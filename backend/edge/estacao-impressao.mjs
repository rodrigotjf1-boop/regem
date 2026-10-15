// ESTAÇÃO DE IMPRESSÃO (fase 1 da central de impressão, 15/10/2026).
//
// O serviço que roda em cada PC com impressora — PDV, PC do delivery, PC da cozinha — e imprime SÓ
// as impressoras ligadas nele ("Ligada em", `equipamento.estacao_id`). Antes, no modo local, o
// servidor da loja imprimia toda a fila pelo Windows dele, e a impressora USB de outro PC nunca saía.
//
// Fala com o servidor da loja pela rede (modo local, sem depender da internet) ou com a nuvem (loja
// sem servidor), com a credencial da estação (X-Estacao-Id + X-Estacao-Segredo), recebida ao parear
// pelo código de 6 dígitos. Nunca usa o token do servidor da loja (a lição do ERR-232).
//   • impressora de REDE: pergunta o estado antes e confere depois (impressora-estado.mjs) — sem
//     papel/tampa aberta = o cupom espera; parou no meio = volta inteiro, marcado;
//   • impressora USB (instalada neste Windows): spooler, pelo raw-print.ps1.
//
// Config (`.env.local` na pasta de instalação, gravado pelo pareamento; o segredo cifrado com o
// DPAPI desta máquina):
//   REGEM_API        https://<ip-do-servidor>:3002/api/v1  (ou a API da nuvem)
//   REGEM_CA         ca.pem do servidor da loja (o certificado é da própria loja)
//   ESTACAO_ID, ESTACAO_SEGREDO, ESTACAO_NOME
// Uso:
//   node edge/estacao-impressao.mjs --parear <codigo> --servidor <ip>   (instalador, loja com servidor)
//   node edge/estacao-impressao.mjs --parear <codigo> [--api <url>]     (loja sem servidor: a nuvem)
//   node edge/estacao-impressao.mjs                                     (serviço)
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { readFileSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir, hostname } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renderEscpos } from './escpos.mjs';
import { imprimirRedeComEstado } from './impressora-estado.mjs';
import { carregarEnvArquivo } from './decifrar-env.mjs';

const EDGE_DIR = dirname(fileURLToPath(import.meta.url));
const RAIZ = process.env.ESTACAO_RAIZ || dirname(EDGE_DIR); // pasta de instalação
const ENV_ARQ = join(RAIZ, '.env.local');
const VERSAO = process.env.APP_VERSION || 'dev';
const MAQUINA = (hostname() || '').slice(0, 120);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== HTTP (sem dependência): o certificado do servidor da loja é da própria loja (ca.pem) =====
function chamar(metodo, url, corpo, { ca, inseguro = false, timeoutMs = 15000, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const dados = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));
    const req = mod.request(
      u,
      {
        method: metodo,
        headers: { ...(dados ? { 'content-type': 'application/json', 'content-length': dados.length } : {}), ...headers },
        ...(u.protocol === 'https:' ? { ca: ca || undefined, rejectUnauthorized: !inseguro } : {}),
      },
      (res) => {
        const partes = [];
        res.on('data', (c) => partes.push(c));
        res.on('end', () => {
          const texto = Buffer.concat(partes).toString('utf8');
          let json = null;
          try { json = texto ? JSON.parse(texto) : null; } catch { /* não é JSON */ }
          resolve({ status: res.statusCode, json, texto });
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`sem resposta em ${timeoutMs / 1000} s`)));
    req.on('error', reject);
    if (dados) req.write(dados);
    req.end();
  });
}

