import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { NOME_DO_FORMULARIO, VERSAO_DO_FORMULARIO, montarFormulario } from '../avaliacao-pedido/formulario-da-nota';
import { TIPO_DO_FORMULARIO } from '../avaliacao-pedido/nota-pelo-whatsapp';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** O que a rotina precisa da Meta (o `WhatsappCloudService`; o teste troca por um falso). */
export type MetaDosFormularios = Pick<WhatsappCloudService, 'formulariosDaConta' | 'criarFormulario' | 'errosDoFormulario' | 'publicarFormulario'>;

export type ContaSemFormulario = { tenantId: string; waba: string; linhaId: string | null };

/**
 * A ROTINA DO FORMULÁRIO DA NOTA (fase A2, mig 456). Só na NUVEM. Para cada conta do WhatsApp oficial (a WABA do número
 * da loja) de uma empresa que LIGOU "Pedir uma nota depois da entrega" e ainda não tem o formulário da versão atual
 * publicado: a DMS cria e publica (a loja não faz nada — "integração: o usuário informa, a Regem conclui").
 *
 *  1. reconhece o que ela mesma já criou pelo NOME (o mesmo nome por versão): publicado → só anota; rascunho → confere os
 *     erros e publica (uma volta anterior criou e não chegou a publicar);
 *  2. senão, cria como RASCUNHO com o Flow JSON; erro de validação → "recusado" com os erros (publicado não se edita — não
 *     se publica nada com erro);
 *  3. publica. Recusou ou não respondeu: "erro" com o motivo da Meta.
 *
 * A vez de cada conta é TOMADA por uma gravação condicional (duas réplicas nunca criam dois formulários na mesma conta) e
 * a próxima tentativa de quem falhou é 30 min depois. Volta curta de 5 min (V104: o relógio recomeça a cada deploy).
 */
@Injectable()
export class FormularioDaNotaProcessor {
  private readonly logger = new Logger('FormularioDaNota');
  private rodando = false;
  static readonly POR_VOLTA = 20;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly cloud: WhatsappCloudService,
  ) {}

  @Interval(5 * 60_000)
  async processar(): Promise<number> {
    if (ehServidorLocal() || this.rodando) return 0;
    this.rodando = true;
    try {
      return await this.preparar(this.cloud);
    } catch (e: any) {
      this.logger.warn(`formulário da nota: a volta falhou — ${e?.message ?? e}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }

  /** As contas que precisam do formulário AGORA (uma consulta para todas as empresas — set-based). */
  async contasSemFormulario(): Promise<ContaSemFormulario[]> {
    const r: any = await this.db.execute(sql`
      select distinct on (cc.wa_cloud_waba_id) cc.tenant_id, cc.wa_cloud_waba_id as waba, f.id as linha_id
        from robo_config rc
        join cardapio_config cc on cc.tenant_id = rc.tenant_id and cc.unidade_id is null and cc.provedor = 'cloud'
                               and coalesce(cc.wa_cloud_waba_id, '') <> ''
        left join whatsapp_flow f on f.waba_id = cc.wa_cloud_waba_id and f.tipo = ${TIPO_DO_FORMULARIO} and f.versao = ${VERSAO_DO_FORMULARIO}
       where rc.nota_ativa
         and (f.id is null or (f.situacao <> 'publicado' and (f.tentou_em is null or f.tentou_em < now() - interval '30 minutes')))
       order by cc.wa_cloud_waba_id, cc.tenant_id
       limit ${FormularioDaNotaProcessor.POR_VOLTA}`);
    return (r?.rows ?? r ?? []).map((x: any) => ({ tenantId: String(x.tenant_id), waba: String(x.waba), linhaId: x.linha_id ?? null }));
  }

  /** Toma a vez da conta (gravação condicional): o id da linha, ou null — outra réplica/volta já está nela. */
  private async tomarAVez(c: ContaSemFormulario): Promise<string | null> {
    const r: any = c.linhaId
      ? await this.db.execute(sql`
          update whatsapp_flow set situacao = 'criando', tentou_em = clock_timestamp()
           where id = ${c.linhaId}::uuid and situacao <> 'publicado'
             and (tentou_em is null or tentou_em < now() - interval '30 minutes')
          returning id`)
      : await this.db.execute(sql`
          insert into whatsapp_flow (tenant_id, waba_id, tipo, versao, situacao, tentou_em)
          values (${c.tenantId}::uuid, ${c.waba}, ${TIPO_DO_FORMULARIO}, ${VERSAO_DO_FORMULARIO}, 'criando', clock_timestamp())
          on conflict (waba_id, tipo, versao) do nothing
          returning id`);
    const id = (r?.rows ?? r ?? [])[0]?.id;
    return id ? String(id) : null;
  }

  private async anotar(id: string, situacao: 'publicado' | 'recusado' | 'erro', o: { flowId?: string | null; erro?: string | null } = {}): Promise<void> {
    await this.db.execute(sql`
      update whatsapp_flow
         set situacao = ${situacao},
             flow_id = coalesce(${o.flowId ?? null}, flow_id),
             erro = ${o.erro ? String(o.erro).slice(0, 1000) : null},
             publicado_em = case when ${situacao} = 'publicado' then coalesce(publicado_em, clock_timestamp()) else publicado_em end
       where id = ${id}::uuid`);
  }

  /** Uma volta: prepara o formulário das contas da vez. Devolve quantas ficaram publicadas. */
  async preparar(meta: MetaDosFormularios): Promise<number> {
    let publicados = 0;
    for (const c of await this.contasSemFormulario()) {
      const id = await this.tomarAVez(c);
      if (!id) continue;
      let flowId: string | null = null;
      try {
        const existentes = await meta.formulariosDaConta(c.waba);
        const meu = existentes.find((f) => f.nome === NOME_DO_FORMULARIO && f.status !== 'DEPRECATED');
        if (meu?.status === 'PUBLISHED') {
          await this.anotar(id, 'publicado', { flowId: meu.id });
          publicados++;
          continue;
        }
        let erros: string[];
        if (meu) {
          flowId = meu.id;
          erros = await meta.errosDoFormulario(meu.id);
        } else {
          const criado = await meta.criarFormulario(c.waba, NOME_DO_FORMULARIO, montarFormulario());
          flowId = criado.id;
          erros = criado.erros;
        }
        if (erros.length) {
          await this.anotar(id, 'recusado', { flowId, erro: `A Meta apontou erro no formulário: ${erros.join(' | ')}` });
          this.logger.warn(`formulário da nota recusado na conta ${c.waba.slice(-4)}: ${erros.join(' | ')}`);
          continue;
        }
        await meta.publicarFormulario(flowId);
        await this.anotar(id, 'publicado', { flowId });
        publicados++;
        this.logger.log(`formulário da nota publicado na conta ${c.waba.slice(-4)} (formulário ${flowId})`);
      } catch (e: any) {
        const motivo = String(e?.message ?? e);
        await this.anotar(id, 'erro', { flowId, erro: motivo }).catch(() => {});
        this.logger.warn(`formulário da nota não ficou pronto na conta ${c.waba.slice(-4)}: ${motivo}`);
      }
    }
    return publicados;
  }
}
