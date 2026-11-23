// Roteiro de tela de RELATÓRIOS › NOTÍCIAS DO RAMO (fase N1 do protótipo `mockups/regem-noticias-do-ramo.html`, versão 2,
// aprovado em 22/11/2026; mig 494). A API simulada, com o boletim real de 22/11. Confere:
//  • em cada largura: nenhuma barra de rolagem para o lado nem texto esmagado, com todas as notícias e com cada filtro;
//  • os blocos (destaques, novidades e tendências, mais notícias), o aviso de "ainda não é lei", o crédito e o link;
//  • os estados: sem internet, erro com "Tentar de novo", nenhum boletim, dia sem novidade, dia sem boletim, filtro vazio;
//  • o menu: aparece com a permissão e com o ramo; some sem um dos dois.
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', nome: 'Ana' });
const GERENTE = tokenFalso({ cat: 'gerente', perfil: 'gerente', nome: 'Beto', perm: { dashboard: true } });
const RECEITA = 'Fonte: Receita Federal (gov.br, CC BY-ND 3.0)';
const AVISO = 'Em discussão no Congresso: ainda não é lei.';
const noticia = (id, titulo, categoria, categoriaNome, credito, publicadoEm, emDiscussao = false) => ({
  id: String(id),
  titulo,
  link: `https://fonte.teste/noticia/${id}`,
  categoria,
  categoriaNome,
  publicadoEm,
  emDiscussao,
  aviso: emDiscussao ? AVISO : null,
  credito,
});
const BOLETIM = {
  dia: '2026-11-22',
  mensagem: null,
  indicadores: [
    { id: 'ipca_fora_do_domicilio', nome: 'IPCA da alimentação fora de casa', valor: 0.36, unidade: '% no mês', referencia: '2026-10', acumulado12Meses: 5.68, mudou: false, credito: 'Fonte: IBGE' },
    { id: 'ipca_geral', nome: 'IPCA (inflação geral)', valor: 0.14, unidade: '% no mês', referencia: '2026-10', acumulado12Meses: 4.63, mudou: false, credito: 'Fonte: IBGE' },
    { id: 'selic', nome: 'Selic (meta)', valor: 13.75, unidade: '% ao ano', referencia: '2026-11-22', acumulado12Meses: null, mudou: true, credito: 'Fonte: Banco Central do Brasil' },
  ],
  destaques: [
    noticia(1, 'Receita Federal amplia acesso ao Ambiente de Produção Restrita do Piloto da CBS', 'impostos', 'Impostos e fiscal', RECEITA, '2026-11-20T14:05:00.000Z'),
    noticia(2, 'Receita Federal, CGIBS e CFC vão orientar mais de 25 mil profissionais da contabilidade sobre destaque de CBS/IBS em documentos fiscais', 'impostos', 'Impostos e fiscal', RECEITA, '2026-11-19T19:56:00.000Z'),
    noticia(3, 'Durigan defende novo imposto no Senado', 'impostos', 'Impostos e fiscal', 'Agência Senado', '2026-11-19T20:02:00.000Z', true),
    noticia(5, 'Empresários pedem mais tempo para adaptação à escala 5x2 com 42 horas semanais', 'trabalho', 'Trabalho', 'Agência Câmara', '2026-11-19T19:11:00.000Z', true),
  ],
  novidades: [
    noticia(7, 'Mel com pimenta e snacks funcionais estão entre as tendências de alimentos para 2027', 'tendencias', 'Tendências do ramo', 'Fonte: Mercado&Consumo', '2026-11-22T12:40:00.000Z'),
    noticia(8, 'iFood lança armários inteligentes para organizar e agilizar pedidos em restaurantes', 'plataformas', 'Plataformas de delivery', 'Fonte: Mercado&Consumo', '2026-11-21T12:40:00.000Z'),
  ],
  mais: [noticia(6, 'Câmara deve votar ajuste fiscal; proposta do governo pretende economizar R$ 70 bilhões', 'economia', 'Economia e custos', 'Agência Câmara', '2026-11-19T17:57:00.000Z', true)],
};
const RESPOSTA = { semNuvem: false, dia: '2026-11-22', dias: ['2026-11-22', '2026-11-21'], boletim: BOLETIM };
const SEM_NOVIDADE = { ...RESPOSTA, boletim: { ...BOLETIM, mensagem: 'Hoje não saiu nada importante para o ramo.', destaques: [], novidades: [], mais: [] } };

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    for (const el of document.querySelectorAll('main p, main li, main h2, main h3, main h4, main a')) {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      if (r.width > 0 && r.width < 60 && r.height > lh * 3.2 && (el.textContent || '').trim().length > 12)
        achados.push(`esmagado ${el.tagName.toLowerCase()} ${Math.round(r.width)}px: ${(el.textContent || '').trim().slice(0, 24)}`);
    }
    return achados;
  });
