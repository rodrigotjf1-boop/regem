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

/**
 * O ENVIO da loja que a página faz ao broker (op_type 3): `{ sid, texto }` da 1ª mensagem de texto — ou null (outro op,
 * outro tipo, corpo estragado). Mapeado em 05/11: `{ op_type: 3, body: { msgs: [{ body: { cont }, msg_type: 65536, sid }] } }`.
 */
function envioDoBroker(txt) {
  let j;
  try {
    j = jsonSemArredondar(txt);
  } catch {
    return null;
  }
  if (!j || Number(j.op_type) !== 3) return null;
  const msgs = (j.body && Array.isArray(j.body.msgs) && j.body.msgs) || (Array.isArray(j.msgs) && j.msgs) || [];
  const m = msgs.find((x) => x && Number(x.msg_type) === TEXTO && x.body && typeof x.body.cont === 'string');
  if (!m) return null;
  const sid = comoTexto(m.sid);
  return sid ? { sid, texto: m.body.cont } : null;
}

/** A CONFIRMAÇÃO do broker ao envio: o id da mensagem (`uniq_msg_id`, o mesmo do polling; sem ele, o `mid`) — ou null. */
function confirmacaoDoBroker(txt) {
  let j;
  try {
    j = jsonSemArredondar(txt);
  } catch {
    return null;
  }
  if (!j || (j.errno !== undefined && Number(j.errno) !== 0)) return null;
  const b = j.body && typeof j.body === 'object' ? j.body : {};
  const m = Array.isArray(b.msgs) ? b.msgs.find((x) => x && (x.uniq_msg_id !== undefined || x.mid !== undefined)) : null;
  const id = m ? comoTexto(m.uniq_msg_id) || comoTexto(m.mid) : Array.isArray(b.mids) && b.mids.length ? comoTexto(b.mids[0]) : '';
  return id ? { id } : null;
}

