// Saúde do servidor local depois de atualizar/reverter — usado pelo atualizar.ps1 e reverter.ps1.
//
// Uso: node saude-local.mjs <porta> [versao-esperada]
//   Consulta GET /api/v1/ping (HTTPS com o certificado local; cai para HTTP) e imprime a versão.
//   Saída: 0 = respondeu (e, se informada, na versão esperada) · 1 = respondeu em OUTRA versão
//          · 2 = não respondeu (inclui o BANCO fora: o /ping devolve 503, e imprime "banco-fora").
//
// Antes o health-check aceitava "a porta TCP abriu" (ERR-048): o PowerShell 5.1 falha o TLS com
// o certificado local e o fallback por porta dava OK até para um processo que caía em seguida,
// sem nunca conferir se a versão NOVA estava no ar.
//
// Desde set/2026 o /ping também confere o Postgres local (`banco: true|false`) e responde 503
// quando ele está fora — então "API no ar, banco parado" REPROVA a atualização, em vez de
// aprová-la e deixar a loja sem operar.
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
          let json = null;
          try { json = JSON.parse(corpo); } catch { /* corpo não-JSON */ }
          // 503 com `banco:false` = a API subiu mas o Postgres local está fora. Não é "sem
          // resposta": devolve o motivo real para o log da atualização (senão o operador lê
          // "a API nao respondeu" e vai procurar defeito no lugar errado).
          if (res.statusCode !== 200) return resolve(json?.banco === false ? { bancoFora: true } : null);
          resolve(json);
        });
      },
    );
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

const r = (await ping(https)) ?? (await ping(http));
if (r?.bancoFora) {
  console.log('banco-fora');
  process.exit(2);
}
if (!r || r.regem !== true) {
  console.log('sem-resposta');
  process.exit(2);
}
console.log(String(r.versao ?? ''));
process.exit(esperada && String(r.versao) !== String(esperada) ? 1 : 0);
