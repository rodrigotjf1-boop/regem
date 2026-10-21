// Confere a tela de senhas (Cozinha em estações, entrega 4; mig 337):
//  · as faixas dos ajustes da tela (`src/lib/tela-senhas.ts`) são as MESMAS do servidor
//    (`backend/src/modules/tela-senhas/tela-senhas.regras.ts`) — tempos em Pronto, tamanhos e padrões;
//  · as regras puras da TV: a senha que "chama", o relógio pelo servidor, os tamanhos e as iniciais;
//  · as cores da TV se leem (WCAG ≥ 4,5:1) em cada fundo onde aparecem (V62).
// Uso: npm run check:tela-senhas
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const aqui = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'check-tela-senhas-'));
async function carregar(caminho, nome) {
  const js = ts.transpileModule(readFileSync(caminho, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  writeFileSync(join(tmp, nome), js);
  return import(pathToFileURL(join(tmp, nome)).href);
}
const tela = await carregar(join(aqui, '..', 'src', 'lib', 'tela-senhas.ts'), 'tela.mjs');
const servidor = await carregar(join(aqui, '..', '..', 'backend', 'src', 'modules', 'tela-senhas', 'tela-senhas.regras.ts'), 'servidor.mjs');

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contraste = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

try {
  caso('as faixas dos ajustes são as mesmas na tela e no servidor', () => {
    for (const k of ['TEMPOS_PRONTO_MIN', 'TEMPO_PRONTO_PADRAO', 'SOM_PADRAO', 'TAMANHO_MIN', 'TAMANHO_MAX', 'TAMANHO_PASSO', 'TAMANHO_PADRAO', 'CAMPOS_TAMANHO'])
      assert.deepEqual(tela[k], servidor[k], `${k} difere entre a tela e o servidor`);
  });

  caso('a senha que chama: só a que entrou em Pronto agora — na primeira leitura, nenhuma', () => {
    const s = (id) => ({ id, senha: 1, prefixo: 'B', prontoEm: '', saiEm: null });
    assert.deepEqual(tela.novasProntas(null, [s('a'), s('b')]), []);
    assert.deepEqual(tela.novasProntas([s('a')], [s('b'), s('a')]), ['b']);
    assert.deepEqual(tela.novasProntas([s('a'), s('b')], [s('a')]), []);
  });

  caso('a senha sai de Pronto na hora do SERVIDOR, mesmo com o relógio da TV errado', () => {
    const agoraServidor = Date.parse('2026-10-21T20:00:00Z');
    const relogioDaTv = agoraServidor - 5 * 60_000; // a TV está 5 min atrasada
    const desvio = tela.desvioDoRelogio(new Date(agoraServidor).toISOString(), relogioDaTv);
    assert.equal(desvio, 5 * 60_000);
    const s = { id: 'a', senha: 1, prefixo: 'B', prontoEm: '', saiEm: new Date(agoraServidor + 60_000).toISOString() };
    assert.equal(tela.aindaNaTela(s, relogioDaTv, desvio), true);
    assert.equal(tela.aindaNaTela(s, relogioDaTv + 61_000, desvio), false);
    assert.equal(tela.aindaNaTela({ ...s, saiEm: null }, relogioDaTv + 10 ** 9, desvio), true); // até o balcão entregar
  });

  caso('tamanhos: o que vem fora da faixa vira 100% (a TV nunca desenha torto)', () => {
    assert.deepEqual(tela.tamanhosValidos({ pronto: 140, preparando: 300, titulos: 85 }), { pronto: 140, preparando: 100, titulos: 100 });
    assert.deepEqual(tela.tamanhosValidos(null), { pronto: 100, preparando: 100, titulos: 100 });
  });

  caso('iniciais da loja sem logo', () => {
    assert.equal(tela.iniciais('Burger da Esquina'), 'BE');
    assert.equal(tela.iniciais('Regem'), 'RE');
    assert.equal(tela.iniciais('  '), 'R');
  });

  caso('as cores da TV se leem em cada fundo onde aparecem (≥ 4,5:1)', () => {
    const T = tela.TEMA_TV;
    const pares = [
      ['tinta', T.tinta, 'fundo', T.fundo],
      ['fraco', T.fraco, 'fundo', T.fundo],
      ['fraco', T.fraco, 'chip (senha em Preparando)', T.chip],
      ['sobreOk', T.sobreOk, 'ok (senha que chama)', T.ok],
      ['ok (título Pronto)', T.ok, 'okSuave (alto da coluna)', T.okSuave],
      ['ok', T.ok, 'fundo', T.fundo],
      ['sobreOk', T.sobreOk, 'marca (iniciais)', T.marca],
      ['erro', T.erro, 'fundo', T.fundo],
      ['sobreAcao', T.sobreAcao, 'acao (botão)', T.acao],
    ];
    for (const [a, ca, b, cb] of pares) {
      const r = contraste(ca, cb);
      assert.ok(r >= 4.5, `${a} sobre ${b}: ${r.toFixed(2)} abaixo de 4,5`);
    }
  });

  console.log(`\ncheck:tela-senhas — ${n} conferências certas`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
