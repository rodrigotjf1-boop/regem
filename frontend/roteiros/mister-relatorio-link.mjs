// Roteiro de tela da M3c do Mister — a página do LINK PARA ENCAMINHAR (`/m/r/<código>`; mig 443; versão 3 do protótipo
// `mockups/regem-mister.html`, aba "Arquivos e links" › "A página do link" e a decisão 7: para quem não tem usuário, só
// leitura, 7 dias). A API simulada.
//  • O relatório (com venda, por hora e por dia; sem venda) em cada largura: o texto, o aviso "Só leitura · vale até",
//    nenhuma barra lateral, nada fora da janela, nenhum texto esmagado, o botão com altura de toque; foto.
//  • Só leitura: nenhum campo, nenhum "Mudar o período"; "Baixar PDF" baixa o arquivo com o nome que o servidor deu.
//  • O link que não vale (e o que deixa de valer com a página aberta, ao baixar o PDF), a leitura que falha com "Tentar
//    de novo" e o limite por minuto com a frase (nunca o erro cru).
//  • Isolada: só as rotas do link, nada guardado no aparelho, o endereço não vai a outro site (`referrer`), fora da busca.
import { responder } from './comum.mjs';
import { esmagados } from './candidatos-conducao.mjs';

const CODIGO = 'Rb3dEfGh1jKlMn0pQrStUvWxYz-_12_r';
const EMPRESA = 'Empório Sabor da Serra Comércio de Alimentos e Bebidas Artesanais Ltda';
const NOME_DO_PDF = 'carne-56-g-2026-11-18.pdf';

const porHora = () => {
  const vendas = { 11: 6, 12: 21, 13: 17, 14: 4, 18: 9, 19: 31, 20: 44, 21: 38, 22: 12 };
  return Array.from({ length: 12 }, (_, i) => i + 11).map((h) => ({ rotulo: `${h}h`, valor: vendas[h] ?? 0, texto: String(vendas[h] ?? 0) }));
};
const porDia = () => Array.from({ length: 30 }, (_, i) => ({ rotulo: `${String(((i + 19) % 30) + 1).padStart(2, '0')}/${i < 12 ? '10' : '11'}`, valor: 120 + ((i * 37) % 95), texto: String(120 + ((i * 37) % 95)) }));

const vista = (como = 'hora') => ({
  empresa: EMPRESA,
  nomeDoPdf: NOME_DO_PDF,
  comVenda: como !== 'vazio',
  valeAte: '2026-11-25T21:40:00.000Z',
  valeAteDia: '25/11',
  plano: {
    cabecalho: `${EMPRESA} · Loja Centro`,
    gerado: 'Gerado em 18/11 às 21:40, a pedido de Ana Souza',
    titulo: como === 'dia' ? 'Carne 56 g · 20/10 a 18/11 contra 20/09 a 19/10' : 'Carne 56 g · hoje (18/11), até 21:40',
    numeros:
      como === 'vazio'
        ? [{ valor: '0 unidades', rotulo: 'Loja Centro' }]
        : [
            { valor: como === 'dia' ? '4.812 unidades' : '182 unidades', rotulo: 'Loja Centro' },
            { valor: como === 'dia' ? '269,5 kg' : '10,2 kg', rotulo: 'pela conversão do cadastro (56 g por unidade)' },
            { valor: '+18%', rotulo: como === 'dia' ? 'contra 20/09 a 19/10 (4.078 unidades)' : 'contra a média das últimas 4 quartas até 21:40 (154 unidades)' },
          ],
    grafico: {
      titulo: como === 'dia' ? 'Por dia' : 'Por hora',
      barras: como === 'vazio' ? [] : como === 'dia' ? porDia() : porHora(),
      linha: como === 'vazio' ? null : { valor: 154, texto: 'Média das últimas 4 quartas até esta hora: 154 unidades' },
      nota: como === 'hora' ? 'O dia ainda não terminou: os números vão até 21:40.' : null,
    },
    deOnde:
      como === 'vazio'
        ? []
        : [
            { produto: 'X-Burger Clássico da Casa com Queijo Prato', detalhe: '96 vendidos · 1 por unidade', valor: '96 unidades' },
            { produto: 'Combo Duplo Especial com Batata Rústica e Refrigerante 600 ml', detalhe: '31 vendidos · 2 por unidade', valor: '62 unidades' },
            { produto: 'X-Burger · Grande', detalhe: '10 vendidos · 2 por unidade', valor: '20 unidades' },
          ],
    outros: como === 'vazio' ? null : 'Outros (adicionais e o que a ficha não explica): 4 unidades.',
    fonte: 'Fonte: a baixa do estoque de cada venda fechada no período, menos o que voltou no estorno. A ficha técnica de cada produto diz de onde saiu.',
  },
});

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

