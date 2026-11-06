// O PRAZO DO ESTORNO DO PIX (06/11/2026, pedido do dono: "verificar até quando o cancelamento pode ser feito e gerar o
// estorno"). O Pix só aceita devolução até 90 DIAS depois do pagamento — Regulamento do Pix (Resolução BCB nº 103/2021: a
// devolução tem de ser iniciada em até 90 dias da transação original); o PagBank diz o mesmo na documentação oficial
// ("prazo máximo de 90 dias para devolução de uma cobrança com Pix, após sua autorização"); o Mercado Pago aceita reembolso
// até 180 dias em geral, mas o Pix segue a regra do Banco Central. A Rede (Pix) também.
//
// Regra única, dos dois lados: o CANCELAMENTO da loja trava 1 dia antes do fim (89 dias — a rotina da nuvem pede o estorno
// no minuto seguinte); a ROTINA do estorno (`cardapio/estorno-pix.service.ts`) não tenta depois dos 90 e chama uma pessoa.

export const PRAZO_DEVOLUCAO_PIX_DIAS = 90;
export const PRAZO_CANCELAR_PAGO_PIX_DIAS = 89;
const DIA_MS = 86_400_000;

export const GATEWAYS_DO_PIX = ['mercadopago', 'pagseguro', 'rede'] as const;

/** O pedido foi pago ONLINE (Pix aprovado por um gateway) — o que o cancelamento tem de estornar (fora encomenda com sinal). */
export function pagoNoPixOnline(p: {
  pago?: boolean | null;
  statusPagamento?: string | null;
  gatewayPaymentId?: string | null;
  gatewayProvider?: string | null;
  sinalStatus?: string | null;
}): boolean {
  return (
    !!p.pago &&
    p.statusPagamento === 'aprovado' &&
    !!p.gatewayPaymentId &&
    (GATEWAYS_DO_PIX as readonly string[]).includes(String(p.gatewayProvider)) &&
    !p.sinalStatus
  );
}

/** Quantos dias desde o pagamento (o pedido do cardápio é pago na hora: o Pix vence em 10 min — vale a criação). */
export function diasDesdeOPagamento(criadoEm: Date | string, agora = new Date()): number {
  return (agora.getTime() - new Date(criadoEm).getTime()) / DIA_MS;
}

/** A loja ainda pode cancelar o pedido pago no Pix (com o estorno garantido)? */
export function podeCancelarPagoNoPix(criadoEm: Date | string, agora = new Date()): boolean {
  return diasDesdeOPagamento(criadoEm, agora) <= PRAZO_CANCELAR_PAGO_PIX_DIAS;
}

export const MENSAGEM_PRAZO_DO_PIX =
  `Não dá mais para cancelar este pedido: ele foi pago no Pix há mais de ${PRAZO_CANCELAR_PAGO_PIX_DIAS} dias e o Pix só aceita ` +
  `devolver o valor até ${PRAZO_DEVOLUCAO_PIX_DIAS} dias depois do pagamento (regra do Banco Central). ` +
  'Se precisar devolver, combine com o cliente e devolva pelo app do banco ou do gateway.';
