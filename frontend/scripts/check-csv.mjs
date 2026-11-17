// O CSV que a TELA gera (`src/lib/csv.ts`) não deixa texto virar fórmula: o que começa com = + - @ ganha um apóstrofo,
// e o número continua número. E nenhuma tela monta CSV por conta própria — a cópia local que existia na Visão C&O não
// tinha a proteção (segunda rodada da avaliação de segurança de 16/11/2026, B-03).
// Uso: npm run check:csv
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const aqui = dirname(fileURLToPath(import.meta.url));
const src = join(aqui, '..', 'src');
const tmp = mkdtempSync(join(tmpdir(), 'check-csv-'));
let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};

try {
  writeFileSync(
    join(tmp, 'csv.mjs'),
    ts.transpileModule(readFileSync(join(src, 'lib', 'csv.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    }).outputText,
  );
  const { celulaDeCsv, montarCsv } = await import(pathToFileURL(join(tmp, 'csv.mjs')).href);

  caso('o texto que começa como fórmula ganha o apóstrofo', () => {
    for (const texto of ['=1+1', '=HYPERLINK("http://exemplo.invalid";"clique")', '+1+1', '-1+1', '@SUM(A1:A2)', '\t=1+1', '\r=1+1', '-João', '+ item', '=', '@']) {
      assert.equal(celulaDeCsv(texto), `'${texto}`, texto);
    }
  });

  caso('o número segue número: negativo, com R$, com %, e o tipo number', () => {
    for (const texto of ['-5', '-5,00', '-1.234,56', '+3', '-R$ 5,00', '-R$ 5,00', '-12,5%', '-12 %', '+5511999990000']) {
      assert.equal(celulaDeCsv(texto), texto, texto);
    }
    assert.equal(celulaDeCsv(-5.5), '-5.5');
    assert.equal(celulaDeCsv(0), '0');
  });

  caso('o texto comum não muda; o vazio é vazio', () => {
    for (const texto of ['Maria', 'R$ 10,00', '21999990000', 'a=b', 'Rua 1 - casa 2', ' =1+1', '10:30']) assert.equal(celulaDeCsv(texto), texto, texto);
    assert.equal(celulaDeCsv(null), '');
    assert.equal(celulaDeCsv(undefined), '');
  });

  caso('número que traz conta ou letra não passa como número', () => {
    for (const texto of ['-1+1', '-2*3', '+1-1', '-A1', '-5,00+cmd', '-R$ 5,00+1']) assert.equal(celulaDeCsv(texto), `'${texto}`, texto);
  });

  caso('o arquivo: cabeçalho, aspas dobradas e a célula perigosa já com o apóstrofo', () => {
    const csv = montarCsv([
      { Cliente: '=1+1', Total: -5, Obs: 'disse "oi"; saiu' },
      { Cliente: 'Maria', Total: 10, Obs: '@SUM(A1)' },
    ]);
    assert.equal(csv, ['Cliente;Total;Obs', `"'=1+1";"-5";"disse ""oi""; saiu"`, `"Maria";"10";"'@SUM(A1)"`].join('\n'));
    assert.equal(montarCsv([]), '');
  });

  caso('nenhuma tela monta CSV por conta própria (só `lib/csv.ts`)', () => {
    const achados = [];
    const andar = (pasta) => {
      for (const nome of readdirSync(pasta)) {
        const caminho = join(pasta, nome);
        if (statSync(caminho).isDirectory()) andar(caminho);
        // o `new Blob(…)` com `text/csv` na mesma linha: é quem monta o arquivo (o `accept` de um campo de envio não conta)
        else if (/\.tsx?$/.test(nome) && /new Blob\(.{0,200}text\/csv/.test(readFileSync(caminho, 'utf8'))) achados.push(relative(src, caminho).replace(/\\/g, '/'));
      }
    };
    andar(src);
    assert.deepEqual(achados, ['lib/csv.ts']);
  });

  console.log(`check:csv — ${n} casos, tudo certo`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
