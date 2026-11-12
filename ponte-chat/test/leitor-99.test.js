'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { jsonSemArredondar, mensagensDoPolling, sessoesDoBroker, envioDoBroker, confirmacaoDoBroker, paraANuvem, filtroDoIm, filtroDoBroker, ligarLeitor99 } = require('../src/leitor-99');

const LOJA = '9000000000000001';
const CLIENTE = '900000000000123';
// a resposta do polling como a 99 manda (forma vista em 05/11; ids de mentira com o mesmo tamanho)
const polling = (msgs) =>
  `{"body":{"backfill_uid":${LOJA},"single":{"max_mid":4,"msgs":[${msgs.join(',')}]}},"dataversion":"1.0","errmsg":"","errno":0,"product":600}`;
const texto = (mid, uid, cont, sid = '9000000000000000777') =>
  `{"body":{"cont":${JSON.stringify(cont)}},"head_url":"","mact":0,"mattr":7,"mid":${mid},"msg_type":65536,"nick":"Léa","product":600,"session_type":1,"sid":${sid},"stag":"abcdef","time":1793929842760,"uid":${uid},"uniq_msg_id":"92000000000000003${mid}"}`;
const imagem = (mid, uid) =>
  `{"body":{"cont":"https://img.exemplo/1.jpg","fid":"abc","height":1024,"ns":"","width":768},"mid":${mid},"msg_type":196608,"nick":"Léa","session_type":1,"sid":9000000000000000777,"time":1793929545056,"uid":${uid},"uniq_msg_id":"92000000000000001${mid}"}`;
const sistema = `{"body":{"cont":{"action":"start","sid":"9000000000000000777"},"event_id":"notify_session_info"},"mid":1,"msg_type":524289,"session_type":8,"sid":0,"time":1,"uid":0,"uniq_msg_id":"9200000000000000999"}`;

test('os ids grandes chegam INTEIROS (em 05/11 o sid de uma conversa arredondava); o texto não é mexido', () => {
  const j = jsonSemArredondar('{"sid":9000000000000000777,"n":7,"t":"valor:1234567890123456,ok","x":1.5}');
  assert.equal(j.sid, '9000000000000000777');
  assert.equal(j.n, 7);
  assert.equal(j.t, 'valor:1234567890123456,ok');
  assert.equal(j.x, 1.5);
});

test('do polling: só a CONVERSA (sistema fora); texto e imagem; quem é a loja', () => {
  const r = mensagensDoPolling(polling([sistema, texto(4, CLIENTE, 'Cadê meu pedido?'), imagem(2, CLIENTE), texto(5, LOJA, 'Já saiu!')]));
  assert.equal(r.loja, LOJA);
  assert.deepEqual(
    r.msgs.map((m) => [m.tipo, m.uid, m.sid, m.texto.slice(0, 12)]),
    [
      ['texto', CLIENTE, '9000000000000000777', 'Cadê meu ped'],
      ['imagem', CLIENTE, '9000000000000000777', '📷 (o client'],
      ['texto', LOJA, '9000000000000000777', 'Já saiu!'],
    ],
  );
  assert.equal(r.msgs[0].id, '920000000000000034');
  assert.equal(r.msgs[0].nick, 'Léa');
});

test('resposta estragada, sem mensagens, tipo desconhecido ou texto vazio: nada', () => {
  assert.deepEqual(mensagensDoPolling('{quebrado').msgs, []);
  assert.deepEqual(mensagensDoPolling('{"body":{"single":{"msgs":null}}}').msgs, []);
  assert.deepEqual(mensagensDoPolling(polling([texto(4, CLIENTE, '   ')])).msgs, []);
  const outro = texto(6, CLIENTE, 'x').replace('"msg_type":65536', '"msg_type":131072');
  assert.deepEqual(mensagensDoPolling(polling([outro])).msgs, []);
});

