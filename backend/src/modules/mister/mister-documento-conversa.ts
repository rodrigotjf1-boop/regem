import { pareceConversa } from '../../common/duvida-da-nota';
import { sugerirInsumos, type InsumoParaSugerir, type ItemNoMister, type NotaNoMister } from '../../common/nota-por-foto';
import { semDadoPessoal } from '../graph/graph.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CUPOM E A NOTA PELA CONVERSA (ERR-594). A foto segue pelo caminho dos documentos e o agente só via uma linha-resumo: a pessoa
// explicava a linha do queijo, o Mister respondia "Anotado" e nada era gravado. Aqui o agente vê as linhas e grava o que a pessoa
// disse. Quem confere é o código: a linha existe, o número é válido, o insumo é um só. Lançar continua só no botão "Lançar".

/** O trabalho aberto continua valendo no dia seguinte: quem volta ao cupom não pode ouvir "não recebi". */
export const DOCUMENTO_ABERTO_H = 72;
const MAX_ALTERACOES = 20;
const MAX_LINHA = 60;
const MAX_QUANTIDADE = 100_000;
const MAX_VALOR_REAIS = 1_000_000;
const MAX_FATOR = 100_000;

export type AlteracaoDoDocumento =
  | { linha: number; tipo: 'corrigir'; descricao?: string; quantidade?: number; valorTotalCentavos?: number }
  | { linha: number; tipo: 'ligar'; insumo: string }
  | { linha: number; tipo: 'conversao'; quantoNoEstoque: number }
  | { linha: number; tipo: 'fora' }
  | { linha: number; tipo: 'cadastrar'; nome?: string; unidade?: string };

const emTexto = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim();
const positivo = (v: unknown, teto: number): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= teto;

/** O que o modelo pediu, conferido inteiro antes de qualquer gravação. */
export function lerAlteracoes(entrada: unknown): { alteracoes: AlteracaoDoDocumento[] } | { erro: string } {
  if (!Array.isArray(entrada) || !entrada.length) return { erro: 'Diga o que mudar: alteracoes, cada uma com a linha e o tipo.' };
  if (entrada.length > MAX_ALTERACOES) return { erro: `No máximo ${MAX_ALTERACOES} linhas de uma vez.` };
  const alteracoes: AlteracaoDoDocumento[] = [];
  for (const a of entrada as any[]) {
    const linha = Number(a?.linha);
    if (!Number.isInteger(linha) || linha < 1 || linha > MAX_LINHA) return { erro: 'Cada alteração precisa do número da linha do documento.' };
    if (a?.tipo === 'fora') alteracoes.push({ linha, tipo: 'fora' });
    else if (a?.tipo === 'cadastrar') {
      // Versão 9, O1: o cadastro novo que a pessoa pediu ("cadastra o 7"). Sem nome, o que a IA propôs ou o da nota.
      const c: Extract<AlteracaoDoDocumento, { tipo: 'cadastrar' }> = { linha, tipo: 'cadastrar' };
      if (a.nome !== undefined && a.nome !== null && String(a.nome).trim()) {
        const n = emTexto(a.nome);
        if (n.length < 2 || n.length > 120 || !/\p{L}/u.test(n) || pareceConversa(n)) return { erro: `Linha ${linha}: isso não parece o nome de um produto.` };
        c.nome = n;
      }
      if (a.unidade !== undefined && a.unidade !== null && String(a.unidade).trim()) c.unidade = emTexto(a.unidade).slice(0, 20);
      alteracoes.push(c);
    }
    else if (a?.tipo === 'ligar') {
      const insumo = emTexto(a.insumo).slice(0, 120);
      if (insumo.length < 2) return { erro: `Linha ${linha}: diga o nome do insumo do estoque.` };
      alteracoes.push({ linha, tipo: 'ligar', insumo });
    } else if (a?.tipo === 'conversao') {
      if (!positivo(a.quanto_no_estoque, MAX_FATOR)) return { erro: `Linha ${linha}: diga quanto do estoque entra por 1 unidade da nota.` };
      alteracoes.push({ linha, tipo: 'conversao', quantoNoEstoque: a.quanto_no_estoque });
    } else if (a?.tipo === 'corrigir') {
      const c: Extract<AlteracaoDoDocumento, { tipo: 'corrigir' }> = { linha, tipo: 'corrigir' };
      if (a.descricao !== undefined && a.descricao !== null) {
        const d = emTexto(a.descricao);
        if (d.length < 2 || d.length > 120 || !/\p{L}/u.test(d) || pareceConversa(d)) return { erro: `Linha ${linha}: isso não parece o nome de um produto.` };
        c.descricao = d;
      }
      if (a.quantidade !== undefined && a.quantidade !== null) {
        if (!positivo(a.quantidade, MAX_QUANTIDADE)) return { erro: `Linha ${linha}: a quantidade não é válida.` };
        c.quantidade = Math.round(a.quantidade * 1000) / 1000;
      }
      if (a.valor_total !== undefined && a.valor_total !== null) {
        if (!positivo(a.valor_total, MAX_VALOR_REAIS)) return { erro: `Linha ${linha}: o valor não é válido.` };
        c.valorTotalCentavos = Math.round(a.valor_total * 100);
      }
      if (c.descricao === undefined && c.quantidade === undefined && c.valorTotalCentavos === undefined) return { erro: `Linha ${linha}: diga o que corrigir.` };
      alteracoes.push(c);
    } else return { erro: 'tipo precisa ser corrigir, ligar, conversao, fora ou cadastrar.' };
  }
  return { alteracoes };
}

