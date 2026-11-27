// Roteiro de tela dos DIAS ESPECIAIS DO HORÁRIO (H1b da mig 512; protótipo `mockups/regem-dias-especiais.html`, aprovado
// pelo dono em 27/11/2026). A API é simulada (nada de banco nem de loja real). Confere:
//  • Delivery › Configurações › Horários: a lista abaixo da semana (o título com os próximos, as situações Próximos e
//    Passados indo ao servidor, cada linha com o que o servidor mandou, os selos, "2 agendados"); criar em gaveta (o
//    "Outro horário" começa pelo normal do dia, o aviso nasce desligado nele e ligado no dia fechado, a prévia do cardápio,
//    o corpo que sai); editar o Natal (os agendados do dia na gaveta, o diálogo "Há 2 pedidos agendados" com "Ver os
//    agendados" e "Salvar mesmo assim", o PATCH que leva a pausa e o feriado de volta); excluir em diálogo (o horário da
//    semana que volta, o DELETE no id); a recusa do servidor na gaveta; "não leu" com "Tentar de novo"; o vazio; o gerente
//    de supervisão sem os botões; e as 16 larguras com a gaveta e cada diálogo abertos (nenhuma barra para o lado);
//  • o cardápio do cliente (nos 4 modelos): "Fechado hoje · Natal" no topo e na faixa com "Voltamos sáb às 18:00.", o dia
//    de outro horário ("Hoje abrimos das 18:00 às 21:00 · Horário especial de Véspera de Natal.") e o aviso de 3 dias antes,
//    em cada largura, sem barra para o lado.
import { MENU as MENU_BASE } from './cardapio-para-voce.mjs';
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: { loja: { ver: true, editar: true }, delivery: { ver: true } } });
const SUPERVISAO = tokenFalso({ cat: 'supervisao', perfil: 'supervisao', perm: { loja: { ver: true }, delivery: { ver: true } } });

