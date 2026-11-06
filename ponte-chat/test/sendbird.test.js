'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { lerQuadro, mensagemDoQuadro, mensagensDaResposta, pedidoDoCanal, lojaDoCanal, ehAvisoDoIfood, Vistos } = require('../src/sendbird');

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
    pedidoExterno: 'aaaaaaaa-1111-2222-3333-444444444444',
    cliente: 'Carine S.',
    em: 1762304344505,
    avisoDaPlataforma: false,
    avisoDoIfood: false,
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

test('o pedido vem do canal (sendbird_gc_cm_<pedido>_<loja>); canal de outra forma não inventa pedido', () => {
  assert.equal(pedidoDoCanal('sendbird_gc_cm_aaaaaaaa-1111-2222-3333-444444444444_bbbbbbbb-5555-6666-7777-888888888888'), 'aaaaaaaa-1111-2222-3333-444444444444');
  assert.equal(pedidoDoCanal('sendbird_gc_xx_aaaaaaaa-1111-2222-3333-444444444444_b'), null);
  assert.equal(pedidoDoCanal('sendbird_gc_cm_123_456'), null);
  assert.equal(pedidoDoCanal('sendbird_gc_cm_aaaaaaaa-1111-2222-3333-444444444444'), null); // sem a loja
  assert.equal(pedidoDoCanal(null), null);
  const semPedido = mensagemDoQuadro(lerQuadro(quadro('CUSTOMER', { channel_url: 'outro_formato' })));
  assert.equal(semPedido.pedidoExterno, null);
});

test('v0.4: o AVISO AUTOMÁTICO do iFood (MERCHANT mandado pela CONTA da loja — o 2º id do canal) vem marcado', () => {
  const LOJA = 'bbbbbbbb-5555-6666-7777-888888888888';
  assert.equal(lojaDoCanal(`sendbird_gc_cm_aaaaaaaa-1111-2222-3333-444444444444_${LOJA}`), LOJA);
  assert.equal(lojaDoCanal('outro'), null);
  // visto ao vivo em 05/11 (#8916): o "…pedidos nos últimos 30 dias" chega com o remetente = o id da loja
  const aviso = mensagemDoQuadro(lerQuadro(quadro('MERCHANT', { user: { id: 1, guest_id: LOJA.toUpperCase(), metadata: { type: 'MERCHANT' } }, message: 'O cliente fez 3 pedidos nos últimos 30 dias' })));
  assert.equal(aviso.avisoDaPlataforma, true);
  assert.equal(aviso.avisoDoIfood, true); // fica fora do Atendimento
  assert.equal(aviso.autor, 'loja');
  // a equipe (outro usuário da loja) e o cliente não são aviso
  const equipe = mensagemDoQuadro(lerQuadro(quadro('MERCHANT', { user: { id: 2, guest_id: 'usuario-do-gestor', metadata: { type: 'MERCHANT' } }, message: 'boa noite' })));
  assert.equal(equipe.avisoDaPlataforma, false);
  assert.equal(equipe.avisoDoIfood, false);
  const doCliente = mensagemDoQuadro(lerQuadro(quadro('CUSTOMER', { user: { id: 3, guest_id: LOJA, metadata: { type: 'CUSTOMER' } } })));
  assert.equal(doCliente.avisoDaPlataforma, false);
  assert.equal(doCliente.avisoDoIfood, false);
});

test('06/11: a 1ª fala da EQUIPE numa conversa nova chega pela conta da loja — vai ao Atendimento; o aviso do iFood, não', () => {
  const LOJA = 'bbbbbbbb-5555-6666-7777-888888888888';
  const pelaConta = (texto) =>
    mensagemDoQuadro(lerQuadro(quadro('MERCHANT', { user: { id: 1, guest_id: LOJA, metadata: { type: 'MERCHANT' } }, message: texto })));
  const primeira = pelaConta('Oi Carine, seu lanche já está saindo!');
  assert.equal(primeira.autor, 'loja');
  assert.equal(primeira.avisoDaPlataforma, true); // da conta da loja: o eco só vale pelo texto exato (ERR-381)
  assert.equal(primeira.avisoDoIfood, false); // não é aviso: vai à nuvem como fala da loja
  for (const aviso of [
    'O cliente fez 3 pedidos nos últimos 30 dias',
    'Cliente fez 1 pedido nos ultimos 90 dias na sua loja',
    'Este é o primeiro pedido do cliente na sua loja',
    'Sua loja não costuma responder… Taxa de resposta 53%',
  ])
    assert.equal(pelaConta(aviso).avisoDoIfood, true, aviso);
  // o texto da equipe que fala de pedido não é confundido com o aviso
  for (const fala of ['Seu pedido saiu para entrega!', 'Pode deixar, já já chega', 'Você pediu 2 pedidos? Confere?'])
    assert.equal(ehAvisoDoIfood(fala), false, fala);
});

test('v0.4: o HISTÓRICO da conversa (`…/messages`) vira mensagens no mesmo formato; só as de texto', () => {
  const canal = 'sendbird_gc_cm_aaaaaaaa-1111-2222-3333-444444444444_bbbbbbbb-5555-6666-7777-888888888888';
  const r = mensagensDaResposta({
    messages: [
      { type: 'MESG', message_id: 41, message: 'Seu pedido saiu para entrega!', channel_url: canal, created_at: 1000, user: { user_id: 'gestor-1', metadata: { type: 'MERCHANT' } } },
      { type: 'MESG', message_id: 42, message: 'Obrigada', channel_url: canal, created_at: 2000, user: { user_id: 'c-1', nickname: 'Carine S.', metadata: { type: 'CUSTOMER' } } },
      { type: 'ADMM', message_id: 43, message: 'aviso do sistema', channel_url: canal, created_at: 3000 },
      { type: 'MESG', message_id: 44, message: 'apagada', channel_url: canal, is_removed: true, user: { user_id: 'gestor-1', metadata: { type: 'MERCHANT' } } },
      null,
    ],
    has_next: false,
  });
  assert.deepEqual(r.map((m) => [m.id, m.autor, m.em, m.pedidoExterno]), [
    ['41', 'loja', 1000, 'aaaaaaaa-1111-2222-3333-444444444444'],
    ['42', 'cliente', 2000, 'aaaaaaaa-1111-2222-3333-444444444444'],
  ]);
  assert.equal(r[1].cliente, 'Carine S.');
  assert.deepEqual(mensagensDaResposta(null), []);
  assert.deepEqual(mensagensDaResposta({ messages: 'x' }), []);
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
