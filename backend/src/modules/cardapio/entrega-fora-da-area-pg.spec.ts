import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CashbackService } from '../cashback/cashback.service';
import { FidelidadeService } from '../fidelidade/fidelidade.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { CardapioService } from './cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PEDIDO DE ENTREGA FORA DA ÁREA (ERR-470) — contra Postgres (TEST_PG_URL), pela porta de verdade
// (`CardapioService.receberPedido`). O pedido #71 da loja-piloto saiu a ~119 km com frete R$ 0 (a última faixa dela é
// R$ 0 até 1,9 km) e foi pago no Pix; agora a recusa vem ANTES de o pedido existir — nenhuma linha em `pedido_externo`.
// Sem OSRM_URL a distância é em linha reta (Haversine); o endereço vem com lat/lng (nada de geocodificar pela rede).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('entrega-fora-da-area-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

// A loja e dois pontos: um a ~0,5 km e outro a ~119 km (para o norte).
const LOJA = { lat: -22.84, lng: -43.27 };
const PERTO = { lat: -22.8355, lng: -43.27 };
const LONGE = { lat: -21.768, lng: -43.27 };
const RAIOS = [{ ateKm: 0.5, taxa: 5 }, { ateKm: 1, taxa: 5 }, { ateKm: 1.5, taxa: 6 }, { ateKm: 1.9, taxa: 0 }];

