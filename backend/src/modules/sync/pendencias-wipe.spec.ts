import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { TABELAS_PULL, TABELAS_SYNC } from './sync-config';

// A TRAVA QUE IMPEDE APAGAR O BANCO DA LOJA COM DADO QUE SÓ EXISTE NELA.
//
// Por que existe: o instalador roda `sync-daemon --descarregar` e só apaga o banco se ele
// sair 0. Mas o --descarregar só envia o que está em PUSH_TABLES — e havia dado de tabela
// NENHUMA lista conhecia (NFC-e, tarefa, checklist, vistoria, escala). Ele saía 0, o
// instalador apagava com a consciência tranquila e o histórico ia embora.
//
// A trava inverte o ônus: qualquer tabela com `tenant_id` que tenha linha e não esteja
// classificada BLOQUEIA o apagamento. Tabela nova entra bloqueando — é de propósito.
//
// Estes testes guardam as duas maneiras de furar a trava: classificar como "volta da
// nuvem" o que na verdade não volta, e o mecanismo parar de enxergar as tabelas.

const RAIZ = join(__dirname, '..', '..', '..');
const DAEMON = join(RAIZ, 'edge', 'sync-daemon.mjs');
const fonte = readFileSync(DAEMON, 'utf8');

const conjunto = (nome: string): Set<string> => {
  const i = fonte.indexOf(`const ${nome} = new Set([`);
  const j = fonte.indexOf(']);', i);
  if (i < 0 || j < 0) return new Set();
  // Linhas de comentário FORA: uma entrada comentada continha o nome entre aspas e era
  // lida como se estivesse classificada — o teste diria "está na lista" para uma tabela
  // que o daemon não conhece mais. Pego ao conferir que a trava nova realmente reprova.
  const corpo = fonte
    .slice(i, j)
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  return new Set([...corpo.matchAll(/'([a-z_]{3,})'/g)].map((m) => m[1]));
};

