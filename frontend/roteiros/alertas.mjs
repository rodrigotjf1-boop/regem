// Roteiro de tela do cadastro de alertas do KDS (/kds/alertas — auditoria do KDS, K1, A9, A7, A10): a API simulada.
// Confere o zoom livre (a tela não herda o quiosque do KDS), a loja e os KDS de cada alerta, "até o Ciente", a validação,
// a prévia da faixa, o "Testar" e as larguras com a gaveta e o diálogo abertos, sem barra lateral.
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: { producao_kds: { ver: true } } });
const ALERTAS = [
  { id: 'a1', titulo: 'Trocar o óleo da fritadeira', detalhe: 'Desligar a fritadeira 2 antes', prioridade: 'alta', tipo: 'agendado', horarios: ['20:15'], diasSemana: [1, 4], condicao: null, duracaoSeg: 120, unidadeId: 'u1', kdsIds: ['k1'], ateCiente: false, ativo: true },
  { id: 'a2', titulo: 'Fila de delivery acumulando', detalhe: 'Chamar reforço na expedição', prioridade: 'danger', tipo: 'condicional', horarios: [], diasSemana: [0, 1, 2, 3, 4, 5, 6], condicao: { fonte: 'pedidos_delivery', operador: '>=', limiar: 8 }, duracaoSeg: 60, unidadeId: 'u1', kdsIds: null, ateCiente: true, ativo: true },
  { id: 'a3', titulo: 'Lavar as mãos', detalhe: 'Todos da cozinha', prioridade: 'info', tipo: 'agendado', horarios: ['10:00', '14:00'], diasSemana: [0, 1, 2, 3, 4, 5, 6], condicao: null, duracaoSeg: 60, unidadeId: null, kdsIds: null, ateCiente: false, ativo: false },
];

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 50)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    return achados;
  });

