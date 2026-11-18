// Roteiro de tela da NOTA DO PEDIDO (fase A1 do protótipo `mockups/regem-avaliacao-pedido.html`, aprovado pelo dono em
// 18/11/2026 com a correção: o link do Google só na nota 5; mig 453). A API simulada. Confere:
//  • Delivery › Avaliações, em cada largura: nenhuma barra de rolagem para o lado (a página e qualquer peça), os números do
//    período, a lista e a gaveta ABERTA (V45: medida com ela na frente);
//  • os estados da lista: a nuvem não respondeu (a faixa e o "Tentar de novo", que lê de novo), nenhuma avaliação no
//    período (com o ajuste desligado) e o período que vai na consulta; a situação "Nota 1 ou 2" que filtra;
//  • a página do pedido (`/r/…`), em cada largura: o "Como foi o pedido?" depois da entrega; enviar sem nota avisa; as
//    setas mudam a nota; a nota 5 mostra o "Contar também no Google", a 4 não, a 2 diz que a equipe vai falar; "Você já
//    avaliou" com o Google só se a nota foi 5; "encerrou"; desligado não mostra nada;
//  • o ajuste em Delivery › Configurações › Robô de atendimento: o cartão novo e o "Salvar nota" que manda só o que mudou.
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', nome: 'Ana' });
const LINK = 'https://g.page/r/mister-burger/review';
const agora = Date.now();
const ha = (min) => new Date(agora - min * 60_000).toISOString();

const AV = [
  [5, 2841, 'Marina Souza', 'pagina', ['Sabor', 'Tempo de entrega'], 'Chegou quentinho e rápido!', 6, null],
  [2, 2838, 'Carlos Mendes', 'pagina', ['Temperatura', 'Tempo de entrega'], 'Chegou frio e demorou quase uma hora. Pedi sem cebola e veio com cebola também.', 46, 'aberto'],
  [4, 2830, 'Júlia Ramos', 'pagina', ['Embalagem'], null, 70, null],
  [5, 2822, 'Pedro Alves', 'pagina', ['Sabor'], 'Melhor smash da cidade.', 60 * 23, null],
  [1, 2815, 'Ana Paula Ferreira de Albuquerque', 'pagina', ['Pedido completo'], 'Faltou a batata.', 60 * 24, 'resolvido'],
  [3, 2809, 'Rafael Teixeira', 'pagina', ['Preço'], 'Bom, mas achei caro.', 60 * 25, null],
  [5, 2797, 'Bruna Lima', 'pagina', [], null, 60 * 48, null],
  [4, 2790, 'Diego Fonseca', 'pagina', ['Tempo de entrega'], 'Demorou um pouco, mas estava ótimo.', 60 * 49, null],
].map(([nota, numero, cliente, origem, pesou, comentario, min, caso], i) => ({
  id: `av-${i}`,
  nota,
  pesou,
  comentario,
  origem,
  em: ha(min),
  pedido: { id: `p-${i}`, numero: String(numero), cliente, itens: '1× Smash duplo · 1× Batata média · 1× Refri lata', total: 54.9, minutos: 32 + i },
  caso: caso ? { id: `caso-${i}`, status: caso } : null,
}));
const notas = (l) => Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, l.filter((a) => a.nota === n).length]));
const LISTA = (o = {}) => ({
  periodo: o.periodo ?? '7',
  ajustes: { ativa: o.ativa ?? true, casoAte: 2, prazoDias: 7 },
  kpis: { avaliacoes: AV.length, media: 3.6, entregues: 46, notas: notas(AV) },
  lista: AV,
  mais: false,
});
const VAZIA = () => ({ ...LISTA({ ativa: false }), kpis: { avaliacoes: 0, media: null, entregues: 12, notas: notas([]) }, lista: [] });

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
    // Texto esmagado: bloco de texto com menos de 60 px de largura e mais de 3 linhas.
    for (const el of document.querySelectorAll('main p, main td, main li, main h2, main h3, main strong, main dd, [role="dialog"] p, [role="dialog"] dd')) {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      if (r.width > 0 && r.width < 60 && r.height > lh * 3.2 && (el.textContent || '').trim().length > 12)
        achados.push(`esmagado ${el.tagName.toLowerCase()} ${Math.round(r.width)}px: ${(el.textContent || '').trim().slice(0, 24)}`);
    }
    return achados;
  });
const texto = (page, sel = 'main') => page.evaluate((s) => document.querySelector(s)?.innerText.replace(/\s+/g, ' ') ?? '', sel);

