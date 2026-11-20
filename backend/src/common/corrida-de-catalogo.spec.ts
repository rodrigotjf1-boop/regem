import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Client } from 'pg';
import {
  SO_QUANDO_FALTA_A_TABELA,
  TRAVA_DA_EMPRESA,
  comTravaDaEmpresa,
  ehCorridaDeCatalogo,
  migrationJaCriada,
  repetirNaCorridaDeCatalogo,
} from './corrida-de-catalogo';

describe('corrida de catálogo nas specs (ERR-194)', () => {
  const corrida = () => new Error('could not open relation with OID 21779');

  // O impasse entre duas specs no meio da mesma migration: vale o CÓDIGO (a mensagem muda com o idioma do servidor).
  const impasse = (mensagem: string) => Object.assign(new Error(mensagem), { code: '40P01' });

  it('reconhece só o erro da corrida', () => {
    expect(ehCorridaDeCatalogo(corrida())).toBe(true);
    expect(ehCorridaDeCatalogo(new Error('relation "cupom" does not exist'))).toBe(false);
    expect(ehCorridaDeCatalogo(undefined)).toBe(false);
  });

  it('reconhece o impasse pelo código, em qualquer idioma — e nenhum outro código', () => {
    expect(ehCorridaDeCatalogo(impasse('deadlock detected'))).toBe(true);
    expect(ehCorridaDeCatalogo(impasse('impasse detectado'))).toBe(true);
    // a mensagem sozinha não basta, nem outro erro de concorrência (a linha duplicada)
    expect(ehCorridaDeCatalogo(new Error('deadlock detected'))).toBe(false);
    expect(ehCorridaDeCatalogo(new Error('canceling statement due to lock timeout'))).toBe(false);
    expect(ehCorridaDeCatalogo(Object.assign(new Error('duplicate key value'), { code: '23505' }))).toBe(false);
  });

  // ERR-405: a migration (360 em diante) desiste da espera em 5 s (`set local lock_timeout`); no banco dividido do CI,
  // a outra spec segura a tabela mais que isso — vale o CÓDIGO, e a saída é rodar de novo, como no impasse.
  it('a desistência da espera da migration (55P03) também roda de novo', async () => {
    const desistiu = Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' });
    expect(ehCorridaDeCatalogo(desistiu)).toBe(true);
    let vezes = 0;
    const r = await repetirNaCorridaDeCatalogo(async () => {
      vezes++;
      if (vezes < 3) throw desistiu;
      return 'aplicada';
    }, 4, 1);
    expect(r).toBe('aplicada');
    expect(vezes).toBe(3);
  });

  it('roda de novo depois do impasse', async () => {
    let vezes = 0;
    const r = await repetirNaCorridaDeCatalogo(async () => {
      vezes++;
      if (vezes === 1) throw impasse('impasse detectado');
      return 'ok';
    }, 4, 1);
    expect(r).toBe('ok');
    expect(vezes).toBe(2);
  });

  it('roda de novo quando a corrida acontece e devolve o resultado da vez que deu certo', async () => {
    let vezes = 0;
    const r = await repetirNaCorridaDeCatalogo(async () => {
      vezes++;
      if (vezes < 3) throw corrida();
      return 'ok';
    }, 4, 1);
    expect(r).toBe('ok');
    expect(vezes).toBe(3);
  });

  it('qualquer outro erro sobe na primeira vez', async () => {
    let vezes = 0;
    await expect(
      repetirNaCorridaDeCatalogo(async () => {
        vezes++;
        throw new Error('syntax error at or near "alter"');
      }, 4, 1),
    ).rejects.toThrow('syntax error');
    expect(vezes).toBe(1);
  });

  it('desiste depois das tentativas e sobe o erro da corrida', async () => {
    let vezes = 0;
    await expect(
      repetirNaCorridaDeCatalogo(async () => {
        vezes++;
        throw corrida();
      }, 3, 1),
    ).rejects.toThrow('could not open relation with OID');
    expect(vezes).toBe(3);
  });
});

