'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lerQuadro, mensagemDoQuadro, Vistos } = require('../src/sendbird');

// A forma conferida em 04/11/2026 (valores inventados): MESG com o remetente em user.metadata.type.
const quadro = (tipo, extra = {}) =>
  `MESG${JSON.stringify({
    msg_id: 9001,
    channel_url: 'sendbird_gc_cm_aaaaaaaa-1111-2222-3333-444444444444_bbbbbbbb-5555-6666-7777-888888888888',
    channel_type: 'group',
    user: { id: 77, name: 'Carine S.', guest_id: 'g-1', metadata: { type: tipo, userType: 'x' }, is_bot: false },
    message: 'Ok',
    custom_type: '',
    is_guest_msg: true,
    ts: 1762304344505,
    ...extra,
  })}`;

test('lê o comando e o JSON do quadro; o resto não é quadro', () => {
  assert.deepEqual(lerQuadro('PING{"id":1}'), { cmd: 'PING', corpo: { id: 1 } });
  assert.equal(lerQuadro('MESG{quebrado'), null);
  assert.equal(lerQuadro(''), null);
  assert.equal(lerQuadro(undefined), null);
  assert.equal(lerQuadro('mesg{"a":1}'), null); // comando é em maiúsculas
});

test('mensagem do cliente e da loja; o nome só do cliente', () => {
  const c = mensagemDoQuadro(lerQuadro(quadro('CUSTOMER')));
  assert.deepEqual(c, {
    id: '9001',
    autor: 'cliente',
    texto: 'Ok',
    canalDoChat: 'sendbird_gc_cm_aaaaaaaa-1111-2222-3333-444444444444_bbbbbbbb-5555-6666-7777-888888888888',
    cliente: 'Carine S.',
    em: 1762304344505,
  });
  const l = mensagemDoQuadro(lerQuadro(quadro('MERCHANT', { message: 'seu pedido esta a caminho' })));
  assert.equal(l.autor, 'loja');
  assert.equal(l.cliente, null);
});

test('fora: outro comando, remetente desconhecido, sem texto, apagada, sem id', () => {
  assert.equal(mensagemDoQuadro(lerQuadro('READ{"msg_id":1}')), null);
  assert.equal(mensagemDoQuadro(lerQuadro(quadro('ADMIN'))), null);
  assert.equal(mensagemDoQuadro(lerQuadro(quadro('CUSTOMER', { message: '   ' }))), null);
  assert.equal(mensagemDoQuadro(lerQuadro(quadro('CUSTOMER', { is_removed: true }))), null);
  assert.equal(mensagemDoQuadro(lerQuadro(quadro('CUSTOMER', { msg_id: null }))), null);
  assert.equal(mensagemDoQuadro(lerQuadro('MESG{"msg_id":1,"message":"oi"}')), null); // sem user
});

test('a mesma mensagem (uma por conexão) passa uma vez só; a lista não cresce sem fim', () => {
  const v = new Vistos(3);
  assert.equal(v.novo('1'), true);
  assert.equal(v.novo('1'), false);
  v.novo('2');
  v.novo('3');
  v.novo('4'); // o "1" sai
  assert.equal(v.ids.size, 3);
  assert.equal(v.novo('1'), true);
});
