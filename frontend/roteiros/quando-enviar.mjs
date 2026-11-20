// Roteiro de tela do "QUANDO ENVIAR" DA CAMPANHA (F7 parte 4b do `docs/plano-perfil-cliente.md`; protótipo
// `regem-perfil-cliente.html`, aba "Marketing", cartão "Quando enviar"; mig 480). A API simulada. Confere:
//  • em cada largura, no Marketing: o cartão com as duas formas; "Na hora habitual de cada cliente" pede a prévia com
//    `habitual=1`, mostra quem fica de fora sem o aceite clicado e como os envios se espalham pelas horas, com o número
//    escrito — nenhuma barra para o lado nem texto esmagado (V45);
//  • criar na hora habitual manda `envioHabitual: true`; a janela de horário da campanha vai junto na prévia;
//  • o diálogo "Nova campanha" de Delivery › Clientes com o mesmo cartão (320 e 1280);
//  • sem o módulo "Perfil do cliente", nem o cartão aparece (a campanha de sempre).
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', nome: 'Ana' });

const PREVIA_FIXO = { total: 36, foraPorOferta: 0, intervaloOfertasDias: null };
const PREVIA_HABITUAL = {
  total: 17,
  foraPorOferta: 0,
  intervaloOfertasDias: null,
  habitual: { foraPorAceite: 19, porHora: { 17: 1, 18: 3, 19: 7, 20: 4, 21: 2 }, dia: 3 },
};

const medir = (page, escopo) =>
  page.evaluate((sel) => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && !el.closest('table'))
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    const raiz = document.querySelector(sel);
    if (!raiz) return ['sem o cartão'];
    const caixa = raiz.getBoundingClientRect();
    for (const el of raiz.querySelectorAll('p, button, li, span')) {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 16;
      if (r.width > 0 && r.width < 60 && r.height > lh * 3.2 && (el.textContent || '').trim().length > 12)
        achados.push(`esmagado ${el.tagName.toLowerCase()} ${Math.round(r.width)}px: ${(el.textContent || '').trim().slice(0, 24)}`);
      if (r.width > 0 && (r.right > caixa.right + 1 || r.right > doc.clientWidth + 1))
        achados.push(`passa ${el.tagName.toLowerCase()}: ${(el.textContent || '').trim().slice(0, 24)}`);
    }
    return achados;
  }, escopo);

