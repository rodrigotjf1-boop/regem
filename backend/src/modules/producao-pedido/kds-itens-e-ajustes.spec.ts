import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ProducaoPedidoService } from './producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Auditoria do KDS (20/10/2026), correções escolhidas pelo dono:
//  • "item removido some": o item tirado da comanda sai do cartão ativo e do resumo, e o cartão ganha "Alterado"; no
//    cartão cancelado os itens ficam (riscados na tela), para a cozinha saber o que parar;
//  • "ajustes valendo na loja": cores e etapas do KDS e o período da senha valem da LOJA e, sem ajuste próprio, da
//    EMPRESA (a tela grava sem loja; a leitura exata caía no padrão). O período mora no ajuste do KDS (mig 332), que
//    sincroniza — o contador é de cada máquina.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('kds-itens-e-ajustes.spec: sem TEST_PG_URL — PULADO');

const ARQUIVO_332 = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '332_kds_periodo_da_senha_no_ajuste.sql');

describe('migration 332 (arquivo)', () => {
  const texto = readFileSync(ARQUIVO_332, 'utf8');
  it('roda nos dois lados (a coluna precisa existir na loja) e passa pela trava do Supabase', () => {
    expect(texto).not.toMatch(/^\s*--\s*@cloud-only\b/im);
    expect(texto).not.toMatch(/\bdrop\b|\btruncate\b|^\s*delete\b/im);
    expect(texto).toMatch(/add column if not exists senha_periodo text/);
  });
});