// A semana do protótipo: segunda fechada, terça a quinta 18–23, sexta e sábado 18–00, domingo 18–23.
const SEMANA = [
  { dia: 0, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 1, abre: '18:00', fecha: '23:00', ativo: false },
  { dia: 2, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 3, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 4, abre: '18:00', fecha: '23:00', ativo: true },
  { dia: 5, abre: '18:00', fecha: '00:00', ativo: true },
  { dia: 6, abre: '18:00', fecha: '00:00', ativo: true },
];
const dia = (p) => ({ dataFim: null, abre: null, fecha: null, conjunto: 'todos', avisoAntes: true, pausarCanais: true, feriadoChave: null, origem: 'tela', criadoEm: '2026-11-27T12:00:00Z', agendados: 0, ...p });
function servidor() {
  return {
    config: { id: 'c1', horarios: SEMANA, horarioUnico: true, ativo: true, modo: 'delivery' },
    proximos: [
      dia({ id: 'd-vespera', data: '2026-12-24', nome: 'Véspera de Natal', funcionamento: 'horario', abre: '18:00', fecha: '21:00', avisoAntes: false }),
      dia({ id: 'd-natal', data: '2026-12-25', nome: 'Natal', funcionamento: 'fechada', agendados: 2, pausarCanais: false, feriadoChave: 'natal-2026' }),
      dia({ id: 'd-reforma', data: '2027-01-12', dataFim: '2027-01-14', nome: 'Reforma da cozinha com um nome comprido', funcionamento: 'fechada', origem: 'mister' }),
    ],
    passados: [dia({ id: 'd-finados', data: '2026-11-02', nome: 'Finados', funcionamento: 'fechada' })],
    agendados: [
      { id: 'p1', numero: '812', cliente: 'Cliente de exemplo A', quando: '2026-12-25T19:30', total: 74.9, forma: 'pix', pago: true },
      { id: 'p2', numero: '815', cliente: 'Cliente de exemplo B com nome comprido', quando: '2026-12-25T20:15', total: 52, forma: 'dinheiro', pago: false },
    ],
    // H2a: os feriados sem resposta (a lista de 60 dias; a faixa pede `?dias=10` e recebe os que caem até 07/12).
    feriados: [
      { chave: 'calendario:c1:2026-12-02', data: '2026-12-02', nome: 'Aniversário da cidade', origem: 'calendario', normal: '18:00 às 23:00' },
      { chave: 'regra:feriado:ano-novo:2027', data: '2027-01-01', nome: 'Confraternização Universal', origem: 'lei', normal: '18:00 às 00:00' },
    ],
    calendarioLido: true,
    // H3: a pausa sozinha do iFood e da 99 (a variável da distribuição); desligada, a tela nem mostra a chave.
    pausaAutomatica: false,
    consultas: [],
    posts: [],
    patches: [],
    deletes: [],
    falharLista: false,
    recusar: null,
  };
}

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.hs')) continue; // as fileiras que deslizam de propósito no cardápio (abas, carrosséis)
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    for (const d of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
      const r = d.getBoundingClientRect();
      if (r.left < -1 || r.right > window.innerWidth + 1) achados.push(`painel fora da tela ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    // Texto esmagado (V45): um bloco de texto com menos de 40 px de largura e mais de uma palavra.
    for (const el of document.querySelectorAll('section[aria-labelledby="dias-especiais-titulo"] li p, [role="dialog"] p, [role="alertdialog"] p, .p-aviso b')) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.width < 40 && /\s/.test(el.textContent.trim())) achados.push(`texto esmagado ${Math.round(r.width)}px: ${el.textContent.trim().slice(0, 30)}`);
    }
    return achados;
  });

export default async function roteiroDiasEspeciais({ nav, base, ok, foto, larguras }) {
  async function abrir(w, h, S = servidor(), jwt = PRESIDENTE) {
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: false });
    await ctx.addInitScript((t) => localStorage.setItem('regen_token', t), jwt);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const u = new URL(req.url());
      const p = u.pathname.replace(/^.*\/api\/v1/, '');
      const corpo = req.postData() ? JSON.parse(req.postData()) : null;
      if (p === '/cardapio/config') return responder(route, S.config);
      if (p === '/cardapio/dias-especiais/sem-resposta') {
        S.consultas.push(p + u.search);
        const ate = u.searchParams.get('dias') === '10' ? '2026-12-07' : '2027-01-31';
        return responder(route, { hoje: '2026-11-27', ate, fontes: { calendario: S.calendarioLido }, itens: S.feriados.filter((f) => f.data <= ate) });
      }
      if (p === '/cardapio/dias-especiais/agendados') {
        S.consultas.push(p + u.search);
        return responder(route, { itens: u.searchParams.get('de') === '2026-12-25' ? S.agendados : [] });
      }
      if (p === '/cardapio/dias-especiais' && req.method() === 'GET') {
        S.consultas.push(p + u.search);
        if (S.falharLista) return responder(route, { statusCode: 500, message: 'Não deu para ler os dias especiais agora.' }, 500);
        const passados = u.searchParams.get('situacao') === 'passados';
        return responder(route, { hoje: '2026-11-27', contagem: { proximos: S.proximos.length, passados: S.passados.length }, pausaAutomatica: S.pausaAutomatica, itens: passados ? S.passados : S.proximos });
      }
      if (p === '/cardapio/dias-especiais' && req.method() === 'POST') {
        S.posts.push(corpo);
        if (S.recusar) return responder(route, { statusCode: 409, message: S.recusar }, 409);
        const novo = dia({ ...corpo, id: `d-novo-${S.posts.length}` });
        S.proximos = [...S.proximos, novo].sort((a, b) => a.data.localeCompare(b.data));
        // A resposta tira o feriado da lista (o servidor: qualquer dia especial na data, ou a chave gravada).
        S.feriados = S.feriados.filter((f) => f.chave !== corpo?.feriadoChave && f.data !== corpo?.data);
        return responder(route, novo);
      }
      const m = p.match(/^\/cardapio\/dias-especiais\/([^/]+)$/);
      if (m && req.method() === 'PATCH') {
        S.patches.push({ id: m[1], corpo });
        S.proximos = S.proximos.map((x) => (x.id === m[1] ? { ...x, ...corpo } : x));
        return responder(route, { id: m[1], ...corpo });
      }
      if (m && req.method() === 'DELETE') {
        S.deletes.push(m[1]);
        S.proximos = S.proximos.filter((x) => x.id !== m[1]);
        return responder(route, { ok: true });
      }
      if (/banners|cupons|regras-sinal|formas|impressoras|integrac|numeros|robo|eventos|fidelidade|cashback|bairros|areas/.test(p)) return responder(route, []);
      return responder(route, {});
    });
    await page.goto(base + '/delivery/configuracoes?aba=horarios');
    await page.waitForSelector('#dias-especiais-titulo', { timeout: 20000 });
    return { ctx, page, erros, S };
  }
  // As linhas da lista dos dias (o bloco dos feriados sem resposta tem a sua).
  const linhas = (page) => page.locator('section[aria-labelledby="dias-especiais-titulo"] ul:not([aria-label="Feriados sem resposta"]) > li');
  const feriadosNaTela = (page) => page.locator('ul[aria-label="Feriados sem resposta"] > li');
  const gaveta = (page) => page.locator('[role="dialog"]').last();

  // ── a lista ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 1000);
    await page.waitForSelector('text=Sexta, 25/12 · Natal', { timeout: 10000 });
    const titulo = umaLinha(await page.locator('#dias-especiais-titulo').innerText());
    ok(/Dias especiais\s*3/.test(titulo), `o título com os próximos (${titulo})`);
    const textos = (await linhas(page).allInnerTexts()).map((t) => umaLinha(t, 400));
    ok(textos.length === 3, `três linhas (${textos.length})`);
    ok(/Quinta, 24\/12 · Véspera de Natal/.test(textos[0]) && /Das 18:00 às 21:00 · o normal é das 18:00 às 23:00/.test(textos[0]) && /outro horário/.test(textos[0]), `a véspera: o horário, o normal de quinta e o selo (${textos[0]})`);
    ok(!/aviso no cardápio/.test(textos[0]), 'a véspera sem o aviso (desligado nela)');
    ok(/Sexta, 25\/12 · Natal/.test(textos[1]) && /Fechada o dia todo/.test(textos[1]) && /aviso no cardápio desde terça, 22\/12/.test(textos[1]) && /fechada/.test(textos[1]) && /2 agendados/.test(textos[1]), `o Natal: fechada, o aviso desde terça, "2 agendados" (${textos[1]})`);
    ok(/Terça, 12\/01 a quinta, 14\/01/.test(textos[2]) && /Fechada os 3 dias/.test(textos[2]) && /cadastrado pelo Mister em 27\/11/.test(textos[2]) && /período/.test(textos[2]), `o período: os 3 dias, quem cadastrou e o selo (${textos[2]})`);
    ok(await page.locator('section[aria-labelledby="dias-especiais-titulo"] button[aria-pressed="true"]:has-text("Próximos")').count() === 1, 'a situação Próximos ligada');
    await page.screenshot({ path: foto('1280-lista.png') });
    await page.click('section[aria-labelledby="dias-especiais-titulo"] button:has-text("Passados")');
    await page.waitForSelector('text=Finados', { timeout: 5000 });
    ok(S.consultas.some((c) => c === '/cardapio/dias-especiais?situacao=passados'), 'Passados vai ao servidor (?situacao=passados)');
    ok(await page.locator('section[aria-labelledby="dias-especiais-titulo"] li button:has-text("Editar")').count() === 0, 'o passado não tem Editar nem Excluir');
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── criar: outro horário ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 1000);
    await page.click('button:has-text("＋ Adicionar dia especial")');
    const g = gaveta(page);
    await g.waitFor();
    ok(/Novo dia especial/.test(await g.innerText()), 'a gaveta "Novo dia especial"');
    ok(await g.locator('button:has-text("Salvar dia")').isDisabled(), 'Salvar travado sem o dia e o nome');
    await g.locator('input[type="date"]').first().fill('2026-12-31');
    await g.locator('label:has-text("Nome que o cliente vê") + input, input[placeholder="Ex.: Natal"]').first().fill('Véspera de Ano-novo');
    // Fechada (o padrão): o aviso nasce ligado.
    ok((await g.locator('[role="switch"]').getAttribute('aria-checked')) === 'true', 'fechada: o aviso nasce ligado (decisão 6)');
    const previaFechada = umaLinha(await g.innerText(), 2000);
    ok(/Fechado hoje · Véspera de Ano-novo\. Voltamos sex às 18:00\./.test(previaFechada), `a prévia do dia fechado com a volta (${previaFechada.match(/Fechado hoje[^\n/]*/)?.[0]})`);
    await g.locator('label:has-text("Outro horário")').click();
    const abre = await g.locator('input[type="time"]').nth(0).inputValue();
    const fecha = await g.locator('input[type="time"]').nth(1).inputValue();
    ok(abre === '18:00' && fecha === '23:00', `outro horário começa pelo normal de quinta (${abre}–${fecha})`);
    ok((await g.locator('[role="switch"]').getAttribute('aria-checked')) === 'false', 'outro horário: o aviso desligado (decisão 6)');
    ok(/O normal de quinta é das 18:00 às 23:00\./.test(await g.innerText()), 'o normal do dia escrito na opção');
    await g.locator('input[type="time"]').nth(1).fill('21:00');
    ok(/Hoje abrimos das 18:00 às 21:00 · Horário especial de Véspera de Ano-novo\./.test(await g.innerText()), 'a prévia do outro horário');
    await page.screenshot({ path: foto('1280-gaveta.png') });
    await g.locator('button:has-text("Salvar dia")').click();
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
    const post = S.posts[0] ?? {};
    ok(post.data === '2026-12-31' && post.dataFim === null && post.nome === 'Véspera de Ano-novo' && post.funcionamento === 'horario' && post.abre === '18:00' && post.fecha === '21:00' && post.conjunto === 'todos' && post.avisoAntes === false, `o corpo do POST (${JSON.stringify(post)})`);
    ok(!('pausarCanais' in post), 'criar não manda a pausa (o servidor usa o padrão da decisão 5)');
    await page.waitForSelector('text=Quinta, 31/12 · Véspera de Ano-novo', { timeout: 5000 });
    ok(true, 'a lista relida mostra o dia novo');
    // A recusa do servidor fica na gaveta, com a mensagem dele.
    S.recusar = 'Já existe um dia especial que cruza com 31/12 nesse horário.';
    await page.click('button:has-text("＋ Adicionar dia especial")');
    await gaveta(page).locator('input[type="date"]').first().fill('2026-12-31');
    await gaveta(page).locator('input[placeholder="Ex.: Natal"]').fill('Outro');
    await gaveta(page).locator('button:has-text("Salvar dia")').click();
    await page.waitForSelector('[role="dialog"] [role="alert"]', { timeout: 5000 });
    ok(/Já existe um dia especial que cruza com 31\/12/.test(await gaveta(page).locator('[role="alert"]').innerText()), 'a recusa do servidor aparece na gaveta, e ela continua aberta');
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── editar o Natal: os agendados e o "Salvar mesmo assim" ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 1000);
    await page.click('button[aria-label="Editar Sexta, 25/12 · Natal"]');
    const g = gaveta(page);
    await g.waitFor();
    await page.waitForSelector('text=2 pedidos agendados para sexta, 25/12', { timeout: 5000 });
    ok(S.consultas.some((c) => c === '/cardapio/dias-especiais/agendados?de=2026-12-25'), 'os agendados do dia lidos ao abrir');
    ok(/#812, #815/.test(await g.innerText()), 'os números dos agendados na gaveta');
    await g.locator('button:has-text("Salvar dia")').click();
    const d = page.locator('[role="alertdialog"]');
    await d.waitFor();
    const td = umaLinha(await d.innerText(), 600);
    ok(/Há 2 pedidos agendados para sexta, 25\/12/.test(td) && /não cancela/.test(td) && /#812/.test(td) && /19:30/.test(td) && /pago/.test(td), `o diálogo dos agendados (${td.slice(0, 160)})`);
    ok((await d.locator('a:has-text("Ver os agendados")').getAttribute('href')) === '/delivery?situacao=agendados', '"Ver os agendados" leva ao painel com a situação ligada');
    ok(S.patches.length === 0, 'nada gravado antes do "Salvar mesmo assim"');
    await page.screenshot({ path: foto('1280-agendados.png') });
    await d.locator('button:has-text("Salvar mesmo assim")').click();
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
    const patch = S.patches[0];
    ok(patch?.id === 'd-natal' && patch.corpo.funcionamento === 'fechada' && patch.corpo.avisoAntes === true, `o PATCH no id do Natal (${JSON.stringify(patch)})`);
    ok(patch?.corpo.pausarCanais === false && patch?.corpo.feriadoChave === 'natal-2026', 'o PATCH leva de volta a pausa e o feriado que a gaveta não mostra (V16)');
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── excluir ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 1000);
    await page.click('button[aria-label="Excluir Quinta, 24/12 · Véspera de Natal"]');
    const d = page.locator('[role="alertdialog"]');
    await d.waitFor();
    const td = umaLinha(await d.innerText(), 400);
    ok(/Excluir o dia especial de quinta, 24\/12\?/.test(td) && /A loja volta ao horário de quinta: das 18:00 às 23:00\./.test(td), `o diálogo diz o horário que volta (${td})`);
    await d.locator('button:has-text("Excluir")').last().click();
    await page.waitForSelector('[role="alertdialog"]', { state: 'detached', timeout: 5000 });
    ok(S.deletes.join() === 'd-vespera', `o DELETE no id (${S.deletes.join()})`);
    ok((await linhas(page).count()) === 2, 'a lista relida sem a véspera');
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── não leu, vazio e supervisão ──
  {
    const S = servidor();
    S.falharLista = true;
    const { ctx, page, erros } = await abrir(1024, 900, S);
    await page.waitForSelector('section[aria-labelledby="dias-especiais-titulo"] [role="alert"]', { timeout: 5000 });
    ok(/Não deu para ler os dias especiais agora\./.test(await page.locator('section[aria-labelledby="dias-especiais-titulo"] [role="alert"]').innerText()), '"não leu": a mensagem, nunca a lista vazia');
    S.falharLista = false;
    S.proximos = [];
    S.passados = [];
    await page.click('button:has-text("Tentar de novo")');
    await page.waitForSelector('text=Nenhum dia especial', { timeout: 5000 });
    ok(/A loja segue o horário da semana todos os dias\./.test(await page.locator('section[aria-labelledby="dias-especiais-titulo"]').innerText()), '"Tentar de novo" lê de novo; o vazio diz o que vale');
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, erros } = await abrir(1024, 900, servidor(), SUPERVISAO);
    await page.waitForSelector('text=Sexta, 25/12 · Natal', { timeout: 10000 });
    ok((await page.locator('button:has-text("＋ Adicionar dia especial")').count()) === 0 && (await page.locator('section[aria-labelledby="dias-especiais-titulo"] li button').count()) === 0, 'supervisão vê a lista sem criar, editar nem excluir');
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── H2a: os feriados sem resposta (a lista, as respostas, o "Outro horário…", a faixa do topo) ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 1000);
    await page.waitForSelector('text=Próximos feriados sem resposta', { timeout: 10000 });
    ok(S.consultas.includes('/cardapio/dias-especiais/sem-resposta'), 'a lista lê os feriados sem resposta (60 dias)');
    ok(S.consultas.includes('/cardapio/dias-especiais/sem-resposta?dias=10'), 'a faixa do topo lê os próximos 10 dias');
    const sit = umaLinha(await page.locator('section[aria-labelledby="dias-especiais-titulo"] [role="group"][aria-label="Situação"]').innerText());
    ok(/Próximos[\s/]*3.*Sem resposta[\s/]*2.*Passados[\s/]*1/.test(sit), `as três situações com a contagem (${sit})`);
    const fs = (await feriadosNaTela(page).allInnerTexts()).map((t) => umaLinha(t, 300));
    ok(fs.length === 2 && /Quarta, 02\/12 · Aniversário da cidade/.test(fs[0]) && /Feriado da cidade, cadastrado em Delivery › Clientes › Calendário de eventos · o normal de quarta é 18:00 às 23:00/.test(fs[0]), `o feriado da cidade com a origem e o normal (${fs[0]})`);
    ok(/Sexta, 01\/01 · Confraternização Universal/.test(fs[1]) && /Feriado por lei/.test(fs[1]), `o feriado por lei (${fs[1]})`);
    // a faixa do topo: o feriado dos próximos 10 dias, com o horário que vale até responder
    const faixa = page.locator('[role="status"]:has-text("Como a loja fica nesse dia?")');
    ok(await faixa.isVisible(), 'a faixa do topo aparece para o presidente');
    ok(/Quarta, 02\/12, é Aniversário da cidade\. Como a loja fica nesse dia\? Até alguém responder, vale o horário de quarta \(18:00 às 23:00\)\./.test(umaLinha(await faixa.innerText())), `o texto da faixa (${umaLinha(await faixa.innerText())})`);
    ok((await faixa.locator('a:has-text("Outro horário…")').getAttribute('href')) === '/delivery/configuracoes?aba=horarios&feriado=calendario%3Ac1%3A2026-12-02', '"Outro horário…" da faixa leva à gaveta daquele feriado');
    await page.screenshot({ path: foto('h2a-1280-sem-resposta.png') });
    // "Horário normal" na lista grava na hora com a chave (decisão 9) e o feriado sai
    await page.click('button[aria-label="Horário normal em Sexta, 01/01 · Confraternização Universal"]');
    await page.waitForFunction(() => document.querySelectorAll('ul[aria-label="Feriados sem resposta"] > li').length === 1, null, { timeout: 5000 });
    const post1 = S.posts.at(-1);
    ok(post1?.data === '2027-01-01' && post1.nome === 'Confraternização Universal' && post1.funcionamento === 'normal' && post1.feriadoChave === 'regra:feriado:ano-novo:2027', `"Horário normal" grava a resposta com a chave (${JSON.stringify(post1)})`);
    // "Fechada" na FAIXA grava na hora e a faixa some
    await faixa.locator('button:has-text("Fechada")').click();
    await page.waitForSelector('[role="status"]:has-text("Como a loja fica nesse dia?")', { state: 'detached', timeout: 5000 });
    const post2 = S.posts.at(-1);
    ok(post2?.data === '2026-12-02' && post2.funcionamento === 'fechada' && post2.feriadoChave === 'calendario:c1:2026-12-02', `"Fechada" da faixa grava a resposta (${JSON.stringify(post2)})`);
    const sumiu = await page
      .waitForFunction(() => document.querySelectorAll('ul[aria-label="Feriados sem resposta"] > li').length === 0, null, { timeout: 5000 })
      .then(() => true, () => false);
    ok(sumiu, 'respondido pela faixa, a lista de Horários relê sozinha e os sem resposta somem');
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    // "Outro horário…" pelo endereço da faixa: a gaveta abre com o dia, o nome e o horário normal daquele dia; salvar leva a chave
    const S = servidor();
    S.calendarioLido = false;
    const { ctx, page, erros } = await abrir(1280, 1000, S);
    await page.goto(base + '/delivery/configuracoes?aba=horarios&feriado=calendario%3Ac1%3A2026-12-02');
    const g = gaveta(page);
    await g.waitFor({ timeout: 10000 });
    ok((await g.locator('input[type="date"]').first().inputValue()) === '2026-12-02' && (await g.locator('input[placeholder="Ex.: Natal"]').inputValue()) === 'Aniversário da cidade', 'a gaveta abre com o dia e o nome do feriado');
    const abre = await g.locator('input[type="time"]').nth(0).inputValue();
    const fecha = await g.locator('input[type="time"]').nth(1).inputValue();
    ok(abre === '18:00' && fecha === '23:00' && (await g.locator('input[type="radio"]').nth(1).isChecked()), `"Outro horário" marcado, começando pelo normal de quarta (${abre}–${fecha})`);
    await g.locator('input[type="time"]').nth(1).fill('21:00');
    await g.locator('button:has-text("Salvar dia")').click();
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
    const post = S.posts.at(-1);
    ok(post?.funcionamento === 'horario' && post.abre === '18:00' && post.fecha === '21:00' && post.feriadoChave === 'calendario:c1:2026-12-02', `salvar leva a chave do feriado (${JSON.stringify(post)})`);
    await page.click('section[aria-labelledby="dias-especiais-titulo"] button:has-text("Sem resposta")');
    ok(/não foi lido aqui/.test(await page.locator('section[aria-labelledby="dias-especiais-titulo"]').innerText()), 'sem o calendário (servidor da loja): a tela diz que não leu o feriado da cidade (V37)');
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    // a supervisão não vê a faixa (não pode mudar o horário) nem os botões dos feriados
    const { ctx, page, erros, S } = await abrir(1024, 900, servidor(), SUPERVISAO);
    await page.waitForSelector('text=Próximos feriados sem resposta', { timeout: 10000 });
    ok((await page.locator('[role="status"]:has-text("Como a loja fica nesse dia?")').count()) === 0 && !S.consultas.includes('/cardapio/dias-especiais/sem-resposta?dias=10'), 'supervisão: sem a faixa e sem a leitura dela');
    ok((await feriadosNaTela(page).locator('button').count()) === 0, 'supervisão: os feriados sem os botões de resposta');
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── H3: a pausa sozinha do iFood e da 99 (o selo, a chave da gaveta e o corpo) ──
  {
    const S = servidor();
    S.pausaAutomatica = true;
    S.proximos = S.proximos.map((x) =>
      x.id === 'd-natal'
        ? { ...x, pausarCanais: true, pausas: [{ canal: 'ifood', desde: '18:00', ate: '00:00' }, { canal: 'food99', desde: '18:00', ate: null }] }
        : x.id === 'd-vespera'
          ? { ...x, pausas: [{ canal: 'ifood', desde: '21:00', ate: '23:00' }] }
          : x,
    );
    const { ctx, page, erros } = await abrir(1280, 1000, S);
    await page.waitForSelector('text=Sexta, 25/12 · Natal', { timeout: 10000 });
    const textos = (await linhas(page).allInnerTexts()).map((t) => umaLinha(t, 400));
    ok(/iFood pausado das 21:00 às 23:00/.test(textos[0]) && /iFood e 99 pausados no dia/.test(textos[1]), `o selo da pausa em cada dia (${textos[0].slice(-60)} | ${textos[1].slice(-60)})`);
    // O dia novo: a chave nasce ligada (decisão 5); desligada, o corpo leva false.
    await page.click('button:has-text("＋ Adicionar dia especial")');
    const g = gaveta(page);
    await g.waitFor();
    const chave = g.locator('[role="switch"][aria-label="Pausar o iFood e a 99"]');
    ok((await chave.count()) === 1 && (await chave.getAttribute('aria-checked')) === 'true', 'a chave "Pausar o iFood e a 99" nasce ligada');
    await g.locator('input[type="date"]').first().fill('2026-12-31');
    await g.locator('input[placeholder="Ex.: Natal"]').fill('Fechado para balanço');
    await chave.click();
    await g.locator('button:has-text("Salvar dia")').click();
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
    ok(S.posts.at(-1)?.pausarCanais === false, `desligada, o corpo leva pausarCanais false (${JSON.stringify(S.posts.at(-1))})`);
    // "Horário normal" esconde a chave (não há o que pausar).
    await page.click('button:has-text("＋ Adicionar dia especial")');
    await gaveta(page).locator('label:has-text("Horário normal")').click();
    ok((await gaveta(page).locator('[role="switch"][aria-label="Pausar o iFood e a 99"]').count()) === 0, 'no "horário normal" a chave some');
    await page.keyboard.press('Escape');
    // Excluir o Natal diz que a pausa marcada não acontece mais.
    await page.click('button[aria-label="Excluir Sexta, 25/12 · Natal"]');
    ok(/A pausa do iFood e da 99 marcada para esse dia não acontece mais/.test(await page.locator('[role="alertdialog"]').innerText()), 'excluir diz o que acontece com a pausa');
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    // Sem a pausa automática (a variável desligada): nem a chave nem o selo.
    const { ctx, page, erros } = await abrir(1280, 1000);
    await page.waitForSelector('text=Sexta, 25/12 · Natal', { timeout: 10000 });
    ok(!/pausad/.test(umaLinha(await linhas(page).nth(1).innerText(), 400)), 'desligada: sem o selo da pausa');
    await page.click('button:has-text("＋ Adicionar dia especial")');
    ok((await gaveta(page).locator('[role="switch"][aria-label="Pausar o iFood e a 99"]').count()) === 0, 'desligada: sem a chave na gaveta');
    ok(erros.length === 0, `sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── as larguras: a lista, a gaveta, o diálogo dos agendados e o de excluir ──
  for (const w of larguras) {
    // Com a pausa automática ligada: o selo comprido e a chave da gaveta entram na medida.
    const SL = servidor();
    SL.pausaAutomatica = true;
    SL.proximos = SL.proximos.map((x) => (x.id === 'd-natal' ? { ...x, pausas: [{ canal: 'ifood', desde: '18:00', ate: '00:00' }, { canal: 'food99', desde: '18:00', ate: null }] } : x));
    const { ctx, page, erros } = await abrir(w, 900, SL);
    await page.waitForSelector('text=Sexta, 25/12 · Natal', { timeout: 10000 });
    await page.waitForSelector('[role="status"]:has-text("Como a loja fica nesse dia?")', { timeout: 10000 });
    let achados = await medir(page);
    ok(!achados.length, `${w}px: a lista, os feriados sem resposta e a faixa do topo sem barra para o lado (${achados.join(' | ')})`);
    if (w === 375) await page.screenshot({ path: foto('h2a-375-faixa.png') });
    await page.click('section[aria-labelledby="dias-especiais-titulo"] button:has-text("Sem resposta")');
    achados = await medir(page);
    ok(!achados.length && (await feriadosNaTela(page).count()) === 2, `${w}px: a situação "Sem resposta" (${achados.join(' | ')})`);
    await page.click('section[aria-labelledby="dias-especiais-titulo"] button:has-text("Próximos")');
    await page.click('button[aria-label="Editar Sexta, 25/12 · Natal"]');
    await page.waitForSelector('text=2 pedidos agendados para sexta, 25/12', { timeout: 5000 });
    achados = await medir(page);
    ok(!achados.length && (await gaveta(page).isVisible()), `${w}px: com a gaveta aberta (${achados.join(' | ')})`);
    if (w === 375) await page.screenshot({ path: foto('375-gaveta.png') });
    await gaveta(page).locator('button:has-text("Salvar dia")').click();
    await page.waitForSelector('[role="alertdialog"]');
    achados = await medir(page);
    ok(!achados.length && (await page.locator('[role="alertdialog"]').isVisible()), `${w}px: com o diálogo dos agendados aberto (${achados.join(' | ')})`);
    if (w === 375) await page.screenshot({ path: foto('375-agendados.png') });
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
    await page.click('button[aria-label="Excluir Terça, 12/01 a quinta, 14/01 · Reforma da cozinha com um nome comprido"]');
    await page.waitForSelector('[role="alertdialog"]');
    achados = await medir(page);
    ok(!achados.length, `${w}px: com o diálogo de excluir aberto (${achados.join(' | ')})`);
    ok(erros.length === 0, `${w}px: sem erro de script (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── o cardápio do cliente ──
  const TOKEN = 'loja-demo-h1b';
  // `tipos` e `abertoPorTipo` no formato do servidor (`delivery`, `retirada`, `local`): o cardápio decide a situação por eles.
  const MENU_TIPOS = { ...MENU_BASE, tipos: { delivery: true, retirada: true, local: false }, abertoPorTipo: { entrega: true, retirada: true, local: false } };
  const fechadoHoje = {
    ...MENU_TIPOS,
    abertaAgora: false,
    abertoPorTipo: { entrega: false, retirada: false, local: false },
    horarioLabel: 'Abre sáb 18:00',
    proximaAbertura: { entrega: 'sáb 18:00', retirada: 'sáb 18:00' },
    diasEspeciais: { hoje: { nome: 'Natal', funcionamento: 'fechada', abre: null, fecha: null }, aviso: null, proximos: [] },
  };
  const outroHorario = {
    ...MENU_TIPOS,
    horarioLabel: 'Aberta até 21:00',
    diasEspeciais: { hoje: { nome: 'Véspera de Natal', funcionamento: 'horario', abre: '18:00', fecha: '21:00' }, aviso: null, proximos: [] },
  };
  const avisoAntes = {
    ...MENU_TIPOS,
    diasEspeciais: { hoje: null, aviso: { data: '2026-12-25', nome: 'Natal', texto: 'Sexta, 25/12, estaremos fechados (Natal).' }, proximos: [] },
  };
  async function abrirCardapio(w, tema, menu) {
    const ctx = await nav.newContext({ viewport: { width: w, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === `/publico/cardapio/${TOKEN}`) return responder(route, menu);
      if (route.request().method() === 'POST') return responder(route, { ok: true });
      return responder(route, {});
    });
    await page.goto(`${base}/c/${TOKEN}?tema=${tema}`);
    await page.waitForSelector('.p-aviso', { timeout: 30000 });
    return { ctx, page, erros };
  }
  const casos = [
    { nome: 'fechado hoje', menu: fechadoHoje, titulo: 'Fechado hoje · Natal', texto: 'Voltamos sáb às 18:00.' },
    { nome: 'outro horário', menu: outroHorario, titulo: 'Hoje abrimos das 18:00 às 21:00', texto: 'Horário especial de Véspera de Natal.' },
    { nome: 'aviso 3 dias antes', menu: avisoAntes, titulo: 'Sexta, 25/12, estaremos fechados (Natal).', texto: '' },
  ];
  for (const tema of ['fluxo', 'galeria', 'balcao', 'oferta'])
    for (const c of casos)
      for (const w of tema === 'fluxo' ? larguras : [375, 1280]) {
        const { ctx, page, erros } = await abrirCardapio(w, tema, c.menu);
        const avisos = (await page.locator('.p-aviso').allInnerTexts()).map((t) => umaLinha(t, 300));
        const certo = avisos.find((t) => t.includes(c.titulo));
        ok(!!certo && (!c.texto || certo.includes(c.texto)), `${tema} ${w}px · ${c.nome}: a faixa (${avisos.join(' | ')})`);
        if (c.nome === 'fechado hoje') {
          const topo = await page.locator('text=Fechado hoje · Natal').count();
          ok(topo >= 2, `${tema} ${w}px · fechado hoje: também no status do topo (${topo} lugares)`);
        }
        const achados = await medir(page);
        ok(!achados.length, `${tema} ${w}px · ${c.nome}: sem barra para o lado (${achados.join(' | ')})`);
        if (w === 375) await page.screenshot({ path: foto(`cardapio-${tema}-${c.nome.replace(/\s+/g, '-')}-375.png`) });
        ok(erros.length === 0, `${tema} ${w}px · ${c.nome}: sem erro de script (${erros.join(' | ')})`);
        await ctx.close();
      }
}
