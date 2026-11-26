/* eslint-disable @typescript-eslint/no-explicit-any */

// A RESPOSTA EM ANDAMENTO — contra a "conversa picotada" (16/11/2026, pedido do dono: "quando o cliente mandar uma
// mensagem e o atendimento estiver gerando resposta, e o cliente manda outra antes do atendente virtual responder, ele
// segura o envio da resposta, soma as mensagens, reavalia o contexto e retorna com uma resposta").
//
// Antes: a 1ª mensagem ia ao robô (o fluxo do n8n, com a IA); a 2ª, chegando enquanto a IA pensava, ia SOZINHA depois dos
// 3 s da junção e virava outra execução em paralelo — e o Regem mandava as DUAS respostas ao cliente, a 1ª sem saber da
// 2ª mensagem. Agora, por conversa (empresa + telefone), uma resposta por vez:
//  1. a mensagem que vai ao robô abre a "resposta em andamento" da conversa;
//  2. a mensagem de texto que chega enquanto ela está em andamento NÃO vai ao robô: espera, e marca a resposta como superada;
//  3. a resposta chega (`publico/bot/responder` → `fimDaResposta`): superada, ela NÃO sai — o Regem manda de novo ao robô
//     tudo o que o cliente escreveu (o que já tinha ido + o que esperou), com a marca dizendo que a resposta anterior não
//     foi enviada; a resposta DESSA vez é a que sai;
//  4. o cliente que segue escrevendo não fica sem resposta: depois de `MAX_SEGURADAS` vezes a resposta sai e o que chegou
//     vai em seguida; e a resposta que não chega no prazo (`ROBO_SEGURAR_MS`) solta o que esperava.
// Cada execução do fluxo chama o `responder` UMA vez (o nó de texto ou o de voz — conferido no fluxo exportado de 30/10):
// é isso que deixa ligar a resposta à mensagem sem campo novo no fluxo. Só o WhatsApp (oficial e por QR) e só texto (o
// mesmo critério da junção): o Direct e o Messenger respondem por outro caminho, e a mídia segue como antes.
// Em memória deste processo, como a junção (`juntar-mensagens.ts`): com mais de uma réplica, volta ao comportamento de antes.

export const MARCA_DA_RESPOSTA_SEGURADA =
  '[o cliente mandou mais mensagens enquanto você preparava a resposta — a sua resposta anterior NÃO foi enviada a ele. Responda considerando tudo o que ele escreveu abaixo:]';
/**
 * Quantas vezes seguidas a resposta é segurada antes de sair mesmo assim (o cliente que não para de escrever). Era 2 até
 * 26/11/2026: cada segurada soma uma rodada inteira do robô (30 a 60 s medidos), e três textos seguidos chegaram a 94 s
 * sem resposta. Com 1, o cliente espera no máximo duas rodadas; o que ele escrever depois vai em seguida.
 */
export const MAX_SEGURADAS = 1;
/**
 * Prazo padrão para a resposta chegar (era 40 s até 26/11/2026). Medido na loja piloto de 19 a 26/11: mediana 34 s, p90 50 s
 * e até 90 s com áudio. Com 40 s, a resposta lenta vencia o prazo, o Regem mandava tudo de novo ao robô EM PARALELO e as
 * duas respostas saíam (a velha também). 90 s cobre o áudio; `ROBO_SEGURAR_MS` continua mudando sem deploy.
 */
const PRAZO_PADRAO_MS = 90_000;
const PRAZO_MAXIMO_MS = 120_000;

type Entregar = (m: any) => Promise<any>;
interface Andamento {
  /** Os textos do cliente que esta resposta cobre (sem a marca). */
  textos: string[];
  ids: string[];
  entregueEm: number;
  /** As mensagens que chegaram depois — a resposta em andamento ficou velha. */
  fila: any[];
  seguradas: number;
  /** Como mandar de novo ao robô (o mesmo caminho da 1ª, com o porteiro da pausa). */
  reentregar: Entregar;
  timer: ReturnType<typeof setTimeout> | null;
}
const andamentos = new Map<string, Andamento>();
let relogio: () => number = () => Date.now();

