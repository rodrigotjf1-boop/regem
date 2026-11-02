/* eslint-disable @typescript-eslint/no-explicit-any */

// O "ENTREGUE" PERTO DO ENDEREÇO quando o pedido não tem código (a loja desligou o código de entrega, mig 348; decisão
// do dono de 01/11/2026). Sem o código, o "entregue" seria só o toque do entregador — tocado na loja ou no caminho, a hora
// da entrega e o tempo das etapas ficam errados. O app manda a posição do momento do toque (também pela fila sem
// internet), e o servidor confere a distância até o endereço do pedido.

/**
 * Raio em volta do endereço em que o "Entregue" vale. Largo de propósito: o GPS erra dentro de prédio e condomínio, e o
 * endereço é achado pelo mapa. O que se quer barrar é o "entregue" tocado na loja ou no caminho.
 */
export const RAIO_ENTREGUE_M = 300;
/** A precisão que o próprio GPS informa entra como folga, até este teto (uma leitura ruim não vira passe livre). */
export const FOLGA_MAXIMA_M = 150;

export type LocalInformado = { lat: number; lng: number; precisao: number | null };

/** A posição que o app mandou, conferida; null = não veio ou veio inválida (app antigo, GPS desligado). */
export function localInformado(v: unknown): LocalInformado | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as any;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (lat === 0 && lng === 0) return null; // o "sem posição" de alguns aparelhos
  const p = o.precisao == null ? null : Number(o.precisao);
  return { lat, lng, precisao: p != null && Number.isFinite(p) && p >= 0 ? p : null };
}

/** Longe demais do endereço para valer o "entregue"? */
export function longeDoEndereco(distanciaM: number, precisao: number | null): boolean {
  return distanciaM - Math.min(precisao ?? 0, FOLGA_MAXIMA_M) > RAIO_ENTREGUE_M;
}

/** A distância para a pessoa ler: "850 m", "2,4 km". */
export function distanciaParaLer(m: number): string {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

/** A recusa que o entregador lê (no app e no aviso da fila sem internet). O botão do painel é o FINALIZAR. */
export function textoDeLonge(distanciaM: number): string {
  return `Você está a ${distanciaParaLer(distanciaM)} do endereço do cliente. Marque "Entregue" quando estiver lá. Se já está no endereço, peça à loja para finalizar o pedido no painel.`;
}
