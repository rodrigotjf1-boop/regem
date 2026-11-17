import { Conversao, chaveUnidade, fatorParaEstoque } from '../../common/conversao-unidade';
import { InsumoParaSugerir, palavrasDaDescricao, sugerirInsumos } from '../../common/nota-por-foto';

// M3c — O RELATÓRIO POR INSUMO DO MISTER (versão 3 do protótipo, conversas 15 e 16; decisão 10: "o que a venda baixou pela
// ficha técnica, na unidade do insumo, com o total em quilos"). Só o que é puro: achar o insumo pelo nome que a pessoa
// disse, o total em quilos, a série por hora ou por dia, a comparação e o "de onde saíram". As contas com o banco ficam
// no `MisterFerramentasService.insumoVendido`.

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/** O plural mais comum do português tirado das palavras ("carnes" → "carne", "paes" fica): só para procurar o insumo. */
const noSingular = (t: string) =>
  t
    .split(/\s+/)
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') && !/\d/.test(w) ? w.slice(0, -1) : w))
    .join(' ');

export type InsumoAchado = { tipo: 'achou'; id: string; nome: string } | { tipo: 'escolher'; opcoes: string[] } | { tipo: 'nenhum' };

/**
 * O insumo do estoque que a pessoa quis dizer ("carnes de 56g", "a carne 56", "bacon"). O nome igual vence; senão, a
 * MESMA sugestão da nota do fornecedor (as palavras, os sinônimos do ramo e a medida — "56g" nunca vai para a de 120 g),
 * também com as palavras no singular. Mais de um parecido sem um claramente melhor → as opções, para o Mister perguntar.
 */
export function acharInsumo(pedido: unknown, insumos: InsumoParaSugerir[]): InsumoAchado {
  const t = String(pedido ?? '').trim();
  if (!t) return { tipo: 'nenhum' };
  const igual = insumos.filter((i) => [i.nome, i.nomeComercial].some((n) => n && semAcento(n) === semAcento(t)));
  if (igual.length === 1) return { tipo: 'achou', id: igual[0].id, nome: igual[0].nome };
  const melhores = new Map<string, { id: string; nome: string; nota: number }>();
  for (const s of [...sugerirInsumos(t, insumos), ...sugerirInsumos(noSingular(semAcento(t)), insumos)]) {
    const ja = melhores.get(s.id);
    if (!ja || s.nota > ja.nota) melhores.set(s.id, s);
  }
  const lista = [...melhores.values()].sort((a, b) => b.nota - a.nota || a.nome.localeCompare(b.nome));
  if (!lista.length) return { tipo: 'nenhum' };
  // Um só, ou o primeiro claramente na frente (a medida que bate soma 0,5 na nota).
  if (lista.length === 1 || lista[0].nota - lista[1].nota >= 0.25) return { tipo: 'achou', id: lista[0].id, nome: lista[0].nome };
  return { tipo: 'escolher', opcoes: lista.slice(0, 3).map((x) => x.nome) };
}

/** O peso que o nome do insumo traz ("Carne 56 g" → 56; "Queijo 1,5 kg" → 1500), em gramas; sem peso, null. */
export function pesoNoNome(nome: unknown): number | null {
  const medida = palavrasDaDescricao(nome).find((w) => /^\d+(\.\d+)?(kg|g)$/.test(w));
  if (!medida) return null;
  const n = Number(medida.replace(/(kg|g)$/, ''));
  if (!(n > 0)) return null;
  return medida.endsWith('kg') ? n * 1000 : n;
}

/**
 * O total em quilos (decisão 10): pela conversão do cadastro do insumo ou pelas medidas fixas (o insumo em grama, em kg);
 * sem caminho até o quilo, null — nunca um palpite. Também diz, para o insumo guardado em PESO cujo nome traz o peso de
 * cada um ("Carne 56 g" em kg), quantas unidades isso dá ("cerca de 212") — o Mister fala "cerca de".
 */
