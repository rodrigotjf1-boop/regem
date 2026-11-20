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

/**
 * O INSTANTE em que começou o dia, a semana ou o mês de HOJE no relógio da operação. `date_trunc(…, now() at time zone
 * FUSO)` sozinho é um horário SEM fuso — comparado com uma coluna de instante, o banco o lê no fuso da SESSÃO (na nuvem,
 * UTC): o "hoje" começava às 21h da véspera em Brasília (o teto do dia da campanha e o "No mês" dos clientes — ERR-542).
 * Aqui ele volta a ser instante pelo fuso da operação.
 */
export function inicioDoPeriodo(unidade: 'day' | 'week' | 'month'): SQL {
  if (!['day', 'week', 'month'].includes(unidade)) throw new Error(`período inválido: ${unidade}`);
  return sql`(date_trunc(${sql.raw(`'${unidade}'`)}, now() at time zone ${FUSO_SQL}) at time zone ${FUSO_SQL})`;
}

/** `col` (instante) dentro do período escolhido na tela, que é hora de Brasília. */
export function noPeriodo(col: string, inicio: string, fim: string): SQL {
  return sql`${sql.raw(col)} between ${instanteDe(inicio)} and ${instanteDe(fim)}`;
}
