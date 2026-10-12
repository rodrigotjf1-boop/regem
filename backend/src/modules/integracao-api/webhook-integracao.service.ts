import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { ChaveSegredosAusente, cifrar, decifrar } from '../../common/cifra-segredo';
import { fetchExterno } from '../../common/fetch-externo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { IntegracaoCtxData } from './integracao-token.guard';
import { ProblemaException } from './problema';
import { sqlIso } from './venda-integracao';
import { ATRASO_LEITURA_SEG } from './vendas-integracao.service';
import {
  basesDoWebhook,
  cabecalhosDoAviso,
  chaveDoSegredo,
  corpoDoAviso,
  desfechoDoEnvio,
  enderecoPermitido,
  EVENTO_DO_RECURSO,
  EVENTO_DO_RETRATO,
  RecursoAvisado,
  RetratoAvisado,
} from './webhook-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AVISOS (webhooks) da API de integração (trilha C, C3b — mig 304). SÓ NUVEM.
//
// A integração registra, com o token da loja, o endereço e o segredo dela (`PUT /integracao/webhook`).
// A cada 15 s este job olha, numa consulta só, quais lojas têm versão publicada MAIS NOVA do que o
// último aviso (`avisado_ate`) — pelas mesmas regras de escopo e de loja da leitura com cursor — e
// manda UM aviso assinado por loja, no máximo um por minuto. Não há fila de eventos: o aviso é só
// gatilho ("leia de novo"), e a posição fica na própria linha do registro.
//
// RETRATOS (catálogo e fichas, lidos na hora — mig 316): não têm versão publicada. Os gatilhos das
// tabelas do cardápio anotam a mudança numa fila; no começo de cada ciclo o job esvazia a fila e
// carimba a marca (`integracao_retrato_marca`), e a busca de novidade olha a marca junto das versões.
// Só o job grava a marca, depois de a escrita de quem salvou estar confirmada — por isso a hora dela
// nunca fica atrás de um aviso já mandado.
//
// Escala: parado (nada novo) custa DUAS consultas (a fila dos retratos, vazia, e a busca) e nenhuma
// gravação; nenhum retrato é relido para comparar. Só a loja com novidade é
// reservada (a reserva é a `proxima_verificacao_em` empurrada — duas réplicas não mandam o mesmo
// aviso) e ganha uma gravação com o resultado. O destino fora do ar não segura ninguém: prazo
// curto, recuo por loja, e o lote para quando ninguém respondeu.
// Os métodos aceitam `{ tenantIds }` para os testes rodarem só nas empresas deles (V32).

/** Intervalo mínimo entre dois avisos da mesma loja (segundos). */
export const INTERVALO_AVISO_SEG = 60;
/** Reserva do envio em curso (segundos): se o processo cair no meio, a loja volta à fila depois disso. */
const RESERVA_SEG = 120;
const PRAZO_ENVIO_MS = 5000;
const LOTE = 40;
const EM_PARALELO = 8;
const ORCAMENTO_CICLO_MS = 10_000;
const ESPERA_SEM_TABELA_MS = 10 * 60_000;
/** Depois de um erro ao esvaziar a fila dos retratos, quanto esperar para tentar de novo. */
const ESPERA_ERRO_RETRATO_MS = 60_000;
const LIMPEZA_INTERVALO_MS = 10 * 60_000;

export type EscopoAviso = { tenantIds?: string[] };

type Devido = {
  token_id: string;
  tenant_id: string;
  unidade_id: string | null;
  cliente: string;
  url: string;
  segredo_cifrado: string;
  falhas_seguidas: number;
  falhando_ha: number | null;
  recurso: RecursoAvisado | RetratoAvisado;
  /** Nulo no retrato (catálogo, fichas): o aviso vale pela loja, não por um recurso. */
  recurso_id: string | null;
  versao: string | null;
  ate: string;
  cupom_id: string | null;
  pedido_id: string | null;
};

@Injectable()
export class WebhookIntegracaoService {
  private readonly log = new Logger('IntegracaoWebhook');
  private rodando = false;
  private pausadoAte = 0;
  private limpezaEm = 0;
  /** Sem as tabelas da 316 (ou com erro na fila dos retratos): os avisos de venda e de cupom seguem sozinhos. */
  private retratosParadosAte = 0;
  /** Atraso sobre o carimbo, o mesmo da leitura (os testes encurtam). */
  atrasoSeg = ATRASO_LEITURA_SEG;
  /** Intervalo entre avisos da mesma loja (os testes encurtam). */
  intervaloSeg = INTERVALO_AVISO_SEG;
  prazoEnvioMs = PRAZO_ENVIO_MS;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  private rows(r: any): any[] {
    return r?.rows ?? r ?? [];
  }

