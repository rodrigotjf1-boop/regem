import { categoriasPorPapel, palavrasDe, papelDaCategoria, procurarNoCardapio, termosDaBusca } from './robo-busca';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A BUSCA DO ROBÔ (Fase 5, F2 — pedido do dono de 30/10/2026): "tem hambúrguer com bacon?" → os que LEVAM bacon (ficha
// técnica primeiro, senão a descrição; o nome também vale), onde o bacon entra como ADICIONAL (com o preço), os combos e
// o link direto. Cardápio de teste parecido com o da loja piloto.
const g = (tipo: string, opcoes: any[]) => ({ id: `g-${Math.random()}`, nome: 'Adicionais', tipo, min: 0, max: 5, opcoes });
const op = (nome: string, precoDelta: number, informativa = false) => ({ id: `o-${nome}`, nome, precoDelta, informativa });

const MENU = {
  categorias: [
    { id: 'c-lanches', nome: 'Lanches' },
    { id: 'c-combos', nome: 'Combos' },
    { id: 'c-porcoes', nome: 'Porções' },
    { id: 'c-bebidas', nome: 'Bebidas' },
    { id: 'c-sobremesas', nome: 'Sobremesas' },
  ],
  produtos: [
    { id: 'xbacon', nome: 'X Bacon', precoVenda: 26, categoriaId: 'c-lanches', descricao: 'Pão, carne, queijo e bacon', grupos: [g('remover', [op('Sem bacon', 0)])] },
    { id: 'xburger', nome: 'X-Burger', precoVenda: 22, categoriaId: 'c-lanches', descricao: 'Pão, carne e queijo', grupos: [g('adicionar', [op('Bacon', 4), op('Ovo', 3), op('Ponto da carne', 0, true)])] },
    { id: 'xsalada', nome: 'X-Salada', precoVenda: 23, categoriaId: 'c-lanches', descricao: 'Pão, carne, queijo, alface e tomate', grupos: [g('adicionar', [op('Bacon', 4)])] },
    { id: 'xtudo', nome: 'X-Tudo', precoVenda: 32, categoriaId: 'c-lanches', descricao: 'O mais completo', grupos: [g('adicionar', [op('Bacon extra', 5)])] },
    // Com FICHA: a descrição não fala de bacon, mas a ficha (sub-receita do molho) tem.
    { id: 'smash', nome: 'Smash da Casa', precoVenda: 29, categoriaId: 'c-lanches', descricao: 'Dois smash e molho especial', grupos: [] },
    // Com FICHA sem bacon, e a DESCRIÇÃO fala de bacon (a ficha vale — a descrição estava velha).
    { id: 'veggie', nome: 'Burger Veggie', precoVenda: 27, categoriaId: 'c-lanches', descricao: 'Antes vinha com bacon', grupos: [] },
    { id: 'esgotado', nome: 'X-Egg', precoVenda: 24, categoriaId: 'c-lanches', descricao: 'Pão, carne e ovo', esgotado: true, grupos: [g('adicionar', [op('Bacon', 4)])] },
    { id: 'trio', nome: 'TRIO X-BACON', precoVenda: 36, categoriaId: 'c-combos', descricao: 'X Bacon + batata + refri', grupos: [] },
    { id: 'batata', nome: 'Batata com bacon', precoVenda: 18, categoriaId: 'c-porcoes', descricao: 'Batata frita com bacon', grupos: [] },
    { id: 'coca', nome: 'Coca-Cola lata', precoVenda: 7, categoriaId: 'c-bebidas', descricao: null, grupos: [] },
    { id: 'pudim', nome: 'Pudim', precoVenda: 9, categoriaId: 'c-sobremesas', descricao: null, grupos: [] },
  ],
};
const DADOS = {
  ingredientes: new Map<string, Set<string>>([
    ['smash', palavrasDe('carne bovina 90 g pao brioche molho da casa bacon em cubos 15 g')],
    ['veggie', palavrasDe('pao brioche hamburguer de grao de bico alface')],
    ['xbacon', palavrasDe('pao carne 120 g queijo prato bacon fatiado 20 g')],
  ]),
  componentes: new Map<string, string[]>([['trio', ['xbacon', 'batata', 'coca']]]),
  linkDoProduto: (id: string) => `https://app.dmsregem.com/c/abc123?produto=${id}`,
};
const nomes = (l: any[]) => l.map((x) => x.nome);

describe('busca do robô — ficha, descrição, adicionais, combos e link', () => {
  it('"tem hambúrguer com bacon?": os que levam bacon — pelo nome, pela ficha (sub-receita) e o combo', () => {
    const r: any = procurarNoCardapio(MENU, 'tem hambúrguer com bacon?', DADOS);
    expect(nomes(r.levam)).toEqual(expect.arrayContaining(['X Bacon', 'Smash da Casa', 'TRIO X-BACON']));
    expect(r.levam.find((x: any) => x.nome === 'Smash da Casa').porque).toBe('ficha');
    // A batata com bacon não é hambúrguer: fica de fora desta pergunta.
    expect(nomes(r.levam)).not.toContain('Batata com bacon');
  });

  it('onde o bacon entra como ADICIONAL, com o preço (que muda de lanche para lanche); esgotado fica de fora', () => {
    const r: any = procurarNoCardapio(MENU, 'tem hambúrguer com bacon?', DADOS);
    const bacon = r.podeAdicionar.find((a: any) => a.adicional === 'Bacon');
    expect(bacon).toMatchObject({ preco: '+R$ 4,00' });
    expect(bacon.em).toEqual(expect.arrayContaining(['X-Burger', 'X-Salada']));
    expect(bacon.em).not.toContain('X-Egg');
    const extra = r.podeAdicionar.find((a: any) => a.adicional === 'Bacon extra');
    expect(extra).toMatchObject({ preco: '+R$ 5,00', em: ['X-Tudo'] });
  });

  it('"x-bacon", "xbacon" e "x bacon" casam igual: o sanduíche e o trio, nessa ordem de relevância', () => {
    for (const q of ['x-bacon', 'xbacon', 'x bacon', 'X-BACON?']) {
      const r: any = procurarNoCardapio(MENU, q, DADOS);
      expect(nomes(r.levam).slice(0, 2)).toEqual(['X Bacon', 'TRIO X-BACON']);
    }
  });

  it('a FICHA vale mais que a descrição: com ficha sem bacon, a descrição velha não conta', () => {
    const r: any = procurarNoCardapio(MENU, 'bacon', DADOS);
    expect(nomes(r.levam)).not.toContain('Burger Veggie');
    // sem ficha, a descrição vale
    expect(r.levam.find((x: any) => x.nome === 'Batata com bacon')).toBeTruthy();
  });

  it('"Sem bacon" (grupo de remover) e opção informativa não contam como adicional', () => {
    const r: any = procurarNoCardapio(MENU, 'ponto da carne', DADOS);
    expect(r.podeAdicionar).toEqual([]);
    const semBacon: any = procurarNoCardapio(MENU, 'bacon', DADOS);
    for (const a of semBacon.podeAdicionar) expect(a.adicional).not.toMatch(/^Sem/);
  });

  it('cada item traz preço escrito, versões, os combos que o levam, o que o combo leva e o link direto', () => {
    const r: any = procurarNoCardapio(MENU, 'x bacon', DADOS);
    const xb = r.levam.find((x: any) => x.id === 'xbacon');
    expect(xb).toMatchObject({ preco: 'R$ 26,00', link: 'https://app.dmsregem.com/c/abc123?produto=xbacon' });
    expect(xb.combos).toEqual([{ nome: 'TRIO X-BACON', preco: 'R$ 36,00', esgotado: false }]);
    const trio = r.levam.find((x: any) => x.id === 'trio');
    expect(trio.itensDoCombo).toEqual(['X Bacon', 'Batata com bacon', 'Coca-Cola lata']);
  });

  it('nunca entrega os nomes técnicos da ficha (receita, gramatura)', () => {
    const r = JSON.stringify(procurarNoCardapio(MENU, 'bacon', DADOS));
    expect(r).not.toMatch(/fatiado|cubos|brioche|120 g|15 g/);
  });

  it('nada casa: os parecidos por pontos; pergunta vazia: listas vazias', () => {
    const r: any = procurarNoCardapio(MENU, 'refrigerante de cola', DADOS);
    expect(r.levam.length + r.parecidos.length).toBeGreaterThan(0);
    expect(procurarNoCardapio(MENU, '   ', DADOS)).toMatchObject({ levam: [], podeAdicionar: [], parecidos: [] });
  });
});

describe('termos da busca e o papel das categorias', () => {
  it('tira as palavras vazias e mantém o "x" do x-bacon', () => {
    expect(termosDaBusca('Oi, tem hambúrguer com bacon? quanto custa').map((t) => t.texto)).toEqual(['hamburguer', 'bacon']);
    expect(termosDaBusca('x-bacon').map((t) => t.texto)).toEqual(['x', 'bacon']);
  });

  it('bebida, sobremesa e porção pelo nome da categoria (plural e acento não atrapalham)', () => {
    expect(papelDaCategoria('Bebidas')).toBe('bebida');
    expect(papelDaCategoria('Refrigerantes')).toBe('bebida');
    expect(papelDaCategoria('Sobremesas')).toBe('sobremesa');
    expect(papelDaCategoria('Porções')).toBe('porcao');
    expect(papelDaCategoria('Acompanhamentos')).toBe('porcao');
    expect(papelDaCategoria('Lanches')).toBeNull();
    expect(categoriasPorPapel(MENU)).toEqual({ bebidas: ['Bebidas'], sobremesas: ['Sobremesas'], porcoes: ['Porções'] });
  });
});
