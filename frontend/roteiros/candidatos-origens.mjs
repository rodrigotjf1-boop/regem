// Roteiro de tela da F5a das vagas — "De onde vêm as fichas" (protótipo `mockups/regem-vagas-talentos.html`, mig 430).
// A API simulada.
//  • Pessoas › Candidatos › QR codes e links, em cada largura: o cartão com os totais, as origens (QR, robô, sem origem) e
//    a conta de cada QR no período; nenhuma barra lateral, nada fora da janela, nenhum texto esmagado; foto de cada origem.
//  • O período: "7 dias" pede `?dias=7` e a tela mostra a resposta dele (a leitura antiga que chega depois não vale).
//  • A leitura que falha: "Tentar de novo", nunca zeros; sem abertura: o estado vazio.
//  • A página pública: abre e conta UMA abertura; aberta de novo no mesmo aparelho no mesmo dia, não conta de novo.
import { responder, tokenFalso } from './comum.mjs';
import { esmagados } from './candidatos-conducao.mjs';

const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: { candidatos: { ver: true, editar: true } } });
const HORA = { ativa: true, inicio: '15:00', fim: '03:00' };
const AJUSTES = {
  codigo: 'burger-teste',
  criada: true,
  loja: { nome: 'Burger da Praça', logoRef: null, logoEmoji: null, corPrimaria: null },
  pagina: {
    ligada: true, titulo: 'Venha fazer parte do nosso time!', frase: 'Vagas fixas e horistas.',
    funcoes: [{ codigo: 'chapeiro', nome: 'Chapeiro(a)', salario: 'R$ 1.900,00', lideranca: false, aberta: true }],
    beneficios: ['Vale-refeição'], vagaFixa: true, horista: true,
    horarios: { '12x36': HORA, '5x2': HORA, horista: { ...HORA, dias: ['sex', 'sab', 'dom'] } },
    idadeMinima: 18, guardaMeses: 12, perguntas: {}, corPrincipal: null, corDestaque: null,
  },
};
const QRS = [
  { id: 'q1', codigo: 'balcao', nome: 'QR do balcão', fichas: 21 },
  { id: 'q2', codigo: 'salao', nome: 'QR do salão e mesas de fora da loja', fichas: 5 },
  { id: 'q3', codigo: 'fachada', nome: 'Fachada', fichas: 0 },
];
const origem = (o, nome, tipo, aberturas, fichas) => ({ origem: o, nome, tipo, aberturas, fichas });
const ABERTURAS = (dias) => ({
  dias,
  desde: '2026-10-18',
  contandoDesde: '2026-11-16',
  totais: dias === 7 ? { aberturas: 102, fichas: 9 } : { aberturas: 412, fichas: 41 },
  origens:
    dias === 7
      ? [origem('balcao', 'QR do balcão', 'qr', 41, 5), origem('whatsapp', 'Robô no WhatsApp', 'robo', 10, 1), origem('salao', 'QR do salão e mesas de fora da loja', 'qr', 15, 1), origem('fachada', 'Fachada', 'qr', 0, 0), origem('', 'Link sem origem', 'link', 36, 2)]
      : [origem('balcao', 'QR do balcão', 'qr', 180, 21), origem('salao', 'QR do salão e mesas de fora da loja', 'qr', 64, 5), origem('whatsapp', 'Robô no WhatsApp', 'robo', 38, 4), origem('direct', 'Robô no Direct do Instagram', 'robo', 12, 1), origem('', 'Link sem origem', 'link', 118, 10), origem('fachada', 'Fachada', 'qr', 0, 0)],
});
const PUBLICA = {
  loja: { nome: 'Burger da Praça', logoRef: null, logoEmoji: null },
  cores: { principal: null, destaque: null },
  pagina: { ...AJUSTES.pagina, funcoes: [{ codigo: 'chapeiro', nome: 'Chapeiro(a)', salario: 'R$ 1.900,00', lideranca: false }] },
  termos: { guarda: 'Guardamos a sua ficha por 12 meses.', comunicacao: { resumo: 'Avisos de vaga pelo WhatsApp.', texto: ['Você pode sair quando quiser.'] } },
};

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        if (el.classList.contains('faixa-abas') && window.innerWidth < 640 && el.offsetHeight === el.clientHeight + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)) continue;
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      }
    }
    for (const el of document.querySelectorAll('main button, main dd, main dt, main li, main p')) {
      if (el.closest('.faixa-abas') && window.innerWidth < 640) continue;
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.right > window.innerWidth + 1) achados.push(`passa ${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 20)}" ${Math.round(r.right)}>${window.innerWidth}`);
    }
    return achados;
  });

