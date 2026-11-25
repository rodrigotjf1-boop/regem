import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A AGENDA DAS ENCOMENDAS (Delivery › Encomendas) contra o Postgres real (ERR-605): o dia da encomenda é o da LOJA — pelo
// relógio de UTC, a das 21h30 ia para o dia seguinte — e o limite de 200 pedidos vale depois do filtro das encomendas — num
// dia cheio, a encomenda feita há dois dias sumia atrás dos pedidos do dia. Sem banco (`TEST_PG_URL`), pula.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('agenda-encomendas-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

descrever('a agenda das encomendas (Postgres real)', () => {
  let pool: Pool;
  let db: any;
  let tenant: string;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    tenant = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [tenant, `teste encomendas ${tenant.slice(0, 6)}`]);
  });
  afterAll(async () => {
    await q(`delete from pedido_externo where tenant_id = $1`, [tenant]);
    await q(`delete from empresa where id = $1`, [tenant]);
    await pool.end();
  });

  it('a encomenda das 21h30 fica no dia dela, e aparece mesmo atrás de 205 pedidos do dia', async () => {
    const [{ id: noite }] = await q(
      `insert into pedido_externo (tenant_id, canal, tipo, status, total, criado_em, agendamento, retirada_tipo, display_id)
       values ($1, 'proprio', 'retirada', 'confirmado', 80, now() - interval '2 days', '2026-12-05T21:30:00-03:00', 'encomenda', 'ENC-NOITE') returning id::text as id`,
      [tenant],
    );
    const [{ id: manha }] = await q(
      `insert into pedido_externo (tenant_id, canal, tipo, status, total, criado_em, agendamento, retirada_tipo, display_id)
       values ($1, 'proprio', 'retirada', 'novo', 40, now() - interval '3 days', '2026-12-06T09:00:00-03:00', 'encomenda', 'ENC-MANHA') returning id::text as id`,
      [tenant],
    );
    await q(
      `insert into pedido_externo (tenant_id, canal, tipo, status, total, agendamento, display_id)
       values ($1, 'proprio', 'entrega', 'cancelado', 10, '2026-12-05T12:00:00-03:00', 'ENC-CANCELADA')`,
      [tenant],
    );
    // O dia cheio: 205 pedidos ativos, mais novos que as encomendas, sem dia marcado (set-based, uma instrução).
    await q(
      `insert into pedido_externo (tenant_id, canal, tipo, status, total, display_id)
       select $1, 'proprio', 'entrega', 'novo', 20, 'DIA-' || g from generate_series(1, 205) g`,
      [tenant],
    );
    const delivery = new DeliveryService(db, {} as any, {} as any, {} as any, {} as any, {} as any, { flashPedidos: () => undefined } as any);
    const grupos = await delivery.listarEncomendas(tenant, null);
    expect(grupos.map((g: any) => ({ data: g.data, ids: g.pedidos.map((p: any) => p.id) }))).toEqual([
      { data: '2026-12-05', ids: [noite] },
      { data: '2026-12-06', ids: [manha] },
    ]);
    expect((await delivery.listarEncomendas(tenant, null, '2026-12-05')).map((g: any) => g.data)).toEqual(['2026-12-05']);
    expect((await delivery.listarEncomendas(tenant, null, '2026-12-05'))[0].pedidos[0].dataEntrega).toBe('2026-12-05');
  });
});
