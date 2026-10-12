// A conversão de unidade vive em DOIS arquivos — `src/lib/conversao-unidade.ts` (a tela lista as
// unidades e mostra a conta) e `backend/src/common/conversao-unidade.ts` (o servidor grava) — e os
// dois têm de dar a MESMA resposta. Este script transpila os dois com o TypeScript do projeto, roda
// os mesmos casos em cada um e falha se algum diferir; depois confere as contas que importam.
// Uso: npm run check:conversao
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const aqui = dirname(fileURLToPath(import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'check-conversao-'));
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
const c = (unidadeDe, fator, unidadePara) => ({ unidadeDe, fator, unidadePara });

// Produtos de exemplo: [unidade do estoque, conversões do cadastro].
const PRODUTOS = {
  'kg sem conversão': ['kg', []],
  'grama sem conversão': ['grama', []],
  'litro sem conversão': ['litro', []],
  'ml sem conversão': ['ml', []],
  'unidade sem conversão': ['unidade', []],
  'guardado em "l" (texto antigo)': ['l', []],
  'bacon em kg, 1 kg = 72 unidade': ['kg', [c('kg', 72, 'unidade')]],
  'fardo de 12': ['fardo', [c('fardo', 12, 'unidade')]],
  'caixa → pacotes → unidade': ['caixa', [c('caixa', 10, 'pacotes'), c('pacotes', 12, 'unidade')]],
  'caixa de 6 kg, porção de 30 grama': ['caixa', [c('caixa', 6, 'kg'), c('porção', 30, 'grama')]],
  'a mesma, com as linhas invertidas': ['caixa', [c('porção', 30, 'grama'), c('caixa', 6, 'kg')]],
  'porção de 30 "g" num produto em kg': ['kg', [c('porção', 30, 'g')]],
  'conversão própria kg → grama': ['kg', [c('kg', 900, 'grama')]],
  'óleo: 1 litro = 0,92 kg': ['litro', [c('litro', 0.92, 'kg')]],
  'com linha solta e linha incompleta': ['caixa', [c('caixa', 6, 'kg'), c('pacote', 10, 'bisnaga'), c('garrafa', 500, 'ml'), c('lata', 0, 'pote'), c('kg', 'abc', 'saco')]],
};
const UNIDADES = ['', null, 'kg', 'KG ', 'k', 'quilos', 'grama', 'gramas', 'g', 'gr', 'litro', 'l', 'L', 'ml', 'mililitros', 'unidade', 'unidades', 'pacote', 'porção', 'porcao', 'caixa', 'fardo', 'fatia', 'bisnaga', 'garrafa'];

