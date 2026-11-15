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

// A ÁREA DE ENTREGA DESENHADA NO MAPA (mig 425; protótipo aprovado em 15/11/2026) — contra Postgres (TEST_PG_URL), pelas portas
// de verdade: `setAreas`/`listarAreas` (a tela), `setConfig` (ligar o modo), `menu` (o checkout) e `receberPedido` (o pedido).
// Sem OSRM e sem geocodificar pela rede: o endereço vem com lat/lng.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('area-entrega-mapa-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const L = [-22.8436, -43.2784];
const em = (dLat: number, dLng: number) => ({ lat: L[0] + dLat, lng: L[1] + dLng });
// Já com 6 casas, como o serviço grava (`conferirAreas`).
const seis = (n: number) => Math.round(n * 1e6) / 1e6;
const canto = (dLat: number, dLng: number): [number, number] => [seis(L[0] + dLat), seis(L[1] + dLng)];
const PENHA = [canto(0.006, -0.008), canto(0.007, 0.006), canto(-0.002, 0.009), canto(-0.007, 0.003), canto(-0.005, -0.008)];
const OLARIA = [canto(0.013, -0.018), canto(0.016, 0.004), canto(0.004, 0.02), canto(-0.012, 0.016), canto(-0.014, -0.006), canto(-0.004, -0.02)];

