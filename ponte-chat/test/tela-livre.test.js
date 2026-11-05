'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { INSTALAR_VIGIA, ESTADO_DA_TELA, avaliarTela, mexeuDesde } = require('../src/tela-livre');

const tela = (o) => ({ vigia: true, acaoEm: 0, vigiaDesde: 0, cartoes: 3, campoComTexto: false, ...o });

test('livre = no quadro, sem rascunho no campo e ninguém mexendo há o tempo da parada', () => {
  const agora = 1_000_000;
  assert.deepEqual(avaliarTela(tela({ acaoEm: agora - 20_000 }), { agora, paradaMs: 10_000 }), { ok: true });
  assert.match(avaliarTela(tela({ acaoEm: agora - 2_000 }), { agora, paradaMs: 10_000 }).motivo, /usando o Gestor/);
  // a tecla pela janela (o Electron conta) também vale
  assert.match(avaliarTela(tela({ acaoEm: 0 }), { agora, ultimaTeclaEm: agora - 1_000, paradaMs: 10_000 }).motivo, /usando o Gestor/);
  // vigia recém-posto (a página recarregou): o que houve antes ninguém viu — espera a parada inteira
  assert.match(avaliarTela(tela({ vigiaDesde: agora - 3_000 }), { agora, paradaMs: 10_000 }).motivo, /usando o Gestor/);
  assert.match(avaliarTela(tela({ cartoes: 0 }), { agora }).motivo, /quadro "Pedidos"/);
  assert.match(avaliarTela(tela({ campoComTexto: true }), { agora }).motivo, /texto no campo/);
  assert.match(avaliarTela(tela({ vigia: false }), { agora }).motivo, /vigia/);
  assert.match(avaliarTela(null, { agora }).motivo, /não respondeu/);
});

test('"mexeu desde": a última conferência antes de apertar; sem resposta da página, conta como mexeu (não aperta)', () => {
  assert.equal(mexeuDesde(tela({ acaoEm: 500 }), 1000, 0), false);
  assert.equal(mexeuDesde(tela({ acaoEm: 1500 }), 1000, 0), true);
  assert.equal(mexeuDesde(tela({ acaoEm: 0 }), 1000, 1200), true);
  assert.equal(mexeuDesde(null, 1000, 0), true);
});

test('os roteiros da página compilam', () => {
  for (const s of [INSTALAR_VIGIA, ESTADO_DA_TELA]) assert.doesNotThrow(() => new Function(`return ${s};`));
});
