import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from './vendas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Migration 500 — desfaz as 16 vendas em dobro de 02/08 a 09/09/2026, aprovadas pelo dono em 23/11 (ERR-582). Contra o Postgres real.
// O período e os números aprovados são trocados pelos do cenário (março, sem dado de outra spec), numa transação DESFEITA no fim.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('venda-em-dobro-500.spec: sem TEST_PG_URL — PULADO');

const ARQUIVO = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '500_desfazer_16_vendas_em_dobro.sql');
const MOTIVO = 'Venda em dobro: o pedido foi aceito pela nuvem e pelo servidor da loja (ERR-582). Desfeita pela migration 500.';

describe('migration 500 (arquivo)', () => {
  const texto = readFileSync(ARQUIVO, 'utf8');
  it('é só da nuvem, não apaga nada e não leva id de cliente ou de venda no repositório', () => {
    expect(texto.split('\n')[0].trim()).toBe('-- @cloud-only');
    expect(texto).not.toMatch(/\bdrop\b|\btruncate\b|^\s*delete\b/im);
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    for (const trava of ['c_qtd constant integer := 16;', 'c_soma constant numeric := 746.00;', 'c_entradas constant integer := 12;', 'c_caixa constant numeric := 587.50;'])
      expect(texto).toContain(trava);
  });
});