export default async function roteiroCandidatosOrigens({ nav, base, ok, foto, larguras }) {
  async function abrir(w, { falhas = 0, vazio = false } = {}) {
    const ctx = await nav.newContext({ viewport: { width: w, height: w < 700 ? 820 : 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    const pedidos = [];
    let falhar = falhas;
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const url = new URL(route.request().url());
      const p = url.pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/vagas/aberturas') {
        const dias = Number(url.searchParams.get('dias'));
        pedidos.push(dias);
        if (falhar > 0) {
          falhar--;
          return responder(route, { message: 'O servidor demorou para responder.' }, 503);
        }
        // A leitura de 30 dias demora mais que a de 7: se a de 30 chegar por último, a tela não pode mostrá-la.
        if (dias === 30 && pedidos.filter((d) => d === 30).length > 1) await new Promise((r) => setTimeout(r, 600));
        return responder(route, vazio ? { ...ABERTURAS(dias), totais: { aberturas: 0, fichas: 0 }, origens: ABERTURAS(dias).origens.filter((o) => o.tipo === 'qr').map((o) => ({ ...o, aberturas: 0, fichas: 0 })) } : ABERTURAS(dias));
      }
      if (p === '/vagas/qr') return responder(route, QRS);
      if (p === '/vagas/pagina') return responder(route, AJUSTES);
      if (p === '/vagas/candidatos' || p === '/vagas/candidatos/conducao') return responder(route, p.endsWith('conducao') ? { pessoas: [], porMes: 0, porDia: 0, somadas: 0, foraDaSoma: 0 } : []);
      return responder(route, {});
    });
    await page.goto(base + '/candidatos');
    await page.click('[aria-label="Partes de Candidatos"] button:has-text("QR codes e links")');
    await page.waitForSelector('[data-de-onde-vem]', { timeout: 20000 });
    return { ctx, page, erros, pedidos };
  }

  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w);
    await page.waitForSelector('[data-de-onde-vem] [data-origem]', { timeout: 10000 }).catch(() => null);
    const cartao = page.locator('[data-de-onde-vem]');
    const t = (await cartao.innerText()).replace(/\s+/g, ' ');
    ok(
      /Abriram a página 412/.test(t) && /Enviaram a ficha 41/.test(t) && /Viraram ficha 10%/.test(t) && t.includes('As aberturas começaram a contar em 16/11'),
      `${w}: os totais do período e a nota de quando as aberturas começaram (${t.slice(0, 200)})`,
    );
    const origens = page.locator('[data-de-onde-vem] [data-origem]');
    ok((await origens.count()) === 5, `${w}: as cinco origens com número (a Fachada zerada fica só no cartão dela)`);
    ok(/QR do balcão QR ou link da loja abriram 180 fichas 21 12% viraram ficha/.test((await origens.first().innerText()).replace(/\s+/g, ' ')), `${w}: a primeira origem é a que mais trouxe fichas, com a taxa`);
    const contas = (await page.locator('[data-qr-conta]').allInnerTexts()).map((x) => x.replace(/\s+/g, ' '));
    ok(contas[0].includes('Abriram 180 · enviaram 21 (12%)') && contas[2].includes('Nenhuma abertura nos últimos 30 dias'), `${w}: cada QR com a conta do período (${contas.join(' | ')})`);
    const m = await medir(page);
    ok(m.length === 0, `${w}: nenhuma barra lateral e nada fora da janela ${m.slice(0, 3).join(' | ')}`);
    const e = await esmagados(page, '[data-de-onde-vem]');
    ok(e.length === 0, `${w}: nenhum texto esmagado no cartão ${e.slice(0, 3).join(' | ')}`);
    if ([320, 375, 768, 1920].includes(w)) {
      for (let i = 0; i < (await origens.count()); i++) {
        await origens.nth(i).scrollIntoViewIfNeeded();
        await origens.nth(i).screenshot({ path: foto(`origem-${w}-${i + 1}.png`) });
      }
      await cartao.scrollIntoViewIfNeeded();
      await cartao.screenshot({ path: foto(`de-onde-${w}.png`) });
    }
    ok(erros.length === 0, `${w}: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── o período: 7 dias pede ?dias=7; a leitura antiga de 30 que chega depois não vale ──
  {
    const { ctx, page, erros, pedidos } = await abrir(375);
    await page.waitForSelector('[data-de-onde-vem] >> text=Abriram a página', { timeout: 10000 });
    await page.click('[data-de-onde-vem] button:has-text("30 dias")'); // pede 30 de novo (vai demorar)
    await page.click('[data-de-onde-vem] button:has-text("7 dias")'); // e 7 logo depois
    await page.waitForTimeout(1200);
    const t = (await page.locator('[data-de-onde-vem]').innerText()).replace(/\s+/g, ' ');
    ok(pedidos.includes(7) && /Últimos 7 dias/.test(t) && /Abriram a página 102/.test(t), `período: "7 dias" mostra a leitura de 7, mesmo com a de 30 chegando depois (${pedidos.join(',')} · ${t.slice(0, 120)})`);
    ok((await page.locator('[data-de-onde-vem] button[aria-pressed="true"]').innerText()).includes('7 dias'), 'período: o botão escolhido fica marcado');
    ok(erros.length === 0, `período: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── a leitura falha: "Tentar de novo", nunca zeros ──
  {
    const { ctx, page, erros } = await abrir(375, { falhas: 1 });
    await page.waitForSelector('[data-de-onde-vem] button:has-text("Tentar de novo")', { timeout: 10000 }).catch(() => null);
    const t = (await page.locator('[data-de-onde-vem]').innerText()).replace(/\s+/g, ' ');
    ok(t.includes('Não foi possível carregar de onde vêm as fichas') && !/Abriram a página 0/.test(t), `falha: diz que não leu e não mostra zeros (${t.slice(0, 120)})`);
    ok((await page.locator('[data-qr-conta]').first().innerText()).includes('21 fichas vieram daqui'), 'falha: o cartão do QR fica com as fichas de sempre');
    await page.click('[data-de-onde-vem] button:has-text("Tentar de novo")');
    await page.waitForSelector('[data-de-onde-vem] >> text=Abriram a página', { timeout: 10000 }).catch(() => null);
    ok((await page.locator('[data-de-onde-vem]').innerText()).includes('412'), 'falha: "Tentar de novo" lê');
    ok(erros.length === 0, `falha: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── sem abertura no período: o estado vazio ──
  {
    const { ctx, page, erros } = await abrir(375, { vazio: true });
    await page.waitForSelector('[data-de-onde-vem] >> text=Ainda não há aberturas neste período', { timeout: 10000 }).catch(() => null);
    ok(await page.locator('[data-de-onde-vem] >> text=Ainda não há aberturas neste período').isVisible(), 'vazio: o cartão explica que ainda não há aberturas');
    ok(erros.length === 0, `vazio: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── a página pública conta UMA abertura por aparelho por dia ──
  {
    const ctx = await nav.newContext({ viewport: { width: 375, height: 820 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: true });
    const page = await ctx.newPage();
    const erros = [];
    const contadas = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/publico/vagas/burger-teste/abertura') {
        contadas.push(JSON.parse(route.request().postData() || '{}'));
        return responder(route, { ok: true });
      }
      if (p === '/publico/vagas/burger-teste') return responder(route, PUBLICA);
      return responder(route, {});
    });
    await page.goto(base + '/v/burger-teste?o=salao');
    await page.waitForSelector('text=Burger da Praça', { timeout: 20000 });
    await page.waitForTimeout(500);
    ok(contadas.length === 1 && contadas[0].origem === 'salao', `pública: abriu e contou uma abertura pelo salão (${JSON.stringify(contadas)})`);
    await page.goto(base + '/v/burger-teste?o=balcao');
    await page.waitForSelector('text=Burger da Praça', { timeout: 20000 });
    await page.waitForTimeout(500);
    ok(contadas.length === 1, `pública: aberta de novo no mesmo aparelho e dia, não conta de novo (${contadas.length})`);
    const cookies = await ctx.cookies();
    ok(cookies.some((c) => c.name === 'rgm_vaga_burger-teste' && /^\d{4}-\d{2}-\d{2}$/.test(c.value)), 'pública: o cookie guarda só o dia');
    ok(erros.length === 0, `pública: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
