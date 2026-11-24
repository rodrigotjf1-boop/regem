// Confere a leitura do valor em reais digitado (`src/lib/valor-digitado.ts`; C-05 da revisão de 24/11/2026): "1.200,00" é
// R$ 1.200,00 e não R$ 0,00, "1.200" é R$ 1.200,00 e não R$ 1,20, e o que não é valor volta NaN em vez de zero. E que as
// telas do caixa (abertura, sangria, contagem, acerto do garçom e pagamento dividido) não voltaram à conta antiga.
// Uso: npm run check:valor
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const aqui = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'check-valor-'));
let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};

try {
  const js = ts.transpileModule(readFileSync(join(aqui, '..', 'src', 'lib', 'valor-digitado.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  writeFileSync(join(tmp, 'valor.mjs'), js);
  const { lerValorDigitado, valorDigitadoValido } = await import(pathToFileURL(join(tmp, 'valor.mjs')).href);

  caso('o formato brasileiro, com e sem milhar', () => {
    assert.equal(lerValorDigitado('1.200,00'), 1200);
    assert.equal(lerValorDigitado('1.200,5'), 1200.5);
    assert.equal(lerValorDigitado('100,50'), 100.5);
    assert.equal(lerValorDigitado('12.500.000,99'), 12500000.99);
    assert.equal(lerValorDigitado(' R$ 30 '), 30);
    assert.equal(lerValorDigitado('0'), 0);
  });
  caso('ponto: de milhar quando separa grupos de 3, decimal nos outros casos', () => {
    assert.equal(lerValorDigitado('1.200'), 1200);
    assert.equal(lerValorDigitado('12.500.000'), 12500000);
    assert.equal(lerValorDigitado('12.50'), 12.5); // a tela que preenche com toFixed(2)
    assert.equal(lerValorDigitado('1200.00'), 1200);
    assert.equal(lerValorDigitado('1.5'), 1.5);
  });
  caso('vazio é null; o que não é valor é NaN (nunca zero calado)', () => {
    assert.equal(lerValorDigitado(''), null);
    assert.equal(lerValorDigitado('   '), null);
    assert.equal(lerValorDigitado(undefined), null);
    for (const t of ['1,200,50', '12a', '1.20.0', '.', ',', 'abc', '-']) assert.ok(Number.isNaN(lerValorDigitado(t)), t);
    assert.equal(lerValorDigitado('1 200,00'), 1200); // o espaço de milhar sai junto com os outros espaços
  });
  caso('número já numérico passa com 2 casas; válido = não vazio, finito e não negativo', () => {
    assert.equal(lerValorDigitado(10.005), 10.01);
    assert.equal(valorDigitadoValido(lerValorDigitado('0')), true);
    assert.equal(valorDigitadoValido(lerValorDigitado('-5')), false);
    assert.equal(valorDigitadoValido(lerValorDigitado('')), false);
    assert.equal(valorDigitadoValido(lerValorDigitado('x')), false);
  });
  caso('as telas do caixa não usam mais Number(texto.replace(",", "."))', () => {
    for (const arq of ['caixa-panel.tsx', 'acertos-salao.tsx', 'split-pagamento.tsx']) {
      const t = readFileSync(join(aqui, '..', 'src', 'components', 'pdv', arq), 'utf8');
      assert.ok(!t.includes("replace(',', '.')"), `${arq} voltou a ler o valor com replace(',', '.')`);
      assert.ok(t.includes('lerValorDigitado'), `${arq} não usa lerValorDigitado`);
    }
  });
  console.log(`check:valor — ${n} casos ok`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
