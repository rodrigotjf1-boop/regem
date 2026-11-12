import { ESPERA_SEM_RESPOSTA_MS, type DecisaoDoPrazo } from './prazo-pix-rede';

// O PRAZO DO PIX DO MERCADO PAGO E DO PAGBANK (ERR-454, 12/11/2026). O cardápio cancela o pedido de pagamento online que
// passou de 10 min sem pagar (`expirarPixNaoPagos`). Para estes dois provedores o prazo confiava no AVISO deles: se o
// aviso de "pago" nunca chegasse (endereço, assinatura ou token errados; aviso perdido) e o cliente já tivesse fechado a
// página, o pedido de quem PAGOU era cancelado — dinheiro na conta da loja, sem estorno e sem ninguém saber. O aviso
// ATRASADO já tinha saída (marca pago no cancelado e o estorno da mig 372 devolve); o que nunca chega, não.
//
// Agora, como a Rede já fazia (`prazo-pix-rede.ts`), a rotina PERGUNTA ao provedor antes de cancelar e decide aqui:
//   • pago → APROVAR (o pedido entra, em vez de ser cancelado);
//   • não pago → CANCELAR (como sempre; no Mercado Pago a cobrança também é cancelada, para não haver pagamento tardio);
//   • o provedor não respondeu → ESPERAR, até 1 h depois do pedido; aí CANCELAR (o mesmo teto da Rede).
// Loja sem o token do provedor (tirou a integração) não tem como perguntar: vale o prazo, como antes.

/** `pago`: o que o provedor respondeu AGORA; `null` = não respondeu. */
export function decidirPrazoPixDoProvedor(pago: boolean | null, agora: number, criadoEm: Date): DecisaoDoPrazo {
  if (pago === null) return agora - new Date(criadoEm).getTime() > ESPERA_SEM_RESPOSTA_MS ? 'cancelar' : 'esperar';
  return pago ? 'aprovar' : 'cancelar';
}
