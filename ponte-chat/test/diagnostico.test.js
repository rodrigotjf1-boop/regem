'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Diagnostico, interessa } = require('../src/diagnostico');

const PEDIDO = 'aaaaaaaa-1111-2222-3333-444444444444';
const OUTRO = 'bbbbbbbb-5555-6666-7777-888888888888';
const CANAL = `sendbird_gc_cm_${PEDIDO}_${OUTRO}`;

test('a marca: o mesmo id dá a mesma marca; outro sal dá outra; nunca o id em claro', () => {
  const a = new Diagnostico(null, 'sal-1', { gravar: false });
  const b = new Diagnostico(null, 'sal-2', { gravar: false });
  assert.equal(a.marca(PEDIDO), a.marca(PEDIDO));
  assert.notEqual(a.marca(PEDIDO), b.marca(PEDIDO));
  assert.equal(a.marca(PEDIDO).length, 12);
  assert.equal(a.marca(''), null);
  assert.deepEqual(a.canal(CANAL), ['sendbird', 'gc', 'cm', a.marca(PEDIDO), a.marca(OUTRO)]);
});

test('o chat do pedido e a mensagem se cruzam pela marca — sem texto, nome ou telefone no arquivo', () => {
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'diag-')), 'diagnostico.jsonl');
  const d = new Diagnostico(arq, 'sal');
  d.mesg({ msg_id: 1, channel_url: CANAL, user: { id: 9, name: 'Carine Souza', guest_id: 'g', metadata: { type: 'CUSTOMER' } }, message: 'Ok, obrigada', data: '' });
  d.resposta(`https://order-manager-api.ifood.com.br/orderManager/v1.0/chat/orders/${PEDIDO}`, {
    orderId: PEDIDO,
    channelUrl: CANAL,
    customer: { name: 'Carine Souza', phone: '0800 705 0505', id: OUTRO },
  });
  const txt = fs.readFileSync(arq, 'utf8');
  for (const proibido of ['Carine', 'Souza', 'obrigada', '0800', PEDIDO, OUTRO]) assert.ok(!txt.includes(proibido), `vazou: ${proibido}`);
  const [m, r] = txt.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(m.tipo, 'CUSTOMER');
  assert.deepEqual(m.canal, d.canal(CANAL));
  assert.equal(r.url, `order-manager-api.ifood.com.br/orderManager/v1.0/chat/orders/<${d.marca(PEDIDO)}>`);
  assert.ok(r.ids.some((x) => x.caminho === 'channelUrl' && JSON.stringify(x.canal) === JSON.stringify(d.canal(CANAL))));
  assert.ok(r.ids.some((x) => x.caminho === 'customer.id' && x.marca === d.marca(OUTRO)));
  assert.ok(!r.ids.some((x) => x.caminho === 'customer.phone'));
});

test('o data da mensagem: JSON vira as chaves (e os ids como marca); texto vira o tamanho', () => {
  const d = new Diagnostico(null, 'sal', { gravar: false });
  assert.deepEqual(d.formaDoData(JSON.stringify({ orderId: PEDIDO, obs: 'sem cebola' })), { json: ['orderId', 'obs'], ids: [{ caminho: 'orderId', marca: d.marca(PEDIDO) }] });
  assert.equal(d.formaDoData('qualquer'), '<texto 8>');
  assert.equal(d.formaDoData(''), '');
});

test('o arquivo tem teto: passou, o anterior vira .1', () => {
  const arq = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'diag-')), 'd.jsonl');
  const d = new Diagnostico(arq, 'sal', { maxBytes: 200 });
  for (let i = 0; i < 10; i++) d.anotar({ ev: 'x', i });
  assert.ok(fs.existsSync(`${arq}.1`));
  assert.ok(fs.statSync(arq).size < 400);
});

