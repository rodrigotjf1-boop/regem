// O CHAT DA 99 QUE NÃO ABRE (ERR-556, noite de 20/11/2026). A 99 ficou instável em ondas (a de 23:06 a 23:35 tirou até o app
// dela do ar): a conversa abria e não carregava por 45 s e, depois, mostrava "não é possível enviar mensagens". A ponte lia
// isso como "o pedido foi concluído" e a mensagem morria — com o pedido ainda em rota, e a conversa viva minutos depois.
//
// Quem sabe se o pedido acabou é o NOSSO cadastro, não a frase da tela. A decisão mora na NUVEM (vale com o deploy, para a
// ponte que já está na loja): o pedido encerrado segue falhando como antes; o pedido aberto volta para a fila e tenta de
// novo a cada `ESPERA_CHAT_INDISPONIVEL_S`, sem gastar as 3 tentativas, até a regra de sempre dos 30 min.

/** Quanto a mensagem espera antes de tentar de novo (cada tentativa com a 99 fora ocupa a janela dela por até ~50 s). */
export const ESPERA_CHAT_INDISPONIVEL_S = 120;

// Estas frases aparecem na tela do Atendimento: as mesmas em `frontend/src/lib/ponte-do-chat.ts` (a spec confere).
/** A mensagem está esperando o chat da 99 voltar. */
export const ERRO_CHAT_INDISPONIVEL = 'o chat da 99 não abriu agora: o Regem tenta de novo sozinho por até 30 min';
/** Passaram os 30 min e o chat não voltou. */
export const ERRO_CHAT_FORA_30_MIN = 'o chat da 99 não abriu por 30 min: fale com o cliente pelo app da 99';
/** A fala da equipe que esperava e a loja já falou com o cliente pelo app: não sai repetida nem fora de hora. */
export const ERRO_A_LOJA_JA_FALOU = 'a loja falou com o cliente pelo app antes de o chat voltar: esta mensagem não saiu';

/**
 * O que a ponte devolve quando a conversa da 99 não abriu ou não aceitou mensagem (`ponte-chat/src/envio-99.js`). Só o começo
 * da frase: a ponte 0.7.8 acrescenta o texto exato da 99 depois dele. Falha do programa, da busca ou do texto não entra.
 */
const SINAIS_DO_CHAT_FORA = [
  /^a 99 encerrou a conversa/i,
  /^a conversa aberta é a do \(sem número\)/i,
  /^a conversa da 99 não terminou de carregar/i,
  /^cliquei no botão do chat e a conversa não abriu/i,
  /^a conversa fechou antes de carregar/i,
];

export function pareceChatDa99Fora(erro: string | null | undefined): boolean {
  const e = String(erro ?? '').trim();
  return !!e && SINAIS_DO_CHAT_FORA.some((r) => r.test(e));
}
