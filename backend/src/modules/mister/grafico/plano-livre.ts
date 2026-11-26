import { numerosDosResultados } from '../mister-agente.regras';
import { numerosDoTexto, porcentagemDaConta, type OrigemDosNumeros } from '../mister-imagem-numeros';
import { reaisCurtos, type FormaDoGrafico, type PlanoDoGrafico } from './plano-do-grafico';

// O GRÁFICO LIVRE (versão 10, fase C10b; aprovada pelo dono em 25/11/2026 — `docs/plano-mister.md` § "Versão 10", decisão
// V10-11, protótipo `mockups/regem-mister-v10.html`, "No celular" › "Qualquer gráfico"). Até aqui o Mister desenhava 8 gráficos
// prontos (`mostrar_grafico`); o resto ia em texto. Agora a IA monta o gráfico de QUALQUER consulta desta pergunta (as contas por
// categoria, o estoque em alerta, as faltas da semana…): escolhe a forma, o título e os itens; o código confere que cada número
// veio de uma consulta desta pergunta (ou foi dito pela pessoa) e monta o plano — o desenho é o mesmo dos outros gráficos
// (`imagem-do-plano.ts`), sem custo e sem IA de imagem. Puro: sem banco e sem desenho.

export const FORMAS_DO_LIVRE = ['colunas', 'linha', 'horizontais', 'tabela', 'participacao'] as const;
export type FormaDoLivre = (typeof FORMAS_DO_LIVRE)[number];
export const UNIDADES_DO_LIVRE = ['reais', 'quantidade', 'porcentagem'] as const;
export type UnidadeDoLivre = (typeof UNIDADES_DO_LIVRE)[number];
export const ITENS_DO_LIVRE = { min: 2, max: 12 } as const;

export interface GraficoLivre {
  forma: FormaDoLivre;
  titulo: string;
  unidade: UnidadeDoLivre;
  itens: Array<{ rotulo: string; valor: number }>;
  /** A posição (1 = o primeiro) do item em dourado; sem ela, o maior. */
  destaque?: number;
}

const texto = (t: unknown) => String(t ?? '').replace(/\s+/g, ' ').trim();

/** O que a IA mandou, conferido inteiro (a forma, o título, a unidade e de 2 a 12 itens com rótulo e valor). */
export function lerGraficoLivre(en: Record<string, unknown>): GraficoLivre | { erro: string } {
  const forma = String(en.forma ?? '') as FormaDoLivre;
  if (!FORMAS_DO_LIVRE.includes(forma)) return { erro: `A forma é ${FORMAS_DO_LIVRE.join(', ')}.` };
  const titulo = texto(en.titulo);
  if (titulo.length < 3 || titulo.length > 70) return { erro: 'O título tem de ter de 3 a 70 letras: a mensagem principal do gráfico.' };
  // "medida" (não "unidade": no Mister, unidade é a loja, e o modelo nunca manda campo de loja).
  const unidade = String(en.medida ?? '') as UnidadeDoLivre;
  if (!UNIDADES_DO_LIVRE.includes(unidade)) return { erro: `A medida é ${UNIDADES_DO_LIVRE.join(', ')}.` };
  if (!Array.isArray(en.itens) || en.itens.length < ITENS_DO_LIVRE.min || en.itens.length > ITENS_DO_LIVRE.max)
    return { erro: `Mande de ${ITENS_DO_LIVRE.min} a ${ITENS_DO_LIVRE.max} itens, cada um com rotulo e valor (para mais, os principais).` };
  const itens: GraficoLivre['itens'] = [];
  for (const x of en.itens as any[]) {
    const rotulo = texto(x?.rotulo);
    if (!rotulo || rotulo.length > 40) return { erro: 'Cada item precisa de um rótulo curto (até 40 letras).' };
    const valor = Number(x?.valor);
    if (typeof x?.valor !== 'number' || !Number.isFinite(valor) || valor < 0) return { erro: `"${rotulo}": o valor é um número (zero ou mais), sem texto.` };
    itens.push({ rotulo, valor });
  }
  if (forma === 'participacao' && !itens.some((i) => i.valor > 0)) return { erro: 'A participação precisa de algum valor acima de zero.' };
  if (unidade === 'porcentagem' && forma === 'participacao') return { erro: 'A participação já mostra a parte de cada um: mande os valores (reais ou quantidade), não a porcentagem.' };
  const g: GraficoLivre = { forma, titulo, unidade, itens };
  if (en.destaque !== undefined && en.destaque !== null) {
    const d = Number(en.destaque);
    if (!Number.isInteger(d) || d < 1 || d > itens.length) return { erro: `O destaque é a posição de 1 a ${itens.length}.` };
    g.destaque = d;
  }
  return g;
}

