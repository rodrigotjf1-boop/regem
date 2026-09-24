import { catalogoParaGogem } from './catalogo-gogem';

// R3 — o tradutor é o contrato entre os dois produtos. Os casos abaixo são os que
// quebrariam a loja de verdade: item sem de-para (venda recusada no lançamento),
// dinheiro em float, esgotado sumindo do cardápio e categoria órfã.
const base = {
  categorias: [
    { id: 'c1', nome: 'Lanches', ordem: 2, ativo: true, imagemRef: 'https://s/c1.png' },
    { id: 'c2', nome: 'Bebidas', ordem: 1, ativo: true, imagemRef: null },
    { id: 'c3', nome: 'Inativa', ordem: 0, ativo: false, imagemRef: null },
  ],
  produtos: [
    {
      id: 'p1',
      codigo: '101',
      nome: 'X-Burger',
      descricao: 'pão, carne',
      imagem: 'https://s/p1.png',
      precoVenda: '29.90',
      categoriaId: 'c1',
      disponivelBalcao: true,
      disponivelCardapio: true,
      canaisPausados: [],
      pausadoEstoque: false,
      ativo: true,
      grupos: [
        {
          id: 'g1',
          nome: 'Adicionais',
          tipo: 'adicionar',
          min: 0,
          max: null,
          obrigatorio: false,
          ordem: 0,
          opcoes: [
            { id: 'o1', nome: 'Bacon', precoDelta: '4.50', codigoPdv: '9001', ordem: 0 },
            { id: 'o2', nome: 'Ovo', precoDelta: '0', codigoPdv: null, ordem: 1 },
          ],
        },
      ],
    },
    {
      id: 'p2',
      codigo: '202',
      nome: 'Refri',
      descricao: '',
      imagem: null,
      precoVenda: '7.00',
      categoriaId: 'c2',
      disponivelBalcao: true,
      canaisPausados: ['gogem'],
      pausadoEstoque: false,
      ativo: true,
      grupos: [],
    },
  ],
};

describe('catalogoParaGogem (R3)', () => {
  it('monta o envelope que o totem lê', () => {
    const r = catalogoParaGogem(base as any, { corPrimaria: '#fff' }, 42);
    expect(r.versao).toBe(42);
    expect(r.aparencia).toEqual({ corPrimaria: '#fff' });
    expect(Object.keys(r.snapshot)).toEqual(['categorias', 'produtos']);
  });

  it('converte preço para CENTAVOS inteiros (sem float)', () => {
    const r = catalogoParaGogem(base as any, null, 1);
    expect(r.snapshot.produtos[0].precoCentavos).toBe(2990);
    expect(r.snapshot.produtos[0].grupos[0].opcoes[0].precoCentavosDelta).toBe(450);
  });

  it('leva o código PDV no externalRefs (é a chave da venda de volta)', () => {
    const r = catalogoParaGogem(base as any, null, 1);
    expect(r.snapshot.produtos[0].externalRefs).toEqual([
      { sistema: 'regem', codigo_pdv: '101' },
    ]);
    expect(r.snapshot.produtos[0].grupos[0].opcoes[0].externalRefs).toEqual([
      { sistema: 'regem', codigo_pdv: '9001' },
    ]);
    // Opção sem código PDV não inventa de-para.
    expect(r.snapshot.produtos[0].grupos[0].opcoes[1].externalRefs).toEqual([]);
  });

  it('produto SEM código PDV fica de fora (a venda seria recusada)', () => {
    const cat = {
      ...base,
      produtos: [...base.produtos, { ...base.produtos[0], id: 'p9', codigo: null }],
    };
    const r = catalogoParaGogem(cat as any, null, 1);
    expect(r.snapshot.produtos.map((p) => p.id)).not.toContain('p9');
  });

  it('inativo e fora do balcão ficam de fora', () => {
    const cat = {
      ...base,
      produtos: [
        { ...base.produtos[0], id: 'pi', ativo: false },
        { ...base.produtos[0], id: 'pb', disponivelBalcao: false },
      ],
    };
    const r = catalogoParaGogem(cat as any, null, 1);
    expect(r.snapshot.produtos).toHaveLength(0);
  });

  it('esgotado/canal pausado APARECE como indisponível (não some)', () => {
    const r = catalogoParaGogem(base as any, null, 1);
    const refri = r.snapshot.produtos.find((p) => p.id === 'p2');
    expect(refri).toBeDefined();
    expect(refri!.disponivel).toBe(false);
    expect(r.snapshot.produtos.find((p) => p.id === 'p1')!.disponivel).toBe(true);
  });

  it('max nulo vira o total de opções do grupo (o totem espera inteiro)', () => {
    const r = catalogoParaGogem(base as any, null, 1);
    expect(r.snapshot.produtos[0].grupos[0].max).toBe(2);
  });

  it('categoria inativa e categoria sem produto ficam de fora; ordem é respeitada', () => {
    const r = catalogoParaGogem(base as any, null, 1);
    expect(r.snapshot.categorias.map((c) => c.id)).toEqual(['c2', 'c1']);
  });

  it('aguenta catálogo vazio sem quebrar', () => {
    const r = catalogoParaGogem({ categorias: [], produtos: [] }, null, 0);
    expect(r.snapshot).toEqual({ categorias: [], produtos: [] });
  });
});