/** Quanto a resposta pode demorar antes de soltar o que esperava (`ROBO_SEGURAR_MS`; 0 desliga tudo isto). */
export function prazoParaSegurar(): number {
  const bruto = process.env.ROBO_SEGURAR_MS;
  const n = Number(bruto === undefined || bruto === '' ? PRAZO_PADRAO_MS : bruto);
  return Number.isFinite(n) && n >= 0 ? Math.min(n, PRAZO_MAXIMO_MS) : PRAZO_PADRAO_MS;
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');
const chave = (tenantId: unknown, telefone: unknown) => `${String(tenantId ?? '')}:${soDigitos(telefone)}`;
const ehTexto = (m: any) => m?.tipo === 'text' || m?.tipo === 'interactive' || m?.tipo === 'poll';

/** Vale segurar esta mensagem? Só WhatsApp (oficial ou por QR), de um telefone, e texto (botão e enquete contam). */
export function valeSegurar(msg: any): boolean {
  if (msg?.provedor !== 'cloud' && msg?.provedor !== 'evolution') return false;
  if (!msg?.tenantId || !ehTexto(msg)) return false;
  const de = String(msg?.de ?? '');
  return /^\+?\d{8,15}$/.test(de.trim());
}

const textosDe = (m: any): string[] =>
  Array.isArray(m?.textosDoCliente) ? m.textosDoCliente.map(String) : [String(m?.texto ?? '')].filter((t) => t.trim());
const idsDe = (m: any): string[] =>
  Array.isArray(m?.mensagemIds) ? m.mensagemIds.map(String) : m?.mensagemId ? [String(m.mensagemId)] : [];

function largar(k: string): Andamento | null {
  const a = andamentos.get(k) ?? null;
  if (a?.timer) clearTimeout(a.timer);
  andamentos.delete(k);
  return a;
}

/** A mensagem que vai de novo ao robô: tudo o que o cliente escreveu, com a marca; os campos são os da mais nova. */
function juntarParaReavaliar(a: Andamento, marca: boolean): any {
  const nova = a.fila[a.fila.length - 1];
  const textos = [...a.textos, ...a.fila.flatMap(textosDe)];
  const ids = [...a.ids, ...a.fila.flatMap(idsDe)];
  return {
    ...nova,
    texto: marca ? `${MARCA_DA_RESPOSTA_SEGURADA}\n${textos.join('\n')}` : textos.join('\n'),
    textosDoCliente: textos,
    mensagensJuntadas: ids.length,
    mensagemIds: ids,
    respostaSegurada: a.seguradas + (marca ? 1 : 0),
  };
}

/** A mensagem que esperou vai ao robô SOZINHA (a resposta anterior sai ou já saiu): sem a marca, só o que ela disse. */
function soAFila(a: Andamento): any {
  const nova = a.fila[a.fila.length - 1];
  const textos = a.fila.flatMap(textosDe);
  const ids = a.fila.flatMap(idsDe);
  return { ...nova, texto: textos.join('\n'), textosDoCliente: textos, ...(ids.length > 1 ? { mensagensJuntadas: ids.length, mensagemIds: ids } : {}) };
}

/**
 * Entrega ao robô — ou segura, se a conversa já tem uma resposta em andamento (a mensagem espera a resposta chegar).
 * `entregar` é a entrega de verdade (ao n8n); `reentregar`, o caminho inteiro para mandar de novo (com o porteiro).
 * Nunca lança mais do que `entregar` lançaria. Devolve o que `entregar` devolveu, ou `true` quando segurou.
 */
export async function entregarSegurando(msg: any, entregar: Entregar, reentregar: Entregar = entregar): Promise<any> {
  const prazo = prazoParaSegurar();
  if (!prazo || !valeSegurar(msg)) return entregar(msg);
  const k = chave(msg.tenantId, msg.de);
  const agora = relogio();
  const a = andamentos.get(k);
  if (a && agora - a.entregueEm < prazo) {
    a.fila.push(msg);
    if (!a.timer) a.timer = setTimeout(() => void venceu(k).catch(() => {}), Math.max(0, a.entregueEm + prazo - agora));
    return true;
  }
  if (a) largar(k); // a anterior passou do prazo sem resposta: não espera mais por ela
  andamentos.set(k, {
    textos: textosDe(msg),
    ids: idsDe(msg),
    entregueEm: agora,
    fila: [],
    seguradas: Number(msg?.respostaSegurada) > 0 ? Number(msg.respostaSegurada) : 0,
    reentregar,
    timer: null,
  });
  let entregou: any;
  try {
    entregou = await entregar(msg);
  } catch (e) {
    largar(k);
    throw e;
  }
  // Não chegou ao robô (sem endereço, n8n fora): nenhuma resposta vai chegar — nada fica esperando por ela.
  if (entregou === false) {
    const sobrou = largar(k);
    if (sobrou?.fila.length) void reentregar(soAFila(sobrou)).catch(() => {});
  }
  return entregou;
}

/** A resposta não chegou no prazo: o que esperava vai ao robô (com o que já tinha ido — a resposta não veio). */
async function venceu(k: string): Promise<void> {
  const a = largar(k);
  if (!a?.fila.length) return;
  await a.reentregar(juntarParaReavaliar(a, true));
}

export type DecisaoDaResposta = 'enviar' | 'descartar';

/**
 * A resposta do robô chegou para esta conversa (o `publico/bot/responder`). 'descartar' = ela ficou velha (o cliente
 * escreveu depois que ela começou): NÃO sai, e tudo vai de novo ao robô. `podeResponder` = robô ligado e conversa sem
 * pessoa — sem isso a resposta não sai de qualquer jeito, e o que esperava vai ao robô sozinho, como antes.
 */
export function fimDaResposta(tenantId: unknown, telefone: unknown, podeResponder: boolean): DecisaoDaResposta {
  const k = chave(tenantId, telefone);
  const a = largar(k);
  if (!a || !a.fila.length) return 'enviar';
  if (!podeResponder || a.seguradas >= MAX_SEGURADAS) {
    void a.reentregar(soAFila(a)).catch(() => {});
    return 'enviar';
  }
  void a.reentregar(juntarParaReavaliar(a, true)).catch(() => {});
  return 'descartar';
}

/** Só para teste: a situação de uma conversa, o relógio e a limpeza. */
export function andamentoDe(tenantId: unknown, telefone: unknown): { fila: number; seguradas: number; textos: string[] } | null {
  const a = andamentos.get(chave(tenantId, telefone));
  return a ? { fila: a.fila.length, seguradas: a.seguradas, textos: [...a.textos] } : null;
}
export function trocarRelogio(r: (() => number) | null): void {
  relogio = r ?? (() => Date.now());
}
export function esquecerAndamentos(): void {
  for (const a of andamentos.values()) if (a.timer) clearTimeout(a.timer);
  andamentos.clear();
}