descrever('migration 500: desfaz as 16 vendas em dobro aprovadas (ERR-582)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const semAuditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, semAuditoria);
  const producao = new ProducaoPedidoService(db, semAuditoria, eventos);
  const vendas = new VendasService(db, semAuditoria, eventos, producao, fiscal, {} as any);
  const auditoria = new AuditoriaService(db);
  // O cenário tem 2 sobras (R$ 37,40 com a entrada no caixa e R$ 52,90 sem ela), em março.
  const doCenario = readFileSync(ARQUIVO, 'utf8')
    .replace("'2026-08-01 00:00:00-03'", "'2026-03-01 00:00:00-03'")
    .replace("'2026-09-09 06:00:00-03'", "'2026-03-31 00:00:00-03'")
    .replace(/\b16\b/g, '2')
    .replace(/\b12\b/g, '1')
    .replace(/746\.00/g, '90.30')
    .replace(/587\.50/g, '37.40');
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  let t = '';
  let u = '';
  let produtoId = '';
  const v: Record<string, string> = {};

  async function venda(senha: string, cliente: string, preco: number, criadaEm: string) {
    const r = await vendas.venderExterno(t, null, {
      unidadeId: u,
      cliente,
      forma: 'online',
      origem: 'delivery',
      plataforma: 'anotaai',
      senhaPlataforma: senha,
      itens: [{ produtoId, descricao: 'Lanche de teste', quantidade: 1, precoUnitario: preco }],
    } as any);
    await q('update comanda set created_at = $2::timestamptz where id = $1', [r.comandaId, criadaEm]);
    await q('update producao_pedido set created_at = $2::timestamptz where comanda_id = $1', [r.comandaId, criadaEm]);
    await q('update lancamento_caixa set data = $2::date where comanda_id = $1', [r.comandaId, criadaEm.slice(0, 10)]);
    return r.comandaId as string;
  }
  async function pedido(senha: string, comandaId: string, criadoEm: string) {
    const [p] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total, comanda_id, criado_em)
       values ($1,$2,'anotaai',$3,$4,'Cliente de teste','entrega','concluido','[]'::jsonb,0,$5,$6::timestamptz) returning id`,
      [t, u, randomUUID(), senha, comandaId, criadoEm],
    );
    return p.id as string;
  }
  const senha = () => `U${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    await pool
      .query(`create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
      .catch((e: any) => {
        if (!['23505', '42P07'].includes(e?.code)) throw e;
      });
    t = (await q(`insert into empresa (nome) values ('teste migration 500') returning id`))[0].id;
    u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id;
    produtoId = (await q(
      `insert into produto (tenant_id, codigo, nome, preco_venda, vai_para_producao) values ($1,'D500','Lanche de teste','37.40',true) returning id`,
      [t],
    ))[0].id;
    const a = senha();
    v.sobraA = await venda(a, 'Ana', 37.4, '2026-03-13 19:31:00-03');
    v.gemeaA = await venda(a, 'Ana', 37.4, '2026-03-13 19:31:20-03');
    v.pedidoA = await pedido(a, v.gemeaA, '2026-03-13 19:30:50-03');
    const b = senha();
    v.sobraB = await venda(b, 'Bia', 52.9, '2026-03-24 20:07:00-03');
    v.gemeaB = await venda(b, 'Bia', 52.9, '2026-03-24 20:07:30-03');
    v.pedidoB = await pedido(b, v.gemeaB, '2026-03-24 20:06:50-03');
    await q('delete from lancamento_caixa where comanda_id = $1', [v.sobraB]); // a sobra que nunca entrou no caixa

    // O que NÃO pode mudar: outro cliente e mais de 2 minutos entre as vendas.
    const c = senha();
    v.outroCliente = await venda(c, 'Caio', 41, '2026-03-15 20:00:00-03');
    v.gemeaCliente = await venda(c, 'Dani', 41, '2026-03-15 20:00:30-03');
    await pedido(c, v.gemeaCliente, '2026-03-15 19:59:50-03');
    const d = senha();
    v.longe = await venda(d, 'Edu', 33, '2026-03-16 20:00:00-03');
    v.gemeaLonge = await venda(d, 'Edu', 33, '2026-03-16 20:10:00-03');
    await pedido(d, v.gemeaLonge, '2026-03-16 19:59:50-03');
    await auditoria.registrar({ tenantId: t, atorId: null, atorPerfil: 'presidente', tipo: 'venda', acao: 'teste_antes', detalhe: {} } as any);
  });
  afterAll(async () => {
    for (const tb of ['producao_pedido', 'pedido_externo', 'lancamento_caixa', 'comanda_item', 'comanda', 'produto', 'unidade'])
      await pool.query(`delete from ${tb} where tenant_id = $1`, [t]).catch(() => {});
    await pool.end();
  }, 120_000);

  async function naTransacao(fn: (c: any) => Promise<void>) {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await fn(c);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  }

  it.each([
    ['outra soma', (s: string) => s.replace(/90\.30/g, '90.31')],
    ['outro valor no caixa', (s: string) => s.replace(/37\.40/g, '37.41')],
  ])('%s: recusa sem gravar nada', async (_nome, muda) => {
    await naTransacao(async (c) => {
      await expect(c.query(muda(doCenario))).rejects.toThrow('nada foi gravado');
    });
    expect((await q('select status from comanda where id = $1', [v.sobraA]))[0].status).toBe('fechada');
  });

  it('cancela as sobras na data da venda, estorna só a entrada que existe, mantém o pedido e a auditoria; a 2ª vez não muda nada', async () => {
    await naTransacao(async (c) => {
      const ler = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;
      const resultado: any = await c.query(doCenario);
      const conferencia = (Array.isArray(resultado) ? resultado[resultado.length - 1] : resultado).rows[0];
      expect(conferencia.ok).toBe(true);

      const situacao = async (id: string) =>
        (await ler(`select status, motivo_cancelamento, cancelada_em = created_at as na_data from comanda where id = $1`, [id]))[0];
      for (const id of [v.sobraA, v.sobraB]) expect(await situacao(id)).toEqual({ status: 'cancelada', motivo_cancelamento: MOTIVO, na_data: true });
      for (const id of [v.gemeaA, v.gemeaB, v.outroCliente, v.gemeaCliente, v.longe, v.gemeaLonge]) expect((await situacao(id)).status).toBe('fechada');
      expect((await ler('select comanda_id from pedido_externo where id = $1', [v.pedidoB]))[0].comanda_id).toBe(v.gemeaB);

      const estorno = await ler(`select valor, to_char(data, 'YYYY-MM-DD') as data from lancamento_caixa where comanda_id = $1 and tipo = 'saida'`, [v.sobraA]);
      expect(estorno).toEqual([{ valor: '37.40', data: '2026-03-13' }]);
      expect((await ler(`select count(*)::int as n from lancamento_caixa where comanda_id = $1`, [v.sobraB]))[0].n).toBe(0);
      expect((await ler('select status from producao_pedido where comanda_id = $1', [v.sobraB])).map((x: any) => x.status)).toEqual(['cancelado']);
      expect(await new AuditoriaService(drizzle(c, { schema }) as any).verificarCadeia(t)).toEqual({ ok: true, total: 3, quebras: [] });

      const conta = async () => (await ler(
        `select (select count(*) from lancamento_caixa where tenant_id = $1 and tipo = 'saida')::int as estornos,
                (select count(*) from audit_log where tenant_id = $1)::int as auditoria`,
        [t],
      ))[0];
      const antes = await conta();
      await c.query(doCenario);
      expect(await conta()).toEqual(antes);
    });
  });
});
