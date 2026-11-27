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
  caso('milhar fora do lugar é recusado (PDV-C-04)', () => {
    for (const t of ['12.34,56', '1.2.3,45', '1.20,00', '12.3456,7']) assert.ok(Number.isNaN(lerValorDigitado(t)), t);
    assert.equal(lerValorDigitado('12.345,67'), 12345.67);
  });
  const jsB = ts.transpileModule(readFileSync(join(aqui, '..', 'src', 'lib', 'balcao.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  writeFileSync(join(tmp, 'balcao.mjs'), jsB);
  const { valorDigitado } = await import(pathToFileURL(join(tmp, 'balcao.mjs')).href);
  caso('o leitor do balcão (lib/balcao.ts › valorDigitado) segue a mesma regra', () => {
    const casos = ['1.200,00', '1.200', '1.250', '12.50', '50,5', ' R$ 30 ', '12.34,56', '1.2.3,45', '1,200,50', 'abc', '', '-5', '0', '12.500.000'];
    for (const t of casos) {
      const v = lerValorDigitado(t);
      const esperado = v !== null && Number.isFinite(v) && v > 0 ? v : 0; // o do balcão devolve 0 para o que não serve
      assert.equal(valorDigitado(t), esperado, `balcão × caixa em "${t}"`);
    }
  });
  caso('as telas do caixa não usam mais Number(texto.replace(",", "."))', () => {
    for (const arq of ['caixa-panel.tsx', 'acertos-salao.tsx', 'split-pagamento.tsx']) {
      const t = readFileSync(join(aqui, '..', 'src', 'components', 'pdv', arq), 'utf8');
      assert.ok(!t.includes("replace(',', '.')"), `${arq} voltou a ler o valor com replace(',', '.')`);
      assert.ok(t.includes('lerValorDigitado'), `${arq} não usa lerValorDigitado`);
    }
  });
  // Campo de valor OPCIONAL na edição do produto (custo manual, preço promocional — ERR-636): esvaziar limpa (null),
  // vazio que já era vazio não manda nada, e o valor que volta do banco ("1.200" = 1,2) não vira mil e duzentos.
  const jsC = ts.transpileModule(readFileSync(join(aqui, '..', 'src', 'lib', 'campo-opcional.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  writeFileSync(join(tmp, 'campo.mjs'), jsC);
  const { valorOpcionalDaEdicao, numeroDoCampo } = await import(pathToFileURL(join(tmp, 'campo.mjs')).href);
  caso('campo opcional: esvaziado limpa (null); já vazio = ausente; digitado = o número', () => {
    assert.equal(valorOpcionalDaEdicao('', '0'), null); // o custo 0 da importação: apagar o campo LIMPA
    assert.equal(valorOpcionalDaEdicao('', '12.50'), null);
    assert.equal(valorOpcionalDaEdicao('  ', 7), null);
    assert.equal(valorOpcionalDaEdicao('', ''), undefined); // produto novo ou campo que já era vazio: não manda nada
    assert.equal(valorOpcionalDaEdicao('', null), undefined);
    assert.equal(valorOpcionalDaEdicao('', undefined), undefined);
    assert.equal(valorOpcionalDaEdicao('8,5', ''), 8.5);
    assert.equal(valorOpcionalDaEdicao('0', '3'), 0); // zero DIGITADO vale (custo zero de propósito)
    assert.equal(valorOpcionalDaEdicao('abc', '3'), undefined); // erro de digitação não apaga o guardado
  });
  caso('campo opcional: o valor do banco volta igual (ponto decimal, nunca milhar)', () => {
    assert.equal(numeroDoCampo('1.200'), 1.2); // o numeric do Postgres; lerValorDigitado leria 1200
    assert.equal(valorOpcionalDaEdicao('1.200', '1.200'), 1.2);
    assert.equal(numeroDoCampo('12.5000'), 12.5);
    assert.equal(numeroDoCampo(3), 3);
    assert.equal(numeroDoCampo(''), null);
    assert.ok(Number.isNaN(numeroDoCampo('1,2,3')));
  });
  caso('a tela do produto manda o custo e a promoção pelo campo opcional', () => {
    const t = readFileSync(join(aqui, '..', 'src', 'app', 'produtos', 'page.tsx'), 'utf8');
    assert.ok(/precoCusto: valorOpcionalDaEdicao\(f\.precoCusto, valoresAntes\.current\.precoCusto\)/.test(t), 'custo manual');
    assert.ok(/precoPromocional: valorOpcionalDaEdicao\(f\.precoPromocional, valoresAntes\.current\.precoPromocional\)/.test(t), 'preço promocional');
  });
  console.log(`check:valor — ${n} casos ok`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