test('para a nuvem: o cliente leva o PRÓPRIO uid como o cliente do pedido; a loja, o cliente da conversa (se conhecido)', () => {
  const { loja, msgs } = mensagensDoPolling(polling([texto(4, CLIENTE, 'Cadê?'), texto(5, LOJA, 'Já saiu!')]));
  assert.deepEqual(paraANuvem(msgs[0], loja, null), { canal: '99food', id: msgs[0].id, autor: 'cliente', texto: 'Cadê?', cliente: 'Léa', pedido: { cliente99: CLIENTE } });
  assert.deepEqual(paraANuvem(msgs[1], loja, CLIENTE), { canal: '99food', id: msgs[1].id, autor: 'loja', texto: 'Já saiu!', cliente: null, pedido: { cliente99: CLIENTE } });
  // da loja numa conversa em que o cliente ainda não falou: vai sem pedido (a nuvem guarda sem ligar)
  assert.equal(paraANuvem(msgs[1], loja, null).pedido, undefined);
});

test('o endereço do polling: o da 99; a prova troca', () => {
  assert.ok(filtroDoIm({}).test('https://lion.didiglobal.com/im/polling/'));
  assert.ok(!filtroDoIm({}).test('https://lion.didiglobal.com/im/broker/'));
  assert.ok(filtroDoIm({ REGEM_PONTE_99_IM: '127\\.0\\.0\\.1:4499/im/polling' }).test('http://127.0.0.1:4499/im/polling/'));
  assert.ok(filtroDoBroker({}).test('https://lion.didiglobal.com/im/broker/'));
  assert.ok(!filtroDoBroker({}).test('https://lion.didiglobal.com/im/polling/'));
});

test('a 99 respondeu com erro: ok falso (não conta como logada)', () => {
  assert.equal(mensagensDoPolling('{"errno":1001,"errmsg":"x","body":{}}').ok, false);
  assert.equal(mensagensDoPolling(polling([])).ok, true);
});

const SID = '9000000000000000777';
const PEDIDO = '9100000000000003441';
// a conversa aberta (op_type 12): `extend` como texto JSON, com o `payload` também em texto (a forma de 05/11)
const broker = (extend) => `{"body":{"infos":[{"sid":${SID},"extend":${JSON.stringify(extend)}}]},"errno":0}`;

test('do broker: a sessão ↔ o pedido (id inteiro, número sem o "#"); payload em texto ou objeto', () => {
  const emTexto = JSON.stringify({ payload: `{"orderId":${PEDIDO},"orderNum":"#900002"}` });
  assert.deepEqual(sessoesDoBroker(broker(emTexto)), [{ sid: SID, externo: PEDIDO, numero: '900002' }]);
  const emObjeto = `{"infos":[{"sid":${SID},"extend":{"payload":{"orderId":"${PEDIDO}"}}}]}`;
  assert.deepEqual(sessoesDoBroker(emObjeto), [{ sid: SID, externo: PEDIDO, numero: null }]);
  // sem pedido, sem sessão ou estragado: nada
  assert.deepEqual(sessoesDoBroker(broker(JSON.stringify({ payload: '{"x":1}' }))), []);
  assert.deepEqual(sessoesDoBroker(`{"body":{"infos":[{"extend":{"payload":{"orderId":"${PEDIDO}"}}}]}}`), []);
  assert.deepEqual(sessoesDoBroker('{quebrado'), []);
});

test('para a nuvem com a sessão ↔ pedido conhecida: vai o id e o número do pedido também', () => {
  const { loja, msgs } = mensagensDoPolling(polling([texto(5, LOJA, 'Já saiu!')]));
  assert.deepEqual(paraANuvem(msgs[0], loja, null, { externo: PEDIDO, numero: '900002' }).pedido, { externo: PEDIDO, numero: '900002' });
  assert.deepEqual(paraANuvem(msgs[0], loja, CLIENTE, { externo: PEDIDO, numero: null }).pedido, { externo: PEDIDO, cliente99: CLIENTE });
});