export default async function roteiroAlertas({ nav, base, ok, foto, larguras }) {
  const S = { criado: null, testado: null };
  async function abrir(w, h) {
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/kds/alertas' && req.method() === 'GET') return responder(route, ALERTAS);
      if (p === '/kds/alertas' && req.method() === 'POST') {
        S.criado = JSON.parse(req.postData() || '{}');
        return responder(route, { id: 'novo', ...S.criado });
      }
      if (/^\/kds\/alertas\/[^/]+\/testar$/.test(p)) {
        S.testado = p;
        return responder(route, { ok: true, kds: ['k1'] });
      }
      if (p === '/unidades') return responder(route, [{ id: 'u1', nome: 'Centro' }, { id: 'u2', nome: 'Shopping Norte' }]);
      if (p === '/producao/kds/telas')
        return responder(route, [
          { id: 'k1', nome: 'Fritadeira', unidadeId: 'u1' },
          { id: 'k2', nome: 'Chapa', unidadeId: 'u1' },
          { id: 'k3', nome: 'Despacho do Shopping', unidadeId: 'u2' },
        ]);
      return responder(route, {});
    });
    await page.goto(base + '/kds/alertas');
    await page.waitForSelector('text=Trocar o óleo da fritadeira', { timeout: 20000 });
    return { ctx, page, erros };
  }

  // ── zoom livre e o que a lista mostra ──
  let { ctx, page, erros } = await abrir(1280, 900);
  const vp = await page.evaluate(() => [...document.querySelectorAll('meta[name="viewport"]')].map((m) => m.content));
  ok(vp.length === 1 && !/user-scalable=no/.test(vp[0]) && !/maximum-scale=1(\D|$)/.test(vp[0]), `K1: zoom livre (${vp.join(' | ')})`);
  const manifesto = await page.evaluate(() => document.querySelector('link[rel="manifest"]')?.getAttribute('href') ?? null);
  ok(manifesto !== '/kds.webmanifest', `K1: sem o manifesto do quiosque (${manifesto})`);
  const corpo = await page.locator('main').innerText();
  ok(/Centro/.test(corpo) && /Fritadeira/.test(corpo) && /Todos os KDS/.test(corpo), 'a lista diz a loja e os KDS de cada alerta');
  ok(/Até o Ciente/.test(corpo) && /120 s/.test(corpo), 'a lista diz quanto tempo fica');
  ok(/Urgentes/.test(corpo), 'situação "Urgentes"');

  // ── novo alerta: loja, só os KDS dela, "até o Ciente", prévia, validação e o corpo que vai ──
  await page.click('button:has-text("Novo alerta")');
  await page.waitForSelector('#alerta-titulo');
  await page.fill('#alerta-titulo', 'Conferir a câmara fria');
  await page.selectOption('#alerta-loja', 'u1');
  const chips = await page.locator('[aria-label="KDS que recebem"] button').allTextContents();
  ok(JSON.stringify(chips) === JSON.stringify(['Todos os KDS', 'Fritadeira', 'Chapa']), `só os KDS da loja: ${JSON.stringify(chips)}`);
  await page.click('#alerta-kds-todos'); // desmarca "todos" → nenhum marcado
  await page.click('button:has-text("Até alguém tocar em Ciente")');
  await page.fill('#alerta-horario', '21:00');
  await page.click('button:has-text("Adicionar")');
  await page.click('button[type="submit"]');
  await page.waitForSelector('[role="alert"]:has-text("ao menos um KDS")', { timeout: 5000 });
  ok(S.criado === null, 'nenhum KDS marcado: não salva e diz por quê');
  await page.click('[aria-label="KDS que recebem"] button:has-text("Fritadeira")');
  const previa = await page.locator('[aria-label="Prévia da faixa no KDS"]').innerText();
  ok(/Conferir a câmara fria/.test(previa) && /CIENTE/i.test(previa) && /ATENÇÃO/i.test(previa), `prévia da faixa: ${umaLinha(previa)}`);
  const medGaveta = await medir(page);
  ok(medGaveta.length === 0, `gaveta 1280: ${medGaveta.slice(0, 3).join(' | ')}`);
  await page.screenshot({ path: foto('1280-gaveta.png') });
  await page.click('button[type="submit"]');
  await page.waitForFunction(() => !document.querySelector('#alerta-titulo'), null, { timeout: 5000 });
  ok(S.criado && S.criado.unidadeId === 'u1' && JSON.stringify(S.criado.kdsIds) === '["k1"]' && S.criado.ateCiente === true,
    `o que vai ao servidor: loja ${S.criado?.unidadeId}, kds ${JSON.stringify(S.criado?.kdsIds)}, até o Ciente ${S.criado?.ateCiente}`);

  // ── testar: diz onde aparece e dispara ESTE alerta ──
  const linha = page.locator('tr, li, article').filter({ hasText: 'Trocar o óleo da fritadeira' }).first();
  await linha.locator('button:has-text("Testar"), [aria-label^="Testar"]').first().click();
  const dlg = await page.locator('[role="alertdialog"], [role="dialog"]').last().innerText();
  ok(/nos KDS Fritadeira/.test(dlg) && /por 120 segundos/.test(dlg), `diálogo do teste: ${umaLinha(dlg)}`);
  await page.click('button:has-text("Disparar no KDS")');
  await page.waitForTimeout(500);
  ok(S.testado === '/kds/alertas/a1/testar', `testar chama o alerta certo (${S.testado})`);
  ok(erros.length === 0, `sem erro na página (${erros.join(' | ')})`);
  await ctx.close();

  // ── cada largura: lista, gaveta aberta e diálogo do teste aberto ──
  for (const w of larguras) {
    ({ ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900));
    const m0 = await medir(page);
    await page.click('button:has-text("Novo alerta")');
    await page.waitForSelector('#alerta-titulo');
    await page.selectOption('#alerta-loja', 'u1');
    const m1 = await medir(page);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#alerta-titulo', { state: 'detached' });
    const linhaW = page.locator('tr, li, article').filter({ hasText: 'Lavar as mãos' }).first();
    const testar = linhaW.locator('button:has-text("Testar"), [aria-label^="Testar"]').first();
    if (await testar.count()) await testar.click();
    else {
      // no estreito as ações ficam num menu da linha
      await linhaW.locator('button[aria-haspopup], button[aria-label*="Ações"], button[aria-label*="ações"]').first().click();
      await page.locator('[role="menuitem"]:has-text("Testar"), button:has-text("Testar")').first().click();
    }
    await page.waitForSelector('button:has-text("Disparar no KDS")');
    const m2 = await medir(page);
    ok(m0.length === 0 && m1.length === 0 && m2.length === 0, `${w}: lista, gaveta e diálogo sem barra lateral ${[...m0, ...m1, ...m2].slice(0, 3).join(' | ')}`);
    if (w === 375) await page.screenshot({ path: foto('375-teste.png') });
    ok(erros.length === 0, `${w}: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
