/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A ÁREA DE ENTREGA DESENHADA NO MAPA, do lado da tela (mig 425; protótipo `mockups/regem-area-entrega-mapa.html`, aprovado
 * em 15/11/2026). A MESMA conta do servidor (`backend/src/modules/cardapio/area-de-entrega.ts`), que decide de verdade:
 * a tela só avisa antes. `npm run check:area` compara as duas com os mesmos pontos (V74).
 */

export type AreaNoMapa = {
  poligono: [number, number][];
  taxa: number;
  tempoMin?: number | null;
  tempoMax?: number | null;
  pedidoMinimo?: number | null;
  freteGratisAcima?: number | null;
  ativo?: boolean;
  ordem: number;
};

/** O ponto está dentro do polígono? Raio que cruza as arestas (par/ímpar), em graus — a conta do servidor. */
export function pontoNoPoligono(lat: number, lng: number, poligono: unknown): boolean {
  if (!Array.isArray(poligono) || poligono.length < 3 || !Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  let dentro = false;
  for (let i = 0, j = poligono.length - 1; i < poligono.length; j = i++) {
    const yi = Number(poligono[i]?.[0]);
    const xi = Number(poligono[i]?.[1]);
    const yj = Number(poligono[j]?.[0]);
    const xj = Number(poligono[j]?.[1]);
    if (![yi, xi, yj, xj].every(Number.isFinite)) return false;
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) dentro = !dentro;
  }
  return dentro;
}

/** A área que atende o ponto: a de menor `ordem` entre as ativas que o contêm (a de cima da lista), ou null. */
export function areaDoPonto<T extends AreaNoMapa>(areas: T[] | null | undefined, lat: number, lng: number): T | null {
  return (
    [...(areas ?? [])]
      .filter((a) => a.ativo !== false)
      .sort((a, b) => a.ordem - b.ordem)
      .find((a) => pontoNoPoligono(lat, lng, a.poligono)) ?? null
  );
}

/** O tempo da área em texto ("25–35 min", "~40 min"), ou null. */
export function tempoDaArea(a: { tempoMin?: number | null; tempoMax?: number | null } | null | undefined): string | null {
  if (!a) return null;
  const de = a.tempoMin ?? null;
  const ate = a.tempoMax ?? null;
  if (de != null && ate != null) return de === ate ? `~${de} min` : `${de}–${ate} min`;
  if (ate != null || de != null) return `~${ate ?? de} min`;
  return null;
}

/** Área aproximada em km² (projeção local) — só para dar noção do tamanho na lista. */
export function km2(poligono: [number, number][]): number {
  if (!Array.isArray(poligono) || poligono.length < 3) return 0;
  const R = 6371;
  const rad = Math.PI / 180;
  const lat0 = Number(poligono[0][0]) * rad;
  const xy = poligono.map(([la, lo]) => [lo * rad * R * Math.cos(lat0), la * rad * R]);
  let s = 0;
  for (let i = 0, j = xy.length - 1; i < xy.length; j = i++) s += (xy[j][0] + xy[i][0]) * (xy[j][1] - xy[i][1]);
  return Math.abs(s / 2);
}

/** Um círculo como polígono (36 cantos) — para converter as faixas de km em áreas. */
export function circuloComoPoligono(lat: number, lng: number, km: number, cantos = 36): [number, number][] {
  const dLat = km / 111.32;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: cantos }, (_, i) => {
    const t = (i / cantos) * 2 * Math.PI;
    return [Math.round((lat + dLat * Math.sin(t)) * 1e6) / 1e6, Math.round((lng + dLng * Math.cos(t)) * 1e6) / 1e6] as [number, number];
  });
}
