import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FichasService } from '../fichas/fichas.service';
import { ProdutoService } from './produto.service';
import { custoDaImportacao } from '../../common/custo-importado';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-635: desmarcar "Controlar estoque" não tirava a pausa por estoque — ela só saía no próximo `sincronizarEsgotados`
// (uma baixa de estoque; na loja com servidor local, só no servidor). Os Numero 01 e 13 da loja do dono seguiram
// "esgotados" (pausa de outubro) depois de desligado pela nuvem com a loja fechada.
// ERR-636: o custo manual R$ 0,00 que a importação gravou escondia a ficha, e a tela não limpava o campo (vazio ia
// ausente). Aqui: o serviço grava null quando vem null e mantém quando vem ausente; a importação não grava mais zero.

describe('o custo que vem de outro sistema na importação (sem banco)', () => {
  it('só valor positivo vale; vazio, zero e o que não é número = null', () => {
    for (const v of [null, undefined, '', 0, '0', '0,00', -3, 'abc', NaN]) expect(custoDaImportacao(v)).toBeNull();
    expect(custoDaImportacao(12.5)).toBe(12.5);
    expect(custoDaImportacao('12,5')).toBe(12.5);
    expect(custoDaImportacao(' 7.25 ')).toBe(7.25);
  });
  it('as importações do Anota Aí e do Cardápio Web não gravam mais custo zero no produto novo', () => {
    const anota = readFileSync(join(__dirname, '..', 'integracoes', 'anotaai', 'anotaai.service.ts'), 'utf8');
    const cw = readFileSync(join(__dirname, '..', 'integracoes', 'cardapio-web', 'cardapio-web.service.ts'), 'utf8');
    const insertDe = (t: string) => t.slice(t.indexOf('insert into produto ('), t.indexOf('returning id', t.indexOf('insert into produto (')));
    expect(insertDe(anota)).toMatch(/\$\{setor\},null,null,null\)/);
    expect(insertDe(cw)).toMatch(/\$\{custoDaImportacao\(it\.cost_price\)\}\)/);
    expect(insertDe(cw)).not.toMatch(/cost_price\) \|\| 0/);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('custo-e-pausa-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('editar o produto: custo manual e pausa por estoque (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const flashProdutos: string[][] = [];
  const flashPausas: string[][] = [];
  const flash = {
    flashProdutos: async (ids: string[]) => void flashProdutos.push(ids),
    flashPausas: async (ids: string[]) => void flashPausas.push(ids),
  };
  const produtos = new (ProdutoService as any)(db, auditoria, flash, new FichasService(db)) as ProdutoService;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['produto_pausa_estoque', 'produto', 'categoria_produto', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // Uma empresa com duas lojas; o produto pausado por estoque nas duas (como o Numero 01 da loja do dono) e outro produto
  // pausado que não é mexido.
  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste custo e pausa') returning id`))[0].id as string;
    empresas.push(t);
    const l1 = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja 1') returning id`, [t]))[0].id as string;
    const l2 = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja 2') returning id`, [t]))[0].id as string;
    const cat = (await q(`insert into categoria_produto (tenant_id, nome) values ($1, 'Lanches') returning id`, [t]))[0].id as string;
    const novoProduto = async (nome: string, custo: string | null) =>
      (
        await q(
          `insert into produto (tenant_id, nome, categoria_id, preco_venda, preco_custo, controla_estoque, pausado_estoque, pausa_motivo)
           values ($1, $2, $3, 30, $4, true, true, 'Estoque do insumo esgotado') returning id`,
          [t, nome, cat, custo],
        )
      )[0].id as string;
    const p = await novoProduto('Numero 01', '0');
    const outro = await novoProduto('Numero 13', '0');
    for (const prod of [p, outro])
      for (const l of [l1, l2])
        await q(
          `insert into produto_pausa_estoque (id, tenant_id, produto_id, unidade_id, pausado, motivo, updated_at)
           values (md5($2::text || $3::text)::uuid, $1::uuid, $2::uuid, $3::uuid, true, 'Estoque do insumo esgotado', now() - interval '45 days')`,
          [t, prod, l],
        );
    return { t, p, outro };
  }

  it('desligar o controle de estoque tira a pausa do produto e a de todas as lojas, na hora (ERR-635)', async () => {
    const { t, p, outro } = await loja();
    await produtos.atualizar(t, p, { controlaEstoque: false });
    const [prod] = await q(`select controla_estoque, pausado_estoque, pausa_motivo from produto where id = $1`, [p]);
    expect(prod).toEqual({ controla_estoque: false, pausado_estoque: false, pausa_motivo: null });
    const pausas = await q(`select pausado, motivo, updated_at > now() - interval '1 minute' as carimbou from produto_pausa_estoque where produto_id = $1`, [p]);
    expect(pausas).toHaveLength(2);
    expect(pausas.every((x: any) => x.pausado === false && x.motivo === null && x.carimbou === true)).toBe(true);
    // O outro produto não é mexido.
    const doOutro = await q(`select pausado from produto_pausa_estoque where produto_id = $1`, [outro]);
    expect(doOutro.every((x: any) => x.pausado === true)).toBe(true);
    const [o] = await q(`select pausado_estoque from produto where id = $1`, [outro]);
    expect(o.pausado_estoque).toBe(true);
    // O envio rápido ao servidor da loja leva as duas pausas desfeitas.
    expect(flashPausas.at(-1)).toHaveLength(2);
  });

  it('ligar o controle de estoque não pausa nada sozinho (quem pausa é o cálculo dos esgotados)', async () => {
    const { t, p } = await loja();
    await produtos.atualizar(t, p, { controlaEstoque: false });
    const antes = flashPausas.length;
    await produtos.atualizar(t, p, { controlaEstoque: true });
    const [prod] = await q(`select controla_estoque, pausado_estoque from produto where id = $1`, [p]);
    expect(prod).toEqual({ controla_estoque: true, pausado_estoque: false });
    const pausas = await q(`select pausado from produto_pausa_estoque where produto_id = $1`, [p]);
    expect(pausas.every((x: any) => x.pausado === false)).toBe(true);
    expect(flashPausas.length).toBe(antes);
  });

  it('outra edição (sem mexer no controle) não tira a pausa', async () => {
    const { t, p } = await loja();
    await produtos.atualizar(t, p, { descricao: 'nova' });
    const [prod] = await q(`select pausado_estoque from produto where id = $1`, [p]);
    expect(prod.pausado_estoque).toBe(true);
    const pausas = await q(`select pausado from produto_pausa_estoque where produto_id = $1`, [p]);
    expect(pausas.every((x: any) => x.pausado === true)).toBe(true);
  });

  it('o custo manual: null limpa, ausente mantém, zero digitado vale (ERR-636)', async () => {
    const { t, p } = await loja();
    await produtos.atualizar(t, p, { descricao: 'sem custo no corpo' });
    expect((await q(`select preco_custo from produto where id = $1`, [p]))[0].preco_custo).toBe('0');
    await produtos.atualizar(t, p, { precoCusto: null as any });
    expect((await q(`select preco_custo from produto where id = $1`, [p]))[0].preco_custo).toBeNull();
    await produtos.atualizar(t, p, { precoCusto: 0 });
    expect((await q(`select preco_custo from produto where id = $1`, [p]))[0].preco_custo).toBe('0');
    await produtos.atualizar(t, p, { precoPromocional: 25 });
    await produtos.atualizar(t, p, { precoPromocional: null as any });
    expect((await q(`select preco_promocional from produto where id = $1`, [p]))[0].preco_promocional).toBeNull();
  });

  it('outra empresa não é mexida', async () => {
    const a = await loja();
    const b = await loja();
    await expect(produtos.atualizar(a.t, b.p, { controlaEstoque: false })).rejects.toThrow(/não encontrado/);
    const pausas = await q(`select pausado from produto_pausa_estoque where produto_id = $1`, [b.p]);
    expect(pausas.every((x: any) => x.pausado === true)).toBe(true);
  });
});
