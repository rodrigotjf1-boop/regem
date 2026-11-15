// Roteiro de tela das LISTAS LARGAS que rolavam para o lado (V45, como o ERR-430): Formas de pagamento (`/formas-pagamento`,
// tabela de 720 px), Relatórios de entrega (`/delivery/relatorios`, tabela por entregador de 640 px) e o Relatório das
// Ordens de produção (`/ordens-producao`, tabela de 520 px). A API simulada.
// Confere: em cada largura, nenhuma barra lateral e nada fora da janela; a tabela na tela larga e os cartões no celular;
// nos cartões, "Editar" abre a forma e "N bairro(s)" abre os bairros do entregador.
import { responder, tokenFalso } from './comum.mjs';

const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: { formas_pagamento: { ver: true, editar: true }, delivery: { ver: true } } });

const FORMAS = [
  { id: 'f1', nome: 'Dinheiro', tipo: 'dinheiro', ativo: true, cardapio: true, tiposPedido: ['delivery', 'retirada', 'balcao'], taxaExtra: null, obs: null, bandeiras: [] },
  { id: 'f2', nome: 'Cartão de crédito na entrega (maquininha do entregador)', tipo: 'credito', ativo: true, cardapio: true, tiposPedido: ['delivery'], taxaExtra: 1.5, obs: 'Levar a maquininha carregada; aceita aproximação', bandeiras: ['Visa', 'Mastercard', 'Elo', 'Amex', 'Hipercard'] },
  { id: 'f3', nome: 'Pix', tipo: 'pix', ativo: false, cardapio: false, tiposPedido: ['balcao'], taxaExtra: null, obs: null, bandeiras: [] },
];
const RELATORIO = {
  periodo: { inicio: '2026-11-15', fim: '2026-11-15' },
  totais: { entregas: 31, tempoMedioSeg: 1500, ganhosCentavos: 41250 },
  entregadores: [
    { colaboradorId: 'e1', nome: 'Rogério Santos de Albuquerque Filho', entregas: 18, dias: 1, tempoMedioSeg: 1380, ganhosCentavos: 23400, bairros: [{ bairro: 'Penha', n: 7 }, { bairro: 'Olaria', n: 6 }, { bairro: 'Vila da Penha', n: 5 }] },
    { colaboradorId: 'e2', nome: 'Juca', entregas: 13, dias: 1, tempoMedioSeg: 1680, ganhosCentavos: 17850, bairros: [] },
  ],
};

const ORDENS = {
  resumo: { ordens: 3, planejadoTotal: 42, produzidoTotal: 39.5, aderenciaMedia: 94 },
  itens: [
    { id: 'o1', fichaNome: 'Molho especial da casa com páprica defumada', dataProducao: '2026-11-14', planejada: 12, produzida: 11.5, quebra: 0.5, unidade: 'L' },
    { id: 'o2', fichaNome: 'Pão de hambúrguer', dataProducao: '2026-11-14', planejada: 20, produzida: 18, quebra: 2, unidade: 'un' },
    { id: 'o3', fichaNome: 'Cebola caramelizada', dataProducao: '2026-11-13', planejada: 10, produzida: 10, quebra: 0, unidade: 'kg' },
  ],
};

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        // A faixa de partes desliza sem barra à mostra abaixo de 640 px (o desenho do `Partes` e a regra do dono de
        // 07/10/2026, como no roteiro do Mister): vale, desde que a barra dela fique escondida de verdade.
        if (el.classList.contains('faixa-abas') && window.innerWidth < 640 && el.offsetHeight === el.clientHeight + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)) continue;
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      }
    }
    for (const el of document.querySelectorAll('main button, main a, main input, main select, main h1, main h2')) {
      // Os botões da faixa de partes que deslizou para o lado ficam fora da janela de propósito (a faixa os rola).
      if (el.closest('.faixa-abas') && window.innerWidth < 640) continue;
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.right > window.innerWidth + 1) achados.push(`passa ${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 20)}" ${Math.round(r.right)}>${window.innerWidth}`);
    }
    return achados;
  });

