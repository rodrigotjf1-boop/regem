// Confere a regra pura do campo de unidade de medida (`src/lib/unidade-da-lista.ts`): reconhecer na
// lista fechada do servidor o que já estava gravado de outro jeito. O frontend não tem runner de
// testes: este script transpila o arquivo com o TypeScript do projeto e roda asserts do Node.
// Uso: npm run check:unidades
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib');
const tmp = mkdtempSync(join(tmpdir(), 'check-unidades-'));
writeFileSync(
  join(tmp, 'unidade-da-lista.mjs'),
  ts.transpileModule(readFileSync(join(raiz, 'unidade-da-lista.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText,
);
const u = await import(pathToFileURL(join(tmp, 'unidade-da-lista.mjs')).href);

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};
// Como o servidor responde em GET /estoque/unidades-medida (recorte).
const LISTA = {
  unidades: ['unidade', 'porção', 'kg', 'grama', 'litro', 'ml', 'galão'],
  apelidos: { unidade: 'unidade', un: 'unidade', und: 'unidade', porcao: 'porção', porcoes: 'porção', kg: 'kg', g: 'grama', grama: 'grama', l: 'litro', litro: 'litro', ml: 'ml', gl: 'galão', galao: 'galão' },
};

try {
  caso('o que já é da lista fica como está', () => {
    for (const x of LISTA.unidades) assert.equal(u.unidadeDaLista(x, LISTA), x);
  });

  caso('texto antigo abre na unidade da lista: maiúscula, ponto, acento e plural', () => {
    assert.equal(u.unidadeDaLista('un', LISTA), 'unidade');
    assert.equal(u.unidadeDaLista('UN', LISTA), 'unidade');
    assert.equal(u.unidadeDaLista('Und.', LISTA), 'unidade');
    assert.equal(u.unidadeDaLista(' porções ', LISTA), 'porção');
    assert.equal(u.unidadeDaLista('Porcao', LISTA), 'porção');
    assert.equal(u.unidadeDaLista('L', LISTA), 'litro');
    assert.equal(u.unidadeDaLista('G', LISTA), 'grama');
    assert.equal(u.unidadeDaLista('galao', LISTA), 'galão');
  });

  caso('o que não tem correspondente não é adivinhado', () => {
    assert.equal(u.unidadeDaLista('colher', LISTA), null);
    assert.equal(u.unidadeDaLista('lt', LISTA), null); // ambíguo (lata ou litro): a pessoa escolhe
    assert.equal(u.unidadeDaLista('', LISTA), null);
    assert.equal(u.unidadeDaLista(null, LISTA), null);
    assert.equal(u.unidadeDaLista(undefined, LISTA), null);
  });

  caso('sem a lista (ainda carregando, ou servidor antigo sem apelidos) nada é trocado', () => {
    assert.equal(u.unidadeDaLista('un', null), null);
    assert.equal(u.unidadeDaLista('un', { unidades: ['unidade'], apelidos: {} }), null);
    assert.equal(u.unidadeDaLista('unidade', { unidades: ['unidade'], apelidos: {} }), 'unidade');
    // apelido que aponta para fora da lista não vale
    assert.equal(u.unidadeDaLista('cx', { unidades: ['unidade'], apelidos: { cx: 'caixa' } }), null);
  });

  caso('a chave é a mesma do servidor: sem acento, minúscula, sem ponto, espaços juntos', () => {
    assert.equal(u.chaveDaUnidade('  Pç. '), 'pc');
    assert.equal(u.chaveDaUnidade('DÚZIA'), 'duzia');
    assert.equal(u.chaveDaUnidade('colher   de   sopa'), 'colher de sopa');
  });

  console.log(`\ncheck:unidades — ${n} grupos de casos, todos certos.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
