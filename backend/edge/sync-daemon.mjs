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
//   SYNC_INTERVAL_MS    intervalo entre ciclos (default 60000 = 1 min)
import pg from 'pg';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { createHash, createHmac } from 'node:crypto';
import dns from 'node:dns';
// Preferir IPv4 nas resoluções DNS. Num SERVIÇO do Windows o IPv6 costuma NÃO rotear
// (o processo do USUÁRIO conecta por IPv6 e dá 200; o do serviço falha) → o daemon
// batia "fetch failed" a cada ciclo enquanto o fetch manual funcionava. IPv4 p/
// Cloudflare é universal; Happy Eyeballs ainda tenta IPv6 como fallback. Junto com o
// retry do fetchT (socket morto reusado do pool), elimina o "fetch failed" em série.
dns.setDefaultResultOrder('ipv4first');

const pExecFile = promisify(execFile);

// Rodando como servico do Windows nao ha shell que exporte as envs. A API usa
// @nestjs/config + secure-env; este daemon faz o equivalente E DECIFRA os enc:
// DPAPI — senao a EDGE_DATABASE_URL fica cifrada e o pg conecta como a conta da
// maquina (28P01 "password authentication failed for user <MAQUINA>$").
import { carregarEnvLocal } from './decifrar-env.mjs';
carregarEnvLocal(import.meta.url);

const EDGE_DB = req('EDGE_DATABASE_URL');
const CLOUD = req('CLOUD_API').replace(/\/$/, '');
const TOKEN = req('SYNC_TOKEN');
const INTERVAL = Number(process.env.SYNC_INTERVAL_MS || 60000);

// fetch COM TIMEOUT (AbortSignal.timeout). Sem isto, uma nuvem lenta ou em 502 deixa
// o fetch PENDURADO indefinidamente; como o ciclo é serial (trava cicloRodando), isso
// CONGELA o daemon inteiro — todos os ticks seguintes viram "pulando este tick" e o
// sync para por completo (incidente 25/08: congelado desde 22/08). Com timeout, o
// fetch lança, o ciclo termina/libera e o próximo tick tenta de novo. 45s cobre pull/
// push/restore grandes; ajustável por SYNC_FETCH_TIMEOUT_MS.
const FETCH_TIMEOUT_MS = Number(process.env.SYNC_FETCH_TIMEOUT_MS || 45000);
// Restore puxa páginas GRANDES (1000 linhas/tabela) do banco na nuvem (Oregon, latência)
// → estourava os 45s, o cursor não avançava e o restore travava na mesma página. Timeout
// próprio, folgado. Ajustável por SYNC_RESTORE_TIMEOUT_MS.
const RESTORE_TIMEOUT_MS = Number(process.env.SYNC_RESTORE_TIMEOUT_MS || 120000);
const FETCH_TENTATIVAS = Number(process.env.SYNC_FETCH_RETRIES || 3);

// Extrai a CAUSA real de um erro de fetch. O undici aninha o motivo em e.cause[.cause]
// (ex.: TypeError "fetch failed" → cause AggregateError → cause Error ECONNRESET). Sem
// isto o daemon logava só "fetch failed" e a gente ficava HORAS caçando no escuro.
function causaErro(e) {
  const partes = [];
  let cur = e;
  for (let i = 0; i < 5 && cur; i++) {
    const cod = cur.code || cur.errno || (cur.name && cur.name !== 'Error' ? cur.name : '');
    const msg = cur.message ? String(cur.message).slice(0, 140) : '';
    const t = [cod, msg].filter(Boolean).join(' ');
    if (t && !partes.includes(t)) partes.push(t);
    cur = cur.cause;
  }
  return partes.join(' <- ') || String(e);
}

// Erro de rede TRANSITÓRIO → vale re-tentar. O daemon é um processo LONGO: o pool do
// undici acumula sockets keep-alive que a nuvem/Cloudflare já fechou por ociosidade; a
// 1ª tentativa pega o socket morto (ECONNRESET / "fetch failed"), a 2ª abre um novo.
// Sem retry, o ciclo inteiro falhava e NADA sincronizava (o restore concluía só quando
// o pool estava quente). Também cobre IPv6 instável e resets pontuais do CDN.
function ehTransitorio(e) {
  return /fetch failed|terminated|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|EPIPE|UND_ERR|socket hang up|other side closed|aborted due to timeout|operation was aborted|TimeoutError/i.test(causaErro(e));
}

