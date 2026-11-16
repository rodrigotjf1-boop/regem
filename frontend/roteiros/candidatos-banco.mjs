// Roteiro de tela da F4b, parte 1 — avisar o banco de talentos (protótipo `mockups/regem-vagas-talentos.html`, a faixa
// "Vaga aberta" e a gaveta "Avisar o banco de talentos", via sem número de marketing). A API simulada.
//  • Em cada largura: a faixa diz quantos podem ser avisados; "Avisar o banco de talentos" abre a gaveta com quem recebe
//    ("Abrir no WhatsApp" com a mensagem pronta e "Marquei como avisado") e quem não recebe, com o motivo; nada fora da
//    janela com a gaveta aberta, nenhum texto esmagado, foto de cada pessoa.
//  • "Marquei como avisado" manda a pessoa e a função e relê; trocar a função pede `?funcao=`.
//  • A leitura que falha: "Tentar de novo"; ninguém para avisar: o estado vazio.
import { responder, tokenFalso } from './comum.mjs';
import { esmagados } from './candidatos-conducao.mjs';

const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: { candidatos: { ver: true, editar: true } } });
const MSG = (nome) => `Olá, ${nome}! A Burger da Praça abriu vaga de Chapeiro(a) (12x36, das 15h às 3h · R$ 1.900,00). Você deixou sua ficha no nosso banco de talentos. Quer participar da seleção?\n\nSe não quiser mais receber avisos de vaga, é só responder dizendo.`;
const pessoa = (id, nome, km) => ({
  id, nome, funcoes: ['Chapeiro(a)', 'Auxiliar de cozinha'], distanciaKm: km, autorizouEm: '2026-11-10', mensagem: MSG(nome.split(' ')[0]),
  link: `https://wa.me/552199990000?text=${encodeURIComponent(MSG(nome.split(' ')[0]))}`,
});
const FUNCOES = [
  { codigo: 'chapeiro', nome: 'Chapeiro(a)', detalhe: '12x36, das 15h às 3h · 5x2, das 19h às 3h · R$ 1.900,00', dentro: 3 },
  { codigo: 'atendimento', nome: 'Atendimento', detalhe: '5x2, das 19h às 3h · R$ 1.800,00', dentro: 0 },
];
const ficha = (id, nome, situacao) => ({
  id, protocolo: `V-${id}`, situacao, nome, idade: 24, telefone: '21999990000', bairro: 'Penha', cidade: 'Rio de Janeiro', funcoes: ['chapeiro'], setores: [],
  tipoVaga: 'fixa', escala: '12x36', dias: [], meios: ['publico'], conducoes: 1, valorIda: 4.7, valorVolta: 4.7, experiencia: 'sim', estuda: false,
  turnoEstudo: null, trabalhando: false, comeca: 'imediato', origem: null, origemNome: null, entrevistaEm: null, recebidoEm: '2026-11-14T15:00:00Z',
  loja: 'Burger da Praça', comunicacao: true, experiencias: 2, temCarteira: true, jaLiderou: false, distanciaKm: 3.1, minutosCarro: 9, distanciaFalha: null, distanciaMedindo: false,
});

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        if (el.classList.contains('faixa-abas') && window.innerWidth < 640 && el.offsetHeight === el.clientHeight + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)) continue;
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      }
    }
    for (const el of document.querySelectorAll('[data-faixa-vaga-aberta] *, [role="dialog"] *')) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 1 && r.right > window.innerWidth + 1) achados.push(`passa ${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 20)}" ${Math.round(r.right)}>${window.innerWidth}`);
    }
    return achados;
  });

