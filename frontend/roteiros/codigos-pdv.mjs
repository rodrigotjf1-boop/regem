// Roteiro de tela — "Mostrar código PDV" em Cadastros › Cardápio (pedido do dono, 21/11/2026): o código de produtos, complementos
// e opções editado direto na lista, sem abrir item por item. A API simulada.
//  • Em cada largura e em cada aba: nada rola para o lado, nenhum campo fora da janela, nome do item legível, barra e diálogo à vista.
//  • Desmarcado: nenhum campo. Marcado: um campo por item, com o código atual.
//  • A mesma opção em Opções e em Complementos mostra o mesmo rascunho.
//  • Preencher um código vazio salva direto; trocar um que existe mostra antes o "de → para".
//  • Salva em UM pedido só; a recusa do servidor marca a linha e mantém o que foi digitado.
import { responder, tokenFalso } from './comum.mjs';

const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: { loja: { ver: true, editar: true } } });
const CATEGORIAS = [{ id: 'c1', nome: 'Os mais pedidos', ordem: 0 }, { id: 'c2', nome: 'Combos, leve mais pague menos', ordem: 1 }];
const produto = (id, nome, codigo, categoriaId) => ({
  id, nome, codigo, categoriaId, tipo: 'simples', precoVenda: '29.00', descricao: '2 carnes de 56 g, duas fatias de queijo cheddar, bacon, cebola, picles, alface e molho especial',
  disponivelBalcao: true, disponivelCardapio: true, controlaEstoque: false,
});
const novosDados = () => ({
  produtos: [
    produto('p1', 'Trio 07 com um nome bem comprido para conferir que continua legível', '75', 'c1'),
    produto('p2', 'Trio 08', '76', 'c1'),
    produto('p3', 'Combo família', null, 'c2'),
  ],
  opcoes: [
    { id: 'o1', nome: 'Bacon extra', codigoPdv: 'A01', tipo: 'simples', ativo: true, precoCusto: null },
    { id: 'o2', nome: 'Queijo cheddar em dobro com nome comprido', codigoPdv: 'A02', tipo: 'simples', ativo: true, precoCusto: null },
    { id: 'o3', nome: 'Sem cebola', codigoPdv: null, tipo: 'simples', ativo: true, precoCusto: null },
  ],
});
const complementos = (d) => [
  { id: 'g1', nome: 'Adicionais', regra: 'varias_sem_repeticao', obrigatorio: false, canais: [], itens: d.opcoes.slice(0, 2).map((o, i) => ({ opcaoId: o.id, nome: o.nome, codigoPdv: o.codigoPdv, preco: '5.00', ordem: i })) },
  { id: 'g2', nome: 'Retirar', regra: 'uma', obrigatorio: false, canais: [], itens: [d.opcoes[0], d.opcoes[2]].map((o, i) => ({ opcaoId: o.id, nome: o.nome, codigoPdv: o.codigoPdv, preco: '0.00', ordem: i })) },
];

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && !el.classList.contains('faixa-abas'))
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
    }
    for (const el of document.querySelectorAll('[data-codigo-pdv]')) {
      const r = el.getBoundingClientRect();
      if (r.right > innerWidth + 1 || r.left < -1) achados.push(`campo fora da janela ${el.getAttribute('data-codigo-pdv')}`);
      if (r.width < 90) achados.push(`campo estreito ${Math.round(r.width)}`);
      // O nome do item na mesma linha não pode ficar esmagado.
      const linha = el.parentElement;
      const nome = linha?.querySelector('p') ?? linha?.querySelector('span.break-words');
      if (!nome) achados.push(`linha sem nome ${el.getAttribute('data-codigo-pdv')}`);
      else if (nome.getBoundingClientRect().width < 60) achados.push(`nome esmagado "${(nome.textContent ?? '').slice(0, 16)}" ${Math.round(nome.getBoundingClientRect().width)}`);
    }
    return achados;
  });

