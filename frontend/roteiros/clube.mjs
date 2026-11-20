// Roteiro de tela do CLUBE DE RECOMPRA — a base e o prêmio surpresa (fases A0 e A1 do `docs/plano-clube-e-banner.md`;
// protótipo `mockups/regem-clube-banner.html`, aprovado pelo dono em 20/11/2026; migs 471 e 474). A API simulada.
// Confere, em cada largura (V45: nenhuma barra de rolagem para o lado — a página e qualquer peça —, com cada gaveta e
// diálogo ABERTO e medido na frente):
//  • Delivery › Marketing › aba Clube › Visão geral: as três ferramentas com a chave (o prêmio surpresa, o álbum e a meta),
//    as regras que valem para as três, mudar o pedido
//    mínimo mostra a barra de alterações e "Salvar alterações" manda SÓ o que mudou; "Ver as regras" abre o diálogo;
//  • Prêmio surpresa: a forma (raspadinha × roleta) manda só a forma; a chave do "Pedido entregue" sem prêmio abre a gaveta,
//    que não oferece o produto grátis; "Ligar com este prêmio" manda o gatilho; os gatilhos das próximas fases e os travados;
//    a chave da reclamação sem prêmios abre a gaveta dela (caixas sem o produto grátis, o limite, quem manda — A1b);
//  • a página do pedido (`/r/…`): a raspadinha ("Revelar sem raspar" e raspando com o mouse) e a roleta (gira e para no
//    prêmio; sem animação com "reduzir movimento"), o cupom revelado e as regras do clube;
//  • o link pessoal (`/p/…`, o prêmio de desculpas — A1b): revelar, o cupom e "Abrir o cardápio"; o link que não existe;
//  • o álbum de selos (A2, mig 479): Marketing › Clube › Álbum (selos, validade, os prêmios em gaveta sem o produto grátis,
//    salvar manda só o que mudou), o selo na página do pedido e Sua conta › Benefícios (os selos, "Peça em …", completo →
//    escolher o prêmio, que manda o prêmio e o álbum recomeça);
//  • a meta do mês (A3): Marketing › Clube › Meta (os níveis com os prêmios em gaveta, pôr e tirar o nível 3, a validade),
//    a barra na página do pedido e Sua conta › Benefícios (a barra, o que falta, os prêmios; batida, escolher manda o mês,
//    o nível e o prêmio; o mês anterior até o dia 7);
//  • Prêmios: a lista com a contagem, a situação "Em uso" que filtra, "＋ Novo prêmio" abre a gaveta, "Produto grátis" lê
//    os produtos, o diálogo de excluir (o prêmio em uso diz onde está);
//  • o gerente vê e não muda (sem "＋ Novo prêmio", sem campo do mínimo); a nuvem não respondeu → "Tentar de novo".
import { responder, tokenFalso, umaLinha } from './comum.mjs';
import { MENU, TOKEN as TOKEN_CARDAPIO } from './cardapio-para-voce.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', nome: 'Ana' });
const GERENTE = tokenFalso({ cat: 'gerente', perfil: 'gerente', nome: 'Bruno' });
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const P3 = '33333333-3333-4333-8333-333333333333';

