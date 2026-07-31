// Gera a CA INTERNA de ASSINATURA DE CÓDIGO do Regem (rota sem custo anual).
// Roda UMA ÚNICA VEZ, na máquina segura da DISTRIBUIÇÃO. Produz:
//   - backend/edge/code-signing-ca.pem  -> PÚBLICO. Commitar no repo; o instalador
//     confia ele em cada máquina (Root + TrustedPublisher) = "editor verificado".
//   - desktop/signing/code-signing.pfx  -> SEGREDO (chave privada). NUNCA vai pro
//     git nem pro edge. Fica só com a distribuição; é o que assina o .exe no build.
//
// Por ser cert INTERNO (não de CA pública), a regra de HSM não se aplica: o .pfx
// comum funciona com o electron-builder (CSC_LINK/CSC_KEY_PASSWORD).
//
//   node edge/gerar-ca-assinatura.mjs [--cn="DMS Regem"] [--senha=...] [--forcar]
//   (sem --senha, lê CSC_KEY_PASSWORD; sem nada, gera uma senha forte e imprime.)
//
// ⚠️ Regenerar INVALIDA a confiança já distribuída nas máquinas: só use --forcar
//    sabendo que todo instalador/app assinado com a CA antiga deixa de ser confiável.
import { mkdirSync, writeFileSync, existsSync } from 'fs';
import forge from 'node-forge';

const arg = (k, d) => {
  const p = process.argv.find((a) => a.startsWith(`--${k}=`));
  return p ? p.slice(k.length + 3) : d;
};
const tem = (k) => process.argv.includes(`--${k}`);

const winPath = (u) => u.pathname.replace(/^\/([A-Za-z]:)/, '$1');
const pemPath = winPath(new URL('./code-signing-ca.pem', import.meta.url));
const signDir = winPath(new URL('../../desktop/signing/', import.meta.url));
const pfxPath = signDir + 'code-signing.pfx';

if ((existsSync(pemPath) || existsSync(pfxPath)) && !tem('forcar')) {
  console.error('Já existe CA de assinatura. Use --forcar para regerar (INVALIDA a confiança já distribuída).');
  process.exit(1);
}

const cn = arg('cn', 'DMS Regem');
const senha = arg('senha', process.env.CSC_KEY_PASSWORD || '');
let senhaFinal = senha;
if (!senhaFinal) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  senhaFinal = Array.from(forge.random.getBytesSync(28), (c) => alfabeto[c.charCodeAt(0) % alfabeto.length]).join('');
}

const anos = (base, n) => { const d = new Date(base); d.setFullYear(d.getFullYear() + n); return d; };
const agora = new Date();
const ontem = new Date(agora.getTime() - 24 * 3600 * 1000); // margem p/ relógio adiantado
const serial = () => Math.floor(agora.getTime() / 1000).toString(16) + forge.util.bytesToHex(forge.random.getBytesSync(4));

// ---- CA raiz de assinatura (auto-assinada, longa p/ não invalidar a confiança) ----
const caKeys = forge.pki.rsa.generateKeyPair(3072);
const caCert = forge.pki.createCertificate();
caCert.publicKey = caKeys.publicKey;
caCert.serialNumber = serial();
caCert.validity.notBefore = ontem;
caCert.validity.notAfter = anos(agora, 20);
const caSubject = [{ name: 'commonName', value: `${cn} Code Signing CA` }, { name: 'organizationName', value: cn }];
caCert.setSubject(caSubject);
caCert.setIssuer(caSubject);
caCert.setExtensions([
  { name: 'basicConstraints', cA: true, critical: true },
  { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
]);
caCert.sign(caKeys.privateKey, forge.md.sha256.create());

// ---- Certificado FOLHA de assinatura (o "publisher"; assina o .exe) ----
const leafKeys = forge.pki.rsa.generateKeyPair(3072);
const leafCert = forge.pki.createCertificate();
leafCert.publicKey = leafKeys.publicKey;
leafCert.serialNumber = serial();
leafCert.validity.notBefore = ontem;
leafCert.validity.notAfter = anos(agora, 10);
const leafSubject = [{ name: 'commonName', value: cn }, { name: 'organizationName', value: cn }];
leafCert.setSubject(leafSubject);
leafCert.setIssuer(caSubject);
leafCert.setExtensions([
  { name: 'basicConstraints', cA: false, critical: true },
  { name: 'keyUsage', digitalSignature: true, critical: true },
  { name: 'extKeyUsage', codeSigning: true }, // 1.3.6.1.5.5.7.3.3 — Authenticode
]);
leafCert.sign(caKeys.privateKey, forge.md.sha256.create());

// ---- Saídas ----
writeFileSync(pemPath, forge.pki.certificateToPem(caCert)); // público (repo/instalador)
mkdirSync(signDir, { recursive: true });
// .pfx = chave privada da folha + cadeia (folha + CA) para o signtool embutir a cadeia.
const p12 = forge.pkcs12.toPkcs12Asn1(leafKeys.privateKey, [leafCert, caCert], senhaFinal, { friendlyName: cn });
writeFileSync(pfxPath, Buffer.from(forge.asn1.toDer(p12).getBytes(), 'binary'));

console.log('CA de assinatura de código gerada.');
console.log(`- Público (commitar):  ${pemPath}`);
console.log(`- Segredo (NÃO commitar, guardar em cofre): ${pfxPath}`);
if (!senha) console.log(`- Senha do .pfx (guarde AGORA, não é recuperável):\n    ${senhaFinal}`);
console.log('\nNo build (desktop/): defina as envs e rode `npm run dist`:');
console.log(`    setx CSC_LINK "${pfxPath}"`);
console.log('    setx CSC_KEY_PASSWORD "<a senha acima>"');
console.log('\nCommite SÓ o code-signing-ca.pem. O .pfx e a senha ficam só com a distribuição.');
