// Roteiro de tela de Pessoas › Candidatos com os indicadores do topo e a CONDUÇÃO DOS APROVADOS (F5b das vagas,
// protótipo `mockups/regem-vagas-talentos.html`). A API simulada.
// Confere em cada largura: os cinco indicadores, "Ver por pessoa" abre a gaveta com cada pessoa, o valor do mês, quem fica
// fora da soma e o motivo; nenhuma barra lateral e nada fora da janela, com a gaveta aberta; nenhum texto esmagado
// (≈ uma palavra por linha) e a foto de CADA indicador e de CADA pessoa (V45, ERR-432). E a leitura da condução que falha:
// "Tentar de novo", nunca R$ 0,00 (V37).
import { responder, tokenFalso } from './comum.mjs';

const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: { candidatos: { ver: true, editar: true } } });

const ficha = (id, nome, situacao, extra = {}) => ({
  id, protocolo: `V-${id}`, situacao, nome, idade: 24, telefone: '21999990000', bairro: 'Penha', cidade: 'Rio de Janeiro',
  funcoes: ['chapeiro'], setores: [], tipoVaga: 'fixa', escala: '12x36', dias: [], meios: ['publico'], conducoes: 1,
  valorIda: 4.7, valorVolta: 4.7, experiencia: 'sim', estuda: false, turnoEstudo: null, trabalhando: false, comeca: 'imediato',
  origem: null, origemNome: null, entrevistaEm: null, recebidoEm: '2026-11-14T15:00:00Z', loja: 'Burger da Praça', comunicacao: false,
  experiencias: 2, temCarteira: true, jaLiderou: false, distanciaKm: 3.1, minutosCarro: 9, distanciaFalha: null, distanciaMedindo: false,
  ...extra,
});
const CANDIDATOS = [
  ficha('a1', 'Rafael Souza', 'aprovado'),
  ficha('a2', 'Bianca Torres', 'aprovado'),
  ficha('n1', 'Joana Prado', 'novo', { recebidoEm: '2026-11-15T13:10:00Z' }),
  ficha('e1', 'Marcos Lima', 'entrevista', { entrevistaEm: '2099-01-10T18:00:00Z' }),
  ficha('b1', 'Patrícia Lima', 'banco', { comunicacao: true }),
  ficha('c1', 'Renata Dias', 'contratado'),
];

const pessoa = (id, nome, situacao, extra) => ({
  id, nome, situacao, loja: 'Burger da Praça', funcoes: ['chapeiro'], tipoVaga: 'fixa', dias: [], meios: ['publico'], conducoes: 1,
  uberMotivo: null, valorIda: 4.7, valorVolta: 4.7, contratadoEm: null, porDia: 9.4, diasNoMes: 15, porMes: 141, escala: '12x36', motivo: null,
  ...extra,
});
const CONDUCAO = {
  pessoas: [
    pessoa('a1', 'Rafael Souza', 'aprovado', {}),
    pessoa('a2', 'Bianca Torres de Albuquerque Figueiredo', 'aprovado', { funcoes: ['atendente', 'auxiliar'], conducoes: 2, valorIda: 9.4, valorVolta: 9.4, porDia: 18.8, diasNoMes: 22, porMes: 413.6, escala: '5x2' }),
    pessoa('c1', 'Renata Dias', 'contratado', { contratadoEm: '2026-11-03T14:00:00Z', meios: ['publico', 'uber'], uberMotivo: 'madrugada', valorVolta: 18.9, porDia: 23.6, diasNoMes: 22, porMes: 519.2, escala: '5x2' }),
    pessoa('h1', 'Tiago Ramos', 'contratado', { contratadoEm: '2026-11-12T14:00:00Z', tipoVaga: 'horista', dias: ['sex', 'sab', 'dom'], meios: ['bike'], conducoes: null, valorIda: 0, valorVolta: 0, porDia: 0, diasNoMes: 12.9, porMes: 0, escala: 'horista' }),
    pessoa('t1', 'Lúcia Ferreira', 'aprovado', { escala: 'tanto', diasNoMes: null, porMes: null, motivo: 'escala_a_definir' }),
    pessoa('s1', 'Carlos Eduardo', 'aprovado', { meios: ['pe'], conducoes: null, valorIda: null, valorVolta: null, porDia: null, diasNoMes: 15, porMes: null, motivo: 'sem_valor' }),
  ],
  porMes: 1073.8,
  porDia: 51.8,
  somadas: 4,
  foraDaSoma: 2,
};
const AJUSTES = { pagina: { funcoes: [{ codigo: 'chapeiro', nome: 'Chapeiro' }, { codigo: 'atendente', nome: 'Atendente' }, { codigo: 'auxiliar', nome: 'Auxiliar de cozinha' }] } };

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        // A faixa de partes desliza sem barra à mostra abaixo de 640 px (o desenho do `Partes`, como nos outros roteiros).
        if (el.classList.contains('faixa-abas') && window.innerWidth < 640 && el.offsetHeight === el.clientHeight + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)) continue;
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      }
    }
    for (const el of document.querySelectorAll('main button, main dd, main dt, [role="dialog"] *')) {
      if (el.closest('.faixa-abas') && window.innerWidth < 640) continue;
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.right > window.innerWidth + 1) achados.push(`passa ${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 20)}" ${Math.round(r.right)}>${window.innerWidth}`);
    }
    return achados;
  });

