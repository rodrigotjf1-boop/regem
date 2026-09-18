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
import { readFileSync, existsSync, writeFileSync, unlinkSync, appendFileSync } from 'fs';
import { tmpdir, hostname } from 'os';
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

// Rede de seguranca do PROCESSO (E1): sem estes handlers uma excecao nao tratada derruba o
// agente em silencio. unhandledRejection: loga e segue. uncaughtException: loga e SAI (1) p/ o
// NSSM reiniciar (AppThrottle evita crash-loop).
process.on('unhandledRejection', (e) => console.error(`[print-agent][unhandledRejection] ${e?.stack ?? e?.message ?? e}`));
process.on('uncaughtException', (e) => {
  console.error(`[print-agent][uncaughtException] ${e?.stack ?? e?.message ?? e}`);
  process.exit(1);
});

// --- envio para a impressora (idêntico ao worker do edge) ---
// Duas esperas: CONECTAR (3 s — impressora desligada não responde nada) e ENVIAR (8 s).
const CONECTAR_MS = Number(process.env.PRINT_CONECTAR_MS || 3000);
function enviarTcp(host, porta, buffer) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port: porta || PORTA_PADRAO });
    let feito = false;
    const fim = (err) => { if (feito) return; feito = true; clearTimeout(tConectar); sock.destroy(); err ? reject(err) : resolve(); };
    const tConectar = setTimeout(() => fim(new Error(`impressora não respondeu (sem conexão em ${CONECTAR_MS / 1000} s)`)), CONECTAR_MS);
    sock.setTimeout(8000);
    sock.on('connect', () => { clearTimeout(tConectar); sock.write(buffer, () => sock.end()); });
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

// --- identidade desta máquina ---
// O token é o da LOJA (os caixas dividem). Para o job de impressora USB ir só para a máquina
// onde ela está instalada, o agente diz QUEM é e QUAIS impressoras o Windows dele tem.
const MAQUINA = (process.env.AGENTE_MAQUINA || hostname() || '').trim().slice(0, 120) || null;
let dispositivos = null; // null = não consegui listar (a nuvem cai no comportamento antigo)
let dispositivosEm = 0;
function listarImpressorasWindows() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name'],
      { windowsHide: true },
    );
    let out = '';
    const t = setTimeout(() => { child.kill(); resolve(null); }, 15000);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', () => { clearTimeout(t); resolve(null); });
    child.on('close', (code) => {
      clearTimeout(t);
      resolve(code === 0 ? out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : null);
    });
  });
}
// Lista fixa pelo .env (suporte: Windows onde o Get-Printer não responde). Nomes separados por '|'.
const FIXAS = (process.env.AGENTE_IMPRESSORAS || '').split('|').map((s) => s.trim()).filter(Boolean);
async function atualizarDispositivos() {
  if (FIXAS.length) { dispositivos = FIXAS; return; }
  if (Date.now() - dispositivosEm < 5 * 60 * 1000) return; // a lista muda raramente
  const l = await listarImpressorasWindows();
  if (l) dispositivos = l;
  dispositivosEm = Date.now();
}

// --- memória do que JÁ saiu no papel ---
// Se o papel sai mas as 3 confirmações falham (rede instável), o job fica reservado, a reserva
// vence em 120 s e ele volta — e saía de novo. Aqui guardamos os ids impressos (2 dias): se um
// deles volta, só confirmamos, sem imprimir.
// Arquivo de LINHAS ("id<TAB>ms"): cada impressão ACRESCENTA uma linha — antes o arquivo inteiro
// (até 5 mil ids) era reescrito a cada ticket. Quando passa de 10 mil linhas, é compactado uma
// vez (só os ids dos últimos 2 dias, no máximo 5 mil).
const MEMORIA = fileURLToPath(new URL('./.impressos.log', import.meta.url));
const MEMORIA_MS = 2 * 24 * 60 * 60 * 1000;
const impressos = new Map();
let linhasNoArquivo = 0;
const NL = '\n';
const TAB = '\t';
try {
  for (const l of readFileSync(MEMORIA, 'utf8').split(NL)) {
    const [id, em] = l.split(TAB);
    linhasNoArquivo++;
    if (id && Date.now() - Number(em) < MEMORIA_MS) impressos.set(id, Number(em));
  }
} catch { /* primeira vez: começa vazia */ }
function compactarMemoria() {
  const corte = Date.now() - MEMORIA_MS;
  const vivos = [...impressos].filter(([, em]) => em >= corte).slice(-5000);
  impressos.clear();
  for (const [k, em] of vivos) impressos.set(k, em);
  try { writeFileSync(MEMORIA, vivos.map(([k, em]) => k + TAB + em).join(NL) + NL); } catch { /* disco */ }
  linhasNoArquivo = vivos.length;
}
function lembrarImpresso(id) {
  const agora = Date.now();
  impressos.set(id, agora);
  try { appendFileSync(MEMORIA, id + TAB + agora + NL); linhasNoArquivo++; } catch { /* disco: segue */ }
  if (linhasNoArquivo > 10000) compactarMemoria();
}

