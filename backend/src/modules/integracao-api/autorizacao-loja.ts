import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { AUTORIZACAO_LOJA, CLIENTES_INTEGRACAO } from './escopos';

// AUTORIZAÇÃO PELA LOJA (trilha C, C1b) — as peças sem banco: o código de uso único, o PKCE, o
// cliente (segredo e endereços de volta, do ambiente) e o endereço para onde a pessoa volta.
//
// O fluxo (docs do Liame, `integracoes/regem.md` §1): o Liame abre `/integracoes/autorizar` com
// `cliente`, `redirect_uri`, `state`, `code_challenge` (S256); o presidente escolhe as lojas e o
// que libera; o Regem devolve a pessoa ao `redirect_uri` com `code` e `state`; o servidor do
// Liame troca o `code` (com o `code_verifier` e o segredo de cliente) pelos tokens das lojas.
// O código e o segredo NUNCA vão para log, mensagem de erro nem auditoria.

export const PREFIXO_CODIGO_AUTORIZACAO = 'rgm_ac_';
/** Minutos que o código vale. */
export const VALIDADE_CODIGO_MIN = 10;
/** O segredo de cliente mais curto que isto é tratado como não configurado. */
export const SEGREDO_MINIMO = 32;

const FORMATO_CODIGO = /^rgm_ac_[A-Za-z0-9_-]{43}$/;
// PKCE (RFC 7636): o desafio S256 é o SHA-256 do verificador em base64url (43 caracteres); o
// verificador tem de 43 a 128 caracteres "não reservados".
const FORMATO_DESAFIO = /^[A-Za-z0-9_-]{43}$/;
const FORMATO_VERIFICADOR = /^[A-Za-z0-9\-._~]{43,128}$/;
// O `state` é do cliente: volta como veio. Só caracteres visíveis, sem espaço.
const FORMATO_ESTADO = /^[\x21-\x7E]{16,200}$/;

export function gerarCodigoAutorizacao(): { codigo: string; hash: string } {
  const codigo = PREFIXO_CODIGO_AUTORIZACAO + randomBytes(32).toString('base64url');
  return { codigo, hash: hashCodigoAutorizacao(codigo) };
}

export function hashCodigoAutorizacao(codigo: string): string {
  return createHash('sha256').update(codigo, 'utf8').digest('hex');
}

/** Formato conferido SEM ir ao banco: o que não tem a cara de um código nem é procurado. */
export function formatoCodigoAutorizacao(v: unknown): v is string {
  return typeof v === 'string' && FORMATO_CODIGO.test(v);
}

export function desafioValido(v: unknown): v is string {
  return typeof v === 'string' && FORMATO_DESAFIO.test(v);
}

export function estadoValido(v: unknown): v is string {
  return typeof v === 'string' && FORMATO_ESTADO.test(v);
}

const iguais = (a: string, b: string): boolean => {
  // Compara os SHA-256: mesmo tamanho sempre, e o tempo não depende de onde os textos diferem.
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
};

/** O verificador do PKCE confere com o desafio guardado na autorização? */
export function verificadorConfere(verificador: unknown, desafio: string): boolean {
  if (typeof verificador !== 'string' || !FORMATO_VERIFICADOR.test(verificador)) return false;
  return iguais(createHash('sha256').update(verificador, 'ascii').digest('base64url'), desafio);
}

/** Endereço de volta aceitável: https, ou http só para a própria máquina (desenvolvimento e teste). */
function enderecoDeVoltaValido(u: string): boolean {
  try {
    const url = new URL(u);
    if (url.username || url.password || url.hash) return false;
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  } catch {
    return false;
  }
}

export type ClienteAutorizacao = {
  chave: string;
  rotulo: string;
  /** Endereços de volta aceitos (comparação exata). */
  redirectUris: string[];
  /** `null` = a distribuição ainda não configurou: a página não abre e a troca recusa. */
  segredo: string | null;
};

/**
 * O cliente que pode pedir autorização pela loja, com o que o ambiente configurou. `null` =
 * cliente desconhecido ou que não usa esta página (o RegemCast, hoje).
 */
export function clienteAutorizacao(chave: unknown, env: NodeJS.ProcessEnv = process.env): ClienteAutorizacao | null {
  if (typeof chave !== 'string' || !Object.prototype.hasOwnProperty.call(AUTORIZACAO_LOJA, chave)) return null;
  const cfg = AUTORIZACAO_LOJA[chave];
  const doAmbiente = String(env[cfg.envRedirect] ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  const segredo = String(env[cfg.envSegredo] ?? '');
  return {
    chave,
    rotulo: CLIENTES_INTEGRACAO[chave]?.rotulo ?? chave,
    redirectUris: (doAmbiente.length ? doAmbiente : [...cfg.redirectPadrao]).filter(enderecoDeVoltaValido),
    segredo: segredo.length >= SEGREDO_MINIMO ? segredo : null,
  };
}

export function redirectPermitido(c: ClienteAutorizacao, uri: unknown): uri is string {
  return typeof uri === 'string' && c.redirectUris.includes(uri);
}

export function segredoConfere(c: ClienteAutorizacao, segredo: unknown): boolean {
  return c.segredo !== null && typeof segredo === 'string' && segredo.length > 0 && iguais(segredo, c.segredo);
}

/** O endereço de volta com os parâmetros da resposta (`code` + `state`, ou `error` + `state`). */
export function urlDeVolta(redirectUri: string, params: Record<string, string>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}