// ───────────────────────── versão 10, C1a: o que os leitores de código faziam, agora pela IA ─────────────────────────
// Até a C1a, a resposta da pessoa à dúvida da leitura passava antes por leitores de código ("o total é 1.240", "faltou 2 CX
// de cebola 18,00", "vence dia 30, 480 reais"). Agora o texto vai à IA, que entende a frase e grava por aqui. Quem confere é o
// código: o número válido, o item com nome e valor, a data que existe.

const MAX_INCLUIR = 10;

/** O que a nota ganha além das linhas: o total, os itens que a leitura não pegou e o "lançar assim mesmo" com a soma diferente. */
export interface ExtrasDaNota {
  totalCentavos?: number;
  incluir?: Array<{ descricao: string; quantidade: number; unidade: string | null; valorTotalCentavos: number }>;
  semSomar?: true;
}

/** Os campos de cima da chamada `alterar` (fora das linhas), conferidos. Vazio = nada além das linhas. */
export function lerExtrasDaNota(en: Record<string, unknown>): { extras: ExtrasDaNota } | { erro: string } {
  const extras: ExtrasDaNota = {};
  if (en.total !== undefined && en.total !== null) {
    if (!positivo(en.total, MAX_VALOR_REAIS)) return { erro: 'O total da nota não é válido: diga o valor em reais.' };
    extras.totalCentavos = Math.round((en.total as number) * 100);
  }
  if (en.incluir !== undefined && en.incluir !== null) {
    if (!Array.isArray(en.incluir) || !en.incluir.length) return { erro: 'incluir é a lista dos itens que faltaram, cada um com produto, quantidade e valor_total.' };
    if (en.incluir.length > MAX_INCLUIR) return { erro: `No máximo ${MAX_INCLUIR} itens de uma vez.` };
    extras.incluir = [];
    for (const x of en.incluir as any[]) {
      const descricao = emTexto(x?.produto ?? x?.descricao);
      if (descricao.length < 2 || descricao.length > 120 || !/\p{L}/u.test(descricao) || pareceConversa(descricao)) return { erro: 'Cada item a incluir precisa do nome do produto como está na nota.' };
      if (!positivo(x?.quantidade, MAX_QUANTIDADE)) return { erro: `${descricao}: a quantidade não é válida.` };
      if (!positivo(x?.valor_total, MAX_VALOR_REAIS)) return { erro: `${descricao}: diga o valor total do item, em reais.` };
      const unidade = x?.unidade !== undefined && x?.unidade !== null && String(x.unidade).trim() ? emTexto(x.unidade).toUpperCase().slice(0, 12) : null;
      extras.incluir.push({ descricao, quantidade: Math.round(x.quantidade * 1000) / 1000, unidade, valorTotalCentavos: Math.round(x.valor_total * 100) });
    }
  }
  if (en.lancar_mesmo_sem_somar === true) extras.semSomar = true;
  return { extras };
}

