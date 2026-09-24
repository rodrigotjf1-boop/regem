import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { retidosVencidos } from './totem-retido.query';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Esta consulta CANCELA pedido de cliente automaticamente — um filtro a menos e ela
// passa a cancelar venda boa. Postgres real, porque a decisão é a query.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('totem-retido.query.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('pedidos de totem vencidos esperando pagamento', () => {
  let pool: Pool;
  let db: any;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const criadas: string[] = [];

  const empresa = async () => {
    const t = randomUUID();
    const u = randomUUID();
    await q(`insert into empresa (id, nome) values ($1,'teste retido')`, [t]);
    criadas.push(t);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$2,'Loja')`, [u, t]);
    return { t, u };
  };

  /** Cria um pedido de totem com idade controlada. */
  const pedido = async (
    t: string,
    u: string,
    o: {
      minutos: number;
      forma?: string;
      status?: string;
      pago?: boolean;
      comanda?: boolean;
      canal?: string;
    },
  ) => {
    const comandaId = o.comanda ? randomUUID() : null;
    if (comandaId) {
      await q(`insert into comanda (id, tenant_id, status, total) values ($1,$2,'fechada',10)`, [comandaId, t]);
    }
    const r = await q(
      `insert into pedido_externo
         (tenant_id, unidade_id, canal, external_id, status, pago, comanda_id, forma_pagamento, criado_em, itens, total)
       values ($1,$2,$3,$4,$5,$6,$7,$8, now() - ($9 || ' minutes')::interval, '[]'::jsonb, 10)
       returning id`,
      [t, u, o.canal ?? 'totem', randomUUID(), o.status ?? 'novo', o.pago ?? false,
       comandaId, o.forma ?? 'cartao', String(o.minutos)],
    );
    return r.rows[0].id as string;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });

  afterAll(async () => {
    if (!pool) return;
    for (const t of criadas) {
      await q('delete from pedido_externo where tenant_id = $1', [t]).catch(() => {});
      await q('delete from comanda where tenant_id = $1', [t]).catch(() => {});
      await q('delete from unidade where tenant_id = $1', [t]).catch(() => {});
      await q('delete from empresa where id = $1', [t]).catch(() => {});
    }
    await pool.end();
  });

  const ids = async () => (await retidosVencidos(db, 5)).map((v: any) => v.id);

  it('cartão parado há mais de 5 min VENCE', async () => {
    const { t, u } = await empresa();
    const id = await pedido(t, u, { minutos: 6, forma: 'cartao' });
    expect(await ids()).toContain(id);
  });

  it('cartão recente NÃO vence (o cliente ainda está pagando)', async () => {
    const { t, u } = await empresa();
    const id = await pedido(t, u, { minutos: 2, forma: 'cartao' });
    expect(await ids()).not.toContain(id);
  });

  it('DINHEIRO nunca vence — o cliente está indo até o caixa', async () => {
    const { t, u } = await empresa();
    const id = await pedido(t, u, { minutos: 60, forma: 'dinheiro' });
    expect(await ids()).not.toContain(id);
    // e a comparação não pode depender de maiúscula/minúscula
    const id2 = await pedido(t, u, { minutos: 60, forma: 'Dinheiro' });
    expect(await ids()).not.toContain(id2);
  });

  it('pedido já PAGO não vence', async () => {
    const { t, u } = await empresa();
    const id = await pedido(t, u, { minutos: 30, pago: true });
    expect(await ids()).not.toContain(id);
  });

  it('pedido que já virou comanda não vence', async () => {
    const { t, u } = await empresa();
    const id = await pedido(t, u, { minutos: 30, comanda: true });
    expect(await ids()).not.toContain(id);
  });

  it('pedido já cancelado ou confirmado não vence', async () => {
    const { t, u } = await empresa();
    const a = await pedido(t, u, { minutos: 30, status: 'cancelado' });
    const b = await pedido(t, u, { minutos: 30, status: 'confirmado' });
    const atuais = await ids();
    expect(atuais).not.toContain(a);
    expect(atuais).not.toContain(b);
  });

  it('pedido de OUTRO canal não é tocado', async () => {
    const { t, u } = await empresa();
    for (const canal of ['ifood', 'cardapio', '99food']) {
      const id = await pedido(t, u, { minutos: 30, canal, forma: 'cartao' });
      expect(await ids()).not.toContain(id);
    }
  });
});
