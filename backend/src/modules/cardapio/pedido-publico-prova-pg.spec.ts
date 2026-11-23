import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CashbackService } from '../cashback/cashback.service';
import { assinarCliente, verificarCliente } from '../cliente/cliente-token';
import { FidelidadeService } from '../fidelidade/fidelidade.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { CardapioService } from './cardapio.service';
import { RECUSA_DA_QUANTIDADE } from './quantidade-do-cardapio';

/* eslint-disable @typescript-eslint/no-explicit-any */

// 3ª RODADA DE SEGURANÇA (19/11/2026) — o pedido PÚBLICO do cardápio, contra Postgres (TEST_PG_URL), pela porta de verdade
// (`CardapioService.receberPedido`):
// · R3-H01 (ERR-316/V79): digitar o telefone de um cliente que já existe ligava o pedido ao cadastro dele (certo — é
//   comércio) e DEVOLVIA a credencial de "Sua conta" dele (errado — histórico, endereços, cashback e "esquecer meus dados"
//   de outra pessoa). A credencial só volta a quem provou quem é: a credencial do mesmo cliente, ou o WhatsApp do robô.
//   Vale também no reenvio do mesmo `clientRef` (a resposta reconstruída).
// · R3-H02 (ERR-533): a quantidade negativa entrava no subtotal como desconto; fração e número gigante também passavam.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pedido-publico-prova-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('pedido público do cardápio: credencial só com prova e quantidade conferida (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  // A entrada do pedido de sempre, reduzida ao que o teste lê (como no `entrega-fora-da-area-pg.spec`): grava a linha.
  const delivery = {
    ingest: async (tenantId: string, unidadeId: string | null, canal: string, n: any, x: any) =>
      (
        await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, client_ref, display_id, cliente_nome, cliente_telefone, tipo, endereco,
             endereco_rua, endereco_numero, endereco_bairro, itens, total, forma_pagamento, taxa_entrega, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,'novo') returning *`,
          [tenantId, unidadeId, canal, x.clientRef ?? null, n.displayId, n.cliente, n.clienteTelefone, n.tipo, n.endereco ?? null,
            x.enderecoRua ?? null, x.enderecoNumero ?? null, x.enderecoBairro ?? null, JSON.stringify(n.itens), n.total, n.formaPagamento,
            x.taxaEntrega ?? 0],
        )
      ).map((r: any) => ({ ...r, id: r.id, displayId: r.display_id, status: r.status, unidadeId: r.unidade_id }))[0],
    aceitar: async (_t: string, _u: any, id: string) => q(`update pedido_externo set status = 'confirmado' where id = $1`, [id]),
  } as any;
  const cardapio = new CardapioService(db, vendas, delivery, {} as any, new FidelidadeService(db), new CashbackService(db), eventos, {} as any);
  const edgeOriginal = process.env.EDGE_MODE;
  const segredoOriginal = process.env.CLIENTE_TOKEN_SECRET;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    // O pedido do cardápio assina o token do cliente no fim (o CI não tem JWT_SECRET) — um valor de teste.
    if (!process.env.JWT_SECRET && !segredoOriginal) process.env.CLIENTE_TOKEN_SECRET = `teste-${randomUUID()}`;
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(
          `create table if not exists ${t} (id uuid primary key default gen_random_uuid(),
             tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`,
        )
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
  });
  afterAll(async () => {
    if (edgeOriginal !== undefined) process.env.EDGE_MODE = edgeOriginal;
    if (segredoOriginal === undefined) delete process.env.CLIENTE_TOKEN_SECRET;
    else process.env.CLIENTE_TOKEN_SECRET = segredoOriginal;
    if (empresas.length) {
      for (const t of ['impressao_job', 'producao_pedido', 'pedido_externo', 'lancamento_caixa', 'movimento_estoque', 'comanda',
        'cliente_endereco', 'cliente', 'cardapio_config', 'produto', 'categoria_produto', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste pedido publico prova') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Categoria de teste') returning id`, [t]))[0].id as string;
    const lanche = (await q(
      `insert into produto (tenant_id, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque) values ($1,'Lanche de teste',$2,30,false,false) returning id`,
      [t, categoria],
    ))[0].id as string;
    const token = `tk-${randomUUID()}`;
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo, modo) values ($1,$2,$3,true,'retirada')`, [t, u, token]);
    // Um cliente que JÁ existe, com histórico (é o cadastro que outra pessoa tentaria abrir digitando o telefone dele).
    const dono = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Cliente antigo','21987650001') returning id`, [t]))[0]
      .id as string;
    return { t, token, lanche, dono };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  const pedir = (l: Loja, extra: Record<string, any> = {}, interno?: { telefoneVerificado?: boolean }) =>
    cardapio.receberPedido(
      l.token,
      {
        tipo: 'retirada', cliente: 'Quem digitou', telefone: '5521987650001', formaPagamento: 'Pix',
        itens: [{ produtoId: l.lanche, quantidade: 1 } as any], ...extra,
      } as any,
      interno,
    ) as Promise<any>;
  const pedidos = async (l: Loja) => q(`select id, cliente_id, total::float8 as total, itens from pedido_externo where tenant_id = $1`, [l.t]);

  describe('R3-H01 — a credencial de "Sua conta" só volta a quem provou quem é', () => {
    it('telefone de cliente que já existe, sem prova: o pedido se liga ao cadastro, mas a credencial NÃO volta', async () => {
      const l = await loja();
      const r = await pedir(l);
      expect(r.clienteToken).toBeUndefined();
      const [p] = await pedidos(l);
      expect(p.cliente_id).toBe(l.dono); // o comércio continua: o pedido é do cadastro do telefone
    });

    it('com a credencial do próprio cliente: volta (renovada) e é dele', async () => {
      const l = await loja();
      const r = await pedir(l, { clienteToken: assinarCliente(l.dono, l.t) });
      expect(verificarCliente(r.clienteToken)).toEqual({ cli: l.dono, tenant: l.t });
    });

    it('credencial de OUTRA empresa não prova nada aqui: nenhuma credencial volta', async () => {
      const l = await loja();
      const r = await pedir(l, { clienteToken: assinarCliente(randomUUID(), randomUUID()) });
      expect(r.clienteToken).toBeUndefined();
    });

    it('credencial forjada (assinatura errada): nenhuma credencial volta', async () => {
      const l = await loja();
      const boa = assinarCliente(l.dono, l.t);
      const r = await pedir(l, { clienteToken: `${boa.split('.')[0]}.assinatura-falsa` });
      expect(r.clienteToken).toBeUndefined();
    });

    it('o robô do WhatsApp (o número da conversa prova): a credencial volta', async () => {
      const l = await loja();
      const r = await pedir(l, {}, { telefoneVerificado: true });
      expect(verificarCliente(r.clienteToken)).toEqual({ cli: l.dono, tenant: l.t });
    });

    it('telefone novo: o cadastro nasce, mas a credencial só sai pelo código de "Sua conta"', async () => {
      const l = await loja();
      const r = await pedir(l, { telefone: '5521987650099' });
      expect(r.clienteToken).toBeUndefined();
      const [p] = await pedidos(l);
      expect(p.cliente_id).toBeTruthy();
      expect(p.cliente_id).not.toBe(l.dono);
    });

    it('reenvio do mesmo clientRef: a resposta reconstruída também pede a prova', async () => {
      const l = await loja();
      const clientRef = `ref-${randomUUID()}`;
      await pedir(l, { clientRef });
      const semProva = await pedir(l, { clientRef });
      expect(semProva.clienteToken).toBeUndefined();
      const deOutro = await pedir(l, { clientRef, clienteToken: assinarCliente(randomUUID(), l.t) });
      expect(deOutro.clienteToken).toBeUndefined();
      const doDono = await pedir(l, { clientRef, clienteToken: assinarCliente(l.dono, l.t) });
      expect(verificarCliente(doDono.clienteToken)).toEqual({ cli: l.dono, tenant: l.t });
      const peloRobo = await pedir(l, { clientRef }, { telefoneVerificado: true });
      expect(verificarCliente(peloRobo.clienteToken)).toEqual({ cli: l.dono, tenant: l.t });
      expect(await pedidos(l)).toHaveLength(1); // o reenvio não cria outro pedido
    });
  });

  describe('S1-02 — o cashback só sai de quem provou quem é', () => {
    const comSaldo = (l: Loja, telefone: string) =>
      q(`insert into cashback_saldo (tenant_id, telefone, tipo, saldo) values ($1,$2,'valor',20)`, [l.t, telefone]);
    const saldo = async (l: Loja, telefone: string) =>
      Number((await q(`select saldo from cashback_saldo where tenant_id = $1 and telefone = $2 and tipo = 'valor'`, [l.t, telefone]))[0]?.saldo);

    it('digitar o telefone de quem tem saldo não dá desconto nem gasta o saldo', async () => {
      const l = await loja();
      await comSaldo(l, '5521987650001');
      const r = await pedir(l, { telefone: '5521987650001' });
      expect(r).toMatchObject({ total: 30, desconto: 0 });
      expect(await saldo(l, '5521987650001')).toBe(20);
    });

    it('com a credencial do dono: usa o saldo DELE, mesmo com outro telefone digitado', async () => {
      const l = await loja();
      await comSaldo(l, '21987650001');
      await comSaldo(l, '5521999990000');
      const r = await pedir(l, { telefone: '5521999990000', clienteToken: assinarCliente(l.dono, l.t) });
      expect(r).toMatchObject({ total: 10, desconto: 20 });
      expect(await saldo(l, '21987650001')).toBe(0);
      expect(await saldo(l, '5521999990000')).toBe(20);
    });

    it('a credencial de outro cliente não gasta o saldo do telefone digitado', async () => {
      const l = await loja();
      await comSaldo(l, '5521987650001');
      const [outro] = await q(`insert into cliente (tenant_id, nome, telefone) values ($1,'Outro','21900000077') returning id`, [l.t]);
      const r = await pedir(l, { telefone: '5521987650001', clienteToken: assinarCliente(outro.id, l.t) });
      expect(r).toMatchObject({ total: 30, desconto: 0 });
      expect(await saldo(l, '5521987650001')).toBe(20);
    });

    it('o robô do WhatsApp (o número da conversa prova): usa o saldo', async () => {
      const l = await loja();
      await comSaldo(l, '5521987650001');
      const r = await pedir(l, { telefone: '5521987650001', usarCashback: true }, { telefoneVerificado: true });
      expect(r).toMatchObject({ total: 10, desconto: 20 });
      expect(await saldo(l, '5521987650001')).toBe(0);
    });
  });

  describe('R3-H02 — a quantidade de cada item: inteiro de 1 a 9.999', () => {
    it.each([
      ['negativa', -1],
      ['negativa em texto', '-2'],
      ['zero', 0],
      ['fração', 1.5],
      ['gigante', 10000],
      ['texto', 'abc'],
    ])('%s: recusada e nenhum pedido criado', async (_nome, quantidade) => {
      const l = await loja();
      await expect(pedir(l, { itens: [{ produtoId: l.lanche, quantidade }] })).rejects.toMatchObject({
        response: expect.objectContaining({ message: RECUSA_DA_QUANTIDADE }),
      });
      expect(await pedidos(l)).toHaveLength(0);
    });

    it('a negativa não vira desconto ao lado de uma positiva (2 × R$ 30 e −1 × R$ 30): o pedido inteiro é recusado', async () => {
      const l = await loja();
      await expect(
        pedir(l, { itens: [{ produtoId: l.lanche, quantidade: 2 }, { produtoId: l.lanche, quantidade: -1 }] }),
      ).rejects.toMatchObject({ response: expect.objectContaining({ message: RECUSA_DA_QUANTIDADE }) });
      expect(await pedidos(l)).toHaveLength(0);
    });

    it('inteiro em texto vale e soma certo; ausente vale 1', async () => {
      const l = await loja();
      await pedir(l, { itens: [{ produtoId: l.lanche, quantidade: '3' }, { produtoId: l.lanche }] });
      const [p] = await pedidos(l);
      expect(p.total).toBe(120); // (3 + 1) × R$ 30
      expect((p.itens as any[]).map((i) => i.quantidade)).toEqual([3, 1]);
    });
  });
});
