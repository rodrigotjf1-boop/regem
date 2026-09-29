// TABELA DO IBPT NO BANCO (Lei 12.741, mig 291). Dado da DISTRIBUIÇÃO, sem empresa: a nuvem recebe
// o arquivo pelo console e guarda todas as UFs; o servidor da loja guarda só a do estado dele.
//
// Tabela PRÓPRIA (mig 292): a empresa que informa o token dela no IBPT ganha versões com o seu
// `tenant_id`, só com os NCMs dos produtos dela (vindos da API). A emissão prefere a própria quando
// ela cobre TODOS os NCMs da nota; senão usa a da distribuição inteira — nunca mistura as duas.
//
// Vigência: sai uma versão por mês, do dia 20 ao fim do mês seguinte — sobrepostas. A que vale
// num dia é a MAIS RECENTE cuja vigência o inclui. Nenhuma vigente = a nota sai sem os valores:
// o termo do IBPT (cl. 5ª) manda não exibir com a tabela vencida.
//
// SQL em string contra o banco de verdade (V6): coberto por `ibpt.spec.ts`. Listas vão como UM
// literal de array (`{…}`), nunca como array JS no template do Drizzle (V31).
import { sql } from 'drizzle-orm';
import { fusoDaUf } from '../fuso-fiscal';
import type { AliquotaIbpt, TabelaIbptDaNota } from '../tributos-aproximados';
import type { LinhaIbpt, TabelaIbptUf } from './ibpt-arquivo';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type VersaoIbpt = {
  id: string;
  tenantId: string | null; // nulo = distribuição
  uf: string;
  versao: string;
  chave: string;
  fonte: string;
  vigenciaInicio: string;
  vigenciaFim: string;
  linhas: number;
  importadaEm: string | null;
  importadaPor: string | null;
};

// Versões vencidas há mais que isto saem do banco (a nota guarda o que usou; reimpressão não
// precisa da tabela). Com uma versão por mês, sobram umas três por UF.
export const DIAS_GUARDAR_VENCIDA = 60;

const linhasDe = (r: any): any[] => r?.rows ?? r ?? [];

/** Dia de hoje no fuso da UF, `AAAA-MM-DD` — a vigência da tabela é por data. */
export function hojeNaUf(uf?: string | null, agora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: fusoDaUf(uf),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(agora);
}

// As datas vêm como TEXTO do SQL (`::text`): o driver converteria `date` em `Date` no fuso da
// máquina, e o dia podia andar um para trás.
const dataIso = (v: any): string => String(v ?? '').slice(0, 10);

function versaoDe(r: any): VersaoIbpt {
  return {
    id: r.id,
    tenantId: r.tenant_id ?? null,
    uf: r.uf,
    versao: r.versao,
    chave: r.chave,
    fonte: r.fonte,
    vigenciaInicio: dataIso(r.vigencia_inicio),
    vigenciaFim: dataIso(r.vigencia_fim),
    linhas: Number(r.linhas) || 0,
    importadaEm: r.importada_em ? new Date(r.importada_em).toISOString() : null,
    importadaPor: r.importada_por ?? null,
  };
}

// Literal de array do Postgres. Só números e dígitos passam por aqui (NCM, exceção, percentual),
// mas o texto vai entre aspas do mesmo jeito.
const arrTexto = (xs: string[]) => `{${xs.map((x) => `"${String(x).replace(/["\\]/g, '')}"`).join(',')}}`;
const arrNum = (xs: number[]) => `{${xs.map((x) => (Number.isFinite(x) ? String(x) : '0')).join(',')}}`;

const LOTE = 4000;

/**
 * Grava uma tabela de UF. Idempotente por (dono, uf, versão, chave): reenviar o mesmo arquivo — ou
 * a mesma versão com a vigência estendida, que o IBPT faz sem trocar a chave — atualiza a vigência
 * e troca as linhas. Tudo numa transação: quem emite nunca vê meia tabela.
 *
 * `tenantId` = tabela PRÓPRIA da empresa (senão, da distribuição). `mesclar` = junta as linhas às
 * que a versão já tem em vez de trocá-las — a tabela própria chega aos poucos, NCM a NCM, pela API.
 */
