// Regra pura (sem rede) do campo de unidade de medida: reconhecer, na lista fechada que veio do
// servidor, o que já estava gravado de outro jeito ("un" → unidade, "Porções" → porção).
// Conferida por `scripts/check-unidades.mjs`.
export type ListaDeUnidades = { unidades: string[]; apelidos: Record<string, string> };

// A mesma chave do servidor (`backend/src/modules/estoque/unidades.ts`): sem acento, minúscula,
// sem ponto, espaços juntos.
export const chaveDaUnidade = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A unidade da lista que corresponde ao texto; `null` se não há (ou se a lista ainda não chegou). */
export function unidadeDaLista(texto: string | null | undefined, lista: ListaDeUnidades | null): string | null {
  if (!texto || !lista) return null;
  if (lista.unidades.includes(texto)) return texto;
  const u = lista.apelidos[chaveDaUnidade(texto)];
  return u && lista.unidades.includes(u) ? u : null;
}
