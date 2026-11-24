// Roteiro de tela do MISTER NO CONSOLE DA DISTRIBUIÇÃO (protótipo `mockups/regem-mister.html`, aba "Console da
// distribuição", aprovado em 13/11/2026), com a API e a janela da Meta simuladas.
// Confere: a aba só existe para a Diretoria; número não conectado — "Conectar com a Meta" só libera depois de escolher a
// forma, e na forma "só na API" depois do PIN de seis dígitos; o que vai ao servidor (a forma, o código da Meta, o PIN só
// quando é o caso) e o `featureType` da janela; a janela fechada não muda nada; os avisos da Meta aparecem; conectar NÃO
// liga a chave geral; conectado — os dados do número e o aviso da coexistência; desconectar e desligar pedem
// confirmação (Esc cancela, sem chamada); o número que caiu mostra o motivo; a lista de empresas com os rótulos, a busca
// que vai ao servidor (e só a resposta mais nova vale), vazio, teto e erro com "Tentar de novo"; os modelos de mensagem
// (a situação lida, o pedido uma vez só, o aprovado e o recusado, sem número e o erro); e, em cada largura, a página e o
// diálogo inteiros na tela, sem barra lateral — tabela no largo, cartões no estreito.
import { responder, tokenFalso } from './comum.mjs';
import { esmagados } from './candidatos-conducao.mjs';

const DIRETORIA = tokenFalso({ escopo: 'distribuicao', perfil: 'diretoria', nome: 'Rodrigo' });
const TECNICO = tokenFalso({ escopo: 'distribuicao', perfil: 'tecnico', nome: 'Técnica' });

const CADASTRO = { appId: '111', configId: '222', graphVersion: 'v25.0', pronto: true };
const SEM = { situacao: 'sem', numero: null, nome: null, forma: null, motivo: null, conectadoEm: null, situacaoEm: null, ultimaEntradaEm: null, qualidade: null, avisosPorDia: null };
const conectado = (forma = 'coexistencia') => ({
  situacao: 'conectado',
  numero: '5521900000000',
  nome: 'Mister',
  forma,
  motivo: null,
  conectadoEm: '2026-11-13T12:00:00Z',
  situacaoEm: '2026-11-13T12:00:00Z',
  ultimaEntradaEm: '2026-11-13T23:15:00Z',
  qualidade: 'green',
  avisosPorDia: 2000,
});
const CAIU = { ...conectado(), situacao: 'caiu', motivo: 'Object with ID does not exist', situacaoEm: '2026-11-10T09:00:00Z', qualidade: null, avisosPorDia: null };
// Q2 (mig 437): a conexão por QR Code. O texto do aceite é o do servidor (`mister-qr.ts`); a imagem, um PNG de 1 ponto.
const TEXTO_DO_ACEITE =
  'O WhatsApp não autoriza conexões fora da API oficial. O número pode ser bloqueado sem aviso, sobretudo se mandar mensagem para quem não falou com ele. O Mister só fala com quem ligou o próprio telefone (com o código de 10 minutos), o que reduz esse risco, mas não o elimina.\nUse um número só para o Mister, num celular que fique na distribuição, ligado e com internet.';
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const QR = (o = {}) => ({ pronto: true, situacao: 'sem', motivo: null, numero: null, situacaoEm: null, conectadoEm: null, aceite: null, textoDoAceite: TEXTO_DO_ACEITE, versaoDoAceite: 'v1', ...o });
const ACEITE = { por: 'Rodrigo', em: '2026-11-15T21:38:00-03:00', versao: 'v1' };
const QR_CONECTADO = (o = {}) => QR({ situacao: 'conectado', numero: '5521900001111', conectadoEm: '2026-11-15T21:40:00-03:00', situacaoEm: '2026-11-15T21:40:00-03:00', aceite: ACEITE, ...o });
const EMPRESAS = [
  { tenantId: 'a', nome: 'Burger da Praça', modulo: true, ia: { origem: 'propria', provedor: 'anthropic' }, pessoas: 3, usoUsd: 10.23, situacao: 'funcionando', motivo: null },
  { tenantId: 'b', nome: 'Pizzaria do Porto', modulo: true, ia: { origem: 'propria', provedor: 'anthropic' }, pessoas: 1, usoUsd: 2.1, situacao: 'ia_parada', motivo: 'sem_credito' },
  { tenantId: 'c', nome: 'Empório Sabor da Serra Comércio de Alimentos e Bebidas Artesanais Ltda', modulo: true, ia: { origem: null, provedor: null }, pessoas: 0, usoUsd: 0, situacao: 'falta_chave_e_whatsapp', motivo: null },
  { tenantId: 'd', nome: 'Cantina Bella', modulo: false, ia: { origem: 'incluida', provedor: null }, pessoas: 0, usoUsd: null, situacao: 'modulo_desligado', motivo: null },
];

const modelo = (nome, situacao, extra = {}) => ({
  nome,
  finalidade: nome === 'mister_aviso' ? 'Avisos fora das 24 horas' : 'Resumos fora das 24 horas',
  corpo: nome === 'mister_aviso' ? 'Aviso do Mister para {{1}}: {{2}}. Toque no botão para ver o que fazer.' : 'Seu {{1}} está pronto ({{2}}). Toque no botão para receber.',
  botao: nome === 'mister_aviso' ? 'Ver o que fazer' : 'Ver resumo',
  situacao,
  categoria: situacao === 'nao_pedido' ? null : 'utility',
  motivo: null,
  ...extra,
});
const MODELOS_NAO_PEDIDOS = [modelo('mister_aviso', 'nao_pedido'), modelo('mister_resumo_pronto', 'nao_pedido')];
const MODELOS_LONGOS = [
  modelo('mister_aviso', 'aprovado', { categoria: 'marketing' }),
  modelo('mister_resumo_pronto', 'recusado', { motivo: 'INVALID_FORMAT — o corpo do modelo tem um formato que a Meta não aceita para a categoria utilidade nesta conta' }),
];

// Os avisos para o suporte da DMS (F1.4 parte B): dois abertos (um escalou) e um resolvido; o nome comprido de propósito.
// A qualidade do Mister (F5, parte 1): só números — o roteiro confere que nenhum texto de pergunta aparece.
const QUALIDADE = {
  dias: 7,
  perguntas: 412,
  respondidas: 395,
  pctRespondidas: 96,
  falhas: 17,
  semConsulta: 23,
  // F5.2: o "não tenho acesso" e o que faltou, por tema (o tema que o Mister anota; nunca as palavras da pessoa).
  naoTem: { quantas: 19, pct: 5 },
  temas: [
    { tema: 'estoque e compras', quantas: 8 },
    { tema: 'financeiro e contas', quantas: 6 },
    { tema: 'outro assunto', quantas: 5 },
  ],
  // O Mentor, parte 1: os padrões com a observação, a causa provável e a proposta.
  melhorar: [
    { causa: 'falta_consulta', observacao: '"estoque e compras" faltou 8 vezes, em 3 empresas (o que mais faltou)', porque: 'nenhuma consulta do Mister traz esse dado', proposta: 'Consulta nova de estoque e compras · abrir tarefa' },
    { causa: 'erro_na_consulta', observacao: '"historia do pedido" não leu 5 vezes, de 37 (14%)', porque: 'a mesma consulta falhando mais de 10%', proposta: 'Ver o log das 5 falhas · abrir tarefa' },
  ],
  empresas: 3,
  pessoas: 9,
  tempo: { medianaS: 6, p90S: 14.2 },
  custo: { totalUsd: 0.45, porPerguntaUsd: 0.0011, precosLidosEm: '2026-11-12' },
  motivos: [
    { motivo: 'a chave de IA da empresa foi recusada', quantas: 6 },
    { motivo: 'a IA não respondeu (passageiro)', quantas: 5 },
    { motivo: 'sem crédito na conta de IA', quantas: 3 },
    { motivo: 'passou do tempo', quantas: 3 },
  ],
  consultas: [
    { nome: 'resumo do dia', vezes: 128, pct: 31, falhas: 0 },
    { nome: 'vendas do periodo', vezes: 91, pct: 22, falhas: 0 },
    { nome: 'historia do pedido', vezes: 37, pct: 9, falhas: 2 },
  ],
  porEmpresa: [
    { empresa: 'Burger da Praça', perguntas: 318, semResposta: 4, custoUsd: 0.35, chave: 'ok' },
    { empresa: 'Pizzaria do Porto', perguntas: 81, semResposta: 9, custoUsd: 0.09, chave: 'chave_recusada' },
    { empresa: 'Empório Sabor da Serra Comércio de Alimentos e Bebidas Artesanais Ltda', perguntas: 13, semResposta: 4, custoUsd: 0.01, chave: null },
  ],
};

// S2 (mig 434): a análise com IA da Segurança — a última rodada com duas propostas (o texto comprido de propósito).
const PROPOSTAS_DA_ANALISE = () => [
  {
    id: 'p-1', nivel: 'atencao', titulo: 'Um telefone tentou 9 códigos errados em 12 minutos', situacao: 'aberta', tarefa: null, decididaPor: null, decididaEm: null,
    viu: 'Final 7731, empresa Empório Sabor da Serra Comércio de Alimentos e Bebidas Artesanais Ltda, 15/11 entre 22:04 e 22:16 — os 9 com "código errado".',
    proposta: 'Calar novas tentativas desse telefone por 1 hora (a regra que já existe cala por 30 min depois de 5).',
    impacto: 'Só esse telefone. Conferir: nenhuma tentativa dele na próxima hora, na contagem "telefone calado".',
  },
  {
    id: 'p-2', nivel: 'melhoria', titulo: 'O filtro tirou "link" de 6 respostas da consulta "canais e integrações"', situacao: 'aberta', tarefa: null, decididaPor: null, decididaEm: null,
    viu: '6 notas link_tirado em 3 empresas, sempre depois da mesma consulta.',
    proposta: 'A consulta devolver o caminho do menu em vez do endereço (o filtro tira links de propósito).',
    impacto: 'Só o texto dessa consulta. Conferir: zero link_tirado nela em 7 dias e a avaliação de regressão sem erradas novas.',
  },
];
const ANALISE = (o = {}) => ({
  chaveDaDistribuicao: true, modelo: 'claude-haiku-5-5', dias: 7, prazoMin: 5, estimativaUsd: 0.02,
  analise: { id: 'a-1', situacao: 'terminou', pedidaPor: 'Rita', dias: 7, eventos: 1284, custoUsd: 0.02, motivo: null, iniciadaEm: '2026-11-15T12:12:00Z', terminadaEm: '2026-11-15T12:12:20Z' },
  propostas: PROPOSTAS_DA_ANALISE(),
  ...o,
});

// M2b (mig 435): as instruções candidatas — a candidata com a avaliação passando, uma troca publicada e as erradas da base.
const TROCA_PUBLICADA = {
  id: 't-1', sai: '- Para vendas por canal, use a consulta de vendas do período.', entra: '- Para vendas por canal, use a consulta de vendas do período e diga o valor de cada canal.',
  publicadaEm: '2026-11-15T13:00:00Z', publicadaPor: 'Rita', ultima: true,
};
const CANDIDATA = (o = {}) => ({
  id: 'k-1', tipo: 'troca', versao: '7c21d0b9', criadaEm: '2026-11-16T12:30:00Z', criadaPor: 'Rodrigo',
  sai: '- Para quantos pedidos na cozinha, use a consulta de pedidos em andamento e conte os que ainda não saíram, separando por canal e por etapa (novo, em preparo, pronto) sempre que a pessoa perguntar.',
  entra: '- Para quantos pedidos na cozinha, use a consulta de pedidos em andamento e conte os que ainda não saíram, separando por canal e por etapa (novo, em preparo, pronto), e diga quantos estão atrasados.',
  porque: 'a pergunta "Quantos pedidos estão na cozinha?" não falava dos atrasados',
  avaliacao: { id: 'av-k', situacao: 'terminou', total: 40, feitas: 40, acertos: 40, custoUsd: 0.04, iniciadaEm: '2026-11-16T12:41:00Z' },
  pode: true, motivo: null, novas: [], melhoraram: ['Quanto vendi no iFood ontem?'],
  ...o,
});
const INSTRUCOES = (o = {}) => ({
  indisponivel: false, chaveDaDistribuicao: true,
  noAr: { versao: 'a4fae716', desde: '2026-11-15T13:00:00Z', por: 'Rita', avaliacao: { id: 'av-1', situacao: 'terminou', total: 40, feitas: 40, acertos: 39, custoUsd: 0.04, iniciadaEm: '2026-11-15T12:00:00Z' }, quebradas: [] },
  erradasNoAr: [{ pergunta: 'Quanto vendi no iFood ontem?', falhas: ['não disse o valor do iFood'] }],
  candidata: CANDIDATA(),
  publicadas: [TROCA_PUBLICADA],
  ...o,
});

// A segurança (o Sentinela, parte 1): só contagens; o nome comprido de propósito.
const SEGURANCA = {
  dias: 7,
  saida: [
    { nota: 'segredo', texto: 'segredo tirado', quantas: 1 },
    { nota: 'link_tirado', texto: 'link tirado', quantas: 3 },
    { nota: 'valor_sem_origem', texto: 'valor em reais sem origem (anotado)', quantas: 2 },
    { nota: 'cortada', texto: 'resposta cortada pelo tamanho', quantas: 1 },
    { nota: 'vazia', texto: 'resposta vazia', quantas: 0 },
  ],
  entrada: { codigoNaoVale: 11, codigosDemais: 1, codigoCalado: 2, codigoErrado: { quantas: 14, telefones: 3, calados: 1 }, outraPessoa: 2, perdeuOAcesso: 4, naoLigado: { quantas: 9, telefones: 6 } },
  segredos: 1,
  limite: 1,
  // F4.2a (mig 433): os links com PIN bloqueados pelo quinto PIN errado.
  linksComPin: { bloqueados: 2, empresas: 1 },
  atencao: [
    { nivel: 'critico', texto: 'Uma resposta saiu sem algo parecido com uma chave de acesso (o filtro de saída tirou). Conferir qual consulta trouxe esse dado: canais e integracoes · Pizzaria do Porto · 13/11 21:04.' },
    { nivel: 'atencao', texto: '1 telefone foi calado por 1 hora depois de 5 códigos errados seguidos para ligar ao Mister.' },
  ],
  porEmpresa: [
    { empresa: 'Pizzaria do Porto', filtro: 4, segredos: 1, perdeuOAcesso: 3, outraPessoa: 0, limite: 0 },
    { empresa: 'Empório Sabor da Serra Comércio de Alimentos e Bebidas Artesanais Ltda', filtro: 3, segredos: 0, perdeuOAcesso: 1, outraPessoa: 2, limite: 1 },
  ],
};

