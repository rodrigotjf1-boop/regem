import { chaveDoParcial, lerCancelamentoParcial, mensagemDoParcial } from './food99-parcial';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CANCELAMENTO PARCIAL DA 99 lido do detalhe do pedido como a documentação manda (Get Order Details, conferida em
// 11/11/2026): `submit_refund_amount` em cada item = quantos saíram; `price.refund_price` = o total devolvido (centavos);
// a situação 9xx = pedido cancelado. Achado O8 da auditoria do KDS.

const item = (mdu: string, name: string, amount: number, submit_refund_amount?: number) => ({
  mdu_id: mdu,
  app_item_id: `app-${mdu}`,
  name,
  amount,
  ...(submit_refund_amount != null ? { submit_refund_amount } : {}),
});
const detalhe = (itens: any[], extra: Record<string, unknown> = {}) => ({
  order_id: '5764607801871630353',
  status: 100,
  order_items: itens,
  price: { refund_price: 0 },
  ...extra,
});

describe('o cancelamento parcial lido do detalhe da 99', () => {
  it('parte saiu: os itens com a quantidade que saiu, o que fica e o valor devolvido em reais', () => {
    const c = lerCancelamentoParcial(
      detalhe([item('A1', 'Coca-Cola 2L', 1, 1), item('B2', 'Batata frita', 3, 2), item('C3', 'X-Burger', 2, 0)], { price: { refund_price: 2390 } }),
    );
    expect(c).toEqual({
      cancelado: false,
      tirados: [
        { mdu: 'A1', nome: 'Coca-Cola 2L', quantidade: 1, pedido: 1 },
        { mdu: 'B2', nome: 'Batata frita', quantidade: 2, pedido: 3 },
      ],
      devolvido: 23.9,
    });
  });

  it('o formato da doc com `order_info` também vale', () => {
    const c = lerCancelamentoParcial({ order_id: '1', order_info: detalhe([item('A1', 'Suco', 2, 1)]) });
    expect(c.cancelado).toBe(false);
    expect(c.tirados).toEqual([{ mdu: 'A1', nome: 'Suco', quantidade: 1, pedido: 2 }]);
  });

  it('a 99 cancelou o pedido (situação 9xx): é cancelamento do pedido inteiro', () => {
    for (const status of [901, 921, 961, 981]) {
      expect(lerCancelamentoParcial(detalhe([item('A1', 'Suco', 2, 1)], { status })).cancelado).toBe(true);
    }
    expect(lerCancelamentoParcial(detalhe([item('A1', 'Suco', 2, 1)], { status: 200 })).cancelado).toBe(false);
    expect(lerCancelamentoParcial(detalhe([item('A1', 'Suco', 2, 1)], { status: 1000 })).cancelado).toBe(false);
  });

  it('não sobrou item nenhum: é cancelamento do pedido inteiro', () => {
    expect(lerCancelamentoParcial(detalhe([item('A1', 'Suco', 2, 2), item('B2', 'Pão', 1, 1)])).cancelado).toBe(true);
    // A 99 mandando mais do que havia não passa do que havia.
    const c = lerCancelamentoParcial(detalhe([item('A1', 'Suco', 2, 5), item('B2', 'Pão', 1, 0)]));
    expect(c.cancelado).toBe(false);
    expect(c.tirados).toEqual([{ mdu: 'A1', nome: 'Suco', quantidade: 2, pedido: 2 }]);
  });

  it('o detalhe sem o campo da quantidade que saiu: nada listado, e não é cancelamento', () => {
    const c = lerCancelamentoParcial(detalhe([item('A1', 'Suco', 2)]));
    expect(c).toEqual({ cancelado: false, tirados: [], devolvido: null });
  });

  it('detalhe vazio ou estranho: não quebra e não cancela', () => {
    expect(lerCancelamentoParcial(null)).toEqual({ cancelado: false, tirados: [], devolvido: null });
    expect(lerCancelamentoParcial({ order_items: 'x', price: { refund_price: 'abc' } })).toEqual({ cancelado: false, tirados: [], devolvido: null });
  });
});

describe('a chave do caso', () => {
  const tirados = lerCancelamentoParcial(detalhe([item('A1', 'Suco', 2, 1), item('B2', 'Pão', 3, 1)])).tirados;

  it('o mesmo aviso de novo dá a mesma chave, em qualquer ordem dos itens', () => {
    expect(chaveDoParcial('99', tirados)).toBe(chaveDoParcial('99', [...tirados].reverse()));
    expect(chaveDoParcial('99', tirados)).toMatch(/^parcial-99-[0-9a-f]{16}$/);
  });

  it('mais um item saindo depois dá outra chave (outro caso); outro pedido também', () => {
    const mais = lerCancelamentoParcial(detalhe([item('A1', 'Suco', 2, 2), item('B2', 'Pão', 3, 1)])).tirados;
    expect(chaveDoParcial('99', mais)).not.toBe(chaveDoParcial('99', tirados));
    expect(chaveDoParcial('98', tirados)).not.toBe(chaveDoParcial('99', tirados));
  });
});

describe('o texto do caso', () => {
  it('o que saiu, o que fica, o que a 99 devolveu e o que fazer', () => {
    const c = lerCancelamentoParcial(detalhe([item('A1', 'Coca-Cola 2L', 1, 1), item('B2', 'Batata frita', 3, 2)], { price: { refund_price: 2390 } }));
    expect(mensagemDoParcial(c)).toBe(
      [
        'A 99 cancelou parte do pedido.',
        'Saiu: 1× Coca-Cola 2L; 2× Batata frita (ficam 1).',
        'A 99 devolveu R$ 23,90 ao cliente.',
        'Avise a cozinha e quem embala para não mandar o que saiu. A venda no Regem não muda sozinha.',
      ].join('\n'),
    );
  });

  it('sem a lista do que saiu: manda conferir no portal da 99', () => {
    expect(mensagemDoParcial({ cancelado: false, tirados: [], devolvido: null })).toContain('confira o pedido no portal da 99');
  });
});
