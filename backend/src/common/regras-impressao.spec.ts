import { alvosDoDocumento, normalizarRegras, VIAS_MAX } from './regras-impressao';

// Onde cada documento sai (mig 327) — a parte sem banco: o formato guardado e para onde vai cada
// documento. `null` = sem regra (o caminho de sempre, decisão 1A).
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const PDV = '33333333-3333-4333-8333-333333333333';

describe('normalizarRegras', () => {
  it('chave ausente = documento sem regra; lixo vira vazio', () => {
    expect(normalizarRegras(null)).toEqual({});
    expect(normalizarRegras([])).toEqual({});
    expect(normalizarRegras({ outro: 1 })).toEqual({});
    expect(normalizarRegras({ delivery: 'x' })).toEqual({});
  });

  it('vias de 1 a 5 (inteiras); impressora repetida soma as vias; ordem preservada', () => {
    const r = normalizarRegras({ delivery: { impressoras: [{ id: B, vias: 0 }, { id: A, vias: 2.7 }, { id: B, vias: 9 }, { id: '' }, 'lixo'] } });
    expect(r.delivery?.impressoras).toEqual([{ id: B, vias: VIAS_MAX }, { id: A, vias: 2 }, { id: 'lixo', vias: 1 }]);
  });

  it('padrões: balcão com "PDV que vendeu" ligado e 1 via; entregador nas mesmas do delivery', () => {
    expect(normalizarRegras({ balcao: {}, entregador: {} })).toEqual({
      balcao: { pdv: true, pdvVias: 1, impressoras: [] },
      entregador: { mesmasDoDelivery: true, impressoras: [] },
    });
    expect(normalizarRegras({ balcao: { pdv: false } }).balcao?.pdv).toBe(false);
  });
});

describe('alvosDoDocumento', () => {
  it('sem regra (ou com a lista vazia) = null: o caminho de sempre', () => {
    expect(alvosDoDocumento({}, 'delivery', null)).toBeNull();
    expect(alvosDoDocumento(normalizarRegras({ delivery: { impressoras: [] } }), 'delivery', null)).toBeNull();
    expect(alvosDoDocumento({}, 'balcao', PDV)).toBeNull();
    expect(alvosDoDocumento({}, 'entregador', null)).toBeNull();
  });

  it('delivery em duas impressoras, com as vias de cada uma', () => {
    const r = normalizarRegras({ delivery: { impressoras: [{ id: A, vias: 2 }, { id: B, vias: 1 }] } });
    expect(alvosDoDocumento(r, 'delivery', null)).toEqual([{ id: A, vias: 2 }, { id: B, vias: 1 }]);
  });

  it('balcão: a do PDV que vendeu mais a lista; a mesma impressora soma as vias; sem PDV, só a lista', () => {
    const r = normalizarRegras({ balcao: { pdv: true, pdvVias: 1, impressoras: [{ id: A, vias: 1 }] } });
    expect(alvosDoDocumento(r, 'balcao', PDV)).toEqual([{ id: PDV, vias: 1 }, { id: A, vias: 1 }]);
    expect(alvosDoDocumento(r, 'balcao', A)).toEqual([{ id: A, vias: 2 }]);
    expect(alvosDoDocumento(r, 'balcao', null)).toEqual([{ id: A, vias: 1 }]);
    expect(alvosDoDocumento(normalizarRegras({ balcao: { pdv: true } }), 'balcao', null)).toBeNull(); // sem PDV e sem lista
    expect(alvosDoDocumento(normalizarRegras({ balcao: { pdv: false, impressoras: [{ id: B }] } }), 'balcao', PDV)).toEqual([{ id: B, vias: 1 }]);
  });

  it('entregador: nas mesmas do delivery (padrão) ou na sua lista', () => {
    const delivery = { impressoras: [{ id: A, vias: 1 }] };
    expect(alvosDoDocumento(normalizarRegras({ delivery }), 'entregador', null)).toEqual([{ id: A, vias: 1 }]);
    expect(alvosDoDocumento(normalizarRegras({ delivery, entregador: { mesmasDoDelivery: false, impressoras: [{ id: B, vias: 2 }] } }), 'entregador', null)).toEqual([{ id: B, vias: 2 }]);
    expect(alvosDoDocumento(normalizarRegras({ delivery, entregador: { mesmasDoDelivery: false } }), 'entregador', null)).toBeNull();
  });

  // Pedido do dono (20/10/2026): a retirada no balcão (pedido de canal que o cliente busca no
  // caixa) com a impressão À PARTE. Sem escolha, nada muda: sai nas mesmas do delivery.
  it('retirada: nas mesmas do delivery (padrão e sem regra) ou na sua lista', () => {
    const delivery = { impressoras: [{ id: A, vias: 1 }] };
    expect(alvosDoDocumento(normalizarRegras({ delivery }), 'retirada', null)).toEqual([{ id: A, vias: 1 }]);
    expect(alvosDoDocumento(normalizarRegras({ delivery, retirada: {} }), 'retirada', null)).toEqual([{ id: A, vias: 1 }]);
    expect(alvosDoDocumento(normalizarRegras({ delivery, retirada: { mesmasDoDelivery: false, impressoras: [{ id: B, vias: 2 }] } }), 'retirada', null)).toEqual([{ id: B, vias: 2 }]);
    expect(alvosDoDocumento(normalizarRegras({ delivery, retirada: { mesmasDoDelivery: false } }), 'retirada', null)).toBeNull();
    expect(alvosDoDocumento({}, 'retirada', null)).toBeNull(); // sem regra nenhuma: o caminho de sempre
    // A regra da retirada não mexe no delivery nem no entregador.
    const r = normalizarRegras({ delivery, retirada: { mesmasDoDelivery: false, impressoras: [{ id: B, vias: 1 }] } });
    expect(alvosDoDocumento(r, 'delivery', null)).toEqual([{ id: A, vias: 1 }]);
    expect(alvosDoDocumento(r, 'entregador', null)).toEqual([{ id: A, vias: 1 }]);
    expect(normalizarRegras({ retirada: {} })).toEqual({ retirada: { mesmasDoDelivery: true, impressoras: [] } });
  });
});
