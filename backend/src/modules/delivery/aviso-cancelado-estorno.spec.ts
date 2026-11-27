import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O AVISO DE CANCELAMENTO DO PEDIDO JÁ PAGO (pedido do dono, 26/11/2026): "já enviamos o aviso do pedido cancelado e o
// motivo — avisar também que o valor é estornado automaticamente". O estorno do Pix online é automático para todo cancelado
// pago assim (`EstornoPixService`); o aviso diz isso só quando é verdade.
describe('o aviso de pedido cancelado diz que o Pix é estornado sozinho', () => {
  const texto = (extra: Record<string, unknown> = {}) =>
    (DeliveryService as any).textoNotificacao('cancelado', {
      displayId: '76',
      canal: 'cardapio',
      tipo: 'entrega',
      status: 'cancelado',
      motivoCancelamento: 'Produto em falta',
      ...extra,
    }).texto as string;
  const pagoNoPix = { pago: true, statusPagamento: 'aprovado', gatewayPaymentId: 'pay-1', gatewayProvider: 'mercadopago' };

  it('pago no Pix online: o motivo e o estorno automático', () => {
    expect(texto(pagoNoPix)).toBe(
      'Seu pedido #76 foi cancelado. Motivo: Produto em falta. O valor pago no Pix será estornado automaticamente, para a mesma conta de onde saiu.',
    );
    for (const gatewayProvider of ['pagseguro', 'rede']) expect(texto({ ...pagoNoPix, gatewayProvider })).toContain('estornado automaticamente');
  });

  it('não pago online (na entrega, Pix esperando, sinal de encomenda, provedor de fora): sem a frase do estorno', () => {
    expect(texto()).toBe('Seu pedido #76 foi cancelado. Motivo: Produto em falta.');
    expect(texto({ ...pagoNoPix, pago: false, statusPagamento: 'aguardando' })).not.toContain('estornado');
    expect(texto({ ...pagoNoPix, sinalStatus: 'pago' })).not.toContain('estornado'); // o sinal tem a regra dele
    expect(texto({ ...pagoNoPix, gatewayProvider: 'gogem' })).not.toContain('estornado');
    expect(texto({ ...pagoNoPix, gatewayPaymentId: null })).not.toContain('estornado');
  });

  it('sem motivo: só o cancelado e, se pago no Pix, o estorno', () => {
    expect(texto({ ...pagoNoPix, motivoCancelamento: null })).toBe(
      'Seu pedido #76 foi cancelado. O valor pago no Pix será estornado automaticamente, para a mesma conta de onde saiu.',
    );
  });
});
