import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { idEntitlement } from '../../common/id-deterministico';
import { MODULO_CONFERIR_APPS } from '../../common/conferir-apps';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Quem age no console da distribuição (`DistCtx`). */
type QuemDist = { sub?: string; nome?: string; perfil?: string };

/**
 * O lado da DISTRIBUIÇÃO de "Conferir com os apps" (R3 F4a; mig 405), no console (aba Integrações, só Diretoria): ligar ou
 * desligar o direito `conferir_apps` da empresa (decisão 5 do protótipo: nasce desligada). Sem versão mínima do servidor
 * da loja: o servidor antigo não tem a aba (a tela vem no mesmo .zip que repassa à nuvem). O lojista nunca grava o direito.
 */
@Injectable()
export class ConferirAppsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async rows(q: any): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return (r.rows ?? r) as any[];
  }

  private async empresa(tenantId: string) {
    if (!UUID.test(String(tenantId ?? ''))) throw new BadRequestException('Escolha a empresa.');
    const [e] = await this.rows(sql`select id, nome from empresa where id = ${tenantId} and deleted_at is null`);
    if (!e) throw new NotFoundException('Empresa não encontrada.');
    return e as { id: string; nome: string };
  }

  /** O painel: a liberação, o que cada app tem ligado na empresa e a última leitura de cada loja. */
  async painel(tenantId: string) {
    const emp = await this.empresa(tenantId);
    const [lib, apps, leituras] = await Promise.all([
      this.rows(sql`select ativo from entitlement where tenant_id = ${emp.id} and modulo = ${MODULO_CONFERIR_APPS}`),
      this.rows(sql`
        select exists (select 1 from entitlement where tenant_id = ${emp.id} and modulo = 'ifood_pelo_orzuni' and ativo) as orzuni,
               (select count(*)::int from orzuni_ligacao l join unidade u on u.id = l.unidade_id and u.deleted_at is null
                 where l.tenant_id = ${emp.id} and l.revogada_em is null) as lojas_orzuni,
               exists (select 1 from entitlement where tenant_id = ${emp.id} and modulo = 'precos_na_99' and ativo) as precos99,
               exists (select 1 from integracao where tenant_id = ${emp.id} and canal = '99food' and ativo) as com99`),
      // A leitura guardada (mig 405, só nuvem — o console também).
      this.rows(sql`
        select u.nome as loja, c.canal, c.lido_em, c.erro, c.erro_em,
               jsonb_array_length(c.itens) as itens, jsonb_array_length(c.opcoes) as opcoes
          from conferencia_app_leitura c join unidade u on u.id = c.unidade_id
         where c.tenant_id = ${emp.id}
         order by u.nome, c.canal`),
    ]);
    const a = apps[0] ?? {};
    return {
      empresa: emp,
      liberado: lib[0]?.ativo === true,
      ifood: { liberado: a.orzuni === true, lojasLigadas: Number(a.lojas_orzuni ?? 0) },
      n99: { liberado: a.precos99 === true, conectada: a.com99 === true },
      leituras: leituras.map((l) => ({
        loja: String(l.loja),
        canal: String(l.canal),
        lidoEm: l.lido_em ?? null,
        erro: l.erro ?? null,
        erroEm: l.erro_em ?? null,
        itens: Number(l.itens ?? 0),
        opcoes: Number(l.opcoes ?? 0),
      })),
    };
  }

  /** Liga ou desliga o direito `conferir_apps` da empresa (com auditoria na empresa). */
  async liberacao(dto: { tenantId?: string; ligar?: unknown }, quem: QuemDist) {
    const emp = await this.empresa(String(dto?.tenantId ?? ''));
    if (dto?.ligar !== true && dto?.ligar !== false) throw new BadRequestException('Informe "ligar" (true ou false).');
    const ligar = dto.ligar === true;
    const [antes] = await this.rows(sql`select ativo from entitlement where tenant_id = ${emp.id} and modulo = ${MODULO_CONFERIR_APPS}`);
    // Dois únicos (o id da chave e empresa+módulo): "não faz nada" vale para qualquer um, e o valor vai pela chave natural
    // — dois salvamentos juntos não dão 23505 (ERR-391).
    await this.db.execute(sql`
      insert into entitlement (id, tenant_id, modulo, ativo)
      values (${idEntitlement(emp.id, MODULO_CONFERIR_APPS)}, ${emp.id}, ${MODULO_CONFERIR_APPS}, ${ligar})
      on conflict do nothing`);
    await this.db.execute(sql`
      update entitlement set ativo = ${ligar}, updated_at = now() where tenant_id = ${emp.id} and modulo = ${MODULO_CONFERIR_APPS}`);
    if ((antes?.ativo === true) !== ligar) {
      await this.auditoria.registrar({
        tenantId: emp.id,
        atorId: null,
        atorPerfil: quem?.perfil ?? null,
        atorTipo: 'distribuicao',
        tipo: 'integracao',
        acao: ligar ? 'ligou_conferir_apps' : 'desligou_conferir_apps',
        entidadeTipo: 'empresa',
        entidadeId: emp.id,
        origem: 'distribuicao',
        detalhe: { por: quem?.nome ?? null },
      });
    }
    return { tenantId: emp.id, liberado: ligar };
  }
}
