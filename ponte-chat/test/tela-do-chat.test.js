'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { LER_A_TELA, LER_O_QUADRO } = require('../src/tela-do-chat');

// Os dois roteiros rodam DENTRO da página do Gestor (executeJavaScript): erro de sintaxe ali só apareceria no PC da loja.
test('os roteiros da página compilam (sem rodar)', () => {
  assert.doesNotThrow(() => new Function(`return ${LER_A_TELA};`));
  assert.doesNotThrow(() => new Function(`return ${LER_O_QUADRO};`));
});

test('os roteiros só leem: nada de clique, digitação ou envio', () => {
  for (const r of [LER_A_TELA, LER_O_QUADRO]) {
    assert.ok(!/\.click\(|dispatchEvent|\.value\s*=|execCommand|\.submit\(|\.focus\(/.test(r), 'o roteiro mexe na página');
  }
});
