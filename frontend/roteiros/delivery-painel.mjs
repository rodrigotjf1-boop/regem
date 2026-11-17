// Roteiro de tela do PAINEL DO DELIVERY (/delivery): as listas "Pedidos pendentes" e "Entregas em andamento" (ERR-430).
// A API simulada. Confere: a lista nunca rola para o lado — em cada largura ela escolhe a tabela inteira, a compacta (sem o
// código externo e a data) ou os cartões, pelo espaço que tem; nos cartões, tocar seleciona o pedido, a caixa marca sem
// selecionar, "Todos" marca a lista e o "Ordenar" reordena; na tabela, o cabeçalho ordena e a caixa marca.
import { fotoDoComoFaco, responder, tokenFalso, umaLinha } from './comum.mjs';

const TOKEN = tokenFalso({ cat: 'gerente', perfil: 'gerente', perm: { delivery: { ver: true, editar: true }, pedidos: { ver: true } } });

const ha = (min) => new Date(Date.now() - min * 60_000).toISOString();
const PEDIDOS = [
  { id: 'p1', numero: 281, displayId: '4821', canal: 'ifood', tipo: 'delivery', status: 'novo', criadoEm: ha(3), clienteNome: 'Mariana Albuquerque de Souza Prado', clientePedidosCount: 1, endereco: 'Rua Coronel Albuquerque Maranhão, 1234, apto 1102, bloco B — Jardim Botânico', enderecoBairro: 'Jardim Botânico', observacao: 'sem cebola' },
  { id: 'p2', numero: 282, displayId: '77102', canal: '99food', tipo: 'delivery', status: 'confirmado', criadoEm: ha(18), clienteNome: 'Bruno', clientePedidosCount: 7, endereco: 'Av. Brasil, 500 — Penha', enderecoBairro: 'Penha' },
  { id: 'p3', numero: 283, displayId: null, canal: 'cardapio', tipo: 'retirada', status: 'pronto', criadoEm: ha(31), clienteNome: 'Ana Lúcia', clientePedidosCount: 3 },
  { id: 'p4', numero: 284, displayId: 'AN-5530', canal: 'anotaai', tipo: 'delivery', status: 'confirmado', criadoEm: ha(70), clienteNome: 'Carlos Eduardo', clientePedidosCount: 2, endereco: 'Rua das Laranjeiras, 77 — Laranjeiras', enderecoBairro: 'Laranjeiras', alterado: true },
  { id: 'p5', numero: 285, displayId: '4830', canal: 'ifood', tipo: 'delivery', status: 'novo', criadoEm: ha(1), clienteNome: 'Zé', clientePedidosCount: 0, endereco: 'Travessa Um, 2 — Centro' },
  { id: 'p6', numero: 279, displayId: '4810', canal: 'ifood', tipo: 'delivery', status: 'despachado', criadoEm: ha(40), clienteNome: 'Patrícia Mendes', clientePedidosCount: 4, endereco: 'Rua A, 10', entregadorNome: 'Rogério Santos' },
  { id: 'p7', numero: 280, displayId: '77090', canal: '99food', tipo: 'delivery', status: 'entregue', criadoEm: ha(55), clienteNome: 'Fernanda Lima Barbosa', clientePedidosCount: 1, endereco: 'Rua B, 20', entregadorNome: 'Juca' },
];

const procurarBarras = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    // Nada da página passa da janela (o "⏸ Pausar" e a ⚙️ saíam em 375 px — a linha não quebrava).
    for (const el of document.querySelectorAll('main button, main a, main input, main select, main h2')) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.right > window.innerWidth + 1) achados.push(`passa ${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 20)}" ${Math.round(r.right)}>${window.innerWidth}`);
    }
    return achados;
  });

// O degrau de cada lista: 'tabela' (inteira), 'compacta' (sem "Cód. ext.") ou 'cartoes'.
const degraus = (page) =>
  page.evaluate(() =>
    ['Pedidos pendentes', 'Entregas em andamento'].map((t) => {
      const h = [...document.querySelectorAll('h2')].find((x) => x.textContent?.trim() === t);
      const card = h?.closest('.flex.flex-col') ?? h?.parentElement?.parentElement;
      if (!card) return 'sumiu';
      if (card.querySelector('[data-pedidos-cartoes]')) return 'cartoes';
      const ths = [...card.querySelectorAll('th')].map((x) => x.textContent ?? '');
      return ths.some((x) => x.includes('Cód. ext.')) ? 'tabela' : 'compacta';
    }),
  );

