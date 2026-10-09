import { escreverCsv, escreverXlsx } from '../../common/escrever-planilha';
import {
  PLANILHA_MAX_LINHAS,
  formatarTexto,
  lerTabela,
  montarPrevia,
  numeroDaCelula,
  tabelaDeExportacao,
} from './produtos-planilha';

// Importação/exportação do cadastro de produtos por planilha — a parte que não toca o banco.
// As planilhas daqui são montadas no teste, com produtos inventados, no MESMO desenho do
// relatório de estoque do Alô Chefia (títulos e texto dentro da célula, sem sharedStrings).

const CAB_ALO_CHEFIA = ['ID', 'Produto', 'Quantidade', 'Unidade', 'Último preço', 'Preço médio', 'Estoque mínimo', 'Categorias', 'Ficha técnica?'];
const ALO_CHEFIA = [
  CAB_ALO_CHEFIA,
  [900001, 'cebolinha de teste', 3, 'und', 5.49, 5.49, 0, 'INSUMO PRODUÇÃO DIURNA', 'Não'],
  [900002, 'queijo de teste peça', 11.6, 'kg', 23.06034483, 23.06034483, 5, 'INSUMO PRODUÇÃO DIURNA, RESFRIADOS', 'Sim'],
  [900003, 'TOMATE DE TESTE', 0.427, 'kg', 12.59, 12.59, 0, 'INSUMOS', 'Não'],
  [900004, 'refri zeta lata 350ml 12 uni', 4, 'pct', 39.9, 39.9, 5, 'BEBIDAS', 'Não'],
  [900005, 'bisnaga de teste', 0, 'bisnaga', 42.19, '', 2, 'INSUMOS', 'Não'],
  [900006, 'Cebolinha de Teste', 1, 'und', 5, 5, 0, 'INSUMOS', 'Não'],
  [900007, 'caixa misteriosa', 2, 'lt', 10, 10, 0.5, '', 'Não'],
];
const NO_REGEM = [
  { id: 'a1', nome: 'Tomate de teste' },
  { id: 'a2', nome: 'Refri Zeta lata 350ml' },
  { id: 'a3', nome: 'Óleo de teste' },
];

const previaDe = (linhas: (string | number | null)[][], existentes = NO_REGEM, categorias = ['Bebidas']) => {
  const { tabela, decimalPonto } = lerTabela(escreverXlsx(linhas), 'estoque_completo.xlsx');
  return montarPrevia(tabela, decimalPonto, existentes, categorias);
};