// ===== PAREAMENTO (o instalador chama uma vez) =====
async function parear(codigo, { servidor, api }) {
  let base;
  let ca = null;
  if (servidor) {
    const portaApi = process.env.REGEM_PORTA_API || '3002';
    const portaWeb = process.env.REGEM_PORTA_WEB || '3001';
    base = `https://${servidor}:${portaApi}/api/v1`;
    // Confiança no primeiro uso, como o instalador do PC cliente: o servidor entrega o certificado
    // da loja em /ca.pem; daqui em diante a estação só aceita o servidor assinado por ele.
    const r = await chamar('GET', `https://${servidor}:${portaWeb}/ca.pem`, undefined, { inseguro: true });
    ca = r.status === 200 && /BEGIN CERTIFICATE/.test(r.texto) ? r.texto : null;
    if (!ca) throw new Error(`O servidor ${servidor} não entregou o certificado da loja. Confira o endereço e se ele está ligado.`);
  } else {
    base = (api || 'https://api.dmsregem.com/api/v1').replace(/\/$/, '');
  }
  const r = await chamar('POST', `${base}/publico/terminal/parear`, { codigo: String(codigo), fingerprint: MAQUINA }, { ca });
  if (r.status >= 400) throw new Error(r.json?.message || `o servidor recusou o código (HTTP ${r.status})`);
  if (r.json?.tipo !== 'estacao_impressao') {
    throw new Error('Este código é de outro tipo de equipamento. No Regem, gere o código na ESTAÇÃO DE IMPRESSÃO.');
  }
  mkdirSync(RAIZ, { recursive: true });
  let caArq = null;
  if (ca) {
    mkdirSync(join(RAIZ, 'certs'), { recursive: true });
    caArq = join(RAIZ, 'certs', 'servidor-ca.pem');
    writeFileSync(caArq, ca);
  }
  const linhas = [
    `REGEM_API=${base}`,
    caArq ? `REGEM_CA=${caArq}` : null,
    `ESTACAO_ID=${r.json.terminalId}`,
    `ESTACAO_SEGREDO=${r.json.segredo}`,
    `ESTACAO_NOME=${String(r.json.nome || '').replace(/[\r\n]/g, ' ')}`,
  ].filter(Boolean);
  writeFileSync(ENV_ARQ, linhas.join('\r\n') + '\r\n');
  // Windows: o segredo vira `enc:` (DPAPI desta máquina) — copiar o arquivo para outro PC não serve.
  if (process.platform === 'win32' && !process.env.ESTACAO_SEM_CIFRA) {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', join(EDGE_DIR, 'proteger-env.ps1'), '-EnvFile', ENV_ARQ],
      { stdio: 'inherit' },
    );
  }
  console.log(`Estação de impressão pareada: ${r.json.nome}`);
}

// ===== IMPRESSORA USB (spooler do Windows) =====
const RAW_PS1 = join(EDGE_DIR, 'raw-print.ps1');
function enviarWindows(dispositivo, buffer) {
  return new Promise((resolve, reject) => {
    const tmp = join(tmpdir(), `regem-estacao-${Date.now()}-${randomUUID().slice(0, 8)}.bin`);
    try { writeFileSync(tmp, buffer); } catch (e) { return reject(e); }
    const limpar = () => { try { unlinkSync(tmp); } catch { /* já removido */ } };
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
// As impressoras deste Windows: vão na batida (o "Ligada em" mostra o que existe neste PC).
let impressorasDoWindows = [];
let listadasEm = 0;
function listarImpressorasWindows() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(null);
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Printer | Select-Object -ExpandProperty Name'], { windowsHide: true });
    let out = '';
    const t = setTimeout(() => { child.kill(); resolve(null); }, 15000);
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('error', () => { clearTimeout(t); resolve(null); });
    child.on('close', (code) => { clearTimeout(t); resolve(code === 0 ? out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : null); });
  });
}
async function atualizarImpressorasWindows() {
  if (Date.now() - listadasEm < 5 * 60_000) return;
  const l = await listarImpressorasWindows();
  if (l) impressorasDoWindows = l;
  listadasEm = Date.now();
}

