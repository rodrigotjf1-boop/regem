// O QUE O CLIENTE DEVE NA PORTA — a mesma conta do servidor (`backend/src/modules/delivery/valor-na-porta.ts`, CAR-C-03/C-04/D-04 da
// revisão de 25/11/2026): o total do pedido (itens + frete − desconto) menos as parcelas que o canal já recebeu antes (`pagamentos[]`
// com `prepago`). Em centavos inteiros; a tela mostra em reais. O servidor confere de novo e recusa o recebimento que não fecha.

type Parcela = { valor?: unknown; prepago?: unknown };

function parcelas(pagamentos: unknown): Parcela[] {
  if (Array.isArray(pagamentos)) return pagamentos as Parcela[];
  if (typeof pagamentos === 'string') {
    try {
      const v = JSON.parse(pagamentos);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Centavos que o cliente deve na porta (nunca negativo). */
export function centavosAReceber(pedido: { total?: unknown; pagamentos?: unknown } | null | undefined): number {
  const total = Math.round((Number(pedido?.total) || 0) * 100);
  const prePago = parcelas(pedido?.pagamentos)
    .filter((p) => p?.prepago === true || p?.prepago === 'true')
    .reduce((s, p) => s + Math.max(0, Math.round((Number(p?.valor) || 0) * 100)), 0);
  return Math.max(0, total - prePago);
}
