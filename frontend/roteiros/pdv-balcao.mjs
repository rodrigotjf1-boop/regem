// Roteiro de tela do PDV · BALCÃO (pedido do dono, 17/11/2026): "melhorar a tela onde estão os cards — um card moderno, mais
// fácil de identificar o produto pela foto e pelo nome; não mexer no pedido; a janela que abre com as etapas mais retangular
// na horizontal (hoje gera barra de rolagem); com foto no cadastro, a foto ao lado do nome". A API simulada. Confere:
//  • o cartão: a foto do cadastro em cima (ou o ícone, sem foto), o nome inteiro legível, o preço; a contagem no pedido;
//  • a janela das etapas: larga (no monitor, a largura do diálogo grande), as opções em grade (várias por linha), a foto de
//    cada opção ao lado do nome, e o combo de três etapas SEM rolagem no monitor de 1080 px de altura;
//  • em cada largura: nenhuma barra de rolagem para o lado (a página, a grade e a janela aberta), a janela inteira na tela;
//  • o ícone do totem a pagar no cabeçalho do Balcão;
//  • o TAMANHO dos cartões (17/11, "a primeira tela parece não ter mudado"): grande é o padrão (foto 4:3, nome de 17 px);
//    "Compactos" encolhe na hora, grava nas preferências da pessoa e a tela reabre compacta.
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', nome: 'Rodrigo' });

// Uma "foto" de lanche desenhada (SVG), para a tela ter imagem sem rede.
const foto = (cor) =>
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 100"><rect width="160" height="100" fill="#f4efe6"/>` +
      `<ellipse cx="80" cy="42" rx="46" ry="20" fill="${cor}"/><rect x="34" y="52" width="92" height="10" rx="5" fill="#7a3b12"/>` +
      `<rect x="36" y="62" width="88" height="14" rx="7" fill="#e2a340"/></svg>`,
  );

const CATS = [
  { id: 'c1', nome: 'BURGUER + BATATA + REFRI', parentId: null, ordem: 1 },
  { id: 'c2', nome: 'BEBIDAS', parentId: null, ordem: 2 },
];
const PRODUTOS = [
  ...Array.from({ length: 18 }, (_, i) => ({
    id: `p${i + 1}`,
    nome: i === 4 ? 'TRIO MUSSARELA COM BACON E CHEDDAR CREMOSO' : `TRIO ${String(i + 1).padStart(2, '0')}`,
    codigo: i === 6 ? 'cw4620854' : String(69 + i),
    precoVenda: 20 + i * 1.5,
    categoriaId: 'c1',
    ativo: true,
    // dois sem foto: o cartão fica do mesmo tamanho, com o ícone
    imagemRef: i === 2 || i === 9 ? null : foto(['#c9772b', '#b5651d', '#d18b47'][i % 3]),
    tipo: 'simples',
  })),
  { id: 'b1', nome: 'Coca-Cola lata', codigo: '201', precoVenda: 6, categoriaId: 'c2', ativo: true, imagemRef: foto('#b00020'), tipo: 'simples' },
  { id: 'b2', nome: 'Suco natural', codigo: '202', precoVenda: 9, categoriaId: 'c2', ativo: true, imagemRef: null, tipo: 'variavel' },
];
const opcao = (id, nome, delta = 0, comFoto = true) => ({ id, nome, precoDelta: delta, codigoPdv: id, imagemRef: comFoto ? foto('#3a7d44') : null });
// O combo: três etapas (a batata, a bebida, os adicionais), 15 opções — o caso que rolava na janela estreita.
const DETALHE_COMBO = {
  ...PRODUTOS[0],
  variacoes: [],
  complementos: [
    { id: 'g1', nome: 'Escolha a batata', tipo: 'escolha', min: 1, max: 1, obrigatorio: true, regra: 'uma', opcoes: [opcao('o1', 'Batata frita'), opcao('o2', 'Batata rústica', 2), opcao('o3', 'Batata com cheddar e bacon', 6), opcao('o4', 'Sem batata', 0, false)] },
    { id: 'g2', nome: 'Escolha a bebida', tipo: 'escolha', min: 1, max: 1, obrigatorio: true, regra: 'uma', opcoes: [opcao('o5', 'Coca-Cola lata'), opcao('o6', 'Coca-Cola Zero lata'), opcao('o7', 'Guaraná Antarctica lata'), opcao('o8', 'Fanta laranja lata'), opcao('o9', 'Água sem gás'), opcao('o10', 'Suco natural', 4)] },
    { id: 'g3', nome: 'Adicionais', tipo: 'adicionar', min: 0, max: 5, regra: 'varias_com_repeticao', opcoes: [opcao('o11', 'Bacon', 5), opcao('o12', 'Cheddar', 4), opcao('o13', 'Ovo', 3, false), opcao('o14', 'Cebola caramelizada', 4), opcao('o15', 'Hambúrguer extra', 9)] },
  ],
};

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    const d = document.querySelector('[role="dialog"]');
    if (d) {
      const r = d.getBoundingClientRect();
      if (r.left < -1 || r.right > window.innerWidth + 1 || r.top < -1 || r.bottom > window.innerHeight + 1)
        achados.push(`janela fora da tela ${Math.round(r.left)}..${Math.round(r.right)} x ${Math.round(r.top)}..${Math.round(r.bottom)}`);
    }
    return achados;
  });