// ===== MEMÓRIA DO QUE JÁ SAIU (2 dias) =====
// O papel sai e a confirmação falha (rede): a reserva vence e o cupom volta. Aqui ele só é
// confirmado, sem sair de novo. Uma linha por cupom; compacta acima de 10 mil linhas.
const MEMORIA = join(RAIZ, '.estacao-impressos.log');
const MEMORIA_MS = 2 * 24 * 60 * 60 * 1000;
const impressos = new Map();
let linhasNoArquivo = 0;
function carregarMemoria() {
  try {
    for (const l of readFileSync(MEMORIA, 'utf8').split('\n')) {
      const [id, em] = l.split('\t');
      linhasNoArquivo++;
      if (id && Date.now() - Number(em) < MEMORIA_MS) impressos.set(id, Number(em));
    }
  } catch { /* primeira vez */ }
}
function lembrarImpresso(id) {
  const agora = Date.now();
  impressos.set(id, agora);
  try { appendFileSync(MEMORIA, `${id}\t${agora}\n`); linhasNoArquivo++; } catch { /* disco: segue */ }
  if (linhasNoArquivo > 10000) {
    const corte = Date.now() - MEMORIA_MS;
    const vivos = [...impressos].filter(([, em]) => em >= corte).slice(-5000);
    impressos.clear();
    for (const [k, em] of vivos) impressos.set(k, em);
    try { writeFileSync(MEMORIA, vivos.map(([k, em]) => `${k}\t${em}`).join('\n') + '\n'); } catch { /* disco */ }
    linhasNoArquivo = vivos.length;
  }
}

// ===== API (servidor da loja ou nuvem), com a credencial da estação =====
let API = '';
let CA = null;
let CRED = {};
function api(metodo, caminho, corpo, timeoutMs) {
  return chamar(metodo, `${API}${caminho}`, corpo, { ca: CA, timeoutMs, headers: CRED });
}
async function avisar(caminho, corpo) {
  // Confirmação com nova tentativa: se não chegar, a reserva vence (2 min) e o cupom volta — a
  // memória acima impede que ele saia de novo no papel.
  for (let t = 1; t <= 3; t++) {
    try {
      const r = await api('POST', caminho, corpo, 15000);
      if (r.status < 500) return r;
    } catch { /* rede: de novo */ }
    if (t < 3) await sleep(400 * t);
  }
  console.error(`  ! não consegui avisar ${caminho} — a reserva vence e o cupom volta`);
  return null;
}

// O que cada impressora desta estação respondeu — vai na batida (o servidor grava só quando muda).
const estados = new Map(); // equipamentoId → { estado, detalhe }
function anotar(id, estado, detalhe) {
  if (id && estado) estados.set(id, { estado, detalhe: detalhe ?? null });
}

const TENTATIVAS = 3;
const RESERVA_UTIL_MS = 100_000; // a reserva é de 120 s: depois disto pode ter ido para outra

