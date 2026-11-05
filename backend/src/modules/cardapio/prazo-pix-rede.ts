import type { ConsultaPixRede } from '../../common/erede';

// O PRAZO DO PIX DA REDE. O cardápio cancela o pedido de pagamento online que passou de 10 min sem pagar
// (`expirarPixNaoPagos`). Com o Mercado Pago, o aviso de "pago" chega em segundos e o prazo cancela também a
// cobrança lá. A Rede não avisa sozinha e não deixa cancelar um QR pendente: cancelar o pedido sem perguntar a
// ela perderia o PIX pago no último minuto (o dinheiro entra e o pedido some — V25). Por isso, antes de cancelar,
// a rotina consulta a Rede e decide aqui:
//   • pago → APROVAR (o pedido entra, em vez de ser cancelado);
//   • QR ainda valendo, ou vencido há menos de 2 min (folga para a Rede refletir um pagamento de última hora) → ESPERAR;
//   • vencido, devolvido ou outra situação → CANCELAR (o QR vencido não aceita mais pagamento);
//   • a Rede não respondeu → ESPERAR, até 1 h depois do pedido; aí CANCELAR (se houver pagamento, vira devolução manual).

export const FOLGA_DEPOIS_DO_QR_MS = 2 * 60_000;
export const ESPERA_SEM_RESPOSTA_MS = 60 * 60_000;
const VALIDADE_PADRAO_MS = 10 * 60_000;

export type DecisaoDoPrazo = 'aprovar' | 'esperar' | 'cancelar';

/** `consulta` = null quando a Rede não respondeu. */
export function decidirPrazoPixRede(consulta: ConsultaPixRede | null, agora: number, criadoEm: Date): DecisaoDoPrazo {
  const criado = new Date(criadoEm).getTime();
  if (!consulta) return agora - criado > ESPERA_SEM_RESPOSTA_MS ? 'cancelar' : 'esperar';
  if (consulta.status === 'paid') return 'aprovar';
  if (consulta.status === 'pending') {
    const vence = consulta.expiraEm ? consulta.expiraEm.getTime() : criado + VALIDADE_PADRAO_MS;
    return agora < vence + FOLGA_DEPOIS_DO_QR_MS ? 'esperar' : 'cancelar';
  }
  return 'cancelar';
}
