// O que as telas dizem sobre o PROGRAMA da ponte do chat (o do PC da loja, `ponte-chat/`), num lugar só: o nome do item
// do menu tem de ser o mesmo do programa (`ponte-chat/src/main.js`, menu do ícone perto do relógio) — V65.

/** Onde se retoma a ponte pausada no PC (mig 368). */
export const COMO_RETOMAR_A_PONTE = 'Para retomar, no PC da ponte: ícone da ponte perto do relógio › Retomar a ponte neste PC.';

/** A 99 "só lendo" (a ponte até a 0.7.7 nascia assim — ERR-543): onde se liga a resposta pela 99 no PC da ponte. */
export const COMO_RESPONDER_PELA_99 = 'para a resposta sair por ela, no PC da ponte: ícone da ponte perto do relógio › Responder pela 99 neste PC';

// O chat da 99 que não abre (ERR-556): as MESMAS frases de `backend/src/modules/ponte-chat/chat-indisponivel.ts` (a spec confere).
/** A mensagem está esperando o chat da 99 voltar. */
export const CHAT_DA_99_NAO_ABRIU = 'o chat da 99 não abriu agora: o Regem tenta de novo sozinho por até 30 min';
/** Passaram os 30 min e o chat não voltou. */
export const CHAT_DA_99_FORA_30_MIN = 'o chat da 99 não abriu por 30 min: fale com o cliente pelo app da 99';
/** A fala da equipe que esperava, e a loja já falou com o cliente pelo app. */
export const LOJA_JA_FALOU_PELO_APP = 'a loja falou com o cliente pelo app antes de o chat voltar: esta mensagem não saiu';