export default async function roteiroDeliveryPainel({ nav, base, ok, foto, larguras }) {
  async function abrir(w, h) {
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/delivery/pedidos') return responder(route, PEDIDOS);
      if (p === '/delivery/config') return responder(route, { prepBalcaoMax: 25, prepDeliveryMax: 55 });
      if (p === '/financeiro/caixa') return responder(route, null);
      if (p === '/delivery/entregadores' || p === '/atendimento' || p === '/delivery/integracoes') return responder(route, []);
      if (p === '/delivery/entregadores-ao-vivo/fila') return responder(route, { entregadores: [] });
      if (p === '/delivery/pausas') return responder(route, { canais: [], avisoMinutos: 5 });
      if (p === '/cardapio/config') return responder(route, { ativo: true, roboAtivo: false });
      if (p === '/entregador/pagamento/config') return responder(route, null);
      return responder(route, {});
    });
    await page.goto(base + '/delivery');
    await page.waitForSelector('h2:has-text("Pedidos pendentes")', { timeout: 20000 });
    await page.waitForTimeout(300);
    return { ctx, page, erros };
  }

  const vistos = new Set();
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900);
    const m = await procurarBarras(page);
    ok(m.length === 0, `${w}: nenhuma barra lateral ${m.slice(0, 3).join(' | ')}`);
    const d = await degraus(page);
    d.forEach((x) => vistos.add(x));
    ok(!d.includes('sumiu'), `${w}: as duas listas aparecem (${d.join(', ')})`);
    if (w >= 1920) ok(d[0] !== 'cartoes', `${w}: na tela larga a lista dos pendentes é tabela (${d[0]})`);
    if (w <= 414) ok(d.every((x) => x === 'cartoes'), `${w}: no celular as duas viram cartões (${d.join(', ')})`);
    // O notebook comum (1280) fica na tabela compacta: o cartão ocupa três linhas por pedido e mostra menos de uma vez.
    if (w === 1280) ok(d.every((x) => x !== 'cartoes'), `${w}: no notebook as duas ficam em tabela (${d.join(', ')})`);
    if (w === 375 || w === 1280 || w === 1920) await page.screenshot({ path: foto(`${w}-painel.png`), fullPage: true });
    ok(erros.length === 0, `${w}: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  ok(vistos.has('cartoes') && (vistos.has('tabela') || vistos.has('compacta')), `os degraus aparecem conforme o espaço (${[...vistos].join(', ')})`);

  // ── M3d: a imagem do "como faço" de pausar um canal — 1: Delivery › Painel no menu; 2: "⏸ Pausar" (só com GERAR_COMO_FACO=1) ──
  {
    const { ctx, page, erros } = await abrir(1280, 800);
    const conferir = (id, r) => ok(r.achou.every(Boolean), `como faço (${id}): as marcas estão na tela (${r.achou.join(', ')})${r.gerou ? ' — imagem gerada' : ''}${(r.motivos ?? []).filter(Boolean).length ? ` — ${r.motivos.join(' | ')}` : ''}`);
    const menu = page.locator('aside a[href="/delivery"] >> visible=true').first();
    conferir('pausar-canal', await fotoDoComoFaco(page, 'pausar-canal', [menu, page.locator('button:has-text("⏸ Pausar") >> visible=true').first()]));
    // O tempo de preparo fica no fim da janela da ⚙️ (longa): a imagem mostra onde ela está — 1: o menu; 2: a ⚙️.
    conferir('tempo-de-preparo', await fotoDoComoFaco(page, 'tempo-de-preparo', [menu, page.locator('button[title="Configurações do delivery"] >> visible=true').first()]));
    // Aceitar e avançar: o pedido "Em análise" selecionado — 1: o pedido na lista; 2: "AVANÇAR"; 3: "FINALIZAR".
    const pedido = page.locator('main table tbody tr', { hasText: 'Mariana' }).first();
    await pedido.click();
    const avancar = page.locator('main button:has-text("AVANÇAR")').first();
    ok(await avancar.isEnabled(), 'como faço (aceitar-avancar): com o pedido selecionado, "AVANÇAR" fica ligado');
    conferir('aceitar-avancar', await fotoDoComoFaco(page, 'aceitar-avancar', [pedido, avancar, page.locator('main button:has-text("FINALIZAR")').first()]));
    // Cancelar: o mesmo pedido selecionado — 1: o pedido; 2: "CANCELAR".
    conferir('cancelar-pedido', await fotoDoComoFaco(page, 'cancelar-pedido', [pedido, page.locator('main button:has-text("CANCELAR")').first()]));
    ok(erros.length === 0, `como faço: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── cartões (celular): tocar seleciona; a caixa marca sem selecionar; "Todos"; ordenar ──
  {
    const { ctx, page, erros } = await abrir(375, 820);
    const pend = page.locator('[data-pedidos-cartoes]').first();
    const primeiro = pend.locator('[data-pedido-cartao]').first();
    await primeiro.click({ position: { x: 200, y: 12 } });
    ok((await primeiro.getAttribute('aria-current')) === 'true', 'cartão: tocar seleciona o pedido');
    const segundo = pend.locator('[data-pedido-cartao]').nth(1);
    await segundo.locator('input[type=checkbox]').check();
    ok((await segundo.getAttribute('aria-current')) !== 'true', 'cartão: a caixa marca sem selecionar o pedido');
    ok(await page.locator('text=1 selecionado(s)').first().isVisible(), 'cartão: a contagem de marcados aparece');
    const controles = page.locator('[data-controles-cartoes]').first();
    await controles.locator('input[type=checkbox]').check();
    const nPend = await pend.locator('[data-pedido-cartao]').count();
    ok(await page.locator(`text=${nPend} selecionado(s)`).first().isVisible(), `cartão: "Todos" marca os ${nPend} pendentes`);
    await controles.locator('select').selectOption('clienteNome');
    const nomes = await pend.locator('[data-pedido-cartao] .font-medium').allInnerTexts();
    const ordenados = [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    ok(JSON.stringify(nomes.map((x) => x.toLowerCase())) === JSON.stringify(ordenados.map((x) => x.toLowerCase())), `cartão: ordenar por cliente (${umaLinha(nomes.join(', '))})`);
    await controles.locator('button').click();
    const nomesDesc = await pend.locator('[data-pedido-cartao] .font-medium').allInnerTexts();
    ok(nomesDesc[0]?.toLowerCase() === ordenados[ordenados.length - 1]?.toLowerCase(), `cartão: a seta inverte a ordem (${umaLinha(nomesDesc.join(', '))})`);
    await page.screenshot({ path: foto('375-cartoes-marcados.png'), fullPage: true });
    ok(erros.length === 0, `cartões: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── tabela (tela larga): o cabeçalho ordena, a caixa marca, a linha seleciona ──
  {
    const { ctx, page, erros } = await abrir(1920, 1000);
    const tab = page.locator('table').first();
    ok(await tab.isVisible(), 'tabela: aparece na tela larga');
    await tab.locator('th button[aria-label="Ordenar por Cliente"]').click();
    const nomes = await tab.locator('tbody tr td:nth-child(6) .font-medium, tbody tr td:nth-child(5) .font-medium').allInnerTexts();
    const ordenados = [...nomes].sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
    ok(nomes.length > 0 && JSON.stringify(nomes.map((x) => x.toLowerCase())) === JSON.stringify(ordenados.map((x) => x.toLowerCase())), `tabela: o cabeçalho ordena por cliente (${umaLinha(nomes.join(', '))})`);
    const linha = tab.locator('tbody tr').first();
    await linha.click();
    ok((await linha.getAttribute('aria-selected')) === 'true', 'tabela: clicar na linha seleciona');
    await tab.locator('tbody tr').nth(1).locator('input[type=checkbox]').check();
    ok(await page.locator('text=1 selecionado(s)').first().isVisible(), 'tabela: a caixa marca');
    ok(erros.length === 0, `tabela: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
