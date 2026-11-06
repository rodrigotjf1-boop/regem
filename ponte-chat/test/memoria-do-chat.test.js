'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MemoriaDoChat, FOLGA_MS } = require('../src/memoria-do-chat');

const P = 'aaaaaaaa-1111-2222-3333-444444444444';
const canal = (p) => `sendbird_gc_cm_${p}_bbbbbbbb-5555-6666-7777-888888888888`;
const msg = (o) => ({ id: '1', autor: 'loja', texto: 'Seu pedido saiu para entrega!', canalDoChat: canal(P), pedidoExterno: P, em: 10_000_000, avisoDaPlataforma: false, ...o });

test('acha a mensagem da LOJA com o mesmo texto na conversa do pedido, de "desde" em diante (com a folga dos relógios)', () => {
  const m = new MemoriaDoChat();
  assert.equal(m.guardar(msg({ id: '41' })), true);
  assert.deepEqual(m.jaEnviada({ pedidoExterno: P.toUpperCase(), texto: '  Seu pedido   saiu para entrega! ', desde: 10_000_000 }), { id: '41', em: 10_000_000 });
  // nasceu um pouco DEPOIS (relógio da nuvem adiantado): dentro da folga ainda vale
  assert.ok(m.jaEnviada({ pedidoExterno: P, texto: 'Seu pedido saiu para entrega!', desde: 10_000_000 + FOLGA_MS - 1 }));
  // a mensagem é mais velha que o aviso (fora da folga): é OUTRA vez, não conta
  assert.equal(m.jaEnviada({ pedidoExterno: P, texto: 'Seu pedido saiu para entrega!', desde: 10_000_000 + FOLGA_MS + 1 }), null);
  // outro texto, outro pedido: não
  assert.equal(m.jaEnviada({ pedidoExterno: P, texto: 'Seu pedido chegou', desde: 0 }), null);
  assert.equal(m.jaEnviada({ pedidoExterno: 'cccccccc-1111-2222-3333-444444444444', texto: 'Seu pedido saiu para entrega!', desde: 0 }), null);
});

test('só a loja: o cliente nunca conta; a CONTA da loja só pelo texto exato (ERR-381); repetida não entra duas vezes', () => {
  const m = new MemoriaDoChat();
  assert.equal(m.guardar(msg({ id: '1', autor: 'cliente' })), false);
  assert.equal(m.jaEnviada({ pedidoExterno: P, texto: 'Seu pedido saiu para entrega!', desde: 0 }), null);
  // o aviso automático do iFood (a conta da loja, OUTRO texto) entra, mas nunca vale como "já enviada" do nosso texto
  assert.equal(m.guardar(msg({ id: '2', avisoDaPlataforma: true, texto: 'Sua loja não costuma responder... Taxa de resposta 53%' })), true);
  assert.equal(m.jaEnviada({ pedidoExterno: P, texto: 'Seu pedido saiu para entrega!', desde: 0 }), null);
  // a 1ª mensagem de uma conversa nova volta pela conta da loja (a mesma cara do aviso): com o NOSSO texto, vale
  assert.equal(m.guardar(msg({ id: '4', avisoDaPlataforma: true })), true);
  assert.deepEqual(m.jaEnviada({ pedidoExterno: P, texto: 'Seu pedido saiu para entrega!', desde: 0 }), { id: '4', em: 10_000_000 });
  const m2 = new MemoriaDoChat();
  assert.equal(m2.guardar(msg({ id: '3' })), true);
  assert.equal(m2.guardar(msg({ id: '3' })), false); // a mesma (veio ao vivo e no histórico)
  assert.equal(m2.conversas.get(P).length, 1);
  assert.equal(m2.guardar(null), false);
});

test('(antigo, mantido) repetida não entra duas vezes', () => {
  const m = new MemoriaDoChat();
  assert.equal(m.guardar(msg({ id: '3' })), true);
  assert.equal(m.guardar(msg({ id: '3' })), false); // a mesma (veio ao vivo e no histórico)
  assert.equal(m.conversas.get(P).length, 1);
  assert.equal(m.guardar(null), false);
  assert.equal(m.guardar(msg({ id: '' })), false);
});

test('sem a hora da mensagem, vale a hora em que a ponte a viu; e a memória tem teto', () => {
  let agora = 50_000;
  const m = new MemoriaDoChat({ conversas: 2, porConversa: 2, agora: () => agora });
  m.guardar(msg({ id: '1', em: null }));
  assert.ok(m.jaEnviada({ pedidoExterno: P, texto: 'Seu pedido saiu para entrega!', desde: 50_000 }));
  m.guardar(msg({ id: '2', texto: 'b' }));
  m.guardar(msg({ id: '3', texto: 'c' })); // o 1º sai (2 por conversa)
  assert.equal(m.conversas.get(P).length, 2);
  assert.equal(m.jaEnviada({ pedidoExterno: P, texto: 'Seu pedido saiu para entrega!', desde: 0 }), null);
  m.guardar(msg({ id: '4', pedidoExterno: 'p2', canalDoChat: 'x' }));
  m.guardar(msg({ id: '5', pedidoExterno: 'p3', canalDoChat: 'y' })); // a conversa mais velha sai (2 conversas)
  assert.equal(m.conversas.size, 2);
  assert.ok(!m.conversas.has(P));
});
