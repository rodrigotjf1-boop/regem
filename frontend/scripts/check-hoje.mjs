// Confere o "hoje" da loja no navegador (`src/lib/hoje-na-loja.ts`; V46, ERR-551): às 23:30 de Brasília o UTC já é o dia
// seguinte, e a tela Tarefas mostrava as tarefas de amanhã no meio do expediente da noite. E trava a volta do padrão:
// nenhum arquivo do `src` calcula o "hoje" com `new Date().toISOString().slice(0, 10)` (nem "n dias atrás" a partir de
// `Date.now()`) — o dia sai do ajudante.
// Uso: npm run check:hoje
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const aqui = dirname(fileURLToPath(import.meta.url));
const src = join(aqui, '..', 'src');
const tmp = mkdtempSync(join(tmpdir(), 'check-hoje-'));

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};

try {
  const js = ts.transpileModule(readFileSync(join(src, 'lib', 'hoje-na-loja.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  writeFileSync(join(tmp, 'hoje.mjs'), js);
  const H = await import(pathToFileURL(join(tmp, 'hoje.mjs')).href);

  const noite = new Date('2026-11-21T02:30:00Z'); // 23:30 de 20/11 em Brasília
  caso('às 23:30 de Brasília, hoje ainda é o dia 20 (o UTC já é 21)', () => {
    assert.equal(noite.toISOString().slice(0, 10), '2026-11-21');
    assert.equal(H.hojeNaLoja(noite), '2026-11-20');
  });
  caso('de madrugada (01:00 de Brasília), já é o dia seguinte', () => {
    assert.equal(H.hojeNaLoja(new Date('2026-11-21T04:00:00Z')), '2026-11-21');
  });
  caso('"n dias atrás" conta a partir do dia da loja', () => {
    assert.equal(H.diasAtrasNaLoja(0, noite), '2026-11-20');
    assert.equal(H.diasAtrasNaLoja(1, noite), '2026-11-19');
    assert.equal(H.diasAtrasNaLoja(30, noite), '2026-10-21');
    assert.equal(H.diasAtrasNaLoja(-1, noite), '2026-11-21');
  });

  // A catraca: o padrão não volta.
  const proibidos = [/new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/, /new Date\(Date\.now\(\)[^)]*\)\.toISOString\(\)\.slice\(0,\s*10\)/];
  const achados = [];
  const andar = (dir) => {
    for (const nome of readdirSync(dir)) {
      const cheio = join(dir, nome);
      if (statSync(cheio).isDirectory()) andar(cheio);
      // o próprio ajudante cita o padrão no comentário
      else if (/\.(tsx?|jsx?)$/.test(nome) && nome !== 'hoje-na-loja.ts') {
        const linhas = readFileSync(cheio, 'utf8').split('\n');
        linhas.forEach((l, i) => {
          if (proibidos.some((r) => r.test(l))) achados.push(`${relative(src, cheio)}:${i + 1}`);
        });
      }
    }
  };
  andar(src);
  caso('nenhum arquivo calcula o "hoje" em UTC (use hojeNaLoja/diasAtrasNaLoja)', () => {
    assert.deepEqual(achados, []);
  });
  console.log(`check:hoje — ${n} casos ok`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
