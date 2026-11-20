// Roteiro de tela de DELIVERY › CLIENTES › SAÚDE DA BASE (F4 do `docs/plano-perfil-cliente.md`; protótipo, aba 5).
// A API simulada. Confere:
//  • em cada largura: os sete blocos com os números escritos (o resumo em frases, os itens que fazem voltar e os que levam a
//    sumir, o que querem encontrar, as reclamações, os mais abertos e o dado de cada camada), o bloco que o servidor não leu
//    com o próprio aviso e "Tentar de novo" — nenhuma barra para o lado nem texto esmagado (V45);
//  • "Ver os atrasados no próprio ritmo" abre Clientes já na aba (`segmento=perfil_atrasado`);
//  • a base vazia (os textos de vazio), o gerente (o servidor recusa: a tela diz de quem é) e o botão em Clientes só para o
//    presidente.
import { responder, tokenFalso, umaLinha } from './comum.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', nome: 'Ana' });
const GERENTE = tokenFalso({ cat: 'gerente', perfil: 'gerente', nome: 'Gil' });

const CHEIA = {
  frase: { novos: 214, novos2o: 66, novosAnt: 180, novos2oAnt: 49, voltaram: 19, semanaisSumidos: 37, semanaisComReclamacao: 12, sumiuDias: 15 },
  itens: {
    estreias: 900,
    voltaram: 279,
    minimo: 30,
    voltam: [
      { nome: 'Smash duplo', estreias: 120, voltaram: 53 },
      { nome: 'X-Bacon da casa com cheddar cremoso e cebola caramelizada no pão brioche', estreias: 98, voltaram: 38 },
      { nome: 'Combo família', estreias: 60, voltaram: 21 },
    ],
    somem: [
      { nome: 'Costela BBQ', estreias: 50, voltaram: 9 },
      { nome: 'Wrap de frango', estreias: 42, voltaram: 9 },
      { nome: 'Salada da casa', estreias: 36, voltaram: 8 },
    ],
  },
  gostaria: [
    { opcao: 'Açaí', n: 41 },
    { opcao: 'Doces', n: 26 },
    { opcao: 'Saudável e leve', n: 19 },
    { opcao: 'Sem lactose', n: 11 },
  ],
  reclamacoes: { porMotivo: [{ nome: 'atraso', vezes: 48, clientes: 30 }, { nome: 'chegou frio', vezes: 25, clientes: 20 }], repetidos: 9 },
  buscas: null, // o servidor não leu este bloco: a tela mostra o aviso dele e o resto aparece
  abertos: [
    { produto_id: 'p1', nome: 'Costela BBQ', abriram: 210, carrinho: 40 },
    { produto_id: 'p2', nome: 'Smash duplo', abriram: 180, carrinho: 120 },
  ],
  dado: { ativos: 1200, pede: 552, quando: 492, move: 108, olha: 48, visitasComCliques30d: 3400 },
};
const VAZIA = {
  frase: { novos: 0, novos2o: 0, novosAnt: 0, novos2oAnt: 0, voltaram: 0, semanaisSumidos: 0, semanaisComReclamacao: 0, sumiuDias: 15 },
  itens: { estreias: 0, voltaram: 0, minimo: 30, voltam: [], somem: [] },
  gostaria: [],
  reclamacoes: { porMotivo: [], repetidos: 0 },
  buscas: [],
  abertos: [],
  dado: { ativos: 0, pede: 0, quando: 0, move: 0, olha: 0, visitasComCliques30d: 0 },
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
    for (const el of document.querySelectorAll('main p, main button, main li span, main h2')) {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      if (r.width > 0 && r.width < 60 && r.height > lh * 3.2 && (el.textContent || '').trim().length > 12)
        achados.push(`esmagado ${el.tagName.toLowerCase()} ${Math.round(r.width)}px: ${(el.textContent || '').trim().slice(0, 24)}`);
      if (r.right > doc.clientWidth + 1) achados.push(`passa da tela ${el.tagName.toLowerCase()}: ${(el.textContent || '').trim().slice(0, 24)}`);
    }
    return achados;
  });
const texto = (page) => page.evaluate(() => document.querySelector('main')?.innerText.replace(/\s+/g, ' ') ?? '');