/** Teto de números da origem na conta de dois (a conta é de pares). */
const TETO_DA_CONTA = 300;

/** O valor é a soma ou a diferença de dois números da origem ("quanto falta" = o mínimo − o saldo)? Em centavos: conta exata. */
function contaDeDois(c: number, origem: number[]): boolean {
  const base = origem.slice(0, TETO_DA_CONTA);
  const tem = new Set(base);
  return base.some((a) => tem.has(a - c) || tem.has(c - a) || tem.has(a + c));
}

/**
 * Os valores do gráfico que não vieram de uma consulta desta pergunta nem da fala da pessoa (vazio = todos têm origem). Vale o
 * número que veio, a soma ou a diferença de dois que vieram ("quanto falta"), e a porcentagem que é a conta de dois.
 */
export function valoresSemOrigem(g: GraficoLivre, origem: OrigemDosNumeros): string[] {
  const daFala = origem.falas.flatMap((f) => numerosDoTexto(f).map((n) => n.centavos / 100));
  const conhecidos = numerosDosResultados([...origem.resultados, { numerosDaFala: daFala }]);
  for (const v of [...conhecidos]) conhecidos.add(Math.abs(v));
  const lista = [...conhecidos];
  return g.itens
    .filter((i) => {
      const c = Math.round(i.valor * 100);
      if (conhecidos.has(c)) return false;
      if (g.unidade === 'porcentagem') return !porcentagemDaConta(c, lista);
      return !contaDeDois(c, lista);
    })
    .map((i) => `${i.rotulo} (${i.valor.toLocaleString('pt-BR')})`);
}

const doValor = (u: UnidadeDoLivre, v: number): string =>
  u === 'reais' ? reaisCurtos(v) : u === 'porcentagem' ? `${v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : v.toLocaleString('pt-BR', { maximumFractionDigits: 3 });

/** O plano do gráfico livre (o desenho é o de sempre). Colunas e linha: barras; deitadas, tabela e participação: partes. */
export function planoLivre(g: GraficoLivre, o: { loja: string; lidoEm: string }): PlanoDoGrafico {
  const forma: FormaDoGrafico = g.forma;
  const curto = (r: string) => (r.length > 12 ? `${r.slice(0, 11)}…` : r);
  const comBarras = forma === 'colunas' || forma === 'linha';
  const soma = g.itens.reduce((s, i) => s + i.valor, 0);
  return {
    forma,
    titulo: g.titulo,
    sub: o.loja,
    // O total só na participação (a parte de cada um é do total) e com unidade que se soma.
    kpi: forma === 'participacao' ? doValor(g.unidade, soma) : null,
    delta: null,
    ...(comBarras
      ? { barras: g.itens.map((i) => ({ rotulo: curto(i.rotulo), valor: i.valor, texto: doValor(g.unidade, i.valor) })) }
      : { partes: g.itens.map((i) => ({ nome: i.rotulo, valor: i.valor, texto: doValor(g.unidade, i.valor) })) }),
    ...(g.destaque ? { destaque: g.destaque } : {}),
    rodape: `Lido em ${o.lidoEm} · desenhado pelo Regem com os números desta conversa`,
  };
}