  private escopo(coluna: SQL, e?: EscopoAviso): SQL {
    if (!e?.tenantIds) return sql``;
    if (!e.tenantIds.length) return sql`and false`;
    return sql`and ${coluna} in (${sql.join(
      e.tenantIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )})`;
  }

  // ───────────────────────────── registro (rotas do token) ─────────────────────────────

  /** O que a integração vê do próprio registro — nunca o segredo. */
  private estado(l: any) {
    return {
      url: l.url as string,
      registrado_em: l.registrado_em as string,
      pausado: !!l.pausado_em,
      pausado_em: (l.pausado_em as string | null) ?? null,
      motivo_pausa: (l.motivo_pausa as string | null) ?? null,
      ultimo_envio_em: (l.ultimo_envio_em as string | null) ?? null,
      ultimo_status_http: l.ultimo_status_http === null || l.ultimo_status_http === undefined ? null : Number(l.ultimo_status_http),
      falhas_seguidas: Number(l.falhas_seguidas ?? 0),
      entregues: Number(l.entregues ?? 0),
    };
  }

  private colunasDoEstado(): SQL {
    return sql`w.url, ${sqlIso(sql`w.registrado_em`)} as registrado_em, ${sqlIso(sql`w.pausado_em`)} as pausado_em,
               w.motivo_pausa, ${sqlIso(sql`w.ultimo_envio_em`)} as ultimo_envio_em, w.ultimo_status_http,
               w.falhas_seguidas, w.entregues::text as entregues`;
  }

  /**
   * `PUT /integracao/webhook`: registra (ou troca) o endereço e o segredo do aviso deste token.
   * Registrar de novo religa o que estava pausado e zera as falhas. O endereço tem de estar na
   * lista do cliente (definida pela distribuição); o segredo é guardado cifrado.
   */
  async registrar(ctx: IntegracaoCtxData, corpo: unknown) {
    const c = corpo as Record<string, unknown> | null;
    if (!c || typeof c !== 'object' || Array.isArray(c)) {
      throw new ProblemaException(400, 'parametro-invalido', 'Envie um JSON com "url" e "segredo".');
    }
    const estranhos = Object.keys(c).filter((k) => k !== 'url' && k !== 'segredo');
    if (estranhos.length) {
      throw new ProblemaException(400, 'parametro-invalido', `Campo desconhecido: ${estranhos.join(', ')}.`);
    }
    const bases = basesDoWebhook(ctx.cliente);
    if (!bases.length) {
      throw new ProblemaException(422, 'endereco-nao-permitido', 'Esta integração não tem aviso habilitado no Regem.');
    }
    const url = enderecoPermitido(c.url, bases);
    if (!url) {
      this.log.warn(`token ${ctx.prefixo}… (${ctx.cliente}): endereço de aviso fora da lista permitida — recusado`);
      throw new ProblemaException(
        422,
        'endereco-nao-permitido',
        '"url" precisa ser um endereço da própria integração, registrado no Regem pela distribuição.',
      );
    }
    if (!chaveDoSegredo(c.segredo)) {
      throw new ProblemaException(
        400,
        'parametro-invalido',
        '"segredo" precisa estar no formato Standard Webhooks: "whsec_" + base64 de 24 a 64 bytes.',
      );
    }
    const segredo = c.segredo as string;
    let cifrado: string;
    try {
      cifrado = cifrar(segredo);
    } catch (e: any) {
      // Sem a chave de segredos na nuvem não há como guardar: motivo no log, resposta sem detalhe.
      this.log.error(`aviso não registrado: ${e instanceof ChaveSegredosAusente ? e.message : (e?.message ?? e)}`);
      throw new ProblemaException(503, 'aviso-indisponivel', 'Os avisos não estão disponíveis agora. A leitura com cursor segue valendo.');
    }

    const [antes] = this.rows(
      await this.db.execute(sql`
        select w.url, w.segredo_cifrado, w.pausado_em is not null as pausado
          from integracao_webhook w
         where w.token_id = ${ctx.tokenId}::uuid`),
    );
    let mesmoSegredo = false;
    if (antes) {
      try {
        mesmoSegredo = decifrar(antes.segredo_cifrado) === segredo;
      } catch {
        mesmoSegredo = false; // o guardado não abre mais: o novo o substitui
      }
    }
    const mudou = !antes || antes.url !== url || !mesmoSegredo || !!antes.pausado;

    const [l] = this.rows(
      await this.db.execute(sql`
        insert into integracao_webhook as w (token_id, tenant_id, unidade_id, cliente, url, segredo_cifrado)
        values (${ctx.tokenId}::uuid, ${ctx.tenantId}::uuid, ${ctx.unidadeId}::uuid, ${ctx.cliente}, ${url}, ${cifrado})
        on conflict (token_id) do update
           set url = excluded.url,
               segredo_cifrado = excluded.segredo_cifrado,
               registrado_em = now(),
               falhas_seguidas = 0,
               primeira_falha_em = null,
               pausado_em = null,
               motivo_pausa = null,
               proxima_verificacao_em = least(w.proxima_verificacao_em, now())
        returning ${this.colunasDoEstado()}`),
    );
    if (mudou) {
      // O registro repetido do dia a dia (mesmo endereço, mesmo segredo) não vira linha de auditoria.
      await this.auditoria.registrar({
        tenantId: ctx.tenantId,
        unidadeId: ctx.unidadeId,
        atorTipo: 'integracao',
        tipo: 'integracao',
        acao: 'integracao.webhook_registrado',
        origem: 'integracao',
        entidadeTipo: 'integracao_token',
        entidadeId: ctx.tokenId,
        detalhe: { cliente: ctx.cliente, prefixo: ctx.prefixo, url, novo: !antes },
      });
    }
    return this.estado(l);
  }