export default async function roteiroCodigosPdv({ nav, base, ok, foto, larguras }) {
  async function abrir(w, { recusar = null } = {}) {
    const ctx = await nav.newContext({ viewport: { width: w, height: w < 700 ? 820 : 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    const S = { d: novosDados(), pedidos: [], recusar };
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      if (p === '/produtos/codigos-pdv' && req.method() === 'PATCH') {
        const { trocas } = JSON.parse(req.postData() || '{}');
        S.pedidos.push(trocas);
        if (S.recusar) {
          const r = S.recusar;
          S.recusar = null;
          return responder(route, { statusCode: 409, message: `Nada foi salvo: ${r.motivo}.`, code: 'DATABASE_CONFLICT', details: { recusas: [r] } }, 409);
        }
        for (const t of trocas) {
          if (t.tipo === 'produto') S.d.produtos.find((x) => x.id === t.id).codigo = t.para;
          else S.d.opcoes.find((x) => x.id === t.id).codigoPdv = t.para;
        }
        return responder(route, { ok: true, alterados: trocas.length });
      }
      if (p === '/produtos') return responder(route, S.d.produtos);
      if (p === '/produtos/categorias') return responder(route, CATEGORIAS);
      if (p === '/produtos/opcoes') return responder(route, S.d.opcoes);
      if (p === '/produtos/complementos-catalogo') return responder(route, complementos(S.d));
      if (['/fichas', '/estoque/itens', '/setores', '/equipamento', '/delivery/integracoes'].includes(p)) return responder(route, []);
      if (p === '/produtos/ifood-pelo-orzuni' || p === '/produtos/precos-na-99') return responder(route, { ligado: false });
      return responder(route, {});
    });
    await page.goto(base + '/produtos');
    await page.waitForSelector('text=Mostrar código PDV', { timeout: 20000 });
    await page.waitForSelector('text=Trio 08', { timeout: 15000 });
    return { ctx, page, erros, S };
  }
  const campo = (page, chave) => page.locator(`[data-codigo-pdv="${chave}"]`).first();
  const aba = (page, nome) => page.getByRole('button', { name: nome, exact: true }).click();
  const marcar = (page) => page.getByLabel('Mostrar código PDV').check({ force: true });

  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w);
    ok((await page.locator('text=is not a function').count()) === 0, `${w}: a tela carregou sem erro de dados`);
    ok((await page.locator('[data-codigo-pdv]').count()) === 0, `${w}: desmarcado, nenhum campo na lista`);
    await marcar(page);
    await page.waitForSelector('[data-codigo-pdv="produto:p1"]');
    ok((await page.locator('[data-codigo-pdv^="produto:"]').count()) === 3, `${w}: um campo por produto`);
    ok((await campo(page, 'produto:p1').inputValue()) === '75', `${w}: o campo traz o código atual`);
    let m = await medir(page);
    ok(!m.length, `${w}: Produtos sem nada fora nem esmagado (${m.join('; ')})`);
    if ([320, 1440].includes(w)) {
      await campo(page, 'produto:p1').scrollIntoViewIfNeeded();
      await page.screenshot({ path: foto(`produtos-${w}.png`) });
    }

    await campo(page, 'produto:p1').fill('80');
    await page.waitForSelector('text=1 código ainda não salvo');
    m = await medir(page);
    ok(!m.length, `${w}: com a barra de salvar (${m.join('; ')})`);
    ok(await page.getByRole('button', { name: 'Salvar códigos' }).isVisible(), `${w}: "Salvar códigos" à vista`);

    await aba(page, 'Opções');
    await page.waitForSelector('[data-codigo-pdv="opcao:o1"]');
    await campo(page, 'opcao:o1').fill('B01');
    m = await medir(page);
    ok(!m.length, `${w}: Opções sem nada fora nem esmagado (${m.join('; ')})`);

    await aba(page, 'Complementos');
    await page.waitForSelector('[data-codigo-pdv="opcao:o1"]');
    ok((await campo(page, 'opcao:o1').inputValue()) === 'B01', `${w}: a mesma opção mostra o rascunho em Complementos`);
    ok((await page.locator('[data-codigo-pdv="opcao:o1"]').count()) === 2, `${w}: a opção aparece nas duas etapas que a usam`);
    m = await medir(page);
    ok(!m.length, `${w}: Complementos sem nada fora nem esmagado (${m.join('; ')})`);
    if ([320, 375, 1024, 1440].includes(w)) await page.screenshot({ path: foto(`codigos-pdv-complementos-${w}.png`) });

    await page.getByRole('button', { name: 'Salvar códigos' }).click();
    const dialogo = page.getByRole('alertdialog');
    await dialogo.waitFor();
    const t = (await dialogo.innerText()).replace(/\s+/g, ' ');
    ok(t.includes('Trocar 2 códigos PDV?') && t.includes('75 → 80') && t.includes('A01 → B01'), `${w}: o diálogo mostra de → para (${t.slice(0, 120)})`);
    m = await medir(page);
    ok(!m.length, `${w}: com o diálogo aberto (${m.join('; ')})`);
    ok(!erros.length, `${w}: sem erro na página (${erros.join('; ')})`);
    await ctx.close();
  }

  // O fluxo inteiro: um pedido só, as listas relidas e a barra some.
  {
    const { ctx, page, S } = await abrir(1280);
    await marcar(page);
    await campo(page, 'produto:p1').fill('80');
    await aba(page, 'Opções');
    await campo(page, 'opcao:o2').fill('  C02 ');
    await page.getByRole('button', { name: 'Salvar códigos' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Trocar códigos' }).click();
    await page.waitForSelector('text=códigos PDV salvos');
    ok(S.pedidos.length === 1 && S.pedidos[0].length === 2, `um pedido só com as duas trocas (${S.pedidos.length})`);
    ok(S.pedidos[0].some((x) => x.id === 'o2' && x.de === 'A02' && x.para === 'C02'), 'vai o código lido e o novo, sem espaços');
    ok((await campo(page, 'opcao:o2').inputValue()) === 'C02', 'a lista relê o código salvo');
    ok((await page.getByRole('button', { name: 'Salvar códigos' }).count()) === 0, 'a barra some depois de salvar');
    ok(await page.getByLabel('Mostrar código PDV').isEnabled(), 'sem pendência, dá para desmarcar');
    await ctx.close();
  }

  // Preencher o que estava vazio salva direto, sem o diálogo.
  {
    const { ctx, page, S } = await abrir(1280);
    await marcar(page);
    await campo(page, 'produto:p3').fill('90');
    ok(await page.getByLabel('Mostrar código PDV').isDisabled(), 'com pendência, não dá para esconder os campos');
    await page.getByRole('button', { name: 'Salvar códigos' }).click();
    await page.waitForSelector('text=Código PDV salvo.');
    ok(S.pedidos[0]?.[0]?.de === null && S.pedidos[0]?.[0]?.para === '90', 'código novo salvo sem pedir confirmação');
    await ctx.close();
  }

  // A recusa do servidor: o motivo na barra, o campo marcado e o digitado continua.
  {
    const { ctx, page } = await abrir(375, { recusar: { tipo: 'produto', id: 'p2', motivo: 'o código 75 ainda está em "Trio 07": troque o de lá e salve primeiro' } });
    await marcar(page);
    await campo(page, 'produto:p2').fill('75');
    await page.getByRole('button', { name: 'Salvar códigos' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Trocar códigos' }).click();
    await page.waitForSelector('text=troque o de lá e salve primeiro');
    ok((await campo(page, 'produto:p2').inputValue()) === '75', 'recusado: o que foi digitado continua no campo');
    ok((await campo(page, 'produto:p2').getAttribute('aria-invalid')) === 'true', 'recusado: o campo fica marcado');
    const m = await medir(page);
    ok(!m.length, `recusado, em 375: nada fora (${m.join('; ')})`);
    await page.screenshot({ path: foto('codigos-pdv-recusa-375.png') });
    await ctx.close();
  }
}
