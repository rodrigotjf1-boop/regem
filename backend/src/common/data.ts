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

/** Soma `dias` a uma data YYYY-MM-DD, sem depender do fuso do servidor. */
export function somarDias(iso: string, dias: number): string {
  // Meio-dia UTC + aritmética em UTC: montar a data em hora local e ler de volta em UTC
  // acerta por coincidência no Brasil e na nuvem, e erra um dia em servidor a leste.
  const d = new Date(`${String(iso).slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dias);
  // Monta a string pelos campos UTC em vez de `toISOString()`: dá o mesmo resultado
  // aqui, mas a guarda deste arquivo proíbe aquela chamada de propósito — é a forma
  // clássica de devolver a data em UTC, e a regra vale sem precisar julgar caso a caso.
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/** Hora atual (HH:MM) no fuso da operação. */
export function horaAgora(): string {
  return new Date().toLocaleTimeString('en-GB', { timeZone: FUSO, hour12: false }).slice(0, 5);
}