export default async function roteiroAvaliacoes({ nav, base, ok, foto: arquivoFoto, larguras }) {
  // ───────────────────────── Delivery › Avaliações ─────────────────────────
  async function abrirLista(w, h, o = {}) {
    const consultas = [];
    let falhas = o.falhas ?? 0;
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), PRESIDENTE);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/delivery/avaliacoes') {
        consultas.push(u.search);
        if (falhas > 0) {
          falhas--;
          return responder(route, { statusCode: 502, message: 'A nuvem não respondeu agora. Tente de novo em instantes.' }, 502);
        }
        return responder(route, o.vazia ? VAZIA() : LISTA({ periodo: u.searchParams.get('periodo') }));
      }
      return responder(route, {});
    });
    await page.goto(base + '/delivery/avaliacoes');
    return { ctx, page, erros, consultas };
  }

  for (const w of larguras) {
    const { ctx, page, erros } = await abrirLista(w, 900);
    await page.waitForSelector('text=Nota média', { timeout: 30000 });
    const t = await texto(page);
    let achados = await medir(page);
    ok(achados.length === 0, `${w}px · avaliações: sem barra para o lado nem texto esmagado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok(t.includes('3,6') && t.includes('17%') && t.includes('8 de 46 pedidos entregues do Regem') && t.includes('Chegou frio e demorou'), `${w}px · os números do período e a lista`);
    // A gaveta ABERTA, medida com ela na frente (V45).
    await page.getByRole('button', { name: 'Ver: pedido 2838' }).first().click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    const g = await texto(page, '[role="dialog"]');
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · gaveta aberta: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok(g.includes('Pedido #2838') && g.includes('Ruim') && g.includes('Temperatura') && g.includes('Caso “Avaliação” no Atendimento') && g.includes('Cardápio Regem'), `${w}px · a gaveta mostra a nota, o que pesou, o pedido e o caso`);
    ok((await page.locator('[role="dialog"] a:has-text("Abrir no Atendimento")').getAttribute('href')) === '/atendimento?caso=caso-1', `${w}px · "Abrir no Atendimento" leva ao caso`);
    if (w === 390 || w === 1440) await page.locator('[role="dialog"]').screenshot({ path: arquivoFoto(`avaliacoes-gaveta-${w}.png`) });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
    if (w === 390 || w === 1440) {
      await page.screenshot({ path: arquivoFoto(`avaliacoes-${w}.png`) });
      const lista = page.locator('main section').first();
      await lista.screenshot({ path: arquivoFoto(`avaliacoes-${w}-lista.png`) });
    }
    ok(erros.length === 0, `${w}px · nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    await ctx.close();
  }

  for (const w of [390, 1366]) {
    {
      // A nuvem não respondeu: a faixa; "Tentar de novo" lê de novo e a lista aparece.
      const { ctx, page, consultas } = await abrirLista(w, 900, { falhas: 1 });
      await page.waitForSelector('text=Não consegui ler as avaliações agora', { timeout: 30000 });
      const achados = await medir(page);
      ok(achados.length === 0, `${w}px · não leu: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      await page.getByRole('button', { name: 'Tentar de novo' }).click();
      await page.waitForSelector('text=Nota média', { timeout: 10000 });
      ok(consultas.length === 2, `${w}px · "Tentar de novo" lê de novo (${consultas.length} leituras)`);
      // O período vai na consulta; a situação filtra a lista.
      await page.getByRole('button', { name: 'Hoje', exact: true }).click();
      await page.waitForTimeout(300);
      ok(consultas.some((c) => c.includes('periodo=hoje')), `${w}px · "Hoje" pede o período`);
      await page.waitForSelector('text=Nota média', { timeout: 10000 });
      await page.getByRole('button', { name: /^Nota 1 ou 2/ }).click();
      const t = await texto(page);
      ok(t.includes('2 de 8 avaliações') && !t.includes('Melhor smash'), `${w}px · "Nota 1 ou 2" filtra a lista (${umaLinha(t.match(/\d+ de \d+ avaliações/)?.[0] ?? '?')})`);
      await ctx.close();
    }
    {
      const { ctx, page } = await abrirLista(w, 900, { vazia: true });
      await page.waitForSelector('text=Nenhuma avaliação nos últimos 7 dias', { timeout: 30000 });
      const t = await texto(page);
      const achados = await medir(page);
      ok(achados.length === 0 && t.includes('está desligado') && t.includes('Delivery › Configurações › Robô de atendimento'), `${w}px · vazio com o ajuste desligado: diz onde ligar e sem barra para o lado`);
      ok((await page.locator('a:has-text("Ver o ajuste")').getAttribute('href')) === '/delivery/configuracoes?aba=robo', `${w}px · "Ver o ajuste" leva ao Robô de atendimento`);
      await ctx.close();
    }
  }

  // ───────────────────────── a página do pedido (/r/…) ─────────────────────────
  const ESTADO = (o = {}) => ({
    situacao: 'aberta',
    loja: 'Mister Burger',
    prazoDias: 7,
    ate: new Date(agora + 6 * 86_400_000).toISOString(),
    opcoes: ['Sabor', 'Temperatura', 'Tempo de entrega', 'Embalagem', 'Pedido completo', 'Preço'],
    feita: null,
    google: null,
    ...o,
  });
  async function abrirPagina(w, h, o = {}) {
    const enviados = [];
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/rastreio/tk2841') return responder(route, { numero: 2841, status: 'concluido', statusLabel: 'entregue', entregador: null, destino: null, parada: null, etaMin: null, codigoEntrega: null, rota: null });
      if (p === '/rastreio/tk2841/avaliacao' && req.method() === 'POST') {
        const corpo = JSON.parse(req.postData() || '{}');
        enviados.push(corpo);
        const nota = Number(corpo.nota);
        return responder(route, { ...ESTADO({ situacao: 'avaliado', feita: { nota, origem: 'pagina', em: new Date().toISOString() }, google: nota === 5 ? LINK : null }), caso: nota <= 2 });
      }
      if (p === '/rastreio/tk2841/avaliacao') return responder(route, ESTADO(o.estado ?? {}));
      return responder(route, {});
    });
    await page.goto(base + '/r/tk2841');
    return { ctx, page, erros, enviados };
  }

  for (const w of larguras) {
    const { ctx, page, erros, enviados } = await abrirPagina(w, 900);
    await page.waitForSelector('text=Como foi o pedido?', { timeout: 30000 });
    let achados = await medir(page);
    ok(achados.length === 0, `${w}px · página do pedido: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    // Enviar sem nota avisa, sem perder o texto.
    await page.getByLabel(/Quer contar mais/).fill('Chegou quentinho!');
    await page.getByRole('button', { name: 'Enviar avaliação' }).click();
    ok(await page.getByText('Escolha uma nota de 1 a 5.').isVisible(), `${w}px · enviar sem nota avisa`);
    ok(enviados.length === 0, `${w}px · sem nota, nada vai ao servidor`);
    // As setas mudam a nota (grupo de escolha).
    await page.getByRole('radio', { name: '3 de 5 · Regular' }).click();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    ok((await page.getByRole('radio', { name: '5 de 5 · Excelente' }).getAttribute('aria-checked')) === 'true', `${w}px · as setas levam a nota a 5`);
    await page.getByRole('button', { name: 'Sabor', exact: true }).click();
    if (w === 390 || w === 1440) await page.locator('form').screenshot({ path: arquivoFoto(`pagina-nota-${w}.png`) });
    await page.getByRole('button', { name: 'Enviar avaliação' }).click();
    await page.waitForSelector('text=Obrigado pela nota!', { timeout: 10000 });
    ok(JSON.stringify(enviados[0]) === JSON.stringify({ nota: 5, pesou: ['Sabor'], comentario: 'Chegou quentinho!' }), `${w}px · o que vai ao servidor (${umaLinha(JSON.stringify(enviados[0]))})`);
    ok((await page.locator('a:has-text("Contar também no Google")').getAttribute('href')) === LINK, `${w}px · a nota 5 mostra o "Contar também no Google"`);
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · o obrigado: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    if (w === 390) await page.screenshot({ path: arquivoFoto('pagina-nota-5-390.png'), fullPage: true });
    ok(erros.length === 0, `${w}px · página: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    await ctx.close();
  }

  for (const w of [390, 1366]) {
    for (const [nota, frase, google] of [
      [4, 'é assim que a gente melhora', false],
      [2, 'Sinto muito pelo pedido.', false],
    ]) {
      const { ctx, page } = await abrirPagina(w, 900);
      await page.waitForSelector('text=Como foi o pedido?', { timeout: 30000 });
      await page.getByRole('radio', { name: new RegExp(`^${nota} de 5`) }).click();
      await page.getByRole('button', { name: 'Enviar avaliação' }).click();
      await page.waitForSelector(`text=${frase}`, { timeout: 10000 });
      ok((await page.locator('a:has-text("Contar também no Google")').count()) === (google ? 1 : 0), `${w}px · nota ${nota}: "${frase}" e sem o Google`);
      await ctx.close();
    }
    for (const [nome, estado, frase, comGoogle] of [
      ['já avaliou (5)', { situacao: 'avaliado', feita: { nota: 5, origem: 'pagina', em: ha(30) }, google: LINK }, 'Você já avaliou este pedido', true],
      ['já avaliou (4)', { situacao: 'avaliado', feita: { nota: 4, origem: 'whatsapp', em: ha(60 * 30) }, google: null }, 'Pelo WhatsApp', false],
      ['encerrou', { situacao: 'encerrada' }, 'A avaliação deste pedido encerrou', false],
    ]) {
      const { ctx, page } = await abrirPagina(w, 900, { estado });
      await page.waitForSelector(`text=${frase}`, { timeout: 30000 });
      const achados = await medir(page);
      ok(achados.length === 0 && (await page.locator('a:has-text("Contar também no Google")').count()) === (comGoogle ? 1 : 0), `${w}px · ${nome}: a frase, o Google ${comGoogle ? 'sim' : 'não'} e sem barra para o lado`);
      await ctx.close();
    }
    {
      const { ctx, page } = await abrirPagina(w, 900, { estado: { situacao: 'desligado', loja: null } });
      await page.waitForSelector('text=Pedido entregue', { timeout: 30000 });
      await page.waitForTimeout(600);
      ok((await page.getByText('Como foi o pedido?').count()) === 0, `${w}px · desligado: a página não mostra o formulário`);
      await ctx.close();
    }
  }

  // ───────────────────────── o ajuste (Delivery › Configurações › Robô de atendimento) ─────────────────────────
  for (const w of [390, 1366]) {
    const posts = [];
    let ajuste = { ativa: true, casoAte: 2, prazoDias: 7, opcoes: { casoAte: [1, 2, 3], prazoDias: [2, 7, 30] } };
    const ctx = await nav.newContext({ viewport: { width: w, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), PRESIDENTE);
    const page = await ctx.newPage();
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      const robo = () => ({ pausaMinutos: 30, opcoesPausa: [30], avaliacao: { ativa: true, link: LINK, texto: 'x {link}', depoisMin: 40, soSemProblema: true, aPartirDo: 2, deNovoDias: 60, doMes: { enviados: 0, tocaram: 0 }, opcoes: { depoisMin: [40], aPartirDo: [2], deNovoDias: [60] }, textoPadrao: 'x {link}' }, nota: ajuste });
      if (p === '/whatsapp/nota-do-pedido' && req.method() === 'POST') {
        const corpo = JSON.parse(req.postData() || '{}');
        posts.push(corpo);
        ajuste = { ...ajuste, ...corpo };
        return responder(route, robo());
      }
      if (p === '/whatsapp/robo-config') return responder(route, robo());
      // Os números do WhatsApp (a mesma aba os lê): o principal na API oficial, o de marketing sem número.
      if (p === '/whatsapp/numeros') {
        const numero = (papel, n) => ({ papel, provedor: 'cloud', numero: n, instancia: null, phoneId: n ? 'pn-1' : null, wabaId: n ? 'waba-1' : null, status: n ? 'conectado' : 'desligado', verificado: !!n, vinculado: !!n });
        return responder(route, { principal: numero('principal', '5521999990771'), marketing: numero('marketing', null), termo: { versao: '1', evolution: '', cloud: '' } });
      }
      if (p === '/cardapio/config') return responder(route, { id: 'cfg', ativo: true, roboAtivo: true, provedor: 'cloud' });
      if (/banners|cupons|regras-sinal|formas|impressoras|integrac|numeros|eventos|fidelidade|cashback|bairros|areas/.test(p)) return responder(route, []);
      return responder(route, {});
    });
    const errosAj = [];
    page.on('pageerror', (e) => errosAj.push(String(e?.message ?? e)));
    page.on('console', (m) => {
      if (m.type() === 'error') errosAj.push(m.text().slice(0, 200));
    });
    await page.goto(base + '/delivery/configuracoes?aba=robo');
    const cartao = page.locator('[data-nota-do-pedido]');
    await cartao.waitFor({ timeout: 30000 });
    try {
      await cartao.getByLabel('Nota que abre caso no Atendimento').waitFor({ timeout: 10000 });
    } catch (e) {
      // O motivo na mão: o que o cartão mostra e a foto dele.
      await page.screenshot({ path: arquivoFoto(`avaliacoes-ajuste-falhou-${w}.png`) }).catch(() => {});
      const quantos = await cartao.count().catch(() => -1);
      ok(false, `${w}px · ajuste: o cartão não mostrou os campos (${quantos} cartão(ões); ${umaLinha(await cartao.first().innerText().catch(() => '?'), 300)}; erros: ${umaLinha(errosAj.join(' | '), 300)})`);
      await ctx.close();
      continue;
    }
    const achados = await medir(page);
    ok(achados.length === 0, `${w}px · ajuste: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok((await cartao.innerText()).includes('Link do Google: colado ✓'), `${w}px · ajuste: diz que o link do Google está colado (vai só na nota 5)`);
    await cartao.getByLabel('Prazo para avaliar').selectOption('30');
    await cartao.getByRole('button', { name: 'Salvar nota' }).click();
    await page.waitForTimeout(400);
    ok(JSON.stringify(posts[0]) === JSON.stringify({ prazoDias: 30 }), `${w}px · "Salvar nota" manda só o que mudou (${umaLinha(JSON.stringify(posts[0]))})`);
    if (w === 390) await cartao.screenshot({ path: arquivoFoto('avaliacoes-ajuste-390.png') });
    await ctx.close();
  }
}
