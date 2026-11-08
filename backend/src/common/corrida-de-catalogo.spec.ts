import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Client } from 'pg';
import { TRAVA_DA_EMPRESA, comTravaDaEmpresa, ehCorridaDeCatalogo, repetirNaCorridaDeCatalogo } from './corrida-de-catalogo';

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
