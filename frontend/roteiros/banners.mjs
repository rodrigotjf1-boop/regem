// Roteiro de tela dos BANNERS — "Ao tocar, abre" e o período (fase B3 do `docs/plano-clube-e-banner.md`; protótipo
// `mockups/regem-clube-banner.html`, gaveta "Ao tocar no banner, abre"; mig 482). A API é simulada. Confere, em cada
// largura (V45: nenhuma barra de rolagem para o lado, com a gaveta ABERTA e medida na frente):
//  • Delivery › Configurações › Banners: o resumo de cada banner ("Ao tocar, abre: X-Bacon duplo · até 30/11", "Vagas da
//    loja"); "Ao tocar, abre…" abre a gaveta com os 8 destinos; "O Clube" › "Regras do clube" e o período; "até" antes de
//    "aparece de" avisa; "Salvar" manda a lista com o destino e o período; o link externo sem https avisa;
//  • o cardápio: o banner "Regras do clube" abre as regras (e "o clube ainda não está aberto" sem regras); o banner "Meus
//    prêmios e o álbum" abre Sua conta em Benefícios.
import { responder, tokenFalso, umaLinha } from './comum.mjs';
import { MENU, TOKEN as TOKEN_CARDAPIO } from './cardapio-para-voce.mjs';

