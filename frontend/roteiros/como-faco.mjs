// Roteiro das IMAGENS DO "COMO FAÇO" do Mister (M3d) para as telas que não têm roteiro próprio. A API simulada com dados
// de exemplo (nunca dado de loja): a resposta padrão é a lista vazia nas leituras e `{}` no resto; cada tela pode trazer
// as suas respostas. Em cada tela: abrir, dar o passo (uma aba), marcar os lugares e conferir que cada marca está na tela,
// inteira e na frente (`fotoDoComoFaco`), que não houve erro de script e que a tela não caiu no "Algo deu errado" (a
// fronteira de erro do React segura a queda sem `pageerror`). Só grava a imagem com GERAR_COMO_FACO=1; sem a variável,
// só confere. O assunto do guia (`mister-guia-de-uso.ts`) diz em `imagem` o que cada número marca.
//
// Fora daqui por enquanto: "Relatórios de vendas" (cai com a resposta genérica — as 11 abas leem formatos próprios).
import { fotoDoComoFaco, responder, tokenFalso, umaLinha } from './comum.mjs';

const TUDO = { ver: true, criar: true, editar: true, excluir: true };
const PERMISSOES = ['cadastros', 'escalas', 'impressoras', 'acessos', 'relatorios_vendas', 'cancelamentos', 'auditoria', 'turnos', 'fiscal_config', 'cupons', 'delivery', 'pedidos', 'fiscal', 'producao_kds', 'loja'];
const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: Object.fromEntries(PERMISSOES.map((p) => [p, TUDO])) });

const menu = (page, href) => page.locator(`aside a[href="${href}"] >> visible=true`).first();
const em = (page, seletor) => page.locator('main').locator(seletor).first();
const botao = (page, texto) => em(page, `button:text-is("${texto}")`);
const cartao = (page, titulo) => em(page, `button:has(:text-is("${titulo}"))`);
const rotulado = (page, rotulo) => page.locator('main').getByLabel(rotulo, { exact: true }).first();