// Texto esmagado (ERR-432): um texto de 3+ palavras que ocupa quase uma linha por palavra.
export const esmagados = (page, raiz) =>
  page.evaluate((sel) => {
    const achados = [];
    for (const r of document.querySelectorAll(sel)) {
      for (const el of r.querySelectorAll('span, dt, dd, p, button')) {
        if (el.children.length) continue;
        const palavras = (el.textContent ?? '').trim().split(/\s+/).filter(Boolean);
        if (palavras.length < 3 || !el.getClientRects().length) continue;
        const linhas = el.getClientRects().length > 1 ? el.getClientRects().length : Math.round(el.getBoundingClientRect().height / (parseFloat(getComputedStyle(el).lineHeight) || 18));
        if (linhas >= 3 && palavras.length / linhas <= 2) achados.push(`"${palavras.join(' ').slice(0, 30)}" ${linhas} linhas`);
      }
    }
    return achados;
  }, raiz);

export default async function roteiroCandidatosConducao({ nav, base, ok, foto, larguras }) {
  async function abrir(w, { conducao = () => CONDUCAO, falhas = 0 } = {}) {
    const ctx = await nav.newContext({ viewport: { width: w, height: w < 700 ? 820 : 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    let falhar = falhas;
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/vagas/candidatos/conducao') {
        if (falhar > 0) {
          falhar--;
          return responder(route, { message: 'O servidor demorou para responder.' }, 503);
        }
        return responder(route, conducao());
      }
      if (p === '/vagas/candidatos') return responder(route, CANDIDATOS);
      if (p === '/vagas/pagina') return responder(route, AJUSTES);
      return responder(route, {});
    });
    await page.goto(base + '/candidatos');
    await page.waitForSelector('[data-candidatos-indicadores]', { timeout: 20000 });
    await page.waitForTimeout(300);
    return { ctx, page, erros };
  }

  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w);
    const ind = page.locator('[data-candidatos-indicadores]');
    await page.waitForSelector('[data-candidatos-indicadores] >> text=R$ 1.073,80', { timeout: 10000 }).catch(() => null);
    const textoInd = (await ind.innerText()).replace(/\s+/g, ' ');
    ok(
      /Fichas novas 1/.test(textoInd) && /Entrevistas marcadas 1/.test(textoInd) && /Aprovados para contratar 2/.test(textoInd) && /No banco de talentos 1 1 autorizou/.test(textoInd) && /R\$ 1\.073,80 por mês · informado na ficha · 2 fora da soma/.test(textoInd),
      `${w}: os cinco indicadores com os números da lista e da condução (${textoInd.slice(0, 220)})`,
    );
    let m = await medir(page);
    ok(m.length === 0, `${w}: lista com indicadores — nenhuma barra lateral e nada fora da janela ${m.slice(0, 3).join(' | ')}`);
    // O valor da condução numa linha só (na grade de duas colunas o cartão ocupa a linha inteira)
    const linhasDoValor = await ind.locator('dt:has-text("Condução dos aprovados") + dd').evaluate((el) => Math.round(el.getBoundingClientRect().height / (parseFloat(getComputedStyle(el).lineHeight) || 28)));
    ok(linhasDoValor === 1, `${w}: "R$ 1.073,80" numa linha só (${linhasDoValor} linhas)`);
    let e = await esmagados(page, '[data-candidatos-indicadores]');
    ok(e.length === 0, `${w}: nenhum texto esmagado nos indicadores ${e.slice(0, 3).join(' | ')}`);
    if ([320, 375, 768, 1920].includes(w)) {
      const cartoes = ind.locator('dl > div');
      for (let i = 0; i < (await cartoes.count()); i++) {
        await cartoes.nth(i).scrollIntoViewIfNeeded();
        await cartoes.nth(i).screenshot({ path: foto(`indicador-${w}-${i + 1}.png`) });
      }
    }

    await page.click('button:has-text("Ver por pessoa")');
    const gaveta = page.locator('[data-conducao-gaveta]');
    await gaveta.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
    ok(await gaveta.isVisible(), `${w}: "Ver por pessoa" abre a gaveta da condução`);
    const textoGav = (await gaveta.innerText()).replace(/\s+/g, ' ');
    ok(
      (await page.locator('[data-conducao-pessoa]').count()) === 6 &&
        textoGav.includes('Ida R$ 9,40 · volta R$ 9,40 · 5x2 = 22 dias') &&
        textoGav.includes('R$ 413,60') &&
        textoGav.includes('Contratado em 03/11') &&
        textoGav.includes('horista (Sex, Sáb, Dom) = 12,9 dias') &&
        textoGav.includes('sem custo') &&
        textoGav.includes('12x36 ou 5x2 (a definir)') &&
        textoGav.includes('R$ 9,40 por dia de trabalho; entra na soma quando a escala estiver definida') &&
        textoGav.includes('Não informou o valor da ida e da volta na ficha.') &&
        textoGav.includes('Por mês R$ 1.073,80') &&
        textoGav.includes('Num dia em que todos trabalham R$ 51,80') &&
        textoGav.includes('2 fora da soma'),
      `${w}: cada pessoa com o valor, os dias da escala e quem fica fora da soma (${textoGav.slice(0, 160)})`,
    );
    m = await medir(page);
    ok(m.length === 0, `${w}: com a gaveta aberta, nenhuma barra lateral e nada fora da janela ${m.slice(0, 3).join(' | ')}`);
    e = await esmagados(page, '[role="dialog"]');
    ok(e.length === 0, `${w}: nenhum texto esmagado na gaveta ${e.slice(0, 3).join(' | ')}`);
    if ([320, 375, 768, 1920].includes(w)) {
      const linhas = page.locator('[data-conducao-pessoa]');
      for (let i = 0; i < (await linhas.count()); i++) {
        await linhas.nth(i).scrollIntoViewIfNeeded();
        await linhas.nth(i).screenshot({ path: foto(`conducao-${w}-${i + 1}.png`) });
      }
      await page.screenshot({ path: foto(`conducao-${w}.png`) });
    }
    await page.keyboard.press('Escape');
    await gaveta.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => null);
    ok(!(await gaveta.isVisible()), `${w}: Esc fecha a gaveta`);
    ok(erros.length === 0, `${w}: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── a leitura da condução falha: "Tentar de novo", nunca R$ 0,00; o segundo clique lê ──
  {
    const { ctx, page, erros } = await abrir(375, { falhas: 1 });
    const ind = page.locator('[data-candidatos-indicadores]');
    await page.waitForSelector('[data-candidatos-indicadores] button:has-text("Tentar de novo")', { timeout: 10000 }).catch(() => null);
    const t = (await ind.innerText()).replace(/\s+/g, ' ');
    ok(t.includes('não deu para ler') && !t.includes('R$ 0,00') && (await page.locator('button:has-text("Ver por pessoa")').count()) === 0, `falha: o indicador diz que não leu e não mostra R$ 0,00 (${t.slice(-120)})`);
    await page.click('[data-candidatos-indicadores] button:has-text("Tentar de novo")');
    await page.waitForSelector('[data-candidatos-indicadores] >> text=R$ 1.073,80', { timeout: 10000 }).catch(() => null);
    ok((await ind.innerText()).includes('R$ 1.073,80'), 'falha: "Tentar de novo" lê a condução');
    ok(erros.length === 0, `falha: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── ninguém aprovado: a gaveta explica que a soma aparece com o primeiro aprovado ──
  {
    const { ctx, page, erros } = await abrir(375, { conducao: () => ({ pessoas: [], porMes: 0, porDia: 0, somadas: 0, foraDaSoma: 0 }) });
    await page.waitForSelector('button:has-text("Ver por pessoa")', { timeout: 10000 });
    await page.click('button:has-text("Ver por pessoa")');
    await page.waitForSelector('[data-conducao-gaveta]', { timeout: 5000 });
    ok((await page.locator('[data-conducao-gaveta]').innerText()).includes('Nenhum aprovado nem contratado nos últimos 30 dias'), 'vazio: a gaveta diz que ninguém está na soma');
    ok(erros.length === 0, `vazio: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
