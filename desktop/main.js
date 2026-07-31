// Regem Desktop (Fase 6) — casca nativa Electron. Modo ÚNICO local-first: abre o
// servidor (edge na LAN / localhost) em tela cheia, dando sensação de app. Se o
// servidor local não responde, cai pra nuvem com um "status dot" (local/nuvem/offline)
// e volta ao local sozinho quando ele reaparece. Endurecido: sem nodeIntegration,
// contextIsolation + sandbox, sem DevTools em prod, navegação externa bloqueada.
const { app, BrowserWindow, session, globalShortcut, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const https = require('https');

const isDev = !app.isPackaged;

function loadConfig() {
  let cfg = {};
  try {
    const p = path.join(app.getPath('userData'), 'regem-desktop.json');
    if (fs.existsSync(p)) cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    /* usa defaults */
  }
  return {
    server: process.env.REGEM_SERVER_URL || cfg.server || 'https://localhost:3001',
    cloud: process.env.REGEM_CLOUD_URL || cfg.cloud || 'https://app.dmsregem.com',
  };
}

// Ping no /api/v1/ping (o edge responde public). rejectUnauthorized:false porque o
// edge usa cert local (auto-assinado) na LAN.
function ping(base) {
  return new Promise((resolve) => {
    try {
      const u = new URL(base.replace(/\/$/, '') + '/api/v1/ping');
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.get(u, { timeout: 3000, rejectUnauthorized: false }, (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 500);
      });
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.on('error', () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

let win;
let modo = 'local';

async function alvo(cfg) {
  if (await ping(cfg.server)) { modo = 'local'; return cfg.server; }
  if (await ping(cfg.cloud)) { modo = 'nuvem'; return cfg.cloud; }
  modo = 'offline';
  return cfg.server; // tenta o local mesmo offline (a tela mostra o erro/retry)
}

function endurecerSessao() {
  const s = session.defaultSession;
  // Só libera as permissões essenciais de um PDV/KDS; o resto é negado.
  s.setPermissionRequestHandler((_wc, perm, cb) => {
    cb(['media', 'fullscreen', 'clipboard-read', 'clipboard-sanitized-write'].includes(perm));
  });
}

function injetarStatus() {
  if (!win) return;
  const cor = modo === 'local' ? '#0E7C66' : modo === 'nuvem' ? '#E2A340' : '#C0392B';
  win.webContents
    .executeJavaScript(
      `(()=>{let d=document.getElementById('regem-status');if(!d){d=document.createElement('div');d.id='regem-status';d.style.cssText='position:fixed;bottom:8px;right:8px;z-index:2147483647;font:600 11px system-ui;padding:3px 8px;border-radius:20px;color:#fff;opacity:.85;pointer-events:none';document.body.appendChild(d);}d.textContent='${modo}';d.style.background='${cor}';})();`,
    )
    .catch(() => {});
}

async function criarJanela() {
  const cfg = loadConfig();
  const url = await alvo(cfg);
  win = new BrowserWindow({
    kiosk: !isDev,
    frame: isDev,
    fullscreen: !isDev,
    backgroundColor: '#0F2230',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools: isDev,
    },
  });
  win.removeMenu();

  const hosts = () => {
    try { return [new URL(cfg.server).host, new URL(cfg.cloud).host]; } catch { return []; }
  };
  // Links externos abrem no navegador do sistema; nada de nova janela na casca.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, u) => {
    try {
      if (!hosts().includes(new URL(u).host)) { e.preventDefault(); shell.openExternal(u); }
    } catch { /* ignora */ }
  });

  await win.loadURL(url).catch(() => {});
  injetarStatus();
  win.webContents.on('did-finish-load', injetarStatus);

  // Re-checa periodicamente: se voltar ao ar o local, volta pra ele.
  setInterval(async () => {
    await alvo(cfg);
    injetarStatus();
    const atual = win.webContents.getURL();
    if (modo === 'local' && !atual.startsWith(cfg.server)) win.loadURL(cfg.server).catch(() => {});
  }, 20000);
}

app.whenReady().then(() => {
  endurecerSessao();
  criarJanela();
  // O kiosk esconde o chrome; atalhos discretos para sair/recarregar (suporte).
  globalShortcut.register('Control+Shift+Q', () => app.quit());
  globalShortcut.register('Control+Shift+R', () => win && win.reload());
});

app.on('window-all-closed', () => app.quit());
app.on('will-quit', () => globalShortcut.unregisterAll());
