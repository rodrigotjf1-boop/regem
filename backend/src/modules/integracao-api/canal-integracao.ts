import { CANAIS_MARKETPLACE } from '../fiscal/destinatario';

// CANAL e GRUPO DO CANAL da venda na API de integração (contrato Regem → Liame v1, §2.2).
//
// O `canal` sai no formato do contrato (`^[a-z0-9_]{1,40}$`): o do pedido é texto livre no
// Regem (o servidor da loja e a integração Open Delivery mandam o que vier), e um valor fora do
// formato faria o Liame recusar a PÁGINA inteira. O grupo é uma função só, testada — a do painel
// de retirada (`DeliveryService.grupoCanal`) agrupa de outro jeito, para outra finalidade.

export type GrupoCanal = 'cardapio' | 'whatsapp' | 'presencial' | 'marketplace' | 'outro';

/**
 * Marketplaces do contrato: a lista fiscal de plataformas de terceiro (`CANAIS_MARKETPLACE`)
 * mais o `open_delivery`, que o contrato também põe aqui. Pedido de marketplace nunca manda
 * cliente (D-A2.5-11).
 */
export const CANAIS_MARKETPLACE_INTEGRACAO: ReadonlySet<string> = new Set([...CANAIS_MARKETPLACE, 'open_delivery']);

/** Pedido que vem do totem (o do Regem ou o GoGeM) é venda presencial. */
const CANAIS_PRESENCIAIS = new Set(['totem', 'gogem']);

/** O canal no formato do contrato: minúsculo, `[a-z0-9_]`, até 40; vazio vira `outro`. */
export function canalIntegracao(canal: unknown): string {
  const c = String(canal ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  return c || 'outro';
}

/**
 * Grupo do canal. Comanda sem pedido (balcão, mesa, totem direto) é sempre `presencial`.
 * `whatsapp` fica sem uso até existir marcador próprio: hoje o bot manda o link do cardápio e o
 * pedido entra como `cardapio`. `cardapio_web`, `delivery_direto`, `anotaai` e `manual` são
 * `outro` (sem captura do clique — só o cupom atribui).
 */
export function grupoCanalIntegracao(canal: string, fonte: 'pedido_externo' | 'comanda'): GrupoCanal {
  if (fonte === 'comanda') return 'presencial';
  const c = canalIntegracao(canal);
  if (c === 'cardapio') return 'cardapio';
  if (CANAIS_PRESENCIAIS.has(c)) return 'presencial';
  if (CANAIS_MARKETPLACE_INTEGRACAO.has(c)) return 'marketplace';
  return 'outro';
}
