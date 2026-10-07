import { lerXlsx } from '../cliente/ler-xlsx';
import { chaveNome, limparNome, maisParecido } from './produto-nome';
import { normalizarUnidade, type UnidadeEstoque } from './unidades';

// Importação e exportação do cadastro de produtos do estoque por planilha (Excel .xlsx ou CSV).
// Aqui fica só o que não toca o banco: ler o arquivo, achar as colunas pelo TÍTULO e dizer, para
// cada linha, se o produto é novo, se já existe ou se parece com um que existe. O serviço usa
// isto na prévia (nada é gravado) e grava depois, com o que a pessoa conferiu.
//
// Formatos reconhecidos pelo cabeçalho: o relatório de estoque do Alô Chefia (Produto,
// Quantidade, Unidade, Último preço, Preço médio, Estoque mínimo, Categorias), a exportação do
// próprio Regem e qualquer planilha que tenha ao menos uma coluna de nome. A coluna ID e as
// demais que o Regem não usa são ignoradas.

/* eslint-disable @typescript-eslint/no-explicit-any */
export const PLANILHA_MAX_LINHAS = 2000;

export type Formato = 'alochefia' | 'regem' | 'generico';
export type Situacao = 'novo' | 'igual' | 'parecido' | 'repetido';

export type LinhaProduto = {
  /** Linha no arquivo (1 = primeira), para a pessoa achar. */
  linha: number;
  nome: string;
  /** Nome com a primeira letra maiúscula, quando veio todo em maiúsculas ou todo em minúsculas. */
  nomeFormatado: string;
  unidadeArquivo: string;
  /** Unidade da lista do Regem que corresponde; `null` = a pessoa escolhe. */
  unidade: UnidadeEstoque | null;
  /** Primeira categoria da célula (a planilha pode trazer várias, separadas por vírgula). */
  categoria: string;
  estoqueMinimo: number | null;
  custo: number | null;
  quantidade: number | null;
  situacao: Situacao;
  /** Produto do Regem igual ou parecido (situação `igual`/`parecido`). */
  existente: { id: string; nome: string } | null;
};

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// Títulos aceitos por coluna, em ordem de preferência (o primeiro que existir no arquivo vale).
const TITULOS: Record<'nome' | 'unidade' | 'categoria' | 'minimo' | 'custo' | 'quantidade', string[]> = {
  nome: ['produto', 'nome do produto', 'nome', 'insumo', 'item', 'descricao'],
  unidade: ['unidade', 'unidade de medida', 'unidade principal', 'medida', 'und', 'unid', 'un'],
  categoria: ['categoria', 'categorias', 'grupo'],
  minimo: ['estoque minimo', 'minimo', 'estoque min', 'est minimo'],
  custo: ['preco medio', 'custo medio', 'custo', 'preco de custo', 'ultimo preco', 'valor unitario'],
  quantidade: ['quantidade', 'saldo', 'estoque atual', 'estoque', 'qtd', 'qtde'],
};

/** Texto do arquivo → tabela. Excel (.xlsx) ou CSV (vírgula, ponto e vírgula ou tabulação). */
export function lerTabela(buffer: Buffer, nomeArquivo = ''): { tabela: string[][]; decimalPonto: boolean } {
  const nome = nomeArquivo.toLowerCase();
  if (/\.(xls|pdf|ods|numbers)$/.test(nome) || buffer.subarray(0, 4).toString('latin1') === '%PDF')
    throw new Error('Envie em Excel (.xlsx) ou CSV. O .xls antigo e o PDF não dá para ler com segurança.');
  if (buffer.subarray(0, 2).toString('latin1') === 'PK') return { tabela: lerXlsx(buffer), decimalPonto: true };
  // CSV: UTF-8 por padrão; em Latin-1/Windows-1252 (acentos viram �), relê assim.
  let texto = buffer.toString('utf8');
  if (texto.includes('�')) texto = buffer.toString('latin1');
  texto = texto.replace(/^﻿/, '');
  const linhas = linhasCsv(texto);
  if (!linhas.length) return { tabela: [], decimalPonto: false };
  // Separador: o que mais aparece na 1ª linha, fora de aspas.
  const sep = [';', '\t', ','].map((s) => ({ s, n: dividirCsv(linhas[0], s).length })).sort((a, b) => b.n - a.n)[0].s;
  return { tabela: linhas.map((l) => dividirCsv(l, sep)), decimalPonto: false };
}

