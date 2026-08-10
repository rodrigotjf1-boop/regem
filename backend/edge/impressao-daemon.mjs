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

const pool = new pg.Pool({ connectionString: EDGE_DB });
const mask = EDGE_DB.replace(/:[^:@/]*@/, ':****@');

// Envia bytes crus por TCP para host:porta (protocolo RAW/9100 das termicas).
function enviarTcp(host, porta, buffer) {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port: porta || PORTA_PADRAO });
    let feito = false;
    const fim = (err) => {
      if (feito) return;
      feito = true;
      sock.destroy();
      err ? reject(err) : resolve();
    };
    sock.setTimeout(8000);
    sock.on('connect', () => sock.write(buffer, () => sock.end()));
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

async function marcarImpresso(id) {
  await pool.query(
    `update impressao_job set status='impresso', impresso_em=now() where id=$1`,
    [id],
  );
}
async function marcarErro(id, msg) {
  await pool.query(
    `update impressao_job set status='erro', erro=$2, tentativas=tentativas+1 where id=$1`,
    [id, String(msg || 'falha').slice(0, 400)],
  );
}

// Imprime um job com retry/backoff. Devolve true se saiu, false se falhou de vez.
async function imprimirJob(job) {
  const local = job.conexao === 'local';
  // Valida o alvo conforme o tipo de conexão da impressora.
  if (local && !job.dispositivo) {
    await marcarErro(job.id, 'impressora local sem nome do Windows');
    console.error(`  job ${job.id.slice(0, 8)} — impressora "${job.impressora || '?'}" local sem nome`);
    return false;
  }
  if (!local && !job.host) {
    await marcarErro(job.id, 'impressora de rede sem IP configurado');
    console.error(`  job ${job.id.slice(0, 8)} — impressora "${job.impressora || '?'}" sem IP`);
    return false;
  }
  const vias = Math.max(1, Number(job.vias) || 1);
  const buffer = renderEscpos(job.conteudo, job.largura || 80, job.linguagem);
  const enviar = local
    ? () => enviarWindows(job.dispositivo, buffer)
    : () => enviarTcp(job.host, job.porta, buffer);
  const alvo = local ? `win:${job.dispositivo}` : `${job.impressora || job.host}:${job.porta || PORTA_PADRAO}`;
  let ultimoErro = null;
  for (let t = 1; t <= TENTATIVAS; t++) {
    try {
      for (let v = 0; v < vias; v++) await enviar();
      await marcarImpresso(job.id);
      console.log(`  ✓ job ${job.id.slice(0, 8)} -> ${alvo}` + (vias > 1 ? ` (${vias} vias)` : ''));
      return true;
    } catch (e) {
      ultimoErro = e.message;
      if (t < TENTATIVAS) await sleep(500 * t); // backoff 0.5s, 1s
    }
  }
  await marcarErro(job.id, ultimoErro);
  console.error(`  ✗ job ${job.id.slice(0, 8)} falhou apos ${TENTATIVAS} tentativas: ${ultimoErro}`);
  return false;
}

// Busca a fila (join com equipamento para host/porta/largura/vias).
async function pendentes() {
  const r = await pool.query(`
    select j.id, j.conteudo, j.tentativas,
           e.conexao, e.host, e.porta, e.dispositivo, e.largura, e.vias, e.nome as impressora,
           e.linguagem_etiqueta as linguagem
    from impressao_job j
    left join equipamento e on e.id = j.equipamento_id
    where j.status = 'pendente'
    order by j.criado_em asc
    limit 20
  `);
  return r.rows;
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
      for (const job of fila) await imprimirJob(job);
    }
  } finally {
    drenando = false;
    if (repetir) {
      repetir = false;
      drenar();
    }
  }
}

// LISTEN dedicado (client separado do pool) com reconexao automatica.
async function ouvir() {
  const client = new pg.Client({ connectionString: EDGE_DB });
  client.on('notification', () => drenar());
  client.on('error', (e) => {
    console.error(`  LISTEN caiu: ${e.message} — reconectando em 3s`);
    setTimeout(ouvir, 3000);
  });
  try {
    await client.connect();
    await client.query('LISTEN impressao_nova');
    console.log('  LISTEN impressao_nova ativo (impressao instantanea)');
    await drenar(); // pega o que ja estava na fila ao subir
  } catch (e) {
    console.error(`  falha no LISTEN: ${e.message} — retry em 3s`);
    setTimeout(ouvir, 3000);
  }
}

console.log(`Worker de impressao — edge=${mask} poll=${POLL_MS}ms porta_padrao=${PORTA_PADRAO}`);
await ouvir();
setInterval(drenar, POLL_MS); // rede de seguranca
