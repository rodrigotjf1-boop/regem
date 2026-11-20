import { Conversao, fatorParaEstoque } from '../../common/conversao-unidade';
import { InsumoParaSugerir, numeroDoTexto, sugerirInsumos } from '../../common/nota-por-foto';
import { acharMarca, limparNome } from '../estoque/produto-nome';
import { normalizarUnidade } from '../estoque/unidades';
import { acharInsumo } from './insumo-vendido';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A LISTA DE COMPRAS PELA CONVERSA (versão 6, M6g; plano aprovado em 20/11/2026, `docs/plano-mister.md` § "Versão 6",
// Frente C; protótipo `mockups/regem-mister-v6.html`, "Ações e apresentação"; mig 475). Só o que é puro: as linhas como a
// pessoa pediu, a ligação de cada uma a um insumo (o mesmo achador do relatório por insumo — o nome igual, as palavras, a
// medida "56 g"), o que falta responder (o insumo, a unidade, a marca), os botões, as frases e a leitura da planilha. Quem
// grava, pergunta e cria o pedido (pelo MESMO `ComprasService.createLista` da tela) é o `MisterListaService`.

export const MAX_LINHAS_DA_LISTA = 40;
/** A lista pela metade some da conversa depois disto (a coluna `vence_em` da mig 475). */
export const LISTA_VALE_H = 24;

export type EstadoDaLinha = 'ligado' | 'item' | 'fator' | 'marca' | 'fora';

/** O que a pessoa pediu numa linha: o produto como ela disse, a quantidade e a unidade (se disse). */
export interface PedidoDaLinha {
  texto: string;
  quantidade: number;
  unidade: string | null;
}

export interface LinhaDaLista extends PedidoDaLinha {
  itemId: string | null;
  itemNome: string | null;
  unidadeDoEstoque: string | null;
  /** Quantas unidades do estoque vale 1 unidade pedida (1 quando a pessoa não disse a unidade, ou é a mesma). */
  fator: number | null;
  /** As marcas cadastradas do insumo (a lista exige uma quando há duas ou mais). */
  marcas: string[];
  marca: string | null;
  /** Os insumos parecidos para escolher (até 2 nos botões). */
  opcoes: { id: string; nome: string }[];
  estado: EstadoDaLinha;
}

export interface InsumoDaLista extends InsumoParaSugerir {
  unidadeMedida: string;
  marcas: string[];
}

const texto = (v: unknown, max = 120): string => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max);

/** A unidade como veio ("UN", "caixas", "kg") pela lista de apelidos do estoque, antes de converter (ERR-544). */
const unidadeImpressa = (u: string | null): string | null => (u ? (normalizarUnidade(u) ?? u) : null);

/**
 * As linhas que a IA mandou (a ferramenta) ou que a planilha trouxe: o texto (1 a 120 letras), a quantidade (positiva, até
 * 100 mil — o número fora disso não vira pedido) e a unidade. Linha torta fica de fora; até 40.
 */
export function lerPedidos(itens: unknown): PedidoDaLinha[] {
  if (!Array.isArray(itens)) return [];
  const fora: PedidoDaLinha[] = [];
  for (const x of itens) {
    const t = texto(x?.texto);
    const q = typeof x?.quantidade === 'number' ? x.quantidade : numeroDoTexto(x?.quantidade);
    if (!t || q == null || !Number.isFinite(q) || q <= 0 || q > 100_000) continue;
    const u = texto(x?.unidade, 20) || null;
    fora.push({ texto: t, quantidade: Math.round(q * 1000) / 1000, unidade: u });
    if (fora.length >= MAX_LINHAS_DA_LISTA) break;
  }
  return fora;
}

/** Liga a linha ao insumo: a conversão da unidade pedida, a marca (a única, ou a pergunta) e o estado. */
export function ligarAoInsumo(l: LinhaDaLista, insumo: InsumoDaLista, conversoes: Conversao[]): LinhaDaLista {
  const fator = l.unidade ? fatorParaEstoque(unidadeImpressa(l.unidade), insumo.unidadeMedida, conversoes) : 1;
  const marcas = Array.isArray(insumo.marcas) ? insumo.marcas.filter(Boolean) : [];
  const marca = marcas.length === 1 ? marcas[0] : null;
  return {
    ...l,
    itemId: insumo.id,
    itemNome: insumo.nome,
    unidadeDoEstoque: insumo.unidadeMedida,
    fator,
    marcas,
    marca,
    opcoes: [],
    estado: fator == null ? 'fator' : marcas.length >= 2 ? 'marca' : 'ligado',
  };
}

