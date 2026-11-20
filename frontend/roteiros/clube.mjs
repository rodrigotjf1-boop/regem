// Roteiro de tela do CLUBE DE RECOMPRA — a base e o prêmio surpresa (fases A0 e A1 do `docs/plano-clube-e-banner.md`;
// protótipo `mockups/regem-clube-banner.html`, aprovado pelo dono em 20/11/2026; migs 471 e 474). A API simulada.
// Confere, em cada largura (V45: nenhuma barra de rolagem para o lado — a página e qualquer peça —, com cada gaveta e
// diálogo ABERTO e medido na frente):
//  • Delivery › Marketing › aba Clube › Visão geral: o prêmio surpresa com a chave; o álbum e a meta dizem "Chega numa
//    próxima entrega" (nenhuma chave para ligar o que ainda não existe), as regras que valem para as três, mudar o pedido
//    mínimo mostra a barra de alterações e "Salvar alterações" manda SÓ o que mudou; "Ver as regras" abre o diálogo;
//  • Prêmio surpresa: a forma (raspadinha × roleta) manda só a forma; a chave do "Pedido entregue" sem prêmio abre a gaveta,
//    que não oferece o produto grátis; "Ligar com este prêmio" manda o gatilho; os gatilhos das próximas fases e os travados;
//    a chave da reclamação sem prêmios abre a gaveta dela (caixas sem o produto grátis, o limite, quem manda — A1b);
//  • a página do pedido (`/r/…`): a raspadinha ("Revelar sem raspar" e raspando com o mouse) e a roleta (gira e para no
//    prêmio; sem animação com "reduzir movimento"), o cupom revelado e as regras do clube;
//  • o link pessoal (`/p/…`, o prêmio de desculpas — A1b): revelar, o cupom e "Abrir o cardápio"; o link que não existe;
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
const R_PADRAO = { ativo: false, premios: [], limite: 'mes1', quem: 'gerencia' };
const PAINEL = (minimo = 30, forma = 'raspadinha', entregue = { ativo: false, premioId: null, desde: null }, reclamacao = R_PADRAO) => ({
  config: {
    surpresaAtivo: true, surpresaForma: forma, albumAtivo: false, albumSelos: 4, albumValidadeMeses: 12, albumPremios: [P2],
    metaAtivo: false, metaNiveis: [{ pedidos: 3, premios: [] }, { pedidos: 6, premios: [] }], metaValidadeDias: 15, minimo,
  },
  prontas: { surpresa: true, album: false, meta: false },
  gatilhos: { entregue, reclamacao },
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
  opcoes: {
    validadesDoPremio: [3, 7, 15, 30], minimoMax: 1000, nomeMax: 60, premiosMax: 50, premiosPorEscolhaMax: 6,
    limitesDaReclamacao: [{ valor: 'mes1', rotulo: '1 por mês' }, { valor: 'mes2', rotulo: '2 por mês' }, { valor: 'tri1', rotulo: '1 a cada 3 meses' }],
    quemMandaDesculpas: [{ valor: 'gerencia', rotulo: 'Gerente e supervisão' }, { valor: 'gerente', rotulo: 'Só o gerente' }, { valor: 'atendimento', rotulo: 'Qualquer pessoa do atendimento' }],
  },
});

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('faixa-abas'))
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth} "${(el.innerText || '').replace(/\s+/g, ' ').slice(0, 40) || el.outerHTML.slice(0, 220)}"`);
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
    let forma = 'raspadinha';
    let entregue = { ativo: false, premioId: null, desde: null };
    let reclamacao = R_PADRAO;
    const painel = () => PAINEL(minimo, forma, entregue, reclamacao);
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
        return responder(route, painel());
      }
      if (p === '/marketing/clube/config' && metodo === 'PUT') {
        const corpo = JSON.parse(route.request().postData() || '{}');
        enviados.push(corpo);
        if (typeof corpo.minimo === 'number') minimo = corpo.minimo;
        if (corpo.surpresaForma) forma = corpo.surpresaForma;
        return responder(route, painel());
      }
      if (p === '/marketing/clube/gatilhos/reclamacao' && metodo === 'PUT') {
        const corpo = JSON.parse(route.request().postData() || '{}');
        enviados.push({ reclamacao: corpo });
        reclamacao = { ...reclamacao, ...corpo };
        return responder(route, painel());
      }
      if (p === '/marketing/clube/gatilhos/entregue' && metodo === 'PUT') {
        const corpo = JSON.parse(route.request().postData() || '{}');
        enviados.push({ gatilho: corpo });
        entregue = { ...entregue, ...corpo };
        entregue.desde = entregue.ativo ? '2026-11-20T18:30:00.000Z' : null;
        return responder(route, painel());
      }
      if (p === '/marketing/clube/produtos') return responder(route, [{ id: 'pr-1', nome: 'Batata média' }, { id: 'pr-2', nome: 'Refrigerante lata' }]);
      if (p.startsWith('/marketing/clube/premios')) {
        enviados.push({ metodo, p });
        return responder(route, painel());
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
    ok(
      (t.match(/Chega numa próxima entrega/g) ?? []).length === 2 && (await page.locator('main [role="switch"]').count()) === 1 &&
        (await page.getByRole('switch', { name: 'Prêmio surpresa' }).count()) === 1,
      `${w}px · o prêmio surpresa com a chave; o álbum e a meta: "Chega numa próxima entrega"`,
    );
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

    // ── Prêmio surpresa ──
    enviados.length = 0;
    await page.getByRole('button', { name: 'Prêmio surpresa', exact: true }).click();
    await page.waitForSelector('text=Quando o cliente ganha', { timeout: 10000 });
    t = await texto(page);
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · Prêmio surpresa: sem barra para o lado nem texto esmagado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok(
      (t.match(/Chega numa próxima entrega/g) ?? []).length === 2 && t.includes('não recomendado') && t.includes('sorteio · precisa de autorização'),
      `${w}px · classificação e campanha nas próximas entregas; avaliação não recomendada; aleatório travado`,
    );
    await page.getByRole('button', { name: /Roleta de prêmios/ }).click();
    await page.waitForSelector('button[aria-pressed="true"]:has-text("Roleta de prêmios")', { timeout: 5000 });
    ok(JSON.stringify(enviados[0]) === JSON.stringify({ surpresaForma: 'roleta' }), `${w}px · a forma manda só a forma (${umaLinha(JSON.stringify(enviados[0]))})`);
    // A chave sem prêmio abre a gaveta (sem o produto grátis na lista).
    await page.getByRole('switch', { name: 'Pedido entregue' }).click();
    await dialogo(page);
    achados = await medir(page);
    const opcoes = await page.locator('[role="dialog"] option').allTextContents();
    ok(achados.length === 0, `${w}px · gaveta do Pedido entregue aberta: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok(opcoes.includes('15% off até R$ 20') && opcoes.includes('Frete grátis') && !opcoes.some((x) => x.includes('Batata')), `${w}px · a gaveta não oferece o produto grátis (${umaLinha(opcoes.join(', '))})`);
    if (w === 390 || w === 1440) await page.locator('[role="dialog"]').screenshot({ path: arquivoFoto(`clube-gatilho-${w}.png`) });
    await page.getByRole('button', { name: 'Ligar com este prêmio' }).click();
    ok(await page.getByText('Escolha o prêmio de quem tem o pedido entregue.').isVisible(), `${w}px · ligar sem escolher o prêmio avisa`);
    await page.locator('[role="dialog"] select').selectOption(P1);
    await page.getByRole('button', { name: 'Ligar com este prêmio' }).click();
    await fechou(page);
    await page.waitForSelector('text=Valem os pedidos concluídos desde', { timeout: 5000 });
    ok(JSON.stringify(enviados[1]) === JSON.stringify({ gatilho: { ativo: true, premioId: P1 } }), `${w}px · ligar manda o gatilho com o prêmio (${umaLinha(JSON.stringify(enviados[1]))})`);
    t = await texto(page);
    ok(t.includes('Prêmio: 15% off até R$ 20') && (await page.getByRole('switch', { name: 'Pedido entregue' }).getAttribute('aria-checked')) === 'true', `${w}px · ligado, com o prêmio na linha`);
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · Prêmio surpresa ligado: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    // A reclamação: a chave sem prêmios abre a gaveta; os prêmios em caixas (sem o produto grátis), o limite e quem manda.
    await page.getByRole('switch', { name: 'Depois de uma reclamação' }).click();
    await dialogo(page);
    achados = await medir(page);
    const caixas = await page.locator('[role="dialog"] input[type="checkbox"]').count();
    const tg = await texto(page, '[role="dialog"]');
    ok(achados.length === 0, `${w}px · gaveta da reclamação aberta: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok(caixas === 2 && !tg.includes('Batata') && tg.includes('Quem pode mandar'), `${w}px · a gaveta da reclamação: 2 prêmios (sem o produto grátis), o limite e quem manda`);
    if (w === 390 || w === 1440) await page.locator('[role="dialog"]').screenshot({ path: arquivoFoto(`clube-reclamacao-${w}.png`) });
    await page.getByRole('button', { name: 'Ligar', exact: true }).click();
    ok(await page.getByText('Escolha ao menos um prêmio que a equipe pode mandar.').isVisible(), `${w}px · ligar sem prêmio avisa`);
    await page.getByLabel('Frete grátis').check();
    await page.getByLabel('No máximo, por cliente').selectOption('tri1');
    await page.getByRole('button', { name: 'Ligar', exact: true }).click();
    await fechou(page);
    const ultimo = enviados[enviados.length - 1];
    ok(
      JSON.stringify(ultimo) === JSON.stringify({ reclamacao: { ativo: true, premios: [P3], limite: 'tri1', quem: 'gerencia' } }),
      `${w}px · ligar a reclamação manda os prêmios, o limite e quem manda (${umaLinha(JSON.stringify(ultimo))})`,
    );
    t = await texto(page);
    ok(t.includes('No máximo 1 a cada 3 meses por cliente') && (await page.getByRole('switch', { name: 'Depois de uma reclamação' }).getAttribute('aria-checked')) === 'true', `${w}px · reclamação ligada, com o limite na linha`);
    if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`clube-surpresa-${w}.png`), fullPage: true });

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
      await page.getByRole('button', { name: 'Prêmio surpresa', exact: true }).click();
      await page.waitForSelector('text=Quando o cliente ganha', { timeout: 10000 });
      ok(
        !(await page.locator('[data-tela="clube"] [role="switch"]').count()) && !(await page.getByRole('button', { name: 'Mudar' }).count()) &&
          (await page.getByRole('button', { name: /Roleta de prêmios/ }).isDisabled()),
        `${w}px · gerente: o prêmio surpresa só para ver (sem chave, sem "Mudar", a forma travada)`,
      );
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

  // ───────────────────────── a página do pedido (/r/…): a raspadinha e a roleta ─────────────────────────
  const FATIAS = ['Frete grátis', 'R$ 5 off', '15% off até R$ 20', 'Batata grátis'];
  const REVELADO = { nome: '15% off até R$ 20', descricao: '15% de desconto, até R$ 20 · em pedido a partir de R$ 30 · vale 7 dias', codigo: 'CLUBE7K2QX', validoAte: '2026-11-27', usado: false, vencido: false };
  const REGRAS = ['Prêmio surpresa: todo pedido entregue pelo cardápio online ou pelo WhatsApp a partir de R$ 30 dá uma raspadinha com o prêmio "15% off até R$ 20".', 'Não há sorteio: todo mundo que cumpre a regra recebe, e não há limite de prêmios.'];
  async function abrirPagina(w, h, forma, o = {}) {
    const revelacoes = [];
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900, reducedMotion: o.semMovimento ? 'reduce' : 'no-preference' });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/rastreio/tk9') return responder(route, { numero: 1482, status: 'concluido', statusLabel: 'entregue', entregador: null, destino: null, parada: null, etaMin: null, codigoEntrega: null, rota: null });
      const fatias = forma === 'roleta' ? FATIAS : [];
      if (p === '/rastreio/tk9/premio/revelar' && req.method() === 'POST') {
        revelacoes.push(1);
        return responder(route, { tem: true, forma, revelado: true, fatias, premio: REVELADO, fatia: forma === 'roleta' ? 2 : null, regras: REGRAS });
      }
      if (p === '/rastreio/tk9/premio') return responder(route, { tem: true, forma, revelado: false, fatias, premio: null, fatia: null, regras: REGRAS });
      if (p === '/rastreio/tk9/avaliacao') return responder(route, { statusCode: 404, message: 'x' }, 404);
      return responder(route, {});
    });
    await page.goto(base + '/r/tk9');
    return { ctx, page, erros, revelacoes };
  }

  for (const w of larguras) {
    {
      // A raspadinha: "Revelar sem raspar" (o caminho do leitor de tela e do teclado).
      const { ctx, page, erros, revelacoes } = await abrirPagina(w, 900, 'raspadinha');
      await page.waitForSelector('text=Você ganhou uma raspadinha', { timeout: 30000 });
      let achados = await medir(page);
      const t0 = await texto(page, 'body');
      ok(achados.length === 0 && t0.includes('Seu prêmio já está garantido') && !t0.includes('CLUBE7K2QX'), `${w}px · raspadinha: o prêmio garantido, o código ainda escondido, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      await page.getByRole('button', { name: 'Revelar sem raspar' }).click();
      await page.waitForSelector('text=CLUBE7K2QX', { timeout: 10000 });
      achados = await medir(page);
      const t1 = await texto(page, 'body');
      ok(revelacoes.length === 1 && t1.includes('Vale até 27/11') && t1.includes('Só você usa'), `${w}px · revelado: o cupom, a validade e "Só você usa" (revelações: ${revelacoes.length})`);
      ok(achados.length === 0, `${w}px · cupom revelado: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      await page.getByText('Regras do clube').click();
      ok(await page.getByText('Não há sorteio', { exact: false }).isVisible(), `${w}px · as regras do clube abrem na página`);
      if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`clube-raspadinha-${w}.png`), fullPage: true });
      ok(erros.length === 0, `${w}px · raspadinha: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
      await ctx.close();
    }
    {
      // A roleta: gira e para na fatia do prêmio.
      const { ctx, page, erros, revelacoes } = await abrirPagina(w, 900, 'roleta');
      await page.waitForSelector('text=Gire para descobrir o seu prêmio', { timeout: 30000 });
      let achados = await medir(page);
      const rotulo = await page.getByRole('img', { name: /Roleta com 4 prêmios/ }).getAttribute('aria-label');
      ok(achados.length === 0 && !!rotulo, `${w}px · roleta: a roda com os prêmios da loja (${umaLinha(rotulo ?? '?')}), sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      await page.getByRole('button', { name: 'Girar' }).click();
      await page.waitForSelector('text=CLUBE7K2QX', { timeout: 15000 });
      const giro = await page.evaluate(() => getComputedStyle(document.querySelector('svg[role="img"]')).transform);
      achados = await medir(page);
      ok(revelacoes.length === 1 && giro !== 'none', `${w}px · girou e parou no prêmio (revelações: ${revelacoes.length})`);
      ok(achados.length === 0, `${w}px · roleta revelada: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`clube-roleta-${w}.png`), fullPage: true });
      ok(erros.length === 0, `${w}px · roleta: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
      await ctx.close();
    }
  }

  for (const w of [390, 1366]) {
    {
      // Raspando com o mouse: metade raspada revela.
      const { ctx, page, revelacoes } = await abrirPagina(w, 900, 'raspadinha');
      await page.waitForSelector('text=Você ganhou uma raspadinha', { timeout: 30000 });
      const caixa = await page.locator('canvas').boundingBox();
      await page.mouse.move(caixa.x + 4, caixa.y + 4);
      await page.mouse.down();
      for (let y = 6; y < caixa.height; y += 22)
        for (let x = 4; x < caixa.width; x += 14) await page.mouse.move(caixa.x + (Math.floor(y / 22) % 2 ? caixa.width - x : x), caixa.y + y);
      await page.mouse.up();
      await page.waitForSelector('text=CLUBE7K2QX', { timeout: 10000 });
      ok(revelacoes.length === 1 && !(await page.locator('canvas').count()), `${w}px · raspar com o mouse revela (revelações: ${revelacoes.length})`);
      await ctx.close();
    }
    {
      // "Reduzir movimento": a roleta para no prêmio sem animar.
      const { ctx, page } = await abrirPagina(w, 900, 'roleta', { semMovimento: true });
      await page.waitForSelector('text=Gire para descobrir o seu prêmio', { timeout: 30000 });
      await page.getByRole('button', { name: 'Girar' }).click();
      await page.waitForSelector('text=CLUBE7K2QX', { timeout: 5000 });
      const transicao = await page.evaluate(() => getComputedStyle(document.querySelector('svg[role="img"]')).transitionDuration);
      ok(transicao === '0s', `${w}px · reduzir movimento: a roleta para sem animar (${transicao})`);
      await ctx.close();
    }
  }

  // ───────────────────────── o link pessoal (/p/…): o prêmio de desculpas ─────────────────────────
  const CODIGO = 'Kq3xT9wLmN2pR7sV4yZ8bA';
  async function abrirLink(w, h, o = {}) {
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      const extra = { loja: 'Lanchonete da Praça', cardapio: 'https://app.exemplo/c/tk-cardapio' };
      if (o.naoAcha) return responder(route, { statusCode: 404, message: 'Prêmio não encontrado.' }, 404);
      if (p === `/clube/premio/${CODIGO}/revelar` && req.method() === 'POST')
        return responder(route, { tem: true, forma: 'raspadinha', revelado: true, fatias: [], premio: REVELADO, fatia: null, regras: REGRAS, ...extra });
      if (p === `/clube/premio/${CODIGO}`) return responder(route, { tem: true, forma: 'raspadinha', revelado: false, fatias: [], premio: null, fatia: null, regras: REGRAS, ...extra });
      return responder(route, {});
    });
    await page.goto(base + `/p/${o.naoAcha ? 'outro-codigo-qualquer' : CODIGO}`);
    return { ctx, page, erros };
  }

  for (const w of larguras) {
    const { ctx, page, erros } = await abrirLink(w, 900);
    await page.waitForSelector('text=Você ganhou uma raspadinha', { timeout: 30000 });
    let achados = await medir(page);
    ok(achados.length === 0 && (await texto(page, 'body')).includes('Um prêmio para você'), `${w}px · link pessoal: a raspadinha, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    await page.getByRole('button', { name: 'Revelar sem raspar' }).click();
    await page.waitForSelector('text=CLUBE7K2QX', { timeout: 10000 });
    const cardapio = await page.locator('a:has-text("Abrir o cardápio")').getAttribute('href');
    achados = await medir(page);
    ok(cardapio === 'https://app.exemplo/c/tk-cardapio' && achados.length === 0, `${w}px · link pessoal revelado: o cupom e "Abrir o cardápio" da loja, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`clube-link-${w}.png`), fullPage: true });
    ok(erros.length === 0, `${w}px · link pessoal: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    await ctx.close();
  }
  for (const w of [390, 1366]) {
    const { ctx, page } = await abrirLink(w, 900, { naoAcha: true });
    await page.waitForSelector('text=Não achamos este prêmio.', { timeout: 30000 });
    const achados = await medir(page);
    ok(achados.length === 0, `${w}px · link que não existe: "Não achamos este prêmio.", sem barra para o lado`);
    await ctx.close();
  }
}
