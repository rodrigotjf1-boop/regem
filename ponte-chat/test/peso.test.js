'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ligarLeitor } = require('../src/leitor');
const { ligarLeitor99 } = require('../src/leitor-99');
const { LIMITES_DA_ESCUTA } = require('../src/limites-da-escuta');
const { pesoDasMetricas } = require('../src/peso');

// A PONTE MAIS LEVE (0.7.9) — pedido do dono em 25/11/2026 ("está usando muito processador e memória"; medido no servidor
// da loja, um i5 650: a ponte com 15% da CPU da máquina e 1,15 GB).

// Um depurador que só anota os comandos (o leitor liga a escuta assim que nasce).
function depuradorQueAnota() {
  const comandos = [];
  return {
    comandos,
    isAttached: () => true,
    attach() {},
    on() {},
    async sendCommand(metodo, p, sid) {
      comandos.push({ metodo, p, sid });
      return {};
    },
  };
}

test('a escuta do Gestor e a da 99 ligam a rede COM limite — antes, sem limite, o Chromium guardava o corpo de toda resposta', async () => {
  const dbgIfood = depuradorQueAnota();
  const leitor = ligarLeitor({ debugger: dbgIfood }, { aoChegar() {} });
  await leitor.pronto;
  const dbg99 = depuradorQueAnota();
  const leitor99 = ligarLeitor99({ debugger: dbg99 }, { aoChegar() {}, env: {} });
  await leitor99.pronto;
  for (const [nome, dbg] of [['iFood', dbgIfood], ['99', dbg99]]) {
    const enable = dbg.comandos.filter((c) => c.metodo === 'Network.enable');
    assert.equal(enable.length, 1, `${nome}: liga a rede uma vez`);
    assert.deepEqual(enable[0].p, { maxTotalBufferSize: 16 * 1024 * 1024, maxResourceBufferSize: 3 * 1024 * 1024 }, nome);
  }
  // o limite por resposta cabe o maior corpo que a ponte aceita ler (2 MB — acima disso o leitor anota `corpo_fora`)
  assert.ok(LIMITES_DA_ESCUTA.maxResourceBufferSize > 2000000);
  assert.ok(Object.isFrozen(LIMITES_DA_ESCUTA));
});

test('o peso: soma os processos da ponte, CPU em % da MÁQUINA (o Electron dá % de um núcleo) e memória em MB', () => {
  const metricas = [
    { type: 'Browser', cpu: { percentCPUUsage: 2 }, memory: { workingSetSize: 150 * 1024 } },
    { type: 'Tab', cpu: { percentCPUUsage: 28 }, memory: { workingSetSize: 414 * 1024 } }, // o Gestor
    { type: 'Tab', cpu: { percentCPUUsage: 6 }, memory: { workingSetSize: 204 * 1024 } }, // a 99
    { type: 'GPU', cpu: { percentCPUUsage: 25.6 }, memory: { workingSetSize: 119 * 1024 } },
    { type: 'Utility', cpu: {}, memory: {} }, // campo faltando não quebra a conta
  ];
  const p = pesoDasMetricas(metricas, 4);
  assert.deepEqual(
    { processos: p.processos, cpuPct: p.cpuPct, memoriaMb: p.memoriaMb, nucleos: p.nucleos },
    { processos: 5, cpuPct: 15.4, memoriaMb: 887, nucleos: 4 },
  );
  assert.deepEqual(p.porTipo.Tab, { processos: 2, cpuPct: 8.5, memoriaMb: 618 });
  assert.deepEqual(p.porTipo.GPU, { processos: 1, cpuPct: 6.4, memoriaMb: 119 });
  assert.deepEqual(p.porTipo.Utility, { processos: 1, cpuPct: 0, memoriaMb: 0 });
});

test('o peso sem medida: lista vazia ou núcleos desconhecidos não quebram (vale 1 núcleo)', () => {
  assert.deepEqual(pesoDasMetricas(undefined, 0), { processos: 0, cpuPct: 0, memoriaMb: 0, nucleos: 1, porTipo: {} });
  assert.equal(pesoDasMetricas([{ type: 'Tab', cpu: { percentCPUUsage: 10 } }], undefined).cpuPct, 10);
});