/** A linha nova: o insumo achado (ligada), as opções (escolher) ou nenhum (cadastrar ou deixar de fora). */
export function montarLinha(p: PedidoDaLinha, insumos: InsumoDaLista[], conversoes: Map<string, Conversao[]>): LinhaDaLista {
  const base: LinhaDaLista = { ...p, itemId: null, itemNome: null, unidadeDoEstoque: null, fator: null, marcas: [], marca: null, opcoes: [], estado: 'item' };
  const achado = acharInsumo(p.texto, insumos);
  if (achado.tipo === 'achou') {
    const insumo = insumos.find((i) => i.id === achado.id)!;
    return ligarAoInsumo(base, insumo, conversoes.get(insumo.id) ?? []);
  }
  if (achado.tipo === 'escolher') {
    const opcoes = achado.opcoes
      .map((nome) => insumos.find((i) => i.nome === nome))
      .filter((i): i is InsumoDaLista => !!i)
      .slice(0, 2)
      .map((i) => ({ id: i.id, nome: i.nome }));
    return { ...base, opcoes };
  }
  // Nada claro: a melhor sugestão (se houver) vira a opção — a pessoa confirma.
  const sug = sugerirInsumos(p.texto, insumos)[0];
  return { ...base, opcoes: sug ? [{ id: sug.id, nome: sug.nome }] : [] };
}

/** A próxima pergunta (na ordem das linhas), ou null quando tudo está respondido. */
export function proximaPendencia(linhas: Pick<LinhaDaLista, 'estado'>[]): { indice: number; tipo: 'item' | 'fator' | 'marca' } | null {
  const i = linhas.findIndex((l) => l.estado === 'item' || l.estado === 'fator' || l.estado === 'marca');
  return i < 0 ? null : { indice: i, tipo: linhas[i].estado as 'item' | 'fator' | 'marca' };
}

/** A quantidade na unidade do estoque (a que vai ao pedido), com 3 casas. */
export const quantidadeNoEstoque = (l: Pick<LinhaDaLista, 'quantidade' | 'fator'>): number => Math.round(l.quantidade * (l.fator ?? 1) * 1000) / 1000;

/** A marca que a pessoa escreveu, entre as cadastradas (o mesmo achador do pedido da tela). Não achou: null. */
export function marcaDoTexto(marcas: string[], escrito: unknown): string | null {
  const t = limparNome(String(escrito ?? ''));
  return t ? (acharMarca(marcas, t) ?? null) : null;
}

// ───────────────────────────── os botões ─────────────────────────────
// `lc:<lista>:<linha>:<0|1 = opção | n = cadastrar novo | f = deixar de fora>` · `lc:<lista>:<linha>:m<0..2>` (a marca) ·
// `lc:<lista>:fo:<0|1|s>` (o fornecedor, ou sem) · `lc:<lista>:criar` · `lc:<lista>:cancelar`.

export const PREFIXO_DA_LISTA = 'lc:';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

export type BotaoDaLista =
  | { listaId: string; tipo: 'item'; indice: number; escolha: '0' | '1' | 'n' | 'f' }
  | { listaId: string; tipo: 'marca'; indice: number; k: number }
  | { listaId: string; tipo: 'fornecedor'; escolha: number | 'sem' }
  | { listaId: string; tipo: 'criar' }
  | { listaId: string; tipo: 'cancelar' };

export function lerBotaoDaLista(botaoId: unknown): BotaoDaLista | null {
  const s = String(botaoId ?? '');
  let m = new RegExp(`^lc:(${UUID}):(\\d{1,2}):(0|1|n|f)$`, 'i').exec(s);
  if (m) return { listaId: m[1].toLowerCase(), tipo: 'item', indice: Number(m[2]), escolha: m[3].toLowerCase() as any };
  m = new RegExp(`^lc:(${UUID}):(\\d{1,2}):m([0-2])$`, 'i').exec(s);
  if (m) return { listaId: m[1].toLowerCase(), tipo: 'marca', indice: Number(m[2]), k: Number(m[3]) };
  m = new RegExp(`^lc:(${UUID}):fo:([01]|s)$`, 'i').exec(s);
  if (m) return { listaId: m[1].toLowerCase(), tipo: 'fornecedor', escolha: m[2] === 's' ? 'sem' : Number(m[2]) };
  m = new RegExp(`^lc:(${UUID}):(criar|cancelar)$`, 'i').exec(s);
  if (m) return { listaId: m[1].toLowerCase(), tipo: m[2].toLowerCase() as 'criar' | 'cancelar' };
  return null;
}

