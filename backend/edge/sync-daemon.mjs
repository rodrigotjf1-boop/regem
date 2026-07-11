// Daemon de sync do SERVIDOR LOCAL (edge). Roda ao lado do backend local:
//  - PULL: baixa o controle da nuvem e aplica no banco local (upsert por id, LWW natural
//          porque a nuvem manda o estado atual; soft-delete vem em deleted_at).
//  - PUSH: sobe o operacional (append-only) do banco local para a nuvem.
// Cursores ficam numa tabela local `sync_state`. Intervalo configurável.
//
// Config por env:
//   EDGE_DATABASE_URL   banco do servidor local (fonte da verdade da LAN)
//   CLOUD_API           base da API da nuvem, ex.: https://api.dmsregem.com/api/v1
//   SYNC_TOKEN          token do equipamento 'servidor_local' (header x-sync-token)
//   SYNC_INTERVAL_MS    intervalo entre ciclos (default 30000)
import pg from 'pg';

const EDGE_DB = req('EDGE_DATABASE_URL');
const CLOUD = req('CLOUD_API').replace(/\/$/, '');
const TOKEN = req('SYNC_TOKEN');
const INTERVAL = Number(process.env.SYNC_INTERVAL_MS || 30000);

// Operacional que sobe (espelha as tabelas 'sobe' do sync-config da nuvem).
const PUSH_TABLES = [
  { tabela: 'movimento_estoque', cursor: 'created_at' },
  { tabela: 'ponto_marcacao', cursor: 'created_at' },
  { tabela: 'lancamento_caixa', cursor: 'created_at' },
  { tabela: 'audit_log', cursor: 'created_at' },
];

const pool = new pg.Pool({ connectionString: EDGE_DB });
const colCache = new Map();