export default async function roteiroListasLargas({ nav, base, ok, foto, larguras }) {
  async function abrir(w, caminho, esperar) {
    const ctx = await nav.newContext({ viewport: { width: w, height: w < 700 ? 820 : 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/financeiro/formas-pagamento') return responder(route, FORMAS);
      if (p === '/entregador/relatorio') return responder(route, RELATORIO);
      if (p === '/ordens-producao/relatorio') return responder(route, ORDENS);
      if (p === '/ordens-producao') return responder(route, []);
      return responder(route, {});
    });
    await page.goto(base + caminho);
    await page.waitForSelector(esperar, { timeout: 20000 });
    await page.waitForTimeout(300);
    return { ctx, page, erros };
  }

  const TELAS = [
    { nome: 'formas', caminho: '/formas-pagamento', esperar: 'text=Cartão de crédito na entrega', cartoes: '[data-formas-cartoes]' },
    { nome: 'entregas', caminho: '/delivery/relatorios', esperar: 'text=Rogério Santos', cartoes: '[data-entregadores-cartoes]' },
    // Ordens de produção › Relatório: a lista do modelo do Estoque (cartões = a `ul` com a legenda).
    {
      nome: 'ordens',
      caminho: '/ordens-producao',
      // O botão da aba, dentro do grupo da página: "button:has-text" sozinho pegava o "Relatórios" do menu lateral,
      // escondido no celular, e o clique esperava ele aparecer.
      esperar: '[aria-label="Partes de Ordens de produção"] button:has-text("Relatório")',
      antes: async (page) => {
        await page.click('[aria-label="Partes de Ordens de produção"] button:has-text("Relatório")');
        await page.waitForSelector('text=Pão de hambúrguer', { timeout: 10000 });
      },
      cartoes: 'ul[aria-label="Planejado e produzido por ordem"]',
    },
  ];
  for (const t of TELAS) {
    for (const w of larguras) {
      const { ctx, page, erros } = await abrir(w, t.caminho, t.esperar);
      if (t.antes) await t.antes(page);
      const m = await medir(page);
      ok(m.length === 0, `${t.nome} ${w}: nenhuma barra lateral e nada fora da janela ${m.slice(0, 3).join(' | ')}`);
      const emCartoes = (await page.locator(t.cartoes).count()) > 0;
      if (w <= 414) ok(emCartoes, `${t.nome} ${w}: no celular a lista vira cartões`);
      if (w >= 1920) ok(!emCartoes && (await page.locator('main table').count()) > 0, `${t.nome} ${w}: na tela larga a lista é tabela`);
      if (w === 375 || w === 1920) await page.screenshot({ path: foto(`${t.nome}-${w}.png`), fullPage: true });
      ok(erros.length === 0, `${t.nome} ${w}: sem erro (${erros.join(' | ')})`);
      await ctx.close();
    }
  }

  // ── nos cartões: "Editar" abre a forma; "N bairro(s)" abre os bairros ──
  {
    const { ctx, page, erros } = await abrir(375, '/formas-pagamento', 'text=Cartão de crédito na entrega');
    await page.locator('[data-formas-cartoes] li').nth(1).locator('button:has-text("Editar")').click();
    await page.waitForSelector('h3:has-text("Editar forma")', { timeout: 5000 }).catch(() => null);
    const valores = await page.locator('input').evaluateAll((els) => els.map((e) => e.value));
    ok(
      (await page.locator('h3:has-text("Editar forma")').isVisible()) && valores.includes('Cartão de crédito na entrega (maquininha do entregador)'),
      'formas: "Editar" no cartão abre a forma certa',
    );
    const m = await medir(page);
    ok(m.length === 0, `formas: com o diálogo aberto, nada fora da janela ${m.slice(0, 3).join(' | ')}`);
    ok(erros.length === 0, `formas: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, erros } = await abrir(375, '/delivery/relatorios', 'text=Rogério Santos');
    const botao = page.locator('[data-entregadores-cartoes] button:has-text("3 bairro(s)")');
    await botao.click();
    ok((await page.locator('[data-entregadores-cartoes] button[aria-expanded="true"]').count()) === 1 && (await page.locator('[data-entregadores-cartoes] >> text=Vila da Penha').isVisible()), 'entregas: "3 bairro(s)" abre os bairros no cartão');
    const m = await medir(page);
    ok(m.length === 0, `entregas: com os bairros abertos, nada fora da janela ${m.slice(0, 3).join(' | ')}`);
    ok(erros.length === 0, `entregas: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
