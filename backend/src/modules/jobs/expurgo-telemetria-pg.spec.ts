import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { JobsService } from './jobs.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O EXPURGO DA TELEMETRIA (ERR-455). Até 12/11/2026 a limpeza diária mirava `edge_telemetria`/`criado_em`, tabela e
// coluna que não existem: o erro era engolido como "tabela ausente no servidor da loja" e a `telemetria_evento` crescia
// sem limite. O que se prova: a rotina mira a tabela e a coluna de verdade; sai a linha há mais de 90 dias sem NOVA
// ocorrência (resolvida ou não); a que voltou a ocorrer fica, por mais antiga que seja; e no servidor da loja (sem a
// tabela) ela não lança nem registra erro.
const u = undefined as any;
const servico = (db: any) => new JobsService(db, u, u, u, u, u, u, u);

describe('o expurgo da telemetria — sem banco', () => {
  it('a rotina diária não cita mais a tabela que não existe e chama o expurgo da telemetria', () => {
    const fonte = readFileSync(join(__dirname, 'jobs.service.ts'), 'utf8');
    const rotina = fonte.slice(fonte.indexOf('async expurgarMetadadosSync()'), fonte.indexOf('static readonly TELEMETRIA_RETENCAO_DIAS'));
    expect(rotina).not.toContain("'edge_telemetria'");
    expect(rotina).toContain('await this.expurgarTelemetria()');
    expect(JobsService.TELEMETRIA_RETENCAO_DIAS).toBe(90);
  });

  it('no servidor da loja (sem a tabela, 42P01) devolve zero, sem lançar e sem registrar erro', async () => {
    const svc = servico({ execute: async () => Promise.reject(Object.assign(new Error('relation "telemetria_evento" does not exist'), { code: '42P01' })) });
    const erros: string[] = [];
    (svc as any).log = { log: () => undefined, error: (m: string) => erros.push(m) };
    await expect(svc.expurgarTelemetria()).resolves.toBe(0);
    expect(erros).toEqual([]);
  });

  it('outro erro do banco não derruba a rotina, mas fica no log com o motivo', async () => {
    const svc = servico({ execute: async () => Promise.reject(Object.assign(new Error('conexão recusada'), { code: '08006' })) });
    const erros: string[] = [];
    (svc as any).log = { log: () => undefined, error: (m: string) => erros.push(m) };
    await expect(svc.expurgarTelemetria()).resolves.toBe(0);
    expect(erros).toEqual(['expurgo telemetria_evento: conexão recusada']);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('expurgo-telemetria-pg.spec: sem TEST_PG_URL — PULADO');

descrever('o expurgo da telemetria (Postgres)', () => {
  jest.setTimeout(60_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const svc = servico(db);
  let tenant = '';
  let deFora = '';

  beforeAll(async () => {
    // `telemetria_evento` é só da nuvem (migs 122 e 166); o banco do CI é de loja: a MESMA forma para o teste, como em
    // `ifood-eventos.spec.ts`. Em paralelo, quem perde a corrida do `create ... if not exists` recebe 23505/42P07 (ERR-128).
    const criar = async (s: string) =>
      pool.query(s).catch((e: any) => {
        if (!['23505', '42P07'].includes(e?.code)) throw e;
      });
    await criar(`create table if not exists telemetria_evento (
      id uuid primary key default gen_random_uuid(), tenant_id uuid references empresa(id) on delete cascade, unidade_id uuid,
      origem text not null default 'outro', nivel text not null default 'error', tipo text, mensagem text not null,
      hash text not null, stack text, contexto jsonb not null default '{}', versao text, fingerprint text,
      ocorrencias integer not null default 1, primeiro_em timestamptz not null default now(),
      ultimo_em timestamptz not null default now(), resolvido boolean not null default false)`);
    await criar(`create unique index if not exists telemetria_evento_dedup
      on telemetria_evento (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), hash)`);
    tenant = (await q(`insert into empresa (nome) values ('Teste expurgo da telemetria') returning id`))[0].id;
    deFora = (await q(`insert into empresa (nome) values ('Teste expurgo da telemetria (de fora)') returning id`))[0].id;
  });
  afterAll(async () => {
    for (const t of [tenant, deFora].filter(Boolean)) {
      await q('delete from telemetria_evento where tenant_id = $1', [t]).catch(() => {});
      await q('delete from empresa where id = $1', [t]).catch(() => {});
    }
    await pool.end();
  });

  const evento = (t: string, hash: string, nasceuHaDias: number, ultimaHaDias: number, resolvido = false) =>
    q(
      `insert into telemetria_evento (tenant_id, mensagem, hash, ocorrencias, primeiro_em, ultimo_em, resolvido)
       values ($1, $2, $2, 3, now() - make_interval(days => $3::int), now() - make_interval(days => $4::int), $5)`,
      [t, hash, nasceuHaDias, ultimaHaDias, resolvido],
    );
  const restam = async (t: string) => (await q(`select hash from telemetria_evento where tenant_id = $1 order by hash`, [t])).map((x) => x.hash);

  it('sai a linha há mais de 90 dias sem nova ocorrência, resolvida ou não; a que voltou a ocorrer fica', async () => {
    await evento(tenant, 'a-antiga-resolvida', 200, 100, true);
    await evento(tenant, 'b-antiga-aberta', 200, 91, false);
    await evento(tenant, 'c-antiga-que-voltou', 200, 1, false); // nasceu há 200 dias, mas ocorreu ontem
    await evento(tenant, 'd-no-limite', 120, 89, true);
    await evento(tenant, 'e-recente', 10, 10, false);
    await evento(deFora, 'f-antiga-de-fora', 200, 150, true);
    expect(await svc.expurgarTelemetria([tenant])).toBe(2);
    expect(await restam(tenant)).toEqual(['c-antiga-que-voltou', 'd-no-limite', 'e-recente']);
    expect(await restam(deFora)).toEqual(['f-antiga-de-fora']); // a volta limitada às empresas do teste não toca a de fora
    expect(await svc.expurgarTelemetria([tenant])).toBe(0); // de novo: nada a fazer
  });
});
