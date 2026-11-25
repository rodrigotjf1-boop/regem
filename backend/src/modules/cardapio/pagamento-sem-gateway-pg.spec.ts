import { randomUUID } from 'node:crypto';
import { hojeISO } from '../../common/data';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CashbackService } from '../cashback/cashback.service';
import { FidelidadeService } from '../fidelidade/fidelidade.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { CardapioService, categoriaDisponivelAgora } from './cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PAGAMENTO ONLINE SÓ COM COBRANÇA DE VERDADE (auditoria de 22/11/2026, S1-01/B-03 e B-01), contra Postgres:
// · loja sem gateway: a rota pública marcava QUALQUER pedido como pago, sem cobrar. Agora recusa e o pedido fica como estava;
// · o Pix e o cartão online saem do cardápio dessa loja, e o pedido com eles é recusado antes de gravar;
// · pedido cancelado ou concluído não recebe cobrança.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pagamento-sem-gateway-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('pagamento online só com cobrança de verdade (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const gravados: any[] = [];
  const delivery = {
    ingest: async (tenantId: string, _u: any, canal: string, n: any, x: any) => {
      const [row] = await q(
        `insert into pedido_externo (tenant_id, canal, client_ref, display_id, cliente_nome, cliente_telefone, tipo, itens, total, forma_pagamento, status, status_pagamento)
         values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,'novo',$11) returning *`,
        [tenantId, canal, x.clientRef ?? randomUUID(), n.displayId, n.cliente, n.clienteTelefone, n.tipo, JSON.stringify(n.itens), n.total, n.formaPagamento, x.statusPagamento],
      );
      gravados.push(row.id);
      return { ...row, displayId: row.display_id };
    },
    aceitar: async () => undefined,
  } as any;
  const cardapio = new CardapioService(db, vendas, delivery, {} as any, new FidelidadeService(db), new CashbackService(db), eventos, {} as any, auditoria);
  const empresas: string[] = [];
  const antes = { edge: process.env.EDGE_MODE, segredo: process.env.CLIENTE_TOKEN_SECRET, pix: process.env.PIX_SIMULADO, mp: process.env.MP_ACCESS_TOKEN };

  beforeAll(async () => {
    delete process.env.EDGE_MODE;
    delete process.env.PIX_SIMULADO;
    delete process.env.MP_ACCESS_TOKEN;
    if (!process.env.JWT_SECRET && !antes.segredo) process.env.CLIENTE_TOKEN_SECRET = `teste-${randomUUID()}`;
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(`create table if not exists ${t} (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
  });
  afterEach(() => {
    delete process.env.PIX_SIMULADO;
  });
  afterAll(async () => {
    for (const [nome, valor] of [['EDGE_MODE', antes.edge], ['CLIENTE_TOKEN_SECRET', antes.segredo], ['PIX_SIMULADO', antes.pix], ['MP_ACCESS_TOKEN', antes.mp]] as const) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
    if (empresas.length) {
      for (const t of ['pedido_externo', 'cliente', 'integracao', 'cardapio_config', 'produto', 'categoria_produto', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste pagamento sem gateway') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Categoria de teste') returning id`, [t]))[0].id as string;
    const lanche = (await q(
      `insert into produto (tenant_id, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque) values ($1,'Lanche de teste',$2,30,false,false) returning id`,
      [t, categoria],
    ))[0].id as string;
    const token = `tk-${randomUUID()}`;
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, modo, pagamentos) values ($1,$2,$3,true,'retirada','["pix","cartao","entrega"]'::jsonb)`, [t, u, token]);
    return { t, token, lanche };
  }
  const pedidoGravado = async (t: string, status = 'novo', statusPagamento = 'na_entrega') =>
    (await q(`insert into pedido_externo (tenant_id, canal, tipo, itens, total, status, status_pagamento) values ($1,'cardapio','retirada','[]',25,$2,$3) returning id`, [t, status, statusPagamento]))[0].id as string;
  const ler = async (id: string) => (await q(`select status, pago, status_pagamento from pedido_externo where id = $1`, [id]))[0];
  const pedir = (l: Awaited<ReturnType<typeof loja>>, formaPagamento: string) =>
    cardapio.receberPedido(l.token, {
      tipo: 'retirada',
      cliente: 'Cliente de teste',
      telefone: `55219${Math.floor(10000000 + Math.random() * 89999999)}`,
      formaPagamento,
      itens: [{ produtoId: l.lanche, quantidade: 1 } as any],
    } as any);

  it('loja sem gateway: pagar é recusado e o pedido fica como estava, qualquer que seja a forma dele', async () => {
    const l = await loja();
    for (const situacao of ['na_entrega', 'aguardando']) {
      const id = await pedidoGravado(l.t, 'novo', situacao);
      await expect(cardapio.pagarPedidoPublico(l.token, id)).rejects.toThrow('não está recebendo pagamento online');
      expect(await ler(id)).toEqual({ status: 'novo', pago: false, status_pagamento: situacao });
    }
  });

  it('a aprovação simulada só existe ligada de propósito e nunca em produção', async () => {
    const l = await loja();
    const noAmbiente = process.env.NODE_ENV;
    process.env.PIX_SIMULADO = 'true';
    try {
      process.env.NODE_ENV = 'production';
      const emProducao = await pedidoGravado(l.t);
      await expect(cardapio.pagarPedidoPublico(l.token, emProducao)).rejects.toThrow('não está recebendo pagamento online');
      expect((await ler(emProducao)).pago).toBe(false);
    } finally {
      process.env.NODE_ENV = noAmbiente;
    }
    const emTeste = await pedidoGravado(l.t);
    await expect(cardapio.pagarPedidoPublico(l.token, emTeste)).resolves.toMatchObject({ mock: true });
    expect((await ler(emTeste)).pago).toBe(true);
  });

  it('pedido cancelado ou concluído não recebe cobrança, nem na simulação', async () => {
    const l = await loja();
    process.env.PIX_SIMULADO = 'true';
    const cancelado = await pedidoGravado(l.t, 'cancelado', 'aguardando');
    await expect(cardapio.pagarPedidoPublico(l.token, cancelado)).rejects.toThrow('foi cancelado');
    expect((await ler(cancelado)).pago).toBe(false);
    const concluido = await pedidoGravado(l.t, 'concluido');
    await expect(cardapio.pagarPedidoPublico(l.token, concluido)).rejects.toThrow('já foi concluído');
    expect((await ler(concluido)).pago).toBe(false);
  });

  it('o fechamento recusa Pix e cartão online antes de gravar; pagar na entrega segue normal', async () => {
    const l = await loja();
    gravados.length = 0;
    await expect(pedir(l, 'pix')).rejects.toThrow('Escolha outra forma de pagamento');
    await expect(pedir(l, 'cartao')).rejects.toThrow('cartão online ainda não está disponível');
    expect(gravados).toHaveLength(0);
    await expect(pedir(l, 'entrega')).resolves.toMatchObject({ ok: true, pagamentoOnline: false });
    expect(gravados).toHaveLength(1);
  });

  it('o cardápio só mostra o Pix na loja que consegue cobrar; o cartão online não aparece em loja nenhuma (CAR-B-06)', async () => {
    const l = await loja();
    expect(((await cardapio.menu(l.token)) as any).loja.pagamentos).toEqual(['entrega']);
    await q(`insert into integracao (tenant_id, canal, ativo, token) values ($1,'mercadopago',true,'token-de-teste')`, [l.t]);
    expect(((await cardapio.menu(l.token)) as any).loja.pagamentos).toEqual(['pix', 'entrega']);
  });

  it('CAR-B-06: com o provedor de Pix ligado, o pedido em "Cartão online" é recusado antes de gravar (antes virava um QR de Pix)', async () => {
    const l = await loja();
    await q(`insert into integracao (tenant_id, canal, ativo, token) values ($1,'mercadopago',true,'token-de-teste')`, [l.t]);
    gravados.length = 0;
    await expect(pedir(l, 'cartao')).rejects.toThrow('cartão online ainda não está disponível');
    expect(gravados).toHaveLength(0);
  });

  it('CAR-A-04: categoria fechada agora (desligada ou fora do dia) — o produto some do menu e o pedido é recusado', async () => {
    const l = await loja();
    const hoje = new Date(`${hojeISO()}T12:00:00Z`).getUTCDay();
    const outroDia = (hoje + 1) % 7;
    await q(
      `update categoria_produto set disponibilidade = $2::jsonb where id = (select categoria_id from produto where id = $1)`,
      [l.lanche, JSON.stringify([{ dias: [outroDia], inicio: '00:00', fim: '23:59' }])],
    );
    const menu: any = await cardapio.menu(l.token);
    expect(menu.produtos.map((p: any) => p.id)).not.toContain(l.lanche);
    gravados.length = 0;
    await expect(pedir(l, 'entrega')).rejects.toThrow('não está disponível neste horário');
    expect(gravados).toHaveLength(0);
    // Desligada: o mesmo.
    await q(`update categoria_produto set disponibilidade = '[]'::jsonb, ativo = false where id = (select categoria_id from produto where id = $1)`, [l.lanche]);
    expect(((await cardapio.menu(l.token)) as any).produtos.map((p: any) => p.id)).not.toContain(l.lanche);
    await expect(pedir(l, 'entrega')).rejects.toThrow('não está disponível neste horário');
    // Aberta de novo: volta e vende.
    await q(`update categoria_produto set ativo = true where id = (select categoria_id from produto where id = $1)`, [l.lanche]);
    await expect(pedir(l, 'entrega')).resolves.toMatchObject({ ok: true });
  });

  it('CAR-A-04: produto EXCLUÍDO não fecha pedido (o carrinho aberto antes da exclusão)', async () => {
    const l = await loja();
    await q(`update produto set deleted_at = now() where id = $1`, [l.lanche]);
    gravados.length = 0;
    await expect(pedir(l, 'entrega')).rejects.toThrow('Produto indisponível');
    expect(gravados).toHaveLength(0);
  });

  it('CAR-A-04: a janela da categoria é a do horário da LOJA, não a do servidor (a nuvem roda em UTC)', () => {
    const janela = [{ dias: [1], inicio: '18:00', fim: '23:00' }]; // segunda, das 18h às 23h em São Paulo
    expect(categoriaDisponivelAgora(janela, new Date('2026-11-30T19:30:00Z'))).toBe(false); // 16h30 em SP
    expect(categoriaDisponivelAgora(janela, new Date('2026-11-30T21:30:00Z'))).toBe(true); // 18h30 em SP
    expect(categoriaDisponivelAgora(janela, new Date('2026-12-01T02:30:00Z'))).toBe(false); // 23h30 em SP (já é terça em UTC)
  });
});
