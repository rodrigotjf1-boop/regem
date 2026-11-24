// Roteiro de tela do MISTER › PESSOAS, IA E USO e AVISOS E RELATÓRIOS (protótipo `mockups/regem-mister.html`, aprovado em 13/11/2026), com a
// API simulada.
// PESSOAS: o presidente vê as duas partes e a lista inteira (quem é quem, o final do número, avisos parados, quem não
// ligou), sem "Editar o que pode"; a parte da IA só é lida quando aberta; ligar o próprio WhatsApp (o código, o QR, o
// link, a espera até aparecer ligado, o código vencido e "Gerar outro código", a recusa do servidor); desligar pede
// confirmação; o Mister indisponível trava o "Ligar"; o gerente vê só a própria linha, sem a faixa de partes e sem
// chamar as rotas da IA; quem é da execução não entra.
// IA E USO:
// Confere: módulo desligado não abre a tela nem chama a rota da chave; sem chave própria, a IA incluída; a chave colada
// vai ao servidor sem espaço, o campo esvazia e ela NÃO fica na página; a situação (funcionando, sem crédito) e o teste;
// a recusa do servidor aparece com a frase dele; apagar pede confirmação; o uso com os rótulos, o custo e o total, vazio,
// erro e "Tentar de novo"; os atalhos de período; o guia em gaveta; gerente não entra; e, em cada largura, a página, a
// gaveta e o diálogo inteiros na tela, sem barra lateral.
// JEITO E MEMÓRIA (versão 4): o perfil e o jeito da empresa (M4a); "O que o Mister sabe" (M4b) — a lista com as duas
// situações, o medidor, a busca e a origem, anotar com a recusa do servidor no campo, mudar, esquecer, vazio e erro, e a
// gaveta e o diálogo abertos em cada largura.
import { fotoDoComoFaco, responder, tokenFalso, umaLinha } from './comum.mjs';

const PRESIDENTE = tokenFalso({ cat: 'presidente', perfil: 'presidente', perm: {} });
const GERENTE = tokenFalso({ cat: 'gerente', perfil: 'gerente', perm: { delivery: { ver: true } } });
const CHAVE = `sk-ant-api03-${'k'.repeat(60)}ZZ99`;

const SEM_CHAVE = { provedoresAceitos: ['anthropic'], origem: 'incluida', chave: null };
/** Versão 5 (M5b.2): a situação do DMS Graph (`GET /graph/clique/situacao`) — ligado (137 de 500), franquia acabou, sem a ligação. */
const SITUACAO_DO_GRAPH = (g) => {
  const mes = new Date().toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' }).slice(0, 7);
  const ligacao =
    g === 'sem'
      ? null
      : {
          contaNome: 'Mister teste',
          desde: '2026-11-19T07:06:00Z',
          por: 'Ana',
          permissoes: ['arquivos.analisar'],
          ultimoUso: '2026-11-19T09:00:00Z',
          ultimaLeitura: { em: '2026-11-19T09:00:00Z', resultado: g === 'acabou' ? 'franquia-esgotada' : 'lida' },
          franquia: { mes, usados: g === 'acabou' ? 500 : 137, total: 500, em: '2026-11-19T09:00:00Z', doMesAtual: true },
        };
  return { ligado: true, empresaNome: 'Mister teste', empresaTemCnpj: true, reservaIa: true, pronto: true, naNuvem: true, podeLigar: true, ligacao, desligadaPeloGraphEm: null, permissoes: [] };
};
const comChave = (situacao = 'ok') => ({
  provedoresAceitos: ['anthropic'],
  origem: 'propria',
  chave: { provedor: 'anthropic', final: 'ZZ99', situacao, conferidaEm: '2026-11-13T01:10:00Z', salvaEm: '2026-11-13T01:10:00Z' },
});
const USO = {
  de: '2026-10-15',
  ate: '2026-11-13',
  precosLidosEm: '2026-11-12',
  itens: [
    { recurso: 'copiloto', provedor: 'anthropic', modelo: 'claude-haiku-5-5', origem: 'lojista', chamadas: 312, falhas: 2, tokens: { entrada: 780_000, cacheEscrita: 0, cacheLeitura: 0, saida: 62_000 }, custoEstimadoUsd: 0.109 },
    { recurso: 'copiloto', provedor: 'anthropic', modelo: 'claude-haiku-5-5', origem: 'distribuicao', chamadas: 40, falhas: 0, tokens: { entrada: 100_000, cacheEscrita: 0, cacheLeitura: 0, saida: 8_000 }, custoEstimadoUsd: 0.014 },
    { recurso: 'mister_perguntas', provedor: 'anthropic', modelo: 'claude-sonnet-5-5', origem: 'lojista', chamadas: 28, falhas: 0, tokens: { entrada: 400_000, cacheEscrita: 500_000, cacheLeitura: 2_500_000, saida: 224_000 }, custoEstimadoUsd: 8.96 },
    { recurso: 'prova', provedor: 'anthropic', modelo: 'modelo-novo', origem: 'lojista', chamadas: 2, falhas: 0, tokens: { entrada: 16, cacheEscrita: 0, cacheLeitura: 0, saida: 32 }, custoEstimadoUsd: null },
  ],
  custoEstimadoUsd: { lojista: 9.069, distribuicao: 0.014 },
  semPreco: ['modelo-novo'],
};

const pessoa = (o) => ({
  colaboradorId: 'c1',
  nome: 'Ana Souza',
  nivel: 'presidente',
  loja: null,
  voce: false,
  ligado: false,
  final: null,
  ligadoEm: null,
  pausado: false,
  pode: ['avisos', 'consulta', 'autorizacao'],
  ...o,
});
const gerente = (o) => pessoa({ nivel: 'gerente', pode: ['avisos', 'consulta'], ...o });
const PESSOAS = [
  pessoa({ voce: true, ligado: true, final: '4321', ligadoEm: '2026-11-02T15:00:00Z' }),
  gerente({ colaboradorId: 'c2', nome: 'Carlos Lima', loja: 'Loja Centro', ligado: true, final: '8890', ligadoEm: '2026-11-05T15:00:00Z' }),
  gerente({ colaboradorId: 'c3', nome: 'João Reis', loja: 'Loja Centro', ligado: true, final: '1177', ligadoEm: '2026-11-06T15:00:00Z', pausado: true }),
  gerente({ colaboradorId: 'c4', nome: 'Marina Alves de Albuquerque Figueiredo', loja: 'Loja Barra' }),
];
const NINGUEM = PESSOAS.map((x) => ({ ...x, ligado: false, final: null, ligadoEm: null, pausado: false }));
const EXECUCAO = tokenFalso({ cat: 'execucao', perfil: 'execucao', perm: {} });

// A parte "Avisos e relatórios" (versão 2 do protótipo, aprovada em 14/11/2026): o que o servidor devolve com o padrão.
const DESTINOS_DA_TELA = [
  { id: 'presidente', nome: 'WhatsApp do presidente' },
  { id: 'gerente', nome: 'WhatsApp do gerente da loja' },
  { id: 'tela', nome: 'Tela do Regem na loja' },
  { id: 'kds', nome: 'KDS da cozinha' },
  { id: 'atendimento', nome: 'Caso no Atendimento' },
  { id: 'dms', nome: 'Suporte da DMS' },
];
const regraAv = (destinos, o = {}) => ({ ligado: true, destinos, escalaMin: null, escalaPara: [], parametro: null, ...o });
const AVISOS_PADRAO = () => ({
  destinos: DESTINOS_DA_TELA,
  avisos: [
    { tipo: 'impressora', grupo: 'Na loja', titulo: 'Impressora parada', descricao: 'Uma impressora deixou de responder com via na fila.', jaFunciona: true, padrao: true, regra: regraAv(['tela'], { escalaMin: 5, escalaPara: ['gerente'] }) },
    { tipo: 'pedido_parado', grupo: 'Na loja', titulo: 'Pedido parado', descricao: 'Um pedido sem andar além do tempo escolhido.', jaFunciona: false, padrao: true, regra: regraAv(['kds', 'tela', 'gerente'], { ligado: false, parametro: 20 }) },
    { tipo: 'caixa_24h', grupo: 'Na loja', titulo: 'Caixa aberto há mais de 24 horas', descricao: 'O Regem já pede o fechamento na tela do caixa; aqui o gerente fica sabendo.', jaFunciona: true, padrao: true, regra: regraAv(['gerente']) },
    { tipo: 'canal_desconectado', grupo: 'Na loja', titulo: 'iFood ou 99 desconectado', descricao: 'A loja parou de receber pedidos de um canal.', jaFunciona: false, padrao: true, regra: regraAv(['gerente', 'tela']) },
    { tipo: 'servidor_sem_sinal', grupo: 'Servidor da loja', titulo: 'Servidor da loja sem sinal', descricao: 'Só quando há pedido esperando.', jaFunciona: true, padrao: true, regra: regraAv(['gerente', 'dms']) },
    { tipo: 'servidor_tecnico', grupo: 'Servidor da loja', titulo: 'Serviço parado, disco cheio ou cópia de segurança atrasada', descricao: 'Problemas técnicos do servidor: o suporte da DMS resolve.', jaFunciona: true, padrao: true, regra: regraAv(['dms'], { escalaMin: 120, escalaPara: ['gerente'] }) },
    { tipo: 'nota_sem_resposta', grupo: 'Fiscal', titulo: 'Nota fiscal sem resposta', descricao: 'Nota que ficou pendente depois de todas as tentativas.', jaFunciona: false, padrao: true, regra: regraAv(['atendimento', 'presidente']) },
    { tipo: 'certificado', grupo: 'Fiscal', titulo: 'Certificado digital perto de vencer', descricao: 'A 60, 30, 15, 7 e 1 dia do vencimento.', jaFunciona: false, padrao: true, regra: regraAv(['presidente']) },
    { tipo: 'chave_ia', grupo: 'O próprio Mister', titulo: 'A chave de IA parou', descricao: 'Sem crédito, no teto de gasto ou recusada.', jaFunciona: true, padrao: true, regra: regraAv(['presidente']) },
    // M3a parte 4: o boleto lançado por foto perto de vencer (a antecedência no `parametro`: 3, 1 ou 0 dia).
    { tipo: 'boleto_vencendo', grupo: 'Documentos e dinheiro', titulo: 'Boleto perto de vencer', descricao: 'Os boletos lançados por foto no Mister. Vai com a linha digitável; "Já paguei" dá baixa na conta e tira o boleto da lista. Às 9h da loja.', jaFunciona: true, padrao: true, regra: regraAv(['presidente'], { parametro: 3 }) },
    // G2 do gasto do WhatsApp oficial (18/11/2026): no fim da lista; a tela os põe em "Documentos e dinheiro".
    { tipo: 'gasto_whatsapp', grupo: 'Documentos e dinheiro', titulo: 'Gasto do WhatsApp oficial', descricao: 'Quando o gasto do mês na Meta passa de cada valor. Cada valor avisa uma vez por mês; no dia 1º tudo recomeça.', jaFunciona: true, padrao: true, regra: regraAv(['presidente'], { ligado: false, valores: [] }) },
    { tipo: 'franquia_atendimento', grupo: 'Documentos e dinheiro', titulo: 'Atendimento grátis perto do fim', descricao: 'A Meta dá 1.000 mensagens de atendimento grátis por mês em cada número; avisa quando um número passa de 900.', jaFunciona: true, padrao: true, regra: regraAv(['presidente']) },
    // M3e: o ponto esquecido, ao gerente, com o resumo no dia seguinte.
    { tipo: 'ponto_esquecido', grupo: 'Pessoas e ponto', titulo: 'Ponto esquecido', descricao: 'Entrada ou saída que falta depois do horário da escala. O aviso diz quem, qual turno e onde ajustar. Só nas lojas que usam o terminal de ponto.', jaFunciona: true, padrao: true, regra: regraAv(['gerente'], { parametro: 0 }) },
    // M3e parte 2: o arquivo do ponto do mês, ao presidente, sem parâmetro (como o servidor manda).
    { tipo: 'ponto_do_mes', grupo: 'Pessoas e ponto', titulo: 'Arquivo do ponto do mês', descricao: 'O espelho de ponto do mês em PDF, depois que o último turno do mês fecha. Com um toque, vai à contabilidade.', jaFunciona: true, padrao: true, regra: regraAv(['presidente']) },
  ],
});
// Os relatórios (mig 420): os dois desligados, como o padrão; o do dia com um envio que não saiu (fora da janela).
const RELATORIOS_PADRAO = () => [
  {
    tipo: 'resumo_dia', titulo: 'Resumo do dia', descricao: 'Pedidos, vendas, tempo médio, cancelamentos e o que saiu do lugar.',
    regra: { ligado: false, hora: '23:30', diaSemana: null },
    ultimo: { referencia: '2026-11-13', situacao: 'nao_enviado', motivo: 'fora_da_janela_de_24h', em: '2026-11-14T02:31:00.000Z' },
  },
  {
    tipo: 'resumo_semana', titulo: 'Resumo da semana', descricao: 'Os 7 dias até a véspera contra os 7 anteriores.',
    regra: { ligado: false, hora: '09:00', diaSemana: 1 },
    // Fora das 24 horas: foi o convite pelo modelo da Meta, e o resumo espera o toque.
    ultimo: { referencia: '2026-11-02', situacao: 'nao_enviado', motivo: 'convite_enviado', em: '2026-11-09T12:05:00.000Z' },
  },
  {
    // F4c das vagas: só conta, sem a IA; vai a quem pode ver os candidatos.
    tipo: 'fichas_novas', titulo: 'Fichas novas de candidatos', usaIa: false,
    descricao: 'As fichas que chegaram na Página de vagas desde o último resumo: nome, função, escala e distância. Só nos dias em que chegou ficha. Sem telefone nem endereço no WhatsApp.',
    vaiPara: 'o presidente e quem tem a permissão Candidatos, cada um só das lojas que vê',
    regra: { ligado: false, hora: '09:00', diaSemana: null },
    ultimo: null,
  },
  {
    // Fase N2 das Notícias do ramo: sem a IA; o convite fora das 24 horas é opcional e nasce desligado.
    tipo: 'boletim_ramo', titulo: 'Boletim do ramo', usaIa: false,
    descricao: 'Os indicadores, até 3 destaques e até 2 novidades do setor, com a fonte e o link de cada um. Só nos dias com novidade.',
    vaiPara: 'o presidente e o gerente com a permissão Notícias do ramo, se ligaram o próprio WhatsApp em Pessoas',
    regra: { ligado: false, hora: '08:30', diaSemana: null, convidarFora: false },
    ultimo: null,
  },
  {
    // Versão 8, E3: o aviso da véspera, em texto fixo. Fica no grupo "Clima e eventos", com a linha "Amanhã" do resumo.
    tipo: 'vespera', titulo: 'Avisar na véspera', usaIa: false,
    descricao: 'No dia anterior, quando vem feriado, data forte, jogo na cidade ou chuva nas duas previsões. Só nos dias com algo para dizer. Texto fixo, sem IA.',
    vaiPara: 'o presidente e os gerentes que ligaram o próprio WhatsApp em Pessoas, cada um com as suas lojas',
    regra: { ligado: false, hora: '18:00', diaSemana: null, convidarFora: false },
    ultimo: null,
  },
];

// O histórico dos avisos (F1.4 parte B): dois abertos (um escalou pelo modelo da Meta) e dois resolvidos (um fechado
// porque o aviso foi desligado); um título comprido de propósito.
const HISTORICO = () => {
  const ha = (min) => new Date(Date.now() - min * 60_000).toISOString();
  return [
    {
      id: 'h1', grupo: 'Na loja', titulo: 'Loja Centro · pedido #284 · iFood 4821 aceito há mais de 20 min e ainda não ficou pronto', detalhe: 'Confira na cozinha se ele está sendo feito.',
      situacao: 'aberto', fechouDesligado: false, abertoEm: ha(10), resolvidoEm: null, escaladoEm: ha(5),
      foiPara: ['Tela do Regem na loja', 'KDS da cozinha', 'WhatsApp do gerente da loja (••4821)'],
      trilha: [
        { fase: 'Abriu', em: ha(10), destino: 'Tela do Regem na loja', ok: true, nota: null },
        { fase: 'Sem solução', em: ha(5), destino: 'WhatsApp do gerente da loja (••4821)', ok: true, nota: 'pelo modelo da Meta, fora das 24 horas' },
      ],
    },
    { id: 'h2', grupo: 'Na loja', titulo: 'Loja Centro · impressora Cozinha parada', detalhe: 'Confira se ela está ligada.', situacao: 'aberto', fechouDesligado: false, abertoEm: ha(3), resolvidoEm: null, escaladoEm: null, foiPara: ['Tela do Regem na loja'], trilha: [{ fase: 'Abriu', em: ha(3), destino: 'Tela do Regem na loja', ok: true, nota: null }] },
    { id: 'h3', grupo: 'Fiscal', titulo: 'Loja Centro · certificado digital da nota vence em 18/11', detalhe: null, situacao: 'resolvido', fechouDesligado: false, abertoEm: ha(2 * 24 * 60), resolvidoEm: ha(24 * 60), escaladoEm: null, foiPara: ['WhatsApp do presidente (••1234)'], trilha: [] },
    { id: 'h4', grupo: 'Servidor da loja', titulo: 'Loja Centro · servidor sem sinal', detalhe: null, situacao: 'resolvido', fechouDesligado: true, abertoEm: ha(120), resolvidoEm: ha(100), escaladoEm: null, foiPara: [], trilha: [] },
  ];
};

// A parte "Documentos" (M3a parte 3, versão 3 do protótipo aprovada em 17/11): o que o servidor devolve.
const doc = (o) => ({
  id: 'd1',
  tipo: 'boleto',
  beneficiario: 'Distribuidora Sabor Ltda.',
  fornecedor: 'Distribuidora Sabor',
  valorCentavos: 128490,
  vencimento: '2026-11-25',
  situacao: 'lancado',
  motivo: 'sozinho',
  origem: { valor: 'codigo', vencimento: 'codigo' },
  linhaDigitavel: '00191.23454 67890.123457 67890.123457 7 16410000128490',
  quem: 'Ana',
  telefoneFinal: '4321',
  criadoEm: '2026-11-16T22:41:00Z',
  respondidoEm: '2026-11-16T22:41:00Z',
  tituloId: 't1',
  podeDesfazer: true,
  ...o,
});
const DOCUMENTOS = () => [
  doc({}),
  doc({ id: 'd2', beneficiario: 'Gás Rio', fornecedor: null, valorCentavos: 48000, vencimento: '2026-11-30', origem: { valor: 'pessoa', vencimento: 'pessoa' }, motivo: 'informado', linhaDigitavel: null, tituloId: 't2' }),
  doc({ id: 'd3', beneficiario: null, fornecedor: null, valorCentavos: null, vencimento: null, situacao: 'falta', motivo: 'valor,vencimento', origem: { valor: null, vencimento: null }, linhaDigitavel: null, respondidoEm: null, tituloId: null, podeDesfazer: false }),
  doc({ id: 'd4', beneficiario: 'Light Serviços de Eletricidade S.A. — Unidade Consumidora 4102938475', fornecedor: null, valorCentavos: 31240, vencimento: '2026-12-02', situacao: 'confirmar', motivo: 'conta', origem: { valor: 'codigo', vencimento: 'ia' }, linhaDigitavel: '83640000004-5 80000123456-9 78901234567-2 89012345678-6', respondidoEm: null, tituloId: null, podeDesfazer: false }),
  doc({ id: 'd5', beneficiario: 'Embalagens Rio', fornecedor: 'Embalagens Rio', valorCentavos: 89000, vencimento: '2026-11-12', situacao: 'pago', tituloId: 't5', podeDesfazer: false }),
  doc({ id: 'd6', beneficiario: 'Distribuidora Sabor Ltda.', situacao: 'recusado', motivo: 'codigo_nao_confere', valorCentavos: null, vencimento: null, origem: { valor: null, vencimento: null }, linhaDigitavel: null, respondidoEm: null, tituloId: null, podeDesfazer: false }),
  // M3b: a nota do fornecedor lançada (entrou pelo recebimento: sem "Desfazer" e sem o PDF do boleto).
  doc({
    id: 'd7',
    tipo: 'nota',
    beneficiario: 'Frigorífico Boa Carne',
    fornecedor: 'Frigorífico Boa Carne',
    valorCentavos: 264000,
    vencimento: '2026-12-16',
    motivo: 'itens_ligados',
    origem: { valor: null, vencimento: null },
    linhaDigitavel: null,
    tituloId: 't7',
    podeDesfazer: false,
    // M3b.3: cada item com o destino (a mesma linha do resumo da conversa), as parcelas e o recebimento.
    nota: {
      numero: '48213',
      parcelas: 2,
      noEstoque: 2,
      recebimentoId: 'r7',
      itens: [
        { descricao: 'BLEND BOVINO 56G', quanto: '40 KG', destino: 'Carne 56 g', estado: 'ligado' },
        { descricao: 'BACON EM TIRAS DEFUMADO FATIADO PACOTE 1 KG RESFRIADO', quanto: '5 KG', destino: 'Bacon em tiras (10 pacote)', estado: 'ligado' },
        { descricao: 'DETERGENTE NEUTRO', quanto: '10 UN', destino: 'fora do estoque', estado: 'fora' },
      ],
    },
  }),
  // A nota que ainda espera a resposta de um item na conversa.
  doc({
    id: 'd8',
    tipo: 'nota',
    beneficiario: 'Hortifruti Verde',
    fornecedor: 'Hortifruti Verde',
    valorCentavos: 31240,
    vencimento: null,
    situacao: 'falta',
    motivo: 'item:1',
    origem: { valor: null, vencimento: null },
    linhaDigitavel: null,
    respondidoEm: null,
    tituloId: null,
    podeDesfazer: false,
    nota: {
      numero: '1907',
      parcelas: 1,
      noEstoque: 1,
      recebimentoId: null,
      itens: [
        { descricao: 'TOMATE ITALIANO', quanto: '12 KG', destino: 'Tomate', estado: 'ligado' },
        { descricao: 'RÚCULA MAÇO', quanto: '20 UN', destino: 'falta dizer o insumo', estado: 'item' },
      ],
    },
  }),
];