export async function gravarTabelaIbpt(
  db: any,
  t: Pick<TabelaIbptUf, 'uf' | 'versao' | 'chave' | 'fonte' | 'vigenciaInicio' | 'vigenciaFim' | 'linhas'>,
  por: string | null,
  opcoes: { tenantId?: string | null; mesclar?: boolean } = {},
): Promise<{ versao: VersaoIbpt; nova: boolean }> {
  const tenantId = opcoes.tenantId ?? null;
  return db.transaction(async (tx: any) => {
    const r: any = await tx.execute(sql`
      insert into ibpt_versao (tenant_id, uf, versao, chave, fonte, vigencia_inicio, vigencia_fim, linhas, importada_por)
      values (${tenantId}::uuid, ${t.uf}, ${t.versao}, ${t.chave}, ${t.fonte}, ${t.vigenciaInicio}::date,
              ${t.vigenciaFim}::date, ${t.linhas.length}, ${por})
      -- Alvo = o índice uq_ibpt_versao_dono (mig 292), com a MESMA expressão e a constante escrita
      -- aqui: um parâmetro no lugar dela não casa com o índice (42P10).
      on conflict ((coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid)), uf, versao, chave) do update
        set fonte = excluded.fonte, vigencia_inicio = excluded.vigencia_inicio,
            vigencia_fim = excluded.vigencia_fim, linhas = excluded.linhas,
            importada_em = now(), importada_por = excluded.importada_por
      returning id, tenant_id, uf, versao, chave, fonte, vigencia_inicio::text as vigencia_inicio, vigencia_fim::text as vigencia_fim, linhas, importada_em, importada_por, (xmax = 0) as nova`);
    const row = linhasDe(r)[0];
    if (!opcoes.mesclar) await tx.execute(sql`delete from ibpt_aliquota where versao_id = ${row.id}::uuid`);
    for (let i = 0; i < t.linhas.length; i += LOTE) {
      const lote: LinhaIbpt[] = t.linhas.slice(i, i + LOTE);
      await tx.execute(sql`
        insert into ibpt_aliquota (versao_id, ncm, ex, nacional_federal, importados_federal, estadual, municipal)
        select ${row.id}::uuid, n, e, nf, imf, es, mu
          from unnest(${arrTexto(lote.map((l) => l.ncm))}::text[], ${arrTexto(lote.map((l) => l.ex))}::text[],
                      ${arrNum(lote.map((l) => l.nacionalFederal))}::numeric[],
                      ${arrNum(lote.map((l) => l.importadosFederal))}::numeric[],
                      ${arrNum(lote.map((l) => l.estadual))}::numeric[],
                      ${arrNum(lote.map((l) => l.municipal))}::numeric[]) as x(n, e, nf, imf, es, mu)
        on conflict (versao_id, ncm, ex) do update
          set nacional_federal = excluded.nacional_federal, importados_federal = excluded.importados_federal,
              estadual = excluded.estadual, municipal = excluded.municipal`);
    }
    if (opcoes.mesclar) {
      const c: any = await tx.execute(sql`
        update ibpt_versao set linhas = (select count(*) from ibpt_aliquota where versao_id = ${row.id}::uuid)
         where id = ${row.id}::uuid returning linhas`);
      row.linhas = linhasDe(c)[0]?.linhas ?? row.linhas;
    }
    return { versao: versaoDe(row), nova: row.nova === true };
  });
}

/** Tira as versões da UF vencidas há mais de `dias` (as linhas saem junto, em cascata). */
export async function podarVersoesIbpt(db: any, uf: string, hoje: string, dias = DIAS_GUARDAR_VENCIDA) {
  const r: any = await db.execute(sql`
    delete from ibpt_versao
     where uf = ${uf} and vigencia_fim < (${hoje}::date - ${dias}::int)
    returning id`);
  return linhasDe(r).length;
}

/**
 * A versão que vale no dia: a mais recente cuja vigência o inclui. `tenantId` nulo = a tabela da
 * distribuição; preenchido = a tabela PRÓPRIA daquela empresa.
 */
export async function versaoVigente(
  db: any,
  uf: string,
  dia: string,
  tenantId: string | null = null,
): Promise<VersaoIbpt | null> {
  const r: any = await db.execute(sql`
    select id, tenant_id, uf, versao, chave, fonte, vigencia_inicio::text as vigencia_inicio, vigencia_fim::text as vigencia_fim, linhas, importada_em, importada_por from ibpt_versao
     where uf = ${uf} and tenant_id is not distinct from ${tenantId}::uuid
       and vigencia_inicio <= ${dia}::date and vigencia_fim >= ${dia}::date
     order by vigencia_inicio desc, versao desc, importada_em desc
     limit 1`);
  const row = linhasDe(r)[0];
  return row ? versaoDe(row) : null;
}

