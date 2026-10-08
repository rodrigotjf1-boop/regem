import { sql, type SQL } from 'drizzle-orm';
import { FUSO_OPERACAO } from './data';

// DIA E HORA DE RELATÓRIO = os da OPERAÇÃO, sempre com o fuso escrito na consulta (ERR-120).
//
// As colunas de quando algo aconteceu são INSTANTES (`timestamptz`) e a sessão do banco da nuvem
// é UTC. Comparar a coluna com o texto do período "cru" ('2026-10-07 00:00:00'), ou agrupar por
// `coluna::date` / `extract(hour from coluna)`, usa o fuso da SESSÃO: o "dia" do relatório ia das
// 21h da véspera às 21h de Brasília — a venda das 22h caía no dia seguinte — e o gráfico por hora
// saía 3 horas adiantado. No servidor da loja, cujo banco usa o fuso da máquina, dava outro
// resultado. Com o fuso explícito, nuvem e loja respondem igual.

/** O fuso da operação como literal SQL (constante do código, não vem de fora). */
export const FUSO_SQL = sql.raw(`'${FUSO_OPERACAO}'`);

/** O instante da coluna no relógio da operação — para agrupar por dia, hora, semana ou mês. */
export function noFuso(col: string): SQL {
  return sql`(${sql.raw(col)} at time zone ${FUSO_SQL})`;
}

/** Um horário do relógio da operação ('2026-10-07 18:00:00' ou '2026-10-07') como instante. */
export function instanteDe(relogio: string): SQL {
  return sql`(${relogio}::timestamp at time zone ${FUSO_SQL})`;
}

/** `col` (instante) dentro do período escolhido na tela, que é hora de Brasília. */
export function noPeriodo(col: string, inicio: string, fim: string): SQL {
  return sql`${sql.raw(col)} between ${instanteDe(inicio)} and ${instanteDe(fim)}`;
}
