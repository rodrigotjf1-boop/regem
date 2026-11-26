'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { FilaDeEntrada } = require('../src/fila-entrada');
const { criarGuardaCifrada } = require('../src/fila-em-disco');

// A FILA DE ENTRADA EM DISCO (0.8.0; análise de rede de 25–26/11/2026): a fila ficava só na memória e um reinício do PC
// no meio de uma queda perdia mensagem de cliente. Agora vai a um arquivo CIFRADO pelo Windows (aqui, um cofre de mentira
// que embaralha os bytes — o que importa é que o texto do cliente não vai em claro).

const msg = (i) => ({ canal: 'ifood', id: String(i), autor: 'cliente', texto: `mensagem do cliente ${i}` });
const cofreDeMentira = (disponivel = true) => ({
  isEncryptionAvailable: () => disponivel,
  encryptString: (s) => Buffer.from(Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)),
  decryptString: (b) => Buffer.from(Buffer.from(b).map((x) => x ^ 0x5a)).toString('utf8'),
});
const pasta = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ponte-fila-'));

test('reinício no meio de uma queda: o que não chegou à nuvem volta para a fila e sai quando a internet volta', async () => {
  const dir = pasta();
  try {
    const arq = path.join(dir, 'fila-de-entrada.bin');
    const guarda = criarGuardaCifrada(arq, cofreDeMentira());
    const caiu = new FilaDeEntrada(async () => ({ ok: false }), { guarda }); // sem internet
    caiu.por(msg(1), true);
    caiu.por(msg(2), true);
    assert.equal(await caiu.descarregar(true), 0);
    assert.ok(fs.existsSync(arq));
    // o texto do cliente não fica em claro no disco
    assert.equal(fs.readFileSync(arq).toString('utf8').includes('mensagem do cliente'), false);

    // a ponte (ou o PC) reiniciou: a fila nova relê o arquivo
    const enviados = [];
    const voltou = new FilaDeEntrada(async (l) => (enviados.push(...l.map((m) => m.id)), { ok: true }), { guarda });
    assert.deepEqual(voltou.itens.map((m) => m.id), ['1', '2']);
    assert.equal(await voltou.descarregar(true), 2);
    assert.deepEqual(enviados, ['1', '2']);
    // tudo chegou: o arquivo some (só fica no disco o que ainda não chegou)
    assert.equal(fs.existsSync(arq), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a ponte desligada nos ajustes esvazia a fila e apaga o arquivo; desligada, nada entra nem vai ao disco', async () => {
  const dir = pasta();
  try {
    const arq = path.join(dir, 'fila-de-entrada.bin');
    const f = new FilaDeEntrada(async () => ({ ok: false }), { guarda: criarGuardaCifrada(arq, cofreDeMentira()) });
    f.por(msg(1), true);
    assert.ok(fs.existsSync(arq));
    assert.equal(await f.descarregar(false), 0);
    assert.equal(fs.existsSync(arq), false);
    assert.equal(f.por(msg(2), false), false);
    assert.equal(fs.existsSync(arq), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sem a cifra do Windows: nada é gravado em texto aberto (a fila segue só na memória, como antes)', () => {
  const dir = pasta();
  try {
    const arq = path.join(dir, 'fila-de-entrada.bin');
    const guarda = criarGuardaCifrada(arq, cofreDeMentira(false));
    const f = new FilaDeEntrada(async () => ({ ok: false }), { guarda });
    f.por(msg(1), true);
    assert.equal(f.itens.length, 1);
    assert.equal(fs.existsSync(arq), false);
    assert.deepEqual(guarda.carregar(), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('arquivo estragado ou de outro usuário (não decifra): a fila começa vazia, sem quebrar a ponte; o teto de 1.000 vale ao reler', () => {
  const dir = pasta();
  try {
    const arq = path.join(dir, 'fila-de-entrada.bin');
    fs.writeFileSync(arq, 'lixo que não decifra');
    const quebrado = { ...cofreDeMentira(), decryptString: () => { throw new Error('não é deste usuário'); } };
    assert.equal(new FilaDeEntrada(async () => ({ ok: true }), { guarda: criarGuardaCifrada(arq, quebrado) }).itens.length, 0);
    const guarda = criarGuardaCifrada(arq, cofreDeMentira());
    guarda.guardar(Array.from({ length: 12 }, (_, i) => msg(i)));
    const f = new FilaDeEntrada(async () => ({ ok: true }), { guarda, maximo: 10 });
    assert.deepEqual(f.itens.map((m) => m.id), ['2', '3', '4', '5', '6', '7', '8', '9', '10', '11']); // as mais velhas saem
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