function req(k) {
  const v = process.env[k];
  if (!v) {
    console.error(`Falta a env ${k}`);
    process.exit(1);
  }
  return v;
}
const q = (id) => '"' + String(id).replace(/"/g, '') + '"';
const coerce = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

async function colunas(tabela) {
  if (colCache.has(tabela)) return colCache.get(tabela);
  const r = await pool.query(
    `select column_name from information_schema.columns where table_schema='public' and table_name=$1`,
    [tabela],
  );
  const set = new Set(r.rows.map((x) => x.column_name));
  colCache.set(tabela, set);
  return set;
}

async function ensureState() {
  await pool.query(
    `create table if not exists sync_state (chave text primary key, valor text)`,
  );
}
async function getState(k, d) {
  const r = await pool.query('select valor from sync_state where chave=$1', [k]);
  return r.rows[0]?.valor ?? d;
}
async function setState(k, v) {
  await pool.query(
    `insert into sync_state(chave,valor) values($1,$2)
     on conflict(chave) do update set valor=$2`,
    [k, v],
  );
}

async function upsertLocal(tabela, row) {
  const cols = await colunas(tabela);
  const keys = Object.keys(row).filter((k) => cols.has(k));
  if (!keys.includes('id')) return;
  const setCols = keys.filter((k) => k !== 'id');
  const ph = keys.map((_, i) => `$${i + 1}`);
  const setSql = setCols.length
    ? `do update set ${setCols.map((k) => `${q(k)}=excluded.${q(k)}`).join(',')}`
    : 'do nothing';
  await pool.query(
    `insert into ${q(tabela)} (${keys.map(q).join(',')}) values (${ph.join(',')})
     on conflict (id) ${setSql}`,
    keys.map((k) => coerce(row[k])),
  );
}

async function pull() {
  const desde = await getState('pull_cursor', '1970-01-01T00:00:00Z');
  const res = await fetch(`${CLOUD}/sync/pull?desde=${encodeURIComponent(desde)}`, {
    headers: { 'x-sync-token': TOKEN },
  });
  if (!res.ok) throw new Error(`pull HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  let aplicadas = 0;
  let pendentes = []; // linhas cujo pai (FK) ainda não chegou → retry
  for (const [tabela, rows] of Object.entries(data.tabelas)) {
    for (const row of rows) {
      try {
        await upsertLocal(tabela, row);
        aplicadas++;
      } catch (e) {
        if (e.code === '23503') pendentes.push([tabela, row]);
        else throw e;
      }
    }
  }
  // Reprocessa dependências fora de ordem (pais já aplicados neste ciclo).
  for (let passe = 0; passe < 3 && pendentes.length; passe++) {
    const resta = [];
    for (const [tabela, row] of pendentes) {
      try {
        await upsertLocal(tabela, row);
        aplicadas++;
      } catch (e) {
        if (e.code === '23503') resta.push([tabela, row]);
        else throw e;
      }
    }
    pendentes = resta;
  }
  if (pendentes.length) console.warn(`  ${pendentes.length} linha(s) sem pai (FK) após retries`);
  if (data.proximoCursor) await setState('pull_cursor', data.proximoCursor);
  return aplicadas;
}

async function push() {
  const lotes = [];
  const avanco = {};
  for (const t of PUSH_TABLES) {
    if (!(await colunas(t.tabela)).size) continue;
    const cur = await getState(`push_${t.tabela}`, '1970-01-01T00:00:00Z');
    const r = await pool.query(
      `select * from ${q(t.tabela)} where ${q(t.cursor)} > $1 order by ${q(t.cursor)} asc limit 500`,
      [cur],
    );
    if (r.rows.length) {
      lotes.push({ tabela: t.tabela, linhas: r.rows });
      avanco[t.tabela] = { cursor: t.cursor, rows: r.rows };
    }
  }
  if (!lotes.length) return 0;
  const res = await fetch(`${CLOUD}/sync/push`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sync-token': TOKEN },
    body: JSON.stringify({ lotes }),
  });
  if (!res.ok) throw new Error(`push HTTP ${res.status}: ${await res.text()}`);
  for (const [tabela, a] of Object.entries(avanco)) {
    const max = a.rows.reduce(
      (m, row) => (new Date(row[a.cursor]) > new Date(m) ? row[a.cursor] : m),
      await getState(`push_${tabela}`, '1970-01-01T00:00:00Z'),
    );
    await setState(`push_${tabela}`, new Date(max).toISOString());
  }
  return lotes.reduce((s, l) => s + l.linhas.length, 0);
}

const GRACE_MS = (Number(process.env.LICENSE_GRACE_DAYS) || 30) * 86400000;

// Licença: busca o lease na nuvem, guarda local com GRACE (offline continua até
// vencer o grace) e detecta rollback de relógio (não pode voltar no tempo).
async function licenca() {
  try {
    const res = await fetch(`${CLOUD}/edge/lease`, { headers: { 'x-sync-token': TOKEN } });
    if (res.ok) {
      const j = await res.json();
      if (j.ativo && j.lease) {
        // anti-rollback: guarda o maior "srv" já visto.
        try {
          const payload = JSON.parse(Buffer.from(j.lease.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
          const srvMax = Number(await getState('lic_srv_max', '0'));
          if (payload.srv && payload.srv >= srvMax) await setState('lic_srv_max', String(payload.srv));
          else if (Date.now() < srvMax) console.warn('  ⚠️ relógio local voltou no tempo (rollback)');
        } catch { /* ignore */ }
        await setState('lic_lease', j.lease);
        await setState('lic_ativa', '1');
        await setState('lic_grace_ate', String(Date.now() + GRACE_MS));
      } else {
        await setState('lic_ativa', '0'); // suspensa/expirada/revogada
      }
    }
  } catch {
    // Offline: mantém o status; se passou do grace, desativa.
    const graceAte = Number(await getState('lic_grace_ate', '0'));
    if (graceAte && Date.now() > graceAte) await setState('lic_ativa', '0');
  }
}

// Fase E-D: pergunta à nuvem se há versão nova. NÃO aplica sozinho (troca de
// binário/serviço é do instalador) — só registra e loga um aviso claro para o
// operador. Guarda em sync_state pra a UI/painel poder mostrar depois.
async function updateCheck() {
  try {
    const atual = process.env.APP_VERSION || '1';
    const res = await fetch(`${CLOUD}/edge/update-check?versao=${encodeURIComponent(atual)}`);
    if (!res.ok) return;
    const j = await res.json();
    if (j.atualizar) {
      await setState('update_disponivel', j.ultima || '');
      await setState('update_url', j.url || '');
      await setState('update_notas', j.notas || '');
      console.warn(`  ⬆️ atualização disponível: ${atual} → ${j.ultima}${j.url ? ` (${j.url})` : ''}. Rode a atualização do edge quando a loja estiver fechada.`);
    } else {
      await setState('update_disponivel', '');
    }
  } catch { /* best-effort: sem rede, ignora */ }
}

async function heartbeat(pullN, pushN, erro) {
  try {
    await fetch(`${CLOUD}/edge/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-token': TOKEN },
      body: JSON.stringify({
        versao: process.env.APP_VERSION || '1',
        estado: erro ? 'erro' : 'sync_ok',
        ultimoSync: new Date().toISOString(),
        clientes: Number(process.env.EDGE_CLIENTES || 0) || null,
        erro: erro || null,
      }),
    });
  } catch { /* heartbeat é best-effort */ }
}

async function ciclo() {
  let erro = null, p = 0, u = 0;
  try {
    p = await pull();
    u = await push();
    console.log(`[${new Date().toISOString()}] sync ok — pull ${p} linha(s), push ${u} linha(s)`);
  } catch (e) {
    erro = e.message;
    console.error(`[${new Date().toISOString()}] sync FALHOU: ${e.message}`);
  }
  await licenca();
  // update-check é barato mas não precisa a cada 30s: no máximo 1x/hora.
  const agora = Date.now();
  if (agora - ultimoUpdateCheck > 3600000) {
    ultimoUpdateCheck = agora;
    await updateCheck();
  }
  await heartbeat(p, u, erro);
}

let ultimoUpdateCheck = 0;

console.log(`Daemon de sync — edge=${EDGE_DB.replace(/:[^:@/]*@/, ':****@')} cloud=${CLOUD} intervalo=${INTERVAL}ms`);
await ensureState();
await ciclo();
setInterval(ciclo, INTERVAL);
