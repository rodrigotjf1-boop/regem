// Roteiro de tela do MISTER NO CONSOLE DA DISTRIBUIÇÃO (protótipo `mockups/regem-mister.html`, aba "Console da
// distribuição", aprovado em 13/11/2026), com a API e a janela da Meta simuladas.
// Confere: a aba só existe para a Diretoria; número não conectado — "Conectar com a Meta" só libera depois de escolher a
// forma, e na forma "só na API" depois do PIN de seis dígitos; o que vai ao servidor (a forma, o código da Meta, o PIN só
// quando é o caso) e o `featureType` da janela; a janela fechada não muda nada; os avisos da Meta aparecem; conectar NÃO
// liga a chave geral; conectado — os dados do número e o aviso da coexistência; desconectar e desligar pedem
// confirmação (Esc cancela, sem chamada); o número que caiu mostra o motivo; a lista de empresas com os rótulos, a busca
// que vai ao servidor (e só a resposta mais nova vale), vazio, teto e erro com "Tentar de novo"; e, em cada largura, a
// página e o diálogo inteiros na tela, sem barra lateral — tabela no largo, cartões no estreito.
import { responder, tokenFalso } from './comum.mjs';

const DIRETORIA = tokenFalso({ escopo: 'distribuicao', perfil: 'diretoria', nome: 'Rodrigo' });
const TECNICO = tokenFalso({ escopo: 'distribuicao', perfil: 'tecnico', nome: 'Técnica' });

