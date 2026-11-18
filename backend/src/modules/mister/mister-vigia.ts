import { FUSO_OPERACAO, dataNoFuso, horaNoFuso, somarDias } from '../../common/data';
import { pareceSegredo } from './mister-agente.regras';

// O "FICA DE OLHO" E O LEMBRETE (versão 4, fase M4d, mig 452; protótipo `mockups/regem-mister-jeito-memoria.html`, aprovado
// pelo dono em 18/11/2026, decisão 8 — o padrão "heartbeat" do Hermes: só fala quando algo muda). As regras puras:
//  • Até 3 "fica de olho" e 10 lembretes ATIVOS por pessoa (o serviço confere com a trava da empresa — V98).
//  • O "fica de olho" vence no fim da noite de trabalho (06:00 da loja) e fala só quando o alvo muda; o lembrete fala uma
//    vez, na hora marcada (até 30 dias à frente).
//  • O texto do lembrete é uma linha de até 200 letras, sem link e sem senha/PIN/chave.

export const OLHOS_MAX = 3;
export const LEMBRETES_MAX = 10;
export const LEMBRETE_DIAS_MAX = 30;
export const ROTULO_DO_VIGIA_MAX = 200;
/** O fim da noite de trabalho: o "fica de olho" vale até esta hora da loja. */
export const HORA_DO_FIM_DA_NOITE = '06:00';

/** O instante de uma data e hora da loja ("2026-11-19", "10:00") — o fuso da operação, sem depender do do servidor. */
export function instanteNaLoja(dia: string, hora: string, fuso = FUSO_OPERACAO): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || !/^\d{2}:\d{2}$/.test(hora)) return null;
  const palpite = new Date(`${dia}T${hora}:00Z`);
  if (Number.isNaN(palpite.getTime())) return null;
  // O deslocamento do fuso naquele instante: as partes locais do palpite lidas como se fossem UTC, menos o palpite.
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: fuso, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(palpite)
      .map((p) => [p.type, p.value]),
  );
  const comoLocal = Date.UTC(Number(partes.year), Number(partes.month) - 1, Number(partes.day), Number(partes.hour), Number(partes.minute), Number(partes.second));
  const certo = new Date(palpite.getTime() - (comoLocal - palpite.getTime()));
  // Confere a volta (data que não existe, como 31/02, não volta igual).
  return dataNoFuso(certo) === dia && horaNoFuso(certo) === hora ? certo : null;
}

/** Até quando vale o "fica de olho": o próximo 06:00 da loja depois de agora. */
export function fimDaNoite(agora: Date): Date {
  const hoje = dataNoFuso(agora);
  const hojeAs6 = instanteNaLoja(hoje, HORA_DO_FIM_DA_NOITE)!;
  return hojeAs6.getTime() > agora.getTime() ? hojeAs6 : instanteNaLoja(somarDias(hoje, 1), HORA_DO_FIM_DA_NOITE)!;
}

/** O "quando" do lembrete como o modelo manda ("2026-11-19T10:00", hora da loja): no futuro e até 30 dias. */
export function lerQuando(texto: unknown, agora: Date): { quando: Date } | { erro: string } {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/.exec(String(texto ?? '').trim());
  if (!m) return { erro: 'Diga o dia e a hora do lembrete (AAAA-MM-DDTHH:MM, na hora da loja).' };
  const quando = instanteNaLoja(m[1], m[2]);
  if (!quando) return { erro: 'Essa data não existe. Diga o dia e a hora de novo.' };
  if (quando.getTime() <= agora.getTime() + 60_000) return { erro: 'Essa hora já passou. Diga uma hora daqui para frente.' };
  if (quando.getTime() > agora.getTime() + LEMBRETE_DIAS_MAX * 86_400_000) return { erro: `O lembrete vale até ${LEMBRETE_DIAS_MAX} dias à frente.` };
  return { quando };
}

