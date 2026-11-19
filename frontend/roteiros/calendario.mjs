// Roteiro de tela do CALENDÁRIO DE EVENTOS (F2 do `docs/plano-perfil-cliente.md`, protótipo `mockups/regem-perfil-cliente.html`,
// aba "Calendário"; mig 461). A API simulada. Confere:
//  • Delivery › Clientes › Calendário de eventos, em cada largura: nenhuma barra de rolagem para o lado (a página e
//    qualquer peça) nem texto esmagado — a lista, a gaveta "Evento da loja" ABERTA e o diálogo de excluir ABERTO (V45);
//  • as situações com quantidade que filtram; o evento sem lei com o selo "costume"; só o evento da loja que a pessoa pode
//    mudar tem "Editar" e "Excluir"; o feriado da Escala aponta para Escalas › Feriado / evento;
//  • o período que vai na consulta (14, 30, 60 dias); a nuvem não respondeu (a faixa e o "Tentar de novo"); o vazio;
//  • criar (o corpo que sai: nome, tipo, dia, hora, repete), editar (PATCH no id) e excluir (DELETE no id);
//  • o módulo desligado: a tela diz onde ligar e não chama a rota do calendário.
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', nome: 'Ana' });
const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const mais = (n) => {
  const [a, m, d] = hoje.split('-').map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
};

const EVENTOS = () => [
  { chave: 'regra:feriado:x', dia: mais(1), grupo: 'feriado', tipo: 'feriado', nome: 'Dia Nacional de Zumbi e da Consciência Negra', detalhe: 'Lei 14.759/2023', origem: 'regra', confianca: 'lei' },
  { chave: 'regra:dinheiro:vale', dia: mais(1), grupo: 'dinheiro', tipo: 'dinheiro', nome: 'Vale (adiantamento) do dia 20', detalhe: 'costume de muitas empresas, não é lei', origem: 'regra', confianca: 'costume' },
  { chave: 'escala:e1:x', dia: mais(3), grupo: 'feriado', tipo: 'feriado_escala', nome: 'Aniversário da cidade', detalhe: 'Feriado cadastrado em Escalas › Feriado / evento', origem: 'escala', unidadeId: 'u1', unidadeNome: 'Loja Centro' },
  { chave: 'loja:ev1:x', dia: mais(4), grupo: 'loja', tipo: 'promocao', nome: 'Smash em dobro na quinta', detalhe: 'Promoção da casa · 19:00 · toda semana · cadastrado pela loja', origem: 'loja', id: 'ev1', hora: '19:00', repete: 'semana', diaDoCadastro: mais(4), unidadeId: 'u1', unidadeNome: 'Loja Centro', podeEditar: true },
  { chave: 'regra:comemorativa:bf', dia: mais(8), grupo: 'comemorativa', tipo: 'comemorativa', nome: 'Black Friday', detalhe: 'costume do comércio (a sexta depois da 4ª quinta de novembro)', origem: 'regra', confianca: 'costume' },
  { chave: 'loja:ev2:x', dia: mais(10), grupo: 'loja', tipo: 'show', nome: 'Show no estádio com um nome bem comprido para ver a quebra de linha no celular', detalhe: 'Show ou festa na cidade · todas as lojas · cadastrado pela loja', origem: 'loja', id: 'ev2', hora: null, repete: 'nao', diaDoCadastro: mais(10), unidadeId: null, podeEditar: false },
  { chave: 'regra:dinheiro:13', dia: mais(11), grupo: 'dinheiro', tipo: 'dinheiro', nome: '13º salário — prazo da 1ª parcela', detalhe: 'Lei 4.749/1965, art. 2º (até 30/11)', origem: 'regra', confianca: 'lei' },
];

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    for (const el of document.querySelectorAll('main p, main td, main li, main h2, main h3, main strong, main span, [role="dialog"] p, [role="dialog"] label')) {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      if (r.width > 0 && r.width < 60 && r.height > lh * 3.2 && (el.textContent || '').trim().length > 12)
        achados.push(`esmagado ${el.tagName.toLowerCase()} ${Math.round(r.width)}px: ${(el.textContent || '').trim().slice(0, 24)}`);
    }
    return achados;
  });
const texto = (page, sel = 'main') => page.evaluate((s) => document.querySelector(s)?.innerText.replace(/\s+/g, ' ') ?? '', sel);