export const temExtras = (x: ExtrasDaNota): boolean => x.totalCentavos !== undefined || !!x.incluir?.length || x.semSomar === true;

/** O valor e o vencimento do boleto ou da conta em aberto (`acao: informar`), conferidos. */
export function lerInformado(en: Record<string, unknown>, hojeIso: string): { valorCentavos?: number; vencimento?: string } | { erro: string } {
  const r: { valorCentavos?: number; vencimento?: string } = {};
  if (en.valor !== undefined && en.valor !== null) {
    if (!positivo(en.valor, MAX_VALOR_REAIS)) return { erro: 'O valor não é válido: diga em reais.' };
    r.valorCentavos = Math.round((en.valor as number) * 100);
  }
  if (en.vencimento !== undefined && en.vencimento !== null && String(en.vencimento).trim()) {
    const v = String(en.vencimento).trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    const data = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
    if (!m || !data || data.toISOString().slice(0, 10) !== v) return { erro: 'O vencimento vai como AAAA-MM-DD (o dia que a pessoa disse, no mês certo).' };
    // Um boleto vencido há mais de um ano ou para daqui a mais de cinco é engano (o ano dito ou lido errado): pergunte de novo.
    const hoje = Date.parse(`${hojeIso}T00:00:00Z`);
    if (data.getTime() < hoje - 366 * 86_400_000 || data.getTime() > hoje + 5 * 366 * 86_400_000) return { erro: `O vencimento ${v} está longe demais de hoje: confirme o dia com a pessoa.` };
    r.vencimento = v;
  }
  if (r.valorCentavos === undefined && r.vencimento === undefined) return { erro: 'Diga o valor (em reais) ou o vencimento (AAAA-MM-DD) que a pessoa informou.' };
  return r;
}

/** Aplica a correção na linha. Devolve se o nome mudou: o insumo ligado pelo nome antigo deixa de valer. */
export function corrigirLinha(it: ItemNoMister, a: Extract<AlteracaoDoDocumento, { tipo: 'corrigir' }>): boolean {
  const nomeMudou = a.descricao !== undefined && a.descricao !== it.descricao;
  if (a.descricao !== undefined) it.descricao = a.descricao;
  if (a.quantidade !== undefined) it.quantidade = a.quantidade;
  if (a.valorTotalCentavos !== undefined) {
    it.valorTotalCentavos = a.valorTotalCentavos;
    if (it.quantidade > 0) it.valorUnitarioCentavos = Math.round(a.valorTotalCentavos / it.quantidade);
  } else if (a.quantidade !== undefined && it.valorUnitarioCentavos != null) {
    it.valorTotalCentavos = Math.round(it.valorUnitarioCentavos * it.quantidade);
  }
  it.duvida = null;
  return nomeMudou;
}

const normal = (t: unknown) =>
  emTexto(t)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase();

/** O insumo pelo nome exato (ou o nome comercial). O código nunca escolhe entre parecidos: devolve as opções para perguntar. */
export function acharInsumo<T extends InsumoParaSugerir>(termo: string, insumos: T[]): { insumo: T } | { opcoes: string[] } {
  const alvo = normal(termo);
  const iguais = insumos.filter((i) => normal(i.nome) === alvo || (!!i.nomeComercial && normal(i.nomeComercial) === alvo));
  if (iguais.length === 1) return { insumo: iguais[0] };
  if (iguais.length > 1) return { opcoes: iguais.slice(0, 5).map((i) => i.nome) };
  const contem = insumos.filter((i) => normal(i.nome).includes(alvo) || (!!i.nomeComercial && normal(i.nomeComercial).includes(alvo))).map((i) => i.nome);
  return { opcoes: [...new Set([...contem, ...sugerirInsumos(termo, insumos).map((s) => s.nome)])].slice(0, 5) };
}

