import type { LinhaDaLista } from './mister-lista';
import { lerAlteracoesDaLista, lerBotaoDasSugestoes, listaPelaIa, perguntasJuntas } from './mister-lista-ia';

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
