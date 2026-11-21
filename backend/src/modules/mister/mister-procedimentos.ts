// AS PROPOSTAS DO MISTER (F4.1 de `docs/plano-mister.md`, "Propor e aprovar"; mig 428). O Mister propõe resolver um
// aviso por um procedimento deste CATÁLOGO FIXO — a IA não inventa ação —, o presidente autoriza na conversa, o Regem
// executa pelo MESMO serviço da tela e o Mister confere o efeito antes de dizer "feito". Puro: sem banco, sem rede.
//
// Dois níveis (conversas 5 e 6 do protótipo `mockups/regem-mister.html`): botão na conversa, só para baixo impacto (vale
// 10 minutos e uma vez); link com PIN, que abre o Regem, para dinheiro, cancelamento ou configuração (a F4.2). Até o perfil
// de permissões do fim do projeto, só o presidente autoriza.

import type { TipoDeAviso } from './mister-avisos.regras';
import { compararVersao } from '../edge/release-selecao';
import { ACOES, TEXTOS_DAS_ACOES, type AcaoDoMister } from './mister-acoes';

// Versão 6, M6j: as AÇÕES da porta `propor_acao` (`mister-acoes.ts`) também são propostas — de botão, de quem pediu.
export type ProcedimentoDoMister = 'consultar_nota' | 'imprimir_teste' | 'cancelar_pedido' | 'reiniciar_impressao' | 'abrir_sessao' | AcaoDoMister;
export type NivelDaAutorizacao = 'botao' | 'pin';
export type SituacaoDaProposta = 'proposta' | 'autorizada' | 'recusada' | 'vencida' | 'executando' | 'feita' | 'nao_deu';

export interface Procedimento {
  id: ProcedimentoDoMister;
  /** O tipo de aviso que este procedimento resolve; null = nasce da pergunta (F4.3), preso ao alvo (o pedido). */
  tipoDoAviso: TipoDeAviso | null;
  nivel: NivelDaAutorizacao;
  /** Por quanto tempo a proposta vale. */
  prazoMin: number;
  /** Quanto tempo o Mister espera o efeito aparecer depois de executar. */
  conferirMin: number;
  /** O nome curto, para a auditoria e o histórico. */
  nome: string;
}

