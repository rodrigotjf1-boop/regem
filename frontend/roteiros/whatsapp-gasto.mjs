// Roteiro de tela de WHATSAPP › USO E GASTO (G1 do protótipo `mockups/regem-whatsapp-gasto.html`, aprovado pelo dono em
// 18/11/2026; mig 445). A API simulada. Confere:
//  • em cada largura: nenhuma barra de rolagem para o lado (a página e qualquer peça), o gasto do mês, os tipos, o gráfico
//    por dia com o número escrito, "De onde veio" e os meses anteriores;
//  • os estados: a Meta não respondeu (a faixa e o "Tentar de novo", que lê de novo), a primeira leitura, a conexão por
//    QR Code, nenhum gasto no período;
//  • o período (Últimos 3 meses vira "Gasto por mês"; "Outro período" mostra as duas datas) e o filtro do número (vai na
//    consulta);
//  • o gerente vê que a tela é do presidente (o servidor barra de verdade).
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', nome: 'Ana' });
const GERENTE = tokenFalso({ cat: 'gerente', perfil: 'gerente', nome: 'Carlos' });

const VALORES = [3.1, 3.85, 2.4, 2.75, 3.2, 4.6, 5.1, 3.05, 2.9, 3.3, 3.65, 4.2, 4.95, 137.8, 5.4, 4.35, 4.9, 5.93];
const dia = (i) => `2026-11-${String(i + 1).padStart(2, '0')}`;
const BASE = () => ({
  oficial: true,
  periodo: { tipo: 'mes', de: '2026-11-01', ate: '2026-11-18', mesCorrente: true },
  leitura: { lidoEm: new Date(Date.now() - 12 * 60000).toISOString(), algumaLida: true, tentouEm: new Date(Date.now() - 12 * 60000).toISOString(), erro: null, moeda: 'BRL', minutos: 30 },
  total: { custo: 205.43, mensagens: 2790, cobradas: 1790 },
  projecao: 344.4,
  tipos: [
    { grupo: 'marketing', mensagens: 498, cobradas: 498, gratis: 0, custo: 160.21 },
    { grupo: 'utilidade', mensagens: 1092, cobradas: 1092, gratis: 0, custo: 38.22 },
    { grupo: 'atendimento', mensagens: 1200, cobradas: 200, gratis: 1000, custo: 7 },
    { grupo: 'autenticacao', mensagens: 0, cobradas: 0, gratis: 0, custo: 0 },
  ],
  dias: VALORES.map((v, i) => ({ dia: dia(i), custo: v, marketing: i === 13 ? 132.54 : 1.5 })),
  franquia: [
    { numero: '552199992210', usadas: 1200, limite: 1000, papel: 'principal', final: '2210' },
    { numero: '552199997731', usadas: 12, limite: 1000, papel: 'marketing', final: '7731' },
  ],
  numeros: [
    { numero: '5521999997731', papel: 'marketing', final: '7731' },
    { numero: '5521999992210', papel: 'principal', final: '2210' },
  ],
  filtroNumero: null,
  meses: [
    { mes: '2026-10', custo: 96.3, cobradas: 1410, mensagens: 2100 },
    { mes: '2026-09', custo: 41.1, cobradas: 690, mensagens: 1500 },
    { mes: '2026-08', custo: 29.85, cobradas: 512, mensagens: 900 },
  ],
  deOndeVeio: [
    { nome: 'Sexta do burger com o nome bem comprido para ver a quebra', apoio: 'campanha de 14/11', grupo: 'marketing', mensagens: 412, custo: 132.54 },
    { nome: 'Cashback vencendo', apoio: 'modelo', grupo: 'marketing', mensagens: 86, custo: 27.67 },
    { nome: 'Pedido saiu para entrega', apoio: 'aviso do pedido', grupo: 'utilidade', mensagens: 640, custo: 22.4 },
    { nome: 'Pedido confirmado', apoio: 'aviso do pedido', grupo: 'utilidade', mensagens: 452, custo: 15.82 },
    { nome: 'Respostas do robô e da equipe', apoio: '1000 grátis · 200 cobradas', grupo: 'atendimento', mensagens: 1200, custo: 7 },
  ],
  // G2: os alertas de gasto do mês pelo Mister (100 e 200 passaram; 400 ainda não) e a franquia.
  alertas: {
    mes: '2026-11',
    custoDoMes: 205.43,
    gasto: {
      ligado: true,
      destinos: ['presidente'],
      valores: [
        { valor: 100, passouEm: '2026-11-14T21:12:00.000Z' },
        { valor: 200, passouEm: '2026-11-18T23:05:00.000Z' },
        { valor: 400, passouEm: null },
      ],
    },
    franquia: { ligado: true, destinos: ['presidente'], numeros: [{ final: '2210', passouEm: '2026-11-14T00:40:00.000Z' }] },
  },
});
const CENARIOS = {
  tudo: BASE,
  erro: () => ({ ...BASE(), leitura: { ...BASE().leitura, erro: { motivo: 'A Meta respondeu 500: An unknown error has occurred. (código 1)', conta: { papel: 'principal', final: '2210' } } } }),
  primeira: () => ({ ...BASE(), leitura: { lidoEm: null, algumaLida: false, tentouEm: null, erro: null, moeda: null, minutos: 30 }, total: { custo: 0, mensagens: 0, cobradas: 0 } }),
  qr: () => ({ oficial: false }),
  // G3 (mig 448): a conta cobrada por meio de um parceiro — a Meta não mostra o custo; o valor é estimado.
  estimado: () => ({ ...BASE(), leitura: { ...BASE().leitura, fonteDoCusto: 'tabela' } }),
  // G3b (mig 451): o gasto por modelo que a Meta não deixou ler — a tela diz "não li", com o motivo.
  modelos: () => ({
    ...BASE(),
    leitura: { ...BASE().leitura, modelosErro: { motivo: 'A Meta respondeu 400: Template analytics is not enabled for this business', conta: { papel: 'principal', final: '2210' } } },
  }),
  vazio: () => ({ ...BASE(), total: { custo: 0, mensagens: 0, cobradas: 0 }, projecao: 0, tipos: BASE().tipos.map((t) => ({ ...t, mensagens: 0, cobradas: 0, gratis: 0, custo: 0 })), dias: BASE().dias.map((d) => ({ ...d, custo: 0, marketing: 0 })), franquia: [], deOndeVeio: [] }),
  tres: () => ({
    ...BASE(),
    periodo: { tipo: 'tres', de: '2026-09-01', ate: '2026-11-18', mesCorrente: false },
    projecao: null,
    dias: Array.from({ length: 79 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 8, 1 + i)).toISOString().slice(0, 10);
      return { dia: d, custo: 1 + (i % 5), marketing: 0 };
    }),
  }),
};

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
    for (const el of document.querySelectorAll('main p, main td, main li, main h2, main strong')) {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      if (r.width > 0 && r.width < 60 && r.height > lh * 3.2 && (el.textContent || '').trim().length > 12) achados.push(`esmagado ${el.tagName.toLowerCase()} ${Math.round(r.width)}px: ${(el.textContent || '').trim().slice(0, 24)}`);
    }
    return achados;
  });

