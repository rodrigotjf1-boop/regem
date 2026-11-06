/**
 * O pedido pago online (Pix) e cancelado: o que o cliente lê. A nuvem pede o estorno TOTAL ao gateway sozinha (mig 372,
 * `backend/src/modules/cardapio/estorno-pix.service.ts`); o robô do WhatsApp diz o mesmo (`whatsapp.service.ts`).
 */
export const TEXTO_DO_ESTORNO =
  'O valor pago no Pix será devolvido automaticamente para a mesma conta, pela instituição financeira — costuma cair em poucos minutos.';
