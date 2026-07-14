// Gera a mini-CA + certificado local do edge (HTTPS na LAN, sem internet).
// O cert cobre regem.local, localhost, 127.0.0.1 e o IP passado. O instalador
// confia o CA no Windows de cada equipamento cliente -> HTTPS valido (SW + camera)
// sem aviso. Feito em Node puro (node-forge) para NAO depender de openssl no PATH.
//
//   node edge/gen-cert.mjs <IP-do-servidor>   (ex.: node edge/gen-cert.mjs 192.168.1.2)
//
// Saida em edge/certs/: ca.pem (confiar nos clientes), server.crt, server.key
// (apontar EDGE_TLS_CERT/EDGE_TLS_KEY para eles).
import { mkdirSync, writeFileSync } from 'fs';
import forge from 'node-forge';

const ip = (process.argv[2] || '').trim();
const dir = new URL('./certs/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(dir, { recursive: true });

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

writeFileSync(`${dir}ca.pem`, forge.pki.certificateToPem(caCert));
writeFileSync(`${dir}server.crt`, forge.pki.certificateToPem(srvCert));
writeFileSync(`${dir}server.key`, forge.pki.privateKeyToPem(srvKeys.privateKey));

console.log(`Cert gerado em ${dir}`);
console.log(`- SAN: regem.local, localhost, 127.0.0.1${ip ? `, ${ip}` : ''}`);
console.log('- Confie o ca.pem no Windows dos clientes (certlm.msc -> Autoridades de Certificacao Raiz Confiaveis).');
console.log('- No edge: EDGE_TLS_CERT=server.crt  EDGE_TLS_KEY=server.key');