/** O texto do lembrete: uma linha, até 200 letras, sem link e sem segredo. */
export function conferirTextoDoLembrete(texto: unknown): { texto: string } | { erro: string } {
  const t = String(texto ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return { erro: 'Diga do que é para lembrar.' };
  if (t.length > ROTULO_DO_VIGIA_MAX) return { erro: `O lembrete cabe em ${ROTULO_DO_VIGIA_MAX} letras.` };
  if (/https?:\/\/|www\./i.test(t)) return { erro: 'O lembrete não guarda link.' };
  if (pareceSegredo(t) || /\b(senha|pin)\b/i.test(t)) return { erro: 'O lembrete não guarda senha, PIN ou código.' };
  return { texto: t };
}

const DIA_DA_SEMANA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
/** "hoje às 10:00", "amanhã, 19/11, às 10:00", "sexta, 21/11, às 10:00" (na hora da loja). */
export function quandoNaConversa(quando: Date, agora: Date): string {
  const dia = dataNoFuso(quando);
  const hora = horaNoFuso(quando);
  const hoje = dataNoFuso(agora);
  const ddmm = `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
  if (dia === hoje) return `hoje às ${hora}`;
  if (dia === somarDias(hoje, 1)) return `amanhã, ${ddmm}, às ${hora}`;
  const semana = DIA_DA_SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()];
  return `${semana}, ${ddmm}, às ${hora}`;
}

// ───────────────────────────── o pedido (o alvo da parte 1) ─────────────────────────────

/** As situações do pedido do canal em que ele não muda mais: o "fica de olho" avisa e termina. */
export const SITUACOES_FINAIS_DO_PEDIDO = ['entregue', 'concluido', 'cancelado'];

/** O que aconteceu, para a frase ("O #284 · iFood 4821 saiu para entrega às 21:42."). */
const MUDOU_PARA: Record<string, string> = {
  novo: 'voltou para "aguardando aceite"',
  confirmado: 'foi aceito e está em preparo',
  pronto: 'ficou pronto',
  despachado: 'saiu para entrega',
  entregue: 'foi entregue',
  concluido: 'foi concluído',
  cancelado: 'foi cancelado',
};

/** A mensagem quando o pedido muda. `hora` = a hora daquela mudança na loja (ou null). */
export function textoDaMudancaDoPedido(rotulo: string, status: string, hora: string | null): string {
  const fim = SITUACOES_FINAIS_DO_PEDIDO.includes(status) ? ' Deixo de olhar este pedido.' : '';
  const icone = status === 'cancelado' ? '⚠️' : status === 'despachado' || status === 'entregue' || status === 'concluido' ? '✅' : '👀';
  return `${icone} O ${rotulo} ${MUDOU_PARA[status] ?? `mudou para "${status}"`}${hora ? ` às ${hora}` : ''}.${fim}`;
}

/** A mensagem do lembrete na hora marcada. */
export function textoDoLembreteNaHora(rotulo: string): string {
  return `🔔 Lembrete que você pediu: ${rotulo}${/[.!?]$/.test(rotulo) ? '' : '.'}`;
}

/** A referência guardada do pedido do canal (o id dele) e a leitura de volta. */
export const referenciaDoPedido = (id: string) => `pe:${id}`;
export const idDaReferencia = (ref: unknown, prefixo = 'pe'): string | null => {
  const m = new RegExp(`^${prefixo}:([0-9a-f-]{36})$`, 'i').exec(String(ref ?? ''));
  return m ? m[1].toLowerCase() : null;
};

// ───────────────────────────── o caixa, a impressora e o canal (a parte 2) ─────────────────────────────

/** Os alvos do "fica de olho" (os mesmos da restrição da mig 452). */
export const ALVOS_DO_OLHO = ['pedido', 'caixa', 'impressora', 'canal'] as const;
export type AlvoDoOlho = (typeof ALVOS_DO_OLHO)[number];

/** O caixa aberto: olha até fechar (`cx:<id da sessão>`). */
export const referenciaDoCaixa = (id: string) => `cx:${id}`;
/** A impressora parada: olha até voltar a responder (`vi:<id do incidente do vigia>`). */
export const referenciaDaImpressora = (id: string) => `vi:${id}`;
/** O canal pausado: olha até reabrir (`canal:<ifood|food99|cardapio>:<loja ou "rede">`). */
export const referenciaDoCanal = (canal: string, unidadeId: string | null) => `canal:${canal}:${unidadeId ?? 'rede'}`;
export function canalDaReferencia(ref: unknown): { canal: string; unidadeId: string | null } | null {
  const m = /^canal:(ifood|food99|cardapio):(rede|[0-9a-f-]{36})$/i.exec(String(ref ?? ''));
  return m ? { canal: m[1].toLowerCase(), unidadeId: m[2].toLowerCase() === 'rede' ? null : m[2].toLowerCase() } : null;
}

/** O canal como a pessoa diz ("iFood", "99", "cardápio") → a chave da pausa; ou null. */
export function canalDito(dito: unknown): 'ifood' | 'food99' | 'cardapio' | null {
  const t = String(dito ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '');
  if (/ifood/.test(t)) return 'ifood';
  if (/^99|99food|food99/.test(t)) return 'food99';
  if (/cardapio|site|proprio/.test(t)) return 'cardapio';
  return null;
}

/** A mensagem quando o caixa, a impressora ou o canal muda. `hora` = a hora daquela mudança na loja (ou null). */
export function textoDaMudanca(alvo: string, rotulo: string, estado: string, hora: string | null): string {
  const as = hora ? ` às ${hora}` : '';
  if (alvo === 'pedido') return textoDaMudancaDoPedido(rotulo, estado, hora);
  if (alvo === 'caixa') return estado === 'fechada' ? `✅ O ${rotulo} fechou${as}.` : `👀 O ${rotulo} mudou: ${estado}.`;
  if (alvo === 'impressora') return estado === 'aberto' ? `⚠️ A ${rotulo} parou de novo${as}.` : `✅ A ${rotulo} voltou a responder${as}.`;
  if (alvo === 'canal') return estado === 'pausado' ? `⏸ O ${rotulo} foi pausado de novo${as}.` : `✅ O ${rotulo} voltou: a pausa acabou${as}.`;
  return `👀 ${rotulo}: ${estado}.`;
}

/** O estado em que o "fica de olho" de cada alvo termina (avisa e encerra). */
export function estadoFinal(alvo: string, estado: string): boolean {
  if (alvo === 'pedido') return SITUACOES_FINAIS_DO_PEDIDO.includes(estado);
  if (alvo === 'caixa') return estado === 'fechada';
  if (alvo === 'impressora') return estado !== 'aberto';
  if (alvo === 'canal') return estado === 'aberto';
  return false;
}
