import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FichasService } from '../fichas/fichas.service';
import { ProdutoService } from './produto.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O custo do combo pela soma dos produtos dele, no banco: a lista do Cardápio (`listar`) e o mapa dos relatórios e da
// integração (`custoEfetivoMapa`) leem os produtos de cada combo (`produto_combo_item`, só os vivos) e somam o custo de cada
// um × a quantidade. Produto sem custo conhecido deixa o combo sem custo.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('custo-do-combo-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('o custo do combo (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const flash = { flashProdutos: async () => undefined, flashPausas: async () => undefined };
  const produtos = new (ProdutoService as any)(db, { registrar: async () => undefined }, flash, new FichasService(db)) as ProdutoService;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  // Insere preenchendo as colunas obrigatórias sem padrão com um valor qualquer do tipo.
  async function inserir(tabela: string, valores: Record<string, unknown>): Promise<string> {
    const cols = await q(
      `select column_name, data_type from information_schema.columns
        where table_schema = current_schema() and table_name = $1 and is_nullable = 'NO' and column_default is null`,
      [tabela],
    );
    const v: Record<string, unknown> = { ...valores };
    for (const c of cols) {
      if (c.column_name in v) continue;
      const t = String(c.data_type);
      v[c.column_name] = t.includes('uuid') ? randomUUID() : t.includes('int') || t === 'numeric' ? 0 : t === 'boolean' ? false : t.includes('json') ? '{}' : t.includes('timestamp') ? new Date() : 'x';
    }
    const ks = Object.keys(v);
    const r = await q(`insert into ${tabela} (${ks.join(',')}) values (${ks.map((_, i) => `$${i + 1}`).join(',')}) returning id::text as id`, ks.map((k) => v[k]));
    return r[0].id;
  }

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['produto_combo_item', 'produto', 'item_estoque', 'categoria_produto'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  it('a lista e o mapa somam os produtos do combo; produto sem custo deixa o combo sem custo', async () => {
    const t = (await q(`insert into empresa (nome) values ('teste custo do combo') returning id::text as id`))[0].id as string;
    empresas.push(t);
    const cat = await inserir('categoria_produto', { tenant_id: t, nome: 'Combos' });
    const itemLata = await inserir('item_estoque', { tenant_id: t, nome: 'Lata (teste combo)', unidade_medida: 'un', custo_medio: '2.40' });
    const prod = (nome: string, extra: Record<string, unknown> = {}) => inserir('produto', { tenant_id: t, nome, categoria_id: cat, preco_venda: '10', ...extra });
    const lanche = await prod('Lanche', { preco_custo: '9' });
    const lata = await prod('Lata', { item_id: itemLata, item_fator: '1' });
    const semCusto = await prod('Sem custo');
    const trio = await prod('Trio', { tipo: 'combo' });
    const outro = await prod('Combo incompleto', { tipo: 'combo' });
    const item = (combo: string, componente: string, quantidade: string, deletado = false) =>
      inserir('produto_combo_item', { tenant_id: t, combo_produto_id: combo, componente_produto_id: componente, quantidade, deleted_at: deletado ? new Date() : null });
    await item(trio, lanche, '1');
    await item(trio, lata, '2');
    await item(trio, semCusto, '1', true); // retirado do combo: não conta
    await item(outro, lanche, '1');
    await item(outro, semCusto, '1');

    const lista = await produtos.listar(t, true);
    const doTrio: any = lista.find((p: any) => p.id === trio);
    expect(doTrio.custoFonte).toBe('combo');
    expect(Number(doTrio.custoEfetivo)).toBeCloseTo(9 + 2 * 2.4, 6);
    expect(Number(doTrio.custoEfetivoDelivery)).toBeCloseTo(9 + 2 * 2.4, 6);
    const doOutro: any = lista.find((p: any) => p.id === outro);
    expect(doOutro.custoEfetivo).toBeNull();
    expect(doOutro.custoFonte).toBeNull();
    // Quem não vê valores segue sem custo nenhum.
    expect((await produtos.listar(t, false)).find((p: any) => p.id === trio)).toMatchObject({ custoEfetivo: null, custoFonte: null });

    const mapa = await produtos.custoEfetivoMapa(t, null);
    expect(mapa[trio]).toBeCloseTo(13.8, 6);
    expect(mapa[outro]).toBeUndefined();
    expect(mapa[lanche]).toBe(9);
    expect(mapa[lata]).toBeCloseTo(2.4, 6);

    // O custo à mão no combo vence a soma.
    await q(`update produto set preco_custo = 20 where id = $1`, [outro]);
    expect((await produtos.custoEfetivoMapa(t, null))[outro]).toBe(20);
  });
});