// ---------- a escuta da rede (com um depurador de mentira) ----------

function depuradorFalso() {
  const ouvintes = {};
  const corpos = new Map();
  return {
    corpos,
    isAttached: () => false,
    attach() {},
    on(ev, f) {
      (ouvintes[ev] = ouvintes[ev] || []).push(f);
    },
    async sendCommand(metodo, p) {
      if (metodo !== 'Network.getResponseBody') return {};
      if (!corpos.has(p.requestId)) throw new Error('No resource with given identifier found');
      return { body: corpos.get(p.requestId), base64Encoded: false };
    },
    emitir(metodo, p, sid) {
      for (const f of ouvintes.message || []) f({}, metodo, p, sid);
    },
  };
}
let proximo = 1;
async function responder(dbg, url, corpo, type = 'XHR', postData) {
  const id = `r${proximo++}`;
  dbg.corpos.set(id, corpo);
  if (postData !== undefined) dbg.emitir('Network.requestWillBeSent', { requestId: id, type, request: { url, method: 'POST', postData } });
  dbg.emitir('Network.responseReceived', { requestId: id, type, response: { url, mimeType: 'text/plain' } });
  dbg.emitir('Network.loadingFinished', { requestId: id });
  await new Promise((r) => setImmediate(r));
}
const POLL = 'https://lion.didiglobal.com/im/polling/?ts=1';
const BROKER = 'https://lion.didiglobal.com/im/broker/';

test('a escuta: lê o polling, uma vez por mensagem, com o cliente e o pedido da conversa', async () => {
  const dbg = depuradorFalso();
  const chegaram = [];
  let t = 1000;
  const l = ligarLeitor99({ debugger: dbg }, { aoChegar: (m) => chegaram.push(m), env: {}, agora: () => t });
  assert.equal(l.ultimoPolling(), 0);
  // a fala da LOJA vem antes da do cliente no mesmo lote: ainda assim leva o cliente da conversa
  await responder(dbg, POLL, polling([texto(5, LOJA, 'Oi, tudo certo?'), texto(4, CLIENTE, 'Cadê meu pedido?')]));
  assert.equal(l.ultimoPolling(), 1000);
  assert.equal(l.loja(), LOJA);
  assert.deepEqual(
    chegaram.map((m) => [m.autor, m.texto, m.pedido]),
    [
      ['loja', 'Oi, tudo certo?', { cliente99: CLIENTE }],
      ['cliente', 'Cadê meu pedido?', { cliente99: CLIENTE }],
    ],
  );
  // a mesma mensagem noutro polling: não vai de novo
  t = 2000;
  await responder(dbg, POLL, polling([texto(4, CLIENTE, 'Cadê meu pedido?')]));
  assert.equal(chegaram.length, 2);
  assert.equal(l.ultimoPolling(), 2000);
  // a página abriu a conversa (broker): as próximas falas levam o id do pedido
  await responder(dbg, BROKER, broker(JSON.stringify({ payload: `{"orderId":${PEDIDO},"orderNum":"#900002"}` })));
  assert.deepEqual(l.pedidoDaSessao(SID), { externo: PEDIDO, numero: '900002' });
  await responder(dbg, POLL, polling([texto(6, LOJA, 'Já saiu!')]), 'Fetch');
  assert.deepEqual(chegaram[2].pedido, { externo: PEDIDO, numero: '900002', cliente99: CLIENTE });
});

test('a escuta: sem saber quem é a loja, não leva nada (a fala da loja viraria caso de cliente)', async () => {
  const dbg = depuradorFalso();
  const chegaram = [];
  const erros = [];
  ligarLeitor99({ debugger: dbg }, { aoChegar: (m) => chegaram.push(m), registrarErro: (s) => erros.push(s), env: {} });
  const semLoja = polling([texto(5, LOJA, 'Já saiu!')]).replace(`"backfill_uid":${LOJA},`, '');
  await responder(dbg, POLL, semLoja);
  await responder(dbg, POLL, semLoja);
  assert.equal(chegaram.length, 0);
  assert.equal(erros.length, 1, 'avisa uma vez');
});

