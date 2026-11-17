import type { Pool } from 'pg';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PARA TESTE DE CORRIDA (só as specs usam). Disparar N chamadas em paralelo não prova uma corrida: no banco de teste
// elas acabam atendidas quase em fila e o código errado passa por sorte (V24; medido na segunda rodada da avaliação de
// segurança, 16/11/2026 — o teste dos "dez palpites" passava com o contador antigo). Isto força o cruzamento: segura as
// gravações de uma tabela (`update "<tabela>" …` que passa pelo pool) até `n` delas terem CHEGADO e solta todas juntas.
//
//  • no código que lê, decide e só depois grava, as N leituras já aconteceram quando a primeira gravação sai: todas
//    leram o mesmo valor — o defeito aparece sempre;
//  • no código que reserva na própria gravação, as N reservas saem juntas e o banco decide: só as que cabem passam.
//
// Se chegarem menos de `n` (o caminho certo pode gravar menos), o prazo solta as que esperam. Devolve o "desfazer".

export function juntarNaGravacao(pool: Pool, tabela: string, n: number, prazoMs = 600): () => void {
  const original = pool.query;
  const comeco = new RegExp(`^\\s*update\\s+"${tabela}"`, 'i');
  let chegaram = 0;
  let soltar!: () => void;
  const solta = new Promise<void>((resolver) => (soltar = resolver));
  const prazo = setTimeout(soltar, prazoMs);
  (pool as any).query = async function (this: Pool, ...args: any[]) {
    const texto = typeof args[0] === 'string' ? args[0] : String(args[0]?.text ?? '');
    if (comeco.test(texto)) {
      if (++chegaram >= n) soltar();
      await solta;
    }
    return (original as any).apply(pool, args);
  };
  return () => {
    clearTimeout(prazo);
    soltar();
    (pool as any).query = original;
  };
}
