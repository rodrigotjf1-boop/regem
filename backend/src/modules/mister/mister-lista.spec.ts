import {
  InsumoDaLista,
  LinhaDaLista,
  lerBotaoDaLista,
  lerPedidos,
  ligarAoInsumo,
  marcaDoTexto,
  montarLinha,
  pedidosDaPlanilha,
  perguntaDaLinha,
  perguntaDoFornecedor,
  proximaPendencia,
  quantidadeNoEstoque,
  resumoDaLista,
} from './mister-lista';

// A LISTA DE COMPRAS PELA CONVERSA (versão 6, M6g) — só o que é puro: as linhas, a ligação ao insumo, as pendências, os
// botões, as frases e a planilha. O caminho com o banco e o pedido criado está na suíte do Mister com Postgres.

const L = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90';
const insumos: InsumoDaLista[] = [
  { id: 'b1', nome: 'Bacon em tiras', unidadeMedida: 'kg', marcas: ['Sadia', 'Seara'] },
  { id: 't1', nome: 'Tomate', unidadeMedida: 'kg', marcas: [] },
  { id: 'c56', nome: 'Carne 56 g', unidadeMedida: 'unidade', marcas: ['Friboi'] },
  { id: 'c120', nome: 'Carne 120 g', unidadeMedida: 'unidade', marcas: [] },
];

describe('as linhas que a pessoa pediu', () => {
  it('lê texto, quantidade e unidade; a linha torta (sem texto, sem quantidade, negativa, enorme) fica de fora', () => {
    expect(
      lerPedidos([
        { texto: ' bacon ', quantidade: 10, unidade: 'kg' },
        { texto: 'tomate', quantidade: '2,5' },
        { texto: '', quantidade: 1 },
        { texto: 'sal', quantidade: 0 },
        { texto: 'açúcar', quantidade: -3 },
        { texto: 'farinha', quantidade: 1e9 },
      ]),
    ).toEqual([
      { texto: 'bacon', quantidade: 10, unidade: 'kg' },
      { texto: 'tomate', quantidade: 2.5, unidade: null },
    ]);
    expect(lerPedidos('não é lista')).toEqual([]);
    expect(lerPedidos(Array.from({ length: 60 }, (_, i) => ({ texto: `item ${i}`, quantidade: 1 })))).toHaveLength(40);
  });
});

