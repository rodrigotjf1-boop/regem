// Confere a faixa "sem conexão com a nuvem" do servidor da loja (F1.4 do docs/plano-mister.md): o texto
// (`src/lib/sem-nuvem.ts`), a regra do servidor que decide (`backend/src/modules/edge/conexao-nuvem.ts`) e que a tela lê o
// MESMO campo que o servidor manda na presença do PC (`nuvem.semConexaoDesde`).
// Uso: npm run check:sem-nuvem
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const aqui = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'check-sem-nuvem-'));
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
  const T = await carregar(join(aqui, '..', 'src', 'lib', 'sem-nuvem.ts'), 'sem-nuvem.mjs');
  const S = await carregar(join(aqui, '..', '..', 'backend', 'src', 'modules', 'edge', 'conexao-nuvem.ts'), 'conexao-nuvem.mjs');
  const agora = Date.parse('2026-11-14T22:00:00Z');
  const ha = (min) => new Date(agora - min * 60_000).toISOString();

  caso('os minutos: inteiros, nunca negativos; o rótulo em minutos e em horas', () => {
    assert.equal(T.minutosDesde(ha(12), agora), 12);
    assert.equal(T.minutosDesde(ha(-3), agora), 0);
    assert.equal(T.minutosDesde('lixo', agora), 0);
    assert.equal(T.rotuloDeMinutos(0), '1 min');
    assert.equal(T.rotuloDeMinutos(12), '12 min');
    assert.equal(T.rotuloDeMinutos(60), '1 h');
    assert.equal(T.rotuloDeMinutos(125), '2 h 05 min');
  });

  caso('o texto da faixa: o tempo, o que continua e o que para', () => {
    assert.equal(T.TEXTO_SEM_NUVEM.titulo(12), '📡 O servidor da loja está sem conexão com a nuvem há 12 min');
    assert.equal(T.TEXTO_SEM_NUVEM.titulo(null), '📡 O servidor da loja está sem conexão com a nuvem');
    assert.match(T.TEXTO_SEM_NUVEM.detalhe, /continua normal/);
    assert.match(T.TEXTO_SEM_NUVEM.detalhe, /iFood, da 99 e do cardápio digital não chegam/);
    assert.equal(T.TEXTO_SEM_NUVEM.voltou(14), '✅ A conexão com a nuvem voltou · ficou 14 min fora');
  });

  caso('a regra do servidor (a mesma do ícone da bandeja): 2 min falhando, 5 sem contato certo, nada sem anotação', () => {
    const contato = (okEm, falhandoDesde) => JSON.stringify({ okEm, falhandoDesde });
    assert.equal(S.situacaoDaNuvem(contato(ha(3), ha(2)), agora).semConexaoDesde, ha(2));
    assert.equal(S.situacaoDaNuvem(contato(ha(1.5), ha(1)), agora).semConexaoDesde, null);
    assert.equal(S.situacaoDaNuvem(contato(ha(5), null), agora).semConexaoDesde, ha(5));
    assert.equal(S.situacaoDaNuvem(null, agora).semConexaoDesde, null);
  });

  caso('a tela lê o mesmo campo que o servidor manda na presença do PC', () => {
    const controller = readFileSync(join(aqui, '..', '..', 'backend', 'src', 'modules', 'edge', 'edge.controller.ts'), 'utf8');
    const servico = readFileSync(join(aqui, '..', '..', 'backend', 'src', 'modules', 'edge', 'edge.service.ts'), 'utf8');
    const conexao = readFileSync(join(aqui, '..', 'src', 'lib', 'conexao-servidor.ts'), 'utf8');
    const faixa = readFileSync(join(aqui, '..', 'src', 'components', 'ui', 'faixa-sem-nuvem.tsx'), 'utf8');
    const shell = readFileSync(join(aqui, '..', 'src', 'components', 'app-shell', 'shell.tsx'), 'utf8');
    assert.match(controller, /\bnuvem,\r?\n/);
    assert.match(servico, /return \{ semConexaoDesde: situacaoDaNuvem\(await this\.getState\('nuvem_contato'\)\)\.semConexaoDesde \}/);
    // O ícone da bandeja usa a MESMA regra (V74).
    const bandeja = readFileSync(join(aqui, '..', '..', 'backend', 'src', 'modules', 'bandeja', 'bandeja.service.ts'), 'utf8');
    assert.match(bandeja, /situacaoDaNuvem\(valor, agoraMs\)/);
    assert.match(conexao, /nuvem: r\?\.nuvem \?\? null/);
    assert.match(faixa, /c\.nuvem\?\.semConexaoDesde/);
    assert.match(shell, /<FaixaSemNuvem \/>/);
  });

  console.log(`check:sem-nuvem — ${n} casos ok`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
