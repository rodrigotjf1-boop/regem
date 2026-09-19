// Verifica a ASSINATURA Ed25519 de um release do edge. Chamado pelo atualizar.ps1
// (verificar assinatura no PowerShell 5.1 é doloroso; node tem crypto).
//
// Uso:
//   node verify-update.mjs <versao> <sha256> <url> <assinatura-base64>              (v1)
//   node verify-update.mjs <versao> <sha256> <url> <assinatura-base64> <expira-iso> (v2)
//
// Mensagens assinadas (IDÊNTICAS ao sign-update.mjs e ao console da distribuição):
//   v1: "versao|sha256|url"
//   v2: "regem-edge-v2|versao|sha256|url|expira"  — com VALIDADE: metadado velho reapresentado
//       depois de vencer é recusado (ataque de "congelamento", modelo TUF). O prefixo impede que
//       uma assinatura v1 seja aceita como v2 e vice-versa.
//
// Chave(s) PÚBLICA(S) (PEM SPKI): env EDGE_UPDATE_PUBLIC_KEY (PEM ou base64 do PEM) ou o
// arquivo edge/update-pub.pem ao lado deste script. O arquivo pode ter VÁRIOS blocos PEM:
// vale se QUALQUER um conferir — é assim que se troca a chave sem parar as lojas (a próxima
// chave entra no arquivo um release antes de começar a ser usada).
//
// Códigos de saída: 0 = VÁLIDA · 1 = INVÁLIDA · 2 = sem chave/argumentos · 3 = v2 VENCIDA
// (ou data de validade ilegível). Quem decide o que fazer com o 2 é o atualizar.ps1.
import { verify as edVerify, createPublicKey } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export function mensagemV1(versao, sha256, url) {
  return `${versao}|${sha256}|${url}`;
}
export function mensagemV2(versao, sha256, url, expira) {
  return `regem-edge-v2|${versao}|${sha256}|${url}|${expira}`;
}

// Separa um texto com 1..N blocos "-----BEGIN PUBLIC KEY-----" em chaves.
export function chavesDoPem(texto) {
  const blocos = String(texto ?? '').match(/-----BEGIN PUBLIC KEY-----[\s\S]+?-----END PUBLIC KEY-----/g) ?? [];
  const chaves = [];
  for (const b of blocos) {
    try { chaves.push(createPublicKey(b)); } catch { /* bloco ilegível: ignora */ }
  }
  return chaves;
}

export function lerChavesPublicas() {
  const env = (process.env.EDGE_UPDATE_PUBLIC_KEY || '').trim();
  if (env) return chavesDoPem(env.includes('BEGIN') ? env : Buffer.from(env, 'base64').toString('utf8'));
  const f = fileURLToPath(new URL('./update-pub.pem', import.meta.url));
  return existsSync(f) ? chavesDoPem(readFileSync(f, 'utf8')) : [];
}

// → 0 válida · 1 inválida · 2 sem chave/args · 3 vencida
export function verificar({ versao, sha256, url, assinatura, expira, chaves, agora = Date.now() }) {
  if (!chaves?.length || !assinatura || !versao || !sha256 || !url) return 2;
  let msg;
  if (expira) {
    const t = Date.parse(expira);
    if (!Number.isFinite(t) || t <= agora) return 3;
    msg = mensagemV2(versao, sha256, url, expira);
  } else {
    msg = mensagemV1(versao, sha256, url);
  }
  let sig;
  try { sig = Buffer.from(assinatura, 'base64'); } catch { return 1; }
  for (const k of chaves) {
    try { if (edVerify(null, Buffer.from(msg, 'utf8'), k, sig)) return 0; } catch { /* tenta a próxima */ }
  }
  return 1;
}

// Execução direta (não quando importado por teste).
if (process.argv[1] && fileURLToPath(import.meta.url).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  const [, , versao, sha256, url, assinatura, expira] = process.argv;
  const rc = verificar({ versao, sha256, url, assinatura, expira, chaves: lerChavesPublicas() });
  if (rc === 3) console.error(`verify-update: assinatura VENCIDA ou validade ilegível (${expira}).`);
  process.exit(rc);
}