/** O `errno` de uma resposta do broker (o número, para o diagnóstico) — ou null (sem ele, corpo estragado). */
function errnoDe(txt) {
  try {
    const j = jsonSemArredondar(txt);
    return j && j.errno !== undefined ? String(j.errno).slice(0, 20) : null;
  } catch {
    return null;
  }
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
  const envios = new Map(); // `${sessão}|${requestId}` → { sid, texto } (o envio que a página fez — op_type 3)
  const daLoja = []; // o que a LOJA mandou (polling e confirmação do envio): { sid, texto, em, id } — o "já está no chat?"
  const ouvintes = new Set(); // quem espera a confirmação do envio (4b)
  let loja = null;
  let ultimoPolling = 0;
  let avisouSemLoja = false;
  // 12/11 (os 2 "envio incerto" de 10/11, sem prova de que saíram): o que a rede mostrou do ÚLTIMO envio da página — o
  // pedido de envio visto e a resposta do broker (com o errno) —, para o diagnóstico dizer onde parou
  let envioVistoEm = 0;
  let respostaDoEnvio = { em: 0, ok: false, errno: null };
  const anotarSemFalhar = (o) => {
    try {
      if (anotar) anotar(o);
    } catch {
      /* o diagnóstico não derruba a leitura */
    }
  };
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

  /** Guarda o que a loja mandou e avisa quem espera a confirmação de um envio. */
  function daLojaChegou(ev) {
    daLoja.push(ev);
    if (daLoja.length > 500) daLoja.shift();
    for (const f of ouvintes) {
      try {
        f(ev);
      } catch {
        /* quem ouve não derruba a leitura */
      }
    }
  }
  const doPedido = (sid, pedidoExterno) => {
    const p = pedidos.get(String(sid));
    return !!p && !!pedidoExterno && p.externo === String(pedidoExterno);
  };

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
      if (m.uid === loja && m.tipo === 'texto') daLojaChegou({ fonte: 'polling', sid: m.sid, texto: m.texto, em: agora(), id: m.id });
      const n = paraANuvem(m, loja, clientes.get(m.sid), pedidos.get(m.sid));
      if (anotar) anotar({ ev: 'msg_99', autor: n.autor, tipo: m.tipo, comCliente: !!(n.pedido && n.pedido.cliente99), comPedido: !!(n.pedido && n.pedido.externo) });
      aoChegar(n);
    }
  }

  function doBroker(txt, envio) {
    if (envio) {
      // a resposta ao envio da loja (op 3): o id da mensagem confirma que saiu
      const c = confirmacaoDoBroker(txt);
      respostaDoEnvio = { em: Date.now(), ok: !!c, errno: c ? null : errnoDe(txt) };
      if (c) daLojaChegou({ fonte: 'envio', sid: envio.sid, texto: envio.texto, em: agora(), id: c.id });
      else anotarSemFalhar({ ev: 'envio_99_recusado', errno: respostaDoEnvio.errno });
      return;
    }
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
      if (metodo === 'Network.requestWillBeSent') {
        const rq = p.request || {};
        if (rq.method === 'POST' && broker.test(rq.url || '') && typeof rq.postData === 'string') {
          const e = envioDoBroker(rq.postData);
          if (e) {
            envios.set(chave(p.requestId), e);
            envioVistoEm = Date.now();
            anotarSemFalhar({ ev: 'envio_99_visto', conversaConhecida: pedidos.has(e.sid) });
          }
        } else if (rq.method === 'POST' && broker.test(rq.url || '') && rq.hasPostData) {
          // o navegador não mandou o corpo junto (corpo grande): sem ele não dá para ligar a confirmação ao envio
          anotarSemFalhar({ ev: 'envio_99_sem_corpo' });
        }
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
        if (envios.has(chave(p.requestId))) {
          respostaDoEnvio = { em: Date.now(), ok: false, errno: null };
          anotarSemFalhar({ ev: 'envio_99_falhou', erro: String(p.errorText || '').slice(0, 80), cancelado: !!p.canceled });
        }
        envios.delete(chave(p.requestId));
        return;
      }
      if (metodo === 'Network.loadingFinished' && corpos.has(chave(p.requestId))) {
        const { tipo, sid: s } = corpos.get(chave(p.requestId));
        corpos.delete(chave(p.requestId));
        const envio = envios.get(chave(p.requestId)) || null;
        envios.delete(chave(p.requestId));
        dbg
          .sendCommand('Network.getResponseBody', { requestId: p.requestId }, s || undefined)
          .then((b) => {
            const txt = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
            if (!txt || txt.length > 2000000) return;
            if (tipo === 'polling') doPolling(txt);
            else doBroker(txt, envio);
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
    /**
     * A mensagem da LOJA com este texto EXATO já está na conversa deste pedido (de `desde` em diante)? Só vale na conversa
     * cuja sessão ↔ pedido a página abriu (o mesmo texto noutra conversa não conta) — { id } ou null.
     */
    jaEnviada: ({ pedidoExterno, texto, desde = 0 }) => {
      const t = String(texto || '').trim();
      const m = [...daLoja].reverse().find((x) => x.em >= desde && x.texto.trim() === t && doPedido(x.sid, pedidoExterno));
      return m ? { id: m.id } : null;
    },
    /**
     * Espera a confirmação do envio: a resposta do broker ao envio da loja OU o eco no polling, com o texto EXATO, na
     * conversa deste pedido (quando a sessão ↔ pedido é conhecida — a página acabou de abri-la) — { id } ou null no prazo.
     */
    esperarEco: ({ pedidoExterno, texto, desde, prazoMs = 20000, tardioMs = 120000 }) =>
      new Promise((resolver) => {
        const t = String(texto || '').trim();
        const inicio = Date.now();
        let noPrazo = true;
        let fimTardio = null;
        const fim = setTimeout(() => {
          noPrazo = false;
          resolver(null);
          // 12/11: sem confirmação no prazo — o diagnóstico diz o que a rede mostrou (o envio saiu da página? o broker
          // respondeu? com que erro?) e o ouvinte fica mais um pouco: a confirmação ATRASADA prova que a 99 só estava lenta
          anotarSemFalhar({
            ev: 'eco_99_sem_resposta',
            prazoMs,
            viuOEnvio: envioVistoEm >= inicio,
            brokerRespondeu: respostaDoEnvio.em >= inicio,
            brokerAceitou: respostaDoEnvio.em >= inicio && respostaDoEnvio.ok,
            errno: respostaDoEnvio.em >= inicio ? respostaDoEnvio.errno : null,
          });
          fimTardio = setTimeout(() => ouvintes.delete(ouvir), tardioMs);
          if (fimTardio.unref) fimTardio.unref();
        }, prazoMs);
        const ouvir = (ev) => {
          if (ev.texto.trim() !== t || ev.em < desde) return;
          if (pedidoExterno && pedidos.has(String(ev.sid)) && !doPedido(ev.sid, pedidoExterno)) return;
          ouvintes.delete(ouvir);
          if (noPrazo) {
            clearTimeout(fim);
            resolver({ id: ev.id, fonte: ev.fonte });
            return;
          }
          clearTimeout(fimTardio);
          anotarSemFalhar({ ev: 'eco_99_tardio', fonte: ev.fonte, depoisMs: Date.now() - inicio });
        };
        ouvintes.add(ouvir);
      }),
  };
}

module.exports = {
  jsonSemArredondar,
  mensagensDoPolling,
  sessoesDoBroker,
  envioDoBroker,
  confirmacaoDoBroker,
  paraANuvem,
  filtroDoIm,
  filtroDoBroker,
  ligarLeitor99,
  TEXTO,
  IMAGEM,
  TEXTO_DA_IMAGEM,
};
