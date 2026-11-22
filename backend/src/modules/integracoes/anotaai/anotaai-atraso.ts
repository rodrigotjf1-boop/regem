// Quanto o Regem demorou para ver uma mudança de status do Anota Aí. É só medida: serve para separar "o Regem leu tarde" de
// "a loja marcou tarde" (pedido do dono em 21/11), sem mudar nenhum horário do pedido.

export type FaixaDoAtraso = 'ate_1_min' | 'de_1_a_5_min' | 'de_5_a_15_min' | 'mais_de_15_min';

/** O atraso entre a hora do canal e a hora em que o Regem viu. Hora inválida ou mais de 1 min no futuro não é medida. */
export function atrasoDoStatus(noCanal: unknown, vistoEm: Date): { segundos: number; faixa: FaixaDoAtraso } | null {
  const t = typeof noCanal === 'string' ? Date.parse(noCanal) : noCanal instanceof Date ? noCanal.getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  const diferenca = Math.round((vistoEm.getTime() - t) / 1000);
  if (diferenca < -60) return null;
  const segundos = Math.max(0, diferenca);
  const faixa: FaixaDoAtraso = segundos <= 60 ? 'ate_1_min' : segundos <= 300 ? 'de_1_a_5_min' : segundos <= 900 ? 'de_5_a_15_min' : 'mais_de_15_min';
  return { segundos, faixa };
}
