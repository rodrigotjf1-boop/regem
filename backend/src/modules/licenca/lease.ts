import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as edSign,
  verify as edVerify,
  KeyObject,
} from 'crypto';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Lease de licença = token ASSIMÉTRICO (Ed25519). A nuvem assina com a privada;
// o edge só verifica com a PÚBLICA → não consegue forjar. `kid` permite rotação.
// Chaves via env (PEM em base64): LICENSE_PRIVATE_KEY_B64 / LICENSE_PUBLIC_KEY_B64.
// Sem env → gera par efêmero (dev; não persiste entre restarts).

const KID = process.env.LICENSE_KID ?? 'k1';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

let priv: KeyObject | null = null;
let pub: KeyObject | null = null;
function chaves() {
  if (priv && pub) return { priv, pub };
  const pkB64 = process.env.LICENSE_PRIVATE_KEY_B64;
  const pubB64 = process.env.LICENSE_PUBLIC_KEY_B64;
  if (pkB64 && pubB64) {
    priv = createPrivateKey(Buffer.from(pkB64, 'base64').toString('utf8'));
    pub = createPublicKey(Buffer.from(pubB64, 'base64').toString('utf8'));
  } else {
    // Em produção, um par EFÊMERO invalidaria as licenças a cada restart e não
    // casaria com a chave pública do edge — recusa (fail-fast).
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'LICENSE_PRIVATE_KEY_B64/LICENSE_PUBLIC_KEY_B64 ausentes em produção — recusando gerar par efêmero.',
      );
    }
    // eslint-disable-next-line no-console
    console.warn('[lease] LICENSE_*_KEY_B64 ausentes — usando par EFÊMERO (apenas dev).');
    const kp = generateKeyPairSync('ed25519');
    priv = kp.privateKey;
    pub = kp.publicKey;
  }
  return { priv, pub };
}

// A licença está configurada (chaves presentes)? Usado para falhar com mensagem
// clara (e log) ANTES de tentar assinar, em vez de estourar um 500 opaco.
export function licencaConfigurada(): boolean {
  return !!(
    process.env.LICENSE_PRIVATE_KEY_B64 && process.env.LICENSE_PUBLIC_KEY_B64
  );
}

export interface LeasePayload {
  tenantId: string;
  ramo: string;
  plano: string;
  modulos: string[];
  exp: number | null; // epoch ms; null = sem prazo
  iat: number; // epoch ms (emissão)
  srv: number; // epoch ms do servidor (anti-rollback de relógio no edge)
}

export function assinarLease(p: Omit<LeasePayload, 'iat' | 'srv'>): string {
  const { priv } = chaves();
  const agora = Date.now();
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: KID })));
  const payload = b64url(Buffer.from(JSON.stringify({ ...p, iat: agora, srv: agora })));
  const assinatura = b64url(edSign(null, Buffer.from(`${header}.${payload}`), priv!));
  return `${header}.${payload}.${assinatura}`;
}

// Verifica a assinatura e devolve o payload (ou null se inválido). Usado no EDGE.
export function verificarLease(lease: string): LeasePayload | null {
  try {
    const { pub } = chaves();
    const [h, p, s] = lease.split('.');
    if (!h || !p || !s) return null;
    const ok = edVerify(null, Buffer.from(`${h}.${p}`), pub!, fromB64url(s));
    if (!ok) return null;
    return JSON.parse(fromB64url(p).toString('utf8'));
  } catch {
    return null;
  }
}

// Chave pública (PEM) para embutir no edge/instalador.
export function chavePublicaPem(): string {
  return chaves().pub.export({ type: 'spki', format: 'pem' }).toString();
}
