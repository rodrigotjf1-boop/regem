'use strict';

// O CHAT DO iFood por dentro (Sendbird). Cada quadro do WebSocket do chat é um COMANDO de 4 letras colado num JSON
// ("MESG{...}", "LOGI{...}", "READ{...}"). Conferido em 04/11/2026 com mensagens reais no Gestor (só a forma, nada
// guardado):
//  • a mensagem chega como MESG; quem mandou está em `user.metadata.type`: "CUSTOMER" (o cliente) ou "MERCHANT" (a loja —
//    também o que a equipe escreve no Gestor de OUTRO PC);
//  • chega repetida, uma vez por conexão que o Gestor mantém aberta: a chave é o `msg_id`;
//  • o aviso "Sua loja não costuma responder" o próprio Gestor desenha — não vem por aqui;
//  • a conversa é POR PEDIDO: o canal é `sendbird_gc_cm_<id do pedido no iFood>_<id da loja no iFood>` (conferido em
//    04/11 na lista de conversas do Gestor — o 1º id é o `metadata.orderId` em todas — e no Regem: é o `external_id`
//    do pedido). Assim cada mensagem já diz o pedido.

/** "MESG{...}" → { cmd: 'MESG', corpo: {...} }; o que não é comando + JSON → null. */
function lerQuadro(payload) {
  const s = typeof payload === 'string' ? payload : '';
  const m = /^([A-Z]{4})(\{[\s\S]*\})\s*$/.exec(s);
  if (!m) return null;
  try {
    return { cmd: m[1], corpo: JSON.parse(m[2]) };
  } catch {
    return null;
  }
}

const AUTOR = { CUSTOMER: 'cliente', MERCHANT: 'loja' };
const CANAL_DO_PEDIDO = /^sendbird_gc_cm_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})_([0-9a-f-]+)$/i;

/** O id do pedido no iFood que o canal da conversa traz — ou null (canal de outra forma). */
function pedidoDoCanal(canal) {
  const m = typeof canal === 'string' ? CANAL_DO_PEDIDO.exec(canal) : null;
  return m ? m[1] : null;
}

/** O id da LOJA no iFood (a 2ª parte do canal) — ou null. */
function lojaDoCanal(canal) {
  const m = typeof canal === 'string' ? CANAL_DO_PEDIDO.exec(canal) : null;
  return m ? m[2].toLowerCase() : null;
}

/**
 * Os AVISOS AUTOMÁTICOS do iFood que chegam pela conta da loja e só a loja vê ("O cliente fez 3 pedidos nos últimos 30
 * dias" — visto em 05/11 no #8916; e os da mesma família: primeiro pedido, taxa de resposta). Pelo TEXTO: a conta da loja
 * também traz a 1ª fala da equipe numa conversa nova (06/11), e essa tem de chegar ao Atendimento.
 */
const AVISOS_DO_IFOOD = [
  /pedidos?\s+nos\s+[uú]ltimos\s+\d+\s+dias/i,
  /primeiro\s+pedido\s+(do|deste|desse)\s+cliente/i,
  /taxa\s+de\s+resposta/i,
  /n[aã]o\s+costuma\s+responder/i,
];
function ehAvisoDoIfood(texto) {
  return typeof texto === 'string' && AVISOS_DO_IFOOD.some((r) => r.test(texto));
}

/**
 * Uma mensagem do chat no formato da ponte (do quadro ao vivo ou do histórico) — ou null (sem remetente conhecido, sem
 * texto, apagada). A CONTA da loja (o id da loja, 2ª parte do canal — não uma pessoa) manda duas coisas como MERCHANT:
 * o AVISO AUTOMÁTICO do iFood (visto ao vivo em 05/11 no #8916) e a 1ª mensagem de uma conversa nova — a da equipe no
 * Gestor e a da própria ponte (ERR-381). As duas vêm marcadas `avisoDaPlataforma` (o eco só vale pelo texto exato); só o
 * aviso do iFood vem marcado `avisoDoIfood` — é o que fica fora do Atendimento.
 */
