'use strict';

// O CHAT DA 99 (Etapa 4a — a leitura). Mapeado em 05/11/2026 na 99 de verdade com o USUÁRIO EXTRA da loja (ele tem sessão
// própria: não derruba a 99 do PC da loja). O portal (`merchant.99app.com`) conversa pelo IM da DiDi:
//   • `POST lion.didiglobal.com/im/polling/` (op_type 1) — a página pergunta de tempos em tempos e a resposta traz as
//     mensagens novas em `body.single.msgs[]`: { mid, uniq_msg_id, msg_type, session_type, sid, uid, time, nick, body };
//     `body.backfill_uid` = o usuário da LOJA (quem está logado). Texto = msg_type 65536 (`body.cont`); imagem = 196608
//     (`body.cont` = o endereço, `fid`, `width`, `height`); aviso de sistema = session_type 8; conversa = session_type 1.
//   • `POST lion.didiglobal.com/im/broker/` op_type 12 (a página abre uma conversa) — a resposta traz `infos[].sid` e
//     `extend.payload` (texto JSON) com `orderId` (o id do pedido na 99 = `external_id` no Regem) e `orderNum` ("#900002").
//   • O pedido: o `uid` de quem manda (o cliente) é o `receive_address.uid` do pedido que o Regem já recebe da 99 — a NUVEM
//     liga pelo cliente (`pedido.cliente99`) sem a ponte abrir conversa nenhuma; quando a conversa já foi aberta aqui (a
//     sessão ↔ pedido do broker), vai também o id do pedido (`pedido.externo`), como no iFood.
// Os ids (sid, uid, mid) passam de 2^53: o JSON é lido com os números grandes como TEXTO (senão arredonda — visto em 05/11 no sid
// de uma conversa de verdade).
// Só LÊ: não clica, não escreve. A escuta da rede é pelo depurador do Chromium, como a do iFood (`leitor.js`).

const { Vistos } = require('./sendbird');

const TEXTO = 65536;
const IMAGEM = 196608;
const CONVERSA = 1;
const TEXTO_DA_IMAGEM = '📷 (o cliente mandou uma imagem — veja no portal da 99)';

// O JSON.parse deste Chromium/Node entrega o texto de origem de cada número ao `reviver` (Node 21+, Chromium 114+)?
const TEM_ORIGEM = (() => {
  let ok = false;
  try {
    JSON.parse('[1]', (_k, v, ctx) => {
      if (ctx && typeof ctx.source === 'string') ok = true;
      return v;
    });
  } catch {
    /* sem */
  }
  return ok;
})();

/**
 * JSON.parse que guarda os inteiros acima de 2^53 como TEXTO, exatamente como vieram (o JavaScript arredonda). Usa o texto
 * de origem que o `reviver` recebe; sem ele (motor antigo), troca os números longos por texto antes de ler.
 */
function jsonSemArredondar(txt) {
  const s = String(txt);
  if (TEM_ORIGEM) return JSON.parse(s, (_k, v, ctx) => (typeof v === 'number' && !Number.isSafeInteger(v) && ctx && typeof ctx.source === 'string' && /^-?\d+$/.test(ctx.source) ? ctx.source : v));
  return JSON.parse(s.replace(/([:[,]\s*)(-?\d{16,})(?=\s*[,}\]])/g, '$1"$2"'));
}

const comoTexto = (v) => (v === undefined || v === null ? '' : String(v));

/**
 * As mensagens de CONVERSA de uma resposta do polling, no formato da ponte. Aviso de sistema, tipo desconhecido e mensagem
 * sem id ficam de fora. `loja` = o `backfill_uid` (quem está logado); `ok` = a 99 respondeu sem erro (errno 0).
 */
function mensagensDoPolling(txt) {
  let j;
  try {
    j = jsonSemArredondar(txt);
  } catch {
    return { ok: false, loja: null, msgs: [] };
  }
  const corpo = j && j.body && typeof j.body === 'object' ? j.body : {};
  const loja = comoTexto(corpo.backfill_uid) || null;
  const lista = corpo.single && Array.isArray(corpo.single.msgs) ? corpo.single.msgs : [];
  const msgs = [];
  for (const m of lista) {
    if (!m || typeof m !== 'object' || Number(m.session_type) !== CONVERSA) continue;
    const id = comoTexto(m.uniq_msg_id);
    const uid = comoTexto(m.uid);
    const sid = comoTexto(m.sid);
    if (!id || !uid || !sid) continue;
    const tipo = Number(m.msg_type);
    const cont = m.body && typeof m.body.cont === 'string' ? m.body.cont : '';
    let texto;
    if (tipo === TEXTO) texto = cont;
    else if (tipo === IMAGEM) texto = TEXTO_DA_IMAGEM;
    else continue;
    if (!texto.trim()) continue;
    msgs.push({ id, sid, uid, tipo: tipo === TEXTO ? 'texto' : 'imagem', texto, nick: typeof m.nick === 'string' ? m.nick : null, em: Number(m.time) || null });
  }
  return { ok: !!j && (j.errno === undefined || Number(j.errno) === 0), loja, msgs };
}