  /** `GET /integracao/webhook`: a situação do aviso deste token (404 se não há registro). */
  async ler(ctx: IntegracaoCtxData) {
    const [l] = this.rows(
      await this.db.execute(sql`
        select ${this.colunasDoEstado()}
          from integracao_webhook w
         where w.token_id = ${ctx.tokenId}::uuid`),
    );
    if (!l) throw new ProblemaException(404, 'nao-encontrado', 'Este token não tem aviso registrado.');
    return this.estado(l);
  }

  /** `DELETE /integracao/webhook`: para de avisar. Sem registro, não faz nada (a resposta é a mesma). */
  async remover(ctx: IntegracaoCtxData): Promise<void> {
    const apagados = this.rows(
      await this.db.execute(sql`
        delete from integracao_webhook w
         where w.token_id = ${ctx.tokenId}::uuid
        returning w.url`),
    );
    if (!apagados.length) return;
    await this.auditoria.registrar({
      tenantId: ctx.tenantId,
      unidadeId: ctx.unidadeId,
      atorTipo: 'integracao',
      tipo: 'integracao',
      acao: 'integracao.webhook_removido',
      origem: 'integracao',
      entidadeTipo: 'integracao_token',
      entidadeId: ctx.tokenId,
      detalhe: { cliente: ctx.cliente, prefixo: ctx.prefixo, url: apagados[0].url },
    });
  }

  // ───────────────────────────── o job ─────────────────────────────

  // Um ciclo por vez neste processo. Só na NUVEM (V1, ERR-075): o módulo nem sobe no servidor da
  // loja (e a tabela não existe lá), e o job se guarda sozinho mesmo assim.
  @Interval(15000)
  async tick(): Promise<void> {
    if (ehServidorLocal() || this.rodando || Date.now() < this.pausadoAte) return;
    this.rodando = true;
    try {
      if (Date.now() >= this.limpezaEm) {
        this.limpezaEm = Date.now() + LIMPEZA_INTERVALO_MS;
        await this.limpar();
      }
      await this.ciclo();
    } catch (e: any) {
      if (e?.code === '42P01') {
        // Tabela da 304 ausente (migration ainda não aplicada): um aviso a cada 10 min. Nada mais
        // depende deste job — a leitura com cursor segue igual.
        this.pausadoAte = Date.now() + ESPERA_SEM_TABELA_MS;
        this.log.warn(`avisos da integração parados por 10 min: ${e?.message ?? e} — aplique a migration 304 na nuvem`);
      } else {
        this.log.error(`ciclo dos avisos falhou: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`, e?.stack);
      }
    } finally {
      this.rodando = false;
    }
  }

