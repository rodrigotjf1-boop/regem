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
const PERMISSOES = ['cadastros', 'escalas', 'impressoras', 'acessos', 'relatorios_vendas', 'cancelamentos', 'auditoria', 'turnos', 'fiscal_config'];
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
    if (t.passo) await t.passo(page);
    const caiu = await page.locator('text=Algo deu errado').count();
    ok(caiu === 0, `como faço (${t.id}): a tela abriu (sem "Algo deu errado")`);
    if (t.confere) await t.confere(page, ok);
    const r = await fotoDoComoFaco(page, t.id, t.marcas(page));
    ok(r.achou.every(Boolean), `como faço (${t.id}): as marcas estão na tela (${r.achou.join(', ')})${r.gerou ? ' — imagem gerada' : ''}${(r.motivos ?? []).filter(Boolean).length ? ` — ${r.motivos.join(' | ')}` : ''}`);
    ok(erros.length === 0, `como faço (${t.id}): sem erro de script (${umaLinha(erros.join(' | '))})`);
    await ctx.close();
  }
  ok(TELAS.length > 0 && new Set(TELAS.map((t) => t.id)).size === TELAS.length, 'como faço: cada assunto uma vez só');
  void foto;
}
