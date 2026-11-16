// AS PROPOSTAS DO MISTER (F4.1 de `docs/plano-mister.md`, "Propor e aprovar"; mig 428). O Mister propõe resolver um
// aviso por um procedimento deste CATÁLOGO FIXO — a IA não inventa ação —, o presidente autoriza na conversa, o Regem
// executa pelo MESMO serviço da tela e o Mister confere o efeito antes de dizer "feito". Puro: sem banco, sem rede.
//
// Dois níveis (conversas 5 e 6 do protótipo `mockups/regem-mister.html`): botão na conversa, só para baixo impacto (vale
// 10 minutos e uma vez); link com PIN, que abre o Regem, para dinheiro, cancelamento ou configuração (a F4.2). Até o perfil
// de permissões do fim do projeto, só o presidente autoriza.

import type { TipoDeAviso } from './mister-avisos.regras';

export type ProcedimentoDoMister = 'consultar_nota' | 'imprimir_teste';
export type NivelDaAutorizacao = 'botao' | 'pin';
export type SituacaoDaProposta = 'proposta' | 'autorizada' | 'recusada' | 'vencida' | 'executando' | 'feita' | 'nao_deu';

export interface Procedimento {
  id: ProcedimentoDoMister;
  /** O tipo de aviso que este procedimento resolve. */
  tipoDoAviso: TipoDeAviso;
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
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A proposta que um aviso aberto pede, com o alvo tirado da chave do aviso; null quando nenhum procedimento serve.
 *  • nota sem resposta: `nota:<id da nota>`;
 *  • impressora parada: `vigia:impressora_parada:srv:<servidor>:impressora:<id da impressora no servidor da loja>`.
 */
export function propostaDoAviso(a: { tipo: string; chave: string }): { procedimento: ProcedimentoDoMister; parametros: Record<string, string> } | null {
  if (a.tipo === 'nota_sem_resposta') {
    const id = /^nota:(.+)$/.exec(a.chave)?.[1] ?? '';
    return UUID.test(id) ? { procedimento: 'consultar_nota', parametros: { notaId: id } } : null;
  }
  if (a.tipo === 'impressora') {
    const m = /^vigia:impressora_parada:srv:([^:]+):impressora:(.+)$/.exec(a.chave);
    return m && m[1] && m[2] ? { procedimento: 'imprimir_teste', parametros: { servidorId: m[1], impressoraId: m[2] } } : null;
  }
  return null;
}

/** A pergunta que vai com o aviso, antes dos botões. */
export function perguntaDaProposta(p: ProcedimentoDoMister): string {
  const prazo = PROCEDIMENTOS[p].prazoMin;
  if (p === 'consultar_nota') return `Posso consultar esta nota de novo na SEFAZ? Leva alguns segundos. A pergunta vale por ${prazo} minutos.`;
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
export const botoesDaProposta = (propostaId: string) => [
  { id: idDoBotao(propostaId, true), titulo: BOTOES_DA_PROPOSTA.autorizar },
  { id: idDoBotao(propostaId, false), titulo: BOTOES_DA_PROPOSTA.naoAgora },
];

/** As respostas ao toque. */
export const TEXTOS_DA_PROPOSTA = {
  autorizada: (p: ProcedimentoDoMister) =>
    p === 'consultar_nota' ? 'Autorizado. Consultando a SEFAZ…' : 'Autorizado. Mandei a via de teste; confiro em alguns minutos.',
  recusada: 'Certo, não faço nada. O aviso continua aberto no Regem.',
  vencida: (hora: string) => `Essa pergunta valeu até as ${hora}. Se o aviso continuar, a próxima vez traz outra.`,
  jaRespondida: 'Essa pergunta já foi respondida.',
  soPresidente: 'Por enquanto, só o presidente da empresa autoriza por aqui. O aviso continua aberto no Regem.',
  naoAchada: 'Não achei essa pergunta. Ela pode ter vencido.',
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
};