// Quebra em linhas sem cortar campo entre aspas que contenha quebra (e aceita CRLF, CR e LF).
function linhasCsv(texto: string): string[] {
  const out: string[] = [];
  let cur = '';
  let aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (ch === '"') aspas = !aspas;
    if (!aspas && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.filter((l) => l.trim() !== '');
}

function dividirCsv(linha: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let aspas = false;
  for (let i = 0; i < linha.length; i++) {
    const ch = linha[i];
    if (aspas) {
      if (ch === '"' && linha[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') aspas = false;
      else cur += ch;
    } else if (ch === '"') aspas = true;
    else if (ch === sep) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

/** Número de uma célula. No Excel o valor cru usa ponto; no CSV brasileiro, vírgula. */
export function numeroDaCelula(texto: string | undefined, decimalPonto: boolean): number | null {
  // Só o primeiro número da célula ("3 pote" → 3; "R$ 5,49" → 5,49; "1.2E-2" do Excel).
  const m = String(texto ?? '').match(/-?\d[\d.,]*(?:[eE][+-]?\d+)?/);
  if (!m) return null;
  let t = m[0].replace(/[.,]+$/, '');
  if (!decimalPonto) {
    if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); // 1.234,56 → 1234.56
    else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ''); // 1.234 → 1234
  } else if (t.includes(',') && !t.includes('.')) t = t.replace(',', '.');
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 1e6) / 1e6 : null;
}

/** "CALDAS E COBERTURAS" → "Caldas e coberturas"; nome com maiúsculas no meio fica como está. */
export function formatarTexto(texto: string): string {
  const t = limparNome(texto);
  if (!t) return '';
  const letras = t.replace(/[^\p{L}]/gu, '');
  if (!letras) return t;
  // Tudo maiúsculo, tudo minúsculo ou o Caps Lock invertido ("lEGUMINOSA").
  const resto = letras.slice(1);
  const todoIgual =
    letras === letras.toUpperCase() ||
    letras === letras.toLowerCase() ||
    (resto.length > 1 && resto === resto.toUpperCase());
  if (!todoIgual) return t;
  const baixo = t.toLowerCase();
  return baixo.charAt(0).toUpperCase() + baixo.slice(1);
}

export type PreviaPlanilha = {
  formato: Formato;
  /** Título, no arquivo, da coluna usada para cada dado (`null` = o arquivo não tem). */
  colunas: Record<keyof typeof TITULOS, string | null>;
  linhas: LinhaProduto[];
  /** Unidades do arquivo, com a sugestão e quantos produtos usam cada uma. */
  unidades: { noArquivo: string; sugestao: UnidadeEstoque | null; produtos: number }[];
  /** Categorias do arquivo que ainda não existem no Regem. */
  categoriasNovas: string[];
  resumo: { total: number; novos: number; parecidos: number; iguais: number; repetidos: number; semNome: number };
};

/**
 * Lê a tabela e classifica cada produto frente ao que já existe. `existentes` = produtos ativos
 * que a pessoa enxerga; `categorias` = nomes das categorias já cadastradas.
 */
export function montarPrevia(
  tabela: string[][],
  decimalPonto: boolean,
  existentes: { id: string; nome: string }[],
  categorias: string[],
): PreviaPlanilha {
  // Cabeçalho: a primeira das 10 primeiras linhas que tem uma coluna de nome (relatório pode
  // trazer um título antes).
  let iCab = -1;
  let cab: string[] = [];
  for (let i = 0; i < Math.min(tabela.length, 10); i++) {
    const titulos = tabela[i].map(semAcento);
    if (TITULOS.nome.some((t) => titulos.includes(t))) { iCab = i; cab = titulos; break; }
  }
  if (iCab < 0)
    throw new Error(
      'Não achei a coluna com o nome do produto. A primeira linha da planilha precisa ter os títulos — por exemplo: Produto, Unidade, Categoria, Estoque mínimo.',
    );
  const achar = (chave: keyof typeof TITULOS) => {
    for (const t of TITULOS[chave]) { const i = cab.indexOf(t); if (i >= 0) return i; }
    return -1;
  };
  const idx = {
    nome: achar('nome'), unidade: achar('unidade'), categoria: achar('categoria'),
    minimo: achar('minimo'), custo: achar('custo'), quantidade: achar('quantidade'),
  };
  const titulo = (i: number) => (i >= 0 ? (tabela[iCab][i] ?? '').trim() : null);
  const tem = (t: string) => cab.includes(t);
  const formato: Formato =
    tem('produto') && tem('preco medio') && tem('ultimo preco') && tem('categorias')
      ? 'alochefia'
      : tem('produto') && tem('fornecedores') && tem('setores')
        ? 'regem'
        : 'generico';

  const dados = tabela.slice(iCab + 1);
  if (dados.length > PLANILHA_MAX_LINHAS)
    throw new Error(`A planilha tem ${dados.length} linhas; o limite por importação é ${PLANILHA_MAX_LINHAS}. Divida o arquivo.`);

  const porChave = new Map(existentes.map((e) => [chaveNome(e.nome), e]));
  const categoriasExistentes = new Set(categorias.map(chaveNome));
  const vistos = new Set<string>();
  const linhas: LinhaProduto[] = [];
  const contUnidade = new Map<string, number>();
  const novasCategorias = new Map<string, string>();
  let semNome = 0;

  dados.forEach((l, i) => {
    const cel = (j: number) => (j >= 0 ? (l[j] ?? '').trim() : '');
    const nome = limparNome(cel(idx.nome));
    if (!nome) {
      if (l.some((c) => (c ?? '').trim() !== '')) semNome++;
      return;
    }
    const unidadeArquivo = cel(idx.unidade);
    const categoria = formatarTexto(cel(idx.categoria).split(',').map((c) => c.trim()).find(Boolean) ?? '');
    const chave = chaveNome(nome);
    let situacao: Situacao = 'novo';
    let existente: LinhaProduto['existente'] = null;
    const igual = porChave.get(chave);
    if (igual) { situacao = 'igual'; existente = { id: igual.id, nome: igual.nome }; }
    else if (vistos.has(chave)) situacao = 'repetido';
    else {
      const parecido = maisParecido(nome, existentes);
      if (parecido) { situacao = 'parecido'; existente = { id: parecido.id, nome: parecido.nome }; }
    }
    vistos.add(chave);
    contUnidade.set(unidadeArquivo, (contUnidade.get(unidadeArquivo) ?? 0) + 1);
    if (categoria && !categoriasExistentes.has(chaveNome(categoria)) && !novasCategorias.has(chaveNome(categoria)))
      novasCategorias.set(chaveNome(categoria), categoria);
    linhas.push({
      linha: iCab + 2 + i,
      nome,
      nomeFormatado: formatarTexto(nome),
      unidadeArquivo,
      unidade: normalizarUnidade(unidadeArquivo),
      categoria,
      estoqueMinimo: numeroDaCelula(cel(idx.minimo), decimalPonto),
      custo: numeroDaCelula(cel(idx.custo), decimalPonto),
      quantidade: numeroDaCelula(cel(idx.quantidade), decimalPonto),
      situacao,
      existente,
    });
  });
  // Arquivo que não rendeu produto nenhum é erro, não "vazio" (LIC-092).
  if (!linhas.length) throw new Error('A planilha não tem nenhum produto abaixo da linha de títulos.');

  const conta = (s: Situacao) => linhas.filter((x) => x.situacao === s).length;
  return {
    formato,
    colunas: {
      nome: titulo(idx.nome), unidade: titulo(idx.unidade), categoria: titulo(idx.categoria),
      minimo: titulo(idx.minimo), custo: titulo(idx.custo), quantidade: titulo(idx.quantidade),
    },
    linhas,
    unidades: [...contUnidade.entries()]
      .map(([noArquivo, produtos]) => ({ noArquivo, sugestao: normalizarUnidade(noArquivo), produtos }))
      .sort((a, b) => b.produtos - a.produtos),
    categoriasNovas: [...novasCategorias.values()].sort((a, b) => a.localeCompare(b, 'pt-BR')),
    resumo: {
      total: linhas.length,
      novos: conta('novo'),
      parecidos: conta('parecido'),
      iguais: conta('igual'),
      repetidos: conta('repetido'),
      semNome,
    },
  };
}

// ── Exportação ────────────────────────────────────────────────────────────────────────────
// Os títulos são os mesmos que a importação reconhece: o arquivo exportado entra de volta.
export function tabelaDeExportacao(itens: any[], verFinanceiro: boolean): { linhas: (string | number | null)[][]; larguras: number[] } {
  const cab = ['Produto', 'Categoria', 'Unidade', 'Estoque mínimo', 'Saldo'];
  const larguras = [38, 24, 12, 16, 12];
  if (verFinanceiro) { cab.push('Custo médio', 'Valor em estoque'); larguras.push(14, 18); }
  cab.push('Fornecedores', 'Setores', 'Conversões', 'Validade após aberto (dias)');
  larguras.push(34, 26, 30, 26);
  const n = (v: unknown) => (v === null || v === undefined || v === '' ? null : Math.round(Number(v) * 1e4) / 1e4);
  const linhas: (string | number | null)[][] = [cab];
  for (const i of itens) {
    const l: (string | number | null)[] = [
      i.nome, i.categoriaNome ?? '', i.unidadeLista ?? i.unidadeMedida, n(i.estoqueMinimo), n(i.saldo),
    ];
    if (verFinanceiro) l.push(n(i.custoMedio), n(i.valorEstoque));
    l.push(
      (i.fornecedorNomes ?? []).join(', '),
      (i.setorNomes ?? []).join(', '),
      (i.conversoes ?? [])
        .map((c: any) => `1 ${c.unidadeDeLista ?? c.unidadeDe} = ${String(c.fator).replace('.', ',')} ${c.unidadeParaLista ?? c.unidadePara}`)
        .join('; '),
      i.validadeAbertoDias ?? null,
    );
    linhas.push(l);
  }
  return { linhas, larguras };
}
