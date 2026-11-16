// Roteiro de tela da LANDING pública do app (`/`, `src/app/page.tsx`) — a página que o visitante vê antes do login.
// Confere, em cada largura: nenhuma barra lateral e nada fora da janela; os três planos com os preços da tabela do app
// (129 / 199 / 299, o do meio em destaque); o TEF com "em breve"; nenhuma das promessas que o produto não cumpre; nenhum
// link que não leva a lugar nenhum (`href="#"`); e sem o botão flutuante do WhatsApp (decisões do dono de 12/11/2026).
const PROIBIDAS = ['lojas operando', '120+', 'desperdício evitado', 'Metas L.T.D.A', 'white-label', 'agendados por e-mail', 'vistorias assinadas', 'meu ranking', 'Sob consulta', 'R$ 149', 'R$ 289'];

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('.lp a, .lp button, .lp h1, .lp h2, .lp h3, .lp .plan, .lp .mod, .lp .pcard')) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 1 && (r.right > window.innerWidth + 1 || r.left < -1))
        achados.push(`passa ${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 24)}" ${Math.round(r.left)}..${Math.round(r.right)} de ${window.innerWidth}`);
    }
    return achados;
  });

export default async function roteiroLanding({ nav, base, ok, foto, larguras }) {
  for (const w of larguras) {
    const ctx = await nav.newContext({ viewport: { width: w, height: w < 700 ? 820 : 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', (r) => r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
    await page.goto(base + '/');
    await page.waitForSelector('.lp #precos .plan', { timeout: 20000 });
    await page.waitForTimeout(200);

    const m = await medir(page);
    ok(m.length === 0, `${w}: nenhuma barra lateral e nada fora da janela ${m.slice(0, 3).join(' | ')}`);

    const planos = await page.evaluate(() =>
      [...document.querySelectorAll('.lp #precos .plan')].map((p) => ({
        nome: p.querySelector('h3')?.textContent?.trim(),
        preco: (p.querySelector('.price')?.textContent ?? '').replace(/\s+/g, ' ').trim(),
        destaque: p.classList.contains('hot'),
        itens: p.querySelectorAll('li').length,
        botao: p.querySelector('a')?.getAttribute('href'),
      })),
    );
    ok(
      JSON.stringify(planos.map((p) => [p.nome, p.preco, p.destaque])) ===
        JSON.stringify([['Balcão', 'R$ 129/mês', false], ['Salão', 'R$ 199/mês', true], ['Completo', 'R$ 299/mês', false]]),
      `${w}: os três planos com os preços do app (${planos.map((p) => `${p.nome} ${p.preco}`).join(' · ')})`,
    );
    ok(planos.every((p) => p.itens >= 4 && p.botao === '/criar-conta'), `${w}: cada plano lista o que traz e leva ao criar conta`);
    // O selo do plano em destaque vem do CSS (`::before`): o texto da página não o traz, então lê-se o estilo.
    const selo = await page.evaluate(() => {
      const el = document.querySelector('.lp #precos .plan.hot');
      return el ? getComputedStyle(el, '::before').content.replace(/"/g, '') : '';
    });
    ok(selo === 'RECOMENDADO', `${w}: o plano em destaque é "recomendado", não "mais escolhido" (${selo})`);

    const texto = await page.evaluate(() => document.querySelector('.lp')?.innerText ?? '');
    const achadas = PROIBIDAS.filter((t) => texto.toLowerCase().includes(t.toLowerCase()));
    ok(achadas.length === 0, `${w}: nenhuma promessa que o produto não cumpre (${achadas.join(', ')})`);
    const tef = await page.evaluate(() => [...document.querySelectorAll('.lp .mod h3')].find((h) => h.textContent.includes('TEF'))?.textContent ?? '');
    ok(/em breve/i.test(tef), `${w}: o TEF aparece com "em breve" (${tef.trim()})`);

    const mortos = await page.evaluate(() => [...document.querySelectorAll('.lp a')].filter((a) => a.getAttribute('href') === '#').map((a) => a.textContent.trim()));
    ok(mortos.length === 0, `${w}: nenhum link que não leva a lugar nenhum (${mortos.join(', ')})`);
    const flutuante = await page.evaluate(() => [...document.querySelectorAll('.lp a')].some((a) => getComputedStyle(a).position === 'fixed'));
    ok(!flutuante, `${w}: sem botão flutuante`);

    if (w === 375 || w === 1920) {
      await page.locator('.lp #precos').scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await page.screenshot({ path: foto(`precos-${w}.png`) });
      await page.locator('.lp .proof').scrollIntoViewIfNeeded();
      await page.waitForTimeout(150);
      await page.screenshot({ path: foto(`numeros-${w}.png`) });
    }
    ok(erros.length === 0, `${w}: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
