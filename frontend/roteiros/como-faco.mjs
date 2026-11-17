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

// Os números do WhatsApp da loja (a aba do robô lê `principal.provedor`: a API sempre manda os dois papéis).
const numero = (papel, ligado) => ({
  papel, provedor: 'evolution', numero: ligado ? '5521900000000' : null, instancia: ligado ? 'loja-exemplo' : null,
  phoneId: null, wabaId: null, status: ligado ? 'conectado' : 'desconectado', verificado: ligado, vinculado: ligado,
});
const NUMEROS_DO_WHATSAPP = { principal: numero('principal', true), marketing: numero('marketing', false), termo: { versao: '1', evolution: '', cloud: '' } };
// Os ajustes do robô no formato de `whatsapp-provedor.service.ts › roboConfig` (a pausa, os avisos e o "Pedir avaliação").
const CONFIG_DO_ROBO = {
  pausaMinutos: 30, opcoesPausa: [15, 30, 60, 120, 240, 0],
  avisoAtraso: false, avisoAtrasoToleranciaMin: 10, lembreteCarrinho: false, conferirEntrega: false, cliente99Whatsapp: false,
  opcoesToleranciaAtraso: [0, 5, 10, 15, 20, 30],
  avaliacao: {
    ativa: false, link: null, texto: 'Oi, {nome}! Gostou do pedido? Conta pra gente: {link}', depoisMin: 40, soSemProblema: true, aPartirDo: 1, deNovoDias: 60,
    doMes: { enviados: 0, tocaram: 0 },
    opcoes: { depoisMin: [20, 40, 60, 120], aPartirDo: [1, 2, 3, 4, 5], deNovoDias: [30, 60, 90, 180] },
    textoPadrao: 'Oi, {nome}! Gostou do pedido? Conta pra gente: {link}',
  },
};
// A caixa de conversas do WhatsApp: o número conectado, duas conversas de exemplo e as mensagens da primeira (o horário
// das mensagens em segundos, como a API manda).
const agoraS = () => Math.floor(Date.now() / 1000);
const CONVERSAS_DO_WHATSAPP = [
  { jids: ['5521988880001@s.whatsapp.net'], telefone: '5521988880001', nome: 'Ana Exemplo', ultimaMensagem: 'Vocês entregam no Centro?', naoLidas: 1, chamado: null },
  { jids: ['5521988880002@s.whatsapp.net'], telefone: '5521988880002', nome: 'Bruno Exemplo', ultimaMensagem: 'Obrigado, chegou certinho!', naoLidas: 0, chamado: null },
];
const mensagensDaConversa = () => [
  { id: 'm1', fromMe: false, texto: 'Oi! Vocês entregam no Centro?', timestamp: agoraS() - 300 },
  { id: 'm2', fromMe: true, texto: 'Entregamos sim! A taxa para o Centro é R$ 5,00. Quer o cardápio?', timestamp: agoraS() - 240 },
];