  /** Apaga o registro de token revogado ou vencido (o segredo guardado sai junto). */
  async limpar(e?: EscopoAviso): Promise<number> {
    const r: any = await this.db.execute(sql`
      delete from integracao_webhook w
       using integracao_token_loja t
       where t.id = w.token_id
         and (t.revogado_em is not null or (t.expira_em is not null and t.expira_em <= now()))
         ${this.escopo(sql`w.tenant_id`, e)}`);
    return Number(r?.rowCount ?? 0);
  }

  /** Um ciclo: reserva as lojas com novidade e manda os avisos, até acabar ou o tempo do ciclo. */
  async ciclo(e?: EscopoAviso, orcamentoMs = ORCAMENTO_CICLO_MS) {
    const fim = Date.now() + orcamentoMs;
    await this.carimbarRetratos(e);
    let enviados = 0;
    let entregues = 0;
    for (;;) {
      const lote = await this.reservar(e, LOTE);
      if (!lote.length) break;
      let ok = 0;
      for (let i = 0; i < lote.length; i += EM_PARALELO) {
        const r = await Promise.all(lote.slice(i, i + EM_PARALELO).map((l) => this.enviar(l)));
        ok += r.filter(Boolean).length;
      }
      enviados += lote.length;
      entregues += ok;
      // Ninguém respondeu (destino fora do ar): o resto fica para o próximo ciclo.
      if (!ok || lote.length < LOTE || Date.now() > fim) break;
    }
    return { enviados, entregues };
  }

  /**
   * Esvazia a fila que os gatilhos do cardápio e das fichas escrevem (mig 316) e carimba a marca de
   * cada empresa × loja × tipo que mudou — num comando só. A hora da marca é a DESTE job, e não a da
   * escrita: ele só enxerga o que já foi confirmado, então a marca nunca nasce "no passado" de um aviso
   * já mandado. Duas réplicas não se atrapalham (cada linha da fila sai por uma só).
   * Nunca rejeita: sem as tabelas da 316, ou com erro, os avisos de venda e de cupom seguem valendo.
   */
  async carimbarRetratos(e?: EscopoAviso): Promise<number> {
    if (Date.now() < this.retratosParadosAte) return 0;
    try {
      const r: any = await this.db.execute(sql`
        with lidas as (
          delete from integracao_retrato_mudanca m
           where true ${this.escopo(sql`m.tenant_id`, e)}
          returning m.tenant_id, m.recurso, m.unidade_id
        )
        insert into integracao_retrato_marca as k (tenant_id, recurso, unidade_id, atualizado_em)
        select d.tenant_id, d.recurso, d.unidade_id, clock_timestamp()
          from (select distinct l.tenant_id, l.recurso, l.unidade_id from lidas l) d
        on conflict (tenant_id, recurso, (coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid)))
        do update set atualizado_em = excluded.atualizado_em`);
      return Number(r?.rowCount ?? 0);
    } catch (erro: any) {
      if (erro?.code === '42P01') {
        this.retratosParadosAte = Date.now() + ESPERA_SEM_TABELA_MS;
        this.log.warn(
          `avisos do cardápio e das fichas parados por 10 min: ${erro?.message ?? erro} — aplique a migration 316 na nuvem (os avisos de venda e de cupom seguem)`,
        );
      } else {
        this.retratosParadosAte = Date.now() + ESPERA_ERRO_RETRATO_MS;
        this.log.error(
          `fila dos retratos não esvaziada: ${erro?.code ? `[${erro.code}] ` : ''}${erro?.message ?? erro} — tento de novo em 1 min`,
          erro?.stack,
        );
      }
      return 0;
    }
  }

