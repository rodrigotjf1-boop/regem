import { createHash } from 'crypto';
import { ProblemaException } from './problema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CURSOR OPACO da API de integração (contrato de cupons §2, que o de vendas segue): a ordem é
// estável por (`atualizado_em`, `id`). Por dentro, base64url de um JSON curto:
//   k — a rota ('venda' | 'cliente'): cursor de uma rota não vale na outra;
//   l — o vínculo com a EMPRESA e a LOJA do token (hash curto): cursor de uma loja não vale em
//       outra — nem de outra empresa. É ligado à loja, não ao token: o token novo da MESMA loja
//       (trocar escopos = emitir outro e revogar o antigo) segue do mesmo ponto;
//   t — o carimbo em texto com MICROSSEGUNDOS (o `Date` do JS perderia o µs e repetiria ou
//       pularia linhas);
//   i — o id do último item entregue;
//   d — o `confirmados_desde` da carga inicial, que fica dentro do cursor.
// Nada disso é segredo: todo filtro de empresa e loja vem SEMPRE do token, nunca do cursor.

export type RotaCursor = 'venda' | 'cliente';
export type PosicaoCursor = { t: string; i: string } | null;
export type Cursor = { posicao: PosicaoCursor; desde: string | null };

const INSTANTE_US = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INSTANTE_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TAMANHO_MAX = 1000;

/** Vínculo do cursor com a empresa e a loja do token (não revela os ids). */
export function vinculoCursor(tenantId: string, unidadeId: string): string {
  return createHash('sha256').update(`${tenantId}:${unidadeId}`, 'utf8').digest('base64url').slice(0, 16);
}

export function codificarCursor(rota: RotaCursor, vinculo: string, c: Cursor): string {
  const corpo = { k: rota, l: vinculo, t: c.posicao?.t ?? null, i: c.posicao?.i ?? null, d: c.desde };
  return Buffer.from(JSON.stringify(corpo), 'utf8').toString('base64url');
}

function invalido(): never {
  throw new ProblemaException(400, 'cursor-invalido', 'Cursor inválido para esta rota e esta loja — recomece sem cursor.');
}

/** Lê o cursor que o cliente devolveu. Qualquer coisa fora do formato → 400 `cursor-invalido`. */
export function lerCursor(texto: unknown, rota: RotaCursor, vinculo: string): Cursor {
  if (typeof texto !== 'string' || !texto || texto.length > TAMANHO_MAX || !/^[A-Za-z0-9_-]+$/.test(texto)) invalido();
  let corpo: any;
  try {
    corpo = JSON.parse(Buffer.from(texto, 'base64url').toString('utf8'));
  } catch {
    invalido();
  }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) invalido();
  if (corpo.k !== rota || corpo.l !== vinculo) invalido();
  const temT = corpo.t !== null && corpo.t !== undefined;
  const temI = corpo.i !== null && corpo.i !== undefined;
  if (temT !== temI) invalido();
  if (temT && (typeof corpo.t !== 'string' || !INSTANTE_US.test(corpo.t))) invalido();
  if (temI && (typeof corpo.i !== 'string' || !UUID.test(corpo.i))) invalido();
  const d = corpo.d ?? null;
  if (d !== null && (typeof d !== 'string' || !INSTANTE_ISO.test(d) || Number.isNaN(Date.parse(d)))) invalido();
  return { posicao: temT ? { t: corpo.t, i: corpo.i.toLowerCase() } : null, desde: d };
}

/**
 * `confirmados_desde` (instante ISO 8601 COM fuso: `Z` ou `±hh:mm`) → ISO normalizado em UTC.
 * Sem fuso seria ambíguo (hora de quem?) → 400.
 */
export function lerInstante(v: unknown, campo: string): string {
  const ok =
    typeof v === 'string' &&
    v.length <= 40 &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/.test(v) &&
    !Number.isNaN(Date.parse(v));
  if (!ok) {
    throw new ProblemaException(400, 'parametro-invalido', `"${campo}" tem de ser um instante ISO 8601 com fuso (ex.: 2026-07-01T00:00:00Z).`);
  }
  return new Date(Date.parse(v as string)).toISOString();
}

/** `limite` da página: padrão 200, de 1 a 500. */
export function lerLimite(v: unknown): number {
  if (v === undefined || v === null || v === '') return 200;
  if (typeof v !== 'string' || !/^\d{1,4}$/.test(v)) {
    throw new ProblemaException(400, 'parametro-invalido', '"limite" tem de ser um número inteiro de 1 a 500.');
  }
  const n = Number(v);
  if (n < 1 || n > 500) {
    throw new ProblemaException(400, 'parametro-invalido', '"limite" tem de ser um número inteiro de 1 a 500.');
  }
  return n;
}
