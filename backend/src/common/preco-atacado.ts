// Atacado por volume (mig 184) — desconto percentual progressivo por quantidade.
// As faixas ficam em produto_faixa_preco (qtd_min → desconto_pct) e só valem
// quando produto.atacado_ativo = true. Regra: aplica a faixa de MAIOR qtd_min que
// ainda seja <= quantidade vendida ("a partir de N unidades"). Sem faixa aplicável
// (qtd abaixo da menor) → desconto 0. Usado no PDV e no cardápio.

export interface FaixaAtacado {
  qtdMin: number | string;
  descontoPct?: number | string | null;
}

/** Desconto de atacado (%) aplicável a uma quantidade. 0 se nenhuma faixa vale. */
export function descontoAtacadoPct(
  faixas: FaixaAtacado[] | null | undefined,
  qtd: number,
): number {
  if (!faixas?.length || !(qtd > 0)) return 0;
  let melhorPct = 0;
  let melhorMin = -1;
  for (const f of faixas) {
    const min = Number(f.qtdMin) || 0;
    const pct = Number(f.descontoPct) || 0;
    if (pct <= 0 || min > qtd) continue;
    // Maior qtd_min vence; em empate de qtd_min, o maior desconto.
    if (min > melhorMin || (min === melhorMin && pct > melhorPct)) {
      melhorMin = min;
      melhorPct = pct;
    }
  }
  return Math.min(Math.max(melhorPct, 0), 100);
}

/** Preço unitário após o desconto de atacado (arredonda a 2 casas). */
export function precoComAtacado(
  precoUnit: number,
  faixas: FaixaAtacado[] | null | undefined,
  qtd: number,
): number {
  const pct = descontoAtacadoPct(faixas, qtd);
  if (pct <= 0) return precoUnit;
  return Math.round(precoUnit * (1 - pct / 100) * 100) / 100;
}
