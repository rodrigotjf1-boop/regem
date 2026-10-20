// Senha nunca é preenchida pelo navegador: o Regem roda em PC compartilhado da loja e o Edge/Chrome punham
// sozinhos o login salvo de quem entrou antes (pedido do dono, 20/10/2026). Confere:
//   1) a regra pura `src/lib/senha-sem-preencher.ts`, que o <Input> aplica a todo campo de senha;
//   2) em todo .tsx de src/, cada campo de senha: o <input> cru leva autoComplete="new-password" (ou
//      "one-time-code") e o <Input> não pede outro valor;
//   3) nenhuma tela pede ao navegador o login salvo ("username"/"current-password"), fora das listadas abaixo.
// Uso: npm run check:senhas
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const src = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
// Onde o login salvo do navegador continua valendo: o console da distribuição (PC do dono, com o código de
// 2 fatores) e o cadastro da conta nova (o navegador guarda a conta que acabou de nascer).
const PODE_LOGIN_SALVO = new Set(['app/distribuicao/login/page.tsx', 'app/criar-conta/page.tsx']);
const NAO_PREENCHE = new Set(['new-password', 'one-time-code']);

const tmp = mkdtempSync(join(tmpdir(), 'check-senhas-'));
writeFileSync(
  join(tmp, 'senha-sem-preencher.mjs'),
  ts.transpileModule(readFileSync(join(src, 'lib', 'senha-sem-preencher.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText,
);
const { autoCompleteDoCampo } = await import(pathToFileURL(join(tmp, 'senha-sem-preencher.mjs')).href);

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};

// Os <input>/<Input> de um .tsx, com o tipo e o autoComplete como estão escritos no fonte.
function camposDe(arquivo) {
  const texto = readFileSync(arquivo, 'utf8');
  const sf = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const campos = [];
  const valor = (a) => {
    if (!a?.initializer) return undefined;
    if (ts.isStringLiteral(a.initializer)) return { literal: a.initializer.text };
    return { expressao: a.initializer.getText(sf) };
  };
  const visitar = (no) => {
    if ((ts.isJsxSelfClosingElement(no) || ts.isJsxOpeningElement(no)) && ['input', 'Input'].includes(no.tagName.getText(sf))) {
      const attrs = Object.fromEntries(no.attributes.properties.filter(ts.isJsxAttribute).map((a) => [a.name.getText(sf), valor(a)]));
      const tipo = attrs.type;
      campos.push({
        tag: no.tagName.getText(sf),
        linha: sf.getLineAndCharacterOfPosition(no.getStart(sf)).line + 1,
        senha: tipo?.literal === 'password' || /['"]password['"]/.test(tipo?.expressao ?? ''),
        autoComplete: attrs.autoComplete,
      });
    }
    ts.forEachChild(no, visitar);
  };
  visitar(sf);
  return campos;
}
const tsxDe = (pasta) =>
  readdirSync(pasta, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? tsxDe(join(pasta, d.name)) : d.name.endsWith('.tsx') ? [join(pasta, d.name)] : [],
  );

try {
  caso('o <Input>: campo de senha sem autoComplete, ou com "off" (que o navegador ignora em senha), vira "new-password"', () => {
    assert.equal(autoCompleteDoCampo('password', undefined), 'new-password');
    assert.equal(autoCompleteDoCampo('password', 'off'), 'new-password');
    assert.equal(autoCompleteDoCampo('password', 'new-password'), 'new-password');
    assert.equal(autoCompleteDoCampo('password', 'one-time-code'), 'one-time-code');
  });

  caso('o <Input>: os outros campos ficam como a tela escreveu', () => {
    assert.equal(autoCompleteDoCampo('text', undefined), undefined);
    assert.equal(autoCompleteDoCampo('text', 'off'), 'off');
    assert.equal(autoCompleteDoCampo('search', 'off'), 'off');
    assert.equal(autoCompleteDoCampo(undefined, 'name'), 'name');
  });

  caso('o <Input> usa a regra', () => {
    assert.match(readFileSync(join(src, 'components', 'ui', 'input.tsx'), 'utf8'), /autoComplete=\{autoCompleteDoCampo\(type, autoComplete\)\}/);
  });

  const todos = tsxDe(src).flatMap((arq) => camposDe(arq).map((c) => ({ ...c, arq: relative(src, arq).split('\\').join('/') })));
  const onde = (c) => `${c.arq}:${c.linha}`;

  caso('nenhuma tela pede o login salvo ao navegador (fora do console da distribuição e do cadastro da conta)', () => {
    const pedem = todos.filter((c) => ['username', 'current-password'].includes(c.autoComplete?.literal) && !PODE_LOGIN_SALVO.has(c.arq));
    assert.deepEqual(pedem.map(onde), []);
  });

  caso('todo <input> de senha leva autoComplete="new-password"; o <Input> de senha não pede outro valor', () => {
    const senhas = todos.filter((c) => c.senha && !PODE_LOGIN_SALVO.has(c.arq));
    const crus = senhas.filter((c) => c.tag === 'input');
    const errados = [
      ...crus.filter((c) => !NAO_PREENCHE.has(c.autoComplete?.literal)),
      ...senhas.filter((c) => c.tag === 'Input' && c.autoComplete && !['off', ...NAO_PREENCHE].includes(c.autoComplete.literal)),
    ];
    assert.deepEqual(errados.map(onde), []);
    // A varredura enxerga o que importa: o login (tipo que alterna para mostrar a senha) e o pareamento do ponto.
    for (const arq of ['app/entrar/page.tsx', 'app/terminal/ponto/page.tsx']) assert.ok(crus.some((c) => c.arq === arq), `${arq}: campo de senha não encontrado`);
    assert.ok(senhas.filter((c) => c.tag === 'Input').length >= 10, 'campos de senha com <Input> não encontrados');
    console.log(`    (${crus.length} <input> e ${senhas.length - crus.length} <Input> de senha conferidos)`);
  });

  console.log(`\ncheck:senhas — ${n} grupos de casos, todos certos.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
