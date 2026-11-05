'use strict';

// AS REGRAS DO TEXTO QUE SAI PELO CHAT — as MESMAS da nuvem (`backend/src/modules/ponte-chat/texto-do-chat.ts`; V74: a
// mesma regra dos dois lados — `test/regras.test.js` compara as duas). O iFood e a 99 proíbem passar contato no chat
// (termo 3.3 do iFood): telefone, WhatsApp, Instagram, @ e link. Até 300 letras.

const TEXTO_MAX = 300;
const CONTATO_PROIBIDO = /(https?:\/\/|www\.|\.com\b|\.com\.br\b|wa\.me|whats|\bzap\b|\binsta(gram)?\b|@[a-z0-9_.]{3,}|\(?\d{2}\)?\s?9?\d{4}[-.\s]?\d{4})/i;

function temContatoProibido(texto) {
  return CONTATO_PROIBIDO.test(String(texto || ''));
}

/** O texto pode sair? Devolve o motivo em português, ou null. */
function motivoParaNaoEnviar(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!t) return 'escreva o texto';
  if (t.length > TEXTO_MAX) return `o texto tem no máximo ${TEXTO_MAX} letras`;
  if (temContatoProibido(t)) return 'o iFood e a 99 proíbem telefone, WhatsApp, Instagram ou link no chat';
  return null;
}

module.exports = { TEXTO_MAX, CONTATO_PROIBIDO, temContatoProibido, motivoParaNaoEnviar };