test('a escuta: polling com erro não conta como logada; outro endereço, imagem do documento e corpo perdido: nada', async () => {
  const dbg = depuradorFalso();
  const chegaram = [];
  const l = ligarLeitor99({ debugger: dbg }, { aoChegar: (m) => chegaram.push(m), env: {} });
  await responder(dbg, POLL, '{"errno":1001,"body":{}}');
  assert.equal(l.ultimoPolling(), 0);
  await responder(dbg, 'https://b.99app.com/order/list', polling([texto(4, CLIENTE, 'x')]));
  await responder(dbg, POLL, polling([texto(4, CLIENTE, 'x')]), 'Document');
  dbg.emitir('Network.responseReceived', { requestId: 'perdido', type: 'XHR', response: { url: POLL } });
  dbg.emitir('Network.loadingFinished', { requestId: 'perdido' });
  await new Promise((r) => setImmediate(r));
  assert.equal(chegaram.length, 0);
});

test('a escuta na 99 de mentira da prova (REGEM_PONTE_99_IM)', async () => {
  const dbg = depuradorFalso();
  const chegaram = [];
  ligarLeitor99({ debugger: dbg }, { aoChegar: (m) => chegaram.push(m), env: { REGEM_PONTE_99_IM: '127\\.0\\.0\\.1:4499/im/polling' } });
  await responder(dbg, POLL, polling([texto(4, CLIENTE, 'da 99 de verdade')]));
  await responder(dbg, 'http://127.0.0.1:4499/im/polling/', polling([texto(7, CLIENTE, 'da 99 de mentira')]));
  assert.deepEqual(chegaram.map((m) => m.texto), ['da 99 de mentira']);
});

// ---------- 4b: o envio da loja e a confirmação ----------

const envio = (cont, sid = SID) => `{"op_type":3,"body":{"msgs":[{"body":{"cont":${JSON.stringify(cont)}},"msg_type":65536,"sid":${sid},"local_id":"x1","soid":"y"}]}}`;
const confirmacao = (uniq) => `{"body":{"mids":[123456789012345678],"msgs":[{"mid":123456789012345678,"uniq_msg_id":${uniq}}]},"errno":0}`;

test('o envio que a página faz (op 3) e a confirmação do broker: o texto, a sessão e o id (o mesmo do polling)', () => {
  assert.deepEqual(envioDoBroker(envio('Seu pedido saiu!')), { sid: SID, texto: 'Seu pedido saiu!' });
  assert.equal(envioDoBroker('{"op_type":12,"body":{}}'), null);
  assert.equal(envioDoBroker(envio('x').replace('65536', '196608')), null);
  assert.equal(envioDoBroker('{quebrado'), null);
  assert.deepEqual(confirmacaoDoBroker(confirmacao('920000000000000099')), { id: '920000000000000099' });
  assert.deepEqual(confirmacaoDoBroker('{"body":{"mids":[123456789012345678]},"errno":0}'), { id: '123456789012345678' });
  assert.equal(confirmacaoDoBroker('{"errno":500,"body":{"mids":[1]}}'), null);
  assert.equal(confirmacaoDoBroker('{"body":{},"errno":0}'), null);
});