try {
  const tela = await carregar(join(aqui, '..', 'src', 'lib', 'conversao-unidade.ts'), 'tela.mjs');
  const servidorTs = join(aqui, '..', '..', 'backend', 'src', 'common', 'conversao-unidade.ts');
  let servidor = null;
  try {
    servidor = await carregar(servidorTs, 'servidor.mjs');
  } catch (e) {
    // Imagem só do frontend (Docker): o arquivo do servidor não está aqui. A regra da tela é conferida do mesmo jeito.
    // No CI o repositório vem inteiro: ali a falta do arquivo é erro (a comparação não pode sumir calada).
    if (e?.code !== 'ENOENT' || process.env.CI) throw e;
    console.log('  · servidor fora desta pasta: confere só a regra da tela');
  }

  if (servidor)
    caso('a tela e o servidor dão a mesma resposta em todos os casos', () => {
      let comparados = 0;
      for (const [nome, [estoque, conversoes]] of Object.entries(PRODUTOS)) {
        assert.deepEqual(tela.unidadesDoProduto(estoque, conversoes), servidor.unidadesDoProduto(estoque, conversoes), `unidades de: ${nome}`);
        assert.deepEqual([...tela.valoresEmEstoque(estoque, conversoes)], [...servidor.valoresEmEstoque(estoque, conversoes)], `valores de: ${nome}`);
        assert.deepEqual(tela.conversoesSoltas(estoque, conversoes), servidor.conversoesSoltas(estoque, conversoes), `soltas de: ${nome}`);
        for (const u of UNIDADES) {
          assert.equal(tela.fatorParaEstoque(u, estoque, conversoes), servidor.fatorParaEstoque(u, estoque, conversoes), `fator de "${u}" em: ${nome}`);
          comparados++;
        }
      }
      for (const a of UNIDADES) for (const b of UNIDADES) assert.equal(tela.proporcaoFixa(a, b), servidor.proporcaoFixa(a, b), `proporção "${a}" → "${b}"`);
      for (const u of [...UNIDADES, 'Galão', ' Pacotes ', 'DÚZIA']) assert.equal(tela.chaveUnidade(u), servidor.chaveUnidade(u));
      for (const v of [2 / 72, 0.1 + 0.2, 1.99999999998, NaN, Infinity]) assert.equal(tela.arredondarInformado(v), servidor.arredondarInformado(v));
      assert.ok(comparados > 300);
    });

  const { unidadesDoProduto, unidadesDoCadastro, fatorParaEstoque, conversoesSoltas, proporcaoFixa } = tela;
  const nomes = (lista) => lista.map((u) => u.unidade);
  const perto = (a, b) => assert.ok(Math.abs(a - b) < 1e-15, `${a} ≠ ${b}`);

  caso('kg e grama, litro e ml: o sistema converte sem cadastro', () => {
    assert.deepEqual(unidadesDoProduto('kg', []), [{ unidade: 'kg', fator: 1 }, { unidade: 'grama', fator: 0.001 }]);
    assert.deepEqual(unidadesDoProduto('grama', []), [{ unidade: 'grama', fator: 1 }, { unidade: 'kg', fator: 1000 }]);
    assert.deepEqual(unidadesDoProduto('litro', []), [{ unidade: 'litro', fator: 1 }, { unidade: 'ml', fator: 0.001 }]);
    assert.deepEqual(unidadesDoProduto('unidade', []), [{ unidade: 'unidade', fator: 1 }]);
    assert.equal(2500 * fatorParaEstoque('grama', 'kg', []), 2.5); // 2500 grama = 2,5 kg
    assert.equal(2.5 * fatorParaEstoque('k', 'grama', []), 2500); // "2,5 k" = 2500 grama
    assert.equal(fatorParaEstoque('ml', 'kg', []), null); // peso não vira volume sozinho
  });

  caso('o caso que motivou: caixa de 6 kg com porção de 30 grama → a porção aparece e vale 0,005 caixa', () => {
    const [estoque, conversoes] = PRODUTOS['caixa de 6 kg, porção de 30 grama'];
    assert.deepEqual(nomes(unidadesDoProduto(estoque, conversoes)), ['caixa', 'kg', 'grama', 'porção']);
    perto(fatorParaEstoque('porção', estoque, conversoes), 0.005);
    assert.deepEqual(conversoesSoltas(estoque, conversoes), []);
  });

  caso('conversão solta é apontada pelo índice; a incompleta não conta', () => {
    const [estoque, conversoes] = PRODUTOS['com linha solta e linha incompleta'];
    assert.deepEqual(conversoesSoltas(estoque, conversoes), [1, 2]);
  });

  caso('proporção fixa: 1 kg = 1000 grama; entre peso e volume não há', () => {
    assert.equal(proporcaoFixa('kg', 'grama'), 1000);
    assert.equal(proporcaoFixa('ml', 'litro'), 0.001);
    assert.equal(proporcaoFixa('kg', 'litro'), null);
    assert.equal(proporcaoFixa('caixa', 'kg'), null);
  });

  caso('ligação "1 por venda" (revenda, adicional): só o que o cadastro cita, e a unidade já gravada', () => {
    assert.deepEqual(nomes(unidadesDoCadastro('kg', [])), ['kg']); // produto em kg não ganha "1 grama por venda"
    assert.deepEqual(nomes(unidadesDoCadastro('kg', [c('kg', 72, 'unidade')])), ['kg', 'unidade']);
    assert.deepEqual(nomes(unidadesDoCadastro('caixa', [c('caixa', 6, 'kg'), c('porção', 30, 'grama')])), ['caixa', 'kg', 'grama', 'porção']);
    assert.deepEqual(nomes(unidadesDoCadastro('kg', [], 'grama')), ['kg', 'grama']); // já estava gravada: continua na lista
    assert.deepEqual(nomes(unidadesDoCadastro('kg', [], '')), ['kg']);
  });

  console.log(`\ncheck:conversao — ${n} grupos de casos, todos certos.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
