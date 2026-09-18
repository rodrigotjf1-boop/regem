// Worker de IMPRESSAO do servidor local (edge). Roda ao lado do backend/Postgres
// locais. Estrategia de maior qualidade e menor risco:
//   - LISTEN 'impressao_nova' (Postgres NOTIFY) -> imprime NA HORA que o job entra;
//   - POLL de 3s como rede de seguranca (caso uma notificacao se perca);
//   - quando ha fila, DRENA em rajada ate esvaziar (sem esperar o proximo tick).
// Envia o ticket por TCP RAW (porta 9100) para o IP da impressora, com retry/
// backoff (3 tentativas). So marca 'erro' depois de esgotar as tentativas.
//
// Config por env (herda do .env.local do edge, como os outros daemons):
//   EDGE_DATABASE_URL   banco do servidor local (fonte da fila)
//   PRINT_POLL_MS       intervalo do poll de seguranca (default 3000)
//   PRINT_PORTA_PADRAO  porta TCP padrao das impressoras (default 9100)
import pg from 'pg';
import net from 'net';
import { spawn } from 'child_process';
import { readFileSync, existsSync, writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import { renderEscpos } from './escpos.mjs';
import {
  SQL_RESERVAR, SQL_OUTRA_LOJA, SQL_RENOVAR, SQL_IMPRESSO, SQL_ERRO, SQL_ERRO_DEFINITIVO,
  SQL_DEVOLVER, SQL_STATUS,
} from './impressao-fila.mjs';

// Servico do Windows nao tem shell que exporte envs: carrega o .env.local na mao
// e DECIFRA os enc: DPAPI (senao a EDGE_DATABASE_URL fica cifrada -> pg 28P01).
import { carregarEnvLocal } from './decifrar-env.mjs';
carregarEnvLocal(import.meta.url);

function req(k) {
  const v = process.env[k];
  if (!v) {
    console.error(`Falta a env ${k}`);
    process.exit(1);
  }
  return v;
}

const EDGE_DB = req('EDGE_DATABASE_URL');
const POLL_MS = Number(process.env.PRINT_POLL_MS || 3000);
const PORTA_PADRAO = Number(process.env.PRINT_PORTA_PADRAO || 9100);
const TENTATIVAS = 3;
const AUTO_RETRY_CAP = 5; // rounds de re-tentativa automática (P2) antes de 'erro' terminal
const WORKER_ID = `edge-${randomUUID().slice(0, 8)}`; // identifica a reserva (claim) deste worker

const pool = new pg.Pool({ connectionString: EDGE_DB });
// Resiliencia (auditoria ago/2026): Postgres reiniciado (57P01, a cada install/update)
// emite 'error' na conexao OCIOSA do pool -> SEM handler o Node derruba o daemon. So
// logamos; o pg descarta a conexao morta e reabre na proxima query.
pool.on('error', (e) => console.error(`[impressao] pool: conexao ociosa caiu (${e?.code ?? e?.message}) - descartada, segue no ar`));
const mask = EDGE_DB.replace(/:[^:@/]*@/, ':****@');

// Rede de seguranca do PROCESSO (E1): sem estes handlers, uma promise rejeitada / excecao nao
// tratada (ex.: erro de DB no drain) DERRUBA o servico em silencio. unhandledRejection: loga e
// segue. uncaughtException: estado desconhecido -> loga e SAI (1) p/ o NSSM reiniciar limpo
// (AppThrottle no instalar-servicos.ps1 evita crash-loop).
process.on('unhandledRejection', (e) => console.error(`[unhandledRejection] ${e?.stack ?? e?.message ?? e}`));
process.on('uncaughtException', (e) => {
  console.error(`[uncaughtException] ${e?.stack ?? e?.message ?? e}`);
  process.exit(1);
});

// Envia bytes crus por TCP para host:porta (protocolo RAW/9100 das termicas).
// Duas esperas: CONECTAR (3 s — impressora desligada/IP errado não responde nada, e esperar 8 s
// por tentativa travava a fila dela por ~25 s por job) e ENVIAR (8 s depois de conectada — uma
// impressora ligada e lenta, ou sem papel segurando o buffer, ainda tem folga).
const CONECTAR_MS = Number(process.env.PRINT_CONECTAR_MS || 3000);
function enviarTcp(host, porta, buffer) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port: porta || PORTA_PADRAO });
    let feito = false;
    const fim = (err) => {
      if (feito) return;
      feito = true;
      clearTimeout(tConectar);
      sock.destroy();
      err ? reject(err) : resolve();
    };
    const tConectar = setTimeout(() => fim(new Error(`impressora não respondeu (sem conexão em ${CONECTAR_MS / 1000} s)`)), CONECTAR_MS);
    sock.setTimeout(8000);
    sock.on('connect', () => {
      clearTimeout(tConectar);
      sock.write(buffer, () => sock.end());
    });
    sock.on('close', () => fim());
    sock.on('timeout', () => fim(new Error('timeout na conexao com a impressora')));
    sock.on('error', (e) => fim(e));
  });
}

