// RITMO DO ENVIO (push) do servidor da loja (ERR-278, 22/10/2026).
//
// O envio sobe um lote por tabela, um de cada vez. Duas situações NÃO são falha de sincronização — o lote fica para o
// próximo ciclo, com o cursor parado:
//  • 429 "Já há um push deste dispositivo em curso": outro envio deste servidor ainda está na nuvem;
//  • o envio passou do tempo: a nuvem provavelmente recebeu e ainda está aplicando o lote.
// Antes, o envio que passava do tempo era REPETIDO na hora e batia na trava do primeiro (429); o ciclo inteiro contava
// como falha, o intervalo esticava até 5 min e a nuvem deixava de ver o servidor como vivo — pedidos de canal levando de
// 2 a 5 minutos para descer (medido em 21/10, depois de uma reinstalação que reenviava o que tinha sido restaurado).
// O lote que passou do tempo volta com a METADE das linhas (até um piso); o que dá certo volta a crescer até o teto.
// Adiado muitas vezes seguidas vira falha (aparece na saúde e na telemetria).
//
// SEM import de propósito: o teste avalia este arquivo como texto (como o achar-servidor.mjs).

/** Ciclos seguidos com o envio adiado até contar como falha (~10 min no ciclo de 1 min). */
export const ADIAMENTOS_ATE_FALHA = 10;
/** O menor lote depois de envios que passaram do tempo. */
export const LOTE_MINIMO = 20;

/** O erro é de tempo esgotado (a requisição saiu e a resposta não veio a tempo)? */
export function ehTempoEsgotado(causa) {
  return /aborted due to timeout|operation was aborted|TimeoutError|operation timed out/i.test(String(causa ?? ''));
}

/** Por que o envio desta tabela fica para o próximo ciclo — ou null, se o erro é outro (falha de verdade). */
export function motivoDoAdiamento(status, causa) {
  if (status === 429) return 'outro envio deste servidor ainda está na nuvem';
  if (ehTempoEsgotado(causa)) return 'o envio passou do tempo';
  return null;
}

/** O lote da próxima tentativa depois de um envio que passou do tempo: a metade, até o piso. */
export function loteDepoisDoTempoEsgotado(atual) {
  return Math.max(LOTE_MINIMO, Math.floor(Number(atual) / 2));
}

/** O lote depois de um envio que deu certo: o dobro, até o teto. */
export function loteDepoisDoSucesso(atual, teto) {
  return Math.min(Number(teto), Math.max(LOTE_MINIMO, Number(atual) * 2));
}

/** Adiado tantas vezes seguidas já é falha? */
export function adiamentoViraFalha(seguidos) {
  return Number(seguidos) >= ADIAMENTOS_ATE_FALHA;
}
