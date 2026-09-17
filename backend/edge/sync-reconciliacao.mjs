// RECONCILIAÇÃO do sync depois de uma atualização do servidor local (edge).
//
// O PROBLEMA (visto na passagem da 1.29.0 para a versão seguinte)
// Enquanto o edge roda um código mais velho que a nuvem, o pull continua descendo as
// tabelas e colunas NOVAS da nuvem — e o edge, que ainda não as tem, aplica a linha SEM
// elas (ou descarta a linha inteira, se a tabela nem existe) e AVANÇA o cursor. Quando a
// atualização chega e cria as colunas, aquelas linhas já passaram: nunca mais descem.
// Pior: migrations que criam `updated_at default now()` carimbam TODAS as linhas locais
// com a hora da atualização, então a cópia local fica "mais nova" que a da nuvem:
//   • no pull, a regra da mais nova nunca deixa a nuvem corrigir o edge;
//   • no push, a tabela que acabou de entrar na lista sobe do zero e SOBRESCREVE a nuvem
//     — com vazio nas colunas que o edge nunca recebeu (conferência da compra, validade,
//     vencimento, hora da contagem…).
//
// A SOLUÇÃO (uma fila por tabela, persistida em sync_state)
//  1. PULL: a tabela é rebaixada desde o começo UMA vez; em cada linha, depois do upsert
//     normal, as colunas que o edge não tinha são copiadas da nuvem — só nas linhas que
//     não foram editadas aqui depois da atualização (`updated_at <= desde`). Se o
//     `updated_at` é uma dessas colunas, ele volta ao valor real da nuvem.
//  2. PUSH, enquanto o pull da tabela não termina:
//     • se o `updated_at` local é artificial (está entre as colunas novas) → a tabela
//       espera: subir agora sobrescreveria a nuvem com a cópia velha;
//     • senão → sobe normalmente, MAS sem as colunas novas (a nuvem mantém as dela).
//  3. Ao terminar o pull da tabela, o cursor de push volta para `desde`: o que mudou aqui
//     depois da atualização sobe de novo, agora completo.
//
// PARA O FUTURO: o pull registra tabela/coluna que a nuvem mandou e o edge não tem, e não
// avança o cursor de tabela ausente. Quando a atualização cria a tabela/coluna, ela entra
// sozinha na fila. A lista fixa abaixo só existe porque a 1.29.0 não registrava nada.

// Página do pull da nuvem (sync.service `PAGINA`). Página menor = a tabela chegou ao fim.
export const PAGINA_PULL = 1000;

// O que a nuvem tem e a 1.29.0 não recebia (migrations 224–262, só tabelas sincronizadas).
// `null` = tabela inteira nova. Levantado cruzando as migrations com a whitelist do sync.
// `movimento_estoque.unidade_id` (253) fica de fora de propósito: a mig 254 preenche a loja
// do histórico no próprio edge, pela mesma função da nuvem.
export const COLUNAS_POS_1_29 = {
  empresa: ['suporte_acesso_total', 'snapshot_hora'],
  cardapio_config: ['encomenda_corte_inicio', 'wa_retencao_dias', 'wa_msg_limit', 'wa_msg_limit_em'],
  ficha_ingrediente: ['updated_at', 'deleted_at'],
  produto_variacao: ['updated_at', 'deleted_at'],
  produto_combo_item: ['created_at', 'updated_at', 'deleted_at'],
  pedido_externo: [
    'valor_bruto', 'desconto_loja', 'desconto_marketplace', 'descontos', 'pagamentos',
    'taxa_entrega_dono', 'valor_pago_cliente', 'taxas_extras', 'taxas_extras_detalhe',
  ],
  recebimento_item: ['updated_at'],
  lote: ['codigo', 'fornecedor_id', 'unidade_id', 'compra_item_id', 'validade_indefinida'],
  desperdicio: ['equipamento_id', 'registrado_por_id'],
  etiqueta_validade: ['lote_id'],
  contagem_lista_item: ['created_at', 'updated_at'],
  contagem_execucao: ['updated_at'],
  contagem_item: ['updated_at', 'contado_em'],
  compra_lista: ['vencimento'],
  compra_item: ['created_at', 'updated_at', 'qtd_recebida', 'validade', 'validade_indefinida', 'lote_codigo', 'divergencia'],
  titulo_financeiro: ['updated_at'],
  movimento_lote: null,
  item_estoque_unidade: null,
  produto_pausa_estoque: null, // mig 260 — entrou antes do mesmo corte de release
  sync_exclusao: null, // mig 262 — idem
};