export function emQuilos(quantidade: number, unidadeDoEstoque: string, conversoes: Conversao[], nome: string): { kg: number | null; cercaDeUnidades: number | null } {
  const porQuilo = fatorParaEstoque('kg', unidadeDoEstoque, conversoes); // unidades do estoque em 1 kg
  const kg = porQuilo && porQuilo > 0 ? arredondar(quantidade / porQuilo, 3) : null;
  const emPeso = ['kg', 'grama', 'g', 'gr', 'quilo'].includes(chaveUnidade(unidadeDoEstoque));
  const peso = pesoNoNome(nome);
  const cercaDeUnidades = emPeso && kg != null && peso ? Math.round((kg * 1000) / peso) : null;
  return { kg, cercaDeUnidades };
}

export const arredondar = (n: number, casas = 3) => {
  const f = 10 ** casas;
  return Math.round((Number(n) || 0) * f) / f;
};

/**
 * A série do gráfico. Por hora (um dia só): as horas do primeiro ao último movimento, com as vazias no meio em zero —
 * "18h 19h 20h 21h 22h". Por dia: todos os dias do período, até hoje, com zero onde não vendeu.
 */
export function seriePorHora(linhas: Array<{ hora: number; quantidade: number }>): Array<{ rotulo: string; quantidade: number }> {
  const com = linhas.filter((l) => Number.isInteger(l.hora) && l.hora >= 0 && l.hora <= 23);
  if (!com.length) return [];
  const de = Math.min(...com.map((l) => l.hora));
  const ate = Math.max(...com.map((l) => l.hora));
  const q = new Map(com.map((l) => [l.hora, l.quantidade]));
  const fora: Array<{ rotulo: string; quantidade: number }> = [];
  for (let h = de; h <= ate; h++) fora.push({ rotulo: `${h}h`, quantidade: arredondar(q.get(h) ?? 0) });
  return fora;
}

const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export function seriePorDia(linhas: Array<{ dia: string; quantidade: number }>, de: string, ate: string): Array<{ rotulo: string; dia: string; quantidade: number }> {
  const q = new Map(linhas.map((l) => [l.dia, l.quantidade]));
  const fora: Array<{ rotulo: string; dia: string; quantidade: number }> = [];
  const fim = new Date(`${ate}T12:00:00Z`);
  for (let d = new Date(`${de}T12:00:00Z`); d <= fim && fora.length < 400; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    fora.push({ rotulo: `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${DIAS[d.getUTCDay()]}`, dia: iso, quantidade: arredondar(q.get(iso) ?? 0) });
  }
  return fora;
}

/** "18% acima da média das últimas 4 segundas": a média das semanas anteriores (só as que venderam) e a diferença. */
export function comparacaoComAsSemanas(total: number, anteriores: number[]): { media: number; diferencaPct: number } | null {
  const com = anteriores.filter((x) => x > 0);
  if (!com.length) return null;
  const media = com.reduce((a, b) => a + b, 0) / com.length;
  return { media: arredondar(media, 1), diferencaPct: Math.round(((total - media) / media) * 100) };
}

/**
 * De onde saiu o insumo: a ficha de cada produto vendido (o consumo de uma unidade × quanto vendeu), do que mais usou para o
 * que menos (até 6). O que a ficha não explica — adicionais, "sem" pedido pelo cliente, a embalagem do delivery, um produto
 * que mudou de ficha no meio do período — fica em "outros", para a soma bater com o total que a venda baixou.
 */
export function deOndeSairam(
  total: number,
  vendidos: Array<{ produto: string; vendidos: number; porUnidade: number }>,
): { produtos: Array<{ produto: string; quantidade: number; porUnidade: number; vendidos: number }>; outros: number | null } {
  const com = vendidos
    .filter((v) => v.porUnidade > 0 && v.vendidos > 0)
    .map((v) => ({ produto: v.produto, quantidade: arredondar(v.porUnidade * v.vendidos), porUnidade: arredondar(v.porUnidade), vendidos: arredondar(v.vendidos) }))
    .sort((a, b) => b.quantidade - a.quantidade || a.produto.localeCompare(b.produto));
  const produtos = com.slice(0, 6);
  const listados = produtos.reduce((a, b) => a + b.quantidade, 0);
  const resto = arredondar(total - listados);
  // Pela ficha pode dar MAIS do que a venda baixou (o "sem carne" do cliente): aí não há "outros" a mostrar.
  return { produtos, outros: resto > 0.0005 ? resto : null };
}
