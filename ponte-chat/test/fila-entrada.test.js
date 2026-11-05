'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FilaDeEntrada } = require('../src/fila-entrada');

const msg = (i) => ({ canal: 'ifood', id: String(i), autor: 'cliente', texto: `m${i}` });

test('desligada: nada entra e nada sai (conversa de cliente não fica no PC)', async () => {
  const enviados = [];
  const f = new FilaDeEntrada(async (l) => (enviados.push(l), { ok: true }));
  assert.equal(f.por(msg(1), false), false);
  assert.equal(f.itens.length, 0);
  f.por(msg(2), true);
  assert.equal(await f.descarregar(false), 0); // desligou depois: esvazia sem mandar
  assert.equal(f.itens.length, 0);
  assert.equal(enviados.length, 0);
});

test('ligada: manda em lotes do tamanho da rota, na ordem', async () => {
  const enviados = [];
  const f = new FilaDeEntrada(async (l) => (enviados.push(l.map((m) => m.id)), { ok: true }), { lote: 2 });
  for (let i = 1; i <= 5; i++) f.por(msg(i), true);
  assert.equal(await f.descarregar(true), 5);
  assert.deepEqual(enviados, [['1', '2'], ['3', '4'], ['5']]);
  assert.equal(f.itens.length, 0);
});

test('falhou (sem nuvem): o lote fica para a próxima volta; erro lançado conta como falha', async () => {
  let vez = 0;
  const f = new FilaDeEntrada(async () => {
    vez++;
    if (vez === 1) return { ok: false };
    if (vez === 2) throw new Error('rede');
    return { ok: true };
  });
  f.por(msg(1), true);
  assert.equal(await f.descarregar(true), 0);
  assert.equal(await f.descarregar(true), 0);
  assert.equal(f.itens.length, 1);
  assert.equal(await f.descarregar(true), 1);
});

test('muito tempo sem nuvem: as mais velhas saem (teto)', () => {
  const f = new FilaDeEntrada(async () => ({ ok: true }), { maximo: 3 });
  for (let i = 1; i <= 5; i++) f.por(msg(i), true);
  assert.deepEqual(f.itens.map((m) => m.id), ['3', '4', '5']);
  assert.equal(f.descartadas, 2);
});

test('uma descarga por vez', async () => {
  let soltar;
  const f = new FilaDeEntrada(() => new Promise((r) => (soltar = () => r({ ok: true }))));
  f.por(msg(1), true);
  const a = f.descarregar(true);
  assert.equal(await f.descarregar(true), 0);
  soltar();
  assert.equal(await a, 1);
});
