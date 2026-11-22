import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { TefService } from './tef.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O RESULTADO DO PINPAD VALE UMA VEZ (ERR-566, 22/11/2026). A leitura "está pendente?" vinha antes e a gravação não conferia
// de novo: duas respostas juntas passavam pela leitura, e a última sobrescrevia a primeira (um "aprovado" podia virar "negado"
// com o cartão já cobrado). O teste segura a linha para as duas respostas ficarem presas DEPOIS da leitura (V98).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('tef-resultado-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('o resultado do pinpad vale uma vez (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG, max: 6 });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const T = randomUUID();
  const svc = new TefService(db, { registrar: async () => undefined } as any);
  const pendente = async () => (await q(`insert into pagamento_tef (tenant_id, valor, forma) values ($1, 50, 'credito') returning id`, [T]))[0].id as string;

  beforeAll(async () => {
    await q(`insert into empresa (id, nome) values ($1, 'teste resultado do pinpad')`, [T]);
  });
  afterAll(async () => {
    await q(`delete from pagamento_tef where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from empresa where id = $1`, [T]).catch(() => undefined);
    await pool.end();
  });

  it('duas respostas juntas: a primeira fica, a segunda é recusada e não sobrescreve', async () => {
    const id = await pendente();
    const c = await pool.connect();
    let respostas: Promise<any>[] = [];
    try {
      await c.query('begin');
      await c.query('select 1 from pagamento_tef where id = $1 for update', [id]);
      const eu = (await c.query('select pg_backend_pid() as pid')).rows[0].pid;
      respostas = [svc.resultado(T, id, { status: 'aprovado', nsu: '111' }), svc.resultado(T, id, { status: 'negado', nsu: '222' })];
      respostas.forEach((r) => r.catch(() => undefined));
      let presas = 0;
      for (let i = 0; i < 200 && presas < 2; i++) {
        presas = (await q(`select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`, [eu]))[0].n;
        if (presas < 2) await new Promise((r) => setTimeout(r, 25));
      }
      expect(presas).toBeGreaterThanOrEqual(1);
    } finally {
      await c.query('commit');
      c.release();
    }
    const r = await Promise.allSettled(respostas);
    const ok = r.filter((x) => x.status === 'fulfilled') as PromiseFulfilledResult<any>[];
    expect(ok).toHaveLength(1);
    expect((r.find((x) => x.status === 'rejected') as PromiseRejectedResult).reason).toBeInstanceOf(BadRequestException);
    const [linha] = await q(`select status, nsu from pagamento_tef where id = $1`, [id]);
    expect(linha).toEqual({ status: ok[0].value.status, nsu: ok[0].value.nsu });
  });

  it('a resposta repetida depois de processar é recusada e a primeira fica', async () => {
    const id = await pendente();
    await svc.resultado(T, id, { status: 'aprovado', nsu: '333' });
    await expect(svc.resultado(T, id, { status: 'negado', nsu: '444' })).rejects.toThrow('não está pendente');
    expect((await q(`select status, nsu from pagamento_tef where id = $1`, [id]))[0]).toEqual({ status: 'aprovado', nsu: '333' });
  });
});
