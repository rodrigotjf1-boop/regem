// Data "de hoje" para campos de REGISTRO (data do movimento, do lançamento, da
// marcação de ponto).
//
// ⚠️ NUNCA use `new Date().toISOString().slice(0, 10)` para isso: isso devolve a data
// em UTC. O Brasil é UTC−3, então toda operação a partir das 21h local cai no DIA
// SEGUINTE — a venda das 21h30 de terça aparece como quarta no fechamento do caixa,
// no relatório do dia e no ledger de estoque.
//
// Havia QUATRO cópias privadas de `hojeISO()` no projeto. Uma (ponto.controller) já
// tinha sido corrigida para o fuso da operação; as outras três seguiram em UTC — o
// conserto ficou preso num arquivo. Este é o único lugar onde a regra mora agora.
const FUSO = 'America/Sao_Paulo';

/** Data de hoje (YYYY-MM-DD) no fuso da operação. */
export function hojeISO(): string {
  // 'en-CA' formata como YYYY-MM-DD, que é o formato aceito por `date` no Postgres.
  return new Date().toLocaleDateString('en-CA', { timeZone: FUSO });
}

/** Data (YYYY-MM-DD) de um instante qualquer, no fuso da operação. */
export function dataNoFuso(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: FUSO });
}
