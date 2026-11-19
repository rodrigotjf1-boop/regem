/**
 * A QUANTIDADE de cada item do pedido do cardápio (R3-H02 da 3ª rodada de segurança, 19/11/2026; ERR-533).
 *
 * A rota pública do pedido (`POST publico/cardapio/:token/pedido`) recebe o corpo sem DTO, e o cálculo fazia
 * `Number(it.quantidade) || 1`: uma quantidade NEGATIVA entrava no subtotal como desconto (`preço × qtd`), e fração e
 * número gigante também passavam. O cardápio não vende fracionado: só INTEIRO de 1 a 9.999 (folga para a encomenda
 * grande de salgados). Ausente ou vazia = 1, como sempre foi. Fora disso, o pedido é recusado inteiro, antes de calcular
 * e de gravar. (O robô do WhatsApp tem a regra dele, mais curta: `quantidadeDoPedido`, de 1 a 50.)
 */
export const QUANTIDADE_MAXIMA_DO_CARDAPIO = 9999;

export const RECUSA_DA_QUANTIDADE = 'Quantidade inválida no pedido: use um número inteiro de 1 a 9.999.';

/** A quantidade conferida (inteiro de 1 a 9.999; ausente = 1), ou `null` quando não vale. */
export function quantidadeDoCardapio(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return 1;
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = typeof v === 'number' ? v : Number(v.trim());
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1 || n > QUANTIDADE_MAXIMA_DO_CARDAPIO) return null;
  return n;
}