/** O nome do botão cabe no limite da Meta (20 letras). */
const curto = (t: string, max = 20) => (t.length <= max ? t : `${t.slice(0, max - 1)}…`);

const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const quanto = (l: Pick<LinhaDaLista, 'quantidade' | 'unidade'>) => `${qtd(l.quantidade)}${l.unidade ? ` ${l.unidade}` : ''}`;

/** A pergunta de uma linha e os botões dela. */
export function perguntaDaLinha(listaId: string, i: number, l: LinhaDaLista): { texto: string; botoes: { id: string; titulo: string }[] } {
  if (l.estado === 'fator') {
    return {
      texto: `Você pediu ${quanto(l)} de "${l.texto}", e o "${l.itemNome}" é contado em ${l.unidadeDoEstoque}. 1 ${l.unidade} tem quantos ${l.unidadeDoEstoque}? Responda só o número.`,
      botoes: [],
    };
  }
  if (l.estado === 'marca') {
    const mais = l.marcas.length > 3 ? ` Ou responda o nome de outra: ${l.marcas.slice(3).join(', ')}.` : '';
    return {
      texto: `O "${l.itemNome}" tem ${l.marcas.length} marcas. Qual vai no pedido?${mais}`,
      botoes: l.marcas.slice(0, 3).map((mc, k) => ({ id: `${PREFIXO_DA_LISTA}${listaId}:${i}:m${k}`, titulo: curto(mc) })),
    };
  }
  // O insumo: até 2 opções; com uma só (ou nenhuma), também "Cadastrar novo"; sempre "Deixar de fora".
  const op = l.opcoes.slice(0, 2);
  const botoes = [
    ...op.map((o, k) => ({ id: `${PREFIXO_DA_LISTA}${listaId}:${i}:${k}`, titulo: curto(op.length === 1 ? `É o ${o.nome}` : o.nome) })),
    ...(op.length < 2 ? [{ id: `${PREFIXO_DA_LISTA}${listaId}:${i}:n`, titulo: 'Cadastrar novo' }] : []),
    { id: `${PREFIXO_DA_LISTA}${listaId}:${i}:f`, titulo: 'Deixar de fora' },
  ];
  const t =
    op.length === 0
      ? `Não achei "${l.texto}" (${quanto(l)}) no seu estoque. Cadastro um novo, ou deixo de fora da lista?`
      : op.length === 1
        ? `"${l.texto}" (${quanto(l)}) é o "${op[0].nome}" do estoque?`
        : `"${l.texto}" (${quanto(l)}) é qual destes do estoque?`;
  return { texto: t, botoes };
}

/** A pergunta do fornecedor (até 2 nos botões e "Sem fornecedor"). */
export function perguntaDoFornecedor(listaId: string, opcoes: { id: string; nome: string }[]): { texto: string; botoes: { id: string; titulo: string }[] } {
  return {
    texto: 'Para qual fornecedor é o pedido?',
    botoes: [
      ...opcoes.slice(0, 2).map((f, k) => ({ id: `${PREFIXO_DA_LISTA}${listaId}:fo:${k}`, titulo: curto(f.nome) })),
      { id: `${PREFIXO_DA_LISTA}${listaId}:fo:s`, titulo: 'Sem fornecedor' },
    ],
  };
}

/** O resumo antes do "Criar o pedido": cada linha com o insumo e a quantidade que vai ao pedido, e o que fica de fora. */
export function resumoDaLista(listaId: string, linhas: LinhaDaLista[], fornecedor: string | null): { texto: string; botoes: { id: string; titulo: string }[] } {
  const vao = linhas.filter((l) => l.estado === 'ligado');
  const fora = linhas.filter((l) => l.estado === 'fora');
  const itens = vao.map((l) => `• ${l.itemNome}, ${qtd(quantidadeNoEstoque(l))} ${l.unidadeDoEstoque}${l.marca ? ` (${l.marca})` : ''}`);
  const deFora = fora.length ? `\nFica de fora: ${fora.map((l) => l.texto).join(', ')}.` : '';
  return {
    texto: `🛒 Lista de compras${fornecedor ? ` · ${fornecedor}` : ''}\n${itens.join('\n')}${deFora}\n\nCrio o pedido em Estoque › Pedidos?`,
    botoes: [
      { id: `${PREFIXO_DA_LISTA}${listaId}:criar`, titulo: 'Criar o pedido' },
      { id: `${PREFIXO_DA_LISTA}${listaId}:cancelar`, titulo: 'Cancelar' },
    ],
  };
}

