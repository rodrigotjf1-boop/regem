import { BadRequestException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { dataNoFuso, somarDias } from './data';
import { FUSO_SQL } from './fuso-sql';

// A REGRA DO ANIVERSÁRIO — UM LUGAR SÓ (Onda 3, mig 357; protótipo `mockups/regem-relacionamento.html`, com a proteção
// pedida pelo dono em 03/11/2026). Vale para TODA promoção de aniversariante: o presente automático, o cupom "Só
// aniversariantes" e a campanha "Aniversariantes desta semana / do mês". Em JS (um cliente) e em SQL (a lista), com o
// teste que confere os dois lados nos mesmos casos (V74).
//   • Dia e mês, sem o ano. 29/02 em ano comum vale como 28/02.
//   • Carência: a data só vale para o aniversário que cai 30 dias ou mais DEPOIS de informada (ou trocada) — quem informa
//     perto do aniversário ganha no ano seguinte.
//   • "Semana do aniversário" = a semana de domingo a sábado que contém o aniversário.
//   • Um presente a cada 12 meses e "quem pediu nos últimos 12 meses" ficam nas automáticas e no cupom (são do uso).

export const CARENCIA_DIAS = 30;
export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS_DO_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const p2 = (n: number) => String(n).padStart(2, '0');
const bissexto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;

/** Dia e mês que a tela mandou, conferidos (inteiros, dia que existe no mês; 29/02 aceito). */
export function lerData(dto: unknown): { dia: number; mes: number } {
  const d = (dto ?? {}) as Record<string, unknown>;
  const dia = typeof d.dia === 'number' ? d.dia : NaN;
  const mes = typeof d.mes === 'number' ? d.mes : NaN;
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) throw new BadRequestException('Escolha o mês do aniversário.');
  if (!Number.isInteger(dia) || dia < 1 || dia > DIAS_DO_MES[mes - 1]) throw new BadRequestException('Escolha um dia que existe nesse mês.');
  return { dia, mes };
}

/** "5 de novembro". */
export function textoData(dia: number, mes: number): string {
  return `${dia} de ${MESES[mes - 1]}`;
}

/** O aniversário no ano `ano` (YYYY-MM-DD); 29/02 em ano comum = 28/02. */
export function noAno(dia: number, mes: number, ano: number): string {
  const d = mes === 2 && dia === 29 && !bissexto(ano) ? 28 : dia;
  return `${ano}-${p2(mes)}-${p2(d)}`;
}

/** Desde quando a data vale para promoções: o dia (no fuso da operação) em que foi informada + 30. */
export function valeDesde(informadoEm: Date | string): string {
  return somarDias(dataNoFuso(new Date(informadoEm)), CARENCIA_DIAS);
}

/** A data informada vale para o aniversário que cai em `aniversario` (YYYY-MM-DD)? */
export function valePara(informadoEm: Date | string | null | undefined, aniversario: string): boolean {
  return !!informadoEm && valeDesde(informadoEm) <= aniversario;
}

/** A semana (domingo a sábado) que contém a data. */
export function semanaDe(data: string): { inicio: string; fim: string } {
  const dow = new Date(`${data}T12:00:00Z`).getUTCDay();
  return { inicio: somarDias(data, -dow), fim: somarDias(data, 6 - dow) };
}

/** As ocorrências do aniversário entre `desde` e `ate` (inclusivo), olhando os anos das duas pontas (virada do ano). */
export function ocorrenciasEntre(dia: number, mes: number, desde: string, ate: string): string[] {
  const anos = new Set([Number(desde.slice(0, 4)), Number(ate.slice(0, 4))]);
  return [...anos].map((a) => noAno(dia, mes, a)).filter((d) => d >= desde && d <= ate).sort();
}

/**
 * O aniversário VALENDO cuja ocorrência cai entre `desde` e `ate`: a ocorrência (YYYY-MM-DD) ou `null`. A mesma conta do
 * `sqlAniversarioEntre`.
 */
export function aniversarioValendoEntre(
  a: { dia?: number | null; mes?: number | null; informadoEm?: Date | string | null } | null | undefined,
  desde: string,
  ate: string,
): string | null {
  if (!a?.dia || !a?.mes) return null;
  return ocorrenciasEntre(a.dia, a.mes, desde, ate).find((d) => valePara(a.informadoEm, d)) ?? null;
}

/** "Só aniversariantes (semana do aniversário)": hoje está na semana do aniversário valendo? */
export function naSemanaDoAniversario(
  a: { dia?: number | null; mes?: number | null; informadoEm?: Date | string | null } | null | undefined,
  hoje: string,
): string | null {
  if (!a?.dia || !a?.mes) return null;
  // A semana de hoje: o aniversário que cai nela (o deste ano, ou do ano vizinho na virada).
  const { inicio, fim } = semanaDe(hoje);
  return aniversarioValendoEntre(a, inicio, fim);
}

// ===================== Em SQL =====================

/** A ocorrência no ano (expressão), com 29/02 → 28/02 em ano comum. `a` = alias de `cliente_aniversario`. */
function sqlNoAno(a: string, ano: number): SQL {
  const dia = sql.raw(`${a}.dia`);
  const mes = sql.raw(`${a}.mes`);
  const comum = !bissexto(ano);
  return sql`make_date(${ano}::int, ${mes}::int, (case when ${mes} = 2 and ${dia} = 29 and ${comum} then 28 else ${dia} end)::int)`;
}

/**
 * Fragmento do `where` sobre `cliente c`: tem aniversário VALENDO (informado 30 dias ou mais antes da ocorrência) com
 * ocorrência entre `desde` e `ate` (YYYY-MM-DD, inclusivo; cobre a virada do ano).
 */
export function sqlAniversarioEntre(desde: string, ate: string): SQL {
  const anos = [...new Set([Number(desde.slice(0, 4)), Number(ate.slice(0, 4))])];
  const ocorrencias = sql.join(
    anos.map((ano) => sql`(${sqlNoAno('ca', ano)})`),
    sql`, `,
  );
  return sql`and exists (
    select 1 from cliente_aniversario ca
     cross join lateral (values ${ocorrencias}) o(d)
     where ca.cliente_id = c.id and ca.dia is not null
       and o.d between ${desde}::date and ${ate}::date
       and ((ca.informado_em at time zone ${FUSO_SQL})::date + ${CARENCIA_DIAS}::int) <= o.d)`;
}

/**
 * A ocorrência (date) do aniversário entre `desde` e `ate` — para a lista que precisa da data. Alias `ca`. Com
 * `carencia` (o padrão), só a ocorrência VALENDO; sem, qualquer uma (a prévia mostra quem fica para o ano que vem).
 */
export function sqlOcorrenciaEntre(desde: string, ate: string, carencia = true): SQL {
  const anos = [...new Set([Number(desde.slice(0, 4)), Number(ate.slice(0, 4))])];
  const ocorrencias = sql.join(
    anos.map((ano) => sql`(${sqlNoAno('ca', ano)})`),
    sql`, `,
  );
  const vale = carencia ? sql`and ((ca.informado_em at time zone ${FUSO_SQL})::date + ${CARENCIA_DIAS}::int) <= o.d` : sql``;
  return sql`(select min(o.d) from (values ${ocorrencias}) o(d)
              where o.d between ${desde}::date and ${ate}::date ${vale})`;
}
