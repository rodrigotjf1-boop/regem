import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FichasService } from './fichas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O NOME DO INGREDIENTE NA LINHA DA FICHA (ERR-231) — contra Postgres (TEST_PG_URL).
// Pedido do dono (14/10/2026): renomeou o pão das 9 fichas e a mesma linha passou a mostrar dois nomes —
// o seletor com o atual, o campo "Insumo" (e a leitura do Farol) com a cópia antiga gravada na linha.
// A ligação é pelo código; o texto `insumo_nome` é que ficava velho. Agora: (1) salvar a ficha grava o
// nome ATUAL do produto ou da sub-receita, não o texto que a tela mandou; (2) na nuvem, a mig 322 leva o
// nome novo às linhas quando o produto ou a ficha é renomeado, por qualquer caminho, e corrige as antigas.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ficha-nome-do-insumo.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('nome do ingrediente na linha da ficha (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const fichas = new FichasService(db);
  const empresas: string[] = [];
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  afterAll(async () => {
    for (const id of empresas) {
      for (const t of ['ficha_ingrediente', 'ficha_tecnica', 'item_estoque']) await q(`delete from ${t} where tenant_id = $1`, [id]).catch(() => {});
      await q(`delete from empresa where id = $1`, [id]).catch(() => {});
    }
    await pool.end();
  });

  async function empresa() {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `Nome teste ${id.slice(0, 6)}`]);
    empresas.push(id);
    return id;
  }
  const produto = async (t: string, nome: string) =>
    (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1, $2, 'unidade', 2) returning id`, [t, nome]))[0].id as string;
  const nomesGravados = async (fichaId: string) =>
    (await q(`select insumo_nome from ficha_ingrediente where ficha_id = $1 and deleted_at is null order by ordem`, [fichaId])).map((r) => r.insumo_nome);

  it('salvar a ficha grava o nome ATUAL do produto, não o texto que a tela mandou', async () => {
    const t = await empresa();
    const pao = await produto(t, 'Pão de teste antigo');
    const f: any = await fichas.create(t, {
      nome: 'Lanche de teste', rendimento: 1,
      ingredientes: [{ insumoNome: 'Texto qualquer', itemId: pao, quantidade: 1, unidade: 'unidade', custoUnitario: 2 }],
    } as any);
    expect(await nomesGravados(f.id)).toEqual(['Pão de teste antigo']);
    // Alguém renomeia o produto enquanto a ficha está aberta; a tela salva com o nome velho.
    await q(`update item_estoque set nome = 'Pão de teste novo' where id = $1`, [pao]);
    await fichas.update(t, f.id, { ingredientes: [{ insumoNome: 'Pão de teste antigo', itemId: pao, quantidade: 1, unidade: 'unidade', custoUnitario: 2 }] } as any);
    expect(await nomesGravados(f.id)).toEqual(['Pão de teste novo']);
    // O caminho de acrescentar uma linha também.
    await fichas.addIngrediente(t, f.id, { insumoNome: 'Outro texto', itemId: pao, quantidade: 2, unidade: 'unidade', custoUnitario: 2, ordem: 1 } as any);
    expect(await nomesGravados(f.id)).toEqual(['Pão de teste novo', 'Pão de teste novo']);
  });

  it('a linha de sub-receita grava o nome atual da sub-receita; a escrita à mão fica como veio', async () => {
    const t = await empresa();
    const sub: any = await fichas.create(t, { nome: 'Molho de teste', rendimento: 1, ingredientes: [] } as any);
    const f: any = await fichas.create(t, {
      nome: 'Prato de teste', rendimento: 1,
      ingredientes: [
        { insumoNome: 'Molho velho', subFichaId: sub.id, quantidade: 1, unidade: 'porção' },
        { insumoNome: 'Sal a gosto', quantidade: 1, unidade: 'grama', custoUnitario: 0.01 },
      ],
    } as any);
    expect(await nomesGravados(f.id)).toEqual(['Molho de teste', 'Sal a gosto']);
  });

  // A mig 322 (só nuvem) roda num esquema à parte, com cópia das tabelas, dentro de uma transação desfeita
  // no fim: não toca os dados dos outros testes. O gatilho de data da mig 259 é posto na cópia das linhas,
  // para provar que a linha renomeada pelo sincronismo (marca `regem.sync`) também ganha data nova.
  it('migration 322: corrige as linhas antigas; renomear produto ou ficha leva o nome às linhas, também pelo sincronismo', async () => {
    const dir = join(__dirname, '../../../../database/migrations');
    const m321 = readFileSync(join(dir, '321_ficha_ingrediente_indices_ligacao.sql'), 'utf8');
    const m322 = readFileSync(join(dir, '322_ficha_linha_nome_atual.sql'), 'utf8');
    expect(m322).toMatch(/^-- @cloud-only/);
    expect(m322).not.toMatch(/\bdrop\b|\btruncate\b/i);
    const esquema = `t322_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`create schema ${esquema}`);
      for (const tabela of ['item_estoque', 'ficha_tecnica', 'ficha_ingrediente'])
        await c.query(`create table ${esquema}.${tabela} (like public.${tabela} including defaults)`);
      await c.query(`set local search_path = ${esquema}`);
      await c.query(`create trigger trg_data before update on ficha_ingrediente for each row execute function public.set_updated_at()`);
      await c.query(m321);
      const ultimo = (r: any) => (Array.isArray(r) ? r[r.length - 1] : r).rows;
      const t = randomUUID();
      const outra = randomUUID();
      const um = async (s: string, p: any[]) => (await c.query(s, p)).rows[0].id as string;
      const pao = await um(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Pão novo', 'unidade') returning id`, [t]);
      const caixa = await um(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Caixa', 'unidade') returning id`, [t]);
      const molho = await um(`insert into ficha_tecnica (tenant_id, nome) values ($1, 'Molho novo') returning id`, [t]);
      const lanche = await um(`insert into ficha_tecnica (tenant_id, nome) values ($1, 'Lanche') returning id`, [t]);
      const linha = (item: string | null, sub: string | null, nome: string, apagada = false, empresa = t) =>
        um(`insert into ficha_ingrediente (tenant_id, ficha_id, item_id, sub_ficha_id, insumo_nome, quantidade, unidade, updated_at, deleted_at)
            values ($1, $2, $3, $4, $5, 1, 'unidade', '2026-01-01', case when $6 then now() end) returning id`, [empresa, lanche, item, sub, nome, apagada]);
      const l = {
        paoVelho: await linha(pao, null, 'Pão gold velho'),
        paoApagada: await linha(pao, null, 'Pão gold velho', true),
        caixaCerta: await linha(caixa, null, 'Caixa'),
        molhoVelho: await linha(null, molho, 'Molho velho'),
        avulsa: await linha(null, null, 'Sal a gosto'),
        outraEmpresa: await linha(pao, null, 'Pão gold velho', false, outra), // mesmo item, outra empresa: não casa
      };
      const ler = async () => {
        const r = (await c.query(`select id, insumo_nome, updated_at > '2026-01-02' as data_nova from ficha_ingrediente`)).rows;
        return Object.fromEntries(Object.entries(l).map(([k, id]) => {
          const x = r.find((y: any) => y.id === id);
          return [k, [x.insumo_nome, x.data_nova]];
        }));
      };

      // A migration: gatilhos + correção das linhas antigas.
      expect(ultimo(await c.query(m322)).every((x: any) => x.ok)).toBe(true);
      expect(await ler()).toEqual({
        paoVelho: ['Pão novo', true],
        paoApagada: ['Pão gold velho', false],
        caixaCerta: ['Caixa', false],
        molhoVelho: ['Molho novo', true],
        avulsa: ['Sal a gosto', false],
        outraEmpresa: ['Pão gold velho', false],
      });

      // Alterar o produto sem trocar o nome não toca as linhas. (A data volta para 01/01 com a marca do
      // sincronismo — sem ela, o gatilho da 259 carimbaria a hora de agora.)
      await c.query(`set local regem.sync = 'on'`);
      await c.query(`update ficha_ingrediente set updated_at = '2026-01-01' where id = any($1::uuid[])`, [[l.paoVelho, l.molhoVelho]]);
      await c.query(`set local regem.sync = 'off'`);
      await c.query(`update item_estoque set custo_medio = 9, nome = nome where id = $1`, [pao]);
      expect((await ler()).paoVelho).toEqual(['Pão novo', false]);

      // Renomear pelo SINCRONISMO (marca regem.sync): o nome vai para a linha e a data é renovada.
      await c.query(`set local regem.sync = 'on'`);
      await c.query(`update item_estoque set nome = 'Pão de hoje' where id = $1`, [pao]);
      await c.query(`set local regem.sync = 'off'`);
      expect((await ler()).paoVelho).toEqual(['Pão de hoje', true]);
      expect((await ler()).outraEmpresa[0]).toBe('Pão gold velho');

      // Renomear a ficha usada como sub-receita.
      await c.query(`update ficha_tecnica set nome = 'Molho da casa' where id = $1`, [molho]);
      expect((await ler()).molhoVelho).toEqual(['Molho da casa', true]);

      // Rodar a migration de novo não muda nada.
      const antes = await ler();
      expect(ultimo(await c.query(m322)).every((x: any) => x.ok)).toBe(true);
      expect(await ler()).toEqual(antes);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });
});
