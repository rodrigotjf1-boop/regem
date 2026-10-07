import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TOTEM na lista "Retirada / Encomendas" (decisão do dono, 30/09/2026 — mig 301):
//  • opção "o pago sai da lista quando ficar pronto": o pronto do KDS conclui o pedido JÁ PAGO
//    (o mesmo "Entregar" do balcão, com a baixa de estoque); desligada = como antes;
//  • cartão/PIX ainda em aprovação é pago NO TOTEM: o balcão não aceita nem cobra.
// Postgres real (a regra lê a config e o pedido do banco).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('totem-conclui-ao-ficar-pronto.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const MIG_301 = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '301_totem_conclui_ao_ficar_pronto.sql');

descrever('totem: pedido pago sai da lista ao ficar pronto (mig 301)', () => {
  let pool: Pool;
  let servico: DeliveryService;
  const baixas: string[] = [];
  const criadas: string[] = [];
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  const empresa = async () => {
    const t = randomUUID();
    const u = randomUUID();
    await q(`insert into empresa (id, nome) values ($1,'teste totem pronto')`, [t]);
    criadas.push(t);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$2,'Loja')`, [u, t]);
    return { t, u };
  };

  /** Pedido de retirada ligado a uma comanda (o KDS avisa o "pronto" pela comanda). */
  const pedido = async (
    t: string,
    u: string,
    o: { canal?: string; status?: string; pago?: boolean; forma?: string; comanda?: boolean } = {},
  ) => {
    const comandaId = o.comanda === false ? null : randomUUID();
    if (comandaId) await q(`insert into comanda (id, tenant_id, status, total) values ($1,$2,'fechada',10)`, [comandaId, t]);
    const [r] = await q(
      `insert into pedido_externo
         (tenant_id, unidade_id, canal, external_id, status, tipo, pago, comanda_id, forma_pagamento, itens, total)
       values ($1,$2,$3,$4,$5,'retirada',$6,$7,$8,'[]'::jsonb,10) returning id`,
      [t, u, o.canal ?? 'totem', randomUUID(), o.status ?? 'confirmado', o.pago ?? true, comandaId, o.forma ?? 'dinheiro'],
    );
    return { id: r.id as string, comandaId };
  };
  const status = async (id: string) => (await q(`select status, entregue_em from pedido_externo where id = $1`, [id]))[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    // A coluna da 301 (no CI ela vem com todas as migrations; aqui a própria spec garante).
    await pool.query(readFileSync(MIG_301, 'utf8'));
    const vendas = { baixarEstoqueExterno: async (_t: string, comandaId: string) => void baixas.push(comandaId) };
    servico = new DeliveryService(
      drizzle(pool, { schema }) as any,
      vendas as any,
      // a produção responde que a comanda está toda pronta (o caso de dois cards tem spec própria)
      { comandaTodaPronta: async () => true } as any,
      {} as any,
      {} as any,
      { emit: () => undefined } as any,
      { flashPedidos: () => {} } as any,
    );
  });
  afterAll(async () => {
    if (!pool) return;
    for (const t of criadas) {
      await q('delete from pedido_externo where tenant_id = $1', [t]).catch(() => {});
      await q('delete from comanda where tenant_id = $1', [t]).catch(() => {});
      await q('delete from delivery_config where tenant_id = $1', [t]).catch(() => {});
      await q('delete from unidade where tenant_id = $1', [t]).catch(() => {});
      await q('delete from empresa where id = $1', [t]).catch(() => {});
    }
    await pool.end();
  });

  it('opção desligada (padrão): o pago fica PRONTO na lista, esperando o "Entregar"', async () => {
    const { t, u } = await empresa();
    expect(await servico.totemConcluiAoFicarPronto(t)).toBe(false);
    const p = await pedido(t, u);
    await servico.aoProducaoPronto({ tenantId: t, comandaId: p.comandaId });
    expect((await status(p.id)).status).toBe('pronto');
    expect(baixas).not.toContain(p.comandaId);
  });

  it('opção ligada: o pago CONCLUI no pronto da cozinha (sai da lista) e baixa o estoque', async () => {
    const { t, u } = await empresa();
    expect(await servico.setTotemConcluiAoFicarPronto(t, true)).toEqual({ totemConcluiAoFicarPronto: true, mudou: true });
    expect((await servico.listarRetirada(t)).totemConcluiAoFicarPronto).toBe(true);
    const p = await pedido(t, u, { forma: 'credito' });
    await servico.aoProducaoPronto({ tenantId: t, comandaId: p.comandaId });
    const s = await status(p.id);
    expect(s.status).toBe('concluido');
    expect(s.entregue_em).not.toBeNull();
    expect(baixas).toContain(p.comandaId);
    // O que ainda deve (produz antes de cobrar) espera o "Cobrar e entregar".
    const devendo = await pedido(t, u, { pago: false });
    await servico.aoProducaoPronto({ tenantId: t, comandaId: devendo.comandaId });
    expect((await status(devendo.id)).status).toBe('pronto');
    // Pedido de outra origem (cardápio) não entra na regra do totem.
    const cardapio = await pedido(t, u, { canal: 'cardapio' });
    await servico.aoProducaoPronto({ tenantId: t, comandaId: cardapio.comandaId });
    expect((await status(cardapio.id)).status).toBe('pronto');
  });

  it('gravar a mesma opção de novo não conta como mudança (a auditoria só registra a troca)', async () => {
    const { t } = await empresa();
    expect((await servico.setTotemConcluiAoFicarPronto(t, false)).mudou).toBe(false); // padrão já é desligado
    expect((await servico.setTotemConcluiAoFicarPronto(t, true)).mudou).toBe(true);
    expect((await servico.setTotemConcluiAoFicarPronto(t, true)).mudou).toBe(false);
    expect(await servico.totemConcluiAoFicarPronto(t)).toBe(true);
  });

  it('cartão/PIX em aprovação no totem: o balcão não aceita nem cobra', async () => {
    const { t, u } = await empresa();
    const p = await pedido(t, u, { status: 'novo', pago: false, forma: 'pix', comanda: false });
    await expect(servico.aceitar(t, null, p.id)).rejects.toThrow(/sendo pago no totem/);
    await expect(servico.receberPagamentoTotem(t, null, p.id, null)).rejects.toThrow(/sendo pago no totem/);
    expect((await status(p.id)).status).toBe('novo');
    // Dinheiro (cobrado no balcão) e pedido já pago não são "pagando no totem".
    expect(DeliveryService.pagandoNoTotem({ canal: 'totem', pago: false, status: 'novo', formaPagamento: 'dinheiro' })).toBe(false);
    expect(DeliveryService.pagandoNoTotem({ canal: 'totem', pago: true, status: 'novo', formaPagamento: 'credito' })).toBe(false);
    expect(DeliveryService.pagandoNoTotem({ canal: 'gogem', pago: false, status: 'novo', formaPagamento: 'debito' })).toBe(true);
    expect(DeliveryService.pagandoNoTotem({ canal: 'cardapio', pago: false, status: 'novo', formaPagamento: 'pix' })).toBe(false);
  });
});
