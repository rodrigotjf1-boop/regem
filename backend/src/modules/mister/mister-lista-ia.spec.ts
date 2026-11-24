import type { LinhaDaLista } from './mister-lista';
import { juntarLinhas, lerAlteracoesDaLista, lerBotaoDasSugestoes, listaPelaIa, perguntasJuntas } from './mister-lista-ia';

// Versão 9, O4: a lista de compras pela IA e pela conversa.

const ID = '0f5e8a2c-1d3b-4c5d-9e6f-7a8b9c0d1e2f';
const linha = (o: Partial<LinhaDaLista>): LinhaDaLista => ({
  texto: 'x',
  quantidade: 1,
  unidade: 'kg',
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

describe('a lista pela IA (O4)', () => {
  it('as dúvidas juntas, cada uma com o número da linha, e os botões', () => {
    const linhas = [
      linha({ texto: 'batata', estado: 'ligado', itemId: 'b', itemNome: 'Batata', pelaIa: true }),
      linha({ texto: 'molho 1,5', quantidade: 2, unidade: 'un', propostaDaIa: true, opcoes: [{ id: 'c', nome: 'Cheddar cremoso' }, { id: 's', nome: 'Molho Shoyo' }] }),
      linha({ texto: 'bacon', estado: 'marca', itemId: 'bc', itemNome: 'Bacon em tiras', marcas: ['Sadia', 'Seara'] }),
      linha({ texto: 'coisa nova', quantidade: 1, unidade: null, nomeNovo: 'Coisa nova' }),
    ];
    expect(listaPelaIa(linhas)).toBe(true);
    const p = perguntasJuntas(ID, linhas);
    expect(p.texto).toContain('Liguei 1 de 4 linhas ao seu estoque. 3 precisam de você');
    expect(p.texto).toContain('Linha 2 · "molho 1,5" (2 un): é o *Cheddar cremoso*? Ou o Molho Shoyo?');
    expect(p.texto).toContain('Linha 3 · "bacon" (1 kg): o Bacon em tiras tem as marcas Sadia, Seara. Qual vai?');
    expect(p.texto).toContain('Linha 4 · "coisa nova" (1): não achei no estoque. Cadastro *Coisa nova*');
    expect(p.texto).toContain('Nada foi pedido.');
    expect(p.botoes.map((b) => b.titulo)).toEqual(['Aceitar as sugestões', 'Cancelar']);
    expect(lerBotaoDasSugestoes(p.botoes[0].id)).toBe(ID);
    // Sem nenhuma proposta, só o "Cancelar".
    expect(perguntasJuntas(ID, [linhas[3]]).botoes.map((b) => b.titulo)).toEqual(['Cancelar']);
    expect(listaPelaIa([linha({})])).toBe(false);
  });

  it('o botão só lê o próprio formato', () => {
    expect(lerBotaoDasSugestoes(`lc:${ID}:ia`)).toBe(ID);
    expect(lerBotaoDasSugestoes(`lc:${ID}:criar`)).toBeNull();
    expect(lerBotaoDasSugestoes(`doc:ia:${ID}`)).toBeNull();
  });

  it('as mudanças pela conversa, conferidas antes de gravar', () => {
    expect(
      lerAlteracoesDaLista([
        { linha: 3, tipo: 'ligar', insumo: 'Cheddar cremoso' },
        { linha: 5, tipo: 'quantidade', quantidade: 20, medida: 'pacotes' },
        { linha: 7, tipo: 'fora' },
        { linha: 9, tipo: 'cadastrar' },
        { linha: 2, tipo: 'marca', marca: 'Sadia' },
        { linha: 4, tipo: 'conversao', quanto_no_estoque: 12 },
      ]),
    ).toEqual({
      alteracoes: [
        { linha: 3, tipo: 'ligar', insumo: 'Cheddar cremoso' },
        { linha: 5, tipo: 'quantidade', quantidade: 20, medida: 'pacote' },
        { linha: 7, tipo: 'fora' },
        { linha: 9, tipo: 'cadastrar', nome: null, medida: null },
        { linha: 2, tipo: 'marca', marca: 'Sadia' },
        { linha: 4, tipo: 'conversao', quantoNoEstoque: 12 },
      ],
    });
    for (const ruim of [[], [{ tipo: 'fora' }], [{ linha: 1, tipo: 'quantidade', quantidade: -2 }], [{ linha: 1, tipo: 'quantidade', quantidade: 2, medida: 'xpto' }], [{ linha: 1, tipo: 'cadastrar', nome: 'confirmado' }], [{ linha: 1, tipo: 'apagar' }]])
      expect(lerAlteracoesDaLista(ruim)).toHaveProperty('erro');
  });
});

describe('24/11: o pedido com o abaixo do mínimo e os itens ditos; adicionar na lista aberta', () => {
  it('"adicionar" não tem linha: o produto como a pessoa disse, a quantidade e a medida, conferidos', () => {
    expect(lerAlteracoesDaLista([{ tipo: 'adicionar', texto: ' hambúrguer  56 g ', quantidade: 50 }, { tipo: 'adicionar', texto: 'batata 7mm', quantidade: 30, medida: 'caixas' }])).toEqual({
      alteracoes: [
        { linha: 0, tipo: 'adicionar', texto: 'hambúrguer 56 g', quantidade: 50, medida: null },
        { linha: 0, tipo: 'adicionar', texto: 'batata 7mm', quantidade: 30, medida: 'caixa' },
      ],
    });
    for (const ruim of [
      [{ tipo: 'adicionar', texto: '50', quantidade: 50 }],
      [{ tipo: 'adicionar', texto: 'batata', quantidade: 0 }],
      [{ tipo: 'adicionar', texto: 'batata', quantidade: '30' }],
      [{ tipo: 'adicionar', texto: 'batata', quantidade: 3, medida: 'xpto' }],
      [{ tipo: 'adicionar', texto: 'pode adicionar', quantidade: 3 }],
    ])
      expect(lerAlteracoesDaLista(ruim)).toHaveProperty('erro');
  });

  it('juntar: o insumo que já está na lista fica com a quantidade dita; o novo entra no fim; a linha que saiu não conta', () => {
    const tomate = linha({ texto: 'Tomate', quantidade: 20, unidade: null, itemId: 'i-tomate', itemNome: 'Tomate', unidadeDoEstoque: 'kg', fator: 1, estado: 'ligado' });
    const cebola = linha({ texto: 'Cebola', quantidade: 5, itemId: 'i-cebola', itemNome: 'Cebola', unidadeDoEstoque: 'kg', fator: 1, estado: 'fora' });
    const tomate50 = linha({ texto: 'tomate', quantidade: 50, itemId: 'i-tomate', itemNome: 'Tomate', unidadeDoEstoque: 'kg', fator: 1, estado: 'ligado' });
    const cebola3 = linha({ texto: 'cebola', quantidade: 3, itemId: 'i-cebola', itemNome: 'Cebola', unidadeDoEstoque: 'kg', fator: 1, estado: 'ligado' });
    const novo = linha({ texto: 'coisa nova', quantidade: 2, unidade: null });
    const r = juntarLinhas([tomate, cebola], [tomate50, cebola3, novo]);
    expect(r.linhas.map((l) => [l.texto, l.quantidade, l.estado])).toEqual([
      ['tomate', 50, 'ligado'],
      ['Cebola', 5, 'fora'],
      ['cebola', 3, 'ligado'],
      ['coisa nova', 2, 'item'],
    ]);
    expect(r.feito).toEqual(['Linha 1 (Tomate): agora 50 kg.', 'Entrou na linha 3: "cebola" (3 kg) → Cebola.', 'Entrou na linha 4: "coisa nova" (2), com uma pergunta.']);
  });
});
