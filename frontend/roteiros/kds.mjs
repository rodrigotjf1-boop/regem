// Roteiro de tela do KDS (/kds — auditoria do KDS de 11/11/2026, ondas 2 e 4; protótipo `mockups/regem-kds-cozinha.html`,
// aba 1). A API e o tempo real são SIMULADOS aqui (rota interceptada + Engine.IO por polling): nada de banco nem de login.
//  1. 16 larguras + 3 tablets, nos dois temas e nas letras 85%/100%/150%, com a gaveta "Esta tela", a aba "Avisos" e o
//     diálogo "Finalizar todos" abertos: sem barra lateral, sem corte, nada fora da janela e toque ≥ 48 px.
//  2. O que o protótipo promete: letras, cartão neutro, encomenda, o toque com "Aguarde…" e a resposta do servidor, a
//     recusa (R15), o cancelado até o "Ciente", "Finalizar todos" só do que está na tela, o histórico e as faixas.
//  3. Os avisos de cada tela e a faixa da pausa dos canais.
//  4. Cada origem (balcão, mesa, totem, iFood, 99 com o entregador, Anota Aí, cardápio com encomenda), o cartão
//     cancelado e o pedido alterado (o aviso, NOVO/TIRAR, o "Visto" no cartão e no rodapé).
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const TABLETS = [
  [1024, 600],
  [1280, 800],
  [1366, 768],
];

// ── dados de exemplo (os do protótipo) ──
const agora = Date.now();
const ha = (m) => new Date(agora - m * 60000).toISOString();
const daqui = (m) => new Date(agora + m * 60000).toISOString();
function pedidosIniciais() {
  return [
    { id: 'b12', status: 'preparo', criadoEm: ha(4), senha: 12, senhaPrefixo: 'B', origem: 'balcao', itens: [
      { id: 'i1', quantidade: 2, descricao: 'X-Burger', complementosTexto: 'sem cebola · + bacon' },
      { id: 'i2', quantidade: 1, descricao: 'Batata frita G' },
      { id: 'i3', quantidade: 2, descricao: 'Coca-Cola lata 350 ml' }] },
    { id: 'd241', status: 'recebido', criadoEm: ha(7), senha: 241, senhaPrefixo: 'D', origem: 'delivery', plataforma: 'iFood', senhaPlataforma: '4821', itens: [
      { id: 'i4', quantidade: 1, descricao: 'X-Salada', complementosTexto: '+ ovo · sem tomate' },
      { id: 'i5', quantidade: 1, descricao: 'Batata frita M', observacao: 'Mandar dois sachês de ketchup' },
      { id: 'i6', quantidade: 1, descricao: 'Guaraná 2 L' }] },
    { id: 'm7', status: 'preparo', criadoEm: ha(13), mesa: '7', origem: 'balcao', itens: [
      { id: 'i7', quantidade: 1, descricao: 'Filé à parmegiana', observacao: 'Sem queijo — alergia a lactose' },
      { id: 'i8', quantidade: 1, descricao: 'Arroz branco' },
      { id: 'i9', quantidade: 1, descricao: 'Suco de laranja 500 ml', complementosTexto: 'sem açúcar' }] },
    { id: 'b14', status: 'recebido', criadoEm: ha(2), senha: 14, senhaPrefixo: 'B', origem: 'balcao', plataforma: 'Totem', consumo: 'viagem', itens: [
      { id: 'i10', quantidade: 1, descricao: 'Hambúrguer artesanal duplo com cheddar cremoso, cebola caramelizada e maionese da casa',
        complementosTexto: '+ pão sem glúten · + cheddar extra · sem picles', observacao: 'ALÉRGICOAAMENDOIM-NÃOUSARMOLHODACASA-SEPARARUTENSÍLIOS' }] },
    // Alterado e ainda sem o "Visto": o aviso invertido no cartão entra em toda medida de largura e tema.
    { id: 'b15', status: 'recebido', criadoEm: ha(3), senha: 15, senhaPrefixo: 'B', origem: 'balcao', obs: 'ALTERADO', alteracaoNaoVista: true, alteradoEm: ha(2), itens: [
      { id: 'i11', quantidade: 1, descricao: 'X-Bacon', status: 'novo', mudouEm: ha(2) },
      { id: 'i12', quantidade: 1, descricao: 'X-Burger', status: 'removido', mudouEm: ha(2) },
      { id: 'i13', quantidade: 1, descricao: 'Milk-shake de chocolate 400 ml' }] },
    { id: 'd243', status: 'pronto', criadoEm: ha(9), senha: 243, senhaPrefixo: 'D', origem: 'delivery', plataforma: '99Food', senhaPlataforma: '77102',
      logistica: { modo: 'logistica_canal', canal: '99food', entregadorNome: 'Carlos', situacao: 'chegou na loja', status: 130, codigoColeta: '5519' }, itens: [
      { id: 'i14', quantidade: 1, descricao: 'Combo família', complementosTexto: '4 X-Burger · 2 batatas G' },
      { id: 'i15', quantidade: 1, descricao: 'Coca-Cola 2 L' }] },
    { id: 'd250', status: 'recebido', criadoEm: ha(95), senha: 250, senhaPrefixo: 'D', origem: 'delivery', plataforma: 'Cardápio Regem', encomendaPara: daqui(73), itens: [
      { id: 'i16', quantidade: 20, descricao: 'Mini X-Burger (festa)' },
      { id: 'i17', quantidade: 4, descricao: 'Batata frita G' }] },
    { id: 'd244', status: 'recebido', criadoEm: ha(1), senha: 244, senhaPrefixo: 'D', origem: 'delivery', plataforma: 'Anota Aí', itens: [
      { id: 'i18', quantidade: 2, descricao: 'X-Tudo', complementosTexto: 'sem milho' },
      { id: 'i19', quantidade: 2, descricao: 'Coca-Cola lata 350 ml' }] },
    { id: 'm3', status: 'preparo', criadoEm: ha(6), mesa: '3', origem: 'balcao', itens: [{ id: 'i20', quantidade: 2, descricao: 'Porção de fritas com cheddar e bacon' }] },
    // Cancelado pelo canal: cinza, sem botão, fora das etapas.
    { id: 'd245', status: 'cancelado', criadoEm: ha(5), senha: 245, senhaPrefixo: 'D', origem: 'delivery', plataforma: 'iFood', senhaPlataforma: '5530', itens: [
      { id: 'i23', quantidade: 1, descricao: 'X-Egg' }] },
  ];
}

