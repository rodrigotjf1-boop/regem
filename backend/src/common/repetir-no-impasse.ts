import { pgRetryable } from './errors/pg-error';

// REPETIR NO IMPASSE (ERR-481). O Postgres derruba UMA das transações de um impasse (40P01) ou de uma falha de
// serialização (40001), e a que caiu volta inteira — nada dela ficou gravado. Repetir é seguro SÓ quando a transação é
// idempotente (o que ela grava tem chave e `on conflict`, e nada sai para fora antes do commit). Até 3 tentativas, com
// uma pausa curta e crescente (e um pouco de acaso, para as duas não se cruzarem de novo no mesmo instante). Qualquer outro
// erro, ou a terceira queda, sobe como veio.

export interface OpcoesDoImpasse {
  tentativas?: number;
  pausaMs?: number;
  /** Chamado antes de cada nova tentativa (o log do motivo — V11). */
  aoRepetir?: (tentativa: number, erro: unknown) => void;
}

export async function repetirNoImpasse<T>(fn: () => Promise<T>, o: OpcoesDoImpasse = {}): Promise<T> {
  const max = Math.max(1, o.tentativas ?? 3);
  for (let tentativa = 1; ; tentativa++) {
    try {
      return await fn();
    } catch (e) {
      if (tentativa >= max || !pgRetryable(e)) throw e;
      o.aoRepetir?.(tentativa, e);
      const pausa = (o.pausaMs ?? 50) * tentativa + Math.floor(Math.random() * 25);
      await new Promise((r) => setTimeout(r, pausa));
    }
  }
}
