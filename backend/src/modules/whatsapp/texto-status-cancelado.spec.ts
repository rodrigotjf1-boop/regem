import { WhatsappService } from './whatsapp.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O texto de status que o robô do WhatsApp repassa ao cliente, no pedido CANCELADO (06/11/2026): pago online (Pix aprovado),
// avisa que o valor volta sozinho — a nuvem pede o estorno total ao gateway (mig 372); o Pix que venceu sem pagar e o
// pedido sem pagamento online seguem com o texto de antes.
describe('texto de status do pedido cancelado (robô do WhatsApp)', () => {
  const texto = (p: { status: string; statusPagamento: string | null; tipo: string | null }) =>
    (Object.create(WhatsappService.prototype) as any).textoStatusPedido(p) as string;

  it('pago online: avisa o estorno automático', () => {
    expect(texto({ status: 'cancelado', statusPagamento: 'aprovado', tipo: 'entrega' })).toBe(
      'Seu pedido foi cancelado. O valor pago no Pix será devolvido automaticamente para a mesma conta, pela instituição financeira — costuma cair em poucos minutos.',
    );
  });

  it('o Pix que venceu sem pagar e o pagamento na entrega: o texto de antes', () => {
    expect(texto({ status: 'cancelado', statusPagamento: 'aguardando', tipo: 'entrega' })).toBe('Seu pedido foi cancelado por falta de pagamento no prazo.');
    expect(texto({ status: 'cancelado', statusPagamento: 'na_entrega', tipo: 'retirada' })).toBe('Seu pedido foi cancelado.');
  });

  it('o texto do robô é o mesmo da página do pedido', () => {
    const { readFileSync } = require('node:fs');
    const { join } = require('node:path');
    const tela = readFileSync(join(__dirname, '../../../../frontend/src/components/loja/cardapio/texto-do-estorno.ts'), 'utf8');
    const doRobo = texto({ status: 'cancelado', statusPagamento: 'aprovado', tipo: 'entrega' }).replace('Seu pedido foi cancelado. ', '');
    expect(tela).toContain(doRobo);
  });
});