/** O catálogo. Procedimento novo entra aqui, com o teste da execução pelo serviço da tela e da conferência do efeito. */
export const PROCEDIMENTOS: Record<ProcedimentoDoMister, Procedimento> = {
  // O aviso da nota que gastou as reconsultas (vai ao presidente pelo padrão): a mesma consulta do botão "Consultar na
  // SEFAZ" da tela (`FiscalService.consultarNota`). A conferência é a própria resposta da SEFAZ.
  consultar_nota: { id: 'consultar_nota', tipoDoAviso: 'nota_sem_resposta', nivel: 'botao', prazoMin: 10, conferirMin: 2, nome: 'consultar a nota de novo na SEFAZ' },
  // O aviso da impressora parada (vai ao presidente quando a empresa escolhe): a via de teste pelo servidor da loja, como
  // o "Imprimir teste" da tela (`edge_comando` `testar_impressora`). Conferido quando o servidor pegou o pedido e a
  // impressora voltou a responder (o aviso fecha).
  imprimir_teste: { id: 'imprimir_teste', tipoDoAviso: 'impressora', nivel: 'botao', prazoMin: 10, conferirMin: 5, nome: 'mandar uma via de teste para a impressora' },
  // F4.2b: cancelar um pedido com o estorno — mexe com dinheiro, então é de PIN (o link da F4.2a), vale 15 minutos. A
  // execução é o MESMO `DeliveryService.cancelar` do botão "Cancelar" do painel (o canal, o estorno pela rotina da nuvem,
  // a cozinha, os benefícios), com o presidente conferido pelo PIN no lugar da senha. Conferido quando o pedido está
  // cancelado e, se foi pago no Pix online, quando o estorno saiu no gateway (`pedido_estorno` feito).
  cancelar_pedido: { id: 'cancelar_pedido', tipoDoAviso: null, nivel: 'pin', prazoMin: 15, conferirMin: 10, nome: 'cancelar o pedido com o estorno' },
  // F4.4 (a conversa 5 do protótipo): a impressora que parou de RESPONDER, com o servidor da loja na versão que sabe
  // reiniciar o serviço de impressão (`edge_comando` `reiniciar_impressao`, no `.exe`). Conferido como a via de teste:
  // o servidor reiniciou (o retorno do comando) e a impressora voltou a responder (o aviso fecha).
  reiniciar_impressao: { id: 'reiniciar_impressao', tipoDoAviso: 'impressora', nivel: 'botao', prazoMin: 10, conferirMin: 5, nome: 'reiniciar o serviço de impressão do servidor da loja' },
  // Versão 6, M6d (mig 476): a SESSÃO COM PIN — com o ajuste ligado, os valores em reais, os dados de pessoas e as ações de
  // botão pedem o PIN pelo link; o PIN certo libera por 6, 12 ou 24 horas (`mister_vinculo.pin_ate`). Da própria pessoa
  // (presidente ou gerente), nasce da conversa, vale 15 minutos. O efeito é imediato (não há o que conferir depois).
  abrir_sessao: { id: 'abrir_sessao', tipoDoAviso: null, nivel: 'pin', prazoMin: 15, conferirMin: 1, nome: 'liberar os valores e os dados de pessoas no Mister' },
  // Versão 6, M6j: as ações da porta `propor_acao` (lote 1, o Delivery) — de botão, de QUEM pediu (presidente ou gerente com
  // o Delivery no perfil), nascem da conversa; o efeito se confere na hora, pelo estado que o serviço da tela deixou.
  ...(Object.fromEntries(
    Object.values(ACOES).map((a) => [a.id, { id: a.id, tipoDoAviso: null, nivel: a.nivel, prazoMin: a.prazoMin, conferirMin: 1, nome: a.nome }]),
  ) as Record<AcaoDoMister, Procedimento>),
};

/** Versão 6, M6d: o texto da conversa que leva o link do PIN da sessão (a mensagem vai com o link, nunca com botões). */
export const TEXTOS_DA_SESSAO = {
  link: (horas: number, ate: string) =>
    `Para ver valores em reais e dados de pessoas (e autorizar pelos botões), confirme com o seu PIN no Regem — vale por ${horas} horas. O link vale até ${ate}.`,
  liberada: (ate: string) => `liberado até ${ate}: os valores e os dados de pessoas voltam a aparecer`,
  botaoPedePin: 'Para autorizar pelo botão, confirme antes o seu PIN pelo link que mandei agora.',
} as const;

/** A versão do servidor da loja que traz o comando `reiniciar_impressao` (o `sync-daemon` do `.exe` seguinte à 1.30.13). */
export const VERSAO_QUE_REINICIA_A_IMPRESSAO = '1.30.14';

/**
 * Reiniciar o serviço de impressão serve? Só com a impressora sem RESPONDER (a que respondeu com aviso — sem papel, tampa
 * aberta — não volta com reinício) e o servidor da loja na versão que sabe fazer isso. Sem saber a versão, não.
 */
