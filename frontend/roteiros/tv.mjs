// Roteiro de tela da TV de senhas (/senhas — auditoria do KDS, T1 e T2): a rota pública da TV simulada. Confere a senha
// medida em px pela largura da TV (o navegador de TV antigo não entende `cqi`); 8 senhas a 100%; 16 senhas com a letra
// menor (até 60%) e todas à vista; 25 e 60 senhas em páginas que trocam a cada 8 s, a primeira com as mais novas —
// nenhuma senha some.
import { responder } from './comum.mjs';

const senhas = (n, base = 300) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, senha: base - i, prefixo: i % 3 === 0 ? 'D' : 'B', prontoEm: new Date(Date.now() - i * 30_000).toISOString(), saiEm: null }));

const medir = (page) =>
  page.evaluate(() => {
    const q = document.querySelector('.tv-quadro');
    const pronto = [...document.querySelectorAll('.tv-col')][1];
    const caixa = pronto.querySelector('.tv-senhas');
    const chip = pronto.querySelector('.tv-senha');
    const visiveis = [...pronto.querySelectorAll('[data-senha]')].filter((el) => {
      const r = el.getBoundingClientRect();
      const c = caixa.getBoundingClientRect();
      return r.bottom <= c.bottom + 1 && r.right <= c.right + 1;
    }).length;
    const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
    return {
      largura: q.getBoundingClientRect().width,
      u: getComputedStyle(q).getPropertyValue('--u').trim(),
      fonte: parseFloat(getComputedStyle(chip).fontSize),
      fit: caixa.dataset.fit,
      paginas: Number(caixa.dataset.paginas),
      naCaixa: pronto.querySelectorAll('[data-senha]').length,
      visiveis,
      transborda: caixa.scrollHeight > caixa.clientHeight + 1 || caixa.scrollWidth > caixa.clientWidth + 1,
      titulo: pronto.querySelector('.tv-col-titulo').textContent,
      primeira: pronto.querySelector('[data-senha] .sr-only')?.textContent,
      temCqi: /cqi/.test(css),
      pagina: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    };
  });

export default async function roteiroTv({ nav, base, ok, foto }) {
  async function abrir(w, h, nPronto, nPrep = 6) {
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    await ctx.addInitScript(() => localStorage.setItem('regem_tela_senhas', JSON.stringify({ id: 't1', segredo: 's', nome: 'TV do balcão' })));
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', (route) => {
      if (new URL(route.request().url()).pathname.endsWith('/publico/senhas'))
        return responder(route, {
          agora: new Date().toISOString(),
          tela: { id: 't1', nome: 'TV do balcão' },
          loja: { nome: 'Burger da Esquina', logoRef: null, logoEmoji: null },
          ajustes: { tamanhos: { pronto: 100, preparando: 100, titulos: 100 }, prontoMin: 0, som: false },
          preparando: Array.from({ length: nPrep }, (_, i) => ({ id: `r${i}`, senha: 120 + i, prefixo: 'B' })),
          pronto: senhas(nPronto),
        });
      return responder(route, {});
    });
    await page.goto(base + '/senhas');
    await page.waitForSelector('.tv-quadro [data-senha]', { timeout: 20000 });
    await page.waitForTimeout(600);
    return { ctx, page, erros };
  }

  for (const [w, h] of [[1280, 720], [1920, 1080], [1024, 600]]) {
    // 8 senhas: tudo a 100%, medido em px pela largura da TV
    let a = await abrir(w, h, 8);
    let m = await medir(a.page);
    const esperado = (m.largura / 100) * 5.2;
    ok(!m.temCqi, `${w}×${h}: nenhum cqi no estilo da TV`);
    ok(/px$/.test(m.u) && Math.abs(parseFloat(m.u) - m.largura / 100) < 0.05, `${w}×${h}: --u em px pela largura (${m.u})`);
    ok(m.fit === '1.00' && Math.abs(m.fonte - esperado) < 0.6, `${w}×${h} 8 senhas: letra a 100% (${m.fonte.toFixed(1)} px ≈ ${esperado.toFixed(1)} px)`);
    ok(m.paginas === 1 && m.visiveis === 8 && !m.transborda, `${w}×${h} 8 senhas: todas à vista`);
    ok(!m.pagina, `${w}×${h}: sem rolagem lateral`);
    if (w === 1280) await a.page.screenshot({ path: foto(`${w}-8.png`) });
    ok(a.erros.length === 0, `${w}×${h}: sem erro (${a.erros.join(' | ')})`);
    await a.ctx.close();

    // 16 senhas: não cabem a 100%; a letra diminui (sem passar de 60%) e todas ficam na tela, numa página só
    a = await abrir(w, h, 16);
    m = await medir(a.page);
    const fit16 = Number(m.fit);
    ok(m.paginas === 1 && m.visiveis === 16 && !m.transborda, `${w}×${h} 16 senhas: todas à vista (${m.visiveis}), letra a ${Math.round(fit16 * 100)}%`);
    ok(fit16 < 1 && fit16 >= 0.6, `${w}×${h} 16 senhas: a letra diminuiu sem passar de 60% (${fit16})`);
    if (w === 1280) await a.page.screenshot({ path: foto(`${w}-16.png`) });
    await a.ctx.close();

    // 25 senhas: nem a 60% cabem — duas páginas, nenhuma some
    a = await abrir(w, h, 25);
    m = await medir(a.page);
    ok(m.paginas === 2 && m.naCaixa * 2 >= 25 && !m.transborda, `${w}×${h} 25 senhas: ${m.paginas} páginas de ${m.naCaixa}, nada some`);
    await a.ctx.close();

    // 60 senhas (pico): páginas que trocam a cada 8 s, a primeira com as mais novas; juntas mostram as 60
    a = await abrir(w, h, 60);
    m = await medir(a.page);
    ok(m.paginas > 1 && /página 1 de \d/.test(m.titulo), `${w}×${h} 60 senhas: ${m.paginas} páginas ("${m.titulo.trim()}")`);
    ok(m.fit === '0.60' && !m.transborda && m.visiveis === m.naCaixa, `${w}×${h} 60 senhas: letra a 60%, a página inteira à vista (${m.visiveis})`);
    ok(/Senha D 300/.test(m.primeira ?? ''), `${w}×${h} 60 senhas: a primeira página começa pela mais nova (${m.primeira})`);
    ok(m.naCaixa * m.paginas >= 60, `${w}×${h} 60 senhas: ${m.naCaixa} por página × ${m.paginas} cobre as 60`);
    if (w === 1280) {
      await a.page.screenshot({ path: foto(`${w}-60-p1.png`) });
      await a.page.waitForTimeout(8600);
      const m2 = await medir(a.page);
      ok(/página 2 de/.test(m2.titulo) && m2.primeira !== m.primeira, `${w}×${h}: depois de 8 s, a página 2 ("${m2.titulo.trim()}", começa em ${m2.primeira})`);
      await a.page.screenshot({ path: foto(`${w}-60-p2.png`) });
    }
    ok(a.erros.length === 0, `${w}×${h} 60: sem erro (${a.erros.join(' | ')})`);
    await a.ctx.close();
  }
}
