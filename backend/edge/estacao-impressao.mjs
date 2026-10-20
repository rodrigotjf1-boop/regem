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
//   node edge/estacao-impressao.mjs --parear <codigo> --servidor <ip>   (loja com servidor)
//   node edge/estacao-impressao.mjs --parear <codigo> [--api <url>]     (loja sem servidor: a nuvem)
//   node edge/estacao-impressao.mjs --parear --servidor <ip>            (o código vem em ESTACAO_CODIGO:
//                                                                        o instalador não o põe na linha)
//   node edge/estacao-impressao.mjs --baixar-ca --servidor <ip ou nome> (o instalador: a CA da loja antes
//                                                                        de parear — ERR-249)
//   node edge/estacao-impressao.mjs                                     (serviço)
//
// PAINEL LOCAL (PR 4): o ícone na bandeja fala com o serviço por HTTP só em 127.0.0.1
// (ESTACAO_PAINEL_PORTA, 17311), com a chave de `painel.key` na pasta de dados — estado das
// impressoras, os últimos cupons, a fila ANTIGA (mig 326: mais de 10 min espera a decisão),
// imprimir teste, reimprimir o último, pausar, e parear com um código novo (ESTACAO_SERVIDOR /
// ESTACAO_API_PAREAR, gravados pelo instalador no serviço).
//
// CONEXÃO COM O SERVIDOR (parte 2, 20/10/2026): "Regem neste PC" vai em todo PC cliente, mesmo sem
// impressora (D1). Procura o servidor quando ele some (o roteador pode trocar o IP dele), só aceita o
// da loja (certificado pelo nome regem.local) e anota regem.local no hosts do Windows quando a rede não
// resolve o nome (D2). Painel: POST /testar, /procurar, /servidor { endereco, usar } e /parear a qualquer
// momento; /estado traz `conexao`. Testes: ESTACAO_HOSTS_ARQ, ESTACAO_REDE_TESTE, ESTACAO_API_NUVEM,
// ESTACAO_PROCURAR_MS, ESTACAO_VIGIA_MS.
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import { readFileSync, writeFileSync, unlinkSync, appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir, hostname, networkInterfaces } from 'node:os';
import { join, dirname } from 'node:path';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { renderEscpos } from './escpos.mjs';
import { imprimirRedeComEstado } from './impressora-estado.mjs';
import { carregarEnvArquivo } from './decifrar-env.mjs';
import { MARCA_REIMPRESSAO, resumoDoCupom } from './impressao-fila.mjs';
import { NOME_DO_SERVIDOR, acharServidor, ehIpv4, enderecoDigitado, enderecosDaRede, hostsComServidor, ipNoHosts } from './achar-servidor.mjs';

