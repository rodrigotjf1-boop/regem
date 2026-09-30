import { createHash, randomBytes } from 'crypto';

// O TOKEN de integração por loja: `rgm_it_` + 32 bytes aleatórios em base64url (43 caracteres).
// Mostrado UMA vez, na emissão; o banco guarda só o SHA-256 (hex) do token inteiro e um prefixo
// curto para reconhecer na tela. Nunca vai para log, mensagem de erro nem auditoria.

export const PREFIXO_TOKEN_INTEGRACAO = 'rgm_it_';
const FORMATO = /^rgm_it_[A-Za-z0-9_-]{43}$/;

/** Formato conferido SEM ir ao banco: o que não tem a cara de um token nem é procurado. */
export function formatoTokenIntegracao(token: unknown): token is string {
  return typeof token === 'string' && FORMATO.test(token);
}

export function hashTokenIntegracao(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** `rgm_it_` + 5 caracteres: o bastante para achar o token na lista, sem dar o token. */
export function prefixoTokenIntegracao(token: string): string {
  return token.slice(0, PREFIXO_TOKEN_INTEGRACAO.length + 5);
}

export function gerarTokenIntegracao(): { token: string; hash: string; prefixo: string } {
  const token = PREFIXO_TOKEN_INTEGRACAO + randomBytes(32).toString('base64url');
  return { token, hash: hashTokenIntegracao(token), prefixo: prefixoTokenIntegracao(token) };
}
