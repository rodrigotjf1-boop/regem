import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { sqlChaveTelefone } from '../../common/telefone-chave';
import { estadoDaPausa } from './robo-pausa';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { sqlConversaNaJanela } from './janela-da-conversa';
import { ACAO_PERGUNTA, ATE_HORAS, CANAIS_DE_FORA, DEPOIS_MIN, OPCOES_DA_CONFERENCIA, textoDaPergunta } from './conferir-entrega';

/* eslint-disable @typescript-eslint/no-explicit-any */

type Candidato = {
  id: string;
  tenantId: string;
  unidadeId: string | null;
  numero: string | null;
  nome: string | null;
  telefone: string;
  /** O número da conversa aberta (o cliente escreveu nas últimas 24 h), como a Meta o manda. */
  para: string;
};

/**
 * A ROTINA DO "CHEGOU TUDO CERTO?" (B1; mig 352). Só na NUVEM (o WhatsApp só existe lá). Quem recebe: o cliente de um
 * pedido de ENTREGA dos canais da própria loja (nunca iFood nem 99), concluído há 20 min a 3 h, da loja que LIGOU a
 * pergunta (`robo_config.conferir_entrega`, nasce desligado) e usa a API OFICIAL, com a conversa aberta (o cliente
 * escreveu nas últimas 24 h — a janela da Meta; a mensagem vai para o número da conversa) e sem atendente nela (pausa
 * ou caso aberto). UMA vez por pedido: o envio é gravado ANTES de mandar (`insert … on conflict do nothing returning`);
 * não saiu → fica "falhou" (não pergunta de novo). Até 50 por volta, de 2 em 2 minutos. A resposta é tratada no portão
 * da entrada (conferir-entrega.ts).
 *
 * A conversa aberta é conferida NA consulta (ERR-360): o pedido de quem não escreveu à loja nem entra na lista — antes ele
 * voltava na frente a cada volta e, com 50 deles, os mais novos nunca chegavam à vez. A lista leva até 200 (a conversa com
 * alguém da equipe é pulada sem marcar e não pode tomar a vez dos outros); saem até 50 por volta.
 */
@Injectable()
export class ConferirEntregaProcessor {
  private readonly logger = new Logger('ConferirEntrega');
  private rodando = false;
  static readonly POR_VOLTA = 50;
  static readonly LISTA = 200;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly cloud: WhatsappCloudService,
  ) {}

  @Interval(120_000)
  async processar(): Promise<number> {
    if (ehServidorLocal() || this.rodando) return 0;
    this.rodando = true;
    try {
      return await this.perguntar();
    } catch (e: any) {
      this.logger.warn(`"chegou tudo certo?": a volta falhou — ${e?.message ?? e}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Os pedidos que podem receber a pergunta AGORA — uma consulta para todas as lojas (set-based), já com a conversa aberta
   * (ERR-360). A chave do telefone é calculada uma vez por pedido (CTE `materialized`) e cada forma do número é achada pelo
   * índice das mensagens (LIC-113). Fora da janela de 24 h: o pedido não entra e a volta seguinte tenta de novo, até 3 h.
   */
  async candidatos(): Promise<Candidato[]> {
    const r: any = await this.db.execute(ConferirEntregaProcessor.consulta());
    return (r?.rows ?? r ?? []).map((x: any) => ({
      id: String(x.id),
      tenantId: String(x.tenant_id),
      unidadeId: x.unidade_id ?? null,
      numero: x.numero ?? null,
      nome: x.cliente_nome ?? null,
      telefone: String(x.cliente_telefone),
      para: String(x.para),
    }));
  }

  /** A consulta dos candidatos (à parte para o teste conferir o plano — a conversa pelo índice). */
  static consulta(): SQL {
    return sql`
      with base as materialized (
        select p.id, p.tenant_id, p.unidade_id, coalesce(p.display_id, p.numero::text) as numero, p.cliente_nome, p.cliente_telefone,
               p.concluido_em, ${sqlChaveTelefone(sql`p.cliente_telefone`)} as chave
          from pedido_externo p
          join robo_config rc on rc.tenant_id = p.tenant_id and rc.conferir_entrega
          join cardapio_config cc on cc.tenant_id = p.tenant_id and cc.unidade_id is null
                                 and cc.provedor = 'cloud' and coalesce(cc.wa_cloud_phone_id, '') <> ''
         where p.status = 'concluido' and p.tipo = 'entrega'
           and p.canal not in (${sql.join(CANAIS_DE_FORA.map((c) => sql`${c}`), sql`, `)})
           and coalesce(trim(p.cliente_telefone), '') <> ''
           and p.concluido_em < now() - make_interval(mins => ${DEPOIS_MIN})
           and p.concluido_em > now() - make_interval(hours => ${ATE_HORAS})
           and not exists (select 1 from pedido_envio e where e.pedido_id = p.id and e.acao = ${ACAO_PERGUNTA})
      )
      select b.id, b.tenant_id, b.unidade_id, b.numero, b.cliente_nome, b.cliente_telefone, conversa.para
        from base b
        join ${sqlConversaNaJanela(sql`b.tenant_id`, sql`b.chave`)} conversa on true
       order by b.concluido_em, b.id
       limit ${ConferirEntregaProcessor.LISTA}`;
  }

  /** Pergunta aos candidatos: confere a equipe na conversa, grava "perguntei" primeiro e manda. Devolve quantas saíram. */
  async perguntar(): Promise<number> {
    let n = 0;
    for (const c of await this.candidatos()) {
      if (n >= ConferirEntregaProcessor.POR_VOLTA) break; // o resto fica para a volta seguinte
      try {
        const para = c.para;
        if ((await estadoDaPausa(this.db, c.tenantId, para)).pausado) continue; // alguém da equipe está na conversa
        const marcou: any = await this.db.execute(sql`
          insert into pedido_envio (tenant_id, unidade_id, pedido_id, destino, acao, resultado, servidor)
          values (${c.tenantId}::uuid, ${c.unidadeId}, ${c.id}::uuid, 'cliente_whatsapp', ${ACAO_PERGUNTA}, 'enviado', 'nuvem')
          on conflict (pedido_id, acao) where acao in ('conferir_entrega', 'conferir_entrega_resposta') do nothing
          returning id`);
        const id = (marcou?.rows ?? marcou ?? [])[0]?.id;
        if (!id) continue; // outra volta (ou réplica) já perguntou
        try {
          await this.cloud.enviarOpcoes(c.tenantId, para, textoDaPergunta(c.nome, c.numero), OPCOES_DA_CONFERENCIA);
          n++;
        } catch (e: any) {
          const motivo = String(e?.message ?? e).slice(0, 300);
          await this.db.execute(sql`update pedido_envio set resultado = 'falhou', motivo = ${motivo} where id = ${id}::uuid`);
          this.logger.warn(`"chegou tudo certo?" do pedido ${c.id} não saiu: ${motivo}`);
        }
      } catch (e: any) {
        this.logger.warn(`"chegou tudo certo?" do pedido ${c.id}: ${e?.message ?? e}`);
      }
    }
    return n;
  }
}
