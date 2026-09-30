import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, Interval } from '@nestjs/schedule';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import {
  FotoVenda,
  montarFoto,
  situacaoDaVenda,
  sqlIso,
  sqlVendasDeComandas,
  sqlVendasDePedidos,
  textoCanonico,
} from './venda-integracao';
import { decidirCupom, sqlCupons, sqlUsosCupom } from './cupom-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CARIMBADOR da API de integração (trilha C, C1c — mig 296). Job SÓ DA NUVEM.
//
// Os gatilhos da 296 anotam "este pedido/comanda/cliente mudou" numa fila só de inserção. A cada
// 5 s este job:
//   1. faz a CARGA INICIAL (90 dias) da empresa que ganhou token novo — pela mesma fila, com
//      prioridade baixa (a mudança do dia a dia passa na frente);
//   2. consome a fila e marca as versões PENDENTES — a comanda puxa o(s) pedido(s) ligado(s) a ela
//      (índice por comanda_id, mig 297), porque os itens do pedido são os da comanda;
//   3. carimba: monta a venda como a API devolve (a fórmula do Painel), compara com a última foto
//      e, se mudou, grava a foto nova, sobe a versão e carimba `atualizado_em` — por ÚLTIMO, logo
//      antes do commit, para o carimbo nunca ficar para trás de um cursor já entregue (a leitura
//      só devolve o que foi carimbado há mais de 15 s).
// A comanda sem pedido só é carimbada depois de 10 min sem mudança: a comanda do pedido externo
// nasce fechada numa transação e só depois o pedido ganha o `comanda_id` (achado A5) — sem a
// espera, ela sairia por instantes como venda de balcão. Publicada e depois ligada a um pedido
// (ou apagada), sai de novo como `removido`.
//
// Escala: tudo em conjunto (uma consulta por fonte, nunca uma por venda); a fila é reservada com
// `for update skip locked` numa CTE materializada (LIC-069/LIC-120), então duas réplicas não
// pegam o mesmo item; a venda cuja montagem falha é isolada (as outras seguem — LIC-076).
// Os métodos aceitam `{ tenantIds }` para os testes rodarem o ciclo só nas empresas deles (V32).
//
// CUPONS (mig 298, PR3): pela MESMA fila e tabela de versões — recursos `cupom` e `cupom_uso`
// (o gatilho do uso anota também o cupom, que publica `usos`). Cupom ou uso apagado depois de
// publicado sai como LÁPIDE (`decidirCupom`). A carga dos cupons (todos) e dos usos (91 dias) tem
// controle próprio (`integracao_carga_cupom`): a empresa carregada antes da 298 ganha a dela sem
// repetir a das vendas. Sem a 298 aplicada, só a parte dos cupons para (aviso a cada 10 min).

/** A comanda sem pedido só sai depois deste tempo sem mudança (segundos). */
export const MATURIDADE_COMANDA_SEG = 600;
/** Janela da carga inicial (dias) — o Liame pede 90; um de folga. */
export const CARGA_DIAS = 91;
/** Janela da reconciliação diária (dias). */
export const RECONCILIACAO_DIAS = 3;
/** Lápide de cliente anonimizado (e de cupom/uso apagado) é guardada por este tempo (dias). */
export const RETENCAO_LAPIDE_DIAS = 400;
/** Validade da `Idempotency-Key` das escritas (horas) — o contrato de cupons diz "até 24 h". */
export const IDEMPOTENCIA_HORAS = 24;
const LOTE_FILA = 1000;
const LOTE_CARIMBO = 300;
const ORCAMENTO_CICLO_MS = 4000;

export type EscopoCarimbo = { tenantIds?: string[] };

type Alvo = {
  recurso: 'venda' | 'cliente' | 'cupom' | 'cupom_uso';
  recurso_id: string;
  tenant_id: string;
  fonte: 'pedido_externo' | 'comanda' | 'cliente' | 'cupom' | 'cupom_uso';
  mudou_em: string;
  carga: boolean;
};

