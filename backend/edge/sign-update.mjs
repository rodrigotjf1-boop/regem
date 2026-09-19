// ASSINA um release do edge com Ed25519 — par do verify-update.mjs.
// Roda na máquina SEGURA da distribuição (é onde vive a chave privada). NÃO vai no pacote
// da loja (package.mjs barra as ferramentas da distribuição).
//
// Mensagens assinadas (IDÊNTICAS ao verify-update.mjs e ao console da distribuição):
//   v1: "versao|sha256|url"                                — lojas na versão antiga
//   v2: "regem-edge-v2|versao|sha256|url|expira"           — com validade (padrão 180 dias)
//
// Modos:
//   1) Gerar o par de chaves (UMA vez):          node edge/sign-update.mjs --gerar-chaves
//   2) Derivar a PÚBLICA da privada existente:   node edge/sign-update.mjs --derivar-publica
//      -> escreve edge/update-pub.pem (público: commitar; vai no pacote; a loja confere com ele)
//   3) Assinar uma versão (depois de subir o zip e saber a URL final):
//        node edge/sign-update.mjs 1.30.0 <sha256> https://storage/regem-edge-1.30.0.zip [--expira-dias=180]
//      -> imprime assinatura v1, assinatura v2 e a validade, para colar no console da distribuição.
//
// Chave privada: env EDGE_UPDATE_PRIVATE_KEY (PEM inteiro ou base64 do PEM), ou o arquivo
// edge/update-priv.pem ao lado deste script (gitignored).
//
// TROCA DE CHAVE (sem parar as lojas): gere o par novo em outra pasta, ACRESCENTE a pública
// nova ao update-pub.pem (o arquivo aceita vários blocos) e publique um release assinado com a
// chave ANTIGA. Quando a frota estiver nele, passe a assinar com a nova e, depois, tire a antiga.
import { generateKeyPairSync, sign as edSign, createPrivateKey, createPublicKey } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mensagemV1, mensagemV2 } from './verify-update.mjs';

const args = process.argv.slice(2);
const tem = (f) => args.includes(f);
const opcao = (k, d) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const privPath = fileURLToPath(new URL('./update-priv.pem', import.meta.url));
const pubPath = fileURLToPath(new URL('./update-pub.pem', import.meta.url));

function chavePrivada() {
  const env = (process.env.EDGE_UPDATE_PRIVATE_KEY || '').trim();
  if (env) return env.includes('BEGIN') ? env : Buffer.from(env, 'base64').toString('utf8');
  if (existsSync(privPath)) return readFileSync(privPath, 'utf8');
  return null;
}

// ---- Modo 1: gerar o par de chaves ----
if (tem('--gerar-chaves')) {
  if ((existsSync(privPath) || existsSync(pubPath)) && !tem('--forcar')) {
    console.error('Já existe par de chaves de update. Use --forcar para regerar');
    console.error('(INVALIDA todo release assinado com a chave antiga — prefira a troca descrita no topo).');
    process.exit(1);
  }
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  writeFileSync(privPath, privateKey.export({ type: 'pkcs8', format: 'pem' })); // SEGREDO
  writeFileSync(pubPath, publicKey.export({ type: 'spki', format: 'pem' })); // público
  console.log('Par de chaves de update (Ed25519) gerado.');
  console.log(`- Segredo (NÃO commitar, cofre): ${privPath}`);
  console.log(`- Público (commitar, vai no pacote): ${pubPath}`);
  process.exit(0);
}

// ---- Modo 2: derivar a pública da privada existente ----
if (tem('--derivar-publica')) {
  const pem = chavePrivada();
  if (!pem) { console.error('Sem chave privada (EDGE_UPDATE_PRIVATE_KEY ou edge/update-priv.pem).'); process.exit(2); }
  const pub = createPublicKey(createPrivateKey(pem)).export({ type: 'spki', format: 'pem' });
  if (existsSync(pubPath)) {
    const atual = readFileSync(pubPath, 'utf8');
    if (atual.includes(pub.trim())) { console.log(`update-pub.pem já contém esta chave: ${pubPath}`); process.exit(0); }
    if (!tem('--forcar')) {
      console.error('update-pub.pem existe com OUTRA chave. Para acrescentar (troca de chave), edite à mão;');
      console.error('para substituir, use --forcar.');
      process.exit(1);
    }
  }
  writeFileSync(pubPath, pub);
  console.log(`Chave pública escrita em ${pubPath} — commite o arquivo.`);
  process.exit(0);
}

// ---- Modo 3: assinar uma versão ----
const [versao, sha256, url] = args.filter((a) => !a.startsWith('--'));
if (!versao || !sha256 || !url) {
  console.error('Uso: node edge/sign-update.mjs <versao> <sha256> <url> [--expira-dias=180]');
  console.error('  ou: node edge/sign-update.mjs --gerar-chaves | --derivar-publica');
  process.exit(2);
}
if (!/^[0-9a-f]{64}$/.test(sha256)) { console.error('sha256 inválido (64 hex minúsculos).'); process.exit(2); }
const dias = Number(opcao('expira-dias', '180'));
if (!Number.isFinite(dias) || dias < 1 || dias > 730) { console.error('--expira-dias entre 1 e 730.'); process.exit(2); }

const pem = chavePrivada();
if (!pem) {
  console.error('Sem chave privada. Defina EDGE_UPDATE_PRIVATE_KEY ou gere com --gerar-chaves.');
  process.exit(2);
}
const priv = createPrivateKey(pem);
const expira = new Date(Date.now() + dias * 86400000).toISOString();
const v1 = edSign(null, Buffer.from(mensagemV1(versao, sha256, url), 'utf8'), priv).toString('base64');
const v2 = edSign(null, Buffer.from(mensagemV2(versao, sha256, url, expira), 'utf8'), priv).toString('base64');

console.log('Assinaturas Ed25519 do release — cole no console da distribuição (Publicar release):');
console.log('   EDGE_UPDATE_SIG=' + v1);
console.log('   EDGE_UPDATE_SIG_V2=' + v2);
console.log('   EDGE_UPDATE_EXPIRA=' + expira);
console.log(`\nA v2 vence em ${dias} dias: depois disso nenhuma loja instala este release — publique um novo`);
console.log('ou assine de novo (mesmo pacote) antes de vencer.');
