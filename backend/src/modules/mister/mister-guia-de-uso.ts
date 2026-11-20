import { CATALOGO_PERMISSOES, Permissoes } from '../../auth/permissoes';
import { MODULOS } from '../modulo/modulo.service';
import { semAcento } from './mister-agente.regras';

/**
 * O GUIA DE USO do Regem — o suporte de uso do Mister (F2.5 do plano em `docs/plano-mister.md`; decisão do dono de
 * 14/11/2026: "use o recomendado" — um guia curto das telas principais, escrito por nós a partir das telas de verdade).
 *
 * É da DISTRIBUIÇÃO: vive no código, igual para toda empresa, e nenhuma loja edita. O Mister consulta por assunto
 * (`buscarNoGuia`) e passa o caminho e os passos como estão — ele não inventa menu nem botão (V65, ERR-269).
 *
 * A spec (`mister-guia-de-uso.spec.ts`) confere, contra o código das telas:
 *   - `caminho` e `rota` = uma linha do menu em `frontend/src/components/app-shell/shell.tsx` (grupo › item);
 *   - `perm` e `soPresidente` = os da mesma linha do menu;
 *   - cada texto entre aspas nos passos está em `botoes`, e cada um de `botoes` existe LITERALMENTE no `frontend/src`;
 *   - nada de valor em reais nem de endereço da internet (o filtro de saída do Mister tiraria).
 * Mudou o nome de um item do menu ou de um botão citado aqui → a spec fica vermelha e o guia muda no mesmo PR.
 */
export interface SecaoDoGuia {
  /** Identificador estável (para a trilha e os testes). */
  id: string;
  /** O assunto, como a pessoa pergunta ("Pausar os pedidos de um canal"). */
  titulo: string;
  /** Os nomes do menu até a tela, como aparecem: ['Delivery', 'Painel'] ou ['Estoque']. */
  caminho: string[];
  /** O endereço da tela (o `href` da linha do menu). */
  rota: string;
  /** A permissão do perfil que libera o item do menu (a mesma do `shell.tsx`); `null` = o item não pede permissão. */
  perm: keyof Permissoes | null;
  /** O item do menu é só do presidente. */
  soPresidente?: boolean;
  /** O item só aparece com este módulo contratado e ligado (o mesmo `modulo` do menu). */
  modulo?: string;
  /** Palavras que a pessoa usaria para perguntar (sem acento não importa). */
  palavras: string[];
  /** O passo a passo, curto. Nome de botão, aba ou campo vai entre aspas duplas e TAMBÉM em `botoes`. */
  passos: string[];
  /** Os textos da tela citados nos passos — a spec procura cada um no `frontend/src`. */
  botoes: string[];
  /** O que a própria tela avisa (limites, quem pode). */
  notas?: string[];
  /**
   * Outras seções ligadas (pelo `id`): o caminho de outra tela sai DELAS, conferido — passos e notas nunca escrevem um
   * caminho de menu ("›") por conta própria.
   */
  veja?: string[];
  /**
   * M3d: o que cada número marca na imagem da tela (`frontend/public/como-faco/<id>.png`, feita pelos roteiros com dados
   * de exemplo — `GERAR_COMO_FACO=1`), na ordem das marcas. A spec confere que o arquivo existe.
   */
  imagem?: string[];
}

// ───────────────────────────── a busca ─────────────────────────────

/** Palavras que não dizem o assunto ("como faço para…", "onde fica o…"). */
const PALAVRAS_VAZIAS = new Set(
  (
    'a o as os um uma uns umas e ou de da do das dos no na nos nas em ao aos para pra pro pros com sem por pelo pela que qual quais ' +
    'como faco faz fazer fazemos consigo consegue posso pode podemos preciso precisa quero queria gostaria onde fica ficam esta estao ' +
    'eu me meu minha meus minhas seu sua seus suas voce vc nos la ai aqui isso esse essa este esta tem ter ja mais muito so ate ' +
    'agora hoje sistema regem tela menu botao opcao jeito forma vez coisa algum alguma ensina explica mostra diz dizer sobre ' +
    'nao sim quando porque pq ta to vou novo nova novos novas'
  ).split(' '),
);

/** As palavras do texto, sem acento, sem as vazias. */
export function palavrasDoTexto(texto: unknown): string[] {
  return semAcento(texto)
    .split(/[^a-z0-9]+/)
    .filter((p) => p.length >= 2 && !PALAVRAS_VAZIAS.has(p));
}

/**
 * A raiz de uma palavra, de um jeito simples: sem o plural e sem a terminação de verbo ou de gênero (pauso · pausa ·
 * pausar · pausado · pausei → "paus"; cadastro · cadastrar → "cadastr"; ligo · ligar → "lig"). Sobram sempre 3 letras.
 */
export function raiz(p: string): string {
  let r = p;
  if (r.length > 4 && r.endsWith('s')) r = r.slice(0, -1);
  if (r.length > 3) {
    const sem = r.replace(/(ando|endo|indo|ado|ada|ido|ida|am|em|ar|er|ir|ei|ou|o|a|e)$/, '');
    if (sem.length >= 3) r = sem;
  }
  return r;
}

/** Duas palavras falam da mesma coisa: a mesma raiz, ou uma raiz de 5 letras ou mais que é o começo da outra (entrega · entregador). */
export function mesmaPalavra(a: string, b: string): boolean {
  const ra = raiz(a);
  const rb = raiz(b);
  if (ra === rb) return true;
  const [curta, longa] = ra.length <= rb.length ? [ra, rb] : [rb, ra];
  return curta.length >= 5 && longa.startsWith(curta);
}

/** Quanto uma seção responde ao assunto (palavra-chave vale 3, do título 2, dos passos 1) e quantas palavras pedidas ela cobre. */
function avaliar(s: SecaoDoGuia, pedidas: string[]): { pontos: number; acertos: number } {
  const chaves = s.palavras.flatMap(palavrasDoTexto);
  const titulo = palavrasDoTexto(s.titulo);
  const corpo = palavrasDoTexto([...s.passos, ...(s.notas ?? [])].join(' '));
  let pontos = 0;
  let acertos = 0;
  for (const p of pedidas) {
    const vale = chaves.some((c) => mesmaPalavra(p, c)) ? 3 : titulo.some((c) => mesmaPalavra(p, c)) ? 2 : corpo.some((c) => mesmaPalavra(p, c)) ? 1 : 0;
    pontos += vale;
    if (vale) acertos++;
  }
  return { pontos, acertos };
}

export function pontosDaSecao(s: SecaoDoGuia, assunto: unknown): number {
  return avaliar(s, [...new Set(palavrasDoTexto(assunto))]).pontos;
}

export const SECOES_POR_RESPOSTA = 3;
export const PONTOS_MINIMOS = 3;

/**
 * As seções que respondem ao assunto, da melhor para a pior, no máximo 3. Cada uma precisa de pelo menos uma palavra-chave
 * (ou duas do título), de cobrir MAIS de um terço das palavras pedidas ("previsão do tempo amanhã" não acha o tempo de
 * preparo só pelo "tempo") e de MAIS da metade dos pontos da melhor (a seção que só esbarrou numa palavra fica de fora).
 */
export function buscarNoGuia(assunto: unknown, guia: SecaoDoGuia[] = GUIA_DE_USO): SecaoDoGuia[] {
  const pedidas = [...new Set(palavrasDoTexto(assunto))];
  if (!pedidas.length) return [];
  const notas = guia
    .map((s, i) => ({ s, i, ...avaliar(s, pedidas) }))
    .filter((x) => x.pontos >= PONTOS_MINIMOS && x.acertos * 3 > pedidas.length);
  if (!notas.length) return [];
  notas.sort((a, b) => b.pontos - a.pontos || a.i - b.i);
  const corte = notas[0].pontos / 2;
  return notas.filter((x) => x.pontos > corte).slice(0, SECOES_POR_RESPOSTA).map((x) => x.s);
}

/**
 * Quem abre a tela, em português. A permissão sai com o nome de Configurações › Acessos & perfis (`CATALOGO_PERMISSOES`)
 * e o módulo com o nome da Visão C&O (`MODULOS`) — as mesmas listas das telas.
 */
export function quemAbre(s: SecaoDoGuia): string {
  const partes: string[] = [];
  if (s.soPresidente) partes.push('só o presidente');
  else if (s.perm) {
    const nome = CATALOGO_PERMISSOES.find((p) => p.chave === s.perm)?.rotulo ?? s.perm;
    partes.push(`o presidente e quem tem no perfil a permissão "${nome}"`);
  } else partes.push('o presidente e o gerente');
  if (s.modulo) {
    const nome = MODULOS.find((m) => m.chave === s.modulo)?.label ?? s.modulo;
    partes.push(`a tela aparece quando o módulo "${nome}" está ligado`);
  }
  return partes.join('; ');
}

// ───────────────────────────── o guia ─────────────────────────────

const DELIVERY_PAINEL = { caminho: ['Delivery', 'Painel'], rota: '/delivery', perm: 'delivery' as const };
const DELIVERY_CONFIG = { caminho: ['Delivery', 'Configurações'], rota: '/delivery/configuracoes', perm: 'delivery' as const };
const CATALOGO = { caminho: ['Delivery', 'Gestão do catálogo'], rota: '/catalogo', perm: 'delivery' as const };
const BALCAO = { caminho: ['PDV · Balcão', 'Balcão'], rota: '/pdv', perm: 'pdv' as const };

