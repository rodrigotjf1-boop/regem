// ASSINA um release do edge com Ed25519 (Fase 3) — par do verify-update.mjs.
// Roda na máquina SEGURA da distribuição (é onde vive a chave privada).
//
// Mensagem assinada: "versao|sha256|url" (IDÊNTICA ao verify-update.mjs).
//
// Dois modos:
//   1) Gerar o par de chaves (UMA vez):
//        node edge/sign-update.mjs --gerar-chaves
//      -> escreve edge/update-priv.pem (SEGREDO, gitignored) + edge/update-pub.pem
//         (público: commitar; vai no pacote e o verify-update.mjs o lê na loja).
//      -> imprime EDGE_UPDATE_PUBLIC_KEY (base64 do PEM) p/ colar no regem-api também.
//
//   2) Assinar uma versão (depois de subir o zip e saber a URL final):
//        node edge/sign-update.mjs 1.5.0 <sha256> https://storage/regem-edge-1.5.0.zip
//      -> imprime a assinatura base64 e a env EDGE_UPDATE_SIG p/ colar no regem-api.
//
// Chave privada: env EDGE_UPDATE_PRIVATE_KEY (PEM inteiro ou base64 do PEM), ou
// o arquivo edge/update-priv.pem ao lado deste script.
import { generateKeyPairSync, sign as edSign, createPrivateKey } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const tem = (f) => args.includes(f);
const privPath = fileURLToPath(new URL('./update-priv.pem', import.meta.url));
const pubPath = fileURLToPath(new URL('./update-pub.pem', import.meta.url));

// ---- Modo 1: gerar o par de chaves ----
if (tem('--gerar-chaves')) {
  if ((existsSync(privPath) || existsSync(pubPath)) && !tem('--forcar')) {
    console.error('Já existe par de chaves de update. Use --forcar para regerar');
    console.error('(INVALIDA todo release assinado com a chave antiga).');
    process.exit(1);
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  writeFileSync(privPath, privPem); // SEGREDO — fica só com a distribuição
  writeFileSync(pubPath, pubPem); // público — commitar; vai no pacote
  console.log('Par de chaves de update (Ed25519) gerado.');
  console.log(`- Segredo (NÃO commitar, cofre): ${privPath}`);
  console.log(`- Público (commitar, vai no pacote): ${pubPath}`);
  console.log('\nOpcional — no regem-api (EasyPanel) a chave pública também pode ir por env:');
  console.log('   EDGE_UPDATE_PUBLIC_KEY=' + Buffer.from(pubPem).toString('base64'));
  console.log('\nDepois commite o update-pub.pem e rode edge/publicar.ps1 p/ ele entrar no pacote.');
  process.exit(0);
}

// ---- Modo 2: assinar uma versão ----
const [versao, sha256, url] = args;
if (!versao || !sha256 || !url) {
  console.error('Uso: node edge/sign-update.mjs <versao> <sha256> <url>');
  console.error('  ou: node edge/sign-update.mjs --gerar-chaves');
  process.exit(2);
}

function chavePrivada() {
  const env = (process.env.EDGE_UPDATE_PRIVATE_KEY || '').trim();
  if (env) return env.includes('BEGIN') ? env : Buffer.from(env, 'base64').toString('utf8');
  if (existsSync(privPath)) return readFileSync(privPath, 'utf8');
  return null;
}

const pem = chavePrivada();
if (!pem) {
  console.error('Sem chave privada. Defina EDGE_UPDATE_PRIVATE_KEY ou gere com --gerar-chaves.');
  process.exit(2);
}

const msg = Buffer.from(`${versao}|${sha256}|${url}`, 'utf8');
const sig = edSign(null, msg, createPrivateKey(pem)).toString('base64');
console.log('Assinatura Ed25519 do release (mensagem: versao|sha256|url):');
console.log('   EDGE_UPDATE_SIG=' + sig);
console.log('\nCole essa env no regem-api (EasyPanel) junto com EDGE_LATEST_VERSION/_URL/_SHA256 e reinicie.');
