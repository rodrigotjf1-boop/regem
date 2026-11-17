// Adicionais escolhidos num item — o que as telas de venda precisam da regra que o servidor aplica
// (`backend/src/common/adicionais.ts`): a mesma opção pode ser escolhida mais de uma vez só na
// etapa "com repetição", e o texto junta as repetições ("+ 2x Bacon").

export const REGRA_COM_REPETICAO = 'varias_com_repeticao';

/** A etapa (grupo de opções do produto) aceita repetir a mesma opção? */
export const permiteRepetir = (grupo: { regra?: string | null } | null | undefined): boolean =>
  grupo?.regra === REGRA_COM_REPETICAO;

/** Quantas vezes `id` está entre as escolhidas. */
export const vezesDe = (escolhidas: string[], id: string): number => escolhidas.filter((x) => x === id).length;

/**
 * Texto das escolhas, na ordem em que foram feitas e com as repetições juntas:
 * ["+ 2x Bacon", "sem Cebola"]. `opcoes` = todas as opções do produto, com o `tipo` do grupo.
 */
export function textosDasEscolhas(
  escolhidas: string[],
  opcoes: { id: string; nome: string; tipo?: string | null }[],
): string[] {
  const vezes = new Map<string, number>();
  for (const id of escolhidas) vezes.set(id, (vezes.get(id) ?? 0) + 1);
  const textos: string[] = [];
  for (const [id, n] of vezes) {
    const o = opcoes.find((x) => x.id === id);
    if (!o) continue;
    textos.push(`${o.tipo === 'remover' ? 'sem' : '+'} ${n > 1 ? `${n}x ${o.nome}` : o.nome}`);
  }
  return textos;
}

// ── A etapa: o máximo e o obrigatório (pedido do dono, 17/11/2026: "com o máximo 1, consegui escolher as duas batatas e
// mais de uma bebida") ───────────────────────────────────────────────────────────────────────────────────────────────
// A MESMA regra do cardápio digital (`components/loja/cardapio/produto.tsx`), agora no balcão, na mesa e no garçom. O
// servidor segue com o teto de sempre (corta a repetição no máximo, sem recusar a venda — ERR-301, ERR-505).
type Etapa = { max?: number | string | null; min?: number | string | null; obrigatorio?: boolean | null; opcoes?: { id: string }[] | null };

/** O máximo da etapa (0 ou vazio = sem limite, como no cardápio). */
export const maximoDaEtapa = (g: Etapa | null | undefined): number | null => Number(g?.max) || null;

/** Quantas escolhas da lista são desta etapa (a repetida conta cada vez). */
export const escolhasNaEtapa = (g: Etapa, escolhidas: string[]): number => {
  const ids = new Set((g.opcoes ?? []).map((o) => o.id));
  return escolhidas.filter((x) => ids.has(x)).length;
};

/**
 * Tocar numa opção de etapa SEM repetição. Marcada: desmarca. "Até 1": troca a escolha da etapa (como um botão de rádio).
 * Máximo maior: não passa dele (a lista volta igual). As escolhas das outras etapas ficam como estão.
 */
export function alternarOpcao(g: Etapa, escolhidas: string[], id: string): string[] {
  if (escolhidas.includes(id)) return escolhidas.filter((x) => x !== id);
  const max = maximoDaEtapa(g);
  if (max === 1) {
    const ids = new Set((g.opcoes ?? []).map((o) => o.id));
    return [...escolhidas.filter((x) => !ids.has(x)), id];
  }
  if (max != null && escolhasNaEtapa(g, escolhidas) >= max) return escolhidas;
  return [...escolhidas, id];
}

/** A etapa pede escolha antes de pôr no pedido ("Obrigatório" ou mínimo). */
export const etapaObrigatoria = (g: Etapa | null | undefined): boolean => !!(g?.obrigatorio || Number(g?.min) > 0);

/** A etapa já tem o que precisa: a obrigatória, o mínimo (ou 1); a opcional, sempre. */
export const etapaCompleta = (g: Etapa, escolhidas: string[]): boolean =>
  !etapaObrigatoria(g) || escolhasNaEtapa(g, escolhidas) >= (Number(g.min) || 1);

/** A primeira etapa que ainda falta escolher, na ordem da tela (nenhuma = null). */
export function etapaQueFalta<G extends Etapa>(grupos: G[], escolhidas: string[]): G | null {
  return grupos.find((g) => !etapaCompleta(g, escolhidas)) ?? null;
}