type Decisao = {
  recurso: string;
  recurso_id: string;
  publicar: boolean;
  situacao?: string | null;
  unidade_id?: string | null;
  confirmado_em?: string | null;
  removido_em?: string | null;
  foto?: FotoVenda | null;
  erro_em?: string | null;
  erro?: string | null;
};

function lista(ids: string[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
}

/** Sem as tabelas da mig 296 (ainda não aplicada), o job espera este tempo antes de tentar de novo. */
const ESPERA_SEM_TABELA_MS = 10 * 60_000;
/** Erros de "a mig 298 ainda não foi aplicada": tabela ausente, coluna ausente, `check` antigo. */
const SEM_MIG_298 = new Set(['42P01', '42703', '23514']);

@Injectable()
export class CarimbadorIntegracaoService {
  private readonly log = new Logger('IntegracaoCarimbador');
  private rodando = false;
  private pausadoAte = 0;
  private avisoSem298Ate = 0;

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private rows(r: any): any[] {
    return r?.rows ?? r ?? [];
  }

  private escopo(coluna: SQL, e?: EscopoCarimbo): SQL {
    if (!e?.tenantIds) return sql``;
    if (!e.tenantIds.length) return sql`and false`;
    return sql`and ${coluna} in (${lista(e.tenantIds)})`;
  }

  // Um ciclo por vez neste processo (o próximo tick espera). Só na NUVEM (V1, ERR-075): o módulo
  // nem sobe no servidor da loja, e o job se guarda sozinho mesmo assim.
  @Interval(5000)
  async tick(): Promise<void> {
    if (ehServidorLocal() || this.rodando || Date.now() < this.pausadoAte) return;
    this.rodando = true;
    try {
      await this.ciclo();
    } catch (e: any) {
      if (e?.code === '42P01') {
        // Tabela da 296 ausente (migration ainda não aplicada na nuvem): um aviso a cada 10 min,
        // não um erro a cada 5 s. As vendas, o sync e o Painel não dependem deste job.
        this.pausadoAte = Date.now() + ESPERA_SEM_TABELA_MS;
        this.log.warn(`carimbador parado por 10 min: ${e?.message ?? e} — aplique a migration 296 na nuvem`);
      } else {
        this.log.error(`ciclo do carimbador falhou: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`, e?.stack);
      }
    } finally {
      this.rodando = false;
    }
  }

  // Rede de segurança, 1×/dia (04:30 de Brasília): repassa pelo carimbador as vendas das empresas
  // conectadas que mudaram nos últimos 3 dias (a foto só muda se a venda mudou — o que o gatilho
  // não viu ganha versão nova), repete as que falharam e apaga lápides vencidas.
  @Cron('0 30 4 * * *', { timeZone: 'America/Sao_Paulo' })
  async reconciliacaoDiaria(): Promise<void> {
    if (ehServidorLocal()) return;
    try {
      const r = await this.reconciliar();
      this.log.log(`reconciliação: ${r.enfileiradas} venda(s) repassada(s), ${r.lapidesApagadas} lápide(s) vencida(s) apagada(s)`);
    } catch (e: any) {
      this.log.error(`reconciliação falhou: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`, e?.stack);
    }
  }

  /**
   * Um ciclo: cargas pendentes e, até o orçamento de tempo, fila → pendentes → carimbo. Ocioso
   * (nada na fila, nada pendente) custa duas consultas — nenhuma transação é aberta à toa.
   */
  async ciclo(e?: EscopoCarimbo, orcamentoMs = ORCAMENTO_CICLO_MS) {
    const fim = Date.now() + orcamentoMs;
    let cargas = 0;
    let consumidas = 0;
    let carimbadas = 0;
    try {
      cargas = await this.fazerCargas(e);
    } catch (err: any) {
      if (err?.code === '42P01') throw err;
      this.log.error(`carga inicial falhou: ${err?.code ? `[${err.code}] ` : ''}${err?.message ?? err}`, err?.stack);
    }
    // Carga dos cupons: à parte e SEM derrubar o ciclo (sem a mig 298 as vendas seguem).
    cargas += await this.fazerCargasCupons(e);
    for (;;) {
      const [t] = this.rows(
        await this.db.execute(sql`
          select exists (select 1 from integracao_mudanca m where true ${this.escopo(sql`m.tenant_id`, e)}) as fila,
                 exists (select 1 from integracao_versao v
                          where v.pendente
                            and (v.fonte <> 'comanda' or v.mudou_em < now() - make_interval(secs => ${MATURIDADE_COMANDA_SEG}))
                            ${this.escopo(sql`v.tenant_id`, e)}) as pendente`),
      );
      if (!t?.fila && !t?.pendente) break;
      const c = t.fila ? await this.consumirFila(e) : 0;
      const k = await this.carimbar(e);
      consumidas += c;
      carimbadas += k;
      if ((!c && !k) || Date.now() > fim) break;
    }
    return { cargas, consumidas, carimbadas };
  }

  // ───────────────────────────── carga inicial ─────────────────────────────

  /** Empresas com token ativo emitido depois da última carga (a primeira conexão ou uma nova). */
  async fazerCargas(e?: EscopoCarimbo): Promise<number> {
    const pendentes = this.rows(
      await this.db.execute(sql`
        select t.tenant_id::text as tenant_id
          from integracao_token_loja t
          left join integracao_carga c on c.tenant_id = t.tenant_id
         where t.revogado_em is null and (c.feita_em is null or t.criado_em > c.feita_em)
           ${this.escopo(sql`t.tenant_id`, e)}
         group by t.tenant_id
         limit 10`),
    );
    let total = 0;
    for (const p of pendentes) {
      try {
        total += await this.carregarEmpresa(p.tenant_id);
      } catch (err: any) {
        // Uma empresa não segura as outras (LIC-076): registra e segue; tenta de novo no próximo ciclo.
        this.log.error(`carga inicial da empresa ${p.tenant_id} falhou: ${err?.code ? `[${err.code}] ` : ''}${err?.message ?? err}`);
      }
    }
    return total;
  }

  /**
   * Põe na fila (prioridade baixa) as vendas da empresa dos últimos 91 dias. Os gatilhos já
   * anotam desde que o token foi gravado, então nada se perde entre uma coisa e outra; a trava
   * da linha de `integracao_carga` impede duas réplicas de carregar a mesma empresa juntas.
   */
  async carregarEmpresa(tenantId: string, dias = CARGA_DIAS): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into integracao_carga (tenant_id, feita_em) values (${tenantId}::uuid, '-infinity')
        on conflict (tenant_id) do nothing`);
      const [c] = this.rows(
        await tx.execute(sql`
          select exists (select 1 from integracao_token_loja t
                          where t.tenant_id = c.tenant_id and t.revogado_em is null
                            and t.criado_em > c.feita_em) as falta
            from integracao_carga c
           where c.tenant_id = ${tenantId}::uuid
           for update skip locked`),
      );
      if (!c?.falta) return 0; // outra réplica está carregando, ou já carregou
      const r: any = await tx.execute(sql`
        insert into integracao_mudanca (tenant_id, recurso, recurso_id, carga)
        select pe.tenant_id, 'pedido', pe.id, true
          from pedido_externo pe
         where pe.tenant_id = ${tenantId}::uuid
           and (pe.criado_em >= now() - make_interval(days => ${dias})
                or pe.confirmado_em >= now() - make_interval(days => ${dias}))
        union all
        select c.tenant_id, 'comanda', c.id, true
          from comanda c
         where c.tenant_id = ${tenantId}::uuid and c.status in ('fechada', 'cancelada')
           and c.fechada_em >= now() - make_interval(days => ${dias})`);
      // `now()` = início desta transação: token gravado depois dele pede outra carga.
      await tx.execute(sql`update integracao_carga set feita_em = now() where tenant_id = ${tenantId}::uuid`);
      const n = Number(r?.rowCount ?? 0);
      this.log.log(`carga inicial da empresa ${tenantId}: ${n} venda(s) na fila`);
      return n;
    });
  }

  /** Sem a mig 298 na nuvem: um aviso a cada 10 min (as vendas não dependem dos cupons). */
  private avisarSem298(err: any): void {
    if (Date.now() < this.avisoSem298Ate) return;
    this.avisoSem298Ate = Date.now() + ESPERA_SEM_TABELA_MS;
    this.log.warn(`cupons da integração parados: [${err?.code}] ${err?.message ?? err} — aplique a migration 298 na nuvem`);
  }

  /**
   * Carga dos CUPONS por empresa (mig 298): todos os cupons e os usos dos últimos 91 dias, pela
   * fila, com prioridade baixa — a cada token novo, como a das vendas, e uma vez para a empresa
   * já conectada antes da 298 (sem linha em `integracao_carga_cupom`). Nunca lança.
   */
  async fazerCargasCupons(e?: EscopoCarimbo): Promise<number> {
    let pendentes: any[];
    try {
      pendentes = this.rows(
        await this.db.execute(sql`
          select t.tenant_id::text as tenant_id
            from integracao_token_loja t
            left join integracao_carga_cupom c on c.tenant_id = t.tenant_id
           where t.revogado_em is null and (c.feita_em is null or t.criado_em > c.feita_em)
             ${this.escopo(sql`t.tenant_id`, e)}
           group by t.tenant_id
           limit 10`),
      );
    } catch (err: any) {
      if (SEM_MIG_298.has(err?.code)) this.avisarSem298(err);
      else this.log.error(`carga dos cupons falhou: ${err?.code ? `[${err.code}] ` : ''}${err?.message ?? err}`, err?.stack);
      return 0;
    }
    let total = 0;
    for (const p of pendentes) {
      try {
        total += await this.carregarCuponsEmpresa(p.tenant_id);
      } catch (err: any) {
        if (SEM_MIG_298.has(err?.code)) this.avisarSem298(err);
        // Uma empresa não segura as outras (LIC-076).
        else this.log.error(`carga dos cupons da empresa ${p.tenant_id} falhou: ${err?.code ? `[${err.code}] ` : ''}${err?.message ?? err}`);
      }
    }
    return total;
  }

  async carregarCuponsEmpresa(tenantId: string, dias = CARGA_DIAS): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`
        insert into integracao_carga_cupom (tenant_id, feita_em) values (${tenantId}::uuid, '-infinity')
        on conflict (tenant_id) do nothing`);
      const [c] = this.rows(
        await tx.execute(sql`
          select exists (select 1 from integracao_token_loja t
                          where t.tenant_id = c.tenant_id and t.revogado_em is null
                            and t.criado_em > c.feita_em) as falta
            from integracao_carga_cupom c
           where c.tenant_id = ${tenantId}::uuid
           for update skip locked`),
      );
      if (!c?.falta) return 0; // outra réplica está carregando, ou já carregou
      const r: any = await tx.execute(sql`
        insert into integracao_mudanca (tenant_id, recurso, recurso_id, carga)
        select c.tenant_id, 'cupom', c.id, true
          from cupom c
         where c.tenant_id = ${tenantId}::uuid
        union all
        select u.tenant_id, 'cupom_uso', u.id, true
          from cupom_uso u
         where u.tenant_id = ${tenantId}::uuid
           and u.created_at >= now() - make_interval(days => ${dias})`);
      await tx.execute(sql`update integracao_carga_cupom set feita_em = now() where tenant_id = ${tenantId}::uuid`);
      const n = Number(r?.rowCount ?? 0);
      this.log.log(`carga dos cupons da empresa ${tenantId}: ${n} cupom(ns)/uso(s) na fila`);
      return n;
    });
  }

  // ───────────────────────────── fila → pendentes ─────────────────────────────

  /** Consome um lote da fila e marca as versões pendentes. Devolve quantos itens da fila saíram. */
  async consumirFila(e?: EscopoCarimbo, lote = LOTE_FILA): Promise<number> {
    return this.db.transaction(async (tx) => {
      const fila = this.rows(
        await tx.execute(sql`
          with alvo as materialized (
            select m.id from integracao_mudanca m
             where true ${this.escopo(sql`m.tenant_id`, e)}
             order by m.carga, m.criado_em, m.id
             limit ${lote}
             for update skip locked
          )
          delete from integracao_mudanca m using alvo
           where m.id = alvo.id
          returning m.tenant_id::text as tenant_id, m.recurso, m.recurso_id::text as recurso_id, m.carga,
                    ${sqlIso(sql`m.criado_em`)} as criado_em`),
      );
      if (!fila.length) return 0;

      // Os pedidos ligados às comandas que mudaram: os itens do pedido são os da comanda.
      const comandas = [...new Set(fila.filter((f) => f.recurso === 'comanda').map((f) => f.recurso_id as string))];
      const ligados = comandas.length
        ? this.rows(
            await tx.execute(sql`
              select pe.id::text as id, pe.tenant_id::text as tenant_id, pe.comanda_id::text as comanda_id
                from pedido_externo pe
               where pe.comanda_id in (${lista(comandas)})`),
          )
        : [];
      const pedidosDaComanda = new Map<string, any[]>();
      for (const p of ligados) {
        const l = pedidosDaComanda.get(p.comanda_id) ?? [];
        l.push(p);
        pedidosDaComanda.set(p.comanda_id, l);
      }

      const alvos = new Map<string, Alvo>();
      const juntar = (a: Alvo) => {
        const chave = `${a.recurso}:${a.recurso_id}`;
        const x = alvos.get(chave);
        if (!x) alvos.set(chave, a);
        else {
          if (a.mudou_em > x.mudou_em) x.mudou_em = a.mudou_em;
          x.carga = x.carga && a.carga;
        }
      };
      for (const f of fila) {
        const base = { tenant_id: f.tenant_id as string, mudou_em: f.criado_em as string, carga: !!f.carga };
        if (f.recurso === 'pedido') {
          juntar({ ...base, recurso: 'venda', recurso_id: f.recurso_id, fonte: 'pedido_externo' });
        } else if (f.recurso === 'comanda') {
          juntar({ ...base, recurso: 'venda', recurso_id: f.recurso_id, fonte: 'comanda' });
          for (const p of pedidosDaComanda.get(f.recurso_id) ?? []) {
            if (p.tenant_id === f.tenant_id) juntar({ ...base, recurso: 'venda', recurso_id: p.id, fonte: 'pedido_externo' });
          }
        } else if (f.recurso === 'cliente') {
          juntar({ ...base, recurso: 'cliente', recurso_id: f.recurso_id, fonte: 'cliente' });
        } else if (f.recurso === 'cupom' || f.recurso === 'cupom_uso') {
          juntar({ ...base, recurso: f.recurso, recurso_id: f.recurso_id, fonte: f.recurso });
        }
      }

      // Na ordem da chave (menos chance de impasse entre duas réplicas). A carga de comanda já
      // nasce "madura" (fechada há tempo); mudança de verdade reinicia a espera (`greatest`).
      const linhas = [...alvos.values()].sort((a, b) =>
        a.recurso === b.recurso ? (a.recurso_id < b.recurso_id ? -1 : 1) : a.recurso < b.recurso ? -1 : 1,
      );
      await tx.execute(sql`
        insert into integracao_versao (recurso, recurso_id, tenant_id, fonte, pendente, mudou_em)
        select d.recurso, d.recurso_id, d.tenant_id, d.fonte, true,
               case when d.carga and d.fonte = 'comanda'
                    then least(d.mudou_em, now() - make_interval(secs => ${MATURIDADE_COMANDA_SEG + 1}))
                    else d.mudou_em end
          from jsonb_to_recordset(${JSON.stringify(linhas)}::jsonb)
               as d(recurso text, recurso_id uuid, tenant_id uuid, fonte text, mudou_em timestamptz, carga boolean)
         order by d.recurso, d.recurso_id
        on conflict (recurso, recurso_id) do update
           set pendente = true,
               mudou_em = greatest(integracao_versao.mudou_em, excluded.mudou_em),
               erro_em = null,
               erro = null`);
      return fila.length;
    });
  }

  // ───────────────────────────── carimbo ─────────────────────────────

  /** Carimba um lote de versões pendentes prontas. Devolve quantas foram olhadas. */
  async carimbar(e?: EscopoCarimbo, lote = LOTE_CARIMBO): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`set local statement_timeout = '20s'`);
      const alvos = this.rows(
        await tx.execute(sql`
          with alvo as materialized (
            select v.recurso, v.recurso_id from integracao_versao v
             where v.pendente
               and (v.fonte <> 'comanda' or v.mudou_em < now() - make_interval(secs => ${MATURIDADE_COMANDA_SEG}))
               ${this.escopo(sql`v.tenant_id`, e)}
             order by v.mudou_em
             limit ${lote}
             for update skip locked
          )
          select v.recurso, v.recurso_id::text as recurso_id, v.tenant_id::text as tenant_id, v.fonte,
                 v.situacao, v.foto, (v.atualizado_em is not null) as publicada,
                 v.unidade_id::text as unidade_id, ${sqlIso(sql`v.mudou_em`)} as mudou_em,
                 ${sqlIso(sql`v.confirmado_em`)} as confirmado_em
            from integracao_versao v
            join alvo a on a.recurso = v.recurso and a.recurso_id = v.recurso_id`),
      );
      if (!alvos.length) return 0;

      const { reps, erros } = await this.montar(tx, alvos);
      const decisoes: Decisao[] = [];
      const descartes: { recurso: string; recurso_id: string }[] = [];
      const agoraIso = new Date().toISOString();
      for (const v of alvos) {
        const chave = { recurso: v.recurso as string, recurso_id: v.recurso_id as string };
        if (v.recurso === 'cliente') {
          // Cada exclusão do cliente é um aviso novo (a lápide leva a hora da exclusão).
          decisoes.push({ ...chave, publicar: true, situacao: null, removido_em: v.mudou_em, foto: null });
          continue;
        }
        const falha = erros.get(v.recurso_id);
        if (falha) {
          decisoes.push({ ...chave, publicar: false, erro_em: agoraIso, erro: falha.slice(0, 500) });
          continue;
        }
        if (v.recurso === 'cupom' || v.recurso === 'cupom_uso') {
          // Cupom e uso (mig 298): a mesma regra da escrita síncrona — `decidirCupom`.
          const d = decidirCupom(
            {
              recurso: v.recurso,
              publicada: !!v.publicada,
              situacao: v.situacao ?? null,
              unidade_id: v.unidade_id ?? null,
              foto: v.foto,
              confirmado_em: v.confirmado_em ?? null,
              mudou_em: v.mudou_em ?? null,
            },
            reps.get(v.recurso_id),
            (m) => this.log.warn(m),
          );
          if (d.acao === 'descartar') descartes.push(chave);
          else if (d.acao === 'erro') decisoes.push({ ...chave, publicar: false, erro_em: agoraIso, erro: d.erro.slice(0, 500) });
          else if (d.acao === 'manter') decisoes.push({ ...chave, publicar: false });
          else {
            decisoes.push({
              ...chave,
              publicar: true,
              situacao: d.situacao,
              unidade_id: d.unidade_id,
              confirmado_em: d.confirmado_em,
              removido_em: d.removido_em,
              foto: d.foto as any,
            });
          }
          continue;
        }
        const rep = reps.get(v.recurso_id);
        const publicadaComoVenda = !!v.publicada && (v.situacao === 'confirmado' || v.situacao === 'cancelado');
        const sit = situacaoDaVenda(rep, publicadaComoVenda);
        const aviso = (m: string) => this.log.warn(m);
        if (sit) {
          const foto = montarFoto(rep, sit, aviso);
          const mudou = !v.publicada || v.situacao !== sit || textoCanonico(v.foto) !== textoCanonico(foto);
          decisoes.push(
            mudou
              ? { ...chave, publicar: true, situacao: sit, unidade_id: rep.unidade_id ?? null, confirmado_em: foto.confirmado_em, foto }
              : { ...chave, publicar: false },
          );
        } else if (v.publicada) {
          // Deixou de ser venda (comanda que virou parte de um pedido, venda apagada): `removido`.
          if (v.situacao === 'removido') {
            decisoes.push({ ...chave, publicar: false });
          } else if (rep || v.foto) {
            const foto: FotoVenda = rep ? montarFoto(rep, 'removido', aviso) : { ...(v.foto as FotoVenda), cancelado_em: null };
            decisoes.push({
              ...chave,
              publicar: true,
              situacao: 'removido',
              unidade_id: rep ? (rep.unidade_id ?? null) : (v.unidade_id ?? null),
              confirmado_em: foto.confirmado_em,
              foto,
            });
          } else {
            this.log.error(`venda ${v.recurso_id} publicada sem foto e sem origem — mantida como estava`);
            decisoes.push({ ...chave, publicar: false });
          }
        } else {
          descartes.push(chave); // nunca foi publicada e não é venda: nada a dizer ao cliente
        }
      }

      if (descartes.length) {
        await tx.execute(sql`
          delete from integracao_versao v
           using jsonb_to_recordset(${JSON.stringify(descartes)}::jsonb) as d(recurso text, recurso_id uuid)
           where v.recurso = d.recurso and v.recurso_id = d.recurso_id and v.atualizado_em is null`);
      }
      // POR ÚLTIMO, logo antes do commit: o carimbo (`clock_timestamp()`) fica o mais perto possível
      // do instante em que a linha passa a ser vista.
      await tx.execute(sql`
        update integracao_versao v
           set pendente = false,
               versao = case when d.publicar then coalesce(v.versao, 0) + 1 else v.versao end,
               atualizado_em = case when d.publicar then clock_timestamp() else v.atualizado_em end,
               situacao = case when d.publicar then d.situacao else v.situacao end,
               unidade_id = case when d.publicar then d.unidade_id else v.unidade_id end,
               confirmado_em = case when d.publicar then d.confirmado_em else v.confirmado_em end,
               removido_em = case when d.publicar then d.removido_em else v.removido_em end,
               foto = case when d.publicar then d.foto else v.foto end,
               erro_em = d.erro_em,
               erro = d.erro
          from jsonb_to_recordset(${JSON.stringify(decisoes)}::jsonb)
               as d(recurso text, recurso_id uuid, publicar boolean, situacao text, unidade_id uuid,
                    confirmado_em timestamptz, removido_em timestamptz, foto jsonb, erro_em timestamptz, erro text)
         where v.recurso = d.recurso and v.recurso_id = d.recurso_id`);
      return alvos.length;
    });
  }

  /**
   * Monta as vendas do lote: uma consulta por fonte. Se a do lote falhar (um dado que a fórmula
   * não aguenta), cada venda é montada sozinha — a que falhar sozinha fica marcada com o motivo e
   * as outras seguem (LIC-076). Cada tentativa num savepoint: a transação continua usável.
   */
  private async montar(tx: any, alvos: any[]): Promise<{ reps: Map<string, any>; erros: Map<string, string> }> {
    const reps = new Map<string, any>();
    const erros = new Map<string, string>();
    const ids = (recurso: string, fonte?: string) =>
      alvos.filter((a) => a.recurso === recurso && (!fonte || a.fonte === fonte)).map((a) => a.recurso_id as string);
    // Ids são uuid de tabelas diferentes: o mesmo mapa serve às quatro fontes.
    const grupos: [string, string[], (ids: string[]) => SQL][] = [
      ['venda', ids('venda', 'pedido_externo'), sqlVendasDePedidos],
      ['venda', ids('venda', 'comanda'), sqlVendasDeComandas],
      ['cupom', ids('cupom'), sqlCupons],
      ['uso de cupom', ids('cupom_uso'), sqlUsosCupom],
    ];
    for (const [nome, lote, consulta] of grupos) {
      if (!lote.length) continue;
      try {
        const r = this.rows(await tx.transaction((sp: any) => sp.execute(consulta(lote))));
        for (const l of r) reps.set(l.id, l);
      } catch (err: any) {
        this.log.warn(`montagem de ${lote.length} ${nome}(s) falhou (${err?.code ?? '?'}: ${err?.message ?? err}) — uma a uma`);
        for (const id of lote) {
          try {
            const [l] = this.rows(await tx.transaction((sp: any) => sp.execute(consulta([id]))));
            if (l) reps.set(l.id, l);
          } catch (e2: any) {
            const motivo = `${e2?.code ? `[${e2.code}] ` : ''}${e2?.message ?? e2}`;
            erros.set(id, motivo);
            this.log.error(`${nome} ${id}: montagem falhou — ${motivo}`);
          }
        }
      }
    }
    return { reps, erros };
  }

  // ───────────────────────────── reconciliação ─────────────────────────────

  async reconciliar(e?: EscopoCarimbo, dias = RECONCILIACAO_DIAS) {
    const conectadas = sql`(select distinct t.tenant_id from integracao_token_loja t
                             where t.revogado_em is null ${this.escopo(sql`t.tenant_id`, e)})`;
    const r: any = await this.db.execute(sql`
      insert into integracao_mudanca (tenant_id, recurso, recurso_id, carga)
      select pe.tenant_id, 'pedido', pe.id, true
        from pedido_externo pe
       where pe.tenant_id in ${conectadas} and pe.updated_at >= now() - make_interval(days => ${dias})
      union all
      select c.tenant_id, 'comanda', c.id, true
        from comanda c
       where c.tenant_id in ${conectadas} and c.updated_at >= now() - make_interval(days => ${dias})`);
    await this.db.execute(sql`
      update integracao_versao set pendente = true, erro_em = null, erro = null
       where erro_em is not null ${this.escopo(sql`tenant_id`, e)}`);
    const purga: any = await this.db.execute(sql`
      delete from integracao_versao
       where recurso = 'cliente' and removido_em < now() - make_interval(days => ${RETENCAO_LAPIDE_DIAS})
         ${this.escopo(sql`tenant_id`, e)}`);
    const c = await this.reconciliarCupons(e, dias);
    return {
      enfileiradas: Number(r?.rowCount ?? 0) + c.enfileirados,
      lapidesApagadas: Number(purga?.rowCount ?? 0) + c.lapidesApagadas,
    };
  }

  /**
   * Cupons (mig 298): repassa TODOS os cupons das empresas conectadas (são poucos por empresa; a
   * contagem de usos só muda com uso) e os usos dos últimos dias; apaga as lápides de cupom e de
   * uso com mais de 400 dias e as chaves de idempotência vencidas (24 h). Sem a 298: nada, com aviso.
   */
  async reconciliarCupons(e?: EscopoCarimbo, dias = RECONCILIACAO_DIAS) {
    try {
      const conectadas = sql`(select distinct t.tenant_id from integracao_token_loja t
                               where t.revogado_em is null ${this.escopo(sql`t.tenant_id`, e)})`;
      const r: any = await this.db.execute(sql`
        insert into integracao_mudanca (tenant_id, recurso, recurso_id, carga)
        select c.tenant_id, 'cupom', c.id, true
          from cupom c
         where c.tenant_id in ${conectadas}
        union all
        select u.tenant_id, 'cupom_uso', u.id, true
          from cupom_uso u
         where u.tenant_id in ${conectadas} and u.created_at >= now() - make_interval(days => ${dias})`);
      const purga: any = await this.db.execute(sql`
        delete from integracao_versao
         where recurso in ('cupom', 'cupom_uso') and situacao = 'removido'
           and removido_em < now() - make_interval(days => ${RETENCAO_LAPIDE_DIAS})
           ${this.escopo(sql`tenant_id`, e)}`);
      await this.db.execute(sql`
        delete from integracao_idempotencia
         where criado_em < now() - make_interval(hours => ${IDEMPOTENCIA_HORAS})
           ${this.escopo(sql`tenant_id`, e)}`);
      return { enfileirados: Number(r?.rowCount ?? 0), lapidesApagadas: Number(purga?.rowCount ?? 0) };
    } catch (err: any) {
      if (SEM_MIG_298.has(err?.code)) this.avisarSem298(err);
      else this.log.error(`reconciliação dos cupons falhou: ${err?.code ? `[${err.code}] ` : ''}${err?.message ?? err}`, err?.stack);
      return { enfileirados: 0, lapidesApagadas: 0 };
    }
  }
}
