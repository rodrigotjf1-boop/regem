import { createPublicKey, KeyObject, verify as edVerify } from 'node:crypto';

// Conferência das assinaturas dos releases do servidor local — ESPELHO do
// edge/verify-update.mjs (a loja confere com aquele; o console da distribuição confere com
// este ANTES de publicar, para nunca publicar um release que as lojas vão recusar).
// `update-assinatura.spec.ts` garante que as mensagens e a chave são as mesmas nos dois.

// Chave PÚBLICA de update (a mesma de backend/edge/update-pub.pem). Não é segredo. A imagem
// da nuvem leva só o dist, por isso a constante; EDGE_UPDATE_PUBLIC_KEY (PEM ou base64)
// substitui/acrescenta na troca de chave.
export const CHAVE_PUBLICA_UPDATE = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAnFfcwW/+0gAuoEROK6sMiXhYCgGNF6xOrojjLwr9FBA=
-----END PUBLIC KEY-----`;

export function mensagemV1(versao: string, sha256: string, url: string): string {
  return `${versao}|${sha256}|${url}`;
}
export function mensagemV2(versao: string, sha256: string, url: string, expira: string): string {
  return `regem-edge-v2|${versao}|${sha256}|${url}|${expira}`;
}

export function chavesDoPem(texto: string): KeyObject[] {
  const blocos =
    String(texto ?? '').match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g) ?? [];
  const out: KeyObject[] = [];
  for (const b of blocos) {
    try {
      out.push(createPublicKey(b));
    } catch {
      /* bloco ilegível */
    }
  }
  return out;
}

export function chavesPublicasUpdate(): KeyObject[] {
  const env = (process.env.EDGE_UPDATE_PUBLIC_KEY ?? '').trim();
  const doEnv = env ? (env.includes('BEGIN') ? env : Buffer.from(env, 'base64').toString('utf8')) : '';
  return chavesDoPem(`${CHAVE_PUBLICA_UPDATE}\n${doEnv}`);
}

export function assinaturaConfere(
  mensagem: string,
  assinaturaB64: string,
  chaves: KeyObject[] = chavesPublicasUpdate(),
): boolean {
  let sig: Buffer;
  try {
    sig = Buffer.from(String(assinaturaB64 ?? ''), 'base64');
  } catch {
    return false;
  }
  if (sig.length !== 64) return false; // Ed25519 = 64 bytes
  return chaves.some((k) => {
    try {
      return edVerify(null, Buffer.from(mensagem, 'utf8'), k, sig);
    } catch {
      return false;
    }
  });
}