/** Os rótulos das colunas do gráfico: um não encosta no outro e nenhum é cortado pela borda da linha (o texto medido). */
const rotulosEncavalados = (page) =>
  page.evaluate(() => {
    const achados = [];
    for (const linha of document.querySelectorAll('[role="img"] + div[aria-hidden="true"]')) {
      const caixa = linha.getBoundingClientRect();
      let fim = -Infinity;
      let escritos = 0;
      for (const s of linha.querySelectorAll('span')) {
        if (!s.textContent) continue;
        escritos++;
        const faixa = document.createRange();
        faixa.selectNodeContents(s);
        const b = faixa.getBoundingClientRect();
        if (b.left < fim + 1) achados.push(`"${s.textContent}" começa em ${Math.round(b.left)}, antes do fim do anterior (${Math.round(fim)})`);
        if (b.right > caixa.right + 1) achados.push(`"${s.textContent}" passa da linha (${Math.round(b.right)}>${Math.round(caixa.right)})`);
        fim = b.right;
      }
      if (escritos < 2) achados.push(`só ${escritos} rótulo escrito`);
    }
    return achados;
  });

export default async function roteiroMisterRelatorioLink({ nav, base, ok, foto, larguras }) {
  /** Abre a página com o "servidor" simulado. `falhas` = leituras que respondem 503 antes; `pdf` = o que o PDF responde. */
  async function abrir(w, { como = 'hora', falhas = 0, ver = 200, pdf = 200 } = {}) {
    const ctx = await nav.newContext({ viewport: { width: w, height: w < 700 ? 820 : 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900, acceptDownloads: true });
    const page = await ctx.newPage();
    const erros = [];
    const outros = [];
    const chamadas = { ver: 0, pdf: 0, metodos: new Set() };
    let falhar = falhas;
    const pdfResponde = { status: pdf };
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
      const raiz = `/publico/mister/relatorio/${CODIGO}`;
      chamadas.metodos.add(route.request().method());
      if (p === raiz) {
        chamadas.ver++;
        if (ver === 404) return responder(route, { message: 'Este link não vale mais. Peça outro a quem mandou.' }, 404);
        if (ver === 429) return responder(route, { message: 'ThrottlerException: Too Many Requests' }, 429);
        if (falhar > 0) {
          falhar--;
          return responder(route, { message: 'O servidor demorou para responder.' }, 503);
        }
        return responder(route, vista(como));
      }
      if (p === `${raiz}/pdf`) {
        chamadas.pdf++;
        if (pdfResponde.status === 404) return responder(route, { message: 'Este link não vale mais. Peça outro a quem mandou.' }, 404);
        if (pdfResponde.status === 429) return responder(route, { message: 'ThrottlerException: Too Many Requests' }, 429);
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4\n% relatório de exemplo do roteiro\n%%EOF\n', 'latin1') });
      }
      outros.push(p);
      return responder(route, {});
    });
    await page.goto(`${base}/m/r/${CODIGO}`);
    await page.waitForSelector('[data-relatorio-do-mister]:not([data-estado="carregando"])', { timeout: 20000 });
    return { ctx, page, erros, outros, chamadas, pdfResponde };
  }
  const textoDe = async (page) => (await page.locator('[data-relatorio-do-mister]').innerText()).replace(/\s+/g, ' ');
  const RODAPE = 'Esta página é só deste relatório. Nada fica guardado neste aparelho.';

  // ── o relatório em cada largura: por hora (todas), por dia e sem venda (algumas) ──
  for (const como of ['hora', 'dia', 'vazio']) {
    // "dia" (30 colunas com rótulo comprido) também em todas as larguras: é onde os rótulos se encostavam.
    for (const w of como === 'vazio' ? larguras.filter((x) => [320, 375, 768, 1280].includes(x)) : larguras) {
      const { ctx, page, erros, outros, chamadas } = await abrir(w, { como });
      const t = await textoDe(page);
      const v = vista(como);
      ok(t.includes(v.plano.titulo) && t.includes(v.plano.gerado), `${como} ${w}: o título e quem pediu (${t.slice(0, 120)})`);
      ok(/Só leitura · vale até 25\/11\. Mostra o relatório como estava quando foi pedido: ele não atualiza\./.test(t), `${como} ${w}: o aviso de só leitura com a data`);
      ok(v.plano.numeros.every((n) => t.includes(n.valor) && t.includes(n.rotulo)), `${como} ${w}: os números do relatório`);
      if (como === 'vazio') {
        ok(t.includes('Nenhuma venda deste insumo no período.') && !t.includes('De onde saiu'), `vazio ${w}: diz que não houve venda, sem o gráfico nem o "De onde saiu"`);
      } else {
        ok(t.includes('De onde saiu') && v.plano.deOnde.every((d) => t.includes(d.produto) && t.includes(d.valor)) && t.includes(v.plano.outros), `${como} ${w}: "De onde saiu" com cada produto e os outros`);
        ok((await page.locator('[role="img"]').count()) === 1 && t.includes(v.plano.grafico.linha.texto), `${como} ${w}: o gráfico com a linha da média escrita`);
        const r = await rotulosEncavalados(page);
        ok(r.length === 0, `${como} ${w}: os rótulos do gráfico não se encostam nem são cortados ${r.slice(0, 3).join(' | ')}`);
      }
      ok(t.includes(v.plano.fonte) && t.includes(RODAPE), `${como} ${w}: a fonte e o rodapé`);
      ok((await page.locator('header').innerText()).includes(EMPRESA), `${como} ${w}: o topo com o nome da empresa (mesmo comprido)`);
      // Só leitura: nenhum campo, nenhuma troca de período; um botão só (o do PDF).
      ok((await page.locator('main input, main select, main textarea, main form').count()) === 0 && !/Mudar o período/.test(t), `${como} ${w}: só leitura (nenhum campo, sem "Mudar o período")`);
      ok((await page.locator('main button').allInnerTexts()).join('|') === 'Baixar PDF', `${como} ${w}: o único botão é "Baixar PDF"`);
      ok((await page.locator('h1').count()) === 1, `${como} ${w}: um título principal só`);
      const m = await medir(page);
      ok(m.length === 0, `${como} ${w}: nenhuma barra lateral, nada fora da janela, botão de toque ${m.slice(0, 3).join(' | ')}`);
      const e = await esmagados(page, '[data-relatorio-do-mister]');
      ok(e.length === 0, `${como} ${w}: nenhum texto esmagado ${e.slice(0, 3).join(' | ')}`);
      if ([320, 375, 768, 1920].includes(w)) await page.locator('[data-relatorio-do-mister]').screenshot({ path: foto(`${como}-${w}.png`) });
      ok(outros.length === 0 && [...chamadas.metodos].join(',') === 'GET', `${como} ${w}: a página só LÊ, e só as rotas do link (${outros.join(', ')} ${[...chamadas.metodos].join(',')})`);
      ok(erros.length === 0, `${como} ${w}: sem erro (${erros.join(' | ')})`);
      await ctx.close();
    }
  }

  // ── "Baixar PDF": o arquivo com o nome do servidor; nada guardado; fora da busca; o endereço não vai a outro site ──
  {
    const { ctx, page, erros, chamadas } = await abrir(375);
    const [baixado] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('button:has-text("Baixar PDF")')]);
    ok(baixado.suggestedFilename() === NOME_DO_PDF, `PDF: baixa com o nome do servidor (${baixado.suggestedFilename()})`);
    ok(chamadas.pdf === 1, `PDF: pediu uma vez (${chamadas.pdf})`);
    await page.waitForSelector('button:has-text("Baixar PDF"):not([disabled])', { timeout: 10000 });
    const guardado = await page.evaluate(() => ({ local: localStorage.length, sessao: sessionStorage.length }));
    ok(guardado.local === 0 && guardado.sessao === 0 && (await ctx.cookies()).length === 0, `nada guardado no aparelho (${JSON.stringify(guardado)})`);
    ok((await page.locator('meta[name="referrer"]').getAttribute('content')) === 'no-referrer', 'o endereço com o código não vai a outro site (referrer)');
    ok(/noindex/.test((await page.locator('meta[name="robots"]').getAttribute('content')) ?? ''), 'fora da busca');
    ok((await page.locator('main a[href]').count()) === 0, 'nenhum link para fora na página');
    ok(erros.length === 0, `PDF: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  // O limite por minuto no PDF: a frase, e o relatório continua na tela. Depois o link deixa de valer: a página diz.
  {
    const { ctx, page, erros, pdfResponde } = await abrir(360, { pdf: 429 });
    await page.click('button:has-text("Baixar PDF")');
    await page.waitForSelector('main [role="alert"]:has-text("Muitas aberturas agora. Espere um minuto e tente de novo.")', { timeout: 10000 });
    const t = await textoDe(page);
    ok(!/Throttler|Too Many/.test(t) && t.includes('De onde saiu'), 'PDF no limite: a frase (nunca o erro cru), e o relatório continua na tela');
    ok((await medir(page)).length === 0, 'PDF no limite: sem barra lateral em 360');
    pdfResponde.status = 404;
    await page.click('button:has-text("Baixar PDF")');
    await page.waitForSelector('[data-relatorio-do-mister][data-estado="naoVale"]', { timeout: 10000 });
    ok(!(await textoDe(page)).includes('De onde saiu'), 'o link deixou de valer com a página aberta: o relatório sai da tela');
    ok(erros.length === 0, `PDF no limite: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── o link que não vale, o limite por minuto na abertura e a leitura que falha ──
  for (const w of [320, 768]) {
    const { ctx, page, erros } = await abrir(w, { ver: 404 });
    const t = await textoDe(page);
    ok(/Este link não vale mais O link de um relatório vale por 7 dias e pode ser cancelado por quem mandou\. Se ainda precisar do relatório, peça outro link a quem mandou este\./.test(t), `não vale ${w}: a frase (${t.slice(0, 140)})`);
    ok((await page.locator('main button').count()) === 0 && t.includes(RODAPE), `não vale ${w}: nenhum botão, e o rodapé`);
    ok((await medir(page)).length === 0, `não vale ${w}: sem barra lateral`);
    await page.locator('[data-relatorio-do-mister]').screenshot({ path: foto(`nao-vale-${w}.png`) });
    ok(erros.length === 0, `não vale ${w}: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, erros } = await abrir(375, { ver: 429 });
    const t = await textoDe(page);
    ok(/Não consegui abrir o relatório Muitas aberturas agora\. Espere um minuto e tente de novo\./.test(t) && !/Throttler|Too Many/.test(t), `limite na abertura: a frase, nunca o erro cru (${t.slice(0, 140)})`);
    ok(erros.length === 0, `limite na abertura: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, erros, chamadas } = await abrir(320, { falhas: 1 });
    ok(/Não consegui abrir o relatório O servidor demorou para responder\. Tentar de novo/.test(await textoDe(page)), 'falha: diz que não abriu, com "Tentar de novo"');
    ok((await medir(page)).length === 0, 'falha: sem barra lateral em 320');
    await page.locator('[data-relatorio-do-mister]').screenshot({ path: foto('falha-320.png') });
    await page.click('button:has-text("Tentar de novo")');
    await page.waitForSelector('[data-relatorio-do-mister][data-estado="ok"]', { timeout: 10000 });
    ok(chamadas.ver === 2 && (await textoDe(page)).includes('De onde saiu'), `falha: "Tentar de novo" lê de novo e abre o relatório (${chamadas.ver})`);
    ok(erros.length === 0, `falha: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
