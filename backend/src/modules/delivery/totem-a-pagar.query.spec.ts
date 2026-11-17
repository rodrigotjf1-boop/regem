import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { MINUTOS_ALERTA_TOTEM, totemDinheiroAPagar } from './totem-a-pagar.query';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ícone e o aviso do PDV saem desta consulta: um filtro errado e o operador é chamado para cobrar pedido que está sendo
// pago no totem — ou deixa de ser avisado do cliente esperando, ou do lanche PRONTO que ninguém cobrou. Postgres real.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('totem-a-pagar.query.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('pedidos do totem em dinheiro esperando pagamento', () => {
  let pool: Pool;
  let db: any;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const criadas: string[] = [];

  const empresa = async () => {
    const t = randomUUID();
    const u = randomUUID();
    await q(`insert into empresa (id, nome) values ($1,'teste totem a pagar')`, [t]);
    criadas.push(t);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$2,'Loja')`, [u, t]);
    return { t, u };
  };

  const pedido = async (
    t: string,
    u: string | null,
    o: { minutos: number; forma?: string | null; status?: string; pago?: boolean; comanda?: boolean; canal?: string; senha?: string; apagado?: boolean },
  ) => {
    const comandaId = o.comanda ? randomUUID() : null;
    if (comandaId) await q(`insert into comanda (id, tenant_id, status, total) values ($1,$2,'fechada',10)`, [comandaId, t]);
    const r = await q(
      `insert into pedido_externo
         (tenant_id, unidade_id, canal, external_id, display_id, status, pago, comanda_id, forma_pagamento, criado_em, itens, total, tipo, deleted_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9, now() - ($10 || ' minutes')::interval, '[]'::jsonb, 25.5, 'retirada', $11)
       returning id`,
      [t, u, o.canal ?? 'totem', randomUUID(), o.senha ?? null, o.status ?? 'novo', o.pago ?? false, comandaId,
       o.forma === undefined ? 'dinheiro' : o.forma, String(o.minutos), o.apagado ? new Date() : null],
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

  const ids = async (t: string, u: string | null) => (await totemDinheiroAPagar(db, t, u)).map((v) => v.id);

  it('o "atrasado" é a partir de 8 minutos', () => {
    expect(MINUTOS_ALERTA_TOTEM).toBe(8);
  });

  it('dinheiro sem pagar ENTRA na chegada (o ícone aparece na hora), com a senha, o valor e o tempo de espera', async () => {
    const { t, u } = await empresa();
    const id = await pedido(t, u, { minutos: 0, senha: '#B12' });
    const r = await totemDinheiroAPagar(db, t, u);
    expect(r.map((p) => p.id)).toEqual([id]);
    expect(r[0]).toMatchObject({ senha: 'B12', total: 25.5, minutos: 0, status: 'novo', pronto: false, atrasado: false });
  });

  it('passou de 8 min: continua, marcado como atrasado', async () => {
    const { t, u } = await empresa();
    await pedido(t, u, { minutos: 9 });
    const [p] = await totemDinheiroAPagar(db, t, u);
    expect(p).toMatchObject({ minutos: 9, atrasado: true });
  });

  it('a forma não depende de maiúscula nem de espaço; sem forma gravada conta como dinheiro', async () => {
    const { t, u } = await empresa();
    const a = await pedido(t, u, { minutos: 20, forma: ' Dinheiro ' });
    const b = await pedido(t, u, { minutos: 15, forma: null });
    expect(await ids(t, u)).toEqual([a, b]); // o que espera há mais tempo vem primeiro
  });

  it('cartão e PIX em aprovação NÃO entram — o pagamento é no totem', async () => {
    const { t, u } = await empresa();
    await pedido(t, u, { minutos: 20, forma: 'cartao' });
    await pedido(t, u, { minutos: 20, forma: 'pix' });
    expect(await ids(t, u)).toEqual([]);
  });

  it('a loja que produz antes de cobrar: o aceito (na cozinha) e o PRONTO entram — o pronto e não pago vem primeiro', async () => {
    const { t, u } = await empresa();
    const esperando = await pedido(t, u, { minutos: 30 });
    const naCozinha = await pedido(t, u, { minutos: 20, status: 'confirmado', comanda: true });
    const pronto = await pedido(t, u, { minutos: 10, status: 'pronto', comanda: true });
    const r = await totemDinheiroAPagar(db, t, u);
    expect(r.map((p) => p.id)).toEqual([pronto, esperando, naCozinha]);
    expect(r[0]).toMatchObject({ status: 'pronto', pronto: true });
    expect(r[2]).toMatchObject({ status: 'confirmado', pronto: false });
  });

  it('já pago, concluído, cancelado ou apagado NÃO entra', async () => {
    const { t, u } = await empresa();
    await pedido(t, u, { minutos: 20, pago: true });
    await pedido(t, u, { minutos: 20, status: 'pronto', pago: true, comanda: true });
    await pedido(t, u, { minutos: 20, status: 'concluido', comanda: true });
    await pedido(t, u, { minutos: 20, status: 'cancelado' });
    await pedido(t, u, { minutos: 20, apagado: true });
    expect(await ids(t, u)).toEqual([]);
  });

  it('pedido de outro canal NÃO entra, mesmo em dinheiro e sem pagar', async () => {
    const { t, u } = await empresa();
    for (const canal of ['ifood', 'cardapio', 'anotaai', 'manual']) await pedido(t, u, { minutos: 20, canal });
    expect(await ids(t, u)).toEqual([]);
  });

  it('pedido esquecido há mais de 12 h sai do aviso (vira pendência do fechamento do turno)', async () => {
    const { t, u } = await empresa();
    await pedido(t, u, { minutos: 13 * 60 });
    const hoje = await pedido(t, u, { minutos: 11 * 60 });
    expect(await ids(t, u)).toEqual([hoje]);
  });

  it('cada loja vê os seus e os sem loja; outra empresa não vê nada', async () => {
    const { t, u } = await empresa();
    const outraLoja = randomUUID();
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$2,'Loja 2')`, [outraLoja, t]);
    const daLoja = await pedido(t, u, { minutos: 30 });
    const semLoja = await pedido(t, null, { minutos: 20 });
    const daOutra = await pedido(t, outraLoja, { minutos: 10 });
    expect(await ids(t, u)).toEqual([daLoja, semLoja]);
    expect(await ids(t, outraLoja)).toEqual([semLoja, daOutra]);
    const { t: t2, u: u2 } = await empresa();
    expect(await ids(t2, u2)).toEqual([]);
  });
});
