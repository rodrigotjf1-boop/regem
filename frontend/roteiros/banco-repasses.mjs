// Roteiro de tela de FINANCEIRO › BANCO E REPASSES (R1 da versão 8 do Mister; protótipo `mockups/regem-mister-v8.html`, aba
// "Na loja"; mig 499). A API simulada, com dados inventados. Confere:
//  • em cada largura: nenhuma barra para o lado nem texto esmagado na lista, com a gaveta do lançamento aberta e com a
//    importação aberta em cada passo e em cada um dos casos do passo 2;
//  • a faixa das fontes (o Banco real; as outras "ainda não ligado", sem botão), as 5 situações, Casado e Esperado em 0;
//  • os filtros indo ao servidor, a fonte só com o que tem dado, o seletor nativo de data, "Mostrar mais";
//  • classificar e "Lembrar para os próximos" (o corpo que sai), importar em 3 passos (o passo 2 não grava);
//  • vazio, erro com "Tentar de novo", e o gerente, que nem chama a rota.
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', nome: 'Ana' });
const GERENTE = tokenFalso({ cat: 'gerente', perfil: 'gerente', nome: 'Carlos' });

const TIPOS = [
  ['venda_ifood', 'Venda do iFood'], ['venda_ifood_pago', 'Venda do iFood Pago'], ['venda_99', 'Venda da 99'], ['venda_maquininha', 'Venda da maquininha'],
  ['pix_cliente', 'Pix de cliente'], ['deposito_caixa', 'Depósito do caixa'], ['fornecedor', 'Fornecedor'], ['folha', 'Folha'], ['imposto', 'Imposto'],
  ['retirada_dono', 'Retirada do dono'], ['transferencia_contas', 'Transferência entre contas'], ['outra_despesa', 'Outra despesa da loja'],
  ['outra_entrada', 'Outra entrada da loja'], ['nao_e_da_loja', 'Não é da loja'],
].map(([chave, rotulo]) => ({ chave, rotulo }));

const BASE = [
  ['2026-11-22', 842310, 'TED RECEBIDA IFOOD', 'ifood', 'a_conferir', null],
  ['2026-11-21', 124145, 'CRED IFOOD PAGO', 'ifood_pago', 'a_conferir', 'venda_ifood_pago'],
  ['2026-11-20', 230640, 'TED RECEBIDA 99 TECNOLOGIA', '99', 'a_conferir', null],
  ['2026-11-20', 410295, 'CRED MAQUININHA LOTE 1120', 'maquininha', 'a_conferir', 'venda_maquininha'],
  ['2026-11-20', -374218, 'DAS SIMPLES NACIONAL', 'banco', 'so_no_banco', 'imposto'],
  ['2026-11-19', -321485, 'BOLETO · HORTIFRUTI *** LTDA · CNPJ **.***.903/0001-**', 'banco', 'so_no_banco', 'fornecedor'],
  ['2026-11-18', -64000, 'PIX ENVIADO · M*** C*** · CPF ***.781.***-**', 'banco', 'so_no_banco', null],
  ['2026-11-17', -32000, 'PIX ENVIADO · L*** A*** · CPF ***.320.***-**', 'banco', 'nao_e_da_loja', 'nao_e_da_loja'],
  ['2026-11-16', 212000, 'DEPOSITO EM DINHEIRO', 'banco', 'so_no_banco', 'deposito_caixa'],
  ['2026-11-13', 131875, 'PIX RECEBIDO CARDAPIO DIGITAL', 'banco', 'so_no_banco', 'pix_cliente'],
  ['2026-11-12', -2318470, 'CONTA DE LUZ E AGUA COM UMA DESCRICAO BEM COMPRIDA PARA VER A QUEBRA DE LINHA NO CARTAO E NA TABELA DO BANCO', 'banco', 'so_no_banco', 'outra_despesa'],
  ['2026-11-10', 1856020, 'TED RECEBIDA · R*** O*** · CPF ***.456.***-**', 'banco', 'so_no_banco', 'transferencia_contas'],
  ['2026-11-09', -8990, 'TARIFA PACOTE DE SERVICOS', 'banco', 'so_no_banco', 'outra_despesa'],
  ['2026-11-06', -1486000, 'PAGTO SALARIOS LOTE 11', 'banco', 'so_no_banco', 'folha'],
  ['2026-11-05', -650000, 'DEB AUTOMATICO ALUGUEL', 'banco', 'so_no_banco', null],
  ['2026-11-03', 4218, 'RENDIMENTO DA CONTA', 'banco', 'so_no_banco', 'outra_entrada'],
].map(([data, valor, descricao, fonte, situacao, tipo], i) => ({ id: `0000000${i.toString(16)}-0000-4000-8000-000000000000`, data, valor, descricao, fonte, situacao, tipo }));

