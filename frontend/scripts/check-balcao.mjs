// Confere as regras puras da venda do balcão (`src/lib/balcao.ts`): leitura de valor digitado,
// divisão da conta em centavos (por pessoas e por item, com taxa de serviço), notas sugeridas e a
// busca de produto. O frontend não tem runner de testes: este script transpila o arquivo com o
// TypeScript do projeto e roda asserts do Node.
// Uso: npm run check:balcao
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib');
const tmp = mkdtempSync(join(tmpdir(), 'check-balcao-'));
writeFileSync(
  join(tmp, 'balcao.mjs'),
  ts.transpileModule(readFileSync(join(raiz, 'balcao.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText,
);
const b = await import(pathToFileURL(join(tmp, 'balcao.mjs')).href);

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};
const soma = (v) => v.reduce((a, x) => a + Math.round(x * 100), 0);

try {
  caso('valor digitado: inteiro, vírgula, milhar com ponto e lixo', () => {
    assert.equal(b.valorDigitado('50'), 50);
    assert.equal(b.valorDigitado('50,5'), 50.5);
    assert.equal(b.valorDigitado('1.250,00'), 1250);
    assert.equal(b.valorDigitado('12.34'), 12.34); // ponto sem vírgula = decimal (campo type=number)
    assert.equal(b.valorDigitado(''), 0);
    assert.equal(b.valorDigitado('abc'), 0);
    assert.equal(b.valorDigitado('-5'), 0);
    assert.equal(b.valorDigitado(null), 0);
  });

  caso('partes iguais: o centavo que sobra fica com as primeiras e a soma fecha', () => {
    assert.deepEqual(b.partesIguais(100, 3), [33.34, 33.33, 33.33]);
    assert.deepEqual(b.partesIguais(105.6, 3), [35.2, 35.2, 35.2]);
    assert.deepEqual(b.partesIguais(0.05, 3), [0.02, 0.02, 0.01]);
    assert.deepEqual(b.partesIguais(82, 1), [82]);
    for (const [total, pessoas] of [[82, 7], [19.99, 6], [1234.57, 9], [0.01, 4]]) assert.equal(soma(b.partesIguais(total, pessoas)), Math.round(total * 100), `${total}/${pessoas}`);
  });

  caso('por item: cada pessoa paga o que consumiu; "todos" divide a linha por igual', () => {
    assert.deepEqual(b.partesPorItem([68, 18], [0, 1], 2), [68, 18]);
    assert.deepEqual(b.partesPorItem([68, 18], [null, null], 2), [43, 43]);
    assert.deepEqual(b.partesPorItem([10, 10, 5], [0, 0, null], 3), [21.67, 1.67, 1.66]);
    // dono fora da faixa (a pessoa foi tirada da divisão) volta a ser "todos"
    assert.deepEqual(b.partesPorItem([30], [5], 3), [10, 10, 10]);
  });

  caso('por item com taxa de serviço: proporcional, e a soma fecha em linhas + serviço', () => {
    assert.deepEqual(b.partesPorItem([68, 18], [0, 1], 2, 8.6), [74.8, 19.8]);
    const p = b.partesPorItem([10, 10, 10], [0, 1, 2], 3, 0.02); // 2 centavos para 3 iguais
    assert.equal(soma(p), 3002);
    assert.equal(Math.max(...p) - Math.min(...p) <= 0.011, true);
    for (const servico of [0.01, 3.33, 12.07]) assert.equal(soma(b.partesPorItem([19.9, 7.5, 33.33], [0, null, 2], 3, servico)), 6073 + Math.round(servico * 100));
    assert.deepEqual(b.partesPorItem([], [], 2, 5), [0, 0]); // sem itens não há a quem cobrar a taxa
  });

  caso('notas sugeridas: sempre cobrem o total, sem repetir, no máximo 4', () => {
    assert.deepEqual(b.notasSugeridas(82), [85, 90, 100, 200]);
    assert.deepEqual(b.notasSugeridas(4), [5, 10, 20, 50]);
    assert.deepEqual(b.notasSugeridas(100), [100, 200]);
    assert.deepEqual(b.notasSugeridas(0), []);
    for (const t of [0.5, 17.3, 250, 999.99]) assert.equal(b.notasSugeridas(t).every((x) => x >= t), true);
  });

  const PRODUTOS = [
    { nome: 'X-Bacon', codigo: '103' },
    { nome: 'X-Burger', codigo: '101' },
    { nome: 'Combo X-Burger', codigo: '501' },
    { nome: 'Água mineral', codigo: '303' },
    { nome: 'Suco natural de laranja', codigo: null },
    { nome: 'Açaí na tigela', codigo: '1010' },
  ];
  const nomes = (t) => b.buscarProdutos(PRODUTOS, t).map((p) => p.nome);

  caso('busca: código exato vem antes de tudo; depois começo do nome e começo do código', () => {
    assert.deepEqual(nomes('101'), ['X-Burger', 'Açaí na tigela']);
    assert.deepEqual(nomes('x-b'), ['X-Bacon', 'X-Burger', 'Combo X-Burger']);
    assert.deepEqual(nomes('10'), ['X-Bacon', 'X-Burger', 'Açaí na tigela']);
  });

  caso('busca: sem acento, sem hífen, pelas iniciais e pelo meio do nome', () => {
    assert.deepEqual(nomes('agua'), ['Água mineral']);
    assert.deepEqual(nomes('ACAI'), ['Açaí na tigela']);
    assert.deepEqual(nomes('xburger'), ['X-Burger', 'Combo X-Burger']);
    assert.deepEqual(nomes('sn'), ['Suco natural de laranja']); // iniciais: s·n·d·l
    assert.deepEqual(nomes('laranja'), ['Suco natural de laranja']);
    assert.deepEqual(nomes('   '), []);
    assert.deepEqual(nomes('pizza'), []);
    assert.equal(b.buscarProdutos(PRODUTOS, 'a', 2).length, 2); // respeita o limite
  });

  caso('linha do pedido: a ordem dos adicionais não cria outra linha; a observação cria', () => {
    const base = { produtoId: 'p1', variacaoId: 'v1' };
    assert.equal(b.chaveDoItem({ ...base, complementos: ['a', 'b', 'a'] }), b.chaveDoItem({ ...base, complementos: ['b', 'a', 'a'] }));
    assert.notEqual(b.chaveDoItem({ ...base, complementos: ['a'] }), b.chaveDoItem({ ...base, complementos: ['a', 'a'] }));
    assert.notEqual(b.chaveDoItem(base), b.chaveDoItem({ ...base, observacao: 'sem sal' }));
    assert.equal(b.chaveDoItem({ produtoId: 'p1' }), b.chaveDoItem({ produtoId: 'p1', variacaoId: null, complementos: [], observacao: undefined }));
  });

  console.log(`\ncheck:balcao — ${n} grupos de casos, todos certos.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