// Gateway transitório do Cloudflare/origem (502/503/504): comum quando a origem está
// sob carga ou o edge reconecta com backlog. Re-tentável — MAS só para requisições
// IDEMPOTENTES (GET: pull/restore). O push é POST: re-enviar em 5xx arriscaria
// DUPLO-APPLY, então NÃO re-tenta aqui — o ciclo re-tenta no próximo tick e a nuvem
// deduplica por seq. Na última tentativa devolve a resposta 5xx (o chamador loga o corpo).
const GATEWAY_5XX = new Set([502, 503, 504]);
async function fetchT(url, opts = {}, ms = FETCH_TIMEOUT_MS) {
  const metodo = (opts.method || 'GET').toUpperCase();
  const idempotente = metodo === 'GET' || metodo === 'HEAD';
  let ultimo;
  for (let tent = 1; tent <= FETCH_TENTATIVAS; tent++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(ms) });
      if (idempotente && GATEWAY_5XX.has(res.status) && tent < FETCH_TENTATIVAS) {
        ultimo = new Error(`HTTP ${res.status} (gateway)`);
        await new Promise((r) => setTimeout(r, 600 * tent));
        continue;
      }
      return res;
    } catch (e) {
      ultimo = e;
      if (!ehTransitorio(e) || tent === FETCH_TENTATIVAS) break;
      await new Promise((r) => setTimeout(r, 600 * tent)); // backoff curto p/ pegar socket novo
    }
  }
  // Propaga a mensagem JÁ com a causa real (a telemetria/log param de esconder o motivo).
  const err = new Error(`${ultimo?.message || 'fetch falhou'} | causa: ${causaErro(ultimo)}`);
  err.cause = ultimo;
  throw err;
}

// Assinatura do push (espelha backend/src/modules/sync/sync-sig.ts — MANTER IGUAL).
// A chave HMAC é derivada do token do dispositivo. Qualquer mudança aqui tem que ser
// refletida no TS, senão a nuvem rejeita a assinatura.
function stableSync(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableSync).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableSync(v[k])).join(',') + '}';
}
function chaveSync(token) {
  return createHash('sha256').update('regem-sync-v1|' + token).digest('hex');
}
function assinarSync(token, seq, ts, lotes) {
  return createHmac('sha256', chaveSync(token)).update(`${seq}.${ts}.${stableSync(lotes)}`).digest('hex');
}

// Fingerprint FORTE (P1): hash do MachineGuid do Windows (estável por instalação,
// bem mais forte que o nome do PC). MESMO cálculo do instalador (instalar-tudo.ps1).
// Fallback = hostname (esquema legado); a nuvem migra transparente (x-sync-fp-legacy).
import { execSync } from 'child_process';
import { hostname } from 'os';
function fingerprintForte() {
  try {
    const out = execSync('reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid', { encoding: 'utf8', windowsHide: true });
    const mg = (out.match(/MachineGuid\s+REG_SZ\s+([\w-]+)/i) || [])[1];
    if (mg) return createHash('sha256').update(mg.toUpperCase()).digest('hex');
  } catch { /* fallback abaixo */ }
  return hostname();
}