const ncmsValidos = (ncms: (string | null | undefined)[]) => [
  ...new Set(ncms.map((n) => String(n ?? '').replace(/\D/g, '')).filter((n) => n.length === 8)),
];

async function aliquotasDaVersao(db: any, versaoId: string, lista: string[]) {
  const aliquotas: Record<string, AliquotaIbpt> = {};
  if (!lista.length) return aliquotas;
  const r: any = await db.execute(sql`
    select ncm, nacional_federal, importados_federal, estadual, municipal
      from ibpt_aliquota
     where versao_id = ${versaoId}::uuid and ex = '' and ncm = any(${arrTexto(lista)}::text[])`);
  for (const a of linhasDe(r))
    aliquotas[a.ncm] = {
      nacionalFederal: Number(a.nacional_federal),
      importadosFederal: Number(a.importados_federal),
      estadual: Number(a.estadual),
      municipal: Number(a.municipal),
    };
  return aliquotas;
}

/**
 * O que a EMISSÃO precisa: a tabela vigente da UF com as linhas dos NCMs desta nota (sem exceção
 * de TIPI — o produto não a tem). `null` = sem tabela vigente.
 *
 * Com `tenantId`, a tabela PRÓPRIA da empresa vem primeiro — mas só se tiver TODOS os NCMs da
 * nota (um produto novo, ainda não consultado no IBPT, faz a nota inteira usar a da
 * distribuição). Uma nota nunca cita duas fontes/chaves.
 */
export async function tabelaIbptDaNota(
  db: any,
  uf: string | null | undefined,
  ncms: (string | null | undefined)[],
  dia: string,
  tenantId: string | null = null,
): Promise<TabelaIbptDaNota | null> {
  const u = String(uf ?? '').toUpperCase();
  if (!u) return null;
  const lista = ncmsValidos(ncms);
  if (tenantId && lista.length) {
    const propria = await versaoVigente(db, u, dia, tenantId);
    if (propria) {
      const aliquotas = await aliquotasDaVersao(db, propria.id, lista);
      if (lista.every((n) => aliquotas[n]))
        return { fonte: propria.fonte, chave: propria.chave, versao: propria.versao, aliquotas, propria: true };
    }
  }
  const v = await versaoVigente(db, u, dia);
  if (!v) return null;
  return { fonte: v.fonte, chave: v.chave, versao: v.versao, aliquotas: await aliquotasDaVersao(db, v.id, lista) };
}

/** NCMs da lista que a versão ainda não tem (a tabela própria cresce conforme os produtos). */
export async function ncmsFaltando(db: any, versaoId: string, ncms: (string | null | undefined)[]): Promise<string[]> {
  const lista = ncmsValidos(ncms);
  if (!lista.length) return [];
  const r: any = await db.execute(sql`
    select ncm from ibpt_aliquota
     where versao_id = ${versaoId}::uuid and ex = '' and ncm = any(${arrTexto(lista)}::text[])`);
  const tem = new Set(linhasDe(r).map((x: any) => x.ncm));
  return lista.filter((n) => !tem.has(n));
}

/** Apaga as tabelas PRÓPRIAS da empresa (todas, ou só as da UF) — token removido ou recusado. */
export async function apagarTabelasProprias(db: any, tenantId: string, uf?: string | null) {
  const r: any = await db.execute(sql`
    delete from ibpt_versao
     where tenant_id = ${tenantId}::uuid and (${uf ?? null}::text is null or uf = ${uf ?? null}::text)
    returning id`);
  return linhasDe(r).length;
}

/**
 * Pacote da UF para o servidor da loja: a versão vigente e todas as linhas dela. Com `tenantId`,
 * a tabela PRÓPRIA daquela empresa.
 */
export async function pacoteIbptDaUf(db: any, uf: string, dia: string, tenantId: string | null = null) {
  const v = await versaoVigente(db, uf, dia, tenantId);
  if (!v) return null;
  const r: any = await db.execute(sql`
    select ncm, ex, nacional_federal, importados_federal, estadual, municipal
      from ibpt_aliquota where versao_id = ${v.id}::uuid order by ncm, ex`);
  return {
    uf: v.uf,
    versao: v.versao,
    chave: v.chave,
    fonte: v.fonte,
    vigenciaInicio: v.vigenciaInicio,
    vigenciaFim: v.vigenciaFim,
    // Compacto: [ncm, ex, nacionalFederal, importadosFederal, estadual, municipal]
    linhas: linhasDe(r).map((a: any) => [
      a.ncm, a.ex, Number(a.nacional_federal), Number(a.importados_federal), Number(a.estadual), Number(a.municipal),
    ]),
  };
}

