import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O MESMO pedido de marketplace chegando duas vezes AO MESMO TEMPO (reenvio do webhook da
// 99Food após os 6 s de limite, poller + webhook do iFood, duas réplicas da API) tem de
// gerar UM pedido. Postgres real: a checagem "já existe?" em memória não prova nada.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ingest-concorrencia.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('ingest de pedido de marketplace — entregas simultâneas', () => {
  let pool: Pool;
  let svc: DeliveryService;
  const T = randomUUID();
  const LOJA = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, max: 10 });
    const db = drizzle(pool, { schema });
    const eventos = { emit: () => true } as any;
    svc = new DeliveryService(db as any, {} as any, {} as any, {} as any, {} as any, eventos, { flashPedidos: () => {} } as any);
    await pool.query(`insert into empresa (id, nome) values ($1,'teste ingest')`, [T]);
    await pool.query(`insert into unidade (id, tenant_id, nome) values ($1,$2,'Loja')`, [LOJA, T]);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`delete from pedido_externo where tenant_id = $1`, [T]).catch(() => {});
    await pool.query(`delete from unidade where tenant_id = $1`, [T]).catch(() => {});
    await pool.query(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });

  const pedido99 = (orderId: string) => ({
    order_id: orderId,
    order_index: 7,
    status: 100,
    delivery_type: 2,
    fulfillment_mode: 0,
    pay_type: 1,
    price: { order_price: 3000, delivery_price: 500, customer_need_paying_money: 3500 },
    receive_address: { name: 'Cliente', phone: '11999999999', street_name: 'Rua A' },
    order_items: [{ app_item_id: 'X1', name: 'Lanche', amount: 1, sku_price: 3000 }],
  });

  it('duas entregas simultâneas do mesmo order_id da 99 geram UM pedido', async () => {
    const orderId = String(5764665043203457000n + BigInt(Math.floor(Math.random() * 1000)));
    const r = await Promise.allSettled(
      Array.from({ length: 5 }, () => svc.ingest(T, LOJA, '99food', pedido99(orderId))),
    );
    const n = (await pool.query(
      `select count(*)::int n from pedido_externo where tenant_id=$1 and canal='99food' and external_id=$2`,
      [T, orderId],
    )).rows[0].n;
    const erros = r.filter((x) => x.status === 'rejected').map((x: any) => String(x.reason?.message ?? x.reason));
    expect({ pedidos: n, erros }).toEqual({ pedidos: 1, erros: [] });
  });
});
