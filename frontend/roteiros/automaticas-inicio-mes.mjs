// Roteiro de tela do "INÍCIO DO MÊS" em Delivery › Marketing › Automáticas (F7 parte 4c do `docs/plano-perfil-cliente.md`;
// protótipo `regem-perfil-cliente.html`, aba "Marketing", "Automáticas novas"; mig 486). A API simulada. Confere:
//  • em cada largura: o grupo com a chave desligada, o público de verdade, a prévia e o "Ver quem" — nenhuma barra para o
//    lado nem texto esmagado, com o diálogo aberto também (V45);
//  • a tela diz POR QUE ninguém recebe: sem selo, ou com selo e sem o aceite clicado;
//  • ligar e salvar manda só `inicioMesAtivo: true`; "Enviar à Meta" chama o modelo `inicio_mes`;
//  • sem o módulo "Perfil do cliente", o grupo não aparece.
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', nome: 'Ana' });
const RESULTADO = { mensagens: 0, cliques: 0, voltaram: 0, valor: 0, cupons: 0 };
const LISTA = [
  { nome: 'Marina L.', detalhe: 'último pedido em 28/10' },
  { nome: 'Paulo R.', detalhe: 'último pedido em 22/10' },
  { nome: 'Sara M.', detalhe: 'último pedido em 15/10' },
];

function inicioMes({ comSelo = 12, comAceite = 3, total = 3, modelo = null } = {}) {
  return {
    provedor: 'cloud',
    pronto: false,
    motivo: 'o modelo ainda não foi enviado à Meta',
    modelo,
    janela: { inicio: '2026-12-01', fim: '2026-12-05', valendo: false },
    publico: { comSelo, comAceite },
    previa: { dia: '2026-12-01', total, vagas: 30, lista: total ? LISTA.slice(0, total) : [] },
    resultado: RESULTADO,
  };
}

function painel({ perfil = true, ativo = false, ...im } = {}) {
  const fora = { provedor: 'cloud', pronto: false, motivo: 'o modelo ainda não foi enviado à Meta', previa: null, resultado: RESULTADO };
  return {
    ajustes: {
      intervaloOfertasDias: 7, maxPorDia: 30, horario: 'antes_de_abrir',
      cashbackAtivo: false, cashbackDiasAntes: 3, cashbackSaldoMin: 5,
      aniversarioAtivo: false, aniversarioQuando: 'no_dia', aniversarioPresente: 'cupom', aniversarioDesconto: 'v10', aniversarioMinimo: 40, aniversarioValidadeDias: 7,
      voltaAtivo: false, voltaDias: 30, voltaMinPedidos: 1, voltaPresente: 'cupom', voltaDesconto: 'v8', voltaMinimo: 30, voltaValidadeDias: 7, voltaTentativas: 2,
      voltaPeloRitmo: false, grupoControle: false, viuAtivo: false, inicioMesAtivo: ativo,
    },
    perfilLigado: perfil,
    opcoes: {
      intervalos: [3, 7, 15, 30], maxPorDia: [10, 20, 30, 50, 100], horarios: ['antes_de_abrir', 'ao_abrir', '10:00', '15:00'],
      cashbackDiasAntes: [1, 2, 3, 5, 7], cashbackSaldoMin: [1, 2, 5, 10],
      aniversarioQuando: ['no_dia', '3_antes', '7_antes'], aniversarioDesconto: ['v5', 'v10', 'v15', 'p10', 'p15', 'frete'], aniversarioMinimo: [0, 30, 40, 60], aniversarioValidade: [3, 7, 15],
      voltaDias: [21, 30, 45, 60], voltaPedidos: [1, 2, 3], voltaDesconto: ['v5', 'v8', 'v10', 'p10', 'frete'], voltaMinimo: [0, 30, 40], voltaValidade: [3, 7, 15], voltaTentativas: [1, 2],
    },
    envioHoje: { antes_de_abrir: '17:00', ao_abrir: '18:00' },
    cashback: { ...fora, modelo: null },
    aniversario: { ...fora, modelos: { presente: null, parabens: null }, informaram: 0, previa: { inicio: '2026-11-21', fim: '2026-11-27', aniversarios: 0, recebem: 0, lista: [] } },
    volta: { ...fora, modelos: { cupom: null, lembrete: null } },
    inicioMes: perfil ? inicioMes(im) : null,
  };
}

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && !el.closest('table'))
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    const raiz = document.querySelector('[role="dialog"]') ?? document.querySelector('[data-publico-inicio-mes]')?.closest('section') ?? document.body;
    const caixa = raiz.getBoundingClientRect();
    for (const el of raiz.querySelectorAll('p, button, li, span, b')) {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 16;
      if (r.width > 0 && r.width < 60 && r.height > lh * 3.2 && (el.textContent || '').trim().length > 12)
        achados.push(`esmagado ${el.tagName.toLowerCase()} ${Math.round(r.width)}px: ${(el.textContent || '').trim().slice(0, 24)}`);
      if (r.width > 0 && (r.right > caixa.right + 1 || r.right > doc.clientWidth + 1))
        achados.push(`passa ${el.tagName.toLowerCase()}: ${(el.textContent || '').trim().slice(0, 24)}`);
    }
    return achados;
  });

