// O TEMPO DE ESPERA AGORA (item 2 do plano das leituras do Mister para o atendente — aprovado pelo dono em 26/11/2026).
// O atendente só tinha o tempo CONFIGURADO da loja ("40 min"); na hora do pico, prometia 40 com a cozinha levando o dobro.
//
// A conta é RELATIVA, de propósito: compara quanto a cozinha está levando AGORA (os pedidos que ficaram prontos ou saíram na
// última hora) com o NORMAL da loja (a mesma medida nos 7 dias anteriores) e, só quando está mais lenta, soma a diferença ao
// tempo configurado. Medir o tempo inteiro até "concluído" engana: na loja piloto (14 dias, 26/11), o Anota Aí concluía
// em 103 min na mediana — o fechamento é tardio —, enquanto "pronto ou saiu" ficava em 12 a 16 min em todos os canais. A
// diferença entre AGORA e o NORMAL da mesma medida não depende de como cada canal fecha o pedido.
//
// Nunca abaixo do configurado (a loja escolheu o que promete); sem amostra que baste, nada (vale o configurado). O cliente
// recebe só a faixa — nunca quantos pedidos há, a fila nem por que está lento.

export type AmostraDaCozinha = {
  /** Pedidos que ficaram prontos ou saíram na última hora (o "agora"), e a mediana do tempo deles, em minutos. */
  nAgora: number;
  medianaAgoraMin: number | null;
  /** Os mesmos dos 7 dias anteriores (o "normal"). */
  nNormal: number;
  medianaNormalMin: number | null;
};

export type TempoAgora = { de: number; ate: number };

/** Abaixo disto, a amostra não diz nada (poucos pedidos na última hora / no histórico). */
export const MINIMO_AGORA = 4;
export const MINIMO_NORMAL = 20;
/** Atraso que vale contar (menos que isto é ruído). */
export const ATRASO_MINIMO_MIN = 5;

const paraCima5 = (n: number) => Math.ceil(n / 5) * 5;

/** Quantos minutos a cozinha está MAIS LENTA que o normal agora (null = não está, ou não dá para saber). */
export function atrasoDaCozinha(a: AmostraDaCozinha): number | null {
  if (a.nAgora < MINIMO_AGORA || a.nNormal < MINIMO_NORMAL) return null;
  if (a.medianaAgoraMin == null || a.medianaNormalMin == null) return null;
  const atraso = a.medianaAgoraMin - a.medianaNormalMin;
  return atraso >= ATRASO_MINIMO_MIN ? atraso : null;
}

/** A faixa de agora para um tipo (entrega ou retirada): o configurado + o atraso, de 5 em 5 min, com 10 min de folga. */
export function tempoAgoraDoTipo(configuradoMin: unknown, atraso: number | null): TempoAgora | null {
  const base = Number(configuradoMin);
  if (atraso == null || !Number.isFinite(base) || base <= 0) return null;
  const de = paraCima5(base + atraso);
  return { de, ate: de + 10 };
}
