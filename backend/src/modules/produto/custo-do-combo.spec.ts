import { agruparProdutosDosCombos, criarResolvedorDeCusto, type CustoPar } from './custo-do-combo';

// O custo do combo pela soma dos produtos dele (pedido do dono, 27/11/2026): o lanche pela ficha, a batata pela ficha e a lata
// pelo estoque. A regra: manual vence; combo com produtos = a soma × quantidade, balcão e delivery separados; produto sem
// custo conhecido = combo sem custo (nunca soma parcial); combo sem produtos segue pelo cadastro dele; ciclo = sem custo.

type Prod = { tipo?: string; manual?: number; ficha?: CustoPar; item?: number };
const montar = (produtos: Record<string, Prod>, combos: Array<[string, string, unknown]>) =>
  criarResolvedorDeCusto({
    manual: (id) => (produtos[id]?.manual != null ? { balcao: produtos[id].manual!, delivery: produtos[id].manual! } : null),
    cadastro: (id) => {
      const p = produtos[id];
      if (p?.ficha) return { custo: p.ficha, fonte: 'ficha' };
      if (p?.item != null) return { custo: { balcao: p.item, delivery: p.item }, fonte: 'estoque' };
      return null;
    },
    ehCombo: (id) => produtos[id]?.tipo === 'combo',
    produtosDosCombos: agruparProdutosDosCombos(combos.map(([combo, componente, quantidade]) => ({ combo, componente, quantidade }))),
  });

const base: Record<string, Prod> = {
  lanche: { ficha: { balcao: 9, delivery: 9.8 } }, // a embalagem do delivery entra na ficha
  batata: { ficha: { balcao: 3, delivery: 3.5 } },
  lata: { item: 2.4 },
  semCusto: {},
};

describe('o custo do combo pela soma dos produtos', () => {
  it('combo com ficha + ficha + revenda: a soma × a quantidade, balcão e delivery separados', () => {
    const custo = montar({ ...base, trio: { tipo: 'combo' } }, [['trio', 'lanche', '1'], ['trio', 'batata', 1], ['trio', 'lata', 2]]);
    const r = custo('trio')!;
    expect(r.fonte).toBe('combo');
    expect(r.custo.balcao).toBeCloseTo(9 + 3 + 2 * 2.4, 10);
    expect(r.custo.delivery).toBeCloseTo(9.8 + 3.5 + 2 * 2.4, 10);
  });

  it('um produto sem custo conhecido deixa o combo sem custo (nunca a soma parcial)', () => {
    const custo = montar({ ...base, trio: { tipo: 'combo' } }, [['trio', 'lanche', 1], ['trio', 'semCusto', 1]]);
    expect(custo('trio')).toBeNull();
    // Componente que nem existe na lista (excluído) também.
    expect(montar({ ...base, trio: { tipo: 'combo' } }, [['trio', 'lanche', 1], ['trio', 'sumiu', 1]])('trio')).toBeNull();
  });

  it('o custo informado à mão no combo vence a soma', () => {
    const custo = montar({ ...base, trio: { tipo: 'combo', manual: 15 } }, [['trio', 'lanche', 1], ['trio', 'semCusto', 1]]);
    expect(custo('trio')).toEqual({ custo: { balcao: 15, delivery: 15 }, fonte: 'manual' });
  });

  it('combo SEM produtos segue pelo cadastro dele (como era)', () => {
    const custo = montar({ ...base, velho: { tipo: 'combo', ficha: { balcao: 7, delivery: 7 } } }, []);
    expect(custo('velho')).toEqual({ custo: { balcao: 7, delivery: 7 }, fonte: 'ficha' });
  });

  it('o produto comum não muda: manual → ficha → estoque', () => {
    const custo = montar({ ...base, refri: { manual: 0, item: 3 } }, []);
    expect(custo('lanche')?.fonte).toBe('ficha');
    expect(custo('lata')).toEqual({ custo: { balcao: 2.4, delivery: 2.4 }, fonte: 'estoque' });
    expect(custo('refri')).toEqual({ custo: { balcao: 0, delivery: 0 }, fonte: 'manual' }); // o zero digitado vale
    expect(custo('semCusto')).toBeNull();
  });

  it('combo dentro de combo soma pela mesma regra; ciclo fica sem custo', () => {
    const dentro = montar({ ...base, trio: { tipo: 'combo' }, familia: { tipo: 'combo' } }, [
      ['trio', 'lanche', 1],
      ['trio', 'lata', 1],
      ['familia', 'trio', 2],
      ['familia', 'batata', 1],
    ]);
    expect(dentro('familia')?.custo.balcao).toBeCloseTo(2 * (9 + 2.4) + 3, 10);
    const ciclo = montar({ ...base, a: { tipo: 'combo' }, b: { tipo: 'combo' } }, [['a', 'b', 1], ['b', 'a', 1]]);
    expect(ciclo('a')).toBeNull();
    expect(ciclo('b')).toBeNull();
  });

  it('quantidade vazia ou zero vale 1, como na venda', () => {
    const grupos = agruparProdutosDosCombos([{ combo: 'c', componente: 'x', quantidade: null }, { combo: 'c', componente: 'y', quantidade: '0' }, { combo: 'c', componente: 'z', quantidade: '2.5' }]);
    expect(grupos.get('c')).toEqual([{ produtoId: 'x', quantidade: 1 }, { produtoId: 'y', quantidade: 1 }, { produtoId: 'z', quantidade: 2.5 }]);
  });
});
