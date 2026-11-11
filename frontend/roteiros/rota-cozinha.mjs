// Roteiro de tela da Rota da cozinha (/rota-cozinha — auditoria do KDS, onda 2, mig 410; protótipo
// `mockups/regem-kds-cozinha.html`, aba 2): a API simulada. Confere a rota, as notas, as impressoras, "Editar a ordem"
// (antes, depois, junto, incluir, renomear, arrastar), a recusa do despacho fora do fim, o diálogo de salvar e o corpo
// que vai ao servidor, o simulador, a gaveta do KDS, a loja com servidor (só mostra) e as larguras com a edição, o diálogo
// e a gaveta abertos: sem barra lateral, sem corte e toque ≥ 44 px.
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: { producao_kds: { ver: true } } });
const K = (id, nome, o = {}) => ({ id, nome, escopo: 'producao', ativo: true, proximoKdsId: null, unidadeId: 'u1', imprimeAoAvancar: false, imprimeNoStatus: 'pronto', impressoraDestinoId: null, impressora: null, produtos: 0, ...o });
function rotaInicial() {
  return {
    loja: 'u1',
    etapas: [{ nome: 'Preparo', kds: ['chapa', 'frita'] }, { nome: '', kds: ['mont'] }, { nome: 'Saída', kds: ['desp'] }],
    kds: [
      K('chapa', 'Chapa', { proximoKdsId: 'mont', produtos: 14 }),
      K('frita', 'Fritadeira', { ativo: false, proximoKdsId: 'desp', produtos: 6 }),
      K('mont', 'Montagem', { proximoKdsId: 'desp', produtos: 3, imprimeAoAvancar: true, imprimeNoStatus: 'pronto', impressora: 'Impressora do balcão' }),
      K('desp', 'Despacho', { escopo: 'despacho', produtos: 5, imprimeAoAvancar: true, imprimeNoStatus: 'entregue', impressora: 'Impressora do balcão' }),
      K('sobre', 'Sobremesas com nome bem comprido para quebrar a linha', { produtos: 3 }),
    ],
    tvs: [{ id: 'tv1', nome: 'TV do balcão' }],
    estacoes: true,
    padrao: { id: 'imp1', nome: 'Impressora da cozinha' },
    duplicados: [{ produto: 'X-Burger', kds: ['chapa', 'mont'] }],
    editavel: true,
    motivo: null,
  };
}
const PRODUTOS = [
  { id: 'p1', nome: 'X-Burger', vaiParaProducao: true, categoriaNome: 'Lanches' },
  { id: 'p2', nome: 'Petit gâteau', vaiParaProducao: true, categoriaNome: 'Sobremesas' },
  { id: 'p3', nome: 'Água', vaiParaProducao: false, categoriaNome: 'Bebidas' },
];

// Barra lateral, corte e toque pequeno (só o que está visível e não esmaecido).
const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      if (el.clientWidth > 1 && cs.overflowX === 'hidden' && el.scrollWidth > el.clientWidth + 1 && el.textContent.trim() && !el.closest('nav,aside'))
        achados.push(`corta ${el.tagName.toLowerCase()} "${el.textContent.trim().slice(0, 30)}"`);
    }
    for (const b of document.querySelectorAll('main button, main select, main input, [role="dialog"] button, [role="alertdialog"] button')) {
      // caixinha e rádio: a área de toque é o rótulo que os envolve
      const alvo = /^(checkbox|radio)$/.test(b.getAttribute('type') || '') && b.closest('label') ? b.closest('label') : b;
      const r = alvo.getBoundingClientRect();
      if (!r.width || b.closest('[inert]')) continue;
      if (r.height < 43.5) achados.push(`toque ${Math.round(r.height)}px "${(b.textContent || b.getAttribute('aria-label') || '').trim().slice(0, 25)}"`);
    }
    return achados;
  });