// M3c.4: o relatório do link — o plano que o servidor devolve (o MESMO do PDF), com os números da conversa 16.
const RELATORIO_INSUMO = () => {
  const valores = [62, 70, 85, 90, 101, 160, 171, 58, 66, 80, 88, 97, 150, 168, 74, 40];
  return {
    total: 1486,
    nomeDoPdf: 'carne-120-g-2026-11-01-a-2026-11-16.pdf',
    plano: {
      cabecalho: 'Burger da Praça · Loja Centro',
      gerado: 'Gerado em 16/11/2026, 22:43 pelo Mister, a pedido de Ana',
      titulo: 'Carne 120 g · de 01/11 a 16/11 contra 01/10 a 16/10',
      numeros: [
        { valor: '1.486 unidades', rotulo: 'Loja Centro' },
        { valor: '178,3 kg', rotulo: 'pela ficha técnica' },
        { valor: '+13%', rotulo: 'contra 01/10 a 16/10 (1.312)' },
      ],
      grafico: {
        titulo: 'Carne 120 g por dia (unidades)',
        barras: valores.map((v, i) => ({ rotulo: String(i + 1).padStart(2, '0'), valor: v, texto: String(v) })),
        linha: { valor: 82, texto: 'média de 01/10 a 16/10: 82 por dia' },
        nota: null,
      },
      deOnde: [
        { produto: 'X-Tudo', detalhe: '812 vendidos', valor: '812' },
        { produto: 'Duplo Bacon Especial da Casa com Cheddar Cremoso', detalhe: '2 por unidade, 209 vendidos', valor: '418' },
        { produto: 'Salada', detalhe: '256 vendidos', valor: '256' },
      ],
      outros: null,
      fonte: 'Fonte: As vendas fechadas, baixadas pela ficha técnica de cada produto (Estoque › Fichas técnicas). O total é o que saiu do estoque; cancelamento devolve.',
    },
  };
};
const LINK_DO_RELATORIO = '?insumo=11111111-2222-3333-4444-555555555555&de=2026-11-01&ate=2026-11-16&compararDe=2026-10-01&compararAte=2026-10-16';

// Versão 4, M4b: "O que o Mister sabe" — as anotações da empresa e de duas pessoas (a mais longa de 300 letras, a
// largura que aperta o cartão).
const ANA = '11111111-aaaa-4aaa-8aaa-000000000001';
const CARLOS = '11111111-aaaa-4aaa-8aaa-000000000002';
const MEMORIA = () => [
  { id: 'm-e1', colaboradorId: null, texto: 'O pico da noite é das 20h às 22h; no sábado começa às 19h.', origem: 'conversa', criadoEm: '2026-11-18T00:40:00Z', anotadoPor: 'Ana Souza' },
  { id: 'm-e2', colaboradorId: null, texto: '"Smash" é o X-Burger Smash; "trio" é lanche com batata e refrigerante.', origem: 'presidente', criadoEm: '2026-11-16T13:05:00Z', anotadoPor: 'Rodrigo Teixeira' },
  { id: 'm-e3', colaboradorId: null, texto: `A loja ainda fecha os pedidos do delivery no Eclética: pedido "em aberto" no painel não é atraso. ${'Confira antes no Eclética. '.repeat(7)}`.slice(0, 300).trim(), origem: 'conversa', criadoEm: '2026-11-15T03:12:00Z', anotadoPor: 'Ana Souza' },
  { id: 'm-p1', colaboradorId: ANA, texto: 'Ana prefere os valores sem centavos e a resposta mais curta.', origem: 'conversa', criadoEm: '2026-11-18T12:12:00Z', anotadoPor: 'Ana Souza' },
  { id: 'm-p2', colaboradorId: CARLOS, texto: 'Carlos chama a cozinha de "chapa" e o delivery de "rua".', origem: 'conversa', criadoEm: '2026-11-16T01:47:00Z', anotadoPor: 'Carlos Lima' },
];
/** A resposta de GET /mister/memoria montada como o servidor monta (`MisterMemoriaService.daTela`). */
const memoriaDaTela = (itens) => {
  const nomes = { [ANA]: 'Ana Souza', [CARLOS]: 'Carlos Lima' };
  const letras = (l) => l.reduce((s, i) => s + i.texto.length, 0);
  const daEmpresa = itens.filter((i) => !i.colaboradorId);
  const dePessoas = itens.filter((i) => i.colaboradorId);
  return {
    disponivel: true,
    limites: { empresa: 2200, pessoa: 1375 },
    empresa: { itens: daEmpresa, letras: letras(daEmpresa) },
    pessoas: [...new Set(dePessoas.map((i) => i.colaboradorId))].map((id) => {
      const dela = dePessoas.filter((i) => i.colaboradorId === id);
      return { colaboradorId: id, nome: nomes[id], itens: dela, letras: letras(dela) };
    }),
    pessoasLigadas: [{ id: ANA, nome: 'Ana Souza' }, { id: CARLOS, nome: 'Carlos Lima' }],
  };
};

const medir = (page) =>
  page.evaluate(() => {
    const achados = [];
    const doc = document.documentElement;
    if (doc.scrollWidth > doc.clientWidth + 1) achados.push(`página ${doc.scrollWidth}>${doc.clientWidth}`);
    for (const el of document.querySelectorAll('main *, [role="dialog"] *, [role="alertdialog"] *')) {
      const cs = getComputedStyle(el);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) {
        // A faixa de partes desliza sem barra à mostra abaixo de 640 px (o desenho do componente e a regra do dono de
        // 07/10/2026): vale, desde que a barra dela fique escondida de verdade.
        if (el.classList.contains('faixa-abas') && window.innerWidth < 640 && el.offsetHeight === el.clientHeight + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0)) continue;
        achados.push(`rola ${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} ${el.scrollWidth}>${el.clientWidth}`);
      }
    }
    for (const d of document.querySelectorAll('[role="dialog"], [role="alertdialog"]')) {
      const r = d.getBoundingClientRect();
      if (r.left < 0 || r.right > window.innerWidth + 1 || r.top < 0) achados.push(`painel fora da tela ${Math.round(r.left)}..${Math.round(r.right)}`);
    }
    for (const b of document.querySelectorAll('main button, [role="dialog"] button, [role="alertdialog"] button'))
      if (b.getClientRects().length && b.getBoundingClientRect().height < 39.5) achados.push(`botão baixo "${b.textContent.trim().slice(0, 30)}"`);
    return achados;
  });