/** O texto que vem do documento: uma linha, sem aspas, sem telefone nem e-mail, cortado. */
export const limpo = (t: unknown, max = 60) =>
  semDadoPessoal(String(t ?? ''))
    .replace(/["“”\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
const reais = (c: number) => `R$ ${(c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** Para onde a linha vai, ou o que falta dizer. */
function situacaoDaLinha(it: ItemNoMister): string {
  if (it.duvida) return `em dúvida (${limpo(it.duvida.texto, 40)})`;
  if (it.estado === 'fora') return 'fora do estoque';
  if (it.estado === 'item') {
    // Versão 9, O1: a proposta da IA, para a pessoa confirmar ("sim" liga a ela).
    if (it.propostaDaIa && it.sugestoes?.[0]) return `falta confirmar: é o ${limpo(it.sugestoes[0].nome, 40)}?`;
    return `falta dizer qual insumo é${it.nomeNovo ? ` (ou cadastrar ${limpo(it.nomeNovo, 40)})` : ''}`;
  }
  const de = limpo(it.unidade, 12) || 'unidade';
  const para = limpo(it.unidadeDoEstoque, 12);
  if (it.estado === 'fator') {
    return typeof it.fatorProposto === 'number'
      ? `${limpo(it.insumoNome, 40)}, falta confirmar: 1 ${de} = ${qtd(it.fatorProposto)} ${para}`
      : `${limpo(it.insumoNome, 40)}, falta a conversão de ${de} para ${para}`;
  }
  return `${limpo(it.insumoNome, 40)} (1 ${de} = ${qtd(Number(it.fator) || 0)} ${para})${it.pelaIa ? ', ligado pela IA' : ''}`;
}

/** A linha curta do bloco "TRABALHO EM ANDAMENTO". O número é o que a ferramenta recebe. */
export function linhaCurtaDoItem(it: ItemNoMister, i: number, verValores: boolean): string {
  const valor = verValores && it.valorTotalCentavos ? `, ${reais(it.valorTotalCentavos)}` : '';
  // O documento vem do banco: o campo que faltar não derruba o bloco inteiro.
  return `  ${i + 1}. ${limpo(it.descricao, 56)} (${qtd(Number(it.quantidade) || 0)} ${limpo(it.unidade, 8)}${valor}) → ${situacaoDaLinha(it)}`;
}

/** O que a ferramenta devolve no "ver". */
export function linhasParaOAgente(n: NotaNoMister, verValores: boolean) {
  return n.itens.map((it, i) => ({
    linha: i + 1,
    produto: limpo(it.descricao, 90),
    quantidade: it.quantidade,
    unidade: limpo(it.unidade, 12) || null,
    ...(verValores && it.valorTotalCentavos ? { valorTotal: it.valorTotalCentavos / 100 } : {}),
    situacao: situacaoDaLinha(it),
    ...(it.estado === 'item' && it.sugestoes?.length ? { insumosParecidos: it.sugestoes.map((s) => limpo(s.nome)) } : {}),
  }));
}

/** O que foi gravado, em uma frase por linha: é o que o agente repete. */
export function fraseDoFeito(a: AlteracaoDoDocumento, it: ItemNoMister, verValores: boolean): string {
  const nome = limpo(it.descricao, 50);
  if (a.tipo === 'fora') return `Linha ${a.linha} (${nome}): não entra no estoque.`;
  if (a.tipo === 'corrigir') {
    const valor = verValores && it.valorTotalCentavos ? `, total ${reais(it.valorTotalCentavos)}` : '';
    return `Linha ${a.linha} corrigida: ${nome}, ${qtd(it.quantidade)} ${limpo(it.unidade, 8)}${valor}.`;
  }
  return `Linha ${a.linha} (${nome}): ${situacaoDaLinha(it)}.`;
}