// --- API da nuvem ---
async function api(path, opts = {}) {
  return fetch(`${CLOUD}${path}`, {
    ...opts,
    headers: { 'x-sync-token': TOKEN, 'content-type': 'application/json', ...(opts.headers || {}) },
  });
}
async function marcar(id, ok, erro, definitivo = false) {
  const path = `/impressao/${id}/${ok ? 'impresso' : 'erro'}`;
  const body = JSON.stringify(ok ? { maquina: MAQUINA } : { erro: erro || null, definitivo });
  // ACK com RETRY: a nuvem reserva o job (120 s). Se este POST falhar, o job volta quando a
  // reserva vence — a memória acima evita que ele saia de novo no papel.
  for (let t = 1; t <= 3; t++) {
    try {
      const res = await api(path, { method: 'POST', body, signal: AbortSignal.timeout(15000) });
      if (res.ok) return;
    } catch {
      /* rede — tenta de novo */
    }
    if (t < 3) await sleep(400 * t);
  }
  console.error(`  ! ACK '${ok ? 'impresso' : 'erro'}' falhou p/ job ${String(id).slice(0, 8)} — ele volta após a reserva${ok ? ' (não reimprime: está na memória)' : ''}`);
}

// Devolve à fila da nuvem SEM gastar tentativa (a impressora dele acabou de cair).
async function devolver(id) {
  try { await api(`/impressao/${id}/devolver`, { method: 'POST', body: JSON.stringify({ maquina: MAQUINA }), signal: AbortSignal.timeout(15000) }); }
  catch { /* a reserva vence em 120 s e ele volta sozinho */ }
}

// Reserva da nuvem = 120 s. Job que chegou há mais que isto (menos folga) pode já ter sido
// repassado a outro agente: não imprime, deixa voltar.
const RESERVA_UTIL_MS = 100 * 1000;

// Devolve 'ok' | 'config' (erro de cadastro) | 'falha' (a impressora não recebeu) | 'pulado'.
async function imprimirJob(job, recebidoEm) {
  if (impressos.has(job.id)) { await marcar(job.id, true); return 'ok'; }
  if (Date.now() - recebidoEm > RESERVA_UTIL_MS) return 'pulado';
  const local = job.conexao === 'local';
  // Erro de CONFIGURAÇÃO: definitivo (não adianta 5 rodadas de nova tentativa).
  if (!job.conexao && !job.host && !job.dispositivo) { await marcar(job.id, false, 'impressora não encontrada (removida ou sem cadastro)', true); return 'config'; }
  if (job.ativo === false) { await marcar(job.id, false, 'impressora desativada — use "Imprimir em…" para outra', true); return 'config'; }
  if (local && !job.dispositivo) { await marcar(job.id, false, 'impressora local sem nome do Windows', true); return 'config'; }
  if (!local && !job.host) { await marcar(job.id, false, 'impressora de rede sem IP', true); return 'config'; }
  if (local && dispositivos && !dispositivos.includes(job.dispositivo)) {
    await marcar(job.id, false, `impressora "${job.dispositivo}" não está instalada na máquina ${MAQUINA}`);
    return 'falha';
  }
  const vias = Math.max(1, Number(job.vias) || 1);
  const buffer = renderEscpos(job.conteudo, job.largura || 80, job.linguagem, job.codepage);
  const enviar = local ? () => enviarWindows(job.dispositivo, buffer) : () => enviarTcp(job.host, job.porta, buffer);
  let ultimoErro = null;
  let enviadas = 0; // via-a-via: uma via que já saiu NÃO é reimpressa no retry
  for (let t = 1; t <= TENTATIVAS && enviadas < vias; t++) {
    try {
      while (enviadas < vias) { await enviar(); enviadas++; }
    } catch (e) {
      ultimoErro = e.message;
      if (t < TENTATIVAS) await sleep(500 * t);
    }
  }
  if (enviadas >= vias) {
    lembrarImpresso(job.id); // ANTES do ACK: se o ACK falhar, a volta do job não imprime de novo
    await marcar(job.id, true);
    console.log(`  ✓ ${String(job.id).slice(0, 8)} -> ${local ? 'win:' + job.dispositivo : (job.impressora || job.host)}` + (vias > 1 ? ` (${vias} vias)` : ''));
    return 'ok';
  }
  await marcar(job.id, false, ultimoErro);
  console.error(`  ✗ ${String(job.id).slice(0, 8)} falhou (${enviadas}/${vias} vias): ${ultimoErro}`);
  return 'falha';
}

