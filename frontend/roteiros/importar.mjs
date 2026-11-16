// Roteiro de tela do IMPORTAR PRODUTOS (Estoque › Produtos › Importar, `components/estoque/importar-produtos.tsx`). A API
// simulada; a planilha é um CSV pequeno e a prévia vem pronta do "servidor".
// Confere, em cada largura, os passos 2 (unidades) e 3 (conferência) com o diálogo aberto: nenhuma barra lateral, nada
// fora da janela; a conferência em colunas quando cabe e empilhada (as outras colunas descem para a célula do produto)
// quando não cabe — pelo ESPAÇO do diálogo, não pela largura da tela (V45): entre 640 e ~704 px a tabela de 640 px rolava
// dentro do diálogo de 576 px.
import { responder, tokenFalso } from './comum.mjs';

const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: { estoque: { ver: true, criar: true, editar: true } } });

const ITENS = [{ id: 'i1', nome: 'Farinha de trigo', unidade: 'kg', saldo: 12, estoqueMinimo: 5, categoria: 'Secos', ativo: true }];
const linha = (n, nome, situacao, extra = {}) => ({
  linha: n,
  nome,
  nomeFormatado: nome,
  unidadeArquivo: 'UN',
  unidade: 'un',
  categoria: 'Bebidas e refrigerantes',
  estoqueMinimo: null,
  custo: null,
  quantidade: null,
  situacao,
  existente: null,
  ...extra,
});
const PREVIA = {
  arquivo: 'estoque-da-loja.csv',
  formato: 'generico',
  colunas: { nome: 'Produto', comercial: 'Nome comercial', marcas: 'Marcas', unidade: 'Unidade', categoria: 'Categoria', minimo: null, custo: null, quantidade: null },
  linhas: [
    linha(2, 'Refrigerante de cola lata 350 ml', 'novo', { nomeComercial: 'REFRI COLA LT 350ML CX C/12', marcas: ['Coca-Cola', 'Pepsi'] }),
    linha(3, 'Água mineral sem gás 500 ml', 'novo'),
    linha(4, 'Farinha de trigo tipo 1', 'parecido', { unidadeArquivo: 'KG', unidade: 'kg', categoria: 'Secos', existente: { id: 'i1', nome: 'Farinha de trigo' } }),
    linha(5, 'Farinha de trigo', 'igual', { unidadeArquivo: 'KG', unidade: 'kg', categoria: 'Secos', existente: { id: 'i1', nome: 'Farinha de trigo' } }),
    linha(6, 'Água mineral sem gás 500 ml', 'repetido'),
    linha(7, 'Pão de hambúrguer brioche com gergelim', 'novo', { unidadeArquivo: 'PCT', unidade: 'pct', categoria: 'Padaria' }),
  ],
  unidades: [
    { noArquivo: 'UN', sugestao: 'un', produtos: 3 },
    { noArquivo: 'KG', sugestao: 'kg', produtos: 2 },
    { noArquivo: 'PCT', sugestao: 'pct', produtos: 1 },
  ],
  categoriasNovas: ['Bebidas e refrigerantes', 'Padaria'],
  resumo: { total: 6, novos: 3, parecidos: 1, iguais: 1, repetidos: 1, semNome: 0 },
};

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        // A faixa de abas do Estoque desliza sem barra à mostra abaixo de 640 px (o desenho do `Partes` e a regra do dono de
        // 07/10/2026, como no roteiro das listas largas): vale, desde que a barra dela fique escondida de verdade.
        if (el.classList.contains('faixa-abas') && window.innerWidth < 640 && el.offsetHeight === el.clientHeight + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)) continue;
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      }
    }
    for (const el of document.querySelectorAll('[role="dialog"] button, [role="dialog"] input, [role="dialog"] select, [role="dialog"] h2, [role="dialog"] h3')) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 1 && (r.right > window.innerWidth + 1 || r.left < -1))
        achados.push(`passa ${el.tagName.toLowerCase()} "${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 24)}" ${Math.round(r.left)}..${Math.round(r.right)} de ${window.innerWidth}`);
    }
    return achados;
  });

