/* eslint-disable @typescript-eslint/no-explicit-any */
import { voltaDaPausa } from '../../common/pausa-do-canal';

/**
 * A LOJA ESTÁ ATENDENDO AGORA? — o veredito conferido para o atendente virtual (15/11/2026, pedido do dono — ERR-471).
 *
 * Na quinta, sem luz, o dono fechou o iFood, a 99 e a Anota Aí, e o atendente do Instagram dizia "estamos abertos": o
 * `consultar_loja` só olhava o horário e o botão do cardápio digital — dado fixo. Agora ele confere o que o Regem SABE da
 * loja real, sem consulta nova a cada mensagem (tudo já está no banco):
 *  • a situação da loja na 99 — chega pelo aviso assinado `shopStatus` (`integracoes/food99/situacao-99.ts`);
 *  • a pausa que o Regem pôs no iFood ou na 99 ("⏸ Pausar" do Delivery, `pausa_canal`);
 *  • o sinal do servidor da loja (`edge_status`): sem sinal há mais de 10 min = a loja pode estar sem energia ou internet.
 *
 * Regra — só REBAIXA, nunca promove (o "fechado pelo horário" continua como sempre foi):
 *  • cardápio fechado (horário, pausa, botão): nada muda — veredito null;
 *  • algum aplicativo conhecido ABERTO: aberta;
 *  • todos os aplicativos conhecidos fechados/pausados/desconectados (pelo menos um): FECHADA — mesmo dentro do horário;
 *  • nenhum aplicativo conhecido e o servidor da loja sem sinal: INCERTA — o atendente não afirma, confere com a equipe;
 *  • senão: aberta (como hoje).
 */

export type EstadoDoCanal = 'aberta' | 'pausada' | 'fechada' | 'desconectada' | 'fora_do_horario' | 'bloqueada' | 'sem_entregador';

export type SinalDoCanal = {
  /** Como o atendente fala do canal ("99", "iFood"). */
  nome: string;
  estado: EstadoDoCanal;
  motivo: string | null;
  /** Até quando (ISO), se quem disse sabe. */
  ate: string | null;
  /** Quem disse: a própria plataforma ou a pausa feita pelo Regem. */
  fonte: 'plataforma' | 'regem';
};

export type SituacaoConferida = {
  veredito: 'aberta' | 'fechada' | 'incerta' | null;
  /** Cada aplicativo que o Regem conhece agora, em palavras. */
  canais: { nome: string; situacao: string }[];
  servidorDaLoja: 'ok' | 'sem_sinal' | null;
  /** Fechada agora: o motivo (quando um aplicativo disse) e a volta em palavras ("às 21:40"), só se todos disserem. */
  motivo: string | null;
  ate: string | null;
  comoResponder: string | null;
};

const EM_PALAVRAS: Record<EstadoDoCanal, string> = {
  aberta: 'aberta',
  pausada: 'pausada',
  fechada: 'fechada',
  desconectada: 'sem conexão (o aparelho da loja caiu)',
  fora_do_horario: 'fora do horário',
  bloqueada: 'bloqueada pela plataforma',
  sem_entregador: 'fechada por falta de entregador',
};

/** O servidor da loja: sem linha nenhuma = a loja não tem (null); a última batida há mais de `minutos` = sem sinal. */
export function sinalDoServidor(ultimaBatida: Date | string | null | undefined, agora: Date, minutos = 10): 'ok' | 'sem_sinal' | null {
  if (ultimaBatida == null) return null;
  const t = new Date(ultimaBatida).getTime();
  if (!Number.isFinite(t)) return null;
  return agora.getTime() - t > minutos * 60_000 ? 'sem_sinal' : 'ok';
}

/** A volta em palavras, no fuso da loja ("às 21:40", "amanhã às 00:30"); data inválida = null. */
function voltaEmPalavras(iso: string | null, agora: Date): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? voltaDaPausa(d, agora).texto : null;
}

