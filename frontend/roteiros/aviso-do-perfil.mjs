// Roteiro de tela do AVISO DO PERFIL (ERR-562; regra `PERFIL_SO_COM_AVISO`). Um cardápio de EXEMPLO e a API simulada. Confere,
// em cada largura:
//  • cliente novo: depois do código, o aviso com "Não quero esse resumo" no mesmo tamanho dos outros botões; a recusa manda só
//    a resposta ao servidor;
//  • quem já respondeu às caixas: só o aviso, sem caixa, e "Continuar" não reenvia nenhuma escolha (não desfaz um "sim" antigo);
//  • quem já estava com a conta aberta: o aviso em Sua conta › Privacidade;
//  • regra desligada: a entrada continua como era;
//  • nenhuma barra para o lado, e nenhum erro de script.
import { responder, umaLinha } from './comum.mjs';
import { MENU, TOKEN } from './cardapio-para-voce.mjs';

const TEXTO = 'A loja guarda um resumo dos pedidos que você fez direto com ela, inclusive antes deste cardápio.';
const AVISO = { versao: '2026-11-22', texto: TEXTO, visto: false };
const CT = 'ct-falso-do-roteiro';

const estadoBase = (o = {}) => ({
  ativo: true,
  jaRespondeu: false,
  escolhas: { recomendacoes: true },
  declarado: {},
  textos: { recomendacoes: 'Recomendações do meu jeito.', atendimento_personalizado: 'Lembrar como prefiro.', nao_analisar: 'Não quero ser analisado.' },
  avisoRecomendacoes: 'Recomendações do seu jeito: você desliga quando quiser.',
  versaoDosTextos: '2026-11-20',
  avisoPerfil: AVISO,
  ...o,
});

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.hs')) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    return achados;
  });

