import { createHash, randomUUID } from 'node:crypto';
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

// Migration 497 — desfaz as 33 vendas em dobro aprovadas pelo dono em 23/11/2026 (ERR-582). Contra o Postgres real, com as vendas
// criadas pelo `venderExterno`. A migration confere o número e a soma aprovados: aqui os dois valores são trocados pelos do cenário.
// Roda numa transação DESFEITA no fim, para não mexer nos dados das specs em paralelo.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('venda-em-dobro-497.spec: sem TEST_PG_URL — PULADO');

const ARQUIVO = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '497_desfazer_33_vendas_em_dobro.sql');
const MOTIVO = 'Venda em dobro: o pedido foi aceito pela nuvem e pelo servidor da loja (ERR-582). Desfeita pela migration 497.';
const uuidDoMd5 = (s: string) => {
  const h = createHash('md5').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

describe('migration 497 (arquivo)', () => {
  const texto = readFileSync(ARQUIVO, 'utf8');
  it('é só da nuvem, não apaga nada e não leva id de cliente ou de venda no repositório', () => {
    expect(texto.split('\n')[0].trim()).toBe('-- @cloud-only');
    expect(texto).not.toMatch(/\bdrop\b|\btruncate\b|^\s*delete\b/im);
    expect(texto).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(texto).toContain('c_qtd constant integer := 33;');
    expect(texto).toContain('c_soma constant numeric := 1572.49;');
  });
});

descrever('migration 497: desfaz as vendas em dobro aprovadas (ERR-582)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const semAuditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, semAuditoria);
  const producao = new ProducaoPedidoService(db, semAuditoria, eventos);
  const vendas = new VendasService(db, semAuditoria, eventos, producao, fiscal, {} as any);
  const auditoria = new AuditoriaService(db);
  const original = readFileSync(ARQUIVO, 'utf8');
  // O cenário tem 2 sobras, de R$ 37,40 e R$ 52,90.
  const doCenario = original.replace(/\b33\b/g, '2').replace(/1572\.49/g, '90.30');
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  let t = '';
  let u = '';
  let produtoId = '';
  const v: Record<string, string> = {};

  async function venda(senha: string, preco: number, criadaEm: string, dataDoCaixa: string) {
    const r = await vendas.venderExterno(t, null, {
      unidadeId: u,
      cliente: 'Cliente de teste',
      forma: 'online',
      origem: 'delivery',
      plataforma: 'anotaai',
      senhaPlataforma: senha,
      itens: [{ produtoId, descricao: 'Lanche de teste', quantidade: 1, precoUnitario: preco }],
    } as any);
    await q('update comanda set created_at = $2::timestamptz where id = $1', [r.comandaId, criadaEm]);
    await q('update producao_pedido set created_at = $2::timestamptz where comanda_id = $1', [r.comandaId, criadaEm]);
    await q('update lancamento_caixa set data = $2::date where comanda_id = $1', [r.comandaId, dataDoCaixa]);
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
  const senha = () => `T${randomUUID().slice(0, 6)}`;

  beforeAll(async () => {
    await pool
      .query(`create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(), tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`)
      .catch((e: any) => {
        if (!['23505', '42P07'].includes(e?.code)) throw e;
      });
    t = (await q(`insert into empresa (nome) values ('teste migration 497') returning id`))[0].id;
    u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id;
    produtoId = (await q(
      `insert into produto (tenant_id, codigo, nome, preco_venda, vai_para_producao) values ($1,'D497','Lanche de teste','37.40',true) returning id`,
      [t],
    ))[0].id;

    const a = senha();
    v.sobraA = await venda(a, 37.4, '2026-11-13 20:11:00-03', '2026-11-13');
    v.gemeaA = await venda(a, 37.4, '2026-11-14 05:36:00-03', '2026-11-14');
    v.pedidoA = await pedido(a, v.gemeaA, '2026-11-13 20:11:01-03');
    const b = senha();
    v.sobraB = await venda(b, 52.9, '2026-10-21 19:05:00-03', '2026-10-21');
    v.gemeaB = await venda(b, 52.9, '2026-10-21 19:07:00-03', '2026-10-21');
    v.pedidoB = await pedido(b, v.gemeaB, '2026-10-21 19:04:50-03');

    // O que NÃO pode mudar: antes do período aprovado, total diferente e fora das 3 horas.
    const c = senha();
    v.antesDoPeriodo = await venda(c, 41, '2026-09-08 20:00:00-03', '2026-09-08');
    v.gemeaAntes = await venda(c, 41, '2026-09-08 20:02:00-03', '2026-09-08');
    await pedido(c, v.gemeaAntes, '2026-09-08 19:59:50-03');
    const d = senha();
    v.totalDiferente = await venda(d, 45, '2026-10-22 21:00:00-03', '2026-10-22');
    v.gemeaTotal = await venda(d, 44, '2026-10-22 21:01:00-03', '2026-10-22');
    await pedido(d, v.gemeaTotal, '2026-10-22 20:59:50-03');
    const e = senha();
    v.longe = await venda(e, 33, '2026-10-23 12:00:00-03', '2026-10-23');
    v.gemeaLonge = await venda(e, 33, '2026-10-23 21:00:00-03', '2026-10-23');
    await pedido(e, v.gemeaLonge, '2026-10-23 20:59:50-03');

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

  it('outro número de vendas ou outra soma: recusa sem gravar nada', async () => {
    await naTransacao(async (c) => {
      await expect(c.query(original)).rejects.toThrow('nada foi gravado');
    });
    await naTransacao(async (c) => {
      await expect(c.query(doCenario.replace(/90\.30/g, '90.31'))).rejects.toThrow('nada foi gravado');
    });
    expect((await q('select status from comanda where id = $1', [v.sobraA]))[0].status).toBe('fechada');
  });

  it('sobra com entrada em sessão de caixa: recusa sem gravar nada', async () => {
    await naTransacao(async (c) => {
      const [sessao] = (await c.query(`insert into caixa_sessao (tenant_id, unidade_id, status) values ($1,$2,'aberto') returning id`, [t, u])).rows;
      await c.query('update lancamento_caixa set sessao_id = $2 where comanda_id = $1', [v.sobraA, sessao.id]);
      await expect(c.query(doCenario)).rejects.toThrow('nada foi gravado');
    });
  });

  it('cancela a sobra na data da venda, estorna a entrada, tira a produção, mantém o pedido e continua a auditoria; a 2ª vez não muda nada', async () => {
    await naTransacao(async (c) => {
      const ler = async (s: string, p: any[] = []) => (await c.query(s, p)).rows;
      const resultado: any = await c.query(doCenario);
      const conferencia = (Array.isArray(resultado) ? resultado[resultado.length - 1] : resultado).rows[0];
      expect(conferencia.ok).toBe(true);

      const situacao = async (id: string) =>
        (await ler(`select status, motivo_cancelamento, cancelada_em = created_at as na_data_da_venda from comanda where id = $1`, [id]))[0];
      for (const id of [v.sobraA, v.sobraB])
        expect(await situacao(id)).toEqual({ status: 'cancelada', motivo_cancelamento: MOTIVO, na_data_da_venda: true });
      for (const id of [v.gemeaA, v.gemeaB, v.antesDoPeriodo, v.gemeaAntes, v.totalDiferente, v.gemeaTotal, v.longe, v.gemeaLonge])
        expect((await situacao(id)).status).toBe('fechada');

      expect((await ler('select comanda_id from pedido_externo where id = $1', [v.pedidoA]))[0].comanda_id).toBe(v.gemeaA);
      expect((await ler('select comanda_id from pedido_externo where id = $1', [v.pedidoB]))[0].comanda_id).toBe(v.gemeaB);

      const [entradaA] = await ler(`select id, valor from lancamento_caixa where comanda_id = $1 and tipo = 'entrada'`, [v.sobraA]);
      expect(await ler(
        `select id, categoria, forma, valor, to_char(data, 'YYYY-MM-DD') as data, sessao_id, estorno_de, descricao
           from lancamento_caixa where comanda_id = $1 and tipo = 'saida'`,
        [v.sobraA],
      )).toEqual([{
        id: uuidDoMd5('regem:497:estorno:' + entradaA.id), categoria: 'estorno', forma: 'online', valor: entradaA.valor,
        data: '2026-11-13', sessao_id: null, estorno_de: entradaA.id, descricao: 'Estorno · venda em dobro (ERR-582)',
      }]);
      expect((await ler(`select count(*)::int as n from lancamento_caixa where comanda_id = any($1::uuid[]) and tipo = 'saida'`, [[v.gemeaA, v.gemeaB, v.longe]]))[0].n).toBe(0);

      expect((await ler('select status from producao_pedido where comanda_id = $1', [v.sobraA])).map((x: any) => x.status)).toEqual(['cancelado']);
      expect((await ler('select status from producao_pedido where comanda_id = $1', [v.gemeaA])).map((x: any) => x.status)).not.toContain('cancelado');

      const aud = await ler(`select entidade_id, detalhe from audit_log where tenant_id = $1 and acao = 'desfez_venda_em_dobro' order by seq`, [t]);
      expect(aud.map((a: any) => a.entidade_id)).toEqual([v.sobraB, v.sobraA]);
      expect(aud[1].detalhe).toEqual({ motivo: MOTIVO, comandaGemeaId: v.gemeaA, pedidoExternoId: v.pedidoA, valor: '37.40', migration: '497' });
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
