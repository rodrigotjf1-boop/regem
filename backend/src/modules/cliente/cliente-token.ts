import { createHmac } from 'node:crypto';

// Token assinado do cliente do cardápio ("link mágico"): identifica o cliente
// sem senha. HMAC-SHA256 sobre { cli, tenant } com o segredo do app. Guardado no
// navegador do cliente; os endpoints públicos validam a assinatura.

function segredo(): string {
  return process.env.JWT_SECRET || process.env.CLIENTE_TOKEN_SECRET || 'regem-dev-secret';
}

const b64u = (s: string) => Buffer.from(s).toString('base64url');
const unb64u = (s: string) => Buffer.from(s, 'base64url').toString('utf8');

function assinatura(payload: string): string {
  return createHmac('sha256', segredo()).update(payload).digest('base64url');
}

export function assinarCliente(clienteId: string, tenantId: string): string {
  const payload = b64u(JSON.stringify({ cli: clienteId, tenant: tenantId, iat: Date.now() }));
  return `${payload}.${assinatura(payload)}`;
}

export function verificarCliente(
  token?: string | null,
): { cli: string; tenant: string } | null {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || assinatura(payload) !== sig) return null;
  try {
    const d = JSON.parse(unb64u(payload));
    if (!d?.cli || !d?.tenant) return null;
    return { cli: d.cli, tenant: d.tenant };
  } catch {
    return null;
  }
}
