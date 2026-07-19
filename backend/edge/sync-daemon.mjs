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
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';

const pExecFile = promisify(execFile);

// Rodando como servico do Windows nao ha shell que exporte as envs. A API usa
// @nestjs/config para ler o .env.local; este daemon carrega por conta propria.
const _envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(_envFile)) {
  for (const _l of readFileSync(_envFile, 'utf8').split(/\r?\n/)) {
    const _m = _l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (_m && !process.env[_m[1]]) process.env[_m[1]] = _m[2].trim();
  }
}

const EDGE_DB = req('EDGE_DATABASE_URL');
const CLOUD = req('CLOUD_API').replace(/\/$/, '');
const TOKEN = req('SYNC_TOKEN');
const INTERVAL = Number(process.env.SYNC_INTERVAL_MS || 30000);

// Operacional que sobe (espelha as tabelas 'sobe' do sync-config da nuvem).
// v2: transacionais primeiro (pais antes dos filhos p/ FK) por updated_at (LWW).
const PUSH_TABLES = [
  // Catálogo (bidirecional): sobe do edge p/ o cardápio ONLINE (nuvem) por LWW.
  // Ordem = pais antes dos filhos (FK na nuvem; daemon ainda tem retry de 23503).
  { tabela: 'categoria_produto', cursor: 'updated_at' },
  { tabela: 'produto', cursor: 'updated_at' },
  { tabela: 'cardapio_config', cursor: 'updated_at' },
  { tabela: 'opcao', cursor: 'updated_at' },
  { tabela: 'complemento', cursor: 'updated_at' },
  { tabela: 'complemento_item', cursor: 'updated_at' },
  { tabela: 'produto_complemento', cursor: 'updated_at' },
  { tabela: 'complemento_grupo', cursor: 'updated_at' },
  { tabela: 'complemento_opcao', cursor: 'updated_at' },
  // Cadastros bidirecionais (LWW): compra/recebimento no edge cria/edita fornecedor
  // e insumo localmente — precisam SUBIR (fornecedor antes de item_estoque por FK).
  { tabela: 'fornecedor', cursor: 'updated_at' },
  { tabela: 'item_estoque', cursor: 'updated_at' },
  { tabela: 'caixa_sessao', cursor: 'updated_at' },
  { tabela: 'comanda', cursor: 'updated_at' },
  { tabela: 'comanda_item', cursor: 'updated_at' },
  { tabela: 'producao_pedido', cursor: 'updated_at' },
  { tabela: 'producao_pedido_item', cursor: 'updated_at' },
  { tabela: 'pedido_externo', cursor: 'updated_at' },
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

// RESTAURAÇÃO sob demanda (botão do app): volta ao modo local após operar na
// nuvem. 2 tempos, aditivo (upsert por id, nunca apaga o que é só local):
//   1) EMPURRA o operacional local pendente pra nuvem (não perde venda de antes
//      da queda); 2) PUXA as tabelas transacionais da nuvem e aplica localmente.
async function restaurar() {
  console.log('Restauração solicitada — subindo pendências e puxando a nuvem...');
  await setState('restaurar_solicitado', '0'); // consome o pedido (não repete se travar)
  await setState('restaurando', '1');
  try {
    // 1) empurra o pendente local (as tabelas que sobem)
    try { await push(); } catch (e) { console.warn(`  push no restore: ${e.message}`); }
    // 2) puxa as transacionais da nuvem por delta e faz upsert local
    let cursor = await getState('restore_cursor', '1970-01-01T00:00:00Z');
    let total = 0;
    for (let pagina = 0; pagina < 5000; pagina++) {
      const res = await fetch(`${CLOUD}/sync/restore?desde=${encodeURIComponent(cursor)}`, {
        headers: { 'x-sync-token': TOKEN },
      });
      if (!res.ok) throw new Error(`restore HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const linhas = Object.values(data.tabelas).reduce((s, r) => s + r.length, 0);
      let pendentes = [];
      for (const [tabela, rows] of Object.entries(data.tabelas)) {
        for (const row of rows) {
          try { await upsertLocal(tabela, row); total++; }
          catch (e) { if (e.code === '23503') pendentes.push([tabela, row]); else throw e; }
        }
      }
      for (let passe = 0; passe < 3 && pendentes.length; passe++) {
        const resta = [];
        for (const [tabela, row] of pendentes) {
          try { await upsertLocal(tabela, row); total++; }
          catch (e) { if (e.code === '23503') resta.push([tabela, row]); else throw e; }
        }
        pendentes = resta;
      }
      if (!data.proximoCursor || data.proximoCursor === cursor || linhas === 0) break;
      cursor = data.proximoCursor;
      await setState('restore_cursor', cursor);
    }
    await setState('restaurado_em', new Date().toISOString());
    console.log(`Restauração concluída — ${total} linha(s) aplicadas.`);
  } finally {
    await setState('restaurando', '0');
  }
}

// Telemetria (Frente A): reporta erro do daemon à nuvem, com dedup em memória
// (5 min) e best-effort. Assim a distribuição vê erros de sync/DB do edge (ex.:
// coluna faltando) para reparar + publicar update.
const _telemEnviados = new Map();
async function reportarTelemetria(origem, tipo, mensagem) {
  try {
    const chave = origem + '|' + String(mensagem).replace(/\d+/g, '#').slice(0, 120);
    const agora = Date.now();
    if (agora - (_telemEnviados.get(chave) ?? 0) < 5 * 60 * 1000) return;
    _telemEnviados.set(chave, agora);
    await fetch(`${CLOUD}/edge/telemetria`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-token': TOKEN },
      body: JSON.stringify({ origem, tipo, nivel: 'error', mensagem: String(mensagem).slice(0, 2000), versao: process.env.APP_VERSION ?? null }),
    });
  } catch { /* best-effort */ }
}

// Comandos remotos (Fase 4): a distribuição enfileira (ex.: rollback); o edge busca
// e executa localmente. Best-effort; confirma o resultado na nuvem.
async function verificarComandos() {
  try {
    const res = await fetch(`${CLOUD}/edge/comandos`, { headers: { 'x-sync-token': TOKEN } });
    if (!res.ok) return;
    const cmds = await res.json();
    for (const c of cmds) {
      let ok = true, resultado = '';
      try {
        if (c.comando === 'rollback') {
          await pExecFile('schtasks', ['/run', '/tn', 'RegemEdgeRollback']);
          resultado = 'rollback disparado';
        } else {
          resultado = 'ignorado';
        }
      } catch (e) { ok = false; resultado = String(e.message).slice(0, 200); }
      await fetch(`${CLOUD}/edge/comandos/${c.id}/ack`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-token': TOKEN },
        body: JSON.stringify({ ok, resultado }),
      }).catch(() => {});
      console.log(`comando ${c.comando} -> ${ok ? 'ok' : 'erro'}: ${resultado}`);
    }
  } catch { /* sem rede — tenta no próximo ciclo */ }
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
    await reportarTelemetria('sync', 'sync_erro', e.message);
  }
  // Restauração sob demanda (botão do app grava a flag em sync_state).
  if ((await getState('restaurar_solicitado', '0')) === '1') {
    try { await restaurar(); } catch (e) { console.error(`Restauração FALHOU: ${e.message}`); }
  }
  await licenca();
  await verificarComandos();
  // Verificação de update SÓ nas janelas de abertura da loja (não aplica — só
  // notifica; o gestor instala pelo botão do app).
  await updateCheckSeJanela();
  await heartbeat(p, u, erro);
}

// Hora/dia locais no fuso do Brasil (as janelas seguem o relógio da loja).
function spParts() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
  return {
    data: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    dia: d.getDay(), // 0=domingo..6=sábado (igual ao cadastro de horários)
    minutos: d.getHours() * 60 + d.getMinutes(),
  };
}

// Minutos desde a meia-noite da ABERTURA de hoje (cardapio_config.horarios).
// Sem horário cadastrado para o dia → padrão 04:00 (240).
async function aberturaHojeMin(diaSemana) {
  try {
    const r = await pool.query('select horarios from cardapio_config limit 1');
    const arr = Array.isArray(r.rows[0]?.horarios) ? r.rows[0].horarios : [];
    const h = arr.find((x) => Number(x.dia) === diaSemana && x.ativo && x.abre);
    if (h && /^\d{1,2}:\d{2}$/.test(h.abre)) {
      const [hh, mm] = h.abre.split(':').map(Number);
      return hh * 60 + mm;
    }
  } catch {
    /* sem tabela/linha → cai no padrão */
  }
  return 240; // 04:00
}

// Verifica no máx. 2x/dia: uma nos 10 primeiros minutos após abrir e outra ~30min
// depois. Marca a janela já verificada no dia (sync_state) para não repetir.
async function updateCheckSeJanela() {
  try {
    const { data, dia, minutos } = spParts();
    const ab = await aberturaHojeMin(dia);
    const naJanelaA = minutos >= ab && minutos <= ab + 10;
    const naJanelaB = minutos >= ab + 29 && minutos <= ab + 31;
    if (naJanelaA && (await getState('upd_janela_a', '')) !== data) {
      await setState('upd_janela_a', data);
      await updateCheck();
    } else if (naJanelaB && (await getState('upd_janela_b', '')) !== data) {
      await setState('upd_janela_b', data);
      await updateCheck();
    }
  } catch (e) {
    console.warn(`  updateCheckSeJanela: ${e.message}`);
  }
}

console.log(`Daemon de sync — edge=${EDGE_DB.replace(/:[^:@/]*@/, ':****@')} cloud=${CLOUD} intervalo=${INTERVAL}ms`);
await ensureState();
await ciclo();
setInterval(ciclo, INTERVAL);