const premio = (id, nome, tipo, descricao, emUso, extra = {}) => ({
  id, nome, tipo, valor: 0, teto: null, produtoId: null, produtoNome: null, minimo: 0, validadeDias: 7, descricao, emUso, ...extra,
});
const R_PADRAO = { ativo: false, premios: [], limite: 'mes1', quem: 'gerencia' };
const C_PADRAO = { ativo: false, segmentos: [], premioId: null, periodoDias: 60 };
const PAINEL = (minimo = 30, forma = 'raspadinha', entregue = { ativo: false, premioId: null, desde: null }, reclamacao = R_PADRAO, classificacao = C_PADRAO, campanhaG = { ativo: false }) => ({
  config: {
    surpresaAtivo: true, surpresaForma: forma, albumAtivo: false, albumSelos: 4, albumValidadeMeses: 12, albumPremios: [P2],
    metaAtivo: false, metaNiveis: [{ pedidos: 3, premios: [] }, { pedidos: 6, premios: [] }], metaValidadeDias: 15, minimo,
  },
  prontas: { surpresa: true, album: true, meta: true },
  gatilhos: { entregue, reclamacao, classificacao, campanha: campanhaG },
  classificacao: { perfilLigado: true, contagens: { campeoes: 112, leais: 240, atencao: 96, em_risco: 151, inativos: 388, atrasado: 74 } },
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
    validadesDoPremio: [3, 7, 15, 30], minimoMax: 1000, nomeMax: 60, premiosMax: 50, premiosPorEscolhaMax: 6, validadesDoSelo: [6, 12], validadesDaMeta: [15, 30], niveisMax: 3,
    limitesDaReclamacao: [{ valor: 'mes1', rotulo: '1 por mês' }, { valor: 'mes2', rotulo: '2 por mês' }, { valor: 'tri1', rotulo: '1 a cada 3 meses' }],
    quemMandaDesculpas: [{ valor: 'gerencia', rotulo: 'Gerente e supervisão' }, { valor: 'gerente', rotulo: 'Só o gerente' }, { valor: 'atendimento', rotulo: 'Qualquer pessoa do atendimento' }],
    segmentosDaClassificacao: [{ valor: 'campeoes', rotulo: 'Campeões' }, { valor: 'leais', rotulo: 'Leais' }, { valor: 'atencao', rotulo: 'Precisam de atenção' }, { valor: 'em_risco', rotulo: 'Em risco' }, { valor: 'inativos', rotulo: 'Inativos' }, { valor: 'atrasado', rotulo: 'Atrasados no próprio ritmo' }],
    periodosDaClassificacao: [30, 60, 90],
  },
});

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.hs')) continue; // no cardápio, as fileiras que deslizam de propósito (abas, carrosséis)
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
    let classificacao = C_PADRAO;
    let campanhaG = { ativo: false };
    let album = null;
    let meta = null;
    const painel = () => {
      const p = PAINEL(minimo, forma, entregue, reclamacao, classificacao, campanhaG);
      if (album) p.config = { ...p.config, albumSelos: album.selos, albumPremios: album.premios };
      if (meta) p.config = { ...p.config, ...meta };
      return p;
    };
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
        if (typeof corpo.albumSelos === 'number' || Array.isArray(corpo.albumPremios)) {
          const p = painel();
          album = { selos: corpo.albumSelos ?? album?.selos ?? p.config.albumSelos, premios: corpo.albumPremios ?? album?.premios ?? p.config.albumPremios };
        }
        if (Array.isArray(corpo.metaNiveis) || typeof corpo.metaValidadeDias === 'number') {
          const p = painel();
          meta = { metaNiveis: corpo.metaNiveis ?? p.config.metaNiveis, metaValidadeDias: corpo.metaValidadeDias ?? p.config.metaValidadeDias };
        }
        return responder(route, painel());
      }
      if (p === '/marketing/clube/gatilhos/campanha' && metodo === 'PUT') {
        const corpo = JSON.parse(route.request().postData() || '{}');
        enviados.push({ campanha: corpo });
        campanhaG = { ...campanhaG, ...corpo };
        return responder(route, painel());
      }
      if (p === '/marketing/clube/gatilhos/classificacao' && metodo === 'PUT') {
        const corpo = JSON.parse(route.request().postData() || '{}');
        enviados.push({ classificacao: corpo });
        classificacao = { ...classificacao, ...corpo };
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
      (t.match(/Chega numa próxima entrega/g) ?? []).length === 0 && (await page.locator('main [role="switch"]').count()) === 3 &&
        (await page.getByRole('switch', { name: 'Prêmio surpresa' }).count()) === 1 && (await page.getByRole('switch', { name: 'Álbum de selos' }).count()) === 1 &&
        (await page.getByRole('switch', { name: 'Meta do mês' }).count()) === 1,
      `${w}px · as três ferramentas com a chave (o prêmio surpresa, o álbum e a meta)`,
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
      (t.match(/Chega numa próxima entrega/g) ?? []).length === 0 && t.includes('não recomendado') && t.includes('sorteio · precisa de autorização'),
      `${w}px · os quatro gatilhos com chave; avaliação não recomendada; aleatório travado`,
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
    // A classificação: a chave sem segmento abre a gaveta; os 6 segmentos com a contagem, o período e o prêmio (A1c).
    await page.getByRole('switch', { name: 'Pela classificação do marketing' }).click();
    await dialogo(page);
    achados = await medir(page);
    const tc = await texto(page, '[role="dialog"]');
    ok(achados.length === 0, `${w}px · gaveta da classificação aberta: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok(
      (await page.locator('[role="dialog"] input[type="checkbox"]').count()) === 6 && tc.includes('Inativos · 388 clientes') && tc.includes('1 vez a cada 60 dias'),
      `${w}px · a gaveta da classificação: os 6 segmentos com a contagem e o período`,
    );
    if (w === 390 || w === 1440) await page.locator('[role="dialog"]').screenshot({ path: arquivoFoto(`clube-classificacao-${w}.png`) });
    await page.getByRole('button', { name: 'Ligar', exact: true }).click();
    ok(await page.getByText('Escolha ao menos um segmento.').isVisible(), `${w}px · ligar sem segmento avisa`);
    await page.getByLabel(/^Inativos/).check();
    await page.getByLabel('Prêmio', { exact: true }).selectOption(P3);
    await page.getByRole('button', { name: 'Ligar', exact: true }).click();
    await fechou(page);
    const ultimoC = enviados[enviados.length - 1];
    ok(
      JSON.stringify(ultimoC) === JSON.stringify({ classificacao: { ativo: true, segmentos: ['inativos'], premioId: P3, periodoDias: 60 } }),
      `${w}px · ligar a classificação manda os segmentos, o prêmio e o período (${umaLinha(JSON.stringify(ultimoC))})`,
    );
    t = await texto(page);
    ok(t.includes('Segmentos: Inativos') && (await page.getByRole('switch', { name: 'Pela classificação do marketing' }).getAttribute('aria-checked')) === 'true', `${w}px · classificação ligada, com o segmento na linha`);
    // A campanha (A1d): a chave liga direto e manda só o liga/desliga.
    await page.getByRole('switch', { name: 'Em disparo (campanha)' }).click();
    await page.waitForFunction(() => document.querySelector('[role="switch"][aria-label="Em disparo (campanha)"]')?.getAttribute('aria-checked') === 'true', null, { timeout: 5000 });
    const ultimoCa = enviados[enviados.length - 1];
    ok(JSON.stringify(ultimoCa) === JSON.stringify({ campanha: { ativo: true } }), `${w}px · ligar a campanha manda só o liga/desliga (${umaLinha(JSON.stringify(ultimoCa))})`);
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · os quatro gatilhos ligados: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`clube-surpresa-${w}.png`), fullPage: true });

    // ── Álbum de selos (A2): quantos selos, a validade, os prêmios em gaveta (sem o produto grátis), a arte automática ──
    enviados.length = 0;
    await page.getByRole('button', { name: 'Álbum de selos', exact: true }).click();
    await page.waitForSelector('text=Selos para completar o álbum', { timeout: 10000 });
    t = await texto(page);
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · Álbum de selos: sem barra para o lado nem texto esmagado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok(t.includes('Validade de cada selo') && t.includes('automática') && t.includes('Desligado: liga em Visão geral'), `${w}px · o álbum: selos, validade, a arte automática e onde ligar`);
    await page.getByRole('button', { name: 'Escolher os prêmios' }).click();
    await dialogo(page);
    achados = await medir(page);
    const ta = await texto(page, '[role="dialog"]');
    ok(achados.length === 0, `${w}px · gaveta dos prêmios do álbum aberta: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok((await page.locator('[role="dialog"] input[type="checkbox"]').count()) === 2 && !ta.includes('Batata'), `${w}px · a gaveta do álbum: 2 prêmios, sem o produto grátis`);
    if (w === 390 || w === 1440) await page.locator('[role="dialog"]').screenshot({ path: arquivoFoto(`clube-album-premios-${w}.png`) });
    await page.getByLabel(/^15% off até R\$ 20/).check();
    await page.getByRole('button', { name: 'Usar estes prêmios' }).click();
    await fechou(page);
    await page.getByLabel('Selos para completar o álbum').selectOption('6');
    await page.waitForSelector('text=2 alterações ainda não salvas', { timeout: 5000 });
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · álbum com a barra de alterações: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await page.waitForSelector('text=2 alterações ainda não salvas', { state: 'detached', timeout: 5000 });
    ok(JSON.stringify(enviados[0]) === JSON.stringify({ albumSelos: 6, albumPremios: [P1] }), `${w}px · salvar o álbum manda só o que mudou (${umaLinha(JSON.stringify(enviados[0]))})`);
    if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`clube-album-${w}.png`), fullPage: true });

    // ── Meta do mês (A3): os níveis (pedidos e prêmios em gaveta), pôr e tirar o nível 3, a validade ──
    enviados.length = 0;
    await page.getByRole('button', { name: 'Meta do mês', exact: true }).click();
    await page.waitForSelector('text=Nível 1 · pedidos no mês', { timeout: 10000 });
    t = await texto(page);
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · Meta do mês: sem barra para o lado nem texto esmagado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok(t.includes('Nível 2 · pedidos no mês') && t.includes('Validade do prêmio') && t.includes('Desligada: liga em Visão geral'), `${w}px · a meta: os dois níveis, a validade e onde ligar`);
    // Nível 1: os prêmios em gaveta (sem o produto grátis)
    await page.getByRole('button', { name: 'Escolher os prêmios' }).first().click();
    await dialogo(page);
    achados = await medir(page);
    const tm = await texto(page, '[role="dialog"]');
    ok(achados.length === 0 && (await page.locator('[role="dialog"] input[type="checkbox"]').count()) === 2 && !tm.includes('Batata') && tm.includes('Prêmios do nível 1 da meta'), `${w}px · gaveta do nível 1: 2 prêmios, sem o produto grátis, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    if (w === 390 || w === 1440) await page.locator('[role="dialog"]').screenshot({ path: arquivoFoto(`clube-meta-premios-${w}.png`) });
    await page.getByLabel(/^15% off até R\$ 20/).check();
    await page.getByRole('button', { name: 'Usar estes prêmios' }).click();
    await fechou(page);
    // Nível 2: frete grátis
    await page.getByRole('button', { name: 'Escolher os prêmios' }).first().click();
    await dialogo(page);
    await page.getByLabel(/^Frete grátis/).check();
    await page.getByRole('button', { name: 'Usar estes prêmios' }).click();
    await fechou(page);
    // Pôr o nível 3 (começa 3 pedidos acima do 2º), mudar o 1º para 4 pedidos e a validade para 30 dias
    await page.getByRole('button', { name: '＋ Pôr o nível 3' }).click();
    await page.waitForSelector('text=Nível 3 · pedidos no mês', { timeout: 5000 });
    await page.getByLabel('Nível 1 · pedidos no mês').fill('4');
    await page.getByLabel('Validade do prêmio').selectOption('30');
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · meta com o nível 3 e a barra de alterações: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`clube-meta-${w}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await page.waitForFunction(() => !document.body.innerText.includes('ainda não salva'), null, { timeout: 5000 });
    ok(
      JSON.stringify(enviados[0]) ===
        JSON.stringify({ metaNiveis: [{ pedidos: 4, premios: [P1] }, { pedidos: 6, premios: [P3] }, { pedidos: 9, premios: [] }], metaValidadeDias: 30 }),
      `${w}px · salvar a meta manda os níveis e a validade (${umaLinha(JSON.stringify(enviados[0]))})`,
    );
    // Tirar o nível 3: manda os dois que ficam
    await page.getByRole('button', { name: 'Tirar o nível 3' }).click();
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await page.waitForFunction(() => !document.body.innerText.includes('ainda não salva'), null, { timeout: 5000 });
    ok(
      JSON.stringify(enviados[1]) === JSON.stringify({ metaNiveis: [{ pedidos: 4, premios: [P1] }, { pedidos: 6, premios: [P3] }] }),
      `${w}px · tirar o nível 3 manda os dois níveis que ficam (${umaLinha(JSON.stringify(enviados[1]))})`,
    );
    ok(await page.getByRole('button', { name: '＋ Pôr o nível 3' }).isVisible(), `${w}px · sem o nível 3, volta o "＋ Pôr o nível 3"`);

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
      if (p === '/rastreio/tk9/selo') return responder(route, { tem: true, mes: 'novembro', arte: '🍔', selos: 3, total: 4, completo: false });
      if (p === '/rastreio/tk9/meta') return responder(route, { tem: true, mesNome: 'novembro', pedidos: 2, proximo: { nivel: 1, pedidos: 3, falta: 1 }, pendente: false, niveis: [3, 6] });
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
      await page.waitForSelector('text=Você ganhou o selo de novembro', { timeout: 10000 });
      let achados = await medir(page);
      const t0 = await texto(page, 'body');
      ok(achados.length === 0 && t0.includes('Seu prêmio já está garantido') && !t0.includes('CLUBE7K2QX'), `${w}px · raspadinha: o prêmio garantido, o código ainda escondido, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      ok(t0.includes('3 de 4 selos no álbum'), `${w}px · o selo do álbum na página do pedido: "Você ganhou o selo de novembro", 3 de 4`);
      await page.waitForSelector('text=Meta de novembro', { timeout: 10000 });
      ok((await texto(page, 'body')).includes('2 pedidos de 3 para o primeiro prêmio.') && (await medir(page)).length === 0, `${w}px · a meta na página do pedido: "2 pedidos de 3 para o primeiro prêmio", sem barra para o lado`);
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

  // ───────────────────────── Sua conta › Benefícios: o álbum de selos (A2) ─────────────────────────
  const SELOS = [
    { mes: '2026-09', rotulo: 'Set', arte: '🍁' },
    { mes: '2026-10', rotulo: 'Out', arte: '🎃' },
    { mes: '2026-11', rotulo: 'Nov', arte: '🍔' },
  ];
  const ALBUM_FALTA_UM = { ativo: true, selos: SELOS, tem: 3, total: 4, completo: false, validadeMeses: 12, premios: [] };
  const ALBUM_COMPLETO = {
    ...ALBUM_FALTA_UM,
    selos: [{ mes: '2026-08', rotulo: 'Ago', arte: '🌻' }, ...SELOS],
    tem: 4,
    completo: true,
    premios: [
      { id: P1, nome: '15% off até R$ 20', descricao: '15% de desconto, até R$ 20 · em pedido a partir de R$ 30 · vale 7 dias' },
      { id: P3, nome: 'Frete grátis', descricao: 'entrega grátis · vale 15 dias' },
    ],
  };
  const ALBUM_RECOMECOU = { ativo: true, selos: [], tem: 0, total: 4, completo: false, validadeMeses: 12, premios: [] };
  // A meta do mês (A3): os prêmios de cada nível, o mês em andamento e o que bateu (o atual e o anterior, até o dia 7).
  const PREMIOS_N1 = [
    { id: P1, nome: '15% off até R$ 20', descricao: '15% de desconto, até R$ 20 · em pedido a partir de R$ 30' },
    { id: P3, nome: 'Frete grátis', descricao: 'entrega grátis' },
  ];
  const PREMIOS_N2 = [{ id: P2, nome: '30% off até R$ 30', descricao: '30% de desconto, até R$ 30' }];
  const nivel = (n, pedidos, feitos, escolhido = false) => ({
    nivel: n, pedidos, falta: Math.max(0, pedidos - feitos), atingido: feitos >= pedidos, escolhido, premios: n === 1 ? PREMIOS_N1 : PREMIOS_N2,
  });
  const mesDaMeta = (mes, mesNome, feitos, escolhidos = []) => {
    const niveis = [nivel(1, 3, feitos, escolhidos.includes(1)), nivel(2, 6, feitos, escolhidos.includes(2))];
    const prox = niveis.find((n) => !n.atingido);
    return { mes, mesNome, pedidos: feitos, niveis, proximo: prox ? { nivel: prox.nivel, pedidos: prox.pedidos, falta: prox.falta } : null, pendente: niveis.some((n) => n.atingido && !n.escolhido) };
  };
  const META_ANDANDO = { ativo: true, validadeDias: 15, atual: mesDaMeta('2026-11', 'novembro', 2), anterior: null };
  const META_BATEU = { ativo: true, validadeDias: 15, atual: mesDaMeta('2026-11', 'novembro', 3), anterior: mesDaMeta('2026-10', 'outubro', 4) };
  const escolheuNaMeta = (m, mes, n) => {
    const marca = (x) => (x && x.mes === mes ? mesDaMeta(x.mes, x.mesNome, x.pedidos, [...x.niveis.filter((y) => y.escolhido).map((y) => y.nivel), n]) : x);
    const anterior = marca(m.anterior);
    return { ...m, atual: marca(m.atual), anterior: anterior?.pendente ? anterior : null };
  };
  async function abrirConta(w, album, meta = { ativo: false }) {
    const escolhas = [];
    let atual = album;
    let metaAtual = meta;
    const ctx = await nav.newContext({ viewport: { width: w, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((t) => localStorage.setItem(`regem_loja_clientetoken_${t}`, 'ct-falso-do-roteiro'), TOKEN_CARDAPIO);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      const raiz = `/publico/cardapio/${TOKEN_CARDAPIO}`;
      if (p === raiz) return responder(route, MENU);
      if (p === `${raiz}/cliente`)
        return responder(route, { nome: 'Ana Souza', telefone: '21900000000', cliente: { nome: 'Ana Souza', telefone: '21900000000' }, enderecos: [], historico: [] });
      if (p === `${raiz}/cliente/presentes`) return responder(route, { presentes: [], paraRevelar: [], album: atual, meta: metaAtual });
      if (p === `${raiz}/cliente/clube/meta` && req.method() === 'POST') {
        const corpo = JSON.parse(req.postData() || '{}');
        escolhas.push(corpo);
        metaAtual = escolheuNaMeta(metaAtual, corpo.mes, corpo.nivel);
        return responder(route, { premio: 'Frete grátis', codigo: 'CLUBEMT34K', validoAte: '2026-12-05' });
      }
      if (p === `${raiz}/cliente/clube/album` && req.method() === 'POST') {
        escolhas.push(JSON.parse(req.postData() || '{}'));
        atual = ALBUM_RECOMECOU;
        return responder(route, { premio: '15% off até R$ 20', codigo: 'CLUBEAB12C', validoAte: '2026-12-05' });
      }
      if (p === `${raiz}/promos`) return responder(route, { cupons: [], fidelidadeAtiva: false });
      if (req.method() === 'POST') return responder(route, { ok: true });
      return responder(route, {});
    });
    await page.goto(`${base}/c/${TOKEN_CARDAPIO}?tema=fluxo&conta=beneficios`);
    return { ctx, page, erros, escolhas };
  }

  for (const w of larguras) {
    {
      // Falta um selo: os selos do álbum, o que falta e "Peça em <mês> e escolha um prêmio".
      const { ctx, page, erros } = await abrirConta(w, ALBUM_FALTA_UM);
      try {
        await page.waitForSelector('text=Álbum de selos · 3 de 4', { timeout: 30000 });
        const achados = await medir(page);
        const t = await texto(page, '[role="dialog"][aria-label="Sua conta"]');
        const selos = await page.locator('.c-album [role="listitem"]').count();
        ok(achados.length === 0, `${w}px · Sua conta › álbum: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
        ok(selos === 4 && /Peça em \S+ e escolha um prêmio\. Seus selos valem 12 meses\./.test(t), `${w}px · o álbum: 4 selos (3 + o que falta) e "Peça em … e escolha um prêmio" (${umaLinha(t.match(/Peça em.{0,60}|Faltam.{0,60}/)?.[0] ?? '?')})`);
        if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`clube-conta-album-${w}.png`), fullPage: true });
        ok(erros.length === 0, `${w}px · Sua conta › álbum: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
      } catch (e) {
        ok(false, `${w}px · Sua conta › álbum abriu (${umaLinha(String(e?.message ?? e))})`);
        await page.screenshot({ path: arquivoFoto(`clube-conta-album-${w}-erro.png`) }).catch(() => {});
      } finally {
        await ctx.close();
      }
    }
    {
      // Completo: escolher o prêmio manda o prêmio e o token do cliente; o álbum recomeça.
      const { ctx, page, erros, escolhas } = await abrirConta(w, ALBUM_COMPLETO);
      try {
        await page.waitForSelector('text=Você completou o álbum!', { timeout: 30000 });
        let achados = await medir(page);
        ok(achados.length === 0 && (await page.getByRole('button', { name: 'Quero este' }).isDisabled()), `${w}px · álbum completo: os prêmios, "Quero este" só depois de escolher, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
        await page.getByRole('button', { name: /^15% off até R\$ 20/ }).click();
        ok((await page.getByRole('button', { name: /^15% off até R\$ 20/ }).getAttribute('aria-pressed')) === 'true', `${w}px · o prêmio escolhido fica marcado`);
        if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`clube-conta-album-completo-${w}.png`), fullPage: true });
        await page.getByRole('button', { name: 'Quero este' }).click();
        await page.waitForSelector('text=Álbum de selos · 0 de 4', { timeout: 10000 });
        achados = await medir(page);
        ok(
          JSON.stringify(escolhas[0]) === JSON.stringify({ clienteToken: 'ct-falso-do-roteiro', premioId: P1 }) && achados.length === 0,
          `${w}px · "Quero este" manda o prêmio e o álbum recomeça (${umaLinha(JSON.stringify(escolhas[0] ?? null))})`,
        );
        ok(erros.length === 0, `${w}px · álbum completo: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
      } catch (e) {
        ok(false, `${w}px · Sua conta › álbum completo (${umaLinha(String(e?.message ?? e))})`);
        await page.screenshot({ path: arquivoFoto(`clube-conta-completo-${w}-erro.png`) }).catch(() => {});
      } finally {
        await ctx.close();
      }
    }
    {
      // A meta andando: a barra, quantos faltam para cada nível e os prêmios da meta (A3).
      const { ctx, page, erros } = await abrirConta(w, { ativo: false }, META_ANDANDO);
      try {
        await page.waitForSelector('text=Meta de novembro', { timeout: 30000 });
        const achados = await medir(page);
        const t = await texto(page, '[role="dialog"][aria-label="Sua conta"]');
        const barra = await page.getByRole('img', { name: '2 de 6 pedidos' }).count();
        ok(achados.length === 0, `${w}px · Sua conta › meta: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
        ok(
          barra === 1 && t.includes('2 pedidos de 3 para o primeiro prêmio') && t.includes('falta 1') && t.includes('faltam 4') && !(await page.getByRole('button', { name: 'Quero este' }).count()),
          `${w}px · a meta: a barra, "2 pedidos de 3 para o primeiro prêmio", o que falta em cada nível e nada para escolher ainda`,
        );
        await page.getByText('Ver os prêmios da meta').click();
        ok((await texto(page, '.c-meta-premios')).includes('6 pedidos: 30% off até R$ 30'), `${w}px · "Ver os prêmios da meta" mostra a lista de cada nível`);
        if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`clube-conta-meta-${w}.png`), fullPage: true });
        ok(erros.length === 0, `${w}px · Sua conta › meta: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
      } catch (e) {
        ok(false, `${w}px · Sua conta › meta abriu (${umaLinha(String(e?.message ?? e))})`);
        await page.screenshot({ path: arquivoFoto(`clube-conta-meta-${w}-erro.png`) }).catch(() => {});
      } finally {
        await ctx.close();
      }
    }
    {
      // Bateu: o mês anterior (até o dia 7) e o atual com o prêmio para escolher; escolher manda o mês, o nível e o prêmio.
      const { ctx, page, erros, escolhas } = await abrirConta(w, { ativo: false }, META_BATEU);
      try {
        await page.waitForSelector('text=Meta de outubro · você conseguiu!', { timeout: 30000 });
        let achados = await medir(page);
        ok(achados.length === 0 && (await page.getByRole('button', { name: 'Quero este' }).count()) === 2, `${w}px · bateu: o prêmio de outubro e o de novembro para escolher, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
        if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`clube-conta-meta-bateu-${w}.png`), fullPage: true });
        const novembro = page.locator('.c-sec', { hasText: 'Meta de novembro' });
        await novembro.getByRole('button', { name: /^Frete grátis/ }).click();
        await novembro.getByRole('button', { name: 'Quero este' }).click();
        await page.waitForSelector('text=✓ escolhido', { timeout: 10000 });
        achados = await medir(page);
        ok(
          JSON.stringify(escolhas[0]) === JSON.stringify({ clienteToken: 'ct-falso-do-roteiro', mes: '2026-11', nivel: 1, premioId: P3 }) && achados.length === 0,
          `${w}px · "Quero este" na meta manda o mês, o nível e o prêmio (${umaLinha(JSON.stringify(escolhas[0] ?? null))})`,
        );
        ok((await page.getByRole('button', { name: 'Quero este' }).count()) === 1, `${w}px · escolhido o de novembro, fica só o de outubro para escolher`);
        ok(erros.length === 0, `${w}px · meta batida: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
      } catch (e) {
        ok(false, `${w}px · Sua conta › meta batida (${umaLinha(String(e?.message ?? e))})`);
        await page.screenshot({ path: arquivoFoto(`clube-conta-meta-bateu-${w}-erro.png`) }).catch(() => {});
      } finally {
        await ctx.close();
      }
    }
  }
}