const VOLTA_DA_NUVEM = conjunto('VOLTA_DA_NUVEM');
const DESCARTAVEL = conjunto('DESCARTAVEL');
const SO_NUVEM = conjunto('SO_NUVEM');
const LEGADO_SEM_USO = conjunto('LEGADO_SEM_USO');
// O que o daemon empurra (PUSH_TABLES). Lido da fonte dele, e não do sync-config, porque
// é esta lista que a trava consulta em tempo de execução.
const SOBE = new Set([...fonte.matchAll(/\{\s*tabela:\s*'([a-z_]{3,})'/g)].map((m) => m[1]));

describe('trava do apagamento — listas do daemon', () => {
  it('as listas foram lidas do daemon (guarda contra o regex parar de casar)', () => {
    expect(VOLTA_DA_NUVEM.size).toBeGreaterThan(5);
    expect(DESCARTAVEL.size).toBeGreaterThan(3);
    expect(DESCARTAVEL.has('impressao_job')).toBe(true);
  });

  it('toda tabela que SÓ desce está marcada como "volta da nuvem"', () => {
    // Se as duas listas se separarem, uma tabela que a nuvem devolve passa a BLOQUEAR a
    // reinstalação para sempre (o instalador nunca mais apaga, mesmo com tudo salvo).
    const soDescem = TABELAS_SYNC.filter((t) => t.direcao === 'desce').map((t) => t.tabela);
    const esquecidas = soDescem.filter((t) => !VOLTA_DA_NUVEM.has(t) && t !== 'empresa');
    expect(esquecidas).toEqual([]);
  });

  it('tudo que está marcado como "volta da nuvem" realmente desce no pull', () => {
    // O erro perigoso é marcar aqui uma tabela que a nuvem NÃO manda de volta: o
    // instalador apagaria o banco e o dado não voltaria nunca.
    const desce = new Set(TABELAS_PULL.map((t) => t.tabela));
    const mentirosas = [...VOLTA_DA_NUVEM].filter((t) => !desce.has(t));
    expect(mentirosas).toEqual([]);
  });

  it('nada está marcado como descartável sendo tabela que a nuvem espera receber', () => {
    // Exceção declarada: sync_exclusao SOBE (é o aviso de exclusão) e some depois de subir.
    const sobem = new Set(TABELAS_SYNC.filter((t) => t.direcao !== 'desce').map((t) => t.tabela));
    const conflito = [...DESCARTAVEL].filter((t) => sobem.has(t) && t !== 'sync_exclusao');
    expect(conflito).toEqual([]);
  });

  it('nenhuma tabela aparece em duas listas ao mesmo tempo', () => {
    const duplicadas = [...VOLTA_DA_NUVEM].filter((t) => DESCARTAVEL.has(t) || SO_NUVEM.has(t));
    const duplicadas2 = [...DESCARTAVEL].filter((t) => SO_NUVEM.has(t));
    expect([...duplicadas, ...duplicadas2]).toEqual([]);
  });

  it('nada que a loja PRODUZ está marcado como "dono é a nuvem"', () => {
    // O erro perigoso aqui seria despachar como "da nuvem" uma tabela que nasce no PDV:
    // ela seria apagada e a nuvem não teria cópia. Quem sobe não pode estar nesta lista.
    const sobem = new Set(TABELAS_SYNC.filter((t) => t.direcao !== 'desce').map((t) => t.tabela));
    const erradas = [...SO_NUVEM].filter((t) => sobem.has(t));
    expect(erradas).toEqual([]);
  });
});

// Contra um Postgres de verdade: o mecanismo tem de ENXERGAR uma tabela com dado e
// bloquear. Sem isto, um erro de SQL (nome de coluna, schema errado) devolveria "nada
// preso" para sempre — que é justamente o estado que causou a perda.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pendencias-wipe.spec: sem TEST_PG_URL — teste da trava contra o Postgres PULADO');

descrever('trava do apagamento — contra o Postgres', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const TABELA = 'zz_trava_pendencia_teste';

  const rodar = (): { codigo: number; saida: string } => {
    try {
      const saida = execFileSync(process.execPath, [DAEMON, '--pendencias'], {
        env: {
          ...process.env,
          EDGE_DATABASE_URL: URL_PG,
          DATABASE_URL: URL_PG,
          CLOUD_API: 'http://127.0.0.1:9/api/v1',
          SYNC_TOKEN: 'teste',
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 60000,
      });
      return { codigo: 0, saida };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { codigo: err.status ?? -1, saida: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  beforeAll(async () => {
    await pool.query(`drop table if exists ${TABELA}`);
  });

  afterAll(async () => {
    await pool.query(`drop table if exists ${TABELA}`);
    await pool.end();
  });

  it('tabela com tenant_id e dado, fora de toda lista, BLOQUEIA o apagamento', async () => {
    await pool.query(`create table ${TABELA} (id uuid primary key default gen_random_uuid(), tenant_id uuid not null)`);
    await pool.query(`insert into ${TABELA} (tenant_id) values (gen_random_uuid())`);
    const r = rodar();
    expect(r.codigo).toBe(3);
    expect(r.saida).toContain(TABELA);
  }, 90000);

  it('toda tabela do sync tem, no banco de verdade, id, tenant_id e o cursor declarado', async () => {
    // O cursor é escrito à mão no sync-config (updated_at / atualizado_em / created_at /
    // criado_em). Errar o nome não quebra nada na hora: a tabela simplesmente para de
    // sincronizar, ou o push derruba o ciclo inteiro com "coluna não existe" (42703).
    // Aqui a lista é conferida contra o banco montado pelas migrations reais.
    const r = await pool.query(
      `select table_name, array_agg(column_name::text) as cols
         from information_schema.columns where table_schema = current_schema() group by table_name`,
    );
    const porTabela = new Map<string, string[]>(r.rows.map((x: any) => [x.table_name, x.cols]));
    const problemas: string[] = [];
    for (const t of TABELAS_SYNC) {
      const cols = porTabela.get(t.tabela);
      if (!cols) { problemas.push(`${t.tabela}: tabela não existe no banco`); continue; }
      if (!cols.includes('id')) problemas.push(`${t.tabela}: sem coluna id`);
      // `empresa` amarra pelo próprio id (escopo: 'id'), não tem tenant_id.
      if (t.escopo !== 'id' && !cols.includes('tenant_id')) problemas.push(`${t.tabela}: sem tenant_id`);
      if (!cols.includes(t.cursor)) problemas.push(`${t.tabela}: cursor "${t.cursor}" não existe`);
    }
    expect(problemas).toEqual([]);
  }, 60000);

  it('TODA tabela com tenant_id está classificada em alguma lista do daemon', async () => {
    // Este é o teste que faltava, e a falta custou caro: os outros conferem o MECANISMO
    // (tabela sintética com dado trava) e a COERÊNCIA entre as listas, mas nenhum
    // perguntava "e as tabelas de verdade, estão todas classificadas?". Cinco não
    // estavam — entre elas `ponto_fechamento`, que uma loja que fechou a folha do mês
    // tem preenchida: a reinstalação pelo .exe travava e ninguém sabia por quê.
    //
    // Tabela nova sem classificação cai aqui, na hora de escrever o código, e não na
    // loja do cliente com o instalador parado.
    const r = await pool.query(
      `select table_name from information_schema.columns
        where table_schema = current_schema() and column_name = 'tenant_id'
        order by table_name`,
    );
    const semClasse = r.rows
      .map((x: any) => x.table_name as string)
      .filter((t) => t !== TABELA) // a sintética deste próprio arquivo
      .filter(
        (t) =>
          !SOBE.has(t) && !VOLTA_DA_NUVEM.has(t) && !SO_NUVEM.has(t) &&
          !DESCARTAVEL.has(t) && !LEGADO_SEM_USO.has(t),
      );
    expect(semClasse).toEqual([]);
  }, 60000);

  it('a mesma tabela VAZIA sai da lista (a trava olha dado, não a existência da tabela)', async () => {
    await pool.query(`delete from ${TABELA}`);
    const r = rodar();
    // Só se afirma sobre ESTA tabela: o banco de quem roda o teste pode ter dado de
    // outras tabelas ainda não classificadas, e aí o código continua 3 com razão.
    expect(r.saida).not.toContain(TABELA);
    expect([0, 3]).toContain(r.codigo);
  }, 90000);
});
