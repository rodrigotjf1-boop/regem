import { randomUUID } from 'node:crypto';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Pool, type PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from './vendas.service';
import { EVENTO_CANCELADOS_NA_BAIXA } from '../delivery/pendencias-turno';
import { pedidoVale } from '../../common/faturamento';
import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// VENDA, COMANDA, ACERTO E CONTA A PAGAR UMA VEZ SÓ — contra Postgres (TEST_PG_URL). Achados da revisão do PDV de
// 24/11/2026 (lote 1): dois cancelamentos do mesmo cupom estornavam duas vezes (D-01); a venda cancelada com o valor ainda
// com o garçom deixava o acerto pendente, que entrava no caixa depois (D-02); dois fechamentos da mesma comanda lançavam a
// entrada duas vezes e o item lançado durante o fechamento entrava numa comanda já fechada (B-01); duas baixas do mesmo
// acerto lançavam duas entradas (B-03); cancelar ou editar a conta a pagar no meio de uma baixa sobrescrevia o "pago"
// (F-01); a soma das formas divididas ficava diferente do total (A-03); e a quantidade zero cobrava uma unidade (A-04).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('vendas-concorrencia-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('venda, comanda, acerto e conta a pagar uma vez só (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG, max: 14 });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const T = randomUUID();
  const auditoria = { registrar: async () => undefined } as any;
  const financeiro = new FinanceiroService(db, auditoria, { imprimirCupomCaixa: async () => ({ enfileirados: 0, aviso: null }) } as any);
  const eventos = new EventEmitter2();
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, new FiscalService(db, auditoria), {} as any);
  let ator: string;
  let loja: string;
  let produto: string;
  let caixa1: string;
  let caixa2: string;
  let salao: string;
  const P = 'presidente';
  const varias = <R>(fs: (() => Promise<R>)[]) => Promise.allSettled(fs.map((f) => f()));
  const ok = (r: PromiseSettledResult<any>[]) => r.filter((x) => x.status === 'fulfilled').length;
  const entradasDa = (comanda: string) =>
    q(`select forma, valor::text as valor from lancamento_caixa where comanda_id = $1 and tipo = 'entrada' order by forma`, [comanda]);
  const saidasDa = (comanda: string) => q(`select forma, valor::text as valor from lancamento_caixa where comanda_id = $1 and tipo = 'saida' order by forma`, [comanda]);
  const terminal = async (tipo: string, nome: string, pdvMain: string | null = null) =>
    (await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token, pdv_main_id) values ($1, $2, $3, $4, $5, $6) returning id`, [T, loja, tipo, nome, randomUUID(), pdvMain]))[0]
      .id as string;
  const vender = (pagamentos?: any[], terminalId = caixa1) =>
    vendas.vendaBalcao(T, ator, P, { itens: [{ produtoId: produto, quantidade: 2 }], forma: pagamentos ? undefined : 'dinheiro', pagamentos, unidadeId: loja } as any, terminalId);
  const comandaComItem = async (terminalId = caixa1) => {
    const c: any = await vendas.abrirComanda(T, ator, { unidadeId: loja });
    await vendas.adicionarItem(T, ator, c.id, { produtoId: produto, quantidade: 1 }, terminalId);
    return c.id as string;
  };
  const conexaoComTransacao = async (): Promise<{ c: PoolClient; pid: number }> => {
    const c = await pool.connect();
    await c.query('begin');
    const [{ pid }] = (await c.query('select pg_backend_pid() as pid')).rows;
    return { c, pid };
  };
  const esperarPresoAtras = async (pid: number) => {
    for (let i = 0; i < 60; i++) {
      const [{ n }] = await q(`select count(*)::int as n from pg_stat_activity where $1 = any(pg_blocking_pids(pid))`, [pid]);
      if (n > 0) return true;
      await new Promise((r) => setTimeout(r, 50));
    }
    return false;
  };

  beforeAll(async () => {
    const criar = (s: string) => pool.query(s).catch((e: any) => {
      if (!['23505', '42P07'].includes(e?.code)) throw e;
    });
    await criar(`create table if not exists edge_status (id uuid primary key default gen_random_uuid(), tenant_id uuid,
                   unidade_id uuid, recebido_em timestamptz not null default now())`);
    await criar(`create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(),
                   ativacao_id uuid, tenant_id uuid, unidade_id uuid, versao text, estado text, ultimo_sync timestamptz,
                   disco_livre_mb integer, clientes integer, fingerprint text, saude jsonb, erro text,
                   recebido_em timestamptz not null default now())`);
    await q(`insert into empresa (id, nome) values ($1, 'teste venda uma vez')`, [T]);
    [{ id: loja }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja') returning id`, [T]);
    const [{ id: funcao }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Presidente', 'presidente') returning id`, [T]);
    [{ id: ator }] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, 'Ana', $2) returning id`, [T, funcao]);
    [{ id: produto }] = await q(`insert into produto (tenant_id, nome, preco_venda) values ($1, 'X-burguer', 25) returning id`, [T]);
    caixa1 = await terminal('pdv', 'Caixa 1');
    caixa2 = await terminal('pdv', 'Caixa 2');
    salao = await terminal('salao', 'Salão', caixa1);
    await financeiro.abrirSessao(T, ator, { terminalId: caixa1, valorAbertura: 0 });
    await financeiro.abrirSessao(T, ator, { terminalId: caixa2, valorAbertura: 0 });
    await Promise.all(Array.from({ length: 12 }, () => pool.query('select pg_sleep(0.05)')));
  });
  afterAll(async () => {
    for (const t of ['producao_pedido', 'pedido_externo', 'acerto_subpdv', 'comanda_pagamento', 'comanda_item_complemento', 'comanda_item', 'lancamento_caixa', 'movimento_estoque', 'comanda', 'titulo_financeiro', 'caixa_sessao', 'equipamento', 'produto', 'colaborador', 'funcao', 'unidade'])
      await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from empresa where id = $1`, [T]).catch(() => undefined);
    await pool.end();
  });

  it('D-01: dois cancelamentos juntos do mesmo cupom (dois caixas) estornam cada forma uma vez só', async () => {
    const v: any = await vender([{ forma: 'dinheiro', valor: 20 }, { forma: 'pix', valor: 30 }]);
    const r = await varias([
      () => vendas.cancelar(T, ator, P, v.comandaId, { motivo: 'teste' }, caixa1),
      () => vendas.cancelar(T, ator, P, v.comandaId, { motivo: 'teste' }, caixa2),
      () => vendas.cancelar(T, ator, P, v.comandaId, { motivo: 'teste' }, caixa1),
    ]);
    expect(ok(r)).toBe(1);
    expect(await saidasDa(v.comandaId)).toEqual([
      { forma: 'dinheiro', valor: '20.00' },
      { forma: 'pix', valor: '30.00' },
    ]);
  });

  it('D-03: cancelar no PDV a venda de um pedido de delivery JÁ concluído tira o pedido do faturamento e devolve os benefícios', async () => {
    const v: any = await vender();
    const [{ id: pedido }] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, tipo, status, total, comanda_id, cliente_telefone) values ($1, $2, 'cardapio', 'entrega', 'concluido', 50, $3, '21900000101') returning id`,
      [T, loja, v.comandaId],
    );
    const conta = async () => {
      const r: any = await db.execute(sql`select count(*)::int as n from pedido_externo pe where pe.id = ${pedido} and ${pedidoVale('pe')}`);
      return (r.rows ?? r)[0].n;
    };
    expect(await conta()).toBe(1);
    const avisados: any[] = [];
    eventos.on(EVENTO_CANCELADOS_NA_BAIXA, (p: any) => avisados.push(p));
    await vendas.cancelar(T, ator, P, v.comandaId, { motivo: 'cliente devolveu' }, caixa1);
    // O pedido segue "concluído" (a sincronização dá precedência a ele), mas não conta mais como venda.
    expect((await q(`select status from pedido_externo where id = $1`, [pedido]))[0].status).toBe('concluido');
    expect(await conta()).toBe(0);
    expect(avisados).toEqual([{ tenantId: T, pedidos: [{ id: pedido, clienteTelefone: '21900000101' }] }]);
  });

  it('D-02: a venda do salão cancelada com o valor ainda com o garçom tira o acerto da fila — e ele não entra mais no caixa', async () => {
    const comanda = await comandaComItem(salao);
    await vendas.fecharComanda(T, ator, P, comanda, { forma: 'dinheiro' }, salao);
    const [acerto] = await q(`select id, status from acerto_subpdv where comanda_id = $1`, [comanda]);
    expect(acerto.status).toBe('pendente');
    await vendas.cancelar(T, ator, P, comanda, { motivo: 'cliente desistiu' }, caixa1);
    expect((await q(`select status from acerto_subpdv where id = $1`, [acerto.id]))[0].status).toBe('cancelado');
    await expect(vendas.baixarAcerto(T, ator, P, acerto.id, {}, caixa1)).rejects.toThrow(/cancelada/);
    expect(await entradasDa(comanda)).toEqual([]);
  });

  it('B-03: duas baixas juntas do mesmo acerto lançam uma entrada só', async () => {
    const comanda = await comandaComItem(salao);
    await vendas.fecharComanda(T, ator, P, comanda, { forma: 'dinheiro' }, salao);
    const [acerto] = await q(`select id from acerto_subpdv where comanda_id = $1`, [comanda]);
    const r = await varias([1, 2, 3].map(() => () => vendas.baixarAcerto(T, ator, P, acerto.id, {}, caixa1)));
    expect(ok(r)).toBe(1);
    expect(await entradasDa(comanda)).toEqual([{ forma: 'dinheiro', valor: '25.00' }]);
  });

  it('B-01: dois fechamentos juntos da mesma comanda (dois caixas) lançam a entrada uma vez só', async () => {
    const comanda = await comandaComItem();
    const r = await varias([
      () => vendas.fecharComanda(T, ator, P, comanda, { forma: 'dinheiro' }, caixa1),
      () => vendas.fecharComanda(T, ator, P, comanda, { forma: 'dinheiro' }, caixa2),
      () => vendas.fecharComanda(T, ator, P, comanda, { forma: 'dinheiro' }, caixa1),
    ]);
    expect(ok(r)).toBe(1);
    expect(await entradasDa(comanda)).toEqual([{ forma: 'dinheiro', valor: '25.00' }]);
  });

  it('B-01: o item lançado enquanto a comanda fecha espera e é recusado — nada entra numa comanda fechada', async () => {
    const comanda = await comandaComItem();
    const { c, pid } = await conexaoComTransacao();
    try {
      await c.query(`select id from comanda where id = $1 for update`, [comanda]);
      await c.query(`update comanda set status = 'fechada', fechada_em = now() where id = $1`, [comanda]);
      const lancando = vendas.adicionarItem(T, ator, comanda, { produtoId: produto, quantidade: 1 }, caixa1);
      lancando.catch(() => undefined);
      await esperarPresoAtras(pid);
      await c.query('commit');
      await expect(lancando).rejects.toThrow(/não está aberta/);
      expect((await q(`select count(*)::int as n from comanda_item where comanda_id = $1`, [comanda]))[0].n).toBe(1);
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });

  it('F-01: cancelar a conta a pagar no meio de uma baixa é recusado — o "pago" fica', async () => {
    const t: any = await financeiro.criar(T, ator, P, { tipo: 'pagar', descricao: 'Boleto · teste', valor: 100, vencimento: '2026-11-30' } as any);
    const { c, pid } = await conexaoComTransacao();
    try {
      await c.query(`update titulo_financeiro set status = 'pago' where id = $1`, [t.id]);
      const cancelando = financeiro.cancelar(T, ator, P, t.id);
      cancelando.catch(() => undefined);
      await esperarPresoAtras(pid);
      await c.query('commit');
      await expect(cancelando).rejects.toThrow(/em aberto/);
      expect((await q(`select status from titulo_financeiro where id = $1`, [t.id]))[0].status).toBe('pago');
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });

  it('A-03: a venda dividida grava no caixa e nas formas exatamente o total; parte zerada ou negativa é recusada', async () => {
    const v: any = await vender([{ forma: 'dinheiro', valor: 25 }, { forma: 'pix', valor: 24.96 }]);
    expect(v.total).toBe(50);
    const entradas = await entradasDa(v.comandaId);
    expect(entradas.reduce((s: number, e: any) => s + Number(e.valor), 0)).toBeCloseTo(50, 5);
    const pagos = await q(`select sum(valor)::text as s from comanda_pagamento where comanda_id = $1`, [v.comandaId]);
    expect(pagos[0].s).toBe('50.00');
    await expect(vender([{ forma: 'dinheiro', valor: 60 }, { forma: 'pix', valor: -10 }])).rejects.toThrow(/maior que zero/);
  });

  it('A-04: quantidade zero, negativa ou absurda recusa a venda inteira; a fração vale', async () => {
    const antes = (await q(`select count(*)::int as n from comanda where tenant_id = $1`, [T]))[0].n;
    for (const quantidade of [0, -1, Number.NaN, 1e9])
      await expect(
        vendas.vendaBalcao(T, ator, P, { itens: [{ produtoId: produto, quantidade }], forma: 'dinheiro', unidadeId: loja } as any, caixa1),
      ).rejects.toThrow(/Quantidade inválida/);
    expect((await q(`select count(*)::int as n from comanda where tenant_id = $1`, [T]))[0].n).toBe(antes);
    const meia: any = await vendas.vendaBalcao(T, ator, P, { itens: [{ produtoId: produto, quantidade: 0.5 }], forma: 'dinheiro', unidadeId: loja } as any, caixa1);
    expect(meia.total).toBe(12.5);
  });
});