export default async function roteiroAvisoDoPerfil({ nav, base, ok, foto, larguras }) {
  async function abrir(w, estado, { identificado = false } = {}) {
    const posts = [];
    let atual = estado;
    const ctx = await nav.newContext({ viewport: { width: w, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    if (identificado) await ctx.addInitScript(([t, ct]) => localStorage.setItem(`regem_loja_clientetoken_${t}`, ct), [TOKEN, CT]);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const u = new URL(route.request().url());
      const p = u.pathname.replace(/^.*\/api\/v1/, '');
      const metodo = route.request().method();
      if (p === `/publico/cardapio/${TOKEN}`) return responder(route, MENU);
      if (p === `/publico/cardapio/${TOKEN}/cliente/otp/enviar`) return responder(route, { enviado: true });
      if (p === `/publico/cardapio/${TOKEN}/cliente/otp/confirmar`) return responder(route, { clienteToken: CT });
      if (p === `/publico/cardapio/${TOKEN}/cliente/privacidade`) {
        if (metodo === 'POST') {
          const corpo = route.request().postDataJSON();
          posts.push(corpo);
          atual = { ...atual, jaRespondeu: true, avisoPerfil: atual.avisoPerfil ? { ...atual.avisoPerfil, visto: true } : null };
        }
        return responder(route, atual);
      }
      if (p === `/publico/cardapio/${TOKEN}/cliente`) return responder(route, { nome: 'Ana Souza', telefone: '21900000000', enderecos: [], promocoes: null });
      if (metodo === 'POST') return responder(route, { ok: true });
      return responder(route, {});
    });
    await page.goto(`${base}/c/${TOKEN}?tema=fluxo`);
    await page.waitForSelector('text=Burgers', { timeout: 30000 });
    await page.getByRole('button', { name: 'Sua conta' }).first().click();
    return { ctx, page, erros, posts };
  }

  async function entrarComCodigo(page) {
    await page.locator('#lp-otp-tel').fill('21900000000');
    await page.getByRole('button', { name: 'Enviar código' }).click();
    await page.locator('#lp-otp-nome').fill('Ana Souza');
    await page.locator('#lp-otp-cod').fill('123456');
    await page.locator('.c-sec .p-btn.c').first().click();
  }

  const conferir = async (page, erros, rotulo) => {
    const achados = await medir(page);
    ok(achados.length === 0, `${rotulo} · sem barra para o lado${achados.length ? ` (${umaLinha(achados.join(' | '))})` : ''}`);
    ok(erros.length === 0, `${rotulo} · nenhum erro de script${erros.length ? ` (${umaLinha(erros.join(' | '))})` : ''}`);
  };

  for (const w of larguras) {
    // Cliente novo: o aviso, as caixas e a recusa.
    {
      const { ctx, page, erros, posts } = await abrir(w, estadoBase());
      try {
        await entrarComCodigo(page);
        const recusar = page.getByRole('button', { name: 'Não quero esse resumo' });
        await recusar.waitFor({ timeout: 15000 });
        const t = await page.locator('.c-sec').first().innerText();
        ok(t.includes(TEXTO) && t.includes('Como a loja usa seus dados'), `novo ${w}px · o aviso aparece`);
        const caixas = await page.getByRole('button', { name: /Continuar sem marcar|Aceitar e continuar|Não quero esse resumo/ }).evaluateAll((els) =>
          els.map((e) => Math.round(e.getBoundingClientRect().width)),
        );
        ok(caixas.length === 3 && new Set(caixas).size === 1, `novo ${w}px · os três botões com o mesmo destaque (${caixas.join(', ')})`);
        await conferir(page, erros, `novo ${w}px`);
        if (w === 390) await page.screenshot({ path: foto(`aviso-perfil-novo-${w}.png`), fullPage: true });
        await recusar.click();
        await page.waitForFunction(() => !document.body.innerText.includes('Não quero esse resumo'), null, { timeout: 15000 });
        ok(posts.length === 1 && posts[0].avisoPerfil === 'recusou' && !posts[0].escolhas, `novo ${w}px · a recusa manda só a resposta`);
      } catch (e) {
        ok(false, `novo ${w}px · a tela abriu (${umaLinha(String(e?.message ?? e))})`);
        await page.screenshot({ path: foto(`aviso-perfil-novo-${w}-erro.png`) }).catch(() => {});
      } finally {
        await ctx.close();
      }
    }
    // Quem já respondeu às caixas: só o aviso.
    {
      const { ctx, page, erros, posts } = await abrir(w, estadoBase({ jaRespondeu: true, escolhas: { recomendacoes: true, atendimento_personalizado: true } }));
      try {
        await entrarComCodigo(page);
        const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
        await continuar.waitFor({ timeout: 15000 });
        ok((await page.getByRole('button', { name: /Aceitar|sem marcar/ }).count()) === 0, `já respondeu ${w}px · sem as caixas`);
        await conferir(page, erros, `já respondeu ${w}px`);
        await continuar.click();
        await page.waitForFunction(() => !document.body.innerText.includes('Não quero esse resumo'), null, { timeout: 15000 });
        ok(posts.length === 1 && posts[0].avisoPerfil === 'continuou' && !posts[0].escolhas, `já respondeu ${w}px · "Continuar" não reenvia as escolhas`);
      } catch (e) {
        ok(false, `já respondeu ${w}px · a tela abriu (${umaLinha(String(e?.message ?? e))})`);
      } finally {
        await ctx.close();
      }
    }
    // Quem já estava com a conta aberta: o aviso em Privacidade.
    {
      const { ctx, page, erros, posts } = await abrir(w, estadoBase({ jaRespondeu: true }), { identificado: true });
      try {
        await page.getByRole('button', { name: 'Perfil', exact: true }).click();
        const continuar = page.getByRole('button', { name: 'Continuar', exact: true });
        await continuar.waitFor({ timeout: 15000 });
        await continuar.scrollIntoViewIfNeeded();
        await conferir(page, erros, `conta aberta ${w}px`);
        // O defeito visto no celular em 22/11: os botões colados um no outro e no texto.
        const medida = await page.locator('.ac-aviso').evaluate((bloco) => {
          const botoes = [...bloco.querySelectorAll('button')];
          const [a, b] = botoes.map((x) => x.getBoundingClientRect());
          const [ea, eb] = botoes.map((x) => getComputedStyle(x));
          const texto = bloco.querySelector('.c-note').getBoundingClientRect();
          return {
            qtd: botoes.length,
            entreBotoes: Math.round(Math.max(b.top - a.bottom, b.left - a.right)),
            doTexto: Math.round(a.top - texto.bottom),
            mesmoTamanho: Math.round(a.width) === Math.round(b.width) && Math.round(a.height) === Math.round(b.height),
            mesmoDesenho: ea.backgroundColor === eb.backgroundColor && ea.color === eb.color && ea.boxShadow === eb.boxShadow && ea.fontWeight === eb.fontWeight,
          };
        });
        ok(medida.qtd === 2 && medida.entreBotoes >= 8 && medida.doTexto >= 8, `conta aberta ${w}px · botões separados (entre eles ${medida.entreBotoes}px, do texto ${medida.doTexto}px)`);
        ok(medida.mesmoTamanho && medida.mesmoDesenho, `conta aberta ${w}px · os dois botões com o mesmo destaque`);
        if (w === 390) await page.locator('.ac-aviso').screenshot({ path: foto(`aviso-perfil-conta-${w}.png`) });
        await continuar.click();
        await page.waitForFunction(() => !document.body.innerText.includes('Não quero esse resumo'), null, { timeout: 15000 });
        ok(posts.length === 1 && posts[0].avisoPerfil === 'continuou' && posts[0].origem === 'cardapio_perfil', `conta aberta ${w}px · a resposta sai pelo Perfil`);
      } catch (e) {
        ok(false, `conta aberta ${w}px · a tela abriu (${umaLinha(String(e?.message ?? e))})`);
      } finally {
        await ctx.close();
      }
    }
  }

  // Regra desligada: a entrada continua como era.
  const { ctx, page, posts } = await abrir(390, estadoBase({ avisoPerfil: null }));
  try {
    await entrarComCodigo(page);
    const seguir = page.getByRole('button', { name: 'Continuar sem marcar' });
    await seguir.waitFor({ timeout: 15000 });
    ok((await page.getByRole('button', { name: 'Não quero esse resumo' }).count()) === 0 && !(await page.locator('body').innerText()).includes('Como a loja usa seus dados'), 'regra desligada · sem o aviso novo');
    await seguir.click();
    await page.waitForFunction(() => !document.body.innerText.includes('Continuar sem marcar'), null, { timeout: 15000 });
    ok(posts.length === 1 && posts[0].avisoPerfil === undefined, 'regra desligada · nada de resposta ao aviso');
  } catch (e) {
    ok(false, `regra desligada · a tela abriu (${umaLinha(String(e?.message ?? e))})`);
  } finally {
    await ctx.close();
  }
}
