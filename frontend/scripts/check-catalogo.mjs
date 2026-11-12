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
// A calculadora de preço (R3 F5): o arquivo da tela e, para comparar, a função `calcular` do PROTÓTIPO aprovado.
writeFileSync(
  join(tmp, 'calculadora-preco.mjs'),
  ts.transpileModule(readFileSync(join(raiz, 'calculadora-preco.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText,
);
const calc = await import(pathToFileURL(join(tmp, 'calculadora-preco.mjs')).href);
// Cadastros › Cardápio depois da Gestão (R3 F7): o "Onde vende" ao criar e o "só o que mudou" ao editar.
writeFileSync(
  join(tmp, 'cadastro-onde-vende.mjs'),
  ts.transpileModule(readFileSync(join(raiz, 'cadastro-onde-vende.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
  }).outputText,
);
const ov = await import(pathToFileURL(join(tmp, 'cadastro-onde-vende.mjs')).href);
const prototipo = (() => {
  const html = readFileSync(join(raiz, '..', '..', '..', 'mockups', 'regem-conciliacao-ifood.html'), 'utf8');
  const ini = html.indexOf('  const FAIXAS_SIMPLES = [');
  const fim = html.indexOf('  // ── o estado da tela');
  if (ini < 0 || fim < 0) throw new Error('não achei a calculadora no protótipo');
  return new Function(`${html.slice(ini, fim)}; return { simples, calcular };`)();
})();

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

  // ── F4b: criar no Regem, ligar, corrigir o código ─────────────────────────────────────────────────────────
  const APPL = L({ chave: 'pdv:3000', nome: 'Combo do app', pdv: '3000', precos: [59.9], regem: null, situacao: 'soApp', pausado: false });
  caso('F4b: ligar diz antes o que muda — o código de → para, quem usava o antigo, o outro app, o preço e a pausa de lá', () => {
    const comCodigo = cf.efeitoDeLigar({ id: 'p', nome: 'X-Bacon', codigo: '2051', na99: true }, APPL, 'ifood');
    assert.equal(comCodigo.tom, 'critico');
    assert.deepEqual(comCodigo.frases.slice(0, 3), [
      'O código de "X-Bacon" passa de 2051 para 3000.',
      'Os pedidos que chegarem com o código 2051 (dos apps, do totem ou de outro canal) não ligam mais a este produto.',
      'Na 99, ele passa a ligar ao item de código 3000 de lá.',
    ]);
    assert.match(comCodigo.frases[3], /^O preço do iFood no Regem fica o de lá \(R\$\s59,90\): nada muda no iFood\.$/);
    const sem = cf.efeitoDeLigar({ id: 'p', nome: 'Combo da casa', codigo: '' }, { ...APPL, pausado: true }, '99food');
    assert.equal(sem.tom, 'info');
    assert.equal(sem.frases[0], '"Combo da casa" ganha o código 3000 e passa a ser marcado "Está na 99": a venda pela 99 baixa o estoque dele.');
    assert.match(sem.frases[1], /e ele fica pausado, como lá: nada muda na 99\.$/);
  });
  caso('F4b: "Corrigir o código" só aceita o código de um item "só no app"; diz qual é e por que não', () => {
    const itens = [
      APPL,
      L({ chave: 'pdv:2051', nome: 'X-Bacon', pdv: '2051', situacao: 'igual' }),
      L({ chave: 'pdv:2060|a', nome: 'Smash', pdv: '2060', situacao: 'naoLiga', motivo: 'repetidoNoApp' }),
      L({ chave: 'pdv:7', nome: 'Ignorado', pdv: '7', situacao: 'ignorada', regem: null }),
      L({ chave: 'regem:p9', nome: 'Hot dog', pdv: '2080', situacao: 'soRegem' }),
    ];
    assert.match(cf.itemDoCodigo(itens, ' 3000 ', 'ifood').frase, /^É "Combo do app" no iFood \(R\$\s59,90\)\.$/);
    assert.equal(cf.itemDoCodigo(itens, '3000', 'ifood').linha.chave, 'pdv:3000');
    assert.equal(cf.itemDoCodigo(itens, '2051', 'ifood').linha, null);
    assert.match(cf.itemDoCodigo(itens, '2051', 'ifood').frase, /já liga a "X-Salada" do Regem/);
    assert.match(cf.itemDoCodigo(itens, '2060', 'ifood').frase, /código está repetido lá/);
    assert.match(cf.itemDoCodigo(itens, '7', 'ifood').frase, /desfaça o "Ignorar" antes/);
    assert.equal(cf.itemDoCodigo(itens, '2080', 'ifood').frase, 'Nenhum item do iFood tem esse código.');
    assert.equal(cf.itemDoCodigo(itens, '', '99food').frase, 'Digite o código: a tela diz qual item da 99 ele é.');
  });
  caso('F4b: "Criar no Regem" — o pedido com o código e o preço do app, o "Onde vende", a pausa e a baixa; e o que falta', () => {
    // A categoria do Regem com o nome da do app (sem acento nem caixa) já vem escolhida; sem ela, o servidor recusa.
    const cats = [{ id: 'c1', nome: 'Burgers' }, { id: 'c2', nome: 'Combos da Casa' }];
    assert.equal(cf.formDeCriar({ ...APPL, grupos: ['COMBOS DA CASA'] }, 'ifood', cats).categoriaId, 'c2');
    const semCat = cf.formDeCriar({ ...APPL, grupos: ['Outra'] }, 'ifood', cats);
    assert.equal(semCat.categoriaId, '');
    assert.equal(cf.pedidoDeCriar({ ...semCat, baixa: 'nada' }, APPL, 'ifood', { comIfood: true, com99: false }).erro, 'Escolha a categoria no Regem: ela organiza o produto no cardápio digital e no balcão.');
    const f = { ...cf.formDeCriar({ ...APPL, pausado: true }, 'ifood'), categoriaId: 'c1' };
    assert.deepEqual([f.nome, f.precoRegem, f.ondeRegem, f.ondeIfood, f.onde99, f.baixa], ['Combo do app', '59,90', false, true, false, 'ficha']);
    assert.equal(cf.pedidoDeCriar(f, APPL, 'ifood', { comIfood: true, com99: true }).erro, 'Escolha a ficha técnica (ou outra forma de baixar o estoque).');
    const combo = { ...f, baixa: 'combo', combo: [{ componenteProdutoId: 'p1', quantidade: '2' }, { componenteProdutoId: '', quantidade: '1' }], ondeRegem: true, precoRegem: '62,5' };
    const r = cf.pedidoDeCriar(combo, { ...APPL, pausado: true }, 'ifood', { comIfood: true, com99: true });
    assert.equal(r.ok, true);
    assert.deepEqual(r.corpo, {
      nome: 'Combo do app', codigo: '3000', categoriaId: 'c1', tipo: 'combo', precoVenda: 62.5, fichaId: null, itemId: null, itemUnidade: null,
      controlaEstoque: true, combo: [{ componenteProdutoId: 'p1', quantidade: 2 }], disponivelBalcao: true, disponivelCardapio: true,
      canaisPausados: ['ifood'], noIfood: true, precoIfood: '59.90', na99: false, preco99: null,
    });
    const nada = cf.pedidoDeCriar({ ...f, baixa: 'nada', precoRegem: '' }, APPL, '99food', { comIfood: false, com99: true });
    assert.deepEqual([nada.corpo.controlaEstoque, nada.corpo.precoVenda, nada.corpo.disponivelBalcao, 'noIfood' in nada.corpo], [false, 0, false, false]);
    assert.equal(cf.pedidoDeCriar({ ...f, baixa: 'nada', ondeRegem: true, precoRegem: '' }, APPL, 'ifood', { comIfood: true, com99: false }).erro, 'Digite o preço no Regem (ex.: 29,90).');
    assert.equal(cf.pedidoDeCriar({ ...f, nome: '  ' }, APPL, 'ifood', { comIfood: true, com99: false }).erro, 'Dê um nome ao produto.');
    assert.equal(cf.pedidoDeCriar({ ...f, baixa: 'item' }, APPL, 'ifood', { comIfood: true, com99: false }).erro, 'Escolha o item de estoque (ou outra forma de baixar o estoque).');
    const item = cf.pedidoDeCriar({ ...f, baixa: 'item', itemId: 'i1', itemUnidade: 'fardo' }, APPL, 'ifood', { comIfood: true, com99: false });
    assert.deepEqual([item.corpo.itemId, item.corpo.itemUnidade, item.corpo.fichaId], ['i1', 'fardo', null]);
    assert.deepEqual([cf.precoDigitado('R$ 29,90'), cf.precoDigitado('29.9'), cf.precoDigitado('abc'), cf.precoDigitado('1,234')], [29.9, 29.9, null, null]);
  });
  caso('F4c: "Criar a opção no Regem" — código, ligação e "Controlar estoque" (V49); o preço do iFood no pedido, o da 99 e a pausa depois', () => {
    const OP = L({ chave: 'pdv:A01', tipo: 'opcao', nome: 'Bacon extra', pdv: 'A01', precos: [6.5], regem: null, situacao: 'soApp', pausado: true });
    const f = cf.formDeCriarOpcao(OP);
    assert.deepEqual([f.nome, f.baixa], ['Bacon extra', 'item']);
    assert.equal(cf.pedidoDeCriarOpcao(f, OP, 'ifood', { comIfood: true }).erro, 'Escolha o item de estoque (ou outra forma de baixar o estoque).');
    const i = cf.pedidoDeCriarOpcao({ ...f, itemId: 'i1', itemUnidade: 'g' }, OP, 'ifood', { comIfood: true });
    assert.deepEqual(i.corpo, { nome: 'Bacon extra', codigoPdv: 'A01', tipo: 'insumo', fichaId: null, itemId: 'i1', itemUnidade: 'g', produtoRefId: null, controlaEstoque: true, precoIfood: '6.50' });
    assert.deepEqual([i.preco99, i.pausar], [null, true]);
    const n99 = cf.pedidoDeCriarOpcao({ ...f, baixa: 'ficha', fichaId: 'f1' }, { ...OP, pausado: false }, '99food', { comIfood: true });
    assert.deepEqual([n99.corpo.tipo, n99.corpo.fichaId, 'precoIfood' in n99.corpo, n99.preco99, n99.pausar], ['ficha', 'f1', false, '6.50', false]);
    const nada = cf.pedidoDeCriarOpcao({ ...f, baixa: 'nada' }, { ...OP, precos: [6, 6.5] }, '99food', { comIfood: false });
    assert.deepEqual([nada.corpo.tipo, nada.corpo.controlaEstoque, nada.preco99], ['simples', false, null]);
    const prod = cf.pedidoDeCriarOpcao({ ...f, baixa: 'produto', produtoRefId: 'p7' }, OP, 'ifood', { comIfood: false });
    assert.deepEqual([prod.corpo.tipo, prod.corpo.produtoRefId, 'precoIfood' in prod.corpo], ['simples', 'p7', false]);
    assert.equal(cf.pedidoDeCriarOpcao({ ...f, baixa: 'produto' }, OP, 'ifood', { comIfood: true }).erro, 'Escolha o produto do Regem (ou outra forma de baixar o estoque).');
    assert.equal(cf.pedidoDeCriarOpcao({ ...f, nome: ' ' }, OP, 'ifood', { comIfood: true }).erro, 'Dê um nome à opção.');
  });

  // ── F5: a calculadora de preço ────────────────────────────────────────────────────────────────────────────
  const TAXAS = {
    ifood: { plano: 'loja', baseComissao: 'loja', parteNaEntrega: null, loja: { com: 12, pag: 3.2, taxaFixa: 0 }, app: { com: 23, pag: 3.2, taxaFixa: 0 } },
    '99food': { plano: 'app', baseComissao: 'cliente', parteNaEntrega: null, loja: { com: 10.9, pag: 3.2, taxaFixa: 0 }, app: { com: 8.9, pag: 3.2, taxaFixa: 0 } },
    geral: { impostoModo: 'simples', imposto: 6, rbt12: 540000, margem: 20, antecipa: false, antec: 2.5, entregaLoja: 0.8, arred: true, maquininha: 2.9, itensPedido: 2 },
  };
  const VENDAS = { rbt12: null, rbt12Motivo: null, itensPorPedido: null, pedidos: 0, parteNaEntrega: { ifood: { pct: 30, pedidos: 10 }, '99food': { pct: 30, pedidos: 10 } }, dias: 90 };
  caso('F5: Simples Nacional, Anexo I — a faixa e a alíquota efetiva; acima de R$ 4,8 mi, fora (a mesma do protótipo)', () => {
    const s = calc.simples(540000);
    assert.deepEqual([s.faixa, s.nominal, Math.round(s.efetiva * 1000) / 1000], [3, 9.5, 6.933]);
    assert.equal(calc.simples(180000).efetiva, 4);
    assert.equal(calc.simples(5_000_000), null);
    assert.equal(calc.simples(0), null);
    for (const v of [50_000, 300_000, 1_000_000, 4_000_000]) assert.equal(calc.simples(v).efetiva, prototipo.simples(v).efetiva);
  });
  caso('F5: o exemplo à mão — X-Bacon (custo 6,90 + embalagem 1,50) no iFood, a loja entrega: R$ 15,90 recomendado, R$ 11,80 mínimo', () => {
    const r = calc.calcular({ custo: 6.9, emb: 1.5 }, 'ifood', 'loja', TAXAS, VENDAS, calc.PROMO_PADRAO);
    // pagamento: 70% online (3,2%) + 30% maquininha (2,9%) = 3,11%; imposto do Simples 6,93%; fixo = 6,90 + 1,50 + 0,80
    assert.equal(Math.round(r.partes.pagamento * 100) / 100, 3.11);
    assert.equal(Math.round(r.fixo * 100) / 100, 9.2);
    assert.deepEqual([r.recomendado, r.minimo], [15.9, 11.8]);
    const hoje = r.com(39.9);
    assert.ok(Math.abs(hoje.lucro - (39.9 - hoje.taxasR - 9.2)) < 1e-9);
  });
  caso('F5: a conta é a MESMA do protótipo aprovado — uma grade de cenários (apps, jeitos, promoções, bases, imposto, antecipação)', () => {
    const promos = [
      { ligada: false },
      { ligada: true, tipo: 'pct', desconto: 30, quemBanca: 'parte', lojaBanca: 100 },
      { ligada: true, tipo: 'pct', desconto: 20, quemBanca: 'parte', lojaBanca: 50 },
      { ligada: true, tipo: 'rsItem', descontoRs: 5, quemBanca: 'appFixo', appFixo: 3 },
      { ligada: true, tipo: 'rsPedido', descontoRs: 10, quemBanca: 'appFixo', appFixo: 7 },
    ].map((p) => ({ ...calc.PROMO_PADRAO, ...p }));
    let casos = 0;
    for (const canal of ['ifood', '99food'])
      for (const k of ['loja', 'app'])
        for (const promo of promos)
          for (const base of ['cliente', 'loja', 'cheio'])
            for (const [modo, antecipa, taxaFixa, semEntrega] of [['simples', false, 0, false], ['media', true, 4.5, false], ['simples', true, 2, true]]) {
              const t = JSON.parse(JSON.stringify(TAXAS));
              t[canal].baseComissao = base;
              t[canal].app.taxaFixa = taxaFixa;
              t.geral.impostoModo = modo;
              t.geral.antecipa = antecipa;
              const b = { custo: 12.4, emb: 2.1, semEntrega };
              const meu = calc.calcular(b, canal, k, t, VENDAS, promo);
              // O protótipo: o mesmo cenário no formato dele (`cen` e `g`).
              const g = { ...t.geral, parteNaEntrega: 30, promo: promo.ligada, promoTipo: promo.tipo, desconto: promo.desconto, descontoRs: promo.descontoRs, quemBanca: promo.quemBanca, lojaBanca: promo.lojaBanca, appFixo: promo.appFixo };
              const cen = { ...t[canal][k], k, baseComissao: base, entrega: semEntrega ? 0 : k === 'loja' ? g.entregaLoja : 0, taxaFixa: semEntrega ? 0 : t[canal][k].taxaFixa };
              const dele = prototipo.calcular(b, cen, g);
              assert.deepEqual([meu.recomendado, meu.minimo], [dele.recomendado, dele.minimo], `${canal} ${k} ${promo.tipo}/${promo.ligada} ${base} ${modo}`);
              for (const p of [19.9, 34.9]) {
                const a = meu.com(p);
                const d = dele.com(p);
                for (const c of ['clientePaga', 'vende', 'comissao', 'pagamento', 'imposto', 'lucro']) assert.ok(Math.abs(a[c] - d[c]) < 1e-9, `${c} em ${p}`);
                assert.ok(Math.abs(meu.descontoMax(p).rs - dele.descontoMax(p).rs) < 1e-9);
              }
              casos++;
            }
    assert.equal(casos, 180);
  });
  caso('F6: a foto de cada app pela última leitura — falta lá, só lá ou nada a dizer; a medida que a 99 pede', () => {
    const f = { canais: { ifood: { lidoEm: 'x', porProduto: { p1: 'https://a/1.jpg', p2: null } }, '99food': null } };
    assert.deepEqual(cf.fotosDoProduto(f, 'p1'), { ifood: 'https://a/1.jpg' });
    assert.deepEqual(cf.fotosDoProduto(f, 'p2'), { ifood: null });
    assert.deepEqual(cf.fotosDoProduto(f, 'p9'), {});
    assert.deepEqual(cf.fotosDoProduto(null, 'p1'), {});
    assert.equal(cf.situacaoDaFoto(true, null), 'faltaNoApp');
    assert.equal(cf.situacaoDaFoto(false, 'https://a/1.jpg'), 'soNoApp');
    assert.equal(cf.situacaoDaFoto(true, 'https://a/1.jpg'), null);
    assert.equal(cf.situacaoDaFoto(true, undefined), null);
    assert.deepEqual([cf.medidaParaA99(800, 600), cf.medidaParaA99(100, 600), cf.medidaParaA99(3200, 1000), cf.medidaParaA99(150, 3000)], [true, false, false, true]);
    // F6b: o iFood pede quadrada (folga de 2% do maior lado) e 300 px ou mais — os mesmos limites de `orzuni-foto.regras.ts`.
    assert.deepEqual(
      [cf.medidaParaOIfood(800, 800), cf.medidaParaOIfood(800, 815), cf.medidaParaOIfood(800, 830), cf.medidaParaOIfood(800, 600), cf.medidaParaOIfood(299, 299), cf.medidaParaOIfood(300, 300)],
      [true, true, false, false, false, true],
    );
    // F6c: a foto que não serve vai enquadrada — o quadrado do centro (o lado menor), reduzido a até 1200 px; menos de
    // 300 px no lado menor não se enquadra (aumentar borraria).
    assert.deepEqual(cf.recorteCentral(1920, 1280), { sx: 320, sy: 0, lado: 1280, saida: 1200 });
    assert.deepEqual(cf.recorteCentral(800, 600), { sx: 100, sy: 0, lado: 600, saida: 600 });
    assert.deepEqual(cf.recorteCentral(1080, 1921), { sx: 0, sy: 420, lado: 1080, saida: 1080 });
    assert.equal(cf.recorteCentral(1200, 299), null);
    assert.deepEqual(cf.recorteCentral(300, 300), { sx: 0, sy: 0, lado: 300, saida: 300 });
  });
  caso('F5: os números digitados × os das vendas; sem vendas, os exemplos; e o que não dá para pagar', () => {
    const t = JSON.parse(JSON.stringify(TAXAS));
    t.geral.rbt12 = null;
    t.geral.itensPedido = null;
    const v = { ...VENDAS, rbt12: 300000, itensPorPedido: 3.4, parteNaEntrega: { ifood: { pct: 12.5, pedidos: 8 }, '99food': { pct: null, pedidos: 0 } } };
    assert.deepEqual(
      [calc.numerosEfetivos(t, v, 'ifood').rbt12, calc.numerosEfetivos(t, v, 'ifood').itensPedido, calc.numerosEfetivos(t, v, 'ifood').parteNaEntrega, calc.numerosEfetivos(t, v, '99food').parteNaEntrega],
      [300000, 3.4, 12.5, 30],
    );
    assert.equal(calc.numerosEfetivos(t, null, 'ifood').itensPedido, 2);
    t.geral.impostoModo = 'media';
    assert.equal(calc.numerosEfetivos(t, v, 'ifood').imposto, 6);
    const caro = calc.calcular({ custo: 5, emb: 0 }, 'ifood', 'app', TAXAS, VENDAS, calc.PROMO_PADRAO, 80);
    assert.equal(caro.recomendado, null);
    assert.deepEqual([calc.numeroDigitado('540.000,00'), calc.numeroDigitado('12,5'), calc.numeroDigitado('12.5'), calc.numeroDigitado('abc'), calc.numeroDigitado('')], [540000, 12.5, 12.5, null, null]);
  });

  caso('F7: "Onde vende" ao criar — Regem = balcão E cardápio digital; o campo de um app só vai com o app ligado', () => {
    assert.deepEqual(ov.camposDoOndeVende(ov.ONDE_VENDE_NOVO, true, true), { disponivelBalcao: true, disponivelCardapio: true, noIfood: true, na99: true });
    assert.deepEqual(ov.camposDoOndeVende({ regem: false, ifood: true, n99: false }, true, true), { disponivelBalcao: false, disponivelCardapio: false, noIfood: true, na99: false });
    // Sem o app ligado, o campo nem vai (ausente = o servidor guarda o padrão; sem o direito, nem grava).
    assert.deepEqual(ov.camposDoOndeVende({ regem: true, ifood: true, n99: true }, false, false), { disponivelBalcao: true, disponivelCardapio: true });
    assert.deepEqual(ov.ondeNaoVende({ regem: false, ifood: true, n99: false }, true, true), ['no Regem', 'na 99']);
    assert.deepEqual(ov.ondeNaoVende({ regem: true, ifood: false, n99: false }, false, false), []);
    assert.equal(ov.linkDaGestao('X-Bacon & cia'), '/catalogo?busca=X-Bacon%20%26%20cia');
  });
  caso('F7: ao editar, só o que a pessoa mudou — nada que a Gestão possa ter mudado no meio; os canais um por vez', () => {
    const lido = ov.estadoDeVenda({ disponivelBalcao: true, disponivelCardapio: false, noIfood: true, canaisPausados: ['gogem', 'ifood'] });
    assert.deepEqual(lido, { disponivelBalcao: true, disponivelCardapio: false, noIfood: true, canaisPausados: ['gogem', 'ifood'] });
    // Nada mexido: nada vai (nem a lista, nem os booleanos).
    assert.deepEqual(ov.mudancasAoEditar(lido, { ...lido }, true), { patch: {}, canais: [] });
    // Despausou o iFood e pausou o Keeta; o totem (gogem) não aparece porque não mudou.
    const agora = { ...lido, disponivelCardapio: true, canaisPausados: ['gogem', 'keeta'] };
    assert.deepEqual(ov.mudancasAoEditar(lido, agora, true), {
      patch: { disponivelCardapio: true },
      canais: [{ canal: 'keeta', pausado: true }, { canal: 'ifood', pausado: false }],
    });
    // "Está no iFood" mudado só vai com o iFood ligado.
    assert.deepEqual(ov.mudancasAoEditar(lido, { ...lido, noIfood: false }, true).patch, { noIfood: false });
    assert.deepEqual(ov.mudancasAoEditar(lido, { ...lido, noIfood: false }, false).patch, {});
    // Ausente = disponível; lista ausente = vazia.
    assert.deepEqual(ov.estadoDeVenda({}), { disponivelBalcao: true, disponivelCardapio: true, noIfood: false, canaisPausados: [] });
  });

  console.log(`\ncheck:catalogo — ${n} grupos de casos, todos certos.`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
