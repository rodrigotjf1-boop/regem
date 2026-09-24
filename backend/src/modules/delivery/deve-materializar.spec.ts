import { deveMaterializar } from './deve-materializar';

// O caso que apareceu no teste do modo edge: pedido de totem em dinheiro (pago=false)
// virava comanda e ia para a cozinha em 15s, com a loja configurada para produzir só
// depois do pagamento.
describe('deveMaterializar (edge)', () => {
  it('totem NÃO pago não vira produção quando a loja produz após o pagamento', () => {
    expect(deveMaterializar({ canal: 'totem', pago: false }, true)).toBe(false);
    expect(deveMaterializar({ canal: 'totem', pago: null }, true)).toBe(false);
    expect(deveMaterializar({ canal: 'TOTEM', pago: false }, true)).toBe(false);
  });

  it('totem PAGO vira produção normalmente', () => {
    expect(deveMaterializar({ canal: 'totem', pago: true }, true)).toBe(true);
    expect(deveMaterializar({ canal: 'totem', pago: true, formaPagamento: 'cartao' }, false)).toBe(
      true,
    );
  });

  it('com a loja em "produz ao aceitar", o totem em DINHEIRO não pago passa (é a escolha dela)', () => {
    expect(deveMaterializar({ canal: 'totem', pago: false }, false)).toBe(true);
    expect(deveMaterializar({ canal: 'totem', pago: false, formaPagamento: 'dinheiro' }, false)).toBe(
      true,
    );
  });

  // ERR-091 (complemento): a configuração da loja vale para o dinheiro. Cartão e PIX ficam
  // RETIDOS enquanto a maquininha cobra — nunca vão para a cozinha antes de aprovar, com
  // qualquer configuração. Antes, com a loja em "produz ao aceitar", iam em 15s.
  it('retido ELETRÔNICO não pago nunca vira produção, com qualquer configuração', () => {
    for (const forma of ['cartao', 'CARTAO', 'pix', 'credito', 'debito']) {
      for (const config of [true, false]) {
        expect(
          deveMaterializar({ canal: 'totem', pago: false, formaPagamento: forma }, config),
        ).toBe(false);
      }
    }
  });

  it('os demais canais não mudam de comportamento', () => {
    for (const canal of ['ifood', 'cardapio', '99food', 'anotaai', 'cardapio_web']) {
      expect(deveMaterializar({ canal, pago: false }, true)).toBe(true);
      expect(deveMaterializar({ canal, pago: true }, true)).toBe(true);
      expect(deveMaterializar({ canal, pago: false, formaPagamento: 'cartao' }, false)).toBe(true);
    }
  });
});
