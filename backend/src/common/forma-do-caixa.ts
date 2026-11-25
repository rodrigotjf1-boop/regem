import { normalizarFormaPagamento } from './formas-pagamento-normaliza';

/**
 * A CHAVE DE CONFERÊNCIA da forma de pagamento no caixa (PDV-C-01 da revisão de 25/11/2026). A venda do balcão grava a forma
 * com o NOME do cadastro ("Dinheiro", "Pix", "Cartão de crédito"), o delivery grava o tipo ("dinheiro"), e a tela de
 * fechamento conta "dinheiro", "cartao" e "pix". O fechamento comparava o texto cru: "Dinheiro" e "dinheiro" viravam duas
 * linhas — a mesma venda aparecia como falta numa e sobra na outra (7 dos 9 fechamentos do balcão na produção, de 03/09 a
 * 17/11). Fechamento, sangria e reconciliação usam esta chave dos DOIS lados (o que entrou e o que foi contado).
 *
 * - vazia → `dinheiro` (o lançamento sem forma é da gaveta — regra antiga do fechamento);
 * - crédito e débito → `cartao` (a tela conta o cartão junto, pelo terminal);
 * - dinheiro, pix, vale-refeição e online → o tipo canônico de `normalizarFormaPagamento`;
 * - forma própria da loja que não é nenhuma dessas → o nome em minúsculas, sem espaços nas pontas.
 */
export function formaDoCaixa(bruto?: string | null): string {
  const s = String(bruto ?? '').trim();
  if (!s) return 'dinheiro';
  const { tipo } = normalizarFormaPagamento(s);
  if (tipo === 'credito' || tipo === 'debito') return 'cartao';
  if (tipo === 'outro') return s.toLowerCase();
  return tipo;
}

/** Soma valores em centavos pela chave de conferência (`{ "Dinheiro": 5000, "dinheiro": 10000 }` → `{ dinheiro: 15000 }`). */
export function somarPorFormaDoCaixa(porForma: Record<string, number>): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const [forma, centavos] of Object.entries(porForma)) {
    const k = formaDoCaixa(forma);
    saida[k] = (saida[k] ?? 0) + centavos;
  }
  return saida;
}
