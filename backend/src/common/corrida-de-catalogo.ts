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

// ── A migration que trava a MESMA tabela duas vezes, reaplicada com a tabela pronta (ERR-539) ──────────────────────
// A 344 reaplicada pula o `create table if not exists`, mas o `create index if not exists` trava a `robo_carrinho` em
// ShareLock até o fim da transação, e o `enable row level security` pede AccessExclusiveLock por cima. Outra spec que,
// numa transação, LEU o carrinho (AccessShareLock) e depois GRAVA nele (RowExclusiveLock — o `registrar` do robô) fecha
// um impasse que o Postgres não consegue reordenar: cada um já segura o que o outro pede. Ele derruba quem esperou
// primeiro, quase sempre a gravação da OUTRA spec, que não repete (CI de 19/11: o pedido agendado da `robo-pedido-pg`
// com a 344 reaplicada pela `pedir-avaliacao-pg`). A migration que pede a trava forte UMA vez só (`alter table … add
// column if not exists`) não fecha esse ciclo: a fila se reordena, ou o `lock_timeout` desiste e o
// `repetirNaCorridaDeCatalogo` repete. A saída: o arquivo desta lista só roda se a tabela dele ainda não existe —
// conferido DENTRO da transação da migration, depois da trava de `empresa` (quem cria e quem confere não correm juntos).
export const SO_QUANDO_FALTA_A_TABELA: Readonly<Record<string, string>> = { '344_robo_carrinho.sql': 'robo_carrinho' };

type Consulta = { query: (sql: string, valores?: unknown[]) => Promise<{ rows: any[] }> };

/** Logo depois do `begin` da transação da migration: `true` = o arquivo cria uma tabela que JÁ existe no schema em uso e
 *  deve ser pulado (ERR-539). Para o arquivo da lista, trava `empresa` antes de olhar (ERR-377). Arquivo fora da lista
 *  (o nome ou o caminho): `false`, sem consulta nenhuma. */
export async function migrationJaCriada(c: Consulta, arquivo: string): Promise<boolean> {
  const tabela = SO_QUANDO_FALTA_A_TABELA[arquivo.split(/[\\/]/).pop() ?? ''];
  if (!tabela) return false;
  await c.query(TRAVA_DA_EMPRESA);
  const { rows } = await c.query(`select to_regclass(current_schema() || '.' || $1) is not null as existe`, [tabela]);
  return rows[0]?.existe === true;
}
