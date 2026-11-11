import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ProducaoPedidoService } from './producao-pedido.service';
import { CardapioService } from '../cardapio/cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AUDITORIA DO KDS (11/11/2026) — os achados que sobraram da onda 1:
//  • O13 o número do pedido na fila conta o dia da OPERAÇÃO (a nuvem é UTC: zerava às 21h de Brasília);
//  • R14 a fila de produção do PDV mostra só os cartões das últimas 12 h (o de papel ficava "atrasado" para sempre);
//  • O12 o pedido pelo QR da mesa cai na mesa da PRÓPRIA loja (antes, a mesa de mesmo número de outra loja).
// (O7 — o item de canal sem cadastro na cozinha — está em `delivery/kds-delivery-cancelamentos.spec.ts`.)
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('kds-pendentes.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

descrever('KDS — achados restantes da auditoria (Postgres)', () => {
  let pool: Pool;
  let poolUtc: Pool;
  let svc: ProducaoPedidoService;
  let svcUtc: ProducaoPedidoService;
  const T = randomUUID();
  const [A, B] = [randomUUID(), randomUUID()];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const cartao = (o: { numero?: number; criadoHa?: string; unidade?: string; status?: string; destino?: string } = {}) =>
    q(
      `insert into producao_pedido (tenant_id, unidade_id, destino_tipo, status, numero, origem, criado_em)
       values ($1,$2,$3,$4,$5,'balcao', now() - ($6)::interval) returning id`,
      [T, o.unidade ?? A, o.destino ?? 'impressora', o.status ?? 'recebido', o.numero ?? 1, o.criadoHa ?? '1 minute'],
    ).then((r) => r[0].id as string);

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    // A sessão da NUVEM é UTC (V46: o teste de "hoje" força o outro fuso).
    poolUtc = new Pool({ connectionString: URL_PG, options: '-c timezone=UTC' });
    const auditoria = { registrar: async () => undefined } as any;
    svc = new ProducaoPedidoService(drizzle(pool, { schema }) as any, auditoria, { emit: () => true } as any);
    svcUtc = new ProducaoPedidoService(drizzle(poolUtc, { schema }) as any, auditoria, { emit: () => true } as any);
    await q(`insert into empresa (id, nome) values ($1,'kds pendentes')`, [T]);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$3,'Loja A'), ($2,$3,'Loja B')`, [A, B, T]);
  });

  afterAll(async () => {
    if (pool) {
      for (const t of ['producao_pedido', 'comanda', 'mesa', 'unidade'])
        await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => undefined);
      await q(`delete from empresa where id = $1`, [T]).catch(() => undefined);
      await pool.end();
    }
    if (poolUtc) await poolUtc.end();
  });

  it('O13: o número recomeça no dia de Brasília, também com a sessão do banco em UTC', async () => {
    // Um cartão de "ontem às 23h" no relógio da operação (= hoje 02h em UTC) com o número 50.
    await q(
      `insert into producao_pedido (tenant_id, unidade_id, destino_tipo, status, numero, origem, criado_em)
       values ($1,$2,'kds','entregue',50,'balcao',
               (((now() at time zone 'America/Sao_Paulo')::date - 1)::timestamp + interval '23 hours') at time zone 'America/Sao_Paulo')`,
      [T, B],
    );
    const proximo = (s: ProducaoPedidoService) => (s as any).db.transaction((tx: any) => (s as any).proximoNumero(tx, T, B));
    // O de ontem não conta: o primeiro do dia é 1, na sessão UTC (nuvem) e na da máquina (loja).
    expect(await proximo(svcUtc)).toBe(1);
    expect(await proximo(svc)).toBe(1);
    // E o de hoje conta.
    await cartao({ unidade: B, numero: 7, status: 'entregue' });
    expect(await proximo(svcUtc)).toBe(8);
  });

  it('R14: a fila de produção do PDV mostra os cartões das últimas 12 h; o de papel esquecido sai', async () => {
    const recente = await cartao({ criadoHa: '30 minutes' });
    const esquecido = await cartao({ criadoHa: '3 days' });
    const ids = ((await svc.filaPdv(T, { unidadeId: A })) as any[]).map((p) => p.id);
    expect(ids).toContain(recente);
    expect(ids).not.toContain(esquecido);
  });

  it('O12: o pedido pelo QR cai na mesa da PRÓPRIA loja, não na mesa de mesmo número de outra', async () => {
    const mesaA = (await q(`insert into mesa (tenant_id, unidade_id, numero, status) values ($1,$2,'5','aberta') returning id`, [T, A]))[0].id;
    const comandaA = (await q(`insert into comanda (tenant_id, unidade_id, mesa_id, status) values ($1,$2,$3,'aberta') returning id`, [T, A, mesaA]))[0].id;
    const abertas: string[] = [];
    const cardapio: any = Object.create(CardapioService.prototype);
    cardapio.db = drizzle(pool, { schema });
    cardapio.vendas = {
      abrirMesa: async (_t: string, _a: any, dto: any) => {
        const id = (await q(`insert into mesa (tenant_id, unidade_id, numero, status) values ($1,$2,$3,'aberta') returning id`, [T, dto.unidadeId, dto.numero]))[0].id;
        abertas.push(dto.unidadeId);
        return { id };
      },
      abrirComandaNaMesa: async (_t: string, _a: any, mesaId: string) =>
        (await q(`insert into comanda (tenant_id, unidade_id, mesa_id, status) values ($1,$2,$3,'aberta') returning id`, [T, B, mesaId]))[0],
    };
    const daLojaB = await cardapio.comandaDaMesa(T, B, '5');
    expect(daLojaB).not.toBe(comandaA); // antes caía na mesa 5 da loja A
    expect(abertas).toEqual([B]); // abriu a mesa 5 da loja B
    // E na loja A continua achando a dela.
    expect(await cardapio.comandaDaMesa(T, A, '5')).toBe(comandaA);
  });
});
