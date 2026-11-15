/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A ÁREA DE ENTREGA DO PEDIDO DO CARDÁPIO (15/11/2026, pedido do dono — ERR-470). O pedido #71 da loja-piloto saiu a ~119 km,
 * num lugar sem entrega, com frete R$ 0,00, e foi pago no Pix: o cancelamento devolveu o dinheiro, mas o gateway já tinha
 * cobrado a tarifa. Até aqui, além da última faixa o cardápio cobrava a taxa da ÚLTIMA faixa (a desta loja é R$ 0) em vez de
 * recusar, e no modo bairro o pedido sem bairro da lista entrava com frete zero. Agora o pedido fora da área é RECUSADO antes
 * de existir — e, por isso, antes de qualquer cobrança. A tela confere o mesmo antes de chegar aqui (`frontend/.../etapas.ts`).
 *
 * Regra (a mesma do robô, `robo-pedido.service.ts#enderecoConferido`, que já recusava):
 *  • distância (modo `raio`, com as faixas e o ponto da loja cadastrados): além da última faixa → recusa; endereço que não se
 *    acha no mapa → recusa (pede para conferir ou usar a localização);
 *  • DESENHADA NO MAPA (modo `mapa`, mig 425 — protótipo `mockups/regem-area-entrega-mapa.html`, aprovado 15/11): o ponto do
 *    cliente dentro de uma área ATIVA → a taxa, o tempo, o pedido mínimo e o frete grátis dela (onde duas se cruzam, vale a de
 *    menor `ordem`); fora de todas (ou só em área pausada, ou sem área nenhuma) → recusa; endereço que não se acha → recusa;
 *  • bairro: sem um bairro da lista de entrega → recusa;
 *  • cadastro da loja incompleto (modo distância sem faixas ou sem o ponto da loja): não recusa — é a configuração da loja que
 *    falta, e recusar pararia todas as entregas dela sem aviso (fica como antes). No modo mapa a tela não deixa ligar o modo
 *    sem pelo menos uma área no ar.
 *
 * A conta "o ponto está dentro?" é a MESMA na tela (`frontend/src/lib/area-entrega.ts`); `npm run check:area` no frontend
 * compara as duas com os mesmos pontos.
 */

export type AreaDesenhada = {
  id: string;
  nome: string;
  /** Os cantos em ordem: [[lat, lng], ...]. */
  poligono: [number, number][];
  taxa: number;
  tempoMin: number | null;
  tempoMax: number | null;
  pedidoMinimo: number | null;
  freteGratisAcima: number | null;
  ativo: boolean;
  ordem: number;
};

export type ResultadoDaTaxa = {
  alemDaUltimaFaixa: boolean;
  semLocalizacao: boolean;
  km: number | null;
  bairro: { id: string; nome: string } | null;
  /** Modo mapa: a área que atende o ponto (null = fora de todas). */
  area?: AreaDesenhada | null;
};

export type RecusaDaArea = {
  code: 'FORA_DA_AREA' | 'ENDERECO_NAO_ENCONTRADO' | 'BAIRRO_FORA_DA_AREA' | 'PEDIDO_MINIMO_DA_AREA';
  message: string;
};

/** Limites do cadastro (os mesmos da tela). */
export const MAX_AREAS = 30;
export const MAX_PONTOS = 300;

const umaCasa = (n: number) => (Math.round(n * 10) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 });
const reais = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** O alcance da entrega por distância: a maior faixa cadastrada (km), ou null sem faixa válida. */
export function alcanceDasFaixas(raios: unknown): number | null {
  const kms = (Array.isArray(raios) ? raios : []).map((r: any) => Number(r?.ateKm)).filter((n) => Number.isFinite(n) && n > 0);
  return kms.length ? Math.max(...kms) : null;
}

/** O modo distância só funciona com as faixas e o ponto da loja. */
export function raioConfigurado(cfg: any): boolean {
  // `Number(null)` e `Number('')` dão 0 (um ponto no oceano): coordenada vazia não conta.
  const coord = (v: unknown) => v != null && String(v).trim() !== '' && Number.isFinite(Number(v));
  return alcanceDasFaixas(cfg?.raios) != null && coord(cfg?.endLat) && coord(cfg?.endLng);
}

/**
 * O ponto está dentro do polígono? Raio que cruza as arestas (par/ímpar), em graus — numa área de entrega (poucos km) a
 * curvatura não pesa. Ponto exatamente na borda: o resultado depende do lado (a tela e o servidor fazem a MESMA conta).
 */
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

/** A área que atende o ponto: a de menor `ordem` entre as ATIVAS que o contêm (a de cima da lista), ou null. */
export function areaDoPonto(areas: AreaDesenhada[], lat: number, lng: number): AreaDesenhada | null {
  return [...areas].filter((a) => a.ativo).sort((a, b) => a.ordem - b.ordem).find((a) => pontoNoPoligono(lat, lng, a.poligono)) ?? null;
}

