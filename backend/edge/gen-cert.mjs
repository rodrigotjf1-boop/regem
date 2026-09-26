// Gera a mini-CA + certificado local do edge (HTTPS na LAN, sem internet).
// O cert cobre regem.local, localhost, 127.0.0.1 e o IP passado. O instalador
// confia o CA no Windows de cada equipamento cliente -> HTTPS valido (SW + camera)
// sem aviso. Feito em Node puro (node-forge) para NAO depender de openssl no PATH.
//
//   node edge/gen-cert.mjs <IP-do-servidor>          (ex.: node edge/gen-cert.mjs 192.168.1.2)
//   node edge/gen-cert.mjs <IP-do-servidor> --novo   gera um conjunto novo mesmo se o atual serve
//
// Saida em edge/certs/: ca.pem (confiar nos clientes), server.crt, server.key
// (apontar EDGE_TLS_CERT/EDGE_TLS_KEY para eles). EDGE_CERT_DIR troca a pasta (teste).
//
// REINSTALACAO NA MESMA MAQUINA: se o conjunto atual ainda serve, ele FICA. Os aparelhos da
// loja (caixas, totem, KDS) confiam NESTA CA - trocar obrigaria cada um a confiar de novo, e o
// totem a ser pareado de novo. Antes toda (re)instalacao gerava CA nova. Serve quando: os tres
// arquivos existem e abrem, o certificado foi assinado por esta CA, a chave e a dele, nenhum
// dos dois vence em menos de 60 dias e o IP gravado nele ainda e desta maquina. Qualquer
// falha -> conjunto novo, com o motivo no log, e o anterior guardado em certs/anterior-*.
// A chave privada da CA NAO e guardada de proposito: quem a tivesse emitiria certificado
// para QUALQUER site nos aparelhos que confiam nela. Por isso um IP novo exige CA nova.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { networkInterfaces } from 'os';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import forge from 'node-forge';

const args = process.argv.slice(2);
const novo = args.includes('--novo');
const ip = (args.find((a) => !a.startsWith('--')) || '').trim();
const dir = process.env.EDGE_CERT_DIR || join(dirname(fileURLToPath(import.meta.url)), 'certs');
const ARQUIVOS = ['ca.pem', 'server.crt', 'server.key'];
const DIAS_MINIMOS = 60;
const dia = (d) => d.toISOString().slice(0, 10);
mkdirSync(dir, { recursive: true });

function ipsDoCertificado(crt) {
  const san = crt.getExtension('subjectAltName');
  return (san?.altNames ?? []).filter((a) => a.type === 7 && a.ip && a.ip !== '127.0.0.1').map((a) => a.ip);
}

function ipsDaMaquina() {
  const ips = new Set();
  for (const lista of Object.values(networkInterfaces())) {
    for (const a of lista ?? []) {
      if ((a.family === 'IPv4' || a.family === 4) && !a.internal) ips.add(a.address);
    }
  }
  return ips;
}

// Por que o conjunto atual NAO serve - ou null quando serve.
function motivoParaTrocar() {
  if (!ARQUIVOS.every((n) => existsSync(join(dir, n)))) return 'nao havia certificado nesta maquina';
  let ca;
  let crt;
  let key;
  try {
    ca = forge.pki.certificateFromPem(readFileSync(join(dir, 'ca.pem'), 'utf8'));
    crt = forge.pki.certificateFromPem(readFileSync(join(dir, 'server.crt'), 'utf8'));
    key = forge.pki.privateKeyFromPem(readFileSync(join(dir, 'server.key'), 'utf8'));
  } catch (e) {
    return `arquivos do certificado ilegiveis (${e.message})`;
  }
  let assinado = false;
  try { assinado = ca.verify(crt); } catch { /* emissor diferente */ }
  if (!assinado) return 'o certificado nao foi assinado por esta CA';
  if (key.n.compareTo(crt.publicKey.n) !== 0 || key.e.compareTo(crt.publicKey.e) !== 0) {
    return 'a chave nao e a deste certificado';
  }
  const limite = Date.now() + DIAS_MINIMOS * 24 * 3600 * 1000;
  if (crt.validity.notAfter.getTime() < limite) return `o certificado vence em ${dia(crt.validity.notAfter)}`;
  if (ca.validity.notAfter.getTime() < limite) return `a CA vence em ${dia(ca.validity.notAfter)}`;
  const doCert = ipsDoCertificado(crt);
  if (!doCert.length) return ip ? `o certificado nao cobre o IP ${ip}` : null;
  const daMaquina = ipsDaMaquina();
  // Sem rede nenhuma agora (cabo solto, Wi-Fi ainda conectando) nao da para julgar - e trocar
  // a CA derrubaria todos os aparelhos por um motivo passageiro. Mantem.
  if (!daMaquina.size) return null;
  // Compara com os IPs da MAQUINA, nao com o IP detectado agora: em PC com duas placas de rede
  // a deteccao pode escolher a outra, e os aparelhos seguem usando o IP gravado no certificado.
  if (!doCert.some((x) => daMaquina.has(x))) return `o IP do certificado (${doCert.join(', ')}) nao e mais desta maquina`;
  return null;
}

