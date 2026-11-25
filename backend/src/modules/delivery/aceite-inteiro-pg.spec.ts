import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DeliveryService } from './delivery.service';
import { VendasService } from '../vendas/vendas.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { CashbackService } from '../cashback/cashback.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ACEITE ENTRA INTEIRO OU NÃO ENTRA (CAR-C-05 da revisão de 25/11/2026) — contra Postgres (TEST_PG_URL). A reserva do pedido
// ('novo' → 'confirmado'), a venda e o vínculo da comanda eram três gravações: uma queda depois da reserva deixava o pedido
// 'confirmado' sem comanda (fora da lista de chegada e de toda retomada, que só olham 'novo'); uma queda depois da venda deixava a
// comanda sem pedido. A queda é simulada por um banco que "cai" a partir da 2ª gravação do pedido feita pelo serviço do Delivery.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('aceite-inteiro-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('o aceite do pedido entra inteiro ou não entra (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG, max: 8 });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const empresas: string[] = [];

  afterAll(async () => {
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => undefined);
    await pool.end();
  });

  /** O serviço do Delivery; `banco` é o que ELE usa (a venda usa sempre o banco de verdade). */
  function servico(o: { banco?: any; producaoFalha?: boolean } = {}) {
    const producao = new ProducaoPedidoService(db, auditoria, eventos);
    if (o.producaoFalha)
      (producao as any).criarPedidos = async () => {
        throw new Error('a conexão caiu no meio da venda');
      };
    const vendas = new VendasService(db, auditoria, eventos, producao, new FiscalService(db, auditoria), {} as any);
    const beneficio = new Proxy({}, { get: () => async () => undefined }) as any;
    const s = new (DeliveryService as any)(
      o.banco ?? db, vendas, producao, new CashbackService(db), beneficio, eventos, { flashPedidos: () => undefined },
      undefined, undefined, undefined, undefined, undefined, undefined, auditoria,
    ) as any;
    for (const k of ['dispararWebhook', 'avisarCodigoDeEntrega', 'statusBackCw', 'statusBackIfood', 'statusBackFood99', 'statusBackAnotaAi'])
      s[k] = async () => undefined;
    return s as DeliveryService;
  }

  /** Um banco que deixa o serviço gravar o pedido UMA vez e "cai" nas gravações seguintes do pedido. */
  function bancoQueCaiNaSegundaGravacao(real: any) {
    let gravacoes = 0;
    return new Proxy(real, {
      get(alvo, k) {
        if (k === 'update')
          return (t: any) => {
            if (t === schema.pedidoExterno && ++gravacoes > 1) throw new Error('a conexão caiu');
            return alvo.update(t);
          };
        const v = alvo[k];
        return typeof v === 'function' ? v.bind(alvo) : v;
      },
    });
  }

  async function pedidoNovo() {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, 'teste aceite inteiro')`, [t]);
    empresas.push(t);
    const [{ id }] = await q(
      `insert into pedido_externo (tenant_id, canal, tipo, status, total, itens) values ($1, 'ifood', 'entrega', 'novo', 30, $2::jsonb) returning id`,
      [t, JSON.stringify([{ descricao: 'X-Burger de teste', quantidade: 1, precoUnitario: 30 }])],
    );
    return { t, id: id as string };
  }
  const estado = async (x: { t: string; id: string }) => ({
    pedido: (await q(`select status, comanda_id::text as comanda from pedido_externo where id = $1`, [x.id]))[0],
    comandas: (await q(`select id::text as id from comanda where tenant_id = $1`, [x.t])).map((r: any) => r.id),
  });

  it('a venda falha e a reserva não consegue voltar (a queda): o pedido segue NOVO, sem comanda', async () => {
    const x = await pedidoNovo();
    await expect(servico({ banco: bancoQueCaiNaSegundaGravacao(db), producaoFalha: true }).aceitar(x.t, null, x.id)).rejects.toThrow();
    expect(await estado(x)).toEqual({ pedido: { status: 'novo', comanda: null }, comandas: [] });
  });

  it('a queda depois da venda: não sobra comanda sem pedido nem pedido confirmado sem comanda', async () => {
    const x = await pedidoNovo();
    await servico({ banco: bancoQueCaiNaSegundaGravacao(db) })
      .aceitar(x.t, null, x.id)
      .catch(() => undefined);
    const e = await estado(x);
    expect(e.comandas).toHaveLength(1);
    expect(e.pedido).toEqual({ status: 'confirmado', comanda: e.comandas[0] });
  });

  it('dois aceites juntos: um aceita, o outro ouve "já foi aceito", e nasce UMA comanda', async () => {
    const x = await pedidoNovo();
    const s = servico();
    const r = await Promise.allSettled([s.aceitar(x.t, null, x.id), s.aceitar(x.t, null, x.id)]);
    expect(r.filter((y) => y.status === 'fulfilled')).toHaveLength(1);
    expect((r.find((y) => y.status === 'rejected') as any)?.reason?.message).toMatch(/já foi aceito/);
    const e = await estado(x);
    expect(e.comandas).toHaveLength(1);
    expect(e.pedido).toEqual({ status: 'confirmado', comanda: e.comandas[0] });
  });
});
