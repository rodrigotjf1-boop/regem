// A regra de "que linha da ficha entra em que venda" vive em DOIS arquivos — `src/lib/embalagem-da-ficha.ts`
// (a ficha mostra o custo do balcão e o do delivery enquanto a pessoa digita) e
// `backend/src/common/embalagem-da-ficha.ts` (o servidor calcula o custo e baixa o estoque) — e os
// dois têm de dar a MESMA resposta. Este script transpila os dois com o TypeScript do projeto, roda
// todas as combinações em cada um e falha se alguma diferir; depois confere o que importa.
// Uso: npm run check:embalagem
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const aqui = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'check-embalagem-'));
const carregar = async (origem, nome) => {
  writeFileSync(
    join(tmp, nome),
    ts.transpileModule(readFileSync(origem, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
    }).outputText,
  );
  return import(pathToFileURL(join(tmp, nome)).href);
};

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};
const LINHAS = [{}, { somenteBalcao: true }, { somenteDelivery: true }, { somenteBalcao: false, somenteDelivery: null }, { somenteBalcao: true, somenteDelivery: true }];
const CANAIS = ['balcao', 'delivery', 'nenhum'];

try {
  const tela = await carregar(join(aqui, '..', 'src', 'lib', 'embalagem-da-ficha.ts'), 'tela.mjs');
  let servidor = null;
  try {
    servidor = await carregar(join(aqui, '..', '..', 'backend', 'src', 'common', 'embalagem-da-ficha.ts'), 'servidor.mjs');
  } catch (e) {
    // Imagem só do frontend (Docker): o arquivo do servidor não está aqui. No CI o repositório vem
    // inteiro: ali a falta do arquivo é erro (a comparação não pode sumir calada).
    if (e?.code !== 'ENOENT' || process.env.CI) throw e;
    console.log('  · servidor fora desta pasta: confere só a regra da tela');
  }

  if (servidor)
    caso('a tela e o servidor dão a mesma resposta em todas as combinações', () => {
      let comparados = 0;
      for (const linha of LINHAS)
        for (const canal of CANAIS)
          for (const mesma of [false, true]) {
            assert.equal(tela.linhaEntra(linha, canal, mesma), servidor.linhaEntra(linha, canal, mesma), `${JSON.stringify(linha)} · ${canal} · mesma=${mesma}`);
            comparados++;
          }
      assert.equal(comparados, 30);
    });

  const { linhaEntra, semZerosFinais } = tela;
  const ingrediente = {}, doBalcao = { somenteBalcao: true }, doDelivery = { somenteDelivery: true };
  // burger: 8,00 de ingredientes + 0,30 de papel do balcão + 1,50 de caixa do delivery
  const ficha = [{ ...ingrediente, custo: 8 }, { ...doBalcao, custo: 0.3 }, { ...doDelivery, custo: 1.5 }];
  const custo = (canal, mesma) => Number(ficha.filter((l) => linhaEntra(l, canal, mesma)).reduce((s, l) => s + l.custo, 0).toFixed(2));

  caso('dois cadastros (o padrão): balcão soma a embalagem do balcão; delivery, a do delivery', () => {
    assert.equal(custo('balcao', false), 8.3);
    assert.equal(custo('delivery', false), 9.5);
    assert.equal(custo('nenhum', false), 8);
  });

  caso('mesma embalagem: a do delivery vale para as duas vendas; a do balcão fica guardada', () => {
    assert.equal(custo('balcao', true), 9.5);
    assert.equal(custo('delivery', true), 9.5);
    assert.equal(custo('nenhum', true), 8);
    assert.equal(linhaEntra(doBalcao, 'balcao', true), false);
  });

  caso('ficha de hoje (só ingredientes e embalagem de delivery) não muda de conta com a chave desligada', () => {
    const deHoje = [{ custo: 8 }, { somenteDelivery: true, custo: 1.5 }];
    const soma = (canal) => deHoje.filter((l) => linhaEntra(l, canal, false)).reduce((s, l) => s + l.custo, 0);
    assert.equal(soma('balcao'), 8);
    assert.equal(soma('delivery'), 9.5);
  });

  caso('número sem os zeros do banco: "2.000" → "2"', () => {
    assert.equal(semZerosFinais('2.000'), '2');
    assert.equal(semZerosFinais('1.250'), '1.25');
    assert.equal(semZerosFinais(1), '1');
    assert.equal(semZerosFinais('0.0277777777777778'), '0.0277777777777778');
    assert.equal(semZerosFinais(null, '1'), '1');
    assert.equal(semZerosFinais(''), '');
    assert.equal(semZerosFinais('abc'), 'abc');
  });

  console.log(`\ncheck:embalagem — ${n} grupos de casos, todos certos.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
