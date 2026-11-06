import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { EstornoPixService, TENTATIVAS_DO_ESTORNO } from './estorno-pix.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ESTORNO DO PIX NO CANCELAMENTO (mig 372), contra o Postgres real, com o gateway de mentira (o `reembolsarPagamentoTotal`
// do CardapioService trocado por uma função que anota as chamadas). O que se prova: só o cancelado PAGO ONLINE (Pix aprovado
// por Mercado Pago, PagBank ou Rede) ganha o estorno — o não pago, o de encomenda com sinal, o antigo e o de outro meio
// ficam fora; o estorno é UM só por pedido (duas voltas, duas réplicas ao mesmo tempo); a falha tenta de novo e, na 3ª,
// vira caso URGENTE no Atendimento; a réplica que caiu no meio devolve a vez.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('estorno-pix-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const MIG = (arq: string) => join(__dirname, '../../../../database/migrations', arq);

descrever('estorno do Pix no cancelamento (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const T = randomUUID();
  let loja: string;
  const chamadas: any[] = [];
  let falhar: (pagamento: string) => boolean = () => false;
  const gateway = {
    reembolsarPagamentoTotal: async (tenantId: string, provedor: string, pagamento: string) => {
      chamadas.push({ tenantId, provedor, pagamento });
      await new Promise((r) => setTimeout(r, 30)); // a chamada leva tempo: duas réplicas juntas se cruzam aqui
      if (falhar(pagamento)) throw new Error('Mercado Pago refund 400: saldo insuficiente');
      return { id: `est-${pagamento}`, status: 'approved' };
    },
  };
  const eventos: any[] = [];
  const svc = new EstornoPixService(db, gateway as any, { emit: (n: string, p: any) => eventos.push({ n, p }) } as any);

  async function pedido(o: { status?: string; pago?: boolean; statusPagamento?: string; provedor?: string | null; pagamento?: string | null; sinal?: string | null; diasAtras?: number; total?: number } = {}) {
    const pagamento = o.pagamento === undefined ? `pay-${randomUUID().slice(0, 8)}` : o.pagamento;
    const [r] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, tipo, itens, total, status, pago, status_pagamento, gateway_provider,
                                   gateway_payment_id, sinal_status, display_id, cliente_nome, cliente_telefone, cancelado_em)
       values ($1, $2, 'cardapio', 'entrega', '[]', $3, $4, $5, $6, $7, $8, $9, $10, 'Cliente Teste', '21900000000',
               case when $4 = 'cancelado' then now() - make_interval(days => $11::int) end)
       returning id`,
      [T, loja, o.total ?? 34, o.status ?? 'cancelado', o.pago ?? true, o.statusPagamento ?? 'aprovado', o.provedor === undefined ? 'mercadopago' : o.provedor,
       pagamento, o.sinal ?? null, String(1000 + Math.floor(Math.random() * 8999)), o.diasAtras ?? 0],
    );
    return { id: r.id as string, pagamento };
  }
  const estorno = async (pedidoId: string) => (await q(`select * from pedido_estorno where pedido_id = $1`, [pedidoId]))[0];

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    await repetirNaCorridaDeCatalogo(async () => {
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(comTravaDaEmpresa(readFileSync(MIG('372_pedido_estorno.sql'), 'utf8')));
        await c.query('commit');
      } catch (e) {
        await c.query('rollback').catch(() => {});
        throw e;
      } finally {
        c.release();
      }
    });
    await q(`insert into empresa (id, nome) values ($1, 'teste estorno pix')`, [T]);
    [{ id: loja }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
  });
  beforeEach(async () => {
    chamadas.length = 0;
    eventos.length = 0;
    falhar = () => false;
    // os pedidos de outros testes (de outras empresas) também podem entrar: a conferência é sempre pelo pedido
  });
  afterAll(async () => {
    for (const t of ['pedido_estorno', 'atendimento_chamado', 'pedido_externo', 'unidade']) await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });

  it('só o cancelado PAGO ONLINE ganha o estorno total (Mercado Pago, PagBank e Rede); os outros ficam fora', async () => {
    const mp = await pedido();
    const pb = await pedido({ provedor: 'pagseguro' });
    const rede = await pedido({ provedor: 'rede' });
    const naoCancelado = await pedido({ status: 'confirmado' });
    const naoPago = await pedido({ pago: false, statusPagamento: 'aguardando' });
    const naEntrega = await pedido({ pago: true, statusPagamento: 'na_entrega', provedor: null, pagamento: null });
    const encomenda = await pedido({ sinal: 'pago' });
    const antigo = await pedido({ diasAtras: 40 });
    const outroMeio = await pedido({ provedor: 'gogem' });
    await svc.volta();
    const meus = chamadas.filter((c) => c.tenantId === T).map((c) => [c.provedor, c.pagamento]).sort();
    expect(meus).toEqual([['mercadopago', mp.pagamento], ['pagseguro', pb.pagamento], ['rede', rede.pagamento]].sort());
    for (const p of [mp, pb, rede]) expect(await estorno(p.id)).toMatchObject({ situacao: 'feito', estorno_id: `est-${p.pagamento}`, tentativas: 1, valor: '34.00' });
    for (const p of [naoCancelado, naoPago, naEntrega, encomenda, antigo, outroMeio]) expect(await estorno(p.id)).toBeUndefined();
  });

  it('UM estorno por pedido: outra volta não chama de novo; duas réplicas ao mesmo tempo, uma chamada só', async () => {
    const p = await pedido();
    await svc.volta();
    await svc.volta();
    expect(chamadas.filter((c) => c.pagamento === p.pagamento)).toHaveLength(1);
    const outro = new EstornoPixService(db, gateway as any);
    const juntos = await pedido();
    await Promise.all([svc.volta(), outro.volta(), svc.volta()]);
    expect(chamadas.filter((c) => c.pagamento === juntos.pagamento)).toHaveLength(1);
    expect(await estorno(juntos.id)).toMatchObject({ situacao: 'feito', tentativas: 1 });
  });

  it(`a falha tenta de novo; na ${TENTATIVAS_DO_ESTORNO}ª vira caso URGENTE no Atendimento (devolver à mão) — e não tenta mais`, async () => {
    const p = await pedido({ total: 57.5 });
    falhar = (pg) => pg === p.pagamento;
    await svc.volta();
    expect(await estorno(p.id)).toMatchObject({ situacao: 'pendente', tentativas: 1, erro: 'Mercado Pago refund 400: saldo insuficiente' });
    await svc.volta();
    expect(await estorno(p.id)).toMatchObject({ situacao: 'pendente', tentativas: 2 });
    expect(await q(`select 1 from atendimento_chamado where pedido_id = $1`, [p.id])).toHaveLength(0);
    await svc.volta();
    expect(await estorno(p.id)).toMatchObject({ situacao: 'falhou', tentativas: 3 });
    const [caso] = await q(`select tipo, prioridade, mensagem, pedido_numero, cliente, telefone, unidade_id from atendimento_chamado where pedido_id = $1`, [p.id]);
    expect(caso).toMatchObject({ tipo: 'atendimento', prioridade: 'urgente', cliente: 'Cliente Teste', telefone: '21900000000', unidade_id: loja });
    expect(caso.mensagem).toMatch(/^O estorno do Pix do pedido #\d+ \(R\$\s?57,50\) não saiu: devolva o valor ao cliente pelo app do Mercado Pago\. Motivo do Mercado Pago: Mercado Pago refund 400: saldo insuficiente$/);
    expect(eventos.map((e) => e.n)).toContain('atendimento.novo');
    // falhou: não tenta mais, nem abre outro caso
    await svc.volta();
    expect(chamadas.filter((c) => c.pagamento === p.pagamento)).toHaveLength(3);
    expect(await q(`select 1 from atendimento_chamado where pedido_id = $1`, [p.id])).toHaveLength(1);
  });

  it('a réplica que caiu no meio ("processando" há mais de 5 min) devolve a vez; a que está trabalhando agora, não', async () => {
    const preso = await pedido();
    const agora = await pedido();
    await svc.enfileirar();
    await q(`update pedido_estorno set situacao = 'processando', atualizado_em = now() - interval '6 minutes' where pedido_id = $1`, [preso.id]);
    await q(`update pedido_estorno set situacao = 'processando', atualizado_em = now() where pedido_id = $1`, [agora.id]);
    await svc.volta();
    expect(await estorno(preso.id)).toMatchObject({ situacao: 'feito' });
    expect(await estorno(agora.id)).toMatchObject({ situacao: 'processando' });
    expect(chamadas.filter((c) => c.pagamento === agora.pagamento)).toHaveLength(0);
  });
});