// ── o estado do "servidor" simulado ──
const S = { pedidos: [], filaFalha: false, nuvem: false, semSocket: false, fila: [], esperaAvancar: 700, vistos: [] };

async function rotas(page) {
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const caminho = url.pathname.replace(/^.*\/api\/v1/, '');
    if (caminho === '/producao/fila') {
      if (S.filaFalha) return responder(route, { message: 'Serviço indisponível' }, 503);
      return responder(route, { cores: { verdeAteMin: 5, amareloAteMin: 10, usaPreparo: true, usaEntregue: true }, pedidos: S.pedidos, nuvemComServidor: S.nuvem });
    }
    if (caminho === '/producao/kds/telas')
      return responder(route, [{ id: 'k1', nome: 'Cozinha', escopo: 'producao', proximoKdsId: null, ...(S.avisosK1 ? { avisos: S.avisosK1 } : {}) }]);
    if (caminho === '/producao/kds/k1/avisos' && req.method() === 'PUT') {
      const corpo = JSON.parse(req.postData() || '{}');
      S.avisosPut = corpo;
      S.avisosK1 = { ...(S.avisosK1 ?? { loja: true, farol: true, pausa: true, estoque: true, chegou: false, gestao: false }), ...corpo.avisos };
      return responder(route, { id: 'k1', avisos: S.avisosK1, mudou: true });
    }
    if (caminho === '/delivery/pausas/kds') return responder(route, { canais: S.pausas ?? [], avisoMinutos: 5 });
    if (caminho === '/setores') return responder(route, []);
    if (caminho.startsWith('/delivery/entregadores-ao-vivo')) return responder(route, { habilitado: false });
    if (caminho === '/producao/historico')
      return responder(route, [{ id: 'h1', acao: 'finalizou_fila', detalhe: { quantidade: 3 }, criadoEm: ha(30), atorNome: 'Ana Souza', atorPerfil: 'supervisao' }]);
    let m = caminho.match(/^\/producao\/pedidos\/([^/]+)\/avancar$/);
    if (m) {
      await new Promise((r) => setTimeout(r, S.esperaAvancar));
      const p = S.pedidos.find((x) => x.id === m[1]);
      if (!p) return responder(route, { message: 'Pedido não encontrado.' }, 404);
      const corpo = JSON.parse(req.postData() || '{}');
      if (corpo.de && corpo.de !== p.status) return responder(route, { message: 'O cartão já mudou de etapa.' }, 409);
      const prox = { recebido: 'preparo', preparo: 'pronto', pronto: 'entregue' }[p.status];
      if (prox === 'entregue') S.pedidos = S.pedidos.filter((x) => x.id !== p.id);
      else p.status = prox;
      return responder(route, { ok: true, status: prox });
    }
    m = caminho.match(/^\/producao\/pedidos\/([^/]+)\/visto$/);
    if (m) {
      S.vistos.push(m[1]);
      const p = S.pedidos.find((x) => x.id === m[1]);
      if (p) {
        p.alteracaoNaoVista = false;
        p.itens = p.itens.filter((i) => i.status !== 'removido');
      }
      return responder(route, { ok: true });
    }
    if (caminho === '/producao/fila/limpar') {
      const ids = JSON.parse(req.postData() || '{}').ids ?? [];
      S.ultimosFinalizados = ids;
      S.pedidos = S.pedidos.filter((p) => !ids.includes(p.id));
      return responder(route, { ok: true, avancados: ids.length });
    }
    return responder(route, {});
  });
  // Engine.IO v4 por polling: o aperto de mão, o "40" de conexão e, depois, o que estiver na fila (eventos do servidor).
  // Uma fila POR ABA: a espera de uma aba já fechada não pode levar o evento da aba de agora.
  const filaDaAba = [];
  S.fila = filaDaAba;
  let conectou = false;
  await page.route('**/socket.io/**', async (route) => {
    const req = route.request();
    if (S.semSocket) return route.abort();
    const url = new URL(req.url());
    if (req.method() === 'POST') return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
    if (url.searchParams.get('transport') === 'websocket') return route.abort();
    if (!url.searchParams.get('sid')) {
      conectou = false;
      return route.fulfill({ status: 200, contentType: 'text/plain', body: '0{"sid":"s1","upgrades":[],"pingInterval":25000,"pingTimeout":60000,"maxPayload":1000000}' });
    }
    if (!conectou) {
      conectou = true;
      return route.fulfill({ status: 200, contentType: 'text/plain', body: '40{"sid":"c1"}' });
    }
    for (let i = 0; i < 40 && !filaDaAba.length && !S.semSocket; i++) await new Promise((r) => setTimeout(r, 250));
    if (S.semSocket) return route.abort().catch(() => {});
    const pacotes = filaDaAba.splice(0).map((e) => '42' + JSON.stringify(e));
    return route.fulfill({ status: 200, contentType: 'text/plain', body: pacotes.length ? pacotes.join('\x1e') : '6' }).catch(() => {});
  });
}