const texto = (page) => page.evaluate(() => document.querySelector('main')?.innerText.replace(/\s+/g, ' ') ?? '');

export default async function roteiroWhatsappGasto({ nav, base, ok, foto: arquivoFoto, larguras }) {
  async function abrir(w, h, o = {}) {
    const consultas = [];
    let lidas = 0;
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), o.token ?? PRESIDENTE);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/whatsapp/gasto') {
        consultas.push(u.search);
        const periodo = u.searchParams.get('periodo');
        return responder(route, (periodo === 'tres' ? CENARIOS.tres : CENARIOS[o.cenario ?? 'tudo'])());
      }
      // O Mister ligado? (G2: o cartão dos alertas avisa quando está desligado.)
      if (p === '/modulos/meus') return responder(route, { mister: o.semMister ? false : true });
      if (p === '/whatsapp/gasto/ler' && route.request().method() === 'POST') {
        lidas++;
        return responder(route, CENARIOS.tudo());
      }
      return responder(route, {});
    });
    await page.goto(base + '/whatsapp/gasto');
    return { ctx, page, erros, consultas, lidas: () => lidas };
  }

  // Em cada largura: o mês corrente inteiro, sem barra para o lado.
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, 900);
    await page.waitForSelector('text=Por tipo de mensagem', { timeout: 30000 });
    const t = await texto(page);
    const achados = await medir(page);
    ok(achados.length === 0, `${w}px: sem barra para o lado nem texto esmagado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok(/R\$\s205,43/.test(t) && t.includes('Gasto por dia') && t.includes('De onde veio') && t.includes('Meses anteriores') && t.includes('Outubro de 2026'), `${w}px: o gasto, por dia, de onde veio e os meses`);
    ok(t.includes('O dia 14/11 teve mais gasto de marketing'), `${w}px: só o dia da campanha é apontado (não os dias comuns)`);
    // O rótulo é em maiúsculas pelo CSS (o innerText devolve assim): a conferência ignora a caixa.
    ok(t.toLowerCase().includes('atendimento grátis · principal final 2210') && t.includes('acabaram'), `${w}px: a franquia de cada número`);
    // G2: o cartão dos alertas — 100 e 200 passaram, faltam R$ 194,57 para o 400, e o "Mudar os alertas" leva ao Mister.
    ok(
      t.includes('Alertas de gasto deste mês') && (t.match(/passou em/g) ?? []).length === 3 && /faltam R\$\s194,57/.test(t),
      `${w}px: o cartão dos alertas de gasto (os valores passados e o que falta)`,
    );
    ok((await page.locator('a:has-text("Mudar os alertas")').getAttribute('href')) === '/mister?parte=avisos', `${w}px: "Mudar os alertas" leva ao Mister › Avisos e relatórios`);
    if (w === 390 || w === 1440) {
      await page.screenshot({ path: arquivoFoto(`whatsapp-gasto-${w}.png`) });
      // A página não rola a casca do app: uma foto de cada seção, depois de rolar até ela (V45).
      const secoes = page.locator('main section');
      for (let i = 0; i < (await secoes.count()); i++) {
        await secoes.nth(i).scrollIntoViewIfNeeded();
        await secoes.nth(i).screenshot({ path: arquivoFoto(`whatsapp-gasto-${w}-secao-${i + 1}.png`) });
      }
    }
    ok(erros.length === 0, `${w}px: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    await ctx.close();
  }

  // Os estados, em 390 e 1366.
  for (const w of [390, 1366]) {
    {
      const { ctx, page, lidas } = await abrir(w, 900, { cenario: 'erro' });
      await page.waitForSelector('text=A Meta não respondeu na última leitura', { timeout: 30000 });
      const achados = await medir(page);
      ok(achados.length === 0, `${w}px · a Meta não respondeu: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      ok((await texto(page)).includes('a conta do número principal final 2210'), `${w}px · a faixa diz qual conta falhou`);
      await page.getByRole('button', { name: 'Tentar de novo' }).click();
      await page.waitForSelector('text=Gasto lido de novo na Meta.', { timeout: 10000 });
      ok(lidas() === 1, `${w}px · "Tentar de novo" lê a Meta de novo (${lidas()} leitura)`);
      if (w === 390) await page.screenshot({ path: arquivoFoto('whatsapp-gasto-erro-390.png'), fullPage: true });
      await ctx.close();
    }
    for (const [cenario, frase] of [
      ['estimado', 'esta conta é cobrada por meio de um parceiro'],
      ['modelos', 'Não consegui ler o gasto por modelo na Meta'],
      ['primeira', 'A primeira leitura do gasto chega em até 30 minutos.'],
      ['qr', 'Esta loja usa a conexão por QR Code.'],
      ['vazio', 'Nenhuma mensagem entregue neste período.'],
    ]) {
      const { ctx, page } = await abrir(w, 900, { cenario });
      await page.waitForSelector(`text=${frase}`, { timeout: 30000 });
      const achados = await medir(page);
      ok(achados.length === 0, `${w}px · ${cenario}: a frase certa e sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      if (cenario === 'estimado') ok((await texto(page)).toLowerCase().includes('gasto estimado em'), `${w}px · estimado: o número grande diz "Gasto estimado"`);
      await ctx.close();
    }
    {
      const { ctx, page, consultas } = await abrir(w, 900);
      await page.waitForSelector('text=Por tipo de mensagem', { timeout: 30000 });
      await page.getByRole('button', { name: 'Últimos 3 meses' }).click();
      await page.waitForSelector('text=Gasto por mês', { timeout: 10000 });
      ok(consultas.some((c) => c.includes('periodo=tres')), `${w}px · "Últimos 3 meses" pede o período e o gráfico vira por mês`);
      await page.getByRole('button', { name: 'Outro período' }).click();
      ok((await page.getByLabel('De', { exact: true }).isVisible()) && (await page.getByLabel('Até', { exact: true }).isVisible()), `${w}px · "Outro período" mostra as duas datas`);
      const achados = await medir(page);
      ok(achados.length === 0, `${w}px · outro período: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      await page.getByRole('button', { name: 'Este mês' }).click();
      await page.waitForSelector('text=Por tipo de mensagem', { timeout: 10000 });
      await page.getByLabel('Número', { exact: true }).selectOption({ label: 'Marketing · final 7731' });
      await page.waitForTimeout(400);
      ok(consultas.some((c) => c.includes('numero=5521999997731')), `${w}px · o número escolhido vai na consulta`);
      await ctx.close();
    }
  }

  // G2: com o Mister desligado, o cartão dos alertas diz que eles vão por ele e onde ligar.
  {
    const { ctx, page } = await abrir(390, 900, { semMister: true });
    await page.waitForSelector('text=Alertas de gasto deste mês', { timeout: 30000 });
    await page.waitForSelector('text=Os alertas vão pelo Mister, e ele está desligado.', { timeout: 10000 });
    ok((await texto(page)).includes('Ligue em Visão C&O › Módulos do produto'), 'Mister desligado: o cartão diz onde ligar');
    await ctx.close();
  }

  // O gerente: a tela é do presidente.
  {
    const { ctx, page, consultas } = await abrir(390, 900, { token: GERENTE });
    await page.waitForSelector('text=Só o presidente vê o gasto do WhatsApp oficial.', { timeout: 30000 });
    ok(consultas.length === 0, `o gerente vê o aviso e a tela nem pede o gasto (${consultas.length} consultas)`);
    await ctx.close();
  }
}
