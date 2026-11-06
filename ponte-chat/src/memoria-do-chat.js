'use strict';

// A MEMÓRIA DO QUE A LOJA JÁ MANDOU no chat de cada pedido — o que impede o envio EM DOBRO (v0.4). Antes de digitar um
// aviso da fila, a ponte pergunta: "esta mensagem da loja, com este texto, já está na conversa deste pedido depois que o
// aviso nasceu?" Se está (a ponte mandou e caiu antes de avisar a nuvem; ou alguém da loja mandou o mesmo texto), não
// digita de novo: dá por enviada com o id que a mensagem tem no chat.
// Alimentam a memória: as mensagens que chegam ao vivo (o quadro MESG — inclusive o eco do que a ponte mandou) e o
// HISTÓRICO que o Gestor carrega ao abrir a conversa (`…/messages`). Só da LOJA. Guarda o RESUMO do texto (sha-256), não o
// texto; só na memória do programa, com teto.
// 0.5.1 (ERR-381, 05/11 no Gestor de verdade): a 1ª mensagem de uma conversa NOVA sai pelo iFood (o `POST` do chat do pedido)
// e volta com o remetente = a CONTA da loja — a mesma cara do aviso automático do iFood ("Apenas você pode ver"). Ela
// também entra aqui: a busca é pelo texto EXATO do que a ponte mandou, que um aviso do iFood nunca tem.

const crypto = require('crypto');

/** O texto como a pessoa leria: sem espaço sobrando nas pontas nem repetido no meio. */
const normalizar = (t) => String(t || '').replace(/\s+/g, ' ').trim();
const resumo = (t) => crypto.createHash('sha256').update(normalizar(t)).digest('hex');

// Folga entre o relógio da nuvem (quando o aviso nasceu) e o do chat (quando a mensagem saiu).
const FOLGA_MS = 60000;

class MemoriaDoChat {
  constructor({ conversas = 300, porConversa = 40, agora = () => Date.now() } = {}) {
    this.maxConversas = conversas;
    this.maxPorConversa = porConversa;
    this.agora = agora;
    this.conversas = new Map(); // pedido (ou canal) → [{ id, resumo, em }]
  }

  /** A chave da conversa: o id do pedido no iFood (o canal o traz); sem ele, o próprio canal. */
  static chave(m) {
    const p = m && m.pedidoExterno ? String(m.pedidoExterno).toLowerCase() : null;
    return p || (m && m.canalDoChat) || null;
  }

  /**
   * Guarda uma mensagem (do quadro ao vivo ou do histórico). Só da loja — também a que vem da CONTA da loja (o aviso do iFood
   * e a 1ª mensagem de uma conversa nova têm a mesma cara): `jaEnviada` só acha pelo texto exato.
   */
  guardar(m) {
    if (!m || m.autor !== 'loja' || !m.id) return false;
    const k = MemoriaDoChat.chave(m);
    if (!k) return false;
    let lista = this.conversas.get(k);
    if (!lista) {
      lista = [];
      this.conversas.set(k, lista);
      if (this.conversas.size > this.maxConversas) this.conversas.delete(this.conversas.keys().next().value);
    }
    if (lista.some((x) => x.id === String(m.id))) return false;
    lista.push({ id: String(m.id), resumo: resumo(m.texto), em: typeof m.em === 'number' ? m.em : this.agora() });
    if (lista.length > this.maxPorConversa) lista.shift();
    return true;
  }

  /**
   * A mensagem da loja com ESTE texto na conversa deste pedido, de `desde` (com a folga dos relógios) em diante — ou null.
   * @param {{ pedidoExterno?: string, canal?: string, texto: string, desde?: number }} q
   */
  jaEnviada({ pedidoExterno, canal, texto, desde = 0 }) {
    const k = pedidoExterno ? String(pedidoExterno).toLowerCase() : canal;
    const lista = k ? this.conversas.get(k) : null;
    if (!lista || !normalizar(texto)) return null;
    const r = resumo(texto);
    const achada = lista.find((x) => x.resumo === r && x.em >= desde - FOLGA_MS);
    return achada ? { id: achada.id, em: achada.em } : null;
  }
}

module.exports = { MemoriaDoChat, normalizar, FOLGA_MS };