const numeroOuNulo = (v: unknown): number | null => {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/**
 * Confere e normaliza a lista que a tela manda ao salvar (a ordem da lista é a `ordem`). Recusa com a frase para a tela —
 * nada é gravado se uma área estiver errada (V86: toda recusa antes da 1ª gravação).
 */
export function conferirAreas(lista: unknown): { ok: true; areas: Omit<AreaDesenhada, 'id'>[] } | { ok: false; erro: string } {
  if (!Array.isArray(lista)) return { ok: false, erro: 'Lista de áreas inválida.' };
  if (lista.length > MAX_AREAS) return { ok: false, erro: `No máximo ${MAX_AREAS} áreas por loja.` };
  const areas: Omit<AreaDesenhada, 'id'>[] = [];
  for (const [i, a] of lista.entries()) {
    const nome = String(a?.nome ?? '').trim().slice(0, 40);
    const rotulo = nome ? `A área "${nome}"` : `A área ${i + 1}`;
    if (!nome) return { ok: false, erro: `${rotulo} está sem nome.` };
    const pontos = Array.isArray(a?.poligono) ? a.poligono : [];
    if (pontos.length < 3) return { ok: false, erro: `${rotulo} precisa de pelo menos 3 cantos no mapa.` };
    if (pontos.length > MAX_PONTOS) return { ok: false, erro: `${rotulo} tem mais de ${MAX_PONTOS} cantos.` };
    const poligono: [number, number][] = [];
    for (const p of pontos) {
      const lat = Number(p?.[0]);
      const lng = Number(p?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
        return { ok: false, erro: `${rotulo} tem um canto fora do mapa.` };
      poligono.push([Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]);
    }
    const taxa = numeroOuNulo(a?.taxa) ?? 0;
    const tempoMin = numeroOuNulo(a?.tempoMin);
    const tempoMax = numeroOuNulo(a?.tempoMax);
    const pedidoMinimo = numeroOuNulo(a?.pedidoMinimo);
    const freteGratisAcima = numeroOuNulo(a?.freteGratisAcima);
    if (!Number.isFinite(taxa) || taxa < 0) return { ok: false, erro: `${rotulo}: a taxa de entrega tem de ser um valor a partir de zero.` };
    for (const [campo, v] of [['o pedido mínimo', pedidoMinimo], ['o frete grátis acima de', freteGratisAcima]] as const)
      if (v != null && (!Number.isFinite(v) || v < 0)) return { ok: false, erro: `${rotulo}: ${campo} tem de ser um valor a partir de zero.` };
    for (const v of [tempoMin, tempoMax])
      if (v != null && (!Number.isInteger(v) || v < 0 || v > 600)) return { ok: false, erro: `${rotulo}: o tempo de entrega tem de ser em minutos (0 a 600).` };
    if (tempoMin != null && tempoMax != null && tempoMax < tempoMin)
      return { ok: false, erro: `${rotulo}: o tempo "até" tem de ser maior ou igual ao "de".` };
    areas.push({
      nome,
      poligono,
      taxa: Math.round(taxa * 100) / 100,
      tempoMin,
      tempoMax,
      pedidoMinimo,
      freteGratisAcima,
      ativo: a?.ativo !== false,
      ordem: i,
    });
  }
  return { ok: true, areas };
}

/** Por que o pedido de ENTREGA não pode sair para este endereço — ou null (pode). `totalItens` = os itens, sem a taxa. */
export function recusaDaArea(cfg: any, t: ResultadoDaTaxa, totalItens?: number): RecusaDaArea | null {
  if (cfg?.areaModo === 'raio') {
    if (!raioConfigurado(cfg)) return null;
    if (t.semLocalizacao)
      return {
        code: 'ENDERECO_NAO_ENCONTRADO',
        message: 'Não encontramos esse endereço no mapa para calcular a entrega. Confira a rua e o número, ou use a sua localização.',
      };
    if (t.alemDaUltimaFaixa) {
      const alcance = alcanceDasFaixas(cfg.raios)!;
      const onde = t.km != null ? `ele fica a ~${umaCasa(t.km)} km da loja, e a entrega vai até ${umaCasa(alcance)} km` : `a entrega vai até ${umaCasa(alcance)} km`;
      return { code: 'FORA_DA_AREA', message: `Não entregamos nesse endereço: ${onde}. Confira o endereço.` };
    }
    return null;
  }
  if (cfg?.areaModo === 'mapa') {
    if (t.semLocalizacao)
      return {
        code: 'ENDERECO_NAO_ENCONTRADO',
        message: 'Não encontramos esse endereço no mapa para calcular a entrega. Confira a rua e o número, ou use a sua localização.',
      };
    if (!t.area) return { code: 'FORA_DA_AREA', message: 'Não entregamos nesse endereço: ele fica fora da nossa área de entrega. Confira o endereço.' };
    if (t.area.pedidoMinimo != null && totalItens != null && totalItens + 0.005 < t.area.pedidoMinimo)
      return {
        code: 'PEDIDO_MINIMO_DA_AREA',
        message: `Para este endereço, o pedido mínimo é ${reais(t.area.pedidoMinimo)} em itens (a taxa de entrega não conta).`,
      };
    return null;
  }
  if (!t.bairro) return { code: 'BAIRRO_FORA_DA_AREA', message: 'Não entregamos nesse bairro. Escolha um dos bairros da lista de entrega.' };
  return null;
}

/** A área da linha do banco (numérico vem como texto). */
export function areaDaLinha(r: any): AreaDesenhada {
  const n = (v: unknown) => (v == null ? null : Number(v));
  return {
    id: String(r.id),
    nome: String(r.nome ?? ''),
    poligono: Array.isArray(r.poligono) ? r.poligono : [],
    taxa: Number(r.taxa) || 0,
    tempoMin: n(r.tempoMin ?? r.tempo_min),
    tempoMax: n(r.tempoMax ?? r.tempo_max),
    pedidoMinimo: n(r.pedidoMinimo ?? r.pedido_minimo),
    freteGratisAcima: n(r.freteGratisAcima ?? r.frete_gratis_acima),
    ativo: r.ativo !== false,
    ordem: Number(r.ordem) || 0,
  };
}