test('esperar o eco: a confirmação do broker ao envio, com o texto exato, na conversa do pedido', async () => {
  const dbg = depuradorFalso();
  const l = ligarLeitor99({ debugger: dbg }, { aoChegar: () => {}, env: {} });
  // a página abriu a conversa (sessão ↔ pedido)
  await responder(dbg, BROKER, broker(JSON.stringify({ payload: `{"orderId":${PEDIDO},"orderNum":"#900002"}` })));
  const desde = Date.now();
  const esperando = l.esperarEco({ pedidoExterno: PEDIDO, texto: 'Seu pedido saiu!', desde, prazoMs: 2000 });
  // outro texto e outra conversa conhecida: não contam
  await responder(dbg, BROKER, confirmacao('920000000000000001'), 'XHR', envio('Outro texto'));
  await responder(dbg, BROKER, confirmacao('920000000000000099'), 'XHR', envio('Seu pedido saiu!'));
  assert.deepEqual(await esperando, { id: '920000000000000099', fonte: 'envio' });
  // e ficou guardada: "já está no chat?" para ESTE pedido; para outro pedido, não
  assert.deepEqual(l.jaEnviada({ pedidoExterno: PEDIDO, texto: 'Seu pedido saiu!', desde }), { id: '920000000000000099' });
  assert.equal(l.jaEnviada({ pedidoExterno: '9100000000000000001', texto: 'Seu pedido saiu!', desde }), null);
  assert.equal(l.jaEnviada({ pedidoExterno: PEDIDO, texto: 'Seu pedido saiu!', desde: Date.now() + 1000 }), null);
});

test('esperar o eco pelo polling (a fala da loja com o texto exato); sem nada no prazo: null', async () => {
  const dbg = depuradorFalso();
  const l = ligarLeitor99({ debugger: dbg }, { aoChegar: () => {}, env: {} });
  await responder(dbg, BROKER, broker(JSON.stringify({ payload: `{"orderId":${PEDIDO},"orderNum":"#900002"}` })));
  const esperando = l.esperarEco({ pedidoExterno: PEDIDO, texto: 'Já saiu!', desde: Date.now(), prazoMs: 2000 });
  await responder(dbg, POLL, polling([texto(8, CLIENTE, 'Já saiu!'), texto(9, LOJA, 'Já saiu!')]));
  assert.deepEqual(await esperando, { id: '920000000000000039', fonte: 'polling' }); // a do cliente com o mesmo texto não conta
  assert.equal(await l.esperarEco({ pedidoExterno: PEDIDO, texto: 'Nada', desde: Date.now(), prazoMs: 50 }), null);
  // a conversa de OUTRO pedido conhecido: o eco não vale
  await responder(dbg, BROKER, `{"body":{"infos":[{"sid":9000000000000000888,"extend":{"payload":{"orderId":"9100000000000000001"}}}]},"errno":0}`);
  const outro = l.esperarEco({ pedidoExterno: PEDIDO, texto: 'Oi', desde: Date.now(), prazoMs: 300 });
  await responder(dbg, POLL, polling([texto(10, LOJA, 'Oi', '9000000000000000888')]));
  assert.equal(await outro, null);
});

// ---------- o diagnóstico do envio sem confirmação (12/11: os 2 "envio incerto" de 10/11 ficaram sem explicação) ----------

/** O envio da página (op 3) sai; a resposta do broker só quando o teste mandar (`responderAgora`) — ou falha na rede. */
function envioPendente(dbg, cont) {
  const id = `r${proximo++}`;
  dbg.emitir('Network.requestWillBeSent', { requestId: id, type: 'XHR', request: { url: BROKER, method: 'POST', postData: envio(cont) } });
  return {
    async responderAgora(corpo) {
      dbg.corpos.set(id, corpo);
      dbg.emitir('Network.responseReceived', { requestId: id, type: 'XHR', response: { url: BROKER, mimeType: 'text/plain' } });
      dbg.emitir('Network.loadingFinished', { requestId: id });
      await new Promise((r) => setImmediate(r));
    },
    falhar(errorText) {
      dbg.emitir('Network.loadingFailed', { requestId: id, errorText, canceled: false });
    },
  };
}

