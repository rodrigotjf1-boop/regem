// Roteiro de tela de DELIVERY › CLIENTES com o perfil do cliente (F7 parte 1 e F3 parte 2 do `docs/plano-perfil-cliente.md`).
// A API simulada. Confere:
//  • em cada largura: as abas "Pelo perfil" (com as contas do resumo), escolher "Pedem no dinheiro no bolso" pede a lista
//    com `segmento=perfil_dinheiro` e mostra a nota do aceite clicado; a ficha do cliente ABERTA (gaveta) com a camada
//    "O que move o cliente" (o selo, "dados insuficientes") — nenhuma barra para o lado nem texto esmagado (V45);
//  • a supervisão (vê a lista, não o perfil): sem as abas e sem ler o resumo do perfil.
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', nome: 'Ana' });
const SUPERVISAO = tokenFalso({ cat: 'supervisao', perfil: 'supervisao', nome: 'Sil' });
const ha = (d) => new Date(Date.now() - d * 86_400_000).toISOString();

const CLIENTES = [
  { id: 'c1', nome: 'Ana Souza', telefone: '21988880001', total_pedidos: 14, total_gasto: 702.5, ultimo_pedido_em: ha(3), canais: ['cardapio_web'] },
  { id: 'c2', nome: 'Bruno Lima com um nome bem comprido para quebrar a linha no celular', telefone: '21988880002', total_pedidos: 3, total_gasto: 120, ultimo_pedido_em: ha(40), canais: ['whatsapp'] },
];
const FICHA = {
  cliente: { id: 'c1', nome: 'Ana Souza', telefone: '21988880001', desde: ha(120) },
  situacao: 'com_perfil',
  perfil: {
    pedidos_diretos: 14, primeiro_pedido_em: ha(120), ultimo_pedido_em: ha(3), segmento: 'campeoes', rfm: '333',
    ticket_medio: 50.18, ticket_ajustado: 49.9, intervalo_dias: 8.2, proximo_previsto: ha(-5).slice(0, 10), atraso: 0.4,
    faixa_habitual: 'noite', dia_habitual: 5, confianca: 'alta', etiquetas: ['campeao'], calculado_em: ha(0),
    camadas: { gosto: { favoritos: [{ nome: 'Smash duplo', pedidos: 9 }], pagamento: 'Pix', retirada_pct: 10 }, ritmo: { grade: {}, hora_habitual: '21:10' }, reclamacoes: {}, avaliacoes: {}, porque: {} },
  },
  declarado: [],
  escolhas: [],
  sensibilidade: [
    { tipo: 'dinheiro', rr: 2.1, prob: 0.97, pedidos: 8, esperado: 3.8, dias_com_pedido: 6, selo: true },
    { tipo: 'feriado', rr: 1.3, prob: 0.71, pedidos: 2, esperado: 1.5, dias_com_pedido: 2, selo: false },
  ],
};

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
    for (const el of document.querySelectorAll('main p, main button, [role="dialog"] p, [role="dialog"] li span')) {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      if (r.width > 0 && r.width < 60 && r.height > lh * 3.2 && (el.textContent || '').trim().length > 12)
        achados.push(`esmagado ${el.tagName.toLowerCase()} ${Math.round(r.width)}px: ${(el.textContent || '').trim().slice(0, 24)}`);
    }
    return achados;
  });
const texto = (page, sel = 'main') => page.evaluate((s) => document.querySelector(s)?.innerText.replace(/\s+/g, ' ') ?? '', sel);

export default async function roteiroClientesPerfil({ nav, base, ok, foto: arquivoFoto, larguras }) {
  async function abrir(w, h, jwt = PRESIDENTE) {
    const consultas = [];
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((t) => localStorage.setItem('regen_token', t), jwt);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname.replace(/^.*\/api\/v1/, '');
      consultas.push(p + u.search);
      if (p === '/modulos/meus') return responder(route, { perfil_cliente: true });
      if (p === '/clientes/crm/resumo') return responder(route, { total: 2, mes: 1, d30: 1, sem30: 1, sem60: 0, campeoes: 1, importados: 0 });
      if (p === '/clientes/crm') return responder(route, CLIENTES);
      if (p === '/perfil-cliente/resumo')
        return responder(route, { segmentos: { campeoes: 12, leais: 30, recentes: 8, atencao: 15, em_risco: 9, inativos: 40 }, etiquetas: { atrasado: 6 }, selos: { dinheiro: 7 }, total: 114 });
      if (p === '/perfil-cliente/c1') return responder(route, FICHA);
      if (p.startsWith('/clientes/crm/') || p.startsWith('/campanhas')) return responder(route, []);
      return responder(route, {});
    });
    await page.goto(base + '/clientes');
    return { ctx, page, erros, consultas };
  }

  for (const w of larguras) {
    const { ctx, page, erros, consultas } = await abrir(w, 900);
    await page.waitForSelector('text=Pelo perfil', { timeout: 30000 });
    await page.waitForSelector('text=Pedem no dinheiro no bolso', { timeout: 10000 });
    let achados = await medir(page);
    ok(achados.length === 0, `${w}px · Clientes com as abas pelo perfil: sem barra para o lado nem texto esmagado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    let t = await texto(page);
    ok(t.includes('Campeões') && t.includes('Atrasados no próprio ritmo') && !t.includes('Pedem em feriado'), `${w}px · as abas: os 6 do RFM, o ritmo e só os selos com gente`);
    await page.getByRole('button', { name: /^Pedem no dinheiro no bolso/ }).click();
    await page.waitForTimeout(400);
    t = await texto(page);
    ok(consultas.some((c) => c.startsWith('/clientes/crm?') && c.includes('segmento=perfil_dinheiro')), `${w}px · a aba pede a lista com segmento=perfil_dinheiro`);
    ok(t.includes('só alcançam quem aceitou receber ofertas com um clique'), `${w}px · a nota do aceite clicado aparece`);
    // A ficha ABERTA: o detalhe do cliente e "Ver perfil do cliente".
    await page.getByText('Ana Souza').first().click();
    await page.getByRole('button', { name: 'Ver perfil do cliente' }).click();
    await page.waitForSelector('text=O que move o cliente', { timeout: 10000 });
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · ficha aberta: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    const ficha = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText.replace(/\s+/g, ' ')).join(' '));
    ok(ficha.includes('Pede 2,1× o normal nesses dias') && ficha.includes('Pede no dinheiro no bolso') && ficha.includes('dados insuficientes (2 de 3 dias com pedido)'), `${w}px · "O que move o cliente": o selo e o "dados insuficientes"`);
    if (w === 390 || w === 1440) {
      const gav = page.locator('[role="dialog"]').last();
      await gav.screenshot({ path: arquivoFoto(`clientes-perfil-ficha-${w}.png`) });
    }
    ok(erros.length === 0, `${w}px · nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    await ctx.close();
  }

  {
    // A supervisão vê a lista, mas não o perfil.
    const { ctx, page, consultas } = await abrir(1280, 900, SUPERVISAO);
    await page.waitForSelector('text=Ana Souza', { timeout: 30000 });
    await page.waitForTimeout(500);
    const t = await texto(page);
    ok(!t.includes('Pelo perfil') && !consultas.some((c) => c.startsWith('/perfil-cliente')), 'supervisão: sem as abas pelo perfil e sem ler o resumo do perfil');
    await ctx.close();
  }
}
