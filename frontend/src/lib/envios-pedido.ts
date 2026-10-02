// REGISTRO DOS ENVIOS DO PEDIDO — os nomes legíveis do que o Regem manda ao canal e ao cliente a
// cada mudança de status. Usado na linha do tempo do pedido e no aviso de falhas do painel.

export interface EnvioDoPedido {
  id: string;
  destino: string;
  acao: string;
  resultado: 'enviado' | 'falhou' | 'nao_enviado';
  motivo: string | null;
  httpStatus: number | null;
  servidor?: 'nuvem' | 'loja';
  criadoEm: string;
}

const CANAL: Record<string, string> = {
  ifood: 'iFood',
  '99food': '99Food',
  anotaai: 'Anota AI',
  cardapio_web: 'Cardápio Web',
  open_delivery: 'Open Delivery',
  delivery_direto: 'Delivery Direto',
  rappi: 'Rappi',
  keeta: 'Keeta',
};
const CLIENTE: Record<string, string> = {
  cliente_whatsapp: 'cliente, pelo WhatsApp',
  cliente_cardapio: 'cliente, no cardápio',
  nuvem: 'nuvem, para avisar o cliente',
};
// O que foi dito ao CANAL.
const ACAO_CANAL: Record<string, string> = {
  confirm: 'pedido aceito',
  ready: 'pedido pronto',
  dispatch: 'saiu para entrega',
  delivered: 'pedido entregue',
  finalize: 'pedido concluído',
  finalizar: 'pedido concluído',
  cancel: 'pedido cancelado',
};
// O aviso mandado ao CLIENTE.
const AVISO: Record<string, string> = {
  confirmado: 'pedido em produção',
  pronto_retirada: 'pronto para retirada',
  saiu_entrega: 'saiu para entrega',
  entregue: 'pedido entregue',
  cancelado: 'pedido cancelado',
  atrasado: 'pedido atrasado',
  codigo_entrega: 'código de entrega',
};

export const ehCliente = (destino: string) => destino in CLIENTE;
export const nomeDestino = (destino: string) => CANAL[destino] ?? CLIENTE[destino] ?? destino;
export const nomeAcao = (destino: string, acao: string) =>
  (ehCliente(destino) ? AVISO[acao] : ACAO_CANAL[acao]) ?? acao.replace(/_/g, ' ');

/** "Enviado ao iFood: pedido aceito" · "Falhou ao enviar ao iFood: pedido pronto" · "Não enviado ao…". */
export function fraseEnvio(e: Pick<EnvioDoPedido, 'destino' | 'acao' | 'resultado'>): string {
  const para = `${ehCliente(e.destino) ? 'à' : 'ao'} ${nomeDestino(e.destino)}`.replace('à cliente', 'ao cliente');
  const oQue = nomeAcao(e.destino, e.acao);
  if (e.resultado === 'enviado') return `Enviado ${para}: ${oQue}`;
  if (e.resultado === 'falhou') return `Falhou ao enviar ${para}: ${oQue}`;
  return `Não enviado ${para}: ${oQue}`;
}
