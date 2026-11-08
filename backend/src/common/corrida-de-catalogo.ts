// SÓ PARA SPECS — repetir quando a conferência de uma migration corre com o DDL de outra spec; e a trava de `empresa`
// que toda migration aplicada por spec no banco dividido leva na frente (no fim do arquivo).
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
//     40P01; a mensagem vem no idioma do servidor, o código não);
//   • a migration DESISTIU da espera: desde a 360 elas trazem `set local lock_timeout = '5s'` (na nuvem, desistir em vez
//     de enfileirar a escrita dos clientes atrás do `alter`). No banco dividido do CI, a tabela que a migration reaplicada
//     quer travar pode estar com outra spec por mais de 5 s, e o Postgres cancela (código 55P03, "canceling statement due
//     to lock timeout" — CI do #872: a `gestor-whatsapp-pg` caiu inteira reaplicando a 342/353/375/379; ERR-405).
//
// Não é defeito da migration nem do código da venda — na nuvem a migration roda sozinha. As
// migrations são idempotentes e o arquivo roda numa transação só (falhou, nada ficou): a saída é
// rodar de novo. Qualquer OUTRO erro sobe na hora (a linha duplicada, por exemplo).

const IMPASSE = '40P01';
const DESISTIU_DA_ESPERA = '55P03';

export const ehCorridaDeCatalogo = (erro: unknown): boolean =>
  (erro as any)?.code === IMPASSE ||
  (erro as any)?.code === DESISTIU_DA_ESPERA ||
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

// ── A trava da empresa na frente da migration (ERR-377) ─────────────────────────────────────────────────────────
// A limpeza das specs apaga a empresa de teste em CASCATA, e a cascata trava as filhas de `empresa` (umas 160) na
// ordem dos gatilhos dela — ordem que ninguém escolhe. Uma migration aplicada por spec no banco dividido que trava
// DUAS filhas numa transação (mesmo reaplicada, com o `create table if not exists` pulado: o índice trava uma, o
// `alter` trava a outra) na ordem contrária fecha o ciclo com essa limpeza, e o Postgres derruba um dos dois — quase
// sempre a limpeza da OUTRA spec, que não repete (CI de 05/11: a `pendencias-turno` caiu com a 353 reaplicada pela
// `atendimento-fila-pg`; reproduzido). Com `empresa` travada PRIMEIRO, quem apaga espera na porta, antes da cascata,
// e duas migrations não correm juntas (este modo de trava é exclusivo entre elas). A nuvem não muda: lá a migration
// roda sozinha, pelo MCP, sem este prefixo. Migration só de DML (328, 331) não trava tabela inteira: dispensa.
export const TRAVA_DA_EMPRESA = 'lock table empresa in share row exclusive mode';

/** Só comentário e espaço, nenhuma instrução — o corte de uma migration por `;` gera pedaços assim (o cabeçalho). */
const semInstrucao = (sql: string): boolean =>
  sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/;/g, '').trim() === '';

/** O texto da migration com a trava de `empresa` na frente: num `.query(...)` sozinho (com duas instruções ou mais, o
 *  Postgres roda o texto inteiro numa transação) ou logo depois do `begin`, antes de qualquer outra instrução. Texto sem
 *  instrução volta como veio: a trava sozinha ficaria fora de transação, e o Postgres a recusa. */
export const comTravaDaEmpresa = (sql: string): string => (semInstrucao(sql) ? sql : `${TRAVA_DA_EMPRESA};\n${sql}`);
