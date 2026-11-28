import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { hojeISO, somarDias } from '../../common/data';
import { PRECOS_LIDOS_EM, UsoDaChamada, custoEstimadoUsd } from '../ia/ia.regras';
import { FUSO_SQL } from '../../common/fuso-sql';
import { FERRAMENTA_DO_QUE_FALTA, RECURSO_DAS_PERGUNTAS, ROTULO_DO_TEMA, ehFerramenta, temaDoQueFalta } from './mister-agente.regras';
import {
  DecisaoValendo,
  EntradaDoQueMelhorar,
  NAO_SE_APLICA_DIAS,
  comAsDecisoes,
  conferirDecisao,
  ehChaveDoPadrao,
  motivoNaQualidade,
  motivosAgrupados,
  nomeDaConsultaNaQualidade,
  padroesParaMelhorar,
  pct,
  periodoDaQualidade,
  temasAgrupados,
} from './mister-qualidade';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A QUALIDADE DO MISTER (F5): como o Mister está respondendo, em TODAS as empresas, para o console da distribuição
// (Diretoria). Só números de cada pergunta: se respondeu, o tempo, o custo, as consultas usadas, o motivo de não
// responder e o TEMA do que pediram e ele não tem (F5.2, a anotação `anotar_o_que_falta` na trilha) — nunca o texto da
// pergunta ou da resposta (é da loja), nem telefone ou pessoa.
// Cada bloco é UMA consulta agregada no banco (nada de laço por empresa): a página pode ler muitas empresas.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.cause?.code === '42P01';
const umaCasa = (v: unknown): number | null => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 10) / 10);
const seisCasas = (v: number) => Math.round(v * 1_000_000) / 1_000_000;
const ARRAY_DE_CONSULTAS = sql`case when jsonb_typeof(p.ferramentas) = 'array' then p.ferramentas else '[]'::jsonb end`;
// A anotação do que falta não lê dado: não conta como consulta (a resposta que só anotou é "sem consultar dado").
const NENHUMA_CONSULTA = sql`not exists (select 1 from jsonb_array_elements(${ARRAY_DE_CONSULTAS}) c where c ->> 'nome' is distinct from ${FERRAMENTA_DO_QUE_FALTA})`;
const ANOTOU_O_QUE_FALTA = sql`exists (select 1 from jsonb_array_elements(${ARRAY_DE_CONSULTAS}) c where c ->> 'nome' = ${FERRAMENTA_DO_QUE_FALTA})`;