export const TEXTOS_DA_LISTA = {
  soQuemPode: 'Montar a lista de compras pelo Mister é para quem pode criar pedidos no Estoque.',
  semLoja: 'Você não tem loja definida no Regem: peça ao presidente para colocar a sua loja no cadastro.',
  semLinhas: 'Não entendi as linhas da lista: mande cada produto com a quantidade (ex.: "10 kg de bacon, 5 caixas de tomate").',
  nadaNoMinimo: 'Nada está abaixo do mínimo no estoque agora: não há o que pôr na lista.',
  jaRespondido: 'Esta lista já foi respondida.',
  vazia: 'Ficou tudo de fora: não há o que pedir. A lista foi descartada.',
  cancelada: 'Certo: descartei a lista. Nada foi pedido.',
  criada: (nome: string, n: number) => `Criei o pedido "${nome}" com ${n === 1 ? '1 item' : `${n} itens`} em Estoque › Pedidos. Para mandar ao fornecedor, abra o pedido por lá.`,
  planilhaSemLinhas: 'Não achei na planilha as colunas do produto e da quantidade. Mande com uma coluna "Produto" e outra "Quantidade" (e "Unidade", se quiser).',
} as const;

// ───────────────────────────── a planilha ─────────────────────────────

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const COLUNA_DO_PRODUTO = /^(produto|produtos|descricao|item|itens|insumo|insumos|nome|material)\b/;
const COLUNA_DA_QUANTIDADE = /^(quantidade|qtd|qtde|quant|qt)\b/;
const COLUNA_DA_UNIDADE = /^(unidade|un|und|unid|medida)\b/;

/**
 * As linhas de uma planilha de compras: o cabeçalho (nas 5 primeiras linhas) diz onde estão o produto, a quantidade e a
 * unidade; sem cabeçalho reconhecido, a 1ª coluna é o produto e a 2ª a quantidade (se as linhas trouxerem número nela).
 * `decimalPonto`: o Excel guarda o número com ponto; o CSV brasileiro, com vírgula.
 */
export function pedidosDaPlanilha(tabela: string[][], decimalPonto: boolean): PedidoDaLinha[] {
  const cel = (l: string[], i: number) => (i >= 0 ? String(l[i] ?? '').trim() : '');
  const num = (t: string) => {
    if (!t) return null;
    const n = decimalPonto && /^\d+(\.\d+)?$/.test(t) ? Number(t) : numeroDoTexto(t);
    return n != null && Number.isFinite(n) ? n : null;
  };
  let inicio = 0;
  let cp = -1;
  let cq = -1;
  let cu = -1;
  for (let r = 0; r < Math.min(5, tabela.length); r++) {
    const cab = tabela[r].map((c) => semAcento(String(c ?? '')));
    const p = cab.findIndex((c) => COLUNA_DO_PRODUTO.test(c));
    const q = cab.findIndex((c) => COLUNA_DA_QUANTIDADE.test(c));
    if (p >= 0 && q >= 0) {
      cp = p;
      cq = q;
      cu = cab.findIndex((c, k) => k !== p && k !== q && COLUNA_DA_UNIDADE.test(c));
      inicio = r + 1;
      break;
    }
  }
  if (cp < 0) {
    // Sem cabeçalho: produto na 1ª coluna e quantidade na 2ª, se a maioria das linhas tiver número ali.
    const comNumero = tabela.filter((l) => num(cel(l, 1)) != null).length;
    if (!tabela.length || comNumero < Math.ceil(tabela.length / 2)) return [];
    cp = 0;
    cq = 1;
    cu = tabela.some((l) => cel(l, 2) && num(cel(l, 2)) == null) ? 2 : -1;
  }
  return lerPedidos(
    tabela.slice(inicio).map((l) => ({ texto: cel(l, cp), quantidade: num(cel(l, cq)), unidade: cu >= 0 ? cel(l, cu) || null : null })),
  );
}