const novaBase = () => BASE.map((l) => ({ ...l }));

const CONFERENCIAS = {
  ok: {
    caso: 'ok', conta: { banco: '341', final: '4821' }, periodo: { de: '2026-11-01', ate: '2026-11-23' }, total: 37, jaEstavam: 35, novos: 2, recusados: 1, informativas: 0,
    saldoFinal: 3925030, saldoAnterior: 3842000, fecha: true, entradasNovas: 124030, saidasNovas: 41000, buraco: null, jaEntrouEm: null,
    novosLista: [
      { data: '2026-11-23', descricao: 'CRED MAQUININHA LOTE 1123', valor: 124030 },
      { data: '2026-11-23', descricao: 'BOLETO · DISTRIBUIDORA *** LTDA · CNPJ **.***.678/0001-** COM UM NOME BEM COMPRIDO', valor: -41000 },
    ],
  },
  repetido: {
    caso: 'repetido', conta: { banco: '341', final: '4821' }, periodo: { de: '2026-11-01', ate: '2026-11-22' }, total: 35, jaEstavam: 35, novos: 0, recusados: 0, informativas: 0,
    saldoFinal: 3842000, saldoAnterior: 3842000, fecha: null, entradasNovas: 0, saidasNovas: 0, buraco: null, jaEntrouEm: '2026-11-22T15:00:00.000Z', novosLista: [],
  },
  outra: { caso: 'outra_conta', conta: { banco: '341', final: '7306' }, contaDaLoja: { banco: '341', final: '4821' } },
  naoabre: { caso: 'nao_abre', motivo: 'Ele veio em PDF, e o Regem lê o extrato em OFX.' },
  buraco: {
    caso: 'buraco', conta: { banco: '341', final: '4821' }, periodo: { de: '2026-11-01', ate: '2026-11-23' }, total: 23, jaEstavam: 21, novos: 2, recusados: 0, informativas: 0,
    saldoFinal: 3925030, saldoAnterior: null, fecha: null, entradasNovas: 124030, saidasNovas: 41000, buraco: { de: '2026-11-09', ate: '2026-11-15' }, jaEntrouEm: null, novosLista: [],
  },
};

