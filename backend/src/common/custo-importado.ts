/**
 * O custo de um produto que chega de OUTRO sistema na importação do cardápio (Cardápio Web, Anota Aí): só um valor
 * positivo vale. Vazio, zero ou o que não é número = `null` — "usa o custo da ficha ou do estoque".
 *
 * Antes as importações gravavam 0 no `produto.preco_custo`. O custo efetivo lê o campo como CUSTO MANUAL (override →
 * ficha → estoque) e o zero escondia a ficha: na empresa do dono, 65 dos 67 produtos ativos mostravam "R$ 0,00
 * override manual", 42 deles com ficha ou item ligado, e a tela não conseguia limpar o zero (ERR-636).
 */
export function custoDaImportacao(valor: unknown): number | null {
  if (valor == null || valor === '') return null;
  const n = typeof valor === 'string' ? Number(valor.trim().replace(',', '.')) : Number(valor);
  return Number.isFinite(n) && n > 0 ? n : null;
}
