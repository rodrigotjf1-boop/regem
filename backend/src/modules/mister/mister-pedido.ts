// PEDIR AO PRESIDENTE (Mister, versão 10, fase C6b — decisão V10-6, "peço a quem pode"; protótipo `mockups/regem-mister-v10.html`,
// "Quando não dá", caso "O seu perfil não pode"; `docs/plano-mister.md` § "C6b").
//
// O gerente pede o que o perfil dele não faz (pagar o entregador, guardar o saldo). O Regem confere a MESMA ação como se o
// presidente pedisse; passando, o gerente recebe "Pedir ao presidente" e "Agora não". No toque, a proposta da ação nasce para
// o presidente (só ele autoriza, com o botão ou o PIN de sempre) e vai ao WhatsApp dele — fora da janela de 24 horas, pelo
// modelo do aviso, e o toque traz o pedido. O gerente fica sabendo do desfecho. Quem pediu fica nos parâmetros da proposta
// (sem migration). Nasce desligado (`MISTER_PEDIR_AO_PRESIDENTE=1`).

/** O procedimento da proposta do GERENTE (o toque em "Pedir ao presidente" manda o pedido). */
export const PROCEDIMENTO_DO_PEDIDO = 'pedir_ao_presidente' as const;
/** Os botões que o gerente recebe. */
export const BOTOES_DO_PEDIDO = { autorizar: 'Pedir ao presidente', naoAgora: 'Agora não' } as const;
/** Quanto tempo o gerente tem para tocar em "Pedir ao presidente". */
export const PRAZO_DO_PEDIDO_MIN = 30;
/** Quanto tempo o presidente tem para responder ao pedido (a proposta da ação para ele). */
export const PRAZO_DO_PRESIDENTE_MIN = 120;

/** O liga/desliga da distribuição. */
export const pedirAoPresidenteLigado = (): boolean => process.env.MISTER_PEDIR_AO_PRESIDENTE === '1';

const primeiro = (nome: unknown): string => String(nome ?? '').trim().split(/\s+/)[0] || 'o presidente';

export const TEXTOS_DO_PEDIDO = {
  /** O caminho que vai na recusa (a IA diz que os botões chegam logo depois). */
  caminho: (presidente: string) => `pedir ao presidente (${primeiro(presidente)}): os botões "Pedir ao presidente" e "Agora não" vão logo depois da sua resposta`,
  /** A pergunta ao gerente, com os botões. */
  perguntaAoGerente: (presidente: string, resumo: string) =>
    `Posso pedir a ${primeiro(presidente)}, com o pedido pronto:\n${resumo}\n\nEle autoriza pelo WhatsApp dele. Toque em "Pedir ao presidente" em até ${PRAZO_DO_PEDIDO_MIN} minutos.`,
  /** O toque do gerente em "Pedir ao presidente" (antes de mandar). */
  pedindo: 'Mandando o pedido ao presidente…',
  /** O toque do gerente em "Agora não". */
  naoPediu: 'Certo, não peço nada ao presidente.',
  /** O que vai ao presidente, antes da pergunta (ou do link) de sempre. */
  aoPresidente: (gerente: string) => `📨 Pedido de ${primeiro(gerente)} (gerente). Só você autoriza:`,
  /** O título do modelo fora da janela de 24 horas (sem valores: o modelo é um texto curto aprovado pela Meta). */
  tituloDoModelo: (gerente: string) => `${primeiro(gerente)} pediu a sua autorização`,
  /** O desfecho do pedido ao gerente (a proposta do gerente). */
  pedido: (presidente: string) => `pedi a ${primeiro(presidente)}. Te aviso quando ele responder.`,
  pedidoSemPresidente: 'o presidente não fala mais com o Mister por este número. Nada foi pedido.',
  pedidoRecusadoNaConferencia: (erro: string) => `o pedido não passou na conferência do presidente: ${erro} Nada foi pedido.`,
  pedidoNaoSaiu: 'o pedido não chegou ao WhatsApp do presidente. Nada foi pedido; tente de novo daqui a pouco.',
  /** O que o gerente recebe quando o presidente responde. */
  presidenteFez: (presidente: string, resultado: string) => `✅ ${primeiro(presidente)} autorizou o seu pedido: ${resultado}`,
  presidenteNaoDeu: (presidente: string, resultado: string) => `${primeiro(presidente)} autorizou o seu pedido, mas não deu: ${resultado}`,
  presidenteRecusou: (presidente: string, resumo: string) => `${primeiro(presidente)} não autorizou o seu pedido: ${resumo}`,
  presidenteNaoRespondeu: (resumo: string) => `O presidente não respondeu a tempo, e o pedido venceu: ${resumo} Nada foi feito.`,
} as const;

/** Os parâmetros que a proposta da ação do PRESIDENTE leva sobre quem pediu. */
export interface QuemPediu {
  pedidaPor: string;
  pedidaPorNome: string;
}

/** O resumo do pedido ("o que vou fazer"), guardado nos parâmetros da proposta do presidente — ou um texto genérico. */
export function resumoGuardado(parametros: unknown): string {
  const p = (parametros && typeof parametros === 'object' ? parametros : {}) as Record<string, unknown>;
  const r = typeof p.resumoDoPedido === 'string' ? p.resumoDoPedido.trim() : '';
  return r ? r.slice(0, 400) : 'a ação que você pediu.';
}

/** Quem pediu, lido dos parâmetros da proposta (ou null se a proposta não é um pedido). */
export function quemPediu(parametros: unknown): QuemPediu | null {
  const p = (parametros && typeof parametros === 'object' ? parametros : {}) as Record<string, unknown>;
  const id = typeof p.pedidaPor === 'string' ? p.pedidaPor : '';
  return /^[0-9a-f-]{36}$/i.test(id) ? { pedidaPor: id, pedidaPorNome: String(p.pedidaPorNome ?? '') } : null;
}
