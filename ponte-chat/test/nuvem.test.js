'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const nuvem = require('../src/nuvem');

/** Uma resposta de mentira no formato do fetch. */
const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)) });

test('a base: a nuvem do Regem; a variável troca (teste local); sem a barra do fim', () => {
  assert.equal(nuvem.baseDaNuvem({}), 'https://api.dmsregem.com/api/v1');
  assert.equal(nuvem.baseDaNuvem({ REGEM_PONTE_NUVEM: 'http://localhost:3056/api/v1/' }), 'http://localhost:3056/api/v1');
});

test('V70: só TERMINAL_REVOGADO faz esquecer; "não reconhecido", limite, rede e 5xx tentam de novo', () => {
  assert.equal(nuvem.classificar({ ok: true }), 'ok');
  assert.equal(nuvem.classificar({ ok: false, status: 403, code: 'TERMINAL_REVOGADO' }), 'revogado');
  assert.equal(nuvem.classificar({ ok: false, status: 403, code: 'TERMINAL_NAO_RECONHECIDO' }), 'nao_reconhecido');
  assert.equal(nuvem.classificar({ ok: false, status: 403, code: null }), 'recusado'); // 403 sem o código: não esquece
  assert.equal(nuvem.classificar({ ok: false, status: 429 }), 'limite');
  assert.equal(nuvem.classificar({ ok: false, status: 0 }), 'rede');
  assert.equal(nuvem.classificar({ ok: false, status: 502 }), 'servidor');
  assert.equal(nuvem.classificar({ ok: false, status: 400 }), 'recusado');
});

test('manda o id e o segredo do PC nos cabeçalhos; lê o code e a mensagem da recusa', async () => {
  let pedido;
  const fetchImpl = async (url, init) => {
    pedido = { url, init };
    return resposta(403, { message: 'A ponte deste PC foi revogada no Regem.', code: 'TERMINAL_REVOGADO' });
  };
  const r = await nuvem.estado({ terminalId: 'id-1', segredo: 's-1' }, { versao: '0.1.0' }, { base: 'http://x/api/v1', fetchImpl });
  assert.equal(pedido.url, 'http://x/api/v1/ponte-chat/estado');
  assert.equal(pedido.init.method, 'POST');
  assert.equal(pedido.init.headers['x-terminal-id'], 'id-1');
  assert.equal(pedido.init.headers['x-terminal-secret'], 's-1');
  assert.deepEqual(JSON.parse(pedido.init.body), { versao: '0.1.0' });
  assert.deepEqual(r, { ok: false, status: 403, code: 'TERMINAL_REVOGADO', mensagem: 'A ponte deste PC foi revogada no Regem.' });
});

test('parear manda o tipo (código de outro aparelho não é gasto) e não manda credencial', async () => {
  let pedido;
  const fetchImpl = async (url, init) => {
    pedido = { url, init };
    return resposta(201, { terminalId: 't', segredo: 's', nome: 'PC do delivery', tipo: 'ponte_chat', unidadeId: null });
  };
  const r = await nuvem.parear('123456', 'dig', { base: 'http://x/api/v1', fetchImpl });
  assert.equal(pedido.url, 'http://x/api/v1/publico/terminal/parear');
  assert.deepEqual(JSON.parse(pedido.init.body), { codigo: '123456', fingerprint: 'dig', tipo: 'ponte_chat' });
  assert.equal(pedido.init.headers['x-terminal-id'], undefined);
  assert.equal(r.ok, true);
  assert.equal(r.dados.nome, 'PC do delivery');
});

test('sem rede ou sem resposta a tempo: status 0, com o motivo em português', async () => {
  const semRede = await nuvem.chamar('/x', {}, null, { base: 'http://x', fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  assert.deepEqual(semRede, { ok: false, status: 0, code: null, mensagem: 'Sem conexão com a nuvem do Regem.' });
  const lenta = await nuvem.chamar('/x', {}, null, {
    base: 'http://x',
    tempoMs: 20,
    fetchImpl: (_u, init) => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))),
  });
  assert.equal(lenta.status, 0);
  assert.equal(lenta.mensagem, 'A nuvem do Regem não respondeu a tempo.');
});

test('mensagens vão no corpo { mensagens }', async () => {
  let corpo;
  await nuvem.mensagens({ terminalId: 't', segredo: 's' }, [{ id: '1' }], { base: 'http://x', fetchImpl: async (_u, i) => ((corpo = JSON.parse(i.body)), resposta(200, { recebidas: 1 })) });
  assert.deepEqual(corpo, { mensagens: [{ id: '1' }] });
});
