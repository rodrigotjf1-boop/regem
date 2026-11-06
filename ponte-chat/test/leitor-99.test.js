'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { jsonSemArredondar, mensagensDoPolling, sessoesDoBroker, paraANuvem, filtroDoIm, filtroDoBroker, ligarLeitor99 } = require('../src/leitor-99');

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
async function responder(dbg, url, corpo, type = 'XHR') {
  const id = `r${proximo++}`;
  dbg.corpos.set(id, corpo);
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