test('sem confirmação no prazo: o diagnóstico diz que o envio saiu da página e o broker não respondeu; a ATRASADA é anotada', async () => {
  const dbg = depuradorFalso();
  const notas = [];
  const l = ligarLeitor99({ debugger: dbg }, { aoChegar: () => {}, env: {}, anotar: (o) => notas.push(o) });
  // a página abriu a conversa (sessão ↔ pedido)
  await responder(dbg, BROKER, broker(JSON.stringify({ payload: `{"orderId":${PEDIDO},"orderNum":"#900002"}` })));
  const desde = Date.now();
  const esperando = l.esperarEco({ pedidoExterno: PEDIDO, texto: 'Seu pedido saiu!', desde, prazoMs: 80, tardioMs: 2000 });
  const pendente = envioPendente(dbg, 'Seu pedido saiu!');
  assert.equal(await esperando, null);
  assert.deepEqual(notas.find((n) => n.ev === 'envio_99_visto'), { ev: 'envio_99_visto', conversaConhecida: true });
  assert.deepEqual(notas.find((n) => n.ev === 'eco_99_sem_resposta'), {
    ev: 'eco_99_sem_resposta',
    prazoMs: 80,
    viuOEnvio: true,
    brokerRespondeu: false,
    brokerAceitou: false,
    errno: null,
  });
  // a 99 lenta confirma DEPOIS do prazo: a prova de que a mensagem saiu fica no diagnóstico (o resultado já foi "incerto")
  await pendente.responderAgora(confirmacao('920000000000000077'));
  const tardio = notas.find((n) => n.ev === 'eco_99_tardio');
  assert.equal(tardio.fonte, 'envio');
  assert.ok(tardio.depoisMs >= 80, String(tardio.depoisMs));
  // e ela vale para o "já está no chat?" (uma nova tentativa não escreve de novo)
  assert.deepEqual(l.jaEnviada({ pedidoExterno: PEDIDO, texto: 'Seu pedido saiu!', desde }), { id: '920000000000000077' });
});

test('o broker recusa o envio (errno) ou a rede derruba: anotado com o motivo, e o "sem resposta" diz o que houve', async () => {
  const dbg = depuradorFalso();
  const notas = [];
  const l = ligarLeitor99({ debugger: dbg }, { aoChegar: () => {}, env: {}, anotar: (o) => notas.push(o) });
  const recusa = l.esperarEco({ pedidoExterno: PEDIDO, texto: 'Oi', desde: Date.now(), prazoMs: 80, tardioMs: 50 });
  await envioPendente(dbg, 'Oi').responderAgora('{"errno":10023,"errmsg":"x","body":{}}');
  assert.equal(await recusa, null);
  assert.deepEqual(notas.find((n) => n.ev === 'envio_99_recusado'), { ev: 'envio_99_recusado', errno: '10023' });
  assert.deepEqual(
    notas.filter((n) => n.ev === 'eco_99_sem_resposta').map((n) => [n.viuOEnvio, n.brokerRespondeu, n.brokerAceitou, n.errno]),
    [[true, true, false, '10023']],
  );
  const queda = l.esperarEco({ pedidoExterno: PEDIDO, texto: 'Oi de novo', desde: Date.now(), prazoMs: 80, tardioMs: 50 });
  envioPendente(dbg, 'Oi de novo').falhar('net::ERR_CONNECTION_RESET');
  assert.equal(await queda, null);
  assert.deepEqual(notas.find((n) => n.ev === 'envio_99_falhou'), { ev: 'envio_99_falhou', erro: 'net::ERR_CONNECTION_RESET', cancelado: false });
  // nada do envio na rede (o clique não fez a página mandar): "não vi o envio"
  const nada = l.esperarEco({ pedidoExterno: PEDIDO, texto: 'Sumiu', desde: Date.now(), prazoMs: 80, tardioMs: 50 });
  assert.equal(await nada, null);
  assert.deepEqual(notas.filter((n) => n.ev === 'eco_99_sem_resposta').at(-1), {
    ev: 'eco_99_sem_resposta',
    prazoMs: 80,
    viuOEnvio: false,
    brokerRespondeu: false,
    brokerAceitou: false,
    errno: null,
  });
});