const EDGE_DIR = dirname(fileURLToPath(import.meta.url));
const RAIZ = process.env.ESTACAO_RAIZ || dirname(EDGE_DIR); // pasta de instalação
const ENV_ARQ = join(RAIZ, '.env.local');
const VERSAO = process.env.APP_VERSION || 'dev';
const MAQUINA = (hostname() || '').slice(0, 120);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ===== HTTP (sem dependência): o certificado do servidor da loja é da própria loja (ca.pem) =====
// `servername`: o nome que o certificado tem de ter. Com a CA da loja vai sempre `regem.local` (o
// gen-cert sempre o põe): assim a estação fala com o servidor pelo IP NOVO — o certificado foi emitido
// para o IP da instalação — e continua conferindo que é o servidor DA LOJA (outra CA é recusada).
function chamar(metodo, url, corpo, { ca, inseguro = false, timeoutMs = 15000, headers = {}, servername } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'https:' ? https : http;
    const dados = corpo === undefined ? null : Buffer.from(JSON.stringify(corpo));
    const req = mod.request(
      u,
      {
        method: metodo,
        headers: { ...(dados ? { 'content-type': 'application/json', 'content-length': dados.length } : {}), ...headers },
        ...(u.protocol === 'https:' ? { ca: ca || undefined, rejectUnauthorized: !inseguro, ...(servername ? { servername } : {}) } : {}),
      },
      (res) => {
        const partes = [];
        const ip = String(res.socket?.remoteAddress || '').replace(/^::ffff:/, '') || null;
        res.on('data', (c) => partes.push(c));
        res.on('end', () => {
          const texto = Buffer.concat(partes).toString('utf8');
          let json = null;
          try { json = texto ? JSON.parse(texto) : null; } catch { /* não é JSON */ }
          resolve({ status: res.statusCode, json, texto, ip });
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
// Confiança no primeiro uso, como o instalador do PC cliente: o servidor entrega o certificado da loja
// em /ca.pem; daqui em diante a estação só aceita o servidor assinado por ele.
async function lerCaDoServidor(servidor) {
  const portaWeb = process.env.REGEM_PORTA_WEB || '3001';
  let r;
  try {
    r = await chamar('GET', `https://${servidor}:${portaWeb}/ca.pem`, undefined, { inseguro: true, timeoutMs: 10000 });
  } catch (e) {
    throw new Error(`não consegui falar com o servidor da loja em ${servidor} (${e?.code || e?.message || e}). Confira o endereço e se ele está ligado.`);
  }
  const ca = r.status === 200 && /BEGIN CERTIFICATE/.test(r.texto) ? r.texto : null;
  if (!ca) throw new Error(`O servidor ${servidor} não entregou o certificado da loja. Confira o endereço e se ele está ligado.`);
  return ca;
}
function guardarCa(ca) {
  mkdirSync(join(RAIZ, 'certs'), { recursive: true });
  const arq = join(RAIZ, 'certs', 'servidor-ca.pem');
  writeFileSync(arq, ca);
  return arq;
}

async function parear(codigo, { servidor, api }) {
  let base;
  let ca = null;
  if (servidor) {
    const portaApi = process.env.REGEM_PORTA_API || '3002';
    base = `https://${servidor}:${portaApi}/api/v1`;
    ca = await lerCaDoServidor(servidor);
  } else {
    base = (api || 'https://api.dmsregem.com/api/v1').replace(/\/$/, '');
  }
  const r = await chamar('POST', `${base}/publico/terminal/parear`, { codigo: String(codigo), fingerprint: MAQUINA }, ca ? { ca, servername: NOME_DO_SERVIDOR } : {});
  if (r.status >= 400) throw new Error(r.json?.message || `o servidor recusou o código (HTTP ${r.status})`);
  if (r.json?.tipo !== 'estacao_impressao') {
    throw new Error('Este código é de outro tipo de equipamento. No Regem, gere o código na ESTAÇÃO DE IMPRESSÃO.');
  }
  mkdirSync(RAIZ, { recursive: true });
  const caArq = ca ? guardarCa(ca) : null;
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
// Com a CA da loja, o nome conferido é sempre regem.local: a estação fala com o servidor por um IP
// novo (o roteador trocou) e continua aceitando só o servidor DA LOJA.
const doServidor = () => (CA ? { ca: CA, servername: NOME_DO_SERVIDOR } : {});
function api(metodo, caminho, corpo, timeoutMs) {
  return chamar(metodo, `${API}${caminho}`, corpo, { ...doServidor(), timeoutMs, headers: CRED });
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

// ===== CONEXÃO COM O SERVIDOR DA LOJA (conexão PC ↔ servidor, parte 2 — plano do dono de 20/10/2026) =====
// O roteador pode dar outro IP ao servidor quando ele reinicia (DHCP). Quando a fila falha 2 vezes
// seguidas, a estação procura o servidor (achar-servidor.mjs): o endereço configurado → regem.local →
// o último IP que funcionou → o IP que o servidor informou à nuvem → a rede deste PC. Só aceita quem
// apresenta o certificado DA LOJA com o nome regem.local. Achou por IP (o nome não respondeu aqui):
// anota `IP regem.local` no arquivo hosts do Windows (D2) — o app deste PC continua no mesmo endereço,
// com o pareamento e a fila offline.
const CONEXAO_ARQ = join(RAIZ, 'conexao.json');
const HOSTS_ARQ = process.env.ESTACAO_HOSTS_ARQ || join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts');
const API_NUVEM = (process.env.ESTACAO_API_NUVEM || 'https://api.dmsregem.com/api/v1').replace(/\/$/, '');
const PROCURAR_A_CADA_MS = Number(process.env.ESTACAO_PROCURAR_MS || 2 * 60_000);
const conexao = {
  configurado: null, // o servidor do pareamento (REGEM_API) ou o digitado em "Trocar endereço"
  alvo: null, // o endereço em uso agora
  ip: null, // o IP que respondeu por último
  como: null, // configurado | nome | ultimo-ip | nuvem | varredura | digitado
  ultimaResposta: null,
  latenciaMs: null,
  versaoServidor: null,
  buscando: false,
  busca: null, // a última busca: { em, motivo, duracaoMs, achou, como, passos }
  hosts: null, // a linha do Regem no hosts deste PC: { ip, em }
  hostsErro: null,
};
let portaApi = process.env.REGEM_PORTA_API || '3002';
let ultimoIp = null; // o último IP que respondeu (fica em conexao.json: a busca começa por ele)
let procuradoEm = 0;
let buscaEmAndamento = null;
const modoLocal = () => !!CA; // fala com o servidor da loja; na nuvem não há o que procurar

function lerConexaoSalva() {
  try {
    const s = JSON.parse(readFileSync(CONEXAO_ARQ, 'utf8'));
    if (ehIpv4(s?.ultimoIp)) ultimoIp = s.ultimoIp;
  } catch { /* primeira vez */ }
  try {
    const ip = ipNoHosts(readFileSync(HOSTS_ARQ, 'latin1'));
    if (ip) conexao.hosts = { ip, em: null };
  } catch { /* sem hosts */ }
}
function salvarConexao() {
  try { writeFileSync(CONEXAO_ARQ, JSON.stringify({ ultimoIp, alvo: conexao.alvo, como: conexao.como, em: new Date().toISOString() })); } catch { /* disco: segue */ }
}

// O endereço que a estação usa: o do REGEM_API (pareada) ou o do instalador (ainda sem pareamento).
function iniciarConexao() {
  let host = null;
  if (API) {
    try {
      const u = new URL(API);
      host = u.hostname;
      if (u.port) portaApi = u.port;
    } catch { /* REGEM_API ilegível: fica sem endereço */ }
  } else {
    host = process.env.ESTACAO_SERVIDOR ? enderecoDigitado(process.env.ESTACAO_SERVIDOR) : null;
    // Ainda sem pareamento: a CA que o instalador deixou na pasta (o teste confere a loja com ela).
    const caArq = join(RAIZ, 'certs', 'servidor-ca.pem');
    if (!CA && existsSync(caArq)) {
      try { CA = readFileSync(caArq, 'utf8'); } catch { /* sem CA: o teste não confere */ }
    }
  }
  conexao.configurado = host;
  conexao.alvo = host;
  conexao.como = host ? 'configurado' : null;
}

function apontarPara(host) {
  conexao.alvo = host;
  if (API) API = `https://${host}:${portaApi}/api/v1`;
}

function motivoDaFalha(e) {
  const c = String(e?.code || '');
  if (c === 'ECONNREFUSED') return 'o PC respondeu, mas o Regem não está aberto nele';
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN') return 'a rede não encontrou esse nome';
  if (c === 'EHOSTUNREACH' || c === 'ENETUNREACH') return 'a rede deste PC não alcança esse endereço';
  if (/CERT|SIGNATURE|SELF_SIGNED|ALTNAME|UNABLE_TO_VERIFY/i.test(c)) return 'respondeu, mas não é o servidor desta loja (o certificado é de outro)';
  if (c === 'ECONNRESET') return 'a conexão caiu no meio';
  if (c === 'ETIMEDOUT' || /sem resposta em/.test(String(e?.message))) return 'ninguém respondeu nesse endereço';
  return String(e?.message || c || e).slice(0, 160);
}

/**
 * O servidor da loja responde em `host`? Com a CA da loja: só vale o certificado dela com o nome
 * regem.local (`conferido: true`). Sem a CA (estação nunca pareada): só diz se um servidor Regem
 * responde ali (`conferido: false`) — o pareamento confere depois. Nunca rejeita.
 */
async function testarHost(host, timeoutMs = 3000) {
  const inicio = Date.now();
  try {
    const opc = CA ? { ca: CA, servername: NOME_DO_SERVIDOR, timeoutMs } : { inseguro: true, timeoutMs };
    const r = await chamar('GET', `https://${host}:${portaApi}/api/v1/ping`, undefined, opc);
    // 503 = o servidor está de pé sem o banco: é ele, e a tela dele mostra o problema.
    if (r.json?.regem !== true || r.json?.edge === false) return { ok: false, motivo: 'respondeu, mas não é o servidor Regem da loja' };
    return { ok: true, conferido: !!CA, ms: Date.now() - inicio, ip: r.ip, versao: r.json?.versao ?? null, banco: r.json?.banco !== false };
  } catch (e) {
    return { ok: false, motivo: motivoDaFalha(e) };
  }
}

function marcarResposta(t) {
  conexao.ultimaResposta = new Date().toISOString();
  if (t?.ip) {
    conexao.ip = t.ip;
    if (ehIpv4(t.ip)) ultimoIp = t.ip;
  }
  if (Number.isFinite(t?.ms)) conexao.latenciaMs = t.ms;
  if (t?.versao) conexao.versaoServidor = t.versao;
}

// O IP do servidor que a nuvem conhece (o servidor manda a cada minuto). Precisa da credencial da
// estação e da internet; sem uma das duas, a busca segue pela rede.
async function perguntarNuvem() {
  if (!CRED['x-estacao-id']) return null;
  try {
    const r = await chamar('GET', `${API_NUVEM}/impressao/estacao/servidor`, undefined, { headers: CRED, timeoutMs: 8000 });
    return r.status === 200 && ehIpv4(r.json?.ip) ? r.json.ip : null;
  } catch {
    return null;
  }
}

function redeParaProcurar() {
  // Teste: ESTACAO_REDE_TESTE="127.0.0.2,127.0.0.3" troca a rede deste PC por esta lista.
  if (process.env.ESTACAO_REDE_TESTE) return process.env.ESTACAO_REDE_TESTE.split(',').map((s) => s.trim()).filter(ehIpv4);
  return enderecosDaRede(networkInterfaces());
}

/**
 * D2: anota `IP regem.local` no arquivo hosts deste PC (só a linha do Regem; as outras ficam). O app
 * deste PC abre por regem.local: com a linha, ele acha o servidor no IP novo sem mudar de endereço.
 * Sem permissão: a estação segue pelo IP e o ícone avisa.
 */
function anotarHosts(ip) {
  if (process.platform !== 'win32' && !process.env.ESTACAO_HOSTS_ARQ) return false;
  try {
    let texto = '';
    // latin1: lê e grava byte a byte (o hosts pode ter acento em ANSI) — nada além da linha do Regem muda.
    try { texto = readFileSync(HOSTS_ARQ, 'latin1'); } catch (e) { if (e?.code !== 'ENOENT') throw e; }
    const novo = hostsComServidor(texto, ip);
    if (novo !== texto) {
      writeFileSync(HOSTS_ARQ, novo, 'latin1');
      if (process.platform === 'win32' && !process.env.ESTACAO_HOSTS_ARQ) {
        try { execFileSync('ipconfig.exe', ['/flushdns'], { windowsHide: true, stdio: 'ignore', timeout: 10_000 }); } catch { /* o cache vence sozinho */ }
      }
      console.log(`  anotado no arquivo de nomes deste PC: ${ip} ${NOME_DO_SERVIDOR}`);
    }
    conexao.hosts = { ip, em: new Date().toISOString() };
    conexao.hostsErro = null;
    return true;
  } catch (e) {
    conexao.hostsErro = e?.code === 'EPERM' || e?.code === 'EACCES'
      ? 'sem permissão para gravar o arquivo de nomes (hosts) deste PC'
      : String(e?.message ?? e).slice(0, 160);
    console.error(`  não consegui anotar ${NOME_DO_SERVIDOR} no hosts (${conexao.hostsErro}) — a estação segue pelo IP`);
    return false;
  }
}

// Passa a usar `host` (achado pela busca ou digitado). Achou por IP e o nome não responde aqui → anota
// no hosts; se o endereço configurado é o nome e ele passa a responder, a estação volta para ele.
async function usarServidor(host, como, teste) {
  const antes = conexao.alvo;
  apontarPara(host);
  conexao.como = como;
  marcarResposta(teste);
  if (ehIpv4(host)) {
    // A busca só chega ao último IP, à nuvem ou à varredura depois de o nome falhar; quando o IP é o
    // configurado ou o digitado, o nome é testado agora (com o nome respondendo, o hosts fica como está).
    const nomeFalhou = ['ultimo-ip', 'nuvem', 'varredura'].includes(como) || !(await testarHost(NOME_DO_SERVIDOR)).ok;
    if (nomeFalhou && anotarHosts(host) && conexao.configurado === NOME_DO_SERVIDOR) {
      const deNovo = await testarHost(NOME_DO_SERVIDOR);
      if (deNovo.ok) {
        apontarPara(NOME_DO_SERVIDOR);
        marcarResposta(deNovo);
      }
    }
  }
  salvarConexao();
  if (antes !== conexao.alvo) console.log(`  servidor da loja: ${antes || '(nenhum)'} -> ${conexao.alvo} (${como}${conexao.ip ? `, IP ${conexao.ip}` : ''})`);
}

/**
 * Procura o servidor (uma busca de cada vez; a automática no máximo a cada 2 min). Achou outro
 * endereço: a estação passa a usá-lo. Nunca rejeita (é chamada com `void`).
 */
function procurar(motivo, { forcar = false, peloIcone = false } = {}) {
  if (!CA) return Promise.resolve(null); // nuvem, ou sem a CA da loja: não há como conferir quem responde
  if (buscaEmAndamento) return buscaEmAndamento;
  if (!forcar && Date.now() - procuradoEm < PROCURAR_A_CADA_MS) return Promise.resolve(null);
  procuradoEm = Date.now();
  const inicio = Date.now();
  const passos = [];
  conexao.buscando = true;
  // `peloIcone`: o ícone mostra o resultado na própria ação (sem o aviso do Windows repetido).
  conexao.busca = { em: new Date().toISOString(), motivo, peloIcone, duracaoMs: null, achou: null, como: null, passos };
  buscaEmAndamento = (async () => {
    try {
      const achados = new Map();
      const r = await acharServidor({
        configurado: conexao.configurado,
        ultimoIp,
        nuvem: perguntarNuvem,
        rede: redeParaProcurar(),
        passos,
        testar: async (host) => {
          const t = await testarHost(host, ehIpv4(host) ? 1500 : 3000);
          if (t.ok) achados.set(host, t);
          return t.ok;
        },
      });
      Object.assign(conexao.busca, { duracaoMs: Date.now() - inicio, achou: r.host, como: r.como });
      if (r.host) await usarServidor(r.host, r.como, achados.get(r.host));
      else console.error(`  procurei o servidor da loja (${motivo}) e não achei — ${passos.length} tentativas`);
      return r;
    } catch (e) {
      console.error(`  a busca do servidor falhou: ${e?.message ?? e}`);
      return null;
    } finally {
      conexao.buscando = false;
      buscaEmAndamento = null;
    }
  })();
  return buscaEmAndamento;
}

// "Testar conexão" do ícone: testa o endereço em uso; sem resposta (e com a CA da loja), procura.
async function testarAgora() {
  const alvo = conexao.alvo;
  if (!alvo) return { ok: false, motivo: 'a estação não sabe o endereço do servidor — digite o endereço ou pareie com um código' };
  const t = await testarHost(alvo);
  if (t.ok) {
    marcarResposta(t);
    return { ...t, alvo };
  }
  if (!CA) return { ...t, alvo };
  const r = await procurar('teste pelo ícone', { forcar: true, peloIcone: true });
  return { ...t, alvo, busca: conexao.busca, achou: r?.host ?? null, agora: conexao.alvo };
}

// "Procurar o servidor" do ícone: a busca inteira agora, sem esperar os 2 min da automática.
async function procurarPeloPainel() {
  if (!CA) throw new Error('Sem o certificado da loja neste PC não dá para conferir quem responde. Pareie com um código e o endereço do servidor.');
  const r = await procurar('pedido pelo ícone', { forcar: true, peloIcone: true });
  return { achou: r?.host ?? null, como: r?.como ?? null, agora: conexao.alvo, busca: conexao.busca, hosts: conexao.hosts, hostsErro: conexao.hostsErro };
}

// "Trocar endereço do servidor" (emergência): testa o endereço digitado e, com `usar`, passa a usá-lo e
// o grava como o configurado (fica depois de reiniciar).
async function trocarServidor(endereco, usar) {
  const host = enderecoDigitado(endereco);
  if (!host) throw new Error('Digite o IP do servidor (ex.: 192.168.0.30) ou o nome dele na rede.');
  const t = await testarHost(host, 4000);
  if (!t.ok) return { ok: false, endereco: host, motivo: t.motivo };
  if (!usar) return { ...t, endereco: host };
  if (!API) {
    // Sem pareamento: o endereço vale para o próximo "Parear com código" (o pareamento confere a loja).
    conexao.configurado = host;
    conexao.alvo = host;
    conexao.como = 'digitado';
    return { ...t, endereco: host, usado: true };
  }
  await usarServidor(host, 'digitado', t);
  gravarEnderecoNoEnv(host);
  return { ...t, endereco: host, usado: true, agora: conexao.alvo, hosts: conexao.hosts, hostsErro: conexao.hostsErro };
}

// O endereço digitado vira o REGEM_API do `.env.local` (só esta linha muda; o segredo cifrado fica).
function gravarEnderecoNoEnv(host) {
  try {
    const nova = `REGEM_API=https://${host}:${portaApi}/api/v1`;
    const linhas = readFileSync(ENV_ARQ, 'utf8').split(/\r?\n/);
    const i = linhas.findIndex((l) => l.startsWith('REGEM_API='));
    if (i >= 0) linhas[i] = nova;
    else linhas.unshift(nova);
    writeFileSync(ENV_ARQ, linhas.join('\r\n'));
    process.env.REGEM_API = nova.slice('REGEM_API='.length);
    conexao.configurado = host;
  } catch (e) {
    console.error(`  não consegui gravar o endereço novo em ${ENV_ARQ} (${e?.message ?? e}) — vale até reiniciar`);
  }
}

// ===== O QUE O PAINEL DO PC MOSTRA (o ícone na bandeja) =====
let impressorasDaEstacao = []; // vem na resposta da batida: as impressoras ligadas nesta estação
const ultimoDe = new Map(); // equipamentoId → o último cupom que saiu nela ("Reimprimir o último")
const recentes = []; // os últimos 30 cupons desta estação, o mais novo primeiro
let retidos = []; // fila ANTIGA (mig 326): mais de 10 min, esperando a decisão de quem está no PC
let retidosEm = null;
const contato = { ok: false, em: null, erro: null }; // a última conversa com o servidor
const pausaManual = new Set(); // "Pausar esta impressora" no ícone
function registrar(job, situacao) {
  recentes.unshift({
    id: job.id,
    em: new Date().toISOString(),
    impressora: job.impressora || job.dispositivo || job.host || '',
    resumo: resumoDoCupom(job.conteudo),
    situacao, // impresso | interrompido | esperando | falhou | teste | reimpresso
  });
  recentes.splice(30);
}

const TENTATIVAS = 3;
const RESERVA_UTIL_MS = 100_000; // a reserva é de 120 s: depois disto pode ter ido para outra

// Devolve 'ok' | 'config' | 'falha' (não recebeu) | 'parada' (respondeu: sem papel, tampa…) | 'pulado'.
async function imprimirJob(job, recebidoEm) {
  if (impressos.has(job.id)) { await avisar(`/impressao/${job.id}/impresso`, {}); return 'ok'; }
  if (Date.now() - recebidoEm > RESERVA_UTIL_MS) return 'pulado';
  const local = job.conexao === 'local';
  const definitivo = (motivo) => { registrar(job, 'falhou'); return avisar(`/impressao/${job.id}/erro`, { erro: motivo, definitivo: true }); };
  if (job.ativo === false) { await definitivo('impressora desativada — use "Imprimir em…" para outra'); return 'config'; }
  if (local && !job.dispositivo) { await definitivo('impressora USB sem o nome do Windows no cadastro'); return 'config'; }
  if (!local && !job.host) { await definitivo('impressora de rede sem IP'); return 'config'; }
  if (local && impressorasDoWindows.length && !impressorasDoWindows.includes(job.dispositivo)) {
    await avisar(`/impressao/${job.id}/erro`, { erro: `a impressora "${job.dispositivo}" não está instalada no PC ${MAQUINA}` });
    anotar(job.equipamentoId, 'erro', 'não está instalada neste PC');
    registrar(job, 'falhou');
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
      registrar(job, 'interrompido');
    } else {
      await avisar(`/impressao/${job.id}/devolver`, {});
      registrar(job, 'esperando');
    }
    return 'parada';
  }
  if (enviadas >= vias) {
    lembrarImpresso(job.id); // ANTES da confirmação
    await avisar(`/impressao/${job.id}/impresso`, {});
    if (local) anotar(job.equipamentoId, 'pronta', null);
    registrar(job, 'impresso');
    if (job.equipamentoId) {
      ultimoDe.set(job.equipamentoId, {
        conteudo: job.conteudo, largura: job.largura, linguagem: job.linguagem, codepage: job.codepage,
        conexao: job.conexao, dispositivo: job.dispositivo, host: job.host, porta: job.porta, impressora: job.impressora,
      });
    }
    console.log(`  ✓ ${String(job.id).slice(0, 8)} -> ${local ? 'usb:' + job.dispositivo : job.impressora || job.host}` + (vias > 1 ? ` (${vias} vias)` : ''));
    return 'ok';
  }
  await avisar(`/impressao/${job.id}/erro`, { erro: ultimoErro });
  anotar(job.equipamentoId, local ? 'erro' : 'sem_resposta', ultimoErro);
  registrar(job, 'falhou');
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
  const ids = [...pausaManual]; // pausada no ícone: fica de fora até alguém retomar
  for (const [id, p] of pausa) if (p.ate > agora) ids.push(id);
  return ids;
}
async function rodarFila(chave) {
  const f = filas.get(chave);
  if (!f || f.rodando) return;
  f.rodando = true;
  try {
    while (f.jobs.length) {
      // Pausada no ícone enquanto o cupom chegava: devolve (sai quando retomarem).
      if (pausaManual.has(chave)) {
        for (const resto of f.jobs.splice(0)) await avisar(`/impressao/${resto.job.id}/devolver`, {});
        break;
      }
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
    const inicio = Date.now();
    const r = await api('POST', '/impressao/estacao/batida', { versao: VERSAO, maquina: MAQUINA, impressoras: impressorasDoWindows, estados: lista }, 15000);
    if (r.status < 500) marcarResposta({ ip: r.ip, ms: Date.now() - inicio }); // o tempo de resposta que o ícone mostra
    // As impressoras ligadas nesta estação (o painel mostra cada uma, mesmo antes do primeiro cupom).
    if (r.status < 300 && Array.isArray(r.json?.impressoras)) impressorasDaEstacao = r.json.impressoras;
  } catch { /* rede: a próxima batida tenta */ }
}

// A fila ANTIGA (mig 326): o servidor guarda; o painel pergunta a cada 30 s e depois de cada decisão.
async function lerRetidos() {
  if (!API) return;
  try {
    const r = await api('GET', '/impressao/estacao/retidos', undefined, 15000);
    if (r.status === 200 && Array.isArray(r.json)) {
      retidos = r.json;
      retidosEm = new Date().toISOString();
    }
  } catch { /* rede: a próxima leitura tenta */ }
}

// ===== CICLO: espera longa na fila =====
let falhasSeguidas = 0;
async function ciclo() {
  try {
    const r = await api('POST', '/impressao/pendentes', { espera: 25, excluir: foraDaReserva() }, 45_000);
    if (r.status === 401) {
      console.error('  a estação foi recusada (revogada ou não pareada) — gere um código no Regem e pareie de novo');
      Object.assign(contato, { ok: false, em: new Date().toISOString(), erro: 'a estação foi recusada (revogada ou não pareada)' });
      await sleep(60_000);
      return;
    }
    if (r.status >= 400) throw new Error(`fila HTTP ${r.status}`);
    Object.assign(contato, { ok: true, em: new Date().toISOString(), erro: null });
    const ipNovo = !!r.ip && r.ip !== ultimoIp;
    marcarResposta({ ip: r.ip });
    if (ipNovo) salvarConexao();
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
    // O ícone mostra o motivo em português ("ninguém respondeu nesse endereço"); o log guarda o original.
    Object.assign(contato, { ok: false, erro: motivoDaFalha(e) });
    // Duas falhas seguidas: o roteador pode ter dado outro IP ao servidor — procura (no máximo a cada 2 min).
    if (falhasSeguidas >= 2) void procurar('a fila parou de responder');
    await sleep(Math.min(60_000, 2000 * 2 ** Math.min(falhasSeguidas - 1, 5)));
  }
}

// ===== PAINEL LOCAL: o ícone na bandeja fala com o serviço por aqui =====
// Só em 127.0.0.1 e com a chave de `painel.key` (gerada aqui; o ícone a lê da mesma pasta). Sem
// cabeçalho de CORS: uma página aberta no navegador deste PC não consegue chamar (o cabeçalho da
// chave dispara a pré-verificação, que não é respondida).
const PAINEL_PORTA = Number(process.env.ESTACAO_PAINEL_PORTA || 17311);
const CHAVE_ARQ = join(RAIZ, 'painel.key');
function chaveDoPainel() {
  try {
    const k = readFileSync(CHAVE_ARQ, 'utf8').trim();
    if (/^[0-9a-f]{32,}$/.test(k)) return k;
  } catch { /* primeira vez */ }
  const k = randomBytes(24).toString('hex');
  mkdirSync(RAIZ, { recursive: true });
  writeFileSync(CHAVE_ARQ, k);
  return k;
}
const iguais = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const daEstacao = (id) => impressorasDaEstacao.find((i) => i.id === id);
const alvoDe = (i) => (i.conexao === 'local' ? `USB: ${i.dispositivo || '(sem nome)'}` : `${i.host || '(sem IP)'}:${i.porta || 9100}`);

function estadoDoPainel() {
  const agora = Date.now();
  return {
    nome: process.env.ESTACAO_NOME || null,
    maquina: MAQUINA,
    versao: VERSAO,
    pareada: !!API,
    servidor: API ? new URL(API).host : process.env.ESTACAO_SERVIDOR || null,
    contato: { ...contato },
    // A conexão com o servidor da loja (parte 2): o endereço em uso, o IP, como foi achado, a busca e o hosts.
    conexao: {
      ...conexao,
      busca: conexao.busca ? { ...conexao.busca, passos: conexao.busca.passos.slice(-12) } : null,
      local: modoLocal(),
      nome: NOME_DO_SERVIDOR,
      porta: portaApi,
      ultimoIp,
    },
    impressoras: impressorasDaEstacao.map((i) => ({
      id: i.id,
      nome: i.nome,
      conexao: i.conexao,
      alvo: alvoDe(i),
      estado: estados.get(i.id)?.estado ?? null,
      detalhe: estados.get(i.id)?.detalhe ?? null,
      pausada: pausaManual.has(i.id),
      parada: (pausa.get(i.id)?.ate ?? 0) > agora,
      naFila: filas.get(i.id)?.jobs.length ?? 0,
      temUltimo: ultimoDe.has(i.id),
    })),
    recentes,
    retidos,
    retidosEm,
  };
}

// Uma via só, direto na impressora (teste e reimpressão do ícone — não passam pela fila).
async function enviarUma(alvo, equipamentoId, conteudo) {
  if (filas.get(equipamentoId)?.rodando) throw new Error('A impressora está imprimindo agora. Tente de novo em instantes.');
  const buffer = renderEscpos(conteudo, alvo.largura || 80, alvo.linguagem, alvo.codepage);
  if (alvo.conexao === 'local') {
    if (!alvo.dispositivo) throw new Error('A impressora USB está sem o nome do Windows no cadastro.');
    await enviarWindows(alvo.dispositivo, buffer);
    anotar(equipamentoId, 'pronta', null);
    return;
  }
  if (!alvo.host) throw new Error('A impressora de rede está sem IP no cadastro.');
  const r = await imprimirRedeComEstado({ host: alvo.host, porta: alvo.porta || 9100, buffer });
  if (r.informa !== false) anotar(equipamentoId, r.estado, r.detalhe);
  if (!r.saiu) throw new Error(`A impressora não imprimiu: ${r.detalhe || r.estado || 'sem resposta'}.`);
}

async function testarImpressora(id) {
  const imp = daEstacao(id);
  if (!imp) throw new Error('Esta impressora não está ligada nesta estação.');
  const hora = new Date().toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const conteudo = [
    '@CB TESTE DE IMPRESSAO',
    `@C ${process.env.ESTACAO_NOME || 'Estacao de impressao'}`,
    `Impressora: ${imp.nome}`,
    `PC: ${MAQUINA}`,
    `Hora: ${hora}`,
    '',
  ].join('\n');
  await enviarUma(imp, id, conteudo);
  registrar({ id: `teste-${Date.now()}`, impressora: imp.nome, conteudo: `Teste de impressão\n${imp.nome}` }, 'teste');
  return { ok: true };
}

async function reimprimirUltimo(id) {
  const u = ultimoDe.get(id);
  if (!u) throw new Error('Nenhum cupom saiu nesta impressora desde que a estação ligou.');
  // Marcada como reimpressão (decisão do dono): ninguém faz o pedido duas vezes.
  const conteudo = String(u.conteudo).startsWith(MARCA_REIMPRESSAO) ? u.conteudo : `${MARCA_REIMPRESSAO}\n${u.conteudo}`;
  await enviarUma(u, id, conteudo);
  registrar({ id: `reimpresso-${Date.now()}`, impressora: u.impressora, conteudo: u.conteudo }, 'reimpresso');
  return { ok: true };
}

async function pausarImpressora(id, pausar) {
  if (!daEstacao(id)) throw new Error('Esta impressora não está ligada nesta estação.');
  if (pausar) {
    pausaManual.add(id);
    // O que já estava na fila local volta para o servidor (sai quando retomarem).
    const f = filas.get(id);
    if (f && !f.rodando) for (const resto of f.jobs.splice(0)) await avisar(`/impressao/${resto.job.id}/devolver`, {});
  } else {
    pausaManual.delete(id);
    pausa.delete(id);
  }
  return { ok: true, pausada: pausaManual.has(id) };
}

async function decidirFilaAntiga(corpo) {
  if (!API) throw new Error('A estação ainda não foi pareada.');
  const acao = corpo?.acao;
  if (acao !== 'imprimir' && acao !== 'descartar') throw new Error('Ação inválida: imprimir ou descartar.');
  const ids = Array.isArray(corpo?.ids) ? corpo.ids.filter((x) => typeof x === 'string').slice(0, 200) : undefined;
  const r = await api('POST', '/impressao/estacao/retidos', { acao, ...(ids ? { ids } : {}) }, 15000);
  if (r.status >= 400) throw new Error(r.json?.message || `o servidor recusou (HTTP ${r.status})`);
  await lerRetidos();
  return { ok: true, feitos: r.json?.feitos ?? 0 };
}

// Parear pelo ícone (o código venceu na instalação, a estação foi revogada ou trocada de servidor) — a
// qualquer momento, mesmo já pareada (parte 2). O endereço: o digitado no ícone, o que responde agora
// (a busca pode ter achado o servidor num IP novo) ou o do instalador.
let acordarPareamento = null;
async function parearPeloPainel(codigo, endereco) {
  if (!/^\d{6}$/.test(String(codigo ?? ''))) throw new Error('O código tem 6 números.');
  let servidor;
  if (String(endereco ?? '').trim()) {
    servidor = enderecoDigitado(endereco);
    if (!servidor) throw new Error('Digite o IP do servidor (ex.: 192.168.0.30) ou o nome dele na rede.');
  } else {
    servidor = (CA && conexao.alvo) || process.env.ESTACAO_SERVIDOR || undefined;
  }
  const apiNuvem = servidor ? undefined : process.env.ESTACAO_API_PAREAR || undefined;
  if (!servidor && !apiNuvem) throw new Error('A estação não sabe o endereço do servidor da loja — digite o endereço dele.');
  await parear(String(codigo), { servidor, api: apiNuvem });
  // Lê o .env.local novo no lugar do antigo (as variáveis do arquivo anterior saem antes).
  for (const k of ['REGEM_API', 'REGEM_CA', 'ESTACAO_ID', 'ESTACAO_SEGREDO', 'ESTACAO_NOME']) delete process.env[k];
  carregarEnvArquivo(ENV_ARQ);
  if (aplicarConfig()) {
    iniciarConexao();
    salvarConexao();
    void bater();
    void lerRetidos();
  }
  acordarPareamento?.();
  return { ok: true, nome: process.env.ESTACAO_NOME || null };
}

function lerCorpo(req) {
  return new Promise((resolve, reject) => {
    const partes = [];
    let tam = 0;
    req.on('data', (c) => {
      tam += c.length;
      if (tam > 16_384) { reject(new Error('corpo grande demais')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      const t = Buffer.concat(partes).toString('utf8');
      try { resolve(t ? JSON.parse(t) : {}); } catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

function subirPainel() {
  const chave = chaveDoPainel();
  const srv = http.createServer(async (req, res) => {
    const responder = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(obj));
    };
    if (!iguais(req.headers['x-painel-chave'] || '', chave)) return responder(401, { erro: 'chave do painel inválida' });
    let corpo = {};
    if (req.method === 'POST') {
      try { corpo = await lerCorpo(req); } catch { return responder(400, { erro: 'corpo inválido' }); }
    }
    const rota = `${req.method} ${new URL(req.url || '/', 'http://127.0.0.1').pathname}`;
    try {
      if (rota === 'GET /estado') return responder(200, estadoDoPainel());
      if (rota === 'POST /teste') return responder(200, await testarImpressora(corpo.equipamentoId));
      if (rota === 'POST /reimprimir') return responder(200, await reimprimirUltimo(corpo.equipamentoId));
      if (rota === 'POST /pausar') return responder(200, await pausarImpressora(corpo.equipamentoId, corpo.pausar !== false));
      if (rota === 'POST /retidos') return responder(200, await decidirFilaAntiga(corpo));
      if (rota === 'POST /parear') return responder(200, await parearPeloPainel(corpo.codigo, corpo.endereco));
      // Conexão com o servidor (parte 2): testar, procurar e o endereço de emergência.
      if (rota === 'POST /testar') return responder(200, await testarAgora());
      if (rota === 'POST /procurar') return responder(200, await procurarPeloPainel());
      if (rota === 'POST /servidor') return responder(200, await trocarServidor(corpo.endereco, corpo.usar === true));
      return responder(404, { erro: 'rota desconhecida' });
    } catch (e) {
      return responder(400, { erro: String(e?.message ?? e).slice(0, 300) });
    }
  });
  srv.on('error', (e) => console.error(`  painel local não subiu (${e?.message ?? e}) — o ícone fica sem dados; a impressão segue`));
  srv.listen(PAINEL_PORTA, '127.0.0.1');
}

function aplicarConfig() {
  if (!process.env.REGEM_API || !process.env.ESTACAO_ID || !process.env.ESTACAO_SEGREDO) return false;
  API = process.env.REGEM_API.replace(/\/$/, '');
  CA = process.env.REGEM_CA && existsSync(process.env.REGEM_CA) ? readFileSync(process.env.REGEM_CA, 'utf8') : null;
  CRED = { 'x-estacao-id': process.env.ESTACAO_ID, 'x-estacao-segredo': process.env.ESTACAO_SEGREDO };
  return true;
}

// ===== PARTIDA =====
process.on('unhandledRejection', (e) => console.error(`[estacao][unhandledRejection] ${e?.stack ?? e?.message ?? e}`));
const args = process.argv.slice(2);
const arg = (nome) => {
  const i = args.indexOf(nome);
  const v = i >= 0 ? args[i + 1] : undefined;
  return v && !v.startsWith('--') ? v : undefined;
};

if (args.includes('--parear')) {
  try {
    // O código vem na linha ou em ESTACAO_CODIGO (o instalador não o põe na linha: ficaria no log).
    await parear(arg('--parear') || process.env.ESTACAO_CODIGO, { servidor: arg('--servidor'), api: arg('--api') });
    process.exit(0);
  } catch (e) {
    console.error(`Não pareou: ${e?.message ?? e}`);
    process.exit(1);
  }
}

// O instalador do PC cliente: a CA da loja ANTES de parear. O "Regem neste PC" confere o servidor com
// ela (também sem impressora — D1), e o instalador a confia no Windows para o navegador. O PowerShell
// 5.1 do instalador não tem -SkipCertificateCheck: o download por ele falhava (ERR-249).
//   node edge/estacao-impressao.mjs --baixar-ca --servidor <ip ou nome>   → grava certs/servidor-ca.pem
if (args.includes('--baixar-ca')) {
  try {
    const servidor = enderecoDigitado(arg('--servidor'));
    if (!servidor) throw new Error('informe o servidor: --servidor <IP ou nome>');
    console.log(guardarCa(await lerCaDoServidor(servidor)));
    process.exit(0);
  } catch (e) {
    console.error(`Não baixei o certificado da loja: ${e?.message ?? e}`);
    process.exit(1);
  }
}

process.on('uncaughtException', (e) => {
  console.error(`[estacao][uncaughtException] ${e?.stack ?? e?.message ?? e}`);
  process.exit(1); // o serviço do Windows sobe de novo, limpo
});
carregarEnvArquivo(ENV_ARQ);
lerConexaoSalva();
aplicarConfig();
iniciarConexao(); // pareada ou não: o ícone mostra a conexão e testa o servidor desde já
subirPainel(); // antes do pareamento: é por ele que o ícone pareia quando o código venceu
// Sem pareamento (PC sem impressora — D1 — ou o código venceu): sem a fila para notar que o servidor
// sumiu, o serviço testa o endereço a cada minuto; duas falhas seguidas → procura (e anota o hosts, se
// for o caso: o app deste PC abre por regem.local). Pareou: a fila assume.
let falhasSemPareamento = 0;
async function vigiarSemPareamento() {
  if (API || !CA || !conexao.alvo || buscaEmAndamento) return;
  const t = await testarHost(conexao.alvo);
  if (t.ok) {
    falhasSemPareamento = 0;
    marcarResposta(t);
  } else if (++falhasSemPareamento >= 2) {
    void procurar('o servidor parou de responder');
  }
}
const vigia = setInterval(() => void vigiarSemPareamento(), Number(process.env.ESTACAO_VIGIA_MS || 60_000));
void vigiarSemPareamento();
// Sem pareamento ainda: espera (o instalador ou o ícone pareiam; o serviço não fica reiniciando em laço).
while (!aplicarConfig()) {
  console.error(`Estação de impressão sem pareamento (${ENV_ARQ}) — aguardando`);
  await new Promise((r) => { acordarPareamento = r; setTimeout(r, 60_000); });
  carregarEnvArquivo(ENV_ARQ);
}
iniciarConexao(); // pareada: o endereço e a porta do REGEM_API
clearInterval(vigia);
carregarMemoria();
console.log(`Estação de impressão Regem ${VERSAO} — ${process.env.ESTACAO_NOME || process.env.ESTACAO_ID} em ${MAQUINA} → ${API}`);
// O servidor responde no endereço configurado? Senão, procura antes de começar (o roteador pode ter
// trocado o IP dele enquanto este PC estava desligado).
if (modoLocal()) {
  const t = await testarHost(conexao.alvo);
  if (t.ok) marcarResposta(t);
  else await procurar('partida do serviço', { forcar: true });
}
await bater();
setInterval(bater, Number(process.env.ESTACAO_BATIDA_MS || 60_000));
void lerRetidos();
setInterval(lerRetidos, Number(process.env.ESTACAO_RETIDOS_MS || 30_000));
for (;;) await ciclo();