// Devolve 'ok' | 'config' | 'falha' (não recebeu) | 'parada' (respondeu: sem papel, tampa…) | 'pulado'.
async function imprimirJob(job, recebidoEm) {
  if (impressos.has(job.id)) { await avisar(`/impressao/${job.id}/impresso`, {}); return 'ok'; }
  if (Date.now() - recebidoEm > RESERVA_UTIL_MS) return 'pulado';
  const local = job.conexao === 'local';
  const definitivo = (motivo) => avisar(`/impressao/${job.id}/erro`, { erro: motivo, definitivo: true });
  if (job.ativo === false) { await definitivo('impressora desativada — use "Imprimir em…" para outra'); return 'config'; }
  if (local && !job.dispositivo) { await definitivo('impressora USB sem o nome do Windows no cadastro'); return 'config'; }
  if (!local && !job.host) { await definitivo('impressora de rede sem IP'); return 'config'; }
  if (local && impressorasDoWindows.length && !impressorasDoWindows.includes(job.dispositivo)) {
    await avisar(`/impressao/${job.id}/erro`, { erro: `a impressora "${job.dispositivo}" não está instalada no PC ${MAQUINA}` });
    anotar(job.equipamentoId, 'erro', 'não está instalada neste PC');
    return 'falha';
  }
  const vias = Math.max(1, Number(job.vias) || 1);
  const buffer = renderEscpos(job.conteudo, job.largura || 80, job.linguagem, job.codepage);
  let enviadas = 0;
  let ultimoErro = null;
  let parada = null;
  for (let t = 1; t <= TENTATIVAS && enviadas < vias && !parada; t++) {
    try {
      while (enviadas < vias) {
        if (local) {
          await enviarWindows(job.dispositivo, buffer);
        } else {
          const r = await imprimirRedeComEstado({ host: job.host, porta: job.porta || 9100, buffer });
          if (r.informa !== false) anotar(job.equipamentoId, r.estado, r.detalhe);
          if (!r.saiu) { parada = r; break; }
        }
        enviadas++;
      }
    } catch (e) {
      ultimoErro = e.message;
      if (t < TENTATIVAS) await sleep(500 * t);
    }
  }
  if (parada) {
    if (parada.motivo === 'interrompido' || enviadas > 0) {
      await avisar(`/impressao/${job.id}/interrompido`, { motivo: parada.detalhe || parada.estado });
      console.error(`  ⏸ ${String(job.id).slice(0, 8)} interrompido (${parada.detalhe}) — volta inteiro, marcado`);
    } else {
      await avisar(`/impressao/${job.id}/devolver`, {});
    }
    return 'parada';
  }
  if (enviadas >= vias) {
    lembrarImpresso(job.id); // ANTES da confirmação
    await avisar(`/impressao/${job.id}/impresso`, {});
    if (local) anotar(job.equipamentoId, 'pronta', null);
    console.log(`  ✓ ${String(job.id).slice(0, 8)} -> ${local ? 'usb:' + job.dispositivo : job.impressora || job.host}` + (vias > 1 ? ` (${vias} vias)` : ''));
    return 'ok';
  }
  await avisar(`/impressao/${job.id}/erro`, { erro: ultimoErro });
  anotar(job.equipamentoId, local ? 'erro' : 'sem_resposta', ultimoErro);
  console.error(`  ✗ ${String(job.id).slice(0, 8)} não saiu (${enviadas}/${vias} vias): ${ultimoErro}`);
  return 'falha';
}

// ===== UMA FILA POR IMPRESSORA + PAUSA (como o servidor da loja) =====
// Parada (respondeu sem papel/tampa aberta): confere de novo em 5 s. Não respondeu: 30 s, dobrando
// até 5 min. Os cupons que esperavam voltam para a fila sem gastar tentativa.
const PAUSA_PARADA_MS = Number(process.env.PRINT_PAUSA_PARADA_MS || 5000);
const filas = new Map();
const pausa = new Map();
// Só as PAUSADAS ficam de fora da próxima espera. A impressora que está imprimindo continua
// recebendo: o cupom novo entra na fila dela aqui e sai na vez dele. Excluí-la também (como o agente
// antigo) segurava o cupom seguinte até a espera longa inteira acabar — medido: ~20 s de atraso
// para o segundo cupom da mesma impressora.
function foraDaReserva() {
  const agora = Date.now();
  const ids = [];
  for (const [id, p] of pausa) if (p.ate > agora) ids.push(id);
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
      try { r = await imprimirJob(job, recebidoEm); } catch (e) { console.error(`  ${String(job.id).slice(0, 8)} — erro inesperado: ${e?.message ?? e}`); continue; }
      if (r === 'ok') pausa.delete(chave);
      if ((r === 'falha' || r === 'parada') && chave !== '-') {
        const p = pausa.get(chave) ?? { falhas: 0, ate: 0 };
        if (r === 'parada') p.ate = Date.now() + PAUSA_PARADA_MS;
        else { p.falhas++; p.ate = Date.now() + Math.min(5 * 60_000, 30_000 * 2 ** (p.falhas - 1)); }
        pausa.set(chave, p);
        for (const resto of f.jobs.splice(0)) await avisar(`/impressao/${resto.job.id}/devolver`, {});
      }
    }
  } finally {
    f.rodando = false;
    if (!f.jobs.length) filas.delete(chave);
  }
}