// Imprime bytes crus numa impressora instalada no WINDOWS (USB/local) pelo NOME.
// Usa o spooler em modo RAW (via raw-print.ps1 → winspool WritePrinter), que NÃO
// rasteriza: os comandos ESC/POS (negrito, fonte dupla, corte) chegam intactos.
const RAW_PS1 = fileURLToPath(new URL('./raw-print.ps1', import.meta.url));
function enviarWindows(dispositivo, buffer) {
  return new Promise((resolve, reject) => {
    const tmp = join(tmpdir(), `regem-print-${Date.now()}-${randomUUID().slice(0, 8)}.bin`);
    try {
      writeFileSync(tmp, buffer);
    } catch (e) {
      return reject(e);
    }
    const limpar = () => {
      try {
        unlinkSync(tmp);
      } catch {
        /* já removido */
      }
    };
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', RAW_PS1, '-PrinterName', dispositivo, '-FilePath', tmp],
      { windowsHide: true },
    );
    let err = '';
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', (e) => {
      limpar();
      reject(e);
    });
    child.on('close', (code) => {
      limpar();
      code === 0 ? resolve() : reject(new Error(err.trim().slice(0, 200) || `powershell saiu com código ${code}`));
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Marca 'impresso' com insistência: o papel JÁ saiu — se esta gravação falhar e o job voltar
// para a fila, ele sai de novo. Três tentativas curtas antes de desistir (e logar).
async function marcarImpresso(id) {
  for (let t = 1; t <= 3; t++) {
    try {
      await pool.query(SQL_IMPRESSO, [id]);
      return;
    } catch (e) {
      if (t === 3) console.error(`  ! job ${id.slice(0, 8)} impresso, mas não consegui gravar: ${e.message} — pode sair de novo`);
      else await sleep(300 * t);
    }
  }
}
// Os dois marcadores de erro NUNCA estouram: uma exceção aqui subia até o `ouvir()`, que
// abria um SEGUNDO cliente LISTEN com o primeiro ainda conectado.
async function marcarErro(id, msg) {
  try {
    await pool.query(SQL_ERRO, [id, String(msg || 'falha').slice(0, 400), AUTO_RETRY_CAP]);
  } catch (e) {
    console.error(`  ! não gravei o erro do job ${id.slice(0, 8)}: ${e.message} (a reserva vence e ele volta)`);
  }
}
async function marcarErroDefinitivo(id, msg) {
  try {
    await pool.query(SQL_ERRO_DEFINITIVO, [id, String(msg).slice(0, 400)]);
  } catch (e) {
    console.error(`  ! não gravei o erro do job ${id.slice(0, 8)}: ${e.message}`);
  }
}

// Estado da impressora (mig 269) — best-effort: banco antigo sem a tabela não atrapalha a impressão.
async function registrarEstado(equipamentoId, saiu, erro) {
  if (!equipamentoId) return;
  try {
    await pool.query(SQL_STATUS, [equipamentoId, !!saiu, saiu ? null : String(erro || 'falha').slice(0, 300)]);
  } catch { /* sem a mig 269: segue sem o estado */ }
}

// Imprime um job com retry/backoff. Devolve 'ok' (saiu), 'config' (erro de cadastro — não é
// a impressora que caiu), 'falha' (a impressora não recebeu) ou 'perdida' (a reserva não é mais
// deste worker; não imprimiu).
async function imprimirJob(job) {
  const local = job.conexao === 'local';
  // Erro de CONFIGURAÇÃO não melhora tentando de novo: vai direto para 'erro' com o motivo.
  if (!job.conexao && !job.host && !job.dispositivo) {
    await marcarErroDefinitivo(job.id, 'impressora não encontrada (removida ou sem cadastro)');
    console.error(`  job ${job.id.slice(0, 8)} — impressora inexistente`);
    return 'config';
  }
  // Desativada no cadastro: não imprime o que ficou na fila dela (antes saía mesmo assim —
  // medido). O gestor redireciona pelo "Imprimir em…".
  if (job.ativo === false) {
    await marcarErroDefinitivo(job.id, 'impressora desativada — use "Imprimir em…" para outra');
    console.error(`  job ${job.id.slice(0, 8)} — impressora "${job.impressora || '?'}" desativada`);
    return 'config';
  }
  if (local && !job.dispositivo) {
    await marcarErroDefinitivo(job.id, 'impressora local sem nome do Windows');
    await registrarEstado(job.equipamento_id, false, 'sem nome do Windows no cadastro');
    console.error(`  job ${job.id.slice(0, 8)} — impressora "${job.impressora || '?'}" local sem nome`);
    return 'config';
  }
  if (!local && !job.host) {
    await marcarErroDefinitivo(job.id, 'impressora de rede sem IP configurado');
    await registrarEstado(job.equipamento_id, false, 'sem IP no cadastro');
    console.error(`  job ${job.id.slice(0, 8)} — impressora "${job.impressora || '?'}" sem IP`);
    return 'config';
  }
  // A reserva do lote pode ter vencido enquanto os jobs anteriores esperavam uma impressora
  // fora do ar: renova ESTE job agora; se ele não é mais nosso, não imprime.
  try {
    const r = await pool.query(SQL_RENOVAR, [job.id, WORKER_ID]);
    if (!r.rowCount) return 'perdida';
  } catch (e) {
    console.error(`  job ${job.id.slice(0, 8)} — não renovei a reserva (${e.message}); fica para o próximo ciclo`);
    return 'perdida';
  }
  const vias = Math.max(1, Number(job.vias) || 1);
  const buffer = renderEscpos(job.conteudo, job.largura || 80, job.linguagem, job.codepage);
  const enviar = local
    ? () => enviarWindows(job.dispositivo, buffer)
    : () => enviarTcp(job.host, job.porta, buffer);
  const alvo = local ? `win:${job.dispositivo}` : `${job.impressora || job.host}:${job.porta || PORTA_PADRAO}`;
  let ultimoErro = null;
  let enviadas = 0; // via-a-via: uma via que já saiu NÃO é reimpressa no retry
  for (let t = 1; t <= TENTATIVAS && enviadas < vias; t++) {
    try {
      while (enviadas < vias) {
        await enviar();
        enviadas++;
      }
    } catch (e) {
      ultimoErro = e.message;
      if (t < TENTATIVAS) await sleep(500 * t); // backoff 0.5s, 1s
    }
  }
  if (enviadas >= vias) {
    // Fora do laço de envio: falha AO GRAVAR não pode virar reenvio do papel.
    await marcarImpresso(job.id);
    await registrarEstado(job.equipamento_id, true);
    console.log(`  ✓ job ${job.id.slice(0, 8)} -> ${alvo}` + (vias > 1 ? ` (${vias} vias)` : ''));
    return 'ok';
  }
  await marcarErro(job.id, ultimoErro);
  await registrarEstado(job.equipamento_id, false, ultimoErro);
  console.error(`  ✗ job ${job.id.slice(0, 8)} falhou apos ${TENTATIVAS} tentativas (${enviadas}/${vias} vias): ${ultimoErro}`);
  return 'falha';
}

// F2 (roteamento por loja): unidade DESTE edge. Setada → só imprime os jobs DELA e os "da
// rede", e só em impressoras DELA ou sem loja (ver SQL_RESERVAR). Vazio (1 loja / edge
// antigo) → sem filtro de loja, comportamento de sempre.
const EDGE_UNIDADE = (process.env.EDGE_UNIDADE_ID || '').trim() || null;
async function pendentes() {
  if (EDGE_UNIDADE) {
    const r = await pool.query(SQL_OUTRA_LOJA, [EDGE_UNIDADE]);
    if (r.rowCount) console.error(`  ${r.rowCount} job(s) apontando para impressora de OUTRA loja — encerrados com erro (redirecione pelo painel)`);
  }
  const r = await pool.query(SQL_RESERVAR, [WORKER_ID, EDGE_UNIDADE, foraDaReserva()]);
  return r.rows;
}

// ===== UMA FILA POR IMPRESSORA (em paralelo) + DISJUNTOR =====
// Antes: uma fila só para todas as impressoras, um job de cada vez. Impressora desligada prendia
// o worker ~25 s por job — medido: via da COZINHA esperou 77 s atrás de três cupons de um caixa
// desligado. Agora cada impressora tem a sua fila (ordem de chegada dentro dela) e as filas andam
// ao mesmo tempo; o que acontece com uma não atrasa as outras — como o spooler do Windows/CUPS.
//
// DISJUNTOR: a impressora que não recebeu um job fica "fora do ar" por 30 s (dobra a cada nova
// falha, até 5 min). Enquanto isso: os jobs dela que estavam na fila voltam para a fila do banco
// sem contar tentativa, e a reserva não pega jobs dela. Vencido o prazo, UM job testa: saiu →
// fecha o disjuntor; não saiu → reabre mais longo. Sem isso, cada job de uma impressora sem
// papel gastaria as suas tentativas uma a uma e iria para 'erro' antes de alguém trocar o papel.
const DISJUNTOR_MIN_MS = 30_000;
const DISJUNTOR_MAX_MS = 5 * 60_000;
const filas = new Map(); // equipamento_id → { jobs: [], rodando: bool }
const disjuntor = new Map(); // equipamento_id → { ate: ms, falhas: n }

function foraDaReserva() {
  const agora = Date.now();
  const ids = [];
  for (const [id, f] of filas) if (f.rodando || f.jobs.length) ids.push(id);
  for (const [id, d] of disjuntor) if (d.ate > agora) ids.push(id);
  return ids;
}

function abrirDisjuntor(id) {
  const d = disjuntor.get(id) ?? { falhas: 0, ate: 0 };
  d.falhas++;
  const ms = Math.min(DISJUNTOR_MAX_MS, DISJUNTOR_MIN_MS * 2 ** (d.falhas - 1));
  d.ate = Date.now() + ms;
  disjuntor.set(id, d);
  console.error(`  impressora ${id.slice(0, 8)} fora do ar — pausa de ${ms / 1000}s (as outras seguem)`);
}

async function rodarFila(chave) {
  const f = filas.get(chave);
  if (!f || f.rodando) return;
  f.rodando = true;
  try {
    while (f.jobs.length) {
      const job = f.jobs.shift();
      let r;
      try {
        r = await imprimirJob(job);
      } catch (e) {
        // Rede de segurança: um job com problema inesperado não derruba a fila da impressora.
        console.error(`  job ${String(job.id).slice(0, 8)} — erro inesperado: ${e?.message ?? e}`);
        continue;
      }
      if (r === 'ok') disjuntor.delete(chave);
      if (r === 'falha' && chave !== '-') {
        abrirDisjuntor(chave);
        // Os que esperavam a vez nesta impressora voltam para o banco sem gastar tentativa.
        for (const resto of f.jobs.splice(0)) {
          await pool.query(SQL_DEVOLVER, [resto.id, WORKER_ID]).catch(() => {});
        }
      }
    }
  } finally {
    f.rodando = false;
    if (!f.jobs.length) filas.delete(chave);
    drenar(); // a impressora ficou livre: pega o próximo dela (e o que mais houver)
  }
}

let drenando = false;
let repetir = false;

// Drena a fila ate esvaziar (rajada). Reentrante: se chega notificacao durante
// a drenagem, marca para repetir ao terminar (nunca roda duas ao mesmo tempo).
async function drenar() {
  if (drenando) {
    repetir = true;
    return;
  }
  drenando = true;
  try {
    for (;;) {
      let fila;
      try {
        fila = await pendentes();
      } catch (e) {
        console.error(`[${new Date().toISOString()}] erro ao ler a fila: ${e.message}`);
        break;
      }
      if (!fila.length) break;
      // Distribui nas filas das impressoras e deixa cada uma andar sozinha. A reserva seguinte
      // já exclui as impressoras que receberam jobs agora (foraDaReserva).
      const tocadas = new Set();
      for (const job of fila) {
        const chave = job.equipamento_id || '-';
        const f = filas.get(chave) ?? { jobs: [], rodando: false };
        f.jobs.push(job);
        filas.set(chave, f);
        tocadas.add(chave);
      }
      for (const chave of tocadas) rodarFila(chave);
    }
  } finally {
    drenando = false;
    if (repetir) {
      repetir = false;
      drenar();
    }
  }
}

// LISTEN dedicado (client separado do pool) com reconexao automatica. UM cliente por vez:
// antes, uma falha na drenagem inicial (dentro do mesmo try) agendava outro ouvir() com este
// cliente ainda conectado — cada falha somava um LISTEN que nunca era fechado.
let ouvinte = null;
let reconectando = false;
function reconectar(motivo) {
  if (reconectando) return;
  reconectando = true;
  const velho = ouvinte;
  ouvinte = null;
  if (velho) velho.end().catch(() => {});
  console.error(`  LISTEN caiu: ${motivo} — reconectando em 3s`);
  setTimeout(() => {
    reconectando = false;
    ouvir();
  }, 3000);
}
async function ouvir() {
  const client = new pg.Client({ connectionString: EDGE_DB });
  client.on('notification', () => drenar());
  client.on('error', (e) => reconectar(e.message));
  client.on('end', () => {
    if (ouvinte === client) reconectar('conexão encerrada');
  });
  try {
    await client.connect();
    await client.query('LISTEN impressao_nova');
    ouvinte = client;
    console.log('  LISTEN impressao_nova ativo (impressao instantanea)');
  } catch (e) {
    client.end().catch(() => {});
    reconectar(`falha no LISTEN: ${e.message}`);
    return;
  }
  drenar(); // pega o que ja estava na fila ao subir (fora do try: não mexe no LISTEN)
}

console.log(`Worker de impressao — edge=${mask} poll=${POLL_MS}ms porta_padrao=${PORTA_PADRAO}` + (EDGE_UNIDADE ? ` loja=${EDGE_UNIDADE.slice(0, 8)}` : ''));
await ouvir();
setInterval(drenar, POLL_MS); // rede de seguranca
