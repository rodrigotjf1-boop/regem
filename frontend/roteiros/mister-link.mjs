// Roteiro de tela da F4.2a do Mister — a página do LINK COM PIN (`/m/<código>`; protótipo `mockups/regem-mister-pin.html`,
// aprovado em 16/11/2026; mig 433). A API simulada, com o estado decidido "no servidor" (como o de verdade).
//  • Cada estado (pede o PIN, fazendo, feito, não deu, não autorizou, venceu, bloqueado, não vale, falha) em cada largura:
//    nenhuma barra lateral, nada fora da janela, nenhum texto esmagado, os botões com altura de toque; foto de cada um.
//  • O PIN: só dígitos, até 6; "Autorizar" só com 4 ou mais; o errado diz quantas restam, limpa e volta ao campo; o certo
//    mostra "Fazendo agora…" e a página acompanha até "Feito"; cinco errados bloqueiam; "Não autorizar" fecha sem PIN.
//  • Isolada: só as rotas do link (nada de login nem de outras telas), nada guardado no aparelho (armazenamento e cookies
//    vazios), o endereço não vai a outro site (`referrer`), fora da busca; o campo não oferece guardar o PIN (V54).
//  • O prazo que passa com a página aberta: a página pergunta ao servidor (que diz "venceu").
import { responder } from './comum.mjs';
import { esmagados } from './candidatos-conducao.mjs';

const CODIGO = 'Ab3dEfGh1jKlMn0pQrStUvWxYz-_12_x';
const EMPRESA = 'Empório Sabor da Serra Comércio de Alimentos e Bebidas Artesanais Ltda';

const vistaBase = (agora) => ({
  estado: 'proposta',
  empresa: EMPRESA,
  titulo: 'Cancelar o pedido 5120 do iFood com o estorno do Pix para a cliente?',
  itens: [
    'O pedido é cancelado no Regem e no iFood.',
    'O estorno de R$ 132,90 é pedido ao Mercado Pago (cai na conta da cliente em até 1 dia útil).',
    'A cozinha tira o cartão, e a via "CANCELADO" sai na impressora.',
  ],
  detalhe: 'iFood · cliente Mariana S. · pago por Pix',
  valor: 132.9,
  botao: 'Autorizar o cancelamento',
  pedidoPor: 'Pedido pelo Mister às 21:02, para Ana (presidente).',
  valeAte: new Date(agora + 13 * 60_000).toISOString(),
  valeAteHora: '21:17',
  restam: 5,
  resultado: null,
  concluidaHora: null,
  respondida: null,
  erro: null,
});

const ESTADOS = {
  fazendo: { estado: 'fazendo', respondida: { hora: '21:05', nome: 'Ana', final: '4821' } },
  feito: {
    estado: 'feito',
    resultado: 'o pedido 5120 foi cancelado no Regem e no iFood, e o estorno de R$ 132,90 foi pedido ao Mercado Pago.',
    concluidaHora: '21:05',
    respondida: { hora: '21:05', nome: 'Ana', final: '4821' },
  },
  naodeu: {
    estado: 'naodeu',
    resultado: 'o iFood recusou o cancelamento: o pedido 5120 já saiu para entrega. Nada foi devolvido. Para resolver agora: Delivery › Pedidos, no pedido 5120.',
    concluidaHora: '21:05',
    respondida: { hora: '21:05', nome: 'Ana', final: '4821' },
  },
  recusou: { estado: 'recusou', resultado: 'não autorizada no Regem', concluidaHora: '21:04', respondida: { hora: '21:04', nome: 'Ana', final: '4821' } },
  venceu: { estado: 'venceu', resultado: 'ninguém respondeu no prazo', concluidaHora: '21:17' },
  bloqueado: { estado: 'bloqueado', restam: 0, resultado: 'link bloqueado: o PIN errado 5 vezes', concluidaHora: '21:06' },
};