// A gestão do catálogo com o iFood (pelo Orzuni) e a 99 ligados e a conferência com os apps: as fotos da conferência
// vêm `null` (sem leitura — a lista vazia quebrava `fotos.canais`), os produtos com o preço e a situação em cada canal.
const CATALOGO_COM_CANAIS = {
  '/catalogo/conferencia/fotos': null,
  '/produtos/ifood-pelo-orzuni': { ligado: true },
  '/produtos/precos-na-99': { ligado: true },
  '/catalogo/conferencia/ligada': { ligada: true },
  '/produtos': [
    { id: 'p1', nome: 'X-Burger', codigo: '101', precoVenda: 29.9, categoriaId: 'c1', ativo: true, noIfood: true, precoIfood: 33.9, na99: true, preco99: 32.9 },
    { id: 'p2', nome: 'X-Salada', codigo: '102', precoVenda: 31.9, categoriaId: 'c1', ativo: true, noIfood: true, precoIfood: 35.9, na99: true, preco99: 34.9 },
    { id: 'p3', nome: 'Coca-Cola lata', codigo: '201', precoVenda: 7, categoriaId: 'c2', ativo: true, noIfood: true, precoIfood: 8.5, na99: true, preco99: 8 },
  ],
  '/produtos/categorias': [{ id: 'c1', nome: 'Lanches' }, { id: 'c2', nome: 'Bebidas' }],
};

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
  // A aba "Integrações": um cartão por plataforma (a lista vem do servidor; vazia, a aba não mostra nenhum)
  {
    id: 'ligar-ifood-99', caminho: '/delivery/configuracoes?aba=integracoes',
    respostas: { '/delivery/integracoes': ['ifood', '99food', 'anotaai', 'keeta'].map((canal) => ({ canal, ativo: false })) },
    marcas: (p) => [
      menu(p, '/delivery/configuracoes'),
      em(p, 'button:text-is("Integrações")'),
      em(p, 'button:has-text("iFood"), button[aria-label*="iFood"], button:has(img[alt*="iFood"])'),
    ],
  },
  // A gestão do catálogo com o iFood e a 99 ligados: o preço e a pausa de cada canal na linha do produto. Fora por
  // enquanto: "Conferir com os apps" (a aba lê a conferência, que o roteiro ainda não simula) e os relatórios de vendas.
  {
    id: 'preco-no-canal', caminho: '/catalogo', respostas: CATALOGO_COM_CANAIS,
    marcas: (p) => [menu(p, '/catalogo'), rotulado(p, 'Buscar'), em(p, 'button[aria-label^="Mudar o preço"][aria-label*="iFood de X-Burger"]')],
  },
  {
    id: 'pausar-produto', caminho: '/catalogo', respostas: CATALOGO_COM_CANAIS,
    marcas: (p) => [menu(p, '/catalogo'), em(p, 'button[aria-label="Pausado no iFood: X-Burger"]')],
  },
  // A caixa de conversas: sem o status conectado, a tela mostra "WhatsApp não conectado"
  {
    id: 'conversas-whatsapp', caminho: '/whatsapp',
    respostas: { '/whatsapp/status': { conectado: true }, '/whatsapp/conversas': CONVERSAS_DO_WHATSAPP, '/whatsapp/robo-config': CONFIG_DO_ROBO },
    respostasDinamicas: { '/whatsapp/mensagens': mensagensDaConversa },
    passo: async (p) => {
      await em(p, 'button:has-text("Ana Exemplo")').click();
      await p.locator('main').getByText('A taxa para o Centro', { exact: false }).first().waitFor({ timeout: 8000 }).catch(() => {});
    },
    marcas: (p) => [menu(p, '/whatsapp'), em(p, 'button:has-text("Ana Exemplo")'), em(p, 'button:has-text("Pausar robô")'), em(p, 'button:has-text("Enviar cardápio")')],
  },
  // A aba "Robô de atendimento" (com os números do WhatsApp e os ajustes do robô simulados; com a lista vazia, caía)
  {
    id: 'robo', caminho: '/delivery/configuracoes?aba=robo', respostas: { '/whatsapp/numeros': NUMEROS_DO_WHATSAPP, '/whatsapp/robo-config': CONFIG_DO_ROBO },
    marcas: (p) => [menu(p, '/delivery/configuracoes'), em(p, 'button:text-is("Robô de atendimento")'), em(p, 'label:has-text("Robô ativo")')],
  },
  {
    id: 'whatsapp-da-loja', caminho: '/delivery/configuracoes?aba=robo', respostas: { '/whatsapp/numeros': NUMEROS_DO_WHATSAPP, '/whatsapp/robo-config': CONFIG_DO_ROBO },
    marcas: (p) => [menu(p, '/delivery/configuracoes'), em(p, 'button:text-is("Robô de atendimento")'), em(p, ':text("Número Principal")')],
  },
  {
    // o grupo "Pausa dos pedidos" só aparece com o cardápio digital da loja (`pausa.temCardapio`)
    id: 'ajustes-da-pausa', caminho: '/delivery/configuracoes?aba=atendimento',
    respostas: {
      '/atendimento/ajustes': {
        conectado99: false, ajuste99: null, fila: { avisarGerenteMin: 0, dizerPosicao: false },
        pausa: { temCardapio: true, minutos: 5, som: 'bipe', mensagem: null, mensagemPadrao: 'Estamos com os pedidos pausados agora. Voltamos já!', mensagemMax: 700, opcoes: { minutos: [0, 1, 3, 5, 10] } },
      },
    },
    marcas: (p) => [menu(p, '/delivery/configuracoes'), em(p, 'button:text-is("Atendimento")'), em(p, 'h3:text-is("Pausa dos pedidos")')],
  },
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
    // a fronteira de erro do React segura a queda sem `pageerror`, mas o React registra o erro no console: guardado
    // para dizer POR QUE a tela caiu
    const doConsole = [];
    page.on('console', (m) => { if (m.type() === 'error') doConsole.push(m.text()); });
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const p = new URL(req.url()).pathname.replace(/^.*\/api\/v1/, '');
      if (t.respostas && p in t.respostas) return responder(route, t.respostas[p]);
      // resposta montada na hora (o horário das mensagens relativo a agora)
      if (t.respostasDinamicas && p in t.respostasDinamicas) return responder(route, t.respostasDinamicas[p]());
      return responder(route, req.method() === 'GET' ? [] : {});
    });
    await page.goto(base + t.caminho);
    await page.waitForSelector('main', { timeout: 20000 });
    await page.waitForTimeout(800);
    if (t.passo) await t.passo(page, ok);
    const caiu = await page.locator('text=Algo deu errado').count();
    ok(caiu === 0, `como faço (${t.id}): a tela abriu (sem "Algo deu errado")${caiu ? ` — ${umaLinha(doConsole.filter((x) => !/Failed to load resource/.test(x)).slice(0, 2).join(' | '), 400)}` : ''}`);
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
