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
// "Conferir com os apps" (R3 F4a): as regras da tela, num arquivo próprio (sem import, como o de cima).
writeFileSync(
  join(tmp, 'conferencia-apps.mjs'),
  ts.transpileModule(readFileSync(join(raiz, 'conferencia-apps.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText,
);
const cf = await import(pathToFileURL(join(tmp, 'conferencia-apps.mjs')).href);

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
    assert.deepEqual(r.ifoodVai.length, 2);
    assert.match(r.ifoodVai[0], /^preço R\$\s45,00 → R\$\s49,90$/);
    // R3 F1b (Orzuni 1.2.0): o nome vai ao iFood; nada fica para o Gestor
    assert.equal(r.ifoodVai[1], 'nome');
    assert.deepEqual(r.ifoodAtencao, []);
  });

  caso('nome e descrição ao iFood: só o que mudou; acima do limite do iFood avisa; entrar no iFood não sobrescreve', () => {
    assert.deepEqual(plano({ descricao: 'Nova' }).ifoodVai, ['descrição']);
    assert.deepEqual(plano({ descricao: 'Nova', nome: 'Outro' }).ifoodVai, ['nome e descrição']);
    const longo = plano({ nome: 'X'.repeat(101) });
    assert.match(longo.ifoodAtencao[0], /até 100 caracteres: o nome não vai/);
    const entra = plano({ noIfood: true, nome: 'Novo' }, CTX, { ...P, noIfood: false });
    assert.deepEqual(entra.ifoodVai, ['entra no cardápio do iFood: vão o preço e a situação']);
    assert.deepEqual(entra.ifoodAtencao, ['ao entrar no iFood, o nome e a descrição de lá ficam como estão']);
    assert.deepEqual(plano({ imagemRef: 'https://x/b.jpg' }).ifoodAtencao, ['a foto no iFood muda no Gestor de Pedidos']);
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

  caso('código novo: vai ao Regem e troca no iFood (antes do resto)', () => {
    const r = plano({ codigo: '3000', precoIfood: '60' });
    assert.deepEqual(r.patch, { codigo: '3000' });
    assert.equal(r.ifoodVai[0], 'troca o código 2051 → 3000');
    assert.match(r.ifoodVai[1], /^preço/);
    assert.deepEqual(r.ifoodAtencao, []);
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

  // ── a 99 (R3 F2; migs 401/402) ──
  const P99 = { ...P, preco99: '44.90', na99: true };
  const CTX99 = { ...CTX, com99: true };

  caso('a 99: pausa = "99food" na lista; sem preço só quem está na 99; "pausado em algum canal" só com ela ligada', () => {
    assert.equal(c.pausadoNa99({ canaisPausados: ['99food'] }), true);
    assert.equal(c.pausadoNa99({ canaisPausados: ['ifood'] }), false);
    assert.equal(c.semPrecoNa99({ na99: true, preco99: null }), true);
    assert.equal(c.semPrecoNa99({ na99: false, preco99: null }), false);
    const p = { na99: true, canaisPausados: ['99food'] };
    assert.equal(c.pausadoEmAlgumCanal(p, false, true), true);
    assert.equal(c.pausadoEmAlgumCanal(p, false, false), false);
    assert.equal(c.pausadoEmAlgumCanal(p, false), false); // chamada antiga (sem a 99) segue igual
  });

  caso('a 99 na gaveta: preço, pausa e nome vão na hora; o iFood não muda por causa dela', () => {
    const r = plano({ preco99: '49,9', pausa99: true, nome: 'X-Bacon duplo' }, CTX99, P99);
    assert.deepEqual(r.precos, [{ canal: '99food', valor: '49.90' }]);
    assert.deepEqual(r.pausas, [{ canal: '99food', pausado: true }]);
    assert.equal(r.n99Vai.length, 3);
    assert.match(r.n99Vai[0], /^preço R\$\s44,90 → R\$\s49,90$/);
    assert.deepEqual(r.n99Vai.slice(1), ['pausa', 'nome']);
    assert.deepEqual(r.n99Atencao, []);
    assert.deepEqual(r.ifoodVai, ['nome']);
    // Sem a 99 ligada: nada da 99 entra (a mesma edição, sem a 99).
    const s = plano({ preco99: '49,9', pausa99: true, na99: false }, CTX, P99);
    assert.deepEqual([s.precos, s.pausas, s.n99Vai, 'na99' in s.patch], [[], [], [], false]);
  });

  caso('a 99 não troca o código: com o código novo, liga a outro item de lá (o nome de lá fica); limites 180/1500', () => {
    const r = plano({ codigo: '3000', nome: 'Outro' }, CTX99, P99);
    assert.match(r.n99Atencao[0], /a 99 não troca o código de um item: com o código 3000/);
    assert.match(r.n99Atencao[1], /nome e a descrição de lá ficam como estão/);
    assert.equal(r.n99Vai.includes('nome'), false);
    assert.match(plano({ nome: 'X'.repeat(181) }, CTX99, P99).n99Atencao[0], /até 180 caracteres: o nome não vai/);
    assert.deepEqual(plano({ nome: 'X'.repeat(150) }, CTX99, P99).n99Atencao, []); // 150 passa na 99 (no iFood não)
    assert.match(plano({ descricao: 'D'.repeat(1501) }, CTX99, P99).n99Atencao[0], /até 1500 caracteres/);
  });

  caso('"Está na 99": entrar manda preço e situação; sair pausa lá; preço em branco é aviso; sem código nada vai', () => {
    const entra = plano({ na99: true }, CTX99, { ...P99, na99: false });
    assert.deepEqual(entra.patch, { na99: true });
    assert.deepEqual(entra.n99Vai, ['entra no cardápio da 99: vão o preço e a situação']);
    const sai = plano({ na99: false, pausa99: true }, CTX99, P99);
    assert.deepEqual([sai.patch, sai.pausas, sai.n99Vai], [{ na99: false }, [], ['sai do cardápio da 99: o item lá fica pausado']]);
    const branco = plano({ preco99: '' }, CTX99, P99);
    assert.deepEqual(branco.precos, [{ canal: '99food', valor: null }]);
    assert.match(branco.n99Atencao[0], /preço em branco/);
    const semCod = plano({ preco99: '50' }, CTX99, { ...P99, codigo: '' });
    assert.deepEqual(semCod.n99Vai, []);
    assert.match(semCod.regem[0], /preço na 99 .* \(guardado\)/);
    assert.match(semCod.n99Atencao.join(' | '), /sem código PDV: nada vai à 99/);
    // Preço inválido: erro antes de gravar; esgotado avisa que segue pausado.
    assert.match(plano({ preco99: 'abc' }, CTX99, P99).erros[0], /^Preço na 99:/);
    const esg = plano({ pausa99: false }, CTX99, { ...P99, canaisPausados: ['99food'], pausadoEstoque: true });
    assert.deepEqual(esg.n99Vai, ['reativa']);
    assert.match(esg.n99Atencao[0], /segue pausado na 99/);
  });

  // ── os complementos (R3 F3a) ──
  const OPC = { opcaoId: 'o1', nome: 'Bacon extra', codigoPdv: 'A01', preco: '5', esgotado: false, canaisPausados: [], precoIfood: '5.00' };
  const GRS = [{ id: 'g1', nome: 'Adicionais', preco: '5' }, { id: 'g2', nome: 'Adicionais da batata', preco: '4.5' }];
  const planoOpc = (mudar, ctx = { comIfood: true, podeMudarPreco: true }, o = OPC) =>
    c.analisarEdicaoDaOpcao(o, GRS, { ...c.edicaoInicialDaOpcao(o, GRS), ...mudar }, ctx);

  caso('complemento: pausa por canal e "Em falta" (todos os canais); informativo = sem código', () => {
    assert.equal(c.opcaoPausadaNo({ ...OPC, canaisPausados: ['regem'] }, 'regem'), true);
    assert.equal(c.opcaoPausadaNo({ ...OPC, canaisPausados: ['regem'] }, 'ifood'), false);
    assert.equal(c.opcaoPausadaNo({ ...OPC, esgotado: true }, 'ifood'), true);
    assert.equal(c.opcaoPausadaEmAlgumCanal({ ...OPC, canaisPausados: ['ifood'] }, false), false); // sem o iFood, só o Regem conta
    assert.equal(c.opcaoPausadaEmAlgumCanal({ ...OPC, canaisPausados: ['ifood'] }, true), true);
    assert.equal(c.informativa({ codigoPdv: ' ' }), true);
    assert.equal(c.opcaoSemPrecoNoIfood({ ...OPC, precoIfood: null }), true);
    assert.equal(c.opcaoSemPrecoNoIfood({ codigoPdv: '', precoIfood: null }), false);
    const grupos = [
      { id: 'g1', nome: 'Adicionais', produtos: [], opcoes: [OPC, { ...OPC, opcaoId: 'o2' }] },
      { id: 'g2', nome: 'Batata', produtos: [], opcoes: [{ ...OPC, preco: '4.5' }] },
    ];
    assert.deepEqual(c.gruposDaOpcao(grupos, 'o1').map((g) => [g.id, g.preco]), [['g1', '5'], ['g2', '4.5']]);
  });

  caso('preço do complemento digitado: zero vale (grátis); vazio só nos apps', () => {
    assert.deepEqual(c.precoDoComplementoDigitado('0', false), { valor: '0.00' });
    assert.deepEqual(c.precoDoComplementoDigitado('4,5', false), { valor: '4.50' });
    assert.match(c.precoDoComplementoDigitado('', false).erro, /0 para grátis/);
    assert.deepEqual(c.precoDoComplementoDigitado('', true), { valor: null });
    assert.match(c.precoDoComplementoDigitado('4,555', false).erro, /2 casas/);
  });

  caso('a gaveta do complemento: o preço de cada grupo, o do iFood e as pausas; "Ao salvar" em palavras', () => {
    assert.equal(planoOpc({}).mudou, false);
    assert.deepEqual(c.edicaoInicialDaOpcao(OPC, GRS).precos, { g1: '5,00', g2: '4,50' });
    const r = planoOpc({ precos: { g1: '6', g2: '4,50' }, precoIfood: '5,5', pausaRegem: true, pausaIfood: true });
    assert.deepEqual(r.precosGrupo, [{ grupoId: 'g1', valor: '6.00' }]);
    assert.deepEqual(r.precosApp, [{ canal: 'ifood', valor: '5.50' }]);
    assert.deepEqual(r.pausas, [{ canal: 'regem', pausado: true }, { canal: 'ifood', pausado: true }]);
    assert.match(r.regem[0], /^preço em "Adicionais" R\$\s5,00 → R\$\s6,00$/);
    assert.match(r.regem[1], /pausado no balcão e no cardápio digital/);
    assert.match(r.ifoodVai[0], /em todos os grupos com o código A01/);
    assert.equal(r.ifoodVai[1], 'pausa');
    // Erros antes de gravar; sem "Ver valores em R$" nenhum preço entra; sem o iFood, nada do iFood.
    assert.match(planoOpc({ precos: { g1: '', g2: '4,5' } }).erros[0], /^Preço em "Adicionais":/);
    assert.deepEqual(planoOpc({ precos: { g1: '9', g2: '9' } }, { comIfood: true, podeMudarPreco: false }).precosGrupo, []);
    const semIfood = planoOpc({ precoIfood: '1', pausaIfood: true }, { comIfood: false, podeMudarPreco: true });
    assert.deepEqual([semIfood.precosApp, semIfood.pausas, semIfood.mudou], [[], [], false]);
    // "Em falta": reativar a pausa do Regem avisa que segue fora; o do iFood, que segue pausado lá.
    const emFalta = planoOpc({ pausaRegem: false, pausaIfood: false }, undefined, { ...OPC, esgotado: true, canaisPausados: ['regem', 'ifood'] });
    assert.match(emFalta.regem.join(' | '), /segue fora: está "Em falta"/);
    assert.match(emFalta.ifoodAtencao[0], /segue pausado no iFood/);
    // Sem preço antes: só o novo (nada de "sem preço → …").
    assert.match(planoOpc({ precoIfood: '5' }, undefined, { ...OPC, precoIfood: null }).ifoodVai[0], /^preço R\$\s5,00, em todos os grupos/);
    // Preço em branco no iFood = aviso, não envio.
    const branco = planoOpc({ precoIfood: '' });
    assert.deepEqual([branco.precosApp, branco.ifoodVai], [[{ canal: 'ifood', valor: null }], []]);
    assert.match(branco.ifoodAtencao[0], /preço em branco/);
  });

  caso('a 99 nos complementos (F3b): preço por código a cada grupo da 99, pausa, "Em falta"; sem a 99 nada entra', () => {
    const o99 = { ...OPC, preco99: '4.00' };
    const ctx = { comIfood: true, com99: true, podeMudarPreco: true };
    const r = planoOpc({ preco99: '4,5', pausa99: true }, ctx, o99);
    assert.deepEqual(r.precosApp, [{ canal: '99food', valor: '4.50' }]);
    assert.deepEqual(r.pausas, [{ canal: '99food', pausado: true }]);
    assert.match(r.n99Vai[0], /^preço R\$\s4,00 → R\$\s4,50, em cada grupo da 99 com o código A01$/);
    assert.equal(r.n99Vai[1], 'pausa');
    assert.deepEqual(r.ifoodVai, []);
    // Zero vale (grátis); em branco = aviso; "Em falta" segue pausado lá.
    assert.deepEqual(planoOpc({ preco99: '0' }, ctx, o99).precosApp, [{ canal: '99food', valor: '0.00' }]);
    assert.match(planoOpc({ preco99: '' }, ctx, o99).n99Atencao[0], /preço em branco/);
    const falta = planoOpc({ pausa99: false }, ctx, { ...o99, esgotado: true, canaisPausados: ['99food'] });
    assert.match(falta.n99Atencao[0], /segue pausado na 99/);
    // Sem a 99 ligada: nada da 99 (a mesma edição).
    const sem = planoOpc({ preco99: '4,5', pausa99: true }, { comIfood: true, podeMudarPreco: true }, o99);
    assert.deepEqual([sem.precosApp, sem.pausas, sem.n99Vai], [[], [], []]);
    assert.equal(c.opcaoSemPrecoNa99({ ...OPC, preco99: null }), true);
    assert.equal(c.opcaoPausadaEmAlgumCanal({ ...OPC, canaisPausados: ['99food'] }, true, true), true);
    assert.equal(c.opcaoPausadaEmAlgumCanal({ ...OPC, canaisPausados: ['99food'] }, true, false), false);
  });

  // ── Conferir com os apps (R3 F4a) ────────────────────────────────────────────────────────────────────────────
  const L = (o) => ({
    chave: 'pdv:1', tipo: 'item', nome: 'X-Salada', pdv: '2052', grupos: ['Burgers'], precos: [29.9], promoDe: null, pausado: false,
    regem: { id: 'p1', nome: 'X-Salada', preco: 32.9, ativo: true }, ligaPeloId: false, situacao: 'igual', motivo: null, outros: [], ...o,
  });
  caso('conferência: o selo e a frase de cada situação, nas palavras do protótipo (iFood e 99)', () => {
    assert.match(cf.seloDa(L({ situacao: 'preco', motivo: 'precoDiferente' }), 'ifood').frase, /^iFood R\$\s29,90 · Regem R\$\s32,90$/);
    assert.equal(cf.seloDa(L({ situacao: 'preco', motivo: 'semPrecoNoRegem' }), '99food').frase, 'No Regem o preço da 99 está em branco.');
    assert.match(cf.seloDa(L({ situacao: 'preco', motivo: 'precosDiferentesNosGrupos', precos: [6, 6.5] }), '99food').frase, /^99: R\$\s6,00 a R\$\s6,50, conforme o grupo/);
    assert.equal(cf.seloDa(L({ situacao: 'soApp', regem: null }), 'ifood').frase, 'Item sem produto no Regem com este código: a venda pelo iFood não baixa o estoque.');
    assert.equal(cf.seloDa(L({ situacao: 'soApp', tipo: 'opcao', regem: null }), '99food').rotulo, 'Só na 99');
    assert.equal(cf.seloDa(L({ situacao: 'soRegem', pdv: '2080', nome: 'Hot dog' }), 'ifood').frase, '"Hot dog" está marcado "Está no iFood", mas o iFood não tem item com o código 2080.');
    assert.match(cf.seloDa(L({ situacao: 'soRegem', motivo: 'semCodigoNoRegem', nome: 'Hot dog' }), 'ifood').frase, /não tem código PDV no Regem: não liga ao iFood/);
    assert.equal(
      cf.seloDa(L({ situacao: 'naoLiga', motivo: 'repetidoNoApp', nome: 'Smash', pdv: '2060', outros: ['Smash Cheddar', 'Smash Bacon'] }), 'ifood').frase,
      'O código 2060 está em 3 itens do iFood: "Smash", "Smash Cheddar" e "Smash Bacon".',
    );
    assert.equal(cf.seloDa(L({ situacao: 'naoLiga', motivo: 'repetidoNoRegem', outros: ['Wrap', 'Wrap (cópia)'], pdv: '2070' }), 'ifood').rotulo, 'Código repetido no Regem');
    assert.match(cf.seloDa(L({ situacao: 'naoLiga', motivo: 'semCodigo', tipo: 'opcao', pdv: null }), 'ifood').frase, /o código que o Orzuni gera/);
    assert.equal(cf.seloDa(L({ situacao: 'ignorada', motivo: 'precoDiferente' }), 'ifood').tom, 'neutro');
    assert.match(cf.seloDa(L({ ligaPeloId: true }), '99food').frase, /pelo id do produto/);
  });
  caso('conferência: "Usar os preços do app" só leva preço diferente, preenchido no Regem e um preço só no app; a busca e as fichas', () => {
    assert.equal(cf.entraNoUsarEmMassa(L({ situacao: 'preco', motivo: 'precoDiferente' })), true);
    assert.equal(cf.entraNoUsarEmMassa(L({ situacao: 'preco', motivo: 'semPrecoNoRegem', regem: { id: 'p1', nome: 'X', preco: null, ativo: true } })), false);
    assert.equal(cf.entraNoUsarEmMassa(L({ situacao: 'preco', motivo: 'precosDiferentesNosGrupos', precos: [6, 6.5] })), false);
    assert.equal(cf.entraNoUsarEmMassa(L({ situacao: 'ignorada', motivo: 'precoDiferente' })), false);
    assert.equal(cf.bateNaBusca(L({ nome: 'Pão de Açúcar' }), 'acucar'), true);
    assert.equal(cf.bateNaBusca(L({}), '2052'), true);
    assert.equal(cf.bateNaBusca(L({ regem: { id: 'p', nome: 'Lanche da casa', preco: 1, ativo: true } }), 'casa'), true);
    assert.equal(cf.bateNaBusca(L({}), 'pizza'), false);
    assert.deepEqual(cf.situacoesDa('ifood', 'item').map((s) => s.rotulo), ['Só no iFood', 'Só no Regem', 'Preço diferente', 'Não dá para ligar', 'Iguais', 'Ignoradas']);
    assert.equal(cf.situacoesDa('99food', 'opcao').some((s) => s.k === 'soRegem'), false);
    assert.equal(cf.pendente(L({ situacao: 'ignorada' })), false);
    assert.equal(cf.pendente(L({ situacao: 'soApp' })), true);
    assert.equal(cf.listaE(['A']), '"A"');
    const agora = new Date('2026-11-11T18:00:00Z');
    assert.equal(cf.quandoLido('2026-11-11T17:30:00Z', agora), 'hoje às 14:30');
    assert.equal(cf.quandoLido('2026-11-10T12:05:00Z', agora), 'em 10/11 às 09:05');
    assert.equal(cf.quandoLido(null, agora), 'ainda não lido');
  });

  console.log(`\ncheck:catalogo — ${n} grupos de casos, todos certos.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