// Cada tela: o assunto do guia, o endereço, o passo (opcional) e as marcas, na ordem dos números.
const TELAS = [
  { id: 'cadastrar-colaborador', caminho: '/cadastros', marcas: (p) => [menu(p, '/cadastros'), cartao(p, 'Colaboradores')] },
  { id: 'cadastrar-entregador', caminho: '/cadastros', marcas: (p) => [menu(p, '/cadastros'), cartao(p, 'Funções'), cartao(p, 'Colaboradores')] },
  { id: 'produto-do-cardapio', caminho: '/cadastros', marcas: (p) => [menu(p, '/cadastros'), cartao(p, 'Cardápio')] },
  // "Gerar escala" fica no topo da página (fora do <main>)
  { id: 'escala', caminho: '/escala', marcas: (p) => [menu(p, '/escala'), p.locator('button:has-text("Gerar escala") >> visible=true').first()] },
  { id: 'adicionar-impressora', caminho: '/impressao', marcas: (p) => [menu(p, '/impressao'), em(p, 'button:has-text("Impressoras")'), em(p, 'button:has-text("Impressora"):not(:has-text("Impressoras"))')] },
  {
    id: 'onde-cada-documento-sai', caminho: '/impressao',
    passo: async (p) => { await em(p, 'button:has-text("Onde cada documento sai")').click(); await p.waitForTimeout(600); },
    marcas: (p) => [menu(p, '/impressao'), em(p, 'button:has-text("Onde cada documento sai")')],
  },
  { id: 'permissoes-do-perfil', caminho: '/config/acessos', marcas: (p) => [menu(p, '/config/acessos'), em(p, 'button:has-text("Perfis")'), em(p, 'button:has-text("Novo perfil")')] },
  {
    id: 'acesso-da-pessoa', caminho: '/config/acessos',
    passo: async (p) => { await em(p, 'button:has-text("Pessoas")').click(); await p.waitForTimeout(600); },
    marcas: (p) => [menu(p, '/config/acessos'), em(p, 'button:has-text("Pessoas")')],
  },
  { id: 'cancelamentos-de-itens', caminho: '/vendas/remocoes', marcas: (p) => [menu(p, '/vendas/remocoes'), rotulado(p, 'Período'), botao(p, 'Atualizar'), em(p, 'button:has-text("Sem justificativa")')] },
  { id: 'auditoria', caminho: '/auditoria', marcas: (p) => [menu(p, '/auditoria'), rotulado(p, 'Buscar'), rotulado(p, 'De'), em(p, 'button:has-text("Tudo")')] },
  { id: 'ver-turno', caminho: '/caixa/fechamentos', marcas: (p) => [menu(p, '/caixa/fechamentos'), rotulado(p, 'Período'), em(p, 'button:has-text("Bateu")')] },
  // A configuração fiscal: os campos achados PELO RÓTULO (o rótulo ficava solto — ERR-510). "Salvar configuração" fica
  // no fim da página (rolar até ele tiraria o "Ambiente" da tela): os passos do guia dizem onde.
  {
    id: 'configurar-nota', caminho: '/fiscal-config',
    respostas: { '/fiscal/config': { ambiente: '2', regime: 'simples', serie: '1', serieNuvem: '2' }, '/financeiro/caixa/config': { caixaLivre: false } },
    marcas: (p) => [menu(p, '/fiscal-config'), rotulado(p, 'Ambiente'), rotulado(p, 'Regime tributário')],
    // a faixa velha dizia "a emissão ainda não está disponível" com a NFC-e saindo de verdade (ERR-511)
    confere: async (p, ok) => {
      ok((await p.locator('main').getByText('ainda não está disponível').count()) === 0, 'fiscal: a tela não diz que a emissão não existe (ERR-511)');
      const pelosRotulos = await Promise.all(['CNPJ', 'Razão social', 'Série do balcão (servidor local)', 'Pedido de entrega sem CPF do cliente'].map((n) => rotulado(p, n).count()));
      ok(pelosRotulos.every((n) => n === 1), `fiscal: os campos achados pelo rótulo (${pelosRotulos.join(', ')})`);
    },
  },
  // M3d parte 6. Fora por enquanto (pedem as respostas simuladas de cada tela): as conversas do WhatsApp e as
  // integrações (aparecem "não conectado"/vazias com a resposta padrão) e a gestão do catálogo (cai, como os relatórios).
  { id: 'aplicativos-conectados', caminho: '/integracoes', marcas: (p) => [menu(p, '/integracoes'), em(p, 'h2:has-text("Aplicativos conectados")')] },
  { id: 'atendimento', caminho: '/atendimento', marcas: (p) => [menu(p, '/atendimento'), em(p, 'button:has-text("Abertos")'), em(p, ':text-is("Fila")')] },
  { id: 'cores-do-kds', caminho: '/producao-config', marcas: (p) => [menu(p, '/producao-config'), rotulado(p, 'Verde até'), rotulado(p, 'Amarelo até')] },
  { id: 'nota-fiscal', caminho: '/notas', marcas: (p) => [menu(p, '/notas'), em(p, ':text("Últimas notas")')] },
  {
    // a configuração de verdade (com a lista vazia, a diária e a taxa apareciam "NaN")
    id: 'pagamento-entregador', caminho: '/delivery/entregadores',
    respostas: {
      '/entregador/pagamento/config': { modelo: 'diaria_taxas', diariaCentavos: 5000, taxaEntregaCentavos: 500, taxaFixaCentavos: 0, raioChegadaM: 70, baseTaxa: 'real', periodicidade: 'dia', maxPedidosEntregador: 1 },
      '/entregador/pagamento/perfis': { entregadores: [] },
    },
    // o <label> envolve o texto e o seletor (o nome inclui as opções): a busca pelo rótulo não é exata
    marcas: (p) => [menu(p, '/delivery/entregadores'), p.locator('main').getByLabel('Como o entregador é pago').first(), botao(p, 'Salvar configurações')],
  },
  { id: 'reimprimir-cancelar-venda', caminho: '/cupons', marcas: (p) => [menu(p, '/cupons'), rotulado(p, 'Buscar por senha/nº'), em(p, ':text("Últimas vendas")')] },
  // Só conferência, sem foto: as telas que leem a categoria do token não podem quebrar a hidratação (V35; os
  // entregadores davam React #418 — o aviso de cima só existia no navegador)
  { id: 'hidratacao-fichas', caminho: '/fichas', semFoto: true },
  { id: 'hidratacao-meu-dia', caminho: '/meu-dia', semFoto: true },
  // Só conferência, sem foto (`semFoto`): o cadastro do produto do cardápio acha cada campo PELO RÓTULO (ERR-510) —
  // a identificação, o preço, a produção e o fiscal.
  {
    id: 'rotulos-do-produto', caminho: '/produtos', semFoto: true,
    passo: async (p, ok) => {
      const novo = p.locator('button:has-text("Novo produto") >> visible=true').first();
      await novo.waitFor({ timeout: 10000 }).catch(() => {});
      if (!(await novo.count())) return ok(false, `produto: o botão "Novo produto" não apareceu — ${umaLinha(await p.locator('body').innerText(), 300)}`);
      await novo.click();
      await p.waitForTimeout(600);
      // a seção dobrável "Fiscal (NCM, CFOP, PIS/COFINS…)" e, dentro dela, o <details> dos campos fiscais
      await p.locator(':is(button, summary):has-text("Fiscal (NCM, CFOP") >> visible=true').first().click();
      const fiscal = p.locator('summary:has-text("Fiscal (NFC-e)") >> visible=true').first();
      await fiscal.waitFor({ timeout: 5000 });
      await fiscal.click();
    },
    confere: async (p, ok) => {
      const nomes = ['Nome', 'Categoria *', 'Código / SKU (PDV)', 'Descrição', 'Tipo', 'Unidade', 'Setor de produção (KDS)', 'NCM', 'CFOP', 'Alíq. COFINS %'];
      const achados = await Promise.all(nomes.map((n) => p.getByLabel(n, { exact: true }).count()));
      ok(achados.every((n) => n === 1), `produto: cada campo achado pelo rótulo (${nomes.map((n, i) => `${n}=${achados[i]}`).join(', ')})`);
      ok((await p.getByRole('group', { name: 'Foto do produto', exact: true }).count()) === 1, 'produto: a foto é um grupo com o nome do rótulo');
    },
  },
];

