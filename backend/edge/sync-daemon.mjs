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
import { join } from 'path';
import { createHash, createHmac } from 'node:crypto';
import zlib from 'node:zlib';
import { Readable } from 'node:stream';
import dns from 'node:dns';
// Preferir IPv4 nas resoluções DNS. Num SERVIÇO do Windows o IPv6 costuma NÃO rotear
// (o processo do USUÁRIO conecta por IPv6 e dá 200; o do serviço falha) → o daemon
// batia "fetch failed" a cada ciclo enquanto o fetch manual funcionava. IPv4 p/
// Cloudflare é universal; Happy Eyeballs ainda tenta IPv6 como fallback. Junto com o
// retry do fetchT (socket morto reusado do pool), elimina o "fetch failed" em série.
dns.setDefaultResultOrder('ipv4first');

const pExecFile = promisify(execFile);

// LOG com carimbo de data/hora ISO em TODA linha. Sem isto, o arquivo rolante mistura
// linhas de tentativas ANTIGAS (restore/pull de instalações anteriores) com as novas e
// ninguém sabe se um "restore concluído" foi antes ou depois de uma atualização — a
// leitura no PowerShell vira adivinhação (nos custou tempo em 01/09). Prefixa [ISO] uma
// vez; as chamadas param de repetir o carimbo à mão (evita duplicar).
for (const _m of ['log', 'warn', 'error']) {
  const _orig = console[_m].bind(console);
  console[_m] = (...a) => _orig(`[${new Date().toISOString()}]`, ...a);
}

// Rodando como servico do Windows nao ha shell que exporte as envs. A API usa
// @nestjs/config + secure-env; este daemon faz o equivalente E DECIFRA os enc:
// DPAPI — senao a EDGE_DATABASE_URL fica cifrada e o pg conecta como a conta da
// maquina (28P01 "password authentication failed for user <MAQUINA>$").
import { carregarEnvLocal } from './decifrar-env.mjs';
import { criarReconciliacao } from './sync-reconciliacao.mjs';
import {
  SQL_SEM_RESPONDER, SQL_DANFE_JA_NA_FILA, SQL_DANFE_ALVO, SQL_DANFE_INSERIR, SQL_JOB_DO_COMANDO,
  SQL_FILA_POR_IMPRESSORA,
} from './impressao-fila.mjs';
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
// Snapshot (Trilha A): download de UM arquivo (todo o transacional da janela) — janela
// larga. Ajustável por SYNC_SNAPSHOT_TIMEOUT_MS.
const SNAPSHOT_TIMEOUT_MS = Number(process.env.SYNC_SNAPSHOT_TIMEOUT_MS || 300000);
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
  // Pausa por estoque POR LOJA (mig 260): a loja calcula a própria pausa aqui. Depois de produto.
  { tabela: 'produto_pausa_estoque', cursor: 'updated_at' },
  { tabela: 'cardapio_config', cursor: 'updated_at' },
  // Configs espelhadas (P1, mig 181): impressoras/terminais e cupom/perfis sobem
  // (backup + volta num banco novo). equipamento FILTRADO: nunca 'servidor_local'.
  { tabela: 'equipamento', cursor: 'updated_at', filtro: "tipo in ('impressora','pdv','salao','ponto_baixa','kds')" },
  { tabela: 'delivery_config', cursor: 'updated_at' },
  { tabela: 'etiqueta_template', cursor: 'updated_at' },
  { tabela: 'opcao', cursor: 'updated_at' },
  { tabela: 'complemento', cursor: 'updated_at' },
  { tabela: 'complemento_item', cursor: 'updated_at' },
  { tabela: 'produto_complemento', cursor: 'updated_at' },
  { tabela: 'complemento_grupo', cursor: 'updated_at' },
  { tabela: 'complemento_opcao', cursor: 'updated_at' },
  // ── PARIDADE (mig 272/273) — o que a loja produz e nunca subia ───────────────────────
  // Espelha a mesma ordem do sync-config da nuvem (pai antes do filho). Config e cadastro
  // primeiro; os documentos que dependem de comanda/caixa ficam lá embaixo.
  { tabela: 'produto_sugestao', cursor: 'created_at' },
  { tabela: 'produto_faixa_preco', cursor: 'created_at' },
  { tabela: 'produto_destino_producao', cursor: 'created_at' },
  { tabela: 'setor_destino_producao', cursor: 'created_at' },
  { tabela: 'complemento_destino_producao', cursor: 'created_at' },
  { tabela: 'opcao_destino_producao', cursor: 'created_at' },
  { tabela: 'entitlement', cursor: 'updated_at' },
  { tabela: 'janela_pico', cursor: 'updated_at' },
  { tabela: 'contador', cursor: 'updated_at' },
  { tabela: 'categoria_item', cursor: 'updated_at' },
  { tabela: 'forma_pagamento', cursor: 'updated_at' },
  { tabela: 'kds_cor_config', cursor: 'updated_at' },
  { tabela: 'tef_config', cursor: 'updated_at' },
  { tabela: 'mesa', cursor: 'updated_at' },
  { tabela: 'documento_controlado', cursor: 'updated_at' },
  { tabela: 'ciencia', cursor: 'created_at' },
  { tabela: 'checklist', cursor: 'updated_at' },
  { tabela: 'checklist_item', cursor: 'updated_at' },
  { tabela: 'pop', cursor: 'updated_at' },
  { tabela: 'tarefa_def', cursor: 'updated_at' },
  { tabela: 'tarefa_instancia', cursor: 'updated_at' }, // id da chave de negócio (mig 277)
  { tabela: 'escala_alocacao', cursor: 'updated_at' },
  { tabela: 'guia', cursor: 'updated_at' },
  { tabela: 'guia_passo', cursor: 'created_at' },
  { tabela: 'comunicado', cursor: 'updated_at' },
  { tabela: 'comunicado_leitura', cursor: 'created_at' },
  { tabela: 'clima_pesquisa', cursor: 'updated_at' },
  { tabela: 'clima_resposta', cursor: 'created_at' },
  { tabela: 'clima_participacao', cursor: 'created_at' },
  { tabela: 'escala_regra', cursor: 'updated_at' },
  { tabela: 'dia_especial', cursor: 'updated_at' },
  { tabela: 'vistoria', cursor: 'updated_at' },
  { tabela: 'ocorrencia', cursor: 'updated_at' },
  { tabela: 'pedido_manutencao', cursor: 'updated_at' },
  { tabela: 'atendimento_chamado', cursor: 'atualizado_em' },
  { tabela: 'alerta_estoque', cursor: 'atualizado_em' },
  { tabela: 'cupom_uso', cursor: 'created_at' }, // o estorno feito aqui precisa voltar o uso
  // Dinheiro do cliente (mig 274). O SALDO não sobe: é recalculado do extrato por gatilho
  // dos dois lados — número sincronizado por última-escrita faria um crédito apagar o outro.
  { tabela: 'cashback_plano', cursor: 'atualizado_em' },
  { tabela: 'cashback_produto_valor', cursor: 'criado_em' },
  { tabela: 'cashback_movimento', cursor: 'criado_em' },
  { tabela: 'cashback_vale', cursor: 'atualizado_em' },
  { tabela: 'fidelidade_plano', cursor: 'atualizado_em' },
  { tabela: 'fidelidade_ponto', cursor: 'atualizado_em' },
  { tabela: 'fidelidade_resgate', cursor: 'atualizado_em' },
  { tabela: 'fidelidade_ajuste', cursor: 'criado_em' },
  // Cadastros bidirecionais (LWW): compra/recebimento no edge cria/edita fornecedor
  // e insumo localmente — precisam SUBIR (fornecedor antes de item_estoque por FK).
  { tabela: 'fornecedor', cursor: 'updated_at' },
  { tabela: 'item_estoque', cursor: 'updated_at' },
  // Custo médio/mínimo POR LOJA (mig 257): o recebimento e a produção daqui ponderam o
  // custo da loja. Depois de item_estoque (FK).
  { tabela: 'item_estoque_unidade', cursor: 'updated_at' },
  // Filhas do insumo (mig 272): fornecedores do item e conversão de unidade de compra.
  { tabela: 'item_fornecedor', cursor: 'created_at' },
  { tabela: 'item_conversao', cursor: 'created_at' },
  // DOCUMENTOS DE ESTOQUE (mig 243): nascem AQUI (Recebimento/Contagem/Compras/
  // Desperdício rodam no edge) e nunca subiam — a nuvem via o movimento de estoque mas
  // não a nota, a contagem nem a perda que o originou; e a CONTA A PAGAR criada pelo
  // recebimento não chegava ao Financeiro. Depois de fornecedor/item_estoque por FK,
  // e pai antes de filho dentro do bloco.
  { tabela: 'recebimento', cursor: 'updated_at' },
  { tabela: 'recebimento_item', cursor: 'updated_at' },
  { tabela: 'lote', cursor: 'updated_at' },
  { tabela: 'desperdicio', cursor: 'updated_at' },
  // Etiqueta de validade (mig 245): depois de desperdicio — a vencida vira perda.
  { tabela: 'etiqueta_validade', cursor: 'updated_at' },
  { tabela: 'contagem_lista', cursor: 'updated_at' },
  { tabela: 'contagem_lista_item', cursor: 'updated_at' },
  { tabela: 'contagem_execucao', cursor: 'updated_at' },
  { tabela: 'contagem_item', cursor: 'updated_at' },
  { tabela: 'compra_lista', cursor: 'updated_at' },
  { tabela: 'compra_item', cursor: 'updated_at' },
  { tabela: 'titulo_financeiro', cursor: 'updated_at' },
  // Cliente do cardápio/CRM (bidirecional): cliente identificado no balcão sobe.
  // ANTES de pedido_externo (FK na nuvem: pedido_externo.cliente_id → cliente.id).
  // Cursor = atualizado_em (a tabela não tem updated_at).
  { tabela: 'cliente', cursor: 'atualizado_em' },
  { tabela: 'cliente_endereco', cursor: 'atualizado_em' }, // endereço salvo do cliente (mig 276)
  { tabela: 'cardapio_bairro', cursor: 'atualizado_em' }, // frete por bairro (mig 276)
  { tabela: 'caixa_sessao', cursor: 'updated_at' },
  { tabela: 'comanda', cursor: 'updated_at' },
  { tabela: 'comanda_item', cursor: 'updated_at' },
  // Complementos do item (mig 262): nunca subiam. Depois de comanda_item (FK).
  { tabela: 'comanda_item_complemento', cursor: 'created_at' },
  // PARIDADE (mig 272): documentos que dependem da comanda/caixa.
  { tabela: 'comanda_pagamento', cursor: 'created_at' },
  { tabela: 'acerto_subpdv', cursor: 'updated_at' },
  { tabela: 'nota_fiscal', cursor: 'updated_at' }, // NFC-e emitida no PDV local
  // Inutilização de numeração (mig 282): é comprovante fiscal, guarda de 5 anos, e é o que
  // prova ao Fisco que o buraco na sequência foi regularizado. Sobe junto com a nota.
  { tabela: 'fiscal_inutilizacao', cursor: 'updated_at' },
  // Eventos da NFC-e (mig 284): o cancelamento por substituição é comprovante fiscal e
  // precisa subir junto com a nota que ele cancela.
  { tabela: 'fiscal_evento', cursor: 'updated_at' },
  { tabela: 'ordem_producao', cursor: 'updated_at' },
  { tabela: 'producao_pedido', cursor: 'updated_at' },
  { tabela: 'producao_pedido_item', cursor: 'updated_at' },
  { tabela: 'pedido_externo', cursor: 'updated_at' },
  // Pagamento dividido (mig 230/262): nunca subia. Depois do pedido (FK).
  { tabela: 'pedido_externo_pagamento', cursor: 'created_at' },
  { tabela: 'movimento_estoque', cursor: 'created_at' },
  // De qual lote saiu cada baixa (mig 248) — append-only, acompanha o ledger.
  { tabela: 'movimento_lote', cursor: 'created_at' },
  { tabela: 'ponto_marcacao', cursor: 'created_at' },
  { tabela: 'ponto_ajuste', cursor: 'created_at' }, // depois da marcação que ele ajusta (FK)
  { tabela: 'pagamento_tef', cursor: 'atualizado_em' },
  { tabela: 'lancamento_caixa', cursor: 'created_at' },
  { tabela: 'audit_log', cursor: 'created_at' },
  // Exclusões físicas feitas aqui (mig 262). POR ÚLTIMO: chegam à nuvem depois das linhas.
  { tabela: 'sync_exclusao', cursor: 'created_at' },
];