descrever('área de entrega desenhada no mapa (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
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
  const cardapio = new CardapioService(db, vendas, delivery, {} as any, new FidelidadeService(db), new CashbackService(db), eventos, {} as any, auditoria);
  const antes = { edge: process.env.EDGE_MODE, osrm: process.env.OSRM_URL, segredo: process.env.CLIENTE_TOKEN_SECRET };

  beforeAll(async () => {
    delete process.env.EDGE_MODE;
    delete process.env.OSRM_URL;
    if (!process.env.JWT_SECRET && !antes.segredo) process.env.CLIENTE_TOKEN_SECRET = `teste-${randomUUID()}`;
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool
        .query(`create table if not exists ${t} (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
        .catch((e: any) => {
          if (!['23505', '42P07'].includes(e?.code)) throw e;
        });
  });
  afterAll(async () => {
    if (antes.edge !== undefined) process.env.EDGE_MODE = antes.edge;
    if (antes.osrm !== undefined) process.env.OSRM_URL = antes.osrm;
    if (antes.segredo === undefined) delete process.env.CLIENTE_TOKEN_SECRET;
    else process.env.CLIENTE_TOKEN_SECRET = antes.segredo;
    if (empresas.length) {
      for (const t of ['impressao_job', 'producao_pedido', 'pedido_externo', 'lancamento_caixa', 'movimento_estoque', 'comanda',
        'cardapio_area_entrega', 'cardapio_bairro', 'cardapio_config', 'produto', 'categoria_produto', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste area desenhada') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste') returning id`, [t]))[0].id as string;
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Categoria de teste') returning id`, [t]))[0].id as string;
    const lanche = (await q(
      `insert into produto (tenant_id, nome, categoria_id, preco_venda, vai_para_producao, controla_estoque) values ($1,'Lanche de teste',$2,20,false,false) returning id`,
      [t, categoria],
    ))[0].id as string;
    const token = `tk-${randomUUID()}`;
    await q(
      `insert into cardapio_config (tenant_id, unidade_id, token, ativo, modo, area_modo, end_lat, end_lng, frete_gratis_acima)
       values ($1,$2,$3,true,'retirada','bairro',$4,$5,100)`,
      [t, u, token, L[0], L[1]],
    );
    return { t, u, token, lanche };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const AREAS = [
    { nome: 'Penha', poligono: PENHA, taxa: 5, tempoMin: 25, tempoMax: 35, cor: '#0E7C66', ativo: true },
    { nome: 'Olaria', poligono: OLARIA, taxa: 7, tempoMin: 35, tempoMax: 45, pedidoMinimo: 30, freteGratisAcima: 50, ativo: true },
    { nome: 'Pausada', poligono: [canto(-0.03, 0.03), canto(-0.03, 0.04), canto(-0.04, 0.04)], taxa: 9, ativo: false },
  ];
  const ligarMapa = async (l: Loja) => {
    await cardapio.setAreas(l.t, l.u, AREAS, { id: null, perfil: 'presidente' });
    await cardapio.setConfig(l.t, l.u, { areaModo: 'mapa' });
  };
  const entrega = (l: Loja, ponto: { lat: number; lng: number }, qtd = 1) =>
    cardapio.receberPedido(l.token, {
      tipo: 'entrega', cliente: 'Cliente de teste', telefone: `55219${Math.floor(10000000 + Math.random() * 89999999)}`, rua: 'Rua de teste', numero: '10',
      formaPagamento: 'Pix', itens: [{ produtoId: l.lanche, quantidade: qtd } as any], ...ponto,
    } as any);
  const pedidos = (l: Loja) => q(`select taxa_entrega::float8 as taxa, endereco_bairro, total::float8 as total from pedido_externo where tenant_id = $1 order by criado_em`, [l.t]);

  it('salvar a lista: grava na ordem, normaliza, audita; uma área errada recusa sem gravar nada', async () => {
    const l = await loja();
    const salvas = await cardapio.setAreas(l.t, l.u, AREAS, { id: null, perfil: 'presidente' });
    expect(salvas.map((a) => [a.nome, a.ordem, a.taxa, a.ativo])).toEqual([
      ['Penha', 0, 5, true],
      ['Olaria', 1, 7, true],
      ['Pausada', 2, 9, false],
    ]);
    expect(salvas[0]).toMatchObject({ tempoMin: 25, tempoMax: 35, cor: '#0E7C66', pedidoMinimo: null });
    expect(salvas[1]).toMatchObject({ pedidoMinimo: 30, freteGratisAcima: 50 });
    expect(auditados.some((e) => e.acao === 'salvou_areas_entrega' && e.tenantId === l.t && e.detalhe.areas.length === 3)).toBe(true);
    // A troca da lista não deixa sobra; um erro na 2ª área recusa e a lista de antes fica.
    await cardapio.setAreas(l.t, l.u, [AREAS[1]]);
    expect((await cardapio.listarAreas(l.t)).map((a) => a.nome)).toEqual(['Olaria']);
    await expect(cardapio.setAreas(l.t, l.u, [AREAS[0], { nome: 'Ruim', poligono: [canto(0, 0)] }])).rejects.toThrow('A área "Ruim" precisa de pelo menos 3 cantos no mapa.');
    expect((await cardapio.listarAreas(l.t)).map((a) => a.nome)).toEqual(['Olaria']);
  });

  it('ligar o modo mapa exige uma área no ar; com o modo ligado, a lista não pode ficar sem área no ar', async () => {
    const l = await loja();
    await expect(cardapio.setConfig(l.t, l.u, { areaModo: 'mapa' })).rejects.toThrow('Desenhe e deixe no ar pelo menos uma área');
    await cardapio.setAreas(l.t, l.u, [{ ...AREAS[0], ativo: false }]);
    await expect(cardapio.setConfig(l.t, l.u, { areaModo: 'mapa' })).rejects.toThrow('Desenhe e deixe no ar pelo menos uma área');
    await ligarMapa(l);
    expect((await q(`select area_modo from cardapio_config where tenant_id = $1`, [l.t]))[0].area_modo).toBe('mapa');
    await expect(cardapio.setAreas(l.t, l.u, [{ ...AREAS[0], ativo: false }])).rejects.toThrow('deixe pelo menos uma área no ar');
    await expect(cardapio.setAreas(l.t, l.u, [])).rejects.toThrow('deixe pelo menos uma área no ar');
    expect((await cardapio.listarAreas(l.t)).length).toBe(3); // nada mudou
    // Os outros modos continuam: volta para bairro e distância.
    await cardapio.setConfig(l.t, l.u, { areaModo: 'raio' });
    await cardapio.setConfig(l.t, l.u, { areaModo: 'bairro' });
    expect((await q(`select area_modo from cardapio_config where tenant_id = $1`, [l.t]))[0].area_modo).toBe('bairro');
  });

  it('o pedido: dentro da área, a taxa e o nome dela; onde se cruzam, a de cima; fora, ou na pausada, recusado sem pedido', async () => {
    const l = await loja();
    await ligarMapa(l);
    await entrega(l, em(0.001, 0.001)); // dentro das duas: vale a Penha (ordem 0)
    await entrega(l, em(0.009, 0.012), 2); // só Olaria (2 lanches = R$ 40, acima do mínimo de 30)
    expect((await pedidos(l)).map((p) => [p.taxa, p.endereco_bairro])).toEqual([
      [5, 'Penha'],
      [7, 'Olaria'],
    ]);
    for (const ponto of [{ lat: -21.77, lng: -43.27 }, em(-0.035, 0.037)]) {
      await expect(entrega(l, ponto)).rejects.toMatchObject({ response: expect.objectContaining({ code: 'FORA_DA_AREA' }) });
    }
    expect((await pedidos(l)).length).toBe(2);
  });

  it('o pedido mínimo e o frete grátis da área', async () => {
    const l = await loja();
    await ligarMapa(l);
    await expect(entrega(l, em(0.009, 0.012), 1)).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'PEDIDO_MINIMO_DA_AREA', message: expect.stringMatching(/R\$\s30,00/) }),
    });
    await entrega(l, em(0.009, 0.012), 3); // R$ 60 em Olaria: acima dos R$ 50 do frete grátis DA ÁREA (a loja é 100)
    await entrega(l, em(0.001, 0.001), 3); // R$ 60 na Penha: sem frete grátis dela, vale o da loja (100) → paga
    expect((await pedidos(l)).map((p) => p.taxa)).toEqual([0, 5]);
  });

  it('o cardápio público manda só as áreas no ar, sem o nome, e só no modo mapa', async () => {
    const l = await loja();
    await cardapio.setAreas(l.t, l.u, AREAS);
    expect(((await cardapio.menu(l.token)) as any).areas).toEqual([]); // ainda no modo bairro
    await cardapio.setConfig(l.t, l.u, { areaModo: 'mapa' });
    const m: any = await cardapio.menu(l.token);
    expect(m.loja.areaModo).toBe('mapa');
    expect(m.areas.map((a: any) => a.taxa)).toEqual([5, 7]);
    expect(m.areas[0]).toEqual({ poligono: PENHA, taxa: 5, tempoMin: 25, tempoMax: 35, pedidoMinimo: null, freteGratisAcima: null, ordem: 0 });
    expect(JSON.stringify(m.areas)).not.toContain('Olaria');
  });
});