test('interessam: a API de pedidos do Gestor, os pedidos e toda a API do chat; o resto não', () => {
  assert.equal(interessa(`https://order-manager-api.ifood.com.br/orderManager/v1.0/chat/orders/${PEDIDO}`), true);
  assert.equal(interessa('https://order-manager-api.ifood.com.br/orderManager/v1.0/qualquer'), true);
  assert.equal(interessa(`https://merchant-api.ifood.com.br/order/v1.0/orders/${PEDIDO}`), true);
  assert.equal(interessa(`https://api-x.sendbird.com/v3/sdk/group_channels/${CANAL}`), true);
  assert.equal(interessa('https://api-x.sendbird.com/v3/users/123456/my_group_channels'), true);
  assert.equal(interessa('https://merchant-api.ifood.com.br/merchant/v1.0/merchants/x/status/delivery'), false);
  assert.equal(interessa('https://merchant-api.ifood.com.br/order/v1.0/events:polling'), false);
  assert.equal(interessa('https://api.amplitude.com/'), false);
});

test('a chamada anota o método e a forma do endereço, com os ids em marca', () => {
  const d = new Diagnostico(null, 'sal', { gravar: false });
  d.chamada('GET', `https://order-manager-api.ifood.com.br/orderManager/v1.0/chat/orders/${PEDIDO}?x=1`);
  const l = d.ultimos.at(-1);
  assert.equal(l.ev, 'chamada');
  assert.equal(l.metodo, 'GET');
  assert.equal(l.url, `order-manager-api.ifood.com.br/orderManager/v1.0/chat/orders/<${d.marca(PEDIDO)}>`);
  assert.ok(!JSON.stringify(l).includes(PEDIDO));
});

test('a chamada sem resposta (0.7.8): o erro da rede, o método e a forma do endereço — e se foi a página que desistiu', () => {
  const d = new Diagnostico(null, 'sal', { gravar: false });
  d.falha('POST', 'https://order-manager-api.ifood.com.br/orderManager/v1.0/oauth/token/refresh', { erro: 'net::ERR_INTERNET_DISCONNECTED' });
  assert.deepEqual({ ...d.ultimos.at(-1), t: undefined }, {
    t: undefined,
    ev: 'chamada_falhou',
    metodo: 'POST',
    url: 'order-manager-api.ifood.com.br/orderManager/v1.0/oauth/token/refresh',
    erro: 'net::ERR_INTERNET_DISCONNECTED',
  });
  d.falha('GET', `https://order-manager-api.ifood.com.br/orderManager/v1.0/chat/orders/${PEDIDO}`, { erro: 'net::ERR_ABORTED', cancelada: true, bloqueio: 'mixed-content' });
  const l = d.ultimos.at(-1);
  assert.equal(l.cancelada, true);
  assert.equal(l.bloqueio, 'mixed-content');
  assert.ok(!JSON.stringify(l).includes(PEDIDO), 'o id do pedido vira marca também na falha');
  // sem texto de erro, a linha sai do mesmo jeito (nunca lança)
  d.falha(undefined, 'endereço torto');
  assert.deepEqual([d.ultimos.at(-1).ev, d.ultimos.at(-1).metodo, d.ultimos.at(-1).url, d.ultimos.at(-1).erro], ['chamada_falhou', '', null, '']);
});

test('a resposta leva o status só quando é recusa ou erro (400 em diante)', () => {
  const d = new Diagnostico(null, 'sal', { gravar: false });
  d.resposta('https://order-manager-api.ifood.com.br/orderManager/v1.0/oauth/token/refresh', { code: 'Unauthorized' }, 401);
  assert.equal(d.ultimos.at(-1).status, 401);
  d.resposta('https://order-manager-api.ifood.com.br/orderManager/v1.0/oauth/token/refresh', { accessToken: 'x' }, 200);
  assert.equal('status' in d.ultimos.at(-1), false);
  d.resposta('https://order-manager-api.ifood.com.br/orderManager/v1.0/merchants/experiences', { a: 1 });
  assert.equal('status' in d.ultimos.at(-1), false);
});