// A avaliação de regressão (F5.3): duas rodadas, a última com 2 erradas; a pergunta comprida de propósito.
const RODADA = (o) => ({ id: 'av2', situacao: 'terminou', iniciadaEm: '2026-11-14T23:10:00-03:00', terminadaEm: '2026-11-14T23:12:00-03:00', pedidaPor: 'Rodrigo', versao: 'a1b2c3d4', consultas: 17, modelo: 'claude-haiku-5-5', total: 40, feitas: 40, acertos: 38, motivo: null, custoUsd: 0.0412, falhas: 0, oQueFalhou: [], ...o });
const AVALIACOES = (o = {}) => ({
  disponivel: true,
  versaoAtual: { versao: 'a1b2c3d4', consultas: 17 },
  total: 40,
  chaveDaDistribuicao: true,
  modelo: 'claude-haiku-5-5',
  prazoMin: 20,
  rodadas: [
    RODADA({
      falhas: 2,
      oQueFalhou: [
        { pergunta: 'Quanto vendi no iFood ontem, separando o que entrou pelo cardápio online e pela 99 também?', falha: 'a resposta não traz 1.688,35' },
        { pergunta: 'O que vai vencer?', falha: 'não usou a consulta "vencimentos e versoes"' },
      ],
    }),
    RODADA({ id: 'av1', iniciadaEm: '2026-11-14T09:40:00-03:00', versao: '9f8e7d6c', consultas: 16, total: 39, feitas: 39, acertos: 39, custoUsd: 0.0398 }),
  ],
  ...o,
});
const CASOS_DA_RODADA = Array.from({ length: 40 }, (_, i) => {
  const id = `c${String(i + 1).padStart(2, '0')}`;
  if (id === 'c07') return { id, pergunta: 'Quanto vendi no iFood ontem, separando o que entrou pelo cardápio online e pela 99 também?', ok: false, falhas: ['a resposta não traz 1.688,35'], consultas: ['vendas_do_periodo'], ms: 4200 };
  if (id === 'c29') return { id, pergunta: 'O que vai vencer?', ok: false, falhas: ['não usou a consulta "vencimentos e versoes"'], consultas: [], ms: 2100 };
  return { id, pergunta: `Pergunta ${i + 1} da avaliação`, ok: true, falhas: [], consultas: ['resumo_do_dia'], ms: 3000 };
});

