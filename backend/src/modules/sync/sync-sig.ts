import { createHash, createHmac } from 'node:crypto';

// Assinatura do push de sync (edge → nuvem). A chave HMAC é DERIVADA do token do
// dispositivo (já é o segredo compartilhado edge↔nuvem) — sem novo provisionamento.
// O MESMO algoritmo é reimplementado em backend/edge/sync-daemon.mjs — qualquer
// mudança aqui tem que ser espelhada lá, senão a verificação falha.

// Serialização estável (chaves ordenadas) — a assinatura não pode depender da ordem
// de chaves do JSON.
export function stableSync(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableSync).join(',') + ']';
  const o = v as Record<string, unknown>;
  return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + stableSync(o[k])).join(',') + '}';
}

export function chaveSync(token: string): string {
  return createHash('sha256').update('regem-sync-v1|' + token).digest('hex');
}

// sig = HMAC-SHA256(chave, `${seq}.${ts}.${stable(lotes)}`)
export function assinarSync(token: string, seq: number | string, ts: string, lotes: unknown): string {
  return createHmac('sha256', chaveSync(token))
    .update(`${seq}.${ts}.${stableSync(lotes)}`)
    .digest('hex');
}