// A API de mentira: os filtros e as contas no "servidor", como na rota de verdade.
function resposta(linhas, q) {
  let de = q.get('de');
  let ate = q.get('ate');
  if (q.get('periodo') === 'ultimo') {
    de = '2026-11-01';
    ate = '2026-11-30';
  }
  const busca = (q.get('busca') ?? '').toUpperCase();
  const base = linhas.filter(
    (l) => (!de || l.data >= de) && (!ate || l.data <= ate) && (!q.get('fonte') || l.fonte === q.get('fonte')) && (!busca || l.descricao.includes(busca) || (TIPOS.find((t) => t.chave === l.tipo)?.rotulo ?? '').toUpperCase().includes(busca)),
  );
  const sit = q.get('situacao');
  const filtrados = sit ? base.filter((l) => l.situacao === sit) : base;
  const conta = (s) => base.filter((l) => l.situacao === s).length;
  const entrou = filtrados.filter((l) => l.valor > 0).reduce((s, l) => s + l.valor, 0);
  const saiu = -filtrados.filter((l) => l.valor < 0).reduce((s, l) => s + l.valor, 0);
  const limite = Number(q.get('limite') ?? 12);
  const desl = Number(q.get('deslocamento') ?? 0);
  return {
    periodo: { de, ate },
    contas: linhas.length ? [{ banco: '341', final: '4821', unidadeId: 'u1', lidoAte: '2026-11-22', importadoEm: '2026-11-22T15:00:00.000Z' }] : [],
    fontes: { banco: { situacao: linhas.length ? 'em_dia' : 'nunca', lidoAte: linhas.length ? '2026-11-22' : null }, comDado: [...new Set(linhas.map((l) => l.fonte))] },
    total: linhas.length,
    base: base.length,
    filtrados: filtrados.length,
    contagem: { casado: conta('casado'), a_conferir: conta('a_conferir'), so_no_banco: conta('so_no_banco'), esperado: conta('esperado'), nao_e_da_loja: conta('nao_e_da_loja') },
    totais: { entrou, saiu, diferenca: entrou - saiu, esperado: 0 },
    lista: filtrados.slice(desl, desl + limite),
    tipos: TIPOS,
  };
}

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    const larg = window.innerWidth;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    const painel = document.querySelector('[role="dialog"]');
    const raiz = painel ?? document.querySelector('main') ?? document.body;
    for (const el of raiz.querySelectorAll('*')) {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.height > 1 && !el.closest('.sr-only') && (r.right > larg + 1 || r.left < -1)) achados.push(`fora da janela ${el.tagName.toLowerCase()} ${Math.round(r.left)}–${Math.round(r.right)}`);
    }
    // Texto esmagado: bloco de texto com menos de 60 px de largura e mais de 3 linhas.
    for (const el of raiz.querySelectorAll('p, td, li, h2, h3, dd, dt, b, button')) {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      if (r.width > 0 && r.width < 60 && r.height > lh * 3.2 && (el.textContent || '').trim().length > 12) achados.push(`esmagado ${el.tagName.toLowerCase()} ${Math.round(r.width)}px: ${(el.textContent || '').trim().slice(0, 24)}`);
    }
    // Toque: os botões da peça com altura de dedo.
    for (const b of raiz.querySelectorAll('button')) {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0 && r.height < 32) achados.push(`botão baixo ${Math.round(r.height)}px: ${(b.textContent || '').trim().slice(0, 20)}`);
    }
    return [...new Set(achados)].slice(0, 6);
  });

const textoDe = (page, sel = 'main') => page.evaluate((s) => document.querySelector(s)?.innerText.replace(/\s+/g, ' ') ?? '', sel);
const arquivoDe = (nome = 'extrato.ofx') => ({ name: nome, mimeType: 'application/x-ofx', buffer: Buffer.from('OFXHEADER:100\n<OFX></OFX>') });

