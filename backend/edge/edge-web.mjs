// Serve o app (Next.js standalone) via HTTPS na LAN do edge.
//
// O server.js do standalone do Next so fala HTTP. Para os aparelhos da loja
// (KDS/PDV/ponto no IP da LAN) terem contexto seguro (Service Worker + camera),
// a pagina precisa vir por HTTPS. Entao: subimos o Next em HTTP no 127.0.0.1
// (interno) e colocamos um proxy HTTPS na frente, com o MESMO cert do edge.
//
//   node edge/edge-web.mjs        (PORT=porta HTTPS publica; default 3001)
import { spawn } from 'child_process';
import https from 'https';
import http from 'http';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const edgeDir = dirname(fileURLToPath(import.meta.url)); // .../backend/edge
const raiz = join(edgeDir, '..'); // .../backend

// .env.local (rodando como servico do Windows nao ha shell que exporte as envs).
const envFile = join(raiz, '.env.local');
if (existsSync(envFile)) {
  for (const l of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const PORT = Number(process.env.PORT || 3001); // HTTPS publico (LAN)
const INNER = Number(process.env.WEB_INNER_PORT || 3011); // Next HTTP interno (localhost)

// Onde ficou o server.js do standalone (monorepo pode aninhar em web/frontend/).
const webRoot = join(raiz, 'web');
const candidatos = [join(webRoot, 'server.js'), join(webRoot, 'frontend', 'server.js')];
const serverJs = candidatos.find((p) => existsSync(p));
if (!serverJs) {
  console.error('server.js do app nao encontrado. Procurei em:\n  ' + candidatos.join('\n  '));
  process.exit(1);
}

const cert = process.env.EDGE_TLS_CERT ? readFileSync(process.env.EDGE_TLS_CERT) : null;
const key = process.env.EDGE_TLS_KEY ? readFileSync(process.env.EDGE_TLS_KEY) : null;
if (!cert || !key) {
  console.error('EDGE_TLS_CERT/EDGE_TLS_KEY ausentes — nao da para servir o app por HTTPS.');
  process.exit(1);
}

// 1) sobe o Next standalone em HTTP, so no localhost (nunca exposto direto).
const next = spawn(process.execPath, [serverJs], {
  cwd: webRoot,
  env: { ...process.env, PORT: String(INNER), HOSTNAME: '127.0.0.1', NODE_ENV: 'production' },
  stdio: 'inherit',
});
next.on('exit', (code) => {
  console.error(`[edge-web] Next saiu (codigo ${code}); encerrando para o servico reiniciar.`);
  process.exit(code || 1);
});

// 2) proxy HTTPS (LAN) -> HTTP interno do Next.
const encaminha = (req, res) => {
  const up = http.request(
    { host: '127.0.0.1', port: INNER, method: req.method, path: req.url, headers: req.headers },
    (upRes) => {
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      upRes.pipe(res);
    },
  );
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('App iniciando, tente de novo em instantes.');
  });
  req.pipe(up);
};

const server = https.createServer({ cert, key }, encaminha);

// Encaminha upgrades (WebSocket), por seguranca.
server.on('upgrade', (req, socket, head) => {
  const up = http.request({
    host: '127.0.0.1',
    port: INNER,
    method: req.method,
    path: req.url,
    headers: req.headers,
  });
  up.on('upgrade', (upRes, upSocket, upHead) => {
    socket.write(
      `HTTP/1.1 101 Switching Protocols\r\n` +
        Object.entries(upRes.headers)
          .map(([k, v]) => `${k}: ${v}\r\n`)
          .join('') +
        '\r\n',
    );
    if (upHead && upHead.length) upSocket.unshift(upHead);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
  });
  up.on('error', () => socket.destroy());
  up.end();
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[edge-web] app HTTPS na porta ${PORT} (Next interno em http://127.0.0.1:${INNER})`);
});
