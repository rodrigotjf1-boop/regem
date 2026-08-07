// TOTP (RFC 6238) na mão — sem dependência externa. Usado pelo MFA da distribuição
// (F9.5). HMAC-SHA1, passo de 30s, 6 dígitos, janela ±1 (tolera relógio defasado).
import { createHmac, randomBytes } from 'crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// Gera um segredo aleatório em base32 (20 bytes → 32 chars).
export function gerarSegredoBase32(): string {
  const buf = randomBytes(20);
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');
  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)];
  return out;
}

function base32Decode(s: string): Buffer {
  const limpo = s.replace(/=+$/, '').toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';
  for (const ch of limpo) {
    const v = B32.indexOf(ch);
    if (v < 0) continue;
    bits += v.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const buf = Buffer.alloc(8);
  // counter em 64 bits big-endian (o topo cabe em 32 bits no horizonte útil).
  buf.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  buf.writeUInt32BE(counter >>> 0, 4);
  const h = createHmac('sha1', secret).update(buf).digest();
  const off = h[h.length - 1] & 0x0f;
  const bin = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return (bin % 1_000_000).toString().padStart(6, '0');
}

// Verifica o código com janela ±1 passo (contra drift de relógio).
export function verificarTotp(segredoBase32: string, codigo: string, agora = Date.now()): boolean {
  const cod = String(codigo ?? '').replace(/\D/g, '');
  if (cod.length !== 6 || !segredoBase32) return false;
  const secret = base32Decode(segredoBase32);
  const step = Math.floor(agora / 1000 / 30);
  for (let w = -1; w <= 1; w++) {
    if (hotp(secret, step + w) === cod) return true;
  }
  return false;
}

// URI otpauth:// para o QR do app autenticador (Google Authenticator, Authy…).
export function otpauthUri(segredoBase32: string, conta: string, emissor = 'Regem Distribuicao'): string {
  const label = encodeURIComponent(`${emissor}:${conta}`);
  const params = `secret=${segredoBase32}&issuer=${encodeURIComponent(emissor)}&digits=6&period=30`;
  return `otpauth://totp/${label}?${params}`;
}
