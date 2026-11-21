// Roteiro de tela dos BANNERS — "Ao tocar, abre" e o período (fase B3 do `docs/plano-clube-e-banner.md`; protótipo
// `mockups/regem-clube-banner.html`, gaveta "Ao tocar no banner, abre"; mig 482). A API é simulada. Confere, em cada
// largura (V45: nenhuma barra de rolagem para o lado, com a gaveta ABERTA e medida na frente):
//  • Delivery › Configurações › Banners: o resumo de cada banner ("Ao tocar, abre: X-Bacon duplo · até 30/11", "Vagas da
//    loja"); "Ao tocar, abre…" abre a gaveta com os 8 destinos; "O Clube" › "Regras do clube" e o período; "até" antes de
//    "aparece de" avisa; "Salvar" manda a lista com o destino e o período; o link externo sem https avisa;
//  • o cardápio: o banner "Regras do clube" abre as regras (e "o clube ainda não está aberto" sem regras); o banner "Meus
//    prêmios e o álbum" abre Sua conta em Benefícios.
import { responder, tokenFalso, umaLinha } from './comum.mjs';
import { MENU, TOKEN as TOKEN_CARDAPIO } from './cardapio-para-voce.mjs';

const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: { loja: { ver: true, editar: true }, delivery: { ver: true } } });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const IMG = 'https://imagens.exemplo.test/banner-1.png';
const P1 = '11111111-1111-4111-8111-111111111111';
const C1 = '55555555-5555-4555-8555-555555555555';
const BANNERS = () => [
  { id: 'b1', imagemRef: IMG, titulo: 'Sextou com bacon', link: `item:${P1}`, ativo: true, apareceDe: null, apareceAte: '2026-11-30' },
  { id: 'b2', imagemRef: IMG, titulo: 'Estamos contratando', link: 'vagas', ativo: true, apareceDe: null, apareceAte: null },
];

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.hs')) continue; // no cardápio, as fileiras que deslizam de propósito
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('faixa-abas')) {
        // O culpado: o elemento mais fundo que passa da borda direita de quem rola.
        const borda = el.getBoundingClientRect().right + 1;
        const fora = [...el.querySelectorAll('*')].filter((x) => x.getBoundingClientRect().right > borda && x.getBoundingClientRect().width > 0);
        const fundo = fora.find((x) => ![...x.children].some((y) => fora.includes(y))) ?? fora[0];
        const quem = fundo ? `${fundo.tagName.toLowerCase()}.${String(fundo.className).slice(0, 50)} "${(fundo.textContent || '').trim().slice(0, 30)}" ${Math.round(fundo.getBoundingClientRect().width)}px` : '?';
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth} — culpado: ${quem}`);
      }
    }
    for (const el of document.querySelectorAll('[role="dialog"] p, [role="dialog"] label, [role="dialog"] li')) {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      if (r.width > 0 && r.width < 60 && r.height > lh * 3.2 && (el.textContent || '').trim().length > 12)
        achados.push(`esmagado ${el.tagName.toLowerCase()} ${Math.round(r.width)}px: ${(el.textContent || '').trim().slice(0, 24)}`);
    }
    return achados;
  });
const texto = (page, sel = 'body') => page.evaluate((s) => document.querySelector(s)?.innerText.replace(/\s+/g, ' ') ?? '', sel);

export default async function roteiroBanners({ nav, base, ok, foto: arquivoFoto, larguras }) {
  async function abrir(w) {
    const enviados = [];
    let lista = BANNERS();
    const ctx = await nav.newContext({ viewport: { width: w, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route((u) => u.hostname === 'imagens.exemplo.test', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/cardapio/banners' && req.method() === 'PUT') {
        const corpo = JSON.parse(req.postData() || '{}');
        enviados.push(corpo);
        lista = (corpo.banners ?? []).map((b, i) => ({ id: `n${i}`, ...b }));
        return responder(route, lista);
      }
      if (p === '/cardapio/banners') return responder(route, lista);
      if (p === '/produtos') return responder(route, [{ id: P1, nome: 'X-Bacon duplo', categoriaId: C1, categoriaNome: 'Hambúrgueres' }]);
      if (p === '/cardapio/cupons') return responder(route, [{ codigo: 'SEXTOU10', ativo: true }]);
      if (p === '/cardapio/config') return responder(route, { id: 'c1', ativo: true, modo: 'delivery', temaConfig: { bannerIntervalo: 2 } });
      if (/bairros|areas-entrega|regras-sinal|formas|impressoras|integrac|numeros|robo|eventos|fidelidade|cashback/.test(p)) return responder(route, []);
      return responder(route, {});
    });
    await page.goto(base + '/delivery/configuracoes?aba=banners');
    await page.waitForSelector('text=Ao tocar, abre:', { timeout: 30000 });
    return { ctx, page, erros, enviados };
  }
  const dialogo = (page) => page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const fechou = (page) => page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });

  for (const w of larguras) {
    const { ctx, page, erros, enviados } = await abrir(w);
    try {
      let achados = await medir(page);
      const t = await texto(page, 'main');
      ok(achados.length === 0, `${w}px · Banners: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      ok(t.includes('Ao tocar, abre: X-Bacon duplo · até 30/11') && t.includes('Ao tocar, abre: Vagas da loja'), `${w}px · o resumo de cada banner (${umaLinha(t.match(/Ao tocar, abre:.{0,40}/g)?.join(' | ') ?? '?')})`);
      await page.getByRole('button', { name: 'Ao tocar, abre…' }).first().click();
      await dialogo(page);
      achados = await medir(page);
      const g = page.locator('[role="dialog"]');
      ok(achados.length === 0 && (await g.getByRole('button', { pressed: true }).count()) === 1 && (await g.locator('[aria-pressed]').count()) === 8, `${w}px · a gaveta: os 8 destinos, o do banner marcado, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      ok((await g.getByLabel('Produto').inputValue()) === P1, `${w}px · a gaveta abre no produto do banner`);
      if (w === 390 || w === 1440) await g.screenshot({ path: arquivoFoto(`gaveta-${w}.png`) });
      // O Clube › Regras do clube, com o período (até antes de aparece de avisa)
      await g.getByRole('button', { name: 'O Clube' }).click();
      await g.getByLabel('Parte do Clube').selectOption('clube:regras');
      await g.getByLabel('Aparece de').fill('2026-12-01');
      await g.getByLabel('até').fill('2026-11-20');
      await g.getByRole('button', { name: 'Salvar' }).click();
      ok(await g.getByText('"Até" vem antes de "aparece de".').isVisible(), `${w}px · "até" antes de "aparece de" avisa e não salva (enviados: ${enviados.length})`);
      await g.getByLabel('até').fill('2026-12-24');
      await g.getByRole('button', { name: 'Salvar' }).click();
      await fechou(page);
      await page.waitForFunction(() => document.body.innerText.includes('Regras do clube · de 01/12 até 24/12'), null, { timeout: 5000 });
      const b0 = enviados[0]?.banners?.[0] ?? {};
      ok(
        enviados.length === 1 && b0.link === 'clube:regras' && b0.apareceDe === '2026-12-01' && b0.apareceAte === '2026-12-24' && enviados[0].banners[1]?.link === 'vagas',
        `${w}px · "Salvar" manda a lista com o destino e o período (${umaLinha(JSON.stringify(b0))})`,
      );
      // Link externo sem https avisa
      await page.getByRole('button', { name: 'Ao tocar, abre…' }).nth(1).click();
      await dialogo(page);
      await g.getByRole('button', { name: 'Link externo' }).click();
      await g.getByLabel('Endereço').fill('http://sem-https.com');
      achados = await medir(page);
      await g.getByRole('button', { name: 'Salvar' }).click();
      ok((await g.getByText('O link externo precisa começar com https://').isVisible()) && achados.length === 0, `${w}px · o link externo sem https avisa, sem barra para o lado`);
      await page.keyboard.press('Escape');
      await fechou(page);
      ok(erros.length === 0, `${w}px · Banners: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    } catch (e) {
      ok(false, `${w}px · Banners (${umaLinha(String(e?.message ?? e))})`);
      await page.screenshot({ path: arquivoFoto(`erro-${w}.png`) }).catch(() => {});
    } finally {
      await ctx.close();
    }
  }

  // ───────────────────────── o cardápio: o banner abre as regras do clube e Sua conta ─────────────────────────
  async function abrirCardapio(w, link, regras) {
    const ctx = await nav.newContext({ viewport: { width: w, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900, reducedMotion: 'reduce' });
    await ctx.addInitScript((t) => localStorage.setItem(`regem_loja_clientetoken_${t}`, 'ct-falso-do-roteiro'), TOKEN_CARDAPIO);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route((u) => u.hostname === 'imagens.exemplo.test', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      const raiz = `/publico/cardapio/${TOKEN_CARDAPIO}`;
      if (p === raiz) return responder(route, { ...MENU, banners: [{ imagemRef: IMG, titulo: 'Banner do clube', link }] });
      if (p === `${raiz}/clube/regras`) return responder(route, { regras });
      if (p === `${raiz}/cliente`)
        return responder(route, { nome: 'Ana Souza', telefone: '21900000000', cliente: { nome: 'Ana Souza', telefone: '21900000000' }, enderecos: [], historico: [] });
      if (p === `${raiz}/cliente/presentes`) return responder(route, { presentes: [], paraRevelar: [], album: { ativo: false }, meta: { ativo: false } });
      if (p === `${raiz}/promos`) return responder(route, { cupons: [], fidelidadeAtiva: false });
      if (req.method() === 'POST') return responder(route, { ok: true });
      return responder(route, {});
    });
    await page.goto(`${base}/c/${TOKEN_CARDAPIO}?tema=oferta`);
    await page.waitForSelector('button[aria-label="Banner do clube"]', { timeout: 30000 });
    return { ctx, page, erros };
  }

  for (const w of larguras) {
    {
      const { ctx, page, erros } = await abrirCardapio(w, 'clube:regras', ['Não há sorteio: todo mundo que cumpre a regra recebe.', 'Um benefício por pedido.']);
      try {
        await page.locator('button[aria-label="Banner do clube"]').first().click();
        await page.waitForSelector('[role="dialog"][aria-label="Regras do clube"] li', { timeout: 10000 });
        const achados = await medir(page);
        const t = await texto(page, '[role="dialog"][aria-label="Regras do clube"]');
        ok(achados.length === 0 && t.includes('Não há sorteio') && t.includes('Um benefício por pedido.'), `${w}px · o banner "Regras do clube" abre as regras, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
        if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`cardapio-regras-${w}.png`) });
        ok(erros.length === 0, `${w}px · cardápio com as regras: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
      } catch (e) {
        ok(false, `${w}px · o banner das regras (${umaLinha(String(e?.message ?? e))})`);
        await page.screenshot({ path: arquivoFoto(`cardapio-regras-${w}-erro.png`) }).catch(() => {});
      } finally {
        await ctx.close();
      }
    }
  }
  for (const w of [390, 1366]) {
    {
      // Sem nenhuma ferramenta ligada, a lista vem vazia: "o clube ainda não está aberto".
      const { ctx, page } = await abrirCardapio(w, 'regem:regras', []);
      try {
        await page.locator('button[aria-label="Banner do clube"]').first().click();
        await page.waitForSelector('text=O clube desta loja ainda não está aberto.', { timeout: 10000 });
        ok(true, `${w}px · sem regras: "O clube desta loja ainda não está aberto."`);
      } catch (e) {
        ok(false, `${w}px · as regras vazias (${umaLinha(String(e?.message ?? e))})`);
      } finally {
        await ctx.close();
      }
    }
    {
      // "Meus prêmios e o álbum": Sua conta em Benefícios.
      const { ctx, page } = await abrirCardapio(w, 'clube:premios', []);
      try {
        await page.locator('button[aria-label="Banner do clube"]').first().click();
        await page.waitForSelector('[role="dialog"][aria-label="Sua conta"]', { timeout: 10000 });
        const aba = await page.getByRole('button', { name: 'Benefícios' }).getAttribute('aria-pressed');
        ok(aba === 'true', `${w}px · o banner "Meus prêmios e o álbum" abre Sua conta em Benefícios (aria-pressed: ${aba})`);
      } catch (e) {
        ok(false, `${w}px · o banner dos prêmios (${umaLinha(String(e?.message ?? e))})`);
      } finally {
        await ctx.close();
      }
    }
  }
}
