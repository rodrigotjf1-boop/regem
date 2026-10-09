// Confere as regras puras do nome comercial e das marcas do produto do estoque
// (`src/lib/produto-compra.ts`): que nome aparece na compra, quando a marca é obrigatória e onde a
// busca procura. O frontend não tem runner de testes: este script transpila o arquivo com o
// TypeScript do projeto e roda asserts do Node.
// Uso: npm run check:marcas
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib');
const tmp = mkdtempSync(join(tmpdir(), 'check-marcas-'));
writeFileSync(
  join(tmp, 'produto-compra.mjs'),
  ts.transpileModule(readFileSync(join(raiz, 'produto-compra.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText,
);
const p = await import(pathToFileURL(join(tmp, 'produto-compra.mjs')).href);

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};
// Produtos de exemplo (nomes fictícios), como o servidor devolve em GET /estoque/itens.
const QUEIJO = { nome: 'Fatia de queijo cheddar de teste', nomeComercial: 'Barra de queijo cheddar fatiado', marcas: ['Marca Alfa', 'Marca Beta'] };
const CARNE = { nome: 'Carne 56 g de teste', nomeComercial: 'Caixa de hambúrguer de teste', marcas: ['Marca Gama'] };
const SAL = { nome: 'Sal de teste', nomeComercial: null, marcas: [] };
const ANTIGO = { nome: 'Produto antigo de teste' }; // servidor da loja ainda sem a migration 311

try {
  caso('na compra aparece o nome comercial; sem ele, o nome do produto', () => {
    assert.equal(p.nomeDeCompra(QUEIJO), 'Barra de queijo cheddar fatiado');
    assert.equal(p.nomeDeCompra(SAL), 'Sal de teste');
    assert.equal(p.nomeDeCompra(ANTIGO), 'Produto antigo de teste');
    assert.equal(p.nomeDeCompra({ nome: 'Sal de teste', nomeComercial: '   ' }), 'Sal de teste');
    assert.equal(p.nomeDeCompra(null), '');
  });

  caso('o nome do produto vem embaixo só quando difere do comercial', () => {
    assert.equal(p.nomeDeApoio(QUEIJO), 'Fatia de queijo cheddar de teste');
    assert.equal(p.nomeDeApoio(SAL), '');
    assert.equal(p.nomeDeApoio(ANTIGO), '');
    assert.equal(p.nomeDeApoio({ nome: 'Sal de teste', nomeComercial: 'SAL DE TESTE' }), ''); // é o mesmo nome
  });

  caso('marca da linha: nenhuma cadastrada = nenhuma; uma = ela; duas ou mais = a escolhida', () => {
    assert.equal(p.marcaDaLinha([], 'Qualquer'), '');
    assert.equal(p.marcaDaLinha(['Marca Gama'], ''), 'Marca Gama');
    assert.equal(p.marcaDaLinha(['Marca Gama'], 'Outra'), 'Marca Gama');
    assert.equal(p.marcaDaLinha(QUEIJO.marcas, ''), '');
    assert.equal(p.marcaDaLinha(QUEIJO.marcas, undefined), '');
    assert.equal(p.marcaDaLinha(QUEIJO.marcas, 'marca beta'), 'Marca Beta'); // devolve a grafia do cadastro
    assert.equal(p.marcaDaLinha(QUEIJO.marcas, 'Marca Gama'), ''); // não é marca deste produto
  });

  caso('a escolha só é obrigatória com duas ou mais marcas', () => {
    assert.equal(p.faltaMarca(p.marcasDe(SAL), ''), false);
    assert.equal(p.faltaMarca(p.marcasDe(ANTIGO), ''), false);
    assert.equal(p.faltaMarca(p.marcasDe(CARNE), ''), false);
    assert.equal(p.faltaMarca(p.marcasDe(QUEIJO), ''), true);
    assert.equal(p.faltaMarca(p.marcasDe(QUEIJO), 'Marca Gama'), true);
    assert.equal(p.faltaMarca(p.marcasDe(QUEIJO), 'Marca Alfa'), false);
  });

  caso('acrescentar marca: sem vazia, sem repetida (maiúscula e acento não contam) e no limite', () => {
    assert.deepEqual(p.juntarMarca([], '  Marca   Alfa '), ['Marca Alfa']);
    assert.deepEqual(p.juntarMarca(['Marca Alfa'], 'marca alfa'), ['Marca Alfa']);
    assert.deepEqual(p.juntarMarca(['Marca Épsilon'], 'Marca Epsilon'), ['Marca Épsilon']);
    assert.deepEqual(p.juntarMarca(['Marca Alfa'], '   '), ['Marca Alfa']);
    assert.deepEqual(p.juntarMarca(['Marca Alfa'], 'Marca Beta'), ['Marca Alfa', 'Marca Beta']);
    assert.equal(p.juntarMarca([], 'x'.repeat(200))[0].length, p.MARCA_MAX);
    const cheia = Array.from({ length: p.MARCAS_MAX }, (_, i) => `Marca ${i}`);
    assert.equal(p.juntarMarca(cheia, 'Mais uma'), cheia); // no limite, a lista não muda
  });

  caso('a busca procura no nome do produto, no nome comercial e nas marcas', () => {
    const texto = p.textoDeBusca(QUEIJO).toLowerCase();
    for (const pedaco of ['fatia de queijo', 'barra de queijo', 'marca beta']) assert.ok(texto.includes(pedaco), pedaco);
    assert.equal(p.textoDeBusca(SAL), 'Sal de teste');
    assert.equal(p.textoDeBusca(ANTIGO), 'Produto antigo de teste');
  });

  caso('marcas já usadas viram sugestão, sem repetir e em ordem alfabética', () => {
    assert.deepEqual(p.marcasConhecidas([QUEIJO, CARNE, SAL, ANTIGO, { marcas: ['marca alfa', 'Marca Delta'] }]), ['Marca Alfa', 'Marca Beta', 'Marca Delta', 'Marca Gama']);
    assert.deepEqual(p.marcasConhecidas([]), []);
    assert.deepEqual(p.marcasDe({ marcas: 'texto' }), []); // formato inesperado não quebra a tela
    assert.deepEqual(p.marcasDe({ marcas: ['Marca Alfa', '', 7, null] }), ['Marca Alfa']);
  });

  console.log(`\ncheck:marcas — ${n} grupos de casos, todos certos.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