export default async function roteiroCalendario({ nav, base, ok, foto: arquivoFoto, larguras }) {
  async function abrir(w, h, o = {}) {
    const consultas = [];
    const enviados = [];
    let falhas = o.falhas ?? 0;
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), PRESIDENTE);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname.replace(/^.*\/api\/v1/, '');
      const metodo = route.request().method();
      if (p === '/modulos/meus') return responder(route, { perfil_cliente: o.desligado ? false : true });
      if (p === '/calendario-da-loja') {
        consultas.push(u.search);
        if (falhas > 0) {
          falhas--;
          return responder(route, { statusCode: 502, message: 'A nuvem não respondeu agora.' }, 502);
        }
        return responder(route, { de: u.searchParams.get('de'), ate: u.searchParams.get('ate'), eventos: o.vazio ? [] : EVENTOS() });
      }
      if (p.startsWith('/calendario-da-loja/eventos')) {
        enviados.push({ metodo, p, corpo: route.request().postDataJSON?.() ?? null });
        return responder(route, metodo === 'DELETE' ? { ok: true } : { id: 'novo' });
      }
      return responder(route, {});
    });
    await page.goto(base + '/clientes/calendario');
    return { ctx, page, erros, consultas, enviados };
  }

  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, 900);
    await page.waitForSelector('text=Smash em dobro na quinta', { timeout: 30000 });
    const t = await texto(page);
    let achados = await medir(page);
    ok(achados.length === 0, `${w}px · calendário: sem barra para o lado nem texto esmagado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok(t.includes('7 eventos') && t.includes('Consciência Negra') && t.includes('Black Friday') && t.includes('Escalas › Feriado / evento'), `${w}px · a lista, a contagem e o feriado da Escala`);
    // A gaveta "Evento da loja" ABERTA (V45).
    await page.getByRole('button', { name: /Evento da loja/ }).first().click();
    await page.waitForSelector('[role="dialog"]', { timeout: 10000 });
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · gaveta aberta: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    const g = await texto(page, '[role="dialog"]');
    ok(g.includes('Nome') && g.includes('Tipo') && g.includes('Dia') && g.includes('Começa (opcional)') && g.includes('Repete'), `${w}px · a gaveta tem nome, tipo, dia, hora e repete`);
    if (w === 390 || w === 1440) await page.locator('[role="dialog"]').screenshot({ path: arquivoFoto(`calendario-gaveta-${w}.png`) });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 5000 });
    // O diálogo de excluir ABERTO.
    await page.getByRole('button', { name: 'Excluir: Smash em dobro na quinta' }).first().click();
    await page.waitForSelector('[role="alertdialog"]', { timeout: 10000 });
    achados = await medir(page);
    ok(achados.length === 0, `${w}px · diálogo de excluir aberto: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok((await texto(page, '[role="alertdialog"]')).includes('com todas as repetições'), `${w}px · o diálogo diz que as repetições saem juntas`);
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="alertdialog"]', { state: 'detached', timeout: 5000 });
    if (w === 390 || w === 1440) {
      await page.screenshot({ path: arquivoFoto(`calendario-${w}.png`) });
      await page.locator('main section').first().screenshot({ path: arquivoFoto(`calendario-${w}-lista.png`) });
    }
    ok(erros.length === 0, `${w}px · nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    await ctx.close();
  }

  for (const w of [390, 1366]) {
    {
      // As situações filtram; "costume"; só o evento que a pessoa pode mudar tem as ações; o período vai na consulta.
      const { ctx, page, consultas, enviados } = await abrir(w, 900);
      await page.waitForSelector('text=Smash em dobro na quinta', { timeout: 30000 });
      ok(consultas[0]?.includes(`de=${hoje}`) && consultas[0]?.includes(`ate=${mais(13)}`), `${w}px · abre nos próximos 14 dias (${umaLinha(consultas[0] ?? '?')})`);
      await page.getByRole('button', { name: /^Dinheiro no bolso/ }).click();
      let t = await texto(page);
      ok(t.includes('2 de 7 eventos') && !t.includes('Black Friday'), `${w}px · "Dinheiro no bolso" filtra (${umaLinha(t.match(/\d+ de \d+ eventos/)?.[0] ?? '?')})`);
      await page.getByRole('button', { name: /^Da loja/ }).click();
      t = await texto(page);
      ok(t.includes('3 de 7 eventos') && t.includes('Aniversário da cidade'), `${w}px · "Da loja" junta os da loja e o da Escala`);
      ok((await page.getByRole('button', { name: 'Editar: Show no estádio com um nome bem comprido para ver a quebra de linha no celular' }).count()) === 0, `${w}px · o evento de todas as lojas não tem "Editar" para quem não pode`);
      await page.getByRole('button', { name: /^Todos/ }).click();
      ok((await page.locator('text=costume').count()) >= 2, `${w}px · as datas sem lei com o selo "costume"`);
      await page.getByRole('button', { name: 'Próximos 60 dias' }).click();
      await page.waitForSelector('text=Smash em dobro na quinta', { timeout: 10000 });
      ok(consultas.some((c) => c.includes(`ate=${mais(59)}`)), `${w}px · "Próximos 60 dias" pede o período`);
      // Criar: o corpo que sai.
      await page.getByRole('button', { name: /Evento da loja/ }).first().click();
      await page.fill('#evento-loja-nome', 'Final do campeonato');
      await page.selectOption('#evento-loja-tipo', 'jogo_time');
      await page.fill('#evento-loja-dia', mais(5));
      await page.fill('#evento-loja-hora', '21:30');
      await page.getByRole('button', { name: 'Salvar evento' }).click();
      await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 10000 });
      const criado = enviados.find((e) => e.metodo === 'POST');
      ok(
        !!criado && criado.corpo?.nome === 'Final do campeonato' && criado.corpo?.tipo === 'jogo_time' && criado.corpo?.dia === mais(5) && criado.corpo?.hora === '21:30' && criado.corpo?.repete === 'nao',
        `${w}px · criar manda nome, tipo, dia, hora e repete (${umaLinha(JSON.stringify(criado?.corpo ?? null))})`,
      );
      // Editar: PATCH no id, com o dia do cadastro.
      await page.getByRole('button', { name: 'Editar: Smash em dobro na quinta' }).first().click();
      ok((await page.inputValue('#evento-loja-nome')) === 'Smash em dobro na quinta' && (await page.inputValue('#evento-loja-repete')) === 'semana', `${w}px · editar abre com o que está salvo`);
      await page.getByRole('button', { name: 'Salvar evento' }).click();
      await page.waitForSelector('[role="dialog"]', { state: 'detached', timeout: 10000 });
      ok(enviados.some((e) => e.metodo === 'PATCH' && e.p === '/calendario-da-loja/eventos/ev1' && e.corpo?.dia === mais(4)), `${w}px · editar manda PATCH no id`);
      // Excluir: DELETE no id.
      await page.getByRole('button', { name: 'Excluir: Smash em dobro na quinta' }).first().click();
      await page.getByRole('button', { name: 'Excluir evento' }).click();
      await page.waitForSelector('[role="alertdialog"]', { state: 'detached', timeout: 10000 });
      ok(enviados.some((e) => e.metodo === 'DELETE' && e.p === '/calendario-da-loja/eventos/ev1'), `${w}px · excluir manda DELETE no id`);
      await ctx.close();
    }
    {
      // A nuvem não respondeu: a faixa; "Tentar de novo" lê de novo.
      const { ctx, page, consultas } = await abrir(w, 900, { falhas: 1 });
      await page.waitForSelector('text=Não consegui ler o calendário agora', { timeout: 30000 });
      const achados = await medir(page);
      ok(achados.length === 0, `${w}px · não leu: sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
      await page.getByRole('button', { name: 'Tentar de novo' }).click();
      await page.waitForSelector('text=Smash em dobro na quinta', { timeout: 10000 });
      ok(consultas.length === 2, `${w}px · "Tentar de novo" lê de novo (${consultas.length} leituras)`);
      await ctx.close();
    }
    {
      const { ctx, page } = await abrir(w, 900, { vazio: true });
      await page.waitForSelector('text=Nenhum evento neste período', { timeout: 30000 });
      ok((await medir(page)).length === 0, `${w}px · vazio: sem barra para o lado`);
      await ctx.close();
    }
    {
      const { ctx, page, consultas } = await abrir(w, 900, { desligado: true });
      await page.waitForSelector('text=está desligado', { timeout: 30000 });
      const t = await texto(page);
      ok(t.includes('Visão C&O › Módulos do produto') && consultas.length === 0, `${w}px · módulo desligado: diz onde ligar e não lê o calendário`);
      await ctx.close();
    }
  }
}
