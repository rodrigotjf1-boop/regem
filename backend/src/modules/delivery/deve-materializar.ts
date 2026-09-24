// Regra ÚNICA de "este pedido pode virar produção agora?" no EDGE.
//
// Existe porque o processador do edge materializava TODO pedido `novo` a cada 15s —
// inclusive o do totem em DINHEIRO, que é "a pagar no balcão". O cupom do totem diz
// "pague no caixa para ser produzido", e a cozinha começava antes do pagamento.
// O `ingest` da nuvem respeita isso (`naoAutoAceitar`), mas o processador do edge roda
// depois, em outro ciclo, e não sabia da regra.
//
// A configuração "produzir só depois do pagamento" é da loja e vale para o DINHEIRO. O
// pagamento ELETRÔNICO não tem escolha: o pedido de cartão/PIX fica RETIDO enquanto a
// maquininha cobra, e não existe "cobra depois" com maquininha. Antes a regra olhava só
// canal e `pago` — com a loja em "produzir ao aceitar", o retido de cartão ia para a
// cozinha em 15s, com o cliente ainda na frente da maquininha (ver ERR-091).
export type PedidoParaMaterializar = {
  canal?: string | null;
  pago?: boolean | null;
  formaPagamento?: string | null;
};

export function deveMaterializar(
  pedido: PedidoParaMaterializar,
  totemProduzAposPagamento: boolean,
): boolean {
  const canal = (pedido.canal ?? '').toLowerCase();
  const ehTotemAPagar = canal === 'totem' && pedido.pago !== true;
  if (!ehTotemAPagar) return true;
  // Pedido de totem sem forma gravada é o de dinheiro de antes do retido: segue a loja.
  const forma = (pedido.formaPagamento ?? 'dinheiro').trim().toLowerCase();
  if (forma !== 'dinheiro') return false;
  return !totemProduzAposPagamento;
}