descrever('KDS: item removido e ajustes da loja (Postgres)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditado: any[] = [];
  const emitidos: any[] = [];
  const producao = new ProducaoPedidoService(
    db,
    { registrar: async (e: any) => void auditado.push(e) } as any,
    { emit: (nome: string, dado: any) => (emitidos.push({ nome, dado }), true) } as any,
  );
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste kds itens e ajustes') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    return { t, u };
  }
  async function cartao(l: { t: string; u: string }, itens: string[]) {
    const comanda = (await q(
      `insert into comanda (tenant_id, unidade_id, status, total, fechada_em, senha_prefixo) values ($1,$2,'fechada',20, now(),'B') returning id`,
      [l.t, l.u],
    ))[0].id as string;
    const id = (await q(
      `insert into producao_pedido (tenant_id, unidade_id, comanda_id, destino_tipo, origem, status)
       values ($1,$2,$3,'kds','balcao','recebido') returning id`,
      [l.t, l.u, comanda],
    ))[0].id as string;
    const comandaItens: string[] = [];
    for (const descricao of itens) {
      const ci = randomUUID();
      comandaItens.push(ci);
      await q(
        `insert into producao_pedido_item (tenant_id, pedido_id, comanda_item_id, descricao, quantidade) values ($1,$2,$3,$4,1)`,
        [l.t, id, ci, descricao],
      );
    }
    return { id, comandaItens };
  }
  const daFila = async (l: { t: string; u: string }, id: string) =>
    ((await producao.filaKds(l.t, { unidadeId: l.u })) as any).pedidos.find((p: any) => p.id === id);

  afterAll(async () => {
    for (const t of empresas) {
      for (const tb of ['producao_pedido_item', 'producao_pedido', 'comanda', 'senha_contador', 'kds_cor_config', 'unidade'])
        await pool.query(`delete from ${tb} where tenant_id = $1`, [t]).catch(() => {});
      await pool.query('delete from empresa where id = $1', [t]).catch(() => {});
    }
    await pool.end();
  }, 60_000);

  it('o item removido sai do cartão ativo e do resumo, o cartão fica "Alterado"; o cancelado mostra o que parar', async () => {
    const l = await loja();
    const c = await cartao(l, ['X-Salada', 'Batata']);
    await producao.removerItemComanda(l.t, c.comandaItens[0]);
    const ativo = await daFila(l, c.id);
    expect(ativo).toMatchObject({ status: 'recebido', obs: 'ALTERADO' });
    expect(ativo.itens.map((i: any) => i.descricao)).toEqual(['Batata']);

    // Tirado o último, o cartão é cancelado e mostra os dois itens (a tela os risca).
    emitidos.length = 0;
    await producao.removerItemComanda(l.t, c.comandaItens[1]);
    const cancelado = await daFila(l, c.id);
    expect(cancelado.status).toBe('cancelado');
    expect(cancelado.itens.map((i: any) => i.descricao).sort()).toEqual(['Batata', 'X-Salada']);
    expect(emitidos.filter((e) => e.dado?.tipo === 'cancelado')).toHaveLength(1);
  });

  it('cores e etapas: a loja sem ajuste próprio usa o da empresa; com ajuste próprio, o dela', async () => {
    const l = await loja();
    await q(`insert into kds_cor_config (tenant_id, unidade_id, verde_ate_min, amarelo_ate_min, usa_preparo, usa_entregue)
             values ($1, null, 6, 12, false, true)`, [l.t]);
    expect(await producao.getCores(l.t, l.u)).toEqual({ verdeAteMin: 6, amareloAteMin: 12, usaPreparo: false, usaEntregue: true });
    // Sem "em preparo" na empresa, o cartão da loja vai de recebido direto para pronto.
    const c = await cartao(l, ['X-Burg']);
    expect(await producao.avancar(l.t, randomUUID(), c.id)).toEqual({ ok: true, status: 'pronto' });

    await q(`insert into kds_cor_config (tenant_id, unidade_id, verde_ate_min, amarelo_ate_min, usa_preparo, usa_entregue)
             values ($1, $2, 3, 8, true, false)`, [l.t, l.u]);
    expect(await producao.getCores(l.t, l.u)).toEqual({ verdeAteMin: 3, amareloAteMin: 8, usaPreparo: true, usaEntregue: false });
    expect(await producao.getCores(l.t, null)).toMatchObject({ verdeAteMin: 6 }); // a tela (sem loja) segue vendo o da empresa
  });

  it('período da senha: o da empresa vale para o contador da loja, o da loja vence, e sem ajuste vale o do contador', async () => {
    const l = await loja();
    // Contador da loja num dia antigo: "diário" zeraria; "nunca" continua.
    await q(`insert into senha_contador (tenant_id, unidade_id, prefixo, valor, periodo, ultimo_reset) values ($1,$2,'B',7,'diario','2000-01-03')`, [l.t, l.u]);
    auditado.length = 0;
    expect(await producao.setSenhaPeriodo(l.t, null, 'nunca')).toEqual({ periodo: 'nunca' });
    expect(auditado).toEqual([expect.objectContaining({ acao: 'alterou_periodo_senha', detalhe: { antes: 'diario', depois: 'nunca' } })]);
    expect((await producao.getSenhaConfig(l.t, null)).periodo).toBe('nunca');
    expect((await producao.getSenhaConfig(l.t, l.u)).periodo).toBe('nunca');
    expect(await producao.proximaSenha(db, l.t, l.u, 'B')).toBe(8); // não zerou

    await producao.setSenhaPeriodo(l.t, l.u, 'diario'); // a loja escolhe o dela
    expect(await producao.proximaSenha(db, l.t, l.u, 'B')).toBe(1); // zerou: dia antigo
    expect((await producao.getSenhaConfig(l.t, null)).periodo).toBe('nunca'); // a empresa continua

    // Sem ajuste nenhum, vale o período do próprio contador (como antes).
    const l2 = await loja();
    await q(`insert into senha_contador (tenant_id, unidade_id, prefixo, valor, periodo, ultimo_reset) values ($1,$2,'B',4,'nunca','2000-01-03')`, [l2.t, l2.u]);
    expect(await producao.proximaSenha(db, l2.t, l2.u, 'B')).toBe(5);
  });

  it('a mig 332 leva a escolha antiga (semanal ou nunca, sem loja) ao ajuste da empresa, sem passar por cima do que já existe', async () => {
    const c: PoolClient = await pool.connect();
    try {
      await c.query('begin');
      const qq = (s: string, p: any[] = []) => c.query(s, p).then((r) => r.rows);
      const novaEmpresa = async () => (await qq(`insert into empresa (nome) values ('teste mig 332') returning id`))[0].id as string;
      const semAjuste = await novaEmpresa();
      await qq(`insert into senha_contador (tenant_id, unidade_id, prefixo, periodo) values ($1, null, 'B', 'semanal')`, [semAjuste]);
      const comAjuste = await novaEmpresa();
      await qq(`insert into senha_contador (tenant_id, unidade_id, prefixo, periodo) values ($1, null, 'B', 'semanal')`, [comAjuste]);
      await qq(`insert into kds_cor_config (tenant_id, unidade_id, senha_periodo) values ($1, null, 'nunca')`, [comAjuste]);
      const res: any = await c.query(readFileSync(ARQUIVO_332, 'utf8'));
      expect((Array.isArray(res) ? res[res.length - 1] : res).rows[0]).toMatchObject({ ok: true, coluna: true });
      const periodo = async (t: string) =>
        (await qq(`select senha_periodo from kds_cor_config where tenant_id = $1 and unidade_id is null`, [t]))[0]?.senha_periodo;
      expect(await periodo(semAjuste)).toBe('semanal');
      expect(await periodo(comAjuste)).toBe('nunca');
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });
});
