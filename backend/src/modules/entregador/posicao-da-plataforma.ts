/* eslint-disable @typescript-eslint/no-explicit-any */

// A POSIÇÃO EXATA do cliente que o iFood e a 99 mandam no pedido (ponte do chat, parte A2 — pedido do dono, 04/11/2026:
// "conciliar o endereço da 99 e do iFood no nosso mapa"). Antes o Regem procurava o endereço pelo TEXTO (geocodificação),
// que erra rua com nome repetido, número que o mapa não tem e condomínio — e o "o entregador está chegando" saía cedo,
// tarde ou nunca. Conferido na nuvem em 04/11: o iFood manda a posição em 1.709 de 1.711 pedidos
// (`delivery.deliveryAddress.coordinates`) e a 99 em todos os 823 (`receive_address.poi_lat/poi_lng`, `coordinate_type`
// = "wgs84" — o padrão do GPS).

export type Posicao = { lat: number; lng: number };

const numero = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Só posição de verdade: dentro do globo e longe do (0, 0), que é o "sem posição" de muito sistema. */
function valida(lat: number | null, lng: number | null): Posicao | null {
  if (lat == null || lng == null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return null;
  return { lat, lng };
}

/** A posição que a plataforma mandou no pedido (`pedido_externo.raw`), ou null (outro canal, sem posição ou suspeita). */
export function posicaoDaPlataforma(canal: unknown, raw: any): Posicao | null {
  if (!raw || typeof raw !== 'object') return null;
  if (canal === 'ifood') {
    const c = raw?.delivery?.deliveryAddress?.coordinates;
    return valida(numero(c?.latitude), numero(c?.longitude));
  }
  if (canal === '99food') {
    const a = raw?.receive_address;
    // Outro sistema de coordenadas (o "gcj02" chinês desloca centenas de metros) não serve para o mapa daqui.
    const tipo = typeof a?.coordinate_type === 'string' ? a.coordinate_type.trim().toLowerCase() : '';
    if (tipo && tipo !== 'wgs84') return null;
    return valida(numero(a?.poi_lat), numero(a?.poi_lng));
  }
  return null;
}