const havia = ARQUIVOS.some((n) => existsSync(join(dir, n)));
const motivo = novo ? 'pedido um certificado novo (--novo)' : motivoParaTrocar();

if (!motivo) {
  const crt = forge.pki.certificateFromPem(readFileSync(join(dir, 'server.crt'), 'utf8'));
  const doCert = ipsDoCertificado(crt);
  console.log(`Certificado MANTIDO em ${dir} - caixas, totem e KDS seguem confiando nele.`);
  console.log(`- IP: ${doCert.join(', ') || '(sem IP)'}; vale ate ${dia(crt.validity.notAfter)}`);
  process.exit(0);
}

const anos = (base, n) => { const d = new Date(base); d.setFullYear(d.getFullYear() + n); return d; };
const agora = new Date();
const ontem = new Date(agora.getTime() - 24 * 3600 * 1000); // margem p/ relogio adiantado do cliente

// ---- CA raiz (auto-assinada) ----
const caKeys = forge.pki.rsa.generateKeyPair(2048);
const caCert = forge.pki.createCertificate();
caCert.publicKey = caKeys.publicKey;
caCert.serialNumber = '01';
caCert.validity.notBefore = ontem;
caCert.validity.notAfter = anos(agora, 10);
const caSubject = [{ name: 'commonName', value: 'Regem Edge CA' }];
caCert.setSubject(caSubject);
caCert.setIssuer(caSubject);
caCert.setExtensions([
  { name: 'basicConstraints', cA: true },
  { name: 'keyUsage', keyCertSign: true, cRLSign: true },
]);
caCert.sign(caKeys.privateKey, forge.md.sha256.create());

// ---- Certificado do servidor (assinado pela CA) ----
const altNames = [
  { type: 2, value: 'regem.local' }, // 2 = DNS
  { type: 2, value: 'localhost' },
  { type: 7, ip: '127.0.0.1' },      // 7 = IP
];
if (ip) altNames.push({ type: 7, ip });

const srvKeys = forge.pki.rsa.generateKeyPair(2048);
const srvCert = forge.pki.createCertificate();
srvCert.publicKey = srvKeys.publicKey;
srvCert.serialNumber = '02';
srvCert.validity.notBefore = ontem;
srvCert.validity.notAfter = anos(agora, 10);
srvCert.setSubject([{ name: 'commonName', value: 'regem.local' }]);
srvCert.setIssuer(caSubject);
srvCert.setExtensions([
  { name: 'basicConstraints', cA: false },
  { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
  { name: 'extKeyUsage', serverAuth: true },
  { name: 'subjectAltName', altNames },
]);
srvCert.sign(caKeys.privateKey, forge.md.sha256.create());

// O conjunto anterior vai para certs/anterior-<data>: se a troca foi engano, o suporte o
// devolve e os aparelhos voltam a confiar sem mexer em nenhum deles.
if (havia) {
  const guarda = join(dir, `anterior-${agora.toISOString().replace(/[-:]/g, '').slice(0, 15)}`);
  mkdirSync(guarda, { recursive: true });
  for (const n of ARQUIVOS) if (existsSync(join(dir, n))) renameSync(join(dir, n), join(guarda, n));
}

writeFileSync(join(dir, 'ca.pem'), forge.pki.certificateToPem(caCert));
writeFileSync(join(dir, 'server.crt'), forge.pki.certificateToPem(srvCert));
writeFileSync(join(dir, 'server.key'), forge.pki.privateKeyToPem(srvKeys.privateKey));

console.log(`Certificado NOVO em ${dir} (motivo: ${motivo}).`);
console.log(`- SAN: regem.local, localhost, 127.0.0.1${ip ? `, ${ip}` : ''}`);
if (havia) {
  console.log('- Os aparelhos que confiavam no certificado anterior precisam confiar neste: abra /ca.pem neles');
  console.log('  (ou rode o instalador em modo cliente) e pareie de novo o totem. O anterior ficou em certs\\anterior-*.');
} else {
  console.log('- Confie o ca.pem no Windows dos clientes (certlm.msc -> Autoridades de Certificacao Raiz Confiaveis).');
}
console.log('- No edge: EDGE_TLS_CERT=server.crt  EDGE_TLS_KEY=server.key');