  /**
   * As lojas com registro ativo, na vez delas, que têm versão publicada mais nova do que o último
   * aviso — e a reserva delas, no MESMO comando. O que conta como novidade segue a leitura com
   * cursor: só o recurso que o escopo do token libera, só o carimbado há mais de 15 s, e a loja do
   * token (empresa de uma loja, ou token da empresa: tudo; cupom sem loja vale para todas; cliente
   * anonimizado é da empresa). O retrato (catálogo, fichas) entra pela marca, com a mesma regra: a
   * marca sem loja é da rede e vale para todas as lojas da empresa.
   */
  private async reservar(e: EscopoAviso | undefined, lote: number): Promise<Devido[]> {
    const pares = sql.join(
      (Object.keys(EVENTO_DO_RECURSO) as RecursoAvisado[]).map((r) => sql`(${r}, ${EVENTO_DO_RECURSO[r].escopo})`),
      sql`, `,
    );
    const paresRetrato = sql.join(
      (Object.keys(EVENTO_DO_RETRATO) as RetratoAvisado[]).map((r) => sql`(${r}, ${EVENTO_DO_RETRATO[r].escopo})`),
      sql`, `,
    );
    // Sem as tabelas da 316 a busca segue só com as versões (os avisos de antes não param).
    const marcas =
      Date.now() < this.retratosParadosAte
        ? sql``
        : sql`
                  union all
                  (select m.recurso, null::uuid as recurso_id, null::bigint as versao, m.atualizado_em,
                          null::text as cupom_id, null::text as pedido_id
                     from integracao_retrato_marca m
                    where m.tenant_id = w.tenant_id
                      and m.recurso = any(p.retratos)
                      and m.atualizado_em > w.avisado_ate
                      and m.atualizado_em <= now() - make_interval(secs => ${this.atrasoSeg})
                      and (p.loja_unica or w.unidade_id is null or m.unidade_id is null or m.unidade_id = w.unidade_id)
                    order by m.atualizado_em desc
                    limit 1)`;
    return this.rows(
      await this.db.execute(sql`
        with nov as materialized (
          select w.token_id, n.recurso, n.recurso_id, n.versao, n.atualizado_em, n.cupom_id, n.pedido_id
            from integracao_webhook w
            join integracao_token_loja t on t.id = w.token_id
           cross join lateral (
                  select array(select r.recurso from (values ${pares}) as r(recurso, escopo)
                                where r.escopo = any(t.escopos)) as recursos,
                         array(select r.recurso from (values ${paresRetrato}) as r(recurso, escopo)
                                where r.escopo = any(t.escopos)) as retratos,
                         (select count(*) from unidade u
                           where u.tenant_id = w.tenant_id and u.deleted_at is null) = 1 as loja_unica
                 ) p
           cross join lateral (
                  select x.recurso, x.recurso_id, x.versao, x.atualizado_em, x.cupom_id, x.pedido_id
                    from (
                  (select v.recurso, v.recurso_id, v.versao, v.atualizado_em,
                          case when v.recurso = 'cupom_uso' then v.foto->>'cupom_id' end as cupom_id,
                          case when v.recurso = 'cupom_uso' then v.foto->>'pedido_id' end as pedido_id
                     from integracao_versao v
                    where v.tenant_id = w.tenant_id
                      and v.recurso = any(p.recursos)
                      and v.atualizado_em > w.avisado_ate
                      and v.atualizado_em <= now() - make_interval(secs => ${this.atrasoSeg})
                      and (p.loja_unica or w.unidade_id is null or v.recurso = 'cliente'
                           or v.unidade_id = w.unidade_id
                           or (v.recurso = 'cupom' and v.unidade_id is null))
                    order by v.atualizado_em desc, v.recurso_id desc
                    limit 1)${marcas}
                         ) x
                   order by x.atualizado_em desc
                   limit 1
                 ) n
           where w.pausado_em is null
             and w.proxima_verificacao_em <= now()
             and t.revogado_em is null
             and (t.expira_em is null or t.expira_em > now())
             ${this.escopo(sql`w.tenant_id`, e)}
           order by w.proxima_verificacao_em
           limit ${lote}
        ), res as (
          update integracao_webhook w
             set proxima_verificacao_em = now() + make_interval(secs => ${RESERVA_SEG})
            from nov
           where w.token_id = nov.token_id
             and w.pausado_em is null
             and w.proxima_verificacao_em <= now()
          returning w.token_id, w.tenant_id, w.unidade_id, w.cliente, w.url, w.segredo_cifrado, w.falhas_seguidas,
                    extract(epoch from (now() - w.primeira_falha_em))::float8 as falhando_ha
        )
        select res.token_id::text as token_id, res.tenant_id::text as tenant_id, res.unidade_id::text as unidade_id,
               res.cliente, res.url,
               res.segredo_cifrado, res.falhas_seguidas, res.falhando_ha,
               nov.recurso, nov.recurso_id::text as recurso_id, nov.versao::text as versao,
               ${sqlIso(sql`nov.atualizado_em`)} as ate, nov.cupom_id, nov.pedido_id
          from res
          join nov on nov.token_id = res.token_id`),
    ) as Devido[];
  }

