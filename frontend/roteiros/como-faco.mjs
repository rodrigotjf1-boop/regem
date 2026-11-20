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
// `financeiro`: a tela das contas a pagar lê a permissão do token (`podePerm`); sem ela, mostra só as formas de pagamento
const PERMISSOES = ['cadastros', 'escalas', 'impressoras', 'acessos', 'relatorios_vendas', 'cancelamentos', 'auditoria', 'turnos', 'fiscal_config', 'cupons', 'delivery', 'pedidos', 'fiscal', 'producao_kds', 'loja', 'financeiro'];
// `ver_financeiro`: o presidente vê os valores em R$ (sem ela, os relatórios mostram só as quantidades e um aviso)
const TOKEN = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: { ...Object.fromEntries(PERMISSOES.map((p) => [p, TUDO])), ver_financeiro: true } });

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
// A conferência com o iFood (`RespostaDaConferencia`, `lib/conferencia-apps.ts`): lida agora, uma linha igual, uma com o
// preço diferente e uma que só existe no app.
const linhaConferida = (chave, nome, pdv, precoApp, regem, situacao, motivo) => ({
  chave, tipo: 'item', nome, pdv, grupos: ['Lanches'], precos: [precoApp], promoDe: null, pausado: false, imagem: null,
  regem, ligaPeloId: false, situacao, motivo, outros: [],
});
const conferenciaDoIfood = () => ({
  loja: { id: 'l1', nome: 'Loja Exemplo' }, canal: 'ifood',
  canais: { ifood: { ligado: true, motivo: null, pendentes: 2 }, '99food': { ligado: true, motivo: null, pendentes: 0 } },
  estado: 'ok', motivo: null, lendoAgora: false, lidoEm: new Date().toISOString(), erro: null, erroEm: null,
  itens: [
    linhaConferida('101', 'X-Burger', '101', 33.9, { id: 'p1', nome: 'X-Burger', preco: 33.9, ativo: true }, 'igual', null),
    linhaConferida('102', 'X-Salada', '102', 36.9, { id: 'p2', nome: 'X-Salada', preco: 35.9, ativo: true }, 'preco', 'precoDiferente'),
    linhaConferida('app-1', 'Combo Família', null, 59.9, null, 'soApp', 'semCodigo'),
  ],
  opcoes: [],
});
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