@Injectable()
export class MisterQualidadeService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // ───────────────────────────── M2a: as decisões do "O que melhorar" (mig 432) ─────────────────────────────

  /** As decisões que valem (não desfeitas). Banco sem a 432: nenhuma. */
  async decisoesValendo(): Promise<DecisaoValendo[]> {
    try {
      return linhas(
        await this.db.execute(sql`
          select chave, decisao, motivo, tarefa, quem,
                 to_char(decidida_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "decididaEm",
                 to_char(vale_ate at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "valeAte"
            from mister_melhoria_decisao where desfeita_em is null`),
      ) as DecisaoValendo[];
    } catch (e: any) {
      if (semTabela(e)) return [];
      throw e;
    }
  }

  /**
   * "Virou tarefa" ou "Não se aplica" num padrão. Um "não se aplica" já vencido não bloqueia: é desfeito na mesma
   * transação. Uma decisão valendo bloqueia (desfazer antes) — o índice único parcial garante com duas abas ao mesmo tempo.
   */
  async decidir(dto: unknown, quem: string | null): Promise<DecisaoValendo> {
    const d = conferirDecisao(dto);
    if ('erro' in d) throw new BadRequestException(d.erro);
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(sql`
          update mister_melhoria_decisao set desfeita_em = clock_timestamp()
           where chave = ${d.chave} and desfeita_em is null and vale_ate is not null and vale_ate <= clock_timestamp()`);
        const [l] = linhas(
          await tx.execute(sql`
            insert into mister_melhoria_decisao (chave, decisao, motivo, tarefa, quem, vale_ate)
            values (${d.chave}, ${d.decisao}, ${d.motivo}, ${d.tarefa}, ${quem},
                    ${d.decisao === 'nao_se_aplica' ? sql`clock_timestamp() + make_interval(days => ${NAO_SE_APLICA_DIAS}::int)` : sql`null`})
            returning chave, decisao, motivo, tarefa, quem,
                      to_char(decidida_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "decididaEm",
                      to_char(vale_ate at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "valeAte"`),
        );
        return l as DecisaoValendo;
      });
    } catch (e: any) {
      if (e?.code === '23505' || e?.cause?.code === '23505') throw new ConflictException('Esse padrão já tem uma decisão. Desfaça a decisão antes de decidir de novo.');
      throw e;
    }
  }

  /** "Desfazer a decisão": a linha fica (histórico) e deixa de valer; o padrão volta a "aberto". */
  async desfazer(chave: unknown): Promise<{ ok: true }> {
    if (!ehChaveDoPadrao(chave)) throw new BadRequestException('Padrão desconhecido.');
    const r = linhas(
      await this.db.execute(sql`
        update mister_melhoria_decisao set desfeita_em = clock_timestamp()
         where chave = ${chave} and desfeita_em is null returning id`),
    );
    if (!r.length) throw new NotFoundException('Esse padrão não tem decisão valendo.');
    return { ok: true };
  }

  async resumo(diasPedidos?: unknown) {
    const dias = periodoDaQualidade(diasPedidos);
    // Instantes comparados com instantes (V46: nada de current_date); o uso da IA é por dia, contado pelo dia da operação.
    const desde = sql`now() - make_interval(days => ${dias})`;
    const doPeriodo = sql`p.criado_em > ${desde} and p.situacao in ('respondida', 'falhou')`;

    const [t] = linhas(
      await this.db.execute(sql`
        select count(*)::int as perguntas,
               count(*) filter (where p.situacao = 'respondida')::int as respondidas,
               count(*) filter (where p.situacao = 'falhou')::int as falhas,
               count(*) filter (where p.situacao = 'respondida' and p.chamadas > 0 and ${NENHUMA_CONSULTA})::int as sem_consulta,
               count(*) filter (where ${ANOTOU_O_QUE_FALTA})::int as nao_tem,
               count(distinct p.tenant_id)::int as empresas,
               count(distinct p.colaborador_id)::int as pessoas,
               percentile_cont(0.5) within group (order by extract(epoch from (p.respondida_em - p.criado_em)))
                 filter (where p.situacao = 'respondida' and p.respondida_em is not null) as mediana,
               percentile_cont(0.9) within group (order by extract(epoch from (p.respondida_em - p.criado_em)))
                 filter (where p.situacao = 'respondida' and p.respondida_em is not null) as p90
          from mister_pergunta p
         where ${doPeriodo}`),
    );
    const motivos = linhas(
      await this.db.execute(sql`
        select p.motivo, count(*)::int as n from mister_pergunta p
         where p.criado_em > ${desde} and p.situacao = 'falhou'
         group by p.motivo`),
    );
    const consultas = linhas(
      await this.db.execute(sql`
        select f ->> 'nome' as nome, count(*)::int as vezes, count(*) filter (where f ->> 'ok' = 'false')::int as falhas
          from mister_pergunta p cross join lateral jsonb_array_elements(${ARRAY_DE_CONSULTAS}) f
         where ${doPeriodo} and f ->> 'nome' is distinct from ${FERRAMENTA_DO_QUE_FALTA}
         group by 1
         order by 2 desc, 1
         limit 20`),
    ).filter((c) => ehFerramenta(c.nome)); // MIS-G-09: o nome inventado pela IA (gravado antes da correção) não aparece
    // O que pediram e o Mister não tem, por tema (a pergunta conta uma vez em cada tema anotado).
    const temas = linhas(
      await this.db.execute(sql`
        select f -> 'entrada' ->> 'tema' as tema, count(distinct p.id)::int as n, count(distinct p.tenant_id)::int as empresas
          from mister_pergunta p cross join lateral jsonb_array_elements(${ARRAY_DE_CONSULTAS}) f
         where ${doPeriodo} and f ->> 'nome' = ${FERRAMENTA_DO_QUE_FALTA}
         group by 1`),
    );
    // Os motivos que são da empresa (a chave, a conta de IA), com a empresa quando é uma só — para o "o que melhorar".
    const motivosDaEmpresa = linhas(
      await this.db.execute(sql`
        select p.motivo, count(*)::int as n, count(distinct p.tenant_id)::int as empresas,
               case when count(distinct p.tenant_id) = 1 then min(emp.nome) end as empresa
          from mister_pergunta p
          join empresa emp on emp.id = p.tenant_id
         where p.criado_em > ${desde} and p.situacao = 'falhou' and p.motivo in ('sem_chave', 'chave_recusada', 'sem_credito', 'teto_atingido')
         group by p.motivo`),
    );
    // A última avaliação de regressão que terminou (F5.3) — a tabela pode ainda não existir.
    let avaliacao: EntradaDoQueMelhorar['avaliacao'] = null;
    try {
      const [a] = linhas(
        await this.db.execute(sql`
          select id::text as id, to_char(iniciada_em at time zone ${FUSO_SQL}, 'DD/MM') as quando, acertos, total,
                 (select jsonb_build_object('pergunta', c ->> 'pergunta', 'falha', c -> 'falhas' ->> 0)
                    from jsonb_array_elements(casos) c where (c ->> 'ok')::boolean is false limit 1) as errada
            from mister_avaliacao where situacao = 'terminou'
           order by iniciada_em desc limit 1`),
      );
      if (a) avaliacao = { id: String(a.id), quando: String(a.quando), acertos: Number(a.acertos) || 0, total: Number(a.total) || 0, primeiraErrada: a.errada ? { pergunta: String(a.errada.pergunta ?? ''), falha: String(a.errada.falha ?? '') } : null };
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }
    const porEmpresa = linhas(
      await this.db.execute(sql`
        select p.tenant_id::text as "tenantId", emp.nome as empresa, count(*)::int as perguntas,
               count(*) filter (where p.situacao = 'falhou')::int as falhas
          from mister_pergunta p
          join empresa emp on emp.id = p.tenant_id
         where ${doPeriodo}
         group by p.tenant_id, emp.nome
         order by 3 desc, 2
         limit 50`),
    );
    const ids = porEmpresa.map((e) => String(e.tenantId));

    // A chave de IA de cada empresa da lista (só a situação, nunca a chave) — uma consulta, pela lista.
    const chaves = new Map<string, string>();
    if (ids.length) {
      try {
        const lidas = linhas(
          await this.db.execute(sql`
            select c.tenant_id::text as "tenantId", c.situacao
              from unnest(${`{${ids.join(',')}}`}::uuid[]) as l(id)
              join ia_credencial c on c.tenant_id = l.id`),
        );
        for (const c of lidas) chaves.set(String(c.tenantId), String(c.situacao));
      } catch (e: any) {
        if (!semTabela(e)) throw e;
      }
    }

    // O custo das perguntas, pela MESMA conta da tela "IA e uso" (`custoEstimadoUsd` sobre o `ia_uso_dia`).
    const custoPorEmpresa = new Map<string, number>();
    let custoTotal = 0;
    try {
      const usos = linhas(
        await this.db.execute(sql`
          select tenant_id::text as "tenantId", modelo,
                 sum(tokens_entrada)::float8 as entrada, sum(tokens_cache_escrita)::float8 as "cacheEscrita",
                 sum(tokens_cache_leitura)::float8 as "cacheLeitura", sum(tokens_saida)::float8 as saida
            from ia_uso_dia
           where recurso = ${RECURSO_DAS_PERGUNTAS} and dia > ${somarDias(hojeISO(), -dias)}::date
           group by 1, 2`),
      );
      for (const u of usos) {
        const uso: UsoDaChamada = { entrada: Number(u.entrada) || 0, cacheEscrita: Number(u.cacheEscrita) || 0, cacheLeitura: Number(u.cacheLeitura) || 0, saida: Number(u.saida) || 0 };
        const c = custoEstimadoUsd(String(u.modelo), uso) ?? 0;
        custoTotal += c;
        custoPorEmpresa.set(String(u.tenantId), (custoPorEmpresa.get(String(u.tenantId)) ?? 0) + c);
      }
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }

    const perguntas = Number(t?.perguntas) || 0;
    const respondidas = Number(t?.respondidas) || 0;
    const totalConsultas = consultas.reduce((s, c) => s + (Number(c.vezes) || 0), 0);
    // M2a (mig 432): as decisões da Diretoria que valem — banco sem a 432 = nenhuma (o cartão segue como na parte 1).
    const decisoes = await this.decisoesValendo();
    return {
      dias,
      perguntas,
      respondidas,
      pctRespondidas: pct(respondidas, perguntas),
      falhas: Number(t?.falhas) || 0,
      semConsulta: Number(t?.sem_consulta) || 0,
      naoTem: { quantas: Number(t?.nao_tem) || 0, pct: pct(Number(t?.nao_tem) || 0, perguntas) },
      temas: temasAgrupados(temas.map((m) => ({ tema: m.tema, n: Number(m.n) || 0 }))),
      melhorar: comAsDecisoes(padroesParaMelhorar({
        temas: temas.map((m) => ({ tema: ROTULO_DO_TEMA[temaDoQueFalta(m.tema)], quantas: Number(m.n) || 0, empresas: Number(m.empresas) || 0 })),
        consultas: consultas.filter((c) => c.nome !== FERRAMENTA_DO_QUE_FALTA).map((c) => ({ nome: nomeDaConsultaNaQualidade(c.nome), vezes: Number(c.vezes) || 0, falhas: Number(c.falhas) || 0 })),
        avaliacao,
        motivosDaEmpresa: motivosDaEmpresa.map((m) => ({ motivo: motivoNaQualidade(m.motivo), quantas: Number(m.n) || 0, empresas: Number(m.empresas) || 0, empresa: m.empresa ? String(m.empresa) : null })),
      }), decisoes),
      empresas: Number(t?.empresas) || 0,
      pessoas: Number(t?.pessoas) || 0,
      tempo: t?.mediana === null || t?.mediana === undefined ? null : { medianaS: umaCasa(t.mediana), p90S: umaCasa(t.p90) },
      custo: { totalUsd: seisCasas(custoTotal), porPerguntaUsd: respondidas ? seisCasas(custoTotal / respondidas) : null, precosLidosEm: PRECOS_LIDOS_EM },
      motivos: motivosAgrupados(motivos.map((m) => ({ motivo: m.motivo, n: Number(m.n) || 0 }))),
      consultas: consultas.map((c) => ({ nome: nomeDaConsultaNaQualidade(c.nome), vezes: Number(c.vezes) || 0, pct: pct(Number(c.vezes) || 0, totalConsultas), falhas: Number(c.falhas) || 0 })),
      porEmpresa: porEmpresa.map((e) => ({
        empresa: String(e.empresa ?? ''),
        perguntas: Number(e.perguntas) || 0,
        semResposta: Number(e.falhas) || 0,
        custoUsd: seisCasas(custoPorEmpresa.get(String(e.tenantId)) ?? 0),
        chave: chaves.get(String(e.tenantId)) ?? null,
      })),
    };
  }
}