// Barra lateral, texto cortado, peça fora da janela e toque < 48 px — dentro da tela do KDS.
const medir = (page) =>
  page.evaluate(() => {
    const doc = document.documentElement;
    const achados = [];
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    const visivel = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
    };
    for (const el of document.querySelectorAll('.kds-app *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      // texto cortado: só o letreiro corta de propósito (2 linhas + "Ver tudo"); o texto só para leitor de tela tem 1 px
      if (cs.overflowX === 'hidden' && el.clientWidth > 1 && el.scrollWidth > el.clientWidth + 1 && !el.closest('.k-txt') && !el.classList.contains('k-fila'))
        achados.push(`corta ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      if (visivel(el)) {
        const r = el.getBoundingClientRect();
        if (r.right > window.innerWidth + 1 && !el.closest('.k-fila,.k-resumo,.k-gcorpo'))
          achados.push(`fora ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${Math.round(r.right)}>${window.innerWidth}`);
      }
    }
    const pequenos = [];
    for (const b of document.querySelectorAll('.kds-app button, .kds-app select, .kds-app input')) {
      if (!visivel(b) || b.classList.contains('k-fundo')) continue; // o fundo escuro da gaveta não é alvo
      const r = b.getBoundingClientRect();
      if (r.height < 47.5 || r.width < 40) pequenos.push(`${(b.textContent || b.getAttribute('aria-label') || b.tagName).trim().slice(0, 24)} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    const top = document.querySelector('.k-top')?.getBoundingClientRect().height ?? 0;
    return { achados, pequenos, top };
  });

const TOKEN = tokenFalso({ perfil: 'gerente', perm: { producao_kds: { ver: true, editar: true } } });

export default async function roteiroKds({ nav, base, ok, foto, larguras, rapido, escrever }) {
  async function abrir({ w, h, tema = 'claro', escala = 1, ver = 'pedido' } = {}) {
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript(
      ([jwt, tema, escala, ver]) => {
        localStorage.setItem('regen_token', jwt);
        localStorage.setItem('kds-equip', 'k1');
        localStorage.setItem('kds-canal', 'todos');
        localStorage.setItem('kds-tema', tema);
        localStorage.setItem('kds-ver', ver);
        localStorage.setItem('kds-view', JSON.stringify({ escala, agregar: false, uso: 'toque' }));
      },
      [TOKEN, tema, escala, ver],
    );
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await rotas(page);
    await page.goto(base + '/kds');
    await page.waitForSelector('.k-card', { timeout: 20000 });
    return { ctx, page, erros };
  }

  // ── 1. medidas: larguras + tablets, claro/escuro, letra 85/100/150 ──
  const tablets = rapido ? TABLETS.slice(0, 1) : TABLETS;
  for (const [w, h] of [...larguras.map((w) => [w, w < 700 ? 820 : 900]), ...tablets]) {
    for (const [tema, escala] of [['claro', 1], ['escuro', 0.85], ['claro', 1.5]]) {
      S.pedidos = pedidosIniciais();
      // a faixa da pausa com dois canais (um com contador, a 99 até o fim do dia)
      S.pausas = [
        { canal: 'ifood', nome: 'iFood', ate: new Date(Date.now() + 754_000).toISOString(), fimDoDia: false, motivo: 'Trocando o gás' },
        { canal: 'food99', nome: '99', ate: new Date(Date.now() + 5 * 3600_000).toISOString(), fimDoDia: true, motivo: 'Sem entregador' },
      ];
      const { ctx, page, erros } = await abrir({ w, h, tema, escala });
      await page.waitForSelector('.k-pausa', { timeout: 10000 });
      const estados = {};
      estados.base = await medir(page);
      await page.click('[aria-label="Configurar este KDS"]');
      await page.waitForSelector('.k-gaveta');
      estados.gaveta = await medir(page);
      await page.click('.k-gtab:has-text("Avisos")');
      await page.waitForSelector('.k-tipos');
      estados.avisos = await medir(page);
      await page.keyboard.press('Escape');
      await page.waitForSelector('.k-gaveta', { state: 'detached' });
      await page.click('[aria-haspopup="dialog"]');
      await page.waitForSelector('.k-dialogo');
      estados.dialogo = await medir(page);
      await page.keyboard.press('Escape');
      for (const [nome, m] of Object.entries(estados)) {
        ok(m.achados.length === 0, `${w}×${h} ${tema} ${escala * 100}% ${nome}: sem barra/corte/fora ${m.achados.slice(0, 3).join(' | ')}`);
        ok(m.pequenos.length === 0, `${w}×${h} ${tema} ${escala * 100}% ${nome}: toque ≥ 48 ${m.pequenos.slice(0, 4).join(' | ')}`);
      }
      if (tema === 'claro' && escala === 1)
        escrever(`INFO  [kds] ${w}×${h}: cabeçalho ${Math.round(estados.base.top)} px = ${((estados.base.top / h) * 100).toFixed(1)}% da altura`, false);
      ok(erros.length === 0, `${w}×${h} ${tema}: sem erro na página ${erros.join(' | ')}`);
      if ([375, 1024, 1280, 1920].includes(w) && h !== 600 && escala !== 0.85) await page.screenshot({ path: foto(`${w}x${h}-${tema}-${escala * 100}.png`) });
      if (w === 1024 && h === 600) await page.screenshot({ path: foto(`1024x600-${tema}-${escala * 100}.png`) });
      await ctx.close();
    }
  }

  // ── 2. o que o protótipo promete, tocando ──
  S.pedidos = pedidosIniciais();
  S.pausas = [];
  {
    const { ctx, page, erros } = await abrir({ w: 1280, h: 800 });
    const fontes = await page.evaluate(() => ({
      item: parseFloat(getComputedStyle(document.querySelector('.k-it')).fontSize),
      comp: parseFloat(getComputedStyle(document.querySelector('.k-comp')).fontSize),
      obs: parseFloat(getComputedStyle(document.querySelector('.k-obs')).fontSize),
      tag: parseFloat(getComputedStyle(document.querySelector('.k-tag')).fontSize),
      avancar: document.querySelector('.k-avancar').getBoundingClientRect().height,
      compCor: getComputedStyle(document.querySelector('.k-comp')).color,
      tinta: getComputedStyle(document.querySelector('.k-d')).color,
    }));
    ok(fontes.item === 20 && fontes.comp === 16 && fontes.obs === 16 && fontes.tag === 13, `letras: item ${fontes.item}, complemento ${fontes.comp}, obs ${fontes.obs}, etiqueta ${fontes.tag}`);
    ok(fontes.compCor === fontes.tinta, `complemento na cor da tinta (${fontes.compCor})`);
    ok(fontes.avancar >= 48, `botão de avançar ${fontes.avancar} px`);
    const comp = await page.locator('[data-kds-cartao="b12"] .k-comp li').allTextContents();
    ok(JSON.stringify(comp) === JSON.stringify(['sem cebola', '+ bacon']), `complementos um por linha: ${JSON.stringify(comp)}`);
    // cartão neutro: o fundo do cabeçalho é o do cartão; a cor fica só no selo do tempo
    const cores = await page.evaluate(() => {
      const c = document.querySelector('[data-kds-cartao="m7"]');
      return { cab: getComputedStyle(c.querySelector('.k-cab')).backgroundColor, card: getComputedStyle(c).backgroundColor, selo: getComputedStyle(c.querySelector('.k-tempo')).backgroundColor, botao: getComputedStyle(c.querySelector('.k-avancar')).backgroundColor };
    });
    ok(cores.cab === cores.card && cores.selo === 'rgb(217, 45, 32)', `m7 (13 min): cabeçalho neutro ${cores.cab}, selo vermelho ${cores.selo}`);
    ok(cores.botao !== 'rgb(217, 45, 32)', `botão de avançar neutro (${cores.botao})`);
    ok((await page.locator('[data-kds-cartao="m7"] .k-tag.atraso').count()) === 1, 'm7 com a etiqueta "Atrasado" em contorno');
    // encomenda: neutra, "começa", sem "Atrasado", e fora do contador
    const enc = await page.locator('[data-kds-cartao="d250"]').innerText();
    ok(/COMEÇA/i.test(enc) && /ENCOMENDA · PARA/i.test(enc), `encomenda: "começa" e "para HH:MM" (${umaLinha(enc, 80)})`);
    ok((await page.locator('[data-kds-cartao="d250"].t-agenda').count()) === 1, 'encomenda: cartão neutro (t-agenda)');
    ok((await page.locator('[data-kds-cartao="d250"] .k-tag.atraso').count()) === 0, 'encomenda: sem "Atrasado" (aceita há 95 min)');
    const atrasados = await page.locator('.k-etapa', { hasText: 'Atrasados' }).locator('b').innerText();
    ok(atrasados === '1', `"Atrasados" conta só o m7 (${atrasados})`);
    const res = await page.locator('.k-res-lista').innerText().catch(() => '');
    ok(!/Mini X-Burger/.test(res), 'resumo: a encomenda que aguarda não entra no que falta produzir');
    const longo = await page.evaluate(() => {
      const c = document.querySelector('[data-kds-cartao="b14"]');
      return { obs: c.querySelector('.k-obs').scrollWidth <= c.querySelector('.k-obs').clientWidth + 1, card: c.scrollWidth <= c.clientWidth + 1 };
    });
    ok(longo.obs && longo.card, 'b14: a observação sem espaço quebra a linha, nada cortado');

    // toque: "Aguarde…" e o aviso curto com o que o servidor fez
    await page.click('[data-kds-cartao="b12"] .k-avancar');
    ok((await page.locator('[data-kds-cartao="b12"] .k-avancar').innerText()).toLowerCase().includes('aguarde'), 'toque: o botão diz "Aguarde…" enquanto o servidor responde');
    await page.waitForSelector('.k-toast.on');
    const toast1 = await page.locator('.k-toast').innerText();
    ok(/Senha B-12 → Pronto/i.test(toast1), `aviso do toque: "${toast1}"`);
    // recusa aparece (R15): a tela velha toca um cartão que já mudou noutro aparelho
    S.pedidos.find((p) => p.id === 'd241').status = 'preparo';
    await page.click('[data-kds-cartao="d241"] .k-avancar');
    await page.waitForFunction(() => /já mudou de etapa/.test(document.querySelector('.k-toast')?.textContent || ''), null, { timeout: 5000 });
    ok(true, 'recusa do servidor aparece no aviso ("já mudou de etapa")');
    ok((await page.locator('.k-toast').getAttribute('data-erro')) === 'true', 'recusa com o desenho de erro');

    // o cancelado chega pelo tempo real: fica até o Ciente
    S.fila.push(['producao:atualizado', { tipo: 'cancelado', pedidoId: 'm3', em: new Date().toISOString() }]);
    await page.waitForSelector('.k-rodape.danger', { timeout: 15000 });
    const rod = await page.locator('.k-rodape').innerText();
    ok(/URGENTE/i.test(rod) && /Cancelado — Mesa 3/.test(rod) && /CIENTE/i.test(rod), `rodapé urgente com Ciente: ${umaLinha(rod)}`);
    const fundoRod = await page.evaluate(() => getComputedStyle(document.querySelector('.k-rodape')).backgroundColor);
    ok(fundoRod === 'rgb(255, 255, 255)', `rodapé claro, sem fundo vermelho (${fundoRod})`);
    const anim = await page.evaluate(() => getComputedStyle(document.querySelector('.k-letreiro')).animationName);
    ok(anim === 'none', `o aviso fica parado (animação: ${anim})`);
    // um segundo aviso (do cadastro, info): "2 avisos" abre a lista; o cancelado continua na faixa
    S.fila.push(['kds:alerta', { id: 'a1', titulo: 'Lavar as mãos', detalhe: 'Todos da cozinha', prioridade: 'info', duracaoSeg: 60, em: new Date().toISOString() }]);
    await page.waitForFunction(() => /2 avisos/.test(document.querySelector('.k-mais')?.textContent || ''), null, { timeout: 15000 });
    await page.waitForTimeout(2500);
    ok(/Cancelado — Mesa 3/.test(await page.locator('.k-rodape').innerText()), 'o cancelado segue na faixa (não sai sozinho)');
    await page.click('.k-mais');
    await page.waitForSelector('.k-lista');
    const medLista = await medir(page);
    ok(medLista.achados.length === 0 && medLista.pequenos.length === 0, `lista de avisos aberta: ${[...medLista.achados, ...medLista.pequenos].slice(0, 3).join(' | ')}`);
    const lista = await page.locator('.k-lista').innerText();
    ok(lista.indexOf('Cancelado') < lista.indexOf('Lavar as mãos'), 'lista: o urgente primeiro');
    await page.screenshot({ path: foto('1280-lista-avisos.png') });
    await page.keyboard.press('Escape');
    await page.click('.k-ciente');
    await page.waitForFunction(() => !/Cancelado/.test(document.querySelector('.k-rodape')?.textContent || ''), null, { timeout: 5000 });
    ok(/Lavar as mãos/.test(await page.locator('.k-rodape').innerText()), 'Ciente: o cancelado sai e o próximo assume');

    // Finalizar todos: diálogo da tela, só o visível (o cancelado não entra), aviso com o número
    await page.click('.k-etapa:has-text("A iniciar")');
    const visiveis = await page.locator('.k-card:not(.cancelado)').count();
    await page.click('[aria-haspopup="dialog"]');
    const dlg = await page.locator('.k-dialogo').innerText();
    ok(new RegExp(`os ${visiveis} pedidos`).test(dlg) && /escondido/.test(dlg), `diálogo: ${umaLinha(dlg, 120)}`);
    await page.click('.k-dialogo .k-bt.pri');
    await page.waitForFunction((n) => new RegExp(`${n} pedidos? finalizados?`).test(document.querySelector('.k-toast')?.textContent || ''), visiveis, { timeout: 5000 });
    ok(S.ultimosFinalizados.length === visiveis, `finalizou só os ${visiveis} da tela (${S.ultimosFinalizados.join(',')})`);

    // gaveta: histórico
    await page.click('[aria-label^="Histórico"]');
    await page.waitForSelector('.k-h');
    ok(/Ana Souza/.test(await page.locator('.k-gaveta').innerText()), 'gaveta › Histórico mostra quem fez');
    await page.screenshot({ path: foto('1280-gaveta-historico.png') });
    await page.keyboard.press('Escape');

    // faixas: falha de leitura, KDS pela internet numa loja com servidor, sem conexão
    S.filaFalha = true;
    S.nuvem = false;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    S.fila.push(['producao:atualizado', { tipo: 'novo', pedidoId: 'x' }]);
    await page.waitForSelector('.k-faixa:has-text("Não consegui ler a fila")', { timeout: 15000 });
    ok(true, 'faixa clara de falha de leitura, com "Tentar agora"');
    const fundoFaixa = await page.evaluate(() => getComputedStyle(document.querySelector('.k-faixa')).backgroundColor);
    ok(fundoFaixa === 'rgb(255, 255, 255)', `faixa clara (${fundoFaixa})`);
    S.filaFalha = false;
    S.nuvem = true;
    await page.click('.k-fbt');
    await page.waitForSelector('.k-faixa:has-text("aberto pela internet")', { timeout: 10000 });
    ok(/Regem neste PC/.test(await page.locator('.k-faixas').innerText()), 'R15: a faixa manda abrir pelo atalho "Regem neste PC"');
    await page.screenshot({ path: foto('1280-faixas.png') });
    S.semSocket = true;
    await page.waitForSelector('.k-faixa:has-text("Sem conexão")', { timeout: 30000 });
    const semCon = await page.evaluate(() => getComputedStyle(document.querySelector('.k-vermelho')).color);
    ok(semCon === 'rgb(180, 35, 28)', `"Sem conexão" só a palavra em vermelho (${semCon})`);
    ok(erros.length === 0, `sem erro na página: ${erros.join(' | ')}`);
    await ctx.close();
  }

  // ── 3. os avisos de cada tela e a faixa da pausa ──
  S.pedidos = pedidosIniciais();
  S.semSocket = false;
  S.nuvem = false;
  S.avisosK1 = null;
  S.pausas = [{ canal: 'ifood', nome: 'iFood', ate: new Date(Date.now() + 299_000).toISOString(), fimDoDia: false, motivo: 'Trocando o gás' }];
  {
    const { ctx, page, erros } = await abrir({ w: 1280, h: 800 });
    // a faixa nos minutos do aviso: "reabre em 5 min", contador em âmbar, faixa clara
    await page.waitForSelector('.k-pausa.logo', { timeout: 10000 });
    const pausa = await page.locator('.k-pausa').innerText();
    ok(/iFood reabre em 5 min/.test(pausa) && /Trocando o gás/.test(pausa) && /faltam/i.test(pausa), `faixa da pausa: ${umaLinha(pausa)}`);
    const corPausa = await page.evaluate(() => ({
      t: getComputedStyle(document.querySelector('.k-pausa .t')).color,
      fundo: getComputedStyle(document.querySelector('.k-pausas')).backgroundColor,
    }));
    ok(corPausa.t === 'rgb(138, 90, 0)' && corPausa.fundo === 'rgb(255, 255, 255)', `contador âmbar ${corPausa.t}, faixa clara ${corPausa.fundo}`);
    await page.screenshot({ path: foto('1280-pausa.png') });
    // reabriu: a faixa sai e o rodapé avisa
    S.pausas = [];
    S.fila.push(['kds:pausa', { em: new Date().toISOString() }]);
    await page.waitForSelector('.k-pausa', { state: 'detached', timeout: 15000 });
    await page.waitForSelector('.k-rodape.ok', { timeout: 5000 });
    ok(/iFood reabriu/.test(await page.locator('.k-rodape').innerText()), 'reabriu: o rodapé avisa "iFood reabriu"');
    // a tela de preparo não recebe o aviso de gestão; recebe o de estoque
    S.fila.push(['kds:alerta', { id: 'g1', titulo: 'Compra recebida: Hortifrúti', detalhe: 'Itens entraram no estoque.', prioridade: 'info', tipo: 'gestao', duracaoSeg: 60, em: new Date().toISOString() }]);
    S.fila.push(['kds:alerta', { id: 'e1', titulo: 'Produto esgotado no cardápio', detalhe: 'Batata frita G', prioridade: 'alta', tipo: 'estoque', duracaoSeg: 60, em: new Date().toISOString() }]);
    await page.waitForFunction(() => /Produto esgotado/.test(document.querySelector('.k-rodape')?.textContent || ''), null, { timeout: 15000 });
    await page.waitForTimeout(1500);
    ok(!/Compra recebida/.test(await page.locator('.k-pe').innerText()), 'o aviso de gestão não toca na tela de preparo');
    // a aba "Avisos": liga a gestão e salva — manda só o que mudou
    await page.click('[aria-label="Configurar este KDS"]');
    await page.click('.k-gtab:has-text("Avisos")');
    await page.waitForSelector('.k-tipos');
    const travados = await page.locator('.k-liga:disabled').count();
    ok(travados === 2, `cancelado e alterado travados (${travados})`);
    await page.click('[aria-label^="Avisos de gestão"]');
    ok(/não salvas/.test(await page.locator('.k-gpe').innerText()), 'rascunho: "Alterações ainda não salvas"');
    const medAv = await medir(page);
    ok(medAv.achados.length === 0 && medAv.pequenos.length === 0, `aba Avisos: ${[...medAv.achados, ...medAv.pequenos].slice(0, 3).join(' | ')}`);
    await page.screenshot({ path: foto('1280-aba-avisos.png') });
    await page.click('.k-gpe .k-bt.pri');
    await page.waitForSelector('.k-gaveta', { state: 'detached', timeout: 5000 });
    ok(JSON.stringify(S.avisosPut) === JSON.stringify({ avisos: { gestao: true } }), `salvar manda só o que mudou: ${JSON.stringify(S.avisosPut)}`);
    await page.waitForFunction(() => /Avisos desta tela salvos/.test(document.querySelector('.k-toast')?.textContent || ''), null, { timeout: 5000 });
    ok(true, 'aviso "Avisos desta tela salvos"');
    // agora a gestão chega (pela faixa ou pela lista — "2 avisos" já podia estar na tela antes dele)
    S.fila.push(['kds:alerta', { id: 'g2', titulo: 'Contagem: Câmara fria', detalhe: 'Hora de contar', prioridade: 'info', tipo: 'gestao', duracaoSeg: 60, em: new Date().toISOString() }]);
    let chegou = false;
    for (let i = 0; i < 30 && !chegou; i++) {
      await page.waitForTimeout(500);
      const rod = await page.locator('.k-rodape').innerText().catch(() => '');
      if (/Contagem: Câmara fria/.test(rod)) chegou = true;
      else if (await page.locator('.k-mais').count()) {
        if (!(await page.locator('.k-lista').count())) await page.click('.k-mais');
        chegou = /Contagem: Câmara fria/.test(await page.locator('.k-lista').innerText().catch(() => ''));
        if (!chegou) await page.keyboard.press('Escape');
      }
    }
    ok(chegou, 'depois de ligar, o aviso de gestão chega');
    ok(erros.length === 0, `sem erro na página (avisos e pausa): ${erros.join(' | ')}`);
    await ctx.close();
  }

  // ── 4. cada origem, o cancelado e o pedido alterado ──
  Object.assign(S, { pedidos: pedidosIniciais(), pausas: [], semSocket: false, nuvem: false, filaFalha: false, vistos: [] });
  {
    const { ctx, page, erros } = await abrir({ w: 1280, h: 800 });
    const cab = async (id) => (await page.locator(`[data-kds-cartao="${id}"] .k-cab`).innerText()).replace(/\s+/g, ' ').trim();
    const cartao = async (id) => (await page.locator(`[data-kds-cartao="${id}"]`).innerText()).replace(/\s+/g, ' ').trim();
    let t = await cab('b12');
    ok(/Senha B-12/i.test(t) && !/#|ifood|99|totem/i.test(t), `balcão: a senha B, sem canal ("${t}")`);
    t = await cab('m7');
    ok(/Mesa 7/i.test(t), `mesa: "${t}"`);
    t = await cab('b14');
    ok(/Senha B-14/i.test(t) && /Totem/i.test(t) && /Viagem/i.test(t), `totem: o canal e "Viagem" ("${t}")`);
    t = await cab('d241');
    ok(/Senha D-241/i.test(t) && /iFood #4821/i.test(t), `iFood: a senha D e o número do iFood ("${t}")`);
    t = await cartao('d243');
    ok(/99Food #77102/i.test(t) && /Entregador chegou/i.test(t) && /Carlos/.test(t) && /código 5519/i.test(t), `99: o número, o entregador que chegou e o código de coleta ("${umaLinha(t)}")`);
    t = await cab('d244');
    ok(/Senha D-244/i.test(t) && /Anota Aí/i.test(t), `Anota Aí: "${t}"`);
    t = await cab('d250');
    ok(/Cardápio Regem/i.test(t) && /Encomenda · para \d{2}:\d{2}/i.test(t), `cardápio com encomenda: "${t}"`);
    // cancelado pelo canal: cinza, "Cancelado", sem botão de avançar, fora das etapas
    const canc = page.locator('[data-kds-cartao="d245"]');
    ok((await canc.count()) === 1 && /\bcancelado\b/.test((await canc.getAttribute('class')) ?? ''), 'cancelado: o cartão aparece cinza');
    t = await cab('d245');
    ok(/Cancelado/i.test(t) && /iFood #5530/i.test(t) && (await canc.locator('.k-avancar').count()) === 0, `cancelado: a etiqueta e nenhum botão de avançar ("${t}")`);

    // alterado e ainda não visto (já estava assim na 1ª leitura): o aviso invertido, a exclamação, NOVO e TIRAR — e nada
    // no rodapé (a 1ª leitura é a base; o som que repete cobre o que já estava na tela)
    const b15 = page.locator('[data-kds-cartao="b15"]');
    ok((await b15.locator('[data-kds-alterado]').count()) === 1 && (await cab('b15')).startsWith('!'), 'alterado não visto: o aviso "Pedido alterado" e a exclamação');
    const novo = await b15.locator('[data-kds-item="novo"]').innerText();
    const tirar = await b15.locator('[data-kds-item="tirar"]').innerText();
    ok(/X-Bacon/.test(novo) && /Novo/i.test(novo) && /X-Burger/.test(tirar) && /Tirar/i.test(tirar), `NOVO e TIRAR nos itens ("${umaLinha(novo, 40)}" · "${umaLinha(tirar, 40)}")`);
    ok(!/Pedido alterado/i.test(await page.locator('.k-pe').innerText()), 'na 1ª leitura o rodapé não repete o alterado');

    // o pedido muda enquanto a tela está aberta: o rodapé avisa (urgente, com o que mudou) até o "Visto"
    const quando = new Date().toISOString();
    const d244 = S.pedidos.find((p) => p.id === 'd244');
    Object.assign(d244, { obs: 'ALTERADO', alteracaoNaoVista: true, alteradoEm: quando });
    d244.itens = [d244.itens[0], { ...d244.itens[1], status: 'removido', mudouEm: quando }, { id: 'i21', quantidade: 1, descricao: 'Batata frita P', status: 'novo', mudouEm: quando }];
    S.fila.push(['producao:atualizado', { tipo: 'alterado', pedidoId: 'd244' }]);
    await page.waitForFunction(() => /Pedido alterado — Senha D-244/i.test(document.querySelector('.k-rodape')?.textContent || ''), null, { timeout: 15000 });
    const rodAlt = await page.locator('.k-rodape').innerText();
    ok(/troca de 2 Coca-Cola lata 350 ml por 1 Batata frita P/i.test(rodAlt) && /Visto/i.test(rodAlt), `rodapé do alterado: "${umaLinha(rodAlt)}"`);
    ok((await page.locator('.k-rodape.danger').count()) === 1, 'o alterado é urgente no rodapé');
    await page.screenshot({ path: foto('1280-alterado.png') });
    // "Visto" no cartão: o aviso sai do cartão e do rodapé, o item tirado sai, fica a etiqueta "Alterado"
    await page.locator('[data-kds-cartao="d244"] [data-kds-visto]').click();
    await page.waitForSelector('[data-kds-cartao="d244"] [data-kds-alterado]', { state: 'detached', timeout: 8000 });
    t = await cartao('d244');
    ok(S.vistos.includes('d244') && !/Coca-Cola/.test(t) && /Batata frita P/.test(t) && /Alterado/i.test(t), `"Visto" no cartão: o item tirado sai e fica "Alterado" ("${umaLinha(t)}")`);
    ok(!/Pedido alterado — Senha D-244/i.test(await page.locator('.k-pe').innerText()), '"Visto" no cartão tira o aviso do rodapé');
    // "Visto" no rodapé é o mesmo do cartão
    const quando2 = new Date().toISOString();
    const m3 = S.pedidos.find((p) => p.id === 'm3');
    Object.assign(m3, { obs: 'ALTERADO', alteracaoNaoVista: true, alteradoEm: quando2 });
    m3.itens = [...m3.itens, { id: 'i22', quantidade: 1, descricao: 'Refrigerante 600 ml', status: 'novo', mudouEm: quando2 }];
    S.fila.push(['producao:atualizado', { tipo: 'alterado', pedidoId: 'm3' }]);
    await page.waitForFunction(() => /Pedido alterado — Mesa 3/i.test(document.querySelector('.k-rodape')?.textContent || ''), null, { timeout: 15000 });
    ok(/\+ 1 Refrigerante 600 ml/.test(await page.locator('.k-rodape').innerText()), 'rodapé: o item que entrou');
    await page.click('.k-rodape .k-ciente');
    await page.waitForSelector('[data-kds-cartao="m3"] [data-kds-alterado]', { state: 'detached', timeout: 8000 });
    ok(S.vistos.includes('m3'), '"Visto" no rodapé marca o pedido como o do cartão');
    ok(erros.length === 0, `sem erro na página (origens e alterado): ${erros.join(' | ')}`);
    await ctx.close();
  }
}
