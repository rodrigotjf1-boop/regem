// Confere as regras puras da Gestão do catálogo › Produtos e preços (`src/lib/catalogo-gestao.ts`): a pausa do Regem
// e do iFood, o esgotado, o "sem preço no iFood", o texto do preço digitado e a ordem dos grupos por categoria. O
// frontend não tem runner de testes: este script transpila o arquivo com o TypeScript do projeto e roda asserts do Node.
// Uso: npm run check:catalogo
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'lib');
const tmp = mkdtempSync(join(tmpdir(), 'check-catalogo-'));
writeFileSync(
  join(tmp, 'catalogo-gestao.mjs'),
  ts.transpileModule(readFileSync(join(raiz, 'catalogo-gestao.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText,
);
const c = await import(pathToFileURL(join(tmp, 'catalogo-gestao.mjs')).href);

let n = 0;
const caso = (nome, fn) => {
  fn();
  n++;
  console.log('  ✓', nome);
};

try {
  caso('a pausa do Regem é balcão E cardápio; um só fora é "parcial", não pausado', () => {
    assert.deepEqual(c.pausaNoRegem({ disponivelBalcao: false, disponivelCardapio: false }), { pausado: true, parcial: null });
    assert.deepEqual(c.pausaNoRegem({ disponivelBalcao: false, disponivelCardapio: true }), { pausado: false, parcial: 'fora do balcão' });
    assert.deepEqual(c.pausaNoRegem({ disponivelBalcao: true, disponivelCardapio: false }), { pausado: false, parcial: 'fora do cardápio digital' });
    // Ausente = disponível (o servidor antigo não manda os campos).
    assert.deepEqual(c.pausaNoRegem({}), { pausado: false, parcial: null });
  });

  caso('a pausa do iFood é o "ifood" na lista; lista nula ou estranha não quebra', () => {
    assert.equal(c.pausadoNoIfood({ canaisPausados: ['gogem', 'ifood'] }), true);
    assert.equal(c.pausadoNoIfood({ canaisPausados: ['99food'] }), false);
    assert.equal(c.pausadoNoIfood({ canaisPausados: null }), false);
    assert.equal(c.pausadoNoIfood({ canaisPausados: '{"ifood":true}' }), false);
    assert.deepEqual(c.canaisPausados({ canaisPausados: ['ifood', 3, null] }), ['ifood']);
  });

  caso('pausado em algum canal: o iFood só conta com ele ligado E o produto no iFood', () => {
    const p = { noIfood: true, canaisPausados: ['ifood'] };
    assert.equal(c.pausadoEmAlgumCanal(p, true), true);
    assert.equal(c.pausadoEmAlgumCanal(p, false), false);
    assert.equal(c.pausadoEmAlgumCanal({ ...p, noIfood: false }, true), false);
    assert.equal(c.pausadoEmAlgumCanal({ disponivelBalcao: false, disponivelCardapio: false }, false), true);
  });

  caso('esgotado: pausado pelo estoque, a não ser que venda no negativo', () => {
    assert.equal(c.esgotado({ pausadoEstoque: true }), true);
    assert.equal(c.esgotado({ pausadoEstoque: true, permiteNegativo: true }), false);
    assert.equal(c.esgotado({}), false);
  });

  caso('sem preço no iFood: só quem está no iFood e sem o preço de lá', () => {
    assert.equal(c.semPrecoNoIfood({ noIfood: true, precoIfood: null }), true);
    assert.equal(c.semPrecoNoIfood({ noIfood: true, precoIfood: '' }), true);
    assert.equal(c.semPrecoNoIfood({ noIfood: true, precoIfood: '45.00' }), false);
    assert.equal(c.semPrecoNoIfood({ noIfood: false, precoIfood: null }), false);
  });

  caso('preço digitado: vírgula, ponto, milhar, "R$"; sempre 2 casas com ponto', () => {
    assert.deepEqual(c.precoDigitado('39,90', false), { valor: '39.90' });
    assert.deepEqual(c.precoDigitado('39.9', false), { valor: '39.90' });
    assert.deepEqual(c.precoDigitado('1.234,50', false), { valor: '1234.50' });
    assert.deepEqual(c.precoDigitado('R$ 12', false), { valor: '12.00' });
    assert.deepEqual(c.precoDigitado(' 7,5 ', false), { valor: '7.50' });
  });

  caso('preço digitado: vazio só vale onde pode (o iFood); zero, letra e 3 casas são recusados com o motivo', () => {
    assert.deepEqual(c.precoDigitado('', true), { valor: null });
    assert.match(c.precoDigitado('', false).erro, /Digite o preço/);
    assert.match(c.precoDigitado('0', false).erro, /maior que zero/);
    assert.match(c.precoDigitado('0,00', true).erro, /deixe em branco/);
    assert.match(c.precoDigitado('abc', false).erro, /só números/);
    assert.match(c.precoDigitado('-3', false).erro, /só números/);
    assert.match(c.precoDigitado('1,234', false).erro, /2 casas/);
    assert.match(c.precoDigitado('1000000', false).erro, /alto demais/);
  });

  caso('o campo abre com o preço em vírgula; sem preço, vazio', () => {
    assert.equal(c.precoNoCampo('39.9'), '39,90');
    assert.equal(c.precoNoCampo(45), '45,00');
    assert.equal(c.precoNoCampo(null), '');
    assert.equal(c.precoNoCampo(''), '');
    assert.equal(c.precoNoCampo('x'), '');
  });

  caso('grupos na ordem do cardápio; categoria vazia some; "Sem categoria" no fim (inclusive a apagada)', () => {
    const cats = [
      { id: 'b', nome: 'Bebidas', ordem: 2 },
      { id: 'l', nome: 'Lanches', ordem: 1 },
      { id: 'v', nome: 'Vazia', ordem: 3 },
      { id: 's', nome: 'Sobremesas' },
    ];
    const prods = [
      { id: '1', nome: 'X-Tudo', categoriaId: 'l' },
      { id: '2', nome: 'Água', categoriaId: 'b' },
      { id: '3', nome: 'X-Bacon', categoriaId: 'l' },
      { id: '4', nome: 'Avulso', categoriaId: null },
      { id: '5', nome: 'Antigo', categoriaId: 'apagada' },
      { id: '6', nome: 'Pudim', categoriaId: 's' },
    ];
    const g = c.agruparPorCategoria(prods, cats);
    assert.deepEqual(
      g.map((x) => [x.nome, x.produtos.map((p) => p.nome)]),
      [
        ['Lanches', ['X-Bacon', 'X-Tudo']],
        ['Bebidas', ['Água']],
        ['Sobremesas', ['Pudim']],
        ['Sem categoria', ['Antigo', 'Avulso']],
      ],
    );
    assert.deepEqual(c.agruparPorCategoria([], cats), []);
  });

  // ── a gaveta de editar ──
  const P = {
    id: 'p1', nome: 'X-Bacon', descricao: 'Pão e bacon', codigo: '2051', categoriaId: 'l', categoriaNome: 'Lanches',
    imagemRef: 'https://x/a.jpg', precoVenda: '39.90', precoIfood: '45.00', noIfood: true,
    disponivelBalcao: true, disponivelCardapio: true, canaisPausados: ['gogem'],
  };
  const CTX = {
    comIfood: true, podeMudarPreco: true,
    outros: [P, { id: 'p2', nome: 'X-Tudo', codigo: '2052' }],
    categorias: [{ id: 'l', nome: 'Lanches' }, { id: 'b', nome: 'Bebidas' }],
  };
  const plano = (mudar, ctx = CTX, p = P) => c.analisarEdicao(p, { ...c.edicaoInicial(p), ...mudar }, ctx);

  caso('abrir e salvar sem mexer: nada muda, nada grava', () => {
    const r = plano({});
    assert.equal(r.mudou, false);
    assert.deepEqual([r.erros, r.patch, r.precos, r.pausas], [[], {}, [], []]);
  });

  caso('cadastro e preços: o PATCH só com o que mudou; os preços pelo canal; "Ao salvar" em palavras', () => {
    const r = plano({ nome: ' X-Bacon duplo ', categoriaId: 'b', precoRegem: '42,9', precoIfood: '49,90' });
    assert.deepEqual(r.patch, { nome: 'X-Bacon duplo', categoriaId: 'b' });
    assert.deepEqual(r.precos, [{ canal: 'regem', valor: '42.90' }, { canal: 'ifood', valor: '49.90' }]);
    assert.equal(r.regem.length, 3);
    assert.match(r.regem[2], /preço de venda R\$\s39,90 → R\$\s42,90/);
    assert.deepEqual(r.ifoodVai.length, 1);
    assert.match(r.ifoodVai[0], /^preço R\$\s45,00 → R\$\s49,90$/);
    assert.deepEqual(r.ifoodAtencao, ['o nome e a descrição no iFood mudam no Gestor de Pedidos']);
  });

  caso('erros ANTES de gravar: código de outro produto, nome e categoria vazios, preço inválido', () => {
    const r = plano({ codigo: '2052', nome: '  ', categoriaId: '', precoRegem: '0', precoIfood: 'abc' });
    assert.equal(r.erros.length, 5);
    assert.match(r.erros[0], /nome/);
    assert.match(r.erros[1], /2052 já é do produto "X-Tudo"/);
    assert.match(r.erros[3], /^Preço de venda:/);
    assert.match(r.erros[4], /^Preço no iFood:/);
    assert.equal('codigo' in r.patch, false);
  });

  caso('código novo: vai ao Regem; no iFood avisa que o item segue com o código antigo', () => {
    const r = plano({ codigo: '3000' });
    assert.deepEqual(r.patch, { codigo: '3000' });
    assert.match(r.ifoodAtencao[0], /segue com o código 2051/);
    // apagar o código: null; sem código, nada vai ao iFood
    const s = plano({ codigo: '' });
    assert.deepEqual(s.patch, { codigo: null });
    assert.match(s.ifoodAtencao[0], /sem código PDV/);
  });

  caso('pausas: Regem e iFood pelo canal; esgotado avisa que segue pausado no iFood', () => {
    const r = plano({ pausaRegem: true, pausaIfood: true });
    assert.deepEqual(r.pausas, [{ canal: 'regem', pausado: true }, { canal: 'ifood', pausado: true }]);
    assert.deepEqual(r.ifoodVai, ['pausa']);
    const esg = { ...P, canaisPausados: ['ifood'], pausadoEstoque: true };
    const s = plano({ pausaIfood: false }, CTX, esg);
    assert.deepEqual(s.ifoodVai, ['reativa']);
    assert.match(s.ifoodAtencao[0], /esgotado pelo estoque/);
  });

  caso('"Está no iFood": sair pausa lá e não manda a pausa à parte; preço em branco é aviso, não envio', () => {
    const r = plano({ noIfood: false, pausaIfood: true });
    assert.deepEqual(r.patch, { noIfood: false });
    assert.deepEqual(r.pausas, []);
    assert.deepEqual(r.ifoodVai, ['sai do cardápio do iFood: o item lá fica pausado']);
    const s = plano({ precoIfood: '' });
    assert.deepEqual(s.precos, [{ canal: 'ifood', valor: null }]);
    assert.deepEqual(s.ifoodVai, []);
    assert.match(s.ifoodAtencao[0], /preço em branco/);
  });

  caso('sem o iFood ligado ou sem "Ver valores em R$": nem a coluna nem o preço entram', () => {
    const r = plano({ noIfood: false, precoIfood: '1', pausaIfood: true }, { ...CTX, comIfood: false });
    assert.equal(r.mudou, false);
    const s = plano({ precoRegem: '1,00', nome: 'Outro' }, { ...CTX, podeMudarPreco: false });
    assert.deepEqual(s.precos, []);
    assert.deepEqual(s.patch, { nome: 'Outro' });
  });

  console.log(`\ncheck:catalogo — ${n} grupos de casos, todos certos.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