export function vereditoDaLoja(e: {
  cardapioAberto: boolean;
  canais: SinalDoCanal[];
  servidor: 'ok' | 'sem_sinal' | null;
  agora?: Date;
}): SituacaoConferida {
  const agora = e.agora ?? new Date();
  const canais = e.canais.map((c) => {
    const volta = voltaEmPalavras(c.ate, agora);
    const situacao = c.fonte === 'regem' ? 'pausada pelo Regem' : EM_PALAVRAS[c.estado];
    return { nome: c.nome, situacao: volta && c.estado !== 'aberta' ? `${situacao}, volta ${volta}` : situacao };
  });
  const base = { canais, servidorDaLoja: e.servidor, motivo: null, ate: null, comoResponder: null };
  if (!e.cardapioAberto) return { ...base, veredito: null };
  // "Fora do horário" numa plataforma é o horário DELA, que a loja configura à parte — não diz que a loja parou (ERR-631,
  // teste do dono em 27/11: o horário do Regem estendido para um pedido de teste e a 99 fora do horário dela; o atendente
  // dizia "não estamos recebendo pedidos" com o cardápio aberto). Ele aparece na lista, mas não conta no veredito: quem
  // decide o horário do cardápio e do atendente é o horário do Regem. Fechada à mão, pausada e sem conexão continuam
  // contando (a quinta sem luz, ERR-471).
  const contam = e.canais.filter((c) => c.estado !== 'fora_do_horario');
  if (contam.some((c) => c.estado === 'aberta')) return { ...base, veredito: 'aberta' };
  if (contam.length) {
    const motivo = contam.map((c) => c.motivo).find(Boolean) ?? (contam.some((c) => c.estado === 'desconectada') || e.servidor === 'sem_sinal' ? 'um imprevisto na loja' : null);
    // Só promete a volta se TODOS os fechados disserem até quando — a mais tarde delas, em palavras.
    const ates = contam.map((c) => (c.ate && Number.isFinite(new Date(c.ate).getTime()) ? new Date(c.ate).toISOString() : null));
    const ate = ates.every(Boolean) ? voltaEmPalavras((ates as string[]).sort().slice(-1)[0], agora) : null;
    return {
      ...base,
      veredito: 'fechada',
      motivo,
      ate,
      comoResponder:
        'A loja NÃO está recebendo pedidos agora, mesmo dentro do horário (os aplicativos da loja estão fechados). Diga com carinho que no momento não estamos atendendo' +
        (motivo ? ` (motivo: ${motivo})` : '') +
        ', peça desculpas pelo transtorno e não monte pedido. ' +
        (ate ? 'Pode dizer até quando, pelo campo ate. ' : 'Não prometa hora de volta: diga que assim que voltarmos a loja avisa pelas redes, ou que ele pode chamar mais tarde. ') +
        'Nunca diga que estamos abertos.',
    };
  }
  if (e.servidor === 'sem_sinal')
    return {
      ...base,
      veredito: 'incerta',
      comoResponder:
        'Não deu para confirmar agora se a loja está atendendo (o sistema da loja está sem sinal). Não afirme que estamos abertos nem fechados: diga com gentileza que vai confirmar com a equipe e chame alguém. Se a equipe não estiver no horário, diga que pode haver um imprevisto na loja agora e que é melhor tentar de novo mais tarde.',
    };
  return { ...base, veredito: 'aberta' };
}

/**
 * Leva o veredito ao resumo do `consultar_loja`: fechada = `abertaAgora` false em tudo (o atendente já sabe o que fazer com
 * a loja fechada) e sem "abre às…" (a volta não é a do horário). Incerta e aberta não mudam o resumo — vão no campo
 * `situacaoConferida`, que as instruções mandam seguir.
 */
export function aplicarNoResumo<T extends Record<string, any>>(resumo: T, s: SituacaoConferida): T & { situacaoConferida: SituacaoConferida } {
  if (s.veredito !== 'fechada') return { ...resumo, situacaoConferida: s };
  const atende = { ...(resumo.atende ?? {}) };
  for (const k of Object.keys(atende)) if (atende[k]) atende[k] = { ...atende[k], abertaAgora: false };
  return { ...resumo, abertaAgora: false, proximaAbertura: null, atende, situacaoConferida: s };
}
