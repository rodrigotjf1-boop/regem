import { createHash } from 'crypto';

// Limite de chamadas POR TOKEN DE INTEGRAÇÃO (API `/api/v1/integracao/*`, trilha C).
//
// O limite global é por IP (120/min, `cf-throttler.guard`). O worker do Liame chama de UM IP
// para MUITAS lojas — no limite por IP, uma loja grande deixaria as outras sem dados (429).
// Trocar a chave do limite para o token abriria uma brecha: cada token inventado ganharia um
// balde novo. Mesmo desenho da fila de impressão (`dispositivo-limite.ts`):
//  • o `IntegracaoTokenGuard` registra aqui o token que ELE validou no banco;
//  • o `CfThrottlerGuard` só isenta do limite por IP a rota de integração com token JÁ
//    validado (desconhecido, formato errado ou inventado continua no limite por IP);
//  • o token validado fica no limite próprio abaixo — contado em TODA chamada dele, inclusive a
//    que termina em 403 por escopo (senão a isenção do IP viraria chamada sem limite);
//  • o token que o banco deixa de reconhecer (revogado, vencido, loja apagada) sai da isenção na
//    mesma chamada (`esquecerTokenIntegracao`) — senão ele seguiria fora dos dois limites até a
//    marca vencer, cada chamada indo ao banco.
// Em memória por processo: é proteção de carga, não de segurança (a autenticação é o guard, no
// banco, a cada chamada — revogar vale na chamada seguinte).

const VALIDADE_MS = 10 * 60 * 1000;
const JANELA_MS = 60 * 1000;
export const LIMITE_INTEGRACAO_POR_MINUTO = 60;

const validados = new Map<string, number>(); // hash do token → validado até
const contagem = new Map<string, { inicio: number; n: number }>();

const hash = (t: string) => createHash('sha256').update(t).digest('hex').slice(0, 32);

export function registrarTokenIntegracaoValidado(token: string) {
  validados.set(hash(token), Date.now() + VALIDADE_MS);
  if (validados.size > 50_000) limparVencidos();
}

/** O token deixou de valer: a próxima chamada com ele volta ao limite por IP. */
export function esquecerTokenIntegracao(token: string) {
  validados.delete(hash(token));
}

export function tokenIntegracaoJaValidado(token: string | undefined | null): boolean {
  if (!token) return false;
  const ate = validados.get(hash(String(token)));
  return !!ate && ate > Date.now();
}

/**
 * Conta uma chamada do token. `ok: false` = passou do limite na janela de 1 minuto;
 * `retryAfterSeg` = quanto falta para a janela virar (vai no cabeçalho `Retry-After`).
 */
export function contarChamadaIntegracao(tokenId: string): { ok: boolean; retryAfterSeg: number } {
  const agora = Date.now();
  const c = contagem.get(tokenId);
  if (!c || agora - c.inicio >= JANELA_MS) {
    contagem.set(tokenId, { inicio: agora, n: 1 });
    if (contagem.size > 50_000) limparVencidos();
    return { ok: true, retryAfterSeg: 0 };
  }
  c.n++;
  return {
    ok: c.n <= LIMITE_INTEGRACAO_POR_MINUTO,
    retryAfterSeg: Math.max(1, Math.ceil((c.inicio + JANELA_MS - agora) / 1000)),
  };
}

function limparVencidos() {
  const agora = Date.now();
  for (const [k, ate] of validados) if (ate <= agora) validados.delete(k);
  for (const [k, c] of contagem) if (agora - c.inicio >= JANELA_MS) contagem.delete(k);
}

/** A rota é da API de integração (`/api/v1/integracao/...`)? */
export function rotaDaIntegracao(url: string | undefined): boolean {
  return /^\/api\/v1\/integracao(\/|\?|$)/.test(String(url ?? ''));
}

/** O token do cabeçalho `Authorization: Bearer …` (ou `null`). */
export function bearerDe(req: any): string | null {
  const raw = req?.headers?.authorization;
  const h = Array.isArray(raw) ? raw[0] : raw;
  if (typeof h !== 'string') return null;
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h);
  return m ? m[1] : null;
}
