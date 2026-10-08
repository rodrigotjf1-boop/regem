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