/** Converte o pacote vindo da nuvem de volta em tabela (lado da loja), conferindo o essencial. */
export function tabelaDoPacote(p: any): TabelaIbptUf {
  const ok =
    p &&
    /^[A-Z]{2}$/.test(String(p.uf ?? '')) &&
    p.versao && p.chave && p.fonte &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(p.vigenciaInicio ?? '')) &&
    /^\d{4}-\d{2}-\d{2}$/.test(String(p.vigenciaFim ?? '')) &&
    Array.isArray(p.linhas);
  if (!ok) throw new Error('Pacote da tabela do IBPT inválido.');
  return {
    arquivo: `nuvem:${p.uf}${p.versao}`,
    uf: p.uf,
    versao: String(p.versao),
    chave: String(p.chave),
    fonte: String(p.fonte),
    vigenciaInicio: p.vigenciaInicio,
    vigenciaFim: p.vigenciaFim,
    linhas: p.linhas
      .filter((l: any) => Array.isArray(l) && /^\d{8}$/.test(String(l[0])))
      .map((l: any) => ({
        ncm: String(l[0]),
        ex: String(l[1] ?? ''),
        nacionalFederal: Number(l[2]) || 0,
        importadosFederal: Number(l[3]) || 0,
        estadual: Number(l[4]) || 0,
        municipal: Number(l[5]) || 0,
      })),
  };
}

export type SituacaoIbpt = 'ok' | 'vence_logo' | 'vencida' | 'sem_tabela';

export type StatusIbptUf = {
  uf: string;
  lojas: number; // estabelecimentos com fiscal configurado nesta UF
  vigente: VersaoIbpt | null;
  proxima: VersaoIbpt | null; // já importada, com vigência começando depois de hoje
  diasParaVencer: number | null;
  situacao: SituacaoIbpt;
};

/** Dias até a vigência acabar para o verificador avisar. */
export const DIAS_AVISO_VENCIMENTO = 7;

const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/**
 * Situação por UF, para o console e para o verificador: as UFs com fiscal configurado e as que já
 * têm tabela. "Vence logo" só conta quando não há a PRÓXIMA versão importada — com ela, a troca é
 * sozinha.
 */
export async function statusIbpt(db: any, hoje: string, ufs?: string[]): Promise<StatusIbptUf[]> {
  // Só as da DISTRIBUIÇÃO: a tabela própria de uma empresa não entra na conta do console.
  const rv: any = await db.execute(sql`select id, tenant_id, uf, versao, chave, fonte, vigencia_inicio::text as vigencia_inicio, vigencia_fim::text as vigencia_fim, linhas, importada_em, importada_por from ibpt_versao where tenant_id is null order by uf, vigencia_inicio desc, versao desc`);
  const versoes = linhasDe(rv).map(versaoDe);
  const rl: any = await db.execute(sql`
    select upper(uf) as uf, count(*)::int as lojas
      from fiscal_config where uf is not null and uf <> '' group by upper(uf)`);
  const lojas = new Map<string, number>(linhasDe(rl).map((x: any) => [x.uf, Number(x.lojas)]));
  const todas = new Set<string>([...lojas.keys(), ...versoes.map((v) => v.uf)]);
  const alvo = ufs?.length ? [...todas].filter((u) => ufs.includes(u)) : [...todas];
  return alvo.sort().map((uf) => {
    const daUf = versoes.filter((v) => v.uf === uf);
    const vigente = daUf.find((v) => v.vigenciaInicio <= hoje && v.vigenciaFim >= hoje) ?? null;
    const proxima =
      daUf
        .filter((v) => v.vigenciaInicio > hoje && (!vigente || v.vigenciaFim > vigente.vigenciaFim))
        .sort((a, b) => a.vigenciaInicio.localeCompare(b.vigenciaInicio))[0] ?? null;
    const dias = vigente ? diasEntre(hoje, vigente.vigenciaFim) : null;
    const situacao: SituacaoIbpt = !vigente
      ? daUf.length
        ? 'vencida'
        : 'sem_tabela'
      : dias! <= DIAS_AVISO_VENCIMENTO && !proxima
        ? 'vence_logo'
        : 'ok';
    return { uf, lojas: lojas.get(uf) ?? 0, vigente, proxima, diasParaVencer: dias, situacao };
  });
}