// ===== UMA FILA POR IMPRESSORA (em paralelo) + DISJUNTOR — igual ao worker do servidor local =====
// Impressora desligada não segura as outras: cada impressora anda sozinha, e a que não recebeu
// fica "fora do ar" 30 s (dobra até 5 min) — os jobs dela voltam à nuvem sem gastar tentativa e
// não são pedidos de novo até o prazo vencer.
const DISJUNTOR_MIN_MS = 30_000;
const DISJUNTOR_MAX_MS = 5 * 60_000;
const filas = new Map(); // equipamentoId → { jobs: [], rodando }
const disjuntor = new Map(); // equipamentoId → { ate, falhas }
function foraDaReserva() {
  const agora = Date.now();
  const ids = [];
  for (const [id, f] of filas) if (id !== '-' && (f.rodando || f.jobs.length)) ids.push(id);
  for (const [id, d] of disjuntor) if (d.ate > agora) ids.push(id);
  return ids;
}
async function rodarFila(chave) {
  const f = filas.get(chave);
  if (!f || f.rodando) return;
  f.rodando = true;
  try {
    while (f.jobs.length) {
      const { job, recebidoEm } = f.jobs.shift();
      let r;
      try { r = await imprimirJob(job, recebidoEm); }
      catch (e) { console.error(`  job ${String(job.id).slice(0, 8)} — erro inesperado: ${e?.message ?? e}`); continue; }
      if (r === 'ok') disjuntor.delete(chave);
      if (r === 'falha' && chave !== '-') {
        const d = disjuntor.get(chave) ?? { falhas: 0, ate: 0 };
        d.falhas++;
        const ms = Math.min(DISJUNTOR_MAX_MS, DISJUNTOR_MIN_MS * 2 ** (d.falhas - 1));
        d.ate = Date.now() + ms;
        disjuntor.set(chave, d);
        console.error(`  impressora ${chave.slice(0, 8)} fora do ar — pausa de ${ms / 1000}s (as outras seguem)`);
        for (const resto of f.jobs.splice(0)) await devolver(resto.job.id);
      }
    }
  } finally {
    f.rodando = false;
    if (!f.jobs.length) filas.delete(chave);
  }
}

// ESPERA LONGA: a requisição fica aberta até 25 s na nuvem e volta na hora em que entra um job.
// Antes: uma consulta a cada 3 s (20/min por agente; 1.667/s com 5 mil lojas).
// Nuvem antiga (sem o POST) → cai na consulta de sempre, a cada PRINT_POLL_MS.
const ESPERA_SEG = 25;
let modoAntigo = false;
async function buscar() {
  if (!modoAntigo) {
    await atualizarDispositivos();
    const res = await api('/impressao/pendentes', {
      method: 'POST',
      body: JSON.stringify({ maquina: MAQUINA, dispositivos, espera: ESPERA_SEG, excluir: foraDaReserva() }),
      signal: AbortSignal.timeout((ESPERA_SEG + 20) * 1000),
    });
    if (res.status === 404 || res.status === 405) {
      modoAntigo = true;
      console.warn('  nuvem sem espera longa — usando a consulta a cada poucos segundos');
    } else {
      if (!res.ok) throw new Error(`pendentes HTTP ${res.status}`);
      return res.json();
    }
  }
  const res = await api('/impressao/pendentes', { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`pendentes HTTP ${res.status}`);
  return res.json();
}

let falhas = 0;
async function ciclo() {
  try {
    const jobs = await buscar();
    const recebidoEm = Date.now();
    // Distribui nas filas das impressoras e volta a esperar na hora — cada fila anda sozinha.
    const tocadas = new Set();
    for (const j of jobs) {
      const chave = j.equipamentoId || '-';
      const f = filas.get(chave) ?? { jobs: [], rodando: false };
      f.jobs.push({ job: j, recebidoEm });
      filas.set(chave, f);
      tocadas.add(chave);
    }
    for (const chave of tocadas) rodarFila(chave);
    // Nuvem antiga (sem espera longa) no modo antigo: espera as filas antes de consultar de novo.
    if (modoAntigo) while (filas.size) await sleep(200);
    falhas = 0;
    // Espera longa: volta a esperar na hora. Modo antigo: o intervalo de sempre.
    if (modoAntigo) await sleep(POLL);
  } catch (e) {
    // Nuvem fora / rede — não derruba o agente; recua (3 s → 60 s) em vez de insistir.
    falhas++;
    console.error(`  ciclo do agente falhou (nuvem/rede): ${String(e?.message ?? e).slice(0, 160)}`);
    await sleep(Math.min(60000, POLL * 2 ** Math.min(falhas - 1, 5)));
  }
}

const mask = CLOUD;
console.log(`Agente de impressao Regem — nuvem=${mask} maquina=${MAQUINA ?? '?'}`);
(async () => { for (;;) await ciclo(); })();