// Tabelas do SNAPSHOT (espelha TABELAS_RESTORE do backend) + a coluna de cursor de cada.
// Ao FIM do restore posicionamos o pull_cursores destas com a marca-d'água REAL do banco
// local — assim o ciclo seguinte NÃO re-baixa os 60 dias que o snapshot já trouxe (o
// -Limpar zera o cursor p/ 1970 → crawl de dezenas de ciclos até "hoje"). SÓ estas 9: o
// catálogo/controle fica de FORA (não vem no snapshot) e segue baixando pelo PISO global
// (pull_cursor=1970), por isso NUNCA mexemos no pull_cursor global aqui.
const SNAPSHOT_TABELAS = [
  ['cliente', 'atualizado_em'],
  ['caixa_sessao', 'updated_at'],
  ['comanda', 'updated_at'],
  ['comanda_item', 'updated_at'],
  ['comanda_item_complemento', 'created_at'],
  ['comanda_pagamento', 'created_at'],
  ['producao_pedido', 'updated_at'],
  ['producao_pedido_item', 'updated_at'],
  ['pedido_externo', 'updated_at'],
  ['pedido_externo_pagamento', 'created_at'],
  ['lancamento_caixa', 'created_at'],
  ['movimento_estoque', 'created_at'],
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
  // Toda conexão do daemon nasce marcada como "aplicação de sync" (mig 259) — parâmetro de
  // ABERTURA da conexão. Antes era um `c.query(set_config...)` no evento 'connect' sem esperar,
  // e o pool já entregava a mesma conexão para outra consulta: o pg avisa "Calling client.query()
  // when the client is already executing a query" (será erro no pg@9) — reproduzido set/2026.
  options: '-c regem.sync=on',
});
// Resiliencia (auditoria ago/2026): o Postgres reiniciado (57P01, a cada install/
// update) emite 'error' na conexao OCIOSA do pool -> SEM handler o Node derruba o
// daemon. So logamos; o pg descarta a conexao morta e reabre na proxima query.
pool.on('error', (e) => console.error(`[sync] pool: conexao ociosa caiu (${e?.code ?? e?.message}) - descartada, segue no ar`));
// Toda conexão do daemon é "aplicação de sync" (mig 259): o gatilho de updated_at mantém o
// carimbo que veio da nuvem. Sem isto ele trocava pela hora local, a linha voltava à nuvem
// como mais nova e ficava indo e voltando a cada ciclo (e podia vencer uma edição real).
// O daemon não faz edição de negócio — só aplica o que veio e grava sync_state/fila de
// impressão, que não têm esse gatilho.
// (a marca `regem.sync=on` vai na abertura da conexão — ver `options` do pool acima)
const colCache = new Map();
// Reconciliação pós-atualização (ver sync-reconciliacao.mjs): colunas/tabelas que a nuvem
// mandou enquanto este servidor ainda não as tinha.
const recon = criarReconciliacao({
  query: (sql, params) => pool.query(sql, params),
  getState: (k, d) => getState(k, d),
  setState: (k, v) => setState(k, v),
  colunas: (t) => colunas(t),
});

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