export function reinicioServe(s: { motivo?: unknown; versao?: unknown }): boolean {
  if (s.motivo === 'aviso') return false;
  const v = String(s.versao ?? '').trim();
  return /^\d+(\.\d+)*$/.test(v) && compararVersao(v, VERSAO_QUE_REINICIA_A_IMPRESSAO) >= 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A proposta que um aviso aberto pede, com o alvo tirado da chave do aviso; null quando nenhum procedimento serve.
 *  • nota sem resposta: `nota:<id da nota>`;
 *  • impressora parada: `vigia:impressora_parada:srv:<servidor>:impressora:<id da impressora no servidor da loja>` — a
 *    via de teste, ou o reinício do serviço de impressão quando ele serve (`reinicioServe`, lido pelo serviço).
 */
export function propostaDoAviso(
  a: { tipo: string; chave: string },
  opcoes: { reinicioServe?: boolean } = {},
): { procedimento: ProcedimentoDoMister; parametros: Record<string, string> } | null {
  if (a.tipo === 'nota_sem_resposta') {
    const id = /^nota:(.+)$/.exec(a.chave)?.[1] ?? '';
    return UUID.test(id) ? { procedimento: 'consultar_nota', parametros: { notaId: id } } : null;
  }
  if (a.tipo === 'impressora') {
    const m = /^vigia:impressora_parada:srv:([^:]+):impressora:(.+)$/.exec(a.chave);
    if (!m || !m[1] || !m[2]) return null;
    return { procedimento: opcoes.reinicioServe ? 'reiniciar_impressao' : 'imprimir_teste', parametros: { servidorId: m[1], impressoraId: m[2] } };
  }
  return null;
}

/** O servidor da loja na chave do aviso da impressora (o id do equipamento), ou null. */
export function servidorDoAviso(a: { tipo: string; chave: string }): string | null {
  if (a.tipo !== 'impressora') return null;
  const s = /^vigia:impressora_parada:srv:([^:]+):impressora:/.exec(a.chave)?.[1] ?? '';
  return UUID.test(s) ? s : null;
}

/** A pergunta que vai com o aviso, antes dos botões. */
export function perguntaDaProposta(p: ProcedimentoDoMister): string {
  const prazo = PROCEDIMENTOS[p].prazoMin;
  if (p === 'consultar_nota') return `Posso consultar esta nota de novo na SEFAZ? Leva alguns segundos. A pergunta vale por ${prazo} minutos.`;
  if (p === 'reiniciar_impressao')
    return `Posso reiniciar o serviço de impressão do servidor da loja? Leva uns 20 segundos, e as vias da fila saem em seguida. A pergunta vale por ${prazo} minutos.`;
  return `Posso mandar uma via de teste para esta impressora? Se ela imprimir, voltou a responder. A pergunta vale por ${prazo} minutos.`;
}

export const BOTOES_DA_PROPOSTA = { autorizar: 'Autorizar', naoAgora: 'Não agora' } as const;
/** O id do botão: `prop:<id da proposta>:sim|nao`. A entrada do WhatsApp entrega ao serviço das propostas pelo prefixo. */
export const PREFIXO_DO_BOTAO = 'prop:';
export const idDoBotao = (propostaId: string, autorizar: boolean) => `${PREFIXO_DO_BOTAO}${propostaId}:${autorizar ? 'sim' : 'nao'}`;
export function lerBotao(botaoId: unknown): { propostaId: string; autorizar: boolean } | null {
  const m = /^prop:([0-9a-f-]{36}):(sim|nao)$/i.exec(String(botaoId ?? ''));
  return m && UUID.test(m[1]) ? { propostaId: m[1].toLowerCase(), autorizar: m[2].toLowerCase() === 'sim' } : null;
}
export const botoesDaProposta = (propostaId: string, titulos: { autorizar: string; naoAgora: string } = BOTOES_DA_PROPOSTA) => [
  { id: idDoBotao(propostaId, true), titulo: titulos.autorizar },
  { id: idDoBotao(propostaId, false), titulo: titulos.naoAgora },
];

/** As respostas ao toque. */
export const TEXTOS_DA_PROPOSTA = {
  autorizada: (p: ProcedimentoDoMister) =>
    p === 'criar_imagem'
      ? TEXTOS_DAS_ACOES.imagemGerando
      : p in ACOES
      ? 'Autorizado. Fazendo agora…'
      : p === 'consultar_nota'
        ? 'Autorizado. Consultando a SEFAZ…'
        : p === 'reiniciar_impressao'
          ? 'Autorizado. Pedi ao servidor da loja para reiniciar o serviço de impressão; confiro em alguns minutos.'
          : 'Autorizado. Mandei a via de teste; confiro em alguns minutos.',
  recusada: 'Certo, não faço nada. O aviso continua aberto no Regem.',
  /** M6j: a ação que a pessoa pediu e depois não autorizou (não há aviso aberto por trás). */
  recusadaAcao: 'Certo, não faço nada.',
  vencida: (hora: string) => `Essa pergunta valeu até as ${hora}. Se o aviso continuar, a próxima vez traz outra.`,
  jaRespondida: 'Essa pergunta já foi respondida.',
  soPresidente: 'Por enquanto, só o presidente da empresa autoriza por aqui. O aviso continua aberto no Regem.',
  naoAchada: 'Não achei essa pergunta. Ela pode ter vencido.',
};

/** F4.4: o desfecho do reinício do serviço de impressão, pelo retorno do servidor da loja e pelo aviso da impressora. */
export const TEXTOS_DO_REINICIO = {
  feito: 'O serviço de impressão reiniciou e a impressora voltou a responder.',
  naoReiniciou: (dito: string) =>
    `o servidor da loja não conseguiu reiniciar o serviço de impressão — ${dito.replace(/[.\s]+$/, '').slice(0, 160)}. Reinicie o computador do servidor; se continuar, fale com o suporte.`,
  semVersao: 'o servidor da loja ainda não sabe reiniciar a impressão por aqui (falta a versão nova do Regem nele). Reinicie o computador do servidor.',
  impressoraNaoVoltou: 'o serviço de impressão reiniciou, mas a impressora ainda não responde. Confira se ela está ligada, com papel e no cabo ou na rede.',
  servidorNaoPegou: 'o servidor da loja não pegou o pedido. Confira se o computador do servidor está ligado e com internet.',
};

/** O que a SEFAZ respondeu, em português, a partir da situação da nota depois da consulta. */
export function resultadoDaConsulta(r: { status?: string | null; motivo?: string | null; numero?: number | string | null }): { feita: boolean; texto: string } {
  const nota = r.numero != null ? `a nota nº ${r.numero}` : 'a nota';
  const motivo = r.motivo ? ` (${String(r.motivo).slice(0, 160)})` : '';
  switch (r.status) {
    case 'autorizada':
      return { feita: true, texto: `A SEFAZ autorizou ${nota}.` };
    case 'cancelada':
      return { feita: true, texto: `A SEFAZ diz que ${nota} está cancelada.` };
    case 'rejeitada':
      return { feita: true, texto: `A SEFAZ rejeitou ${nota}${motivo}. Veja a nota no Regem para corrigir e emitir de novo.` };
    case 'denegada':
      return { feita: true, texto: `A SEFAZ denegou ${nota}${motivo}. Fale com o contador.` };
    default:
      return { feita: false, texto: 'a SEFAZ continua sem responder. Tente de novo mais tarde; se continuar, fale com o suporte.' };
  }
}

/** A mensagem final a quem autorizou. */
export function textoDoDesfecho(feita: boolean, resultado: string, hora: string): string {
  return feita ? `✅ Feito às ${hora}. ${resultado}` : `Não deu: ${resultado}`;
}

// ───────────────────────────── o link com PIN (F4.2a, mig 433) ─────────────────────────────
// Protótipo `mockups/regem-mister-pin.html` (aprovado em 16/11/2026). O que mexe com dinheiro, cancelamento ou
// configuração não se autoriza por botão: o Mister manda um link que abre `/m/<código>` no Regem, a página mostra a
// proposta e pede o PIN de quem recebeu. O link vale uma vez e pelo prazo da proposta; o Regem guarda só o resumo do
// código. Cinco PIN errados bloqueiam o link. O PIN nunca é digitado na conversa.

/** Quantos PIN errados bloqueiam o link. */
export const PIN_TENTATIVAS = 5;
/** O código do link: 24 bytes aleatórios em base64url = 32 letras. Qualquer outra coisa nem chega ao banco. */
export const ehCodigoDoLink = (c: unknown): c is string => typeof c === 'string' && /^[A-Za-z0-9_-]{32}$/.test(c);
/** O PIN do Regem tem de 4 a 6 dígitos (o mesmo do login por PIN). */
export const ehPinValido = (p: unknown): p is string => typeof p === 'string' && /^\d{4,6}$/.test(p);
/** O caminho da página no app. */
export const caminhoDoLink = (codigo: string) => `/m/${codigo}`;

export type EstadoDoLink = 'proposta' | 'fazendo' | 'feito' | 'naodeu' | 'recusou' | 'venceu' | 'bloqueado';

/** O estado que a página mostra, decidido no servidor pela situação gravada (a página nunca decide pelo relógio dela). */
export function estadoDoLink(p: { situacao: string; venceEm: Date | string; bloqueadaEm?: Date | string | null }, agora = Date.now()): EstadoDoLink {
  if (p.bloqueadaEm) return 'bloqueado';
  switch (p.situacao) {
    case 'proposta':
      return new Date(p.venceEm).getTime() > agora ? 'proposta' : 'venceu';
    case 'autorizada':
    case 'executando':
      return 'fazendo';
    case 'feita':
      return 'feito';
    case 'nao_deu':
      return 'naodeu';
    case 'recusada':
      return 'recusou';
    default:
      return 'venceu';
  }
}

/** As tentativas que ainda restam neste link (nunca negativo). */
export const tentativasQueRestam = (pinErros: unknown) => Math.max(0, PIN_TENTATIVAS - (Number(pinErros) || 0));

/**
 * O que a página mostra da proposta: o título, o que vai acontecer em itens curtos, a linha do alvo e o valor. Cada
 * procedimento de PIN do catálogo traz o seu (a F4.2b, cancelar com o estorno); o que não tem apresentação mostra o nome.
 */
export function apresentacaoDaProposta(procedimento: string): { titulo: string; itens: string[]; detalhe: string | null; valor: number | null; botao: string } {
  const nome = (PROCEDIMENTOS as Record<string, Procedimento | undefined>)[procedimento]?.nome;
  return { titulo: nome ? `Autorizar: ${nome}?` : 'Autorizar o pedido do Mister?', itens: [], detalhe: null, valor: null, botao: 'Autorizar' };
}

export const TEXTOS_DO_LINK = {
  /** O rótulo do botão de link na conversa (até 20 letras). */
  botao: 'Abrir no Regem',
  autorizada: 'Autorizado no Regem, com o seu PIN. Estou fazendo agora; aviso aqui quando terminar.',
  recusada: 'Certo: você não autorizou no Regem. Nada foi feito.',
  bloqueada: 'O link foi bloqueado: o PIN foi digitado errado 5 vezes. Nada foi feito. Para tentar de novo, me peça outra vez. Se não foi você, avise o suporte.',
  /** A frase do PIN errado na página. */
  pinErrado: (restam: number) =>
    restam === 1 ? 'O PIN não confere. Resta 1 tentativa.' : `O PIN não confere. Restam ${restam} tentativas.`,
  pinFormato: 'Digite o seu PIN do Regem (de 4 a 6 dígitos).',
  naoVale: 'Este link não vale. Peça de novo ao Mister.',
  /** A resposta a quem tenta autorizar pela conversa o que pede o PIN (a conversa 6 do protótipo). */
  soPeloLink: (nome: string) => `Por aqui eu não consigo, ${nome}: é o tipo de coisa que pede o seu PIN. Toque em "Abrir no Regem".`,
  /** A proposta de PIN que venceu sem resposta (a conversa 6, parte 4). */
  vencida: (oQue: string, hora: string) => `O pedido de autorização ${oQue} venceu às ${hora} sem resposta. Nada foi feito. Se ainda precisar, é só me pedir de novo.`,
};

// ───────────────────────────── cancelar o pedido com o estorno (F4.2b) ─────────────────────────────

/** O pedido como a página e a conversa o mostram — lido do banco na hora; do cliente, só o nome curto (como no painel). */
export interface PedidoDoCancelamento {
  /** O nome do pedido como no quadro do Mister ("#12 · iFood 5120"). */
  nome: string;
  /** O canal como na tela ("iFood", "Cardápio digital"). */
  canal: string;
  /** O canal é uma plataforma de fora (iFood, 99…): o cancelamento também vai para ela. */
  canalExterno: boolean;
  cliente: string | null;
  total: number;
  /** Pago no Pix pelo gateway da loja: o estorno sai pela rotina da nuvem (`pedido_estorno`). */
  pagoNoPix: boolean;
  /** O gateway como na tela ("Mercado Pago"). */
  provedor: string | null;
}

export const PROVEDOR_NA_TELA: Record<string, string> = { mercadopago: 'Mercado Pago', pagseguro: 'PagBank', rede: 'Rede' };
/** As plataformas de fora, que recebem o cancelamento do serviço do painel (o `statusBack` de cada uma). Lista explícita:
 *  canal desconhecido não ganha a frase "cancelado também no …". */
export const CANAIS_DE_FORA = ['ifood', '99food', 'anotaai', 'keeta', 'rappi', 'cardapio_web', 'delivery_direto'];

/** O nome curto do cliente, como no painel: o primeiro nome e a inicial do último ("Mariana S."). */
export function nomeCurtoDoCliente(nome: unknown): string | null {
  const partes = String(nome ?? '').trim().split(/\s+/).filter(Boolean);
  if (!partes.length) return null;
  return partes.length === 1 ? partes[0] : `${partes[0]} ${partes[partes.length - 1].charAt(0).toUpperCase()}.`;
}

const reaisDoCancelamento = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** O que a página do link mostra do cancelamento: o que vai acontecer, em itens curtos que o serviço do painel sustenta. */
export function apresentacaoDoCancelamento(p: PedidoDoCancelamento): { titulo: string; itens: string[]; detalhe: string | null; valor: number | null; botao: string } {
  return {
    titulo: `Cancelar o pedido ${p.nome}?`,
    detalhe: [p.canal, p.cliente ? `cliente ${p.cliente}` : null, p.pagoNoPix ? 'pago por Pix' : null].filter(Boolean).join(' · ') || null,
    valor: p.total,
    itens: [
      p.canalExterno ? `O pedido é cancelado no Regem e no ${p.canal}.` : 'O pedido é cancelado no Regem.',
      p.pagoNoPix ? `O estorno do Pix é pedido ao ${p.provedor ?? 'gateway do Pix'}.` : 'Não houve Pix pago pelo Regem: nenhum estorno é pedido por aqui.',
    ],
    botao: 'Autorizar o cancelamento',
  };
}

export const TEXTOS_DO_CANCELAMENTO = {
  /** A mensagem que vai com o botão "Abrir no Regem". */
  link: (p: PedidoDoCancelamento, hora: string) =>
    `Para cancelar o pedido ${p.nome} (${reaisDoCancelamento(p.total)}${p.pagoNoPix ? ', Pix já pago' : ''}), a autorização é no Regem, com o seu PIN. O pedido vale até ${hora}.`,
  /** "do cancelamento do pedido #12", para a frase da proposta vencida. */
  doCancelamento: (nome: string) => `do cancelamento do pedido ${nome}`,
  feito: (p: PedidoDoCancelamento) =>
    `O pedido ${p.nome} foi cancelado no Regem${p.canalExterno ? ` e no ${p.canal}` : ''}${p.pagoNoPix ? `, e o estorno do Pix foi pedido ao ${p.provedor ?? 'gateway'}` : ''}. Autorizado por você, com o PIN.`,
  estornoFalhou: (p: PedidoDoCancelamento, erro: string | null) =>
    `o pedido ${p.nome} foi cancelado, mas o estorno do Pix não saiu${erro ? ` (${erro.slice(0, 160)})` : ''}. Um caso urgente entrou em Atendimento para devolver o dinheiro à mão.`,
  estornoNaFila: (p: PedidoDoCancelamento) =>
    `o pedido ${p.nome} foi cancelado, mas o estorno do Pix ainda não saiu no ${p.provedor ?? 'gateway'}. O Regem tenta de novo sozinho; se não sair, um caso urgente entra em Atendimento.`,
  // O caminho do menu conferido no `shell.tsx` (V65): o pedido se cancela em Delivery › Painel.
  naoCancelou: (p: PedidoDoCancelamento) => `o pedido ${p.nome} não aparece como cancelado. Confira em Delivery › Painel.`,
  recusado: (motivo: string) => `${motivo.charAt(0).toLowerCase()}${motivo.slice(1)} Nada foi feito.`,
};