export default async function roteiroComoFaco({ nav, base, ok, foto }) {
  for (const t of TELAS) {
    const ctx = await nav.newContext({ viewport: { width: 1280, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), TOKEN);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      if (t.respostas && p in t.respostas) return responder(route, t.respostas[p]);
      return responder(route, req.method() === 'GET' ? [] : {});
    });
    await page.goto(base + t.caminho);
    await page.waitForSelector('main', { timeout: 20000 });
    await page.waitForTimeout(800);
    if (t.passo) await t.passo(page, ok);
    const caiu = await page.locator('text=Algo deu errado').count();
    ok(caiu === 0, `como faço (${t.id}): a tela abriu (sem "Algo deu errado")`);
    if (t.confere) await t.confere(page, ok);
    if (!t.semFoto) {
      const r = await fotoDoComoFaco(page, t.id, t.marcas(page));
      ok(r.achou.every(Boolean), `como faço (${t.id}): as marcas estão na tela (${r.achou.join(', ')})${r.gerou ? ' — imagem gerada' : ''}${(r.motivos ?? []).filter(Boolean).length ? ` — ${r.motivos.join(' | ')}` : ''}`);
    }
    ok(erros.length === 0, `como faço (${t.id}): sem erro de script (${umaLinha(erros.join(' | '))})`);
    await ctx.close();
  }
  ok(TELAS.length > 0 && new Set(TELAS.map((t) => t.id)).size === TELAS.length, 'como faço: cada assunto uma vez só');
  void foto;
}