// Operacional que sobe (espelha as tabelas 'sobe' do sync-config da nuvem).
// v2: transacionais primeiro (pais antes dos filhos p/ FK) por updated_at (LWW).
const PUSH_TABLES = [
  // Catálogo (bidirecional): sobe do edge p/ o cardápio ONLINE (nuvem) por LWW.
  // Ordem = pais antes dos filhos (FK na nuvem; daemon ainda tem retry de 23503).
  { tabela: 'categoria_produto', cursor: 'updated_at' },
  { tabela: 'produto', cursor: 'updated_at' },
  { tabela: 'cardapio_config', cursor: 'updated_at' },
  // Configs espelhadas (P1, mig 181): impressoras/terminais e cupom/perfis sobem
  // (backup + volta num banco novo). equipamento FILTRADO: nunca 'servidor_local'.
  { tabela: 'equipamento', cursor: 'updated_at', filtro: "tipo in ('impressora','pdv','salao')" },
  { tabela: 'delivery_config', cursor: 'updated_at' },
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
  // Cliente do cardápio/CRM (bidirecional): cliente identificado no balcão sobe.
  // ANTES de pedido_externo (FK na nuvem: pedido_externo.cliente_id → cliente.id).
  // Cursor = atualizado_em (a tabela não tem updated_at).
  { tabela: 'cliente', cursor: 'atualizado_em' },
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

// TIMEOUTS: sem isto, uma conexão/consulta ao Postgres local congestionado ou com
// lock preso PENDURA o daemon PARA SEMPRE (ele empaca na 1ª query — ensureState — e
// nunca chega a "sync ok"; o serviço fica reiniciando). Com timeout, a query lança,
// a blindagem cataloga e o próximo tick tenta de novo — nunca mais pendura.
const pool = new pg.Pool({
  connectionString: EDGE_DB,
  connectionTimeoutMillis: 15000, // desiste de CONECTAR após 15s (banco não pronto)
  query_timeout: 30000,           // desiste de uma QUERY após 30s (lock preso)
  statement_timeout: 30000,       // idem, no lado do servidor
  idleTimeoutMillis: 30000,
});
// Resiliencia (auditoria ago/2026): o Postgres reiniciado (57P01, a cada install/
// update) emite 'error' na conexao OCIOSA do pool -> SEM handler o Node derruba o
// daemon. So logamos; o pg descarta a conexao morta e reabre na proxima query.
pool.on('error', (e) => console.error(`[sync] pool: conexao ociosa caiu (${e?.code ?? e?.message}) - descartada, segue no ar`));
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

// Estados TERMINAIS que o pull NUNCA deve reverter por uma linha mais velha da
// nuvem (exceção do LWW — prioridade LOCAL): uma comanda fechada/cancelada no
// edge não volta pra 'aberta' por um delta atrasado/materialização tardia da nuvem.
const ESTADOS_TERMINAIS = { comanda: ['fechada', 'cancelada'] };

async function upsertLocal(tabela, row) {
  const cols = await colunas(tabela);
  const keys = Object.keys(row).filter((k) => cols.has(k));
  if (!keys.includes('id')) return;
  const setCols = keys.filter((k) => k !== 'id');
  const ph = keys.map((_, i) => `$${i + 1}`);
  const vals = keys.map((k) => coerce(row[k]));
  // Append puro (sem colunas mutáveis) → insere ou ignora.
  if (!setCols.length) {
    await pool.query(
      `insert into ${q(tabela)} (${keys.map(q).join(',')}) values (${ph.join(',')})
       on conflict (id) do nothing`,
      vals,
    );
    return;
  }
  const setSql = `do update set ${setCols.map((k) => `${q(k)}=excluded.${q(k)}`).join(',')}`;
  // LWW no PULL: só sobrescreve o local se a linha da nuvem for ESTRITAMENTE mais
  // nova (updated_at). Antes o update era incondicional → uma linha velha da nuvem
  // apagava um estado mais recente do edge (causa do dashboard/espelho inconsistente).
  const cond = [];
  if (cols.has('updated_at')) {
    cond.push(`${q(tabela)}.updated_at < excluded.updated_at`);
  }
  // Exceção: não reabrir comanda em estado terminal local por linha da nuvem não-terminal.
  const terminais = ESTADOS_TERMINAIS[tabela];
  if (terminais && cols.has('status')) {
    const lst = terminais.map((s) => `'${s}'`).join(',');
    cond.push(`not (${q(tabela)}.status in (${lst}) and excluded.status not in (${lst}))`);
  }
  const whereSql = cond.length ? ` where ${cond.join(' and ')}` : '';
  await pool.query(
    `insert into ${q(tabela)} (${keys.map(q).join(',')}) values (${ph.join(',')})
     on conflict (id) ${setSql}${whereSql}`,
    vals,
  );
}

async function pull() {
  const desde = await getState('pull_cursor', '1970-01-01T00:00:00Z');
  // Keyset por tabela: mapa tabela→"<ts>|<id>" no sync_state. Enviamos SEMPRE o param
  // `cursores` (mesmo {} no 1º pull) p/ optar pelo caminho keyset da nuvem — assim cada
  // tabela avança pela sua própria posição e nenhuma "pula". `desde` (cursor legado)
  // segue como PISO p/ tabelas ainda sem entrada no mapa (migração sem re-pull do zero).
  let cursores = {};
  try {
    cursores = JSON.parse(await getState('pull_cursores', '{}')) || {};
  } catch {
    cursores = {};
  }
  const qs =
    `desde=${encodeURIComponent(desde)}` +
    `&cursores=${encodeURIComponent(JSON.stringify(cursores))}`;
  const res = await fetchT(`${CLOUD}/sync/pull?${qs}`, {
    headers: { 'x-sync-token': TOKEN },
  });
  if (!res.ok) throw new Error(`pull HTTP ${res.status}: ${await res.text()}`);
  const data = await res.json();
  let aplicadas = 0;
  let pendentes = []; // linhas cujo pai (FK) ainda não chegou → retry
  const falhas = [];  // linhas com erro DURO (coluna/valor) → pular, NÃO travar o pull
  for (const [tabela, rows] of Object.entries(data.tabelas)) {
    for (const row of rows) {
      try {
        await upsertLocal(tabela, row);
        aplicadas++;
      } catch (e) {
        if (e.code === '23503') pendentes.push([tabela, row]);
        else falhas.push([tabela, row, e]);
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
        else falhas.push([tabela, row, e]);
      }
    }
    pendentes = resta;
  }
  // ÓRFÃOS de pedido_externo: se o cliente_id nunca desceu (cliente ausente na nuvem
  // ou fora de ordem no pull paginado), o pedido ficava ETERNAMENTE sem entrar e
  // inflava o log do Postgres com erros de FK a cada ciclo. Inserimos o pedido com
  // cliente_id=NULL (o cliente é OPCIONAL — nome/telefone já vêm no próprio pedido).
  // Assim o pedido ENTRA no edge e o pull para de chocar nele.
  if (pendentes.length) {
    const resta2 = [];
    for (const [tabela, row] of pendentes) {
      if (tabela === 'pedido_externo' && row.cliente_id) {
        try { await upsertLocal(tabela, { ...row, cliente_id: null }); aplicadas++; continue; }
        catch { /* cai no resta2 abaixo */ }
      }
      resta2.push([tabela, row]);
    }
    pendentes = resta2;
  }
  if (pendentes.length) console.warn(`  ${pendentes.length} linha(s) sem pai (FK) após retries`);
  // RESILIÊNCIA: um registro "veneno" (coluna/tipo/valor que o edge não aceita — ex.:
  // coluna @cloud-only ainda não migrada) NÃO pode abortar o pull inteiro. Antes o
  // `throw e` interrompia o laço, o cursor não avançava e NADA descia (nem catálogo,
  // nem pedidos) — o pipe de sync ficava permanentemente travado na 1ª linha ruim.
  // Agora pulamos a linha, seguimos aplicando o resto, avançamos o cursor e mandamos
  // telemetria com a causa (a distribuição vê e cria a migration que falta).
  if (falhas.length) {
    const amostra = falhas.slice(0, 5).map(([t, , e]) => `${t}: ${e.code || ''} ${e.message}`).join(' | ');
    console.error(`  ⚠ ${falhas.length} linha(s) IGNORADA(s) no pull (erro duro): ${amostra}`);
    try { await reportarTelemetria('sync', 'pull_linha_ignorada', `${falhas.length} linha(s): ${amostra}`); } catch { /* best-effort */ }
  }
  // Keyset: mescla as posições por tabela devolvidas pela nuvem (nuvem nova). Preserva
  // as entradas que já tínhamos (uma tabela sem novidade não vem no retorno).
  if (data.cursores && typeof data.cursores === 'object') {
    await setState('pull_cursores', JSON.stringify({ ...cursores, ...data.cursores }));
  }
  // Mantém o cursor legado (piso p/ tabelas novas + compat caso o daemon seja rebaixado).
  if (data.proximoCursor) await setState('pull_cursor', data.proximoCursor);
  return aplicadas;
}

// Envia UM request de push (assina + POST). Isolado p/ o push mandar em páginas
// menores (evita 413 "request entity too large" quando há muita linha acumulada).
async function enviarLote(lote) {
  // Normaliza via JSON round-trip ANTES de assinar E enviar: assim a nuvem (que
  // recebe o JSON já parseado) assina exatamente a mesma representação (Date→ISO etc.).
  const lotesN = JSON.parse(JSON.stringify([lote]));
  const seq = (Number(await getState('push_seq', '0')) || 0) + 1;
  const ts = new Date().toISOString();
  const sig = assinarSync(TOKEN, seq, ts, lotesN);
  const res = await fetchT(`${CLOUD}/sync/push`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-sync-token': TOKEN,
      'x-sync-seq': String(seq),
      'x-sync-ts': ts,
      'x-sync-sig': sig,
    },
    body: JSON.stringify({ lotes: lotesN }),
  });
  if (!res.ok) throw new Error(`push HTTP ${res.status}: ${await res.text()}`);
  await setState('push_seq', String(seq)); // só avança o seq após sucesso
}