// As dependências (F3, parte 2): uma de cada situação; o nome e o "usamos" compridos de propósito.
const DEPENDENCIAS = () => ({
  semMigration: false,
  itens: [
    { id: 'meta-whatsapp', nome: 'WhatsApp · API oficial da Meta', tipo: 'mensagens', usamos: 'mensagens, modelos de mensagem, webhooks e o número do Mister', versao: 'v25.0', modelos: null, situacao: 'em_dia', achados: [{ integracao: 'meta-whatsapp', usamos: 'v25.0', situacao: 'em_dia', texto: 'A v25.0 vale até 29/07/2028 (622 dias).', data: '2028-07-29' }], fonte: { id: 'meta-graph-versoes', nome: 'Meta · tabela de versões da Graph API', url: 'https://developers.facebook.com/docs/graph-api/changelog/versions/?locale=en_US' }, conferidaEm: '2026-11-15T09:07:00Z', lidaEm: '2026-11-15T09:07:00Z', falha: null, mudanca: null, decisao: null },
    { id: 'meta-instagram', nome: 'Instagram · Graph API', tipo: 'mensagens', usamos: 'Direct, comentários e marcações da conta da loja', versao: 'v27.0', modelos: null, situacao: 'a_conferir', achados: [{ integracao: 'meta-instagram', usamos: 'v27.0', situacao: 'a_conferir', texto: 'A v27.0 não está na tabela da Meta (a tabela pode estar atrasada: confirme pela API).', data: null }], fonte: { id: 'meta-graph-versoes', nome: 'Meta · tabela de versões da Graph API', url: 'https://developers.facebook.com/docs/graph-api/changelog/versions/?locale=en_US' }, conferidaEm: '2026-11-15T09:07:00Z', lidaEm: '2026-11-15T09:07:00Z', falha: null, mudanca: null, decisao: null },
    { id: 'meta-messenger', nome: 'Messenger · Graph API', tipo: 'mensagens', usamos: 'mensagens da página da loja', versao: 'v27.0', modelos: null, situacao: 'nao_verificada', achados: [], fonte: { id: 'meta-graph-versoes', nome: 'Meta · tabela de versões da Graph API', url: 'https://developers.facebook.com/docs/graph-api/changelog/versions/?locale=en_US' }, conferidaEm: '2026-11-12T09:07:00Z', lidaEm: '2026-11-15T09:07:00Z', falha: 'a fonte respondeu 429', mudanca: null, decisao: null },
    { id: 'anthropic', nome: 'Anthropic · modelos de IA', tipo: 'ia', usamos: 'o Mister, o robô de atendimento, o copiloto e as marcações do Instagram', versao: null, modelos: ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5'], situacao: 'a_conferir', achados: [{ integracao: 'anthropic', usamos: 'claude-haiku-5-5', situacao: 'em_dia', texto: 'claude-haiku-5-5: ativo; aposentadoria não antes de 07/10/2027.', data: '2027-10-07' }], fonte: { id: 'anthropic-modelos', nome: 'Anthropic · situação dos modelos', url: 'https://platform.claude.com/docs/en/about-claude/model-deprecations.md' }, conferidaEm: '2026-11-15T09:07:00Z', lidaEm: '2026-11-15T09:07:00Z', falha: null, mudanca: { mudouEm: '2026-11-15T09:07:00Z', saiu: ['claude-sonnet-4-5-20250929 | Active | - | Not sooner than September 29, 2026'], entrou: ['claude-sonnet-4-5-20250929 | Deprecated | 2026-09-30 | 2026-11-30'] }, decisao: null },
    { id: 'ifood', nome: 'iFood · API do parceiro', tipo: 'marketplaces', usamos: 'pedidos, eventos (confirmar, despachar, cancelar), chat e evidências', versao: null, modelos: null, situacao: 'manual', achados: [], fonte: null, conferidaEm: null, lidaEm: null, falha: null, mudanca: null, decisao: null },
    { id: 'ibpt', nome: 'IBPT · tabela por estado', tipo: 'fiscal', usamos: 'o valor aproximado dos tributos na NFC-e (Lei 12.741)', versao: null, modelos: null, situacao: 'vencida', achados: [{ integracao: 'ibpt', usamos: 'RJ', situacao: 'vencendo', texto: 'RJ: vencida — envie a nova em Atualizações.', data: null }], fonte: null, conferidaEm: null, lidaEm: null, falha: null, mudanca: null, decisao: null },
  ],
});

const AVISOS_DO_SUPORTE = () => {
  const ha = (min) => new Date(Date.now() - min * 60_000).toISOString();
  return [
    { id: 's1', empresa: 'Burger da Praça', loja: 'Loja Centro', aviso: 'servidor sem sinal · 2 pedidos esperando', situacao: 'aberto', escalado: false, abertoEm: ha(4), resolvidoEm: null },
    { id: 's2', empresa: 'Empório Sabor da Serra Comércio de Alimentos e Bebidas Artesanais Ltda', loja: 'Unidade Serra', aviso: 'disco do servidor quase cheio', situacao: 'aberto', escalado: true, abertoEm: ha(136), resolvidoEm: null },
    { id: 's3', empresa: 'Pizzaria do Porto', loja: null, aviso: 'cópia de segurança atrasada', situacao: 'resolvido', escalado: false, abertoEm: ha(300), resolvidoEm: ha(60) },
  ];
};

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('main *, [role="alertdialog"] *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1)
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      // Nada do conteúdo passa da borda direita da janela (texto comprido de empresa, número, selo).
      if (el.getClientRects().length && el.getBoundingClientRect().right > window.innerWidth + 1) achados.push(`passa da tela ${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim().slice(0, 24)}"`);
    }
    for (const d of document.querySelectorAll('[role="alertdialog"]')) {
      const r = d.getBoundingClientRect();
      if (r.left < 0 || r.right > window.innerWidth + 1 || r.top < 0 || r.bottom > window.innerHeight + 1) achados.push(`diálogo fora da tela ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    for (const b of document.querySelectorAll('main button, [role="alertdialog"] button'))
      if (b.getClientRects().length && b.getBoundingClientRect().height < 39.5) achados.push(`botão baixo "${b.textContent.trim().slice(0, 30)}"`);
    return [...new Set(achados)];
  });

export default async function roteiroMisterConsole({ nav, base, ok, foto, larguras }) {
  async function abrir(w, h, o = {}) {
    const S = {
      numero: o.numero ?? SEM,
      liberado: o.liberado ?? false,
      empresas: o.empresas ?? EMPRESAS,
      total: o.total,
      falha: !!o.falha,
      falhaDaLista: !!o.falhaDaLista,
      avisos: o.avisos ?? [],
      atrasoDaBusca: o.atrasoDaBusca ?? {},
      modelos: o.modelos ?? MODELOS_NAO_PEDIDOS,
      falhaDosModelos: !!o.falhaDosModelos,
      atrasoDosModelos: 0,
      avisosDoSuporte: o.avisosDoSuporte ?? AVISOS_DO_SUPORTE(),
      falhaDosAvisos: !!o.falhaDosAvisos,
      dependencias: o.dependencias ?? DEPENDENCIAS(),
      falhaDasDependencias: !!o.falhaDasDependencias,
      qualidade: o.qualidade ?? QUALIDADE,
      falhaDaQualidade: !!o.falhaDaQualidade,
      avaliacoes: o.avaliacoes ?? AVALIACOES(),
      seguranca: o.seguranca ?? SEGURANCA,
      falhaDaSeguranca: !!o.falhaDaSeguranca,
      analise: o.analise ?? ANALISE(),
      leiturasRodando: 0,
      instrucoes: o.instrucoes ?? INSTRUCOES(),
      leiturasAvaliando: 0,
      falhaDasAvaliacoes: !!o.falhaDasAvaliacoes,
      provedor: o.provedor ?? 'oficial',
      qr: o.qr ?? QR(),
      conferidas: 0,
      pedidos: [],
    };
    const qrNaResposta = () => ({ provedor: S.provedor, situacao: S.qr.situacao, motivo: S.qr.motivo, numero: S.qr.numero, situacaoEm: S.qr.situacaoEm, conectadoEm: S.qr.conectadoEm, aceite: S.qr.aceite });
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript(
      ({ jwt, fecha }) => {
        localStorage.setItem('regem_dist_token', jwt);
        // A janela da Meta de mentira: guarda como foi aberta e conclui (ou é fechada sem concluir).
        window.FB = {
          init() {},
          login(cb, opcoes) {
            window.__janelaDaMeta = opcoes;
            setTimeout(() => cb(fecha ? {} : { authResponse: { code: 'codigo-da-meta' } }), 20);
          },
        };
      },
      { jwt: o.token ?? DIRETORIA, fecha: !!o.janelaFechada },
    );
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/connect.facebook.net/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const p = url.pathname.replace(/^.*\/api\/v1/, '');
      const metodo = req.method();
      if (p.startsWith('/distribuicao/mister')) S.pedidos.push({ metodo, p, busca: url.searchParams.get('busca') ?? '', corpo: req.postData() ? JSON.parse(req.postData()) : null });
      if (p === '/distribuicao/me') return responder(route, { sub: 'u1', nome: 'Rodrigo', perfil: JSON.parse(Buffer.from((o.token ?? DIRETORIA).split('.')[1], 'base64url').toString()).perfil });
      if (p === '/distribuicao/mister' && metodo === 'GET') {
        if (S.falha) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        return responder(route, { numero: S.numero, liberado: S.liberado, cadastro: o.cadastro ?? CADASTRO, provedor: S.provedor, qr: S.qr });
      }
      if (p === '/distribuicao/mister/qr/aceite') {
        S.qr = { ...S.qr, aceite: { ...ACEITE, versao: JSON.parse(req.postData()).versao } };
        return responder(route, qrNaResposta(), 201);
      }
      if (p === '/distribuicao/mister/qr/gerar') {
        if (o.falhaDoQr) return responder(route, { statusCode: 503, message: o.falhaDoQr }, 503);
        if (JSON.parse(req.postData()).outroNumero) S.qr = { ...S.qr, numero: null };
        S.qr = { ...S.qr, situacao: 'conectando', motivo: null };
        return responder(route, { ...qrNaResposta(), qr: { imagem: PNG, codigo: null } }, 201);
      }
      if (p === '/distribuicao/mister/qr/conferir') {
        S.conferidas += 1;
        if (o.conectaNa && S.conferidas >= o.conectaNa) {
          S.qr = { ...S.qr, situacao: 'conectado', numero: '5521900001111', conectadoEm: '2026-11-16T10:00:00-03:00', situacaoEm: '2026-11-16T10:00:00-03:00' };
          S.provedor = 'evolution';
        }
        return responder(route, qrNaResposta(), 201);
      }
      if (p === '/distribuicao/mister/qr/trocar') {
        S.provedor = JSON.parse(req.postData()).para === 'qr' ? 'evolution' : 'oficial';
        return responder(route, qrNaResposta(), 201);
      }
      if (p === '/distribuicao/mister/qr/desconectar') {
        S.qr = { ...S.qr, situacao: 'sem', numero: null, motivo: null };
        return responder(route, qrNaResposta(), 201);
      }
      if (p === '/distribuicao/mister/empresas') {
        if (S.falhaDaLista) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        const busca = (url.searchParams.get('busca') ?? '').toLowerCase();
        const espera = S.atrasoDaBusca[busca];
        if (espera) await new Promise((r) => setTimeout(r, espera));
        const achadas = S.empresas.filter((e) => !busca || e.nome.toLowerCase().includes(busca));
        return responder(route, { empresas: achadas, total: S.total ?? achadas.length, limite: 200 });
      }
      if (p === '/distribuicao/mister/numero/conectar') {
        if (o.recusa) return responder(route, { statusCode: 400, message: o.recusa }, 400);
        S.numero = conectado(JSON.parse(req.postData()).forma);
        return responder(route, { numero: S.numero, avisos: S.avisos }, 201);
      }
      if (p === '/distribuicao/mister/numero/desconectar') {
        S.numero = SEM;
        return responder(route, S.numero, 201);
      }
      if (p === '/distribuicao/mister/liberacao') {
        S.liberado = JSON.parse(req.postData()).ligado === true;
        return responder(route, { ligado: S.liberado }, 201);
      }
      if (p === '/distribuicao/mister/modelos' && metodo === 'GET') {
        if (S.atrasoDosModelos) await new Promise((r) => setTimeout(r, S.atrasoDosModelos));
        if (S.falhaDosModelos) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        return responder(route, { lido: S.numero.situacao === 'conectado', modelos: S.modelos });
      }
      if (p === '/distribuicao/mister/modelos/pedir') {
        const pedidos = S.modelos.filter((m) => m.situacao === 'nao_pedido').map((m) => m.nome);
        S.modelos = S.modelos.map((m) => (m.situacao === 'nao_pedido' ? { ...m, situacao: 'em_analise', categoria: 'utility' } : m));
        return responder(route, { modelos: S.modelos, pedidos, recusas: [] }, 201);
      }
      if (p === '/distribuicao/dependencias') {
        if (S.falhaDasDependencias) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        return responder(route, S.dependencias);
      }
      if (p === '/distribuicao/dependencias/ler-agora') {
        S.pedidos.push({ metodo, p, busca: '', corpo: null });
        return responder(route, { lidas: [{ fonte: 'meta-graph-versoes', leu: true, mudou: false, falha: null }, { fonte: 'anthropic-modelos', leu: false, mudou: false, falha: 'a fonte respondeu 403' }] }, 201);
      }
      if (/^\/distribuicao\/dependencias\/[^/]+\/decisao$/.test(p)) {
        S.pedidos.push({ metodo, p, busca: '', corpo: req.postData() ? JSON.parse(req.postData()) : null });
        const corpo = JSON.parse(req.postData() || '{}');
        S.dependencias.itens = S.dependencias.itens.map((i) => (i.fonte?.id === p.split('/')[3] && i.mudanca ? { ...i, decisao: { decisao: corpo.decisao, em: new Date().toISOString(), por: 'Rodrigo', nota: corpo.nota || null }, situacao: 'em_dia' } : i));
        return responder(route, { ok: true, fonte: p.split('/')[3], decisao: corpo.decisao }, 201);
      }
      if (p === '/distribuicao/mister/avisos') {
        if (S.falhaDosAvisos) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        const busca = (url.searchParams.get('busca') ?? '').toLowerCase();
        const todos = S.avisosDoSuporte.filter((a) => !busca || a.empresa.toLowerCase().includes(busca));
        const resolvidos = url.searchParams.get('situacao') === 'resolvidos';
        return responder(route, {
          contagens: { abertos: todos.filter((a) => a.situacao === 'aberto').length, resolvidos: todos.filter((a) => a.situacao === 'resolvido').length },
          limite: 200,
          avisos: todos.filter((a) => (resolvidos ? a.situacao === 'resolvido' : a.situacao === 'aberto')),
        });
      }
      // M2b: as instruções candidatas — o servidor de mentira guarda o estado; avaliar passa a "rodando" e a 2ª leitura termina.
      if (p === '/distribuicao/mister/instrucoes' && metodo === 'GET') {
        const c = S.instrucoes.candidata;
        if (c?.avaliacao?.situacao === 'rodando' && ++S.leiturasAvaliando >= 2)
          S.instrucoes = { ...S.instrucoes, candidata: { ...c, avaliacao: { ...c.avaliacao, situacao: 'terminou', feitas: 40, acertos: 40 }, pode: true, motivo: null } };
        return responder(route, S.instrucoes);
      }
      if (p === '/distribuicao/mister/instrucoes/candidata') {
        S.instrucoes = { ...S.instrucoes, candidata: CANDIDATA({ avaliacao: null, pode: false, motivo: 'Rode a avaliação com a candidata antes de publicar.', melhoraram: [] }) };
        return responder(route, { id: 'k-1', versao: '7c21d0b9' }, 201);
      }
      if (p === '/distribuicao/mister/instrucoes/volta') {
        S.instrucoes = { ...S.instrucoes, candidata: CANDIDATA({ id: 'k-2', tipo: 'volta', versao: '3e90b2c4', sai: TROCA_PUBLICADA.entra, entra: TROCA_PUBLICADA.sai, porque: 'voltar ao texto de antes da última troca', avaliacao: null, pode: false, motivo: 'Rode a avaliação com a candidata antes de publicar.', melhoraram: [] }) };
        return responder(route, { id: 'k-2', versao: '3e90b2c4' }, 201);
      }
      if (p === '/distribuicao/mister/instrucoes/avaliar') {
        S.leiturasAvaliando = 0;
        S.instrucoes = { ...S.instrucoes, candidata: { ...S.instrucoes.candidata, avaliacao: { id: 'av-k2', situacao: 'rodando', total: 40, feitas: 12, acertos: 12, custoUsd: null, iniciadaEm: '2026-11-16T12:50:00Z' }, pode: false } };
        return responder(route, { id: 'av-k2', total: 40 }, 201);
      }
      if (p === '/distribuicao/mister/instrucoes/publicar') {
        const c = S.instrucoes.candidata;
        S.instrucoes = { ...S.instrucoes, noAr: { ...S.instrucoes.noAr, versao: c.versao, desde: '2026-11-16T13:00:00Z', por: 'Rodrigo' }, candidata: null, publicadas: [{ ...TROCA_PUBLICADA, ultima: false }, { id: c.id, sai: c.sai, entra: c.entra, publicadaEm: '2026-11-16T13:00:00Z', publicadaPor: 'Rodrigo', ultima: true }] };
        return responder(route, { id: c.id, tipo: c.tipo, versao: c.versao }, 201);
      }
      if (p === '/distribuicao/mister/instrucoes/descartar') {
        const c = S.instrucoes.candidata;
        S.instrucoes = { ...S.instrucoes, candidata: null };
        return responder(route, { id: c?.id }, 201);
      }
      // S2: a análise com IA — rodar passa a "rodando"; a 2ª leitura dela já traz a rodada nova terminada; decidir grava.
      if (p === '/distribuicao/mister/seguranca/analise' && metodo === 'GET') {
        if (S.analise.analise?.situacao === 'rodando' && ++S.leiturasRodando >= 2)
          S.analise = { ...S.analise, analise: { ...S.analise.analise, situacao: 'terminou', eventos: 1301, custoUsd: 0.03, terminadaEm: '2026-11-16T12:00:20Z' }, propostas: PROPOSTAS_DA_ANALISE().slice(0, 1) };
        return responder(route, S.analise);
      }
      if (p === '/distribuicao/mister/seguranca/analise' && metodo === 'POST') {
        S.leiturasRodando = 0;
        S.analise = { ...S.analise, analise: { id: 'a-2', situacao: 'rodando', pedidaPor: 'Rodrigo', dias: 7, eventos: 0, custoUsd: null, motivo: null, iniciadaEm: '2026-11-16T12:00:00Z', terminadaEm: null }, propostas: [] };
        return responder(route, { id: 'a-2' }, 201);
      }
      if (p === '/distribuicao/mister/seguranca/analise/decisao') {
        const c = JSON.parse(req.postData() || '{}');
        S.analise = { ...S.analise, propostas: S.analise.propostas.map((x) => (x.id === c.id ? { ...x, situacao: c.decisao, tarefa: c.decisao === 'tarefa' ? c.tarefa || null : null, decididaPor: 'Rodrigo', decididaEm: '2026-11-16T12:05:00Z' } : x)) };
        return responder(route, { id: c.id, situacao: c.decisao, tarefa: c.tarefa || null }, 201);
      }
      if (p === '/distribuicao/mister/seguranca') {
        if (S.falhaDaSeguranca) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        const dias = Number(url.searchParams.get('dias')) === 30 ? 30 : 7;
        return responder(route, { ...S.seguranca, dias, ...(dias === 30 ? { limite: 7 } : {}) });
      }
      // M2a: as decisões do "O que melhorar" — o servidor de mentira grava e a leitura seguinte já traz a situação nova.
      if (p === '/distribuicao/mister/qualidade/decisao') {
        const c = JSON.parse(req.postData() || '{}');
        S.qualidade = {
          ...S.qualidade,
          melhorar: (S.qualidade.melhorar ?? []).map((x) =>
            x.chave === c.chave ? { ...x, situacao: c.decisao, decisao: { chave: c.chave, decisao: c.decisao, motivo: c.motivo || null, tarefa: c.tarefa || null, quem: 'Rita', decididaEm: '2026-11-16T12:00:00Z', valeAte: c.decisao === 'nao_se_aplica' ? '2026-12-16T12:00:00Z' : null } } : x,
          ),
        };
        return responder(route, { chave: c.chave, decisao: c.decisao });
      }
      if (p === '/distribuicao/mister/qualidade/desfazer') {
        const c = JSON.parse(req.postData() || '{}');
        S.qualidade = { ...S.qualidade, melhorar: (S.qualidade.melhorar ?? []).map((x) => (x.chave === c.chave ? { ...x, situacao: 'aberto', decisao: null } : x)) };
        return responder(route, { ok: true });
      }
      if (p === '/distribuicao/mister/qualidade') {
        if (S.falhaDaQualidade) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        const dias = Number(url.searchParams.get('dias')) === 30 ? 30 : 7;
        return responder(route, { ...S.qualidade, dias, perguntas: dias === 30 ? S.qualidade.perguntas * 3 : S.qualidade.perguntas });
      }
      // A conferência dos aparelhos (versão 6, M6.0): desligada e sem telefones. Sem ela, o `[]` do fim derrubava a aba inteira
      // ("Algo deu errado"): o roteiro tinha ficado para trás quando o quadro entrou.
      if (p === '/distribuicao/mister/aparelho' && route.request().method() === 'GET')
        return responder(route, { disponivel: true, ligado: false, em: null, por: null, vistos: 0, mudaram: 0, telefones: [] });
      // A avaliação (F5.3): a rodada pedida anda 20 perguntas a cada leitura, até as 40.
      if (p === '/distribuicao/mister/avaliacoes' && route.request().method() === 'POST') {
        S.avaliacoes.rodadas.unshift(RODADA({ id: 'av3', situacao: 'rodando', iniciadaEm: new Date().toISOString(), terminadaEm: null, feitas: 0, acertos: 0, custoUsd: null }));
        return responder(route, { id: 'av3', total: 40 });
      }
      if (p === '/distribuicao/mister/avaliacoes') {
        if (S.falhaDasAvaliacoes) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        S.avaliacoes.rodadas = S.avaliacoes.rodadas.map((r) => (r.situacao !== 'rodando' ? r : r.feitas + 20 >= 40 ? { ...r, situacao: 'terminou', feitas: 40, acertos: 40, custoUsd: 0.0405 } : { ...r, feitas: r.feitas + 20, acertos: r.acertos + 20 }));
        return responder(route, S.avaliacoes);
      }
      if (/^\/distribuicao\/mister\/avaliacoes\/[^/]+$/.test(p)) {
        const r = S.avaliacoes.rodadas.find((x) => x.id === p.split('/').pop());
        return responder(route, { ...r, casos: CASOS_DA_RODADA.slice(0, r?.feitas ?? 0) });
      }
      // O resto do console (frota, licenças, auditoria…) não é deste roteiro: listas vazias.
      return responder(route, []);
    });
    await page.goto(base + '/distribuicao');
    return { ctx, page, erros, S };
  }
  const feitos = (S, metodo, p) => S.pedidos.filter((x) => x.metodo === metodo && x.p === p);
  const naAba = async (page) => {
    await page.click('nav button:has-text("Mister")');
    await page.waitForSelector('h2:has-text("Número do Mister")', { timeout: 20000 });
  };

  // ── a aba é da Diretoria: o técnico não a vê e o painel do Mister nem é pedido ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { token: TECNICO });
    await page.waitForSelector('nav button:has-text("Frota")', { timeout: 20000 });
    ok((await page.locator('nav button:has-text("Mister")').count()) === 0, 'perfil técnico: a aba Mister não aparece');
    ok(S.pedidos.length === 0, 'perfil técnico: o painel do Mister não é pedido');
    await ctx.close();
  }

  // ── não conectado → coexistência: escolher a forma libera o botão; conectar não liga a chave geral ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { avisos: ['A Meta recusou um passo da coexistência (history: fora do prazo). Se não for refeito em 24 horas, ela desfaz a conexão: conecte de novo.'] });
    await naAba(page);
    await page.waitForSelector('text=○ não conectado');
    const conectar = page.locator('button:has-text("Conectar com a Meta")');
    ok(await conectar.isDisabled(), 'não conectado: "Conectar com a Meta" começa travado');
    const opcao = (t) => page.locator(`button[aria-pressed]:has-text("${t}")`);
    await opcao('Continua no WhatsApp Business do celular').click();
    ok((await opcao('Continua no WhatsApp Business do celular').getAttribute('aria-pressed')) === 'true' && (await opcao('Só na API oficial').getAttribute('aria-pressed')) === 'false', 'a forma escolhida fica marcada');
    await page.waitForSelector('text=versão 2.24.17 ou mais nova');
    ok((await page.locator('input[inputmode="numeric"]').count()) === 0, 'coexistência: não pede PIN');
    ok(await conectar.isEnabled(), 'com a forma escolhida, o botão libera');
    await conectar.click();
    await page.waitForSelector('text=● conectado');
    const [envio] = feitos(S, 'POST', '/distribuicao/mister/numero/conectar');
    ok(envio && envio.corpo.forma === 'coexistencia' && envio.corpo.code === 'codigo-da-meta' && !('pin' in envio.corpo), `coexistência: vai a forma e o código da Meta, sem PIN (${JSON.stringify(envio?.corpo)})`);
    const janela = await page.evaluate(() => window.__janelaDaMeta);
    ok(janela?.config_id === '222' && janela?.extras?.featureType === 'whatsapp_business_app_onboarding', 'a janela da Meta abre no caminho da coexistência');
    await page.waitForSelector('[role="alert"]:has-text("A Meta recusou um passo da coexistência")');
    ok(true, 'o aviso da Meta aparece para a distribuição');
    await page.waitForSelector('text=Conectar não liga o Mister');
    ok(/Liberação:\s*desligada/.test(await page.locator('section[aria-labelledby="mister-geral"]').innerText()), 'conectar o número não liga a chave geral');
    ok(feitos(S, 'POST', '/distribuicao/mister/liberacao').length === 0, 'nenhuma chamada à chave geral ao conectar');
    const cartao = await page.locator('section[aria-labelledby="mister-numero"]').innerText();
    ok(/\+55 21 90000-0000/.test(cartao) && /Mister/.test(cartao) && /Coexistência \(celular e API\)/.test(cartao) && /alta/.test(cartao) && /até 2\.000 pessoas/.test(cartao), 'conectado: número, nome, forma, qualidade e avisos por dia');
    ok(/a cada 14 dias/.test(cartao), 'coexistência: o aviso dos 14 dias');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── só na API: pede o PIN de seis dígitos e só ele libera; a janela abre sem o caminho da coexistência ──
  {
    const { ctx, page, S } = await abrir(1280, 900);
    await naAba(page);
    await page.locator('button[aria-pressed]:has-text("Só na API oficial")').click();
    const pin = page.locator('input[inputmode="numeric"]');
    await pin.waitFor();
    const conectar = page.locator('button:has-text("Conectar com a Meta")');
    ok(await conectar.isDisabled(), 'só na API: sem PIN o botão fica travado');
    await pin.fill('12a45');
    ok((await pin.inputValue()) === '1245' && (await conectar.isDisabled()), 'só na API: letra não entra e PIN curto não libera');
    await pin.fill('123456789');
    ok((await pin.inputValue()) === '123456' && (await conectar.isEnabled()), 'só na API: seis dígitos liberam (o sétimo não entra)');
    await conectar.click();
    await page.waitForSelector('text=● conectado');
    const [envio] = feitos(S, 'POST', '/distribuicao/mister/numero/conectar');
    ok(envio?.corpo.forma === 'api' && envio.corpo.pin === '123456', 'só na API: o PIN vai junto');
    ok((await page.evaluate(() => window.__janelaDaMeta?.extras?.featureType)) === '', 'só na API: a janela abre sem o caminho da coexistência');
    ok(/Só a API oficial/.test(await page.locator('section[aria-labelledby="mister-numero"]').innerText()) && (await page.locator('text=a cada 14 dias').count()) === 0, 'só na API: sem o aviso dos 14 dias');
    await ctx.close();
  }

  // ── a janela fechada sem concluir e a recusa do servidor: nada muda ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { janelaFechada: true });
    await naAba(page);
    await page.locator('button[aria-pressed]:has-text("Continua no WhatsApp Business do celular")').click();
    await page.click('button:has-text("Conectar com a Meta")');
    await page.waitForSelector('[role="alert"]:has-text("A janela da Meta foi fechada antes de concluir")');
    ok(feitos(S, 'POST', '/distribuicao/mister/numero/conectar').length === 0 && (await page.locator('text=○ não conectado').count()) === 1, 'janela fechada: nada vai ao servidor e o número segue não conectado');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { recusa: 'Este número já é o WhatsApp de uma loja (Burger da Praça). O número do Mister precisa ser só dele.' });
    await naAba(page);
    await page.locator('button[aria-pressed]:has-text("Continua no WhatsApp Business do celular")').click();
    await page.click('button:has-text("Conectar com a Meta")');
    await page.waitForSelector('[role="alert"]:has-text("já é o WhatsApp de uma loja")');
    ok((await page.locator('text=○ não conectado').count()) === 1, 'recusa do servidor: a frase dele aparece e o número segue não conectado');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { cadastro: { ...CADASTRO, pronto: false } });
    await naAba(page);
    await page.locator('button[aria-pressed]:has-text("Continua no WhatsApp Business do celular")').click();
    await page.waitForSelector('text=ainda não está configurado neste servidor');
    ok(await page.locator('button:has-text("Conectar com a Meta")').isDisabled(), 'servidor sem o cadastro da Meta: avisa e não deixa conectar');
    await ctx.close();
  }

  // ── a chave geral: ligar é direto; desligar pede confirmação, Esc cancela ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { numero: conectado(), liberado: false });
    await naAba(page);
    const geral = page.locator('section[aria-labelledby="mister-geral"]');
    await page.waitForSelector('text=o Mister só responde depois de ligado aqui');
    await geral.locator('button:has-text("Ligar o Mister")').click();
    await page.waitForSelector('text=Mister ligado nesta nuvem.');
    ok(feitos(S, 'POST', '/distribuicao/mister/liberacao')[0]?.corpo.ligado === true && /Liberação:\s*ligada/.test(await geral.innerText()), 'ligar: vai "ligado: true" e a tela mostra ligada');
    await geral.locator('button:has-text("Desligar o Mister")').click();
    const dialogo = page.locator('[role="alertdialog"]');
    await dialogo.waitFor();
    ok(/Vale para todas as empresas, na hora/.test(await dialogo.innerText()), 'desligar: o diálogo diz o alcance');
    ok(await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Cancelar'), 'desligar: o foco começa em "Cancelar"');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    ok(await page.evaluate(() => !!document.activeElement?.closest('[role="alertdialog"]')), 'desligar: o Tab não sai do diálogo');
    await page.keyboard.press('Escape');
    await dialogo.waitFor({ state: 'detached' });
    ok(feitos(S, 'POST', '/distribuicao/mister/liberacao').length === 1, 'desligar: Esc cancela, sem chamada');
    await geral.locator('button:has-text("Desligar o Mister")').click();
    await dialogo.locator('button:has-text("Desligar o Mister")').click();
    await page.waitForSelector('text=Mister desligado nesta nuvem.');
    ok(feitos(S, 'POST', '/distribuicao/mister/liberacao')[1]?.corpo.ligado === false && /Liberação:\s*desligada/.test(await geral.innerText()), 'desligar confirmado: vai "ligado: false"');
    // desconectar o número
    await page.click('button:has-text("Desconectar")');
    await dialogo.waitFor();
    ok(/As pessoas ligadas continuam ligadas/.test(await dialogo.innerText()), 'desconectar: o diálogo diz o que acontece com quem está ligado');
    await dialogo.locator('button:has-text("Cancelar")').click();
    await dialogo.waitFor({ state: 'detached' });
    ok(feitos(S, 'POST', '/distribuicao/mister/numero/desconectar').length === 0, 'desconectar: "Cancelar" não chama o servidor');
    await page.click('button:has-text("Desconectar")');
    await dialogo.locator('button:has-text("Desconectar")').click();
    await page.waitForSelector('text=○ não conectado');
    ok(feitos(S, 'POST', '/distribuicao/mister/numero/desconectar').length === 1, 'desconectar confirmado: o número volta a não conectado');
    await ctx.close();
  }

  // ── o número que caiu: o motivo e reconectar já com a forma de antes ──
  {
    const { ctx, page } = await abrir(1280, 900, { numero: CAIU, liberado: true });
    await naAba(page);
    await page.waitForSelector('text=● desconectado pela Meta');
    const cartao = await page.locator('section[aria-labelledby="mister-numero"]').innerText();
    ok(/deixou de reconhecer o número em 10\/11: Object with ID does not exist/.test(cartao) && /nada sai até reconectar/.test(cartao), 'caiu: a data, o motivo da Meta e a consequência');
    await page.click('button:has-text("Reconectar com a Meta")');
    ok((await page.locator('button[aria-pressed]:has-text("Continua no WhatsApp Business do celular")').getAttribute('aria-pressed')) === 'true', 'reconectar: a forma de antes já vem marcada');
    ok(await page.locator('button:has-text("Conectar com a Meta")').isEnabled(), 'reconectar: dá para conectar em seguida');
    await ctx.close();
  }

  // ── os modelos de mensagem: a situação lida, o pedido uma vez só, o aprovado e o recusado, sem número e o erro ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { numero: conectado(), liberado: true });
    await naAba(page);
    const bloco = page.locator('section[aria-labelledby="mister-modelos"]');
    await bloco.locator('text=ainda não pedido').first().waitFor({ timeout: 20000 });
    const texto = await bloco.innerText();
    ok(/mister_aviso/.test(texto) && /mister_resumo_pronto/.test(texto) && /Aviso do Mister para \{\{1\}\}: \{\{2\}\}/.test(texto) && /Botão: Ver o que fazer/.test(texto) && /Botão: Ver resumo/.test(texto), 'os dois modelos com o texto e o botão');
    const pedir = bloco.locator('button:has-text("Pedir aprovação à Meta")');
    ok(await pedir.isEnabled(), 'ainda não pedidos: "Pedir aprovação à Meta" liberado');
    await pedir.click();
    await bloco.locator('[role="status"]:has-text("Pedido enviado à Meta")').waitFor();
    ok(feitos(S, 'POST', '/distribuicao/mister/modelos/pedir').length === 1, 'o pedido vai ao servidor uma vez');
    ok((await bloco.locator('text=em análise na Meta').count()) === 2 && (await pedir.isDisabled()), 'depois do pedido: os dois em análise e o botão travado (nada mais a pedir)');
    // "Atualizar situação" com a situação igual: mostra que leu (o clique não pode parecer sem efeito).
    S.atrasoDosModelos = 900;
    const atualizar = bloco.locator('button:has-text("Atualizar situação"), button:has-text("Lendo na Meta")');
    await atualizar.click();
    await bloco.locator('button:has-text("Lendo na Meta…")').waitFor({ timeout: 3000 });
    ok(await bloco.locator('button:has-text("Lendo na Meta…")').isDisabled(), 'atualizar: enquanto lê, o botão diz "Lendo na Meta…" e trava');
    await bloco.locator('[role="status"]:has-text("Lido na Meta às")').waitFor({ timeout: 5000 });
    ok(/Lido na Meta às \d{2}:\d{2}\. A Meta ainda está analisando/.test(await bloco.locator('[role="status"]:has-text("Lido na Meta")').innerText()), 'atualizar: depois de ler, diz a hora da leitura e que a Meta ainda analisa');
    S.atrasoDosModelos = 0;
    S.modelos = MODELOS_LONGOS;
    await bloco.locator('button:has-text("Atualizar situação")').click();
    await bloco.locator('text=recusado pela Meta').waitFor();
    const depois = await bloco.innerText();
    ok(/aprovado/.test(depois) && /classificou como marketing/.test(depois) && /Motivo da recusa: INVALID_FORMAT/.test(depois), 'atualizar: o aprovado (com a categoria trocada) e o recusado com o motivo');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900);
    await naAba(page);
    const bloco = page.locator('section[aria-labelledby="mister-modelos"]');
    await bloco.locator('text=Conecte o número do Mister para pedir os modelos.').waitFor({ timeout: 20000 });
    ok(await bloco.locator('button:has-text("Pedir aprovação à Meta")').isDisabled(), 'sem número: avisa e não deixa pedir');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { numero: conectado(), falhaDosModelos: true });
    await naAba(page);
    await page.locator('section[aria-labelledby="mister-modelos"] [role="alert"]:has-text("Erro interno")').waitFor({ timeout: 20000 });
    ok((await page.locator('text=● conectado').count()) === 1, 'erro só nos modelos: o número continua na tela');
    await ctx.close();
  }

  // ── a aba Avisos (F1.4 parte B): Diretoria e Técnico; abertos e resolvidos nas 24 h, a busca, o vazio e o erro ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { token: TECNICO });
    await page.waitForSelector('nav button:has-text("Frota")', { timeout: 20000 });
    ok((await page.locator('nav button:has-text("Avisos")').count()) === 1, 'perfil técnico: a aba Avisos aparece (é o suporte)');
    await page.click('nav button:has-text("Avisos")');
    const sec = page.locator('section[aria-labelledby="avisos-suporte"]');
    await sec.locator('text=Burger da Praça').first().waitFor({ timeout: 20000 });
    const t = (await sec.innerText()).replace(/\s+/g, ' ');
    ok(/Abertos ?2/.test(t) && /Resolvidos nas últimas 24 h ?1/.test(t), `avisos: as situações com a quantidade (${t.slice(0, 160)})`);
    ok(/disco do servidor quase cheio/.test(t) && /escalou/.test(t) && /Unidade Serra/.test(t), 'avisos: a empresa, a loja, o aviso e o que escalou');
    await sec.locator('button[aria-pressed]:has-text("Resolvidos")').click();
    await sec.locator('text=resolvido às').first().waitFor();
    ok(feitos(S, 'GET', '/distribuicao/mister/avisos').length >= 2 && /cópia de segurança atrasada/.test(await sec.innerText()), 'avisos: trocar a situação lê de novo no servidor');
    await sec.locator('input[type="search"]').fill('zzz');
    await sec.locator('text=Nenhuma empresa com esse nome.').waitFor();
    ok(true, 'avisos: busca sem resultado');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { falhaDosAvisos: true });
    await page.click('nav button:has-text("Avisos")');
    await page.locator('section[aria-labelledby="avisos-suporte"] [role="alert"]:has-text("Erro interno")').waitFor({ timeout: 20000 });
    ok((await page.locator('section[aria-labelledby="avisos-suporte"] button:has-text("Tentar de novo")').count()) === 1, 'avisos: o erro com "Tentar de novo"');
    await ctx.close();
  }
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900);
    await page.click('nav button:has-text("Avisos")');
    await page.locator('section[aria-labelledby="avisos-suporte"] >> text=Burger da Praça >> visible=true').first().waitFor({ timeout: 20000 });
    const m = await medir(page);
    ok(m.length === 0, `${w}px: a aba Avisos sem barra lateral e nada passando da tela (${m.join(' | ')})`);
    if (w === 375 || w === 1440) await page.screenshot({ path: foto(`${w}-avisos.png`), fullPage: true });
    ok(erros.length === 0, `${w}px: avisos sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── as dependências (F3, parte 2): situações, filtro, busca, a gaveta com o antes e o depois, a decisão, ler agora ──
  {
    const { ctx, page, S, erros } = await abrir(1280, 900, { token: TECNICO });
    await page.locator('nav button:has-text("Dependências")').waitFor({ timeout: 20000 });
    ok((await page.locator('nav button:has-text("Dependências")').count()) === 1, 'dependências: o técnico vê a aba');
    await page.click('nav button:has-text("Dependências")');
    const sec = page.locator('section[aria-labelledby="dependencias-titulo"]');
    await sec.locator('table >> text=WhatsApp · API oficial da Meta').waitFor({ timeout: 20000 });
    const chip = async (rotulo) => (await sec.locator(`[role="group"][aria-label="Situação"] button:has-text("${rotulo}")`).innerText()).replace(/\s+/g, ' ');
    // O número fica colado no rótulo no innerText (o espaço é só a margem): "Todas6".
    ok(/Todas ?6/.test(await chip('Todas')) && /A conferir ?2/.test(await chip('A conferir')) && /Vencidas ou vencendo ?1/.test(await chip('Vencidas ou vencendo')) && /Não verificadas ?1/.test(await chip('Não verificadas')) && /Conferir à mão ?1/.test(await chip('Conferir à mão')), 'dependências: as situações com a quantidade');
    const t = (await sec.innerText()).replace(/\s+/g, ' ');
    ok(/Graph API v25\.0: mensagens/.test(t) && /não verificada desde 12\/11/.test(t) && /conferir à mão/.test(t) && /vencida ou vencendo/.test(t), 'dependências: a versão em uso e cada situação');
    await sec.locator('button:has-text("A conferir")').click();
    ok((await sec.locator('table tbody tr').count()) === 2, 'dependências: "A conferir" filtra 2');
    await sec.locator('input[type="search"]').fill('zzz');
    await sec.locator('text=Nenhuma integração com esses filtros.').waitFor();
    await sec.locator('input[type="search"]').fill('');
    await sec.locator('button:has-text("Todas")').click();
    // A gaveta da Anthropic: o antes e o depois; "não se aplica" só com a nota.
    await sec.locator('tr:has-text("Anthropic") button:has-text("Ver")').click();
    const g = page.locator('[role="dialog"]');
    await g.waitFor();
    const tg = (await g.innerText()).replace(/\s+/g, ' ');
    // Os títulos são em caixa alta pelo CSS (o innerText devolve "O QUE MUDOU"): a conferência não diferencia.
    ok(/O que mudou/i.test(tg) && /Antes claude-sonnet-4-5-20250929 \| Active/i.test(tg) && /Depois claude-sonnet-4-5-20250929 \| Deprecated/i.test(tg), `dependências: a gaveta com o antes e o depois (${tg.slice(0, 120)})`);
    ok(await g.locator('button:has-text("Não se aplica ao Regem")').isDisabled(), 'dependências: "não se aplica" pede a nota');
    await g.locator('textarea').fill('Trocar o modelo do copiloto no PR da semana.');
    await g.locator('button:has-text("Marcar como conferida")').click();
    await g.locator('text=Marcada como conferida.').waitFor();
    const dec = feitos(S, 'POST', '/distribuicao/dependencias/anthropic-modelos/decisao');
    ok(dec.length === 1 && dec[0].corpo?.decisao === 'conferida' && /Trocar o modelo/.test(dec[0].corpo?.nota ?? ''), 'dependências: a decisão vai ao servidor com a nota');
    await page.keyboard.press('Escape');
    await g.waitFor({ state: 'detached' });
    // Ler agora: o resultado de cada fonte.
    await sec.locator('button:has-text("Ler agora")').click();
    await sec.locator('text=Leitura feita: 1 de 2 fontes lidas, 1 sem resposta.').waitFor();
    ok(feitos(S, 'POST', '/distribuicao/dependencias/ler-agora').length === 1, 'dependências: "Ler agora" lê as fontes no servidor');
    ok(erros.length === 0, `dependências: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { dependencias: { ...DEPENDENCIAS(), semMigration: true } });
    await page.click('nav button:has-text("Dependências")');
    await page.locator('text=migration 423').waitFor({ timeout: 20000 });
    ok(await page.locator('section[aria-labelledby="dependencias-titulo"] button:has-text("Ler agora")').isDisabled(), 'dependências: sem a migration, avisa e "Ler agora" fica desligado');
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { falhaDasDependencias: true });
    await page.click('nav button:has-text("Dependências")');
    const sec = page.locator('section[aria-labelledby="dependencias-titulo"]');
    await sec.locator('[role="alert"] >> text=Erro interno').waitFor({ timeout: 20000 });
    S.falhaDasDependencias = false;
    await sec.locator('button:has-text("Tentar de novo")').click();
    await sec.locator('text=WhatsApp · API oficial da Meta').first().waitFor();
    ok(true, 'dependências: o erro com "Tentar de novo" lê de novo');
    await ctx.close();
  }
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900);
    await page.click('nav button:has-text("Dependências")');
    const sec = page.locator('section[aria-labelledby="dependencias-titulo"]');
    await sec.locator('text=WhatsApp · API oficial da Meta >> visible=true').first().waitFor({ timeout: 20000 });
    let m = await medir(page);
    ok(m.length === 0, `${w}px: a aba Dependências sem barra lateral e nada passando da tela (${m.join(' | ')})`);
    const tabela = await sec.locator('table').isVisible();
    ok(w >= 1024 ? tabela : !tabela, `${w}px: dependências em ${w >= 1024 ? 'tabela' : 'cartões'}`);
    await sec.locator('button:has-text("Ver") >> visible=true').nth(3).click();
    await page.locator('[role="dialog"]').waitFor();
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta da dependência inteira na tela (${m.join(' | ')})`);
    if (w === 375 || w === 1440) await page.screenshot({ path: foto(`${w}-dependencias-gaveta.png`) });
    await page.keyboard.press('Escape');
    if (w === 375 || w === 1440) await page.screenshot({ path: foto(`${w}-dependencias.png`), fullPage: true });
    ok(erros.length === 0, `${w}px: dependências sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── as empresas: rótulos, busca no servidor (só a resposta mais nova vale), vazio, teto e erro ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { numero: conectado(), liberado: true, total: 250, atrasoDaBusca: { p: 900 } });
    await naAba(page);
    const lista = page.locator('section[aria-labelledby="mister-empresas"]');
    await lista.locator('table >> text=Burger da Praça').waitFor();
    const linhas = await lista.locator('tbody tr').allInnerTexts();
    const linha = (nome) => (linhas.find((l) => l.includes(nome)) ?? '').replace(/\s+/g, ' ');
    ok(/ligado chave própria · Anthropic 3 US\$ 10,23 funcionando/.test(linha('Burger da Praça')), `empresa funcionando (${linha('Burger da Praça')})`);
    ok(/IA parada · sem crédito/.test(linha('Pizzaria do Porto')) && /US\$ 2,10/.test(linha('Pizzaria do Porto')), 'empresa com a IA parada diz o porquê');
    ok(/sem chave 0 US\$ 0,00 falta a chave e ligar o WhatsApp/.test(linha('Empório')), 'empresa sem chave e sem ninguém ligado');
    ok(/desligado IA incluída pela Regem 0 sem preço módulo desligado/.test(linha('Cantina Bella')), `empresa com o módulo desligado; uso sem preço não vira zero (${linha('Cantina Bella')})`);
    ok(/Mostrando 4 de 250 empresas/.test(await lista.innerText()), 'teto de linhas: diz quantas há e manda usar a busca');
    ok((await lista.locator('caption').count()) === 1, 'a tabela tem legenda para leitor de tela');
    // A busca "p" demora e acha TRÊS empresas; a "cantina" responde antes e acha uma. Vale a mais nova, mesmo a antiga
    // chegando depois — se a antiga valesse, a tela voltaria a três linhas.
    const busca = lista.locator('input[type="search"]');
    await busca.fill('p');
    await page.waitForTimeout(450);
    await busca.fill('cantina');
    await page.waitForTimeout(1500);
    const pedidas = feitos(S, 'GET', '/distribuicao/mister/empresas').map((x) => x.busca);
    ok(pedidas.includes('p') && pedidas.at(-1) === 'cantina', `a busca vai ao servidor, um instante depois de parar de digitar (${pedidas.join(',')})`);
    ok(feitos(S, 'GET', '/distribuicao/mister').length === 1, 'a busca não relê o número (o servidor só pergunta à Meta ao abrir o painel)');
    const depois = await lista.locator('tbody tr').allInnerTexts();
    ok(depois.length === 1 && depois[0].includes('Cantina Bella'), `só a resposta da busca mais nova vale (${depois.length} linhas)`);
    await busca.fill('zzz');
    await lista.locator('text=Nenhuma empresa com esse nome.').waitFor();
    ok((await lista.locator('table').count()) === 0, 'busca sem resultado: a frase, sem tabela vazia');
    S.falhaDaLista = true;
    await busca.fill('burger');
    await lista.locator('[role="alert"] >> text=Erro interno').waitFor();
    S.falhaDaLista = false;
    await lista.locator('button:has-text("Tentar de novo")').click();
    await lista.locator('table >> text=Burger da Praça').waitFor();
    ok((await page.locator('text=● conectado').count()) === 1, 'erro só na lista: o número continua na tela, e "Tentar de novo" lê a lista de novo');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { falha: true });
    await page.click('nav button:has-text("Mister")');
    await page.waitForSelector('[role="alert"] >> text=Erro interno');
    ok((await page.locator('button:has-text("Tentar de novo")').count()) === 1, 'painel que não carrega: avisa, com "Tentar de novo"');
    await ctx.close();
  }

  // ── a qualidade (F5, parte 1): os números, 7 e 30 dias, o vazio e o erro ──
  {
    const { ctx, page, S, erros } = await abrir(1280, 900, { numero: conectado(), liberado: true });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-qualidade"]');
    await sec.locator('text=395 de 412').waitFor({ timeout: 20000 });
    const t = (await sec.innerText()).replace(/\s+/g, ' ');
    // O rótulo é em caixa alta pelo CSS (o innerText devolve "PERGUNTAS"): a conferência não diferencia.
    ok(/Perguntas 412 3 empresas · 9 pessoas/i.test(t) && /Respondidas 96% 395 de 412/i.test(t), `qualidade: perguntas e respondidas (${t.slice(0, 140)})`);
    ok(/metade em até 6 s · 90% em até 14,2 s/.test(t) && /US\$ 0,0011/.test(t), 'qualidade: o tempo e o custo por pergunta');
    ok(/resumo do dia 31%/.test(t) && /historia do pedido · 2 sem ler 9%/.test(t), 'qualidade: as consultas mais usadas, com as que não leram');
    ok(/Por que não respondeu · 17/.test(t) && /a chave de IA da empresa foi recusada 6/.test(t), 'qualidade: por que não respondeu');
    ok(/"Não tenho acesso" 19 5% das perguntas/i.test(t) && /395 de 412 · 23 sem consultar dado/.test(t), `qualidade: "não tenho acesso" e as sem consulta (${t.slice(0, 260)})`);
    ok(/O que pediram e o Mister não tem · 19/.test(t) && /estoque e compras 8/.test(t) && /outro assunto 5/.test(t), 'qualidade: o que faltou, por tema');
    ok(
      /O que melhorar · 2 padrões nos últimos 7 dias/.test(t) && /"estoque e compras" faltou 8 vezes, em 3 empresas \(o que mais faltou\) falta consulta nenhuma consulta do Mister traz esse dado Proposta Consulta nova de estoque e compras · abrir tarefa/i.test(t) && /erro na consulta a mesma consulta falhando mais de 10%/i.test(t),
      `qualidade: o que melhorar, com a observação, a causa e a proposta (${t.slice(t.indexOf('O que melhorar'), t.indexOf('O que melhorar') + 260)})`,
    );
    ok(/Burger da Praça 318 perguntas 4 sem resposta US\$ 0,35 da empresa · ok/.test(t) && /Pizzaria do Porto .* recusada/.test(t) && /sem chave própria/.test(t), 'qualidade: por empresa, com a situação da chave');
    ok((await sec.locator('button[aria-pressed="true"]:has-text("7 dias")').count()) === 1, 'qualidade: 7 dias marcado');
    await sec.locator('button:has-text("30 dias")').click();
    await sec.locator('text=1.236').first().waitFor({ timeout: 10000 });
    ok(feitos(S, 'GET', '/distribuicao/mister/qualidade').length >= 2 && (await sec.locator('button[aria-pressed="true"]:has-text("30 dias")').count()) === 1, 'qualidade: 30 dias lê de novo no servidor');
    ok(erros.length === 0, `qualidade: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { numero: conectado(), liberado: true, qualidade: { ...QUALIDADE, perguntas: 0, respondidas: 0, falhas: 0, motivos: [], consultas: [], porEmpresa: [], tempo: null } });
    await naAba(page);
    await page.locator('section[aria-labelledby="mister-qualidade"] >> text=Nenhuma pergunta ao Mister neste período.').waitFor({ timeout: 20000 });
    ok(true, 'qualidade: o vazio diz que não houve pergunta');
    await ctx.close();
  }
  {
    // M2a (mig 432): as decisões do "O que melhorar" — as situações que filtram, "Não se aplica" com o motivo obrigatório
    // na gaveta, "Desfazer a decisão", e nada fora da janela no celular com a gaveta aberta.
    const melhorar = [
      { chave: 'falta:estoque e compras', causa: 'falta_consulta', observacao: '"estoque e compras" faltou 8 vezes, em 3 empresas (o que mais faltou)', porque: 'nenhuma consulta do Mister traz esse dado', proposta: 'Consulta nova de estoque e compras · abrir tarefa', situacao: 'aberto', decisao: null },
      {
        chave: 'consulta:historia do pedido', causa: 'erro_na_consulta', observacao: '"historia do pedido" não leu 5 vezes, de 37 (14%)', porque: 'a mesma consulta falhando mais de 10%', proposta: 'Ver o log das 5 falhas · abrir tarefa', situacao: 'tarefa',
        decisao: { chave: 'consulta:historia do pedido', decisao: 'tarefa', motivo: null, tarefa: 'DMS-412', quem: 'Rita', decididaEm: '2026-11-15T12:00:00Z', valeAte: null },
      },
    ];
    for (const w of [375, 1280]) {
      const { ctx, page, S, erros } = await abrir(w, 900, { numero: conectado(), liberado: true, qualidade: { ...QUALIDADE, melhorar } });
      await naAba(page);
      const card = page.locator('[data-o-que-melhorar]');
      await card.waitFor({ timeout: 20000 });
      const t0 = (await card.innerText()).replace(/\s+/g, ' ');
      ok(/Abertos 1/.test(t0) && /Virou tarefa 1/.test(t0) && /Não se aplica 0/.test(t0) && (await card.locator('[data-padrao]').count()) === 1, `${w} melhorar: as situações com as contagens, e só o aberto na lista (${t0.slice(0, 200)})`);
      await card.locator('button[aria-pressed]:has-text("Virou tarefa")').click();
      const t1 = (await card.innerText()).replace(/\s+/g, ' ');
      ok(/Em tarefa desde 15\/11 · Rita · DMS-412/.test(t1) && (await card.locator('button:has-text("Desfazer a decisão")').count()) === 1, `${w} melhorar: a situação "virou tarefa" com quem, quando e a tarefa`);
      await card.locator('button[aria-pressed]:has-text("Abertos")').click();
      await card.locator('[data-padrao] button:has-text("Não se aplica")').click();
      await page.waitForSelector('[data-gaveta-decisao]', { timeout: 5000 });
      const salvar = page.locator('[role="dialog"] button:has-text("Salvar a decisão")');
      ok(await salvar.isDisabled(), `${w} melhorar: "Salvar a decisão" trava sem o motivo`);
      const m = await medir(page);
      ok(m.length === 0, `${w} melhorar: com a gaveta aberta, nada fora da janela ${m.slice(0, 3).join(' | ')}`);
      await page.fill('#decisao-motivo', 'o aviso da chave já vai ao presidente dela');
      await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/qualidade/decisao')), salvar.click()]);
      const decisao = feitos(S, 'POST', '/distribuicao/mister/qualidade/decisao')[0];
      ok(JSON.stringify(decisao?.corpo) === JSON.stringify({ chave: 'falta:estoque e compras', decisao: 'nao_se_aplica', motivo: 'o aviso da chave já vai ao presidente dela', tarefa: '' }), `${w} melhorar: salvar manda o padrão, a decisão e o motivo (${JSON.stringify(decisao?.corpo)})`);
      await page.waitForSelector('text=Nenhum padrão nesta situação.', { timeout: 5000 }).catch(() => null);
      ok((await card.innerText()).includes('Nenhum padrão nesta situação.'), `${w} melhorar: depois de salvar, a lista relê e o padrão sai dos abertos`);
      await card.locator('button[aria-pressed]:has-text("Não se aplica")').click();
      await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/qualidade/desfazer')), card.locator('button:has-text("Desfazer a decisão")').click()]);
      ok(JSON.stringify(feitos(S, 'POST', '/distribuicao/mister/qualidade/desfazer')[0]?.corpo) === JSON.stringify({ chave: 'falta:estoque e compras' }), `${w} melhorar: "Desfazer a decisão" manda o padrão`);
      ok(erros.length === 0, `${w} melhorar: sem erro (${erros.join(' | ')})`);
      await ctx.close();
    }
  }
  {
    // A API de antes do deploy (sem os campos da F5.2): a seção abre, com zero e "Nada faltou neste período.".
    const { naoTem, temas, melhorar, ...semF52 } = QUALIDADE;
    const { ctx, page, erros } = await abrir(1280, 900, { numero: conectado(), liberado: true, qualidade: semF52 });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-qualidade"]');
    await sec.locator('text=Nada faltou neste período.').waitFor({ timeout: 20000 });
    const t = (await sec.innerText()).replace(/\s+/g, ' ');
    ok(/O que pediram e o Mister não tem · 0/.test(t) && /"Não tenho acesso" 0/i.test(t) && /O que melhorar · 0 padrões nos últimos 7 dias/.test(t) && /Nenhum padrão a melhorar neste período\./.test(t) && erros.length === 0, `qualidade: a API antiga, sem os campos novos, não quebra a seção (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { numero: conectado(), liberado: true, falhaDaQualidade: true });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-qualidade"]');
    await sec.locator('[role="alert"] >> text=Erro interno').waitFor({ timeout: 20000 });
    S.falhaDaQualidade = false;
    await sec.locator('button:has-text("Tentar de novo")').click();
    await sec.locator('text=395 de 412').waitFor({ timeout: 10000 });
    ok((await page.locator('text=● conectado').count()) === 1, 'qualidade: o erro só na seção, e "Tentar de novo" lê de novo');
    await ctx.close();
  }

  // ── a segurança (o Sentinela, parte 1): o pede atenção, os números, as barras, por empresa, 30 dias, o vazio e o erro ──
  {
    const { ctx, page, S, erros } = await abrir(1280, 900, { numero: conectado(), liberado: true });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-seguranca"]');
    await sec.locator('text=Pede atenção').waitFor({ timeout: 20000 });
    const t = (await sec.innerText()).replace(/\s+/g, ' ');
    ok(/Pede atenção · 2/.test(t) && /Conferir qual consulta trouxe esse dado: canais e integracoes · Pizzaria do Porto · 13\/11 21:04/.test(t) && /1 telefone foi calado por 1 hora/.test(t), `segurança: o pede atenção (${t.slice(0, 220)})`);
    ok(/Segredo tirado da resposta 1 o filtro tirou antes de sair/i.test(t) && /Código errado para ligar 14 de 3 telefones · 1 calado por 1 hora/i.test(t) && /Telefone não ligado 9 de 6 telefones/i.test(t) && /Limite de perguntas 1/i.test(t), 'segurança: os números, com quantos telefones (nunca quais)');
    ok(/link tirado 3/.test(t) && /segredo tirado 1/.test(t) && !/resposta vazia/.test(t) && /código que não vale 11/.test(t) && /códigos demais · calado por 1 hora 3/.test(t) && /número de outra pessoa 2/.test(t), 'segurança: as barras da saída e da entrada, sem as que deram zero');
    ok(/link com PIN bloqueado \(5 PIN errados\) · 1 empresa 2/.test(t), `segurança: os links com PIN bloqueados (F4.2a) na entrada, com quantas empresas (${t.slice(0, 200)})`);
    ok(/Pizzaria do Porto 4 no filtro de saída 1 segredo 3 perdeu o acesso/.test(t) && /Empório Sabor da Serra .* 1 no limite/.test(t), 'segurança: por empresa, com o segredo em destaque');
    await sec.locator('button:has-text("30 dias")').click();
    await sec.locator('text=Limite de perguntas').waitFor();
    await page.waitForFunction(() => /Limite de perguntas\s*7/i.test(document.querySelector('section[aria-labelledby="mister-seguranca"]')?.textContent ?? ''), null, { timeout: 10000 });
    ok(feitos(S, 'GET', '/distribuicao/mister/seguranca').length >= 2, 'segurança: 30 dias lê de novo no servidor');
    ok(erros.length === 0, `segurança: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const zero = { ...SEGURANCA, saida: SEGURANCA.saida.map((s) => ({ ...s, quantas: 0 })), entrada: { codigoNaoVale: 0, codigosDemais: 0, codigoCalado: 0, codigoErrado: { quantas: 0, telefones: 0, calados: 0 }, outraPessoa: 0, perdeuOAcesso: 0, naoLigado: { quantas: 0, telefones: 0 } }, segredos: 0, limite: 0, linksComPin: { bloqueados: 0, empresas: 0 }, atencao: [], porEmpresa: [] };
    const { ctx, page } = await abrir(1280, 900, { numero: conectado(), liberado: true, seguranca: zero });
    await naAba(page);
    await page.locator('section[aria-labelledby="mister-seguranca"] >> text=Nada barrado ou recusado neste período.').waitFor({ timeout: 20000 });
    ok(true, 'segurança: o vazio diz que nada foi barrado');
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { numero: conectado(), liberado: true, falhaDaSeguranca: true });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-seguranca"]');
    await sec.locator('[role="alert"] >> text=Erro interno').waitFor({ timeout: 20000 });
    S.falhaDaSeguranca = false;
    await sec.locator('button:has-text("Tentar de novo")').click();
    await sec.locator('text=Pede atenção').waitFor({ timeout: 10000 });
    ok((await page.locator('section[aria-labelledby="mister-qualidade"] >> text=395 de 412').count()) === 1, 'segurança: o erro só na seção, e "Tentar de novo" lê de novo');
    await ctx.close();
  }

  // ── a avaliação de regressão (F5.3): as rodadas, "o que falhou", a gaveta com as 40, rodar e o andamento ──
  {
    const { ctx, page, S, erros } = await abrir(1280, 900, { numero: conectado(), liberado: true });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-avaliacao"]');
    await sec.locator('text=38 de 40').waitFor({ timeout: 20000 });
    const t = (await sec.innerText()).replace(/\s+/g, ' ');
    ok(/40 perguntas fixas, numa loja de teste com dados inventados, com a chave da DMS/.test(t) && /Versão das instruções agora: a1b2c3d4 · 17 consultas/.test(t), `avaliação: o que é e a versão de agora (${t.slice(0, 200)})`);
    ok(/a1b2c3d4 · 17 consultas/.test(t) && /"Quanto vendi no iFood ontem, separando .*" a resposta não traz 1\.688,35/.test(t) && /US\$ 0,0412/.test(t) && /39 de 39/.test(t), 'avaliação: as rodadas com o resultado, o que falhou e o custo');
    ok(!/mudaram desde a última avaliação/.test(t), 'avaliação: a versão é a mesma da última, sem o aviso');
    ok(/cerca de US\$ 0,0412 na chave da DMS · 40 perguntas/.test(t), 'avaliação: o custo estimado pela última rodada');
    await sec.locator('button:has-text("Ver as 40")').first().click();
    const g = page.locator('[role="dialog"]');
    await g.locator('text=O que vai vencer?').waitFor({ timeout: 10000 });
    const tg = (await g.innerText()).replace(/\s+/g, ' ');
    ok((tg.match(/errada/g) ?? []).length === 2 && /não usou a consulta "vencimentos e versoes"/.test(tg) && /consultou: vendas do periodo · 4,2 s/.test(tg) && /38 de 40 certas/.test(tg), `avaliação: a gaveta com as 40, as erradas e o porquê (${tg.slice(0, 160)})`);
    await page.keyboard.press('Escape');
    await g.waitFor({ state: 'detached' });
    await sec.locator('button:has-text("Rodar a avaliação")').click();
    await sec.locator('text=A avaliação começou: 40 perguntas. O andamento aparece aqui.').waitFor({ timeout: 10000 });
    ok(feitos(S, 'POST', '/distribuicao/mister/avaliacoes').length === 1, 'avaliação: "Rodar a avaliação" pede ao servidor');
    ok(await sec.locator('button:has-text("Rodando…")').isDisabled(), 'avaliação: enquanto roda, o botão fica desligado');
    await sec.locator('li:has-text("40 de 40")').waitFor({ timeout: 20000 });
    ok((await sec.locator('button:has-text("Rodar a avaliação")').isEnabled()) && feitos(S, 'GET', '/distribuicao/mister/avaliacoes').length >= 3, 'avaliação: o andamento relido até terminar, e o botão volta');
    ok(erros.length === 0, `avaliação: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  // A lista curta (pedido do dono, 24/11): com as 10 rodadas que o servidor guarda, aparecem as 3 mais novas; "Ver as 7 anteriores" abre o resto.
  {
    const dez = Array.from({ length: 10 }, (_, i) => RODADA({ id: `av-l${i}`, iniciadaEm: `2026-11-${String(24 - i).padStart(2, '0')}T12:00:00-03:00`, versao: `v${i}`, total: 40, feitas: 40, acertos: 40 - (i % 2), falhas: i % 2, oQueFalhou: i % 2 ? [{ pergunta: `Pergunta da rodada ${i}`, falha: 'a resposta não traz 10,00' }] : [] }));
    const { ctx, page, erros } = await abrir(1280, 900, { numero: conectado(), liberado: true, avaliacoes: AVALIACOES({ rodadas: dez }) });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-avaliacao"]');
    const rodadas = sec.locator('#mister-avaliacao-rodadas > li');
    await rodadas.first().waitFor({ timeout: 20000 });
    ok((await rodadas.count()) === 3, `avaliação curta: só as 3 mais novas aparecem (${await rodadas.count()})`);
    ok((await rodadas.first().innerText()).includes('v0') && (await sec.innerText()).includes('Ver as 7 anteriores'), 'avaliação curta: a mais nova primeiro e "Ver as 7 anteriores"');
    const botao = sec.locator('button[aria-controls="mister-avaliacao-rodadas"]');
    ok((await botao.getAttribute('aria-expanded')) === 'false', 'avaliação curta: o botão diz que está fechado');
    await botao.click();
    await sec.locator('text=Mostrar só as 3 últimas').waitFor();
    ok((await rodadas.count()) === 10 && (await botao.getAttribute('aria-expanded')) === 'true', 'avaliação curta: abre as 10, e o botão diz que está aberto');
    await botao.click();
    await sec.locator('text=Ver as 7 anteriores').waitFor();
    ok((await rodadas.count()) === 3, 'avaliação curta: "Mostrar só as 3 últimas" fecha de novo');
    for (const w of [320, 375, 768]) {
      await page.setViewportSize({ width: w, height: 820 });
      await botao.click();
      const m = await medir(page);
      ok(m.length === 0, `avaliação curta: ${w}px com as 10 abertas, sem barra lateral (${m.join(' | ')})`);
      await botao.click();
    }
    ok(erros.length === 0, `avaliação curta: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { numero: conectado(), liberado: true, avaliacoes: AVALIACOES({ versaoAtual: { versao: 'ffff0000', consultas: 18 }, chaveDaDistribuicao: false }) });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-avaliacao"]');
    await sec.locator('text=As instruções ou as consultas mudaram desde a última avaliação').waitFor({ timeout: 20000 });
    ok((await sec.locator('button:has-text("Rodar a avaliação")').isDisabled()) && (await sec.locator('text=A chave de IA da distribuição não está configurada neste servidor.').count()) === 1, 'avaliação: a versão mudou avisa; sem a chave da DMS, o botão fica desligado e diz por quê');
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { numero: conectado(), liberado: true, avaliacoes: AVALIACOES({ rodadas: [] }), falhaDasAvaliacoes: true });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-avaliacao"]');
    await sec.locator('[role="alert"] >> text=Erro interno').waitFor({ timeout: 20000 });
    S.falhaDasAvaliacoes = false;
    await sec.locator('button:has-text("Tentar de novo")').click();
    await sec.locator('text=Nenhuma avaliação ainda. Rode a primeira para ter a linha de base.').waitFor({ timeout: 10000 });
    ok(true, 'avaliação: o erro só no cartão, "Tentar de novo" lê de novo, e o vazio diz para rodar a primeira');
    await ctx.close();
  }

  // ── S2 (mig 434): a análise com IA da Segurança — os números da rodada, as propostas, "Virou tarefa" na gaveta, "Descartar",
  //    "Analisar" que acompanha até terminar, a que não saiu com "Tentar de novo", e sem a chave da DMS ──
  {
    const { ctx, page, S, erros } = await abrir(1280, 900, { numero: conectado(), liberado: true });
    await naAba(page);
    const card = page.locator('[data-analise-do-sentinela]');
    await card.locator('text=Eventos lidos').waitFor({ timeout: 20000 });
    const t = (await card.innerText()).replace(/\s+/g, ' ');
    ok(/Usa a chave da DMS \(não a da empresa\)\. Custo estimado: US\$ 0,02 por análise\. A última foi em 15\/11 às 09:12\./.test(t), `S2: a chave, o custo estimado e a última rodada (${t.slice(0, 260)})`);
    ok(/Eventos lidos 1\.284 7 dias · só metadados Propostas 2 nenhuma age sozinha Custo US\$ 0,02 chave da DMS/.test(t), 'S2: os três números da rodada');
    // Os rótulos têm caixa-alta pelo CSS, e o innerText devolve o texto como desenhado ("O QUE VIU"): sem caixa na conferência.
    ok(/Um telefone tentou 9 códigos errados em 12 minutos atenção O que viu Final 7731/i.test(t) && /Impacto e como conferir Só esse telefone/i.test(t) && /melhoria/.test(t), `S2: cada proposta com o nível, o que viu, a proposta e o impacto (${t.slice(260, 520)})`);
    await card.locator('[data-proposta-sentinela]').first().locator('button:has-text("Virou tarefa")').click();
    await page.waitForSelector('[data-gaveta-sentinela]', { timeout: 5000 });
    await page.fill('#sentinela-tarefa', 'DMS-9');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/seguranca/analise/decisao')), page.locator('[role="dialog"] button:has-text("Salvar a decisão")').click()]);
    ok(JSON.stringify(feitos(S, 'POST', '/distribuicao/mister/seguranca/analise/decisao')[0]?.corpo) === JSON.stringify({ id: 'p-1', decisao: 'tarefa', tarefa: 'DMS-9' }), 'S2: "Virou tarefa" manda a proposta e a tarefa');
    await card.locator('text=Virou tarefa · DMS-9 · Rodrigo').waitFor({ timeout: 5000 });
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/seguranca/analise/decisao')), card.locator('[data-proposta-sentinela]').nth(1).locator('button:has-text("Descartar")').click()]);
    ok(JSON.stringify(feitos(S, 'POST', '/distribuicao/mister/seguranca/analise/decisao')[1]?.corpo) === JSON.stringify({ id: 'p-2', decisao: 'descartada', tarefa: '' }), 'S2: "Descartar" manda a proposta, sem tarefa');
    await card.locator('text=Descartada · Rodrigo').waitFor({ timeout: 5000 });
    ok((await card.locator('[data-proposta-sentinela] button').count()) === 0, 'S2: decidida, a proposta perde os botões e mostra quem decidiu');
    // Analisar: a tela mostra "Analisando…" e acompanha sozinha até a rodada terminar.
    await card.locator('button:has-text("Analisar os últimos 7 dias")').click();
    await card.locator('button:has-text("Analisando…")').waitFor({ timeout: 5000 });
    ok(await card.locator('button:has-text("Analisando…")').isDisabled(), 'S2: rodando, o botão trava');
    await card.locator('text=Eventos lidos 1.301').waitFor({ timeout: 15000 }).catch(() => null);
    ok(/Eventos lidos 1\.301/.test((await card.innerText()).replace(/\s+/g, ' ')) && feitos(S, 'POST', '/distribuicao/mister/seguranca/analise').length === 1, 'S2: "Analisar" pede UMA rodada e a tela acompanha até terminar');
    ok(erros.length === 0, `S2: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const falhou = ANALISE({ analise: { ...ANALISE().analise, situacao: 'falhou', motivo: 'a conta de IA da distribuição está sem crédito', eventos: 0, custoUsd: 0 }, propostas: [] });
    const { ctx, page, S, erros } = await abrir(375, 820, { numero: conectado(), liberado: true, analise: falhou });
    await naAba(page);
    const card = page.locator('[data-analise-do-sentinela]');
    await card.locator('text=A análise não saiu').waitFor({ timeout: 20000 });
    ok((await card.innerText()).includes('A conta de IA da distribuição está sem crédito. Os números da Segurança acima seguem valendo.'), 'S2: a que não saiu diz o motivo');
    const m = await medir(page);
    ok(m.length === 0, `S2 375: a que não saiu, nada fora da janela ${m.slice(0, 3).join(' | ')}`);
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/seguranca/analise') && r.request().method() === 'POST'), card.locator('button:has-text("Tentar de novo")').click()]);
    ok(feitos(S, 'POST', '/distribuicao/mister/seguranca/analise').length === 1, 'S2: "Tentar de novo" pede outra rodada');
    ok(erros.length === 0, `S2 falhou: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, erros } = await abrir(1280, 900, { numero: conectado(), liberado: true, analise: ANALISE({ chaveDaDistribuicao: false, analise: null, propostas: [] }) });
    await naAba(page);
    const card = page.locator('[data-analise-do-sentinela]');
    await card.locator('text=Nenhuma análise ainda.').waitFor({ timeout: 20000 });
    ok((await card.innerText()).includes('A chave de IA da distribuição não está configurada neste servidor.') && (await card.locator('button:has-text("Analisar os últimos 7 dias")').isDisabled()), 'S2: sem a chave da DMS, o aviso e o botão travado');
    ok(erros.length === 0, `S2 sem chave: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── M2b (mig 435): as instruções candidatas — no ar e a candidata, publicar com a confirmação, a volta que pede a
  //    avaliação antes, "Rodar a avaliação" que acompanha até terminar, descartar, pedir ao Mentor; a errada nova que trava;
  //    a troca quebrada e a versão no ar sem avaliação ──
  {
    const { ctx, page, S, erros } = await abrir(1280, 900, { numero: conectado(), liberado: true });
    await naAba(page);
    const sec = page.locator('[data-instrucoes-do-mister]');
    await sec.locator('text=O que muda na candidata').waitFor({ timeout: 20000 });
    const t = (await sec.innerText()).replace(/\s+/g, ' ');
    ok(/No ar a4fae716 desde 15\/11 às 10:00 · por Rita · 39\/40/.test(t) && /Candidata 7c21d0b9 de 16\/11 às 09:30 · proposta pelo Mentor/.test(t), `M2b: a versão no ar e a candidata (${t.slice(0, 300)})`);
    ok(/Sai - Para quantos pedidos na cozinha/.test(t) && /Entra - Para quantos pedidos na cozinha/.test(t) && /Avaliação: 40\/40 · nenhuma errada nova/.test(t) && /Passou a acertar: "Quanto vendi no iFood ontem\?"/.test(t), 'M2b: o que muda e a avaliação sem errada nova');
    // Publicar pede confirmação (vale para todas as empresas).
    await sec.locator('button:has-text("Publicar a candidata")').click();
    await page.waitForSelector('[role="alertdialog"]');
    ok((await page.locator('[role="alertdialog"]').innerText()).includes('O Mister passa a responder com ela em todas as empresas'), 'M2b: publicar pede confirmação');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/instrucoes/publicar')), page.locator('[role="alertdialog"] button:has-text("Publicar")').click()]);
    ok(feitos(S, 'POST', '/distribuicao/mister/instrucoes/publicar').length === 1, 'M2b: confirmar publica uma vez');
    await sec.locator('text=nenhuma agora').waitFor({ timeout: 5000 });
    ok((await sec.locator('[data-troca-publicada]').count()) === 2 && (await sec.locator('button:has-text("Voltar sem esta troca")').count()) === 1, 'M2b: depois de publicar, a troca entra na lista e só a última tem "Voltar sem esta troca"');
    // A volta vira candidata: sem a avaliação, "Publicar" trava; a avaliação roda e a seção acompanha até terminar.
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/instrucoes/volta')), sec.locator('button:has-text("Voltar sem esta troca")').click()]);
    await sec.locator('text=A volta: tira a última troca publicada').waitFor({ timeout: 5000 });
    ok(await sec.locator('button:has-text("Publicar a candidata")').isDisabled(), 'M2b: a volta sem avaliação não publica');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/instrucoes/avaliar')), sec.locator('button:has-text("Rodar a avaliação")').click()]);
    await sec.locator('text=Rodando com a candidata').waitFor({ timeout: 5000 });
    // A introdução da seção também diz "sem nenhuma errada nova": espera o resultado no bloco da comparação.
    await sec.locator('[data-comparacao] >> text=nenhuma errada nova').waitFor({ timeout: 15000 });
    ok(await sec.locator('button:has-text("Publicar a candidata")').isEnabled(), 'M2b: a avaliação terminou sem errada nova e "Publicar" libera');
    // Descartar e pedir outra ao Mentor.
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/instrucoes/descartar')), sec.locator('button:has-text("Descartar a candidata")').click()]);
    await sec.locator('[data-sem-candidata]').waitFor({ timeout: 5000 });
    ok((await sec.innerText()).includes('A avaliação da versão no ar errou 1: "Quanto vendi no iFood ontem?".'), 'M2b: sem candidata, as erradas da versão no ar');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/instrucoes/candidata')), sec.locator('button:has-text("Pedir uma candidata ao Mentor")').click()]);
    await sec.locator('text=O que muda na candidata').waitFor({ timeout: 5000 });
    ok((await sec.innerText()).includes('Ainda não rodou para a candidata. Custo: cerca de US$ 0,04 (chave da DMS).'), 'M2b: a candidata nova ainda sem avaliação, com o custo');
    ok(erros.length === 0, `M2b: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const ruim = INSTRUCOES({
      candidata: CANDIDATA({ pode: false, novas: ['Quantos pedidos estão na cozinha?'], melhoraram: [], motivo: '1 pergunta passou a errar com a candidata.', avaliacao: { id: 'av-k', situacao: 'terminou', total: 40, feitas: 40, acertos: 38, custoUsd: 0.04, iniciadaEm: '2026-11-16T12:41:00Z' } }),
    });
    const { ctx, page, erros } = await abrir(375, 820, { numero: conectado(), liberado: true, instrucoes: ruim });
    await naAba(page);
    const sec = page.locator('[data-instrucoes-do-mister]');
    await sec.locator('[data-comparacao] >> text=errada nova').waitFor({ timeout: 20000 });
    const t = (await sec.innerText()).replace(/\s+/g, ' ');
    ok(/Avaliação: 38\/40 · 1 errada nova/.test(t) && /Passou a errar: "Quantos pedidos estão na cozinha\?"/.test(t) && /1 pergunta passou a errar com a candidata\./.test(t), 'M2b: a errada nova aparece com o motivo');
    ok(await sec.locator('button:has-text("Publicar a candidata")').isDisabled(), 'M2b: com errada nova, "Publicar" trava');
    const m = await medir(page);
    ok(m.length === 0, `M2b 375: a candidata com errada nova, nada fora da janela ${m.slice(0, 3).join(' | ')}`);
    ok(erros.length === 0, `M2b errada nova: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const semBase = INSTRUCOES({ candidata: null, erradasNoAr: [], publicadas: [], noAr: { versao: 'a4fae716', desde: null, por: null, avaliacao: null, quebradas: [{ id: 't-9', sai: '- uma linha que saiu do código' }] } });
    const { ctx, page, erros } = await abrir(1280, 900, { numero: conectado(), liberado: true, instrucoes: semBase });
    await naAba(page);
    const sec = page.locator('[data-instrucoes-do-mister]');
    await sec.locator('[data-sem-candidata]').waitFor({ timeout: 20000 });
    const t = (await sec.innerText()).replace(/\s+/g, ' ');
    ok(/o texto do código · sem avaliação inteira ainda/.test(t) && /A versão no ar ainda não tem uma avaliação inteira/.test(t) && /1 troca publicada não se aplica mais/.test(t) && /Nenhuma: no ar está o texto do código\./.test(t), `M2b: sem avaliação da versão no ar e com a troca quebrada (${t.slice(0, 260)})`);
    ok(erros.length === 0, `M2b sem base: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── Q2: a conexão por QR Code — o aceite antes do 1º QR, o QR na tela, conectado (a forma vira o QR) e a volta ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { numero: conectado(), liberado: true, conectaNa: 2 });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-forma"]');
    await sec.waitFor({ timeout: 20000 });
    const opcao = (t) => sec.locator(`button[aria-pressed]:has-text("${t}")`);
    ok((await opcao('API oficial da Meta').getAttribute('aria-pressed')) === 'true' && /em uso/.test(await opcao('API oficial da Meta').innerText()), 'Q2: abre na forma em uso (a API oficial), com "em uso"');
    await opcao('Conexão por QR Code').click();
    await sec.locator('[data-qr="antes"]').waitFor();
    const antes = (await sec.innerText()).replace(/\s+/g, ' ');
    ok(/não autoriza conexões fora da API oficial/.test(antes) && /Use um número só para o Mister/.test(antes), 'Q2: o texto do aceite é o do servidor');
    const gerar = sec.locator('button:has-text("Gerar o QR Code")');
    ok(await gerar.isDisabled(), 'Q2: sem o aceite, "Gerar o QR Code" fica travado');
    await sec.locator('input[type="checkbox"]').check();
    ok(await gerar.isEnabled(), 'Q2: marcar o aceite libera o botão');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/qr/gerar')), gerar.click()]);
    ok(JSON.stringify(feitos(S, 'POST', '/distribuicao/mister/qr/aceite')[0]?.corpo) === JSON.stringify({ aceito: true, versao: 'v1' }), 'Q2: o aceite vai antes, com a versão do texto');
    ok(JSON.stringify(feitos(S, 'POST', '/distribuicao/mister/qr/gerar')[0]?.corpo) === JSON.stringify({ outroNumero: false, renovar: false }), 'Q2: o QR é pedido para o mesmo número, sem renovar');
    await sec.locator('[data-qr="na-tela"] img[alt="QR Code para conectar o número do Mister"]').waitFor();
    ok(/Até o celular conectar, o Mister segue falando pela API oficial/.test(await sec.innerText()), 'Q2: com o QR na tela, a oficial segue (a troca é ao conectar)');
    await sec.locator('#forma-aviso:has-text("Conectado. O Mister passou a falar por este número")').waitFor({ timeout: 15000 });
    await sec.locator('[data-qr="conectado"]').waitFor({ timeout: 10000 });
    const ligado = (await sec.innerText()).replace(/\s+/g, ' ');
    ok(/\+55 21 90000-1111/.test(ligado) && /Conexão por QR Code/.test(ligado) && /até 20 por minuto/.test(ligado) && /Rodrigo · .* · texto v1/.test(ligado), `Q2: conectado — o número do celular, o ritmo e o aceite (${ligado.slice(0, 200)})`);
    ok(feitos(S, 'GET', '/distribuicao/mister').length >= 2 && (await page.locator('[data-oficial="fora-de-uso"]').count()) === 1, 'Q2: ao conectar, o painel é relido e a oficial aparece fora de uso');
    ok(/em uso/.test(await opcao('Conexão por QR Code').innerText()) && !/em uso/.test(await opcao('API oficial da Meta').innerText()), 'Q2: "em uso" passa para a conexão por QR Code');
    // a volta para a API oficial: confirmação, Esc cancela sem chamada
    await sec.locator('button:has-text("Trocar para a API oficial")').click();
    const dialogo = page.locator('[role="alertdialog"]');
    await dialogo.waitFor();
    ok(/Ninguém precisa ligar de novo/.test(await dialogo.innerText()), 'Q2: trocar para a oficial — o diálogo diz que ninguém liga de novo');
    await page.keyboard.press('Escape');
    await dialogo.waitFor({ state: 'detached' });
    ok(feitos(S, 'POST', '/distribuicao/mister/qr/trocar').length === 0, 'Q2: Esc cancela a troca, sem chamada');
    await sec.locator('button:has-text("Trocar para a API oficial")').click();
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/qr/trocar')), dialogo.locator('button:has-text("Trocar")').click()]);
    ok(JSON.stringify(feitos(S, 'POST', '/distribuicao/mister/qr/trocar')[0]?.corpo) === JSON.stringify({ para: 'oficial' }), 'Q2: a troca manda "para: oficial"');
    await sec.locator('#forma-aviso:has-text("Forma trocada para a API oficial")').waitFor();
    ok((await opcao('API oficial da Meta').getAttribute('aria-pressed')) === 'true' && /em uso/.test(await opcao('API oficial da Meta').innerText()), 'Q2: depois da troca, a oficial em uso');
    // e de volta ao QR com o celular ainda conectado: o botão pede confirmação e troca na hora
    await sec.locator('[data-qr="oficial"] button:has-text("Trocar para a conexão por QR Code")').click();
    await dialogo.waitFor();
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/qr/trocar')), dialogo.locator('button:has-text("Trocar")').click()]);
    ok(JSON.stringify(feitos(S, 'POST', '/distribuicao/mister/qr/trocar')[1]?.corpo) === JSON.stringify({ para: 'qr' }), 'Q2: com o celular conectado, a troca para o QR é direta');
    // desconectar o celular
    await sec.locator('button:has-text("Desconectar")').click();
    await dialogo.waitFor();
    ok(/para de falar pelo WhatsApp em todas as empresas/.test(await dialogo.innerText()), 'Q2: desconectar com o QR em uso diz que o Mister para de falar');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/qr/desconectar')), dialogo.locator('button:has-text("Desconectar")').click()]);
    await sec.locator('[data-qr="antes"]').waitFor();
    ok(/Aceite do risco: Rodrigo/.test(await sec.innerText()) && (await sec.locator('input[type="checkbox"]').count()) === 0, 'Q2: desconectado — o aceite que vale não é pedido de novo');
    ok(erros.length === 0, `Q2: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    // o QR troca a cada 20 s sem refazer o aceite nem a instância (renovar)
    const { ctx, page, erros, S } = await abrir(1280, 900, { numero: conectado(), liberado: true, qr: QR({ aceite: ACEITE }) });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-forma"]');
    await sec.locator('button[aria-pressed]:has-text("Conexão por QR Code")').click();
    ok((await sec.locator('input[type="checkbox"]').count()) === 0 && /Aceite do risco: Rodrigo/.test(await sec.innerText()), 'Q2: com o aceite de agora, a caixa não aparece');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/qr/gerar')), sec.locator('button:has-text("Gerar o QR Code")').click()]);
    ok(feitos(S, 'POST', '/distribuicao/mister/qr/aceite').length === 0, 'Q2: com o aceite de agora, nada de aceite de novo');
    await page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/qr/gerar'), { timeout: 30000 });
    const pedidos = feitos(S, 'POST', '/distribuicao/mister/qr/gerar');
    ok(pedidos.length === 2 && pedidos[1].corpo.renovar === true && pedidos[1].corpo.outroNumero === false, `Q2: depois de 20 s, um QR novo com "renovar" (${JSON.stringify(pedidos.map((x) => x.corpo))})`);
    ok(feitos(S, 'POST', '/distribuicao/mister/qr/conferir').length >= 5, 'Q2: enquanto o QR está na tela, a conexão é conferida a cada 3 s');
    await sec.locator('button:has-text("Cancelar")').click();
    await sec.locator('[data-qr="antes"]').waitFor();
    const n = feitos(S, 'POST', '/distribuicao/mister/qr/conferir').length;
    await page.waitForTimeout(4000);
    ok(feitos(S, 'POST', '/distribuicao/mister/qr/conferir').length === n, 'Q2: "Cancelar" para de conferir');
    ok(erros.length === 0, `Q2 renovar: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    // bloqueado pelo WhatsApp: conectar OUTRO número; a oficial não conectada trava a volta e explica
    const { ctx, page, erros, S } = await abrir(1280, 900, {
      numero: SEM,
      provedor: 'evolution',
      qr: QR_CONECTADO({ situacao: 'bloqueado', motivo: 'O WhatsApp bloqueou este número.', situacaoEm: '2026-11-15T23:40:00-03:00' }),
    });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-forma"]');
    await sec.locator('[data-qr="bloqueado"]').waitFor({ timeout: 20000 });
    const t = (await sec.innerText()).replace(/\s+/g, ' ');
    ok(/bloqueado pelo WhatsApp/i.test(t) && /\+55 21 90000-1111/.test(t) && /pedido de revisão/.test(t), 'Q2: bloqueado — o número, a data e o caminho da revisão');
    ok(await sec.locator('button:has-text("Trocar para a API oficial")').isDisabled() && /pede o número oficial conectado/.test(t), 'Q2: sem a oficial conectada, a volta trava e explica');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/qr/gerar')), sec.locator('button:has-text("Conectar outro número")').click()]);
    ok(JSON.stringify(feitos(S, 'POST', '/distribuicao/mister/qr/gerar')[0]?.corpo) === JSON.stringify({ outroNumero: true, renovar: false }), 'Q2: "Conectar outro número" pede o QR de um número novo');
    await sec.locator('[data-qr="na-tela"]').waitFor();
    ok(!/segue falando pela API oficial/.test(await sec.innerText()), 'Q2: com o QR em uso, a tela não promete a oficial');
    ok(erros.length === 0, `Q2 bloqueado: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    // o celular que caiu, o Evolution não configurado e a recusa do servidor
    const { ctx, page } = await abrir(1280, 900, { numero: conectado(), provedor: 'evolution', qr: QR_CONECTADO({ situacao: 'caiu', motivo: 'O celular saiu da conta (desconectado no aparelho).', situacaoEm: '2026-11-15T23:10:00-03:00' }) });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-forma"]');
    await sec.locator('[data-qr="caiu"]').waitFor({ timeout: 20000 });
    const t = (await sec.innerText()).replace(/\s+/g, ' ');
    ok(/A conexão caiu em .*: o celular saiu da conta/.test(t) && /nada sai até conectar de novo/.test(t) && (await sec.locator('button:has-text("Trocar para a API oficial")').isEnabled()), `Q2: caiu — a data, o motivo, a consequência e a volta liberada (${t.slice(0, 160)})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { qr: QR({ pronto: false }) });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-forma"]');
    await sec.locator('button[aria-pressed]:has-text("Conexão por QR Code")').click();
    await sec.locator('text=não está configurado neste servidor').waitFor();
    ok((await sec.locator('button:has-text("Gerar o QR Code")').count()) === 0, 'Q2: sem o Evolution configurado, avisa e não oferece o QR');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { qr: QR({ aceite: ACEITE }), falhaDoQr: 'O Evolution não respondeu como esperado: o Evolution não devolveu o QR Code.' });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-forma"]');
    await sec.locator('button[aria-pressed]:has-text("Conexão por QR Code")').click();
    await sec.locator('button:has-text("Gerar o QR Code")').click();
    await sec.locator('[role="alert"]:has-text("O Evolution não respondeu como esperado")').waitFor();
    ok((await sec.locator('[data-qr="antes"]').count()) === 1, 'Q2: a recusa do servidor aparece e a tela segue antes do QR');
    await ctx.close();
  }

  // ── Q2 em cada largura: o aceite (texto comprido), o QR na tela e conectado, nada fora da janela nem esmagado ──
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { numero: conectado(), liberado: true, qr: QR({ aceite: ACEITE }) });
    await naAba(page);
    const sec = page.locator('section[aria-labelledby="mister-forma"]');
    await sec.locator('button[aria-pressed]:has-text("Conexão por QR Code")').click();
    await sec.locator('[data-qr="antes"]').waitFor({ timeout: 20000 });
    let m = await medir(page);
    let e = await esmagados(page, 'section[aria-labelledby="mister-forma"]');
    ok(m.length === 0 && e.length === 0, `${w}px Q2: antes do QR — tudo na tela e legível (${[...m, ...e].slice(0, 3).join(' | ')})`);
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/distribuicao/mister/qr/gerar')), sec.locator('button:has-text("Gerar o QR Code")').click()]);
    await sec.locator('[data-qr="na-tela"]').waitFor();
    m = await medir(page);
    e = await esmagados(page, 'section[aria-labelledby="mister-forma"]');
    ok(m.length === 0 && e.length === 0, `${w}px Q2: o QR na tela — tudo na tela e legível (${[...m, ...e].slice(0, 3).join(' | ')})`);
    if ([320, 375, 768, 1440].includes(w)) {
      await sec.scrollIntoViewIfNeeded();
      await sec.screenshot({ path: foto(`${w}-qr-na-tela.png`) });
    }
    ok(erros.length === 0, `${w}px Q2: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── cada largura: a página e o diálogo inteiros na tela; tabela no largo, cartões no estreito ──
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { numero: conectado(), liberado: true, total: 250, modelos: MODELOS_LONGOS });
    await naAba(page);
    await page.locator('text=Empório Sabor da Serra >> visible=true').first().waitFor({ timeout: 20000 });
    await page.locator('section[aria-labelledby="mister-modelos"] >> text=recusado pela Meta').waitFor({ timeout: 20000 });
    await page.locator('section[aria-labelledby="mister-qualidade"] >> text=395 de 412').waitFor({ timeout: 20000 });
    await page.locator('section[aria-labelledby="mister-seguranca"] >> text=Pede atenção').waitFor({ timeout: 20000 });
    await page.locator('[data-analise-do-sentinela] >> text=Eventos lidos').waitFor({ timeout: 20000 });
    await page.locator('[data-instrucoes-do-mister] >> text=O que muda na candidata').waitFor({ timeout: 20000 });
    let m = await medir(page);
    ok(m.length === 0, `${w}px: conectado — sem barra lateral, nada passa da tela e o toque é grande (${m.join(' | ')})`);
    // M2b: as instruções legíveis em cada largura (a linha comprida da candidata quebra, nada esmagado) e a foto da candidata.
    const esmagadosDasInstrucoes = await esmagados(page, '[data-instrucoes-do-mister]');
    ok(esmagadosDasInstrucoes.length === 0, `${w}px: as instruções sem texto esmagado ${esmagadosDasInstrucoes.slice(0, 3).join(' | ')}`);
    if ([320, 375, 768, 1920].includes(w)) {
      await page.locator('[data-candidata]').scrollIntoViewIfNeeded();
      await page.locator('[data-candidata]').screenshot({ path: foto(`${w}-instrucoes-candidata.png`) });
    }
    // S2: a análise com IA legível em cada largura (nenhum texto esmagado) e a foto de cada proposta.
    const esmagadosDaAnalise = await esmagados(page, '[data-analise-do-sentinela]');
    ok(esmagadosDaAnalise.length === 0, `${w}px: a análise com IA sem texto esmagado ${esmagadosDaAnalise.slice(0, 3).join(' | ')}`);
    if ([320, 375, 768, 1920].includes(w)) {
      const cartoesDaAnalise = page.locator('[data-proposta-sentinela]');
      for (let i = 0; i < (await cartoesDaAnalise.count()); i++) {
        await cartoesDaAnalise.nth(i).scrollIntoViewIfNeeded();
        await cartoesDaAnalise.nth(i).screenshot({ path: foto(`${w}-analise-proposta-${i + 1}.png`) });
      }
    }
    const tabela = await page.locator('section[aria-labelledby="mister-empresas"] table').isVisible();
    const cartoes = await page.locator('section[aria-labelledby="mister-empresas"] ul').isVisible();
    ok(w >= 1024 ? tabela && !cartoes : cartoes && !tabela, `${w}px: ${w >= 1024 ? 'tabela' : 'cartões'} (tabela ${tabela}, cartões ${cartoes})`);
    if (w === 375 || w === 1440) await page.screenshot({ path: foto(`${w}-conectado.png`), fullPage: true });
    // A gaveta da avaliação (F5.3) aberta, inteira na tela.
    await page.locator('section[aria-labelledby="mister-avaliacao"] >> text=38 de 40').waitFor({ timeout: 20000 });
    await page.locator('section[aria-labelledby="mister-avaliacao"] button:has-text("Ver as 40")').first().click();
    await page.locator('[role="dialog"] >> text=O que vai vencer?').waitFor({ timeout: 10000 });
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta da avaliação inteira na tela (${m.join(' | ')})`);
    if (w === 375 || w === 1440) await page.screenshot({ path: foto(`${w}-avaliacao-gaveta.png`) });
    await page.keyboard.press('Escape');
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
    await page.click('button:has-text("Reconectar com a Meta")');
    await page.locator('button[aria-pressed]:has-text("Só na API oficial")').click();
    await page.locator('input[inputmode="numeric"]').waitFor();
    m = await medir(page);
    ok(m.length === 0, `${w}px: reconectando, com o PIN — tudo na tela (${m.join(' | ')})`);
    await page.locator('section[aria-labelledby="mister-geral"] button:has-text("Desligar o Mister")').click();
    await page.waitForSelector('[role="alertdialog"]');
    m = await medir(page);
    ok(m.length === 0, `${w}px: o diálogo de desligar inteiro na tela (${m.join(' | ')})`);
    if (w === 375) await page.screenshot({ path: foto('375-dialogo.png') });
    ok(erros.length === 0, `${w}px: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
}