  /** Manda um aviso e grava o resultado. Nunca rejeita (V3): devolve se foi entregue. */
  private async enviar(l: Devido): Promise<boolean> {
    try {
      let status: number | null = null;
      let erro: string | null = null;
      let chave: Buffer | null = null;
      try {
        chave = chaveDoSegredo(decifrar(l.segredo_cifrado));
      } catch {
        chave = null;
      }
      if (!chave) {
        // A chave de segredos desta nuvem mudou (ou o valor foi alterado): não é falha do destino.
        await this.gravarPausa(l, null, 'o segredo guardado não abre mais neste servidor — registre o aviso de novo');
        return false;
      }
      const corpo = JSON.stringify(
        corpoDoAviso(
          {
            recurso: l.recurso,
            id: l.recurso_id ?? null,
            versao: l.versao === null || l.versao === undefined ? null : Number(l.versao),
            cupom_id: l.cupom_id,
            pedido_id: l.pedido_id,
          },
          l.unidade_id,
        ),
      );
      try {
        // `redirect: 'manual'`: o endereço foi conferido na entrada; um redirecionamento do destino
        // não leva o aviso (nem a assinatura) para outro lugar.
        const r = await fetchExterno(
          l.url,
          { method: 'POST', headers: cabecalhosDoAviso(chave, randomUUID(), corpo), body: corpo, redirect: 'manual' },
          this.prazoEnvioMs,
        );
        status = r.status;
        await r.body?.cancel().catch(() => undefined);
        if (status < 200 || status >= 300) erro = `o destino respondeu ${status}`;
      } catch (e: any) {
        erro = String(e?.message ?? e).slice(0, 300);
      }

      const d = desfechoDoEnvio({ status, falhasSeguidas: Number(l.falhas_seguidas ?? 0), falhandoHaSeg: l.falhando_ha });
      if (d.resultado === 'entregue') {
        await this.db.execute(sql`
          update integracao_webhook
             set avisado_ate = greatest(avisado_ate, ${l.ate}::timestamptz),
                 proxima_verificacao_em = now() + make_interval(secs => ${this.intervaloSeg}),
                 falhas_seguidas = 0, primeira_falha_em = null,
                 ultimo_envio_em = now(), ultimo_status_http = ${status}, ultimo_erro = null,
                 entregues = entregues + 1
           where token_id = ${l.token_id}::uuid`);
        return true;
      }
      if (d.resultado === 'pausa') {
        await this.gravarPausa(l, status, d.motivo);
        return false;
      }
      await this.db.execute(sql`
        update integracao_webhook
           set falhas_seguidas = falhas_seguidas + 1,
               primeira_falha_em = coalesce(primeira_falha_em, now()),
               proxima_verificacao_em = now() + make_interval(secs => ${d.recuoSeg}),
               ultimo_envio_em = now(), ultimo_status_http = ${status}, ultimo_erro = ${erro}
         where token_id = ${l.token_id}::uuid`);
      this.log.warn(
        `aviso ao ${l.cliente} (empresa ${l.tenant_id}) não entregue: ${erro} — tento de novo em ${Math.round(d.recuoSeg / 60)} min`,
      );
      return false;
    } catch (e: any) {
      // Falhou ao gravar o resultado: a reserva (2 min) devolve a loja à fila sozinha.
      this.log.error(`aviso do token ${l.token_id}: resultado não gravado — ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`);
      return false;
    }
  }

  private async gravarPausa(l: Devido, status: number | null, motivo: string): Promise<void> {
    await this.db.execute(sql`
      update integracao_webhook
         set pausado_em = now(), motivo_pausa = ${motivo},
             falhas_seguidas = falhas_seguidas + 1,
             primeira_falha_em = coalesce(primeira_falha_em, now()),
             ultimo_envio_em = now(), ultimo_status_http = ${status}, ultimo_erro = ${motivo}
       where token_id = ${l.token_id}::uuid`);
    this.log.warn(`aviso ao ${l.cliente} (empresa ${l.tenant_id}) PAUSADO: ${motivo}. Um registro novo religa.`);
  }
}
