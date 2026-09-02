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
const AUTO_RETRY_CAP = 5; // rounds de re-tentativa automática (P2) antes de 'erro' terminal
const WORKER_ID = `edge-${randomUUID().slice(0, 8)}`; // identifica a reserva (claim) deste worker

const pool = new pg.Pool({ connectionString: EDGE_DB });
// Resiliencia (auditoria ago/2026): Postgres reiniciado (57P01, a cada install/update)
// emite 'error' na conexao OCIOSA do pool -> SEM handler o Node derruba o daemon. So
// logamos; o pg descarta a conexao morta e reabre na proxima query.
pool.on('error', (e) => console.error(`[impressao] pool: conexao ociosa caiu (${e?.code ?? e?.message}) - descartada, segue no ar`));
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
    `update impressao_job set status='impresso', impresso_em=now(), claim_por=null, claim_ate=null where id=$1`,
    [id],
  );
}
async function marcarErro(id, msg) {
  // Auto-retry (P2): re-enfileira como 'pendente' com backoff crescente (reusa claim_ate como
  // "não pegar antes de") até AUTO_RETRY_CAP; depois vira 'erro' terminal (reimpressão manual).
  await pool.query(
    `update impressao_job set
       tentativas = tentativas + 1,
       erro = $2,
       claim_por = null,
       status = case when tentativas + 1 < $3 then 'pendente' else 'erro' end,
       claim_ate = case when tentativas + 1 < $3 then now() + (interval '30 seconds' * (tentativas + 1)) else null end
     where id = $1`,
    [id, String(msg || 'falha').slice(0, 400), AUTO_RETRY_CAP],
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
  let enviadas = 0; // via-a-via: uma via que já saiu NÃO é reimpressa no retry
  for (let t = 1; t <= TENTATIVAS; t++) {
    try {
      while (enviadas < vias) {
        await enviar();
        enviadas++;
      }
      await marcarImpresso(job.id);
      console.log(`  ✓ job ${job.id.slice(0, 8)} -> ${alvo}` + (vias > 1 ? ` (${vias} vias)` : ''));
      return true;
    } catch (e) {
      ultimoErro = e.message;
      if (t < TENTATIVAS) await sleep(500 * t); // backoff 0.5s, 1s
    }
  }
  await marcarErro(job.id, ultimoErro);
  console.error(`  ✗ job ${job.id.slice(0, 8)} falhou apos ${TENTATIVAS} tentativas (${enviadas}/${vias} vias): ${ultimoErro}`);
  return false;
}

// Busca a fila (join com equipamento para host/porta/largura/vias).
// F2 (roteamento por loja): unidade DESTE edge. Setada → só imprime os jobs DELA + os
// "da rede" (unidade_id null). O banco local tem o tenant inteiro (sync tenant-wide), então
// o filtro é aqui. Vazio (1 loja / edge antigo) → tenant-wide, comportamento atual.
const EDGE_UNIDADE = (process.env.EDGE_UNIDADE_ID || '').trim() || null;
async function pendentes() {
  // Reserva atômica (claim/lease, mig 221): pega até 20 jobs marcando 'enviando' + lease de
  // 120s; `for update skip locked` impede outro worker pegar o mesmo (fim do duplo-print) e
  // re-pega os 'enviando' com lease VENCIDA (worker que morreu no meio). Vias por tipo (mig 168):
  // cupom do cliente vs produção (antes usava só `e.vias` flat — ignorava viasCliente/Producao).
  const filtro = EDGE_UNIDADE ? 'and (j.unidade_id = $2 or j.unidade_id is null)' : '';
  const params = EDGE_UNIDADE ? [WORKER_ID, EDGE_UNIDADE] : [WORKER_ID];
  const r = await pool.query(`
    with alvo as (
      select j.id from impressao_job j
      where ((j.status = 'pendente' and (j.claim_ate is null or j.claim_ate < now()))
             or (j.status = 'enviando' and j.claim_ate < now())) ${filtro}
      order by j.criado_em asc
      limit 20
      for update skip locked
    ),
    claimed as (
      update impressao_job
      set status='enviando', claim_por=$1, claim_ate=now() + interval '120 seconds'
      where id in (select id from alvo)
      returning id, conteudo, via, tentativas, equipamento_id
    )
    select c.id, c.conteudo, c.via, c.tentativas,
           e.conexao, e.host, e.porta, e.dispositivo, e.largura,
           e.nome as impressora, e.linguagem_etiqueta as linguagem,
           case
             when c.via = 'cliente' then coalesce(e.vias_cliente, e.vias)
             when c.via = 'producao' then coalesce(e.vias_producao, e.vias)
             else e.vias end as vias
    from claimed c
    left join equipamento e on e.id = c.equipamento_id
    order by c.criado_em asc
  `, params);
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