export default async function roteiroBancoRepasses({ nav, base, ok, foto: arquivoFoto, larguras }) {
  async function abrir(w, h, o = {}) {
    const estado = { linhas: o.vazio ? [] : novaBase(), consultas: [], patches: [], importou: 0, conferiu: 0, cenario: o.cenario ?? 'ok', falhar: !!o.falhar, chamadas: 0 };
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), o.token ?? PRESIDENTE);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname.replace(/^.*\/api\/v1/, '');
      const m = route.request().method();
      if (p === '/banco-repasses' && m === 'GET') {
        estado.chamadas++;
        estado.consultas.push(u.search);
        if (estado.falhar) return responder(route, { message: 'erro' }, 500);
        return responder(route, resposta(estado.linhas, u.searchParams));
      }
      if (p === '/banco-repasses/importar/conferir' && m === 'POST') {
        estado.conferiu++;
        return responder(route, CONFERENCIAS[estado.cenario]);
      }
      if (p === '/banco-repasses/importar' && m === 'POST') {
        estado.importou++;
        estado.linhas.unshift({ id: 'ffffffff-0000-4000-8000-000000000000', data: '2026-11-22', valor: 124030, descricao: 'CRED MAQUININHA LOTE 1123', fonte: 'maquininha', situacao: 'a_conferir', tipo: null });
        return responder(route, { novos: 2, repetidos: 35, recusados: 0, buraco: null });
      }
      if (p.startsWith('/banco-repasses/lancamentos/') && m === 'PATCH') {
        const id = p.split('/').pop();
        const corpo = JSON.parse(route.request().postData() || '{}');
        estado.patches.push({ id, corpo });
        const l = estado.linhas.find((x) => x.id === id);
        if (l) {
          l.tipo = corpo.tipo ?? null;
          l.situacao = corpo.tipo === 'nao_e_da_loja' ? 'nao_e_da_loja' : l.fonte === 'banco' ? 'so_no_banco' : 'a_conferir';
        }
        return responder(route, { ...l, lembrado: !!corpo.lembrar });
      }
      return responder(route, {});
    });
    await page.goto(base + '/financeiro/banco');
    return { ctx, page, erros, estado };
  }

  // A importação até um passo do caso escolhido, com a gaveta aberta.
  async function irAoPasso2(page) {
    await page.getByRole('button', { name: 'Importar extrato' }).first().click();
    await page.setInputFiles('[role="dialog"] input[type="file"]', arquivoDe());
    await page.locator('[role="dialog"]').getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.waitForSelector('[role="dialog"] li[aria-current="step"]:has-text("Conferir")');
  }

  // ── Em cada largura ──
  const todas = [...new Set([...larguras, ...(larguras.length > 5 ? [820, 912] : [])])].sort((a, b) => a - b);
  for (const w of todas) {
    const { ctx, page, erros, estado } = await abrir(w, 900);
    await page.waitForSelector('text=Entrou no banco', { timeout: 30000 });
    await page.waitForSelector('button:has-text("Abrir")');
    let a = await medir(page);
    ok(a.length === 0, `${w}px: a lista sem barra para o lado, nada cortado nem esmagado${a.length ? ` (${umaLinha(a.join(' | '))})` : ''}`);
    const t = await textoDe(page);
    ok(t.includes('Entrou no banco') && t.includes('Saiu do banco') && t.includes('Diferença') && t.includes('Esperado, ainda não caiu'), `${w}px: os quatro totais`);
    if (w === 390 || w === 1440) {
      await page.screenshot({ path: arquivoFoto(`${w}-lista.png`) });
      const itens = page.locator('main li:has(button:has-text("Abrir"))');
      if (await itens.count()) {
        await itens.nth(10).scrollIntoViewIfNeeded();
        await itens.nth(10).screenshot({ path: arquivoFoto(`${w}-cartao.png`) });
      }
    }

    // A gaveta do lançamento, aberta na linha da descrição mais comprida.
    await page.getByRole('button', { name: /Abrir o lançamento de 12\/11/ }).click();
    await page.waitForSelector('[role="dialog"] >> text=Isso é o quê?');
    a = await medir(page);
    ok(a.length === 0, `${w}px: a gaveta do lançamento inteira${a.length ? ` (${umaLinha(a.join(' | '))})` : ''}`);
    if (w === 390 || w === 1440) await page.locator('[role="dialog"]').screenshot({ path: arquivoFoto(`${w}-gaveta.png`) });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });

    // A importação: passo 1, cada caso do passo 2 e o passo 3.
    await page.getByRole('button', { name: 'Importar extrato' }).first().click();
    await page.waitForSelector('[role="dialog"] >> text=Solte o arquivo aqui');
    a = await medir(page);
    ok(a.length === 0, `${w}px: importar, passo 1${a.length ? ` (${umaLinha(a.join(' | '))})` : ''}`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    for (const c of ['ok', 'repetido', 'outra', 'naoabre', 'buraco']) {
      estado.cenario = c;
      await irAoPasso2(page);
      a = await medir(page);
      ok(a.length === 0, `${w}px: importar, passo 2 (${c})${a.length ? ` (${umaLinha(a.join(' | '))})` : ''}`);
      if ((w === 390 || w === 1440) && c === 'ok') await page.locator('[role="dialog"]').screenshot({ path: arquivoFoto(`${w}-passo2.png`) });
      if (c === 'ok' || c === 'buraco') {
        await page.locator('[role="dialog"]').getByRole('button', { name: c === 'ok' ? 'Continuar' : 'Importar o que veio', exact: true }).click();
        await page.waitForSelector('[role="dialog"] li[aria-current="step"]:has-text("Confirmar")');
        a = await medir(page);
        ok(a.length === 0, `${w}px: importar, passo 3 (${c})${a.length ? ` (${umaLinha(a.join(' | '))})` : ''}`);
      }
      await page.keyboard.press('Escape');
      await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    }
    ok(estado.importou === 0, `${w}px: conferir não grava nada (${estado.conferiu} conferências, ${estado.importou} gravações)`);
    ok(erros.length === 0, `${w}px: nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    await ctx.close();
  }

  // ── A faixa das fontes e as situações ──
  {
    const { ctx, page } = await abrir(1440, 900);
    await page.waitForSelector('button:has-text("Abrir")');
    const faixa = page.getByRole('group', { name: 'Fontes dos dados' });
    const tf = (await faixa.innerText()).replace(/\s+/g, ' ');
    ok(tf.includes('Banco') && tf.includes('Em dia') && tf.includes('Lido até 22/11'), 'a faixa: o Banco com a situação real e a data do último extrato');
    ok((tf.match(/Ainda não ligado/g) ?? []).length === 4 && ['iFood', 'iFood Pago / Anota Aí', '99', 'Maquininha'].every((x) => tf.includes(x)), 'a faixa: iFood, iFood Pago, 99 e Maquininha dizem que ainda não estão ligados');
    ok((await faixa.getByRole('button').count()) === 0, 'a faixa: nenhum botão que não funciona');
    const sits = page.getByRole('group', { name: 'Filtrar por situação' });
    const ts = (await sits.innerText()).replace(/\s+/g, ' ');
    ok(/Casado 0/.test(ts) && /Esperado 0/.test(ts) && /A conferir 4/.test(ts) && /Só no banco 11/.test(ts) && /Não é da loja 1/.test(ts), `as cinco situações, Casado e Esperado em 0 (${ts})`);
    await page.locator('summary:has-text("O que quer dizer cada situação")').click();
    ok((await textoDe(page)).includes('A plataforma informou que vem'), 'a explicação das situações abre');

    // A situação filtra pelo servidor.
    await sits.getByRole('button', { name: /A conferir/ }).click();
    await page.waitForFunction(() => /4 de 16/.test(document.querySelector('main')?.innerText ?? ''));
    ok((await sits.getByRole('button', { name: /A conferir/ }).getAttribute('aria-pressed')) === 'true', 'a situação ligada fica marcada');
    await sits.getByRole('button', { name: /Todos/ }).click();
    await page.waitForFunction(() => /16 lançamentos/.test(document.querySelector('main')?.innerText ?? ''));

    // A fonte só oferece o que tem dado.
    const opcoes = await page.locator('#banco-fonte option').allTextContents();
    ok(JSON.stringify(opcoes) === JSON.stringify(['Todas as fontes', 'Banco', 'iFood', 'iFood Pago', '99', 'Maquininha']), `o filtro de fonte: ${opcoes.join(', ')}`);
    await ctx.close();
  }

  // A fonte sem dado não é oferecida; os filtros vão na consulta.
  {
    const { ctx, page, estado } = await abrir(1440, 900);
    estado.linhas = estado.linhas.filter((l) => l.fonte === 'banco');
    await page.reload();
    await page.waitForSelector('button:has-text("Abrir")');
    const opcoes = await page.locator('#banco-fonte option').allTextContents();
    ok(JSON.stringify(opcoes) === JSON.stringify(['Todas as fontes', 'Banco']), `sem dado do iFood, o filtro não oferece o iFood (${opcoes.join(', ')})`);
    ok(estado.consultas.at(-1).includes('periodo=ultimo'), 'a tela abre no mês do último extrato');

    await page.fill('#banco-busca', 'tarifa');
    await page.waitForFunction(() => /1 de \d+/.test(document.querySelector('main')?.innerText ?? ''));
    ok(estado.consultas.at(-1).includes('busca=tarifa'), 'a busca vai ao servidor');
    await page.fill('#banco-busca', 'não existe nada assim');
    await page.waitForSelector('text=Nenhum lançamento com esses filtros');
    await page.getByRole('button', { name: 'Limpar filtros' }).click();
    await page.waitForSelector('button:has-text("Abrir")');
    ok((await page.inputValue('#banco-busca')) === '', '"Limpar filtros" limpa a busca');

    const periodos = await page.locator('#banco-periodo option').allTextContents();
    ok(periodos[0] === 'Novembro inteiro' && periodos.includes('De 16 a 22/11') && periodos.includes('De 09 a 15/11') && periodos.includes('De 01 a 08/11') && periodos.includes('Outubro inteiro'), `os períodos do extrato (${periodos.join(', ')})`);
    await page.selectOption('#banco-periodo', { label: 'De 09 a 15/11' });
    await page.waitForFunction(() => /de \d+ lançamentos/.test(document.querySelector('main')?.innerText ?? ''));
    await page.waitForTimeout(150);
    ok(estado.consultas.at(-1).includes('de=2026-11-09') && estado.consultas.at(-1).includes('ate=2026-11-15'), 'o pedaço do mês vai na consulta');
    await page.selectOption('#banco-periodo', { label: 'Outro período' });
    const datas = page.locator('main input[type="date"]');
    ok((await datas.count()) === 2, 'Outro período: dois seletores nativos de data');
    await datas.nth(0).fill('2026-11-20');
    await datas.nth(1).fill('2026-11-10');
    await page.waitForSelector('text=A data inicial vem depois da final');
    ok(true, 'o período invertido é dito na tela');
    await ctx.close();
  }

  // "Mostrar mais".
  {
    const { ctx, page, estado } = await abrir(1440, 900);
    await page.waitForSelector('button:has-text("Abrir")');
    ok((await page.locator('tbody tr').count()) === 12, 'a lista começa com 12');
    await page.getByRole('button', { name: 'Mostrar mais 4' }).click();
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 16);
    ok(estado.consultas.at(-1).includes('deslocamento=12'), '"Mostrar mais" pede a página seguinte');
    ok((await textoDe(page)).includes('Mostrando todos os 16'), 'depois: mostrando todos');
    await ctx.close();
  }

  // Classificar e lembrar.
  {
    const { ctx, page, estado, erros } = await abrir(1440, 900);
    await page.waitForSelector('button:has-text("Abrir")');
    await page.getByRole('button', { name: /Abrir o lançamento de 18\/11/ }).click();
    const g = page.locator('[role="dialog"]');
    await g.getByLabel('Isso é o quê?').waitFor();
    const tg = (await g.innerText()).replace(/\s+/g, ' ');
    ok(tg.includes('Saída de 18/11') && tg.includes('Como veio no extrato') && tg.includes('PIX ENVIADO · M*** C*** · CPF ***.781.***-**') && tg.includes('Nomes e documentos ficam mascarados e nunca vão para a IA.'), 'a gaveta: a saída, como veio no extrato (mascarado) e o aviso');
    ok((await g.getByLabel('Isso é o quê?').locator('option').count()) === 15, 'o "Isso é o quê?" com os 14 tipos e o "Escolher"');
    ok((await page.evaluate(() => document.activeElement?.tagName)) === 'SELECT', 'o foco entra no "Isso é o quê?"');
    await g.getByLabel('Isso é o quê?').selectOption({ label: 'Retirada do dono' });
    await g.getByLabel(/Lembrar para os próximos/).check();
    await g.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.waitForSelector('text=Os próximos com esta descrição entram como "Retirada do dono"');
    ok(estado.patches.length === 1 && estado.patches[0].corpo.tipo === 'retirada_dono' && estado.patches[0].corpo.lembrar === true, `salvar manda o tipo e o lembrar (${JSON.stringify(estado.patches[0]?.corpo)})`);
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.waitForSelector('td:has-text("Retirada do dono")');
    ok(true, 'a lista é relida com o tipo novo');

    await page.getByRole('button', { name: /Abrir o lançamento de 10\/11/ }).click();
    await g.getByLabel('Isso é o quê?').selectOption({ label: 'Não é da loja' });
    await g.getByRole('button', { name: 'Salvar', exact: true }).click();
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.waitForFunction(() => /Não é da loja\s*2/.test(document.querySelector('[aria-label="Filtrar por situação"]')?.innerText ?? ''));
    ok(estado.patches[1].corpo.lembrar === false, '"Não é da loja" sem lembrar');
    ok((await textoDe(page)).includes('Você marcou: fica fora das contas da loja'), 'o lançamento marcado explica que fica fora');
    ok(erros.length === 0, 'classificar: nenhum erro de script');
    await ctx.close();
  }

  // Importar nos 3 passos e os casos.
  {
    const { ctx, page, estado, erros } = await abrir(1440, 900);
    await page.waitForSelector('button:has-text("Abrir")');
    await page.getByRole('button', { name: 'Importar extrato' }).first().click();
    const g = page.locator('[role="dialog"]');
    ok(await g.getByRole('button', { name: 'Continuar', exact: true }).isDisabled(), 'sem arquivo, não continua');
    await page.setInputFiles('[role="dialog"] input[type="file"]', arquivoDe('extrato-nov.ofx'));
    ok((await g.innerText()).includes('extrato-nov.ofx'), 'o nome do arquivo escolhido aparece');
    await g.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.waitForSelector('[role="dialog"] li[aria-current="step"]:has-text("Conferir")');
    let t = (await g.innerText()).replace(/\s+/g, ' ');
    ok(t.includes('Passo 2 de 3') && t.includes('final 4821') && t.includes('01/11 a 23/11') && /Novos 2/.test(t) && /Já estavam aqui 35/.test(t), 'passo 2: a conta, o período e o que é novo');
    ok(t.includes('A conta fecha: R$ 38.420,00 +R$ 1.240,30 −R$ 410,00 = R$ 39.250,30.'), `passo 2: a conta fecha (${t.slice(0, 0)}…)`);
    ok(t.includes('1 linha ficou de fora'), 'passo 2: diz quantas linhas ficaram de fora');
    ok(estado.importou === 0, 'passo 2: nada gravado');
    await g.getByRole('button', { name: 'Continuar', exact: true }).click();
    await page.waitForSelector('[role="dialog"] li[aria-current="step"]:has-text("Confirmar")');
    t = (await g.innerText()).replace(/\s+/g, ' ');
    ok(/Vai entrar 2 lançamentos novos/.test(t) && /Vai ficar de fora 35 repetidos/.test(t), 'passo 3: o que entra e o que fica de fora');
    ok(!t.includes('casar'), 'passo 3: não promete casar com os repasses, que ainda não existe');
    ok(estado.importou === 0, 'passo 3: ainda nada gravado');
    await g.getByRole('button', { name: 'Importar', exact: true }).click();
    await page.waitForSelector('text=Importado: 2 lançamentos novos');
    ok(estado.importou === 1, 'importar grava uma vez');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.waitForFunction(() => /17 lançamentos/.test(document.querySelector('main')?.innerText ?? ''));
    ok(true, 'a lista é relida depois de importar');

    const caso = async (c) => {
      estado.cenario = c;
      await irAoPasso2(page);
      const x = (await g.innerText()).replace(/\s+/g, ' ');
      return x;
    };
    t = await caso('repetido');
    ok(t.includes('Esse arquivo já entrou em 22/11.') && t.includes('35 lançamentos dele já estão aqui, e nada vai duplicar'), 'arquivo repetido: a frase do protótipo');
    ok((await g.getByRole('button', { name: 'Importar', exact: true }).count()) === 0, 'arquivo repetido: sem botão de importar');
    await page.keyboard.press('Escape');
    t = await caso('outra');
    ok(t.includes('Esse arquivo é de outra conta.') && t.includes('conta final 7306') && t.includes('conta final 4821') && t.includes('Nada foi gravado.'), 'outra conta: a frase do protótipo');
    await page.keyboard.press('Escape');
    t = await caso('naoabre');
    ok(t.includes('Não consegui abrir esse arquivo. Ele veio em PDF, e o Regem lê o extrato em OFX. Nada foi gravado.') && t.includes('Como baixar em OFX'), 'arquivo que não abre: a frase e como baixar');
    await g.getByRole('button', { name: 'Escolher outro', exact: true }).click();
    await page.waitForSelector('[role="dialog"] >> text=Solte o arquivo aqui');
    ok(true, '"Escolher outro" volta ao passo 1');
    await page.keyboard.press('Escape');
    t = await caso('buraco');
    ok(t.includes('Falta um pedaço neste extrato.') && t.includes('09/11 a 15/11') && t.includes('a loja vendeu nesses dias') && t.includes('não usa esse período na conta do caixa'), 'período com buraco: a frase do protótipo');
    await g.getByRole('button', { name: 'Importar o que veio', exact: true }).click();
    await page.waitForSelector('text=fica marcado como incompleto');
    ok(true, 'buraco: o passo 3 diz que o período fica marcado');
    ok(erros.length === 0, 'importar: nenhum erro de script');
    await ctx.close();
  }

  // Arquivo grande demais nem sai do navegador.
  {
    const { ctx, page, estado } = await abrir(1440, 900);
    await page.waitForSelector('button:has-text("Abrir")');
    await page.getByRole('button', { name: 'Importar extrato' }).first().click();
    await page.setInputFiles('[role="dialog"] input[type="file"]', { name: 'grande.ofx', mimeType: 'application/x-ofx', buffer: Buffer.alloc(5 * 1024 * 1024 + 10, 0x20) });
    await page.waitForSelector('text=Esse arquivo passa de 5 MB');
    ok(estado.conferiu === 0 && (await page.locator('[role="dialog"]').getByRole('button', { name: 'Continuar', exact: true }).isDisabled()), 'arquivo acima de 5 MB é recusado antes de enviar');
    await ctx.close();
  }

  // Os estados: vazio, erro e o gerente.
  {
    const { ctx, page, estado } = await abrir(390, 800, { vazio: true });
    await page.waitForSelector('text=Nenhum extrato importado ainda');
    const t = await textoDe(page);
    ok(t.includes('Baixe o extrato em OFX no site ou no app do banco e envie aqui. O Regem mostra tudo antes de gravar.'), 'vazio: o texto do protótipo');
    ok((await page.getByRole('button', { name: 'Importar extrato' }).count()) >= 1, 'vazio: o botão de importar');
    ok(!t.includes('Ainda não ligado'), 'vazio: sem a faixa das fontes, como o protótipo');
    ok(estado.chamadas >= 1, 'vazio: a tela leu o servidor');
    await ctx.close();
  }
  {
    const { ctx, page, estado } = await abrir(390, 800, { falhar: true });
    await page.waitForSelector('text=Não consegui ler os lançamentos');
    ok((await textoDe(page)).includes('Nada se perdeu. Tente de novo em instantes.'), 'erro: o texto do protótipo, nunca R$ 0,00');
    estado.falhar = false;
    await page.getByRole('button', { name: 'Tentar de novo' }).click();
    await page.waitForSelector('text=Entrou no banco');
    ok(true, 'erro: "Tentar de novo" lê de novo');
    await ctx.close();
  }
  {
    const { ctx, page, estado } = await abrir(390, 800, { token: GERENTE });
    await page.waitForSelector('text=Só o presidente vê o banco e os repasses');
    await page.waitForTimeout(300);
    ok(estado.chamadas === 0, 'o gerente: a tela nem chama a rota');
    ok(!(await textoDe(page)).includes('R$'), 'o gerente: nenhum valor na tela');
    await ctx.close();
  }
}