/** O objeto de um campo que vem como objeto OU como texto JSON (o `extend` e o `payload` da 99) — ou null. */
function objetoOuJson(v) {
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string' || !/^\s*\{/.test(v)) return null;
  try {
    const o = jsonSemArredondar(v);
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

/**
 * Sessão ↔ pedido de uma resposta do broker (a página abriu uma conversa — op_type 12): [{ sid, externo, numero }]. Só o
 * que tem a sessão e o id do pedido; o número sai sem o "#".
 */
function sessoesDoBroker(txt) {
  let j;
  try {
    j = jsonSemArredondar(txt);
  } catch {
    return [];
  }
  const listas = [];
  if (j && typeof j === 'object') {
    if (Array.isArray(j.infos)) listas.push(j.infos);
    if (j.body && typeof j.body === 'object' && Array.isArray(j.body.infos)) listas.push(j.body.infos);
  }
  const fora = [];
  for (const lista of listas)
    for (const info of lista) {
      if (!info || typeof info !== 'object') continue;
      const sid = comoTexto(info.sid);
      const extend = objetoOuJson(info.extend);
      const payload = extend ? objetoOuJson(extend.payload) || extend : null;
      const externo = payload ? comoTexto(payload.orderId) : '';
      if (!sid || !/^\d{6,25}$/.test(externo)) continue;
      const numero = payload ? comoTexto(payload.orderNum).replace(/\D/g, '') : '';
      fora.push({ sid, externo, numero: numero || null });
    }
  return fora;
}

/**
 * Uma mensagem do polling no formato que a nuvem recebe (`ponte-chat/mensagens`). O autor: `uid` = o da loja → "loja";
 * senão "cliente". O pedido vai pelo CLIENTE (`cliente99`): na mensagem do cliente é o próprio `uid`; na da loja, o cliente
 * daquela conversa (`clienteDaConversa`, aprendido nas falas dele). Com a sessão ↔ pedido conhecida (`pedidoDaConversa`),
 * vai também o id e o número do pedido. Sem nada, a nuvem guarda sem pedido.
 */
function paraANuvem(m, loja, clienteDaConversa, pedidoDaConversa) {
  const daLoja = !!loja && m.uid === loja;
  const cliente99 = daLoja ? clienteDaConversa || null : m.uid;
  const pedido = {};
  if (pedidoDaConversa && pedidoDaConversa.externo) {
    pedido.externo = pedidoDaConversa.externo;
    if (pedidoDaConversa.numero) pedido.numero = pedidoDaConversa.numero;
  }
  if (cliente99) pedido.cliente99 = cliente99;
  return {
    canal: '99food',
    id: m.id,
    autor: daLoja ? 'loja' : 'cliente',
    texto: m.texto,
    cliente: daLoja ? null : m.nick,
    pedido: Object.keys(pedido).length ? pedido : undefined,
  };
}

/** O endereço do polling do IM (a prova troca pelo da 99 de mentira com `REGEM_PONTE_99_IM`). */
function filtroDoIm(env = process.env) {
  const p = String(env.REGEM_PONTE_99_IM || '').trim();
  try {
    if (p) return new RegExp(p, 'i');
  } catch {
    /* padrão inválido: o da 99 */
  }
  return /lion\.didiglobal\.com\/im\/polling\//i;
}

/** O endereço do broker do IM (a prova troca com `REGEM_PONTE_99_BROKER`). */
function filtroDoBroker(env = process.env) {
  const p = String(env.REGEM_PONTE_99_BROKER || '').trim();
  try {
    if (p) return new RegExp(p, 'i');
  } catch {
    /* padrão inválido: o da 99 */
  }
  return /lion\.didiglobal\.com\/im\/broker\//i;
}

/**
 * Liga a escuta do IM na página da 99. Cada mensagem NOVA de conversa (o `uniq_msg_id`; a mesma pode voltar noutro
 * polling) vai para `aoChegar` já no formato da nuvem. Sem saber quem é a loja (o `backfill_uid`), não leva nada: sem ele,
 * a fala da loja viraria fala de cliente (e abriria caso no Atendimento).
 * @param {{ debugger: any }} wc
 * @param {{ aoChegar: (m: object) => void, aoMudar?: () => void, registrarErro?: (s: string) => void, anotar?: (o: object) => void, env?: object, agora?: () => number }} o
 */
function ligarLeitor99(wc, { aoChegar, aoMudar, registrarErro, anotar, env = process.env, agora = Date.now }) {
  const dbg = wc.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
  } catch (e) {
    if (registrarErro) registrarErro(`não deu para ler a página da 99: ${e && e.message}`);
    return null;
  }
  const polling = filtroDoIm(env);
  const broker = filtroDoBroker(env);
  const corpos = new Map(); // `${sessão}|${requestId}` → 'polling' | 'broker'
  const vistos = new Vistos();
  const clientes = new Map(); // sid → uid do cliente (aprendido nas falas dele)
  const pedidos = new Map(); // sid → { externo, numero } (a página abriu a conversa)
  let loja = null;
  let ultimoPolling = 0;
  let avisouSemLoja = false;
  const avisar = () => {
    if (aoMudar) aoMudar();
  };
  const guardar = (mapa, k, v) => {
    mapa.set(k, v);
    if (mapa.size > 2000) mapa.delete(mapa.keys().next().value);
  };
  const preparar = (sid) =>
    Promise.all([
      dbg.sendCommand('Network.enable', {}, sid).catch(() => {}),
      dbg.sendCommand('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sid).catch(() => {}),
    ]);
  const pronto = preparar(undefined);

  function doPolling(txt) {
    const r = mensagensDoPolling(txt);
    if (!r.ok) return;
    const antes = ultimoPolling;
    ultimoPolling = agora();
    if (r.loja) loja = r.loja;
    if (!antes) avisar(); // o 1º polling certo: a 99 está logada
    if (!r.msgs.length) return;
    if (!loja) {
      if (!avisouSemLoja && registrarErro) registrarErro('a 99 respondeu sem dizer quem é a loja — as mensagens ficam só no portal da 99');
      avisouSemLoja = true;
      return;
    }
    // primeiro aprende quem é o cliente de cada conversa (a fala da loja pode vir antes da dele no mesmo lote)
    for (const m of r.msgs) if (m.uid !== loja) guardar(clientes, m.sid, m.uid);
    for (const m of r.msgs) {
      if (!vistos.novo(m.id)) continue;
      const n = paraANuvem(m, loja, clientes.get(m.sid), pedidos.get(m.sid));
      if (anotar) anotar({ ev: 'msg_99', autor: n.autor, tipo: m.tipo, comCliente: !!(n.pedido && n.pedido.cliente99), comPedido: !!(n.pedido && n.pedido.externo) });
      aoChegar(n);
    }
  }

  function doBroker(txt) {
    for (const s of sessoesDoBroker(txt)) guardar(pedidos, s.sid, { externo: s.externo, numero: s.numero });
  }

  dbg.on('detach', (_e, motivo) => {
    ultimoPolling = 0;
    avisar();
    if (registrarErro) registrarErro(`a leitura da 99 parou (${motivo})`);
  });
  dbg.on('message', (_e, metodo, p, sid) => {
    try {
      const chave = (id) => `${sid || ''}|${id}`;
      if (metodo === 'Target.attachedToTarget') {
        preparar(p.sessionId);
        return;
      }
      if (metodo === 'Network.responseReceived') {
        const url = (p.response && p.response.url) || '';
        // XHR/Fetch do IM, qualquer tipo de conteúdo (a 99 nem sempre diz que é JSON): o corpo se lê no fim do carregamento
        if (p.type !== 'XHR' && p.type !== 'Fetch') return;
        if (polling.test(url)) corpos.set(chave(p.requestId), { tipo: 'polling', sid });
        else if (broker.test(url)) corpos.set(chave(p.requestId), { tipo: 'broker', sid });
        return;
      }
      if (metodo === 'Network.loadingFailed') {
        corpos.delete(chave(p.requestId));
        return;
      }
      if (metodo === 'Network.loadingFinished' && corpos.has(chave(p.requestId))) {
        const { tipo, sid: s } = corpos.get(chave(p.requestId));
        corpos.delete(chave(p.requestId));
        dbg
          .sendCommand('Network.getResponseBody', { requestId: p.requestId }, s || undefined)
          .then((b) => {
            const txt = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
            if (!txt || txt.length > 2000000) return;
            if (tipo === 'polling') doPolling(txt);
            else doBroker(txt);
          })
          .catch((e) => {
            if (anotar) anotar({ ev: 'corpo_99_falhou', tipo, erro: String((e && e.message) || e).slice(0, 160) });
          });
      }
    } catch (e) {
      if (registrarErro) registrarErro(String((e && e.message) || e));
    }
  });
  return {
    pronto,
    /** Quando chegou a última resposta CERTA do polling (a 99 logada pergunta de tempos em tempos) — ou 0. */
    ultimoPolling: () => ultimoPolling,
    /** O usuário da loja no IM da 99 (o `backfill_uid`) — ou null. */
    loja: () => loja,
    /** A sessão ↔ pedido que a página já abriu (o envio da 4b confere por aqui). */
    pedidoDaSessao: (s) => pedidos.get(String(s)) || null,
  };
}

module.exports = { jsonSemArredondar, mensagensDoPolling, sessoesDoBroker, paraANuvem, filtroDoIm, filtroDoBroker, ligarLeitor99, TEXTO, IMAGEM, TEXTO_DA_IMAGEM };