export default async function roteiroQuandoEnviar({ nav, base, ok, foto: arquivoFoto, larguras }) {
  async function abrir(w, h, { perfil = true, caminho = '/marketing' } = {}) {
    const consultas = [];
    const criados = [];
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((t) => localStorage.setItem('regen_token', t), PRESIDENTE);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    page.on('console', (m) => m.type() === 'error' && /TypeError|ReferenceError|Minified React/.test(m.text()) && erros.push(m.text().slice(0, 300)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname.replace(/^.*\/api\/v1/, '');
      const metodo = route.request().method();
      consultas.push(p + u.search);
      if (p === '/modulos/meus') return responder(route, { perfil_cliente: perfil });
      if (p === '/whatsapp/numeros')
        return responder(route, {
          principal: { provedor: 'evolution', vinculado: true },
          marketing: { provedor: 'evolution', vinculado: true },
        });
      if (p === '/whatsapp/marketing/status') return responder(route, { conectado: true });
      if (p === '/campanhas/previa') return responder(route, u.searchParams.get('habitual') === '1' ? PREVIA_HABITUAL : PREVIA_FIXO);
      if (p === '/campanhas' && metodo === 'POST') {
        criados.push(JSON.parse(route.request().postData() || '{}'));
        return responder(route, { id: 'c1', total: 17 });
      }
      if (p === '/marketing/clube') return responder(route, { config: { surpresaAtivo: false }, gatilhos: {}, premios: [] });
      if (p === '/perfil-cliente/resumo') return responder(route, { segmentos: {}, etiquetas: {}, selos: {}, total: 0 });
      if (p === '/clientes/crm/resumo') return responder(route, { total: 0 });
      if (p === '/campanhas' || p.startsWith('/campanhas/') || p.startsWith('/clientes/crm') || p.startsWith('/whatsapp/cloud/templates'))
        return responder(route, []);
      return responder(route, {});
    });
    await page.goto(base + caminho);
    return { ctx, page, erros, consultas, criados };
  }

  const CARTAO = '[data-quando-enviar]';
  const naHora = (page) => page.getByRole('button', { name: /Na hora habitual de cada cliente/ });

  for (const w of larguras) {
    const { ctx, page, erros, consultas } = await abrir(w, 900);
    await page.getByRole('button', { name: '＋ Nova campanha' }).click({ timeout: 30000 });
    await page.waitForSelector(CARTAO, { timeout: 15000 });
    const fixo = page.getByRole('button', { name: /Num horário fixo/ });
    ok((await fixo.getAttribute('aria-pressed')) === 'true', `${w}px · nasce "num horário fixo"`);
    await naHora(page).click();
    await page.waitForSelector('text=Como os 17 envios se espalham', { timeout: 15000 });
    ok((await naHora(page).getAttribute('aria-pressed')) === 'true', `${w}px · "na hora habitual" marcado (aria-pressed)`);
    ok(consultas.some((c) => c.startsWith('/campanhas/previa?') && c.includes('habitual=1')), `${w}px · a prévia pede habitual=1`);
    const t = (await page.locator(CARTAO).innerText()).replace(/\s+/g, ' ');
    ok(t.includes('19 ficam de fora: não aceitaram as mensagens clicando'), `${w}px · quem fica de fora sem o aceite clicado`);
    ok(t.includes('num dia como hoje (quarta-feira)') && /7\s*19h/.test(t) && /1\s*17h/.test(t), `${w}px · as horas com o número escrito`);
    const achados = await medir(page, CARTAO);
    ok(achados.length === 0, `${w}px · Marketing: sem barra para o lado nem texto esmagado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    if (w === 390 || w === 1440) await page.locator(CARTAO).screenshot({ path: arquivoFoto(`quando-enviar-${w}.png`) });
    ok(erros.length === 0, `${w}px · nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    await ctx.close();
  }

  {
    // Criar na hora habitual, com a janela de horário: a prévia leva a janela; o criar leva envioHabitual.
    const { ctx, page, consultas, criados } = await abrir(1280, 900);
    await page.getByRole('button', { name: '＋ Nova campanha' }).click({ timeout: 30000 });
    await page.waitForSelector(CARTAO, { timeout: 15000 });
    await naHora(page).click();
    await page.waitForSelector('text=Como os 17 envios se espalham', { timeout: 15000 });
    await page.getByText('Agendar (dias e horário)').click();
    const horas = page.locator('input[type="time"]');
    await horas.nth(0).fill('11:00');
    await horas.nth(1).fill('14:00');
    await page.waitForTimeout(800);
    ok(consultas.some((c) => c.includes('habitual=1') && c.includes('horaInicio=11%3A00') && c.includes('horaFim=14%3A00')), 'a prévia leva a janela de horário');
    await page.locator('textarea').first().fill('Combo da noite na loja. Responda SAIR para não receber.');
    await page.getByRole('button', { name: /Criar campanha \(17\)/ }).click();
    await page.waitForTimeout(800);
    ok(criados.length === 1 && criados[0].envioHabitual === true, `o criar manda envioHabitual: true${criados[0] ? '' : ' (nada enviado)'}`);
    await ctx.close();
  }

  for (const w of [320, 1280]) {
    // O diálogo "Nova campanha" de Delivery › Clientes.
    const { ctx, page, erros, consultas } = await abrir(w, 900, { caminho: '/clientes' });
    await page.getByRole('button', { name: 'Nova campanha' }).click({ timeout: 30000 });
    await page.waitForSelector(`[role="dialog"] ${CARTAO}`, { timeout: 15000 });
    await naHora(page).click();
    await page.waitForSelector('[role="dialog"] >> text=Como os 17 envios se espalham', { timeout: 15000 });
    ok(consultas.some((c) => c.startsWith('/campanhas/previa?') && c.includes('habitual=1')), `${w}px · Clientes: a prévia pede habitual=1`);
    ok((await page.getByRole('button', { name: /Enviar p\/ 17/ }).count()) === 1, `${w}px · Clientes: o botão conta os 17 da hora habitual`);
    const achados = await medir(page, `[role="dialog"] ${CARTAO}`);
    ok(achados.length === 0, `${w}px · Clientes: o diálogo sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    if (w === 320) await page.locator('[role="dialog"]').screenshot({ path: arquivoFoto('quando-enviar-clientes-320.png') });
    ok(erros.length === 0, `${w}px · Clientes: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    await ctx.close();
  }

  {
    // Sem o módulo do perfil: nem o cartão (a campanha de sempre).
    const { ctx, page } = await abrir(1280, 900, { perfil: false });
    await page.getByRole('button', { name: '＋ Nova campanha' }).click({ timeout: 30000 });
    await page.waitForSelector('text=Agendar (dias e horário)', { timeout: 15000 });
    ok((await page.locator(CARTAO).count()) === 0, 'sem o módulo do perfil: sem o "Quando enviar"');
    await ctx.close();
  }
}
