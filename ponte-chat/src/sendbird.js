'use strict';

// O CHAT DO iFood por dentro (Sendbird). Cada quadro do WebSocket do chat é um COMANDO de 4 letras colado num JSON
// ("MESG{...}", "LOGI{...}", "READ{...}"). Conferido em 04/11/2026 com mensagens reais no Gestor (só a forma, nada
// guardado):
//  • a mensagem chega como MESG; quem mandou está em `user.metadata.type`: "CUSTOMER" (o cliente) ou "MERCHANT" (a loja —
//    também o que a equipe escreve no Gestor de OUTRO PC);
//  • chega repetida, uma vez por conexão que o Gestor mantém aberta: a chave é o `msg_id`;
//  • o aviso "Sua loja não costuma responder" o próprio Gestor desenha — não vem por aqui.

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

/**
 * A mensagem de um quadro MESG que CHEGOU, no formato que a nuvem recebe — ou null (outro comando, sem remetente
 * conhecido, sem texto, apagada).
 */
function mensagemDoQuadro(q) {
  if (!q || q.cmd !== 'MESG' || !q.corpo || typeof q.corpo !== 'object') return null;
  const c = q.corpo;
  const usuario = c.user && typeof c.user === 'object' ? c.user : null;
  const tipo = usuario && usuario.metadata && typeof usuario.metadata === 'object' ? usuario.metadata.type : null;
  const autor = AUTOR[tipo];
  const id = c.msg_id === undefined || c.msg_id === null ? '' : String(c.msg_id);
  const texto = typeof c.message === 'string' ? c.message : '';
  if (!autor || !id || !texto.trim() || c.is_removed === true) return null;
  return {
    id,
    autor,
    texto,
    canalDoChat: typeof c.channel_url === 'string' ? c.channel_url : null,
    // o nome do cliente como o iFood mostra ("Carine S."); da loja não interessa
    cliente: autor === 'cliente' && typeof usuario.name === 'string' && usuario.name.trim() ? usuario.name.trim() : null,
    em: typeof c.ts === 'number' ? c.ts : typeof c.created_at === 'number' ? c.created_at : null,
  };
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

module.exports = { lerQuadro, mensagemDoQuadro, Vistos };
