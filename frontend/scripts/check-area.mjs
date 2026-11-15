// Confere que a conta "o ponto está dentro da área?" da TELA (`src/lib/area-entrega.ts`) é a MESMA do SERVIDOR
// (`backend/src/modules/cardapio/area-de-entrega.ts`) — a tela avisa antes, o servidor decide (V74, mig 425). Transpila os
// dois com o TypeScript que já é dependência e compara milhares de pontos (dentro, fora, perto da borda, polígono côncavo,
// áreas que se cruzam e a pausada). Uso: npm run check:area
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const aqui = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'check-area-'));
const transpilar = (arq, nome) => {
  const js = ts.transpileModule(readFileSync(arq, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText;
  writeFileSync(join(tmp, nome), js);
  return pathToFileURL(join(tmp, nome)).href;
};
try {
  const tela = await import(transpilar(join(aqui, '..', 'src', 'lib', 'area-entrega.ts'), 'tela.mjs'));
  const servidor = await import(transpilar(join(aqui, '..', '..', 'backend', 'src', 'modules', 'cardapio', 'area-de-entrega.ts'), 'servidor.mjs'));
  let n = 0;
  const caso = (nome, fn) => {
    fn();
    n++;
    console.log('  ✓', nome);
  };
  const L = [-22.8436, -43.2784];
  const c = (a, b) => [L[0] + a, L[1] + b];
  const areas = [
    { id: 'a', nome: 'Penha', ordem: 0, ativo: true, taxa: 5, poligono: [c(0.006, -0.008), c(0.007, 0.006), c(-0.002, 0.009), c(-0.007, 0.003), c(-0.005, -0.008)] },
    { id: 'b', nome: 'Olaria', ordem: 1, ativo: true, taxa: 7, poligono: [c(0.013, -0.018), c(0.016, 0.004), c(0.004, 0.02), c(-0.012, 0.016), c(-0.014, -0.006), c(-0.004, -0.02)] },
    { id: 'c', nome: 'U', ordem: 2, ativo: true, taxa: 9, poligono: [c(-0.02, -0.03), c(-0.02, -0.02), c(-0.03, -0.02), c(-0.03, -0.022), c(-0.022, -0.022), c(-0.022, -0.028), c(-0.03, -0.028), c(-0.03, -0.03)] },
    { id: 'd', nome: 'Pausada', ordem: 3, ativo: false, taxa: 11, poligono: [c(0.02, 0.02), c(0.02, 0.03), c(0.03, 0.03)] },
  ];
  // Pontos determinísticos: grade fina + perto de cada canto (a borda é onde contas diferentes divergiriam).
  let semente = 42;
  const aleatorio = () => ((semente = (semente * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pontos = [];
  for (let i = -40; i <= 40; i++) for (let j = -40; j <= 40; j++) pontos.push(c(i * 0.001, j * 0.001));
  for (const a of areas) for (const [la, lo] of a.poligono) for (let k = 0; k < 20; k++) pontos.push([la + (aleatorio() - 0.5) * 1e-5, lo + (aleatorio() - 0.5) * 1e-5]);

  caso(`a mesma resposta "dentro?" para ${pontos.length * areas.length} pares ponto × área`, () => {
    for (const a of areas) for (const [la, lo] of pontos) assert.equal(tela.pontoNoPoligono(la, lo, a.poligono), servidor.pontoNoPoligono(la, lo, a.poligono), `${a.nome} ${la},${lo}`);
  });
  caso('a mesma área escolhida (a de cima, sem a pausada) em todos os pontos', () => {
    for (const [la, lo] of pontos) assert.equal(tela.areaDoPonto(areas, la, lo)?.id ?? null, servidor.areaDoPonto(areas, la, lo)?.id ?? null, `${la},${lo}`);
  });
  caso('os casos conhecidos: loja na Penha (as duas a contêm), Olaria sozinha, o vão do U, a pausada, 119 km', () => {
    assert.equal(tela.areaDoPonto(areas, L[0], L[1]).id, 'a');
    assert.equal(tela.areaDoPonto(areas, ...c(0.009, 0.012)).id, 'b');
    assert.equal(tela.areaDoPonto(areas, ...c(-0.026, -0.025)), null); // o vão do U
    assert.equal(tela.areaDoPonto(areas, ...c(-0.021, -0.025)).id, 'c');
    assert.equal(tela.areaDoPonto(areas, ...c(0.025, 0.028)), null); // só na pausada
    assert.equal(tela.areaDoPonto(areas, -21.77, -43.27), null);
  });
  caso('entradas ruins: menos de 3 cantos, canto não numérico, ponto inválido', () => {
    for (const f of [tela, servidor]) {
      assert.equal(f.pontoNoPoligono(0, 0, [[0, 0], [1, 1]]), false);
      assert.equal(f.pontoNoPoligono(0.5, 0.5, [[0, 0], ['x', 1], [1, 1]]), false);
      assert.equal(f.pontoNoPoligono(NaN, 0, areas[0].poligono), false);
    }
  });
  caso('tempo da área e o círculo das faixas', () => {
    assert.equal(tela.tempoDaArea({ tempoMin: 25, tempoMax: 35 }), '25–35 min');
    assert.equal(tela.tempoDaArea({ tempoMin: 40, tempoMax: 40 }), '~40 min');
    assert.equal(tela.tempoDaArea({ tempoMax: 50 }), '~50 min');
    assert.equal(tela.tempoDaArea({}), null);
    const circ = tela.circuloComoPoligono(L[0], L[1], 1);
    assert.equal(circ.length, 36);
    assert.equal(tela.pontoNoPoligono(L[0], L[1], circ), true);
    assert.equal(tela.pontoNoPoligono(...c(0.0095, 0), circ), false); // ~1,06 km ao norte
    assert.equal(tela.pontoNoPoligono(...c(0.0085, 0), circ), true); // ~0,95 km
  });
  console.log(`\n${n} grupos de casos: tudo certo.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