function mensagemDoChat({ id, tipo, remetente, nome, texto, canal, em, removida }) {
  const autor = AUTOR[tipo];
  const msgId = id === undefined || id === null ? '' : String(id);
  const corpo = typeof texto === 'string' ? texto : '';
  if (!autor || !msgId || !corpo.trim() || removida === true) return null;
  const quem = typeof remetente === 'string' && remetente ? remetente.toLowerCase() : null;
  const loja = lojaDoCanal(canal);
  const daContaDaLoja = autor === 'loja' && !!quem && !!loja && quem === loja;
  return {
    id: msgId,
    autor,
    texto: corpo,
    canalDoChat: typeof canal === 'string' ? canal : null,
    pedidoExterno: pedidoDoCanal(canal),
    // o nome do cliente como o iFood mostra ("Carine S."); da loja não interessa
    cliente: autor === 'cliente' && typeof nome === 'string' && nome.trim() ? nome.trim() : null,
    em: typeof em === 'number' ? em : null,
    avisoDaPlataforma: daContaDaLoja,
    avisoDoIfood: daContaDaLoja && ehAvisoDoIfood(corpo),
  };
}

/**
 * A mensagem de um quadro MESG que CHEGOU, no formato que a nuvem recebe — ou null (outro comando, sem remetente
 * conhecido, sem texto, apagada).
 */
function mensagemDoQuadro(q) {
  if (!q || q.cmd !== 'MESG' || !q.corpo || typeof q.corpo !== 'object') return null;
  const c = q.corpo;
  const usuario = c.user && typeof c.user === 'object' ? c.user : null;
  return mensagemDoChat({
    id: c.msg_id,
    tipo: usuario && usuario.metadata && typeof usuario.metadata === 'object' ? usuario.metadata.type : null,
    remetente: usuario ? usuario.user_id || usuario.guest_id : null,
    nome: usuario ? usuario.name : null,
    texto: c.message,
    canal: c.channel_url,
    em: typeof c.ts === 'number' ? c.ts : c.created_at,
    removida: c.is_removed,
  });
}

/**
 * As mensagens do HISTÓRICO de uma conversa — a resposta de `…/v3/group_channels/<canal>/messages` que o Gestor pede ao
 * abrir a conversa (`{ messages: [...], has_next }`; o `message_id` é o mesmo `msg_id` do quadro ao vivo). Só as de
 * texto (`type` MESG ou sem tipo); o resto fica de fora.
 */
function mensagensDaResposta(json) {
  const lista = json && Array.isArray(json.messages) ? json.messages : [];
  const r = [];
  for (const x of lista.slice(0, 200)) {
    if (!x || typeof x !== 'object' || (x.type && x.type !== 'MESG')) continue;
    const u = x.user && typeof x.user === 'object' ? x.user : null;
    const m = mensagemDoChat({
      id: x.message_id,
      tipo: u && u.metadata && typeof u.metadata === 'object' ? u.metadata.type : null,
      remetente: u ? u.user_id : null,
      nome: u ? u.nickname || u.name : null,
      texto: x.message,
      canal: x.channel_url,
      em: x.created_at,
      removida: x.is_removed,
    });
    if (m) r.push(m);
  }
  return r;
}

/** Os ids já vistos (a mesma mensagem chega por mais de uma conexão). Guarda só os últimos `max`. */
class Vistos {
  constructor(max = 2000) {
    this.max = max;
    this.ids = new Set();
  }
  /** true na PRIMEIRA vez que o id aparece. */
  novo(id) {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.max) this.ids.delete(this.ids.values().next().value);
    return true;
  }
}

module.exports = { lerQuadro, mensagemDoQuadro, mensagensDaResposta, pedidoDoCanal, lojaDoCanal, ehAvisoDoIfood, Vistos };