async function push() {
  // Páginas pequenas: cada tabela sobe em blocos de PUSH_MAX linhas, UM request por
  // bloco. Menos chance de 413 e progresso persistido (o cursor só avança após o
  // request do bloco dar certo — se cair no meio, retoma de onde parou).
  const PUSH_MAX = Number(process.env.SYNC_PUSH_MAX_LINHAS || 200);
  let total = 0;
  for (const t of PUSH_TABLES) {
    if (!(await colunas(t.tabela)).size) continue;
    let cur = await getState(`push_${t.tabela}`, '1970-01-01T00:00:00Z');
    for (let pagina = 0; pagina < 10000; pagina++) {
      const filtro = t.filtro ? ` and (${t.filtro})` : ''; // constante do PUSH_TABLES, não é entrada de usuário
      const r = await pool.query(
        `select * from ${q(t.tabela)} where ${q(t.cursor)} > $1${filtro} order by ${q(t.cursor)} asc limit $2`,
        [cur, PUSH_MAX],
      );
      if (!r.rows.length) break;
      await enviarLote({ tabela: t.tabela, linhas: r.rows });
      const max = r.rows.reduce(
        (m, row) => (new Date(row[t.cursor]) > new Date(m) ? row[t.cursor] : m),
        cur,
      );
      cur = new Date(max).toISOString();
      await setState(`push_${t.tabela}`, cur);
      total += r.rows.length;
      if (r.rows.length < PUSH_MAX) break; // última página desta tabela
    }
  }
  return total;
}

