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

test('pausar guarda a hora (a 1ª pausa vale) e fica depois de reabrir; retomar apaga; esquecer o pareamento não retoma', () => {
  const dir = pasta();
  const c = new Configuracao(dir, cofre());
  assert.equal(c.pausadaEm(), null);
  const h1 = c.pausar(true, new Date('2026-11-05T17:32:00Z'));
  assert.equal(h1, '2026-11-05T17:32:00.000Z');
  // pausar de novo não troca a hora
  assert.equal(c.pausar(true, new Date('2026-11-05T18:00:00Z')), h1);
  // o programa reaberto (outra instância lendo o mesmo arquivo) segue pausado
  assert.equal(new Configuracao(dir, cofre()).pausadaEm(), h1);
  c.guardarPareamento({ terminalId: 'id', segredo: 's' });
  c.esquecerPareamento();
  assert.equal(c.pausadaEm(), h1);
  assert.equal(c.pausar(false), null);
  assert.equal(new Configuracao(dir, cofre()).pausadaEm(), null);
  // hora estragada no arquivo não conta como pausa
  fs.writeFileSync(path.join(dir, 'ponte.json'), JSON.stringify({ pausadaEm: 'ontem' }));
  assert.equal(c.pausadaEm(), null);
});

test('a 99 lida neste PC (4a): fica guardada (reabre ao reiniciar) e "parar" esquece; nada além do sim/não no arquivo', () => {
  const dir = pasta();
  const c = new Configuracao(dir, cofre());
  assert.equal(c.usar99(), false);
  assert.equal(c.marcarUsar99(true), true);
  assert.equal(new Configuracao(dir, cofre()).usar99(), true);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'ponte.json'), 'utf8')), { usar99: true });
  c.marcarUsar99(false);
  assert.equal(new Configuracao(dir, cofre()).usar99(), false);
  fs.writeFileSync(path.join(dir, 'ponte.json'), JSON.stringify({ usar99: 'sim' }));
  assert.equal(c.usar99(), false); // só o verdadeiro conta
});

test('"Responder pela 99" (4b): nasce desligado, só liga com a 99 lida neste PC, fica guardado; parar de ler a 99 desliga', () => {
  const dir = pasta();
  const c = new Configuracao(dir, cofre());
  assert.equal(c.responder99(), false);
  assert.equal(c.marcarResponder99(true), false); // sem a 99 lida neste PC, não liga
  c.marcarUsar99(true);
  assert.equal(c.marcarResponder99(true), true);
  assert.equal(new Configuracao(dir, cofre()).responder99(), true);
  assert.equal(c.marcarResponder99(false), false);
  c.marcarResponder99(true);
  c.marcarUsar99(false); // "Parar de ler a 99 neste PC"
  assert.equal(new Configuracao(dir, cofre()).responder99(), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'ponte.json'), 'utf8')), {});
  // responder sem usar (arquivo editado à mão): não vale
  fs.writeFileSync(path.join(dir, 'ponte.json'), JSON.stringify({ responder99: true }));
  assert.equal(c.responder99(), false);
});
