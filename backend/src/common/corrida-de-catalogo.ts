// SÓ PARA SPECS — repetir quando a leitura do catálogo do Postgres corre com DDL de outra spec.
//
// Algumas migrations terminam com uma conferência que lê o catálogo do banco INTEIRO (a 295 usa
// `pg_indexes … indexdef`, que calcula a definição de todo índice, de todo schema). As specs rodam
// em paralelo no mesmo banco, cada uma criando e apagando o seu schema: se um índice some entre a
// listagem e a leitura, o Postgres responde `could not open relation with OID n`. Não é defeito da
// migration nem do código da venda — é a conferência concorrendo com o `drop schema` do vizinho.
// Visto três vezes no CI em dois dias (ERR-194), sempre na linha que roda a 295, com o job gêmeo
// (mesmo código) verde.
//
// As migrations são idempotentes e o arquivo roda numa transação só (falhou, nada ficou): a saída
// é rodar de novo. Qualquer OUTRO erro sobe na hora.

export const ehCorridaDeCatalogo = (erro: unknown): boolean =>
  /could not open relation with OID/i.test(String((erro as any)?.message ?? ''));

export async function repetirNaCorridaDeCatalogo<T>(
  rodar: () => Promise<T>,
  tentativas = 4,
  esperaMs = 200,
): Promise<T> {
  for (let i = 1; ; i++) {
    try {
      return await rodar();
    } catch (erro) {
      if (i >= tentativas || !ehCorridaDeCatalogo(erro)) throw erro;
      await new Promise((r) => setTimeout(r, esperaMs * i));
    }
  }
}
