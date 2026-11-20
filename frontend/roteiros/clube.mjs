// Roteiro de tela do CLUBE DE RECOMPRA — a base (fase A0 do `docs/plano-clube-e-banner.md`; protótipo
// `mockups/regem-clube-banner.html`, parte "Marketing › Clube", aprovado pelo dono em 20/11/2026; mig 471). A API simulada.
// Confere, em cada largura (V45: nenhuma barra de rolagem para o lado — a página e qualquer peça —, com cada gaveta e
// diálogo ABERTO e medido na frente):
//  • Delivery › Marketing › aba Clube › Visão geral: as três ferramentas dizem "Chega numa próxima entrega" (nenhuma chave
//    para ligar o que ainda não existe), as regras que valem para as três, mudar o pedido mínimo mostra a barra de
//    alterações e "Salvar alterações" manda SÓ o que mudou; "Ver as regras" abre o diálogo com as regras do clube;
//  • Prêmios: a lista com a contagem, a situação "Em uso" que filtra, "＋ Novo prêmio" abre a gaveta, "Produto grátis" lê
//    os produtos, o diálogo de excluir (o prêmio em uso diz onde está);
//  • o gerente vê e não muda (sem "＋ Novo prêmio", sem campo do mínimo); a nuvem não respondeu → "Tentar de novo".
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', nome: 'Ana' });
const GERENTE = tokenFalso({ cat: 'gerente', perfil: 'gerente', nome: 'Bruno' });
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

const premio = (id, nome, tipo, descricao, emUso, extra = {}) => ({
  id, nome, tipo, valor: 0, teto: null, produtoId: null, produtoNome: null, minimo: 0, validadeDias: 7, descricao, emUso, ...extra,
});
const PAINEL = (minimo = 30) => ({
  config: {
    surpresaAtivo: false, surpresaForma: 'raspadinha', albumAtivo: false, albumSelos: 4, albumValidadeMeses: 12, albumPremios: [P2],
    metaAtivo: false, metaNiveis: [{ pedidos: 3, premios: [] }, { pedidos: 6, premios: [] }], metaValidadeDias: 15, minimo,
  },
  prontas: { surpresa: false, album: false, meta: false },
  premios: [
    premio(P1, '15% off até R$ 20', 'percentual', '15% de desconto, até R$ 20 · em pedido a partir de R$ 30 · vale 7 dias', [], { valor: 15, teto: 20, minimo: 30 }),
    premio(P2, 'Batata média grátis com um nome bem comprido para ver a quebra', 'produto', 'Batata média grátis · vale 7 dias', ['Álbum de selos'], { produtoId: 'pr-1', produtoNome: 'Batata média' }),
    premio(P3, 'Frete grátis', 'fretegratis', 'entrega grátis · vale 15 dias', [], { validadeDias: 15 }),
  ],
  regras: [
    'Não há sorteio: todo mundo que cumpre a regra recebe, e não há limite de prêmios.',
    'Um benefício por pedido: o prêmio não junta com outro cupom.',
    'Os prêmios valem só no cardápio online e no WhatsApp da loja, não no iFood nem na 99.',
  ],
  opcoes: { validadesDoPremio: [3, 7, 15, 30], minimoMax: 1000, nomeMax: 60, premiosMax: 50 },
});

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('faixa-abas'))
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    // O texto esmagado só na aba do Clube e nos diálogos dela (o "Como funciona" da página é de outra aba e já existia).
    const ALVO = '[data-tela="clube"]';
    for (const el of document.querySelectorAll(`${ALVO} p, ${ALVO} td, ${ALVO} li, ${ALVO} h2, ${ALVO} h3, [role="dialog"] p, [role="dialog"] li, [role="dialog"] label, [role="alertdialog"] p`)) {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      if (r.width > 0 && r.width < 60 && r.height > lh * 3.2 && (el.textContent || '').trim().length > 12)
        achados.push(`esmagado ${el.tagName.toLowerCase()} ${Math.round(r.width)}px: ${(el.textContent || '').trim().slice(0, 24)}`);
    }
    return achados;
  });
const texto = (page, sel = 'main') => page.evaluate((s) => document.querySelector(s)?.innerText.replace(/\s+/g, ' ') ?? '', sel);

