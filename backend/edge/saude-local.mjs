// Saúde do servidor local depois de atualizar/reverter — usado pelo atualizar.ps1 e reverter.ps1.
//
// Uso: node saude-local.mjs <porta> [versao-esperada]
//   Consulta GET /api/v1/ping (HTTPS com o certificado local; cai para HTTP) e imprime a versão.
//   Saída: 0 = respondeu (e, se informada, na versão esperada) · 1 = respondeu em OUTRA versão
//          · 2 = não respondeu.
//
// Antes o health-check aceitava "a porta TCP abriu" (ERR-048): o PowerShell 5.1 falha o TLS com
// o certificado local e o fallback por porta dava OK até para um processo que caía em seguida,
// sem nunca conferir se a versão NOVA estava no ar.
import https from 'node:https';
import http from 'node:http';

const [, , portaArg, esperada] = process.argv;
const porta = Number(portaArg) || 3001;

function ping(mod) {
  return new Promise((resolve) => {
    const req = mod.get(
      { host: '127.0.0.1', port: porta, path: '/api/v1/ping', rejectUnauthorized: false, timeout: 4000 },
      (res) => {
        let corpo = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { if (corpo.length < 65536) corpo += c; });
        res.on('end', () => {
          if (res.statusCode !== 200) return resolve(null);
          try { resolve(JSON.parse(corpo)); } catch { resolve(null); }
        });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

const r = (await ping(https)) ?? (await ping(http));
if (!r || r.regem !== true) {
  console.log('sem-resposta');
  process.exit(2);
}
console.log(String(r.versao ?? ''));
process.exit(esperada && String(r.versao) !== String(esperada) ? 1 : 0);
