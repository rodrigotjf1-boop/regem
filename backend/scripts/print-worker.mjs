// Worker de impressão térmica (Fase F3) — roda no SERVIDOR LOCAL (edge).
// Puxa jobs pendentes da API (auth por token 'servidor_local') e envia ESC/POS
// para a impressora de rede (host:porta) de cada job.
//
// Uso:
//   REGEM_API=http://localhost:3001/api/v1 \
//   REGEM_SYNC_TOKEN=<token do equipamento servidor_local> \
//   node scripts/print-worker.mjs
//
// Opcional: PRINT_POLL_MS (padrão 3000). Sem impressora real, use PRINT_DRYRUN=1
// para só logar o ticket (útil em teste).
import net from 'node:net';

const API = process.env.REGEM_API ?? 'http://localhost:3001/api/v1';
const TOKEN = process.env.REGEM_SYNC_TOKEN;
const POLL = Number(process.env.PRINT_POLL_MS ?? 3000);
const DRYRUN = process.env.PRINT_DRYRUN === '1';

if (!TOKEN) {
  console.error('Defina REGEM_SYNC_TOKEN (token do equipamento servidor_local).');
  process.exit(1);
}

const ESC = 0x1b;
const GS = 0x1d;

// Converte o ticket de texto em bytes ESC/POS (init + texto + corte).
function escpos(conteudo) {
  const init = Buffer.from([ESC, 0x40]); // ESC @  (reset)
  const body = Buffer.from(conteudo.replace(/\r?\n/g, '\n') + '\n\n\n', 'latin1');
  const cut = Buffer.from([GS, 0x56, 0x00]); // GS V 0 (corte total)
  return Buffer.concat([init, body, cut]);
}

function imprimir(host, porta, conteudo) {
  return new Promise((resolve, reject) => {
    if (DRYRUN) {
      console.log(`\n--- [DRYRUN] ${host}:${porta} ---\n${conteudo}\n--- fim ---`);
      return resolve();
    }
    const socket = net.createConnection({ host, port: porta || 9100 }, () => {
      socket.write(escpos(conteudo), () => socket.end());
    });
    socket.setTimeout(8000);
    socket.on('error', reject);
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('timeout na impressora'));
    });
    socket.on('close', () => resolve());
  });
}

async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-sync-token': TOKEN },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function tick() {
  let jobs = [];
  try {
    jobs = await api('/impressao/pendentes');
  } catch (e) {
    console.error('poll falhou:', e.message);
    return;
  }
  for (const job of jobs) {
    if (!job.host) {
      await api(`/impressao/${job.id}/erro`, {
        method: 'POST',
        body: { erro: 'impressora sem host configurado' },
      }).catch(() => {});
      continue;
    }
    try {
      await imprimir(job.host, job.porta, job.conteudo);
      await api(`/impressao/${job.id}/impresso`, { method: 'POST' });
      console.log(`impresso: ${job.impressora ?? job.host} · job ${job.id.slice(0, 8)}`);
    } catch (e) {
      await api(`/impressao/${job.id}/erro`, {
        method: 'POST',
        body: { erro: e.message },
      }).catch(() => {});
      console.error(`erro ao imprimir job ${job.id.slice(0, 8)}:`, e.message);
    }
  }
}

console.log(`print-worker: API=${API} poll=${POLL}ms dryrun=${DRYRUN}`);
setInterval(() => {
  tick().catch((e) => console.error(e));
}, POLL);
tick();