describe('planilha de produtos — leitura e classificação', () => {
  it('reconhece o relatório do Alô Chefia, ignora o ID e acha cada coluna pelo título', () => {
    const p = previaDe(ALO_CHEFIA);
    expect(p.formato).toBe('alochefia');
    expect(p.colunas).toEqual({
      nome: 'Produto', comercial: null, marcas: null, unidade: 'Unidade', categoria: 'Categorias',
      minimo: 'Estoque mínimo', custo: 'Preço médio', quantidade: 'Quantidade',
    });
    expect(p.linhas).toHaveLength(7);
    expect(p.linhas[0]).toMatchObject({
      linha: 2, nome: 'cebolinha de teste', nomeFormatado: 'Cebolinha de teste',
      unidadeArquivo: 'und', unidade: 'unidade', categoria: 'Insumo produção diurna',
      estoqueMinimo: 0, custo: 5.49, quantidade: 3, situacao: 'novo', existente: null,
    });
  });

  it('separa novo, igual, parecido e repetido — e o resumo fecha com o total', () => {
    const p = previaDe(ALO_CHEFIA);
    const situacao = Object.fromEntries(p.linhas.map((l) => [l.nome, [l.situacao, l.existente?.nome ?? null]]));
    expect(situacao).toEqual({
      'cebolinha de teste': ['novo', null],
      'queijo de teste peça': ['novo', null],
      'TOMATE DE TESTE': ['igual', 'Tomate de teste'], // maiúsculas não fazem produto novo
      'refri zeta lata 350ml 12 uni': ['parecido', 'Refri Zeta lata 350ml'],
      'bisnaga de teste': ['novo', null],
      'Cebolinha de Teste': ['repetido', null], // a 2ª vez dentro do próprio arquivo
      'caixa misteriosa': ['novo', null],
    });
    expect(p.resumo).toEqual({ total: 7, novos: 4, parecidos: 1, iguais: 1, repetidos: 1, semNome: 0 });
    const r = p.resumo;
    expect(r.novos + r.parecidos + r.iguais + r.repetidos).toBe(r.total);
  });

  it('unidades: sugere a da lista, conta os produtos e deixa a ambígua para a pessoa', () => {
    const p = previaDe(ALO_CHEFIA);
    expect(p.unidades).toEqual([
      { noArquivo: 'und', sugestao: 'unidade', produtos: 2 },
      { noArquivo: 'kg', sugestao: 'kg', produtos: 2 },
      { noArquivo: 'pct', sugestao: 'pacote', produtos: 1 },
      { noArquivo: 'bisnaga', sugestao: 'bisnaga', produtos: 1 },
      { noArquivo: 'lt', sugestao: null, produtos: 1 }, // lata ou litro? não chuta
    ]);
    expect(p.linhas.find((l) => l.nome === 'caixa misteriosa')?.unidade).toBeNull();
  });

  it('categorias: usa a 1ª da célula, ajeita a caixa e só lista como nova a que não existe', () => {
    const p = previaDe(ALO_CHEFIA);
    expect(p.linhas[1].categoria).toBe('Insumo produção diurna'); // "INSUMO PRODUÇÃO DIURNA, RESFRIADOS"
    expect(p.linhas[6].categoria).toBe(''); // sem categoria
    expect(p.categoriasNovas).toEqual(['Insumo produção diurna', 'Insumos']); // "Bebidas" já existe
  });

  it('números: o valor cru do Excel (ponto) e a célula vazia', () => {
    const p = previaDe(ALO_CHEFIA);
    expect(p.linhas[1]).toMatchObject({ quantidade: 11.6, custo: 23.060345, estoqueMinimo: 5 });
    expect(p.linhas[4]).toMatchObject({ quantidade: 0, custo: null, estoqueMinimo: 2 }); // sem preço médio
    expect(p.linhas[6].estoqueMinimo).toBe(0.5);
  });

  it('aceita uma linha de título antes do cabeçalho e títulos com outra caixa', () => {
    const p = previaDe([
      ['Relatório de Estoque — Loja de teste'],
      ['NOME DO PRODUTO', 'UNIDADE DE MEDIDA', 'CATEGORIA', 'ESTOQUE MÍNIMO'],
      ['Farinha de teste', 'kg', 'Secos', 10],
    ], []);
    expect(p.formato).toBe('generico');
    expect(p.linhas).toEqual([
      expect.objectContaining({ linha: 3, nome: 'Farinha de teste', unidade: 'kg', categoria: 'Secos', estoqueMinimo: 10, custo: null, quantidade: null, situacao: 'novo' }),
    ]);
  });

  it('linha sem nome é contada à parte; linha toda vazia é ignorada', () => {
    const p = previaDe([['Produto', 'Unidade'], ['', 'kg'], ['', ''], ['Sal de teste', 'kg']], []);
    expect(p.resumo).toMatchObject({ total: 1, semNome: 1 });
    expect(p.linhas[0].linha).toBe(4);
  });

  it('CSV com ponto e vírgula, vírgula decimal, BOM e CRLF', () => {
    const csv = '﻿Produto;Unidade;Estoque mínimo;Custo médio;Saldo\r\nAzeite de teste;gf;1,5;"1.234,56";12\r\n"Molho; da casa";pt;2;7,9;\r\n';
    const { tabela, decimalPonto } = lerTabela(Buffer.from(csv, 'utf8'), 'produtos.csv');
    const p = montarPrevia(tabela, decimalPonto, [], []);
    expect(p.linhas).toEqual([
      expect.objectContaining({ nome: 'Azeite de teste', unidade: 'garrafa', estoqueMinimo: 1.5, custo: 1234.56, quantidade: 12 }),
      expect.objectContaining({ nome: 'Molho; da casa', unidade: 'pote', estoqueMinimo: 2, custo: 7.9, quantidade: null }),
    ]);
  });

  it('CSV em Latin-1 (acentos) e CSV separado por vírgula', () => {
    const latin = Buffer.from('Produto;Unidade\nAçúcar de teste;sc\n', 'latin1');
    const a = lerTabela(latin, 'a.csv');
    expect(montarPrevia(a.tabela, a.decimalPonto, [], []).linhas[0]).toMatchObject({ nome: 'Açúcar de teste', unidade: 'saco' });
    const b = lerTabela(Buffer.from('nome,unidade,estoque\n"Pão, de teste",un,3\n', 'utf8'), 'b.csv');
    expect(montarPrevia(b.tabela, b.decimalPonto, [], []).linhas[0]).toMatchObject({ nome: 'Pão, de teste', unidade: 'unidade', quantidade: 3 });
  });

  it('recusa com a frase que explica: sem coluna de nome, sem produto, formato que não lê, arquivo grande demais', () => {
    expect(() => previaDe([['Código', 'Valor'], ['1', '2']])).toThrow(/coluna com o nome do produto/);
    expect(() => previaDe([['Produto', 'Unidade']])).toThrow(/nenhum produto/);
    expect(() => lerTabela(Buffer.from('%PDF-1.7'), 'estoque.pdf')).toThrow(/Excel \(\.xlsx\) ou CSV/);
    expect(() => lerTabela(Buffer.from('qualquer'), 'estoque.xls')).toThrow(/Excel \(\.xlsx\) ou CSV/);
    const grande = [['Produto'], ...Array.from({ length: PLANILHA_MAX_LINHAS + 1 }, (_, i) => [`Produto ${i}`])];
    expect(() => previaDe(grande, [])).toThrow(/limite por importação/);
  });

  it('numeroDaCelula: formatos do Excel e do CSV brasileiro', () => {
    expect(numeroDaCelula('23.06034483', true)).toBe(23.060345);
    expect(numeroDaCelula('1.2E-2', true)).toBe(0.012);
    expect(numeroDaCelula('0,5', true)).toBe(0.5); // Excel salvo como texto com vírgula
    expect(numeroDaCelula('R$ 5,49', false)).toBe(5.49);
    expect(numeroDaCelula('1.234,56', false)).toBe(1234.56);
    expect(numeroDaCelula('1.500', false)).toBe(1500);
    expect(numeroDaCelula('23.06', false)).toBe(23.06);
    expect(numeroDaCelula('3 pote', false)).toBe(3);
    expect(numeroDaCelula('', false)).toBeNull();
    expect(numeroDaCelula('sem estoque', false)).toBeNull();
    expect(numeroDaCelula(undefined, true)).toBeNull();
  });

  it('formatarTexto: só mexe no que veio todo em maiúsculas ou todo em minúsculas', () => {
    expect(formatarTexto('CALDAS E COBERTURAS')).toBe('Caldas e coberturas');
    expect(formatarTexto('queijo de teste peça kg')).toBe('Queijo de teste peça kg');
    expect(formatarTexto('Zeta-Cola Zero')).toBe('Zeta-Cola Zero');
    expect(formatarTexto('lEGUMINOSA')).toBe('Leguminosa'); // Caps Lock invertido
    expect(formatarTexto('Pão de Queijo')).toBe('Pão de Queijo');
    expect(formatarTexto('  molho   1,3k ')).toBe('Molho 1,3k');
    expect(formatarTexto('350')).toBe('350');
    expect(formatarTexto('')).toBe('');
  });
});

