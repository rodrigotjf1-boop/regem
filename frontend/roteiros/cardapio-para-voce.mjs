// Roteiro de tela do CARDÁPIO PARA O CLIENTE IDENTIFICADO (F8 do `docs/plano-perfil-cliente.md`; protótipo, aba "No
// cardápio"). Um cardápio de EXEMPLO (loja de demonstração, nada de loja real), a API simulada. Confere, nos 4 modelos
// (`?tema=`) e em cada largura:
//  • com o cliente identificado: "Olá, Ana · seu de sempre" e "Você viu" no topo, a aba curta "Seu de sempre", as
//    categorias na ordem do que ela mais abre (Sobremesas, Burgers e depois a ordem da loja) e o pedido ao servidor com a
//    prova (`ct`); nenhuma barra da página para o lado (as fileiras que deslizam de propósito, `.hs`, ficam de fora — V45);
//  • sem o cliente: nada disso, a ordem da loja e nenhuma chamada ao "para você".
import { responder, umaLinha } from './comum.mjs';

const TOKEN = 'loja-demo-f8';
const foto = null;
const prod = (id, nome, categoriaId, preco) => ({
  id, nome, descricao: `${nome} da casa, feito na hora.`, precoVenda: preco, precoDe: null, categoriaId, imagemRef: foto,
  selos: [], alergenos: null, duracaoMin: null, destaque: false, atacado: [], esgotado: false, variacoes: [], grupos: [],
});
const MENU = {
  loja: {
    nome: 'Loja de demonstração', fraseDeCautela: null, ramo: 'food', tema: 'claro', menuTheme: 'fluxo', temaConfig: {},
    logoEmoji: '🍔', subtitulo: 'Hambúrgueres', aberto: true, emiteNota: false, medeAnuncios: {}, promocoes: {},
    interesse: true, tempoEntregaMin: 35, tempoRetiradaMin: 15, pedidoMinimo: 0, agendado: { ativo: false }, encomenda: {},
    avaliacao: null, freteGratisAcima: 0, areaModo: 'bairro', raios: [], lojaLat: null, lojaLng: null, pagamentos: ['pix'],
    formasCartao: [], fidelidadeAtiva: false, whatsapp: '', parcelasMax: null, logoRef: null, instagram: '', site: '',
    documento: '', responsavelNome: '', contatoLoja: '', endereco: { cidade: 'Cidade' },
  },
  abertaAgora: true, abertoPorTipo: { entrega: true, retirada: true }, horarioLabel: 'Aberto até 23h', proximaAbertura: null,
  pausa: null, evento: null, horarios: [], tipos: { entrega: true, retirada: true }, cheguei: false, robo: {}, modo: 'normal',
  bairros: [], areas: [], banners: [],
  categorias: [
    { id: 'cat-b', nome: 'Burgers', descricao: null, imagemRef: null },
    { id: 'cat-p', nome: 'Porções', descricao: null, imagemRef: null },
    { id: 'cat-s', nome: 'Sobremesas', descricao: null, imagemRef: null },
  ],
  produtos: [
    prod('11111111-1111-4111-8111-111111111111', 'X-Bacon da casa com cheddar cremoso', 'cat-b', 32.9),
    prod('22222222-2222-4222-8222-222222222222', 'Costela BBQ', 'cat-b', 49.9),
    prod('33333333-3333-4333-8333-333333333333', 'Batata rústica', 'cat-p', 24.9),
    prod('44444444-4444-4444-8444-444444444444', 'Pudim de leite', 'cat-s', 14.9),
  ],
};
const PARA_VOCE = {
  deSempre: '11111111-1111-4111-8111-111111111111',
  voceViu: ['22222222-2222-4222-8222-222222222222'],
  ordemCategorias: ['cat-s', 'cat-b'],
};

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.hs')) continue; // as fileiras que deslizam de propósito (abas, carrosséis)
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    return achados;
  });
// Os títulos das seções na ordem em que aparecem.
const titulos = (page) =>
  page.evaluate(() => [...document.querySelectorAll('section[data-sec] h2')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()));

