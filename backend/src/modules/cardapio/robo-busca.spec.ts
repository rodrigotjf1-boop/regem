import {
  categoriasPorPapel,
  nomeJunto,
  nucleoDoNome,
  numerosDoNome,
  palavrasDe,
  papelDaCategoria,
  procurarNoCardapio,
  termosDaBusca,
} from './robo-busca';

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

// F5 (teste do dono, 31/10/2026): "tem alguma opção com bacon?" e o robô citou só o X-Bacon e o trio — os da ficha
// ficaram de fora e o adicional não apareceu. A busca manda a lista PRONTA, com todos, o trio junto e o adicional.
describe('F5: a lista pronta para o cliente (paraOCliente)', () => {
  it('pergunta de ingrediente: TODOS os que levam, o trio junto do lanche e onde dá para pôr a mais (com o preço)', () => {
    const r: any = procurarNoCardapio(MENU, 'Tem alguma opcao com bacon?', DADOS);
    expect(r.paraOCliente).toBe(
      [
        'Com bacon temos:',
        '• Batata com bacon — R$ 18,00',
        '• X Bacon — R$ 26,00 (no trio, R$ 36,00)',
        '• Smash da Casa — R$ 29,00',
        'E dá para pôr bacon a mais nos lanches: de +R$ 4,00 a +R$ 5,00.',
      ].join('\n'),
    );
  });
  it('pergunta pelo NOME de um produto não vira lista (o robô responde com o produto e o link)', () => {
    for (const q of ['x-bacon', 'quanto custa o xbacon?']) expect((procurarNoCardapio(MENU, q, DADOS) as any).paraOCliente).toBeNull();
  });
  it('o núcleo do nome junta o lanche com o trio ("TRIO 07" = "Numero 07"; "TRIO X-BACON" = "X bacon")', () => {
    expect(nucleoDoNome('TRIO 07')).toBe(nucleoDoNome('Numero 07'));
    expect(nucleoDoNome('Trio n8')).toBe(nucleoDoNome('Numero 08'));
    expect(nucleoDoNome('TRIO X-BACON')).toBe(nucleoDoNome('X bacon'));
    expect(nucleoDoNome('TRIO CHEDDAR')).toBe(nucleoDoNome('Cheddar !!!'));
    expect(nucleoDoNome('TRIO 07')).not.toBe(nucleoDoNome('TRIO 08'));
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

// O NÚMERO NO NOME E A FOTO (2º teste do dono, 31/10/2026 — ERR-335): "Tem foto do trio 07?" trouxe o lanche "Numero 07".
// Com o cardápio real da loja, a busca não achava nada por "07", achava TODOS os "Numero" por "número 8" e nenhum trio
// por "foto do trio 07"; e a lista pronta dizia "Dá para pôr foto trio 07 a mais nos lanches: sem custo" (a opção
// "trio kids" da etapa obrigatória de um combo). Cardápio de teste com os nomes da loja.
describe('número no nome, "foto" na frase e a etapa obrigatória (ERR-335)', () => {
  const obrig = (nome: string, opcoes: any[]) => ({ id: `g-${nome}`, nome, tipo: 'adicionar', min: 3, max: 3, obrigatorio: true, opcoes });
  const MENU_LOJA = {
    categorias: [
      { id: 'c-burguer', nome: 'BURGUER' },
      { id: 'c-trios', nome: 'BURGUER + BATATA + REFRI' },
      { id: 'c-mais', nome: 'OS MAIS PEDIDOS !!!' },
      { id: 'c-combos', nome: 'COMBOS' },
      { id: 'c-bebidas', nome: 'Bebidas' },
    ],
    produtos: [
      { id: 'n07', nome: 'Numero 07', precoVenda: 17.5, categoriaId: 'c-burguer', grupos: [g('adicionar', [op('Bacon', 3.5)])] },
      { id: 'n08', nome: 'Numero 08', precoVenda: 21.5, categoriaId: 'c-burguer', grupos: [] },
      { id: 'n10', nome: 'Numero 10', precoVenda: 9, categoriaId: 'c-burguer', grupos: [] },
      { id: 't01', nome: 'TRIO 01', precoVenda: 28, categoriaId: 'c-trios', grupos: [] },
      { id: 't07a', nome: 'TRIO 07', precoVenda: 29, categoriaId: 'c-trios', grupos: [] },
      { id: 't07b', nome: 'TRIO 07', precoVenda: 29, categoriaId: 'c-mais', grupos: [] },
      { id: 't08', nome: 'TRIO 08', precoVenda: 32.5, categoriaId: 'c-trios', grupos: [] },
      { id: 't10', nome: 'TRIO 10', precoVenda: 20, categoriaId: 'c-trios', grupos: [] },
      { id: 'txb', nome: 'TRIO X-BACON', precoVenda: 36, categoriaId: 'c-trios', grupos: [] },
      { id: 'xb', nome: 'X bacon', precoVenda: 26, categoriaId: 'c-burguer', grupos: [] },
      { id: 'fam', nome: 'COMBO FAMILIA', precoVenda: 80, categoriaId: 'c-combos', grupos: [obrig('Monte seu combo', [op('Numero 07', 0), op('trio kids', 0)])] },
      { id: 'coca15', nome: 'Coca cola - 1,50 lts', precoVenda: 14, categoriaId: 'c-bebidas', grupos: [] },
      { id: 'cocalata', nome: 'Coca cola lata', precoVenda: 7, categoriaId: 'c-bebidas', grupos: [] },
    ],
  };
  const SEM_FICHA = { ingredientes: new Map<string, Set<string>>(), componentes: new Map<string, string[]>() };
  const ids = (q: string) => (procurarNoCardapio(MENU_LOJA, q, SEM_FICHA) as any).levam.map((x: any) => x.id);

  it('"trio 07", "trio 7" e a frase inteira ("tem foto do trio 07?"): só o TRIO 07 — as duas cópias, nunca o lanche', () => {
    for (const q of ['trio 07', 'Trio 7', 'foto do trio 07', 'Tem foto do trio 07?', 'me mostra o trio 07']) expect(ids(q)).toEqual(['t07a', 't07b']);
    expect(ids('tem foto do trio 08?')).toEqual(['t08']);
  });

  it('o número sozinho acha o lanche e o trio; "número 8" acha só o 08; "trio 1" não é o "TRIO 10"', () => {
    expect(ids('07').sort()).toEqual(['n07', 't07a', 't07b']);
    expect(ids('número 8')).toEqual(['n08']);
    expect(ids('nº 08')).toEqual(['n08', 't08']);
    expect(ids('trio 1')).toEqual(['t01']);
    expect(ids('numero 1')).toEqual([]);
  });

  it('a quantidade na frente do nome não atrapalha ("2 x-bacon" = "x-bacon"); número com vírgula é um só ("coca 1,5")', () => {
    expect(ids('2 x-bacon')).toEqual(ids('x-bacon'));
    expect(ids('x-bacon')).toContain('xb');
    expect(ids('coca 1,5')).toEqual(['coca15']);
    expect(termosDaBusca('foto do trio 07').map((t) => t.texto)).toEqual(['trio', '7']);
    expect(termosDaBusca('2 x-bacon').map((t) => t.texto)).toEqual(['x', 'bacon']);
  });

  it('a etapa OBRIGATÓRIA do combo não é "a mais": a lista pronta não diz "dá para pôr trio a mais"', () => {
    const r: any = procurarNoCardapio(MENU_LOJA, 'tem trio?', SEM_FICHA);
    expect(r.paraOCliente ?? '').not.toMatch(/a mais/);
    // O adicional de verdade (grupo que dá para pular) continua: "bacon a mais".
    expect((procurarNoCardapio(MENU_LOJA, 'tem com bacon?', SEM_FICHA) as any).paraOCliente).toMatch(/pôr bacon a mais nos lanches: \+R\$ 3,50/);
  });

  it('o nome junto e os números do nome comparam sem o zero da frente', () => {
    expect(nomeJunto('TRIO 07')).toBe('trio7');
    expect(nomeJunto('X-Bacon')).toBe('xbacon');
    expect([...numerosDoNome('Coca cola - 1,50 lts')]).toEqual(['1d5']);
    expect([...numerosDoNome('NUmero 03')]).toEqual(['3']);
  });
});