describe('planilha de produtos — exportação', () => {
  const ITENS = [
    {
      id: 'i1', nome: 'Refri Zeta lata 350 ml', categoriaNome: 'Bebidas', unidadeMedida: 'fardo', estoqueMinimo: '5', saldo: '3',
      custoMedio: 39.9, valorEstoque: 119.7, fornecedorNomes: ['Atacado de teste', 'Distribuidora de teste'], setorNomes: ['Depósito', 'Bar'],
      conversoes: [{ unidadeDe: 'fardo', fator: 12, unidadePara: 'unidade' }], validadeAbertoDias: null,
    },
    {
      id: 'i2', nome: 'Queijo de teste', categoriaNome: null, unidadeMedida: 'kg', estoqueMinimo: '5.000', saldo: '11.6',
      custoMedio: 23.060345, valorEstoque: 267.5, fornecedorNomes: [], setorNomes: [],
      conversoes: [{ unidadeDe: 'peça', fator: 2.5, unidadePara: 'kg' }], validadeAbertoDias: 3,
    },
  ];

  it('com financeiro: custo e valor entram; sem financeiro: as colunas nem existem', () => {
    const com = tabelaDeExportacao(ITENS, true);
    expect(com.linhas[0]).toEqual(['Produto', 'Nome comercial', 'Marcas', 'Categoria', 'Unidade', 'Estoque mínimo', 'Saldo', 'Custo médio', 'Valor em estoque', 'Fornecedores', 'Setores', 'Conversões', 'Validade após aberto (dias)']);
    expect(com.linhas[1]).toEqual(['Refri Zeta lata 350 ml', '', '', 'Bebidas', 'fardo', 5, 3, 39.9, 119.7, 'Atacado de teste, Distribuidora de teste', 'Depósito, Bar', '1 fardo = 12 unidade', null]);
    expect(com.linhas[2]).toEqual(['Queijo de teste', '', '', '', 'kg', 5, 11.6, 23.0603, 267.5, '', '', '1 peça = 2,5 kg', 3]);
    expect(com.larguras).toHaveLength(com.linhas[0].length);

    const sem = tabelaDeExportacao(ITENS.map((i) => ({ ...i, custoMedio: null, valorEstoque: null })), false);
    expect(sem.linhas[0]).not.toContain('Custo médio');
    expect(sem.linhas[0]).not.toContain('Valor em estoque');
    expect(sem.linhas[1]).toHaveLength(sem.linhas[0].length);
    expect(sem.larguras).toHaveLength(sem.linhas[0].length);
  });

  it('o arquivo exportado entra de volta: Excel e CSV, com unidade, mínimo, saldo e custo', () => {
    const { linhas } = tabelaDeExportacao(ITENS, true);
    for (const [nome, arquivo] of [['p.xlsx', escreverXlsx(linhas)], ['p.csv', escreverCsv(linhas)]] as [string, Buffer][]) {
      const { tabela, decimalPonto } = lerTabela(arquivo, nome);
      const p = montarPrevia(tabela, decimalPonto, [], ['Bebidas']);
      expect([nome, p.formato]).toEqual([nome, 'regem']);
      expect(p.linhas).toEqual([
        expect.objectContaining({ nome: 'Refri Zeta lata 350 ml', unidade: 'fardo', categoria: 'Bebidas', estoqueMinimo: 5, quantidade: 3, custo: 39.9, situacao: 'novo' }),
        expect.objectContaining({ nome: 'Queijo de teste', unidade: 'kg', categoria: '', estoqueMinimo: 5, quantidade: 11.6, custo: 23.0603, situacao: 'novo' }),
      ]);
      expect(p.categoriasNovas).toEqual([]);
    }
  });

  it('reimportar na mesma empresa não traz nada de novo: tudo "igual"', () => {
    const { linhas } = tabelaDeExportacao(ITENS, false);
    const { tabela, decimalPonto } = lerTabela(escreverXlsx(linhas), 'p.xlsx');
    const p = montarPrevia(tabela, decimalPonto, ITENS.map((i) => ({ id: i.id, nome: i.nome })), []);
    expect(p.resumo).toMatchObject({ total: 2, iguais: 2, novos: 0, parecidos: 0 });
  });
});
