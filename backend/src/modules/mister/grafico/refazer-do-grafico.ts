import type { BarraDoPlano, FormaDoGrafico, ParteDoPlano, PlanoDoGrafico } from './plano-do-grafico';

// O "REFAZER" DE UM GRÁFICO DO MISTER (versão 6, M6i; plano aprovado em 20/11/2026, `docs/plano-mister.md` § "Versão 6",
// Frente D; protótipo `mockups/regem-mister-v6.html`, "Ações e apresentação" — o gráfico refeito com os mesmos dados).
// "Não entendi", "não gostei", "faz em barras deitadas", "destaca o sábado": a IA escolhe SÓ a apresentação (a forma, o
// título com a mensagem principal, o destaque, a ordem, mostrar ou não os valores); os números são os do plano guardado
// (a consulta não roda de novo). O código confere tudo: a forma que os dados aceitam, o título sem número que o gráfico
// não traz, o destaque que existe. Puro: sem banco e sem desenho.

export type FormaRefeita = 'colunas' | 'horizontais' | 'tabela' | 'linha';
export const FORMAS_REFEITAS: readonly FormaRefeita[] = ['colunas', 'horizontais', 'tabela', 'linha'];
/** "Didático, simples e sofisticado": na ordem pelo maior, no máximo 7 itens (os principais). */
export const MAX_ITENS_NO_REFEITO = 7;
/** O último gráfico fica guardado por 30 minutos para o "refazer". */
export const GRAFICO_GUARDADO_MIN = 30;

export interface OpcoesDoRefazer {
  forma?: unknown;
  titulo?: unknown;
  /** A posição (1 = o primeiro, na ordem que fica) do item que ganha o destaque. */
  destaque?: unknown;
  ordem?: unknown;
  mostrarValores?: unknown;
}

/** As formas que os dados de cada plano aceitam: a série (por dia, por hora) vira linha; a participação e o ranking, não. */
export function formasAceitas(p: Pick<PlanoDoGrafico, 'barras' | 'partes'>): FormaRefeita[] {
  return p.barras?.length ? ['colunas', 'linha', 'horizontais', 'tabela'] : ['horizontais', 'tabela', 'colunas'];
}

/** Os números que o gráfico mostra — o título refeito não traz número de fora deles. */
function numerosDoPlano(p: PlanoDoGrafico): Set<string> {
  const textos = [
    p.titulo,
    p.sub,
    p.kpi ?? '',
    p.delta?.texto ?? '',
    ...(p.barras ?? []).flatMap((b) => [b.rotulo, b.rotulo2 ?? '', b.texto]),
    ...(p.partes ?? []).flatMap((x) => [x.nome, x.texto]),
  ];
  return new Set(textos.join(' ').match(/\d+(?:[.,]\d+)*/g) ?? []);
}

/**
 * O plano refeito, ou o motivo de não dar (a IA escolhe outra coisa). O que não veio fica como estava. A série refeita como
 * barras deitadas ou tabela usa o rótulo de cada ponto como o nome; o ranking refeito como colunas, o nome encurtado.
 */
export function refazerPlano(p: PlanoDoGrafico, o: OpcoesDoRefazer): { plano: PlanoDoGrafico } | { erro: string } {
  const aceitas = formasAceitas(p);
  const pedida = o.forma === undefined || o.forma === null || o.forma === '' ? null : String(o.forma);
  if (pedida && !(aceitas as string[]).includes(pedida)) return { erro: `Este gráfico pode ser refeito como: ${aceitas.join(', ')}.` };
  let titulo = p.titulo;
  if (typeof o.titulo === 'string' && o.titulo.trim()) {
    const t = o.titulo.replace(/\s+/g, ' ').trim();
    if (t.length < 3 || t.length > 70) return { erro: 'O título tem de ter de 3 a 70 letras.' };
    const conhecidos = numerosDoPlano(p);
    const fora = (t.match(/\d+(?:[.,]\d+)*/g) ?? []).filter((n) => !conhecidos.has(n));
    if (fora.length) return { erro: `O título não pode trazer número que o gráfico não mostra (${fora.join(', ')}).` };
    titulo = t;
  }
  if (o.ordem !== undefined && o.ordem !== null && o.ordem !== 'maior' && o.ordem !== 'original') return { erro: 'A ordem é "maior" (do maior para o menor) ou "original".' };
  // A forma final (sem pedido: a do plano; a participação refeita vira barras deitadas).
  const forma: FormaDoGrafico = (pedida as FormaRefeita | null) ?? (p.forma === 'participacao' ? 'horizontais' : p.forma);
  let barras: BarraDoPlano[] | undefined = p.barras ? p.barras.map((b) => ({ ...b })) : undefined;
  let partes: ParteDoPlano[] | undefined = p.partes ? p.partes.map((x) => ({ ...x })) : undefined;
  if (barras && (forma === 'horizontais' || forma === 'tabela')) {
    partes = barras.map((b) => ({ nome: `${b.rotulo}${b.rotulo2 ? ` ${b.rotulo2}` : ''}`, valor: b.valor, texto: b.texto }));
    barras = undefined;
  } else if (!barras && partes && (forma === 'colunas' || forma === 'linha')) {
    barras = partes.map((x) => ({ rotulo: x.nome.length > 12 ? `${x.nome.slice(0, 11)}…` : x.nome, valor: x.valor, texto: x.texto }));
    partes = undefined;
  }
  if (o.ordem === 'maior') {
    if (barras) barras = barras.sort((a, b) => b.valor - a.valor).slice(0, MAX_ITENS_NO_REFEITO);
    if (partes) partes = partes.sort((a, b) => b.valor - a.valor).slice(0, MAX_ITENS_NO_REFEITO);
  }
  const n = (barras ?? partes ?? []).length;
  // A ordem nova muda as posições: o destaque de antes não vale mais (volta ao padrão, o maior).
  let destaque = o.ordem === 'maior' || pedida ? undefined : p.destaque;
  if (o.destaque !== undefined && o.destaque !== null) {
    const d = Number(o.destaque);
    if (!Number.isInteger(d) || d < 1 || d > n) return { erro: `O destaque é a posição de 1 a ${n}.` };
    destaque = d;
  }
  // A legenda das colunas comparadas não vale fora das colunas e da linha.
  const legenda = forma === 'colunas' || forma === 'linha' ? p.legenda : undefined;
  return {
    plano: {
      ...p,
      forma,
      titulo,
      barras,
      partes,
      legenda,
      destaque,
      // V7e: a faixa do pico é por posição: só vale com a mesma forma, a mesma ordem e sem um destaque escolhido.
      faixa: forma === 'colunas' && o.ordem !== 'maior' && (o.destaque === undefined || o.destaque === null) ? p.faixa : undefined,
      semValores: o.mostrarValores === false ? true : o.mostrarValores === true ? false : p.semValores,
    },
  };
}
