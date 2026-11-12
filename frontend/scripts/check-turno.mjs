// Confere o texto do turno aberto há mais de 24 horas (`src/lib/turno.ts`; pedido do dono, 12/11/2026) e a regra do
// servidor que decide (`backend/src/common/turno.ts`): a idade em horas e em dias, a abertura com a data no turno antigo.
// Uso: npm run check:turno
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const aqui = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'check-turno-'));
async function carregar(caminho, nome) {
  const js = ts.transpileModule(readFileSync(caminho, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  writeFileSync(join(tmp, nome), js);
  return import(pathToFileURL(join(tmp, nome)).href);
}

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};

try {
  const T = await carregar(join(aqui, '..', 'src', 'lib', 'turno.ts'), 'turno.mjs');
  const S = await carregar(join(aqui, '..', '..', 'backend', 'src', 'common', 'turno.ts'), 'turno-servidor.mjs');

  caso('a idade: horas até 47, depois dias', () => {
    assert.equal(T.idadeDoTurnoEmTexto(1), 'há 1 hora');
    assert.equal(T.idadeDoTurnoEmTexto(30), 'há 30 horas');
    assert.equal(T.idadeDoTurnoEmTexto(47), 'há 47 horas');
    assert.equal(T.idadeDoTurnoEmTexto(48), 'há 2 dias');
    assert.equal(T.idadeDoTurnoEmTexto(24 * 70), 'há 70 dias');
    assert.equal(T.idadeDoTurnoEmTexto(undefined), 'há 0 horas');
  });

  caso('a abertura: só a hora no turno de hoje; com a data no antigo', () => {
    const agora = new Date(2026, 10, 12, 15, 0);
    assert.match(T.aberturaDoTurno(new Date(2026, 10, 12, 9, 4).toISOString(), agora), /^09:04$/);
    assert.match(T.aberturaDoTurno(new Date(2026, 8, 3, 9, 4).toISOString(), agora), /^03\/09 09:04$/);
    assert.equal(T.aberturaDoTurno(null, agora), '');
    assert.equal(T.aberturaDoTurno('torto', agora), '');
  });

  caso('o servidor decide o limite: 24 horas', () => {
    const agora = Date.parse('2026-11-12T12:00:00.000Z');
    assert.equal(S.TURNO_LIMITE_HORAS, 24);
    assert.deepEqual(S.idadeDoTurno(new Date(agora - 23 * 3_600_000), agora), { horasAberto: 23, passouDoLimite: false });
    assert.deepEqual(S.idadeDoTurno(new Date(agora - 24 * 3_600_000), agora), { horasAberto: 24, passouDoLimite: true });
  });

  console.log(`\ncheck:turno — ${n} casos, tudo certo`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