const texto = (page) => page.evaluate(() => document.querySelector('main')?.innerText.replace(/\s+/g, ' ') ?? '');

export default async function roteiroNoticiasRamo({ nav, base, ok, foto: arquivoFoto, larguras }) {
  async function abrir(w, o = {}) {
    const pedidos = [];
    let falhas = o.falhas ?? 0;
    const ctx = await nav.newContext({ viewport: { width: w, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), o.token ?? PRESIDENTE);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/modulos/meus') return responder(route, { noticias_ramo: o.ramo !== false });
      if (p === '/noticias-do-ramo') {
        pedidos.push(u.search);
        if (falhas > 0) {
          falhas--;
          return responder(route, { statusCode: 500, message: 'Não foi possível ler agora.' }, 500);
        }
        const dia = u.searchParams.get('dia');
        if (dia === '2026-11-01') return responder(route, { ...RESPOSTA, dia, boletim: null });
        return responder(route, o.resposta ?? RESPOSTA);
      }
      return responder(route, {});
    });
    await page.goto(base + '/noticias-do-ramo');
    return { ctx, page, erros, pedidos };
  }

  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w);
    await page.waitForSelector('text=Mel com pimenta', { timeout: 30000 });
    const t = await texto(page);
    let achados = await medir(page);
    ok(achados.length === 0, `${w}px · o boletim: sem barra para o lado nem texto esmagado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok(t.includes('7 notícias') && t.includes('0,36%') && t.includes('13,75%') && t.includes('12 meses: 5,68%'), `${w}px · a contagem e os indicadores`);
    ok(t.includes('EM DESTAQUE · 4') && t.includes('NOVIDADES E TENDÊNCIAS · 2') && t.includes('MAIS NOTÍCIAS · 1'), `${w}px · os três blocos (${umaLinha(t.match(/EM DESTAQUE.{0,12}/)?.[0] ?? t, 40)})`);
    ok(t.includes(AVISO) && t.includes('Fonte: Mercado&Consumo'), `${w}px · o aviso de "ainda não é lei" e o crédito`);
    await page.getByRole('button', { name: /^Novidades e tendências/ }).click();
    const n = await texto(page);
    achados = await medir(page);
    ok(n.includes('2 de 7 notícias') && n.includes('iFood lança') && !n.includes('Durigan'), `${w}px · o filtro de novidades`);
    ok(achados.length === 0, `${w}px · com o filtro: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    if (w === 390 || w === 1440) {
      await page.getByRole('button', { name: /^Todas/ }).click();
      await page.screenshot({ path: arquivoFoto(`noticias-ramo-${w}.png`), fullPage: true });
    }
    ok(erros.length === 0, `${w}px · nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    await ctx.close();
  }

  for (const w of [320, 1366]) {
    {
      const { ctx, page } = await abrir(w);
      await page.waitForSelector('text=Mel com pimenta', { timeout: 30000 });
      const a = page.getByRole('link', { name: /Mel com pimenta/ });
      ok((await a.getAttribute('href')) === 'https://fonte.teste/noticia/7' && (await a.getAttribute('target')) === '_blank' && (await a.getAttribute('rel')) === 'noopener noreferrer', `${w}px · o link abre a fonte em outra aba`);
      await page.getByRole('searchbox').fill('zzzz');
      await page.waitForSelector('text=Nada com esses filtros', { timeout: 5000 });
      await page.getByRole('button', { name: 'Limpar filtros' }).click();
      await page.waitForSelector('text=Mel com pimenta', { timeout: 5000 });
      ok(true, `${w}px · o filtro vazio oferece limpar`);
      await page.locator('#noticias-dia').fill('2026-11-01');
      await page.waitForSelector('text=Não há boletim neste dia', { timeout: 5000 });
      ok((await medir(page)).length === 0, `${w}px · dia sem boletim: sem barra para o lado`);
      await page.getByRole('button', { name: 'Ver o mais recente' }).click();
      await page.waitForSelector('text=Mel com pimenta', { timeout: 5000 });
      ok(true, `${w}px · "Ver o mais recente" volta ao boletim`);
      await ctx.close();
    }
    {
      const { ctx, page } = await abrir(w, { resposta: { semNuvem: true, dia: null, dias: [], boletim: null } });
      await page.waitForSelector('text=Esta loja está sem internet', { timeout: 30000 });
      const t = await texto(page);
      ok(t.includes('As vendas da loja continuam normalmente') && !t.includes('Ainda não há boletim'), `${w}px · sem internet não finge que não há boletim`);
      ok((await medir(page)).length === 0, `${w}px · sem internet: sem barra para o lado`);
      await ctx.close();
    }
    {
      const { ctx, page, pedidos } = await abrir(w, { falhas: 1 });
      await page.waitForSelector('text=Não consegui carregar o boletim', { timeout: 30000 });
      await page.getByRole('button', { name: 'Tentar de novo' }).click();
      await page.waitForSelector('text=Mel com pimenta', { timeout: 10000 });
      ok(pedidos.length === 2, `${w}px · "Tentar de novo" lê de novo (${pedidos.length} leituras)`);
      await ctx.close();
    }
    {
      const { ctx, page } = await abrir(w, { resposta: { semNuvem: false, dia: null, dias: [], boletim: null } });
      await page.waitForSelector('text=Ainda não há boletim', { timeout: 30000 });
      ok((await medir(page)).length === 0, `${w}px · nenhum boletim: sem barra para o lado`);
      await ctx.close();
    }
    {
      const { ctx, page } = await abrir(w, { resposta: SEM_NOVIDADE });
      await page.waitForSelector('text=Hoje não saiu nada importante', { timeout: 30000 });
      const t = await texto(page);
      ok(t.includes('13,75%') && t.includes('0 notícias') && !t.includes('EM DESTAQUE'), `${w}px · dia sem novidade: a frase e os indicadores`);
      ok((await medir(page)).length === 0, `${w}px · dia sem novidade: sem barra para o lado`);
      await ctx.close();
    }
  }

  // O menu: a permissão diz quem vê; o ramo diz se a empresa tem boletim.
  const itemNoMenu = async (o) => {
    const { ctx, page } = await abrir(1366, o);
    await page.waitForSelector('nav, aside', { timeout: 30000 });
    await page.waitForResponse((r) => r.url().includes('/modulos/meus'), { timeout: 5000 }).catch(() => null);
    await page.waitForTimeout(400);
    const relatorios = page.getByRole('button', { name: 'Relatórios', exact: true }).first();
    if (await relatorios.count()) {
      if ((await relatorios.getAttribute('aria-expanded')) === 'false') await relatorios.click();
    }
    const n = await page.locator('a[href="/noticias-do-ramo"]').count();
    await ctx.close();
    return n;
  };
  ok((await itemNoMenu({})) > 0, 'menu: o presidente vê "Notícias do ramo" em Relatórios');
  ok((await itemNoMenu({ ramo: false })) === 0, 'menu: empresa de outro ramo não vê o item');
  ok((await itemNoMenu({ token: GERENTE })) === 0, 'menu: o gerente sem a permissão não vê o item');
}