// ===== BATIDA (a cada minuto) =====
async function bater() {
  await atualizarImpressorasWindows();
  const lista = [...estados].map(([equipamentoId, e]) => ({ equipamentoId, ...e }));
  try {
    await api('POST', '/impressao/estacao/batida', { versao: VERSAO, maquina: MAQUINA, impressoras: impressorasDoWindows, estados: lista }, 15000);
  } catch { /* rede: a próxima batida tenta */ }
}

// ===== CICLO: espera longa na fila =====
let falhasSeguidas = 0;
async function ciclo() {
  try {
    const r = await api('POST', '/impressao/pendentes', { espera: 25, excluir: foraDaReserva() }, 45_000);
    if (r.status === 401) {
      console.error('  a estação foi recusada (revogada ou não pareada) — gere um código no Regem e pareie de novo');
      await sleep(60_000);
      return;
    }
    if (r.status >= 400) throw new Error(`fila HTTP ${r.status}`);
    const recebidoEm = Date.now();
    for (const j of Array.isArray(r.json) ? r.json : []) {
      const chave = j.equipamentoId || '-';
      const f = filas.get(chave) ?? { jobs: [], rodando: false };
      f.jobs.push({ job: j, recebidoEm });
      filas.set(chave, f);
      rodarFila(chave);
    }
    falhasSeguidas = 0;
  } catch (e) {
    falhasSeguidas++;
    console.error(`  sem contato com ${API} (${String(e?.message ?? e).slice(0, 120)})`);
    await sleep(Math.min(60_000, 2000 * 2 ** Math.min(falhasSeguidas - 1, 5)));
  }
}

// ===== PARTIDA =====
process.on('unhandledRejection', (e) => console.error(`[estacao][unhandledRejection] ${e?.stack ?? e?.message ?? e}`));
const args = process.argv.slice(2);
const arg = (nome) => { const i = args.indexOf(nome); return i >= 0 ? args[i + 1] : undefined; };

if (args.includes('--parear')) {
  try {
    await parear(arg('--parear'), { servidor: arg('--servidor'), api: arg('--api') });
    process.exit(0);
  } catch (e) {
    console.error(`Não pareou: ${e?.message ?? e}`);
    process.exit(1);
  }
}

process.on('uncaughtException', (e) => {
  console.error(`[estacao][uncaughtException] ${e?.stack ?? e?.message ?? e}`);
  process.exit(1); // o serviço do Windows sobe de novo, limpo
});
carregarEnvArquivo(ENV_ARQ);
// Sem pareamento ainda: espera (o instalador pareia; o serviço não fica reiniciando em laço).
while (!process.env.REGEM_API || !process.env.ESTACAO_ID || !process.env.ESTACAO_SEGREDO) {
  console.error(`Estação de impressão sem pareamento (${ENV_ARQ}) — aguardando`);
  await sleep(60_000);
  carregarEnvArquivo(ENV_ARQ);
}
API = process.env.REGEM_API.replace(/\/$/, '');
CA = process.env.REGEM_CA && existsSync(process.env.REGEM_CA) ? readFileSync(process.env.REGEM_CA, 'utf8') : null;
CRED = { 'x-estacao-id': process.env.ESTACAO_ID, 'x-estacao-segredo': process.env.ESTACAO_SEGREDO };
carregarMemoria();
console.log(`Estação de impressão Regem ${VERSAO} — ${process.env.ESTACAO_NOME || process.env.ESTACAO_ID} em ${MAQUINA} → ${API}`);
await bater();
setInterval(bater, Number(process.env.ESTACAO_BATIDA_MS || 60_000));
for (;;) await ciclo();