const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: { loja: { ver: true, editar: true }, delivery: { ver: true } } });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');
const IMG = 'https://imagens.exemplo.test/banner-1.png';
const IMG_IA = 'https://imagens.exemplo.test/banner-ia.png';
const GIF_IA = 'https://imagens.exemplo.test/banner-ia.gif';
const MELHORADO = 'Foto de um hambúrguer duplo com bacon crocante, no centro, sobre fundo escuro com luz quente.';
const TITULO_LONGO = 'Sextou com bacon duplo e queijo derretendo no pão da casa!!'; // 59 letras: perto do limite de 60
const CHAMADA_LONGA = 'Duplo bacon, batata e bebida para fechar a semana com tudo, só nesta sexta à noite aqui!'; // perto do limite de 90
const SITUACAO_IA = { pode: true, podeCriar: true, podeEditar: true, podeAnimar: true, podeMelhorar: true, motivo: null, mensagem: null, franquia: { usados: 2, total: 20 } };
const P1 = '11111111-1111-4111-8111-111111111111';
const C1 = '55555555-5555-4555-8555-555555555555';
const BANNERS = () => [
  { id: 'b1', imagemRef: IMG, titulo: 'Sextou com bacon', link: `item:${P1}`, ativo: true, apareceDe: null, apareceAte: '2026-11-30' },
  { id: 'b2', imagemRef: IMG, titulo: 'Estamos contratando', link: 'vagas', ativo: true, apareceDe: null, apareceAte: null },
];

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.hs')) continue; // no cardápio, as fileiras que deslizam de propósito
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('faixa-abas')) {
        // O culpado: o elemento mais fundo que passa da borda direita de quem rola.
        const borda = el.getBoundingClientRect().right + 1;
        const fora = [...el.querySelectorAll('*')].filter((x) => x.getBoundingClientRect().right > borda && x.getBoundingClientRect().width > 0);
        const fundo = fora.find((x) => ![...x.children].some((y) => fora.includes(y))) ?? fora[0];
        const quem = fundo ? `${fundo.tagName.toLowerCase()}.${String(fundo.className).slice(0, 50)} "${(fundo.textContent || '').trim().slice(0, 30)}" ${Math.round(fundo.getBoundingClientRect().width)}px` : '?';
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth} — culpado: ${quem}`);
      }
    }
    for (const el of document.querySelectorAll('[role="dialog"] p, [role="dialog"] label, [role="dialog"] li')) {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      if (r.width > 0 && r.width < 60 && r.height > lh * 3.2 && (el.textContent || '').trim().length > 12)
        achados.push(`esmagado ${el.tagName.toLowerCase()} ${Math.round(r.width)}px: ${(el.textContent || '').trim().slice(0, 24)}`);
    }
    return achados;
  });
const texto = (page, sel = 'body') => page.evaluate((s) => document.querySelector(s)?.innerText.replace(/\s+/g, ' ') ?? '', sel);

export default async function roteiroBanners({ nav, base, ok, foto: arquivoFoto, larguras }) {
  async function abrir(w, situacaoIa = SITUACAO_IA, inicial = BANNERS) {
    const enviados = [];
    const criados = [];
    const animados = [];
    let lista = inicial();
    const ctx = await nav.newContext({ viewport: { width: w, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route((u) => u.hostname === 'imagens.exemplo.test', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/cardapio/banners/ia/situacao') return situacaoIa ? responder(route, situacaoIa) : responder(route, { message: 'O servidor não respondeu.' }, 503);
      if (p === '/cardapio/banners/ia/melhorar') return responder(route, { pedido: MELHORADO });
      if (p === '/cardapio/banners/ia/animar') {
        animados.push(JSON.parse(req.postData() || '{}'));
        return responder(route, { ok: true, imagemAnimadaRef: GIF_IA });
      }
      if (p === '/cardapio/banners/ia/criar') {
        criados.push(req.postDataBuffer()?.toString('utf8') ?? '');
        return responder(route, { ok: true, imagemRef: IMG_IA, franquia: { usados: 3, total: 20 } });
      }
      if (p === '/cardapio/banners' && req.method() === 'PUT') {
        const corpo = JSON.parse(req.postData() || '{}');
        enviados.push(corpo);
        lista = (corpo.banners ?? []).map((b, i) => ({ id: `n${i}`, ...b }));
        return responder(route, lista);
      }
      if (p === '/cardapio/banners') return responder(route, lista);
      if (p === '/produtos') return responder(route, [{ id: P1, nome: 'X-Bacon duplo', categoriaId: C1, categoriaNome: 'Hambúrgueres' }]);
      if (p === '/cardapio/cupons') return responder(route, [{ codigo: 'SEXTOU10', ativo: true }]);
      if (p === '/cardapio/config') return responder(route, { id: 'c1', ativo: true, modo: 'delivery', temaConfig: { bannerIntervalo: 2 } });
      if (/bairros|areas-entrega|regras-sinal|formas|impressoras|integrac|numeros|robo|eventos|fidelidade|cashback/.test(p)) return responder(route, []);
      return responder(route, {});
    });
    await page.goto(base + '/delivery/configuracoes?aba=banners');
    await page.waitForSelector('text=Ao tocar, abre:', { timeout: 30000 });
    return { ctx, page, erros, enviados, criados, animados };
  }
  const dialogo = (page) => page.waitForSelector('[role="dialog"]', { timeout: 10000 });
  const fechou = (page) => page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });

  for (const w of larguras) {
    const { ctx, page, erros, enviados, criados, animados } = await abrir(w);
    try {
      let achados = await medir(page);
      const t = await texto(page, 'main');
      ok(achados.length === 0, `${w}px · Banners: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      ok(t.includes('Ao tocar, abre: X-Bacon duplo · até 30/11') && t.includes('Ao tocar, abre: Vagas da loja'), `${w}px · o resumo de cada banner (${umaLinha(t.match(/Ao tocar, abre:.{0,40}/g)?.join(' | ') ?? '?')})`);
      await page.getByRole('button', { name: 'Ao tocar, abre…' }).first().click();
      await dialogo(page);
      achados = await medir(page);
      const g = page.locator('[role="dialog"]');
      ok(achados.length === 0 && (await g.getByRole('button', { pressed: true }).count()) === 1 && (await g.locator('[aria-pressed]').count()) === 8, `${w}px · a gaveta: os 8 destinos, o do banner marcado, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      ok((await g.getByLabel('Produto').inputValue()) === P1, `${w}px · a gaveta abre no produto do banner`);
      if (w === 390 || w === 1440) await g.screenshot({ path: arquivoFoto(`gaveta-${w}.png`) });
      // O Clube › Regras do clube, com o período (até antes de aparece de avisa)
      await g.getByRole('button', { name: 'O Clube' }).click();
      await g.getByLabel('Parte do Clube').selectOption('clube:regras');
      await g.getByLabel('Aparece de').fill('2026-12-01');
      await g.getByLabel('até').fill('2026-11-20');
      await g.getByRole('button', { name: 'Salvar' }).click();
      ok(await g.getByText('"Até" vem antes de "aparece de".').isVisible(), `${w}px · "até" antes de "aparece de" avisa e não salva (enviados: ${enviados.length})`);
      await g.getByLabel('até').fill('2026-12-24');
      await g.getByRole('button', { name: 'Salvar' }).click();
      await fechou(page);
      await page.waitForFunction(() => document.body.innerText.includes('Regras do clube · de 01/12 até 24/12'), null, { timeout: 5000 });
      const b0 = enviados[0]?.banners?.[0] ?? {};
      ok(
        enviados.length === 1 && b0.link === 'clube:regras' && b0.apareceDe === '2026-12-01' && b0.apareceAte === '2026-12-24' && enviados[0].banners[1]?.link === 'vagas',
        `${w}px · "Salvar" manda a lista com o destino e o período (${umaLinha(JSON.stringify(b0))})`,
      );
      // Link externo sem https avisa
      await page.getByRole('button', { name: 'Ao tocar, abre…' }).nth(1).click();
      await dialogo(page);
      await g.getByRole('button', { name: 'Link externo' }).click();
      await g.getByLabel('Endereço').fill('http://sem-https.com');
      achados = await medir(page);
      await g.getByRole('button', { name: 'Salvar' }).click();
      ok((await g.getByText('O link externo precisa começar com https://').isVisible()) && achados.length === 0, `${w}px · o link externo sem https avisa, sem barra para o lado`);
      await page.keyboard.press('Escape');
      await fechou(page);
      // B2: "✨ Criar com IA" — o pedido, melhorar, criar, a prévia e "Usar este banner"
      await page.getByRole('button', { name: '✨ Criar com IA' }).click();
      await dialogo(page);
      await g.getByText('2 de 20').waitFor({ timeout: 8000 });
      achados = await medir(page);
      ok(achados.length === 0 && (await g.getByRole('button', { name: 'Por cima, escrito pelo Regem', pressed: true }).count()) === 1, `${w}px · a gaveta da IA: a franquia, o texto por cima marcado, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      await g.getByLabel('O que você quer no banner').fill('hamburguer duplo');
      await g.getByRole('button', { name: 'Melhorar o pedido' }).click();
      await g.getByText('Você escreveu:').waitFor({ timeout: 5000 });
      ok((await g.getByLabel('O que você quer no banner').inputValue()) === MELHORADO, `${w}px · "Melhorar o pedido" troca o texto e mostra o que a pessoa escreveu`);
      // "A IA escreve" sem Título nem Chamada: a tela pede o texto e o "Criar banner" não gasta a franquia
      await g.getByRole('button', { name: 'A IA escreve na imagem' }).click();
      const avisoDoTexto = g.getByText('Preencha o Título ou a Chamada');
      await avisoDoTexto.waitFor({ timeout: 3000 });
      achados = await medir(page);
      ok(achados.length === 0 && (await g.getByRole('button', { name: 'Criar banner' }).isDisabled()) && criados.length === 0, `${w}px · "A IA escreve" sem texto: pede o texto, sem criar e sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      await g.getByLabel('Chamada', { exact: true }).fill('Só hoje');
      await avisoDoTexto.waitFor({ state: 'hidden', timeout: 3000 });
      ok(await g.getByRole('button', { name: 'Criar banner' }).isEnabled(), `${w}px · "A IA escreve" com a Chamada: libera o "Criar banner"`);
      await g.getByRole('button', { name: 'Por cima, escrito pelo Regem' }).click();
      await g.getByLabel('Título', { exact: true }).fill(TITULO_LONGO);
      await g.getByLabel('Chamada', { exact: true }).fill(CHAMADA_LONGA);
      achados = await medir(page);
      ok(achados.length === 0, `${w}px · a gaveta da IA preenchida, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      await g.getByRole('button', { name: 'Criar banner' }).click();
      await g.getByLabel('Texto para leitor de tela').waitFor({ timeout: 8000 });
      achados = await medir(page);
      ok(achados.length === 0 && (await g.getByText('3 de 20').isVisible()) && (await g.getByRole('button', { name: 'Criar outra' }).isVisible()), `${w}px · pronto: a prévia, a franquia nova e "Criar outra", sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      ok(/name="chave"/.test(criados[0] ?? '') && criados[0].includes(MELHORADO) && /name="textoPelaIa"\r\n\r\nfalse/.test(criados[0]) && !/name="file"/.test(criados[0]), `${w}px · "Criar banner" manda o pedido, a chave do clique e nenhuma foto`);
      // O GIF: fica na prévia, dá para tirar e pôr de novo, e não gasta a franquia.
      await g.getByRole('button', { name: 'Animar (GIF)' }).click();
      await g.getByRole('button', { name: 'Tirar a animação' }).waitFor({ timeout: 5000 });
      const srcs = () => g.locator('figure img').evaluateAll((l) => l.map((i) => i.getAttribute('src')));
      achados = await medir(page);
      ok(achados.length === 0 && animados[0]?.imagemRef === IMG_IA && (await srcs()).every((s) => s === GIF_IA) && (await g.getByText('3 de 20').isVisible()), `${w}px · "Animar (GIF)": a prévia anima, a franquia não muda, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      await g.getByRole('button', { name: 'Tirar a animação' }).click();
      ok((await srcs()).every((s) => s === IMG_IA), `${w}px · "Tirar a animação" volta à imagem parada`);
      await g.getByRole('button', { name: 'Animar (GIF)' }).click();
      await g.getByRole('button', { name: 'Tirar a animação' }).waitFor({ timeout: 5000 });
      if (w === 390 || w === 1440) await g.screenshot({ path: arquivoFoto(`gaveta-ia-${w}.png`) });
      const antesDeUsar = enviados.length;
      await g.getByRole('button', { name: 'Usar este banner' }).click();
      await fechou(page);
      await page.getByLabel('Texto por cima do banner 3: título').waitFor({ timeout: 5000 });
      const novo = enviados[antesDeUsar]?.banners?.[2] ?? {};
      ok(
        enviados.length === antesDeUsar + 1 && novo.imagemRef === IMG_IA && novo.imagemAnimadaRef === GIF_IA && novo.textoTitulo === TITULO_LONGO && novo.textoChamada === CHAMADA_LONGA && novo.descricao === MELHORADO.slice(0, 200) && novo.feitoComIa === true,
        `${w}px · "Usar este banner" salva a imagem, o GIF, o texto por cima e a descrição (${umaLinha(JSON.stringify(novo))})`,
      );
      ok(await page.getByRole('button', { name: 'Tirar a animação do banner 3' }).isVisible(), `${w}px · a linha do banner diz que o GIF está ligado e deixa tirar`);
      ok((await page.getByRole('button', { name: '✨ Criar com IA' }).count()) === 1, `${w}px · com 3 banners o "Criar com IA" continua`);
      achados = await medir(page);
      ok(achados.length === 0, `${w}px · a linha do banner com o texto por cima, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      ok(erros.length === 0, `${w}px · Banners: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    } catch (e) {
      ok(false, `${w}px · Banners (${umaLinha(String(e?.message ?? e))})`);
      await page.screenshot({ path: arquivoFoto(`erro-${w}.png`) }).catch(() => {});
    } finally {
      await ctx.close();
    }
  }

  // O limite de 6: com 5 ainda entra mais um; com 6 os botões de criar saem, o aviso diz o limite e "Salvar" manda os 6 na ordem.
  const VARIOS = (n) => () => Array.from({ length: n }, (_, i) => ({ id: `v${i + 1}`, imagemRef: IMG, titulo: `Banner ${i + 1}`, link: '', ativo: true, apareceDe: null, apareceAte: null }));
  for (const w of larguras) {
    {
      const { ctx, page, erros } = await abrir(w, SITUACAO_IA, VARIOS(5));
      try {
        const mais = page.getByRole('button', { name: '＋ Banner' });
        const ia = page.getByRole('button', { name: '✨ Criar com IA' });
        ok((await mais.count()) === 1 && (await ia.count()) === 1, `${w}px · com 5 banners ainda dá para pôr mais um`);
        await mais.click();
        await page.getByLabel('Título do banner 6').waitFor({ timeout: 5000 });
        const achados = await medir(page);
        ok((await mais.count()) === 0 && (await ia.count()) === 0 && (await page.getByText('Máximo de 6 banners.').isVisible()) && achados.length === 0 && erros.length === 0, `${w}px · no 6º os botões de criar saem e o limite aparece, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      } catch (e) {
        ok(false, `${w}px · com 5 banners (${umaLinha(String(e?.message ?? e))})`);
      } finally {
        await ctx.close();
      }
    }
    {
      const { ctx, page, erros, enviados } = await abrir(w, SITUACAO_IA, VARIOS(6));
      try {
        await page.getByRole('button', { name: 'Subir o banner 6' }).click();
        await Promise.all([
          page.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/cardapio/banners') && r.request().method() === 'PUT', { timeout: 8000 }),
          page.getByRole('button', { name: 'Salvar', exact: true }).click(),
        ]);
        const titulos = (enviados[0]?.banners ?? []).map((b) => b.titulo);
        ok(titulos.join() === 'Banner 1,Banner 2,Banner 3,Banner 4,Banner 6,Banner 5' && erros.length === 0, `${w}px · "Salvar" manda os 6 na ordem escolhida (${umaLinha(titulos.join(', '))})`);
      } catch (e) {
        ok(false, `${w}px · com 6 banners (${umaLinha(String(e?.message ?? e))})`);
      } finally {
        await ctx.close();
      }
    }
  }

  // B2: quem não pode criar vê o motivo e nenhum "Criar banner"; a leitura que falha oferece "Tentar de novo".
  for (const w of [320, 390, 1366]) {
    for (const [rotulo, situacao, frase] of [
      ['sem franquia', { pode: false, podeCriar: true, podeEditar: true, podeMelhorar: true, motivo: 'sem-franquia', mensagem: 'A empresa ainda não tem franquia de imagem. Fale com a DMS para liberar.', franquia: { usados: 0, total: 0 } }, 'ainda não tem franquia'],
      ['franquia acabou', { pode: false, podeCriar: true, podeEditar: true, podeMelhorar: true, motivo: 'franquia-esgotada', mensagem: 'A franquia de imagem deste mês acabou. Ela volta no dia 1º.', franquia: { usados: 20, total: 20 } }, 'deste mês acabou'],
      ['desligado', { pode: false, podeCriar: false, podeEditar: false, podeMelhorar: false, motivo: 'desligado', mensagem: 'O DMS Graph não está ligado nesta empresa. O presidente liga em Delivery › Configurações › Integrações.', franquia: null }, 'não está ligado'],
      ['leitura falhou', null, 'O servidor não respondeu.'],
    ]) {
      const { ctx, page } = await abrir(w, situacao);
      try {
        await page.getByRole('button', { name: '✨ Criar com IA' }).click();
        await dialogo(page);
        const g = page.locator('[role="dialog"]');
        await g.getByText(frase).waitFor({ timeout: 8000 });
        const achados = await medir(page);
        const tentar = await g.getByRole('button', { name: 'Tentar de novo' }).count();
        ok(achados.length === 0 && (await g.getByRole('button', { name: 'Criar banner' }).count()) === 0 && tentar === (situacao ? 0 : 1), `${w}px · ${rotulo}: o motivo, sem "Criar banner"${situacao ? '' : ', com "Tentar de novo"'}${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      } catch (e) {
        ok(false, `${w}px · ${rotulo} (${umaLinha(String(e?.message ?? e))})`);
      } finally {
        await ctx.close();
      }
    }
  }

  // ───────────────────────── o cardápio: o banner abre as regras do clube e Sua conta ─────────────────────────
  async function abrirCardapio(w, link, regras, banner = { imagemRef: IMG, titulo: 'Banner do clube', link }, tema = 'oferta', espera = 'button[aria-label="Banner do clube"]', movimento = 'reduce') {
    const ctx = await nav.newContext({ viewport: { width: w, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900, reducedMotion: movimento });
    await ctx.addInitScript((t) => localStorage.setItem(`regem_loja_clientetoken_${t}`, 'ct-falso-do-roteiro'), TOKEN_CARDAPIO);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route((u) => u.hostname === 'imagens.exemplo.test', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      const raiz = `/publico/cardapio/${TOKEN_CARDAPIO}`;
      if (p === raiz) return responder(route, { ...MENU, banners: Array.isArray(banner) ? banner : [banner] });
      if (p === `${raiz}/clube/regras`) return responder(route, { regras });
      if (p === `${raiz}/cliente`)
        return responder(route, { nome: 'Ana Souza', telefone: '21900000000', cliente: { nome: 'Ana Souza', telefone: '21900000000' }, enderecos: [], historico: [] });
      if (p === `${raiz}/cliente/presentes`) return responder(route, { presentes: [], paraRevelar: [], album: { ativo: false }, meta: { ativo: false } });
      if (p === `${raiz}/promos`) return responder(route, { cupons: [], fidelidadeAtiva: false });
      if (req.method() === 'POST') return responder(route, { ok: true });
      return responder(route, {});
    });
    await page.goto(`${base}/c/${TOKEN_CARDAPIO}?tema=${tema}`);
    await page.waitForSelector(espera, { timeout: 30000 });
    return { ctx, page, erros };
  }

  // B2: o texto por cima, no maior tamanho aceito, nos 4 modelos: dentro do banner, fora do logo e dos botões da capa.
  const COM_TEXTO = { imagemRef: IMG, titulo: null, link: null, textoTitulo: TITULO_LONGO, textoChamada: CHAMADA_LONGA, descricao: 'Hambúrguer duplo com bacon' };
  for (const w of larguras) {
    for (const tema of ['oferta', 'balcao', 'fluxo', 'galeria']) {
      const { ctx, page, erros } = await abrirCardapio(w, null, [], COM_TEXTO, tema, tema === 'galeria' ? '.g-cap' : '.p-ban-txt');
      try {
        const r = await page.evaluate(() => {
          const caixa = document.querySelector('.p-ban-txt, .g-cap');
          const pai = caixa.closest('.p-ban, .g-slide').getBoundingClientRect();
          const partes = [...caixa.querySelectorAll('b, span')].map((e) => e.getBoundingClientRect());
          const bate = (a, c) => a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top;
          const batem = [...document.querySelectorAll('.b-logo, .o-logo, .ac-fab')].filter((o) => partes.some((p) => bate(p, o.getBoundingClientRect()))).map((o) => o.className);
          return { batem, fora: partes.filter((p) => p.bottom > pai.bottom + 1 || p.top < pai.top - 1 || p.right > pai.right + 1 || p.left < pai.left - 1).length, alt: document.querySelector('.p-ban img, .g-slide img')?.alt, texto: caixa.innerText };
        });
        const achados = await medir(page);
        ok(r.batem.length === 0 && r.fora === 0 && r.alt === COM_TEXTO.descricao && r.texto.includes('Sextou') && achados.length === 0 && erros.length === 0, `${w}px · ${tema}: o texto por cima dentro do banner, fora do logo e dos botões (${umaLinha(JSON.stringify({ batem: r.batem, fora: r.fora, alt: r.alt, achados, erros }))})`);
        if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`cardapio-texto-${tema}-${w}.png`) });
      } catch (e) {
        ok(false, `${w}px · ${tema}: o texto por cima (${umaLinha(String(e?.message ?? e))})`);
      } finally {
        await ctx.close();
      }
    }
  }

  // Os 6 banners no cardápio, nos 4 modelos: um ponto para cada, fora do logo e dos botões, e o último chega à tela.
  const SEIS = Array.from({ length: 6 }, (_, i) => ({ imagemRef: IMG, titulo: `Banner ${i + 1}`, link: null }));
  for (const w of larguras) {
    for (const tema of ['oferta', 'balcao', 'fluxo', 'galeria']) {
      const { ctx, page, erros } = await abrirCardapio(w, null, [], SEIS, tema, tema === 'galeria' ? '.g-dots' : '.p-ban-d');
      try {
        if (tema !== 'galeria') await page.locator('.p-ban-d button').nth(5).click();
        const r = await page.evaluate(async (galeria) => {
          const espera = (ms) => new Promise((f) => setTimeout(f, ms));
          const bate = (a, c) => a.left < c.right && a.right > c.left && a.top < c.bottom && a.bottom > c.top;
          const pai = document.querySelector(galeria ? '.g-slide' : '.p-ban');
          const imagens = [...document.querySelectorAll(galeria ? '.g-slide img' : '.p-ban img')];
          const pontos = [...document.querySelectorAll(galeria ? '.g-dots i' : '.p-ban-d button')];
          if (galeria) {
            const pista = pai.parentElement;
            pista.scrollTo({ left: pista.scrollWidth, behavior: 'instant' });
          }
          await espera(galeria ? 250 : 700);
          const area = (galeria ? pai.parentElement : pai).getBoundingClientRect();
          const ultima = imagens[5]?.getBoundingClientRect();
          const caixas = pontos.map((p) => p.getBoundingClientRect());
          return {
            imagens: imagens.length,
            pontos: pontos.length,
            ativo: pontos.findIndex((p) => p.classList.contains('on')),
            naTela: !!ultima && ultima.left >= area.left - 1 && ultima.right <= area.right + 1,
            pontosFora: caixas.filter((c) => c.left < 0 || c.right > document.documentElement.clientWidth).length,
            batem: [...document.querySelectorAll('.b-logo, .o-logo, .ac-fab')].filter((o) => caixas.some((c) => bate(c, o.getBoundingClientRect()))).map((o) => o.className),
          };
        }, tema === 'galeria');
        const achados = await medir(page);
        ok(r.imagens === 6 && r.pontos === 6 && r.ativo === 5 && r.naTela && r.pontosFora === 0 && r.batem.length === 0 && achados.length === 0 && erros.length === 0, `${w}px · ${tema}: 6 banners, 6 pontos e o último na tela (${umaLinha(JSON.stringify({ ...r, achados, erros }))})`);
        if (w === 390 || w === 1440) {
          await page.evaluate(() => document.querySelector('.p-scroll')?.scrollTo(0, 0));
          await page.screenshot({ path: arquivoFoto(`cardapio-seis-${tema}-${w}.png`) });
        }
      } catch (e) {
        ok(false, `${w}px · ${tema}: os 6 banners (${umaLinha(String(e?.message ?? e))})`);
        await page.screenshot({ path: arquivoFoto(`cardapio-seis-${tema}-${w}-erro.png`) }).catch(() => {});
      } finally {
        await ctx.close();
      }
    }
  }

  // O GIF no cardápio: toca para quem não pediu menos movimento; quem pediu vê a imagem parada. Nos 4 modelos, sem mudar o tamanho.
  const COM_GIF = { ...COM_TEXTO, imagemAnimadaRef: GIF_IA };
  for (const w of [320, 390, 1366]) {
    for (const tema of ['oferta', 'balcao', 'fluxo', 'galeria']) {
      for (const [movimento, esperado] of [['no-preference', GIF_IA], ['reduce', IMG]]) {
        const { ctx, page, erros } = await abrirCardapio(w, null, [], COM_GIF, tema, tema === 'galeria' ? '.g-cap' : '.p-ban-txt', movimento);
        try {
          await page.waitForFunction(() => {
            const i = document.querySelector('.p-ban img, .g-slide img');
            return i && i.currentSrc && i.complete;
          }, null, { timeout: 8000 });
          const r = await page.evaluate(() => {
            const i = document.querySelector('.p-ban img, .g-slide img');
            const a = i.getBoundingClientRect();
            const pai = i.closest('.p-ban, .g-slide').getBoundingClientRect();
            return { src: i.currentSrc, cobre: Math.abs(a.width - pai.width) <= 1 && Math.abs(a.height - pai.height) <= 1, alt: i.alt };
          });
          const achados = await medir(page);
          ok(r.src === esperado && r.cobre && r.alt === COM_TEXTO.descricao && achados.length === 0 && erros.length === 0, `${w}px · ${tema} · ${movimento}: mostra ${esperado === GIF_IA ? 'o GIF' : 'a imagem parada'}, cobrindo o banner (${umaLinha(JSON.stringify(r))})`);
        } catch (e) {
          ok(false, `${w}px · ${tema} · ${movimento}: o GIF no cardápio (${umaLinha(String(e?.message ?? e))})`);
        } finally {
          await ctx.close();
        }
      }
    }
  }

  for (const w of larguras) {
    {
      const { ctx, page, erros } = await abrirCardapio(w, 'clube:regras', ['Não há sorteio: todo mundo que cumpre a regra recebe.', 'Um benefício por pedido.']);
      try {
        await page.locator('button[aria-label="Banner do clube"]').first().click();
        await page.waitForSelector('[role="dialog"][aria-label="Regras do clube"] li', { timeout: 10000 });
        const achados = await medir(page);
        const t = await texto(page, '[role="dialog"][aria-label="Regras do clube"]');
        ok(achados.length === 0 && t.includes('Não há sorteio') && t.includes('Um benefício por pedido.'), `${w}px · o banner "Regras do clube" abre as regras, sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
        if (w === 390 || w === 1440) await page.screenshot({ path: arquivoFoto(`cardapio-regras-${w}.png`) });
        ok(erros.length === 0, `${w}px · cardápio com as regras: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
      } catch (e) {
        ok(false, `${w}px · o banner das regras (${umaLinha(String(e?.message ?? e))})`);
        await page.screenshot({ path: arquivoFoto(`cardapio-regras-${w}-erro.png`) }).catch(() => {});
      } finally {
        await ctx.close();
      }
    }
  }
  for (const w of [390, 1366]) {
    {
      // Sem nenhuma ferramenta ligada, a lista vem vazia: "o clube ainda não está aberto".
      const { ctx, page } = await abrirCardapio(w, 'regem:regras', []);
      try {
        await page.locator('button[aria-label="Banner do clube"]').first().click();
        await page.waitForSelector('text=O clube desta loja ainda não está aberto.', { timeout: 10000 });
        ok(true, `${w}px · sem regras: "O clube desta loja ainda não está aberto."`);
      } catch (e) {
        ok(false, `${w}px · as regras vazias (${umaLinha(String(e?.message ?? e))})`);
      } finally {
        await ctx.close();
      }
    }
    {
      // "Meus prêmios e o álbum": Sua conta em Benefícios.
      const { ctx, page } = await abrirCardapio(w, 'clube:premios', []);
      try {
        await page.locator('button[aria-label="Banner do clube"]').first().click();
        await page.waitForSelector('[role="dialog"][aria-label="Sua conta"]', { timeout: 10000 });
        const aba = await page.getByRole('button', { name: 'Benefícios' }).getAttribute('aria-pressed');
        ok(aba === 'true', `${w}px · o banner "Meus prêmios e o álbum" abre Sua conta em Benefícios (aria-pressed: ${aba})`);
      } catch (e) {
        ok(false, `${w}px · o banner dos prêmios (${umaLinha(String(e?.message ?? e))})`);
      } finally {
        await ctx.close();
      }
    }
  }
}