// exec = executor da query: `pool` no pull/restore normal; um CLIENT de transação no
// restore por snapshot (carga atômica com FK desligada). Default = pool (retrocompatível).
async function upsertLocal(tabela, row, exec = pool) {
  const cols = await colunas(tabela);
  const keys = Object.keys(row).filter((k) => cols.has(k));
  if (!keys.includes('id')) return;
  const setCols = keys.filter((k) => k !== 'id');
  const ph = keys.map((_, i) => `$${i + 1}`);
  const vals = keys.map((k) => coerce(row[k]));
  // Append puro (sem colunas mutáveis) → insere ou ignora.
  if (!setCols.length) {
    await exec.query(
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
  await exec.query(
    `insert into ${q(tabela)} (${keys.map(q).join(',')}) values (${ph.join(',')})
     on conflict (id) ${setSql}${whereSql}`,
    vals,
  );
}

// Upsert em LOTE (INSERT multi-linha) — 1 request por bloco no lugar de 1 por linha.
// A carga do snapshot tem dezenas de milhares de linhas: row-a-row levava ~10 min; o lote
// leva segundos. Mesma regra LWW do upsertLocal (não sobrescreve local mais novo) +
// exceção de estado terminal. Assume colunas consistentes no bloco (o snapshot manda select *).
async function upsertLote(tabela, rows, exec = pool) {
  if (!rows?.length) return 0;
  const cols = await colunas(tabela);
  const keys = Object.keys(rows[0]).filter((k) => cols.has(k));
  if (!keys.includes('id')) return 0;
  const setCols = keys.filter((k) => k !== 'id');
  const ph = [];
  const vals = [];
  let i = 1;
  for (const row of rows) {
    ph.push('(' + keys.map(() => `$${i++}`).join(',') + ')');
    for (const k of keys) vals.push(coerce(row[k]));
  }
  let setSql;
  if (!setCols.length) {
    setSql = 'do nothing';
  } else {
    const cond = [];
    if (cols.has('updated_at')) cond.push(`${q(tabela)}.updated_at < excluded.updated_at`);
    const terminais = ESTADOS_TERMINAIS[tabela];
    if (terminais && cols.has('status')) {
      const lst = terminais.map((s) => `'${s}'`).join(',');
      cond.push(`not (${q(tabela)}.status in (${lst}) and excluded.status not in (${lst}))`);
    }
    const whereSql = cond.length ? ` where ${cond.join(' and ')}` : '';
    setSql = `do update set ${setCols.map((k) => `${q(k)}=excluded.${q(k)}`).join(',')}${whereSql}`;
  }
  await exec.query(
    `insert into ${q(tabela)} (${keys.map(q).join(',')}) values ${ph.join(',')} on conflict (id) ${setSql}`,
    vals,
  );
  return rows.length;
}

// Reparos de UMA VEZ no mapa de cursores. Cada entrada é aplicada no máximo uma vez por
// instalação (marca em sync_state) e serve para casos em que a NUVEM passou a mandar algo
// que o edge precisa reler do começo — o cursor já gravado impediria sozinho.
//
// ledger_completo_v1: `movimento_estoque` era puxado com a janela de 60 dias. Como o SALDO
// é a soma de TODO o ledger, o edge nascia com saldo errado pelo tamanho do histórico que
// ficou de fora. A janela foi removida na nuvem, mas o cursor gravado aqui aponta para
// "60 dias atrás" e o histórico anterior nunca viria. Rebobinamos uma vez; o catch-up é
// paginado (1000 linhas/ciclo) e some sozinho quando alcança o presente.
const REPAROS_CURSOR = [{ marca: 'reparo_ledger_completo_v1', tabelas: ['movimento_estoque'] }];

async function repararCursores(cursores) {
  let mudou = false;
  for (const r of REPAROS_CURSOR) {
    if ((await getState(r.marca, '')) === 'feito') continue;
    for (const t of r.tabelas) {
      if (cursores[t]) {
        delete cursores[t]; // sem cursor próprio → a nuvem recomeça do zero (TABELAS_DESDE_ZERO)
        mudou = true;
      }
    }
    await setState(r.marca, 'feito');
    if (mudou) console.log(`Sync: cursor rebobinado (${r.marca}) — rebaixando o histórico de ${r.tabelas.join(', ')}.`);
  }
  if (mudou) await setState('pull_cursores', JSON.stringify(cursores));
  return cursores;
}

// Linhas por INSERT no pull em lote. 200 × ~60 colunas fica longe do limite de 65.535
// parâmetros do Postgres, mesmo na tabela mais larga (produto).
const LOTE_PULL = Number(process.env.SYNC_PULL_LOTE || 200);

// RELÓGIO: a regra "a mais nova vence" compara o updated_at gravado pelo relógio DESTE PC com
// o da nuvem. PC atrasado → a edição feita aqui parece velha e perde; adiantado → vence o que
// não devia. O pull devolve o cabeçalho HTTP `Date` da nuvem: medimos o desvio a cada ciclo,
// guardamos em sync_state (vai no heartbeat de saúde) e avisamos quando passa do limite.
const RELOGIO_LIMITE_S = Number(process.env.SYNC_RELOGIO_LIMITE_S || 120);
let relogioAvisadoEm = 0;
async function verificarRelogio(res, enviadoEm) {
  try {
    const hdr = res.headers.get('date');
    if (!hdr) return;
    const servidor = new Date(hdr).getTime();
    if (!Number.isFinite(servidor)) return;
    // Meio do caminho entre envio e resposta: desconta a latência. O cabeçalho tem precisão de
    // segundo, então só desvios de alguns segundos para cima significam alguma coisa.
    const local = (enviadoEm + Date.now()) / 2;
    const desvio = Math.round((local - servidor) / 1000);
    await setState('relogio_desvio_s', String(desvio));
    if (Math.abs(desvio) > RELOGIO_LIMITE_S && Date.now() - relogioAvisadoEm > 30 * 60 * 1000) {
      relogioAvisadoEm = Date.now();
      const msg = `relógio deste servidor está ${Math.abs(desvio)}s ${desvio > 0 ? 'ADIANTADO' : 'ATRASADO'} em relação à nuvem — acerte a data/hora do Windows (sincronizar com time.windows.com); com o relógio errado, edições podem ser descartadas pelo sync`;
      console.warn(`  ⚠️ ${msg}`);
      await reportarTelemetria('sync', 'relogio_desvio', msg);
    }
  } catch { /* best-effort */ }
}

async function semearPushInstalacaoNova(cursores) {
  if ((await getState('push_instalacao_nova', '')) === 'feito') return;
  const temCursor = Object.keys(cursores).length > 0 || (await getState('pull_cursor', '')) !== '';
  let vazio = !temCursor;
  for (const t of PUSH_TABLES) {
    if (!vazio) break;
    if (!(await colunas(t.tabela)).size) continue;
    const r = await pool.query(`select exists(select 1 from ${q(t.tabela)}) as tem`);
    if (r.rows[0]?.tem) vazio = false;
  }
  if (vazio) {
    const agora = (await pool.query(`select now()::text as t`)).rows[0].t;
    for (const t of PUSH_TABLES) await setState(`push_${t.tabela}`, `${agora}|00000000-0000-0000-0000-000000000000`);
    console.log('Sync: instalação nova — o push começa agora (o que descer da nuvem não volta).');
  }
  await setState('push_instalacao_nova', 'feito');
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
  // Nunca deixa um reparo derrubar o ciclo de sync — na falha, segue com o cursor atual.
  try {
    cursores = await repararCursores(cursores);
  } catch (e) {
    console.warn(`Sync: reparo de cursor falhou (segue normal): ${e.message}`);
  }
  // Instalação nova: o que vai descer da nuvem não pode voltar a subir (na carga inicial de uma
  // loja de teste, 6.900 linhas eram devolvidas no primeiro ciclo — a nuvem ignorava, mas o
  // tráfego e a carga eram reais). Só vale com o banco COMPLETAMENTE vazio e sem nenhum
  // cursor: não existe linha local a preservar. Uma vez por instalação.
  try {
    await semearPushInstalacaoNova(cursores);
  } catch (e) {
    console.warn(`Sync: não posicionou o push da instalação nova (segue normal): ${e.message}`);
  }
  // Reconciliação: semeia a transição da 1.29.0 (uma vez), promove o que a atualização
  // acabou de criar e rebobina as tabelas enfileiradas. Falha aqui não derruba o pull.
  try {
    await recon.semear();
    await recon.promoverAusentes();
    cursores = await recon.prepararCursores(cursores);
  } catch (e) {
    console.warn(`Sync: reconciliação não preparou (segue normal): ${e.message}`);
  }
  const qs =
    `desde=${encodeURIComponent(desde)}` +
    `&cursores=${encodeURIComponent(JSON.stringify(cursores))}`;
  const enviadoEm = Date.now();
  const res = await fetchT(`${CLOUD}/sync/pull?${qs}`, {
    headers: { 'x-sync-token': TOKEN },
  });
  if (!res.ok) throw new Error(`pull HTTP ${res.status}: ${await res.text()}`);
  await verificarRelogio(res, enviadoEm);
  const data = await res.json();
  // UMA conexão reservada para aplicar a resposta inteira. No pg.Pool, a consulta que FALHA
  // descarta a conexão (`release(err)`) e a próxima abre outra — ~250 ms no Windows. Linha que
  // falha por vínculo (pai fora da janela, ainda não chegou) pagava uma reconexão cada: 12
  // grupos de complemento levavam 3 s e uma página de pedidos, mais de 30 s. Erro numa conexão
  // reservada não a derruba. A marca `regem.sync` vem do evento 'connect' do pool.
  const cli = await pool.connect();
  try {
    // TRANSAÇÃO na aplicação: o PowerSync só troca de estado num ponto consistente e o
    // SymmetricDS mantém a transação de origem dentro do lote. Aqui, sem transação, quem
    // consultava o banco local no meio da aplicação via estado pela metade (comanda sem
    // itens, pedido sem pagamento). Um erro volta tudo e o ciclo seguinte reaplica — o
    // cursor só avança no fim, então nada se perde.
    await cli.query('begin');
    const n = await aplicarPull(data, cursores, cli);
    await cli.query('commit');
    return n;
  } catch (e) {
    try { await cli.query('rollback'); } catch { /* ignore */ }
    throw e;
  } finally {
    cli.release();
  }
}

// LIMPEZA DE ESCOPO (uma vez por instalação): a nuvem passou a mandar só o transacional
// DESTA loja, mas o que desceu antes continua aqui. Electric e PowerSync removem do cliente o
// que sai do recorte; fazemos o mesmo, em uma passada. Só roda quando o servidor tem loja
// definida e a empresa tem mais de uma. As filhas somem por cascata; a sessão do daemon está
// marcada como sync, então isto NÃO gera registro de exclusão (é limpeza local, não exclusão
// de negócio).
const TABELAS_ESCOPO_LOJA = [
  'comanda', 'caixa_sessao', 'lancamento_caixa', 'producao_pedido', 'pedido_externo',
  'movimento_estoque', 'desperdicio', 'recebimento', 'lote', 'etiqueta_validade',
  'contagem_lista', 'compra_lista', 'titulo_financeiro',
];
async function limparEscopoDeOutrasLojas() {
  if ((await getState('limpeza_escopo_v1', '')) === 'feito') return;
  const minha = (process.env.EDGE_UNIDADE_ID || '').trim();
  if (!minha) return; // servidor sem loja definida: não há o que separar
  const u = await pool.query('select count(*)::int as n from unidade where deleted_at is null');
  if ((u.rows[0]?.n ?? 0) < 2) { await setState('limpeza_escopo_v1', 'feito'); return; }
  let total = 0;
  for (const t of TABELAS_ESCOPO_LOJA) {
    const cols = await colunas(t);
    if (!cols.has('unidade_id')) continue;
    try {
      const r = await pool.query(
        `delete from ${q(t)} where ${q('unidade_id')} is not null and ${q('unidade_id')} <> $1`,
        [minha],
      );
      total += r.rowCount ?? 0;
    } catch (e) {
      console.warn(`  limpeza de escopo em ${t}: ${e.code || ''} ${e.message}`);
    }
  }
  await setState('limpeza_escopo_v1', 'feito');
  if (total) console.log(`Sync: ${total} linha(s) de OUTRAS lojas removidas deste servidor (escopo por loja).`);
}

// Ponto de salvamento avulso (fora do laço de blocos, que tem o seu).
async function tentarSp(cli, fn) {
  await cli.query('savepoint sp_sync2');
  try {
    await fn();
    await cli.query('release savepoint sp_sync2');
  } catch (e) {
    await cli.query('rollback to savepoint sp_sync2');
    throw e;
  }
}

async function aplicarPull(data, cursores, cli) {
  let aplicadas = 0;
  let pendentes = []; // linhas cujo pai (FK) ainda não chegou → retry
  const falhas = [];  // linhas com erro DURO (coluna/valor) → pular, NÃO travar o pull
  let fila = {};
  try { fila = await recon.fila(); } catch { fila = {}; }
  // Upsert normal + as colunas em reconciliação (se a tabela está na fila).
  const aplicar = async (tabela, row) => {
    await upsertLocal(tabela, row, cli);
    await recon.aplicarLinha(fila, tabela, row, cli);
  };
  // O que a nuvem mandou e este servidor não tem (tabela → null, ou → colunas).
  const ausentes = {};
  for (const [tabela, rows] of Object.entries(data.tabelas)) {
    const locais = await colunas(tabela);
    if (!locais.size) {
      // Tabela que ainda não existe aqui (atualização pendente): antes a linha era
      // descartada em silêncio, contada como aplicada, e o cursor AVANÇAVA — o histórico
      // nunca mais descia. Agora não aplica nem avança; entra na reconciliação quando a
      // tabela for criada.
      if (rows.length) ausentes[tabela] = null;
      if (data.cursores) delete data.cursores[tabela];
      continue;
    }
    const faltando = rows.length ? Object.keys(rows[0]).filter((k) => !locais.has(k)) : [];
    if (faltando.length) ausentes[tabela] = faltando;
    // EM LOTE: um INSERT por bloco (mesma regra da mais nova e de estado terminal do
    // upsertLocal). Linha a linha eram até 1.000 idas ao banco por tabela por ciclo — numa
    // recarga grande o ciclo inteiro ficava parado aqui. Se o bloco falhar (pai ainda não
    // chegou, linha "veneno", id repetido na página), cai no linha a linha para isolar.
    // Bloco que falha é dividido ao meio até isolar as linhas ruins (bloco de 1 = linha a
    // linha), para poucas linhas com pai ausente não jogarem a página inteira no caminho lento.
    // Cada tentativa roda em PONTO DE SALVAMENTO: dentro de uma transação, um erro aborta
    // tudo até o ponto salvo — sem isso a primeira linha ruim derrubaria a resposta inteira.
    const tentar = async (fn) => {
      await cli.query('savepoint sp_sync');
      try {
        await fn();
        await cli.query('release savepoint sp_sync');
      } catch (e) {
        await cli.query('rollback to savepoint sp_sync');
        throw e;
      }
    };
    const aplicarBloco = async (bloco) => {
      if (bloco.length > 1) {
        try {
          await tentar(async () => {
            await upsertLote(tabela, bloco, cli);
            for (const row of bloco) await recon.aplicarLinha(fila, tabela, row, cli);
          });
          aplicadas += bloco.length;
          return;
        } catch {
          const meio = Math.ceil(bloco.length / 2);
          await aplicarBloco(bloco.slice(0, meio));
          await aplicarBloco(bloco.slice(meio));
          return;
        }
      }
      const row = bloco[0];
      try {
        await tentar(() => aplicar(tabela, row));
        aplicadas++;
      } catch (e) {
        if (e.code === '23503') pendentes.push([tabela, row]);
        else falhas.push([tabela, row, e]);
      }
    };
    for (let i = 0; i < rows.length; i += LOTE_PULL) await aplicarBloco(rows.slice(i, i + LOTE_PULL));
  }
  // ÓRFÃOS DE CICLOS ANTERIORES: linha que chegou antes do pai (pedido de produção antes da
  // comanda que vem na página seguinte, numa carga grande). Antes as 3 tentativas eram só
  // NESTE ciclo: a linha era descartada, o cursor avançava e ela nunca mais descia (27 pedidos
  // de produção perdidos na carga inicial de uma loja de teste). Agora fica numa fila e é
  // retentada nos próximos ciclos — o mesmo que o restore já fazia.
  // Fila em TABELA (mig 264), não mais um texto JSON dentro de uma linha de sync_state
  // reescrito a cada ciclo: dá para indexar, contar e diagnosticar.
  let orfaosAntes = [];
  try {
    const r = await pool.query(`select tabela, conteudo, tentativas from sync_fila where tipo = 'orfao'`);
    orfaosAntes = r.rows.map((x) => ({ tabela: x.tabela, row: x.conteudo, n: x.tentativas }));
  } catch { orfaosAntes = []; }
  const tentativas = new Map(); // row.id → nº de ciclos em que já falhou
  for (const o of orfaosAntes) {
    if (!o?.tabela || !o?.row?.id) continue;
    pendentes.push([o.tabela, o.row]);
    tentativas.set(o.row.id, Number(o.n) || 0);
  }
  // Reprocessa dependências fora de ordem (pais já aplicados neste ciclo).
  for (let passe = 0; passe < 3 && pendentes.length; passe++) {
    const resta = [];
    for (const [tabela, row] of pendentes) {
      try {
        await tentarSp(cli, () => aplicar(tabela, row));
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
        try {
          await tentarSp(cli, () => upsertLocal(tabela, { ...row, cliente_id: null }, cli));
          aplicadas++;
          continue;
        } catch { /* cai no resta2 abaixo */ }
      }
      resta2.push([tabela, row]);
    }
    pendentes = resta2;
  }
  // Guarda os que ainda não entraram para os próximos ciclos. Depois de 20 ciclos o pai não vai
  // chegar (ex.: lançamento de caixa de sessão fora da janela de 60 dias): descarta com aviso.
  // A linha guardada é a da nuvem; se uma versão mais nova chegar antes, a regra da mais nova
  // impede a velha de sobrescrevê-la.
  const LIMITE_CICLOS = 20;
  const guardar = [];
  let descartados = 0;
  const vistos = new Set();
  for (const [tabela, row] of pendentes) {
    if (vistos.has(row.id)) continue;
    vistos.add(row.id);
    const n = (tentativas.get(row.id) ?? 0) + 1;
    if (n > LIMITE_CICLOS) descartados++;
    else guardar.push({ tabela, row, n });
  }
  if (guardar.length || orfaosAntes.length) {
    const manter = guardar.slice(0, 5000);
    await pool.query(`delete from sync_fila where tipo = 'orfao'`);
    for (const g of manter) {
      await pool.query(
        `insert into sync_fila (tipo, tabela, registro_id, conteudo, tentativas)
         values ('orfao', $1, $2, $3, $4)
         on conflict (tipo, tabela, registro_id) do update set conteudo = excluded.conteudo,
           tentativas = excluded.tentativas, atualizado_em = now()`,
        [g.tabela, g.row.id, JSON.stringify(g.row), g.n],
      );
    }
  }
  if (guardar.length) console.warn(`  ${guardar.length} linha(s) aguardando o pai (FK) — nova tentativa no próximo ciclo`);
  if (descartados) console.warn(`  ${descartados} linha(s) descartada(s): o pai não chegou em ${LIMITE_CICLOS} ciclos (fora da janela ou ausente na nuvem)`);
  // Exclusões feitas na nuvem (mig 262): apaga a mesma linha aqui, DEPOIS de aplicar as linhas
  // desta resposta. A sessão do daemon é marcada como sync, então não gera registro de volta.
  try {
    await aplicarExclusoes(data.tabelas?.sync_exclusao ?? [], cli);
  } catch (e) {
    console.warn(`  exclusões não aplicadas (tenta no próximo ciclo): ${e.message}`);
  }
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
  // A nuvem avisa que este servidor está mais atrasado que a janela de retenção das exclusões
  // (mig 265): dados apagados lá podem não ter mais registro, e seguir no delta deixaria linha
  // fantasma para sempre. O caminho é recomeçar pelo arquivo (restauração), que o próprio
  // ciclo dispara — e o push sobe o que é local antes, então nada se perde.
  if (data.reinicializar && (await getState('reinicializando', '0')) !== '1') {
    // Ressincronização completa: rebobina TODOS os cursores para o começo (é o que a nuvem
    // faria num reprovisionamento) e pede o arquivo do transacional. Sem rebobinar, os
    // cursores velhos continuariam velhos depois do arquivo e a nuvem pediria reinicialização
    // a cada ciclo — laço de restauração.
    await setState('reinicializando', '1');
    await setState('pull_cursores', '{}');
    await setState('pull_cursor', '1970-01-01T00:00:00Z');
    await setState('restaurar_solicitado', '1');
    await setState('reinicializado_em', new Date().toISOString());
    const msg = 'servidor local atrasado além da janela de retenção — ressincronizando do começo + restauração por arquivo';
    console.warn(`  ⚠️ ${msg}`);
    try { await reportarTelemetria('sync', 'reinicializar', msg); } catch { /* best-effort */ }
    return aplicadas; // o ciclo seguinte já baixa tudo com os cursores zerados
  }
  if (!data.reinicializar && (await getState('reinicializando', '0')) === '1') {
    await setState('reinicializando', '0'); // voltou à janela: volta ao delta normal
  }
  try {
    await recon.registrarAusentes(ausentes);
    await recon.concluirPull(data.tabelas);
  } catch (e) {
    console.warn(`Sync: reconciliação não registrou o fim do pull (tenta no próximo): ${e.message}`);
  }
  return aplicadas;
}

// Aplica exclusões recebidas. Só em tabela que existe aqui e tem tenant_id; a nuvem só gera
// registro para tabela sincronizada. Apagar o pai antes do filho sem cascata dá 23503 (ex.:
// cliente "esquecido" cujo pedido ainda não chegou desvinculado): fica numa fila em sync_state
// e é retentado nos próximos ciclos, até 50 vezes.
async function aplicarExclusoes(novas, exec = pool) {
  let fila = [];
  try {
    const r = await pool.query(`select tabela, registro_id, tentativas from sync_fila where tipo = 'exclusao'`);
    fila = r.rows.map((x) => ({ tabela: x.tabela, id: x.registro_id, tenant: null, n: x.tentativas }));
  } catch { fila = []; }
  const todas = [...fila, ...novas.map((x) => ({ tabela: x.tabela, id: x.registro_id, tenant: x.tenant_id, n: 0 }))];
  if (!todas.length) return;
  const resta = [];
  for (const x of todas) {
    if (!x?.tabela || !x?.id || x.tabela === 'sync_exclusao' || x.tabela === 'sync_state') continue;
    const cols = await colunas(x.tabela);
    if (!cols.has('tenant_id')) continue;
    try {
      // Sem o tenant (fila relida da tabela), apaga pelo id — que é único e veio da nuvem.
      await exec.query(
        x.tenant
          ? `delete from ${q(x.tabela)} where ${q('id')} = $1 and ${q('tenant_id')} = $2`
          : `delete from ${q(x.tabela)} where ${q('id')} = $1`,
        x.tenant ? [x.id, x.tenant] : [x.id],
      );
    } catch (e) {
      if (e.code === '23503' && (x.n ?? 0) < 50) resta.push({ ...x, n: (x.n ?? 0) + 1 });
      else console.warn(`  exclusão ${x.tabela}/${x.id} descartada: ${e.code || ''} ${e.message}`);
    }
  }
  if (resta.length || fila.length) {
    await pool.query(`delete from sync_fila where tipo = 'exclusao'`);
    for (const x of resta.slice(0, 5000)) {
      await pool.query(
        `insert into sync_fila (tipo, tabela, registro_id, conteudo, tentativas)
         values ('exclusao', $1, $2, $3, $4)
         on conflict (tipo, tabela, registro_id) do update set tentativas = excluded.tentativas,
           atualizado_em = now()`,
        [x.tabela, x.id, JSON.stringify({ tenant: x.tenant ?? null }), x.n ?? 0],
      );
    }
  }
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
  if (!res.ok) {
    const err = new Error(`push HTTP ${res.status}: ${await res.text()}`);
    err.status = res.status; // p/ o push classificar definitivo (4xx) × transitório (5xx/429)
    throw err;
  }
  await setState('push_seq', String(seq)); // só avança o seq após sucesso
}

// Cursor do push = "<ISO>|<id>" (keyset composto). Compat: cursores antigos são só o ISO —
// parseia como {ts, id=nil} (re-envia no máx. as linhas do mesmo ts uma vez; a nuvem deduplica).
function parseCursorPush(s) {
  const str = String(s ?? '');
  const i = str.indexOf('|');
  if (i < 0) return { ts: str || '1970-01-01T00:00:00Z', id: '00000000-0000-0000-0000-000000000000' };
  return { ts: str.slice(0, i), id: str.slice(i + 1) || '00000000-0000-0000-0000-000000000000' };
}

// Reenvia um lote REJEITADO (4xx definitivo) linha a linha, isolando a "veneno": as boas sobem;
// a que ainda falhar 4xx é logada (DEAD-LETTER) e pulada; 5xx/rede no meio → para (o cursor já
// persistido reflete o progresso, retoma no próximo ciclo). Persiste o cursor por linha PROCESSADA.
let deadLetters = 0; // linhas puladas por 4xx (o --descarregar não pode apagar o banco com isso)
async function enviarLinhaALinha(t, linhas, enviadas, chave, cursorDe) {
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    try {
      await enviarLote({ tabela: t.tabela, linhas: [enviadas[i]] });
    } catch (e) {
      const st = e?.status;
      const definitivo = typeof st === 'number' && st >= 400 && st < 500 && st !== 429 && st !== 408;
      if (!definitivo) throw e; // transitório → para; retoma no próximo ciclo sem perder posição
      deadLetters++;
      console.error(
        `[push dead-letter] ${t.tabela} id=${linha.id} cursor=${cursorDe(linha)} — PULADA (HTTP ${st}): ${String(e?.message ?? '').slice(0, 160)}`,
      );
    }
    await setState(chave, cursorDe(linha));
  }
}

// Relógio MUITO fora trava o envio: a regra "a mais nova vence" compara o updated_at gravado
// pelo relógio DESTE PC com o da nuvem. Com horas de diferença, cada linha enviada pode
// descartar em silêncio a versão certa do outro lado (é o problema que os relógios lógicos
// híbridos resolvem). Preferimos SEGURAR o envio e gritar a corromper o histórico; o pull
// continua, então a loja segue recebendo.
const RELOGIO_TRAVA_S = Number(process.env.SYNC_RELOGIO_TRAVA_S || 900);
async function relogioConfiavel() {
  const d = Number(await getState('relogio_desvio_s', '0')) || 0;
  if (Math.abs(d) <= RELOGIO_TRAVA_S) return true;
  console.error(
    `  ⛔ envio SUSPENSO: relógio ${Math.abs(d)}s ${d > 0 ? 'adiantado' : 'atrasado'} — acerte a data/hora do Windows; nada é enviado até normalizar (o recebimento continua).`,
  );
  try { await reportarTelemetria('sync', 'relogio_trava', `push suspenso: desvio de ${d}s`); } catch { /* best-effort */ }
  return false;
}

async function push(limiteMs = null) {
  if (!(await relogioConfiavel())) return 0;
  // Páginas pequenas: cada tabela sobe em blocos de PUSH_MAX linhas, UM request por
  // bloco. Menos chance de 413 e progresso persistido (o cursor só avança após o
  // request do bloco dar certo — se cair no meio, retoma de onde parou).
  const PUSH_MAX = Number(process.env.SYNC_PUSH_MAX_LINHAS || 200);
  // TIME-BOX: o push NÃO pode monopolizar o ciclo. Sem isto, empurrar um backlog grande
  // (ex.: re-push das ~25k linhas do snapshot) rodava minutos numa chamada só e o PULL não
  // rodava nesse tempo → pedido novo não descia. Fatia de 20s por ciclo; o cursor persiste
  // (setState por bloco), então o próximo ciclo continua de onde parou.
  const PUSH_LIMITE_MS = limiteMs ?? Number(process.env.SYNC_PUSH_LIMITE_MS || 20000);
  const push_inicio = Date.now();
  let total = 0;
  let fila = {};
  try { fila = await recon.fila(); } catch { fila = {}; }
  for (const t of PUSH_TABLES) {
    const locais = await colunas(t.tabela);
    if (!locais.size) continue;
    // Reconciliação em curso nesta tabela: espera, ou sobe sem as colunas que este servidor
    // ainda não recebeu da nuvem (senão sobrescreveria a nuvem com vazio).
    const modo = await recon.modoPush(t.tabela, fila);
    if (modo === 'esperar') continue;
    const tirar = Array.isArray(modo) ? modo : null;
    const semColunas = (rows) =>
      rows.map((row) => {
        const c = { ...row };
        delete c.__kc_push; // auxiliar do cursor, não é coluna
        if (tirar) for (const k of tirar) delete c[k];
        return c;
      });
    // Banco sem a coluna de cursor (instalação antiga: ex. compra_item antes da mig 243, no
    // --descarregar do instalador) → keyset só por id, com estado próprio.
    const porId = !locais.has(t.cursor);
    const chave = porId ? `push_${t.tabela}__id` : `push_${t.tabela}`;
    // Cursor em TEXTO do próprio Postgres (precisão de microssegundo). Antes passava por Date
    // do JS (milissegundo): a última linha de cada página tinha valor maior que o cursor
    // truncado e era REENVIADA em todo ciclo, para sempre.
    const cursorDe = (row) => (porId ? String(row.id) : `${row.__kc_push}|${row.id}`);
    let cur = await getState(chave, porId ? '' : '1970-01-01T00:00:00Z');
    for (let pagina = 0; pagina < 10000; pagina++) {
      const filtro = t.filtro ? ` and (${t.filtro})` : ''; // constante do PUSH_TABLES, não é entrada de usuário
      let r;
      if (porId) {
        r = await pool.query(
          `select * from ${q(t.tabela)} where ${q('id')}::text > $1${filtro} order by ${q('id')}::text asc limit $2`,
          [cur, PUSH_MAX],
        );
      } else {
        const { ts, id } = parseCursorPush(cur);
        // Keyset COMPOSTO (cursor, id) — mesma forma expandida/sargável do PULL da nuvem. SEM o
        // desempate por id, ≥PUSH_MAX linhas com o MESMO timestamp na fronteira da página eram
        // PULADAS pra sempre (perda silenciosa): now()=início da tx → uma transação grande
        // (audit_log, movimento_estoque, comanda_item…) gera muitos timestamps idênticos.
        r = await pool.query(
          `select *, ${q(t.cursor)}::text as __kc_push from ${q(t.tabela)}
             where (${q(t.cursor)} > $1::timestamptz
                    or (${q(t.cursor)} = $1::timestamptz and ${q('id')} > $2))${filtro}
             order by ${q(t.cursor)} asc, ${q('id')} asc limit $3`,
          [ts, id, PUSH_MAX],
        );
      }
      if (!r.rows.length) break;
      const enviadas = semColunas(r.rows);
      try {
        await enviarLote({ tabela: t.tabela, linhas: enviadas });
        const ultima = r.rows[r.rows.length - 1]; // ordenado pelo keyset → a última é o máximo
        cur = cursorDe(ultima);
        await setState(chave, cur);
      } catch (e) {
        const st = e?.status;
        const definitivo = typeof st === 'number' && st >= 400 && st < 500 && st !== 429 && st !== 408;
        if (!definitivo) throw e; // transitório (5xx/rede/429): re-tenta o LOTE no próximo ciclo (como hoje)
        // DEFINITIVO (4xx): o lote tem uma linha "veneno" que travava a tabela + as posteriores.
        // Isola linha a linha (as boas sobem; a veneno vira dead-letter e é pulada) — não bloqueia
        // o resto do sync (vendas de outras tabelas continuam subindo).
        console.warn(`  push: lote de ${t.tabela} rejeitado (HTTP ${st}) — reenviando linha a linha p/ isolar a veneno`);
        await enviarLinhaALinha(t, r.rows, enviadas, chave, cursorDe);
        cur = await getState(chave, cur); // recarrega o cursor avançado pelo row-by-row
      }
      total += r.rows.length;
      if (Date.now() - push_inicio > PUSH_LIMITE_MS) {
        console.log(`  push: fatia de ${PUSH_LIMITE_MS}ms atingida (${total} linha(s)) — libera o ciclo; continua no próximo`);
        return total;
      }
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
async function updateCheck(jaRecebido) {
  try {
    const atual = process.env.APP_VERSION || '1';
    let j = jaRecebido;
    if (!j) {
      // Com o token do servidor: a nuvem decide se esta loja já está na fatia do release
      // (distribuição escalonada — piloto/percentual).
      const res = await fetchT(`${CLOUD}/edge/update-check?versao=${encodeURIComponent(atual)}`, {
        headers: { 'x-sync-token': TOKEN },
      });
      if (!res.ok) return;
      j = await res.json();
    }
    if (j.atualizar) {
      await setState('update_disponivel', j.ultima || '');
      await setState('update_url', j.url || '');
      await setState('update_notas', j.notas || '');
      console.warn(`  ⬆️ atualização disponível: ${atual} → ${j.ultima}${j.url ? ` (${j.url})` : ''}. Rode a atualização do edge quando a loja estiver fechada.`);
    } else {
      await setState('update_disponivel', '');
    }
    await setState('update_atual_recolhida', j.versaoAtualRecolhida ? '1' : '');
  } catch { /* best-effort: sem rede, ignora */ }
}

// Instalação AGENDADA pelo gestor (tela Servidor → "Agendar"): chegada a hora, dispara a
// tarefa RegemEdgeUpdate — mas só com a loja PARADA (sem caixa aberto nas últimas 16 h nem
// pedido em produção nas últimas 3 h; a mesma regra da API). Ocupada: espera e tenta de novo
// a cada ciclo, por até 12 h depois do horário; aí desiste e registra (o gestor reagenda).
const AGENDA_TOLERANCIA_MS = 12 * 3600 * 1000;
async function atualizacaoAgendada() {
  try {
    const ag = await getState('update_agendado_para', '');
    if (!ag) return;
    const hora = Date.parse(ag);
    if (!Number.isFinite(hora)) { await setState('update_agendado_para', ''); return; }
    if (Date.now() < hora) return;
    if (!(await getState('update_disponivel', ''))) { await setState('update_agendado_para', ''); return; }
    if (Date.now() - hora > AGENDA_TOLERANCIA_MS) {
      await setState('update_agendado_para', '');
      console.warn('  ⏰ atualização agendada NÃO instalada: a loja ficou em operação por 12 h depois do horário. Reagende.');
      await reportarTelemetria('update', 'agenda_expirada', `agendada para ${ag}; loja em operação`);
      return;
    }
    // Já há uma instalação rodando (status recente e não terminado)? Não dispara outra.
    try {
      const st = JSON.parse(readFileSync(join(process.cwd(), 'logs', 'update-status.json'), 'utf8').replace(/^\uFEFF/, ''));
      const ts = Date.parse(st.ts ?? '');
      if (st.fase !== 'ok' && st.fase !== 'erro' && Number.isFinite(ts) && Date.now() - ts < 20 * 60 * 1000) return;
    } catch { /* sem status: segue */ }
    const loja = process.env.EDGE_UNIDADE_ID || null;
    const r = await pool.query(
      `select
         (select count(*)::int from caixa_sessao
           where status = 'aberta' and aberta_em > now() - interval '16 hours'
             and ($1::uuid is null or unidade_id = $1::uuid or unidade_id is null)) as caixas,
         (select count(*)::int from producao_pedido
           where status in ('recebido', 'preparo') and created_at > now() - interval '3 hours'
             and ($1::uuid is null or unidade_id = $1::uuid or unidade_id is null)) as pedidos`,
      [loja],
    );
    const { caixas, pedidos } = r.rows[0] ?? {};
    if (caixas || pedidos) return; // ainda operando: tenta no próximo ciclo
    await setState('update_agendado_para', '');
    await pExecFile('schtasks', ['/run', '/tn', 'RegemEdgeUpdate']);
    console.log(`  ⬆️ atualização agendada (${ag}) iniciada — loja sem operação.`);
  } catch (e) {
    console.warn(`  atualizacaoAgendada: ${e?.message ?? e}`);
  }
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
    const d = await getState('relogio_desvio_s', '');
    if (d !== '') saude.relogioDesvioS = Number(d); // + adiantado, − atrasado (segundos)
  } catch { /* */ }
  try {
    saude.restaurando = (await getState('restaurando', '0')) === '1';
    saude.restoreProgresso = Number(await getState('restore_progresso', '0')) || 0;
  } catch { /* */ }
  try {
    const r = await pool.query("select count(*)::int n from equipamento where tipo = 'impressora'");
    saude.impressoraConfigurada = (r.rows?.[0]?.n ?? 0) > 0;
  } catch { /* */ }
  try {
    // Fila de impressão (P4): erros terminais + pendentes acumulados — observabilidade no console.
    const r = await pool.query(
      "select count(*) filter (where status='erro')::int erros, count(*) filter (where status in ('pendente','enviando'))::int pend from impressao_job",
    );
    saude.impressaoErros = r.rows?.[0]?.erros ?? 0;
    saude.impressaoPendentes = r.rows?.[0]?.pend ?? 0;
  } catch { /* */ }
  try {
    // Impressoras que pararam de responder (mig 269) — o console mostra qual, desde quando e por quê.
    const minha = (process.env.EDGE_UNIDADE_ID || '').trim() || null;
    const r = await pool.query(SQL_SEM_RESPONDER, [minha]);
    saude.impressorasSemResponder = r.rows.map((x) => ({
      id: x.id, nome: x.nome, desde: x.desde, erro: x.erro ? String(x.erro).slice(0, 120) : null, falhas: x.falhas,
    }));
    const f = await pool.query(SQL_FILA_POR_IMPRESSORA, [minha]);
    saude.filaPorImpressora = f.rows;
  } catch { /* banco sem a mig 269 */ }
  // ── SAÚDE DO BANCO LOCAL ────────────────────────────────────────────────────
  // Três números que ninguém enxergava e que explicam as duas formas de a loja parar:
  //  • tamanho do banco — cresce para sempre (nada é expurgado) até encher o disco;
  //  • corrupção de página — com checksums ligados o Postgres CONTA a falha em vez de
  //    servir dado podre em silêncio; contador > 0 é incidente, não curiosidade;
  //  • contador de transações — Postgres sem manutenção PARA DE ACEITAR ESCRITA quando
  //    ele se esgota (a loja simplesmente não vende mais). 100% = parada.
  try {
    const r = await pool.query(
      `select pg_database_size(current_database())::bigint as bytes,
              (select coalesce(sum(checksum_failures), 0)::bigint from pg_stat_database) as falhas_checksum,
              (select round(100.0 * max(age(datfrozenxid)) / 2000000000, 1) from pg_database) as pct_transacoes`,
    );
    const x = r.rows?.[0] ?? {};
    saude.bancoMb = Math.round(Number(x.bytes || 0) / 1048576);
    saude.bancoFalhasChecksum = Number(x.falhas_checksum || 0);
    saude.bancoPctTransacoes = x.pct_transacoes == null ? null : Number(x.pct_transacoes);
  } catch { /* sem permissão/versão antiga: segue sem os números */ }
  // ── BACKUP ──────────────────────────────────────────────────────────────────
  // Lido do arquivo que o backup.ps1 grava (não do banco): se o Postgres estiver fora, o
  // backup do dia anterior ainda precisa ser reportado. Sem isto a nuvem não tinha como
  // saber que uma loja passou meses sem backup — foi o que aconteceu.
  try {
    const { readFileSync: lerArq, existsSync: temArq, readdirSync: lerDir, statSync } = await import('node:fs');
    const { join: p, dirname } = await import('node:path');
    const raizBackend = process.cwd();
    const dirBk = p(dirname(raizBackend), 'backups');
    const marcador = p(dirBk, 'ultimo-backup.json');
    if (temArq(marcador)) {
      const m = JSON.parse(lerArq(marcador, 'utf8'));
      saude.backup = {
        ok: !!m.ok,
        em: m.em ?? null,
        horas: m.em ? Math.round((Date.now() - new Date(m.em).getTime()) / 36e5) : null,
        mb: m.bytes ? Math.round(Number(m.bytes) / 1048576) : null,
        erro: m.erro ? String(m.erro).slice(0, 200) : null,
      };
    } else if (temArq(dirBk)) {
      // Instalação anterior ao marcador: usa o arquivo mais novo da pasta.
      const arquivos = lerDir(dirBk).filter((f) => f.startsWith('db-') && f.endsWith('.dump.enc'));
      let maisNovo = null;
      for (const f of arquivos) {
        const st = statSync(p(dirBk, f));
        if (!maisNovo || st.mtimeMs > maisNovo.mtimeMs) maisNovo = { nome: f, mtimeMs: st.mtimeMs, size: st.size };
      }
      saude.backup = maisNovo
        ? { ok: true, em: new Date(maisNovo.mtimeMs).toISOString(), horas: Math.round((Date.now() - maisNovo.mtimeMs) / 36e5), mb: Math.round(maisNovo.size / 1048576), erro: null }
        : { ok: false, em: null, horas: null, mb: null, erro: 'nenhum backup encontrado' };
    } else {
      saude.backup = { ok: false, em: null, horas: null, mb: null, erro: 'pasta de backups inexistente' };
    }
  } catch (e) {
    saude.backup = { ok: false, em: null, horas: null, mb: null, erro: `não consegui ler: ${e.message}` };
  }
  // Dado que só existe aqui (ver --pendencias): a nuvem passa a saber ANTES de alguém
  // mandar reinstalar a loja. Varrer ~90 tabelas é caro, então roda a cada 6h e o
  // resultado fica guardado — o heartbeat manda sempre o último apurado.
  try {
    const ULTIMO = 'pendencias_ultimo_ms';
    const CACHE = 'pendencias_cache';
    const agora = Date.now();
    const quando = Number(await getState(ULTIMO, '0')) || 0;
    if (agora - quando > 6 * 60 * 60 * 1000) {
      const pend = await pendenciasLocais(false); // só "tem dado?", sem contar
      await setState(CACHE, JSON.stringify(pend.map((p) => p.tabela)));
      await setState(ULTIMO, String(agora));
    }
    const cache = await getState(CACHE, '');
    if (cache) saude.pendenciasLocais = JSON.parse(cache);
  } catch { /* best-effort */ }
  return { saude, discoLivreMb: sd.discoLivreMb };
}

async function heartbeat(pullN, pushN, erro, comSaude) {
  try {
    const corpo = {
      versao: process.env.APP_VERSION || '1',
      comSaude: !!comSaude, // a nuvem só anexa comandos/atualização na batida do fim do ciclo
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
    const res = await fetchT(`${CLOUD}/edge/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-token': TOKEN },
      body: JSON.stringify(corpo),
    });
    // A nuvem manda comandos pendentes e aviso de atualização JUNTO (2 requisições a menos
    // por ciclo). Edge contra nuvem antiga não recebe nada e cai nos endpoints de sempre.
    if (res.ok) return await res.json().catch(() => null);
  } catch { /* heartbeat é best-effort */ }
  return null;
}

// Restore por SNAPSHOT (Trilha A) — robusto. Baixa /sync/snapshot (NDJSON gzip, corpo
// OPACO → gunzip explícito) com TODO o transacional da loja (escopado pelo token) e carrega
// numa TRANSAÇÃO com session_replication_role=replica (FK/triggers OFF → sem ordem
// pai/filho, fim do "sem pai (FK)"). Substitui o restore linha-a-linha; se falhar, o
// chamador loga e o gestor re-dispara. Só COMMITA se recebeu o __fim (parcial = rollback).
async function restaurarSnapshot() {
  console.log('Restore (snapshot): baixando o arquivo da nuvem…');
  await setState('restaurar_solicitado', '0');
  await setState('restaurando', '1');
  await setState('restore_erro', ''); // limpa erro anterior — a UI mostra progresso/erro
  await setState('restore_progresso', '0');
  try {
    const res = await fetchT(`${CLOUD}/sync/snapshot`, { headers: { 'x-sync-token': TOKEN } }, SNAPSHOT_TIMEOUT_MS);
    if (!res.ok) throw new Error(`snapshot HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const gunzip = zlib.createGunzip();
    Readable.fromWeb(res.body).pipe(gunzip);
    const client = await pool.connect();
    let total = 0, fimOk = false, tabelaAtual = null, fresco = false;
    try {
      // Base VAZIA antes da carga = instalação -Limpar (banco recriado). Só aí é seguro
      // posicionar TAMBÉM o cursor de PUSH ao fim (não há linha só-local a preservar); num
      // restore pelo botão sobre base com dado, o push best-effort ao fim ainda precisa
      // subir o operacional local pendente. ANTES do `begin`: um erro aqui (tabela ausente)
      // não pode envenenar a transação de carga.
      try {
        const _c = await client.query(
          'select not exists(select 1 from comanda) and not exists(select 1 from pedido_externo) as vazio',
        );
        fresco = _c.rows?.[0]?.vazio === true;
      } catch { fresco = false; }
      await client.query('begin');
      // FK/triggers OFF durante a carga (o postgres local é superuser). O arquivo entra em
      // qualquer ordem — acaba o "sem pai (FK)" e a dependência de ordem pai→filho.
      await client.query('set session_replication_role = replica');
      // Carga em LOTE: acumula linhas por tabela e grava em blocos (upsertLote) — 1 request
      // por bloco no lugar de 1 por linha (row-a-row levava ~10 min; lote leva segundos).
      const LOTE = 500;
      let buf = [];
      const flush = async () => {
        if (!tabelaAtual || !buf.length) return;
        total += await upsertLote(tabelaAtual, buf, client);
        buf = [];
        console.log(`  snapshot: ${total} linha(s)…`);
        try { await setState('restore_progresso', String(total)); } catch { /* best-effort */ }
      };
      const aplicar = async (linha) => {
        if (!linha) return;
        const obj = JSON.parse(linha);
        if (obj.__fim) { fimOk = true; await flush(); return; }
        if (obj.__t) { await flush(); tabelaAtual = obj.__t; return; } // fecha a tabela anterior
        if (tabelaAtual) { buf.push(obj); if (buf.length >= LOTE) await flush(); }
      };
      let buffer = '';
      for await (const chunk of gunzip) {
        buffer += chunk.toString('utf8');
        let nl;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const linha = buffer.slice(0, nl).trim();
          buffer = buffer.slice(nl + 1);
          await aplicar(linha);
        }
      }
      await aplicar(buffer.trim());
      await flush(); // último bloco
      if (!fimOk) throw new Error('snapshot incompleto (sem marcador __fim) — carga descartada');
      await client.query('commit');
      await setState('restaurado_em', new Date().toISOString());
      await setState('restore_progresso', String(total));
      console.log(`Restore (snapshot) CONCLUÍDO — ${total} linha(s) aplicadas.`);
      // SEED dos cursores (fecha a Solução A): o snapshot já trouxe TODO o transacional.
      // Sem posicionar, o -Limpar deixa o cursor em 1970 e o próximo ciclo RE-BAIXA/RE-ENVIA
      // os 60 dias que o snapshot carregou (crawl lento + backlog de push de 20s/ciclo) antes
      // de chegar no pedido de HOJE. Marca-d'água REAL do banco local, no formato keyset da
      // nuvem ("<cursor::text>|<id>"). Roda APÓS o commit (sem transação → um erro numa tabela
      // não envenena nada) e usa o `client` só p/ ler. Falha aqui = segue no crawl normal.
      try {
        let _cur = {};
        try { _cur = JSON.parse(await getState('pull_cursores', '{}')) || {}; } catch { _cur = {}; }
        let _n = 0;
        for (const [tb, col] of SNAPSHOT_TABELAS) {
          let hw;
          try {
            hw = await client.query(
              `select ${q(col)}::text as kc, id::text as id from ${q(tb)}
               where ${q(col)} is not null order by ${q(col)} desc, id desc limit 1`,
            );
          } catch { continue; } // tabela/coluna ausente → deixa baixar pelo piso (seguro)
          if (!hw.rows?.length) continue;
          _cur[tb] = `${hw.rows[0].kc}|${hw.rows[0].id}`;
          _n++;
          if (fresco) await setState(`push_${tb}`, `${hw.rows[0].kc}|${hw.rows[0].id}`);
        }
        await setState('pull_cursores', JSON.stringify(_cur));
        console.log(`Restore: cursores posicionados (${_n} tabela(s), ${fresco ? 'pull+push' : 'só pull'}) — próximo ciclo baixa só o novo.`);
      } catch (e) {
        console.warn(`Restore: não posicionou cursores (segue no crawl normal): ${e.message}`);
      }
    } catch (e) {
      try { await client.query('rollback'); } catch { /* ignore */ }
      throw e;
    } finally {
      try { await client.query('set session_replication_role = origin'); } catch { /* ignore */ }
      client.release();
    }
    // Push do pendente por último — best-effort, NUNCA trava o download.
    try { await push(); } catch (e) { console.warn(`  push pós-snapshot (best-effort): ${e.message}`); }
    return total;
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

// Comando 'imprimir_danfe' (nuvem→edge, mig 269): a NFC-e foi emitida na nuvem para uma venda
// desta loja, mas a impressora está aqui. A nuvem manda o texto pronto; aqui escolhemos a
// impressora com a MESMA regra da nuvem: a que imprimiu o cupom desta venda; senão uma de cupom
// da loja (a padrão primeiro). Não duplica: se a comanda já tem DANFE na fila local, não repete.
async function imprimirDanfeLocal(dados) {
  const conteudo = dados?.conteudo;
  if (!conteudo) return 'sem conteúdo';
  const comandaId = dados?.comandaId ?? null;
  const minha = (process.env.EDGE_UNIDADE_ID || '').trim() || null;
  if (comandaId) {
    const ja = await pool.query(SQL_DANFE_JA_NA_FILA, [comandaId]);
    if (ja.rowCount) return 'DANFE já estava na fila';
  }
  const r = await pool.query(SQL_DANFE_ALVO, [comandaId, minha]);
  const alvo = r.rows[0]?.id;
  if (!alvo) return 'sem impressora de cupom nesta loja';
  await pool.query(SQL_DANFE_INSERIR, [alvo, minha, comandaId, conteudo]);
  return 'DANFE enfileirada';
}

// Comando 'testar_impressora' (nuvem→edge): a impressora vive na LAN (a nuvem não a
// alcança direto), então a nuvem manda um comando e o EDGE imprime um teste em CADA
// impressora configurada localmente. Reusa a fila local (impressao_job) — o worker de
// impressão pega via LISTEN/poll e envia por TCP 9100 / winspool. Só o edge tem a
// config de impressora (equipamento é edge-local). Retorna quantas foram enfileiradas.
// Comando 'imprimir' (nuvem→edge, mig 269): etiqueta de validade, ordem de produção ou via de
// etapa do KDS criada pelo app da NUVEM para esta loja. Antes ia para a fila da nuvem, que
// ninguém lê aqui — reproduzido: a etiqueta ficava 'pendente' para sempre.
async function imprimirDaNuvem(d) {
  if (!d?.equipamentoId || !d?.conteudo) return 'sem impressora ou sem conteúdo';
  const minha = (process.env.EDGE_UNIDADE_ID || '').trim() || null;
  const r = await pool.query(SQL_JOB_DO_COMANDO, [
    d.equipamentoId, minha, d.pedidoId ?? null, d.comandaId ?? null, String(d.via || 'producao'), String(d.conteudo),
  ]);
  return r.rowCount ? 'enfileirado' : 'já estava na fila (ou impressora inexistente neste servidor)';
}

async function enfileirarTesteLocal(soEsta = null) {
  // Só as impressoras DESTA loja (e as sem loja). As de todas as lojas descem para cá (config
  // da rede): testar as da outra loja mandava papel para um IP que aqui é outro aparelho — e o
  // job ficava pendente para sempre, inflando `impressaoPendentes` na saúde do servidor.
  const minha = (process.env.EDGE_UNIDADE_ID || '').trim() || null;
  const { rows } = await pool.query(
    `select id, tenant_id, unidade_id, nome, host, porta, largura from equipamento
      where tipo='impressora' and ativo is not false
        and ($1::uuid is null or unidade_id is null or unidade_id = $1::uuid)
        and ($2::uuid is null or id = $2::uuid)`, // só a impressora clicada no painel, se veio
    [minha, soEsta],
  );
  for (const p of rows) {
    const linha = '-'.repeat(Number(p.largura) === 58 ? 32 : 48);
    const conteudo = [
      '*** TESTE REGEM (via nuvem) ***',
      linha,
      `Impressora: ${p.nome ?? '(sem nome)'}`,
      `Destino: ${p.host ? `${p.host}:${p.porta ?? 9100}` : '(impressora do Windows)'}`,
      new Date().toLocaleString('pt-BR'),
      linha,
      'Se leu isto, a impressora esta OK.',
    ].join('\n');
    await pool.query(
      `insert into impressao_job (tenant_id, unidade_id, equipamento_id, via, conteudo)
       values ($1, $2, $3, 'teste', $4)`,
      [p.tenant_id, p.unidade_id ?? null, p.id, conteudo],
    );
  }
  return rows.length;
}

// Comandos remotos (Fase 4): a distribuição enfileira (ex.: rollback); o edge busca
// e executa localmente. Best-effort; confirma o resultado na nuvem.
async function verificarComandos(jaRecebidos) {
  try {
    let cmds = jaRecebidos;
    if (!cmds) {
      const res = await fetchT(`${CLOUD}/edge/comandos`, { headers: { 'x-sync-token': TOKEN } });
      if (!res.ok) return;
      cmds = await res.json();
    }
    if (!Array.isArray(cmds) || !cmds.length) return;
    for (const c of cmds) {
      let ok = true, resultado = '';
      try {
        if (c.comando === 'rollback') {
          await pExecFile('schtasks', ['/run', '/tn', 'RegemEdgeRollback']);
          resultado = 'rollback disparado';
        } else if (c.comando === 'testar_impressora') {
          const n = await enfileirarTesteLocal(c.dados?.equipamentoId ?? null);
          resultado = `teste enfileirado em ${n} impressora(s)`;
        } else if (c.comando === 'imprimir_danfe') {
          resultado = await imprimirDanfeLocal(c.dados);
        } else if (c.comando === 'imprimir') {
          resultado = await imprimirDaNuvem(c.dados);
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
let cicloAnteriorMs = 0;
let falhasSeguidas = 0;
async function ciclo() {
  if (cicloRodando) {
    console.warn(`ciclo anterior ainda em execução — pulando este tick`);
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
    // Batida ANTECIPADA só quando ela importa: restauração pedida ou ciclo anterior longo
    // (a nuvem precisa saber que a loja está viva antes de uma operação demorada). Fora
    // disso é uma requisição por minuto por loja sem função — em 5.000 lojas, 83 por segundo.
    const precisaPingCedo =
      cicloAnteriorMs > 30000 || (await getState('restaurar_solicitado', '0')) === '1';
    if (precisaPingCedo) await heartbeat(0, 0, null);
    const inicioCiclo = Date.now();
    // Antes de qualquer troca: tira do banco o que é de OUTRA loja (uma vez por instalação).
    // Rodando depois do push, a loja chegaria a empurrar linhas que vai apagar na sequência.
    try { await limparEscopoDeOutrasLojas(); } catch (e) { console.warn(`limpeza de escopo: ${e.message}`); }
    try {
      p = await pull();
      u = await push();
      falhasSeguidas = 0;
      console.log(`sync ok — pull ${p} linha(s), push ${u} linha(s)`);
    } catch (e) {
      erro = e.message;
      falhasSeguidas++;
      console.error(`sync FALHOU: ${causaErro(e)}`);
      await reportarTelemetria('sync', 'sync_erro', causaErro(e));
    }
    // Restauração sob demanda (botão do app grava a flag em sync_state).
    if ((await getState('restaurar_solicitado', '0')) === '1') {
      await heartbeat(p, u, erro); // ping ANTES do restore longo (mantém a nuvem deferindo)
      // RESTORE = SNAPSHOT (arquivo). A paginação linha-a-linha foi APOSENTADA (frágil a
      // 502-por-lote/FK/cursor, "não carregava local" — decisão do gestor 01/09). Baixa UM
      // arquivo da nuvem e carrega numa transação com FK desligada. Sem fallback pro
      // page-by-page: se falhar, loga/telemetra e o gestor re-dispara (a flag já foi consumida).
      try {
        await restaurarSnapshot();
      } catch (e) {
        const causa = causaErro(e);
        console.error(`Restore (snapshot) FALHOU: ${causa}`);
        try { await setState('restore_erro', String(causa).slice(0, 500)); } catch { /* best-effort */ }
        await reportarTelemetria('sync', 'snapshot_erro', causa);
      }
    }
    await licenca();
    // Batida RICA do fim do ciclo: traz de carona os comandos pendentes e o aviso de
    // atualização, então as duas consultas separadas só acontecem se a nuvem não mandar nada.
    const resposta = await heartbeat(p, u, erro, true);
    await verificarComandos(resposta?.comandos);
    if (resposta?.atualizacao) await updateCheck(resposta.atualizacao);
    else {
      // Nuvem antiga (sem carona): mantém as janelas de abertura e o check periódico.
      await updateCheckSeJanela();
      await updateCheckPeriodico();
    }
    await atualizacaoAgendada();
    cicloAnteriorMs = Date.now() - inicioCiclo;
  } catch (e) {
    // BLINDAGEM: NENHUM erro de ciclo pode derrubar o daemon. O try interno cobre só
    // pull/push; um throw de licenca/verificarComandos/updateCheck/heartbeat (aqui fora)
    // subia até o `await ciclo()` do boot e CRASHAVA o processo → NSSM reiniciava em loop
    // e nunca chegava a "sync ok". Agora loga + telemetria e segue no próximo tick.
    console.error(`ciclo ERRO (blindado): ${causaErro(e)}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// PENDÊNCIAS: o que existe SÓ aqui e não tem como voltar da nuvem.
//
// O --descarregar sobe as tabelas de PUSH_TABLES. Ele sai 0 mesmo quando o banco
// guarda dado de uma tabela que NINGUÉM sincroniza (NFC-e, tarefa, checklist,
// vistoria, escala…) — e o instalador apaga o banco confiando nesse 0. Isto aqui
// fecha esse buraco: antes de liberar o apagamento, varre o banco e exige que toda
// tabela com dado da loja esteja em uma destas três situações:
//   • sobe (está em PUSH_TABLES — o --descarregar acabou de enviar);
//   • volta da nuvem (catálogo/controle que o pull rebaixa, listado abaixo);
//   • é descartável (fila de trabalho da máquina, recalculável).
// Qualquer outra com pelo menos uma linha BLOQUEIA o apagamento. A regra é ao
// contrário de uma lista de proibidas de propósito: tabela nova que ninguém
// classificou trava o wipe em vez de ser apagada em silêncio.
// ─────────────────────────────────────────────────────────────────────────────

// Volta da nuvem no pull (direção 'desce' no sync-config): apagar é seguro.
const VOLTA_DA_NUVEM = new Set([
  'empresa', 'unidade', 'setor', 'funcao', 'perfil_acesso', 'colaborador', 'turno',
  'etiqueta', 'kds_alerta_config', 'ficha_tecnica', 'ficha_ingrediente', 'produto_variacao',
  'produto_combo_item', 'bot_regra', 'feriado', 'tipo_ocorrencia',
  // Paridade (mig 272): vínculos de cadastro, módulos, cupom e encomenda também são
  // master na nuvem. Tem de bater com a direção declarada no sync-config — o teste
  // pendencias-wipe.spec.ts falha se as duas listas se separarem.
  'funcao_setor', 'colaborador_funcao', 'modulo_ativacao', 'cupom',
  'encomenda_regra_sinal', 'encomenda_recorrencia', 'banner',
  // Fiscal (mig 278): a configuração do emitente é master na nuvem e DESCE — sem ela a
  // loja não tem CNPJ, endereço nem CSC para montar o cupom. A NFC-e passou a voltar
  // também: é guarda obrigatória de 5 anos do emitente, e é dela que a numeração se
  // recupera num banco novo (sem as notas de volta, o contador reiniciaria em 1 e
  // repetiria chave de acesso).
  'fiscal_config', 'nota_fiscal',
  // A inutilização também volta: sem ela, um banco novo não saberia que aquela faixa já foi
  // regularizada e a tela pediria o pedido de novo (a SEFAZ devolveria 563).
  'fiscal_inutilizacao', 'fiscal_evento',
]);

// DONA É A NUVEM (regra de distribuição): licença, telemetria, campanhas, credenciais de
// integração e o app do entregador. A cópia local, quando existe, é criada só para as
// consultas não quebrarem — o dado verdadeiro está na nuvem, então apagar não perde nada.
const SO_NUVEM = new Set([
  'ativacao', 'revenda', 'reautorizacao_edge', 'cadastro_pendente', 'edge_heartbeat', 'suporte_sessao',
  'telemetria_evento', 'api_client', 'webhook_subscription', 'integracao', 'integracao_token',
  'campanha', 'campanha_envio', 'marketing_optout', 'whatsapp_numero', 'whatsapp_template', 'whatsapp_mensagem',
  'cliente_otp', 'cliente_link', 'cardapio_evento', 'cardapio_senha_seq', 'pedido_notificacao', 'bot_atendimento',
  'entregador_dispositivo', 'entregador_chegada', 'entregador_localizacao', 'entregador_posicao', 'entregador_fila',
  'entregador_config', 'entregador_saida', 'entregador_fechamento', 'entregador_perfil_pagamento', 'entregador_preferencia',
  'edge_comando', 'edge_release', 'no_local',
  // Fechamento mensal do ponto: a nuvem tem o histórico inteiro, o servidor local só a
  // janela de espelho (~60 dias) — fechar o mês aqui daria um mês incompleto. O cron e a
  // rota que o geram passaram a ser só-nuvem; a cópia local, se existir de uma versão
  // antiga, é justamente a errada e não faz falta.
  'ponto_fechamento',
  // Certificado A1 e CSC (mig 279). A cópia-MESTRA fica na nuvem, cifrada com a chave dela.
  // NUNCA sincroniza: cada lado cifra com a SUA `SEGREDOS_CHAVE`, então o valor de um banco
  // não abre no outro. Hoje a loja NÃO tem cópia (as rotas de cadastro são só-nuvem); a
  // entrega à loja, cifrada com a chave DELA, é a etapa seguinte do P2. Apagar a cópia local
  // numa reinstalação não perde nada — a mestra está na nuvem.
  'fiscal_credencial',
]);

// LEGADO SEM USO: tabelas criadas nas migrations de fundação (002/003) para recursos que
// nunca foram construídos — não estão no `schema.ts`, nenhum serviço as lê ou escreve e
// elas nunca recebem linha. Ficavam FORA de toda lista e, por desenho, uma tabela não
// classificada BLOQUEIA a reinstalação: bastaria uma linha aparecer ali para travar a
// loja sem ninguém entender por quê. Classificadas para tirar a trava do acaso. Candidatas
// a serem removidas por migration quando alguém confirmar que não há dado nelas em nuvem
// nenhuma.
const LEGADO_SEM_USO = new Set([
  'ausencia', 'colaborador_unidade', 'equipe', 'equipe_membro',
]);

// Descartável: fila/estado de trabalho desta máquina ou dado recalculável. Apagar
// não perde informação de negócio — e sincronizar de volta causaria efeito colateral
// (a fila de impressão voltaria a imprimir pedido velho).
const DESCARTAVEL = new Set([
  // Fila de impressão desta máquina (com reserva por lease): descer de volta faria a
  // impressora cuspir pedido antigo, e quebraria a guarda anti-reimpressão do edge.
  'impressao_job', 'impressao_edge_feito',
  // Infraestrutura do próprio sincronismo e estado da máquina (mig 264 e 269).
  'sync_exclusao', 'sync_fila', 'sync_dead_letter', 'sync_marcador', 'edge_status', 'impressora_status',
  // Fotografia diária do estoque: é SOMA de `movimento_estoque` + custo do insumo, e as
  // duas sincronizam. Recalculável pela rotina diária (o custo histórico pode divergir —
  // decisão registrada em docs/paridade-sync-tabelas.md §4).
  'estoque_snapshot',
  // Contador da senha do balcão: gerador de sequência com trava, por máquina. Sincronizar
  // faria o número andar para trás e a loja emitir senha repetida; reinicia todo dia.
  'senha_contador',
  // Saldo de cashback e pontos de fidelidade: CACHE recalculado do extrato por gatilho
  // (mig 274). O extrato (`cashback_movimento`, `fidelidade_ponto`, `fidelidade_resgate`)
  // é que sincroniza — número sincronizado por última-escrita apagaria crédito.
  'cashback_saldo', 'fidelidade_cliente',
  // Contador da numeração fiscal DESTE ponto de emissão (mig 278). Cada lado é dono do
  // seu: a loja emite na série dela, a nuvem na dela, e sincronizar o número por
  // última-escrita faria a sequência andar para trás e repetir chave de acesso. Num banco
  // novo ele se refaz sozinho a partir do maior número já emitido na série — por isso
  // `nota_fiscal` precisa VOLTAR (lista acima).
  'fiscal_serie',
  // Estado da contingência off-line DESTE ponto de emissão (mig 286): "estou sem SEFAZ agora".
  // Quem está sem internet é a máquina; sincronizar por última-escrita faria a nuvem, que está
  // bem, desligar a contingência da loja que continua fora do ar. As notas emitidas nela estão
  // em `nota_fiscal`, que sobe e volta — apagar este estado não perde nada.
  'fiscal_contingencia',
]);

// Tabelas com dado da loja que NÃO sobem nem voltam. Devolve [{ tabela, linhas }].
// `contar=false` troca o count(*) por "existe alguma linha?" — é o modo usado no sinal de
// saúde, que roda o tempo todo; o count completo fica para a hora de decidir apagar.
async function pendenciasLocais(contar = true) {
  const sobe = new Set(PUSH_TABLES.map((t) => t.tabela));
  const r = await pool.query(
    `select table_name from information_schema.columns
      where table_schema = current_schema() and column_name = 'tenant_id'
      order by table_name`,
  );
  const pendentes = [];
  for (const row of r.rows) {
    const t = row.table_name;
    if (!/^[a-z_][a-z0-9_]*$/.test(t)) continue; // nome fora do padrão: não interpolar
    if (
      sobe.has(t) || VOLTA_DA_NUVEM.has(t) || SO_NUVEM.has(t) ||
      DESCARTAVEL.has(t) || LEGADO_SEM_USO.has(t)
    ) continue;
    try {
      const c = contar
        ? await pool.query(`select count(*)::int as n from "${t}"`)
        : await pool.query(`select 1 as n from "${t}" limit 1`);
      const n = contar ? (c.rows[0]?.n ?? 0) : c.rowCount;
      if (n > 0) pendentes.push({ tabela: t, linhas: contar ? n : -2 }); // -2 = "tem dado", sem contar
    } catch (e) {
      // Não conseguir contar é motivo para BLOQUEAR, não para liberar.
      pendentes.push({ tabela: t, linhas: -1, erro: e.message });
    }
  }
  return pendentes;
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

// --descarregar (usado pelo INSTALADOR antes de apagar o banco local numa reinstalação
// limpa): sobe para a nuvem TUDO o que ainda não subiu e sai. Código de saída 0 = tudo na
// nuvem; 1 = falha de rede/nuvem; 2 = alguma linha foi recusada (dead-letter). Qualquer
// coisa diferente de 0 → o instalador NÃO apaga o banco.
//
// Por quê: o .exe reinstala limpo e os dados voltam da nuvem — premissa que só vale se tudo
// que nasceu na loja já subiu. Tabelas que entraram na lista de push depois da versão
// instalada (documentos de estoque, etiquetas…) nunca subiram; apagar o banco as perderia.
if (process.argv.includes('--descarregar')) {
  let codigo = 0;
  try {
    await ensureState();
    const n = await push(Number.POSITIVE_INFINITY);
    if (deadLetters) {
      console.error(`descarregar: ${n} linha(s) enviadas, mas ${deadLetters} recusada(s) pela nuvem — NÃO apagar o banco.`);
      codigo = 2;
    } else {
      // Enviar tudo o que SOBE não basta: pode haver dado de uma tabela que ninguém
      // sincroniza. Aí o banco só existe aqui, e apagá-lo é perda definitiva.
      const pend = await pendenciasLocais();
      if (pend.length) {
        console.error(
          `descarregar: ${n} linha(s) enviadas, mas ESTE SERVIDOR guarda dado que não vai para a nuvem — NÃO apagar o banco:`,
        );
        for (const p of pend) {
          console.error(`  • ${p.tabela}: ${p.linhas < 0 ? `não consegui contar (${p.erro})` : `${p.linhas} registro(s)`}`);
        }
        codigo = 3;
      } else {
        console.log(`descarregar: ${n} linha(s) enviadas — tudo o que é local está na nuvem.`);
      }
    }
  } catch (e) {
    console.error(`descarregar FALHOU: ${causaErro(e)}`);
    codigo = 1;
  }
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(codigo);
}

// --pendencias: só relata (não envia nada). Usado no diagnóstico e pelo instalador
// quando não há como rodar o --descarregar (ex.: configuração antiga ilegível).
// 0 = nada preso aqui; 3 = há dado que não vai para a nuvem; 1 = não consegui verificar.
if (process.argv.includes('--pendencias')) {
  let codigo = 0;
  try {
    const pend = await pendenciasLocais();
    if (pend.length) {
      console.error('Dado que existe SÓ neste servidor (não sobe e não volta da nuvem):');
      for (const p of pend) {
        console.error(`  • ${p.tabela}: ${p.linhas < 0 ? `não consegui contar (${p.erro})` : `${p.linhas} registro(s)`}`);
      }
      codigo = 3;
    } else {
      console.log('Nada preso: tudo o que é local sobe para a nuvem ou volta dela.');
    }
  } catch (e) {
    console.error(`pendencias FALHOU: ${causaErro(e)}`);
    codigo = 1;
  }
  try { await pool.end(); } catch { /* ignore */ }
  process.exit(codigo);
}

// ensureState e o 1º ciclo NÃO podem crashar o boot (ex.: PG recuperando = 57P03).
// Se falharem, loga e segue — o setInterval reexecuta o ciclo quando o PG estabilizar.
// AGENDAMENTO com ESPALHAMENTO e RECUO, no lugar do setInterval fixo:
//  • espalhamento (±20%): sem ele, todas as lojas batem no mesmo instante do minuto e, depois
//    de uma queda da nuvem, voltam todas juntas — o primeiro minuto concentra tudo (é o
//    "thundering herd" que os SDKs de Firestore e Couchbase evitam com recuo aleatório);
//  • recuo progressivo enquanto a nuvem não responde (até 5 min), em vez de insistir a cada
//    minuto com 3 tentativas cada — a loja offline parava de ajudar e só gerava carga.
// Loja saudável mantém o ciclo de sempre: o pedido de delivery desce pelo pull.
const INTERVALO_MAX_MS = Number(process.env.SYNC_INTERVAL_MAX_MS || 300000);
function proximoIntervalo() {
  const base = falhasSeguidas > 0
    ? Math.min(INTERVAL * Math.pow(2, Math.min(falhasSeguidas, 5)), INTERVALO_MAX_MS)
    : INTERVAL;
  return Math.round(base * (0.8 + Math.random() * 0.4));
}
async function agendar() {
  try { await ciclo(); } catch (e) { console.error(`ciclo falhou (segue): ${e?.message ?? e}`); }
  setTimeout(agendar, proximoIntervalo());
}

try { await ensureState(); } catch (e) { console.error(`ensureState falhou no boot (segue): ${e?.message ?? e}`); }
// Primeiro ciclo com atraso aleatório curto: 5.000 lojas voltando juntas depois de uma queda
// não podem bater no mesmo segundo.
setTimeout(agendar, Math.round(Math.random() * Math.min(INTERVAL, 15000)));