const MARCA_1_29 = 'reconciliacao_pos_1_29_v1';
const CHAVE_FILA = 'reconciliacao';
const CHAVE_AUSENTES = 'sync_colunas_ausentes';
const ZERO = '00000000-0000-0000-0000-000000000000';
const q = (id) => '"' + String(id).replace(/"/g, '') + '"';
const coerce = (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v);

// deps: { query(sql, params), getState(k, d), setState(k, v), colunas(tabela) → Set }
export function criarReconciliacao({ query, getState, setState, colunas, log = console.log }) {
  const lerJson = async (k) => {
    try { return JSON.parse(await getState(k, '{}')) || {}; } catch { return {}; }
  };
  const fila = () => lerJson(CHAVE_FILA);
  const salvarFila = (f) => setState(CHAVE_FILA, JSON.stringify(f));

  async function enfileirar(tabela, cols, desde) {
    const f = await fila();
    const atual = f[tabela];
    if (atual && !atual.pullOk) {
      // Já na fila: junta as colunas (null = tabela inteira vence qualquer lista).
      atual.cols = atual.cols === null || cols === null ? null : [...new Set([...atual.cols, ...cols])];
    } else {
      f[tabela] = { cols, desde, rebobinado: false, pullOk: false };
    }
    await salvarFila(f);
  }

  // Transição da 1.29.0: semeia a fila UMA vez, só em instalação que já sincronizava (num
  // banco novo não há o que reconciliar — tudo desce completo desde o começo).
  async function semear() {
    if ((await getState(MARCA_1_29, '')) === 'feito') return false;
    const cursores = await lerJson('pull_cursores');
    const jaSincronizava = Object.keys(cursores).length > 0;
    if (jaSincronizava) {
      const desde = new Date().toISOString();
      for (const [t, cols] of Object.entries(COLUNAS_POS_1_29)) await enfileirar(t, cols, desde);
      log(`Sync: reconciliação pós-atualização enfileirada (${Object.keys(COLUNAS_POS_1_29).length} tabela(s)).`);
    }
    await setState(MARCA_1_29, 'feito');
    return jaSincronizava;
  }

  // Registra o que a nuvem mandou e o edge não tem. `tabela → null` (tabela ausente) ou
  // `tabela → [colunas]`.
  async function registrarAusentes(mapa) {
    const tabelas = Object.keys(mapa);
    if (!tabelas.length) return;
    const aus = await lerJson(CHAVE_AUSENTES);
    let novo = false;
    for (const t of tabelas) {
      if (mapa[t] === null) {
        if (aus[t] !== null) { aus[t] = null; novo = true; }
        continue;
      }
      if (aus[t] === null) continue;
      const antes = new Set(aus[t] ?? []);
      for (const c of mapa[t]) if (!antes.has(c)) { antes.add(c); novo = true; }
      aus[t] = [...antes];
    }
    if (novo) {
      await setState(CHAVE_AUSENTES, JSON.stringify(aus));
      log(`Sync: a nuvem mandou o que este servidor ainda não tem — ${tabelas.map((t) => (mapa[t] === null ? `${t} (tabela)` : `${t}: ${mapa[t].join(', ')}`)).join(' | ')}. Será reconciliado quando a atualização chegar.`);
    }
  }

  // O que foi registrado como ausente e agora existe (a atualização chegou) → fila.
  async function promoverAusentes() {
    const aus = await lerJson(CHAVE_AUSENTES);
    const tabelas = Object.keys(aus);
    if (!tabelas.length) return;
    const desde = new Date().toISOString();
    let mudou = false;
    for (const t of tabelas) {
      const locais = await colunas(t);
      if (!locais.size) continue; // tabela ainda não existe
      if (aus[t] === null) {
        await enfileirar(t, null, desde);
        delete aus[t];
        mudou = true;
        continue;
      }
      const chegaram = aus[t].filter((c) => locais.has(c));
      if (!chegaram.length) continue;
      await enfileirar(t, chegaram, desde);
      const faltam = aus[t].filter((c) => !locais.has(c)); // coluna só da nuvem: fica registrada
      if (faltam.length) aus[t] = faltam; else delete aus[t];
      mudou = true;
    }
    if (mudou) {
      await setState(CHAVE_AUSENTES, JSON.stringify(aus));
      log('Sync: colunas que chegaram com a atualização entraram na reconciliação.');
    }
  }

  // Antes do pull: rebobina (desde o começo) a tabela enfileirada que ainda não foi.
  async function prepararCursores(cursores) {
    const f = await fila();
    for (const [t, e] of Object.entries(f)) {
      if (!e.pullOk && !e.rebobinado) cursores[t] = `1970-01-01T00:00:00.000Z|`;
    }
    return cursores;
  }

  // Aplica, depois do upsert normal, as colunas que o edge não tinha. `entradas` = fila
  // lida uma vez por pull.
  async function aplicarLinha(entradas, tabela, row, exec = { query }) {
    const e = entradas[tabela];
    if (!e || e.pullOk || !e.cols || !row?.id) return false;
    const locais = await colunas(tabela);
    const cols = e.cols.filter((c) => locais.has(c) && Object.prototype.hasOwnProperty.call(row, c));
    if (!cols.length) return false;
    const vals = cols.map((c) => coerce(row[c]));
    const guarda = locais.has('updated_at') ? ` and ${q('updated_at')} <= $${cols.length + 2}::timestamptz` : '';
    const params = locais.has('updated_at') ? [...vals, row.id, e.desde] : [...vals, row.id];
    await exec.query(
      `update ${q(tabela)} set ${cols.map((c, i) => `${q(c)} = $${i + 1}`).join(', ')}
        where ${q('id')} = $${cols.length + 1}${guarda}`,
      params,
    );
    return true;
  }

  // Depois de um pull BEM-SUCEDIDO: marca o rebobinamento e fecha a tabela que chegou ao
  // fim. Ao fechar, o push volta para `desde` (reenvia completo o que mudou aqui depois).
  async function concluirPull(tabelasRecebidas) {
    const f = await fila();
    let mudou = false;
    for (const [t, e] of Object.entries(f)) {
      if (e.pullOk) continue;
      if (!e.rebobinado) { e.rebobinado = true; mudou = true; }
      const rows = tabelasRecebidas?.[t];
      if (!rows || rows.length < PAGINA_PULL) {
        const cur = await getState(`push_${t}`, '');
        const tsCur = cur ? String(cur).split('|')[0] : '';
        // Comparação no Postgres: o cursor é o texto do timestamptz (microssegundo, com fuso).
        if (tsCur) {
          const r = await query(`select $1::timestamptz > $2::timestamptz as depois`, [tsCur, e.desde]);
          if ((r.rows ?? r)[0]?.depois) await setState(`push_${t}`, `${e.desde}|${ZERO}`);
        }
        delete f[t];
        mudou = true;
        log(`Sync: reconciliação de ${t} concluída.`);
      }
    }
    if (mudou) await salvarFila(f);
  }

  // Modo do push de uma tabela: 'normal', 'esperar' (não sobe agora) ou a lista de colunas
  // a TIRAR das linhas antes de subir.
  async function modoPush(tabela, entradas = null) {
    const f = entradas ?? (await fila());
    const e = f[tabela];
    if (!e || e.pullOk || !e.cols) return 'normal';
    if (e.cols.includes('updated_at')) return 'esperar';
    return e.cols;
  }

  return { semear, registrarAusentes, promoverAusentes, prepararCursores, aplicarLinha, concluirPull, modoPush, fila };
}
