import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { hojeISO } from '../../common/data';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import * as schema from '../../db/schema';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O RECEBIMENTO DE UM PEDIDO ENTRA INTEIRO (ERR-579). Finalizar a entrega, "Receber pagamento" e "Cobrar e entregar" gravavam a divisão,
// o pedido pago e o lançamento no caixa em passos soltos. Uma falha no meio deixava o pedido pago com o dinheiro fora da gaveta, e a
// nova tentativa, vendo `pago`, não refazia o resto. Sem caixa aberto, a divisão ficava gravada. Dois toques juntos duplicavam a divisão.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('recebimento-atomico-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('o recebimento do pedido entra inteiro ou não entra (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG, max: 8 });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await repetirNaCorridaDeCatalogo(() => pool.query(s, p))).rows;
  const empresas: string[] = [];

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['pedido_externo_pagamento', 'pedido_externo', 'lancamento_caixa', 'comanda', 'caixa_sessao'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  /** O serviço com o que vem DEPOIS do recebimento trocado por uma conclusão simples: aqui importa o que o recebimento grava. */
  function servico(banco: any = db) {
    const s = new (DeliveryService as any)(banco, { baixarEstoqueExterno: async () => undefined }) as any;
    s.dispararWebhook = async () => undefined;
    s.statusBackCw = async () => undefined;
    s.statusBackFood99 = async () => undefined;
    s.statusBackAnotaAi = async () => undefined;
    s.avancar = async (_t: string, id: string) => (await q(`update pedido_externo set status = 'concluido' where id = $1 and status <> 'concluido' returning id, status`, [id]))[0] ?? { id, status: 'concluido' };
    return s;
  }

  /** Um banco em que gravar o lançamento do caixa falha: a queda no meio do recebimento. */
  function bancoQueFalhaNoLancamento(real: any): any {
    return new Proxy(real, {
      get(alvo, k) {
        if (k === 'update')
          return (t: any) => {
            if (t === schema.lancamentoCaixa) throw new Error('a conexão caiu no meio');
            return alvo.update(t);
          };
        if (k === 'transaction') return (fn: any, ...r: any[]) => alvo.transaction((tx: any) => fn(bancoQueFalhaNoLancamento(tx)), ...r);
        const v = alvo[k];
        return typeof v === 'function' ? v.bind(alvo) : v;
      },
    });
  }

  async function montar(o: { origem?: 'delivery' | 'pdv' | null; status?: string; tipo?: string } = {}) {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, 'teste recebimento')`, [t]);
    empresas.push(t);
    const origem = o.origem === undefined ? 'delivery' : o.origem;
    const sessao = origem ? (await q(`insert into caixa_sessao (tenant_id, status, origem) values ($1, 'aberta', $2) returning id::text as id`, [t, origem]))[0].id : null;
    const comanda = (await q(`insert into comanda (tenant_id, status, total, forma) values ($1, 'fechada', 40, 'a_receber') returning id::text as id`, [t]))[0].id;
    await q(`insert into lancamento_caixa (tenant_id, tipo, valor, categoria, forma, comanda_id, data) values ($1, 'entrada', 40, 'venda', 'a_receber', $2, $3)`, [t, comanda, hojeISO()]);
    const pedido = (
      await q(`insert into pedido_externo (tenant_id, canal, tipo, status, total, comanda_id, pago) values ($1, 'cardapio', $2, $3, 40, $4, false) returning id::text as id`, [
        t,
        o.tipo ?? 'entrega',
        o.status ?? 'entregue',
        comanda,
      ])
    )[0].id;
    return { t, sessao, comanda, pedido };
  }

  const estado = async (x: { t: string; pedido: string; comanda: string }) => ({
    pago: (await q(`select pago from pedido_externo where id = $1`, [x.pedido]))[0].pago,
    forma: (await q(`select forma_pagamento as f from pedido_externo where id = $1`, [x.pedido]))[0].f,
    divisao: (await q(`select count(*)::int as n from pedido_externo_pagamento where pedido_externo_id = $1`, [x.pedido]))[0].n,
    lancamento: (await q(`select sessao_id::text as s, forma from lancamento_caixa where tenant_id = $1 and comanda_id = $2`, [x.t, x.comanda]))[0],
  });
  const DIVIDIDO = [
    { forma: 'dinheiro', valor: 25 },
    { forma: 'pix', valor: 15 },
  ];

  it('finalizar: divisão, pedido pago e lançamento entram juntos', async () => {
    const x = await montar();
    await servico().finalizar(x.t, null, x.pedido, { pagamentos: DIVIDIDO });
    expect(await estado(x)).toEqual({ pago: true, forma: 'dinheiro + pix', divisao: 2, lancamento: { s: x.sessao, forma: 'dinheiro + pix' } });
  });

  it('a falha no meio não deixa pedido pago com o dinheiro fora do caixa, e a nova tentativa completa', async () => {
    const x = await montar();
    await expect(servico(bancoQueFalhaNoLancamento(db)).finalizar(x.t, null, x.pedido, { pagamentos: DIVIDIDO })).rejects.toThrow('a conexão caiu no meio');
    expect(await estado(x)).toEqual({ pago: false, forma: null, divisao: 0, lancamento: { s: null, forma: 'a_receber' } });
    await servico().finalizar(x.t, null, x.pedido, { pagamentos: DIVIDIDO });
    expect(await estado(x)).toEqual({ pago: true, forma: 'dinheiro + pix', divisao: 2, lancamento: { s: x.sessao, forma: 'dinheiro + pix' } });
  });

  it('sem caixa aberto, nada fica gravado: nem a divisão', async () => {
    const x = await montar({ origem: null });
    await expect(servico().finalizar(x.t, null, x.pedido, { pagamentos: DIVIDIDO })).rejects.toThrow('Abra o caixa de entregas');
    expect(await estado(x)).toMatchObject({ pago: false, divisao: 0 });
  });

  it('vários toques juntos em finalizar recebem uma vez: a divisão não duplica', async () => {
    const x = await montar();
    const s = servico();
    const r = await Promise.allSettled(Array.from({ length: 5 }, () => s.finalizar(x.t, null, x.pedido, { pagamentos: DIVIDIDO })));
    expect(r.filter((y) => y.status === 'rejected')).toEqual([]);
    expect(await estado(x)).toEqual({ pago: true, forma: 'dinheiro + pix', divisao: 2, lancamento: { s: x.sessao, forma: 'dinheiro + pix' } });
  });

  it('"Receber pagamento": dois toques juntos, um recebe e o outro é avisado', async () => {
    const x = await montar({ origem: 'pdv', status: 'confirmado', tipo: 'retirada' });
    await q(`update pedido_externo set canal = 'totem' where id = $1`, [x.pedido]);
    const s = servico();
    const r = await Promise.allSettled([s.receberPagamentoTotem(x.t, null, x.pedido, null, null, DIVIDIDO), s.receberPagamentoTotem(x.t, null, x.pedido, null, null, DIVIDIDO)]);
    expect(r.filter((y) => y.status === 'fulfilled')).toHaveLength(1);
    expect(await estado(x)).toEqual({ pago: true, forma: 'dinheiro + pix', divisao: 2, lancamento: { s: x.sessao, forma: 'dinheiro + pix' } });
  });

  it('"Cobrar e entregar": a falha no meio não conclui o pedido, e dois toques cobram uma vez', async () => {
    const x = await montar({ origem: 'pdv', status: 'pronto', tipo: 'retirada' });
    await expect(servico(bancoQueFalhaNoLancamento(db)).entregarBalcao(x.t, null, x.pedido, null, { pagamentos: DIVIDIDO })).rejects.toThrow('a conexão caiu no meio');
    expect((await q(`select status from pedido_externo where id = $1`, [x.pedido]))[0].status).toBe('pronto');
    expect(await estado(x)).toMatchObject({ pago: false, divisao: 0 });
    const s = servico();
    const r = await Promise.allSettled([s.entregarBalcao(x.t, null, x.pedido, null, { pagamentos: DIVIDIDO }), s.entregarBalcao(x.t, null, x.pedido, null, { pagamentos: DIVIDIDO })]);
    expect(r.filter((y) => y.status === 'fulfilled')).toHaveLength(1);
    expect((await q(`select status from pedido_externo where id = $1`, [x.pedido]))[0].status).toBe('concluido');
    expect(await estado(x)).toEqual({ pago: true, forma: 'dinheiro + pix', divisao: 2, lancamento: { s: x.sessao, forma: 'dinheiro + pix' } });
  });
});
