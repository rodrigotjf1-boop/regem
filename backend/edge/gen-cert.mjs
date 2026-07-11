// Gera a mini-CA + certificado local do edge (HTTPS na LAN, sem internet).
// O cert cobre `regem.local` e o IP passado. O instalador confia o CA no Windows
// de cada equipamento cliente → HTTPS válido (SW + câmera) sem aviso.
//
//   node edge/gen-cert.mjs <IP-do-servidor>   (ex.: node edge/gen-cert.mjs 192.168.1.2)
//
// Saída em edge/certs/: ca.pem (confiar nos clientes), server.crt, server.key
// (apontar EDGE_TLS_CERT/EDGE_TLS_KEY para eles).
import { mkdirSync, writeFileSync } from 'fs';
import { execFileSync } from 'child_process';

const ip = process.argv[2] || '';
const dir = new URL('./certs/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
mkdirSync(dir, { recursive: true });

// Usa o openssl do sistema (Git Bash/Windows costuma ter). Requer openssl no PATH.
const san = `DNS:regem.local${ip ? `,IP:${ip}` : ''}`;
try {
  // CA
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
    '-keyout', `${dir}ca.key`, '-out', `${dir}ca.pem`, '-subj', '/CN=Regem Edge CA'], { stdio: 'inherit' });
  // Cert do servidor assinado pela CA
  execFileSync('openssl', ['req', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', `${dir}server.key`, '-out', `${dir}server.csr`, '-subj', '/CN=regem.local'], { stdio: 'inherit' });
  writeFileSync(`${dir}server.ext`, `subjectAltName=${san}\n`);
  execFileSync('openssl', ['x509', '-req', '-in', `${dir}server.csr`, '-CA', `${dir}ca.pem`, '-CAkey', `${dir}ca.key`,
    '-CAcreateserial', '-days', '3650', '-out', `${dir}server.crt`, '-extfile', `${dir}server.ext`], { stdio: 'inherit' });
  console.log(`\nCert gerado em ${dir}`);
  console.log('- Confie o ca.pem no Windows dos clientes (certlm.msc → Autoridades de Certificação Raiz Confiáveis).');
  console.log('- No edge: EDGE_TLS_CERT=server.crt  EDGE_TLS_KEY=server.key');
} catch (e) {
  console.error('Falhou (precisa do openssl no PATH):', e.message);
  process.exit(1);
}