const GRACE_MS = (Number(process.env.LICENSE_GRACE_DAYS) || 30) * 86400000;

// Licença: busca o lease na nuvem, guarda local com GRACE (offline continua até
// vencer o grace) e detecta rollback de relógio (não pode voltar no tempo).
async function licenca() {
  try {
    // x-sync-fp = fingerprint FORTE (hash do MachineGuid); x-sync-fp-legacy = nome do PC.
    // A nuvem nega renovar se divergir do preso na ativação (anti-clone) e migra do
    // legado pro forte de forma transparente.
    const res = await fetchT(`${CLOUD}/edge/lease`, {
      headers: { 'x-sync-token': TOKEN, 'x-sync-fp': fingerprintForte(), 'x-sync-fp-legacy': hostname() },
    });
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
    const res = await fetchT(`${CLOUD}/edge/update-check?versao=${encodeURIComponent(atual)}`);
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

// Fingerprint é estável por instalação → cacheia (evita reg query a cada heartbeat).
let _fpCache = null;
function fpEdge() {
  if (_fpCache === null) { try { _fpCache = fingerprintForte(); } catch { _fpCache = ''; } }
  return _fpCache || null;
}

// Status dos 5 serviços Windows + disco livre, numa SÓ chamada powershell COM TIMEOUT.
// O ciclo é serial: um powershell pendurado congelaria o sync (mesma disciplina do
// fetchT/pool). Best-effort: falha → null (a saúde some, o heartbeat continua).
async function statusServicosEDisco() {
  try {
    const { stdout } = await pExecFile('powershell', [
      '-NoProfile', '-NonInteractive', '-Command',
      "$s=Get-Service RegemEdgeApi,RegemEdgeWeb,RegemEdgeSync,RegemEdgeImpressao,RegemEdgePg -EA SilentlyContinue|ForEach-Object{$_.Name+'='+$_.Status};$d=[int]((Get-PSDrive C -EA SilentlyContinue).Free/1MB);@{servicos=@($s);discoLivreMb=$d}|ConvertTo-Json -Compress",
    ], { timeout: 8000, windowsHide: true, encoding: 'utf8', maxBuffer: 1 << 20 });
    const o = JSON.parse(stdout);
    const servicos = {};
    for (const l of [].concat(o.servicos || [])) {
      const [nome, est] = String(l).split('=');
      if (nome) servicos[nome.replace(/^RegemEdge/i, '').toLowerCase()] = (est || '').trim();
    }
    for (const s of ['api', 'web', 'sync', 'impressao', 'pg']) if (!(s in servicos)) servicos[s] = 'ausente';
    return { servicos, discoLivreMb: Number.isFinite(o.discoLivreMb) ? o.discoLivreMb : null };
  } catch { return { servicos: null, discoLivreMb: null }; }
}

// Saúde rica — só no heartbeat de FIM de ciclo. Cada coleta é best-effort; nada pode
// derrubar o heartbeat (já best-effort).
async function coletarSaude() {
  const sd = await statusServicosEDisco();
  const saude = { servicos: sd.servicos };
  try { saude.uptimeS = Math.round(process.uptime()); } catch { /* */ }
  try {
    const os = await import('node:os');
    saude.ramLivreMb = Math.round(os.freemem() / 1048576);
    saude.ramTotalMb = Math.round(os.totalmem() / 1048576);
  } catch { /* */ }
  try {
    saude.restaurando = (await getState('restaurando', '0')) === '1';
    saude.restoreProgresso = Number(await getState('restore_progresso', '0')) || 0;
  } catch { /* */ }
  try {
    const r = await pool.query("select count(*)::int n from equipamento where tipo = 'impressora'");
    saude.impressoraConfigurada = (r.rows?.[0]?.n ?? 0) > 0;
  } catch { /* */ }
  return { saude, discoLivreMb: sd.discoLivreMb };
}

async function heartbeat(pullN, pushN, erro, comSaude) {
  try {
    const corpo = {
      versao: process.env.APP_VERSION || '1',
      estado: erro ? 'erro' : 'sync_ok',
      ultimoSync: new Date().toISOString(),
      clientes: Number(process.env.EDGE_CLIENTES || 0) || null,
      erro: erro || null,
      unidadeId: process.env.EDGE_UNIDADE_ID || null, // saúde/roteamento POR LOJA (F1)
    };
    if (comSaude) {
      // Só no fim do ciclo (60s): fingerprint + status dos serviços + disco/ram/restore.
      corpo.fingerprint = fpEdge();
      const { saude, discoLivreMb } = await coletarSaude();
      corpo.saude = saude;
      if (discoLivreMb != null) corpo.discoLivreMb = discoLivreMb;
    }
    await fetchT(`${CLOUD}/edge/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-token': TOKEN },
      body: JSON.stringify(corpo),
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
    // DOWNLOAD PRIMEIRO — é o que a loja precisa. O push (upload) foi pro FIM (best-effort):
    // rodando aqui na frente, com a nuvem em 502 + fila de push grande, ele SEGURAVA o
    // download e o restore ficava preso (potitjf 31/08 — "solicitada" sem nunca puxar).
    // E SEMPRE COMPLETO (desde 1970): o botão Restaurar é catch-up total; não confia num
    // restore_cursor adiantado que faz concluir com 0 linha (bug real do potitjf: dado na
    // nuvem, cursor à frente → restore "conclui" sem baixar nada).
    let cursor = '1970-01-01T00:00:00Z';
    let total = 0;
    console.log(`  restore: baixando da nuvem desde ${cursor} (completo)…`);
    // FK sem pai: ACUMULA entre páginas. O restore pagina por tabela (1000/tabela) com
    // cursor por tabela, então uma FILHA (comanda_item, producao_pedido_item) pode chegar
    // numa página ANTES do PAI (comanda, producao_pedido), que vem numa página posterior.
    // Antes descartávamos por página → a filha sumia (vendas/comandas de hoje não desciam).
    // Agora guardamos e re-tentamos no FIM, com todos os pais já presentes.
    const orfaos = [];
    for (let pagina = 0; pagina < 5000; pagina++) {
      const res = await fetchT(`${CLOUD}/sync/restore?desde=${encodeURIComponent(cursor)}`, {
        headers: { 'x-sync-token': TOKEN },
      }, RESTORE_TIMEOUT_MS);
      if (!res.ok) throw new Error(`restore HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      const linhas = Object.values(data.tabelas).reduce((s, r) => s + r.length, 0);
      for (const [tabela, rows] of Object.entries(data.tabelas)) {
        for (const row of rows) {
          try { await upsertLocal(tabela, row); total++; }
          catch (e) { if (e.code === '23503') orfaos.push([tabela, row]); else throw e; }
        }
      }
      // Visibilidade: sem isto o restore era caixa-preta (nem o gestor nem o suporte
      // sabiam se baixava, travava ou dava erro). Loga a cada página + grava o progresso
      // em sync_state p/ a UI (/servidor) mostrar "Restaurando… N linha(s)".
      console.log(`  restore: página ${pagina} → +${linhas} linha(s) (total ${total}${orfaos.length ? `, ${orfaos.length} p/ varredura FK` : ''})`);
      try { await setState('restore_progresso', String(total)); } catch { /* best-effort */ }
      if (!data.proximoCursor || data.proximoCursor === cursor || linhas === 0) break;
      cursor = data.proximoCursor;
      await setState('restore_cursor', cursor);
    }
    // Varredura final dos órfãos (os pais de páginas posteriores já entraram). Várias
    // passadas porque um órfão pode depender de outro (cadeia comanda→item→…); para quando
    // uma passada não resolve mais nada (pai genuinamente ausente na nuvem = fica de fora).
    let resta = orfaos;
    for (let passe = 0; passe < 6 && resta.length; passe++) {
      const proximo = [];
      for (const [tabela, row] of resta) {
        try { await upsertLocal(tabela, row); total++; }
        catch (e) { if (e.code === '23503') proximo.push([tabela, row]); else throw e; }
      }
      if (proximo.length === resta.length) { resta = proximo; break; }
      resta = proximo;
    }
    if (resta.length) console.warn(`  ${resta.length} linha(s) sem pai (FK) mesmo após varredura final do restore`);
    await setState('restaurado_em', new Date().toISOString());
    console.log(`Restauração concluída — ${total} linha(s) aplicadas.`);
    // Push do pendente local por ÚLTIMO — best-effort, NUNCA trava o download acima.
    try { await push(); } catch (e) { console.warn(`  push pós-restore (best-effort): ${e.message}`); }
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
    await fetchT(`${CLOUD}/edge/telemetria`, {
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
    const res = await fetchT(`${CLOUD}/edge/comandos`, { headers: { 'x-sync-token': TOKEN } });
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
      await fetchT(`${CLOUD}/edge/comandos/${c.id}/ack`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-sync-token': TOKEN },
        body: JSON.stringify({ ok, resultado }),
      }).catch(() => {});
      console.log(`comando ${c.comando} -> ${ok ? 'ok' : 'erro'}: ${resultado}`);
    }
  } catch { /* sem rede — tenta no próximo ciclo */ }
}

// Trava de reentrância: se um ciclo demora mais que o intervalo (ex.: push preso em
// timeout 524 da origem), o setInterval NÃO pode disparar outro por cima — senão viram
// pushes CONCORRENTES (seq fora de ordem, dados duplicados) que sobrecarregam a nuvem
// e causam 502 em cascata. Um ciclo por vez; o próximo tick pula se ainda está rodando.
let cicloRodando = false;
async function ciclo() {
  if (cicloRodando) {
    console.warn(`[${new Date().toISOString()}] ciclo anterior ainda em execução — pulando este tick`);
    return;
  }
  cicloRodando = true;
  let erro = null, p = 0, u = 0;
  try {
    // HEARTBEAT CEDO (liveness): antes das operações longas (pull/push grandes ou um
    // RESTORE de estado). Antes, o heartbeat só saía no FIM do ciclo (linha ~490); um
    // restore de minutos atrasava o "estou vivo" além do limite de 3min → a NUVEM
    // considerava o edge OFFLINE e MATERIALIZAVA o pedido novo lá (setando comanda_id)
    // ou o CloudFallbackProcessor o assumia → ao descer com comanda_id preenchido, o
    // EdgePedidosProcessor (que só pega comanda_id NULL) nunca materializava local:
    // "o pedido não entra no servidor edge". O ping antecipado mantém a nuvem deferindo.
    await heartbeat(0, 0, null);
    try {
      p = await pull();
      u = await push();
      console.log(`[${new Date().toISOString()}] sync ok — pull ${p} linha(s), push ${u} linha(s)`);
    } catch (e) {
      erro = e.message;
      console.error(`[${new Date().toISOString()}] sync FALHOU: ${causaErro(e)}`);
      await reportarTelemetria('sync', 'sync_erro', causaErro(e));
    }
    // Restauração sob demanda (botão do app grava a flag em sync_state).
    if ((await getState('restaurar_solicitado', '0')) === '1') {
      await heartbeat(p, u, erro); // ping ANTES do restore longo (mantém a nuvem deferindo)
      try { await restaurar(); } catch (e) { console.error(`Restauração FALHOU: ${e.message}`); }
    }
    await licenca();
    await verificarComandos();
    // Verificação de update: nas janelas de abertura E a cada ~10 min (o gestor
    // pediu aviso mais frequente). Não aplica sozinho — só marca `update_disponivel`
    // em sync_state; o app mostra o aviso e o botão de baixar/instalar.
    await updateCheckSeJanela();
    await updateCheckPeriodico();
    await heartbeat(p, u, erro, true); // heartbeat RICO (saúde dos 5 serviços) no FIM do ciclo
  } catch (e) {
    // BLINDAGEM: NENHUM erro de ciclo pode derrubar o daemon. O try interno cobre só
    // pull/push; um throw de licenca/verificarComandos/updateCheck/heartbeat (aqui fora)
    // subia até o `await ciclo()` do boot e CRASHAVA o processo → NSSM reiniciava em loop
    // e nunca chegava a "sync ok". Agora loga + telemetria e segue no próximo tick.
    console.error(`[${new Date().toISOString()}] ciclo ERRO (blindado): ${causaErro(e)}`);
    try { await reportarTelemetria('sync', 'ciclo_erro', causaErro(e)); } catch { /* best-effort */ }
  } finally {
    cicloRodando = false; // libera SEMPRE — mesmo com erro, o próximo tick pode rodar
  }
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

// Verificação periódica: a cada ~10 min pergunta à nuvem se há versão nova. O
// daemon roda a cada INTERVAL (30s), então guardamos o último check em sync_state
// e só refazemos passados 10 min. Assim o aviso de atualização aparece rápido no
// app, sem depender só das janelas de abertura.
const UPDATE_INTERVALO_MS = 10 * 60 * 1000;
async function updateCheckPeriodico() {
  try {
    const ultimo = Number(await getState('upd_ultimo_check', '0')) || 0;
    if (Date.now() - ultimo < UPDATE_INTERVALO_MS) return;
    await setState('upd_ultimo_check', String(Date.now()));
    await updateCheck();
  } catch (e) {
    console.warn(`  updateCheckPeriodico: ${e.message}`);
  }
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

// BLINDAGEM GLOBAL: um erro assíncrono solto (ex.: Postgres ainda em recuperação no
// boot → 57P03 no ensureState; rejeição sem catch) NÃO pode matar o processo. Sem isto,
// o daemon caía e o NSSM reiniciava em loop (dezenas de "Daemon de sync —" sem "sync ok").
process.on('unhandledRejection', (e) => console.error(`[unhandledRejection] ${e?.message ?? e}`));
process.on('uncaughtException', (e) => console.error(`[uncaughtException] ${e?.message ?? e}`));

// ensureState e o 1º ciclo NÃO podem crashar o boot (ex.: PG recuperando = 57P03).
// Se falharem, loga e segue — o setInterval reexecuta o ciclo quando o PG estabilizar.
try { await ensureState(); } catch (e) { console.error(`ensureState falhou no boot (segue): ${e?.message ?? e}`); }
try { await ciclo(); } catch (e) { console.error(`primeiro ciclo falhou no boot (segue): ${e?.message ?? e}`); }
setInterval(ciclo, INTERVAL);