describe('a linha ligada ao insumo', () => {
  const conv = new Map();
  it('o nome achado: a marca única já vem; com duas, pergunta a marca; a unidade igual não pergunta nada', () => {
    const bacon = montarLinha({ texto: 'bacon em tiras', quantidade: 10, unidade: 'kg' }, insumos, conv);
    expect(bacon).toMatchObject({ itemId: 'b1', fator: 1, estado: 'marca', marca: null, marcas: ['Sadia', 'Seara'] });
    const carne = montarLinha({ texto: 'carne 56g', quantidade: 100, unidade: 'un' }, insumos, conv);
    expect(carne).toMatchObject({ itemId: 'c56', fator: 1, marca: 'Friboi', estado: 'ligado' }); // "un" = unidade (ERR-544)
  });
  it('a unidade que não chega à do estoque pergunta o fator; sem unidade dita, vale a do estoque', () => {
    expect(montarLinha({ texto: 'tomate', quantidade: 2, unidade: 'caixas' }, insumos, conv)).toMatchObject({ itemId: 't1', fator: null, estado: 'fator' });
    expect(montarLinha({ texto: 'tomate', quantidade: 2, unidade: null }, insumos, conv)).toMatchObject({ itemId: 't1', fator: 1, estado: 'ligado' });
    // a conversão cadastrada do insumo resolve
    const comConv = new Map([['t1', [{ unidadeDe: 'caixa', fator: 20, unidadePara: 'kg' }]]]);
    expect(montarLinha({ texto: 'tomate', quantidade: 2, unidade: 'caixas' }, insumos, comConv as any)).toMatchObject({ fator: 20, estado: 'ligado' });
  });
  it('a dúvida entre dois vira as opções; o que não existe fica sem opção', () => {
    const carne = montarLinha({ texto: 'carne', quantidade: 5, unidade: null }, insumos, conv);
    expect(carne.estado).toBe('item');
    expect(carne.opcoes.map((o) => o.id).sort()).toEqual(['c120', 'c56']);
    expect(montarLinha({ texto: 'guardanapo', quantidade: 5, unidade: null }, insumos, conv)).toMatchObject({ estado: 'item', opcoes: [] });
  });
  it('a pendência segue a ordem das linhas; a quantidade vai ao pedido na unidade do estoque', () => {
    const linhas = [{ estado: 'ligado' }, { estado: 'fora' }, { estado: 'fator' }, { estado: 'item' }] as any;
    expect(proximaPendencia(linhas)).toEqual({ indice: 2, tipo: 'fator' });
    expect(proximaPendencia([{ estado: 'ligado' }, { estado: 'fora' }] as any)).toBeNull();
    expect(quantidadeNoEstoque({ quantidade: 2, fator: 20 })).toBe(40);
    expect(quantidadeNoEstoque({ quantidade: 1.5, fator: null })).toBe(1.5);
  });
  it('ligar depois (a escolha do botão): a marca única vem; o fator que falta continua pedido', () => {
    const base = montarLinha({ texto: 'guardanapo', quantidade: 5, unidade: 'pct' }, insumos, conv);
    expect(ligarAoInsumo(base, { id: 'g', nome: 'Guardanapo', unidadeMedida: 'pacote', marcas: ['Snob'] }, [])).toMatchObject({ itemId: 'g', fator: 1, marca: 'Snob', estado: 'ligado' });
    expect(marcaDoTexto(['Sadia', 'Seara'], 'seara')).toBe('Seara');
    expect(marcaDoTexto(['Sadia', 'Seara'], 'perdigão')).toBeNull();
  });
});