export default async function roteiroCandidatosBanco({ nav, base, ok, foto, larguras }) {
  async function abrir(w, { falhas = 0, ninguem = false } = {}) {
    const ctx = await nav.newContext({ viewport: { width: w, height: w < 700 ? 820 : 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    const S = { marcados: [], pedidas: [], avisados: new Set(), falhar: falhas };
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const p = url.pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/vagas/banco/aviso' && req.method() === 'POST') {
        const corpo = JSON.parse(req.postData() || '{}');
        S.marcados.push(corpo);
        S.avisados.add(corpo.candidatoId);
        return responder(route, { ok: true, jaAvisado: false });
      }
      if (p === '/vagas/banco/aviso') {
        const f = url.searchParams.get('funcao');
        S.pedidas.push(f);
        // a 1ª leitura é a da faixa; a falha simulada vale para a gaveta (a 2ª leitura)
        if (S.falhar > 0 && S.pedidas.length >= 2) {
          S.falhar--;
          return responder(route, { message: 'O servidor demorou para responder.' }, 503);
        }
        const todas = ninguem ? [] : [pessoa('p1', 'Juliana Souza de Albuquerque Figueiredo', 2.2), pessoa('p2', 'Carla Mendes', 4), pessoa('p3', 'Bruno Lima', null)];
        const funcao = f === 'atendimento' ? 'atendimento' : 'chapeiro';
        const dentro = funcao === 'chapeiro' ? todas.filter((x) => !S.avisados.has(x.id)) : [];
        const fora = [
          { id: 'f1', nome: 'Fábio Nascimento', motivo: 'não autorizou mensagens na ficha' },
          { id: 'f2', nome: 'Diego Rocha', motivo: 'pediu para não receber mensagens em 05/11' },
          ...todas.filter((x) => S.avisados.has(x.id)).map((x) => ({ id: x.id, nome: x.nome, motivo: 'já foi avisada desta função em 16/11 (de novo a partir de 16/12)' })),
        ];
        return responder(route, { funcoes: FUNCOES.map((x) => (x.codigo === 'chapeiro' ? { ...x, dentro: dentro.length } : x)), funcao, dentro, fora });
      }
      if (p === '/vagas/candidatos') return responder(route, [ficha('c1', 'Ana Teste', 'banco'), ficha('c2', 'Rui Teste', 'novo')]);
      if (p === '/vagas/candidatos/conducao') return responder(route, { pessoas: [], porMes: 0, porDia: 0, somadas: 0, foraDaSoma: 0 });
      return responder(route, {});
    });
    await page.goto(base + '/candidatos');
    await page.waitForSelector('[data-candidatos-indicadores]', { timeout: 20000 });
    return { ctx, page, erros, S };
  }

  for (const w of larguras) {
    const { ctx, page, erros, S } = await abrir(w);
    await page.waitForSelector('[data-faixa-vaga-aberta]', { timeout: 10000 }).catch(() => null);
    const faixa = (await page.locator('[data-faixa-vaga-aberta]').innerText().catch(() => '')).replace(/\s+/g, ' ');
    ok(faixa.includes('📣 Vaga aberta: Chapeiro(a).') && faixa.includes('3 pessoas do banco de talentos querem essa função e autorizaram mensagens.'), `${w}: a faixa diz a função e quantos podem ser avisados (${faixa})`);
    await page.click('[data-faixa-vaga-aberta] button:has-text("Avisar o banco de talentos")');
    const gaveta = page.locator('[data-gaveta-avisar]');
    await page.waitForSelector('[data-avisar-pessoa]', { timeout: 10000 }).catch(() => null);
    const t = (await gaveta.innerText()).replace(/\s+/g, ' ');
    ok(
      (await page.locator('[data-avisar-pessoa]').count()) === 3 &&
        t.includes('Quem recebe (3)') &&
        t.includes('Não recebe (2)') &&
        t.includes('não autorizou mensagens na ficha') &&
        t.includes('Olá, Juliana! A Burger da Praça abriu vaga de Chapeiro(a)') &&
        t.includes('autorizou em 10/11') &&
        t.includes('O envio pelo número de marketing da loja chega numa próxima entrega'),
      `${w}: a gaveta com quem recebe, quem não recebe e a mensagem (${t.slice(0, 160)})`,
    );
    const href = await page.locator('[data-avisar-pessoa] a:has-text("Abrir no WhatsApp")').first().getAttribute('href');
    ok(/^https:\/\/wa\.me\/552199990000\?text=Ol%C3%A1%2C%20Juliana/.test(href ?? ''), `${w}: "Abrir no WhatsApp" leva a mensagem pronta`);
    const m = await medir(page);
    ok(m.length === 0, `${w}: com a gaveta aberta, nenhuma barra lateral e nada fora da janela ${m.slice(0, 3).join(' | ')}`);
    const e = await esmagados(page, '[role="dialog"], [data-faixa-vaga-aberta]');
    ok(e.length === 0, `${w}: nenhum texto esmagado ${e.slice(0, 3).join(' | ')}`);
    if ([320, 375, 768, 1920].includes(w)) {
      const linhas = page.locator('[data-avisar-pessoa]');
      for (let i = 0; i < (await linhas.count()); i++) {
        await linhas.nth(i).scrollIntoViewIfNeeded();
        await linhas.nth(i).screenshot({ path: foto(`pessoa-${w}-${i + 1}.png`) });
      }
      await page.screenshot({ path: foto(`gaveta-${w}.png`) });
    }
    if (w === 375) {
      // "Marquei como avisado": manda a pessoa e a função e relê — ela vai para "Não recebe".
      await page.locator('[data-avisar-pessoa]').first().locator('button:has-text("Marquei como avisado")').click();
      await page.waitForSelector('text=Quem recebe (2)', { timeout: 5000 }).catch(() => null);
      ok(JSON.stringify(S.marcados) === JSON.stringify([{ candidatoId: 'p1', funcao: 'chapeiro' }]), `marcar: manda a pessoa e a função (${JSON.stringify(S.marcados)})`);
      const t2 = (await gaveta.innerText()).replace(/\s+/g, ' ');
      ok(t2.includes('Quem recebe (2)') && t2.includes('já foi avisada desta função em 16/11'), 'marcar: a pessoa sai de "Quem recebe" e aparece com o motivo');
      // Trocar a função pede ?funcao= e mostra o vazio dela.
      await page.selectOption('#avisar-funcao', 'atendimento');
      await page.waitForSelector('text=Ninguém para avisar desta função', { timeout: 5000 }).catch(() => null);
      ok(S.pedidas.includes('atendimento') && (await page.locator('text=Ninguém para avisar desta função').isVisible()), `trocar: pede a outra função e mostra o vazio (${S.pedidas.join(',')})`);
    }
    await page.keyboard.press('Escape');
    ok(erros.length === 0, `${w}: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── a leitura da gaveta falha: "Tentar de novo" ──
  {
    const { ctx, page, erros } = await abrir(375, { falhas: 1 });
    await page.waitForSelector('[data-faixa-vaga-aberta]', { timeout: 10000 });
    await page.click('[data-faixa-vaga-aberta] button:has-text("Avisar o banco de talentos")');
    await page.waitForSelector('[data-gaveta-avisar] button:has-text("Tentar de novo")', { timeout: 10000 }).catch(() => null);
    ok(await page.locator('[data-gaveta-avisar] >> text=Não foi possível carregar o banco de talentos').isVisible(), 'falha: a gaveta diz que não leu');
    await page.click('[data-gaveta-avisar] button:has-text("Tentar de novo")');
    await page.waitForSelector('[data-avisar-pessoa]', { timeout: 10000 }).catch(() => null);
    ok((await page.locator('[data-avisar-pessoa]').count()) === 3, 'falha: "Tentar de novo" lê');
    ok(erros.length === 0, `falha: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── ninguém para avisar: a faixa não aparece ──
  {
    const { ctx, page, erros } = await abrir(375, { ninguem: true });
    await page.waitForTimeout(800);
    ok((await page.locator('[data-faixa-vaga-aberta]').count()) === 0, 'ninguém: sem gente para avisar, a faixa não aparece');
    ok(erros.length === 0, `ninguém: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