const TEXTO_DO_ESTADO = {
  proposta: /Cancelar o pedido 5120 do iFood .*R\$ 132,90 .*O pedido é cancelado no Regem e no iFood\..*Pedido pelo Mister às 21:02, para Ana \(presidente\)\. ⏱ Vale até 21:17 · faltam 1[23] min Digite o seu PIN do Regem/,
  fazendo: /Fazendo agora… O PIN conferiu e o Regem está fazendo o que você autorizou\. Pode fechar: o resultado também chega no WhatsApp\./,
  feito: /Feito às 21:05 O pedido 5120 foi cancelado no Regem e no iFood.* Autorizado às 21:05 por Ana \(telefone com final 4821\)\./,
  naodeu: /Não deu O iFood recusou o cancelamento: .*Delivery › Pedidos, no pedido 5120\. Autorizado às 21:05 por Ana/,
  recusou: /Você não autorizou Nada foi feito\. Não autorizado às 21:04 por Ana \(telefone com final 4821\)\. Se mudar de ideia, peça de novo ao Mister\./,
  venceu: /Este pedido de autorização venceu Ele valia até 21:17\. Nada foi feito\. Se ainda precisar, peça de novo ao Mister\./,
  bloqueado: /Link bloqueado por segurança O PIN foi digitado errado 5 vezes\. Nada foi feito\./,
  naoVale: /Este link não vale .*Nada foi feito\. Se ainda precisar, peça de novo ao Mister\./,
  erro: /Não consegui abrir esta autorização .*Tentar de novo/,
};

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) achados.push(`rola ${el.tagName.toLowerCase()} ${el.scrollWidth}>${el.clientWidth}`);
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.right > window.innerWidth + 1) achados.push(`passa ${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 20)}" ${Math.round(r.right)}>${window.innerWidth}`);
    }
    for (const b of document.querySelectorAll('main button')) {
      const r = b.getBoundingClientRect();
      if (r.height && r.height < 43.5) achados.push(`botão baixo "${b.textContent?.trim().slice(0, 20)}" ${Math.round(r.height)}px`);
    }
    return achados;
  });