// ── M6k, lote 1: as telas do dia a dia (Dashboard, Tarefas, Mural, Clientes, Marketing, Contas a pagar, Loja, Equipamentos)
// Data e hora relativas a agora (`haMin` na hora da chamada: dentro de uma função, vale a hora da resposta).
const haMin = (min) => new Date(Date.now() - min * 60000).toISOString();
const diaDaqui = (dias) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
// As tarefas de hoje (`/tarefas-instancias`): o Dashboard mostra as pendentes e as não feitas; Tarefas, todas.
const TAREFAS_DO_DIA = [
  { id: 't1', titulo: 'Conferir a validade da câmara fria', setorNome: 'Cozinha', colaboradorNome: 'Ana Exemplo', estado: 'pendente', horario: '18:00', horarioFim: '18:30', prioridade: 'alta', criadoEm: haMin(240), criadoPorNivel: 'gerente' },
  { id: 't2', titulo: 'Limpar a coifa', setorNome: 'Cozinha', colaboradorNome: null, estado: 'nao_feita', horario: '16:00', horarioFim: '16:30', prioridade: 'media', criadoEm: haMin(300), criadoPorNivel: 'gerente' },
  { id: 't3', titulo: 'Abrir o salão', setorNome: 'Salão', colaboradorNome: 'Bruno Exemplo', estado: 'feita', horario: '17:30', horarioFim: null, prioridade: null, criadoEm: haMin(360), criadoPorNivel: 'presidente' },
];
const POLITICA_DE_FOTO = { conclusao: false, parcial: false };
// O resumo do Dashboard no formato de `dashboard.service.ts › resumo` (com a lista vazia, `d.tarefas.pctConclusao` caía);
// `comercial` = o bloco dos valores em reais, que o servidor manda a quem vê valores.
const RESUMO_DO_DIA = {
  tarefas: { total: 12, feitas: 9, pendentes: 3, naoFeitas: 1, emMassa: 0, pctConclusao: 75 },
  escala: { vagas: 7, preenchidas: 6 },
  desperdicio: { total: 1, quantidade: 3 },
  vistorias: 0,
  estoqueAbaixoMinimo: 2,
  vendas: { total: 86 },
  producaoHoje: { producoes: 5, unidades: 140 },
  deliveryPendentes: 4,
  comercial: { faturado: 3420.5, balcaoFaturado: 1840.5, deliveryFaturado: 1580, gorjeta: 0, ticketMedio: 39.77, producaoCusto: 610.2 },
};
// A linha do tempo (`/dashboard/timeline`): quem está escalado por setor, as tarefas com horário e o pico (horas em número).
const LINHA_DO_TEMPO = {
  setores: [
    { setor: 'Cozinha', alocacoes: [{ colaborador: 'Ana Exemplo', funcao: 'Cozinheira', etiqueta: null, turno: 'Noite', inicio: 16, fim: 23 }], tarefas: [{ titulo: 'Conferir validades', horario: 18, estado: 'pendente' }] },
    { setor: 'Salão', alocacoes: [{ colaborador: 'Bruno Exemplo', funcao: 'Atendente', etiqueta: null, turno: 'Noite', inicio: 17.5, fim: 23.5 }], tarefas: [{ titulo: 'Abrir o salão', horario: 17.5, estado: 'feita' }] },
  ],
  picos: [{ nome: 'Jantar', inicio: 19.5, fim: 22 }],
  agora: 20,
};
const PONTO_DE_HOJE = [
  { colaboradorId: 'c1', nome: 'Ana Exemplo', status: 'trabalhando', ultimaMarcacao: { tipo: 'entrada', hora: haMin(240) }, trabalhadoMin: 240 },
  { colaboradorId: 'c2', nome: 'Bruno Exemplo', status: 'trabalhando', ultimaMarcacao: { tipo: 'entrada', hora: haMin(150) }, trabalhadoMin: 150 },
];
// O mural (`/mural`: `{ comunicados, total }`) com um comunicado fixado e um lido por poucos; a pesquisa de clima fechada.
const MURAL = {
  total: 8,
  comunicados: [
    { id: 'm1', titulo: 'Inventário geral no sábado', corpo: 'Chegar 1 hora antes.', fixado: true, audiencia: 'loja', autorNome: 'Gerência', createdAt: haMin(1440), leram: 5, alvo: 8, euLi: true },
    { id: 'm2', titulo: 'Sobremesas novas no cardápio', corpo: null, fixado: false, audiencia: 'setor', autorNome: 'Gerência', createdAt: haMin(300), leram: 2, alvo: 3, euLi: false },
  ],
};
// Os clientes no formato de `/clientes/crm` (as colunas do banco, em snake_case) e o resumo dos grupos.
const CLIENTES = [
  { id: 'c1', nome: 'Ana Exemplo', telefone: '5521988880001', total_pedidos: 14, total_gasto: 532.6, ultimo_pedido_em: haMin(2 * 1440), pedidos_30d: 4, canais: ['cardapio', 'ifood'], opt_out_marketing: false },
  { id: 'c2', nome: 'Bruno Exemplo', telefone: '5521988880002', total_pedidos: 6, total_gasto: 221.4, ultimo_pedido_em: haMin(9 * 1440), pedidos_30d: 1, canais: ['99food'], opt_out_marketing: false },
  { id: 'c3', nome: 'Carla Exemplo', telefone: '5521988880003', total_pedidos: 3, total_gasto: 98.7, ultimo_pedido_em: haMin(41 * 1440), pedidos_30d: 0, canais: ['cardapio'], opt_out_marketing: true },
];
// As campanhas de marketing (`/campanhas`): uma enviando e uma concluída.
const CAMPANHAS = [
  { id: 'k1', tipo: 'cupom', mensagem: 'Presente pra você 🎁 PROMO10 de desconto na Loja Exemplo. Peça: [link]', enviados: 120, total: 180, falhas: 0, estado: 'ativa' },
  { id: 'k2', tipo: 'recuperacao', mensagem: 'Sentimos sua falta 😊 Que tal um pedido hoje? Veja as novidades: [link]', enviados: 64, total: 64, falhas: 0, estado: 'concluida' },
];
// As contas a pagar (`/financeiro/titulos`) e o resto que a tela lê junto; sem o fluxo e o resultado do mês (com a lista
// vazia apareciam blocos zerados), o formulário "Nova conta" sobe na tela.
const CONTAS = {
  '/financeiro/resumo': { aPagar: 2350.9, aReceber: 480, saldoCaixa: 5120.4 },
  '/financeiro/titulos': [
    { id: 'f1', tipo: 'pagar', descricao: 'Aluguel', categoria: 'aluguel', valor: 1800, vencimento: diaDaqui(12), recorrencia: 'mensal', status: 'aberto' },
    { id: 'f2', tipo: 'pagar', descricao: 'Boleto do fornecedor', categoria: 'fornecedor', valor: 550.9, vencimento: diaDaqui(5), recorrencia: 'nenhuma', status: 'aberto', fornecedorNome: 'Fornecedor Exemplo', origem: 'recebimento' },
  ],
  '/financeiro/fluxo': { horizonteDias: 30, saldoFinal: 0, projecao: [] },
  '/financeiro/dre': null,
  '/empresas': { mirrorDias: 60, snapshotHora: '06:00' },
  '/fornecedores': [{ id: 'fo1', nome: 'Fornecedor Exemplo' }],
  '/financeiro/formas-pagamento': [
    { id: 'fp1', nome: 'Dinheiro', tipo: 'dinheiro', ativo: true },
    { id: 'fp2', nome: 'Pix', tipo: 'pix', ativo: true },
    { id: 'fp3', nome: 'Crédito', tipo: 'credito', ativo: true },
  ],
};
// Os dados da loja (`/cardapio/config`, só os campos que a tela de Loja edita).
const DADOS_DA_LOJA = {
  id: 'loja-exemplo', nomePublico: 'Loja Exemplo', contatoLoja: '(21) 3000-0000', documento: '00.000.000/0001-00', whatsapp: '+55 21 90000-0000',
  instagram: '@lojaexemplo', subtitulo: 'Hambúrguer artesanal.', endCep: '20000-000', endCidade: 'Cidade Exemplo', endRua: 'Rua Exemplo', endNumero: '100',
  endBairro: 'Centro', endEstado: 'RJ', pedidoMinimo: '30,00',
};
// Os equipamentos (`/equipamento`) montados na hora da resposta: a "conectado agora" do caixa vale por 3 min (CONECTADO_MIN).
// Um caixa conectado, um KDS, a impressora do caixa, uma estação de impressão sem sinal há 2 h e o terminal de ponto.
const equipamentosDaLoja = () => [
  { id: 'e1', nome: 'Caixa 1', tipo: 'pdv', ativo: true, unidadeId: 'u1', impressoraPadraoId: 'e3', presenca: { vistoEm: haMin(0.5), ip: '192.168.0.21', endereco: 'regem.local' } },
  { id: 'e2', nome: 'KDS da chapa', tipo: 'kds', ativo: true, unidadeId: 'u1', escopo: 'producao', ultimoPing: haMin(1) },
  { id: 'e3', nome: 'Impressora do caixa', tipo: 'impressora', ativo: true, unidadeId: 'u1', conexao: 'rede', host: '192.168.0.50', porta: 9100, largura: 80, fazCupom: true },
  { id: 'e4', nome: 'Estação do balcão', tipo: 'estacao_impressao', ativo: true, unidadeId: 'u1', pareado: true, estacao: { vistoEm: haMin(120), maquina: 'PC-BALCAO', versao: '1.30.14' } },
  { id: 'e5', nome: 'Ponto da entrada', tipo: 'terminal_ponto', ativo: true, unidadeId: 'u1', padrao: true, ultimoPing: haMin(5) },
];

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
  // A aba "Conferir com os apps", com a conferência do iFood simulada (com a lista vazia, a aba caía)
  {
    id: 'conferir-apps', caminho: '/catalogo', respostas: CATALOGO_COM_CANAIS, respostasDinamicas: { '/catalogo/conferencia': conferenciaDoIfood },
    passo: async (p) => {
      await em(p, '[role="tab"]:has-text("Conferir com os apps")').click();
      await p.locator('main').getByText('Preço diferente').first().waitFor({ timeout: 8000 }).catch(() => {});
    },
    marcas: (p) => [
      menu(p, '/catalogo'),
      em(p, '[role="tab"]:has-text("Conferir com os apps")'),
      em(p, 'button:has-text("iFood"):has-text("a resolver")'),
      em(p, 'button:has-text("Preço diferente")'),
    ],
  },
  // A gestão do catálogo com o iFood e a 99 ligados: o preço e a pausa de cada canal na linha do produto.
  {
    id: 'preco-no-canal', caminho: '/catalogo', respostas: CATALOGO_COM_CANAIS,
    marcas: (p) => [menu(p, '/catalogo'), rotulado(p, 'Buscar'), em(p, 'button[aria-label^="Mudar o preço"][aria-label*="iFood de X-Burger"]')],
  },
  {
    id: 'pausar-produto', caminho: '/catalogo', respostas: CATALOGO_COM_CANAIS,
    marcas: (p) => [menu(p, '/catalogo'), em(p, 'button[aria-label="Pausado no iFood: X-Burger"]')],
  },
  // Os relatórios de vendas: a aba "Vendas" lê o resumo do período (com a lista vazia, `resumo.vendas` caía)
  {
    id: 'relatorios-de-vendas', caminho: '/relatorios',
    respostas: {
      '/relatorios/vendas': {
        resumo: { faturado: 4820.5, vendas: 132, ticketMedio: 36.52, gorjeta: 0, canceladas: 2, recebido: 4820.5 },
        porForma: [{ forma: 'Pix', qtd: 58, total: 2110.3 }, { forma: 'Crédito', qtd: 44, total: 1702.2 }, { forma: 'Dinheiro', qtd: 30, total: 1008 }],
        // os canais como o servidor manda (`relatorios.service.ts`: mesa, delivery/app e balcão; a tela põe a maiúscula)
        porCanal: [{ canal: 'delivery/app', qtd: 62, total: 2420.5 }, { canal: 'balcão', qtd: 58, total: 1980 }, { canal: 'mesa', qtd: 12, total: 420 }],
      },
      '/relatorios/produtos': {
        itens: [
          { descricao: 'X-Burger', qtd: 60, bruto: 1794, desconto: 0, faturamento: 1794, custo: 720, lucro: 1074, margemPct: 59.9, pct: 37.2, classe: 'A' },
          { descricao: 'X-Salada', qtd: 41, bruto: 1307.9, desconto: 0, faturamento: 1307.9, custo: 540, lucro: 767.9, margemPct: 58.7, pct: 27.1, classe: 'A' },
          { descricao: 'Coca-Cola lata', qtd: 95, bruto: 665, desconto: 0, faturamento: 665, custo: 285, lucro: 380, margemPct: 57.1, pct: 13.8, classe: 'B' },
        ],
      },
      '/relatorios/atendentes': {
        atendentes: [
          { nome: 'Caixa 1', vendas: 70, total: 2400, gorjeta: 0, ticketMedio: 34.29 },
          { nome: 'Delivery', vendas: 62, total: 2420.5, gorjeta: 0, ticketMedio: 39.04 },
        ],
      },
    },
    // o "Período" marca só o seletor (pelo rótulo, a marca pegava o cartão inteiro do período)
    marcas: (p) => [menu(p, '/relatorios'), em(p, ':is(button,[role="tab"]):text-is("Vendas")'), em(p, 'select'), botao(p, 'Atualizar')],
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
  // ── M6k, lote 1 ──
  {
    id: 'painel-do-dia', caminho: '/painel',
    respostas: { '/dashboard': RESUMO_DO_DIA, '/dashboard/timeline': LINHA_DO_TEMPO, '/tarefas-instancias': TAREFAS_DO_DIA, '/tarefas-instancias/politica-foto': POLITICA_DE_FOTO, '/ponto/pessoas': PONTO_DE_HOJE },
    // o cartão inteiro do "Faturamento hoje" (o pai do rótulo, que é um <p> filho direto do cartão); "Nova tarefa" é o botão de mais
    marcas: (p) => [menu(p, '/painel'), em(p, 'p:text-is("Faturamento hoje")').locator('..'), em(p, 'p:text-is("Linha do tempo operacional")'), em(p, 'button[aria-label="Nova tarefa"]')],
  },
  {
    id: 'criar-tarefa', caminho: '/meu-dia',
    respostas: { '/tarefas-instancias': TAREFAS_DO_DIA, '/tarefas-instancias/politica-foto': POLITICA_DE_FOTO },
    // "Nova tarefa" fica no topo da página (fora do <main>), como o "Gerar escala"
    marcas: (p) => [menu(p, '/meu-dia'), p.locator('button:has-text("Nova tarefa") >> visible=true').first(), em(p, 'tr:has-text("Conferir a validade da câmara fria")')],
  },
  {
    id: 'mural', caminho: '/mural',
    respostas: { '/mural': MURAL, '/mural/clima': { pesquisa: null } },
    // com o título preenchido o "Publicar" liga (desligado, sai apagado na imagem)
    passo: async (p) => { await rotulado(p, 'Título').fill('Reunião da equipe na segunda'); await p.waitForTimeout(300); },
    marcas: (p) => [menu(p, '/mural'), rotulado(p, 'Título'), rotulado(p, 'Público'), botao(p, 'Publicar')],
  },
  {
    id: 'clientes', caminho: '/clientes',
    respostas: {
      '/clientes/crm/resumo': { total: 248, mes: 96, d30: 112, sem30: 64, sem60: 41, campeoes: 18 },
      '/clientes/crm': CLIENTES,
      '/clientes/funil': { visitas: 1240, carrinho: 410, checkout: 260, pedidos: 198 },
      '/clientes/crm/bairros': ['Centro', 'Jardim Exemplo'],
    },
    // a lista vira cartões quando a tabela não cabe (`useModoDaLista`): a linha OU o cartão do cliente
    marcas: (p) => [menu(p, '/clientes'), em(p, 'button:has-text("+30d sem pedir")'), rotulado(p, 'Buscar cliente'), em(p, ':is(tr, li):has-text("Ana Exemplo")')],
  },
  {
    // "＋ Nova campanha" só liga com um número de WhatsApp conectado (`numeros.principal.vinculado`)
    id: 'campanha-whatsapp', caminho: '/marketing',
    respostas: { '/whatsapp/numeros': NUMEROS_DO_WHATSAPP, '/campanhas': CAMPANHAS },
    marcas: (p) => [menu(p, '/marketing'), botao(p, 'Campanhas'), em(p, 'button:has-text("Nova campanha")'), botao(p, 'métricas')],
  },
  {
    id: 'conta-a-pagar', caminho: '/financeiro', respostas: CONTAS,
    // "Cadastrar conta" fica no fim do formulário "Nova conta": a página rola até ele ficar no pé da tela, com a "Descrição"
    // e o valor ainda à vista (rolar só até ele, centralizado, tiraria os campos de cima da imagem)
    passo: async (p) => {
      await botao(p, 'Cadastrar conta').evaluate((el) => el.scrollIntoView({ block: 'end' }));
      await p.waitForTimeout(300);
    },
    marcas: (p) => [menu(p, '/financeiro'), rotulado(p, 'Descrição'), rotulado(p, 'Valor (R$)'), botao(p, 'Cadastrar conta')],
  },
  {
    id: 'dados-da-loja', caminho: '/loja', respostas: { '/cardapio/config': DADOS_DA_LOJA },
    // uma mudança no nome faz aparecer a barra de baixo, com o "Salvar alterações"
    passo: async (p) => { await rotulado(p, 'Nome do estabelecimento').fill('Loja Exemplo Centro'); await p.waitForTimeout(300); },
    marcas: (p) => [menu(p, '/loja'), rotulado(p, 'Nome do estabelecimento'), botao(p, 'Salvar alterações')],
  },
  {
    id: 'equipamentos', caminho: '/equipamentos',
    respostas: { '/unidades': [{ id: 'u1', nome: 'Loja Exemplo' }] },
    respostasDinamicas: { '/equipamento': equipamentosDaLoja },
    // as ações da linha têm o nome do equipamento no rótulo ("Gerar código: Caixa 1"); a estação sem sinal conta em "Sem responder"
    marcas: (p) => [
      menu(p, '/equipamentos'),
      em(p, 'button:has-text("Novo equipamento")'),
      em(p, 'button[aria-label="Gerar código: Caixa 1"]'),
      em(p, 'button[aria-pressed]:has-text("Sem responder")'),
    ],
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
