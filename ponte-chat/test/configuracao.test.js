'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Configuracao } = require('../src/configuracao');

// O cofre do Windows de mentira: "cifra" invertendo o texto (o de verdade é o DPAPI).
const cofre = (disponivel = true) => ({
  isEncryptionAvailable: () => disponivel,
  encryptString: (s) => Buffer.from(`c:${[...s].reverse().join('')}`),
  decryptString: (b) => {
    const s = b.toString();
    if (!s.startsWith('c:')) throw new Error('não decifra');
    return [...s.slice(2)].reverse().join('');
  },
});
const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ponte-cfg-'));

test('o pareamento guarda o segredo CIFRADO (nunca em claro) e devolve a credencial', () => {
  const dir = pasta();
  const c = new Configuracao(dir, cofre());
  assert.equal(c.credencial(), null);
  c.guardarPareamento({ terminalId: 'id-1', segredo: 'segredo-claro', nome: 'PC do delivery', unidadeId: 'u-1' });
  const txt = fs.readFileSync(path.join(dir, 'ponte.json'), 'utf8');
  assert.ok(!txt.includes('segredo-claro'));
  assert.deepEqual(c.credencial(), { terminalId: 'id-1', segredo: 'segredo-claro' });
  assert.equal(c.nome(), 'PC do delivery');
});

test('sem a cifra do Windows, não guarda', () => {
  const c = new Configuracao(pasta(), cofre(false));
  assert.throws(() => c.guardarPareamento({ terminalId: 'id', segredo: 's' }), /proteção/);
  assert.equal(c.credencial(), null);
});

test('esquecer (só na revogação) apaga o pareamento e mantém o sal do diagnóstico', () => {
  const dir = pasta();
  const c = new Configuracao(dir, cofre());
  const sal = c.sal();
  assert.equal(c.sal(), sal); // o sal nasce uma vez
  c.guardarPareamento({ terminalId: 'id', segredo: 's', nome: 'PC', unidadeId: 'u' });
  c.esquecerPareamento();
  assert.equal(c.credencial(), null);
  assert.equal(c.sal(), sal);
  // nem o segredo cifrado fica no arquivo
  const guardado = JSON.parse(fs.readFileSync(path.join(dir, 'ponte.json'), 'utf8'));
  assert.deepEqual(Object.keys(guardado).sort(), ['sal']);
});

test('segredo que o Windows não decifra mais (outro usuário): sem credencial, sem quebrar', () => {
  const dir = pasta();
  fs.writeFileSync(path.join(dir, 'ponte.json'), JSON.stringify({ terminalId: 'id', segredoCifrado: Buffer.from('outra-coisa').toString('base64') }));
  assert.equal(new Configuracao(dir, cofre()).credencial(), null);
});

test('arquivo estragado: começa do zero', () => {
  const dir = pasta();
  fs.writeFileSync(path.join(dir, 'ponte.json'), '{quebrado');
  assert.deepEqual(new Configuracao(dir, cofre()).ler(), {});
});