describe('a trava da empresa na frente da migration (ERR-377)', () => {
  it('o prefixo trava `empresa` antes de qualquer outra instrução do texto', () => {
    expect(TRAVA_DA_EMPRESA).toBe('lock table empresa in share row exclusive mode');
    expect(comTravaDaEmpresa('alter table x add column if not exists y int')).toBe(
      'lock table empresa in share row exclusive mode;\nalter table x add column if not exists y int',
    );
  });

  it('pedaço sem instrução (só comentário, do corte por `;`) volta como veio — a trava sozinha o Postgres recusa', () => {
    for (const s of ['-- 210 · entregador_saida: o cabeçalho\n-- mais comentário', '/* bloco */ \n ', '  ;  ', ''])
      expect(comTravaDaEmpresa(s)).toBe(s);
    expect(comTravaDaEmpresa('-- cabeçalho\ncreate index if not exists i on t (c)')).toBe(
      'lock table empresa in share row exclusive mode;\n-- cabeçalho\ncreate index if not exists i on t (c)',
    );
  });

  // Vistoria: toda spec do schema COMUM que executa o texto de um arquivo (`.query(readFileSync(…))`, `q(readFileSync(…))`)
  // passa o texto por `comTravaDaEmpresa`. Ficam de fora as de schema próprio (`search_path`, `SCHEMA = …`: não tocam na
  // `empresa` comum) e as que travam `empresa` logo depois do `begin` — as que inserem empresa e depois rodam a migration
  // na MESMA transação (a 330 e a 332): ali a trava junto da migration viria tarde (duas delas ao mesmo tempo se
  // esperariam). O texto guardado numa variável (`c.query(sql330)`) a vistoria não vê: vale a regra (V9).
  const executaArquivoSemTrava = (linha: string) => /\b(query|q)\(\s*readFileSync\(/.test(linha);

  it('a vistoria reconhece o jeito de executar a migration sem a trava, e não o jeito com a trava', () => {
    const sem = ['await c.query(', 'readFileSync(MIG(arq), "utf8"));'].join('');
    const semNoQ = ['await q(', 'readFileSync(join(MIG, f), "utf8"));'].join('');
    const com = ['await c.query(comTravaDaEmpresa(', 'readFileSync(MIG(arq), "utf8")));'].join('');
    expect([sem, semNoQ, com].map(executaArquivoSemTrava)).toEqual([true, true, false]);
  });

  it('nenhuma spec do schema comum executa arquivo de migration sem a trava da empresa', () => {
    const raiz = join(__dirname, '..');
    const specs = (readdirSync(raiz, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.spec.ts') && basename(f) !== basename(__filename))
      .map((f) => join(raiz, f));
    expect(specs.length).toBeGreaterThan(300); // a varredura leu a pasta de verdade
    const semTrava: string[] = [];
    let comTrava = 0;
    for (const arq of specs) {
      const texto = readFileSync(arq, 'utf8');
      comTrava += texto.split('comTravaDaEmpresa(').length - 1;
      if (/search_path|SCHEMA = /.test(texto) || texto.includes('query(TRAVA_DA_EMPRESA)')) continue;
      texto.split(/\r?\n/).forEach((linha, i) => {
        if (executaArquivoSemTrava(linha)) semTrava.push(`${arq.slice(raiz.length + 1).replace(/\\/g, '/')}:${i + 1}`);
      });
    }
    expect(comTrava).toBeGreaterThanOrEqual(30); // as specs que aplicam migration foram achadas
    expect(semTrava).toEqual([]);
  });
});

// O mecanismo no Postgres: com a trava presa por quem aplica a migration, quem apaga uma empresa em cascata para na
// PORTA (`empresa`), sem segurar filha nenhuma — e por isso não fecha ciclo com as travas que a migration pega depois.
// Sem a trava (o prefixo vazio), o `delete` passa direto e este teste falha. O impasse em si foi reproduzido à parte
// (ERR-377), não aqui: provocar impasse no banco dividido do CI derrubaria outra spec.
const URL_PG = process.env.TEST_PG_URL;
const descreverPg = URL_PG ? describe : describe.skip;

descreverPg('a trava da empresa contra a limpeza em cascata (ERR-377, Postgres)', () => {
  it('quem apaga a empresa espera na porta, sem segurar filha nenhuma, até a migration terminar', async () => {
    const m = new Client({ connectionString: URL_PG }); // a spec que aplica a migration
    const d = new Client({ connectionString: URL_PG }); // a outra spec, limpando a empresa dela
    await m.connect();
    await d.connect();
    const t = randomUUID();
    try {
      await d.query(`insert into empresa (id, nome) values ($1, 'teste trava da empresa (ERR-377)')`, [t]);
      const [{ pid }] = (await d.query('select pg_backend_pid() as pid')).rows;
      await m.query('begin');
      await m.query(comTravaDaEmpresa('select 1'));
      const apagar = d.query('delete from empresa where id = $1', [t]);
      let espera: { tabela: string; mode: string }[] = [];
      for (let i = 0; i < 100 && !espera.length; i++) {
        await new Promise((r) => setTimeout(r, 50));
        espera = (
          await m.query(
            `select relation::regclass::text as tabela, mode from pg_locks
              where pid = $1 and locktype = 'relation' and not granted`,
            [pid],
          )
        ).rows;
      }
      expect(espera).toEqual([{ tabela: 'empresa', mode: 'RowExclusiveLock' }]);
      const filhas = (
        await m.query(
          `select count(*)::int as n from pg_locks l
             join pg_constraint c on c.conrelid = l.relation and c.contype = 'f' and c.confrelid = 'empresa'::regclass
            where l.pid = $1 and l.granted`,
          [pid],
        )
      ).rows[0].n;
      expect(filhas).toBe(0);
      await m.query('commit');
      await apagar;
      expect((await m.query('select count(*)::int as n from empresa where id = $1', [t])).rows[0].n).toBe(0);
    } finally {
      await m.query('rollback').catch(() => {});
      await m.query('delete from empresa where id = $1', [t]).catch(() => {});
      await m.end();
      await d.end();
    }
  }, 60_000);
});

// ── A migration que trava a mesma tabela duas vezes, reaplicada com a tabela pronta (ERR-539) ──────────────────────
describe('a migration que só roda quando falta a tabela (ERR-539)', () => {
  /** Uma conexão de mentira: guarda as consultas e responde se a tabela existe. */
  const conexao = (existe: boolean) => {
    const consultas: { sql: string; valores?: unknown[] }[] = [];
    return {
      consultas,
      query: async (sql: string, valores?: unknown[]) => {
        consultas.push({ sql, valores });
        return { rows: sql.includes('to_regclass') ? [{ existe }] : [] };
      },
    };
  };

  it('a 344 está na lista, ligada à robo_carrinho', () => {
    expect(SO_QUANDO_FALTA_A_TABELA).toEqual({ '344_robo_carrinho.sql': 'robo_carrinho' });
  });

  it('arquivo fora da lista: roda sempre, sem consulta nenhuma', async () => {
    const c = conexao(true);
    expect(await migrationJaCriada(c, '345_robo_carrinho_conducao.sql')).toBe(false);
    expect(await migrationJaCriada(c, '/repo/database/migrations/349_lembrete_do_carrinho.sql')).toBe(false);
    expect(c.consultas).toEqual([]);
  });

  it('a 344, pelo nome ou pelo caminho (barra de Windows ou não): trava `empresa` ANTES de olhar, e pula se a tabela existe', async () => {
    for (const arq of ['344_robo_carrinho.sql', 'C:\\Regen\\database\\migrations\\344_robo_carrinho.sql', '/repo/database/migrations/344_robo_carrinho.sql']) {
      const pronta = conexao(true);
      expect(await migrationJaCriada(pronta, arq)).toBe(true);
      expect(pronta.consultas.map((q) => q.sql)).toEqual([TRAVA_DA_EMPRESA, expect.stringContaining('to_regclass(current_schema()')]);
      expect(pronta.consultas[1].valores).toEqual(['robo_carrinho']);
      const falta = conexao(false);
      expect(await migrationJaCriada(falta, arq)).toBe(false);
    }
  });

  // Vistoria: toda spec que aplica um arquivo da lista passa pela pergunta. A spec nova que copiar a lista de migrations
  // de outra sem a pergunta volta a fechar o impasse com quem lê e grava a tabela ao mesmo tempo.
  it('toda spec que aplica um arquivo da lista pergunta antes se a tabela já existe', () => {
    const raiz = join(__dirname, '..');
    const specs = (readdirSync(raiz, { recursive: true }) as string[])
      .filter((f) => f.endsWith('.spec.ts') && basename(f) !== basename(__filename))
      .map((f) => join(raiz, f));
    const semPergunta: string[] = [];
    let comArquivo = 0;
    for (const arq of specs) {
      const texto = readFileSync(arq, 'utf8');
      if (!Object.keys(SO_QUANDO_FALTA_A_TABELA).some((m) => texto.includes(`'${m}'`))) continue;
      comArquivo++;
      if (!texto.includes('migrationJaCriada(')) semPergunta.push(arq.slice(raiz.length + 1).replace(/\\/g, '/'));
    }
    expect(comArquivo).toBeGreaterThanOrEqual(8); // as specs que aplicam a 344 foram achadas
    expect(semPergunta).toEqual([]);
  });
});

// O mecanismo no Postgres, num schema SÓ DESTE TESTE (com uma `empresa` própria — nada de chave para tabela comum,
// LIC-088): com outra transação lendo o carrinho, a 344 reaplicada SEGURA o ShareLock do índice e ESPERA o
// AccessExclusiveLock do `enable row level security`. É metade do impasse: se a leitora agora gravasse (RowExclusiveLock,
// que o ShareLock barra), cada uma esperaria a outra. O teste para ANTES da gravação — provocar o impasse derrubaria
// quem estivesse na fila — e confere que, com a tabela pronta, a pergunta da lista não trava a tabela.
descreverPg('a 344 reaplicada trava a robo_carrinho duas vezes (ERR-539, Postgres)', () => {
  const MIG_344 = join(__dirname, '../../../database/migrations/344_robo_carrinho.sql');

  it('reaplicada com a tabela pronta, segura o ShareLock e espera o AccessExclusiveLock; a pergunta pula sem travar', async () => {
    const schema = `teste_err539_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const admin = new Client({ connectionString: URL_PG });
    await admin.connect();
    await admin.query(`create schema ${schema}`);
    await admin.query(`create table ${schema}.empresa (id uuid primary key)`);
    const conectar = async () => {
      const c = new Client({ connectionString: URL_PG, options: `-c search_path=${schema}` });
      await c.connect();
      return c;
    };
    const m = await conectar(); // a spec que reaplica a migration
    const l = await conectar(); // a outra spec, lendo o carrinho numa transação
    const sql344 = readFileSync(MIG_344, 'utf8');
    try {
      await m.query(sql344); // a primeira vez: cria a tabela no schema do teste
      const [{ pid }] = (await m.query('select pg_backend_pid() as pid')).rows;
      const travasNaTabela = async () =>
        (
          await admin.query(
            `select mode, granted from pg_locks where pid = $1 and locktype = 'relation' and relation = to_regclass($2)`,
            [pid, `${schema}.robo_carrinho`],
          )
        ).rows as { mode: string; granted: boolean }[];

      await l.query('begin');
      await l.query('select count(*) from robo_carrinho');
      await m.query('begin');
      const reaplicar = m.query(sql344);
      let travas: { mode: string; granted: boolean }[] = [];
      for (let i = 0; i < 80 && !travas.some((t) => !t.granted); i++) {
        await new Promise((r) => setTimeout(r, 50));
        travas = await travasNaTabela();
      }
      expect(travas.filter((t) => t.granted).map((t) => t.mode)).toContain('ShareLock');
      expect(travas.filter((t) => !t.granted).map((t) => t.mode)).toEqual(['AccessExclusiveLock']);
      await l.query('rollback'); // a leitora sai: a migration termina
      await reaplicar;
      await m.query('commit');

      // Com a pergunta: a tabela existe, o arquivo é pulado, e nenhuma trava na tabela.
      await m.query('begin');
      expect(await migrationJaCriada(m, MIG_344)).toBe(true);
      expect(await travasNaTabela()).toEqual([]);
      await m.query('commit');
      // Sem a tabela, roda.
      await admin.query(`drop table ${schema}.robo_carrinho`);
      await m.query('begin');
      expect(await migrationJaCriada(m, MIG_344)).toBe(false);
      await m.query('commit');
    } finally {
      await l.query('rollback').catch(() => {});
      await m.query('rollback').catch(() => {});
      await l.end();
      await m.end();
      await admin.query(`drop schema ${schema} cascade`).catch(() => {});
      await admin.end();
    }
  }, 60_000);
});
