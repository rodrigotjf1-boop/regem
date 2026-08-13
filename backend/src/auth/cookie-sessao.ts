// Cookie de sessão (httpOnly) — Fase B da migração do JWT para fora do localStorage.
//
// A NUVEM passa a guardar o token num cookie httpOnly (o JS não lê → XSS não rouba a
// sessão). O EDGE e as integrações continuam no header Bearer (LAN/HTTP não casa com
// Secure/SameSite; API externa manda header). O guard aceita os dois: header tem
// prioridade; sem header, cai no cookie.
import type { Request, Response } from 'express';

export const COOKIE_SESSAO = 'regem_sess';

// 12h = mesmo TTL do JWT (auth.module signOptions).
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

function opcoesBase() {
  const isProd = process.env.NODE_ENV === 'production';
  const domain = process.env.COOKIE_DOMAIN?.trim() || undefined; // default: host-only
  return {
    httpOnly: true,
    secure: isProd, // nuvem é https; no edge/dev (http) fica false
    sameSite: 'lax' as const, // app.→api. é same-site → cookie vai; cross-site POST barrado (anti-CSRF)
    domain,
    path: '/',
  };
}

// Grava o cookie de sessão na resposta (login/register na nuvem).
export function setCookieSessao(res: Response, token: string) {
  res.cookie(COOKIE_SESSAO, token, { ...opcoesBase(), maxAge: MAX_AGE_MS });
}

// Remove o cookie de sessão (logout). Mesmos atributos, senão o browser não apaga.
export function limparCookieSessao(res: Response) {
  const { maxAge: _omit, ...base } = { ...opcoesBase(), maxAge: 0 };
  res.clearCookie(COOKIE_SESSAO, base);
}

// Lê o token do cookie (sem cookie-parser — parse manual do header, zero dependência).
export function lerCookieSessao(req: Request): string | undefined {
  const raw = req.headers?.cookie;
  if (!raw) return undefined;
  for (const parte of raw.split(';')) {
    const i = parte.indexOf('=');
    if (i === -1) continue;
    if (parte.slice(0, i).trim() === COOKIE_SESSAO) {
      return decodeURIComponent(parte.slice(i + 1).trim());
    }
  }
  return undefined;
}