export default async function roteiroSaudeDaBase({ nav, base, ok, foto: arquivoFoto, larguras }) {
  async function abrir(w, h, { jwt = PRESIDENTE, corpo = CHEIA, status = 200, caminho = '/clientes/saude' } = {}) {
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
      if (p === '/perfil-cliente/saude')
        return status === 200 ? responder(route, corpo) : responder(route, { statusCode: status, message: 'Sem permissão' }, status);
      if (p === '/clientes/crm/resumo') return responder(route, { total: 0 });
      if (p === '/perfil-cliente/resumo') return responder(route, { segmentos: {}, etiquetas: { atrasado: 6 }, selos: {}, total: 0 });
      if (p === '/clientes/crm' || p.startsWith('/clientes/crm/') || p.startsWith('/campanhas')) return responder(route, []);
      return responder(route, {});
    });
    await page.goto(base + caminho);
    return { ctx, page, erros, consultas };
  }

  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, 900);
    await page.waitForSelector('text=Em uma frase', { timeout: 30000 });
    await page.waitForSelector('text=Perfil com dado suficiente', { timeout: 10000 });
    const achados = await medir(page);
    ok(achados.length === 0, `${w}px · Saúde da base: sem barra para o lado nem texto esmagado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    const t = await texto(page);
    ok(
      t.includes('37 clientes que pediam toda semana não pedem há 15 dias ou mais.') && t.includes('12 têm reclamação nos últimos 90 dias.'),
      `${w}px · a frase dos semanais que sumiram`,
    );
    ok(t.includes('Chegaram 214 clientes novos neste mês; 31% já fizeram o 2º pedido (no mesmo ponto do mês passado: 27%).'), `${w}px · a frase dos novos com o mês passado`);
    ok(t.includes('19 clientes voltaram neste mês depois de 60 dias ou mais sem pedir.'), `${w}px · a frase de quem voltou`);
    ok(t.includes('Smash duplo 44%') && t.includes('Média da loja: 31%.') && t.includes('Costela BBQ 18%'), `${w}px · os itens que fazem voltar e os que levam a sumir, com o número escrito`);
    ok(t.includes('97 respostas') && t.includes('Açaí 41'), `${w}px · o que os clientes querem encontrar`);
    ok(t.includes('atraso 48') && t.includes('9 clientes reclamaram 2 vezes ou mais do mesmo motivo.'), `${w}px · as reclamações por motivo`);
    ok(t.includes('210 · 19% no carrinho'), `${w}px · os mais abertos com o carrinho`);
    ok(t.includes('Clientes ativos (pediram nos últimos 90 dias): 1.200') && t.includes('O que pede 46%') && t.includes('O que olha 4%'), `${w}px · o dado de cada camada`);
    ok(t.includes('Não consegui ler este bloco agora.') && (await page.getByRole('button', { name: 'Tentar de novo' }).count()) === 1, `${w}px · o bloco não lido tem o próprio aviso e "Tentar de novo"`);
    if (w === 390 || w === 1440) await page.locator('main').screenshot({ path: arquivoFoto(`saude-da-base-${w}.png`) });
    ok(erros.length === 0, `${w}px · nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
    await ctx.close();
  }

  {
    // "Ver os atrasados no próprio ritmo" abre Clientes já na aba.
    const { ctx, page, consultas } = await abrir(1280, 900);
    await page.waitForSelector('text=Ver os atrasados no próprio ritmo', { timeout: 30000 });
    await page.getByRole('link', { name: 'Ver os atrasados no próprio ritmo' }).click();
    await page.waitForURL(/\/clientes\?seg=perfil_atrasado/, { timeout: 15000 });
    await page.waitForTimeout(800);
    ok(consultas.some((c) => c.startsWith('/clientes/crm?') && c.includes('segmento=perfil_atrasado')), 'o link abre Clientes pedindo segmento=perfil_atrasado');
    await ctx.close();
  }
  {
    // A base vazia: os textos de vazio, nenhum aviso de erro.
    const { ctx, page } = await abrir(390, 900, { corpo: VAZIA });
    await page.waitForSelector('text=Em uma frase', { timeout: 30000 });
    const t = await texto(page);
    ok(
      t.includes('Nenhum cliente novo neste mês até agora.') &&
        t.includes('Ainda não há itens com 30 estreias ou mais') &&
        t.includes('Ninguém respondeu ainda.') &&
        t.includes('Nenhuma busca sem resultado nos últimos 30 dias.') &&
        t.includes('Ainda sem clientes ativos com perfil.') &&
        !t.includes('Não consegui ler'),
      'base vazia: os textos de vazio de cada bloco',
    );
    await ctx.close();
  }
  {
    // O gerente: o servidor recusa (403) e a tela diz de quem é; em Clientes, sem o botão.
    const { ctx, page } = await abrir(1280, 900, { jwt: GERENTE, status: 403 });
    await page.waitForSelector('text=A Saúde da base é do presidente', { timeout: 30000 });
    ok(true, 'gerente: a tela diz que a Saúde da base é do presidente');
    await page.goto(base + '/clientes');
    await page.waitForSelector('text=Calendário de eventos', { timeout: 30000 });
    ok((await page.getByRole('link', { name: 'Saúde da base' }).count()) === 0, 'gerente: Clientes sem o botão "Saúde da base"');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { caminho: '/clientes' });
    await page.waitForSelector('text=Calendário de eventos', { timeout: 30000 });
    ok((await page.getByRole('link', { name: 'Saúde da base' }).count()) === 1, 'presidente: Clientes com o botão "Saúde da base"');
    await ctx.close();
  }
}
