import { createHash, randomBytes } from 'crypto';

// O CLIQUE DE AUTORIZAÇÃO COM UM PRODUTO DA DMS (Padrão DMS §3) — as peças sem banco que o clique do Orzuni (mig 416) e o
// do DMS Graph (mig 450) usam do mesmo jeito. O Regem é quem PEDE: empurra o pedido ao produto (RFC 9126, com o token do
// DMS ID do aplicativo), abre a página do produto com o número do pedido, e na volta troca o código pela ligação, com o
// verificador do PKCE (RFC 7636). O `state` e o verificador nunca vão para log, mensagem de erro nem banco (do state, só
// o SHA-256; o verificador, cifrado). As formas do número e do código são de cada produto (`orz_`, `gph_`): ficam lá.

/** Minutos que o pedido vale aqui (o produto vence o dele no mesmo prazo). */
export const VALIDADE_DO_PEDIDO_MS = 10 * 60_000;

const FORMATO_DO_ESTADO = /^[A-Za-z0-9_-]{43}$/;

export const resumoDoEstado = (estado: string): string => createHash('sha256').update(estado, 'utf8').digest('hex');

/** Um pedido novo: o `state` (43 caracteres), o verificador do PKCE (43) e o desafio S256. */
export function novoPedido(): { estado: string; verificador: string; desafio: string } {
  const estado = randomBytes(32).toString('base64url');
  const verificador = randomBytes(32).toString('base64url');
  return { estado, verificador, desafio: createHash('sha256').update(verificador, 'ascii').digest('base64url') };
}

export const estadoValido = (v: unknown): v is string => typeof v === 'string' && FORMATO_DO_ESTADO.test(v);

/**
 * O endereço da página de autorização do produto para o navegador: o que o produto devolveu no pedido, só se for https (ou
 * a própria máquina, em teste); senão o `padrao`. Leva só o aplicativo e o número do pedido.
 */
export function paginaDeAutorizacao(devolvido: unknown, padrao: string, clientId: string, numero: string): string {
  let base = padrao;
  if (typeof devolvido === 'string') {
    try {
      const u = new URL(devolvido);
      const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
      if (!u.username && !u.password && (u.protocol === 'https:' || (local && u.protocol === 'http:'))) base = `${u.origin}${u.pathname}`;
    } catch {
      /* fica o padrão */
    }
  }
  const u = new URL(base);
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('request_uri', numero);
  return u.toString();
}

/** O que a volta do produto trouxe na query, sem confiar em nada: só textos. */
export function lerVolta(q: unknown): { code: string | null; state: string | null; iss: string | null; error: string | null } {
  const o = (q !== null && typeof q === 'object' ? q : {}) as Record<string, unknown>;
  const t = (v: unknown) => (typeof v === 'string' && v.length <= 400 ? v : null);
  return { code: t(o.code), state: t(o.state), iss: t(o.iss), error: t(o.error) };
}

/** O tipo do problema de uma recusa em `application/problem+json` (`…/problemas/integracao-parada` → `integracao-parada`). */
export function problemaDoCorpo(corpo: unknown, status: number): string {
  const tipo = corpo && typeof corpo === 'object' ? (corpo as { type?: unknown }).type : undefined;
  return String(tipo ?? '').split('/').pop() || `http-${status}`;
}
