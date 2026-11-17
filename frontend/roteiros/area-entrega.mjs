// Roteiro de tela da ÁREA DE ENTREGA (Delivery › Configurações › Área de atendimento — mig 425; protótipo
// `mockups/regem-area-entrega-mapa.html`, aprovado pelo dono em 15/11/2026). A API é simulada com as regras do servidor
// (o modo mapa só entra com uma área no ar; a recusa da lista volta com a mensagem). O fundo do mapa vem vazio (nada de
// rede); as áreas são desenhadas em SVG pela Leaflet. Confere: os três modos (bairro, distância, desenhada) com a troca
// gravada; desenhar uma área clicando os cantos no mapa e fechando no primeiro; a gaveta; salvar a lista inteira e ligar o
// modo; "Testar um endereço" dentro e fora; converter as faixas; a ordem; apagar com confirmação; a recusa do servidor; e as
// 16 larguras com a gaveta e o diálogo abertos (nenhuma barra lateral).
import { fotoDoComoFaco, responder, tokenFalso, umaLinha } from './comum.mjs';

const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: { loja: { ver: true, editar: true }, delivery: { ver: true } } });
const LOJA = { lat: -22.8436, lng: -43.2784 };
const PNG_VAZIO = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function servidor() {
  return {
    config: { id: 'c1', areaModo: 'bairro', raios: [{ ateKm: 1, taxa: 5 }, { ateKm: 2, taxa: 7 }], endLat: String(LOJA.lat), endLng: String(LOJA.lng), ativo: true, modo: 'delivery' },
    bairros: [{ id: 'b1', nome: 'Penha', taxa: 5, ativo: true }],
    areas: [],
    putsConfig: [],
    putsAreas: [],
    recusarAreas: null,
  };
}

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && !el.closest('.leaflet-container'))
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    for (const d of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
      const r = d.getBoundingClientRect();
      if (r.left < -1 || r.right > window.innerWidth + 1) achados.push(`painel fora da tela ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    return achados;
  });

export default async function roteiroAreaEntrega({ nav, base, ok, foto, larguras }) {
  async function abrir(w, h, S = servidor()) {
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: false });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG_VAZIO }));
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      const corpo = req.postData() ? JSON.parse(req.postData()) : null;
      if (p === '/cardapio/config' && req.method() === 'PUT') {
        S.putsConfig.push(corpo);
        if (corpo?.areaModo === 'mapa' && !S.areas.some((a) => a.ativo))
          return responder(route, { statusCode: 400, message: 'Desenhe e deixe no ar pelo menos uma área antes de usar o modo "Desenhada no mapa".' }, 400);
        S.config = { ...S.config, ...corpo };
        return responder(route, S.config);
      }
      if (p === '/cardapio/config') return responder(route, S.config);
      if (p === '/cardapio/bairros') return responder(route, S.bairros);
      if (p === '/cardapio/areas-entrega' && req.method() === 'PUT') {
        S.putsAreas.push(corpo);
        if (S.recusarAreas) return responder(route, { statusCode: 400, message: S.recusarAreas }, 400);
        S.areas = (corpo?.areas ?? []).map((a, i) => ({ ...a, id: `srv-${i}`, ordem: i }));
        return responder(route, S.areas);
      }
      if (p === '/cardapio/areas-entrega') return responder(route, S.areas);
      if (/banners|cupons|regras-sinal|formas|impressoras|integrac|numeros|robo|eventos|fidelidade|cashback/.test(p)) return responder(route, []);
      return responder(route, {});
    });
    await page.goto(base + '/delivery/configuracoes?aba=area');
    await page.waitForSelector('[role="radiogroup"][aria-label="Como a loja entrega"]', { timeout: 20000 });
    return { ctx, page, erros, S };
  }
  const mapaBox = async (page) => {
    await page.waitForSelector('.leaflet-container', { timeout: 15000 });
    await page.waitForTimeout(400);
    return page.locator('.leaflet-container').boundingBox();
  };
  async function desenhar(page, fracoes) {
    const b = await mapaBox(page);
    await page.click('button:has-text("＋ Nova área")');
    await page.waitForTimeout(250);
    for (const [fx, fy] of fracoes) {
      await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
      await page.waitForTimeout(120);
    }
    await page.mouse.click(b.x + b.width * fracoes[0][0], b.y + b.height * fracoes[0][1]); // fecha no primeiro canto
    await page.waitForTimeout(300);
  }

  // ── os três modos ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 1000);
    const cards = await page.locator('[role="radiogroup"] [role="radio"]').allInnerTexts();
    ok(cards.length === 3 && /Por bairro/.test(cards[0]) && /Por distância/.test(cards[1]) && /Desenhada no mapa/.test(cards[2]), `os três modos (${cards.map((c) => umaLinha(c, 30)).join(' | ')})`);
    ok(/valendo/.test(cards[0]), 'o modo de hoje marcado "valendo" (bairro)');
    // M3d: a imagem do "como faço" — 1: Delivery › Configurações no menu; 2: a aba "Área de atendimento"; 3: os três modos.
    const comoFaco = await fotoDoComoFaco(page, 'taxa-e-area', [
      page.locator('aside a[href="/delivery/configuracoes"] >> visible=true').first(),
      page.locator('main button:has-text("Área de atendimento") >> visible=true').first(),
      page.locator('[role="radiogroup"][aria-label="Como a loja entrega"]').first(),
    ]);
    ok(comoFaco.achou.every(Boolean), `como faço (taxa-e-area): as marcas estão na tela (${comoFaco.achou.join(', ')})${comoFaco.gerou ? ' — imagem gerada' : ''}`);
    ok(await page.locator('text=Bairro + taxa').isVisible(), 'por bairro: a lista dos bairros');
    await page.click('[role="radio"]:has-text("Por distância")');
    await page.waitForTimeout(500);
    ok(S.putsConfig.some((c) => c.areaModo === 'raio'), 'trocar para distância grava o modo na hora');
    ok(await page.locator('text=Faixas de distância a partir do endereço da loja').isVisible(), 'por distância: as faixas');
    // O mapa das faixas (15/11, o dono: "o mapa está limitado numa área pequena"): alto, e o círculo MAIOR inteiro nele.
    await page.waitForTimeout(700);
    const faixas = await page.evaluate(() => {
      const mapa = document.querySelector('[data-mapa-faixas]');
      if (!mapa) return null;
      const m = mapa.getBoundingClientRect();
      const circulos = [...mapa.querySelectorAll('path.leaflet-interactive')].map((p) => p.getBoundingClientRect()).filter((r) => r.width > 0);
      const maior = circulos.sort((a, b) => b.width - a.width)[0];
      const rotulos = [...mapa.querySelectorAll('.leaflet-marker-pane span')].map((s) => s.textContent);
      return {
        altura: Math.round(m.height),
        cabe: !!maior && maior.top >= m.top - 1 && maior.bottom <= m.bottom + 1 && maior.left >= m.left - 1 && maior.right <= m.right + 1,
        ocupa: maior ? Math.round((maior.height / m.height) * 100) : 0,
        rotulos,
      };
    });
    ok(!!faixas && faixas.altura >= 320, `o mapa das faixas é alto (${faixas?.altura}px)`);
    ok(!!faixas && faixas.cabe, `o círculo maior cabe inteiro no mapa (ocupa ${faixas?.ocupa}% da altura)`);
    ok(!!faixas && faixas.ocupa >= 60, `o círculo maior não fica minúsculo (${faixas?.ocupa}% da altura)`);
    ok(!!faixas && faixas.rotulos.join('|') === 'até 1 km · R$ 5,00|até 2 km · R$ 7,00'.replace(/R\$ /g, 'R$ '), `o rótulo de cada faixa no mapa (${faixas?.rotulos.join(' | ')})`);
    await page.click('[role="radio"]:has-text("Desenhada no mapa")');
    await page.waitForTimeout(600);
    ok(!S.putsConfig.some((c) => c.areaModo === 'mapa'), 'escolher "Desenhada no mapa" sem área NÃO grava o modo (o servidor recusaria)');
    ok(await page.locator('text=Este modo ainda não está valendo').isVisible(), 'o aviso de que o modo ainda não vale');
    ok(await page.locator('text=Nenhuma área desenhada ainda').isVisible(), 'a lista vazia com o que fazer');
    ok(await page.locator('.leaflet-container').isVisible(), 'o mapa aparece');
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── M3d: as imagens do "como faço" das outras abas de Delivery › Configurações — 1: o menu; 2: a aba; 3: o campo
  //    principal dela (só gera com GERAR_COMO_FACO=1; sem a variável, confere que cada marca está na tela e na frente) ──
  {
    const { ctx, page, erros } = await abrir(1280, 900);
    const menu = page.locator('aside a[href="/delivery/configuracoes"] >> visible=true').first();
    const ABAS = [
      ['horario', 'Horários', 'text=Mesmo horário para delivery e retirada/consumo no local'],
      // o campo, não o rótulo (o selo do número cobria a primeira letra do rótulo)
      ['tempo-de-entrega', 'Cardápio', (p) => p.locator('main').getByLabel('Tempo de entrega (min)', { exact: true })],
      ['cupom-desconto', 'Cupons', 'button:has-text("Adicionar cupom")'],
      // "Robô de atendimento" e "Atendimento" leem várias rotas (números do WhatsApp, pausa, avisos) que este roteiro não
      // simula — com o {} genérico a tela cai. As imagens delas esperam um roteiro que simule essas rotas.
    ];
    for (const [id, nomeDaAba, chave] of ABAS) {
      const aba = page.locator(`main button:text-is("${nomeDaAba}") >> visible=true`).first();
      await aba.click();
      const alvo = (typeof chave === 'function' ? chave(page) : page.locator('main').locator(chave)).first();
      await alvo.waitFor({ timeout: 8000 }).catch(() => {});
      const r = await fotoDoComoFaco(page, id, [menu, aba, alvo]);
      ok(r.achou.every(Boolean), `como faço (${id}): as marcas estão na tela (${r.achou.join(', ')})${r.gerou ? ' — imagem gerada' : ''}${(r.motivos ?? []).filter(Boolean).length ? ` — ${r.motivos.join(' | ')}` : ''}`);
    }
    // O rótulo de cada campo das configurações é LIGADO ao campo (o <Label> ficava solto: nenhum campo tinha nome
    // acessível). Na aba "Cardápio": os campos de texto pelo rótulo; o botão "Editar tema" num grupo com o nome do rótulo.
    await page.locator('main button:text-is("Cardápio") >> visible=true').first().click();
    const main = page.locator('main');
    const pelosRotulos = await Promise.all(['Tempo de entrega (min)', 'Tempo de retirada (min)', 'Subtítulo'].map((n) => main.getByLabel(n, { exact: true }).count()));
    ok(pelosRotulos.every((n) => n === 1), `configurações: cada campo achado pelo rótulo (${pelosRotulos.join(', ')})`);
    ok((await main.getByRole('group', { name: 'Aparência do cardápio', exact: true }).count()) === 1, 'configurações: o rótulo do botão vira o nome do grupo (clicar nele não abre o editor)');
    ok(erros.length === 0, `como faço (abas): sem erro de script (${umaLinha(erros.join(' | '))})`);
    await ctx.close();
  }

  // ── desenhar, a gaveta, salvar e ligar o modo; testar um ponto ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 1000);
    await page.click('[role="radio"]:has-text("Desenhada no mapa")');
    await desenhar(page, [[0.35, 0.3], [0.65, 0.3], [0.65, 0.7], [0.35, 0.7]]);
    const gaveta = page.locator('[role="dialog"]');
    ok(await gaveta.isVisible(), 'fechar o desenho abre a gaveta da área nova');
    ok(/Nova área/.test(await gaveta.innerText()), 'a gaveta se chama "Nova área"');
    await page.fill('#area-nome', 'Centro');
    const taxa = gaveta.locator('input[aria-label="Taxa de entrega"]');
    await taxa.click();
    await taxa.press('Control+A');
    await taxa.type('600');
    await page.fill('#area-de', '25');
    await page.fill('#area-ate', '35');
    await page.screenshot({ path: foto('1280-gaveta-nova.png') });
    await page.click('[role="dialog"] button:has-text("Salvar área")');
    await page.waitForTimeout(300);
    const lista = await page.locator('section[aria-labelledby="titulo-areas"]').innerText();
    ok(/Centro/.test(lista) && /R\$\s6,00/.test(lista) && /25–35 min/.test(lista), `a área na lista (${umaLinha(lista, 120)})`);
    ok(await page.locator('text=Há alterações ainda não salvas nas áreas').isVisible(), 'a barra de alterações não salvas');
    await page.click('button:has-text("Salvar áreas")');
    await page.waitForTimeout(700);
    const enviado = S.putsAreas.at(-1)?.areas ?? [];
    ok(enviado.length === 1 && enviado[0].nome === 'Centro' && enviado[0].taxa === 6 && enviado[0].tempoMin === 25 && enviado[0].poligono.length === 4, `a lista inteira vai numa chamada (${umaLinha(JSON.stringify(enviado[0] ?? {}), 140)})`);
    ok(S.putsConfig.some((c) => c.areaModo === 'mapa'), 'com a área no ar salva, o modo mapa é gravado');
    const cards = await page.locator('[role="radiogroup"] [role="radio"]').allInnerTexts();
    ok(/valendo/.test(cards[2]) && !/valendo/.test(cards[0]), 'o card "Desenhada no mapa" passa a "valendo"');
    ok(!(await page.locator('text=Este modo ainda não está valendo').count()), 'o aviso some');
    // Testar um ponto: dentro e fora.
    const b = await mapaBox(page);
    await page.click('button:has-text("📍 Testar um endereço")');
    await page.mouse.click(b.x + b.width * 0.5, b.y + b.height * 0.5);
    await page.waitForTimeout(200);
    let r = await page.locator('section[aria-labelledby="titulo-teste"]').innerText();
    ok(/Entrega pela área Centro/.test(r) && /R\$\s6,00/.test(r), `testar dentro: ${umaLinha(r, 120)}`);
    await page.mouse.click(b.x + b.width * 0.1, b.y + b.height * 0.9);
    await page.waitForTimeout(200);
    r = await page.locator('section[aria-labelledby="titulo-teste"]').innerText();
    ok(/Fora da área de entrega/.test(r), `testar fora: ${umaLinha(r, 120)}`);
    await page.screenshot({ path: foto('1280-area-salva.png') });
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── converter as faixas, ordenar, apagar, a recusa do servidor ──
  {
    const S = servidor();
    S.config.areaModo = 'mapa';
    S.areas = [{ id: 'x1', nome: 'Antiga', poligono: [[-22.84, -43.28], [-22.84, -43.27], [-22.85, -43.27]], taxa: 4, ativo: true, ordem: 0 }];
    const { ctx, page, erros } = await abrir(1280, 1000, S);
    await page.waitForSelector('text=Antiga', { timeout: 10000 });
    ok(!(await page.locator('text=Este modo ainda não está valendo').count()), 'loja já no modo mapa: sem o aviso');
    await page.click('button:has-text("Converter as faixas de km em áreas")');
    await page.waitForTimeout(400);
    let nomes = await page.locator('section[aria-labelledby="titulo-areas"] li b').allInnerTexts();
    ok(nomes.join('|') === 'Até 1 km|Até 2 km', `converter: uma área por faixa (${nomes.join(' | ')})`);
    await page.click('button[aria-label="Descer Até 1 km"]');
    nomes = await page.locator('section[aria-labelledby="titulo-areas"] li b').allInnerTexts();
    ok(nomes.join('|') === 'Até 2 km|Até 1 km', `a seta muda a ordem (${nomes.join(' | ')})`);
    await page.click('section[aria-labelledby="titulo-areas"] li:has-text("Até 1 km") button:has-text("Apagar")');
    const d = page.locator('[role="alertdialog"]');
    ok(await d.isVisible(), 'apagar pede confirmação');
    await page.screenshot({ path: foto('1280-apagar.png') });
    await page.click('[role="alertdialog"] button:has-text("Apagar área")');
    nomes = await page.locator('section[aria-labelledby="titulo-areas"] li b').allInnerTexts();
    ok(nomes.join('|') === 'Até 2 km', `apagada (${nomes.join(' | ')})`);
    S.recusarAreas = 'A área "Até 2 km" tem um canto fora do mapa.';
    await page.click('button:has-text("Salvar áreas")');
    await page.waitForTimeout(600);
    ok(await page.locator('text=A área "Até 2 km" tem um canto fora do mapa.').count() > 0, 'a recusa do servidor aparece com a mensagem dele');
    ok(await page.locator('text=Há alterações ainda não salvas nas áreas').isVisible(), 'recusado: as alterações continuam na tela');
    // Pausar a única área com o modo mapa ligado: a tela recusa antes de mandar.
    S.recusarAreas = null;
    await page.click('section[aria-labelledby="titulo-areas"] li button:has-text("Editar")');
    await page.click('[role="dialog"] [role="switch"]');
    await page.click('[role="dialog"] button:has-text("Salvar área")');
    const antes = S.putsAreas.length;
    await page.click('button:has-text("Salvar áreas")');
    await page.waitForTimeout(500);
    ok(S.putsAreas.length === antes, 'modo mapa sem área no ar: a tela não manda (diz o motivo)');
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── as larguras: com a gaveta e com o diálogo abertos ──
  for (const w of larguras) {
    const S = servidor();
    S.config.areaModo = 'mapa';
    S.areas = [
      { id: 'x1', nome: 'Penha com um nome bem comprido para ver se quebra', poligono: [[-22.84, -43.28], [-22.84, -43.27], [-22.85, -43.27]], taxa: 5, tempoMin: 25, tempoMax: 35, pedidoMinimo: 20, freteGratisAcima: 90, ativo: true, ordem: 0 },
      { id: 'x2', nome: 'Olaria', poligono: [[-22.83, -43.29], [-22.83, -43.26], [-22.86, -43.26]], taxa: 7, ativo: false, ordem: 1 },
    ];
    const { ctx, page, erros } = await abrir(w, 900, S);
    await page.waitForSelector('text=Olaria', { timeout: 10000 });
    let achados = await medir(page);
    ok(!achados.length, `${w}px: a tela sem barra lateral (${achados.join(' | ')})`);
    await page.click('section[aria-labelledby="titulo-areas"] li:has-text("Olaria") button:has-text("Editar")');
    await page.waitForSelector('[role="dialog"]');
    achados = await medir(page);
    ok(!achados.length, `${w}px: com a gaveta aberta (${achados.join(' | ')})`);
    if (w === 375 || w === 1280) await page.screenshot({ path: foto(`${w}-gaveta.png`) });
    await page.keyboard.press('Escape');
    await page.click('section[aria-labelledby="titulo-areas"] li:has-text("Olaria") button:has-text("Apagar")');
    await page.waitForSelector('[role="alertdialog"]');
    achados = await medir(page);
    ok(!achados.length, `${w}px: com o diálogo aberto (${achados.join(' | ')})`);
    await page.keyboard.press('Escape');
    ok(erros.length === 0, `${w}px: sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }
}