// O cartão de cada produto: a foto (ou o ícone), o nome sem estourar o cartão, o preço.
const cartoes = (page) =>
  page.$$eval('[data-produto]', (els) =>
    els.map((b) => {
      const r = b.getBoundingClientRect();
      const img = b.querySelector('img');
      const nome = b.querySelector('.line-clamp-2');
      const nr = nome?.getBoundingClientRect();
      return {
        id: b.getAttribute('data-produto'),
        largura: r.width,
        foto: img ? { w: img.getBoundingClientRect().width, h: img.getBoundingClientRect().height } : null,
        icone: !!b.querySelector('svg'),
        nome: nome?.textContent ?? '',
        nomeDentro: !!nr && nr.left >= r.left - 0.5 && nr.right <= r.right + 0.5,
        letra: nome ? parseFloat(getComputedStyle(nome).fontSize) : 0,
        tamanho: b.getAttribute('data-tamanho'),
        topo: Math.round(r.top),
      };
    }),
  );

export default async function roteiroPdvBalcao({ nav, base, ok, foto: arquivoFoto, larguras }) {
  async function abrir(w, h, prefs = {}) {
    const gravadas = [];
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => {
      localStorage.setItem('regen_token', jwt);
      localStorage.setItem('regem_terminal', JSON.stringify({ id: 'term-1', nome: 'Caixa 1' }));
    }, TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/produtos') return responder(route, PRODUTOS);
      if (p === '/produtos/categorias') return responder(route, CATS);
      if (p === '/produtos/p1') return responder(route, DETALHE_COMBO);
      if (p.startsWith('/produtos/')) return responder(route, { ...PRODUTOS.find((x) => `/produtos/${x.id}` === p), variacoes: [], complementos: [] });
      if (p === '/financeiro/caixa') return responder(route, { id: 'cx-1', status: 'aberta', origem: 'pdv', turnoNumero: 3, abertaEm: new Date().toISOString(), operadorNome: 'Rodrigo', horasAberto: 1 });
      if (p === '/financeiro/caixa/pendencias') return responder(route, { total: 0, pedidos: [] });
      if (p === '/financeiro/formas-pagamento')
        return responder(route, [
          { id: 'f1', nome: 'Dinheiro', tipo: 'dinheiro', ativo: true },
          { id: 'f2', nome: 'Pix', tipo: 'pix', ativo: true },
        ]);
      if (p === '/tef/config') return responder(route, { ativo: false });
      if (p === '/delivery/totem/aguardando-pagamento')
        return responder(route, { ativo: true, aposPagamento: true, minutos: 8, pedidos: [{ id: 'tt1', senha: '12', clienteNome: null, total: 31, minutos: 2, status: 'novo', pronto: false, atrasado: false }] });
      if (p === '/vendas/acertos') return responder(route, []);
      if (p === '/colaborador/me/prefs') {
        if (route.request().method() === 'PATCH') gravadas.push(JSON.parse(route.request().postData() || '{}'));
        return responder(route, prefs);
      }
      return responder(route, {});
    });
    await page.goto(base + '/pdv');
    await page.waitForSelector('[data-produto]', { timeout: 30000 });
    return { ctx, page, erros, gravadas };
  }

  // ── o monitor da loja (1920 × 1080): os cartões e a janela do combo ──
  {
    const { ctx, page, erros } = await abrir(1920, 1080);
    const cs = await cartoes(page);
    ok(cs.length === 18, `a 1ª categoria abre com os 18 cartões dela (${cs.length})`);
    const comFoto = cs.filter((c) => c.foto);
    ok(cs.every((c) => c.tamanho === 'grande'), 'o cartão grande é o padrão');
    const naLinha = cs.filter((c) => Math.abs(c.topo - cs[0].topo) < 2).length;
    ok(naLinha === 6, `6 cartões grandes por linha no monitor (${naLinha})`);
    ok(comFoto.length === 16 && comFoto.every((c) => c.foto.w >= 180 && c.foto.h >= 135), `a foto do cadastro GRANDE no cartão (${umaLinha(comFoto.map((c) => `${Math.round(c.foto.w)}x${Math.round(c.foto.h)}`).slice(0, 3).join(' '))})`);
    ok(cs.filter((c) => !c.foto).every((c) => c.icone), 'sem foto: o ícone no lugar (o cartão do mesmo tamanho)');
    ok(cs.every((c) => c.nomeDentro && c.letra >= 17), `o nome dentro do cartão, em letra de 17 px ou mais (${cs[0]?.letra} px)`);
    ok(cs.every((c) => c.largura >= 180), `cada cartão com 180 px ou mais (${Math.round(Math.min(...cs.map((c) => c.largura)))} px)`);
    ok(await page.locator('[data-totem-a-pagar="1"]').isVisible(), 'o ícone do totem a pagar no cabeçalho do Balcão');
    await page.screenshot({ path: arquivoFoto('pdv-balcao-1920.png') });

    await page.click('[data-produto="p1"]');
    await page.waitForSelector('[role="dialog"]');
    const j = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      const corpo = d.querySelector('.overflow-y-auto');
      const labels = [...d.querySelectorAll('fieldset')][1]?.querySelectorAll('label') ?? [];
      const tops = new Set([...labels].map((l) => Math.round(l.getBoundingClientRect().top)));
      return {
        largura: d.getBoundingClientRect().width,
        rola: corpo ? corpo.scrollHeight > corpo.clientHeight + 1 : true,
        fotos: d.querySelectorAll('fieldset img').length,
        linhasDaBebida: tops.size,
        opcoesDaBebida: labels.length,
      };
    });
    ok(j.largura >= 850, `a janela das etapas larga no monitor (${Math.round(j.largura)} px)`);
    ok(j.opcoesDaBebida === 6 && j.linhasDaBebida <= 2, `as 6 bebidas em grade: ${j.linhasDaBebida} linha(s)`);
    ok(j.fotos === 13, `a foto de cada opção que tem foto, ao lado do nome (${j.fotos} de 13)`);
    ok(!j.rola, 'o combo de três etapas cabe sem rolagem no monitor de 1080 px');
    ok((await medir(page)).length === 0, `1920 com a janela aberta: nada para o lado (${umaLinha((await medir(page)).join('; '))})`);
    await page.screenshot({ path: arquivoFoto('pdv-balcao-etapas-1920.png') });
    // escolher e pôr no pedido continua igual
    // a etapa obrigatória segura o "Adicionar"; "escolha 1" troca a escolha (pedido do dono, 17/11: "consegui as duas batatas")
    const botao = page.locator('[role="dialog"] button[type="submit"]');
    ok((await botao.isDisabled()) && /Escolha: Escolha a batata/.test(await botao.innerText()), `sem a batata (obrigatória), o "Adicionar" espera (${umaLinha(await botao.innerText())})`);
    await page.click('text=Batata frita');
    await page.click('text=Batata rústica');
    const batatas = await page.$$eval('[role="dialog"] fieldset', (fs) => [...fs[0].querySelectorAll('input')].filter((e) => e.checked).length);
    ok(batatas === 1, `"escolha 1": a 2ª batata troca a 1ª (${batatas} marcada)`);
    await page.click('text=Coca-Cola lata');
    await page.click('text=Guaraná Antarctica lata');
    const bebidas = await page.$$eval('[role="dialog"] fieldset', (fs) => [...fs[1].querySelectorAll('input')].filter((e) => e.checked).length);
    ok(bebidas === 1, `"escolha 1": a 2ª bebida troca a 1ª (${bebidas} marcada)`);
    ok(!(await botao.isDisabled()) && /^Adicionar/.test(await botao.innerText()), `com as obrigatórias, o "Adicionar" libera (${umaLinha(await botao.innerText())})`);
    await page.click('[aria-label="Pôr Bacon"]');
    await page.click('button[type="submit"]');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    const noPedido = await page.locator('#pedido-balcao').innerText();
    ok(/TRIO 01/.test(noPedido) && /Batata rústica/i.test(noPedido) && /Bacon/i.test(noPedido), `o combo entra no pedido com as escolhas (${umaLinha(noPedido, 120)})`);
    ok((await page.evaluate(() => document.querySelector('[data-produto="p1"] .rounded-full.bg-primary')?.textContent)) === '1', 'o cartão mostra 1 no pedido');
    ok(erros.length === 0, `sem erro na página (${umaLinha(erros.join(' | '))})`);
    await ctx.close();
  }

  // ── o tamanho dos cartões: "Compactos" encolhe na hora, grava, e a tela reabre compacta ──
  {
    const { ctx, page, erros, gravadas } = await abrir(1920, 1080);
    const antes = await cartoes(page);
    ok(await page.locator('[data-tamanho-cartao="grande"][aria-pressed="true"]').isVisible(), '"Cartões grandes" marcado ao abrir');
    await page.click('[data-tamanho-cartao="compacto"]');
    await page.waitForSelector('[data-produto][data-tamanho="compacto"]');
    const depois = await cartoes(page);
    ok(Math.max(...depois.map((c) => c.largura)) < Math.min(...antes.map((c) => c.largura)), `compactos: os cartões menores na hora (${Math.round(antes[0].largura)} → ${Math.round(depois[0].largura)} px)`);
    await page.waitForTimeout(300);
    ok(gravadas.some((g) => g.pdvCartoes === 'compacto'), `a escolha vai para as preferências (${umaLinha(JSON.stringify(gravadas))})`);
    await page.screenshot({ path: arquivoFoto('pdv-balcao-compacto-1920.png') });
    ok(erros.length === 0, `compacto: sem erro na página (${umaLinha(erros.join(' | '))})`);
    await ctx.close();
    const r = await abrir(1920, 1080, { pdvCartoes: 'compacto' });
    ok((await cartoes(r.page)).every((c) => c.tamanho === 'compacto'), 'gravado compacto: a tela reabre compacta');
    await r.ctx.close();
  }

  // ── cada largura: a grade e a janela aberta, sem nada para o lado ──
  for (const w of larguras) {
    const h = w < 700 ? 800 : 900;
    const { ctx, page, erros } = await abrir(w, h);
    const grade = await medir(page);
    ok(grade.length === 0, `${w}px: a grade sem barra para o lado (${umaLinha(grade.join('; '))})`);
    const cs = await cartoes(page);
    ok(cs.length > 0 && cs.every((c) => c.nomeDentro), `${w}px: o nome de cada cartão dentro dele`);
    await page.click('[data-produto="p1"]');
    await page.waitForSelector('[role="dialog"]');
    const aberta = await medir(page);
    ok(aberta.length === 0, `${w}px: a janela das etapas inteira na tela, sem barra para o lado (${umaLinha(aberta.join('; '))})`);
    if (w === 375 || w === 1280) await page.screenshot({ path: arquivoFoto(`pdv-balcao-etapas-${w}.png`) });
    await page.keyboard.press('Escape');
    if (w === 375 || w === 768 || w === 1280) await page.screenshot({ path: arquivoFoto(`pdv-balcao-${w}.png`) });
    ok(erros.length === 0, `${w}px: sem erro na página (${umaLinha(erros.join(' | '))})`);
    await ctx.close();
  }
}
