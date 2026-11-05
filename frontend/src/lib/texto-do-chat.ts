// O que a equipe escreve no chat do iFood e da 99 (ponte do chat, Etapa 2): a MESMA regra do servidor
// (`backend/src/modules/ponte-chat/texto-do-chat.ts` — um teste de lá compara as duas). A tela avisa antes de enviar; quem
// decide é o servidor.

export const TEXTO_MAX_DO_CHAT = 300;

/** Telefone, WhatsApp, Instagram ou link: a plataforma proíbe no chat (termo do iFood 3.3). */
export function temContatoProibido(texto: string): boolean {
  // "insta" só como palavra ("em instantes" passa); o telefone pede 10 ou 11 dígitos (o número do pedido passa).
  return /(https?:\/\/|www\.|\.com\b|\.com\.br\b|wa\.me|whats|\bzap\b|\binsta(gram)?\b|@[a-z0-9_.]{3,}|\(?\d{2}\)?\s?9?\d{4}[-.\s]?\d{4})/i.test(texto);
}
