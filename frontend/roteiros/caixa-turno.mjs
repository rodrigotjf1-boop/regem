// Roteiro de tela do TURNO ABERTO HÁ MAIS DE 24 HORAS (pedido do dono, 12/11/2026), na PDV · Balcão › Retirada (o painel do
// caixa é o mesmo no PDV e no Delivery). A API simulada. Confere: o turno de hoje não pede nada; o de 2 dias pede o
// fechamento ao abrir a tela (o diálogo, "Depois", a faixa em alerta com a idade e a data) e "Fechar turno" abre a contagem
// de sempre; nas larguras, o diálogo inteiro na tela e nenhuma barra lateral.
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const TOKEN = tokenFalso({ cat: 'gerente', perfil: 'gerente', perm: { delivery: { ver: true }, pedidos: { ver: true } } });

function caixa(horas) {
  const abertaEm = new Date(Date.now() - horas * 3_600_000).toISOString();
  return { id: `cx-${horas}`, status: 'aberta', origem: 'pdv', turnoNumero: 3, abertaEm, operadorNome: 'Rodrigo', horasAberto: horas, passouDoLimite: horas >= 24, limiteHoras: 24 };
}

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
    const d = document.querySelector('[role="alertdialog"]');
    if (d) {
      const r = d.getBoundingClientRect();
      if (r.left < 0 || r.right > window.innerWidth + 1 || r.top < 0) achados.push(`diálogo fora da tela ${Math.round(r.left)}..${Math.round(r.right)}`);
      for (const b of d.querySelectorAll('button')) if (b.getBoundingClientRect().height < 39.5) achados.push(`botão baixo "${b.textContent.trim()}"`);
    }
    return achados;
  });

export default async function roteiroCaixaTurno({ nav, base, ok, foto, larguras }) {
  async function abrir(w, h, horas) {
    const S = { pendencias: 0 };
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/financeiro/caixa') return responder(route, caixa(horas));
      if (p === '/financeiro/caixa/pendencias') {
        S.pendencias++;
        return responder(route, { total: 0, pedidos: [] });
      }
      if (p === '/delivery/retirada') return responder(route, { pedidos: [], origensEmUso: {} });
      if (p === '/financeiro/formas-pagamento') return responder(route, []);
      return responder(route, {});
    });
    await page.goto(base + '/pdv/retirada');
    await page.waitForSelector('text=Turno 03', { timeout: 20000 });
    return { ctx, page, erros, S };
  }

  // ── o turno de hoje (3 h): nada a pedir ──
  {
    const { ctx, page, erros } = await abrir(1280, 900, 3);
    await page.waitForTimeout(600);
    ok((await page.locator('[role="alertdialog"]').count()) === 0, 'turno de 3 horas: nenhum pedido de fechamento');
    ok(!(await page.locator('[data-turno-passou]').count()), 'turno de 3 horas: a faixa normal');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── o turno de 2 dias: pede o fechamento ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, 50);
    await page.waitForSelector('[role="alertdialog"]', { timeout: 8000 });
    const d = await page.locator('[role="alertdialog"]').innerText();
    ok(/Turno 03 aberto há 2 dias/.test(d) && /\d{2}\/\d{2} \d{2}:\d{2}/.test(d) && /por Rodrigo/.test(d) && /24 horas/.test(d), `o pedido de fechamento: ${umaLinha(d)}`);
    await page.screenshot({ path: foto('1280-pede-fechar.png') });
    await page.click('[role="alertdialog"] button:has-text("Depois")');
    await page.waitForSelector('[role="alertdialog"]', { state: 'detached' });
    const faixa = await page.locator('[data-turno-passou]').innerText();
    ok(/aberto há 2 dias: feche e abra outro/.test(faixa) && /desde \d{2}\/\d{2} \d{2}:\d{2}/.test(faixa), `"Depois": a faixa segue em alerta (${umaLinha(faixa)})`);
    await page.waitForTimeout(800);
    ok((await page.locator('[role="alertdialog"]').count()) === 0, '"Depois": não pede de novo na mesma tela (a releitura do caixa não reabre)');
    // de volta à tela: pede de novo; "Fechar turno" abre a contagem de sempre
    await page.reload();
    await page.waitForSelector('[role="alertdialog"]', { timeout: 8000 });
    await page.click('[role="alertdialog"] button:has-text("Fechar turno")');
    await page.waitForSelector('text=Fechar turno 03', { timeout: 8000 });
    ok(S.pendencias >= 1, '"Fechar turno": abre a contagem (confere as pendências do turno antes)');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── cada largura: o pedido de fechamento aberto, inteiro na tela, sem barra lateral ──
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, 50);
    await page.waitForSelector('[role="alertdialog"]', { timeout: 8000 });
    const m = await medir(page);
    ok(m.length === 0, `${w}: pedido de fechamento sem barra lateral e inteiro na tela ${m.slice(0, 3).join(' | ')}`);
    if (w === 375) await page.screenshot({ path: foto('375-pede-fechar.png') });
    ok(erros.length === 0, `${w}: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