descrever('pedido de entrega fora da área (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  // A entrada do pedido de sempre, reduzida ao que o teste lê (como no `robo-pedido-pg.spec`): grava a linha.
  const delivery = {
    ingest: async (tenantId: string, unidadeId: string | null, canal: string, n: any, x: any) =>
      (
        await q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, client_ref, display_id, cliente_nome, cliente_telefone, tipo, endereco,
             endereco_rua, endereco_numero, endereco_bairro, itens, total, forma_pagamento, taxa_entrega, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,$15,$16,'novo') returning *`,
          [tenantId, unidadeId, canal, x.clientRef, n.displayId, n.cliente, n.clienteTelefone, n.tipo, n.endereco ?? null, x.enderecoRua ?? null,
            x.enderecoNumero ?? null, x.enderecoBairro ?? null, JSON.stringify(n.itens), n.total, n.formaPagamento, x.taxaEntrega ?? 0],
        )
      ).map((r: any) => ({ ...r, id: r.id, displayId: r.display_id, status: r.status, unidadeId: r.unidade_id }))[0],
    aceitar: async (_t: string, _u: any, id: string) => q(`update pedido_externo set status = 'confirmado' where id = $1`, [id]),
  } as any;
  const cardapio = new CardapioService(db, vendas, delivery, {} as any, new FidelidadeService(db), new CashbackService(db), eventos, {} as any);
  const edgeOriginal = process.env.EDGE_MODE;
  const osrmOriginal = process.env.OSRM_URL;
  const segredoOriginal = process.env.CLIENTE_TOKEN_SECRET;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // como NUVEM
    delete process.env.OSRM_URL; // linha reta, sem rede
    // O pedido do cardápio assina o token do cliente no fim (o CI não tem JWT_SECRET) — um valor de teste, como no robo-pedido-pg.
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
    if (osrmOriginal !== undefined) process.env.OSRM_URL = osrmOriginal;
    if (segredoOriginal === undefined) delete process.env.CLIENTE_TOKEN_SECRET;
    else process.env.CLIENTE_TOKEN_SECRET = segredoOriginal;
    if (empresas.length) {
      for (const t of ['impressao_job', 'producao_pedido', 'pedido_externo', 'lancamento_caixa', 'movimento_estoque', 'comanda',
        'cardapio_bairro', 'cardapio_config', 'produto', 'categoria_produto', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  async function loja(area: { modo: 'raio' | 'bairro'; raios?: any[]; comPonto?: boolean }) {
    const t = (await q(`insert into empresa (nome) values ('teste entrega fora da area') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Categoria de teste') returning id`, [t]))[0].id as string;
    const lanche = (await q(
      `insert into produto (tenant_id, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque) values ($1,'Lanche de teste',$2,65,false,false) returning id`,
      [t, categoria],
    ))[0].id as string;
    const token = `tk-${randomUUID()}`;
    const ponto = area.comPonto === false ? [null, null] : [LOJA.lat, LOJA.lng];
    await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, modo, area_modo, raios, end_lat, end_lng, frete_gratis_acima)
       values ($1,$2,$3,true,'retirada',$4,$5::jsonb,$6,$7,80)`,
      [t, u, token, area.modo, JSON.stringify(area.raios ?? []), ponto[0], ponto[1]],
    );
    const bairro = (await q(`insert into cardapio_bairro (tenant_id, nome, taxa) values ($1,'Bairro de teste',7) returning id`, [t]))[0]
      .id as string;
    return { t, token, lanche, bairro };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;

  const entrega = (l: Loja, extra: Record<string, any>) =>
    cardapio.receberPedido(l.token, {
      tipo: 'entrega', cliente: 'Cliente de teste', telefone: '5521900000000', rua: 'Rua de teste', numero: '10',
      formaPagamento: 'Pix', itens: [{ produtoId: l.lanche, quantidade: 1 } as any], ...extra,
    } as any);
  const pedidos = async (l: Loja) => Number((await q(`select count(*)::int n from pedido_externo where tenant_id = $1`, [l.t]))[0].n);

  it('a ~119 km, além da última faixa (R$ 0): recusado, e nenhum pedido criado', async () => {
    const l = await loja({ modo: 'raio', raios: RAIOS });
    await expect(entrega(l, LONGE)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FORA_DA_AREA', message: expect.stringContaining('a entrega vai até 1,9 km') }),
    });
    expect(await pedidos(l)).toBe(0);
  });

  it('dentro das faixas: o pedido entra, com a taxa da faixa', async () => {
    const l = await loja({ modo: 'raio', raios: RAIOS });
    await entrega(l, PERTO);
    const [p] = await q(`select taxa_entrega::float8 as taxa, endereco_bairro from pedido_externo where tenant_id = $1`, [l.t]);
    expect(p.taxa).toBe(5);
    expect(p.endereco_bairro).toMatch(/km$/);
  });

  it('frete grátis acima de R$ 80 não abre exceção para fora da área', async () => {
    const l = await loja({ modo: 'raio', raios: RAIOS });
    await expect(entrega(l, { ...LONGE, itens: [{ produtoId: l.lanche, quantidade: 2 }] })).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'FORA_DA_AREA' }),
    });
    expect(await pedidos(l)).toBe(0);
  });

  it('modo distância sem o ponto da loja (cadastro incompleto): segue como antes, não recusa', async () => {
    const l = await loja({ modo: 'raio', raios: RAIOS, comPonto: false });
    await entrega(l, LONGE);
    expect(await pedidos(l)).toBe(1);
  });

  it('modo bairro: sem bairro da lista é recusado; com o bairro, entra com a taxa dele', async () => {
    const l = await loja({ modo: 'bairro' });
    await expect(entrega(l, {})).rejects.toMatchObject({ response: expect.objectContaining({ code: 'BAIRRO_FORA_DA_AREA' }) });
    await expect(entrega(l, { bairroId: randomUUID() })).rejects.toMatchObject({ response: expect.objectContaining({ code: 'BAIRRO_FORA_DA_AREA' }) });
    expect(await pedidos(l)).toBe(0);
    await entrega(l, { bairroId: l.bairro });
    const [p] = await q(`select taxa_entrega::float8 as taxa from pedido_externo where tenant_id = $1`, [l.t]);
    expect(p.taxa).toBe(7);
  });

  it('retirada não confere a área', async () => {
    const l = await loja({ modo: 'raio', raios: RAIOS });
    await cardapio.receberPedido(l.token, {
      tipo: 'retirada', cliente: 'Cliente de teste', telefone: '5521900000001', itens: [{ produtoId: l.lanche, quantidade: 1 } as any],
    } as any);
    expect(await pedidos(l)).toBe(1);
  });
});