export const GUIA_DE_USO: SecaoDoGuia[] = [
  // ── Delivery ──
  {
    id: 'pausar-canal',
    titulo: 'Pausar os pedidos de um canal (cardápio digital, iFood, 99)',
    ...DELIVERY_PAINEL,
    palavras: ['pausar', 'pausa', 'fechar a loja', 'parar de receber pedidos', 'ifood', '99', 'cardápio digital', 'reabrir', 'fechado temporariamente'],
    passos: [
      'Clique em "⏸ Pausar" no topo do painel.',
      'Em "1 · O que pausar", marque o canal ou "Todos os canais".',
      'Em "2 · Por que vai pausar?", escolha o motivo, ou "Outro motivo…" e escreva o que o cliente vai ler.',
      'Em "3 · Por quanto tempo", escolha o tempo. Na 99, só 10, 20 ou 30 minutos ou "Até o fim do dia".',
      'Confira em "4 · O cliente vai ver" e confirme no botão de pausar.',
      'A faixa no painel mostra quanto falta para reabrir. Para voltar antes, "Reabrir agora".',
    ],
    botoes: ['⏸ Pausar', '1 · O que pausar', 'Todos os canais', '2 · Por que vai pausar?', 'Outro motivo…', '3 · Por quanto tempo', 'Até o fim do dia', '4 · O cliente vai ver', 'Reabrir agora'],
    notas: [
      'O botão aparece para o presidente, o gerente e a supervisão.',
      'O iFood aparece quando a loja está ligada ao Orzuni; a 99, quando a integração da 99 está ativa.',
      'Pausar de novo troca o motivo e a hora de reabrir.',
      'O aviso antes de reabrir e a mensagem ao cliente durante a pausa se ajustam nas configurações do delivery.',
    ],
    veja: ['ajustes-da-pausa'],
    imagem: ['Delivery › Painel, no menu', 'o botão "⏸ Pausar"'],
  },
  {
    id: 'ajustes-da-pausa',
    titulo: 'Aviso antes de reabrir e mensagem ao cliente durante a pausa',
    ...DELIVERY_CONFIG,
    palavras: ['aviso antes de reabrir', 'som do aviso', 'mensagem da pausa', 'pausa dos pedidos', 'cliente durante a pausa'],
    passos: [
      'Abra a aba "Atendimento" e vá ao grupo "Pausa dos pedidos".',
      'Ajuste "Avisar antes de reabrir", "Som do aviso" e "Mensagem ao cliente durante a pausa" e salve.',
    ],
    botoes: ['Atendimento', 'Pausa dos pedidos', 'Avisar antes de reabrir', 'Som do aviso', 'Mensagem ao cliente durante a pausa'],
    imagem: ['Delivery › Configurações, no menu', 'a aba "Atendimento"', 'o grupo "Pausa dos pedidos"'],
    veja: ['pausar-canal'],
  },
  {
    id: 'aceitar-avancar',
    titulo: 'Aceitar, despachar e finalizar um pedido do delivery',
    ...DELIVERY_PAINEL,
    palavras: ['aceitar', 'avançar', 'despachar', 'finalizar', 'concluir', 'saiu para entrega', 'pedido pronto', 'entregador', 'código de entrega', 'reabrir pedido'],
    passos: [
      'Clique no pedido na lista (ou marque vários com a caixinha).',
      'Clique em "AVANÇAR": o pedido "Em análise" é aceito e vai para a produção.',
      'Clique em "AVANÇAR" de novo para a entrega sair. Se pedir, escolha quem vai levar e clique em "Despachar". "PRONTO" só marca como pronto.',
      'Na volta, clique em "FINALIZAR". Entrega do próprio iFood ou da 99 pede o código de entrega; pedido a receber pede a forma e o valor recebido.',
      '"VOLTAR" reabre um pedido concluído e pede a senha de quem libera (presidente, gerente ou supervisão).',
    ],
    botoes: ['AVANÇAR', 'Em análise', 'Despachar', 'PRONTO', 'FINALIZAR', 'VOLTAR'],
    imagem: ['o pedido selecionado na lista', 'o botão "AVANÇAR"', 'o botão "FINALIZAR"'],
    notas: ['Pedido do iFood, da 99, do Keeta e do Rappi não se edita pelo Regem.'],
  },
  {
    id: 'cancelar-pedido',
    titulo: 'Cancelar um pedido do delivery',
    ...DELIVERY_PAINEL,
    palavras: ['cancelar pedido', 'cancelamento', 'estornar pedido', 'cliente desistiu', 'perda', 'reutilizados'],
    passos: [
      'Selecione o pedido e clique em "CANCELAR"; abre o detalhe.',
      'Clique em "Cancelar", escreva o "Motivo" e a senha de quem libera (presidente, gerente ou supervisão).',
      'Se o pedido já foi aceito, diga se os itens foram "♻️ Reutilizados (ficam no estoque)" ou "🗑️ Perda (saem do estoque)".',
      'Clique em "Confirmar cancelamento".',
    ],
    botoes: ['CANCELAR', 'Cancelar', 'Motivo', '♻️ Reutilizados (ficam no estoque)', '🗑️ Perda (saem do estoque)', 'Confirmar cancelamento'],
    imagem: ['o pedido selecionado na lista', 'o botão "CANCELAR"'],
    notas: ['Não dá para desfazer: a venda é estornada, a cozinha é avisada e o pedido não reabre.'],
  },
  {
    id: 'tempo-de-preparo',
    titulo: 'Tempo de preparo e tipos de pedido do delivery',
    ...DELIVERY_PAINEL,
    palavras: ['tempo de preparo', 'tempo da cozinha', 'tipos de delivery', 'retirar na loja', 'consumir no local'],
    passos: [
      'No painel, clique em "⚙️" (as configurações do delivery).',
      'Em "Tempos de preparo", clique em "Editar", ajuste o mínimo e o máximo do balcão e do delivery e clique em "Salvar".',
      'Na mesma janela ficam os "Tipos de delivery": entrega, retirar na loja e consumir no local.',
    ],
    botoes: ['⚙️', 'Tempos de preparo', 'Editar', 'Salvar', 'Tipos de delivery'],
    imagem: ['Delivery › Painel, no menu', 'o botão "⚙️"'],
  },
  {
    id: 'tempo-de-entrega',
    titulo: 'Tempo de entrega prometido e frete grátis',
    ...DELIVERY_CONFIG,
    palavras: ['tempo de entrega', 'tempo de retirada', 'frete grátis', 'prazo de entrega', 'cardápio digital'],
    passos: [
      'Abra a aba "Cardápio".',
      'Preencha "Tempo de entrega (min)" e "Tempo de retirada (min)". Para frete grátis a partir de um valor, preencha o campo do frete grátis.',
      'Clique em "Salvar".',
    ],
    botoes: ['Cardápio', 'Tempo de entrega (min)', 'Tempo de retirada (min)', 'Salvar'],
    imagem: ['Delivery › Configurações, no menu', 'a aba "Cardápio"', 'o campo "Tempo de entrega (min)"'],
    notas: ['Só o presidente, o gerente e a supervisão editam esta tela.'],
  },
  {
    id: 'taxa-e-area',
    titulo: 'Taxa de entrega e área atendida (bairros, distância ou áreas desenhadas no mapa)',
    ...DELIVERY_CONFIG,
    palavras: ['taxa de entrega', 'frete', 'bairro', 'raio', 'área de entrega', 'distância', 'quilômetro', 'km', 'mapa', 'desenhar', 'área desenhada', 'setor'],
    passos: [
      'Abra a aba "Área de atendimento".',
      'Escolha "Por bairro" (cada bairro com a sua taxa; o marcador liga e desliga o bairro), "Por distância" (faixas de km, cada uma com a sua taxa) ou "Desenhada no mapa" (você desenha as áreas no mapa, cada uma com taxa, tempo e pedido mínimo).',
      'Por bairro, use "＋ Bairro"; por distância, os atalhos ou "＋ Faixa manual", e clique em "Salvar". Desenhada no mapa: "＋ Nova área", clique os cantos no mapa e feche no primeiro, preencha a gaveta e clique em "Salvar áreas" — fora das áreas o pedido não sai.',
    ],
    botoes: ['Área de atendimento', 'Por bairro', 'Por distância', 'Desenhada no mapa', '＋ Bairro', '＋ Faixa manual', '＋ Nova área', 'Salvar áreas', 'Salvar'],
    imagem: ['Delivery › Configurações, no menu', 'a aba "Área de atendimento"', 'os três modos: "Por bairro", "Por distância" e "Desenhada no mapa"'],
  },
  {
    id: 'horario',
    titulo: 'Horário de funcionamento do delivery',
    ...DELIVERY_CONFIG,
    palavras: ['horário', 'abrir', 'fechar', 'funcionamento', 'dias da semana', 'hora de abrir'],
    passos: [
      'Abra a aba "Horários".',
      'Marque os dias e preencha a hora de abrir e de fechar de cada um. "Mesmo horário para delivery e retirada/consumo no local" usa um horário só.',
      'Clique em "Salvar".',
    ],
    botoes: ['Horários', 'Mesmo horário para delivery e retirada/consumo no local', 'Salvar'],
    imagem: ['Delivery › Configurações, no menu', 'a aba "Horários"', '"Mesmo horário para delivery e retirada/consumo no local"'],
  },
  {
    id: 'cupom-desconto',
    titulo: 'Criar um cupom de desconto',
    ...DELIVERY_CONFIG,
    palavras: ['cupom de desconto', 'cupom', 'desconto', 'promoção', 'código promocional', 'frete grátis'],
    passos: [
      'Abra a aba "Cupons".',
      'Preencha o código em "Nome / Código" e escolha o "Tipo de desconto": percentual, valor fixo ou frete grátis.',
      'Preencha o desconto, o teto e o pedido mínimo; se quiser, "Válido de", "Válido até" e o "Limite total de usos".',
      'Clique em "Adicionar cupom".',
    ],
    botoes: ['Cupons', 'Nome / Código', 'Tipo de desconto', 'Válido de', 'Válido até', 'Limite total de usos', 'Adicionar cupom'],
    imagem: ['Delivery › Configurações, no menu', 'a aba "Cupons"', 'o botão "Adicionar cupom"'],
    notas: ['O cupom vale no cardápio digital.'],
  },
  {
    id: 'ligar-ifood-99',
    titulo: 'Ligar o iFood ou a 99 ao Regem',
    ...DELIVERY_CONFIG,
    palavras: ['integração', 'integrar', 'conectar ifood', 'ligar ifood', 'conectar 99', '99food', 'ifood', 'marketplace', 'orzuni'],
    passos: [
      'Abra a aba "Integrações" e clique no cartão da plataforma.',
      'iFood: clique em "Solicitar integração" e autorize no Portal do Parceiro do iFood.',
      '99: clique em "Conectar com 99Food", faça o login e autorize na aba que abre; volte e clique em "Já autorizei".',
      'Para desligar, "Desativar integração".',
    ],
    botoes: ['Integrações', 'Solicitar integração', 'Conectar com 99Food', 'Já autorizei', 'Desativar integração'],
    imagem: ['Delivery › Configurações, no menu', 'a aba "Integrações"', 'o cartão do iFood (o da 99Food fica ao lado)'],
    notas: ['O preço e a pausa no iFood pelo Orzuni são outra ligação, no cartão do Orzuni da mesma aba.'],
  },
  {
    id: 'whatsapp-da-loja',
    titulo: 'Conectar o WhatsApp da loja (o dos clientes)',
    ...DELIVERY_CONFIG,
    palavras: ['whatsapp', 'conectar whatsapp', 'qr code', 'número da loja', 'api oficial', 'meta', 'desconectado'],
    passos: [
      'Abra a aba "Robô de atendimento"; o bloco "Números de WhatsApp da loja" tem o cartão do número principal.',
      'Escolha "Grátis (não oficial)" ou "Oficial (Meta)".',
      'Grátis: clique em "Conectar (QR)" e leia o QR no celular (WhatsApp, Aparelhos conectados, Conectar aparelho). O QR vale 2 minutos.',
      'Oficial: diga se o número continua no WhatsApp Business do celular e clique em "Conectar com a Meta (recomendado)".',
      'Clique em "Salvar escolha".',
    ],
    botoes: ['Robô de atendimento', 'Números de WhatsApp da loja', 'Grátis (não oficial)', 'Oficial (Meta)', 'Conectar (QR)', 'Conectar com a Meta (recomendado)', 'Salvar escolha'],
    imagem: ['Delivery › Configurações, no menu', 'a aba "Robô de atendimento"', 'o cartão do "Número Principal" (o de Marketing fica ao lado)'],
    notas: ['Na API oficial, a Meta cobra as mensagens direto da loja.'],
  },
  {
    id: 'robo',
    titulo: 'Ligar e ajustar o robô de atendimento do WhatsApp',
    ...DELIVERY_CONFIG,
    palavras: ['robô', 'robo', 'bot', 'atendimento automático', 'saudação', 'mensagem de ausência', 'respostas prontas'],
    passos: [
      'Abra a aba "Robô de atendimento" e ligue "Robô ativo".',
      'Ajuste a "Saudação (primeira mensagem)", a "Mensagem de ausência (loja fechada/pausada)", as respostas prontas e a base de conhecimento.',
      'Clique em "Salvar".',
    ],
    botoes: ['Robô de atendimento', 'Robô ativo', 'Saudação (primeira mensagem)', 'Mensagem de ausência (loja fechada/pausada)', 'Salvar', 'Cardápio'],
    imagem: ['Delivery › Configurações, no menu', 'a aba "Robô de atendimento"', '"Robô ativo"'],
    notas: ['O robô só responde com o cardápio digital ligado (aba "Cardápio").'],
    veja: ['conversas-whatsapp'],
  },
  {
    id: 'conversas-whatsapp',
    titulo: 'Responder uma conversa do WhatsApp e pausar o robô nela',
    caminho: ['Delivery', 'WhatsApp'],
    rota: '/whatsapp',
    perm: 'delivery',
    palavras: ['conversa', 'responder cliente', 'pausar robô', 'retomar robô', 'enviar cardápio', 'chamado'],
    passos: [
      'Abra a conversa na lista.',
      '"Pausar robô" cala o robô nesta conversa pelo tempo escolhido ou "Até eu retomar"; "Retomar robô" volta.',
      '"Enviar cardápio" manda o cardápio; "Resolver chamado" fecha o atendimento.',
    ],
    botoes: ['Pausar robô', 'Até eu retomar', 'Retomar robô', 'Enviar cardápio', 'Resolver chamado'],
    imagem: ['Delivery › WhatsApp, no menu', 'a conversa aberta na lista', 'o botão "Pausar robô"', 'o botão "Enviar cardápio"'],
    notas: ['Ao responder, o robô fica calado na conversa por um tempo.'],
  },
  {
    id: 'preco-no-canal',
    titulo: 'Mudar o preço de um produto no iFood, na 99 ou no Regem',
    ...CATALOGO,
    palavras: ['preço', 'mudar preço', 'alterar preço', 'valor do produto', 'preço no ifood', 'preço na 99', 'ifood', '99'],
    passos: [
      'Na aba "Produtos e preços", ache o produto (a busca aceita nome, código ou descrição).',
      'Na coluna do canal (Regem, iFood ou 99), clique no preço com o lápis. Sem preço, "＋ pôr o preço".',
      'Digite o valor e clique em "Salvar" (ou Enter). O preço vai ao iFood pelo Orzuni e à 99 em instantes.',
      'No iFood e na 99, deixar o preço em branco faz o Regem parar de mexer no preço de lá.',
    ],
    botoes: ['Produtos e preços', '＋ pôr o preço', 'Salvar'],
    imagem: ['Delivery › Gestão do catálogo, no menu', 'o campo "Buscar"', 'o preço do produto no iFood (o lápis muda; a 99 fica na coluna ao lado)'],
    notas: [
      'A coluna do iFood aparece quando o iFood pelo Orzuni está ligado na empresa; a da 99, quando o preço e a pausa na 99 estão ligados. Essa ligação é feita pela equipe do Regem.',
      'Só o presidente e quem vê valores em reais mudam o preço; os outros veem o valor sem o lápis.',
    ],
  },
  {
    id: 'pausar-produto',
    titulo: 'Pausar um produto (tirar do ar) num canal ou em todos',
    ...CATALOGO,
    palavras: ['pausar produto', 'tirar do ar', 'acabou', 'esgotado', 'indisponível', 'reativar produto', 'faltou'],
    passos: [
      'Na aba "Produtos e preços", na coluna do canal, clique em "No ar": ele vira "Pausado".',
      'Para todos os canais de uma vez, "Pausar em todos" na linha do produto; "Reativar em todos" volta.',
    ],
    botoes: ['Produtos e preços', 'No ar', 'Pausado', 'Pausar em todos', 'Reativar em todos'],
    imagem: ['Delivery › Gestão do catálogo, no menu', '"No ar" do produto na coluna do iFood (um clique vira "Pausado")'],
    notas: ['Pausar no Regem tira o produto do balcão e do cardápio digital.'],
  },
  {
    id: 'conferir-apps',
    titulo: 'Conferir o cardápio com o iFood e a 99',
    ...CATALOGO,
    palavras: ['conferir', 'conferência', 'conciliação do cardápio', 'preço diferente', 'produto faltando', 'código pdv', 'bater com o ifood', 'os preços batem', 'confiro', 'confere'],
    passos: [
      'Abra a aba "Conferir com os apps" e escolha a loja no topo da tela (a conferência é por loja).',
      'Escolha o app ("iFood" ou "99") e clique no botão de ler agora; sozinha, a leitura é uma vez por dia.',
      'Filtre pela situação ("Só no Regem", "Preço diferente", "Não dá para ligar"…) e resolva na linha: "Criar no Regem", "Ligar a um produto", "Corrigir o código" ou "Ignorar".',
    ],
    botoes: ['Conferir com os apps', 'iFood', '99', 'Só no Regem', 'Preço diferente', 'Não dá para ligar', 'Criar no Regem', 'Ligar a um produto', 'Corrigir o código', 'Ignorar'],
    imagem: ['Delivery › Gestão do catálogo, no menu', 'a aba "Conferir com os apps"', 'o app conferido (iFood ou 99), com quantos há a resolver', 'as situações, como "Preço diferente"'],
    notas: ['A aba aparece quando a conferência está ligada na empresa.'],
  },
  {
    id: 'pagamento-entregador',
    titulo: 'Pagamento dos entregadores',
    caminho: ['Delivery', 'Entregadores'],
    rota: '/delivery/entregadores',
    perm: 'delivery',
    palavras: ['pagar entregador', 'pagamento do entregador', 'motoboy', 'taxa do entregador', 'fechamento do entregador', 'diária'],
    passos: [
      'Em "Modelo de pagamento — padrão da loja", defina como a loja paga; em "Pagamento por entregador", o que muda para cada um. Clique em "Salvar configurações".',
      'Em "Fechamento e pagamento", confira o período e clique em "Finalizar e pagar".',
    ],
    botoes: ['Modelo de pagamento — padrão da loja', 'Pagamento por entregador', 'Salvar configurações', 'Fechamento e pagamento', 'Finalizar e pagar'],
    imagem: ['Delivery › Entregadores, no menu', '"Como o entregador é pago"', 'o botão "Salvar configurações"'],
    notas: ['Cadastrar o entregador não é nesta tela: ele é um colaborador com a função de entregador.'],
    veja: ['cadastrar-entregador'],
  },
  {
    id: 'aplicativos-conectados',
    titulo: 'Aplicativos que leem os dados da loja (ver e revogar)',
    caminho: ['Configurações', 'Aplicativos conectados'],
    rota: '/integracoes',
    perm: 'loja',
    soPresidente: true,
    palavras: ['aplicativos conectados', 'revogar', 'autorização', 'liame', 'farol', 'acesso de terceiros'],
    passos: [
      'A tela lista os aplicativos que leem dados das lojas com a sua autorização (Liame, Farol, Orzuni…).',
      'Use os filtros ("Ativos", "Revogados"…) e, na linha, "Detalhes" ou "Revogar".',
    ],
    botoes: ['Ativos', 'Revogados', 'Detalhes', 'Revogar'],
    imagem: ['Configurações › Aplicativos conectados, no menu', 'a lista dos aplicativos (cada um com o que recebe e o botão de revogar)'],
    notas: ['Ligar o iFood e a 99 não é aqui.'],
    veja: ['ligar-ifood-99'],
  },

  // ── Balcão e caixa ──
  {
    id: 'abrir-caixa',
    titulo: 'Abrir o caixa (turno) no balcão',
    ...BALCAO,
    palavras: ['abrir caixa', 'abrir turno', 'troco inicial', 'parear terminal', 'começar a vender'],
    passos: [
      'Abra o Balcão. Se aparecer "Parear este terminal", digite o código do terminal gerado na tela de equipamentos.',
      'Clique em "Abrir turno" e informe o troco inicial.',
    ],
    botoes: ['Parear este terminal', 'Abrir turno'],
    imagem: ['PDV · Balcão › Balcão, no menu', 'o botão "Abrir turno"'],
    notas: ['O código do terminal vale 15 minutos e só uma vez.'],
  },
  {
    id: 'venda-balcao',
    titulo: 'Fazer uma venda no balcão',
    ...BALCAO,
    palavras: ['vender', 'venda', 'balcão', 'receber', 'cobrar', 'dividir conta', 'pdv'],
    passos: [
      'Toque no produto ou busque pelo nome ou código (F2 vai para a busca).',
      'Se o produto tem tamanho ou adicional, escolha na janela e adicione.',
      'Escolha a forma de pagamento (ou "Dividir conta") e clique em "Receber" (F9). Se faltar algo, o próprio botão diz o quê.',
      'Depois de "Venda concluída", clique em "Nova venda".',
    ],
    botoes: ['Dividir conta', 'Receber', 'Venda concluída', 'Nova venda', 'Em espera'],
    imagem: ['PDV · Balcão › Balcão, no menu', 'o cartão do produto (o número no canto é a quantidade no pedido)', 'o botão "Receber"'],
    notas: ['"Em espera" (F8) guarda a venda para depois.'],
  },
  {
    id: 'sangria',
    titulo: 'Sangria e suprimento do caixa',
    ...BALCAO,
    palavras: ['sangria', 'retirada', 'suprimento', 'reforço', 'tirar dinheiro do caixa'],
    passos: [
      'Com o turno aberto, clique em "Sangria" (retirada) ou "Suprimento" (reforço).',
      'Preencha o "Valor" e o motivo; se o perfil pedir, a senha de quem libera.',
      'Clique em "Confirmar".',
    ],
    botoes: ['Sangria', 'Suprimento', 'Valor', 'Confirmar'],
    imagem: ['PDV · Balcão › Balcão, no menu', 'o botão "Sangria"', 'o botão "Suprimento"'],
  },
  {
    id: 'fechar-caixa',
    titulo: 'Fechar o caixa (turno)',
    ...BALCAO,
    palavras: ['fechar caixa', 'fechar turno', 'fechamento', 'contagem cega', 'diferença de caixa'],
    passos: [
      'Clique em "Fechar turno". Se houver pedidos pendentes, resolva ou feche com a pendência.',
      'Conte e preencha "Dinheiro na gaveta", "Cartão (terminal)" e "Pix". É contagem cega: o esperado aparece só depois.',
      'Clique em "Fechar turno", confira o contado, o esperado e a diferença e clique em "Concluir".',
    ],
    botoes: ['Fechar turno', 'Dinheiro na gaveta', 'Cartão (terminal)', 'Pix', 'Concluir'],
    imagem: ['PDV · Balcão › Balcão, no menu', 'o botão "Fechar turno"'],
    notas: ['Diferença acima do limite vira ocorrência para a gestão.', 'Caixa aberto há mais de 24 horas pede o fechamento.'],
    veja: ['ver-turno'],
  },
  {
    id: 'reimprimir-cancelar-venda',
    titulo: 'Reimprimir ou cancelar uma venda do balcão',
    caminho: ['PDV · Balcão', 'Cupons'],
    rota: '/cupons',
    perm: 'cupons',
    palavras: ['reimprimir', 'segunda via', 'cancelar venda', 'estornar venda', 'cupom da venda', 'vendas do dia'],
    passos: [
      'Busque a venda pela senha ou pelo número ("Buscar") ou abra em "Últimas vendas".',
      'No detalhe, "🖨 Reimprimir (térmica)" ou "Cancelar venda (estornar)".',
    ],
    botoes: ['Buscar', 'Últimas vendas', '🖨 Reimprimir (térmica)', 'Cancelar venda (estornar)'],
    imagem: ['PDV · Balcão › Cupons, no menu', 'o campo "Buscar por senha/nº"', 'a lista "Últimas vendas"'],
    notas: ['Esta tela é a lista das vendas; o cupom de desconto é outro assunto.'],
    veja: ['cupom-desconto'],
  },

  // ── Relatórios ──
  {
    id: 'ver-turno',
    titulo: 'Ver o fechamento de um caixa (turno)',
    caminho: ['Relatórios', 'Turnos'],
    rota: '/caixa/fechamentos',
    perm: 'turnos',
    palavras: ['fechamento de caixa', 'turno', 'caixa bateu', 'faltou dinheiro', 'sobrou dinheiro', 'diferença'],
    passos: [
      'Escolha o "Período" e, se quiser, a situação ("Bateu", "Faltou dinheiro", "Sobrou dinheiro").',
      'Na linha do turno, clique em "Ver fechamento": abertura, esperado, contado e a diferença por forma de pagamento.',
      '"Exportar CSV" baixa a lista.',
    ],
    botoes: ['Período', 'Bateu', 'Faltou dinheiro', 'Sobrou dinheiro', 'Ver fechamento', 'Exportar CSV'],
    imagem: ['Relatórios › Turnos, no menu', 'o "Período"', 'as situações, começando por "Bateu"'],
    notas: ['Só o presidente e o gerente abrem esta tela.'],
  },
  {
    id: 'relatorios-de-vendas',
    titulo: 'Relatórios de vendas (por período, canal, caixa, estoque)',
    caminho: ['Relatórios', 'Relatórios de vendas'],
    rota: '/relatorios',
    perm: 'relatorios_vendas',
    palavras: ['relatório', 'relatórios', 'vendas do mês', 'faturamento', 'período', 'exportar vendas'],
    passos: [
      'Escolha a aba: "Vendas", "Balcão / Salão", "Delivery", "Turnos / Caixa", "Estoque", "Produção" e outras.',
      'No "Período", escolha um atalho (hoje, ontem, 7 ou 30 dias, este mês…) ou "Personalizado" com as datas.',
      'Se quiser, "Só uma faixa de horário"; com mais de uma loja, o presidente pode "Somar todas as lojas". Clique em "Atualizar".',
    ],
    botoes: ['Vendas', 'Balcão / Salão', 'Delivery', 'Turnos / Caixa', 'Estoque', 'Produção', 'Período', 'Personalizado', 'Só uma faixa de horário', 'Somar todas as lojas', 'Atualizar'],
    imagem: ['Relatórios › Relatórios de vendas, no menu', 'a aba "Vendas" (as outras ao lado)', 'o "Período"', 'o botão "Atualizar"'],
  },
  {
    id: 'cancelamentos-de-itens',
    titulo: 'Ver os itens cancelados (retirados) de comandas',
    caminho: ['Relatórios', 'Cancelamentos de itens'],
    rota: '/vendas/remocoes',
    perm: 'cancelamentos',
    palavras: ['item cancelado', 'itens retirados', 'cancelamento de item', 'retirou da comanda', 'justificativa', 'mesa'],
    passos: [
      'Escolha o "Período" e clique em "Atualizar".',
      'Filtre por "Sem justificativa" ou "Com justificativa" e busque pelo item ou por quem retirou.',
      '"Exportar CSV" baixa a lista.',
    ],
    botoes: ['Período', 'Atualizar', 'Sem justificativa', 'Com justificativa', 'Exportar CSV'],
    imagem: ['Relatórios › Cancelamentos de itens, no menu', 'o "Período"', 'o botão "Atualizar"', 'a situação "Sem justificativa"'],
    notas: ['Mostra os itens retirados de comandas de mesa depois de lançados, com quem retirou e a justificativa, até 300 linhas.'],
  },
  {
    id: 'auditoria',
    titulo: 'Auditoria: quem fez o quê no sistema',
    caminho: ['Auditoria'],
    rota: '/auditoria',
    perm: 'auditoria',
    palavras: ['auditoria', 'quem fez', 'quem alterou', 'quem mudou o preço', 'quem mexeu', 'histórico de ações', 'registro', 'log'],
    passos: ['Use "Buscar" (usuário, ação ou detalhe), o período ("De" e "Até") e os botões de tipo ("Tudo", "Acesso", "Configuração", "Estoque"…).'],
    botoes: ['Buscar', 'De', 'Até', 'Tudo', 'Acesso', 'Configuração', 'Estoque'],
    imagem: ['Auditoria, no menu', 'o campo "Buscar"', 'o período ("De" e "Até")', 'os filtros por tipo, começando por "Tudo"'],
    notas: ['Só o presidente e o gerente veem. Os registros não se editam nem se apagam; a tela mostra os 300 mais recentes do filtro.'],
  },

  // ── Estoque ──
  {
    id: 'produto-do-estoque',
    titulo: 'Cadastrar um produto (insumo) do estoque',
    caminho: ['Estoque'],
    rota: '/operacao',
    perm: 'estoque',
    palavras: ['insumo', 'produto do estoque', 'cadastrar insumo', 'matéria-prima', 'estoque mínimo', 'unidade'],
    passos: [
      'Abra a aba "Produtos" e clique em "Novo produto".',
      'Preencha "Nome do produto", "Unidade principal" e o estoque mínimo; se quiser, a categoria, os fornecedores e a validade.',
      'Clique em "Cadastrar produto".',
    ],
    botoes: ['Produtos', 'Novo produto', 'Nome do produto', 'Unidade principal', 'Cadastrar produto', 'Importar'],
    imagem: ['Estoque, no menu', 'a aba "Produtos"', 'o botão "Novo produto"', 'o botão "Importar"'],
    notas: ['Importar por planilha ("Importar") e excluir são só da gestão.'],
    veja: ['produto-do-cardapio'],
  },
  {
    id: 'contagem',
    titulo: 'Fazer uma contagem de estoque',
    caminho: ['Estoque'],
    rota: '/operacao',
    perm: 'estoque',
    palavras: ['contagem', 'contar estoque', 'inventário', 'balanço', 'ajustar estoque', 'conferir estoque'],
    passos: [
      'Abra a aba "Contagem". Se ainda não há lista, clique em "Nova lista", escolha os produtos e a recorrência e clique em "Criar lista".',
      'Na lista, clique em "Contar" e digite o contado de cada produto.',
      'Deixe marcado "Ajustar o estoque pela contagem (lança a diferença)" para corrigir o estoque e clique em "Salvar contagem".',
    ],
    botoes: ['Contagem', 'Nova lista', 'Criar lista', 'Contar', 'Ajustar o estoque pela contagem (lança a diferença)', 'Salvar contagem'],
    imagem: ['Estoque, no menu', 'a aba "Contagem"', 'o botão "Nova lista"'],
    notas: ['A tela avisa os produtos que tiveram venda ou produção desde que a contagem abriu.'],
  },
  {
    id: 'desperdicio',
    titulo: 'Registrar um desperdício',
    caminho: ['Estoque'],
    rota: '/operacao',
    perm: 'estoque',
    palavras: ['desperdício', 'perda', 'jogar fora', 'estragou', 'quebra', 'venceu'],
    passos: [
      'Abra a aba "Desperdício" e clique em "Registrar desperdício".',
      'Preencha a "Descrição"; para baixar do estoque, escolha o produto e a "Quantidade". O motivo e a foto completam o registro.',
      'Clique em "Registrar desperdício".',
    ],
    botoes: ['Desperdício', 'Registrar desperdício', 'Descrição', 'Quantidade'],
    imagem: ['Estoque, no menu', 'a aba "Desperdício"', 'o botão "Registrar desperdício"'],
    notas: [
      'Com o produto, o desperdício baixa o estoque e entra no CMV.',
      'Registrar pede a permissão de desperdício no perfil.',
      'Registro de desperdício não se edita nem se apaga; lançamento errado se corrige com um ajuste no produto.',
    ],
  },
  {
    id: 'etiqueta-de-validade',
    titulo: 'Imprimir etiqueta de validade',
    caminho: ['Estoque'],
    rota: '/operacao',
    perm: 'estoque',
    palavras: ['etiqueta', 'validade', 'imprimir etiqueta', 'data de validade', 'pvps', 'aberto'],
    passos: [
      'Abra a aba "Etiquetas" e clique em "Gerar etiqueta".',
      'Escolha o produto, se é "Novo (fechado)" ou "Usado (aberto)", a quantidade e a data de fabricação.',
      'Clique em "Gerar e imprimir".',
    ],
    botoes: ['Etiquetas', 'Gerar etiqueta', 'Novo (fechado)', 'Usado (aberto)', 'Gerar e imprimir', 'Modelo'],
    imagem: ['Estoque, no menu', 'a aba "Etiquetas"', 'o botão "Gerar etiqueta"'],
    notas: ['Só aparece produto que controla validade.', 'O desenho da etiqueta fica em "Modelo", na mesma aba.'],
  },
  {
    id: 'compra-e-recebimento',
    titulo: 'Pedido de compra ao fornecedor e recebimento da mercadoria',
    caminho: ['Estoque'],
    rota: '/operacao',
    perm: 'estoque',
    palavras: ['compra', 'pedido de compra', 'fornecedor', 'recebimento', 'receber mercadoria', 'nota do fornecedor', 'chegou mercadoria'],
    passos: [
      'Abra a aba "Pedidos" e clique em "Novo pedido"; "Sugerir do estoque baixo" preenche com o que está faltando.',
      'Escolha o fornecedor e os produtos e clique em "Criar pedido". Dá para mandar ao fornecedor por e-mail ou WhatsApp.',
      'Quando a mercadoria chegar, clique em "Conferir e receber" e marque o que chegou, com o valor e a validade.',
      'Clique em "Confirmar recebimento".',
    ],
    botoes: ['Pedidos', 'Novo pedido', 'Sugerir do estoque baixo', 'Criar pedido', 'Conferir e receber', 'Confirmar recebimento', 'Recebimento', 'Nota avulsa'],
    imagem: ['Estoque, no menu', 'a aba "Pedidos"', 'o botão "Novo pedido"'],
    notas: [
      'O que ficar sem marcar é registrado como não veio.',
      'O recebimento gera a conta a pagar do fornecedor pelo valor conferido e não se desfaz por aqui.',
      'Nota sem pedido: aba "Recebimento", "Nota avulsa".',
    ],
  },

  // ── Cadastros ──
  {
    id: 'cadastrar-colaborador',
    titulo: 'Cadastrar um colaborador (com usuário, senha e PIN)',
    caminho: ['Cadastros'],
    rota: '/cadastros',
    perm: 'cadastros',
    palavras: ['colaborador', 'funcionário', 'cadastrar funcionário', 'usuário', 'senha', 'pin', 'novo funcionário'],
    passos: [
      'Toque no cartão "Colaboradores".',
      'Preencha o "Nome", as funções, o "Usuário de acesso (apelido, sem espaço)" e a senha. O PIN do terminal de ponto e o celular são opcionais.',
      'Clique em "Adicionar".',
    ],
    botoes: ['Colaboradores', 'Nome', 'Usuário de acesso (apelido, sem espaço)', 'Adicionar'],
    imagem: ['Cadastros, no menu', 'o cartão "Colaboradores"'],
    notas: ['O gerente cria colaborador de supervisão e de execução; o presidente, de qualquer nível.', 'O perfil e o acesso pela internet se ajustam nos acessos.'],
    veja: ['acesso-da-pessoa'],
  },
  {
    id: 'cadastrar-entregador',
    titulo: 'Cadastrar um entregador (motoboy)',
    caminho: ['Cadastros'],
    rota: '/cadastros',
    perm: 'cadastros',
    palavras: ['entregador', 'motoboy', 'cadastrar entregador', 'motoqueiro', 'novo entregador'],
    passos: [
      'Se ainda não existe, abra o cartão "Funções" e crie uma função com a palavra entregador no nome.',
      'Abra o cartão "Colaboradores", preencha o nome, escolha a função de entregador e preencha o usuário de acesso e o celular (o WhatsApp do aviso de chegada).',
      'Clique em "Adicionar".',
    ],
    botoes: ['Funções', 'Colaboradores', 'Adicionar'],
    imagem: ['Cadastros, no menu', 'o cartão "Funções" (a função com entregador no nome)', 'o cartão "Colaboradores"'],
    notas: ['O entregador é um colaborador com a função de entregador: é assim que ele aparece no delivery.'],
    veja: ['pagamento-entregador'],
  },
  {
    id: 'produto-do-cardapio',
    titulo: 'Cadastrar um produto do cardápio, com categoria, tamanhos e adicionais',
    caminho: ['Cadastros'],
    rota: '/cadastros',
    perm: 'cadastros',
    palavras: ['produto do cardápio', 'cadastrar produto', 'novo produto', 'cardápio', 'categoria', 'adicional', 'complemento', 'opcional', 'variação', 'tamanho'],
    passos: [
      'Toque no cartão "Cardápio" e clique em "＋ Novo produto".',
      'Preencha "Nome", "Categoria *", o preço de venda e o "Código / SKU (PDV)", que liga o produto ao iFood e à 99.',
      'Clique em "Cadastrar produto".',
      'Para opcionais e adicionais, abra a aba "Complementos" do produto salvo, crie o grupo em "Adicionar grupo" e as opções em "＋ opção".',
    ],
    botoes: ['Cardápio', '＋ Novo produto', 'Nome', 'Categoria *', 'Código / SKU (PDV)', 'Cadastrar produto', 'Complementos', 'Adicionar grupo', '＋ opção', 'Categorias', '＋ Adicionar'],
    imagem: ['Cadastros, no menu', 'o cartão "Cardápio"'],
    notas: ['Categoria nova: na lateral "Categorias", "＋ Adicionar".', 'Depois de criado, o preço muda na gestão do catálogo.'],
    veja: ['preco-no-canal'],
  },

  // ── Escala ──
  {
    id: 'escala',
    titulo: 'Montar a escala (um dia ou a semana em diante)',
    caminho: ['Escalas'],
    rota: '/escala',
    perm: 'escalas',
    palavras: ['escala', 'montar escala', 'turno', 'folga', 'jornada', 'feriado', 'quem trabalha'],
    passos: [
      'Clique em "Gerar escala" (ou na célula da vaga no dia).',
      'Escolha o "Colaborador" e a "Vaga (etiqueta)" e preencha "Entrada" e "Saída".',
      'Em "Recorrência", "1 dia" para um dia só, ou um período (como "1 mês") com os "Dias de folga na semana".',
      'Clique em "Gerar escala".',
    ],
    botoes: ['Gerar escala', 'Colaborador', 'Vaga (etiqueta)', 'Entrada', 'Saída', 'Recorrência', '1 dia', '1 mês', 'Dias de folga na semana', 'Feriado / evento'],
    imagem: ['Escalas, no menu', 'o botão "Gerar escala", no alto da tela'],
    notas: [
      'O gerador monta uma pessoa e uma vaga por vez.',
      'Conflito (a mesma pessoa em dois lugares no mesmo turno) é bloqueado.',
      'Feriado ou evento da loja: "Feriado / evento".',
    ],
  },

  // ── Configurações ──
  {
    id: 'adicionar-impressora',
    titulo: 'Adicionar uma impressora e imprimir um teste',
    caminho: ['Configurações', 'Impressoras e cupons'],
    rota: '/impressao',
    perm: 'impressoras',
    palavras: ['impressora', 'adicionar impressora', 'imprimir teste', 'impressora não imprime', 'ip da impressora', 'usb'],
    passos: [
      'Abra a parte "Impressoras" e clique em "Impressora".',
      'Preencha "Nome da impressora", o "Direcionamento" (caixa, cozinha, os dois ou etiqueta) e a "Conexão": "IP" e "Porta" na rede, ou "Nome no Windows" no USB.',
      'Clique em "Salvar". Para testar, "Imprimir teste" na linha da impressora.',
    ],
    botoes: ['Impressoras', 'Impressora', 'Nome da impressora', 'Direcionamento', 'Conexão', 'IP', 'Porta', 'Nome no Windows', 'Salvar', 'Imprimir teste'],
    imagem: ['Configurações › Impressoras e cupons, no menu', 'a parte "Impressoras"', 'o botão "Impressora"'],
    notas: ['Com o servidor da loja ligado, a página de teste sai em segundos.'],
    veja: ['onde-cada-documento-sai'],
  },
  {
    id: 'onde-cada-documento-sai',
    titulo: 'Escolher em qual impressora sai cada via',
    caminho: ['Configurações', 'Impressoras e cupons'],
    rota: '/impressao',
    perm: 'impressoras',
    palavras: ['onde sai', 'via do cliente', 'via do delivery', 'comanda do entregador', 'vias', 'impressora errada'],
    passos: [
      'Abra a parte "Onde cada documento sai".',
      'Para cada documento ("Via do cliente", "Via do delivery", "Via da retirada", "Comanda do entregador"), marque as impressoras e o número de vias.',
      'Clique em "Salvar alterações".',
    ],
    botoes: ['Onde cada documento sai', 'Via do cliente', 'Via do delivery', 'Via da retirada', 'Comanda do entregador', 'Salvar alterações'],
    imagem: ['Configurações › Impressoras e cupons, no menu', 'a parte "Onde cada documento sai"'],
    notas: ['Documento sem escolha sai em todas as impressoras de cupom.', 'Só o presidente e o gerente mudam.'],
  },
  {
    id: 'rota-da-cozinha',
    titulo: 'Mudar a ordem das estações da cozinha (KDS)',
    caminho: ['Configurações', 'Rota da cozinha'],
    rota: '/rota-cozinha',
    perm: 'producao_kds',
    modulo: 'kds',
    palavras: ['rota da cozinha', 'estação', 'ordem dos kds', 'kds', 'despacho', 'fluxo da cozinha'],
    passos: [
      'Clique em "Editar a ordem".',
      'Mova cada KDS com "Antes", "Depois" ou "Junto com…" (ou arraste); "Quando ficar pronto, vai para" diz a etapa seguinte.',
      'Clique em "Salvar a ordem" e confirme.',
    ],
    botoes: ['Editar a ordem', 'Antes', 'Depois', 'Junto com…', 'Quando ficar pronto, vai para', 'Salvar a ordem'],
    imagem: ['Configurações › Rota da cozinha, no menu', 'o botão "Editar a ordem"'],
    notas: ['O despacho só pode ficar na última etapa.', 'Nada muda na cozinha até salvar.'],
    veja: ['produtos-do-kds'],
  },
  {
    id: 'produtos-do-kds',
    titulo: 'Escolher os produtos que aparecem em cada KDS',
    caminho: ['Configurações', 'Rota da cozinha'],
    rota: '/rota-cozinha',
    perm: 'producao_kds',
    modulo: 'kds',
    palavras: ['produtos do kds', 'o que aparece no kds', 'kds', 'estação de preparo', 'kds de despacho', 'produto não aparece na cozinha'],
    passos: [
      'Na rota, clique no botão de editar do KDS: abre "Configurar este KDS".',
      'Em "Lugar no fluxo", escolha "Estação de preparo" ou "KDS de despacho"; em "Produtos que aparecem aqui", marque os produtos.',
      'Clique em "Salvar ajustes deste KDS".',
    ],
    botoes: ['Configurar este KDS', 'Lugar no fluxo', 'Estação de preparo', 'KDS de despacho', 'Produtos que aparecem aqui', 'Salvar ajustes deste KDS', 'Vai para produção (KDS)'],
    imagem: ['"Lugar no fluxo" e "Quando ficar pronto, vai para", na gaveta "Configurar este KDS"', '"Produtos que aparecem aqui"', 'o botão "Salvar ajustes deste KDS"'],
    notas: ['O produto só vai à cozinha com "Vai para produção (KDS)" ligado no cadastro dele.'],
  },
  {
    id: 'cores-do-kds',
    titulo: 'Cores do KDS por tempo, etapas e senha de atendimento',
    caminho: ['Configurações', 'Produção & KDS'],
    rota: '/producao-config',
    perm: 'producao_kds',
    modulo: 'kds',
    palavras: ['cor do kds', 'cores do kds', 'verde', 'amarelo', 'atrasado', 'senha de atendimento', 'em preparo'],
    passos: [
      'Na parte "Ajustes do KDS", em "Cores do KDS por tempo", ajuste "Verde até" e "Amarelo até".',
      'Ali também ficam as "Etapas do pedido", a "Senha de atendimento" e a "Impressão da produção".',
      'Clique em "Salvar alterações".',
    ],
    botoes: ['Ajustes do KDS', 'Cores do KDS por tempo', 'Verde até', 'Amarelo até', 'Etapas do pedido', 'Senha de atendimento', 'Impressão da produção', 'Salvar alterações'],
    imagem: ['Configurações › Produção & KDS, no menu', 'o campo "Verde até"', 'o campo "Amarelo até"'],
    notas: ['O verde precisa terminar antes do amarelo.'],
  },
  {
    id: 'permissoes-do-perfil',
    titulo: 'Mudar o que um perfil pode fazer (permissões)',
    caminho: ['Configurações', 'Acessos & perfis'],
    rota: '/config/acessos',
    perm: 'acessos',
    palavras: ['permissão', 'permissões', 'perfil', 'liberar acesso', 'o que o gerente pode'],
    passos: [
      'Abra a parte "Perfis" e, no perfil, clique em "Permissões".',
      'Ligue ou desligue o que o perfil pode ("Buscar permissão" acha mais rápido).',
      'Clique em "Salvar perfil". Perfil novo: "Novo perfil", o nome e o nível, e "Adicionar perfil".',
    ],
    botoes: ['Perfis', 'Permissões', 'Buscar permissão', 'Salvar perfil', 'Novo perfil', 'Adicionar perfil'],
    imagem: ['Configurações › Acessos & perfis, no menu', 'a parte "Perfis" (cada perfil da lista tem o botão "Permissões")', 'o botão "Novo perfil"'],
    notas: ['A tela é só do presidente.', 'As mudanças valem no próximo login do colaborador.'],
  },
  {
    id: 'acesso-da-pessoa',
    titulo: 'Dar, mudar ou tirar o acesso de um colaborador',
    caminho: ['Configurações', 'Acessos & perfis'],
    rota: '/config/acessos',
    perm: 'acessos',
    palavras: ['acesso', 'bloquear', 'desbloquear', 'perfil do colaborador', 'app do colaborador', 'acesso pela internet', 'login', 'funcionário que saiu', 'desligado'],
    passos: [
      'Abra a parte "Pessoas" e, na pessoa, clique em "Acesso".',
      'Escolha o "Perfil" e ligue "App do colaborador" (libera o PIN) ou "Acesso pela internet (nuvem)".',
      'Clique em "Salvar". Para tirar o acesso na hora, "Bloquear".',
    ],
    botoes: ['Pessoas', 'Acesso', 'Perfil', 'App do colaborador', 'Acesso pela internet (nuvem)', 'Salvar', 'Bloquear'],
    imagem: ['Configurações › Acessos & perfis, no menu', 'a parte "Pessoas" (cada pessoa da lista tem o botão "Acesso")'],
    notas: [
      'A tela é só do presidente.',
      'O usuário, a senha e o PIN nascem no cadastro do colaborador.',
      'Por padrão, só o presidente entra pela nuvem; os demais usam o servidor da loja.',
    ],
    veja: ['cadastrar-colaborador'],
  },

  // ── Financeiro ──
  {
    id: 'nota-fiscal',
    titulo: 'Ver, consultar e cancelar uma nota fiscal (NFC-e)',
    caminho: ['Financeiro', 'Notas fiscais'],
    rota: '/notas',
    perm: 'fiscal',
    palavras: ['nota fiscal', 'nfc-e', 'nfce', 'cancelar nota', 'sefaz', 'contingência', 'cupom fiscal'],
    passos: [
      'Ache a nota em "Últimas notas".',
      'Para cancelar uma nota autorizada, clique no botão de cancelar (ele mostra os minutos que faltam) e escreva a justificativa, com 15 caracteres ou mais.',
      'Nota pendente: "Consultar na SEFAZ". Em contingência: "Tentar transmitir agora".',
    ],
    botoes: ['Últimas notas', 'Consultar na SEFAZ', 'Tentar transmitir agora'],
    imagem: ['Financeiro › Notas fiscais, no menu', 'a lista "Últimas notas"'],
    notas: ['Cancelar é só para o presidente e o gerente, até 30 minutos depois da autorização.'],
    veja: ['configurar-nota'],
  },
  {
    id: 'configurar-nota',
    titulo: 'Configurar a nota fiscal: dados, certificado digital e CSC',
    caminho: ['Financeiro', 'Configuração'],
    rota: '/fiscal-config',
    perm: 'fiscal_config',
    palavras: ['configurar nota', 'certificado digital', 'certificado a1', 'csc', 'emitir nota', 'fiscal', 'série'],
    passos: [
      'Preencha os dados da empresa e da nota e clique em "Salvar configuração" (no fim da página).',
      'Em "Certificado A1 (.pfx)", escolha o arquivo, digite a "Senha do certificado" e clique em "Enviar certificado". "Testar certificado" e "Testar conexão com a SEFAZ" conferem.',
      'No CSC, escolha o "Ambiente", preencha "ID do CSC" e o código e clique em "Salvar CSC".',
    ],
    botoes: ['Salvar configuração', 'Certificado A1 (.pfx)', 'Senha do certificado', 'Enviar certificado', 'Testar certificado', 'Testar conexão com a SEFAZ', 'Ambiente', 'ID do CSC', 'Salvar CSC'],
    imagem: ['Financeiro › Configuração, no menu', 'o "Ambiente" (Homologação para testar, Produção para valer)', 'o "Regime tributário" (os dados da empresa seguem abaixo)'],
    notas: ['Só o presidente abre, e a configuração só muda pela nuvem, não no servidor da loja.', 'O certificado e o CSC não aparecem de volta depois de salvos.'],
  },

  // ── Atendimento ──
  {
    id: 'atendimento',
    titulo: 'Pegar, passar e resolver um caso do Atendimento',
    caminho: ['Atendimento'],
    rota: '/atendimento',
    perm: 'pedidos',
    palavras: ['atendimento', 'caso', 'reclamação', 'pegar caso', 'passar caso', 'resolver caso', 'cliente esperando'],
    passos: [
      'Toque no caso na fila e clique em "Pegar para mim".',
      'Se precisa da resposta do cliente, "Aguardar o cliente".',
      'Para entregar a outra pessoa, "Passar", escolha "Para quem" e confirme.',
      'Para fechar, "Resolver" e confirme; a conversa volta para o robô.',
    ],
    botoes: ['Pegar para mim', 'Aguardar o cliente', 'Passar', 'Para quem', 'Resolver', 'Responder ao pedido de cancelamento'],
    imagem: ['Atendimento, no menu', 'a situação "Abertos" (e as outras ao lado)', 'a fila dos casos'],
    notas: [
      'Caso de cancelamento tem o botão próprio "Responder ao pedido de cancelamento".',
      'Disputa do iFood e pedido da 99 não têm aguardar nem resolver: seguem o prazo da plataforma.',
    ],
  },

  // ── Mister ──
  {
    id: 'mister-ligar-whatsapp',
    titulo: 'Ligar o meu WhatsApp ao Mister',
    caminho: ['Mister'],
    rota: '/mister',
    perm: null,
    modulo: 'mister',
    palavras: ['ligar whatsapp ao mister', 'mister', 'conectar ao mister', 'código do mister', 'desligar mister', 'parar avisos'],
    passos: [
      'Abra a parte "Pessoas" e, na sua linha, clique em "Ligar o meu WhatsApp".',
      'No seu celular, aponte a câmera para o código (ou abra o link) e toque em enviar no WhatsApp.',
      'O código vale 10 minutos e uma vez só; vencido, "Gerar outro código". Para desligar, "Desligar".',
    ],
    botoes: ['Pessoas', 'Ligar o meu WhatsApp', 'Gerar outro código', 'Desligar'],
    imagem: ['Mister, no menu', 'o botão "Ligar o meu WhatsApp", na sua linha'],
    notas: ['Só a própria pessoa liga o seu número, entrando com o usuário dela.', 'Mandar PARAR AVISOS no WhatsApp suspende os avisos; VOLTAR AVISOS volta.'],
  },
  {
    id: 'mister-chave-de-ia',
    titulo: 'Colocar a chave de IA do Mister',
    caminho: ['Mister'],
    rota: '/mister',
    perm: null,
    modulo: 'mister',
    palavras: ['chave de ia', 'chave da anthropic', 'api key', 'inteligência artificial', 'uso da ia', 'custo da ia'],
    passos: [
      'Abra a parte "IA e uso"; no cartão "Chave de IA", cole a chave em "Chave de API".',
      '"Testar conexão" confere; "Salvar chave" guarda.',
      'O passo a passo para criar a chave está em "Como criar a chave, passo a passo".',
    ],
    botoes: ['IA e uso', 'Chave de IA', 'Chave de API', 'Testar conexão', 'Salvar chave', 'Como criar a chave, passo a passo'],
    imagem: ['Mister, no menu', 'a parte "IA e uso"', 'o campo "Chave de API"', 'o botão "Salvar chave"'],
    notas: ['Só o presidente cadastra ou troca a chave. Ela fica cifrada e não aparece de novo.', 'Na mesma parte, o uso da IA mostra o gasto por período.'],
  },
  {
    id: 'mister-resumo-e-avisos',
    titulo: 'Ligar o resumo do dia e escolher para onde vai cada aviso do Mister',
    caminho: ['Mister'],
    rota: '/mister',
    perm: null,
    modulo: 'mister',
    palavras: ['resumo do dia', 'resumo da semana', 'relatório do mister', 'avisos do mister', 'para onde vai o aviso', 'horário do resumo'],
    passos: [
      'Abra a parte "Avisos e relatórios" e vá ao grupo "Relatórios" (fica no fim; digitar a palavra resumo em "Buscar" traz ele para cima).',
      'Ligue o resumo do dia (ou o da semana) e escolha o horário.',
      'Clique em "Salvar alterações". Para mudar o destino de um aviso, "Mudar" nele.',
    ],
    botoes: ['Avisos e relatórios', 'Relatórios', 'Buscar', 'Salvar alterações', 'Mudar'],
    imagem: ['Mister, no menu', 'a parte "Avisos e relatórios"', 'o campo "Buscar", com "resumo" digitado', 'o grupo "Relatórios"'],
    notas: ['Só o presidente muda. O resumo chega a quem ligou o próprio WhatsApp ao Mister e falou com ele nas últimas 24 horas.'],
  },

  // ── M6k, lote 1: as telas do dia a dia que ainda não tinham assunto (no fim da lista: o desempate da busca é pela
  //    posição, e os assuntos de antes continuam na frente) ──
  {
    id: 'painel-do-dia',
    titulo: 'Ver o resumo do dia no Dashboard (vendas, tarefas, escala e ponto)',
    caminho: ['Dashboard'],
    rota: '/painel',
    perm: 'dashboard',
    palavras: ['dashboard', 'painel', 'resumo do dia', 'visão geral', 'como está o dia', 'faturamento de hoje', 'vendas de hoje', 'ticket médio', 'linha do tempo', 'ponto de hoje'],
    passos: [
      'No alto ficam os números de hoje: "Faturamento hoje", "Ticket médio", "Vendas hoje", "Escalados hoje", "Delivery aberto", "Estoque crítico" e outros.',
      'A "Linha do tempo operacional" mostra quem está escalado e o que deveria estar em execução agora; "Alinhamento" muda a grade.',
      '"Gerenciamento de tarefas" lista as tarefas em atraso: toque numa para concluir. O botão de mais, "Nova tarefa", cria uma tarefa para hoje.',
      '"Ponto de hoje" mostra quem está trabalhando agora; "Gerenciar →" abre o ponto.',
    ],
    botoes: ['Faturamento hoje', 'Ticket médio', 'Vendas hoje', 'Escalados hoje', 'Delivery aberto', 'Estoque crítico', 'Linha do tempo operacional', 'Alinhamento', 'Gerenciamento de tarefas', 'Nova tarefa', 'Ponto de hoje', 'Gerenciar →'],
    imagem: ['Dashboard, no menu', 'o "Faturamento hoje" (os números do dia ficam nesta faixa e na de baixo)', 'a "Linha do tempo operacional"', 'o botão de mais, "Nova tarefa"'],
    notas: ['A tela é do presidente e do gerente. O faturamento e o ticket médio só aparecem para quem vê valores em reais.'],
    veja: ['criar-tarefa', 'escala'],
  },
  {
    id: 'criar-tarefa',
    titulo: 'Criar uma tarefa para hoje e marcar como concluída',
    caminho: ['Tarefas', 'Tarefas'],
    rota: '/meu-dia',
    perm: 'meu_dia',
    palavras: ['tarefa', 'tarefas', 'criar tarefa', 'tarefa avulsa', 'tarefa do dia', 'concluir tarefa', 'delegar tarefa', 'responsável pela tarefa', 'tarefa pendente'],
    passos: [
      'Clique em "Nova tarefa", no alto da tela.',
      'Preencha o "Título da tarefa" e escolha a "Função". O "Responsável (opcional)" lista quem está escalado hoje na função; sem ele, a tarefa fica em aberto para a função.',
      'Se quiser, preencha "Horário inicial (opcional)", "Horário final (opcional)" e a "Prioridade". Clique em "Criar tarefa".',
      'Para dar baixa, clique na tarefa da lista e escolha "Concluída", "Parcial" ou "Não concluída" (esta pede o "Motivo da não conclusão").',
    ],
    botoes: ['Nova tarefa', 'Título da tarefa', 'Função', 'Responsável (opcional)', 'Horário inicial (opcional)', 'Horário final (opcional)', 'Prioridade', 'Criar tarefa', 'Concluída', 'Parcial', 'Não concluída', 'Motivo da não conclusão'],
    imagem: ['Tarefas › Tarefas, no menu', 'o botão "Nova tarefa", no alto da tela', 'uma tarefa da lista (um clique abre para concluir)'],
    notas: [
      'A lista é a das tarefas de hoje, montadas a partir da escala.',
      'Editar e excluir uma tarefa ficam com quem tem o nível igual ou acima do de quem a criou.',
    ],
    veja: ['escala', 'painel-do-dia'],
  },
  {
    id: 'mural',
    titulo: 'Publicar um comunicado no mural da equipe e abrir a pesquisa de clima',
    caminho: ['Mural & clima'],
    rota: '/mural',
    perm: 'mural',
    palavras: ['mural', 'comunicado', 'recado para a equipe', 'avisar os funcionários', 'publicar no mural', 'fixar comunicado', 'pesquisa de clima', 'clima da equipe', 'confirmar leitura'],
    passos: [
      'Em "Publicar comunicado", preencha o "Título" e, se quiser, o "Detalhe (opcional)".',
      'Em "Público", escolha "Esta loja", "Um setor" (e o "Setor") ou "Toda a rede".',
      'Marque "Fixar no topo" para ele ficar em cima e clique em "Publicar".',
      'Cada comunicado mostra quantos leram; quem lê clica em "Confirmar leitura".',
      'Pesquisa de clima: "Abrir pesquisa de clima" e, quando quiser, "Encerrar pesquisa". As respostas são anônimas.',
    ],
    botoes: ['Publicar comunicado', 'Título', 'Detalhe (opcional)', 'Público', 'Esta loja', 'Um setor', 'Setor', 'Toda a rede', 'Fixar no topo', 'Publicar', 'Confirmar leitura', 'Abrir pesquisa de clima', 'Encerrar pesquisa'],
    imagem: ['Mural & clima, no menu', 'o campo "Título", em "Publicar comunicado"', 'o "Público" (esta loja, um setor ou toda a rede)', 'o botão "Publicar"'],
    notas: [
      'Publicar e abrir a pesquisa são do presidente, do gerente e da supervisão; "Toda a rede" só aparece para o presidente.',
      'O resultado da pesquisa aparece só depois de um mínimo de respostas, para não identificar ninguém.',
    ],
  },
  {
    id: 'clientes',
    titulo: 'Ver os clientes, quem parou de pedir e o histórico de pedidos de cada um',
    caminho: ['Delivery', 'Clientes'],
    rota: '/clientes',
    perm: 'delivery',
    palavras: ['clientes', 'cliente', 'base de clientes', 'histórico do cliente', 'parou de pedir', 'pararam de pedir', 'sem pedir', 'clientes inativos', 'clientes sumidos', 'campeões', 'exportar clientes', 'importar contatos', 'telefone do cliente'],
    passos: [
      'Escolha o grupo no alto: "Todos", "No mês", "Últimos 30 dias", "+30d sem pedir", "+60d sem pedir" ou "Campeões" (3 pedidos ou mais em 30 dias).',
      'Busque pelo nome ou pelo telefone; filtre por canal ("Todos os canais") ou por bairro ("Todos os bairros").',
      'Clique no cliente: abre o "Histórico de pedidos", com o total gasto. Ali fica também "Não enviar campanhas a este cliente".',
      'Para baixar a lista, "CSV", "Excel" ou "PDF" (marque os clientes para baixar só eles). "Importar contatos" traz contatos do celular ou de uma planilha.',
    ],
    botoes: ['Todos', 'No mês', 'Últimos 30 dias', '+30d sem pedir', '+60d sem pedir', 'Campeões', 'Todos os canais', 'Todos os bairros', 'Histórico de pedidos', 'Não enviar campanhas a este cliente', 'CSV', 'Excel', 'PDF', 'Importar contatos'],
    imagem: ['Delivery › Clientes, no menu', 'o grupo "+30d sem pedir" (os outros grupos ficam ao lado)', 'a busca pelo nome ou telefone', 'um cliente da lista (um clique abre o histórico)'],
    notas: [
      'A base junta o mesmo telefone de todos os canais de delivery.',
      'Exportar e importar são do presidente e de quem tem essas permissões no perfil.',
    ],
    veja: ['campanha-whatsapp'],
  },
  {
    id: 'campanha-whatsapp',
    titulo: 'Criar uma campanha de WhatsApp para os clientes',
    caminho: ['Delivery', 'Marketing'],
    rota: '/marketing',
    perm: 'delivery',
    palavras: ['campanha', 'campanhas', 'criar campanha', 'disparo', 'mensagem em massa', 'mandar promoção', 'marketing', 'divulgar', 'trazer clientes de volta', 'lista de exclusão'],
    passos: [
      'Na aba "Campanhas", clique em "＋ Nova campanha" (pede um número de WhatsApp conectado).',
      'Escolha o "Tipo de campanha" (como "Cupom de desconto" ou "Recuperar cliente") e o "Público" (como "+30 dias sem pedir"); a tela mostra quantos vão receber.',
      'Escreva a "Mensagem" e, se quiser, ponha uma "＋ Imagem". A "Prévia (como o cliente vê)" mostra o balão.',
      'Confira o "Ritmo e limites de envio (anti-bloqueio)" e, se quiser, "Agendar (dias e horário)". "Enviar teste" manda só para o seu número.',
      'Clique em "Criar campanha". Na lista, "métricas" mostra o resultado; "pausar" e "retomar" seguram o envio.',
    ],
    botoes: ['Campanhas', '＋ Nova campanha', 'Tipo de campanha', 'Cupom de desconto', 'Recuperar cliente', 'Público', '+30 dias sem pedir', 'Mensagem', '＋ Imagem', 'Prévia (como o cliente vê)', 'Ritmo e limites de envio (anti-bloqueio)', 'Agendar (dias e horário)', 'Enviar teste', 'Criar campanha', 'métricas', 'pausar', 'retomar', 'Modelos (API oficial)', 'Automáticas'],
    imagem: ['Delivery › Marketing, no menu', 'a aba "Campanhas"', 'o botão "＋ Nova campanha"', '"métricas" de uma campanha da lista'],
    notas: [
      'A campanha sai pelo número de marketing, aos poucos, e nunca para quem respondeu SAIR.',
      'Na API oficial da Meta, a campanha usa um modelo aprovado, na aba "Modelos (API oficial)". As mensagens que saem sozinhas ficam na aba "Automáticas".',
    ],
    veja: ['clientes', 'whatsapp-da-loja'],
  },
  {
    id: 'conta-a-pagar',
    titulo: 'Lançar uma conta a pagar (boleto, aluguel, fornecedor) e dar baixa',
    caminho: ['Financeiro', 'Contas a pagar'],
    rota: '/financeiro',
    perm: 'financeiro',
    palavras: ['contas a pagar', 'conta a pagar', 'boleto', 'pagar conta', 'pagar boleto', 'lançar conta', 'despesa', 'aluguel', 'vencimento', 'contas a receber'],
    passos: [
      'Em "Nova conta", deixe o "Tipo" em "A pagar" e preencha a "Descrição", o valor e o "Vencimento".',
      'Se a conta repete, escolha a "Recorrência". Se quiser, o "Fornecedor" e a foto em "Comprovante / boleto (opcional)".',
      'Clique em "Cadastrar conta".',
      'Quando pagar, ache a conta na lista "A pagar" e clique em "Pagar". Em "Pagos" ficam as pagas, com "Estornar".',
    ],
    botoes: ['Nova conta', 'Tipo', 'A pagar', 'Descrição', 'Vencimento', 'Recorrência', 'Fornecedor', 'Comprovante / boleto (opcional)', 'Cadastrar conta', 'Pagar', 'Pagos', 'Estornar'],
    imagem: ['Financeiro › Contas a pagar, no menu', 'o campo "Descrição", em "Nova conta"', 'o campo do valor', 'o botão "Cadastrar conta"'],
    notas: [
      'Sem a permissão do financeiro, a tela mostra só as formas de pagamento.',
      'A conta do fornecedor nasce sozinha no recebimento da mercadoria. Excluir deixa a conta cancelada, para a auditoria.',
    ],
    veja: ['compra-e-recebimento'],
  },
  {
    id: 'dados-da-loja',
    titulo: 'Mudar os dados da loja: nome, logo, telefone, endereço e pedido mínimo',
    caminho: ['Configurações', 'Loja'],
    rota: '/loja',
    perm: 'loja',
    soPresidente: true,
    palavras: ['dados da loja', 'nome da loja', 'logo', 'logotipo', 'endereço da loja', 'telefone da loja', 'cnpj', 'instagram', 'pedido mínimo', 'ponto no mapa'],
    passos: [
      'Em "Identidade", mude o "Logo da loja (imagem)", o "Nome do estabelecimento", o "Telefone de contato", o "CPF / CNPJ", o WhatsApp e o Instagram.',
      'Em "Endereço do estabelecimento", digite o "CEP": ao sair do campo, rua, bairro, cidade e UF vêm sozinhos. Confira o "Número".',
      'Em "Ponto da loja no mapa", use "Definir pelo endereço" ou "Usar minha localização": é a base do frete por distância.',
      'O "Pedido mínimo p/ delivery" fica em "Pedidos pelo cardápio". "Buscar" acha um ajuste pelo nome.',
      'Clique em "Salvar alterações", na barra de baixo; "Descartar" desfaz.',
    ],
    botoes: ['Identidade', 'Logo da loja (imagem)', 'Nome do estabelecimento', 'Telefone de contato', 'CPF / CNPJ', 'Endereço do estabelecimento', 'CEP', 'Número', 'Ponto da loja no mapa', 'Definir pelo endereço', 'Usar minha localização', 'Pedido mínimo p/ delivery', 'Pedidos pelo cardápio', 'Buscar', 'Salvar alterações', 'Descartar'],
    imagem: ['Configurações › Loja, no menu', 'o campo "Nome do estabelecimento"', 'o botão "Salvar alterações" (a barra aparece quando algo muda)'],
    notas: ['A tela é só do presidente. Os horários, o frete e a aparência do cardápio ficam nas configurações do delivery.'],
    veja: ['horario', 'taxa-e-area'],
  },
  {
    id: 'equipamentos',
    titulo: 'Cadastrar e parear um equipamento da loja (caixa, KDS, terminal de ponto, TV de senhas)',
    caminho: ['Configurações', 'Equipamentos'],
    rota: '/equipamentos',
    perm: 'servidor',
    palavras: ['equipamento', 'equipamentos', 'aparelho', 'parear', 'pareamento', 'código de pareamento', 'kds', 'terminal de ponto', 'tela de senhas', 'tv de senhas', 'computador da loja'],
    passos: [
      'Clique em "Novo equipamento", escolha o "Tipo" (como "Terminal de PDV (caixa)", "KDS (cozinha)" ou "Tela de senhas (TV)"), dê o "Nome" e clique em "Cadastrar equipamento".',
      'Para parear um caixa, uma estação de impressão ou a TV de senhas, clique em "Gerar código" na linha dele e digite o código no aparelho.',
      'PC novo com impressora: "Novo PC com impressora" faz o cadastro, o código e as impressoras do Windows num passo a passo.',
      'A coluna "Situação" diz se o aparelho está no ar; "Sem responder" e "Nunca conectaram" filtram os que pedem atenção. Na linha, "Configurar" muda e "Revogar" tira o acesso.',
    ],
    botoes: ['Novo equipamento', 'Tipo', 'Terminal de PDV (caixa)', 'KDS (cozinha)', 'Tela de senhas (TV)', 'Nome', 'Cadastrar equipamento', 'Gerar código', 'Novo PC com impressora', 'Situação', 'Sem responder', 'Nunca conectaram', 'Configurar', 'Revogar'],
    imagem: ['Configurações › Equipamentos, no menu', 'o botão "Novo equipamento"', 'o "Gerar código" na linha do caixa', 'a situação "Sem responder"'],
    notas: [
      'Só o presidente e o gerente cadastram e mudam.',
      'Com o servidor da loja ligado, impressora, KDS e estação de impressão se configuram nele.',
    ],
    veja: ['abrir-caixa', 'adicionar-impressora'],
  },

  // ── M6k, lote 2: mais telas do dia a dia (retirada, mesas, avaliações, encomendas, ponto, checklist, formas de pagamento
  //    e unidades) — também no fim da lista, pelo mesmo desempate da busca ──
  {
    id: 'retirada-no-balcao',
    titulo: 'Entregar e cobrar um pedido de retirada ou encomenda no balcão',
    caminho: ['PDV · Balcão', 'Retirada / Encomendas'],
    rota: '/pdv/retirada',
    perm: 'pedidos',
    palavras: ['retirada', 'retirar na loja', 'cliente veio buscar', 'entregar no balcão', 'cobrar retirada', 'avisar pronto', 'cheguei', 'clientes esperando', 'totem'],
    passos: [
      'Os pedidos ficam em colunas pela origem ("Cardápio Regem", "Marketplaces"…). Pedido novo: clique em "Aceitar".',
      'Quando ficar pronto, clique em "Avisar pronto": o pedido fica pronto e, se veio do cardápio Regem, o cliente recebe o aviso no WhatsApp.',
      'Na retirada, clique em "Entregar" (pedido já pago) ou em "Cobrar e entregar": escolha a forma de pagamento e clique em "Confirmar". O valor entra no turno aberto do seu caixa.',
      'Quem avisou que está na loja aparece em "Clientes esperando", no topo: quem espera há mais tempo vem primeiro.',
      'Para cancelar, "Cancelar": escreva o "Motivo" e a "Senha de quem libera" e clique em "Cancelar pedido".',
    ],
    botoes: ['Cardápio Regem', 'Marketplaces', 'Aceitar', 'Avisar pronto', 'Entregar', 'Cobrar e entregar', 'Confirmar', 'Clientes esperando', 'Cancelar', 'Motivo', 'Senha de quem libera', 'Cancelar pedido', 'Abrir turno'],
    imagem: ['PDV · Balcão › Retirada / Encomendas, no menu', 'o botão "Aceitar" do pedido novo', 'o botão "Avisar pronto" do pedido pronto', 'o botão "Cobrar e entregar" (o pedido já pago mostra "Entregar")'],
    notas: ['Para cobrar, o turno do caixa precisa estar aberto: "Abrir turno", no alto da tela.', 'Na 99, confira com o cliente o código de retirada antes de entregar.'],
    veja: ['abrir-caixa', 'encomendas-agenda'],
  },
  {
    id: 'mesa-e-comanda',
    titulo: 'Abrir uma mesa, lançar os itens na comanda e fechar a conta',
    caminho: ['PDV · Balcão', 'Mesas e comandas'],
    rota: '/mesas',
    perm: 'mesas',
    modulo: 'mesas',
    palavras: ['mesa', 'mesas', 'comanda', 'comandas', 'abrir mesa', 'fechar mesa', 'conta da mesa', 'garçom', 'lançar item', 'pulseira', 'qr da mesa'],
    passos: [
      'Em "Abrir mesa", preencha o "Número / nome", escolha o "Modo" ("Comanda única" ou "Comandas por cliente") e clique em "Abrir".',
      'Na mesa, toque nos produtos para lançar na comanda ativa; com tamanho ou adicional, escolha e clique em "Adicionar à mesa".',
      'No modo por cliente, preencha "Nova comanda (cliente/pulseira)" e clique em "Abrir"; toque na comanda para deixá-la ativa.',
      'Para tirar um item, o × ao lado dele pede a justificativa; clique em "Remover".',
      'Escolha a forma em "Pagamento" e clique em "Fechar esta comanda" ou em "Fechar mesa" (fecha todas as comandas).',
    ],
    botoes: ['Abrir mesa', 'Número / nome', 'Modo', 'Comanda única', 'Comandas por cliente', 'Abrir', 'Adicionar à mesa', 'Nova comanda (cliente/pulseira)', 'Remover', 'Pagamento', 'Fechar esta comanda', 'Fechar mesa', '🍽 QR por mesa'],
    imagem: ['PDV · Balcão › Mesas e comandas, no menu', 'o campo "Número / nome", em "Abrir mesa" (o "Modo" fica ao lado)', 'o botão "Abrir"', 'uma mesa aberta (um toque abre a comanda)'],
    notas: ['O item tirado avisa a cozinha e fica no relatório com a justificativa.', 'Em "🍽 QR por mesa", gere o QR de cada mesa (pede o cardápio digital ligado): o pedido do cliente vai direto para a comanda dela.'],
    veja: ['cancelamentos-de-itens', 'formas-de-pagamento'],
  },
  {
    id: 'avaliacoes',
    titulo: 'Ver as notas que os clientes deram aos pedidos (avaliações)',
    caminho: ['Delivery', 'Avaliações'],
    rota: '/delivery/avaliacoes',
    perm: 'delivery',
    palavras: ['avaliação', 'avaliações', 'nota do cliente', 'nota do pedido', 'estrelas', 'nota baixa', 'comentário do cliente', 'o que os clientes acharam', 'satisfação'],
    passos: [
      'Escolha o período: "Hoje", "7 dias" ou "30 dias". No alto ficam a "Nota média", quantos "Avaliaram" e as "Notas" de 1 a 5.',
      'Filtre pela situação (a nota baixa, como "Nota 1 ou 2", "Com comentário" ou "Caso aberto"), busque pelo cliente ou pelo número do pedido e escolha "Por onde" a nota veio.',
      'Clique em "Ver" na linha: abre a nota, "O que mais pesou", o "Comentário" e "O pedido". Com caso aberto, "Abrir no Atendimento".',
    ],
    botoes: ['Hoje', '7 dias', '30 dias', 'Nota média', 'Avaliaram', 'Notas', 'Nota 1 ou 2', 'Com comentário', 'Caso aberto', 'Por onde', 'Ver', 'O que mais pesou', 'Comentário', 'O pedido', 'Abrir no Atendimento', 'Pedir uma nota depois da entrega'],
    imagem: ['Delivery › Avaliações, no menu', 'o período "7 dias" ("Hoje" e "30 dias" ao lado)', 'a situação "Nota 1 ou 2"', 'o "Ver" na linha da avaliação'],
    notas: [
      'As notas são dos pedidos do Regem, dadas pelo WhatsApp oficial ou pela página do pedido. A nota baixa também abre um caso no Atendimento.',
      'O pedido da nota sai com "Pedir uma nota depois da entrega" ligado no robô de atendimento.',
    ],
    veja: ['robo', 'atendimento'],
  },
  {
    id: 'encomendas-agenda',
    titulo: 'Ver a agenda das encomendas: o que entregar e produzir em cada dia',
    caminho: ['Delivery', 'Encomendas · agenda'],
    rota: '/encomendas',
    perm: 'delivery',
    palavras: ['encomenda', 'encomendas', 'agenda', 'pedido agendado', 'pedidos agendados', 'encomenda de amanhã', 'data da encomenda', 'o que produzir', 'bolo'],
    passos: [
      'A agenda junta as encomendas do cardápio pelo dia da entrega ou da retirada, com a hora, o cliente e a situação.',
      'Para ver um dia só, escolha a data em "Filtrar por data"; "Todas" volta para a lista inteira.',
      'Clique em "Ver / atender": no detalhe ficam os itens, o total e as ações ("Reimprimir", "Alterar", "Cancelar").',
    ],
    botoes: ['Filtrar por data', 'Todas', 'Ver / atender', 'Reimprimir', 'Alterar', 'Cancelar'],
    imagem: ['Delivery › Encomendas · agenda, no menu', 'o campo "Filtrar por data"', 'o dia das encomendas', 'o botão "Ver / atender" da encomenda'],
    notas: ['As encomendas também aparecem na tela da retirada do balcão.'],
    veja: ['retirada-no-balcao'],
  },
  {
    id: 'meu-ponto',
    titulo: 'Bater o ponto pelo sistema (entrada, intervalo e saída)',
    caminho: ['Tarefas', 'Meu ponto'],
    rota: '/meu-ponto',
    perm: 'meu_dia',
    palavras: ['bater ponto', 'meu ponto', 'marcar ponto', 'ponto', 'entrada', 'saída', 'intervalo', 'almoço', 'comprovante do ponto'],
    passos: [
      'No cartão "Bater ponto", clique na marcação: "Entrada", "Saída p/ intervalo", "Volta do intervalo" ou "Saída".',
      'O comprovante aparece logo abaixo, com o NSR, a hora e o seu nome.',
      'Em "Marcações de hoje" ficam as marcações do dia.',
    ],
    botoes: ['Bater ponto', 'Entrada', 'Saída p/ intervalo', 'Volta do intervalo', 'Saída', 'Marcações de hoje'],
    imagem: ['Tarefas › Meu ponto, no menu', 'os botões da marcação: "Entrada", "Saída p/ intervalo", "Volta do intervalo" e "Saída"', '"Marcações de hoje", com as marcações do dia'],
    notas: ['A marcação é de quem está com o usuário aberto na tela.'],
    veja: ['escala', 'painel-do-dia'],
  },
  {
    id: 'checklist-pop',
    titulo: 'Criar um checklist da rotina e publicar como POP',
    caminho: ['Checklist & registros'],
    rota: '/docs',
    perm: 'checklist',
    palavras: ['checklist', 'check-list', 'lista de verificação', 'pop', 'procedimento padrão', 'rotina', 'abertura da cozinha', 'documento', 'regimento', 'dar ciência', 'treinamento'],
    passos: [
      'Em "Checklists → POP", escolha a "Unidade", preencha o "Nome" (como abertura da cozinha) e clique em "Criar checklist".',
      'No cartão do checklist, escreva o item e, se quiser, como fazer; clique em "Adicionar item". Repita para cada passo.',
      'Clique em "Publicar (gera POP)": o checklist fica "Vigente" e vira o POP. Quem não é gestor clica em "Submeter para aprovação" e o gestor publica.',
      'Em "Documentos + ciência", escolha o "Tipo", preencha o "Título" e clique em "Criar documento"; publicado, a equipe clica em "Dar ciência".',
    ],
    botoes: ['Checklists → POP', 'Unidade', 'Nome', 'Criar checklist', 'Adicionar item', 'Publicar (gera POP)', 'Vigente', 'Submeter para aprovação', 'Documentos + ciência', 'Tipo', 'Título', 'Criar documento', 'Dar ciência'],
    imagem: ['Checklist & registros, no menu', 'o campo "Nome" do checklist novo (a "Unidade" fica acima)', 'o botão "Criar checklist"', 'o botão "Publicar (gera POP)", no cartão do checklist'],
    notas: ['Publicar é do presidente e do gerente.', 'Checklist publicado não recebe item novo.'],
    veja: ['criar-tarefa', 'mural'],
  },
  {
    id: 'formas-de-pagamento',
    titulo: 'Cadastrar, ligar ou desligar uma forma de pagamento',
    caminho: ['Financeiro', 'Formas de pagamento'],
    rota: '/formas-pagamento',
    perm: 'formas_pagamento',
    palavras: ['forma de pagamento', 'formas de pagamento', 'pix', 'cartão', 'dinheiro', 'vale refeição', 'bandeira do cartão', 'aceitar cartão', 'pagamento no cardápio'],
    passos: [
      'Em "Formas pré-definidas", o botão ao lado do nome liga ou desliga a forma; desligada, ela fica riscada.',
      'Para criar, clique em "＋ Nova forma"; para mudar, "Editar" na linha.',
      'Preencha o "Nome" e o "Tipo", ligue "Mostrar no cardápio digital" se o cliente pode escolher no cardápio e marque o "Tipo de pedido que aceita".',
      'Se quiser, a taxa extra e a "Observação"; em crédito ou débito, as "Bandeiras aceitas". Clique em "Salvar". "Remover", no "Editar", apaga a forma.',
    ],
    botoes: ['Formas pré-definidas', '＋ Nova forma', 'Editar', 'Nome', 'Tipo', 'Mostrar no cardápio digital', 'Tipo de pedido que aceita', 'Observação', 'Bandeiras aceitas', 'Salvar', 'Remover'],
    imagem: ['Financeiro › Formas de pagamento, no menu', 'o botão "＋ Nova forma"', 'o botão que liga e desliga a forma (aqui, o Pix)', '"Editar" na linha da forma'],
    notas: ['As formas valem para o delivery e o balcão.', 'O cartão e o Pix online (Mercado Pago) se ligam nas integrações do delivery.'],
    veja: ['venda-balcao'],
  },
  {
    id: 'unidades',
    titulo: 'Cadastrar uma unidade (loja) da rede',
    caminho: ['Configurações', 'Unidades'],
    rota: '/unidades',
    perm: 'unidades',
    palavras: ['unidade', 'unidades', 'cadastrar unidade', 'nova loja', 'segunda loja', 'filial', 'matriz', 'rede de lojas', 'endereço da unidade'],
    passos: [
      'Clique em "Nova unidade".',
      'Preencha o "Nome da unidade", escolha o "Tipo" ("Matriz" ou "Filial") e, se quiser, o "Endereço (opcional)". Clique em "Salvar".',
      'Para mudar, "Editar" na linha; para tirar, "Excluir" e confirme em "Excluir unidade".',
      'As situações ("Matriz", "Filiais", "Sem endereço") e o "Buscar" filtram a lista.',
    ],
    botoes: ['Nova unidade', 'Nome da unidade', 'Tipo', 'Matriz', 'Filial', 'Endereço (opcional)', 'Salvar', 'Editar', 'Excluir', 'Excluir unidade', 'Filiais', 'Sem endereço', 'Buscar'],
    imagem: ['Configurações › Unidades, no menu', 'o botão "Nova unidade"', 'a situação "Sem endereço"', '"Editar" na linha da unidade'],
    notas: [
      'Criar, editar e excluir são só do presidente.',
      'Só dá para excluir a unidade sem setores, turnos ou janelas de pico.',
      'Cada colaborador, setor, turno e venda pertence a uma unidade.',
    ],
    veja: ['dados-da-loja'],
  },

  // ── M6k, lote 3: mapa dos entregadores, produção, manutenção, ponto de baixa, TEF, ponto da equipe e candidatos — no
  //    fim da lista, pelo mesmo desempate da busca ──
  {
    id: 'mapa-ao-vivo',
    titulo: 'Ver no mapa onde estão os entregadores e mostrar o mapa num KDS',
    caminho: ['Delivery', 'Mapa ao vivo'],
    rota: '/delivery/mapa',
    perm: 'delivery',
    palavras: ['mapa', 'mapa ao vivo', 'onde está o entregador', 'onde está o motoboy', 'localização do entregador', 'rastrear entregador', 'entregador em rota', 'mapa no kds', 'gps'],
    passos: [
      'O mapa mostra a loja e os entregadores com entrega ativa, pela última posição dos últimos 15 minutos. Atualiza sozinho a cada 15 segundos.',
      'Em "Em rota agora" fica cada entregador, os pedidos com ele e a hora da última posição.',
      'Para ver o mapa na cozinha, clique em "Mostrar num KDS", marque as telas e clique em "Mostrar o mapa nos KDS marcados". "Tirar de todos" volta os KDS aos pedidos.',
    ],
    botoes: ['Em rota agora', 'Mostrar num KDS', 'Mostrar o mapa nos KDS marcados', 'Tirar de todos', 'Mostrar o mapa dos entregadores no KDS'],
    imagem: ['Delivery › Mapa ao vivo, no menu', 'um entregador em "Em rota agora", com os pedidos e a hora da última posição', 'o botão "Mostrar num KDS"'],
    notas: ['O mapa no KDS começa desligado (é a localização de pessoas): liga-se em "Mostrar o mapa dos entregadores no KDS", no ⚙️ do painel do delivery.'],
    veja: ['aceitar-avancar', 'cadastrar-entregador'],
  },
  {
    id: 'pedidos-producao',
    titulo: 'Acompanhar os pedidos na produção da cozinha (atrasados, prontos) e cancelar um',
    caminho: ['Delivery', 'Pedidos · produção'],
    rota: '/pedidos',
    perm: 'pedidos',
    palavras: ['painel de produção', 'pedidos na cozinha', 'o que está na cozinha', 'pedido atrasado', 'pedidos atrasados', 'pedidos prontos', 'supervisionar a cozinha', 'produção'],
    passos: [
      'No alto, "Em produção", "Atrasados" e "Prontos" contam os pedidos de agora.',
      'Cada setor da cozinha tem o seu cartão, com os pedidos e há quantos minutos chegaram. O que passou do tempo de preparo fica em vermelho, com "ATRASADO".',
      'Para cancelar, clique em "Cancelar pedido" e escreva o motivo, se quiser: a cozinha é avisada.',
      'Em "Recentes (concluídos/cancelados)" ficam os que já saíram.',
    ],
    botoes: ['Em produção', 'Atrasados', 'Prontos', 'ATRASADO', 'Cancelar pedido', 'Recentes (concluídos/cancelados)'],
    imagem: ['Delivery › Pedidos · produção, no menu', 'o contador "Atrasados" ("Em produção" e "Prontos" ao lado)', 'o tempo do pedido atrasado, com "ATRASADO"', 'o "Cancelar pedido" do pedido atrasado'],
    notas: ['A cozinha trabalha no KDS; aqui o gestor vê todos os setores num lugar só. A tela se atualiza a cada 15 segundos.'],
    veja: ['cancelar-pedido', 'produtos-do-kds'],
  },
  {
    id: 'ordem-de-producao',
    titulo: 'Criar um pedido de produção (ordem) e lançar o que foi produzido',
    caminho: ['Tarefas', 'Pedidos de produção'],
    rota: '/ordens-producao',
    perm: 'producao_kds',
    palavras: ['ordem de produção', 'ordens de produção', 'pedido de produção', 'produzir', 'produção do dia', 'pré-preparo', 'lançar produção', 'produção recorrente'],
    passos: [
      'Clique em "Nova ordem". Escolha a "Ficha técnica", a "Quantidade" e a "Data"; se quiser, a hora e o setor.',
      'Em "Onde avisar", marque onde a ordem aparece (como "KDS/Quadro" ou "Impressão") e clique em "Criar ordem".',
      'Na lista, "Iniciar" começa a produção. Ao terminar, "Concluir": escolha "Total", "Parcial" ou "Não concluída" e clique em "Confirmar com PIN" (o PIN de quem produziu).',
      '"Lançar depois" deixa a ordem em "Pendências" até alguém lançar o resultado.',
    ],
    botoes: ['Nova ordem', 'Ficha técnica', 'Quantidade', 'Data', 'Onde avisar', 'KDS/Quadro', 'Impressão', 'Criar ordem', 'Iniciar', 'Concluir', 'Total', 'Parcial', 'Não concluída', 'Confirmar com PIN', 'Lançar depois', 'Pendências', 'Repetir todo dia'],
    imagem: ['Tarefas › Pedidos de produção, no menu', 'o botão "Nova ordem"', 'a situação "Pendências" (as que esperam o lançamento)', 'o "Concluir" na linha da ordem em produção'],
    notas: ['"Total" e "Parcial" dão baixa nos insumos da ficha e põem no estoque o insumo de saída, se a ordem tiver.', '"Repetir todo dia" e cancelar são do presidente, do gerente e da supervisão.'],
  },
  {
    id: 'pedido-de-manutencao',
    titulo: 'Abrir um pedido de manutenção (equipamento com defeito) e acompanhar até concluir',
    caminho: ['Tarefas', 'Pedidos de manutenção'],
    rota: '/manutencao',
    perm: 'manutencao',
    palavras: ['manutenção', 'conserto', 'consertar', 'defeito', 'quebrou', 'equipamento quebrado', 'lâmpada queimada', 'geladeira com defeito', 'chamar técnico'],
    passos: [
      'Clique em "Novo pedido", no alto da tela.',
      'Preencha "O que está com defeito?" e, se quiser, "Equipamento / local (opcional)", "Detalhes (opcional)", a "Prioridade" e até 3 fotos. Clique em "Abrir pedido".',
      'Cada pedido mostra a situação, a prioridade e o responsável; "15+ dias" marca o que está aberto há mais de 15 dias.',
      'Para acompanhar, escolha quem resolve em "Delegar ao gerente…" e feche com "Parcial", "Concluir" ou "Cancelar".',
    ],
    botoes: ['Novo pedido', 'O que está com defeito?', 'Equipamento / local (opcional)', 'Detalhes (opcional)', 'Prioridade', 'Abrir pedido', '15+ dias', 'Delegar ao gerente…', 'Parcial', 'Concluir', 'Cancelar'],
    imagem: ['Tarefas › Pedidos de manutenção, no menu', 'o botão "Novo pedido", no alto da tela', 'o botão "Concluir" do pedido', 'o "Delegar ao gerente…" do pedido'],
    notas: ['Delegar e concluir são do presidente e do gerente.'],
  },
  {
    id: 'ponto-de-baixa',
    titulo: 'Dar baixa ou abrir um produto pelo QR da etiqueta (ponto de baixa)',
    caminho: ['Ponto de baixa (QR)'],
    rota: '/ponto-baixa',
    perm: 'desperdicio',
    palavras: ['ponto de baixa', 'baixa pelo qr', 'ler etiqueta', 'ler o qr', 'leitor de código', 'leitor usb', 'abrir produto', 'produto aberto', 'usei o produto'],
    passos: [
      'Em "Ao ler, o que fazer?", escolha "Perguntar", "Baixar direto" ou "Abrir".',
      'Leia o QR da etiqueta com o leitor na caixa "Leitor USB / código" (ou digite o código e clique em "Ler"). No tablet ou celular, "Ligar câmera" lê pela câmera.',
      'No modo "Perguntar", escolha "Baixar (usei)" ou "Abrir (em uso)".',
      'Em "Últimas leituras" fica o que foi lido, com a hora.',
    ],
    botoes: ['Ao ler, o que fazer?', 'Perguntar', 'Baixar direto', 'Abrir', 'Leitor USB / código', 'Ler', 'Ligar câmera', 'Baixar (usei)', 'Abrir (em uso)', 'Últimas leituras'],
    imagem: ['Ponto de baixa (QR), no menu', 'o que fazer ao ler: "Perguntar", "Baixar direto" ou "Abrir"', 'a caixa "Leitor USB / código"', 'os botões "Baixar (usei)" e "Abrir (em uso)" da etiqueta lida'],
    notas: ['Produto já aberto sempre baixa. Abrir pode encurtar a validade: aí sai uma etiqueta nova.', 'Etiqueta vencida, já baixada ou trocada por outra não baixa: a tela avisa.'],
    veja: ['etiqueta-de-validade'],
  },
  {
    id: 'tef-maquininha',
    titulo: 'Ligar o TEF e ver as cobranças feitas na maquininha',
    caminho: ['Financeiro', 'TEF / maquininha'],
    rota: '/tef',
    perm: 'tef',
    palavras: ['tef', 'maquininha', 'máquina de cartão', 'pinpad', 'cobrar na maquininha', 'cartão na maquininha', 'transações', 'nsu'],
    passos: [
      'Marque "TEF ativo (cobrança de cartão/pix na maquininha)": a venda do balcão paga numa forma só, no crédito, no débito ou no Pix, vai para a maquininha antes de fechar.',
      'A maquininha é operada pelo agente TEF no servidor da loja.',
      'Em "Transações" fica cada cobrança: o valor, a forma, a situação, o NSU e a bandeira.',
      'Sem o agente ou o pinpad, "Simular aprovado" e "Simular negado" fecham uma cobrança pendente (teste).',
    ],
    botoes: ['TEF ativo (cobrança de cartão/pix na maquininha)', 'Transações', 'Simular aprovado', 'Simular negado'],
    imagem: ['Financeiro › TEF / maquininha, no menu', 'a caixa "TEF ativo"', 'o "Simular aprovado" da cobrança pendente', 'uma cobrança aprovada, com o valor, a forma, o NSU e a bandeira'],
    notas: ['Ligar o TEF e simular são do presidente, do gerente e da supervisão.'],
    veja: ['venda-balcao', 'formas-de-pagamento'],
  },
  {
    id: 'espelho-de-ponto',
    titulo: 'Ver o espelho de ponto de um funcionário (horas e saldo) e corrigir uma marcação',
    caminho: ['Pessoas', 'Gerenciamento de ponto'],
    rota: '/pessoas',
    perm: 'ponto_gerencial',
    modulo: 'terminal_ponto',
    palavras: ['espelho de ponto', 'gerenciamento de ponto', 'banco de horas', 'saldo de horas', 'horas trabalhadas', 'hora extra', 'ponto esquecido', 'corrigir o ponto', 'abono', 'atestado'],
    passos: [
      'Em "Ponto de hoje", clique no funcionário; para outro, escolha em "Ver qualquer colaborador…".',
      'Escolha o período: "7 dias", "Este mês", "30 dias" ou as datas.',
      'O espelho mostra "Trabalhado", "Esperado" e "Saldo" e as marcações de cada dia. "Gerar PDF" abre o espelho para imprimir.',
      'Para corrigir, clique em "Gestão": "Incluir marcação", "Abono / Atestado" ou "Desconsiderar", com a "Justificativa". Clique em "Registrar correção".',
    ],
    botoes: ['Ponto de hoje', 'Ver qualquer colaborador…', '7 dias', 'Este mês', '30 dias', 'Trabalhado', 'Esperado', 'Saldo', 'Gerar PDF', 'Gestão', 'Incluir marcação', 'Abono / Atestado', 'Desconsiderar', 'Justificativa', 'Registrar correção', 'Recalcular', 'Encaminhar ao RH'],
    imagem: ['Pessoas › Gerenciamento de ponto, no menu', 'o funcionário em "Ponto de hoje" (um clique abre o espelho)', 'o período "Este mês" ("7 dias" e "30 dias" ao lado)', 'o "Gerar PDF" do espelho'],
    notas: ['O fechamento do mês fica no alto: depois de corrigir, "Recalcular"; sem pendências, "Encaminhar ao RH".', '"Gestão" é do presidente e do gerente.'],
    veja: ['meu-ponto'],
  },
  {
    id: 'candidatos',
    titulo: 'Ver as fichas dos candidatos às vagas, marcar entrevista e contratar',
    caminho: ['Pessoas', 'Candidatos'],
    rota: '/candidatos',
    perm: 'candidatos',
    modulo: 'vagas',
    palavras: ['candidato', 'candidatos', 'vaga', 'vagas', 'currículo', 'ficha do candidato', 'entrevista', 'contratar', 'banco de talentos', 'seleção'],
    passos: [
      'A aba "Candidatos" lista as "Fichas recebidas". As situações (como "Novo" e "Entrevista") e os filtros, como "Distância até a loja", separam as fichas.',
      'Clique em "Abrir ficha" na linha: abre a vaga desejada, a experiência e como a pessoa chega à loja.',
      'Mude a situação no grupo "Situação". "📅 Marcar entrevista" agenda e "💬 Chamar no WhatsApp" abre a conversa.',
      'Para contratar, "Contratar" e "Criar colaborador": o colaborador nasce no cadastro, para completar os documentos.',
    ],
    botoes: ['Candidatos', 'Fichas recebidas', 'Novo', 'Entrevista', 'Distância até a loja', 'Abrir ficha', 'Situação', '📅 Marcar entrevista', '💬 Chamar no WhatsApp', 'Contratar', 'Criar colaborador', 'Página de vagas', 'QR codes e links'],
    imagem: ['Pessoas › Candidatos, no menu', 'a situação "Entrevista" (as outras ficam ao lado)', 'o filtro "Distância até a loja"', 'o "Abrir ficha" na linha do candidato'],
    notas: ['A página de vagas e os QR codes ficam nas abas "Página de vagas" e "QR codes e links".', 'Sexo e idade não são filtro (Lei 9.029/1995).'],
    veja: ['cadastrar-colaborador'],
  },

  // ── M6k, lote 4 (o último): alertas do KDS, direcionamento, config. por ramo, planos, servidor local, números do
  //    atendimento e Visão C&O — no fim da lista, pelo mesmo desempate da busca ──
  {
    id: 'alertas-do-kds',
    titulo: 'Criar um alerta no rodapé do KDS (hora de lavar as mãos, muitos pedidos esperando)',
    caminho: ['Configurações', 'Alertas do KDS'],
    rota: '/kds/alertas',
    perm: 'producao_kds',
    modulo: 'kds',
    palavras: ['alerta do kds', 'alertas do kds', 'alerta na cozinha', 'mensagem no kds', 'rodapé do kds', 'lavar as mãos', 'lembrete', 'muitos pedidos'],
    passos: [
      'Clique em "Novo alerta". Preencha o "Título" e, se quiser, o "Detalhe (opcional)" e a "Prioridade".',
      'Em "Tipo", escolha "Agendado (horário)", com os "Horários" (cada um com "Adicionar") e os "Dias da semana", ou "Condicional (limite)", que dispara com muitos pedidos acumulados.',
      'Em "Quanto tempo fica no rodapé", escolha "Alguns segundos" ou "Até alguém tocar em Ciente". Escolha a "Loja" e os "KDS que recebem" e clique em "Criar alerta".',
      'Na linha do alerta, a chave liga e desliga; "Testar" e depois "Disparar no KDS" mostram o alerta agora, de verdade.',
    ],
    botoes: ['Novo alerta', 'Título', 'Detalhe (opcional)', 'Prioridade', 'Tipo', 'Agendado (horário)', 'Horários', 'Adicionar', 'Dias da semana', 'Condicional (limite)', 'Quanto tempo fica no rodapé', 'Alguns segundos', 'Até alguém tocar em Ciente', 'Loja', 'KDS que recebem', 'Criar alerta', 'Testar', 'Disparar no KDS'],
    imagem: ['Configurações › Alertas do KDS, no menu', 'o botão "Novo alerta"', 'a chave que liga e desliga o alerta', 'o "Testar" na linha do alerta'],
    notas: ['A tela é do presidente e do gerente. O KDS confere os alertas a cada 20 segundos.'],
    veja: ['cores-do-kds'],
  },
  {
    id: 'direcionamento-do-catalogo',
    titulo: 'Escolher para qual KDS ou impressora vai cada produto (direcionamento)',
    caminho: ['Configurações', 'Direcionamento do catálogo'],
    rota: '/direcionamento',
    perm: 'producao_kds',
    palavras: ['direcionamento', 'direcionar', 'para onde vai o produto', 'produto na impressora', 'mandar para outra impressora', 'produto no kds', 'destino do produto', 'cupom do cliente'],
    passos: [
      'Na parte "Produtos", marque os produtos (a busca e os filtros, como "Categoria" e "Setor", ajudam) e clique em "Direcionar marcados". Para um produto só, "Destinos" na linha.',
      'Na gaveta, marque os KDS e as impressoras e escolha "Substituir destinos" ou "Adicionar aos atuais". Clique em "Confirmar direcionamento".',
      'Produto sem destino próprio segue o padrão do setor; "Voltar ao padrão", na linha, tira o destino próprio.',
      'Na parte "Cupom do cliente", ligue as impressoras que imprimem a via com valores.',
    ],
    botoes: ['Produtos', 'Categoria', 'Setor', 'Direcionar marcados', 'Destinos', 'Substituir destinos', 'Adicionar aos atuais', 'Confirmar direcionamento', 'Voltar ao padrão', 'Cupom do cliente'],
    imagem: ['Configurações › Direcionamento do catálogo, no menu', 'a caixa de marcar do produto (aqui, o X-Burger)', 'o botão "Direcionar marcados"', 'o "Destinos" na linha de um produto'],
    notas: ['Direcionar é do presidente, do gerente e da supervisão; o cupom do cliente, do presidente e do gerente.'],
    veja: ['produtos-do-kds', 'onde-cada-documento-sai'],
  },
  {
    id: 'config-por-ramo',
    titulo: 'Montar os setores e as funções pelo ramo da empresa (assistente de início)',
    caminho: ['Configurações', 'Config. por ramo'],
    rota: '/wizard',
    perm: 'config_ramo',
    palavras: ['config por ramo', 'configuração por ramo', 'ramo', 'assistente', 'wizard', 'configuração inicial', 'montar setores', 'setores e funções', 'começar a usar'],
    passos: [
      'Em "Qual o ramo da empresa?", escolha o ramo (por enquanto, só restaurante está completo) e clique em "Avançar ▸".',
      'Em "Setores sugeridos" e em "Funções que mais se qualificam", toque para tirar ou pôr de volta; "Avançar ▸" a cada passo.',
      'Em "Modelos de escala", marque os que a loja usa e, se quiser, "Criar insumos básicos do ramo".',
      'Clique em "Concluir", confira o resumo e clique em "Aplicar". O que já existe não é duplicado.',
    ],
    botoes: ['Qual o ramo da empresa?', 'Avançar ▸', 'Setores sugeridos', 'Funções que mais se qualificam', 'Modelos de escala', 'Criar insumos básicos do ramo', 'Concluir', 'Aplicar', 'Aplicar na unidade'],
    imagem: ['Configurações › Config. por ramo, no menu', 'o ramo escolhido (aqui, restaurante)', 'os quatro passos, com o que cada um tem marcado', 'o botão "Avançar ▸"'],
    notas: [
      'Só o presidente usa. Com mais de uma loja, escolha antes em "Aplicar na unidade".',
      'O assistente fica aberto só enquanto o cadastro está abaixo de 35%; depois, os ajustes são feitos nos cadastros.',
    ],
    veja: ['cadastrar-colaborador', 'escala'],
  },
  {
    id: 'planos-e-assinatura',
    titulo: 'Ver a situação da conta e assinar ou trocar de plano',
    caminho: ['Configurações', 'Planos & assinatura'],
    rota: '/planos',
    perm: 'planos',
    palavras: ['plano', 'planos', 'assinatura', 'assinar', 'trocar de plano', 'mensalidade', 'teste grátis', 'período de teste', 'assinatura vencida'],
    passos: [
      'O aviso no alto diz a situação da conta: quanto falta do teste grátis, a assinatura ativa ou a vencida.',
      'Em "Ciclo de cobrança", escolha "Mensal", "Semestral" ou "Anual": o preço de cada plano muda junto.',
      'No cartão do plano, confira os módulos e clique em "Assinar" (ou em "Trocar para", se já assina).',
      'Confira o plano e o ciclo e clique em "Ir para o pagamento": o pagamento é feito numa página fora do Regem.',
    ],
    botoes: ['Ciclo de cobrança', 'Mensal', 'Semestral', 'Anual', 'Assinar', 'Trocar para', 'Ir para o pagamento'],
    imagem: ['Configurações › Planos & assinatura, no menu', 'o aviso da situação da conta (aqui, o teste grátis)', 'o "Ciclo de cobrança"', 'o botão de assinar de um plano (na imagem, o preço e os módulos ficam borrados: os de verdade estão na tela)'],
    notas: [
      'A tela não pede os dados do cartão. Se a página de pagamento não abrir, o caminho é falar com a distribuição.',
      'Os planos aparecem só no Regem na internet, não no servidor da loja.',
    ],
  },
  {
    id: 'servidor-local',
    titulo: 'Instalar o servidor da loja e conferir o backup e o espaço livre',
    caminho: ['Configurações', 'Servidor local'],
    rota: '/servidor',
    perm: 'servidor',
    palavras: ['servidor local', 'servidor da loja', 'instalar o servidor', 'instalador', 'backup', 'cópia de segurança', 'espaço no computador', 'sem internet', 'ip do servidor'],
    passos: [
      'No alto, "Pede atenção" separa o que precisa de cuidado: servidor sem sinal, backup atrasado ou espaço acabando.',
      'Em "Saúde do servidor", confira o "Último backup" (o computador da loja guarda uma cópia todo dia) e o "Espaço livre no computador".',
      'Em "Endereço na rede" ficam o endereço que os PCs usam e o IP para uma emergência; "Fixar o IP no roteador" mostra como manter o mesmo IP.',
      'Para instalar, no PC com Windows da loja, clique em "⬇ Baixar o instalador (Windows)", execute, aceite o aviso de administrador e entre com a sua conta do Regem.',
    ],
    botoes: ['Pede atenção', 'Saúde do servidor', 'Último backup', 'Espaço livre no computador', 'Endereço na rede', 'Fixar o IP no roteador', '⬇ Baixar o instalador (Windows)'],
    imagem: ['Configurações › Servidor local, no menu', 'a situação "Pede atenção"', 'o "Último backup"', 'o "Espaço livre no computador"'],
    notas: [
      'Com o servidor, o KDS, o PDV e o ponto seguem funcionando sem internet. Backup atrasado ou manutenção: acione o suporte.',
      'A atualização do servidor aparece só na tela aberta no próprio servidor da loja.',
    ],
    veja: ['equipamentos'],
  },
  {
    id: 'numeros-do-atendimento',
    titulo: 'Ver os números do atendimento: tempo de resposta, reclamações e quanto custaram',
    caminho: ['Relatórios', 'Atendimento'],
    rota: '/atendimento/numeros',
    perm: 'pedidos',
    palavras: ['números do atendimento', 'tempo de resposta', 'taxa de resposta', 'reclamações', 'reclamação por produto', 'motivo da reclamação', 'quanto custou', 'reembolso', 'disputa sem resposta'],
    passos: [
      'Escolha o período: "Últimos 7 dias", "Últimos 30 dias", "Este mês" ou "Mês passado".',
      'No alto ficam a "1ª resposta no chat do iFood" e a "Taxa de resposta no chat do iFood" (o cliente vê no iFood), as "Disputas do iFood sem resposta" e quanto custou.',
      'O "Placar por canal" mostra, canal a canal, quanto chegou, quanto foi respondido e em quanto tempo.',
      'Em "Reclamações por motivo" e "Reclamações por produto", clique numa linha para ver os casos: "Abrir o caso" ou "Marcar o motivo".',
    ],
    botoes: ['Últimos 7 dias', 'Últimos 30 dias', 'Este mês', 'Mês passado', '1ª resposta no chat do iFood', 'Taxa de resposta no chat do iFood', 'Disputas do iFood sem resposta', 'Placar por canal', 'Reclamações por motivo', 'Reclamações por produto', 'Abrir o caso', 'Marcar o motivo', 'Somar todas as lojas'],
    imagem: ['Relatórios › Atendimento, no menu', 'o período "Últimos 30 dias" (os outros ao lado)', 'a "1ª resposta no chat do iFood"', 'um motivo em "Reclamações por motivo" (um clique abre os casos)'],
    notas: ['É do gerente e do presidente; com mais de uma loja, o presidente pode "Somar todas as lojas".', 'O chat do iFood e da 99 só entra com a ponte do chat ligada.'],
    veja: ['atendimento'],
  },
  {
    id: 'visao-co',
    titulo: 'Ver o consolidado da rede na Visão C&O e ligar ou desligar um módulo',
    caminho: ['Visão C&O'],
    rota: '/diretoria',
    perm: 'visao_co',
    palavras: ['visão c&o', 'visao co', 'diretoria', 'consolidado', 'faturamento da rede', 'todas as lojas', 'comparativo entre lojas', 'módulo', 'módulos', 'ligar módulo', 'desligar módulo'],
    passos: [
      'No alto ficam os números do mês da rede: "Faturamento rede (mês)", "Desperdícios (mês)", a "Conclusão média" das tarefas e o "Estoque crítico".',
      'Em "Comparativo entre lojas — mês", cada loja tem faturamento, tarefas, escala de hoje, desperdício e estoque crítico, com a situação: "Acima da meta", "Atenção" ou "Plano de ação". "Exportar CSV" baixa a tabela.',
      'Em "Módulos do produto", a chave liga ou desliga o módulo na rede inteira; em "Exceções por loja", só numa loja. Desligar corta o acesso na hora.',
    ],
    botoes: ['Faturamento rede (mês)', 'Desperdícios (mês)', 'Conclusão média', 'Estoque crítico', 'Comparativo entre lojas — mês', 'Acima da meta', 'Atenção', 'Plano de ação', 'Exportar CSV', 'Módulos do produto', 'Exceções por loja'],
    imagem: ['Visão C&O, no menu', 'o "Faturamento rede (mês)" (os outros números do mês ao lado)', 'uma loja no "Comparativo entre lojas — mês"', 'a chave de um módulo em "Módulos do produto"'],
    notas: ['Só o presidente vê esta tela; o gerente não recebe estes números.', 'Os módulos só mudam pelo Regem na internet. O Mister nasce desligado e se liga aqui.'],
  },
];