const CADASTRO = { appId: '111', configId: '222', graphVersion: 'v25.0', pronto: true };
const SEM = { situacao: 'sem', numero: null, nome: null, forma: null, motivo: null, conectadoEm: null, situacaoEm: null, ultimaEntradaEm: null, qualidade: null, avisosPorDia: null };
const conectado = (forma = 'coexistencia') => ({
  situacao: 'conectado',
  numero: '5521900000000',
  nome: 'Mister',
  forma,
  motivo: null,
  conectadoEm: '2026-11-13T12:00:00Z',
  situacaoEm: '2026-11-13T12:00:00Z',
  ultimaEntradaEm: '2026-11-13T23:15:00Z',
  qualidade: 'green',
  avisosPorDia: 2000,
});
const CAIU = { ...conectado(), situacao: 'caiu', motivo: 'Object with ID does not exist', situacaoEm: '2026-11-10T09:00:00Z', qualidade: null, avisosPorDia: null };
const EMPRESAS = [
  { tenantId: 'a', nome: 'Burger da Praça', modulo: true, ia: { origem: 'propria', provedor: 'anthropic' }, pessoas: 3, usoUsd: 10.23, situacao: 'funcionando', motivo: null },
  { tenantId: 'b', nome: 'Pizzaria do Porto', modulo: true, ia: { origem: 'propria', provedor: 'anthropic' }, pessoas: 1, usoUsd: 2.1, situacao: 'ia_parada', motivo: 'sem_credito' },
  { tenantId: 'c', nome: 'Empório Sabor da Serra Comércio de Alimentos e Bebidas Artesanais Ltda', modulo: true, ia: { origem: null, provedor: null }, pessoas: 0, usoUsd: 0, situacao: 'falta_chave_e_whatsapp', motivo: null },
  { tenantId: 'd', nome: 'Cantina Bella', modulo: false, ia: { origem: 'incluida', provedor: null }, pessoas: 0, usoUsd: null, situacao: 'modulo_desligado', motivo: null },
];

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('main *, [role="alertdialog"] *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      // Nada do conteúdo passa da borda direita da janela (texto comprido de empresa, número, selo).
      if (el.getClientRects().length && el.getBoundingClientRect().right > window.innerWidth + 1) achados.push(`passa da tela ${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 24)}"`);
    }
    for (const d of document.querySelectorAll('[role="alertdialog"]')) {
      const r = d.getBoundingClientRect();
      if (r.left < 0 || r.right > window.innerWidth + 1 || r.top < 0 || r.bottom > window.innerHeight + 1) achados.push(`diálogo fora da tela ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    for (const b of document.querySelectorAll('main button, [role="alertdialog"] button'))
      if (b.getClientRects().length && b.getBoundingClientRect().height < 39.5) achados.push(`botão baixo "${b.textContent.trim().slice(0, 30)}"`);
    return [...new Set(achados)];
  });

export default async function roteiroMisterConsole({ nav, base, ok, foto, larguras }) {
  async function abrir(w, h, o = {}) {
    const S = {
      numero: o.numero ?? SEM,
      liberado: o.liberado ?? false,
      empresas: o.empresas ?? EMPRESAS,
      total: o.total,
      falha: !!o.falha,
      falhaDaLista: !!o.falhaDaLista,
      avisos: o.avisos ?? [],
      atrasoDaBusca: o.atrasoDaBusca ?? {},
      pedidos: [],
    };
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript(
      ({ jwt, fecha }) => {
        localStorage.setItem('regem_dist_token', jwt);
        // A janela da Meta de mentira: guarda como foi aberta e conclui (ou é fechada sem concluir).
        window.FB = {
          init() {},
          login(cb, opcoes) {
            window.__janelaDaMeta = opcoes;
            setTimeout(() => cb(fecha ? {} : { authResponse: { code: 'codigo-da-meta' } }), 20);
          },
        };
      },
      { jwt: o.token ?? DIRETORIA, fecha: !!o.janelaFechada },
    );
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/connect.facebook.net/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const p = url.pathname.replace(/^.*\/api\/v1/, '');
      const metodo = req.method();
      if (p.startsWith('/distribuicao/mister')) S.pedidos.push({ metodo, p, busca: url.searchParams.get('busca') ?? '', corpo: req.postData() ? JSON.parse(req.postData()) : null });
      if (p === '/distribuicao/me') return responder(route, { sub: 'u1', nome: 'Rodrigo', perfil: JSON.parse(Buffer.from((o.token ?? DIRETORIA).split('.')[1], 'base64url').toString()).perfil });
      if (p === '/distribuicao/mister' && metodo === 'GET') {
        if (S.falha) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        return responder(route, { numero: S.numero, liberado: S.liberado, cadastro: o.cadastro ?? CADASTRO });
      }
      if (p === '/distribuicao/mister/empresas') {
        if (S.falhaDaLista) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        const busca = (url.searchParams.get('busca') ?? '').toLowerCase();
        const espera = S.atrasoDaBusca[busca];
        if (espera) await new Promise((r) => setTimeout(r, espera));
        const achadas = S.empresas.filter((e) => !busca || e.nome.toLowerCase().includes(busca));
        return responder(route, { empresas: achadas, total: S.total ?? achadas.length, limite: 200 });
      }
      if (p === '/distribuicao/mister/numero/conectar') {
        if (o.recusa) return responder(route, { statusCode: 400, message: o.recusa }, 400);
        S.numero = conectado(JSON.parse(req.postData()).forma);
        return responder(route, { numero: S.numero, avisos: S.avisos }, 201);
      }
      if (p === '/distribuicao/mister/numero/desconectar') {
        S.numero = SEM;
        return responder(route, S.numero, 201);
      }
      if (p === '/distribuicao/mister/liberacao') {
        S.liberado = JSON.parse(req.postData()).ligado === true;
        return responder(route, { ligado: S.liberado }, 201);
      }
      // O resto do console (frota, licenças, auditoria…) não é deste roteiro: listas vazias.
      return responder(route, []);
    });
    await page.goto(base + '/distribuicao');
    return { ctx, page, erros, S };
  }
  const feitos = (S, metodo, p) => S.pedidos.filter((x) => x.metodo === metodo && x.p === p);
  const naAba = async (page) => {
    await page.click('nav button:has-text("Mister")');
    await page.waitForSelector('h2:has-text("Número do Mister")', { timeout: 20000 });
  };

  // ── a aba é da Diretoria: o técnico não a vê e o painel do Mister nem é pedido ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { token: TECNICO });
    await page.waitForSelector('nav button:has-text("Frota")', { timeout: 20000 });
    ok((await page.locator('nav button:has-text("Mister")').count()) === 0, 'perfil técnico: a aba Mister não aparece');
    ok(S.pedidos.length === 0, 'perfil técnico: o painel do Mister não é pedido');
    await ctx.close();
  }

  // ── não conectado → coexistência: escolher a forma libera o botão; conectar não liga a chave geral ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { avisos: ['A Meta recusou um passo da coexistência (history: fora do prazo). Se não for refeito em 24 horas, ela desfaz a conexão: conecte de novo.'] });
    await naAba(page);
    await page.waitForSelector('text=○ não conectado');
    const conectar = page.locator('button:has-text("Conectar com a Meta")');
    ok(await conectar.isDisabled(), 'não conectado: "Conectar com a Meta" começa travado');
    const opcao = (t) => page.locator(`button[aria-pressed]:has-text("${t}")`);
    await opcao('Continua no WhatsApp Business do celular').click();
    ok((await opcao('Continua no WhatsApp Business do celular').getAttribute('aria-pressed')) === 'true' && (await opcao('Só na API oficial').getAttribute('aria-pressed')) === 'false', 'a forma escolhida fica marcada');
    await page.waitForSelector('text=versão 2.24.17 ou mais nova');
    ok((await page.locator('input[inputmode="numeric"]').count()) === 0, 'coexistência: não pede PIN');
    ok(await conectar.isEnabled(), 'com a forma escolhida, o botão libera');
    await conectar.click();
    await page.waitForSelector('text=● conectado');
    const [envio] = feitos(S, 'POST', '/distribuicao/mister/numero/conectar');
    ok(envio && envio.corpo.forma === 'coexistencia' && envio.corpo.code === 'codigo-da-meta' && !('pin' in envio.corpo), `coexistência: vai a forma e o código da Meta, sem PIN (${JSON.stringify(envio?.corpo)})`);
    const janela = await page.evaluate(() => window.__janelaDaMeta);
    ok(janela?.config_id === '222' && janela?.extras?.featureType === 'whatsapp_business_app_onboarding', 'a janela da Meta abre no caminho da coexistência');
    await page.waitForSelector('[role="alert"]:has-text("A Meta recusou um passo da coexistência")');
    ok(true, 'o aviso da Meta aparece para a distribuição');
    await page.waitForSelector('text=Conectar não liga o Mister');
    ok(/Liberação:\s*desligada/.test(await page.locator('section[aria-labelledby="mister-geral"]').innerText()), 'conectar o número não liga a chave geral');
    ok(feitos(S, 'POST', '/distribuicao/mister/liberacao').length === 0, 'nenhuma chamada à chave geral ao conectar');
    const cartao = await page.locator('section[aria-labelledby="mister-numero"]').innerText();
    ok(/\+55 21 90000-0000/.test(cartao) && /Mister/.test(cartao) && /Coexistência \(celular e API\)/.test(cartao) && /alta/.test(cartao) && /até 2\.000 pessoas/.test(cartao), 'conectado: número, nome, forma, qualidade e avisos por dia');
    ok(/a cada 14 dias/.test(cartao), 'coexistência: o aviso dos 14 dias');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── só na API: pede o PIN de seis dígitos e só ele libera; a janela abre sem o caminho da coexistência ──
  {
    const { ctx, page, S } = await abrir(1280, 900);
    await naAba(page);
    await page.locator('button[aria-pressed]:has-text("Só na API oficial")').click();
    const pin = page.locator('input[inputmode="numeric"]');
    await pin.waitFor();
    const conectar = page.locator('button:has-text("Conectar com a Meta")');
    ok(await conectar.isDisabled(), 'só na API: sem PIN o botão fica travado');
    await pin.fill('12a45');
    ok((await pin.inputValue()) === '1245' && (await conectar.isDisabled()), 'só na API: letra não entra e PIN curto não libera');
    await pin.fill('123456789');
    ok((await pin.inputValue()) === '123456' && (await conectar.isEnabled()), 'só na API: seis dígitos liberam (o sétimo não entra)');
    await conectar.click();
    await page.waitForSelector('text=● conectado');
    const [envio] = feitos(S, 'POST', '/distribuicao/mister/numero/conectar');
    ok(envio?.corpo.forma === 'api' && envio.corpo.pin === '123456', 'só na API: o PIN vai junto');
    ok((await page.evaluate(() => window.__janelaDaMeta?.extras?.featureType)) === '', 'só na API: a janela abre sem o caminho da coexistência');
    ok(/Só a API oficial/.test(await page.locator('section[aria-labelledby="mister-numero"]').innerText()) && (await page.locator('text=a cada 14 dias').count()) === 0, 'só na API: sem o aviso dos 14 dias');
    await ctx.close();
  }

  // ── a janela fechada sem concluir e a recusa do servidor: nada muda ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { janelaFechada: true });
    await naAba(page);
    await page.locator('button[aria-pressed]:has-text("Continua no WhatsApp Business do celular")').click();
    await page.click('button:has-text("Conectar com a Meta")');
    await page.waitForSelector('[role="alert"]:has-text("A janela da Meta foi fechada antes de concluir")');
    ok(feitos(S, 'POST', '/distribuicao/mister/numero/conectar').length === 0 && (await page.locator('text=○ não conectado').count()) === 1, 'janela fechada: nada vai ao servidor e o número segue não conectado');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { recusa: 'Este número já é o WhatsApp de uma loja (Burger da Praça). O número do Mister precisa ser só dele.' });
    await naAba(page);
    await page.locator('button[aria-pressed]:has-text("Continua no WhatsApp Business do celular")').click();
    await page.click('button:has-text("Conectar com a Meta")');
    await page.waitForSelector('[role="alert"]:has-text("já é o WhatsApp de uma loja")');
    ok((await page.locator('text=○ não conectado').count()) === 1, 'recusa do servidor: a frase dele aparece e o número segue não conectado');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { cadastro: { ...CADASTRO, pronto: false } });
    await naAba(page);
    await page.locator('button[aria-pressed]:has-text("Continua no WhatsApp Business do celular")').click();
    await page.waitForSelector('text=ainda não está configurado neste servidor');
    ok(await page.locator('button:has-text("Conectar com a Meta")').isDisabled(), 'servidor sem o cadastro da Meta: avisa e não deixa conectar');
    await ctx.close();
  }

  // ── a chave geral: ligar é direto; desligar pede confirmação, Esc cancela ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { numero: conectado(), liberado: false });
    await naAba(page);
    const geral = page.locator('section[aria-labelledby="mister-geral"]');
    await page.waitForSelector('text=o Mister só responde depois de ligado aqui');
    await geral.locator('button:has-text("Ligar o Mister")').click();
    await page.waitForSelector('text=Mister ligado nesta nuvem.');
    ok(feitos(S, 'POST', '/distribuicao/mister/liberacao')[0]?.corpo.ligado === true && /Liberação:\s*ligada/.test(await geral.innerText()), 'ligar: vai "ligado: true" e a tela mostra ligada');
    await geral.locator('button:has-text("Desligar o Mister")').click();
    const dialogo = page.locator('[role="alertdialog"]');
    await dialogo.waitFor();
    ok(/Vale para todas as empresas, na hora/.test(await dialogo.innerText()), 'desligar: o diálogo diz o alcance');
    ok(await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Cancelar'), 'desligar: o foco começa em "Cancelar"');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    ok(await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]')), 'desligar: o Tab não sai do diálogo');
    await page.keyboard.press('Escape');
    await dialogo.waitFor({ state: 'detached' });
    ok(feitos(S, 'POST', '/distribuicao/mister/liberacao').length === 1, 'desligar: Esc cancela, sem chamada');
    await geral.locator('button:has-text("Desligar o Mister")').click();
    await dialogo.locator('button:has-text("Desligar o Mister")').click();
    await page.waitForSelector('text=Mister desligado nesta nuvem.');
    ok(feitos(S, 'POST', '/distribuicao/mister/liberacao')[1]?.corpo.ligado === false && /Liberação:\s*desligada/.test(await geral.innerText()), 'desligar confirmado: vai "ligado: false"');
    // desconectar o número
    await page.click('button:has-text("Desconectar")');
    await dialogo.waitFor();
    ok(/As pessoas ligadas continuam ligadas/.test(await dialogo.innerText()), 'desconectar: o diálogo diz o que acontece com quem está ligado');
    await dialogo.locator('button:has-text("Cancelar")').click();
    await dialogo.waitFor({ state: 'detached' });
    ok(feitos(S, 'POST', '/distribuicao/mister/numero/desconectar').length === 0, 'desconectar: "Cancelar" não chama o servidor');
    await page.click('button:has-text("Desconectar")');
    await dialogo.locator('button:has-text("Desconectar")').click();
    await page.waitForSelector('text=○ não conectado');
    ok(feitos(S, 'POST', '/distribuicao/mister/numero/desconectar').length === 1, 'desconectar confirmado: o número volta a não conectado');
    await ctx.close();
  }

  // ── o número que caiu: o motivo e reconectar já com a forma de antes ──
  {
    const { ctx, page } = await abrir(1280, 900, { numero: CAIU, liberado: true });
    await naAba(page);
    await page.waitForSelector('text=● desconectado pela Meta');
    const cartao = await page.locator('section[aria-labelledby="mister-numero"]').innerText();
    ok(/deixou de reconhecer o número em 10\/11: Object with ID does not exist/.test(cartao) && /nada sai até reconectar/.test(cartao), 'caiu: a data, o motivo da Meta e a consequência');
    await page.click('button:has-text("Reconectar com a Meta")');
    ok((await page.locator('button[aria-pressed]:has-text("Continua no WhatsApp Business do celular")').getAttribute('aria-pressed')) === 'true', 'reconectar: a forma de antes já vem marcada');
    ok(await page.locator('button:has-text("Conectar com a Meta")').isEnabled(), 'reconectar: dá para conectar em seguida');
    await ctx.close();
  }

  // ── as empresas: rótulos, busca no servidor (só a resposta mais nova vale), vazio, teto e erro ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { numero: conectado(), liberado: true, total: 250, atrasoDaBusca: { p: 900 } });
    await naAba(page);
    const lista = page.locator('section[aria-labelledby="mister-empresas"]');
    await lista.locator('table >> text=Burger da Praça').waitFor();
    const linhas = await lista.locator('tbody tr').allInnerTexts();
    const linha = (nome) => (linhas.find((l) => l.includes(nome)) ?? '').replace(/\s+/g, ' ');
    ok(/ligado chave própria · Anthropic 3 US\$ 10,23 funcionando/.test(linha('Burger da Praça')), `empresa funcionando (${linha('Burger da Praça')})`);
    ok(/IA parada · sem crédito/.test(linha('Pizzaria do Porto')) && /US\$ 2,10/.test(linha('Pizzaria do Porto')), 'empresa com a IA parada diz o porquê');
    ok(/sem chave 0 US\$ 0,00 falta a chave e ligar o WhatsApp/.test(linha('Empório')), 'empresa sem chave e sem ninguém ligado');
    ok(/desligado IA incluída pela Regem 0 sem preço módulo desligado/.test(linha('Cantina Bella')), `empresa com o módulo desligado; uso sem preço não vira zero (${linha('Cantina Bella')})`);
    ok(/Mostrando 4 de 250 empresas/.test(await lista.innerText()), 'teto de linhas: diz quantas há e manda usar a busca');
    ok((await lista.locator('caption').count()) === 1, 'a tabela tem legenda para leitor de tela');
    // A busca "p" demora e acha TRÊS empresas; a "cantina" responde antes e acha uma. Vale a mais nova, mesmo a antiga
    // chegando depois — se a antiga valesse, a tela voltaria a três linhas.
    const busca = lista.locator('input[type="search"]');
    await busca.fill('p');
    await page.waitForTimeout(450);
    await busca.fill('cantina');
    await page.waitForTimeout(1500);
    const pedidas = feitos(S, 'GET', '/distribuicao/mister/empresas').map((x) => x.busca);
    ok(pedidas.includes('p') && pedidas.at(-1) === 'cantina', `a busca vai ao servidor, um instante depois de parar de digitar (${pedidas.join(',')})`);
    ok(feitos(S, 'GET', '/distribuicao/mister').length === 1, 'a busca não relê o número (o servidor só pergunta à Meta ao abrir o painel)');
    const depois = await lista.locator('tbody tr').allInnerTexts();
    ok(depois.length === 1 && depois[0].includes('Cantina Bella'), `só a resposta da busca mais nova vale (${depois.length} linhas)`);
    await busca.fill('zzz');
    await lista.locator('text=Nenhuma empresa com esse nome.').waitFor();
    ok((await lista.locator('table').count()) === 0, 'busca sem resultado: a frase, sem tabela vazia');
    S.falhaDaLista = true;
    await busca.fill('burger');
    await lista.locator('[role="alert"] >> text=Erro interno').waitFor();
    S.falhaDaLista = false;
    await lista.locator('button:has-text("Tentar de novo")').click();
    await lista.locator('table >> text=Burger da Praça').waitFor();
    ok((await page.locator('text=● conectado').count()) === 1, 'erro só na lista: o número continua na tela, e "Tentar de novo" lê a lista de novo');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { falha: true });
    await page.click('nav button:has-text("Mister")');
    await page.waitForSelector('[role="alert"] >> text=Erro interno');
    ok((await page.locator('button:has-text("Tentar de novo")').count()) === 1, 'painel que não carrega: avisa, com "Tentar de novo"');
    await ctx.close();
  }

  // ── cada largura: a página e o diálogo inteiros na tela; tabela no largo, cartões no estreito ──
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { numero: conectado(), liberado: true, total: 250 });
    await naAba(page);
    await page.locator('text=Empório Sabor da Serra >> visible=true').first().waitFor({ timeout: 20000 });
    let m = await medir(page);
    ok(m.length === 0, `${w}px: conectado — sem barra lateral, nada passa da tela e o toque é grande (${m.join(' | ')})`);
    const tabela = await page.locator('section[aria-labelledby="mister-empresas"] table').isVisible();
    const cartoes = await page.locator('section[aria-labelledby="mister-empresas"] ul').isVisible();
    ok(w >= 1024 ? tabela && !cartoes : cartoes && !tabela, `${w}px: ${w >= 1024 ? 'tabela' : 'cartões'} (tabela ${tabela}, cartões ${cartoes})`);
    if (w === 375 || w === 1440) await page.screenshot({ path: foto(`${w}-conectado.png`), fullPage: true });
    await page.click('button:has-text("Reconectar com a Meta")');
    await page.locator('button[aria-pressed]:has-text("Só na API oficial")').click();
    await page.locator('input[inputmode="numeric"]').waitFor();
    m = await medir(page);
    ok(m.length === 0, `${w}px: reconectando, com o PIN — tudo na tela (${m.join(' | ')})`);
    await page.locator('section[aria-labelledby="mister-geral"] button:has-text("Desligar o Mister")').click();
    await page.waitForSelector('[role="alertdialog"]');
    m = await medir(page);
    ok(m.length === 0, `${w}px: o diálogo de desligar inteiro na tela (${m.join(' | ')})`);
    if (w === 375) await page.screenshot({ path: foto('375-dialogo.png') });
    ok(erros.length === 0, `${w}px: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