export default async function roteiroRotaCozinha({ nav, base, ok, foto, larguras }) {
  const S = { rota: rotaInicial(), salvo: null, simulou: null };
  async function abrir(w, h, mexer = (r) => r) {
    S.rota = mexer(rotaInicial());
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const p = u.pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/producao/kds/rota' && req.method() === 'GET') return responder(route, S.rota);
      if (p === '/producao/kds/rota' && req.method() === 'PUT') {
        S.salvo = JSON.parse(req.postData() || '{}');
        S.rota = { ...S.rota, etapas: S.salvo.etapas, kds: S.rota.kds.map((k) => (k.id in S.salvo.vai ? { ...k, proximoKdsId: S.salvo.vai[k.id] } : k)) };
        return responder(route, S.rota);
      }
      if (p === '/producao/kds/rota/simular') {
        S.simulou = u.searchParams.get('produtoId');
        if (S.simulou === 'p1')
          return responder(route, { produto: { id: 'p1', nome: 'X-Burger' }, vaiParaProducao: true, estacoes: true, caminhos: [{ inicio: 'chapa', passos: ['chapa', 'mont', 'desp'] }, { inicio: 'mont', passos: ['mont', 'desp'] }], impressoras: [] });
        return responder(route, { produto: { id: 'p2', nome: 'Petit gâteau' }, vaiParaProducao: true, estacoes: true, caminhos: [], impressoras: [{ id: 'imp1', nome: 'Impressora da cozinha', padrao: true }] });
      }
      if (p === '/produtos/direcionamento') return responder(route, PRODUTOS);
      if (/^\/producao\/kds\/[^/]+\/produtos$/.test(p)) return responder(route, { produtoIds: ['p1'] });
      if (p === '/unidades') return responder(route, [{ id: 'u1', nome: 'Centro' }]);
      return responder(route, {});
    });
    await page.goto(base + '/rota-cozinha');
    await page.waitForSelector('text=Por onde o pedido passa?', { timeout: 25000 });
    return { ctx, page, erros };
  }
  const texto = (page) => page.locator('main').innerText();

  let { ctx, page, erros } = await abrir(1280, 900);
  // ── a rota como está ──
  let t = await texto(page);
  ok(/1 · Preparo/i.test(t) && /2 · Etapa 2/i.test(t) && /3 · Saída/i.test(t), 'as etapas numeradas, com o nome ou "Etapa N"');
  ok(/Estações ligadas nesta loja/.test(t) && /Impressora da cozinha/.test(t), 'nota do modo estações com a padrão');
  ok(/X-Burger está marcado em Chapa e Montagem/.test(t) && /Como Chapa manda para Montagem, Montagem recebe X-Burger duas vezes/.test(t), 'nota do produto em dois KDS');
  ok(/Fritadeira desligado:.*passa direto para Despacho/.test(t), 'nota do desligado pulado');
  ok(/Fora da rota:.*Sobremesas/.test(t), 'nota dos ligados fora da rota');
  ok(/Vai para Montagem/.test(t) && /Sim, ao ficar pronto, na Impressora do balcão/.test(t) && /Recebe de\s*Chapa/.test(t), 'cada KDS: vai para, imprime, recebe de');
  ok(/Impressora do balcão\s*Imprime ao avançar: Montagem \(ao ficar pronto\), Despacho \(ao despachar\)/.test(t), 'impressoras da rota');
  const ys = await page.locator('main h3').evaluateAll((hs) => hs.filter((h) => /^\d · |^Cliente/.test(h.textContent.trim())).map((h) => Math.round(h.getBoundingClientRect().top)));
  ok(ys.length === 4 && new Set(ys).size === 1, `1280: as 4 colunas lado a lado (${ys.join(',')})`);
  await page.screenshot({ path: foto('1280.png'), fullPage: true });

  // ── simulador ──
  await page.getByLabel('Produto', { exact: true }).selectOption('p1');
  await page.waitForSelector('text=TV: Pronto');
  t = await texto(page);
  ok(S.simulou === 'p1' && /Marcado em 2 KDS/.test(t) && /Montagem recebe este produto direto e também o cartão que chega de Chapa: sai duas vezes/.test(t), 'simulador: caminhos e o aviso de sair duas vezes');
  await page.getByLabel('Produto', { exact: true }).selectOption('p2');
  await page.waitForSelector('text=Nenhum KDS marcou este produto: sai em papel.');
  ok(true, 'simulador: o papel na padrão');

  // ── gaveta do KDS ──
  await page.click('button:has-text("Editar Chapa")');
  await page.waitForSelector('#kds-produtos-titulo, [aria-labelledby="kds-produtos-titulo"]', { timeout: 8000 });
  ok(true, '"Editar Chapa" abre a gaveta Configurar este KDS');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[aria-labelledby="kds-produtos-titulo"]', { state: 'detached' });

  // ── editar a ordem ──
  await page.click('button:has-text("Editar a ordem")');
  await page.waitForSelector('[aria-label="Editando a ordem da rota"]');
  ok(await page.evaluate(() => document.activeElement?.textContent?.includes('Salvar a ordem')), 'o foco vai para "Salvar a ordem"');
  ok((await page.locator('[inert] >> text=Por onde o pedido passa?').count()) === 1, 'o simulador fica esmaecido (inert) durante a edição');
  // Chapa "Depois": divide a etapa 1 (Chapa sai da Fritadeira)
  await page.click('[aria-label="Mover Chapa para depois"]');
  t = await texto(page);
  ok(/1 · Preparo[\s\S]*Fritadeira[\s\S]*2 · Etapa 2[\s\S]*Chapa[\s\S]*3 · Etapa 3[\s\S]*Montagem/i.test(t), 'Chapa "Depois" abre uma etapa só dela');
  // Junto com: Chapa junto da Montagem
  await page.locator('article[aria-label="Chapa, etapa 2"] button:has-text("Junto com")').click();
  await page.locator('[aria-label="Pôr Chapa na mesma etapa de outro KDS"] button:has-text("Montagem")').click();
  ok((await page.locator('article[aria-label="Chapa, etapa 2"]').count()) === 1 && (await page.locator('article[aria-label="Montagem, etapa 2"]').count()) === 1, 'Junto com Montagem: os dois na etapa 2');
  // Incluir Sobremesas
  await page.click('button:has-text("Incluir KDS na rota")');
  await page.locator('[aria-label="KDS ligados fora da rota"] button').first().click();
  ok((await page.locator('article[aria-label^="Sobremesas"][aria-label$="etapa 1"]').count()) === 1, 'Incluir: Sobremesas entra na etapa 1');
  // Renomear a etapa 1
  await page.click('[aria-label="Renomear a etapa 1"]');
  await page.fill('[aria-label^="Nome da etapa 1"]', 'Fritura e doces');
  await page.keyboard.press('Enter');
  ok(/1 · Fritura e doces/i.test(await texto(page)), 'renomear a etapa 1');
  // Despacho "Antes": não vale — o bloco avisa e o salvar recusa com o motivo do servidor
  await page.click('[aria-label="Mover Despacho para antes"]');
  ok(/O despacho só pode ficar na última etapa: assim não dá para salvar/.test(await texto(page)), 'o despacho fora do fim avisa no bloco');
  await page.click('button:has-text("Salvar a ordem")');
  let dlg = await page.locator('[role="dialog"]').last().innerText();
  ok(/Não dá para salvar esta ordem/.test(dlg) && /O Despacho é o despacho e só pode ficar na última etapa/.test(dlg), `recusa com o motivo: ${umaLinha(dlg)}`);
  const m0 = await medir(page);
  ok(m0.length === 0, `1280 diálogo de recusa: ${m0.slice(0, 3).join(' | ')}`);
  await page.click('button:has-text("Voltar e corrigir")');
  await page.click('[aria-label="Mover Despacho para depois"]');
  // Arrastar: Montagem para a etapa 1
  await page.locator('article[aria-label="Montagem, etapa 2"]').dragTo(page.locator('main h3:has-text("1 · Fritura e doces")'));
  ok((await page.locator('article[aria-label="Montagem, etapa 1"]').count()) === 1, 'arrastar Montagem para a etapa 1');
  // Arrastar o despacho para fora do fim é recusado
  await page.locator('article[aria-label^="Despacho"]').dragTo(page.locator('main h3:has-text("1 · Fritura e doces")'));
  ok((await page.locator('article[aria-label^="Despacho"][aria-label$="etapa 1"]').count()) === 0, 'arrastar o despacho para fora do fim é recusado');
  // Chapa termina aqui (escolha na lista)
  await page.selectOption('#vai-chapa', '');
  // Salvar
  await page.click('button:has-text("Salvar a ordem")');
  dlg = await page.locator('[role="dialog"]').last().innerText();
  ok(/Salvar a nova ordem da rota\?/.test(dlg) && /Chapa:/.test(dlg) && /Etapas:/.test(dlg) && /também dos que já estão na tela/.test(dlg), `diálogo de salvar: ${umaLinha(dlg, 200)}`);
  await page.screenshot({ path: foto('1280-salvar.png') });
  await page.locator('[role="dialog"] button:has-text("Salvar a ordem")').click();
  await page.waitForSelector('[aria-label="Editando a ordem da rota"]', { state: 'detached' });
  const e = S.salvo?.etapas ?? [];
  ok(e.length >= 2 && e[0].nome === 'Fritura e doces' && e.at(-1).kds.includes('desp') && e[0].kds.includes('mont'), `o corpo salvo: ${JSON.stringify(e)}`);
  ok(S.salvo?.vai?.chapa === null && S.salvo?.vai?.desp === null && S.salvo?.vai?.mont === 'desp' && Object.keys(S.salvo?.vai ?? {}).length === 5, `o "vai para" salvo: ${JSON.stringify(S.salvo?.vai)}`);
  ok(/Fritura e doces/i.test(await texto(page)), 'depois de salvar, a rota nova aparece');
  ok(erros.length === 0, `sem erro na página (${erros.join(' | ')})`);
  await ctx.close();

  // ── servidor da loja ligado: só mostra ──
  ({ ctx, page, erros } = await abrir(1024, 800, (r) => ({ ...r, editavel: false, motivo: 'Com o servidor da loja ligado, a rota se ajusta no próprio servidor (abra o Regem pela rede da loja).' })));
  ok(await page.locator('button:has-text("Editar a ordem")').isDisabled(), 'servidor da loja ligado: "Editar a ordem" desligado');
  ok(/a rota se ajusta no próprio servidor/.test(await texto(page)) && (await page.locator('button:has-text("Editar Chapa")').count()) === 0, 'servidor da loja ligado: o motivo aparece e os KDS não se editam');
  await ctx.close();

  // ── cada largura: a rota, a edição, o diálogo de salvar e a gaveta ──
  for (const w of larguras) {
    ({ ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900));
    const a = await medir(page);
    await page.click('button:has-text("Editar a ordem")');
    await page.waitForSelector('[aria-label="Editando a ordem da rota"]');
    await page.locator('article[aria-label^="Chapa"] button:has-text("Junto com")').click();
    await page.click('button:has-text("Incluir KDS na rota")');
    await page.waitForSelector('[aria-label="KDS ligados fora da rota"] button');
    const b = await medir(page);
    await page.click('[aria-label="Mover Chapa para depois"]');
    await page.click('button:has-text("Salvar a ordem")');
    await page.waitForSelector('[role="dialog"]');
    const c = await medir(page);
    await page.keyboard.press('Escape');
    await page.click('button:has-text("Cancelar")');
    await page.click('button:has-text("Editar Montagem")');
    await page.waitForSelector('[aria-labelledby="kds-produtos-titulo"]');
    const d = await medir(page);
    const todos = [...a, ...b, ...c, ...d];
    ok(todos.length === 0, `${w}: rota, edição, diálogo e gaveta sem barra lateral, corte ou toque pequeno ${todos.slice(0, 4).join(' | ')}`);
    if (w === 375) {
      await page.keyboard.press('Escape');
      await page.click('button:has-text("Editar a ordem")');
      await page.screenshot({ path: foto('375-editar.png'), fullPage: true });
    }
    ok(erros.length === 0, `${w}: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
