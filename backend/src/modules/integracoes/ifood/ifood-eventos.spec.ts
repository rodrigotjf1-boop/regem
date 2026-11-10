import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { anotarEventoNaoTratado, deveAnotar, formaDoEvento } from './ifood-eventos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-421 — o que o iFood manda e o Regem ainda não trata vai à telemetria da distribuição: a FORMA do evento (nomes dos
// campos, tipos de mudança), nunca os valores (endereço, texto do cliente); uma linha por empresa e código, que soma.
describe('iFood — eventos que o Regem ainda não trata (regras)', () => {
  it('anota o não tratado e o desconhecido; não anota o tratado nem o só informativo', () => {
    for (const c of ['DAR', 'OPA', 'DRDO', 'XYZ']) expect(deveAnotar({ code: c })).toBe(true);
    expect(deveAnotar({ fullCode: 'ORDER_PATCHED' })).toBe(true);
    for (const c of ['PLC', 'CFM', 'DSP', 'CON', 'CAN', 'HSD', 'HSS', 'ADR', 'CLT', 'PRS', 'KEEPALIVE']) expect(deveAnotar({ code: c })).toBe(false);
    expect(deveAnotar({ code: 'x', fullCode: 'CONCLUDED' })).toBe(false);
    expect(deveAnotar({})).toBe(false);
  });

  it('a forma tem os nomes dos campos (um nível dentro) e os tipos de mudança — nenhum valor', () => {
    const f = formaDoEvento({
      code: 'dar',
      fullCode: 'DELIVERY_ADDRESS_CHANGE_REQUESTED',
      metadata: { address: { streetName: 'Rua Secreta', complement: 'apto 2', coordinates: { latitude: -22.8 } }, changes: [{ changeType: 'ADD_ITEMS', items: [{ id: 'i' }] }, { changeType: 'ADD_ITEMS' }] },
    });
    expect(f.code).toBe('DAR');
    expect(f.campos).toEqual(['address', 'address.streetName', 'address.complement', 'address.coordinates', 'changes', 'changes[].changeType', 'changes[].items']);
    expect(f.mudancas).toEqual(['ADD_ITEMS']);
    expect(JSON.stringify(f)).not.toMatch(/Secreta|apto|22\.8/);
    expect(formaDoEvento({ code: 'X', metadata: 'texto' })).toEqual({ code: 'X', fullCode: '', campos: [], mudancas: [] });
  });

  it('banco fora: não rejeita, avisa e devolve false', async () => {
    const avisos: string[] = [];
    const db = { execute: async () => { throw new Error('conexão recusada'); } };
    expect(await anotarEventoNaoTratado(db, { tenantId: 't', unidadeId: null }, { code: 'OPA' }, (m) => avisos.push(m))).toBe(false);
    expect(avisos[0]).toMatch(/OPA.*conexão recusada/);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ifood-eventos.spec: sem TEST_PG_URL — a parte com Postgres foi PULADA');

descrever('iFood — eventos que o Regem ainda não trata (Postgres)', () => {
  jest.setTimeout(60_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  let tenant = '';

  beforeAll(async () => {
    // `telemetria_evento` é só da nuvem (migs 122 e 166); o banco do CI é de loja: a MESMA forma para o teste. Em paralelo,
    // quem perde a corrida do `create ... if not exists` recebe 23505/42P07 — é "já existe" (ERR-128).
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
    tenant = (await q(`insert into empresa (nome) values ('Teste eventos iFood') returning id`))[0].id;
  });

  afterAll(async () => {
    if (tenant) {
      await q('delete from telemetria_evento where tenant_id = $1', [tenant]).catch(() => {});
      await q('delete from empresa where id = $1', [tenant]).catch(() => {});
    }
    await pool.end();
  });

  it('uma linha por empresa e código: soma as ocorrências e guarda a forma e o pedido da última; o resolvido reabre', async () => {
    const ig = { tenantId: tenant, unidadeId: null };
    const dar = (pedido: string) => ({
      code: 'DAR', fullCode: 'DELIVERY_ADDRESS_CHANGE_REQUESTED', orderId: pedido, createdAt: '2026-11-10T02:10:00Z',
      metadata: { address: { streetName: 'Rua Secreta', complement: 'apto 2' } },
    });
    expect(await anotarEventoNaoTratado(db, ig, dar('o-1'))).toBe(true);
    await q(`update telemetria_evento set resolvido = true where tenant_id = $1`, [tenant]);
    expect(await anotarEventoNaoTratado(db, ig, dar('o-2'))).toBe(true);
    expect(await anotarEventoNaoTratado(db, ig, { code: 'OPA', fullCode: 'ORDER_PATCHED', orderId: 'o-3', metadata: { changes: [{ changeType: 'EDIT_ITEMS' }] } })).toBe(true);
    const linhas = await q(
      `select origem, nivel, tipo, mensagem, ocorrencias, resolvido, contexto from telemetria_evento where tenant_id = $1 order by mensagem`,
      [tenant],
    );
    expect(linhas).toHaveLength(2);
    const [l1, l2] = linhas;
    expect(l1).toMatchObject({ origem: 'ifood', nivel: 'warn', tipo: 'ifood_evento_nao_tratado', ocorrencias: 2, resolvido: false });
    expect(l1.mensagem).toBe('O iFood mandou o evento DELIVERY_ADDRESS_CHANGE_REQUESTED (DAR) e o Regem ainda não trata');
    expect(l1.contexto).toMatchObject({ pedido: 'o-2', campos: ['address', 'address.streetName', 'address.complement'] });
    expect(JSON.stringify(l1.contexto)).not.toMatch(/Secreta|apto/);
    expect(l2).toMatchObject({ ocorrencias: 1, contexto: { mudancas: ['EDIT_ITEMS'], pedido: 'o-3' } });
  });
});