export default async function roteiroMister({ nav, base, ok, foto, larguras }) {
  async function abrir(w, h, o = {}) {
    const S = { modulo: o.modulo ?? true, estado: o.estado ?? SEM_CHAVE, uso: o.uso === undefined ? USO : o.uso, usoFalha: !!o.usoFalha, recusa: o.recusa ?? null, pedidos: [], modulos: [],
      // a parte "Pessoas"
      pessoas: o.pessoas ?? PESSOAS, souPresidente: o.souPresidente ?? true, disponivel: o.disponivel ?? true, pessoasFalha: !!o.pessoasFalha,
      recusaDoCodigo: o.recusaDoCodigo ?? null, valeMs: o.valeMs ?? 600_000, ligaNaLeitura: o.ligaNaLeitura ?? 0, leiturasDoMeu: 0, codigos: 0, doMister: [],
      meu: { disponivel: true, numeroDoMister: '5521900000000', ligado: false, final: null, ligadoEm: null, pausado: false, codigo: null },
      // a parte "Avisos e relatórios"
      avisos: o.avisos ?? AVISOS_PADRAO(), avisosFalha: !!o.avisosFalha, recusaDosAvisos: o.recusaDosAvisos ?? null, salvamentos: [],
      // a faixa dos avisos da loja (F1.4)
      daLoja: o.daLoja ?? [], semConexao: !!o.semConexao, cientes: [],
      // o histórico (F1.4 parte B)
      historico: o.historico ?? HISTORICO(), historicoFalha: !!o.historicoFalha, diasPedidos: [],
      relatorios: o.relatorios ?? RELATORIOS_PADRAO(), salvamentosRel: [],
      // M3a parte 3: os ajustes da conversa e a parte "Documentos"
      // Versão 4, M4a (mig 447): o perfil, o jeito e os grupos de aviso vêm junto (o padrão: nada muda).
      conversa: o.conversa ?? { documentosLigado: true, documentosModo: 'sozinho', perfil: 'hoje', jeito: null, avisosEscritos: [] }, salvamentosConv: [], conversaFalha: !!o.conversaFalha,
      // Versão 4, M4b: a memória (as anotações cruas; a resposta da tela se monta como o servidor monta).
      memoria: o.memoria ?? MEMORIA(), memoriaFalha: !!o.memoriaFalha, memoriaRecusa: o.memoriaRecusa ?? null, memoriaPedidos: [],
      // Os documentos por foto ligados nesta instalação (a variável que o dono liga), como o servidor manda.
      disponivelDocs: o.disponivelDocs ?? true,
      // Versão 5, M5e: a versão 5 ligada nesta instalação (`MISTER_MIDIA`) — o "Como mandar o resumo" diz quando não está.
      resumoEmArquivo: o.resumoEmArquivo ?? true,
      documentos: o.documentos ?? DOCUMENTOS(), documentosFalha: !!o.documentosFalha, diasDosDocumentos: [], desfeitos: [], pdfs: [],
      // M3c.4: a página do relatório do link
      relatorio: o.relatorio ?? RELATORIO_INSUMO(), relatorioRecusa: o.relatorioRecusa ?? null, relatorioPedidos: [], relatorioPdfs: [],
    };
    const ctx = await nav.newContext({ viewport: { width: w, height: h }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', hasTouch: w < 900 });
    await ctx.addInitScript((jwt) => localStorage.setItem('regen_token', jwt), o.token ?? PRESIDENTE);
    const page = await ctx.newPage();
    const erros = [];
    page.on('pageerror', (e) => erros.push(String(e?.message ?? e)));
    await page.route('**/socket.io/**', (r) => r.abort());
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const p = url.pathname.replace(/^.*\/api\/v1/, '');
      const metodo = req.method();
      if (p.startsWith('/ia/')) S.pedidos.push({ metodo, p, consulta: url.search, corpo: req.postData() });
      if (p.startsWith('/mister/')) S.doMister.push({ metodo, p });
      if (p === '/mister/avisos' && metodo === 'GET') {
        if (S.avisosFalha) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        return responder(route, S.avisos);
      }
      if (p === '/mister/avisos/abertos' && metodo === 'GET') return responder(route, { avisos: S.daLoja, ...(S.semConexao ? { semConexao: true } : {}) });
      if (p === '/mister/avisos/historico' && metodo === 'GET') {
        S.diasPedidos.push(url.searchParams.get('dias'));
        if (S.historicoFalha) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        const avisos = S.historico;
        return responder(route, { contagens: { todos: avisos.length, aberto: avisos.filter((a) => a.situacao === 'aberto').length, resolvido: avisos.filter((a) => a.situacao === 'resolvido').length }, limite: 200, avisos });
      }
      const ciente = /^\/mister\/avisos\/([^/]+)\/ciente$/.exec(p);
      if (ciente && metodo === 'POST') {
        S.cientes.push(ciente[1]);
        S.daLoja = S.daLoja.map((a) => (a.id === ciente[1] ? { ...a, ciente: true } : a));
        return responder(route, { ok: true }, 201);
      }
      const disponivel = () => ({ documentos: S.disponivelDocs, notas: S.disponivelDocs, resumoEmArquivo: S.resumoEmArquivo });
      if (p === '/mister/conversa' && metodo === 'GET') {
        if (S.conversaFalha) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        return responder(route, { conversa: S.conversa, disponivel: disponivel() });
      }
      if (p === '/mister/conversa' && metodo === 'PATCH') {
        const corpo = JSON.parse(req.postData() || '{}');
        S.salvamentosConv.push(corpo);
        S.conversa = { ...S.conversa, ...corpo };
        return responder(route, { conversa: S.conversa, disponivel: disponivel() });
      }
      // Versão 4, M4b (mig 449): "O que o Mister sabe" — a lista, anotar, mudar e esquecer (a recusa vem do servidor).
      if (p === '/mister/memoria' && metodo === 'GET') {
        if (S.memoriaFalha) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        return responder(route, memoriaDaTela(S.memoria));
      }
      const daMemoria = /^\/mister\/memoria(?:\/([^/]+))?$/.exec(p);
      if (daMemoria && metodo !== 'GET') {
        const corpo = JSON.parse(req.postData() || '{}');
        S.memoriaPedidos.push({ metodo, id: daMemoria[1] ?? null, corpo });
        if (S.memoriaRecusa && metodo !== 'DELETE') return responder(route, { statusCode: 400, message: S.memoriaRecusa }, 400);
        if (metodo === 'POST') {
          const item = { id: `m${S.memoriaPedidos.length}`, colaboradorId: corpo.sobre === 'empresa' ? null : corpo.sobre, texto: corpo.texto, origem: 'presidente', criadoEm: '2026-11-18T13:00:00Z', anotadoPor: 'Rodrigo Teixeira' };
          S.memoria = [...S.memoria, item];
          return responder(route, { item, uso: 'ok' }, 201);
        }
        if (metodo === 'PATCH') {
          S.memoria = S.memoria.map((i) => (i.id === daMemoria[1] ? { ...i, texto: corpo.texto } : i));
          return responder(route, { item: S.memoria.find((i) => i.id === daMemoria[1]), uso: 'ok' });
        }
        if (metodo === 'DELETE') {
          S.memoria = S.memoria.filter((i) => i.id !== daMemoria[1]);
          return responder(route, { item: { id: daMemoria[1] }, uso: 'ok' });
        }
      }
      if (p === '/mister/documentos' && metodo === 'GET') {
        S.diasDosDocumentos.push(url.searchParams.get('dias'));
        if (S.documentosFalha) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        return responder(route, { dias: Number(url.searchParams.get('dias') ?? 30), limite: 200, documentos: S.documentos });
      }
      // M3c.4: a página do relatório do link e o PDF dela (pelos mesmos parâmetros).
      if (p === '/mister/relatorio/insumo' && metodo === 'GET') {
        S.relatorioPedidos.push(url.search);
        if (S.relatorioRecusa) return responder(route, { statusCode: 403, message: S.relatorioRecusa }, 403);
        return responder(route, S.relatorio);
      }
      if (p === '/mister/relatorio/insumo/pdf' && metodo === 'GET') {
        S.relatorioPdfs.push(url.search);
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4\n%%EOF\n') });
      }
      // M3a parte 4b: o PDF do boleto lançado (um PDF mínimo; a tela só abre o arquivo).
      const pdfDoDoc = /^\/mister\/documentos\/([^/]+)\/pdf$/.exec(p);
      if (pdfDoDoc && metodo === 'GET') {
        S.pdfs.push(pdfDoDoc[1]);
        return route.fulfill({ status: 200, contentType: 'application/pdf', body: Buffer.from('%PDF-1.4\n%%EOF\n') });
      }
      const desfazer = /^\/mister\/documentos\/([^/]+)\/desfazer$/.exec(p);
      if (desfazer && metodo === 'POST') {
        S.desfeitos.push(desfazer[1]);
        S.documentos = S.documentos.map((d) => (d.id === desfazer[1] ? { ...d, situacao: 'desfeito', podeDesfazer: false } : d));
        return responder(route, { resultado: 'feito' }, 201);
      }
      if (p === '/mister/relatorios' && metodo === 'GET') return responder(route, { relatorios: S.relatorios });
      if (p === '/mister/relatorios' && metodo === 'PATCH') {
        const corpo = JSON.parse(req.postData() || '{}');
        S.salvamentosRel.push(corpo);
        for (const r of corpo.relatorios ?? []) {
          const x = S.relatorios.find((y) => y.tipo === r.tipo);
          if (x) {
            const linha = r.linhaAmanha ?? x.regra.linhaAmanha;
            x.regra = { ligado: r.ligado, hora: r.hora, diaSemana: r.diaSemana, ...(r.convidarFora === undefined ? {} : { convidarFora: r.convidarFora }), ...(linha === undefined ? {} : { linhaAmanha: linha }) };
          }
        }
        return responder(route, { relatorios: S.relatorios });
      }
      if (p === '/mister/avisos' && metodo === 'PATCH') {
        const corpo = JSON.parse(req.postData() || '{}');
        S.salvamentos.push(corpo);
        if (S.recusaDosAvisos) return responder(route, { statusCode: 400, message: S.recusaDosAvisos }, 400);
        for (const r of corpo.regras ?? []) {
          const a = S.avisos.avisos.find((x) => x.tipo === r.tipo);
          if (a) Object.assign(a, { padrao: false, regra: { ligado: r.ligado, destinos: r.destinos, escalaMin: r.escalaMin, escalaPara: r.escalaPara, parametro: r.parametro, ...(r.valores ? { valores: r.valores } : {}) } });
        }
        return responder(route, S.avisos);
      }
      if (p === '/mister/pessoas' && metodo === 'GET') {
        if (S.pessoasFalha) return responder(route, { statusCode: 500, message: 'Erro interno' }, 500);
        return responder(route, { disponivel: S.disponivel, numeroDoMister: S.disponivel ? '5521900000000' : null, souPresidente: S.souPresidente, total: S.pessoas.length, pessoas: S.pessoas });
      }
      if (p === '/mister/whatsapp/codigo' && metodo === 'POST') {
        if (S.recusaDoCodigo) return responder(route, { statusCode: 409, message: S.recusaDoCodigo }, 409);
        S.codigos += 1;
        const codigo = String(482912 + S.codigos);
        // Só o PRIMEIRO código usa a validade curta do cenário "vencido"; o gerado depois vale os 10 minutos.
        const vale = S.codigos === 1 ? S.valeMs : 600_000;
        S.meu = { ...S.meu, codigo: { codigo, mensagem: `MISTER ${codigo}`, link: `https://wa.me/5521900000000?text=MISTER%20${codigo}`, expiraEm: new Date(Date.now() + vale).toISOString() } };
        return responder(route, S.meu, 201);
      }
      if (p === '/mister/whatsapp' && metodo === 'GET') {
        S.leiturasDoMeu += 1;
        if (S.ligaNaLeitura && S.leiturasDoMeu >= S.ligaNaLeitura && !S.meu.ligado) {
          S.meu = { ...S.meu, ligado: true, final: '4321', ligadoEm: '2026-11-13T15:00:00Z', codigo: null };
          S.pessoas = S.pessoas.map((x) => (x.voce ? { ...x, ligado: true, final: '4321', ligadoEm: '2026-11-13T15:00:00Z' } : x));
        }
        return responder(route, S.meu);
      }
      const paraDesligar = /^\/mister\/pessoas\/([^/]+)$/.exec(p);
      if (paraDesligar && metodo === 'DELETE') {
        S.pessoas = S.pessoas.map((x) => (x.colaboradorId === paraDesligar[1] ? { ...x, ligado: false, final: null, ligadoEm: null, pausado: false } : x));
        return responder(route, { desligado: true });
      }
      if (p === '/modulos/meus') return responder(route, { mister: S.modulo, mesas: true, kds: true });
      // Visão C&O: a lista de módulos e o liga/desliga
      if (p === '/diretoria/multiunidade') return responder(route, { unidades: [], rede: null });
      if (p === '/modulos' && metodo === 'GET')
        return responder(route, {
          modulos: [
            { chave: 'kds', label: 'KDS de Alertas', emoji: '🖥️' },
            { chave: 'mister', label: 'Mister', emoji: '✨', padrao: false },
          ],
          unidades: [],
          rede: { kds: true, mister: S.modulo },
          porUnidade: {},
        });
      if (p === '/modulos' && metodo === 'POST') {
        S.modulos.push(JSON.parse(req.postData() ?? '{}'));
        return responder(route, { ok: true }, 201);
      }
      if (p === '/ia/chave' && metodo === 'GET') return responder(route, S.estado);
      if (p === '/ia/chave' && metodo === 'POST') {
        if (S.recusa) return responder(route, { statusCode: 400, message: S.recusa }, 400);
        S.estado = comChave(o.aoSalvar ?? 'ok');
        return responder(route, S.estado, 201);
      }
      if (p === '/ia/chave/testar') {
        S.estado = comChave(o.aoTestar ?? 'ok');
        return responder(route, S.estado, 201);
      }
      if (p === '/ia/chave' && metodo === 'DELETE') {
        S.estado = SEM_CHAVE;
        return responder(route, S.estado);
      }
      if (p === '/ia/uso') return S.usoFalha ? responder(route, { statusCode: 500, message: 'Erro interno' }, 500) : responder(route, S.uso);
      // Versão 5 (M5b.2): a situação do DMS Graph para o quadro "Fotos e áudios" (sem `o.graph`, o `{}` de sempre: some).
      if (p === '/graph/clique/situacao' && o.graph) return responder(route, SITUACAO_DO_GRAPH(o.graph));
      return responder(route, {});
    });
    await page.goto(base + (o.caminho ?? '/mister?parte=ia'));
    return { ctx, page, erros, S };
  }
  const daIa = (S, metodo, p) => S.pedidos.filter((x) => x.metodo === metodo && x.p === p);

  // ── a faixa dos avisos da loja (F1.4, protótipo aprovado em 14/11): o aviso mais recente, "Ciente" por pessoa, o ⚠️ do
  //    topo depois do Ciente, a gaveta com todos e o "sem conexão" que não inventa nada ──
  const AVISOS_DA_LOJA = () => [
    { id: 'a1', grupo: 'Na loja', titulo: 'Loja Centro · impressora Cozinha parada', detalhe: 'Confira se ela está ligada, com papel e no cabo ou na rede.', abertoEm: new Date(Date.now() - 3 * 60_000).toISOString(), escalado: false, tambem: ['KDS da cozinha'], ciente: false },
    { id: 'a2', grupo: 'Na loja', titulo: 'Loja Centro · pedido #284 · iFood 4821 aceito há mais de 20 min e ainda não ficou pronto', detalhe: 'Confira na cozinha se ele está sendo feito.', abertoEm: new Date(Date.now() - 26 * 60_000).toISOString(), escalado: true, tambem: ['KDS da cozinha', 'WhatsApp do gerente da loja'], ciente: false },
  ];
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { daLoja: AVISOS_DA_LOJA(), caminho: '/mister?parte=ia' });
    const faixa = page.locator('div[role="status"]:has-text("Ver os 2 avisos")');
    await faixa.waitFor({ timeout: 20000 });
    const tf = await faixa.innerText();
    ok(/impressora Cozinha parada/.test(tf) && /há 3 min/.test(tf) && /Confira se ela está ligada/.test(tf), `faixa: o aviso mais recente, há quanto tempo e o que fazer (${tf.replace(/\s+/g, ' ')})`);
    await faixa.locator('button:has-text("Ciente")').click();
    const segunda = page.locator('div[role="status"]:has-text("pedido #284")');
    await segunda.waitFor();
    ok(S.cientes.includes('a1'), 'faixa: o "Ciente" vai ao servidor');
    ok(/sem solução/.test(await segunda.innerText()), 'faixa: o aviso que escalou diz "sem solução"');
    await segunda.locator('button:has-text("Ciente")').click();
    const chip = page.locator('button[aria-label="2 avisos da loja abertos"]');
    await chip.waitFor();
    ok((await page.locator('div[role="status"]:has-text("Ver os")').count()) === 0, 'faixa: com tudo "Ciente", a faixa some e o ⚠️ do topo aparece');
    await chip.click();
    const gaveta = page.locator('[role="dialog"]:has-text("Avisos da loja")');
    await gaveta.waitFor();
    const tg = await gaveta.innerText();
    ok(/2 abertos/.test(tg) && /também foi para KDS da cozinha, WhatsApp do gerente da loja/.test(tg) && /Confira na cozinha/.test(tg) && /sem solução/.test(tg), 'gaveta: os dois avisos, o que fazer, para onde mais foram e o que escalou');
    await page.keyboard.press('Escape');
    await gaveta.waitFor({ state: 'detached' });
    ok(true, 'gaveta: Esc fecha');
    ok(erros.length === 0, `faixa: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { daLoja: [], semConexao: true, caminho: '/mister?parte=ia' });
    await page.waitForSelector('h1', { timeout: 20000 });
    await page.waitForTimeout(1200);
    ok((await page.locator('div[role="status"]:has-text("Ver o")').count()) === 0 && (await page.locator('button[aria-label$="da loja abertos"], button[aria-label$="da loja aberto"]').count()) === 0, 'sem conexão com a nuvem: nem faixa nem ⚠️ (não inventa nada)');
    await ctx.close();
  }
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { daLoja: AVISOS_DA_LOJA(), caminho: '/mister?parte=ia' });
    const faixa = page.locator('div[role="status"]:has-text("Ver os 2 avisos")');
    await faixa.waitFor({ timeout: 20000 });
    const fora = await faixa.evaluate((el) => {
      const achados = [];
      if (el.getBoundingClientRect().right > window.innerWidth + 1) achados.push('a faixa passa da tela');
      for (const b of el.querySelectorAll('button')) {
        const cs = getComputedStyle(b);
        const linha = parseFloat(cs.lineHeight) || 20;
        if (b.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) > linha * 1.6) achados.push(`botão quebrado "${b.textContent.trim()}"`);
        if (b.getBoundingClientRect().height < 39.5) achados.push(`botão baixo "${b.textContent.trim()}"`);
      }
      return achados;
    });
    let m = await medir(page);
    ok(fora.length === 0 && m.length === 0, `${w}px: a faixa inteira na tela, sem barra lateral e com botões inteiros (${[...fora, ...m].join(' | ')})`);
    if (w === 375 || w === 1440) await page.screenshot({ path: foto(`${w}-faixa-dos-avisos.png`) });
    await faixa.locator('button:has-text("Ver os 2 avisos")').click();
    await page.locator('[role="dialog"]:has-text("Avisos da loja")').waitFor();
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta dos avisos inteira na tela (${m.join(' | ')})`);
    ok(erros.length === 0, `${w}px: faixa sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── Mister › Histórico (F1.4 parte B): a contagem, as situações, a busca, o grupo, o período, a gaveta com a trilha,
  //    o vazio dos filtros e o erro com "Tentar de novo" ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { caminho: '/mister?parte=historico' });
    await page.waitForSelector('h2:has-text("Histórico dos avisos")', { timeout: 20000 });
    const sec = page.locator('section[aria-labelledby="historico-avisos"]');
    await sec.locator('text=impressora Cozinha parada').first().waitFor();
    ok(/4 avisos · últimos 7 dias/.test(await sec.innerText()), 'histórico: a contagem e o período');
    ok(S.diasPedidos[0] === '7', 'histórico: começa pelos últimos 7 dias');
    await sec.locator('button[aria-pressed]:has-text("Abertos")').click();
    ok(/2 de 4 avisos/.test(await sec.innerText()), 'histórico: "Abertos" filtra (2 de 4)');
    await sec.locator('button[aria-pressed]:has-text("Abertos")').click();
    await page.fill('#hist-busca', 'certificado');
    ok(/1 de 4 avisos/.test(await sec.innerText()), 'histórico: a busca pelo título');
    await page.fill('#hist-busca', '');
    await page.selectOption('#hist-grupo', 'O próprio Mister');
    await sec.locator('text=Nada com esses filtros.').waitFor();
    ok(true, 'histórico: filtro sem resultado diz que não achou');
    await page.selectOption('#hist-grupo', '');
    const t = await sec.innerText();
    ok(/escalou/.test(t) && /fechado \(aviso desligado\)/.test(t) && /ninguém recebeu/.test(t) && /WhatsApp do gerente da loja \(••4821\)/.test(t), 'histórico: a situação (escalou, fechado porque desligou) e para onde foi');
    await sec.getByRole('button', { name: /Ver.*pedido #284/ }).first().click();
    const gaveta = page.locator('[role="dialog"]:has-text("Trilha")');
    await gaveta.waitFor();
    const tg = await gaveta.innerText();
    ok(/pelo modelo da Meta, fora das 24 horas/.test(tg) && /••4821/.test(tg) && /nunca o telefone inteiro/.test(tg), 'histórico: a gaveta com a trilha (o modelo da Meta, os 4 dígitos)');
    await page.keyboard.press('Escape');
    await gaveta.waitFor({ state: 'detached' });
    await page.selectOption('#hist-periodo', '1');
    await page.waitForTimeout(400);
    ok(S.diasPedidos.at(-1) === '1', 'histórico: mudar o período lê de novo no servidor');
    ok(erros.length === 0, `histórico: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { caminho: '/mister?parte=historico', historicoFalha: true });
    await page.locator('[role="alert"]:has-text("Não consegui carregar o histórico")').waitFor({ timeout: 20000 });
    S.historicoFalha = false;
    await page.click('button:has-text("Tentar de novo")');
    await page.waitForSelector('h2:has-text("Histórico dos avisos")');
    ok(true, 'histórico: o erro com "Tentar de novo", que lê de novo');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { caminho: '/mister?parte=historico', historico: [] });
    await page.locator('text=Nenhum aviso no período.').waitFor({ timeout: 20000 });
    ok(true, 'histórico: o vazio do período');
    await ctx.close();
  }
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { caminho: '/mister?parte=historico' });
    await page.waitForSelector('h2:has-text("Histórico dos avisos")', { timeout: 20000 });
    await page.locator('section[aria-labelledby="historico-avisos"] >> text=impressora Cozinha parada').first().waitFor();
    let m = await medir(page);
    ok(m.length === 0, `${w}px: o histórico sem barra lateral (${m.join(' | ')})`);
    if (w === 375 || w === 1440) await page.screenshot({ path: foto(`${w}-historico.png`), fullPage: true });
    await page.getByRole('button', { name: /Ver.*pedido #284/ }).first().click();
    await page.locator('[role="dialog"]:has-text("Trilha")').waitFor();
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta da trilha inteira na tela (${m.join(' | ')})`);
    ok(erros.length === 0, `${w}px: histórico sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── Visão C&O › Módulos do produto: o Mister DESLIGADO tem de APARECER e ligar com um toque ──
  // A chave desligada usava a cor do cartão (1,05:1) e ninguém via: todo módulo nascia ligado, até o Mister.
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { modulo: false, caminho: '/diretoria' });
    const chave = page.locator('button[role="switch"][aria-label="Mister na rede"]');
    await chave.waitFor({ timeout: 20000 });
    ok((await chave.getAttribute('aria-checked')) === 'false', 'Visão C&O: o Mister aparece na lista e nasce desligado');
    await page.waitForTimeout(250); // a cor termina a transição
    const contraste = await chave.evaluate((el) => {
      const cor = (s) => {
        const p = (s.match(/rgba?\(([^)]+)\)/)?.[1] ?? '255,255,255').split(/[,\s/]+/).filter(Boolean).map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
      };
      const fundo = (n) => {
        for (let x = n; x; x = x.parentElement) {
          const c = cor(getComputedStyle(x).backgroundColor);
          if (c.a > 0.99) return c;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
      };
      const atras = fundo(el.parentElement);
      const dela = cor(getComputedStyle(el).backgroundColor);
      const vista = { r: dela.r * dela.a + atras.r * (1 - dela.a), g: dela.g * dela.a + atras.g * (1 - dela.a), b: dela.b * dela.a + atras.b * (1 - dela.a) };
      const lum = (c) => {
        const f = (v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
      };
      const [claro, escuro] = [lum(vista), lum(atras)].sort((x, y) => y - x);
      return (claro + 0.05) / (escuro + 0.05);
    });
    ok(contraste >= 3, `Visão C&O: a chave DESLIGADA aparece sobre o cartão (contraste ${contraste.toFixed(2)}:1; o mínimo é 3:1)`);
    await page.screenshot({ path: foto('1280-modulo-desligado.png'), fullPage: true });
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/modulos') && r.request().method() === 'POST'), chave.click()]);
    ok(S.modulos.length === 1 && S.modulos[0].modulo === 'mister' && S.modulos[0].ativo === true && S.modulos[0].unidadeId === null, `Visão C&O: um toque liga o Mister na rede (${JSON.stringify(S.modulos[0])})`);
    await page.waitForSelector('text=Módulo ativado.');
    ok((await chave.getAttribute('aria-checked')) === 'true', 'Visão C&O: ligado, a chave muda de estado');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── módulo desligado: a tela explica e não pede a chave ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { modulo: false });
    await page.waitForSelector('text=O módulo Mister está desligado', { timeout: 20000 });
    ok((await page.locator('a[href="/diretoria"]:has-text("Abrir Visão C&O")').count()) === 1, 'módulo desligado: aponta Visão C&O › Módulos do produto');
    ok(S.pedidos.length === 0, `módulo desligado: nenhuma chamada às rotas da IA (${S.pedidos.length})`);
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── gerente: entra, só na parte "Pessoas", com a própria linha; nada da IA ──
  {
    const soEle = [gerente({ colaboradorId: 'c2', nome: 'Carlos Lima', loja: 'Loja Centro', voce: true })];
    const { ctx, page, erros, S } = await abrir(1280, 900, { token: GERENTE, caminho: '/mister?parte=ia', pessoas: soEle, souPresidente: false });
    await page.waitForSelector('text=Quem fala com o Mister', { timeout: 20000 });
    ok((await page.locator('[aria-label="Partes do Mister"] button').allInnerTexts()).join('|') === 'Pessoas|Regras', 'gerente: só as partes "Pessoas" e "Regras" (não há "IA e uso" para ele, nem pelo link)');
    ok(/Ligue o seu WhatsApp pelo seu celular/.test(await page.locator('main').innerText()), 'gerente: o texto é o dele (ligar o próprio WhatsApp)');
    const linhasDele = await page.locator('main table tbody tr').allInnerTexts();
    ok(linhasDele.length === 1 && /Carlos Lima \(você\)/.test(linhasDele[0].replace(/\s+/g, ' ')) && /gerente · Loja Centro/.test(linhasDele[0]), `gerente: só a própria linha (${linhasDele.length})`);
    ok((await page.locator('main table button:has-text("Ligar o meu WhatsApp")').count()) === 1, 'gerente: pode ligar o próprio WhatsApp');
    ok(S.pedidos.length === 0, `gerente: nenhuma chamada às rotas da IA (${S.pedidos.length})`);
    ok((await page.locator('nav a[href="/mister"]').count()) === 1, 'gerente: o item "Mister" aparece no menu');
    ok(erros.length === 0, `gerente: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── execução: não entra, não vê o item no menu e nada é pedido ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { token: EXECUCAO, caminho: '/mister' });
    await page.waitForSelector('text=Área restrita', { timeout: 20000 });
    // A faixa dos avisos da loja (F1.4) vale para todos os perfis: é a única leitura do Mister que a execução faz.
    const doMisterSemAFaixa = S.doMister.filter((x) => x.p !== '/mister/avisos/abertos');
    ok(S.pedidos.length === 0 && doMisterSemAFaixa.length === 0, `execução: área restrita, sem chamada à IA nem ao Mister (${S.pedidos.length + doMisterSemAFaixa.length})`);
    ok(S.doMister.some((x) => x.p === '/mister/avisos/abertos'), 'execução: a faixa dos avisos da loja lê os avisos (todos os perfis)');
    ok((await page.locator('nav a[href="/mister"]').count()) === 0, 'execução: o item "Mister" não aparece no menu');
    await ctx.close();
  }

  // ── PESSOAS, presidente: as duas partes, a lista inteira, e a IA só é lida quando aberta ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { caminho: '/mister?parte=pessoas' });
    await page.waitForSelector('text=Quem fala com o Mister', { timeout: 20000 });
    const partes = page.locator('[aria-label="Partes do Mister"] button');
    ok(
      (await partes.allInnerTexts()).join('|') === 'Resumo|Pessoas|Regras|IA e uso|Avisos e relatórios|Documentos|Histórico|Jeito e memória' && (await partes.nth(1).getAttribute('aria-pressed')) === 'true',
      'presidente: as partes "Resumo", "Pessoas", "Regras", "IA e uso", "Avisos e relatórios", "Documentos", "Histórico" e "Jeito e memória", com o link abrindo em Pessoas',
    );
    ok(S.pedidos.length === 0, 'em Pessoas, a parte da IA não é lida');
    ok(/O número do Mister é \+55 21 90000-0000/.test(await page.locator('main').innerText()), 'o número do Mister, formatado, para salvar nos contatos');
    const linhas = (await page.locator('main table tbody tr').allInnerTexts()).map((l) => l.replace(/\s+/g, ' '));
    ok(linhas.length === 4, `as quatro pessoas (${linhas.length})`);
    ok(/Ana Souza \(você\) presidente · todas as lojas ligado final 4321 · desde 02\/11 Avisos · Consulta · Autorização Desligar/.test(linhas[0]), `a linha do presidente (${linhas[0]})`);
    ok(/Carlos Lima gerente · Loja Centro ligado final 8890 · desde 05\/11 Avisos · Consulta Desligar/.test(linhas[1]), `a linha do gerente ligado (${linhas[1]})`);
    ok(/avisos parados final 1177/.test(linhas[2]) && /Respondeu PARAR AVISOS/.test(linhas[2]), 'quem respondeu PARAR AVISOS aparece com os avisos parados');
    ok(/não ligado Só a própria pessoa liga, entrando com o usuário dela\. Avisos · Consulta Perdi o celular$/.test(linhas[3].trim()), `quem não ligou: a frase e só o "Perdi o celular" (${linhas[3]})`);
    ok((await page.locator('main button:has-text("Editar o que pode")').count()) === 0, 'sem "Editar o que pode" (o perfil de permissões fica para o fim do projeto)');
    ok(!/\d{10,}/.test(linhas.join(' ')), 'nenhum telefone inteiro na lista');
    // desligar o WhatsApp de outra pessoa: pede confirmação; "Cancelar" não chama
    const desligar = (nome) => page.locator('main table tbody tr', { hasText: nome }).locator('button:has-text("Desligar")');
    await desligar('Carlos Lima').click();
    const alerta = page.locator('[role="alertdialog"]');
    await alerta.waitFor();
    ok(/Desligar o WhatsApp de Carlos Lima/.test(await alerta.innerText()) && /a própria pessoa liga de novo/.test(await alerta.innerText()), 'desligar outra pessoa: o diálogo diz de quem e como volta');
    await alerta.locator('button:has-text("Cancelar")').click();
    await alerta.waitFor({ state: 'detached' });
    ok(S.doMister.filter((x) => x.metodo === 'DELETE').length === 0, 'desligar: "Cancelar" não chama o servidor');
    await desligar('Carlos Lima').click();
    await alerta.locator('button:has-text("Desligar")').click();
    await page.waitForSelector('text=WhatsApp desligado.');
    const apagou = S.doMister.filter((x) => x.metodo === 'DELETE');
    ok(apagou.length === 1 && apagou[0].p === '/mister/pessoas/c2', `desligar confirmado: a pessoa certa vai ao servidor (${apagou.map((x) => x.p).join(',')})`);
    await page.locator('main table tbody tr', { hasText: 'Carlos Lima' }).locator('text=não ligado').waitFor();
    ok((await desligar('Carlos Lima').count()) === 0, 'depois de desligar: a linha mostra "não ligado", sem botão');
    // o próprio: o diálogo fala com ele
    await desligar('Ana Souza').click();
    await alerta.waitFor();
    ok(/Desligar o meu WhatsApp/.test(await alerta.innerText()) && /ligue de novo pelo seu celular/.test(await alerta.innerText()), 'desligar o próprio: o diálogo é o dele');
    await page.keyboard.press('Escape');
    await alerta.waitFor({ state: 'detached' });
    // a outra parte
    await page.click('[aria-label="Partes do Mister"] button:has-text("IA e uso")');
    await page.waitForSelector('text=Chave de IA');
    ok(daIa(S, 'GET', '/ia/chave').length === 1, 'abrir "IA e uso": aí sim a chave é lida');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── M3d: as imagens do "como faço" do Mister — ligar o WhatsApp, a chave de IA e os relatórios (só gera com
  //    GERAR_COMO_FACO=1; sem a variável, confere que cada marca está na tela, inteira e na frente) ──
  {
    const { ctx, page } = await abrir(1280, 900, { caminho: '/mister?parte=pessoas', pessoas: NINGUEM });
    const ligar = page.locator('main table button:has-text("Ligar o meu WhatsApp")').first();
    await ligar.waitFor({ timeout: 20000 });
    const menu = page.locator('aside a[href="/mister"] >> visible=true').first();
    const parte = (nome) => page.locator(`[aria-label="Partes do Mister"] button:has-text("${nome}")`).first();
    const conferir = (id, r) => ok(r.achou.every(Boolean), `como faço (${id}): as marcas estão na tela (${r.achou.join(', ')})${r.gerou ? ' — imagem gerada' : ''}${(r.motivos ?? []).filter(Boolean).length ? ` — ${(r.motivos ?? []).join(' | ')}` : ''}`);
    // Só duas marcas: o gerente também liga o próprio WhatsApp e, para ele, não há a faixa de partes (abre já em Pessoas).
    conferir('mister-ligar-whatsapp', await fotoDoComoFaco(page, 'mister-ligar-whatsapp', [menu, ligar]));
    await parte('IA e uso').click();
    await page.waitForSelector('text=Chave de IA');
    conferir('mister-chave-de-ia', await fotoDoComoFaco(page, 'mister-chave-de-ia', [
      menu, parte('IA e uso'), page.locator('main input[type="password"]').first(), page.locator('main button:has-text("Salvar chave")').first(),
    ]));
    // Os relatórios ficam no fim da parte (uns 2.900 px abaixo): rolar até eles tira a faixa das partes da tela e a
    // conferência reprova. A busca da tela de ajustes ("resumo") traz o grupo para cima — e vira a dica da imagem.
    await parte('Avisos e relatórios').click();
    await page.waitForSelector('#mister-avisos-titulo');
    await page.fill('#mister-avisos-busca', 'resumo');
    const grupoDosRelatorios = page.locator('main h3:text-is("Relatórios")').first();
    await grupoDosRelatorios.waitFor();
    conferir('mister-resumo-e-avisos', await fotoDoComoFaco(page, 'mister-resumo-e-avisos', [
      menu, parte('Avisos e relatórios'), page.locator('#mister-avisos-busca'), grupoDosRelatorios,
    ]));
    await ctx.close();
  }

  // ── PESSOAS: ligar o meu WhatsApp — o código, o QR, o link, a espera e o "Ligado" ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { caminho: '/mister?parte=pessoas', pessoas: NINGUEM, ligaNaLeitura: 2 });
    await page.click('main table button:has-text("Ligar o meu WhatsApp")');
    const dialogo = page.locator('[role="dialog"]');
    await dialogo.locator('text=Esperando a sua mensagem').waitFor({ timeout: 15000 });
    const texto = await dialogo.innerText();
    ok(/Ligar o meu WhatsApp ao Mister/.test(texto) && /MISTER 482913/.test(texto) && /para o número do Mister/.test(texto), 'ligar: o diálogo mostra a mensagem com a palavra MISTER e o código');
    ok(/o código vale até \d{2}:\d{2} e uma vez só/.test(texto), 'ligar: diz até quando o código vale');
    ok((await dialogo.locator('a[href="https://wa.me/5521900000000?text=MISTER%20482913"]').count()) === 1, 'ligar: o link abre o WhatsApp do número do Mister com a mensagem pronta');
    const qr = dialogo.locator('img[alt="Código para abrir o WhatsApp com a mensagem pronta"]');
    await qr.waitFor();
    ok((await qr.getAttribute('src'))?.startsWith('data:image/png'), 'ligar: o código para a câmera é desenhado');
    await dialogo.locator('text=Ligado.').waitFor({ timeout: 15000 });
    ok(/Final 4321/.test(await dialogo.innerText()), 'ligar: quando a mensagem chega, a tela mostra "Ligado" e o final do número');
    const lidas = S.leiturasDoMeu;
    await page.waitForTimeout(3500);
    ok(S.leiturasDoMeu === lidas, `ligado: a tela para de perguntar ao servidor (${lidas} → ${S.leiturasDoMeu})`);
    await dialogo.locator('button:has-text("Fechar")').click();
    await dialogo.waitFor({ state: 'detached' });
    await page.locator('main table tbody tr', { hasText: 'Ana Souza' }).locator('text=final').waitFor();
    ok(S.codigos === 1, 'ligar: um código só foi gerado');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── PESSOAS: o código vence — "Gerar outro código" ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { caminho: '/mister?parte=pessoas', pessoas: NINGUEM, valeMs: 2000 });
    await page.click('main table button:has-text("Ligar o meu WhatsApp")');
    const dialogo = page.locator('[role="dialog"]');
    await dialogo.locator('text=O código venceu. Gere outro para ligar.').waitFor({ timeout: 15000 });
    ok(!/MISTER 482913/.test(await dialogo.innerText()), 'código vencido: o código velho sai da tela');
    await dialogo.locator('button:has-text("Gerar outro código")').click();
    await dialogo.locator('text=MISTER 482914').first().waitFor();
    ok(S.codigos === 2, 'código vencido: "Gerar outro código" pede um novo ao servidor');
    await ctx.close();
  }

  // ── PESSOAS: o Mister indisponível, a recusa do servidor e o erro ao carregar ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { caminho: '/mister?parte=pessoas', pessoas: NINGUEM, disponivel: false });
    await page.waitForSelector('text=O Mister ainda não está disponível pelo WhatsApp');
    ok(await page.locator('main table button:has-text("Ligar o meu WhatsApp")').isDisabled(), 'Mister indisponível: avisa e trava o "Ligar"');
    ok(!/\+55 21/.test(await page.locator('main').innerText()) && S.codigos === 0, 'Mister indisponível: não mostra número e não gera código');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { caminho: '/mister?parte=pessoas', pessoas: NINGUEM, recusaDoCodigo: 'O Mister ainda não está disponível pelo WhatsApp. Fale com a Regem.' });
    await page.click('main table button:has-text("Ligar o meu WhatsApp")');
    await page.waitForSelector('[role="dialog"] [role="alert"]:has-text("Fale com a Regem")');
    ok((await page.locator('[role="dialog"] button:has-text("Tentar de novo")').count()) === 1, 'recusa ao gerar o código: a frase do servidor, com "Tentar de novo"');
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { caminho: '/mister?parte=pessoas', pessoasFalha: true });
    await page.waitForSelector('text=Não consegui carregar as pessoas agora.');
    S.pessoasFalha = false;
    await page.click('main button:has-text("Tentar de novo")');
    await page.locator('main table tbody tr').first().waitFor();
    ok(true, 'erro ao carregar as pessoas: avisa e "Tentar de novo" lê de novo');
    await ctx.close();
  }

  // ── sem chave própria: a IA incluída; colar, salvar, testar, apagar ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, {});
    await page.waitForSelector('text=IA incluída pela Regem.', { timeout: 20000 });
    const campo = page.locator('input[type="password"]');
    ok((await campo.getAttribute('autocomplete')) === 'new-password', 'o campo da chave não deixa o navegador preencher nem guardar (V54)');
    ok((await campo.getAttribute('placeholder')) === 'cole a chave que começa com sk-ant-', 'sem chave: o campo pede a chave');
    ok((await page.locator('button:has-text("Apagar a chave")').count()) === 0, 'sem chave: não há "Apagar a chave"');

    await page.click('button:has-text("Testar conexão")');
    await page.waitForSelector('text=Cole a chave e clique em "Salvar chave"');
    await page.click('button:has-text("Salvar chave")');
    await page.waitForSelector('text=Cole a chave de IA.');
    ok(daIa(S, 'POST', '/ia/chave').length === 0 && daIa(S, 'POST', '/ia/chave/testar').length === 0, 'campo vazio: nada vai ao servidor');

    await campo.fill(`  ${CHAVE}  `);
    await Promise.all([page.waitForResponse((r) => r.url().includes('/ia/chave') && r.request().method() === 'POST'), page.click('button:has-text("Salvar chave")')]);
    await page.waitForSelector('text=Chave conferida e salva.');
    const enviado = JSON.parse(daIa(S, 'POST', '/ia/chave')[0].corpo);
    ok(enviado.provedor === 'anthropic' && enviado.chave === CHAVE, 'salvar: vai o provedor e a chave SEM os espaços das pontas');
    ok((await campo.inputValue()) === '', 'salvar: o campo esvazia');
    ok(!(await page.content()).includes(CHAVE), 'salvar: a chave não fica em lugar nenhum da página');
    const faixa = await page.locator('[role="status"]').first().innerText();
    ok(/Chave salva · final ZZ99/.test(faixa) && /conferida em 12\/11 às 22:10/.test(faixa) && /funcionando/.test(faixa), `a situação: ${umaLinha(faixa)}`);
    ok((await campo.getAttribute('placeholder')) === '•••••• (mantém)', 'com chave salva: o campo vazio mantém a que está guardada');
    await page.screenshot({ path: foto('1280-chave-salva.png'), fullPage: true });

    await Promise.all([page.waitForResponse((r) => r.url().includes('/ia/chave/testar')), page.click('button:has-text("Testar conexão")')]);
    await page.waitForSelector('text=Conectado ✓');
    ok(daIa(S, 'POST', '/ia/chave/testar').length === 1, 'testar: prova a chave guardada');

    // apagar: pede a confirmação; "Cancelar" não apaga
    await page.click('button:has-text("Apagar a chave")');
    await page.waitForSelector('[role="alertdialog"]');
    await page.click('[role="alertdialog"] button:has-text("Cancelar")');
    await page.waitForSelector('[role="alertdialog"]', { state: 'detached' });
    ok(daIa(S, 'DELETE', '/ia/chave').length === 0, 'apagar: "Cancelar" não apaga');
    await page.click('button:has-text("Apagar a chave")');
    await Promise.all([page.waitForResponse((r) => r.request().method() === 'DELETE'), page.click('[role="alertdialog"] button:has-text("Apagar a chave")')]);
    await page.waitForSelector('text=IA incluída pela Regem.');
    ok(daIa(S, 'DELETE', '/ia/chave').length === 1, 'apagar: confirma, apaga e a tela volta para a IA incluída');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── a recusa do servidor aparece com a frase dele; chave salva sem crédito ──
  {
    const { ctx, page, S } = await abrir(1280, 900, { recusa: 'A Anthropic recusou esta chave. Confira se ela está ativa e se foi copiada inteira.' });
    await page.waitForSelector('text=IA incluída pela Regem.', { timeout: 20000 });
    await page.locator('input[type="password"]').fill(CHAVE);
    await page.click('button:has-text("Salvar chave")');
    await page.waitForSelector('text=A Anthropic recusou esta chave.');
    ok((await page.locator('text=Chave salva · final').count()) === 0, 'chave recusada: a tela não diz que salvou');
    ok(daIa(S, 'POST', '/ia/chave').length === 1, 'chave recusada: a frase do servidor aparece');
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { estado: comChave('sem_credito'), aoTestar: 'sem_credito' });
    await page.waitForSelector('text=sem crédito', { timeout: 20000 });
    const faixa = await page.locator('[role="status"]').first().innerText();
    ok(/Compre crédito no console dela/.test(faixa), `sem crédito: a faixa diz o que fazer (${umaLinha(faixa)})`);
    await page.click('button:has-text("Testar conexão")');
    await page.waitForSelector('text=Falhou: a conta está sem crédito.');
    ok(true, 'sem crédito: o teste diz por que falhou');
    await ctx.close();
  }

  // ── o uso: rótulos, tokens, custo, total; vazio; erro; atalhos; período invertido ──
  {
    const { ctx, page, erros, S } = await abrir(1440, 900, { estado: comChave() });
    await page.waitForSelector('text=Copiloto do atendimento', { timeout: 20000 });
    const t = await page.locator('main').innerText();
    ok(/Claude Haiku 5\.5/.test(t) && /Claude Sonnet 5\.5/.test(t) && /modelo-novo/.test(t), 'uso: o nome de cada modelo (o que não conhece sai como veio)');
    ok(/780 mil · 62 mil/.test(t) && /3,4 mi · 224 mil/.test(t), 'uso: os tokens curtos, com o cache na entrada');
    ok(/Mister · perguntas/.test(t) && !/mister_perguntas/.test(t), 'uso: as perguntas do Mister saem com o nome da tela, não com o do servidor');
    ok(/é só perguntar a ele sobre a loja/.test(t) && !/perguntas chegam nas próximas/.test(t), 'página: a abertura diz que já dá para perguntar');
    ok(/US\$ 0,11/.test(t) && /US\$ 8,96/.test(t) && /sem preço/.test(t), 'uso: o custo em dólar e "sem preço" para o modelo fora da tabela');
    ok(/IA incluída/.test(t) && /2 falhas/.test(t), 'uso: marca o que foi pela IA incluída e as falhas');
    ok(/Total do período: 382 chamadas/.test(t) && /Na sua chave: US\$ 9,07/.test(t) && /IA incluída: US\$ 0,01/.test(t), 'uso: o total por dono da chave');
    ok(/lida em 12\/11\/2026/.test(t) && /Sem preço na tabela \(fora da soma\): modelo-novo/.test(t), 'uso: a data da tabela de preços e o que ficou fora da soma');
    const primeira = daIa(S, 'GET', '/ia/uso')[0]?.consulta ?? '';
    ok(/de=\d{4}-\d{2}-\d{2}&ate=\d{4}-\d{2}-\d{2}/.test(primeira), `uso: pede o período (${primeira})`);
    const antes = daIa(S, 'GET', '/ia/uso').length;
    await Promise.all([page.waitForResponse((r) => r.url().includes('/ia/uso')), page.click('button:has-text("7 dias")')]);
    const sete = daIa(S, 'GET', '/ia/uso').at(-1).consulta;
    const [, de, ate] = /de=([\d-]+)&ate=([\d-]+)/.exec(sete) ?? [];
    ok(daIa(S, 'GET', '/ia/uso').length === antes + 1 && (Date.parse(ate) - Date.parse(de)) / 86_400_000 === 6, `atalho "7 dias": pede 7 dias (${sete})`);
    ok((await page.locator('button:has-text("7 dias")').getAttribute('aria-pressed')) === 'true', 'atalho "7 dias": fica marcado');
    // período invertido: avisa e não pede
    const n = daIa(S, 'GET', '/ia/uso').length;
    await page.locator('input[type="date"]').first().fill('2027-01-01');
    await page.waitForSelector('text=A data inicial vem depois da final.');
    await page.waitForTimeout(300);
    ok(daIa(S, 'GET', '/ia/uso').length === n, 'período invertido: avisa e não pede ao servidor');
    // o guia em gaveta: abre, Esc fecha
    await page.click('button:has-text("Como criar a chave, passo a passo")');
    await page.waitForSelector('[role="dialog"]:has-text("Como criar a chave na Anthropic")');
    const guia = await page.locator('[role="dialog"]').innerText();
    const noGuia = (...nomes) => nomes.filter((n) => !guia.includes(n));
    const faltamPt = noGuia('Adicionar saldo', 'Criar workspace', 'Gerenciar workspaces', 'Limites de gastos', 'Ajustar limite', 'Chaves de API', 'Criar chave', 'Continuar com uma chave de API', 'Nunca', 'Conta vinculada', 'Escopo');
    ok(faltamPt.length === 0, `o guia: os botões do console com o nome em português (faltam: ${faltamPt.join(', ')})`);
    const faltamEn = noGuia('Buy credits', 'Create workspace', 'Spend limits', 'Create key', 'Never');
    ok(faltamEn.length === 0, `o guia: o nome em inglês entre parênteses (faltam: ${faltamEn.join(', ')})`);
    ok(!/console da Anthropic é em inglês/.test(guia), 'o guia: não diz mais que o console é em inglês');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    ok(true, 'o guia: Esc fecha');
    ok(erros.length === 0, `sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page } = await abrir(1280, 900, { estado: comChave(), uso: { ...USO, itens: [], custoEstimadoUsd: { lojista: 0, distribuicao: 0 }, semPreco: [] } });
    await page.waitForSelector('text=Nenhum uso de IA neste período.', { timeout: 20000 });
    ok(true, 'uso vazio: diz que não houve uso');
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { estado: comChave(), usoFalha: true });
    await page.waitForSelector('text=Não consegui ler o uso agora.', { timeout: 20000 });
    const n = daIa(S, 'GET', '/ia/uso').length;
    S.usoFalha = false;
    await page.click('button:has-text("Tentar de novo")');
    await page.waitForSelector('text=Copiloto do atendimento');
    ok(daIa(S, 'GET', '/ia/uso').length === n + 1, 'uso com erro: avisa e "Tentar de novo" lê de novo');
    await ctx.close();
  }

  // ── cada largura, PESSOAS: a lista, o diálogo de desligar e o de ligar com o código, sem barra lateral ──
  for (const w of larguras) {
    const a = await abrir(w, w < 700 ? 820 : 900, { caminho: '/mister?parte=pessoas' });
    await a.page.locator('text=Marina Alves de Albuquerque Figueiredo >> visible=true').first().waitFor({ timeout: 20000 });
    let m = await medir(a.page);
    ok(m.length === 0, `${w}px: Pessoas — sem barra lateral e com toque grande (${m.join(' | ')})`);
    if (w === 375 || w === 1440) await a.page.screenshot({ path: foto(`${w}-pessoas.png`), fullPage: true });
    await a.page.locator('button:has-text("Desligar") >> visible=true').first().click();
    await a.page.waitForSelector('[role="alertdialog"]');
    m = await medir(a.page);
    ok(m.length === 0, `${w}px: o diálogo de desligar inteiro na tela (${m.join(' | ')})`);
    ok(a.erros.length === 0, `${w}px: Pessoas sem erro (${a.erros.join(' | ')})`);
    await a.ctx.close();
    const b = await abrir(w, w < 700 ? 820 : 900, { caminho: '/mister?parte=pessoas', pessoas: NINGUEM });
    await b.page.locator('button:has-text("Ligar o meu WhatsApp") >> visible=true').first().click();
    await b.page.locator('[role="dialog"] img').waitFor({ timeout: 15000 });
    m = await medir(b.page);
    ok(m.length === 0, `${w}px: o diálogo de ligar, com o código, inteiro na tela (${m.join(' | ')})`);
    if (w === 375) await b.page.screenshot({ path: foto('375-ligar.png') });
    await b.ctx.close();
  }

  // ── cada largura: a página, a gaveta do guia e o diálogo de apagar, sem barra lateral ──
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { estado: comChave('teto_atingido') });
    // Na tela estreita a tabela vira cartões: os dois existem na página e só um aparece — espera o que está à vista.
    await page.locator('text=Copiloto do atendimento >> visible=true').first().waitFor({ timeout: 20000 });
    let m = await medir(page);
    ok(m.length === 0, `${w}px: a página sem barra lateral e com toque grande (${m.join(' | ')})`);
    if (w === 375 || w === 1440) await page.screenshot({ path: foto(`${w}-pagina.png`), fullPage: true });
    await page.click('button:has-text("Como criar a chave, passo a passo")');
    await page.waitForSelector('[role="dialog"]');
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta do guia inteira na tela (${m.join(' | ')})`);
    if (w === 375) await page.screenshot({ path: foto('375-guia.png') });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.click('button:has-text("Apagar a chave")');
    await page.waitForSelector('[role="alertdialog"]');
    m = await medir(page);
    ok(m.length === 0, `${w}px: o diálogo de apagar inteiro na tela (${m.join(' | ')})`);
    ok(erros.length === 0, `${w}px: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── AVISOS E RELATÓRIOS: o padrão aprovado, o "Mudar" em gaveta, o salvar pela barra e as recusas ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { caminho: '/mister?parte=avisos' });
    await page.waitForSelector('#mister-avisos-titulo', { timeout: 20000 });
    const t0 = await page.locator('main').innerText();
    ok(/27 ajustes em 10 grupos/.test(t0), "avisos: os nove avisos em quatro grupos, o do boleto (M3a), os dois do ponto (M3e), os dois do gasto do WhatsApp (G2), os quatro relatórios e o 'Como mandar o resumo' (M5e) , a conversa (M3a, o 'Responder em áudio', M5c, e a 'Voz com emoção', V7d) e as análises (V7e e o 'Ligar as linhas pela IA' da versão 9, O1)");
    ok(/Fichas novas de candidatos[\s\S]*Vai para: o presidente e quem tem a permissão Candidatos, cada um só das lojas que vê\./.test(t0), 'relatórios: o das fichas novas diz para quem vai (F4c)');
    ok(t0.includes('O de fichas novas e o boletim do ramo não usam a IA.') && t0.includes('No boletim do ramo, esse convite é opcional.'), 'relatórios: a nota diz que o das fichas novas e o boletim não usam a IA, e que o convite do boletim é opcional');
    ok(['Na loja', 'Servidor da loja', 'Fiscal', 'O próprio Mister'].every((g) => t0.includes(g)), 'avisos: os quatro grupos do protótipo');
    ok(/Vai para:[\s\S]*Tela do Regem na loja[\s\S]*sem resolver em 5 min: WhatsApp do gerente da loja/.test(t0), 'avisos: a impressora vai à tela e, sem resolver em 5 min, ao gerente');
    ok((t0.match(/chega numa próxima entrega/g) ?? []).length === 4, 'avisos: os quatro tipos que ainda não saem dizem que chegam numa próxima entrega');
    ok(t0.includes('Relatórios') && t0.includes('Resumo do dia') && t0.includes('Resumo da semana'), 'relatórios: o resumo do dia e o da semana no grupo Relatórios');
    ok(/Último: não saiu em 13\/11 às 23:31 — a pessoa não falou com o Mister nas últimas 24 horas/.test(t0), 'relatórios: o último envio que não saiu, com o motivo em português');
    ok(t0.includes('falou com o Mister nas') && t0.includes('últimas 24 horas'), 'relatórios: a nota diz quem recebe pelo WhatsApp (a janela de 24 horas)');
    ok(/Último: em 09\/11 às 09:05 foi o convite pelo WhatsApp \(fora das 24 horas\)\. O resumo sai quando a pessoa tocar em "Ver resumo"\./.test(t0), 'relatórios: o convite pelo modelo, fora das 24 horas, esperando o toque');
    ok(t0.includes('convite pelo modelo de mensagem aprovado pela Meta'), 'relatórios: a nota diz que fora das 24 horas vai o convite pelo modelo');
    // Desligar o caixa e salvar: a barra conta e o servidor recebe só o tipo que mudou, inteiro.
    await page.click('button[role="switch"][aria-label*="Caixa aberto há mais de 24 horas"]');
    await page.waitForSelector('text=1 alteração ainda não salva');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/avisos') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentos[0]) === JSON.stringify({ regras: [{ tipo: 'caixa_24h', ligado: false, destinos: ['gerente'], escalaMin: null, escalaPara: [], parametro: null }] }), `avisos: salvar manda só o caixa, inteiro (${JSON.stringify(S.salvamentos[0])})`);
    // "Mudar" abre a gaveta com os destinos daquele aviso marcados.
    await page.click('button[aria-label="Mudar para onde vai: Impressora parada"]');
    await page.waitForSelector('[role="dialog"] >> text=Para onde vai: Impressora parada');
    const marcados = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] input[type="checkbox"]')].filter((c) => c.checked).map((c) => c.parentElement.textContent.trim()));
    ok(JSON.stringify(marcados) === JSON.stringify(['Tela do Regem na loja', 'WhatsApp do gerente da loja']), `gaveta: abre com a tela e o gerente da escala marcados (${marcados.join(', ')})`);
    ok((await page.locator('[role="dialog"] select').inputValue()) === '5', 'gaveta: o "se ninguém resolver" em 5 min');
    // Sem nenhum destino com o aviso ligado, "Aplicar" trava e diz por quê.
    await page.locator('[role="dialog"] label:has-text("Tela do Regem na loja") input').uncheck();
    ok(await page.locator('[role="dialog"] button:has-text("Aplicar")').isDisabled(), 'gaveta: sem destino, "Aplicar" trava');
    ok(await page.locator('[role="dialog"] [role="alert"]:has-text("Escolha pelo menos um destino")').isVisible(), 'gaveta: e diz por quê');
    await page.locator('[role="dialog"] label:has-text("Tela do Regem na loja") input').check();
    await page.locator('[role="dialog"] label:has-text("KDS da cozinha") input').check();
    await page.click('[role="dialog"] button:has-text("Aplicar")');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.waitForSelector('text=1 alteração ainda não salva');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/avisos') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentos[1]?.regras?.[0]) === JSON.stringify({ tipo: 'impressora', ligado: true, destinos: ['tela', 'kds'], escalaMin: 5, escalaPara: ['gerente'], parametro: null }), `gaveta: "Aplicar" leva para a barra e salvar manda os destinos novos (${JSON.stringify(S.salvamentos[1])})`);
    ok(/Vai para:[\s\S]*Tela do Regem na loja[\s\S]*KDS da cozinha/.test(await page.locator('main').innerText()), 'avisos: a linha mostra o KDS depois de salvar');
    // A recusa do servidor aparece com a frase dele.
    S.recusaDosAvisos = 'Escolha quem fica sabendo se ninguém resolver.';
    await page.click('button[role="switch"][aria-label*="A chave de IA parou"]');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/avisos') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    await page.waitForSelector('text=Escolha quem fica sabendo se ninguém resolver.');
    ok(true, 'avisos: a recusa do servidor aparece com a frase dele');
    // Relatórios: ligar o resumo do dia às 22:00 e salvar pela MESMA barra — só a rota dos relatórios, só o que mudou.
    // A recusa da cena anterior deixou uma alteração pendente: descarta antes (a barra é uma só para a tela inteira).
    S.recusaDosAvisos = null;
    await page.click("button:has-text(\"Descartar\")");
    await page.waitForSelector("text=ainda não salva", { state: "detached" });
    const avisosAntes = S.salvamentos.length;
    await page.fill('input[type="time"] >> nth=0', '22:00');
    await page.click('button[role="switch"][aria-label*="Resumo do dia"]');
    await page.waitForSelector('text=1 alteração ainda não salva');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/relatorios') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentosRel[0]) === JSON.stringify({ relatorios: [{ tipo: 'resumo_dia', ligado: true, hora: '22:00', diaSemana: null }] }), `relatórios: salvar manda só o resumo do dia, inteiro (${JSON.stringify(S.salvamentosRel[0])})`);
    ok(S.salvamentos.length === avisosAntes, 'relatórios: salvar só os relatórios não chama a rota dos avisos');
    await page.waitForSelector('text=Relatórios do Mister salvos.');
    // O resumo da semana: o dia e o horário.
    await page.getByLabel('Dia do resumo da semana').selectOption('7');
    await page.click('button[role="switch"][aria-label*="Resumo da semana"]');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/relatorios') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentosRel[1]) === JSON.stringify({ relatorios: [{ tipo: 'resumo_semana', ligado: true, hora: '09:00', diaSemana: 7 }] }), `relatórios: o resumo da semana no domingo (${JSON.stringify(S.salvamentosRel[1])})`);
    // F4c: ligar o das fichas novas manda só ele, com o horário e sem dia da semana.
    await page.click('button[role="switch"][aria-label*="Fichas novas de candidatos"]');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/relatorios') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentosRel[2]) === JSON.stringify({ relatorios: [{ tipo: 'fichas_novas', ligado: true, hora: '09:00', diaSemana: null }] }), `relatórios: ligar as fichas novas manda só ele (${JSON.stringify(S.salvamentosRel[2])})`);
    // Fase N2: o boletim do ramo nasce às 08:30, sem convite; o seletor só aparece ligado; antes das 08:15 não aceita.
    const foraDoBoletim = page.getByLabel('Quem não falou com o Mister nas últimas 24 horas');
    const horaDoBoletim = page.getByLabel('Horário do boletim do ramo');
    ok((await horaDoBoletim.inputValue()) === '08:30' && (await foraDoBoletim.count()) === 0, 'boletim: nasce às 08:30 e, desligado, não mostra o convite');
    await page.click('button[role="switch"][aria-label*="Boletim do ramo"]');
    await foraDoBoletim.waitFor();
    ok((await foraDoBoletim.inputValue()) === 'nao' && (await page.locator('[data-boletim-custo]').innerText()).includes('lê na tela, sem custo'), 'boletim: ligado, o padrão é não gastar');
    await foraDoBoletim.selectOption('convite');
    await page.waitForSelector('[data-boletim-custo]:has-text("cerca de R$ 0,035 por pessoa")');
    await horaDoBoletim.fill('08:00');
    await page.waitForSelector('text=Escolha um horário a partir de 08:15');
    ok((await horaDoBoletim.inputValue()) === '08:30', 'boletim: horário antes das 08:15 não entra');
    for (const w of [320, 375]) {
      await page.setViewportSize({ width: w, height: 800 });
      await foraDoBoletim.scrollIntoViewIfNeeded();
      const larga = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      const caixa = await foraDoBoletim.boundingBox();
      ok(!larga && !!caixa && caixa.x >= 0 && caixa.x + caixa.width <= w, `boletim: ${w}px, o convite cabe sem barra para o lado`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/relatorios') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentosRel[3]) === JSON.stringify({ relatorios: [{ tipo: 'boletim_ramo', ligado: true, hora: '08:30', diaSemana: null, convidarFora: true }] }), `boletim: salvar manda só ele, com o convite (${JSON.stringify(S.salvamentosRel[3])})`);
    // Versão 8, E3: "Clima e eventos" — a véspera e a linha "Amanhã", desligadas, com o preço; salvar manda só o que mudou.
    const tClima = await page.locator('main').innerText();
    ok(/Clima e eventos[\s\S]*Avisar na véspera[\s\S]*Linha "Amanhã" no resumo/.test(tClima), 'clima: o grupo novo, com a véspera e a linha "Amanhã"');
    ok((await page.locator('[data-vespera-custo]').innerText()).includes('R$ 0: texto fixo, sem IA') && (await page.locator('[data-amanha-custo]').innerText()).includes('R$ 0'), 'clima: o preço ao lado dos dois');
    ok((await page.locator('[data-vespera-chuva]').innerText()).includes('INMET e o CPTEC concordam'), 'clima: a regra da chuva está escrita');
    const conviteDaVespera = page.getByLabel('Convite da véspera fora das 24 horas');
    ok((await conviteDaVespera.count()) === 0, 'clima: desligada, a véspera não mostra o convite');
    await page.click('button[role="switch"][aria-label="Avisar na véspera"]');
    await conviteDaVespera.waitFor();
    ok((await conviteDaVespera.inputValue()) === 'nao', 'clima: ligada, o padrão é não gastar com o convite');
    await page.click('button[role="switch"][aria-label^="Linha"]');
    for (const w of [320, 375]) {
      await page.setViewportSize({ width: w, height: 800 });
      await conviteDaVespera.scrollIntoViewIfNeeded();
      const larga = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
      const caixa = await conviteDaVespera.boundingBox();
      ok(!larga && !!caixa && caixa.x >= 0 && caixa.x + caixa.width <= w, `clima: ${w}px, o convite da véspera cabe sem barra para o lado`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/relatorios') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(
      JSON.stringify(S.salvamentosRel[4]) ===
        JSON.stringify({ relatorios: [{ tipo: 'resumo_dia', ligado: true, hora: '22:00', diaSemana: null, linhaAmanha: true }, { tipo: 'vespera', ligado: true, hora: '18:00', diaSemana: null, convidarFora: false }] }),
      `clima: salvar manda a véspera e a linha "Amanhã" no resumo do dia (${JSON.stringify(S.salvamentosRel[4])})`,
    );
    ok(erros.length === 0, `avisos: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    // G2 (18/11/2026): o alerta de gasto do WhatsApp oficial — ligar sem valor abre a gaveta com a sugestão; o valor repetido
    // não passa; "Aplicar" e "Salvar" mandam os valores em ordem; o "Para onde vai" do gasto só tem os destinos de dinheiro.
    const { ctx, page, erros, S } = await abrir(1280, 900, { caminho: '/mister?parte=avisos' });
    await page.waitForSelector('#mister-avisos-titulo', { timeout: 20000 });
    const tg = await page.locator('main').innerText();
    ok(/Gasto do WhatsApp oficial[\s\S]*Valores:[\s\S]*nenhum valor/.test(tg) && tg.includes('Atendimento grátis perto do fim'), 'gasto: os dois avisos no grupo, o gasto sem valores');
    await page.click('button[role="switch"][aria-label*="Gasto do WhatsApp oficial"]');
    await page.waitForSelector('[role="dialog"] >> text=Valores do alerta de gasto');
    const campos = page.locator('[role="dialog"] input[inputmode="decimal"]');
    const sugestao = await campos.evaluateAll((l) => l.map((i) => i.value));
    ok(JSON.stringify(sugestao) === JSON.stringify(['100,00', '200,00', '400,00']), `gasto: ligar sem valor abre a gaveta com a sugestão (${sugestao.join(' · ')})`);
    await campos.nth(2).fill('200');
    await page.click('[role="dialog"] button:has-text("Aplicar")');
    ok(await page.locator('[role="dialog"] [role="alert"]:has-text("está repetido")').isVisible(), 'gasto: o valor repetido não passa');
    await campos.nth(2).fill('1.500,50');
    await page.click('[role="dialog"] button:has-text("Novo valor")');
    await page.click('[role="dialog"] button:has-text("Aplicar")');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/avisos') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    const salvo = S.salvamentos.at(-1)?.regras?.[0];
    ok(
      JSON.stringify(salvo) === JSON.stringify({ tipo: 'gasto_whatsapp', ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: null, valores: [100, 200, 1500.5, 3001] }),
      `gasto: salvar manda o aviso ligado com os valores em ordem (${JSON.stringify(salvo)})`,
    );
    ok((await page.locator('[data-valores-do-gasto]').innerText()).includes('R$ 1.500,50'), 'gasto: a linha mostra os valores salvos');
    await page.click('button[aria-label="Mudar para onde vai: Gasto do WhatsApp oficial"]');
    await page.waitForSelector('[role="dialog"] >> text=Para onde vai: Gasto do WhatsApp oficial');
    const opcoes = (await page.locator('[role="dialog"] label:has(input[type="checkbox"])').allInnerTexts()).map((s) => s.trim());
    ok(
      JSON.stringify(opcoes) === JSON.stringify(['WhatsApp do presidente', 'WhatsApp do gerente da loja', 'Tela do Regem na loja', 'Suporte da DMS']),
      `gasto: o "Para onde vai" só tem os destinos de dinheiro (${opcoes.join(', ')})`,
    );
    ok(!(await page.locator('[role="dialog"] legend:has-text("Se ninguém resolver")').isVisible()), 'gasto: sem "se ninguém resolver"');
    await page.keyboard.press('Escape');
    ok(erros.length === 0, `gasto: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const { ctx, page, S } = await abrir(1280, 900, { caminho: '/mister?parte=avisos', avisosFalha: true });
    await page.waitForSelector('text=Não consegui ler os avisos agora', { timeout: 20000 });
    S.avisosFalha = false;
    await page.click('button:has-text("Tentar de novo")');
    await page.waitForSelector('#mister-avisos-titulo');
    ok(true, 'avisos: erro de leitura avisa e "Tentar de novo" lê de novo');
    await ctx.close();
  }
  {
    // O gerente não entra nos avisos: vê Pessoas e nem chama a rota.
    const { ctx, page, S } = await abrir(1280, 900, { token: GERENTE, caminho: '/mister?parte=avisos', souPresidente: false, pessoas: PESSOAS.slice(0, 1) });
    await page.waitForTimeout(1500);
    ok(!S.doMister.some((x) => x.p === '/mister/avisos'), 'avisos: o gerente não chama a rota dos avisos');
    ok(!(await page.locator('#mister-avisos-titulo').count()), 'avisos: o gerente não vê a parte dos avisos');
    await ctx.close();
  }

  // ── cada largura, AVISOS: a página e a gaveta inteiras, sem barra lateral, e o texto das linhas sem espremer ──
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { caminho: '/mister?parte=avisos' });
    await page.waitForSelector('#mister-avisos-titulo', { timeout: 20000 });
    let m = await medir(page);
    ok(m.length === 0, `${w}px: Avisos — sem barra lateral e com toque grande (${m.join(' | ')})`);
    const espremido = await page.evaluate(() =>
      [...document.querySelectorAll('main span')].filter((s) => /^Uma impressora deixou|^Problemas técnicos do servidor/.test(s.textContent ?? '') && s.getBoundingClientRect().width < 180).map((s) => Math.round(s.getBoundingClientRect().width)),
    );
    ok(espremido.length === 0, `${w}px: Avisos — a descrição não fica espremida (${espremido.join(', ')} px)`);
    // O selo de frase longa quebra a linha: inteiro dentro do bloco dele, em toda largura.
    const seloDaNota = await page.evaluate(() => {
      const el = [...document.querySelectorAll('main span')].find((s) => s.className.includes('font-bold') && (s.textContent ?? '').trim() === 'a leitura da nota do fornecedor vem numa próxima entrega');
      if (!el) return 'não achei o selo';
      const r = el.getBoundingClientRect();
      const pai = el.parentElement.getBoundingClientRect();
      return r.left >= pai.left - 1 && r.right <= pai.right + 1 && el.scrollWidth <= el.clientWidth + 1 ? '' : `selo de ${Math.round(r.width)} px num bloco de ${Math.round(pai.width)} px`;
    });
    ok(seloDaNota === '', `${w}px: o selo "a leitura da nota" inteiro, com a linha quebrada (${seloDaNota})`);
    if (w === 375) {
      const blocoDoSelo = page.locator('main span.block:has(> span:text-is("a leitura da nota do fornecedor vem numa próxima entrega"))').first();
      await blocoDoSelo.scrollIntoViewIfNeeded();
      await blocoDoSelo.screenshot({ path: foto('375-selo-da-nota.png') });
    }
    if (w === 375 || w === 1440) await page.screenshot({ path: foto(`${w}-avisos.png`), fullPage: true });
    if (w === 320 || w === 375 || w === 1440) {
      // O cartão dos relatórios (V45: a página inteira não rola o Shell — a foto é do cartão, depois de rolar até ele).
      const cartao = page.locator("div:has(> div > h3:text-is(\"Relatórios\"))").first();
      await cartao.scrollIntoViewIfNeeded();
      await cartao.screenshot({ path: foto(`${w}-relatorios.png`) });
    }
    await page.locator('button:has-text("Mudar") >> visible=true').nth(5).click();
    await page.waitForSelector('[role="dialog"]');
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta "Para onde vai" inteira na tela (${m.join(' | ')})`);
    if (w === 375) await page.screenshot({ path: foto('375-avisos-gaveta.png') });
    // G2: a gaveta dos valores do alerta de gasto, inteira na tela.
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.click('button[aria-label="Mudar os valores do alerta de gasto"]');
    await page.waitForSelector('[role="dialog"] >> text=Valores do alerta de gasto');
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta dos valores do alerta de gasto inteira na tela (${m.join(' | ')})`);
    if (w === 375) await page.screenshot({ path: foto('375-avisos-gaveta-valores.png') });
    // Versão 7, V7e: o ajuste das análises e a gaveta "Ver como funciona", inteiros na tela.
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    const ajusteDasAnalises = page.locator('div:has(> div > h3:text-is("Análises"))').first();
    await ajusteDasAnalises.scrollIntoViewIfNeeded();
    m = await medir(page);
    ok(m.length === 0, `${w}px: o ajuste "Análises mais profundas" sem barra lateral (${m.join(' | ')})`);
    const larguraDoPreco = await page.locator('[data-preco-das-analises]').evaluate((el) => Math.round(el.getBoundingClientRect().width));
    ok(larguraDoPreco >= 180, `${w}px: o preço das análises não fica espremido (${larguraDoPreco} px)`);
    if (w === 375) await ajusteDasAnalises.screenshot({ path: foto('375-analises.png') });
    await ajusteDasAnalises.locator('button:text-is("Ver como funciona")').click();
    await page.waitForSelector('[role="dialog"] >> text=O que não muda');
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta "Análises mais profundas" inteira na tela (${m.join(' | ')})`);
    if (w === 375) await page.screenshot({ path: foto('375-analises-gaveta.png') });
    // Versão 7, V7d: o ajuste "Voz com emoção" e a gaveta dele, inteiros na tela.
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    const precoDaVoz = page.locator('[data-preco-da-voz]');
    await precoDaVoz.scrollIntoViewIfNeeded();
    m = await medir(page);
    ok(m.length === 0, `${w}px: o ajuste "Voz com emoção" sem barra lateral (${m.join(' | ')})`);
    const larguraDoPrecoDaVoz = await precoDaVoz.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    ok(larguraDoPrecoDaVoz >= 180, `${w}px: o preço da voz não fica espremido (${larguraDoPrecoDaVoz} px)`);
    if (w === 375) await page.locator('div:has(> div > h3:text-is("Conversa"))').first().screenshot({ path: foto('375-voz-ajuste.png') });
    await page.click('[data-ver-voz]');
    await page.waitForSelector('[role="dialog"] >> text=O que ele nunca faz');
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta "Voz com emoção" inteira na tela (${m.join(' | ')})`);
    if (w === 375) await page.screenshot({ path: foto('375-voz-gaveta.png') });
    ok(erros.length === 0, `${w}px: Avisos sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── M3a parte 3: o grupo "Conversa" (o ajuste dos documentos) salva pela mesma barra ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { caminho: '/mister?parte=avisos' });
    await page.waitForSelector('#mister-avisos-titulo', { timeout: 20000 });
    const t = await page.locator('main').innerText();
    ok(/27 ajustes em 10 grupos/.test(t), "conversa: o grupo Conversa entra com três ajustes (o do boleto, o 'Responder em áudio', M5c, e a 'Voz com emoção', V7d), Documentos e dinheiro com o do boleto e os dois do gasto (G2), Pessoas e ponto com os dois do ponto, Relatórios com o 'Como mandar o resumo' (M5e) e Análises com o ajuste da V7e e o da O1");
    ok(/Documentos e dinheiro[\s\S]*Boleto perto de vencer[\s\S]*Já paguei/.test(t), 'boleto: o aviso novo no grupo "Documentos e dinheiro", com o "Já paguei"');
    ok(/Lançar boletos por foto/.test(t) && /só o presidente manda/.test(t) && /a leitura da nota do fornecedor vem numa próxima entrega/.test(t), 'conversa: o ajuste diz o que faz, quem manda e que a nota vem depois');
    const sel = page.locator('select:has(option:text-is("boleto: pergunta antes"))');
    ok((await sel.inputValue()) === 'sozinho', 'conversa: o modo salvo (sozinho) vem marcado');
    await sel.selectOption('perguntar');
    await page.waitForSelector('text=1 alteração ainda não salva');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/conversa') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentosConv[0]) === JSON.stringify({ documentosLigado: true, documentosModo: 'perguntar' }), `conversa: salvar manda o ajuste inteiro (${JSON.stringify(S.salvamentosConv[0])})`);
    ok(S.salvamentos.length === 0 && S.salvamentosRel.length === 0, 'conversa: salvar a conversa não manda os avisos nem os relatórios');
    await page.waitForSelector('text=Ajustes da conversa salvos.');
    await page.click('button[role="switch"][aria-label*="Lançar boletos por foto"]');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/conversa') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentosConv[1]) === JSON.stringify({ documentosLigado: false, documentosModo: 'perguntar' }), `conversa: desligar manda desligado e mantém o modo (${JSON.stringify(S.salvamentosConv[1])})`);
    // Versão 5, M5e: "Como mandar o resumo" no grupo Relatórios — o padrão (os botões), e o salvar manda SÓ a forma.
    ok(/Como mandar o resumo[\s\S]*O texto vai sempre/.test(t) && !/ainda não ligado no Regem/.test(t), 'resumo: o ajuste "Como mandar o resumo" diz que o texto vai sempre (ligado nesta instalação, sem o aviso)');
    const comoMandar = page.locator('select:has(option:text-is("texto e o PDF junto"))');
    ok((await comoMandar.inputValue()) === 'botoes', 'resumo: o padrão é "texto com os botões PDF e link"');
    ok((await comoMandar.locator('option').allInnerTexts()).join('|') === 'texto com os botões PDF e link|texto e o PDF junto|texto e o link junto|só o texto', 'resumo: as quatro formas do protótipo');
    await comoMandar.selectOption('pdf');
    await page.waitForSelector('text=1 alteração ainda não salva');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/conversa') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentosConv.at(-1)) === JSON.stringify({ resumoEntrega: 'pdf' }), `resumo: salvar manda só a forma (${JSON.stringify(S.salvamentosConv.at(-1))})`);
    ok((await comoMandar.inputValue()) === 'pdf', 'resumo: a forma salva fica marcada');
    // Versão 5, M5c: "Responder em áudio" no grupo Conversa — nasce desligado; ligar manda SÓ ele.
    ok(/Responder em áudio[\s\S]*responde em texto e também numa nota de voz/.test(t), 'voz: o ajuste "Responder em áudio" diz que o texto vai junto');
    const voz = page.locator('button[role="switch"][aria-label*="Responder em áudio"]');
    ok((await voz.getAttribute('aria-checked')) === 'false', 'voz: nasce desligado');
    // Versão 7, V7d: "Voz com emoção" nasce desligada e, sem "Responder em áudio", não dá para ligar.
    const emocao = page.locator('button[role="switch"][aria-label="Voz com emoção"]');
    ok((await emocao.getAttribute('aria-checked')) === 'false', 'voz com emoção: nasce desligada');
    ok(await emocao.isDisabled(), 'voz com emoção: sem "Responder em áudio", a chave fica travada');
    ok((await page.locator('[data-voz-precisa-do-audio]').count()) === 1, 'voz com emoção: diz que precisa de "Responder em áudio"');
    ok(/Voz com emoção[\s\S]*US\$ 0,006 a cada 40 s de áudio \(US\$ 0,012 a partir de 01\/01\/2027\)/.test(t), 'voz com emoção: o preço conferido na documentação, ao lado');
    await voz.click();
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/conversa') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(JSON.stringify(S.salvamentosConv.at(-1)) === JSON.stringify({ responderAudio: true }), `voz: ligar manda só ele (${JSON.stringify(S.salvamentosConv.at(-1))})`);
    ok((await voz.getAttribute('aria-checked')) === 'true', 'voz: fica ligado depois de salvar');
    ok(!(await emocao.isDisabled()), 'voz com emoção: com "Responder em áudio", a chave destrava');
    ok((await page.locator('[data-voz-precisa-do-audio]').count()) === 0, 'voz com emoção: o aviso de "precisa" some');
    // Ligar pede a confirmação com o preço, sem dizer que gasta a chave da empresa; "Cancelar" não manda nada.
    await emocao.click();
    const antesDaVoz = S.salvamentosConv.length;
    await page.click('button:has-text("Salvar alterações")');
    await page.waitForSelector('[role="dialog"] >> text=Ligar e salvar?');
    const dialogoDaVoz = await page.locator('[role="dialog"]').innerText();
    ok(/Voz com emoção:[\s\S]*US\$ 0,006[\s\S]*franquia de fotos e áudios/.test(dialogoDaVoz), 'voz com emoção: a confirmação diz o preço e a franquia');
    ok(!/passa a gastar a chave de IA/.test(dialogoDaVoz), 'voz com emoção: a confirmação não diz que gasta a chave de IA da empresa');
    {
      const m = await medir(page);
      ok(m.length === 0, `voz com emoção: a confirmação inteira na tela (${m.join(' | ')})`);
    }
    await page.click('[role="dialog"] button:text-is("Cancelar")');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    ok(S.salvamentosConv.length === antesDaVoz, 'voz com emoção: "Cancelar" não salva');
    await page.click('button:has-text("Salvar alterações")');
    await page.waitForSelector('[role="dialog"] >> text=Ligar e salvar?');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/conversa') && r.request().method() === 'PATCH'), page.click('[role="dialog"] button:text-is("Ligar e salvar")')]);
    ok(JSON.stringify(S.salvamentosConv.at(-1)) === JSON.stringify({ vozComEmocao: true }), `voz com emoção: ligar manda só ela (${JSON.stringify(S.salvamentosConv.at(-1))})`);
    ok((await emocao.getAttribute('aria-checked')) === 'true', 'voz com emoção: fica ligada depois de salvar');
    // Desligar "Responder em áudio" não prende a emoção: ela continua podendo ser desligada.
    await voz.click();
    ok(!(await emocao.isDisabled()), 'voz com emoção: ligada, sempre dá para desligar');
    ok((await page.locator('[data-voz-precisa-do-audio]').count()) === 1, 'voz com emoção: avisa que precisa de "Responder em áudio"');
    await voz.click();
    // A gaveta: o que nunca faz, a conta e o aviso de que ainda não foi testada.
    await page.click('[data-ver-voz]');
    await page.waitForSelector('[role="dialog"] >> text=O que ele nunca faz');
    const gavetaDaVoz = page.locator('[role="dialog"]');
    const textoDaGaveta = await gavetaDaVoz.innerText();
    ok(/Rir de prejuízo, reclamação, cliente ou funcionário/.test(textoDaGaveta) && /Guardar o tom de quem falou/.test(textoDaGaveta) && /Falar um valor diferente do texto/.test(textoDaGaveta), 'voz com emoção: a gaveta diz o que ele nunca faz');
    ok(/US\$ 2,03[\s\S]*US\$ 4,05/.test(textoDaGaveta), `voz com emoção: a conta de 15 áudios por dia (${textoDaGaveta.match(/Estimativa[^\n]*/)?.[0]})`);
    ok(/ainda não foram testadas em português/.test(textoDaGaveta), 'voz com emoção: a gaveta avisa que a voz ainda não foi testada');
    ok(/Não gasta a chave de IA da empresa/.test(textoDaGaveta), 'voz com emoção: a gaveta diz de onde sai o custo');
    await gavetaDaVoz.locator('select').selectOption('30');
    ok(/US\$ 4,05[\s\S]*US\$ 8,10/.test(await gavetaDaVoz.innerText()), 'voz com emoção: a conta acompanha os áudios por dia');
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    // Versão 7, V7e: "Análises mais profundas" nasce desligada, com o preço ao lado; ligar manda SÓ ela.
    ok(/Análises mais profundas[\s\S]*De cerca de US\$ 0,001 para cerca de US\$ 0,01 a US\$ 0,08 por análise/.test(t), 'análises: o ajuste traz o preço ao lado');
    const analises = page.locator('button[role="switch"][aria-label*="Análises mais profundas"]');
    ok((await analises.getAttribute('aria-checked')) === 'false', 'análises: nasce desligada');
    // Versão 9, O1 (mig 501): "Ligar as linhas pela IA" nasce desligado, com o preço ao lado.
    ok(/Ligar as linhas pela IA[\s\S]*Cerca de R\$ 0,20 por cupom, nota ou lista/.test(t), 'O1: o ajuste traz o preço ao lado');
    ok((await page.locator('button[role="switch"][aria-label*="Ligar as linhas pela IA"]').getAttribute('aria-checked')) === 'false', 'O1: nasce desligado');
    // Versão 9, O6 (mig 502): "IA mais forte nas tarefas" nasce desligada, com o preço ao lado.
    ok(/IA mais forte nas tarefas[\s\S]*De cerca de R\$ 0,01 para cerca de R\$ 0,20 por resposta/.test(t), 'O6: o ajuste traz o preço ao lado');
    ok((await page.locator('button[role="switch"][aria-label*="IA mais forte nas tarefas"]').getAttribute('aria-checked')) === 'false', 'O6: nasce desligada');
    await analises.click();
    // Ligar pede a confirmação com o preço; "Cancelar" não manda nada.
    const antesDaConfirmacao = S.salvamentosConv.length;
    await page.click('button:has-text("Salvar alterações")');
    await page.waitForSelector('[role="dialog"] >> text=Ligar e salvar?');
    ok(/passa a gastar a chave de IA[\s\S]*US\$ 0,08/.test(await page.locator('[role="dialog"]').innerText()), 'análises: a confirmação diz o preço');
    await page.click('[role="dialog"] button:text-is("Cancelar")');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    ok(S.salvamentosConv.length === antesDaConfirmacao, 'análises: "Cancelar" não salva');
    await page.click('button:has-text("Salvar alterações")');
    await page.waitForSelector('[role="dialog"] >> text=Ligar e salvar?');
    {
      const m = await medir(page);
      ok(m.length === 0, `análises: a confirmação inteira na tela (${m.join(' | ')})`);
    }
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/conversa') && r.request().method() === 'PATCH'), page.click('[role="dialog"] button:text-is("Ligar e salvar")')]);
    ok(JSON.stringify(S.salvamentosConv.at(-1)) === JSON.stringify({ analisesProfundas: true }), `análises: ligar manda só ela (${JSON.stringify(S.salvamentosConv.at(-1))})`);
    ok((await analises.getAttribute('aria-checked')) === 'true', 'análises: fica ligada depois de salvar');
    // M3a parte 4: "Quando avisar do boleto" — o padrão (3 dias antes e no dia) e "só no dia", salvo pela mesma barra.
    const quando = page.locator('select:has(option:text-is("só no dia"))');
    ok((await quando.inputValue()) === '3', 'boleto: o padrão é "3 dias antes e no dia"');
    await quando.selectOption('0');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/avisos') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(
      JSON.stringify(S.salvamentos.at(-1)) === JSON.stringify({ regras: [{ tipo: 'boleto_vencendo', ligado: true, destinos: ['presidente'], escalaMin: null, escalaPara: [], parametro: 0 }] }),
      `boleto: salvar manda o aviso inteiro com a antecedência (${JSON.stringify(S.salvamentos.at(-1))})`,
    );
    // M3e: "Quando avisar do ponto esquecido" — o padrão (no dia seguinte, às 10h) e "30 min depois", pela mesma barra.
    ok(/Pessoas e ponto[\s\S]*Ponto esquecido[\s\S]*Só nas lojas que usam o terminal de ponto/.test(t), 'ponto: o aviso novo no grupo "Pessoas e ponto", dizendo que é só onde há terminal de ponto');
    ok(/Pessoas e ponto[\s\S]*Arquivo do ponto do mês[\s\S]*Com um toque, vai à contabilidade\./.test(t), 'ponto do mês: o 12º aviso no grupo "Pessoas e ponto", com a descrição do protótipo');
    const doPonto = page.locator('select:has(option:text-is("30 min depois"))');
    ok((await doPonto.inputValue()) === '0', 'ponto: o padrão é "no dia seguinte, às 10h"');
    await doPonto.selectOption('30');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/avisos') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    ok(
      JSON.stringify(S.salvamentos.at(-1)) === JSON.stringify({ regras: [{ tipo: 'ponto_esquecido', ligado: true, destinos: ['gerente'], escalaMin: null, escalaPara: [], parametro: 30 }] }),
      `ponto: salvar manda o aviso inteiro com o tempo (${JSON.stringify(S.salvamentos.at(-1))})`,
    );
    ok(erros.length === 0, `conversa: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── M3a parte 3: a parte "Documentos" — a lista, as situações, a gaveta e o "Desfazer o lançamento" ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { caminho: '/mister?parte=documentos' });
    await page.waitForSelector('#documentos-mister', { timeout: 20000 });
    await page.locator('text=Gás Rio >> visible=true').first().waitFor();
    const t = await page.locator('main').innerText();
    ok(/Documentos lidos/.test(t) && /8 documentos/.test(t), 'documentos: o título com a contagem');
    ok(/Nota 48\.213 · Frigorífico Boa Carne/.test(t) && /2 itens no estoque e 2 contas a pagar/.test(t), 'documentos: a nota do fornecedor (M3b) com o número e o que entrou, como no protótipo');
    ok(/Nota 1\.907 · Hortifruti Verde/.test(t) && /1 item sem ligação com o estoque/.test(t), 'documentos: a nota que espera um item diz quantos faltam ligar');
    ok(S.diasDosDocumentos[0] === '30', `documentos: lê os últimos 30 dias (${S.diasDosDocumentos.join(',')})`);
    ok(['Lançados', 'Falta informação', 'A conferir', 'Pagos', 'Não lançados'].every((s) => t.includes(s)), 'documentos: as cinco situações');
    ok(/lido pelo código de barras/.test(t) && /valor ou vencimento ditos na conversa/.test(t) && /os números da linha não conferiram/.test(t), 'documentos: como cada um foi lido (código, conversa, a recusa com o motivo)');
    ok(/R\$\s?1\.284,90/.test(t) && /vence 25\/11, quarta/.test(t) && /não lido/.test(t), 'documentos: o valor, o vencimento com o dia da semana e o "não lido"');
    ok(/Ana · 16\/11 19:41/.test(t), 'documentos: quem mandou e quando (no relógio da loja)');
    // A situação filtra.
    await page.locator('button:has-text("Pagos")').first().click();
    await page.locator('text=Embalagens Rio >> visible=true').first().waitFor();
    ok((await page.locator('text=Gás Rio >> visible=true').count()) === 0, 'documentos: "Pagos" mostra só o pago');
    await page.locator('button:has-text("Pagos")').first().click();
    // A busca.
    await page.fill('#docs-busca', 'light');
    await page.locator('text=Unidade Consumidora >> visible=true').first().waitFor();
    ok((await page.locator('text=Embalagens Rio >> visible=true').count()) === 0, 'documentos: a busca pelo fornecedor');
    await page.fill('#docs-busca', '48213');
    await page.locator('text=Frigorífico Boa Carne >> visible=true').first().waitFor();
    ok((await page.locator('text=Gás Rio >> visible=true').count()) === 0, 'documentos: a busca pelo número da nota');
    await page.fill('#docs-busca', '');
    // O período vai ao servidor.
    await Promise.all([page.waitForResponse((r) => r.url().includes('/mister/documentos?dias=7')), page.selectOption('#docs-periodo', '7')]);
    ok(S.diasDosDocumentos.includes('7'), 'documentos: trocar o período lê de novo com os dias');
    // A gaveta do lançado: os campos com a origem e o "Desfazer".
    await page.locator('text=Distribuidora Sabor Ltda. >> visible=true').first().waitFor();
    await page.locator('button[aria-label^="Ver"] >> visible=true').first().click();
    const g = page.locator('[role="dialog"]');
    await g.waitFor();
    const tg = await g.innerText();
    ok(/Valor[\s\S]*R\$\s?1\.284,90[\s\S]*código/.test(tg) && /Fornecedor[\s\S]*Distribuidora Sabor[\s\S]*cadastro/.test(tg) && /Linha digitável/.test(tg), 'gaveta: os campos com a origem de cada um (código, cadastro) e a linha');
    ok(/A foto não fica guardada/.test(tg), 'gaveta: diz que a foto não fica guardada');
    ok((await g.locator('a:has-text("Ver nas contas a pagar")').getAttribute('href')) === '/financeiro', 'gaveta: "Ver nas contas a pagar" abre o Financeiro');
    // M3a parte 4b: "Ver o PDF" pede o PDF do documento (com o login) e abre.
    const [popup] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null),
      page.waitForResponse((r) => r.url().endsWith('/mister/documentos/d1/pdf')),
      g.locator('button:has-text("Ver o PDF")').click(),
    ]);
    ok(S.pdfs.join(',') === 'd1', `gaveta: "Ver o PDF" pede o PDF do documento certo (${S.pdfs.join(',')})`);
    ok(!!popup, 'gaveta: o PDF abre em outra aba');
    if (popup) await popup.close();
    await g.locator('button:has-text("Desfazer o lançamento")').click();
    const d = page.locator('[role="alertdialog"]');
    await d.waitFor();
    ok(/A conta a pagar de R\$\s?1\.284,90 \(Distribuidora Sabor Ltda\.\) é cancelada/.test(await d.innerText()), 'desfazer: o diálogo diz o que acontece, com o valor e o nome');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/documentos/d1/desfazer')), d.locator('button:has-text("Desfazer")').click()]);
    ok(S.desfeitos.join(',') === 'd1', 'desfazer: manda o documento certo');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.locator('text=desfeito >> visible=true').first().waitFor();
    ok(true, 'desfazer: a lista é lida de novo e mostra "desfeito"');
    // A nota do fornecedor (M3b): a gaveta sem "Desfazer" e sem o PDF do boleto (o que mudar é no Recebimento).
    await page.locator('button[aria-label="Ver: Nota 48.213 · Frigorífico Boa Carne"] >> visible=true').first().click();
    const gn = page.locator('[role="dialog"]');
    await gn.waitFor();
    ok(
      (await gn.locator('button:has-text("Ver o PDF")').count()) === 0 && (await gn.locator('button:has-text("Desfazer o lançamento")').count()) === 0,
      'nota: a gaveta sem "Ver o PDF" e sem "Desfazer"',
    );
    const tgn = await gn.innerText();
    ok(/cada item ligado a um insumo do estoque/.test(tgn), `nota: a gaveta diz o que aconteceu antes de lançar (${tgn.replace(/\s+/g, ' ').slice(0, 300)})`);
    ok(/Total da nota[\s\S]*R\$\s?2\.640,00/.test(tgn) && /1ª parcela[\s\S]*16\/12, quarta/.test(tgn) && /Parcelas[\s\S]*2/.test(tgn) && /Emitente[\s\S]*Frigorífico Boa Carne/.test(tgn), 'nota: o total, a 1ª parcela, as parcelas e o emitente');
    ok(
      /Itens da nota/.test(tgn) && /BLEND BOVINO 56G[\s\S]*40 KG[\s\S]*Carne 56 g/.test(tgn) && /Bacon em tiras \(10 pacote\)/.test(tgn) && /DETERGENTE NEUTRO[\s\S]*fora do estoque/.test(tgn),
      'nota: cada item com o destino (a mesma linha do resumo da conversa)',
    );
    ok(/lançada em Estoque › Recebimento e nas contas a pagar/.test(tgn), 'nota: o que aconteceu diz onde entrou');
    ok((await gn.locator('a:has-text("Ver no Recebimento")').getAttribute('href')) === '/operacao?aba=recebimento', 'nota: "Ver no Recebimento" abre Estoque › Recebimento');
    await page.keyboard.press('Escape');
    await gn.waitFor({ state: 'detached' });
    // A nota que espera um item: o item pendente diz o que falta, com o selo; sem recebimento ainda.
    await page.locator('button[aria-label="Ver: Nota 1.907 · Hortifruti Verde"] >> visible=true').first().click();
    await gn.waitFor();
    const tgf = await gn.innerText();
    ok(/RÚCULA MAÇO[\s\S]*falta dizer o insumo[\s\S]*falta/.test(tgf) && /sem vencimento na nota/.test(tgf), `nota pendente: o item que falta e "sem vencimento" (${tgf.replace(/\s+/g, ' ').slice(0, 300)})`);
    ok((await gn.locator('a:has-text("Ver no Recebimento")').count()) === 0, 'nota pendente: sem "Ver no Recebimento" (ainda não entrou)');
    await page.keyboard.press('Escape');
    ok(erros.length === 0, `documentos: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    const vazio = await abrir(1280, 900, { caminho: '/mister?parte=documentos', documentos: [] });
    await vazio.page.waitForSelector('text=Nenhum documento ainda', { timeout: 20000 });
    ok(true, 'documentos: o vazio explica como mandar a foto');
    await vazio.ctx.close();
    const falha = await abrir(1280, 900, { caminho: '/mister?parte=documentos', documentosFalha: true });
    await falha.page.waitForSelector('text=Não consegui carregar os documentos agora', { timeout: 20000 });
    falha.S.documentosFalha = false;
    await falha.page.click('button:has-text("Tentar de novo")');
    await falha.page.locator('text=Gás Rio >> visible=true').first().waitFor();
    ok(true, 'documentos: o erro tem "Tentar de novo", que lê de novo');
    await falha.ctx.close();
    const gerente = await abrir(1280, 900, { caminho: '/mister?parte=documentos', token: GERENTE });
    await gerente.page.waitForSelector('h1', { timeout: 20000 });
    await gerente.page.waitForTimeout(800);
    ok(!gerente.S.doMister.some((x) => x.p === '/mister/documentos'), 'documentos: o gerente não chama a rota dos documentos');
    await gerente.ctx.close();
  }

  // ── cada largura, DOCUMENTOS: a lista, a gaveta e o diálogo inteiros, sem barra lateral; a foto de cada cartão ──
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { caminho: '/mister?parte=documentos' });
    await page.locator('text=Gás Rio >> visible=true').first().waitFor({ timeout: 20000 });
    let m = await medir(page);
    ok(m.length === 0, `${w}px: Documentos — sem barra lateral e com toque grande (${m.join(' | ')})`);
    const esmagado = await page.evaluate(() =>
      [...document.querySelectorAll('main span, main td')].filter((s) => /^Light Serviços|lido pelo código de barras/.test(s.textContent ?? '') && s.getBoundingClientRect().width > 0 && s.getBoundingClientRect().width < 90).map((s) => Math.round(s.getBoundingClientRect().width)),
    );
    ok(esmagado.length === 0, `${w}px: Documentos — nenhum texto esmagado (${esmagado.join(', ')} px)`);
    if (w === 320 || w === 375 || w === 1440) {
      const lista = page.locator('section[aria-labelledby="documentos-mister"]');
      await lista.scrollIntoViewIfNeeded();
      await lista.screenshot({ path: foto(`${w}-documentos.png`) });
    }
    await page.locator('button[aria-label^="Ver"] >> visible=true').first().click();
    await page.waitForSelector('[role="dialog"]');
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta do documento inteira na tela (${m.join(' | ')})`);
    if (w === 320 || w === 375) await page.locator('[role="dialog"]').screenshot({ path: foto(`${w}-documento-gaveta.png`) });
    await page.locator('[role="dialog"] button:has-text("Desfazer o lançamento")').click();
    await page.waitForSelector('[role="alertdialog"]');
    m = await medir(page);
    ok(m.length === 0, `${w}px: o diálogo de desfazer inteiro na tela (${m.join(' | ')})`);
    // A gaveta da nota (M3b.3): os itens com descrição longa cabem, sem barra lateral.
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="alertdialog"]', { state: 'detached' });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[role="dialog"]', { state: 'detached' });
    await page.locator('button[aria-label="Ver: Nota 48.213 · Frigorífico Boa Carne"] >> visible=true').first().click();
    await page.locator('[role="dialog"]:has-text("Itens da nota")').waitFor();
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta da nota inteira na tela (${m.join(' | ')})`);
    const itensEsmagados = await page.evaluate(() =>
      [...document.querySelectorAll('[role="dialog"] li span')].filter((s) => /BACON EM TIRAS|Bacon em tiras/.test(s.textContent ?? '') && s.getBoundingClientRect().width > 0 && s.getBoundingClientRect().width < 90).map((s) => Math.round(s.getBoundingClientRect().width)),
    );
    ok(itensEsmagados.length === 0, `${w}px: os itens da nota sem texto esmagado (${itensEsmagados.join(', ')} px)`);
    if (w === 320 || w === 375) await page.locator('[role="dialog"]').screenshot({ path: foto(`${w}-nota-gaveta.png`) });
    ok(erros.length === 0, `${w}px: Documentos sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── M3c.4: a página do relatório do link ("Ver no Regem"): o plano do servidor, mudar o período, baixar o PDF ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { caminho: `/mister/relatorio${LINK_DO_RELATORIO}` });
    await page.waitForSelector('#titulo-do-relatorio', { timeout: 20000 });
    const t = await page.locator('main').innerText();
    ok(/Carne 120 g · de 01\/11 a 16\/11 contra 01\/10 a 16\/10/.test(t), 'relatório: o título do plano do servidor');
    ok(/1\.486 unidades/.test(t) && /178,3 kg/.test(t) && /\+13%/.test(t) && /contra 01\/10 a 16\/10 \(1\.312\)/.test(t), 'relatório: os números, com o que cada um é');
    ok(/média de 01\/10 a 16\/10: 82 por dia/.test(t), 'relatório: a legenda da média do outro período');
    ok(/De onde saiu/.test(t) && /X-Tudo/.test(t) && /2 por unidade, 209 vendidos/.test(t), 'relatório: de onde saiu, com o detalhe');
    ok(/Burger da Praça · Loja Centro · Gerado em 16\/11\/2026, 22:43 pelo Mister, a pedido de Ana/.test(t), 'relatório: de quem é e quem pediu');
    ok(S.relatorioPedidos[0] === LINK_DO_RELATORIO, `relatório: lê com os parâmetros do link (${S.relatorioPedidos[0]})`);
    ok((await page.locator('[role="img"][aria-label*="Maior valor: 07, 171"]').count()) === 1, 'relatório: o gráfico com o maior valor descrito para o leitor de tela');
    // Mudar o período: lê de novo com as datas novas; a comparação continua.
    await page.locator('input[type="date"]').first().fill('2026-11-10');
    await Promise.all([page.waitForResponse((r) => r.url().includes('/mister/relatorio/insumo?') && r.url().includes('de=2026-11-10')), page.click('button:has-text("Mudar o período")')]);
    const ultimo = S.relatorioPedidos.at(-1) ?? '';
    ok(ultimo.includes('de=2026-11-10') && ultimo.includes('ate=2026-11-16') && ultimo.includes('compararDe=2026-10-01'), `relatório: mudar o período lê de novo e mantém a comparação (${ultimo})`);
    // Baixar o PDF: o mesmo pedido, com o login, e abre.
    await page.waitForSelector('#titulo-do-relatorio');
    const [popup] = await Promise.all([
      page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null),
      page.waitForResponse((r) => r.url().includes('/mister/relatorio/insumo/pdf?')),
      page.click('button:has-text("Baixar PDF")'),
    ]);
    ok(!!popup && (S.relatorioPdfs[0] ?? '').includes('de=2026-11-10'), `relatório: "Baixar PDF" pede o PDF do período na tela e abre (${S.relatorioPdfs[0]})`);
    if (popup) await popup.close();
    ok(erros.length === 0, `relatório: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    // A recusa do servidor (a loja que a pessoa não consulta, o gerente sem a permissão): a frase dele e "Tentar de novo".
    const r = await abrir(1280, 900, { caminho: `/mister/relatorio${LINK_DO_RELATORIO}`, relatorioRecusa: 'Este relatório é de uma loja que você não consulta.' });
    await r.page.waitForSelector('text=Este relatório é de uma loja que você não consulta.', { timeout: 20000 });
    ok(true, 'relatório: a recusa do servidor aparece com a frase dele');
    r.S.relatorioRecusa = null;
    await r.page.click('button:has-text("Tentar de novo")');
    await r.page.waitForSelector('#titulo-do-relatorio', { timeout: 20000 });
    ok(true, 'relatório: "Tentar de novo" lê de novo');
    await r.ctx.close();
    // Nada vendido no período: o vazio diz, sem gráfico nem "de onde saiu".
    const v = await abrir(1280, 900, { caminho: `/mister/relatorio${LINK_DO_RELATORIO}`, relatorio: { ...RELATORIO_INSUMO(), total: 0 } });
    await v.page.waitForSelector('text=Nenhuma venda deste insumo no período.', { timeout: 20000 });
    ok((await v.page.locator('text=De onde saiu').count()) === 0, 'relatório: o vazio sem gráfico nem "de onde saiu"');
    await v.ctx.close();
  }
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { caminho: `/mister/relatorio${LINK_DO_RELATORIO}` });
    await page.waitForSelector('#titulo-do-relatorio', { timeout: 20000 });
    const m = await medir(page);
    ok(m.length === 0, `${w}px: o relatório sem barra lateral e com toque grande (${m.join(' | ')})`);
    const esmagado = await page.evaluate(() =>
      [...document.querySelectorAll('main li span, main dd')].filter((s) => /Duplo Bacon|1\.486/.test(s.textContent ?? '') && s.getBoundingClientRect().width > 0 && s.getBoundingClientRect().width < 60).map((s) => Math.round(s.getBoundingClientRect().width)),
    );
    ok(esmagado.length === 0, `${w}px: o relatório sem texto esmagado (${esmagado.join(', ')} px)`);
    if (w === 320 || w === 375 || w === 1440) await page.locator('main').screenshot({ path: foto(`${w}-relatorio.png`) });
    ok(erros.length === 0, `${w}px: o relatório sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── RESUMO (a entrada do presidente, versão 1 do protótipo): as três etapas, o que o Mister faz, os últimos avisos ──
  {
    const { ctx, page, erros } = await abrir(1280, 900, { caminho: '/mister' });
    await page.waitForSelector('#mister-etapas', { timeout: 20000 });
    await page.locator('text=Últimos avisos >> visible=true').waitFor();
    const t = await page.locator('main').innerText();
    ok((await page.locator('[aria-label="Partes do Mister"] button').first().getAttribute('aria-pressed')) === 'true', 'resumo: o presidente entra pelo Resumo');
    ok(/Para o Mister funcionar/.test(t) && /2 de 3 etapas concluídas\./.test(t), `resumo: as três etapas, com quantas estão feitas (${(t.match(/\d de 3 etapas concluídas\./) ?? [''])[0]})`);
    ok(/Módulo ligado/.test(t) && /A IA incluída no seu plano: funcionando\./.test(t) && /Ligue pelo seu celular/.test(t), 'resumo: o módulo, a IA incluída no plano e o WhatsApp que falta ligar');
    ok(/O que o Mister faz por esta empresa/.test(t) && /Relatórios com gráfico e por insumo/.test(t) && /Ponto e escala[\s\S]*o arquivo do ponto do mês/.test(t) && /Áudio[\s\S]*em breve/.test(t), 'resumo: o que o Mister faz, com o ponto e escala e o áudio em breve');
    ok(/Loja Centro · impressora Cozinha parada/.test(t), 'resumo: os últimos avisos do histórico');
    // Versão 3: os boletos e as notas por foto, ligados (a função na instalação, a empresa com a leitura ligada, a IA ok).
    ok(/Boletos e notas por foto\s*Mande a foto: ele lê, lança e avisa do vencimento\.\s*ligado/.test(t), 'resumo: os boletos e as notas por foto, ligados');
    // Cada etapa leva à parte onde se resolve.
    await page.click('button:has-text("Ligar o meu WhatsApp")');
    await page.waitForSelector('text=Quem fala com o Mister', { timeout: 20000 });
    ok((await page.locator('h1').first().innerText()).includes('Pessoas'), 'resumo: "Ligar o meu WhatsApp" abre Pessoas');
    ok(erros.length === 0, `resumo: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  // Os boletos e as notas por foto: "em breve" sem a função na instalação; "desligado" com a empresa tendo desligado a leitura.
  for (const [o, rotulo] of [
    [{ disponivelDocs: false }, 'em breve'],
    [{ conversa: { documentosLigado: false, documentosModo: 'sozinho' } }, 'desligado'],
  ]) {
    const { ctx, page, erros } = await abrir(1280, 900, { caminho: '/mister', ...o });
    await page.waitForSelector('#mister-etapas', { timeout: 20000 });
    await page.locator('text=Boletos e notas por foto >> visible=true').waitFor();
    await page.waitForFunction((r) => new RegExp(`Boletos e notas por foto\\s*Mande a foto: ele lê, lança e avisa do vencimento\\.\\s*${r}`).test(document.querySelector('main')?.innerText ?? ''), rotulo, { timeout: 10000 }).catch(() => {});
    const t = await page.locator('main').innerText();
    ok(new RegExp(`Boletos e notas por foto\\s*Mande a foto: ele lê, lança e avisa do vencimento\\.\\s*${rotulo}`).test(t), `resumo: os boletos e as notas por foto, ${rotulo}`);
    ok(erros.length === 0, `resumo (${rotulo}): sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    // Versão 5, M5e: com a versão 5 desligada nesta instalação, o "Como mandar o resumo" diz que o resumo segue por escrito.
    const { ctx, page, erros } = await abrir(1280, 900, { caminho: '/mister?parte=avisos', resumoEmArquivo: false });
    await page.waitForSelector('#mister-avisos-titulo', { timeout: 20000 });
    await page.waitForSelector('[data-resumo-em-arquivo-desligado]', { timeout: 10000 });
    const t = await page.locator('main').innerText();
    ok(/Como mandar o resumo[\s\S]*ainda não ligado no Regem: o resumo segue só por escrito/.test(t), 'resumo desligado na instalação: o ajuste diz que o resumo segue só por escrito');
    ok(erros.length === 0, `resumo desligado na instalação: sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }
  {
    // A chave da empresa sem crédito: a faixa "IA parada" e o "Resolver" que abre IA e uso.
    const parada = { provedoresAceitos: ['anthropic'], origem: 'propria', chave: { provedor: 'anthropic', final: 'A1b2', situacao: 'sem_credito', conferidaEm: null, salvaEm: null } };
    const { ctx, page } = await abrir(1280, 900, { caminho: '/mister', estado: parada });
    await page.waitForSelector('#mister-etapas', { timeout: 20000 });
    await page.locator('text=IA parada. >> visible=true').waitFor();
    const t = await page.locator('main').innerText();
    ok(/A chave de IA da empresa está sem crédito/.test(t) && /Sua chave da Anthropic · final A1b2 · está sem crédito\./.test(t) && /1 de 3 etapas concluídas\./.test(t), 'resumo: a IA parada, na faixa e na etapa');
    ok(/Perguntas sobre a loja[\s\S]*precisa da chave de IA/.test(t), 'resumo: o que depende da IA diz que precisa da chave');
    await page.click('button:has-text("Resolver")');
    await page.waitForSelector('h1:has-text("IA e uso")', { timeout: 20000 });
    ok(true, 'resumo: "Resolver" abre IA e uso');
    await ctx.close();
    // Os avisos que não deu para ler: a frase e "Tentar de novo" (as etapas seguem).
    const f = await abrir(1280, 900, { caminho: '/mister', historicoFalha: true });
    await f.page.waitForSelector('text=Não consegui ler os avisos agora.', { timeout: 20000 });
    ok((await f.page.locator('text=2 de 3 etapas concluídas.').count()) === 1, 'resumo: o erro dos avisos não derruba as etapas');
    f.S.historicoFalha = false;
    await f.page.click('button:has-text("Tentar de novo")');
    await f.page.locator('text=Loja Centro · impressora Cozinha parada >> visible=true').waitFor({ timeout: 20000 });
    ok(true, 'resumo: "Tentar de novo" lê os avisos de novo');
    await f.ctx.close();
  }
  // ── Versão 4, M4a: a parte "Jeito e memória" — o perfil e o jeito da empresa, salvando só o que mudou ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { caminho: '/mister?parte=jeito' });
    await page.waitForSelector('#mister-jeito-titulo', { timeout: 20000 });
    const partes = await page.locator('[aria-label="Partes do Mister"] button').allInnerTexts();
    ok(/Jeito e memória/.test(partes.at(-1) ?? ''), `jeito: a parte nova é a última das partes (${partes.join(' · ')})`);
    const t = await page.locator('main').innerText();
    ok(/O jeito do Mister/.test(t) && /As regras não mudam com o perfil/.test(t) && /os mesmos perfis do atendente virtual/.test(t), 'jeito: o título, o aviso das regras e a ajuda do perfil');
    const perfil = page.getByLabel('Perfil', { exact: true });
    ok((await perfil.inputValue()) === 'hoje', 'jeito: o padrão é "Como hoje"');
    const nomes = await perfil.locator('option').allInnerTexts();
    ok(nomes.join('|') === 'Como hoje|Profissional|Cordial|Gentil|Descontraído|Objetivo|Acolhedor', `jeito: os 7 perfis do atendente, na ordem (${nomes.join('|')})`);
    const salvar = () => Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/conversa') && r.request().method() === 'PATCH'), page.click('button:has-text("Salvar alterações")')]);
    await perfil.selectOption('descontraido');
    await page.waitForSelector('text=1 alteração ainda não salva');
    await salvar();
    ok(JSON.stringify(S.salvamentosConv.at(-1)) === JSON.stringify({ perfil: 'descontraido' }), `jeito: salvar manda SÓ o perfil (${JSON.stringify(S.salvamentosConv.at(-1))})`);
    await page.waitForSelector('text=Salvo. Vale da próxima pergunta em diante.');
    const jeito = page.getByLabel('Jeito da empresa', { exact: true });
    await jeito.fill('Fale como sócio, sem formalidade.');
    await salvar();
    ok(JSON.stringify(S.salvamentosConv.at(-1)) === JSON.stringify({ jeito: 'Fale como sócio, sem formalidade.' }), `jeito: salvar manda SÓ o jeito (${JSON.stringify(S.salvamentosConv.at(-1))})`);
    await jeito.fill('   ');
    await salvar();
    ok(JSON.stringify(S.salvamentosConv.at(-1)) === JSON.stringify({ jeito: null }), `jeito: o jeito em branco vai como null (${JSON.stringify(S.salvamentosConv.at(-1))})`);
    ok((await perfil.inputValue()) === 'descontraido', 'jeito: o perfil salvo segue marcado depois de salvar o jeito');
    // M4c: os avisos escritos — um por grupo, nascem desmarcados; salvar manda SÓ os grupos, na ordem do servidor.
    const grupoNaLoja = page.getByLabel('Na loja', { exact: true });
    const grupoFiscal = page.getByLabel('Fiscal', { exact: true });
    ok(!(await grupoNaLoja.isChecked()) && !(await grupoFiscal.isChecked()), 'avisos escritos: nascem desmarcados');
    ok(/Quem descobre o problema continua sendo a regra, sem IA/.test(await page.locator('main').innerText()), 'avisos escritos: a ajuda diz que a regra descobre e a IA só escreve');
    await grupoFiscal.check();
    await grupoNaLoja.check();
    await page.waitForSelector('text=1 alteração ainda não salva');
    await salvar();
    ok(JSON.stringify(S.salvamentosConv.at(-1)) === JSON.stringify({ avisosEscritos: ['loja', 'fiscal'] }), `avisos escritos: salvar manda SÓ os grupos, na ordem (${JSON.stringify(S.salvamentosConv.at(-1))})`);
    ok((await grupoNaLoja.isChecked()) && (await grupoFiscal.isChecked()) && !(await page.getByLabel('Servidor', { exact: true }).isChecked()), 'avisos escritos: os marcados seguem marcados depois de salvar');
    await grupoFiscal.uncheck();
    await salvar();
    ok(JSON.stringify(S.salvamentosConv.at(-1)) === JSON.stringify({ avisosEscritos: ['loja'] }), `avisos escritos: desmarcar manda a lista sem ele (${JSON.stringify(S.salvamentosConv.at(-1))})`);
    // M4d: a chave "Fica de olho" e lembretes — nasce desligada; ligar manda SÓ ela.
    const olho = page.getByRole('switch', { name: '"Fica de olho" e lembretes' });
    ok((await olho.getAttribute('aria-checked')) === 'false', '"fica de olho": nasce desligado');
    ok(/me avisa quando o #284 sair/.test(await page.locator('main').innerText()), '"fica de olho": a ajuda traz os exemplos da conversa');
    await olho.click();
    await salvar();
    ok(JSON.stringify(S.salvamentosConv.at(-1)) === JSON.stringify({ ficaDeOlho: true }), `"fica de olho": ligar manda SÓ a chave (${JSON.stringify(S.salvamentosConv.at(-1))})`);
    ok((await olho.getAttribute('aria-checked')) === 'true', '"fica de olho": segue ligado depois de salvar');
    ok(erros.length === 0, `jeito: sem erro (${erros.join(' | ')})`);
    await ctx.close();
    // A leitura que falha: a frase e "Tentar de novo".
    const f = await abrir(1280, 900, { caminho: '/mister?parte=jeito', conversaFalha: true });
    await f.page.waitForSelector('text=Não deu para ler o jeito do Mister agora.', { timeout: 20000 });
    f.S.conversaFalha = false;
    await f.page.click('button:has-text("Tentar de novo")');
    await f.page.waitForSelector('#mister-jeito-titulo', { timeout: 20000 });
    ok(true, 'jeito: "Tentar de novo" lê de novo');
    await f.ctx.close();
  }
  // ── Versão 4, M4b (mig 449): "O que o Mister sabe" — a lista, as duas situações, o medidor, a busca e a origem; anotar,
  //    a recusa do servidor no campo, mudar e esquecer; vazio e erro ──
  {
    const { ctx, page, erros, S } = await abrir(1280, 900, { caminho: '/mister?parte=jeito' });
    await page.waitForSelector('#mister-sabe', { timeout: 20000 });
    const secao = page.locator('section[aria-labelledby="mister-sabe"]');
    await secao.locator('text=O pico da noite').first().waitFor({ timeout: 20000 });
    let t = await secao.innerText();
    ok(/5 anotações/.test(t) && /Da empresa\s*3/.test(t) && /De cada pessoa\s*2/.test(t), `memória: a contagem e as duas situações com a quantidade (${t.slice(0, 160).replace(/\s+/g, ' ')})`);
    ok(/de 2\.200 letras usadas/.test(t) && /nunca guarda número/.test(t), 'memória: o medidor da empresa e a regra do que não se guarda');
    ok(/Anotado na conversa com Ana/.test(t) && /Escrito por você/.test(t) && !/Ana prefere/.test(t), 'memória: "Da empresa" mostra só o da empresa, com de onde veio');
    await secao.locator('button:has-text("De cada pessoa")').click();
    t = await secao.innerText();
    ok(/Ana prefere/.test(t) && /De Carlos Lima/.test(t) && !/O pico da noite/.test(t) && /Ana Souza: 60 de 1\.375 letras/.test(t), `memória: "De cada pessoa" com o dono e a conta de cada um (${t.slice(0, 400).replace(/\s+/g, ' ')})`);
    await secao.locator('button:has-text("Da empresa")').click();
    await page.locator('#memoria-busca').fill('smash');
    await page.waitForSelector('text=1 de 5 anotações');
    await page.locator('#memoria-busca').fill('');
    await page.getByLabel('De onde veio', { exact: true }).selectOption('presidente');
    t = await secao.innerText();
    ok(/Smash/.test(t) && !/O pico da noite/.test(t), 'memória: o filtro de origem ("Escrito por você")');
    await page.getByLabel('De onde veio', { exact: true }).selectOption('');
    // Anotar: a recusa do servidor aparece no campo, nada some; depois salva e a lista lê de novo.
    await secao.locator('button:has-text("Anotar")').click();
    const gaveta = page.locator('[role="dialog"]');
    await gaveta.waitFor();
    ok((await page.getByLabel('Sobre', { exact: true }).locator('option').allInnerTexts()).join('|') === 'A empresa (vale para todos)|Ana Souza|Carlos Lima', 'memória: "Sobre" com a empresa e quem ligou o WhatsApp');
    S.memoriaRecusa = 'Tem um valor em reais: o Mister não guarda número — ele consulta na hora. Tire o valor e salve.';
    await page.getByLabel('O que o Mister deve lembrar', { exact: true }).fill('A meta é R$ 5.000 por noite.');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/memoria') && r.request().method() === 'POST'), gaveta.locator('button:has-text("Salvar")').click()]);
    await gaveta.locator('[role="alert"]:has-text("Tem um valor em reais")').waitFor();
    ok((await page.getByLabel('O que o Mister deve lembrar', { exact: true }).inputValue()) === 'A meta é R$ 5.000 por noite.', 'memória: a recusa aparece no campo e o texto fica para corrigir');
    S.memoriaRecusa = null;
    await page.getByLabel('Sobre', { exact: true }).selectOption(CARLOS);
    await page.getByLabel('O que o Mister deve lembrar', { exact: true }).fill('  Carlos   trabalha de quinta a domingo.  ');
    ok(/Ainda cabem 1\.319 letras de Carlos Lima/.test(await gaveta.innerText()), 'memória: quanto ainda cabe, da pessoa escolhida');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/memoria') && r.request().method() === 'POST'), gaveta.locator('button:has-text("Salvar")').click()]);
    await page.waitForSelector('text=6 anotações');
    ok(JSON.stringify(S.memoriaPedidos.at(-1).corpo) === JSON.stringify({ sobre: CARLOS, texto: 'Carlos trabalha de quinta a domingo.' }), `memória: anotar manda o dono e o texto limpo (${JSON.stringify(S.memoriaPedidos.at(-1).corpo)})`);
    // Mudar: a gaveta abre com o texto e o dono fixo; vai só o texto.
    await secao.locator('button[aria-label^="Mudar: O pico da noite"]').click();
    await gaveta.waitFor();
    ok((await page.getByLabel('O que o Mister deve lembrar', { exact: true }).inputValue()).startsWith('O pico da noite') && /Sobre:\s*a empresa/.test(await gaveta.innerText()), 'memória: "Mudar" abre com o texto e o dono');
    await page.getByLabel('O que o Mister deve lembrar', { exact: true }).fill('O pico da noite é das 20h às 22h.');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/memoria/m-e1') && r.request().method() === 'PATCH'), gaveta.locator('button:has-text("Salvar")').click()]);
    ok(JSON.stringify(S.memoriaPedidos.at(-1).corpo) === JSON.stringify({ texto: 'O pico da noite é das 20h às 22h.' }), 'memória: mudar manda só o texto');
    // Esquecer: o diálogo com a anotação, e a lista sem ela.
    await secao.locator('button[aria-label^="Esquecer: \\"Smash\\""]').click();
    const dialogo = page.locator('[role="alertdialog"]');
    await dialogo.waitFor();
    ok(/Smash/.test(await dialogo.innerText()) && /Não dá para desfazer/.test(await dialogo.innerText()), 'memória: o diálogo de esquecer mostra a anotação e avisa que não se desfaz');
    await Promise.all([page.waitForResponse((r) => r.url().endsWith('/mister/memoria/m-e2') && r.request().method() === 'DELETE'), dialogo.locator('button:has-text("Esquecer")').click()]);
    await page.waitForSelector('text=5 anotações');
    ok(!/Smash/.test(await secao.innerText()), 'memória: esquecida, sai da lista');
    ok(erros.length === 0, `memória: sem erro (${erros.join(' | ')})`);
    await ctx.close();
    // Nada anotado: a frase de vazio. A leitura que falha: a frase e "Tentar de novo".
    const v = await abrir(1280, 900, { caminho: '/mister?parte=jeito', memoria: [] });
    await v.page.waitForSelector('text=O Mister ainda não anotou nada.', { timeout: 20000 });
    ok(true, 'memória: o vazio com a explicação');
    await v.ctx.close();
    const f = await abrir(1280, 900, { caminho: '/mister?parte=jeito', memoriaFalha: true });
    await f.page.waitForSelector('text=Não deu para ler o que o Mister sabe agora.', { timeout: 20000 });
    f.S.memoriaFalha = false;
    await f.page.locator('[role="alert"]:has-text("o que o Mister sabe") button:has-text("Tentar de novo")').click();
    await f.page.waitForSelector('#mister-sabe', { timeout: 20000 });
    ok(true, 'memória: "Tentar de novo" lê de novo');
    await f.ctx.close();
  }
  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { caminho: '/mister?parte=jeito' });
    await page.waitForSelector('#mister-jeito-titulo', { timeout: 20000 });
    let m = await medir(page);
    ok(m.length === 0, `${w}px: "Jeito e memória" sem barra lateral e com toque grande (${m.join(' | ')})`);
    // Com uma alteração (a barra de salvar aparece) e o jeito preenchido: continua sem barra lateral.
    await page.getByLabel('Perfil', { exact: true }).selectOption('objetivo');
    await page.getByLabel('Jeito da empresa', { exact: true }).fill('Fale como sócio, sem formalidade. No fim da noite, comece pelo que deu errado.');
    // M4c: os quatro grupos marcados (a linha das marcas quebra no estreito).
    for (const g of ['Na loja', 'Servidor', 'Fiscal', 'O próprio Mister']) await page.getByLabel(g, { exact: true }).check();
    // M4d: a chave do "fica de olho" ligada também.
    await page.getByRole('switch', { name: '"Fica de olho" e lembretes' }).click();
    await page.waitForSelector('text=4 alterações ainda não salvas');
    m = await medir(page);
    ok(m.length === 0, `${w}px: "Jeito e memória" com a barra de salvar, sem barra lateral (${m.join(' | ')})`);
    const area = await page.getByLabel('Jeito da empresa', { exact: true }).boundingBox();
    const caixa = await page.locator('main').boundingBox();
    ok(!!area && !!caixa && area.width >= Math.min(caixa.width - 80, 480) * 0.6, `${w}px: a caixa do jeito não fica espremida (${Math.round(area?.width ?? 0)} px)`);
    if (w === 320 || w === 375 || w === 1440) await page.locator('main').screenshot({ path: foto(`${w}-jeito.png`) });
    // "O que o Mister sabe": a lista (com a anotação de 300 letras), as pessoas, a gaveta de anotar e o diálogo de esquecer
    // — cada um ABERTO nesta largura, sem barra lateral e com o texto da anotação legível (V45).
    const secao = page.locator('section[aria-labelledby="mister-sabe"]');
    await secao.locator('text=O pico da noite').first().waitFor({ timeout: 20000 });
    m = await medir(page);
    ok(m.length === 0, `${w}px: "O que o Mister sabe" sem barra lateral e com toque grande (${m.join(' | ')})`);
    const estreito = await page.evaluate(() =>
      [...document.querySelectorAll('section[aria-labelledby="mister-sabe"] span')]
        .filter((s) => /^(O pico da noite|A loja ainda fecha)/.test(s.textContent ?? '') && s.getBoundingClientRect().width > 0 && s.getBoundingClientRect().width < 150)
        .map((s) => Math.round(s.getBoundingClientRect().width)),
    );
    ok(estreito.length === 0, `${w}px: o texto da anotação não fica espremido (${estreito.join(', ')} px)`);
    await secao.locator('button:has-text("De cada pessoa")').click();
    m = await medir(page);
    ok(m.length === 0, `${w}px: "De cada pessoa" sem barra lateral (${m.join(' | ')})`);
    await secao.locator('button:has-text("Anotar")').click();
    await page.locator('[role="dialog"]').waitFor();
    await page.getByLabel('O que o Mister deve lembrar', { exact: true }).fill('x'.repeat(300));
    m = await medir(page);
    ok(m.length === 0, `${w}px: a gaveta "Anotar" aberta, inteira e sem barra lateral (${m.join(' | ')})`);
    if (w === 320 || w === 1440) await page.locator('[role="dialog"]').screenshot({ path: foto(`${w}-memoria-anotar.png`) });
    await page.keyboard.press('Escape');
    await page.locator('[role="dialog"]').waitFor({ state: 'detached' });
    await secao.locator('button[aria-label^="Esquecer: Ana prefere"]').first().click();
    await page.locator('[role="alertdialog"]').waitFor();
    m = await medir(page);
    ok(m.length === 0, `${w}px: o diálogo "Esquecer" aberto, inteiro e sem barra lateral (${m.join(' | ')})`);
    await page.keyboard.press('Escape');
    if (w === 320 || w === 375 || w === 1440) await secao.screenshot({ path: foto(`${w}-memoria.png`) });
    ok(erros.length === 0, `${w}px: "Jeito e memória" sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  for (const w of larguras) {
    const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { caminho: '/mister' });
    await page.waitForSelector('#mister-etapas', { timeout: 20000 });
    await page.locator('text=Últimos avisos >> visible=true').waitFor();
    const m = await medir(page);
    ok(m.length === 0, `${w}px: o Resumo sem barra lateral e com toque grande (${m.join(' | ')})`);
    const esmagado = await page.evaluate(() =>
      [...document.querySelectorAll('#mister-etapas ~ * li span, main li span')]
        .filter((s) => /^(Ligue pelo seu celular|Ligado em Visão|A IA incluída)/.test(s.textContent ?? '') && s.getBoundingClientRect().width > 0 && s.getBoundingClientRect().width < 150)
        .map((s) => Math.round(s.getBoundingClientRect().width)),
    );
    ok(esmagado.length === 0, `${w}px: o Resumo sem texto esmagado (${esmagado.join(', ')} px)`);
    if (w === 320 || w === 375 || w === 1440) await page.locator('main').screenshot({ path: foto(`${w}-resumo.png`) });
    ok(erros.length === 0, `${w}px: o Resumo sem erro (${erros.join(' | ')})`);
    await ctx.close();
  }

  // ── Versão 5 (M5b.2): Mister › IA e uso › "Fotos e áudios · DMS Graph" — a franquia do mês (uma só, da empresa), o aviso
  //    de que acabou e a empresa sem o Graph (com o caminho para ligar); sem a situação, o quadro não aparece ──
  {
    const { ctx, page } = await abrir(1280, 900, { estado: comChave(), caminho: '/mister?parte=ia' });
    await page.locator('text=Uso da IA >> visible=true').first().waitFor({ timeout: 20000 }).catch(() => undefined);
    await page.waitForTimeout(800);
    ok((await page.locator('#fotos-e-audios-titulo').count()) === 0, 'sem a situação do Graph: o quadro "Fotos e áudios" não aparece (o resto da tela segue)');
    await ctx.close();
  }
  for (const w of larguras) {
    for (const g of ['ligado', 'acabou', 'sem']) {
      const { ctx, page, erros } = await abrir(w, w < 700 ? 820 : 900, { estado: comChave(), caminho: '/mister?parte=ia', graph: g });
      const quadro = page.locator('section[aria-labelledby="fotos-e-audios-titulo"]');
      await quadro.waitFor({ timeout: 20000 });
      await quadro.scrollIntoViewIfNeeded();
      const texto = await quadro.innerText();
      if (g === 'ligado') ok(/Fotos e áudios lidos em [a-zç]+/.test(texto) && /137/.test(texto) && /500/.test(texto), `${w}px: ligado — "Fotos e áudios lidos em <mês>", 137 de 500`);
      if (g === 'acabou') ok((await quadro.locator('[role="alert"]').innerText()).includes('acabou') && /não ouve áudios/.test(texto), `${w}px: a franquia acabou — o aviso diz que o Mister não ouve áudios até o dia 1º`);
      if (g === 'sem') ok((await quadro.locator('a[href="/delivery/configuracoes?aba=integracoes"]').innerText()).includes('Delivery › Configurações › Integrações'), `${w}px: sem o Graph — o caminho para ligar, com o link`);
      const m = await medir(page);
      ok(m.length === 0, `${w}px (${g}): o quadro inteiro na tela, sem barra lateral (${m.join(' | ')})`);
      const espremido = await quadro.evaluate((el) => (el.getBoundingClientRect().width < 200 ? Math.round(el.getBoundingClientRect().width) : 0));
      ok(espremido === 0, `${w}px (${g}): o quadro não fica espremido (${espremido} px)`);
      if ((w === 320 || w === 375 || w === 1440) && g !== 'sem') await quadro.screenshot({ path: foto(`${w}-fotos-e-audios-${g}.png`) });
      ok(erros.length === 0, `${w}px (${g}): o quadro sem erro (${erros.join(' | ')})`);
      await ctx.close();
    }
  }
}
