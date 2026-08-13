// Guard anti-SSRF para URLs que o LOJISTA cadastra (webhook n8n, webhook de OTP,
// baseUrl de integração). Sem isto, o servidor faria fetch para hosts arbitrários
// — inclusive metadata da cloud (169.254.169.254), localhost e a rede interna da
// VPS. Bloqueia protocolo não-http(s), hostnames locais e IPs privados, resolvendo
// o DNS (defesa contra DNS rebinding: checa TODOS os IPs resolvidos).
import { lookup } from 'node:dns/promises';
import net from 'node:net';

function ipPrivadoOuLocal(ip: string): boolean {
  const v = net.isIP(ip);
  if (v === 0) return true; // não é IP válido → trata como suspeito
  if (v === 4) {
    if (/^127\./.test(ip)) return true; // loopback
    if (/^10\./.test(ip)) return true; // privado
    if (/^192\.168\./.test(ip)) return true; // privado
    if (/^169\.254\./.test(ip)) return true; // link-local / metadata cloud
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true; // 172.16–172.31
    if (/^0\./.test(ip)) return true;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return true; // CGNAT 100.64/10
    return false;
  }
  // IPv6
  const low = ip.toLowerCase();
  if (low === '::1' || low === '::') return true;
  if (low.startsWith('fc') || low.startsWith('fd')) return true; // ULA
  if (low.startsWith('fe80')) return true; // link-local
  if (low.startsWith('::ffff:')) return ipPrivadoOuLocal(low.slice(7)); // IPv4-mapped
  return false;
}

// true = URL pública e segura para fetch a partir do servidor.
export async function urlPublicaSegura(u?: string | null): Promise<boolean> {
  if (!u) return false;
  let url: URL;
  try {
    url = new URL(u);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  const host = url.hostname.replace(/^\[|\]$/g, ''); // tira colchetes de IPv6
  const h = host.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal'))
    return false;
  if (net.isIP(host)) return !ipPrivadoOuLocal(host);
  try {
    const enderecos = await lookup(host, { all: true });
    if (!enderecos.length) return false;
    return enderecos.every((e) => !ipPrivadoOuLocal(e.address));
  } catch {
    return false; // não resolveu → não arrisca
  }
}
