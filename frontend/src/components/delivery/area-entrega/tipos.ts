/* eslint-disable @typescript-eslint/no-explicit-any */

// A área de entrega desenhada no mapa, como a tela a edita (mig 425). `chave` só existe na tela (as linhas são regravadas
// inteiras ao salvar — a ordem da lista é a prioridade onde duas se cruzam).
export type AreaEditavel = {
  chave: string;
  nome: string;
  poligono: [number, number][];
  taxa: number;
  tempoMin: number | null;
  tempoMax: number | null;
  pedidoMinimo: number | null;
  freteGratisAcima: number | null;
  cor: string | null;
  ativo: boolean;
};

/** As cores das áreas no mapa (as do protótipo). */
export const CORES_DAS_AREAS = ['#0E7C66', '#E2A340', '#2C6699', '#B93232', '#7C3AED', '#C2410C'];

/** O que vai ao servidor (a ordem da lista = a `ordem`). */
export function paraSalvar(areas: AreaEditavel[]) {
  return areas.map((a) => ({
    nome: a.nome,
    poligono: a.poligono,
    taxa: a.taxa,
    tempoMin: a.tempoMin,
    tempoMax: a.tempoMax,
    pedidoMinimo: a.pedidoMinimo,
    freteGratisAcima: a.freteGratisAcima,
    cor: a.cor,
    ativo: a.ativo,
  }));
}

/** A linha que veio do servidor, como a tela edita. */
export function daLinha(r: any, i: number): AreaEditavel {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    chave: String(r?.id ?? `a${i}`),
    nome: String(r?.nome ?? ''),
    poligono: Array.isArray(r?.poligono) ? r.poligono : [],
    taxa: Number(r?.taxa) || 0,
    tempoMin: n(r?.tempoMin),
    tempoMax: n(r?.tempoMax),
    pedidoMinimo: n(r?.pedidoMinimo),
    freteGratisAcima: n(r?.freteGratisAcima),
    cor: r?.cor ?? CORES_DAS_AREAS[i % CORES_DAS_AREAS.length],
    ativo: r?.ativo !== false,
  };
}