describe('os botões e as frases', () => {
  const linha = (o: Partial<LinhaDaLista>): LinhaDaLista => ({
    texto: 'carne',
    quantidade: 5,
    unidade: null,
    itemId: null,
    itemNome: null,
    unidadeDoEstoque: null,
    fator: null,
    marcas: [],
    marca: null,
    opcoes: [],
    estado: 'item',
    ...o,
  });
  it('cada botão se lê de volta e cabe no limite da Meta; o torto não', () => {
    const p = perguntaDaLinha(L, 3, linha({ opcoes: [{ id: 'c56', nome: 'Carne 56 g' }] }));
    expect(p.botoes.map((b) => b.titulo)).toEqual(['É o Carne 56 g', 'Cadastrar novo', 'Deixar de fora']);
    expect(p.botoes.map((b) => lerBotaoDaLista(b.id))).toEqual([
      { listaId: L, tipo: 'item', indice: 3, escolha: '0' },
      { listaId: L, tipo: 'item', indice: 3, escolha: 'n' },
      { listaId: L, tipo: 'item', indice: 3, escolha: 'f' },
    ]);
    const m = perguntaDaLinha(L, 0, linha({ estado: 'marca', itemNome: 'Bacon em tiras', marcas: ['Sadia', 'Seara', 'Perdigão', 'Aurora'] }));
    expect(m.texto).toBe('O "Bacon em tiras" tem 4 marcas. Qual vai no pedido? Ou responda o nome de outra: Aurora.');
    expect(lerBotaoDaLista(m.botoes[2].id)).toEqual({ listaId: L, tipo: 'marca', indice: 0, k: 2 });
    const f = perguntaDoFornecedor(L, [{ id: 'f1', nome: 'Distribuidora com um nome muito comprido' }, { id: 'f2', nome: 'Hortifruti' }]);
    expect(f.botoes.map((b) => b.titulo)).toEqual(['Distribuidora com u…', 'Hortifruti', 'Sem fornecedor']);
    for (const b of [...p.botoes, ...m.botoes, ...f.botoes]) expect(b.titulo.length).toBeLessThanOrEqual(20);
    expect(lerBotaoDaLista(f.botoes[2].id)).toEqual({ listaId: L, tipo: 'fornecedor', escolha: 'sem' });
    expect(lerBotaoDaLista(`lc:${L}:criar`)).toEqual({ listaId: L, tipo: 'criar' });
    expect(lerBotaoDaLista(`lc:${L}:9:x`)).toBeNull();
    expect(lerBotaoDaLista('lc:nao-e-uuid:criar')).toBeNull();
  });
  it('as perguntas de cada estado: duas opções sem "Cadastrar"; nenhuma; o fator', () => {
    expect(perguntaDaLinha(L, 0, linha({ opcoes: [{ id: 'a', nome: 'Carne 56 g' }, { id: 'b', nome: 'Carne 120 g' }] })).botoes.map((b) => b.titulo)).toEqual([
      'Carne 56 g',
      'Carne 120 g',
      'Deixar de fora',
    ]);
    expect(perguntaDaLinha(L, 0, linha({ texto: 'guardanapo' })).texto).toBe('Não achei "guardanapo" (5) no seu estoque. Cadastro um novo, ou deixo de fora da lista?');
    const fator = perguntaDaLinha(L, 0, linha({ texto: 'tomate', quantidade: 2, unidade: 'caixas', itemNome: 'Tomate', unidadeDoEstoque: 'kg', estado: 'fator' }));
    expect(fator).toEqual({ texto: 'Você pediu 2 caixas de "tomate", e o "Tomate" é contado em kg. 1 caixas tem quantos kg? Responda só o número.', botoes: [] });
  });
  it('o resumo: cada insumo com a quantidade do pedido e a marca, o que fica de fora e o "Criar o pedido"', () => {
    const r = resumoDaLista(
      L,
      [
        linha({ estado: 'ligado', itemId: 'b1', itemNome: 'Bacon em tiras', unidadeDoEstoque: 'kg', quantidade: 10, fator: 1, marca: 'Sadia' }),
        linha({ estado: 'ligado', itemId: 't1', itemNome: 'Tomate', unidadeDoEstoque: 'kg', quantidade: 2, unidade: 'caixas', fator: 20 }),
        linha({ estado: 'fora', texto: 'guardanapo' }),
      ],
      'Distribuidora Sul',
    );
    expect(r.texto).toBe('🛒 Lista de compras · Distribuidora Sul\n• Bacon em tiras, 10 kg (Sadia)\n• Tomate, 40 kg\nFica de fora: guardanapo.\n\nCrio o pedido em Estoque › Pedidos?');
    expect(r.botoes.map((b) => b.titulo)).toEqual(['Criar o pedido', 'Cancelar']);
  });
});

describe('a planilha de compras', () => {
  it('pelo cabeçalho (em qualquer das 5 primeiras linhas), com a unidade', () => {
    const t = [['Pedido da semana'], ['Produto', 'Unidade', 'Qtd'], ['Bacon', 'kg', '10'], ['Tomate', 'cx', '2,5'], ['', '', ''], ['Sal', 'kg', '0']];
    expect(pedidosDaPlanilha(t, false)).toEqual([
      { texto: 'Bacon', quantidade: 10, unidade: 'kg' },
      { texto: 'Tomate', quantidade: 2.5, unidade: 'cx' },
    ]);
  });
  it('o Excel guarda o número com ponto; sem cabeçalho, 1ª coluna o produto e 2ª a quantidade', () => {
    expect(pedidosDaPlanilha([['Descrição', 'Quantidade'], ['Óleo', '1.5']], true)).toEqual([{ texto: 'Óleo', quantidade: 1.5, unidade: null }]);
    expect(pedidosDaPlanilha([['Bacon', '10', 'kg'], ['Tomate', '3', 'kg']], false)).toEqual([
      { texto: 'Bacon', quantidade: 10, unidade: 'kg' },
      { texto: 'Tomate', quantidade: 3, unidade: 'kg' },
    ]);
  });
  it('sem as colunas do produto e da quantidade, nada', () => {
    expect(pedidosDaPlanilha([['Nome', 'Telefone'], ['Ana', 'xx']], false)).toEqual([]);
    expect(pedidosDaPlanilha([], false)).toEqual([]);
  });
});
