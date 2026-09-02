// Regem — AGENTE DE IMPRESSÃO (modo nuvem). Roda na máquina do caixa SEM o edge
// completo (sem Postgres/sync locais). Puxa os jobs de impressão da NUVEM
// (GET /impressao/pendentes, auth por x-sync-token) e imprime na térmica local:
//   - rede: TCP RAW 9100;
//   - local (USB/Windows): spooler RAW via raw-print.ps1 (mesmo do worker do edge).
// Reusa o escpos.mjs (negrito/fonte/corte preservados). Best-effort: se a nuvem
// cair, tenta no próximo ciclo.
//
// Config (env ou .env ao lado): CLOUD_API + SYNC_TOKEN (o token do tenant/loja).
import net from 'net';
import { spawn } from 'child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { renderEscpos } from './escpos.mjs';

// Serviço do Windows não exporta envs: carrega o .env ao lado, se houver.
const _envFile = fileURLToPath(new URL('./.env', import.meta.url));
if (existsSync(_envFile)) {
  for (const l of readFileSync(_envFile, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const CLOUD = (process.env.CLOUD_API || '').replace(/\/$/, '');
const TOKEN = process.env.SYNC_TOKEN || '';
const POLL = Number(process.env.PRINT_POLL_MS || 3000);
const PORTA_PADRAO = Number(process.env.PRINT_PORTA_PADRAO || 9100);
const TENTATIVAS = 3;
if (!CLOUD || !TOKEN) {
  console.error('Agente de impressao: falta CLOUD_API e/ou SYNC_TOKEN (env ou .env ao lado).');
  process.exit(1);
}
const RAW_PS1 = fileURLToPath(new URL('./raw-print.ps1', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- envio para a impressora (idêntico ao worker do edge) ---
function enviarTcp(host, porta, buffer) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port: porta || PORTA_PADRAO });
    let feito = false;
    const fim = (err) => { if (feito) return; feito = true; sock.destroy(); err ? reject(err) : resolve(); };
    sock.setTimeout(8000);
    sock.on('connect', () => sock.write(buffer, () => sock.end()));
    sock.on('close', () => fim());
    sock.on('timeout', () => fim(new Error('timeout na conexao com a impressora')));
    sock.on('error', (e) => fim(e));
  });
}
function enviarWindows(dispositivo, buffer) {
  return new Promise((resolve, reject) => {
    const tmp = join(tmpdir(), `regem-print-${Date.now()}-${randomUUID().slice(0, 8)}.bin`);
    try { writeFileSync(tmp, buffer); } catch (e) { return reject(e); }
    const limpar = () => { try { unlinkSync(tmp); } catch {} };
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', RAW_PS1, '-PrinterName', dispositivo, '-FilePath', tmp],
      { windowsHide: true },
    );
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => { limpar(); reject(e); });
    child.on('close', (code) => { limpar(); code === 0 ? resolve() : reject(new Error(err.trim().slice(0, 200) || `powershell saiu ${code}`)); });
  });
}

// --- API da nuvem ---
async function api(path, opts = {}) {
  return fetch(`${CLOUD}${path}`, {
    ...opts,
    headers: { 'x-sync-token': TOKEN, 'content-type': 'application/json', ...(opts.headers || {}) },
  });
}
async function marcar(id, ok, erro) {
  await api(`/impressao/${id}/${ok ? 'impresso' : 'erro'}`, { method: 'POST', body: JSON.stringify({ erro: erro || null }) }).catch(() => {});
}

async function imprimirJob(job) {
  const local = job.conexao === 'local';
  if (local && !job.dispositivo) { await marcar(job.id, false, 'impressora local sem nome do Windows'); return; }
  if (!local && !job.host) { await marcar(job.id, false, 'impressora de rede sem IP'); return; }
  const vias = Math.max(1, Number(job.vias) || 1);
  const buffer = renderEscpos(job.conteudo, job.largura || 80, job.linguagem);
  const enviar = local ? () => enviarWindows(job.dispositivo, buffer) : () => enviarTcp(job.host, job.porta, buffer);
  let ultimoErro = null;
  let enviadas = 0; // via-a-via: uma via que já saiu NÃO é reimpressa no retry
  for (let t = 1; t <= TENTATIVAS; t++) {
    try {
      while (enviadas < vias) { await enviar(); enviadas++; }
      await marcar(job.id, true);
      console.log(`  ✓ ${String(job.id).slice(0, 8)} -> ${local ? 'win:' + job.dispositivo : (job.impressora || job.host)}` + (vias > 1 ? ` (${vias} vias)` : ''));
      return;
    } catch (e) {
      ultimoErro = e.message;
      if (t < TENTATIVAS) await sleep(500 * t);
    }
  }
  await marcar(job.id, false, ultimoErro);
  console.error(`  ✗ ${String(job.id).slice(0, 8)} falhou (${enviadas}/${vias} vias): ${ultimoErro}`);
}

async function ciclo() {
  try {
    const res = await api('/impressao/pendentes');
    if (!res.ok) throw new Error(`pendentes HTTP ${res.status}`);
    const jobs = await res.json();
    for (const j of jobs) await imprimirJob(j);
  } catch (e) {
    // Nuvem fora / rede — silencioso; tenta no próximo ciclo.
  }
}

const mask = CLOUD;
console.log(`Agente de impressao Regem — nuvem=${mask} poll=${POLL}ms`);
(async () => { for (;;) { await ciclo(); await sleep(POLL); } })();