export default async function roteiroCardapioParaVoce({ nav, base, ok, foto: arquivoFoto, larguras }) {
  async function abrir(w, tema, { identificado = true } = {}) {
    const consultas = [];
    const ctx = await nav.newContext({ viewport: { width: w, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    if (identificado) await ctx.addInitScript((t) => localStorage.setItem(`regem_loja_clientetoken_${t}`, 'ct-falso-do-roteiro'), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname.replace(/^.*\/api\/v1/, '');
      consultas.push(p + u.search);
      if (p === `/publico/cardapio/${TOKEN}`) return responder(route, MENU);
      if (p === `/publico/cardapio/${TOKEN}/para-voce`) return responder(route, PARA_VOCE);
      if (p === `/publico/cardapio/${TOKEN}/cliente`) return responder(route, { nome: 'Ana Souza', telefone: '21900000000', enderecos: [] });
      if (route.request().method() === 'POST') return responder(route, { ok: true });
      return responder(route, {});
    });
    await page.goto(`${base}/c/${TOKEN}?tema=${tema}`);
    return { ctx, page, erros, consultas };
  }

  for (const tema of ['fluxo', 'galeria', 'balcao', 'oferta']) {
    for (const w of larguras) {
      const { ctx, page, erros, consultas } = await abrir(w, tema);
      try {
        await page.waitForSelector('text=Você viu', { timeout: 30000 });
        const t = await titulos(page);
        const iSempre = t.findIndex((x) => x.includes('Olá, Ana · seu de sempre'));
        const iViu = t.findIndex((x) => x.includes('Você viu'));
        const iS = t.findIndex((x) => x.includes('Sobremesas'));
        const iB = t.findIndex((x) => x.includes('Burgers'));
        const iP = t.findIndex((x) => x.includes('Porções'));
        ok(iSempre === 0 && iViu === 1, `${tema} ${w}px · "seu de sempre" e "Você viu" no topo (${umaLinha(t.join(' | '), 120)})`);
        ok(iS > iViu && iS < iB && iB < iP, `${tema} ${w}px · as categorias pelo que ela abre: Sobremesas, Burgers, Porções`);
        const abas = await page.evaluate(() => [...document.querySelectorAll('.hs button')].map((b) => b.textContent.replace(/\s+/g, ' ').trim()));
        ok(abas.some((a) => a.endsWith('Seu de sempre')) && !abas.some((a) => a.includes('Olá, Ana')), `${tema} ${w}px · a aba curta "Seu de sempre"`);
        ok(consultas.some((c) => c.startsWith(`/publico/cardapio/${TOKEN}/para-voce?ct=ct-falso-do-roteiro`)), `${tema} ${w}px · o pedido leva a prova (ct)`);
        if (tema !== 'galeria') {
          // No topo, a aba ativa é a primeira seção — mesmo com o "para você" chegando depois do cardápio.
          await page.waitForTimeout(300);
          const ativa = await page.evaluate(() => document.querySelector('[data-tab].on')?.textContent?.trim() ?? '');
          ok(ativa === 'Seu de sempre', `${tema} ${w}px · no topo, a aba ativa é "Seu de sempre" (está "${ativa}")`);
        }
        const achados = await medir(page);
        ok(achados.length === 0, `${tema} ${w}px · sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
        if (w === 390) await page.screenshot({ path: arquivoFoto(`cardapio-para-voce-${tema}-${w}.png`) });
        ok(erros.length === 0, `${tema} ${w}px · nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
      } catch (e) {
        ok(false, `${tema} ${w}px · a tela abriu (${umaLinha(String(e?.message ?? e))})`);
        await page.screenshot({ path: arquivoFoto(`cardapio-para-voce-${tema}-${w}-erro.png`) }).catch(() => {});
      } finally {
        await ctx.close();
      }
    }
  }

  // Sem o cliente: nada "para você", a ordem da loja, e nenhuma chamada ao "para você".
  for (const tema of ['fluxo', 'galeria']) {
    const { ctx, page, consultas } = await abrir(390, tema, { identificado: false });
    try {
      await page.waitForSelector('text=Sobremesas', { timeout: 30000 });
      await page.waitForTimeout(500);
      const t = await titulos(page);
      ok(
        !t.some((x) => x.includes('seu de sempre') || x.includes('Você viu')) &&
          t.findIndex((x) => x.includes('Burgers')) < t.findIndex((x) => x.includes('Sobremesas')) &&
          !consultas.some((c) => c.includes('/para-voce')),
        `${tema} sem cliente · sem as seções, a ordem da loja e sem chamar o "para você"`,
      );
    } finally {
      await ctx.close();
    }
  }
}