export default async function roteiroInicioMes({ nav, base, ok, foto: arquivoFoto, larguras }) {
  async function abrir(w, h, opcoes = {}) {
    const salvos = [];
    const modelos = [];
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((t) => localStorage.setItem('regen_token', t), PRESIDENTE);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    page.on('console', (m) => m.type() === 'error' && /TypeError|ReferenceError|Minified React/.test(m.text()) && erros.push(m.text().slice(0, 200)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname.replace(/^.*\/api\/v1/, '');
      const metodo = route.request().method();
      if (p === '/modulos/meus') return responder(route, { perfil_cliente: opcoes.perfil !== false });
      if (p === '/whatsapp/numeros')
        return responder(route, { principal: { provedor: 'evolution', vinculado: true }, marketing: { provedor: 'evolution', vinculado: true } });
      if (p === '/whatsapp/marketing/status') return responder(route, { conectado: true });
      if (p === '/marketing/automaticas' && metodo === 'PUT') {
        const corpo = JSON.parse(route.request().postData() || '{}');
        salvos.push(corpo);
        return responder(route, painel({ ...opcoes, ativo: corpo.inicioMesAtivo === true }));
      }
      if (p === '/marketing/automaticas') return responder(route, painel(opcoes));
      if (p.startsWith('/marketing/automaticas/modelo/')) {
        modelos.push(p.split('/').pop());
        return responder(route, painel({ ...opcoes, modelo: { status: 'pendente', categoria: 'MARKETING', motivo: null } }));
      }
      if (p === '/marketing/clube') return responder(route, { config: { surpresaAtivo: false }, gatilhos: {}, premios: [] });
      if (p === '/campanhas' || p.startsWith('/campanhas/') || p.startsWith('/clientes/crm') || p.startsWith('/whatsapp/cloud/templates')) return responder(route, []);
      return responder(route, {});
    });
    await page.goto(`${base}/marketing`);
    await page.getByRole('button', { name: /^Automáticas/ }).click({ timeout: 30000 });
    await page.waitForSelector('text=Para todas as automáticas', { timeout: 15000 });
    return { ctx, page, erros, salvos, modelos };
  }
  const publico = (page) => page.locator('[data-publico-inicio-mes]');
  const verQuem = (page) => page.getByRole('button', { name: 'Ver quem recebe o início do mês' });

  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, 900);
    await publico(page).waitFor({ timeout: 15000 });
    ok((await publico(page).innerText()).includes('12 com o selo · 3 com o aceite de ofertas clicado'), `${w}px · o público de verdade`);
    ok((await page.locator('[data-previa-inicio-mes]').innerText()).replace(/\s+/g, ' ').includes('De 01/12 a 05/12: 3 clientes'), `${w}px · a prévia com a janela`);
    const semDialogo = await medir(page);
    ok(semDialogo.length === 0, `${w}px · grupo sem barra para o lado nem texto esmagado${semDialogo.length ? ` (${umaLinha(semDialogo.join(' | '))})` : ''}`);
    await verQuem(page).click();
    const dlg = page.locator('[role="dialog"]');
    await dlg.waitFor({ timeout: 15000 });
    await dlg.getByText('Marina L.').waitFor({ timeout: 15000 });
    ok((await dlg.innerText()).includes('quem já pediu no mês'), `${w}px · o diálogo diz quem fica de fora`);
    const comDialogo = await medir(page);
    ok(comDialogo.length === 0, `${w}px · diálogo sem barra para o lado nem texto esmagado${comDialogo.length ? ` (${umaLinha(comDialogo.join(' | '))})` : ''}`);
    if (w === 390 || w === 1440) await dlg.screenshot({ path: arquivoFoto(`inicio-mes-dialogo-${w}.png`) });
    await page.keyboard.press('Escape');
    await dlg.waitFor({ state: 'detached', timeout: 15000 });
    if (w === 390 || w === 1440) await publico(page).locator('xpath=ancestor::*[contains(., "📅 Início do mês")][1]').screenshot({ path: arquivoFoto(`inicio-mes-${w}.png`) });
    ok(erros.length === 0, `${w}px · nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    await ctx.close();
  }

  {
    const { ctx, page } = await abrir(390, 800, { comSelo: 0, comAceite: 0, total: 0 });
    await publico(page).waitFor({ timeout: 15000 });
    ok((await publico(page).innerText()).includes('Ninguém tem o selo'), 'sem selo: a tela diz o motivo');
    ok(await verQuem(page).isDisabled(), 'sem ninguém: o "Ver quem" fica desligado');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(390, 800, { comSelo: 4, comAceite: 0, total: 0 });
    await publico(page).waitFor({ timeout: 15000 });
    ok((await publico(page).innerText()).includes('4 clientes têm o selo, nenhum com o aceite de ofertas clicado'), 'com selo e sem aceite: a tela diz o motivo');
    await ctx.close();
  }
  {
    const { ctx, page, salvos, modelos } = await abrir(1280, 900);
    await publico(page).waitFor({ timeout: 15000 });
    const chave = page.getByRole('switch', { name: /Lembrar quem pede mais no começo do mês/ });
    ok((await chave.getAttribute('aria-checked')) === 'false', 'a chave nasce desligada');
    await chave.click();
    await page.getByRole('button', { name: 'Salvar alterações' }).click();
    await page.waitForFunction(() => document.body.innerText.includes('Automáticas salvas'), null, { timeout: 15000 });
    ok(salvos.length === 1 && JSON.stringify(salvos[0]) === '{"inicioMesAtivo":true}', `ligar e salvar manda só a chave (${umaLinha(JSON.stringify(salvos[0] ?? null))})`);
    const grupo = publico(page).locator('xpath=ancestor::*[contains(., "📅 Início do mês")][1]');
    await grupo.getByRole('button', { name: 'Enviar à Meta' }).click();
    await grupo.getByText('Em análise na Meta').waitFor({ timeout: 15000 });
    ok(modelos.length === 1 && modelos[0] === 'inicio_mes', 'o "Enviar à Meta" chama o modelo inicio_mes');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { perfil: false });
    ok((await page.getByText('📅 Início do mês').count()) === 0, 'sem o módulo do perfil, o grupo não aparece');
    await ctx.close();
  }
}
