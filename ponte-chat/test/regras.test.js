'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { TEXTO_MAX, CONTATO_PROIBIDO, motivoParaNaoEnviar } = require('../src/regras');

test('V74: a regra do contato e o limite são OS MESMOS da nuvem (texto-do-chat.ts)', () => {
  const ts = fs.readFileSync(path.join(__dirname, '..', '..', 'backend', 'src', 'modules', 'ponte-chat', 'texto-do-chat.ts'), 'utf8');
  const daNuvem = /return (\/.+\/i)\.test\(texto\);/.exec(ts);
  assert.ok(daNuvem, 'a regra da nuvem mudou de forma — confira as duas');
  assert.equal(String(CONTATO_PROIBIDO), daNuvem[1]);
  assert.equal(Number(/export const TEXTO_MAX = (\d+);/.exec(ts)[1]), TEXTO_MAX);
});

test('o que pode sair e o que não pode', () => {
  assert.equal(motivoParaNaoEnviar('Seu pedido saiu para entrega! Chega por volta das 20h15.'), null);
  assert.equal(motivoParaNaoEnviar('   '), 'escreva o texto');
  assert.match(motivoParaNaoEnviar('Chama no whats'), /proíbem/);
  assert.match(motivoParaNaoEnviar('Liga (21) 99999-1234'), /proíbem/);
  assert.match(motivoParaNaoEnviar('veja em www.loja.com.br'), /proíbem/);
  assert.match(motivoParaNaoEnviar('x'.repeat(301)), /no máximo 300/);
  assert.equal(motivoParaNaoEnviar('Em instantes chega'), null); // "instantes" não é Instagram
});
