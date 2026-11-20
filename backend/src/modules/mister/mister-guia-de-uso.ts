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
];