export default async function roteiroImportar({ nav, base, ok, foto, larguras }) {
  async function abrir(w) {
    const ctx = await nav.newContext({ viewport: { width: w, height: w < 700 ? 820 : 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const p = new URL(route.request().url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/estoque/itens/importar/previa') return responder(route, PREVIA);
      if (p === '/estoque/itens') return responder(route, ITENS);
      if (p === '/estoque/unidades-medida') return responder(route, { unidades: ['un', 'kg', 'g', 'l', 'ml', 'pct', 'cx'] });
      if (p === '/estoque/categorias-item' || p === '/fornecedores' || p === '/setores') return responder(route, []);
      return responder(route, {});
    });
    await page.goto(base + '/operacao?aba=produtos');
    await page.waitForSelector('text=Farinha de trigo', { timeout: 20000 });
    return { ctx, page, erros };
  }

  async function ateOPasso2(page) {
    await page.locator('main button:has-text("Importar")').first().click();
    await page.waitForSelector('#imp-arquivo', { timeout: 10000 });
    await page.setInputFiles('#imp-arquivo', { name: 'estoque-da-loja.csv', mimeType: 'text/csv', buffer: Buffer.from('Produto;Unidade\nAgua;UN\n') });
    await page.waitForSelector('text=Unidades do arquivo', { timeout: 10000 });
    await page.waitForTimeout(150);
  }

  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w);
    await ateOPasso2(page);
    let m = await medir(page);
    ok(m.length === 0, `${w}: passo 2 (unidades) sem barra lateral e nada fora da janela ${m.slice(0, 3).join(' | ')}`);

    await page.click('[role="dialog"] button:has-text("Conferir")');
    await page.waitForSelector('[role="dialog"] >> text=Pão de hambúrguer brioche com gergelim', { timeout: 10000 });
    await page.waitForTimeout(200);
    m = await medir(page);
    ok(m.length === 0, `${w}: passo 3 (conferência) sem barra lateral e nada fora da janela ${m.slice(0, 3).join(' | ')}`);

    // Colunas ou empilhada: a coluna "Situação" visível OU a situação de cada produto dentro da célula dele — nunca as
    // duas, nunca nenhuma.
    const estado = await page.evaluate(() => {
      const caixa = document.querySelector('[role="dialog"] table');
      const visivel = (el) => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';
      const thSituacao = [...(caixa?.querySelectorAll('th') ?? [])].find((th) => th.textContent.trim() === 'Situação');
      const selos = [...(caixa?.querySelectorAll('tbody tr') ?? [])].map((tr) =>
        // Só o SELO (a pílula); a caixa que o envolve na forma empilhada tem o mesmo texto.
        [...tr.querySelectorAll('span.rounded-full')].filter((s) => /^(Novo|Parecido|Já existe|Repetido)/.test(s.textContent.trim()) && visivel(s)).length,
      );
      return { colunas: visivel(thSituacao), selos };
    });
    ok(estado.selos.length === 6 && estado.selos.every((n) => n === 1), `${w}: cada produto mostra a situação uma vez (${estado.selos.join(',')})`);
    if (w >= 1024) ok(estado.colunas, `${w}: com espaço, a conferência é em colunas`);
    if (w <= 414) ok(!estado.colunas, `${w}: no celular, a conferência é empilhada`);

    // Marcar um produto continua funcionando na forma em que a lista estiver.
    const caixa = page.locator('[role="dialog"] input[aria-label="Importar Água mineral sem gás 500 ml"]').first();
    const antes = await caixa.isChecked();
    await caixa.click();
    ok((await caixa.isChecked()) === !antes, `${w}: a caixa "Importar" responde ao toque`);

    if ([375, 660, 690, 1920].includes(w)) await page.screenshot({ path: foto(`importar-conferencia-${w}.png`) });
    ok(erros.length === 0, `${w}: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // A faixa que rolava (640 a ~704 px): medida largura a largura, de 8 em 8 px.
  for (let w = 640; w <= 712; w += 8) {
    if (larguras.includes(w)) continue;
    const { ctx, page, erros } = await abrir(w);
    await ateOPasso2(page);
    await page.click('[role="dialog"] button:has-text("Conferir")');
    await page.waitForSelector('[role="dialog"] >> text=Pão de hambúrguer brioche com gergelim', { timeout: 10000 });
    await page.waitForTimeout(200);
    const m = await medir(page);
    ok(m.length === 0, `${w} (faixa do celular deitado): conferência sem barra lateral ${m.slice(0, 3).join(' | ')}`);
    if (w === 664) await page.screenshot({ path: foto(`importar-conferencia-${w}.png`) });
    ok(erros.length === 0, `${w}: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // Girar o celular com a conferência aberta: a forma decide de novo pelo espaço novo, sem reabrir o diálogo.
  {
    const { ctx, page, erros } = await abrir(660);
    await ateOPasso2(page);
    await page.click('[role="dialog"] button:has-text("Conferir")');
    await page.waitForSelector('[role="dialog"] >> text=Pão de hambúrguer brioche com gergelim', { timeout: 10000 });
    await page.waitForTimeout(200);
    const colunas = () =>
      page.evaluate(() => [...document.querySelectorAll('[role="dialog"] th')].some((th) => th.textContent.trim() === 'Situação' && th.getClientRects().length > 0));
    ok(!(await colunas()), '660 → 1024: a 660 px a conferência começa empilhada');
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.waitForTimeout(400);
    ok(await colunas(), '660 → 1024: ao alargar, a conferência volta às colunas');
    await page.setViewportSize({ width: 660, height: 820 });
    await page.waitForTimeout(400);
    const m = await medir(page);
    ok(!(await colunas()) && m.length === 0, `1024 → 660: ao estreitar, empilha de novo e não rola ${m.slice(0, 3).join(' | ')}`);
    ok(erros.length === 0, `girar: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
