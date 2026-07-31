// Compatibilidade de versão cliente↔servidor (Fase 1.3). O cliente magro (casca)
// e o servidor (edge-core) trocam versões no handshake e RECUSAM combinações
// incompatíveis (evita cliente novo falando com servidor velho e vice-versa).
// Bump em mudança que quebra o contrato edge↔cliente.
export const APP_VERSION = process.env.APP_VERSION ?? '0.0.0';

// Cliente mais ANTIGO que este servidor aceita (o cliente compara sua versão ≥ isto).
export const MIN_CLIENT_VERSION = '1.0.0';
// Servidor mais ANTIGO que um cliente atual aceita (informado ao cliente p/ ele checar).
export const MIN_SERVER_VERSION = '1.0.0';

// Compara semver simples "maior.menor.patch": -1 se a<b, 0 igual, 1 se a>b.
export function cmpVersao(a: string, b: string): number {
  const pa = String(a).split('.').map((n) => Number(n) || 0);
  const pb = String(b).split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