export default async function roteiroClube({ nav, base, ok, foto: arquivoFoto, larguras }) {
  async function abrir(w, h, o = {}) {
    const enviados = [];
    let falhas = o.falhas ?? 0;
    let minimo = 30;
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), o.token ?? PRESIDENTE);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname.replace(/^.*\/api\/v1/, '');
      const metodo = route.request().method();
      if (p === '/marketing/clube' && metodo === 'GET') {
        if (falhas > 0) {
          falhas--;
          return responder(route, { statusCode: 502, message: 'A nuvem não respondeu agora.' }, 502);
        }
        return responder(route, PAINEL(minimo));
      }
      if (p === '/marketing/clube/config' && metodo === 'PUT') {
        const corpo = JSON.parse(route.request().postData() || '{}');
        enviados.push(corpo);
        if (typeof corpo.minimo === 'number') minimo = corpo.minimo;
        return responder(route, PAINEL(minimo));
      }
      if (p === '/marketing/clube/produtos') return responder(route, [{ id: 'pr-1', nome: 'Batata média' }, { id: 'pr-2', nome: 'Refrigerante lata' }]);
      if (p.startsWith('/marketing/clube/premios')) {
        enviados.push({ metodo, p });
        return responder(route, PAINEL(minimo));
      }
      // O resto da página de Marketing (as campanhas, os números, os modelos): o mínimo para ela desenhar.
      if (p === '/campanhas' || p === '/campanhas/optout' || p === '/whatsapp/cloud/templates/locais') return responder(route, []);
      if (p === '/whatsapp/numeros') return responder(route, { principal: { vinculado: true, provedor: 'evolution' }, marketing: null });
      if (p === '/whatsapp/cloud/limite') return responder(route, { limite: null, usadoHoje: 0, tier: null });
      return responder(route, {});
    });
    await page.goto(base + '/marketing');
    const aba = page.getByRole('button', { name: 'Clube', exact: true });
    try {
      await aba.click({ timeout: 15000 });
    } catch (e) {
      // A página de Marketing não desenhou (ex.: uma chamada simulada que falta): a foto, o que a tela mostra e os erros.
      await page.screenshot({ path: arquivoFoto(`clube-aba-nao-apareceu-${w}.png`) });
      const onde = `${page.url()} · ${umaLinha(await page.evaluate(() => document.body.innerText.slice(0, 300)))}`;
      throw new Error(`a aba Clube não apareceu (${w}px): ${onde} · erros: ${umaLinha(erros.join(' | '), 400)} · ${String(e?.message ?? e).split('\n')[0]}`);
    }
    return { ctx, page, erros, enviados };
  }
  const dialogo = (page) => page.waitForSelector('[role="dialog"], [role="alertdialog"]', { timeout: 10000 });
  const fechou = (page) => page.waitForSelector('[role="dialog"], [role="alertdialog"]', { state: 'detached', timeout: 5000 });

  for (const w of larguras) {
    const { ctx, page, erros, enviados } = await abrir(w, 900);
    await page.waitForSelector('text=Pedido mínimo para contar', { timeout: 30000 });
    let t = await texto(page);
    let achados = await medir(page);
    ok(achados.length === 0, `${w}px · Clube › Visão geral: sem barra para o lado nem texto esmagado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok((t.match(/Chega numa próxima entrega/g) ?? []).length === 3 && !(await page.locator('main [role="switch"]').count()), `${w}px · as três ferramentas sem chave: "Chega numa próxima entrega"`);
    ok(t.includes('Cardápio e WhatsApp') && t.includes('Um benefício por pedido'), `${w}px · as regras que valem para as três`);
    // Mudar o mínimo: a barra de alterações e o salvar manda só o mínimo.
    await page.getByLabel('Pedido mínimo para contar').fill('40');
    await page.waitForSelector('text=1 alteração ainda não salva', { timeout: 5000 });
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · com a barra de alterações: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await page.waitForSelector('text=1 alteração ainda não salva', { state: 'detached', timeout: 5000 });
    ok(JSON.stringify(enviados[0]) === JSON.stringify({ minimo: 40 }), `${w}px · "Salvar alterações" manda só o que mudou (${umaLinha(JSON.stringify(enviados[0]))})`);
    // As regras do clube, no diálogo.
    await page.getByRole('button', { name: 'Ver as regras' }).click();
    await dialogo(page);
    achados = await medir(page);
    ok(achados.length === 0 && (await texto(page, '[role="dialog"]')).includes('Não há sorteio'), `${w}px · "Ver as regras": o diálogo, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    await page.keyboard.press('Escape');
    await fechou(page);
    if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`clube-visao-${w}.png`), fullPage: true });

    // ── Prêmios ──
    await page.getByRole('button', { name: /^Prêmios/ }).click();
    await page.waitForSelector('text=3 prêmios', { timeout: 10000 });
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · Prêmios: sem barra para o lado nem texto esmagado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    await page.getByRole('button', { name: /^Em uso/ }).click();
    t = await texto(page);
    ok(t.includes('1 de 3 prêmios') && !t.includes('Frete grátis · '), `${w}px · "Em uso" filtra (${umaLinha(t.match(/\d+ de \d+ prêmios/)?.[0] ?? '?')})`);
    await page.getByRole('button', { name: /^Todos/ }).click();
    if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`clube-premios-${w}.png`), fullPage: true });
    // A gaveta do prêmio novo, e o "Produto grátis" lendo os produtos.
    await page.getByRole('button', { name: '＋ Novo prêmio' }).click();
    await dialogo(page);
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · gaveta do prêmio aberta: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    await page.getByRole('button', { name: 'Produto grátis' }).click();
    await page.waitForSelector('option:has-text("Refrigerante lata")', { state: 'attached', timeout: 5000 });
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · gaveta com o produto grátis: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    if (w === 390 || w === 1440) await page.locator('[role="dialog"]').screenshot({ path: arquivoFoto(`clube-gaveta-${w}.png`) });
    await page.keyboard.press('Escape');
    await fechou(page);
    // Excluir o prêmio em uso: o diálogo diz onde está.
    await page.getByRole('button', { name: /^Excluir.*Batata/ }).first().click();
    await dialogo(page);
    const d = await texto(page, '[role="alertdialog"], [role="dialog"]');
    achados = await medir(page);
    ok(achados.length === 0 && d.includes('em uso em: Álbum de selos'), `${w}px · excluir o prêmio em uso: o diálogo diz onde está, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    await page.getByRole('button', { name: 'Cancelar' }).click();
    await fechou(page);
    ok(erros.length === 0, `${w}px · nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    await ctx.close();
  }

  for (const w of [390, 1366]) {
    {
      // O gerente vê e não muda.
      const { ctx, page, erros } = await abrir(w, 900, { token: GERENTE });
      await page.waitForSelector('text=Só o presidente muda o Clube', { timeout: 30000 });
      // A busca do modelo de ajustes ("buscar ajuste") fica; campo de mudar, nenhum.
      const campos = await page.locator('[data-tela="clube"] input:not([type="search"])').count();
      const tg = await texto(page, '[data-tela="clube"]');
      ok(campos === 0 && tg.includes('R$ 30,00'), `${w}px · gerente: o mínimo só para ver (campos: ${campos}; ${umaLinha(tg.match(/Pedido mínimo para contar.{0,120}/)?.[0] ?? tg.slice(0, 120))})`);
      await page.getByRole('button', { name: /^Prêmios/ }).click();
      await page.waitForSelector('text=3 prêmios', { timeout: 10000 });
      ok(!(await page.getByRole('button', { name: '＋ Novo prêmio' }).count()) && !(await page.getByRole('button', { name: /^Excluir/ }).count()), `${w}px · gerente: sem criar nem excluir prêmio`);
      ok(erros.length === 0, `${w}px · gerente: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
      await ctx.close();
    }
    {
      // A nuvem não respondeu: a mensagem e "Tentar de novo" lê de novo.
      const { ctx, page } = await abrir(w, 900, { falhas: 1 });
      await page.waitForSelector('text=Não deu para ler o Clube agora', { timeout: 30000 });
      const achados = await medir(page);
      ok(achados.length === 0, `${w}px · não leu: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      await page.getByRole('button', { name: 'Tentar de novo' }).click();
      await page.waitForSelector('text=Pedido mínimo para contar', { timeout: 10000 });
      ok(true, `${w}px · "Tentar de novo" leu o Clube`);
      await ctx.close();
    }
  }
}
