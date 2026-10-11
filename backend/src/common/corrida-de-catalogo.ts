// SÓ PARA SPECS — repetir quando a conferência de uma migration corre com o DDL de outra spec.
//
// Algumas migrations terminam com uma conferência que lê o catálogo do banco INTEIRO: a 295 e a 303
// usam `pg_indexes … indexdef` (a definição de todo índice, de todo schema) e a 298 usa
// `pg_get_constraintdef` filtrando pelo NOME da restrição — e cada spec tem, no schema dela, uma
// restrição com esse mesmo nome. Para montar a definição o Postgres abre a TABELA do vizinho, e
// espera a trava dela. As specs rodam em paralelo no mesmo banco, cada uma criando e apagando o
// seu schema, e cada arquivo de migration é uma transação só (o DDL e a conferência juntos). Daí
// saem dois erros, os dois reproduzidos rodando as specs da API de integração em paralelo:
//
//   • o vizinho está APAGANDO o schema: a espera acaba, a tabela não existe mais, e o Postgres
//     responde `could not open relation with OID n` (ERR-194; três vezes no CI, na linha da 295;
//     em 10/10/2026 também na da 298 e na leitura de `indexdef` da spec dos cupons);
//   • o vizinho está NO MEIO da mesma migration: ele segura a tabela dele e espera a nossa, nós
//     seguramos a nossa e esperamos a dele — impasse, e o Postgres derruba um dos dois (código
//     40P01; a mensagem vem no idioma do servidor, o código não).
//
// Não é defeito da migration nem do código da venda — na nuvem a migration roda sozinha. As
// migrations são idempotentes e o arquivo roda numa transação só (falhou, nada ficou): a saída é
// rodar de novo. Qualquer OUTRO erro sobe na hora.

const IMPASSE = '40P01';

export const ehCorridaDeCatalogo = (erro: unknown): boolean =>
  (erro as any)?.code === IMPASSE || /could not open relation with OID/i.test(String((erro as any)?.message ?? ''));

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
