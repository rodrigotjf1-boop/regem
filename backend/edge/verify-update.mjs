// Verifica a ASSINATURA Ed25519 de um release do edge (Fase 3). Chamado pelo
// atualizar.ps1 (verificar assinatura no PowerShell 5.1 é doloroso; node tem crypto).
//
// Uso:  node verify-update.mjs <versao> <sha256> <url> <assinatura-base64>
// Mensagem assinada: "versao|sha256|url". A chave PÚBLICA (PEM SPKI) vem de:
//   - env EDGE_UPDATE_PUBLIC_KEY (PEM inteiro, ou base64 do PEM), ou
//   - arquivo edge/update-pub.pem ao lado deste script.
// Códigos de saída:  0 = assinatura VÁLIDA · 1 = INVÁLIDA · 2 = sem chave/assinatura
// (o ps1 decide: tolera, a menos que EDGE_REQUIRE_SIGNED_UPDATE=true).
import { verify as edVerify } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const [, , versao, sha256, url, assinatura] = process.argv;

function chavePublica() {
  const env = (process.env.EDGE_UPDATE_PUBLIC_KEY || '').trim();
  if (env) return env.includes('BEGIN') ? env : Buffer.from(env, 'base64').toString('utf8');
  const f = fileURLToPath(new URL('./update-pub.pem', import.meta.url));
  if (existsSync(f)) return readFileSync(f, 'utf8');
  return null;
}

const pem = chavePublica();
if (!pem || !assinatura || !versao || !sha256 || !url) process.exit(2);

try {
  const msg = Buffer.from(`${versao}|${sha256}|${url}`, 'utf8');
  const ok = edVerify(null, msg, pem, Buffer.from(assinatura, 'base64'));
  process.exit(ok ? 0 : 1);
} catch (e) {
  console.error('verify-update: ' + (e?.message ?? e));
  process.exit(1);
}
