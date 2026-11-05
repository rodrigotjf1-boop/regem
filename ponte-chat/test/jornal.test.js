'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Jornal } = require('../src/jornal');

const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ponte-jornal-'));

test('anota apertou, eco e fim; reaberto (o programa caiu e voltou), lembra de tudo — sem texto no arquivo', () => {
  const arq = path.join(pasta(), 'envios.jsonl');
  const j = new Jornal(arq);
  j.apertou('id-1');
  j.eco('id-1', '9001');
  j.apertou('id-2'); // apertou e caiu: sem eco
  j.fim('id-1');
  const de1 = j.de('id-1');
  assert.ok(de1.apertouEm && de1.ecoId === '9001' && de1.fimEm);
  const outro = new Jornal(arq);
  assert.equal(outro.de('id-1').ecoId, '9001');
  assert.ok(outro.de('id-2').apertouEm);
  assert.equal(outro.de('id-2').ecoId, undefined);
  assert.equal(outro.de('nunca'), undefined);
  const txt = fs.readFileSync(arq, 'utf8');
  assert.ok(!/saiu|entrega|pedido/i.test(txt), 'o diário não guarda texto');
});

test('linha cortada (o PC desligou no meio) não derruba a leitura; o arquivo tem teto', () => {
  const arq = path.join(pasta(), 'envios.jsonl');
  fs.writeFileSync(arq, '{"t":1,"ev":"apertou","id":"a"}\n{"t":2,"ev":"eco","id":"a","eco":"7"}\n{"t":3,"ev":"apert');
  const j = new Jornal(arq, { max: 3 });
  assert.equal(j.de('a').ecoId, '7');
  for (let i = 0; i < 10; i++) j.apertou(`x-${i}`);
  assert.ok(j.envios.size <= 3);
  const reaberto = new Jornal(arq, { max: 3 });
  assert.ok(reaberto.de('x-9') && reaberto.de('x-9').apertouEm, 'o mais recente fica');
  assert.equal(reaberto.de('x-0'), undefined, 'o mais velho saiu');
  assert.ok(fs.readFileSync(arq, 'utf8').trim().split('\n').length <= 6 + 1);
});