export default async function roteiroMisterLink({ nav, base, ok, foto, larguras }) {
  /**
   * Abre a página com o "servidor" simulado. `estado` = o que a leitura devolve primeiro; `pinCerto` = o PIN que confere;
   * `falhas` = quantas leituras respondem 503 antes; `ver404` = o link não vale.
   */
  async function abrir(w, { estado = 'proposta', falhas = 0, ver404 = false, autorizar429 = false, vencida = false } = {}) {
    const ctx = await nav.newContext({ viewport: { width: w, height: w < 700 ? 820 : 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    const page = await ctx.newPage();
    const erros = [];
    const outros = [];
    const chamadas = { ver: 0, autorizar: [], nao: 0 };
    const agora = Date.now();
    let v = { ...vistaBase(agora), ...(estado === 'proposta' ? {} : ESTADOS[estado]) };
    if (vencida) v = { ...v, valeAte: new Date(agora - 1000).toISOString() };
    let falhar = falhas;
    let fazendoLeituras = 0;
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
      const raiz = `/publico/mister/link/${CODIGO}`;
      if (p === raiz && route.request().method() === 'GET') {
        chamadas.ver++;
        if (ver404) return responder(route, { message: 'Este link não vale. Peça de novo ao Mister.' }, 404);
        if (falhar > 0) {
          falhar--;
          return responder(route, { message: 'O servidor demorou para responder.' }, 503);
        }
        // O prazo passou com a página aberta: o servidor diz "venceu".
        if (vencida && chamadas.ver > 1) v = { ...v, ...ESTADOS.venceu };
        // Executando: depois de duas leituras, o "servidor" conferiu o efeito.
        if (v.estado === 'fazendo' && ++fazendoLeituras >= 2) v = { ...v, ...ESTADOS.feito };
        return responder(route, { ...v, erro: null });
      }
      if (p === `${raiz}/autorizar`) {
        const { pin } = JSON.parse(route.request().postData() || '{}');
        chamadas.autorizar.push(pin);
        if (autorizar429) return responder(route, { message: 'ThrottlerException: Too Many Requests' }, 429);
        if (v.estado !== 'proposta') return responder(route, { ...v, erro: null });
        if (pin === '2580') {
          v = { ...v, ...ESTADOS.fazendo };
          return responder(route, { ...v, erro: null });
        }
        const restam = v.restam - 1;
        v = restam > 0 ? { ...v, restam } : { ...v, ...ESTADOS.bloqueado };
        return responder(route, { ...v, erro: restam > 0 ? (restam === 1 ? 'O PIN não confere. Resta 1 tentativa.' : `O PIN não confere. Restam ${restam} tentativas.`) : null });
      }
      if (p === `${raiz}/nao-autorizar`) {
        chamadas.nao++;
        if (v.estado === 'proposta') v = { ...v, ...ESTADOS.recusou };
        return responder(route, { ...v, erro: null });
      }
      outros.push(p);
      return responder(route, {});
    });
    await page.goto(`${base}/m/${CODIGO}`);
    await page.waitForSelector('[data-link-do-mister]:not([data-estado="carregando"])', { timeout: 20000 });
    return { ctx, page, erros, outros, chamadas };
  }
  const textoDe = async (page) => (await page.locator('[data-link-do-mister]').innerText()).replace(/\s+/g, ' ');

  // ── cada estado em cada largura: o texto, sem barra lateral, nada fora, nada esmagado, botões de toque ──
  for (const estado of ['proposta', 'fazendo', 'feito', 'naodeu', 'recusou', 'venceu', 'bloqueado']) {
    for (const w of estado === 'proposta' ? larguras : larguras.filter((x) => [320, 375, 768, 1280].includes(x))) {
      const { ctx, page, erros, outros } = await abrir(w, { estado });
      // "Fazendo" anda sozinho para "Feito": confere logo depois de abrir.
      const t = await textoDe(page);
      ok(estado === 'fazendo' ? TEXTO_DO_ESTADO.fazendo.test(t) || TEXTO_DO_ESTADO.feito.test(t) : TEXTO_DO_ESTADO[estado].test(t), `${estado} ${w}: o texto do estado (${t.slice(0, 160)})`);
      ok(t.includes('Esta página é só desta autorização. Nada fica guardado neste aparelho.'), `${estado} ${w}: o rodapé`);
      ok((await page.locator('header').innerText()).includes(EMPRESA), `${estado} ${w}: o topo com o nome da empresa (mesmo comprido)`);
      const m = await medir(page);
      ok(m.length === 0, `${estado} ${w}: nenhuma barra lateral, nada fora da janela, botões de toque ${m.slice(0, 3).join(' | ')}`);
      const e = await esmagados(page, '[data-link-do-mister]');
      ok(e.length === 0, `${estado} ${w}: nenhum texto esmagado ${e.slice(0, 3).join(' | ')}`);
      if ([320, 375, 768, 1920].includes(w) || estado !== 'proposta') await page.locator('[data-link-do-mister]').screenshot({ path: foto(`${estado}-${w}.png`) });
      ok(outros.length === 0, `${estado} ${w}: a página só fala com as rotas do link (${outros.join(', ')})`);
      ok(erros.length === 0, `${estado} ${w}: sem erro (${erros.join(' | ')})`);
      await ctx.close();
    }
  }

  // ── o link que não vale e a leitura que falha ──
  {
    const { ctx, page, erros } = await abrir(375, { ver404: true });
    const t = await textoDe(page);
    ok(TEXTO_DO_ESTADO.naoVale.test(t) && !/PIN/.test(t), `não vale: a frase, sem o campo do PIN (${t.slice(0, 140)})`);
    ok((await medir(page)).length === 0, 'não vale: sem barra lateral');
    await page.locator('[data-link-do-mister]').screenshot({ path: foto('nao-vale-375.png') });
    ok(erros.length === 0, `não vale: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, erros, chamadas } = await abrir(320, { falhas: 1 });
    ok(TEXTO_DO_ESTADO.erro.test(await textoDe(page)), 'falha: diz que não abriu, com "Tentar de novo"');
    ok((await medir(page)).length === 0, 'falha: sem barra lateral em 320');
    await page.locator('[data-link-do-mister]').screenshot({ path: foto('falha-320.png') });
    await page.click('button:has-text("Tentar de novo")');
    await page.waitForSelector('#link-pin', { timeout: 10000 });
    ok(chamadas.ver === 2, `falha: "Tentar de novo" lê de novo e abre a proposta (${chamadas.ver})`);
    ok(erros.length === 0, `falha: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── o PIN: só dígitos; "Autorizar" com 4+; o errado diz quantas restam e limpa; o certo faz e acompanha até "Feito" ──
  {
    const { ctx, page, erros, chamadas } = await abrir(375);
    const campo = page.locator('#link-pin');
    const autorizar = page.locator('button:has-text("Autorizar o cancelamento")');
    ok((await campo.getAttribute('inputmode')) === 'numeric' && (await campo.getAttribute('autocomplete')) !== 'on' && (await campo.getAttribute('autocomplete')) !== null, `PIN: teclado numérico e o navegador não oferece guardar (autocomplete=${await campo.getAttribute('autocomplete')})`);
    ok((await campo.getAttribute('type')) === 'password' || (await campo.getAttribute('data-senha-sem-salvar')) !== null, 'PIN: com a máscara de pontos (V54)');
    ok(await autorizar.isDisabled(), 'PIN: "Autorizar" começa desligado');
    await campo.fill('a1b2c');
    ok((await campo.inputValue()) === '12' && (await autorizar.isDisabled()), `PIN: só os dígitos ficam (${await campo.inputValue()}); com 2, ainda desligado`);
    await campo.fill('12345678');
    ok((await campo.inputValue()) === '123456', 'PIN: no máximo 6 dígitos');
    await campo.fill('0000');
    ok(await autorizar.isEnabled(), 'PIN: com 4 dígitos, "Autorizar" liga');
    await autorizar.click();
    // O aviso do campo (o Next tem o seu próprio `role="alert"`, o anunciador de rotas).
    await page.waitForSelector('#link-pin-nota[role="alert"]:has-text("Restam 4 tentativas")', { timeout: 10000 });
    ok((await campo.inputValue()) === '' && (await campo.getAttribute('aria-invalid')) === 'true', 'PIN errado: o campo limpa e fica marcado');
    ok(await page.evaluate(() => document.activeElement?.id === 'link-pin'), 'PIN errado: o foco volta ao campo');
    ok(chamadas.autorizar.join(',') === '0000', `PIN errado: mandou o que foi digitado, uma vez (${chamadas.autorizar.join(',')})`);
    await page.locator('[data-link-do-mister]').screenshot({ path: foto('pin-errado-375.png') });
    await campo.fill('2580');
    await page.keyboard.press('Enter');
    await page.waitForSelector('text=Fazendo agora…', { timeout: 10000 });
    await page.waitForSelector('text=Feito às 21:05', { timeout: 15000 });
    ok(TEXTO_DO_ESTADO.feito.test(await textoDe(page)), 'PIN certo: "Fazendo agora…" e a página acompanha até "Feito" com quem autorizou');
    ok(chamadas.ver >= 3, `PIN certo: acompanhou pelo servidor (${chamadas.ver} leituras)`);
    // Nada guardado no aparelho.
    const guardado = await page.evaluate(() => ({ local: localStorage.length, sessao: sessionStorage.length }));
    ok(guardado.local === 0 && guardado.sessao === 0 && (await ctx.cookies()).length === 0, `nada guardado no aparelho (${JSON.stringify(guardado)})`);
    ok((await page.locator('meta[name="referrer"]').getAttribute('content')) === 'no-referrer', 'o endereço com o código não vai a outro site (referrer)');
    ok(/noindex/.test((await page.locator('meta[name="robots"]').getAttribute('content')) ?? ''), 'fora da busca');
    ok(erros.length === 0, `PIN: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── cinco errados bloqueiam; "Não autorizar" fecha sem PIN; o limite por minuto; o prazo que passa com a página aberta ──
  {
    const { ctx, page, erros, chamadas } = await abrir(360);
    // Espera a frase EXATA de cada tentativa: a resposta limpa o campo, e a próxima só se digita depois dela.
    for (const [pin, frase] of [['1111', 'Restam 4 tentativas'], ['2222', 'Restam 3 tentativas'], ['3333', 'Restam 2 tentativas'], ['4444', 'Resta 1 tentativa']]) {
      await page.fill('#link-pin', pin);
      await page.click('button:has-text("Autorizar o cancelamento")');
      await page.waitForFunction((f) => document.querySelector('#link-pin-nota[role="alert"]')?.textContent?.includes(f), frase, { timeout: 10000 });
    }
    ok((await page.locator('#link-pin-nota[role="alert"]').innerText()).includes('Resta 1 tentativa'), 'bloqueio: a quarta errada diz "Resta 1 tentativa"');
    await page.fill('#link-pin', '5555');
    await page.click('button:has-text("Autorizar o cancelamento")');
    await page.waitForSelector('text=Link bloqueado por segurança', { timeout: 10000 });
    ok(chamadas.autorizar.length === 5 && !(await page.locator('#link-pin').count()), 'bloqueio: a quinta errada bloqueia e o campo some');
    ok(erros.length === 0, `bloqueio: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, erros, chamadas } = await abrir(375);
    await page.click('button:has-text("Não autorizar")');
    await page.waitForSelector('text=Você não autorizou', { timeout: 10000 });
    ok(chamadas.nao === 1 && chamadas.autorizar.length === 0, '"Não autorizar": fecha sem pedir o PIN');
    ok(erros.length === 0, `"Não autorizar": sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, erros } = await abrir(375, { autorizar429: true });
    await page.fill('#link-pin', '2580');
    await page.click('button:has-text("Autorizar o cancelamento")');
    await page.waitForSelector('#link-pin-nota[role="alert"]:has-text("Muitas tentativas agora")', { timeout: 10000 });
    ok(await page.locator('#link-pin').isVisible(), 'limite por minuto: a frase, e a proposta continua na tela');
    ok(erros.length === 0, `limite: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, erros, chamadas } = await abrir(375, { vencida: true });
    await page.waitForSelector('text=Este pedido de autorização venceu', { timeout: 10000 });
    ok(chamadas.ver === 2, `prazo: passou com a página aberta, ela pergunta ao servidor e mostra "venceu" (${chamadas.ver} leituras)`);
    ok(erros.length === 0, `prazo: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
