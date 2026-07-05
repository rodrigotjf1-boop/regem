// Agente TEF (Fase I) — roda no SERVIDOR LOCAL (edge). Puxa as cobranças
// pendentes e as processa na maquininha/pinpad via o provedor (SiTef/PayGo/
// Stone). Reporta o resultado (aprovado/negado + NSU) de volta à API.
//
// Uso:
//   REGEM_API=http://localhost:3001/api/v1 \
//   REGEM_SYNC_TOKEN=<token do equipamento servidor_local> \
//   node scripts/tef-worker.mjs
//
// Sem pinpad real, use TEF_DRYRUN=1 para aprovar automaticamente (teste).
// O provedor real (chamada ao pinpad) é o "plug" — implementar em `cobrar()`.

const API = process.env.REGEM_API ?? 'http://localhost:3001/api/v1';
const TOKEN = process.env.REGEM_SYNC_TOKEN;
const POLL = Number(process.env.TEF_POLL_MS ?? 2000);
const DRYRUN = process.env.TEF_DRYRUN === '1';

if (!TOKEN) {
  console.error('Defina REGEM_SYNC_TOKEN (token do equipamento servidor_local).');
  process.exit(1);
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

// PLUG DO PROVEDOR: aqui entra a chamada ao pinpad (SiTef/PayGo/Stone SDK),
// aguardando o cliente inserir/aproximar o cartão. Devolve o resultado.
async function cobrar(pag) {
  if (DRYRUN) {
    return {
      status: 'aprovado',
      nsu: String(Date.now()).slice(-9),
      autorizacao: '123456',
      bandeira: 'VISA',
      mensagem: 'DRYRUN',
    };
  }
  throw new Error('Provedor TEF não configurado (plugue o SDK do pinpad).');
}

async function tick() {
  let pend = [];
  try {
    pend = await api('/tef/pendentes');
  } catch (e) {
    console.error('poll falhou:', e.message);
    return;
  }
  for (const pag of pend) {
    try {
      console.log(`processando ${pag.forma} ${pag.valor} (job ${pag.id.slice(0, 8)})…`);
      const r = await cobrar(pag);
      await api(`/tef/${pag.id}/resultado`, { method: 'POST', body: r });
      console.log(`  → ${r.status}${r.nsu ? ' NSU ' + r.nsu : ''}`);
    } catch (e) {
      await api(`/tef/${pag.id}/resultado`, {
        method: 'POST',
        body: { status: 'negado', mensagem: e.message },
      }).catch(() => {});
      console.error(`  → negado: ${e.message}`);
    }
  }
}

console.log(`tef-worker: API=${API} poll=${POLL}ms dryrun=${DRYRUN}`);
setInterval(() => tick().catch((e) => console.error(e)), POLL);
tick();
