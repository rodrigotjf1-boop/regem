import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FichasService } from '../fichas/fichas.service';
import { ProdutoService } from './produto.service';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { MODULO_IFOOD_PELO_ORZUNI, precoIfoodDoPedido } from '../../common/ifood-pelo-orzuni';

/* eslint-disable @typescript-eslint/no-explicit-any */

// iFOOD PELO ORZUNI — R1 (mig 369) — contra Postgres (TEST_PG_URL), com o serviço de verdade.
//
// Pedido do dono (04–05/11/2026): no cadastro do catálogo, um "preço no iFood" por produto e por complemento, separado
// do preço do Regem, e um marcador "está no cardápio do iFood". Nada é enviado ao iFood aqui (o envio é o R2). Tudo
// nasce desligado: o servidor só grava os campos com o direito `ifood_pelo_orzuni` ligado na empresa.
//
// Cada caso confere o que ficou GRAVADO e o que a TELA recebe pela rota que ela usa (a lista de produtos e a de opções
// têm o SELECT escrito à mão — ERR-216).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ifood-pelo-orzuni.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIGRATION = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '369_preco_ifood.sql');

describe('precoIfoodDoPedido (regra do valor, sem banco)', () => {
  it('ausente não mexe; null e vazio limpam; número e texto com vírgula viram 2 casas', () => {
    expect(precoIfoodDoPedido(undefined)).toBeUndefined();
    expect(precoIfoodDoPedido(null)).toBeNull();
    expect(precoIfoodDoPedido('')).toBeNull();
    expect(precoIfoodDoPedido('   ')).toBeNull();
    expect(precoIfoodDoPedido(34.9)).toBe('34.90');
    expect(precoIfoodDoPedido('12,5')).toBe('12.50');
    expect(precoIfoodDoPedido(0)).toBe('0.00'); // complemento grátis no iFood
    expect(precoIfoodDoPedido(0.1 + 0.2)).toBe('0.30'); // erro de ponto flutuante não conta como 3ª casa
  });
  it('recusa negativo, texto, mais de 2 casas, valor absurdo e tipo errado — com o motivo', () => {
    for (const v of [-1, 'abc', 1.234, '1,234', 1_000_000, Number.NaN, Infinity, true, {}, []]) {
      expect(() => precoIfoodDoPedido(v)).toThrow(/Preço no iFood/);
    }
  });
});

descrever('iFood pelo Orzuni no cadastro (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const fichas = new FichasService(db);
  const produtos = new (ProdutoService as any)(db, auditoria, { flashProdutos: async () => undefined }, fichas) as ProdutoService;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['complemento_opcao', 'complemento_grupo', 'produto_complemento', 'complemento_item', 'complemento',
        'opcao', 'produto', 'categoria_produto', 'entitlement', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  async function loja(ligado: boolean) {
    const t = (await q(`insert into empresa (nome) values ('teste ifood pelo orzuni') returning id`))[0].id as string;
    empresas.push(t);
    await q(`insert into unidade (tenant_id, nome) values ($1,'Loja de teste')`, [t]);
    const categoria = (await q(`insert into categoria_produto (tenant_id, nome) values ($1,'Lanches') returning id`, [t]))[0].id as string;
    if (ligado) await ligar(t, true);
    return { t, categoria };
  }
  // A distribuição liga/desliga (o id é o da chave, como `idEntitlement` — V42).
  const ligar = (t: string, ativo: boolean) =>
    q(
      `insert into entitlement (id, tenant_id, modulo, ativo) values (md5('entitlement' || $1 || $3)::uuid, $2, $3, $4)
       on conflict (tenant_id, modulo) do update set ativo = excluded.ativo, updated_at = now()`,
      [t, t, MODULO_IFOOD_PELO_ORZUNI, ativo],
    );
  const gravado = async (id: string) =>
    (await q(`select preco_venda::text as pv, preco_ifood::text as pi, no_ifood as ni from produto where id = $1`, [id]))[0];
  const opcaoGravada = async (id: string) => (await q(`select preco_ifood::text as pi from opcao where id = $1`, [id]))[0];
  const daLista = async (t: string, id: string) => ((await produtos.listar(t, true, null)) as any[]).find((p) => p.id === id);
  const opcaoDaLista = async (t: string, id: string) => ((await produtos.listarOpcoes(t, false, false)) as any[]).find((o) => o.id === id);
  const base = (categoria: string, extra: any = {}) =>
    ({ nome: 'X-Burguer de teste', codigo: '12', categoriaId: categoria, precoVenda: 32.9, ...extra }) as any;

  it('desligado (sem linha do direito): a tela não mostra, e o servidor não grava nada do iFood', async () => {
    const { t, categoria } = await loja(false);
    expect(await produtos.ifoodPeloOrzuni(t)).toBe(false);
    const p = await produtos.criar(t, null as any, 'presidente', base(categoria, { precoIfood: 34.9, noIfood: true }));
    expect(await gravado(p.id)).toEqual({ pv: '32.9', pi: null, ni: false });
    await produtos.atualizar(t, p.id, base(categoria, { precoIfood: 40, noIfood: true }));
    expect(await gravado(p.id)).toEqual({ pv: '32.9', pi: null, ni: false });
    const o = await produtos.criarOpcaoCatalogo(t, { nome: 'Bacon', codigoPdv: '501', precoIfood: 5 });
    expect(await opcaoGravada(o.id)).toEqual({ pi: null });
    // Valor inválido é recusado mesmo desligado (a regra do valor não depende do direito).
    await expect(produtos.atualizar(t, p.id, base(categoria, { precoIfood: -1 }))).rejects.toThrow(/Preço no iFood/);
  });

  it('ligado: grava, e a rota do produto e a LISTA da tela devolvem os dois campos', async () => {
    const { t, categoria } = await loja(true);
    expect(await produtos.ifoodPeloOrzuni(t)).toBe(true);
    const p = await produtos.criar(t, null as any, 'presidente', base(categoria, { precoIfood: 34.9, noIfood: true }));
    expect(await gravado(p.id)).toEqual({ pv: '32.9', pi: '34.90', ni: true });
    const um: any = await produtos.getOne(t, p.id);
    expect([um.precoIfood, um.noIfood]).toEqual(['34.90', true]);
    const l = await daLista(t, p.id);
    expect([l.precoIfood, l.noIfood]).toEqual(['34.90', true]);
    // O preço do Regem segue o dele: os dois canais são independentes.
    expect(l.precoVenda).toBe('32.9');
  });

  it('editar: ausente mantém; null e vazio limpam; texto com vírgula vale; o marcador só aceita sim/não', async () => {
    const { t, categoria } = await loja(true);
    const p = await produtos.criar(t, null as any, 'presidente', base(categoria, { precoIfood: 34.9, noIfood: true }));
    await produtos.atualizar(t, p.id, base(categoria, { nome: 'X-Burguer renomeado' })); // sem os campos do iFood
    expect(await gravado(p.id)).toEqual({ pv: '32.9', pi: '34.90', ni: true });
    await produtos.atualizar(t, p.id, base(categoria, { precoIfood: '36,5', noIfood: false }));
    expect(await gravado(p.id)).toEqual({ pv: '32.9', pi: '36.50', ni: false });
    await produtos.atualizar(t, p.id, base(categoria, { precoIfood: null }));
    expect((await gravado(p.id)).pi).toBeNull();
    await produtos.atualizar(t, p.id, base(categoria, { precoIfood: 30 }));
    await produtos.atualizar(t, p.id, base(categoria, { precoIfood: '' }));
    expect((await gravado(p.id)).pi).toBeNull();
    // V15: marcador fora de true/false é recusado — nunca vira `false` em silêncio.
    await produtos.atualizar(t, p.id, base(categoria, { noIfood: true }));
    await expect(produtos.atualizar(t, p.id, base(categoria, { noIfood: 'sim' }))).rejects.toThrow(/noIfood/);
    await expect(produtos.atualizar(t, p.id, base(categoria, { noIfood: null }))).rejects.toThrow(/noIfood/);
    expect((await gravado(p.id)).ni).toBe(true);
  });

  it('recusa ANTES de gravar: um preço inválido não deixa passar o resto da edição', async () => {
    const { t, categoria } = await loja(true);
    const p = await produtos.criar(t, null as any, 'presidente', base(categoria, { precoIfood: 34.9 }));
    await expect(produtos.atualizar(t, p.id, base(categoria, { precoVenda: 99, precoIfood: 1.234 }))).rejects.toThrow(
      /2 casas/,
    );
    expect(await gravado(p.id)).toEqual({ pv: '32.9', pi: '34.90', ni: false });
    await expect(
      produtos.criar(t, null as any, 'presidente', base(categoria, { codigo: '13', precoIfood: 'abc' })),
    ).rejects.toThrow(/Preço no iFood/);
    expect(await q(`select 1 from produto where tenant_id = $1 and codigo = '13'`, [t])).toHaveLength(0);
  });

  it('duplicar: a cópia nasce sem código e fora do iFood (o preço do iFood vem junto)', async () => {
    const { t, categoria } = await loja(true);
    const p = await produtos.criar(t, null as any, 'presidente', base(categoria, { precoIfood: 34.9, noIfood: true }));
    const copia: any = await produtos.duplicar(t, p.id);
    expect(copia.codigo).toBeNull();
    expect(await gravado(copia.id)).toEqual({ pv: '32.9', pi: '34.90', ni: false });
  });

  it('desligar depois de ligado: o que estava gravado fica, e escrita nova é ignorada', async () => {
    const { t, categoria } = await loja(true);
    const p = await produtos.criar(t, null as any, 'presidente', base(categoria, { precoIfood: 34.9, noIfood: true }));
    await ligar(t, false);
    expect(await produtos.ifoodPeloOrzuni(t)).toBe(false);
    await produtos.atualizar(t, p.id, base(categoria, { precoIfood: null, noIfood: false }));
    expect(await gravado(p.id)).toEqual({ pv: '32.9', pi: '34.90', ni: true });
  });

  it('opção do catálogo: um preço no iFood por opção; a lista devolve; a pausa pela lista (sem o campo) não apaga', async () => {
    const { t } = await loja(true);
    const o = await produtos.criarOpcaoCatalogo(t, { nome: 'Bacon', codigoPdv: '501', precoIfood: '4,5' });
    expect(await opcaoGravada(o.id)).toEqual({ pi: '4.50' });
    expect((await opcaoDaLista(t, o.id)).precoIfood).toBe('4.50');
    // A tela de opções regrava a opção inteira para pausar ("esgotado"), sem o preço do iFood.
    await produtos.atualizarOpcao(t, o.id, { nome: 'Bacon', codigoPdv: '501', esgotado: true });
    expect(await opcaoGravada(o.id)).toEqual({ pi: '4.50' });
    await produtos.atualizarOpcao(t, o.id, { nome: 'Bacon', codigoPdv: '501', precoIfood: 0 });
    expect(await opcaoGravada(o.id)).toEqual({ pi: '0.00' });
    await produtos.atualizarOpcao(t, o.id, { nome: 'Bacon', codigoPdv: '501', precoIfood: null });
    expect(await opcaoGravada(o.id)).toEqual({ pi: null });
    await expect(produtos.atualizarOpcao(t, o.id, { nome: 'Bacon', precoIfood: -2 })).rejects.toThrow(/Preço no iFood/);
  });

  it('migration 369: reaplicar não muda nada, e o banco recusa preço negativo', async () => {
    const texto = readFileSync(MIGRATION, 'utf8');
    // Banco dividido do CI: trava `empresa` primeiro (ERR-377) e repete na corrida de catálogo.
    await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(texto)));
    await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(texto)));
    const cols = await q(
      `select table_name || '.' || column_name as c, numeric_scale as e, column_default as d
         from information_schema.columns
        where table_schema = current_schema()
          and ((table_name = 'produto' and column_name in ('preco_ifood', 'no_ifood'))
            or (table_name = 'opcao' and column_name = 'preco_ifood'))
        order by 1`,
    );
    expect(cols.map((r: any) => r.c)).toEqual(['opcao.preco_ifood', 'produto.no_ifood', 'produto.preco_ifood']);
    expect(cols.find((r: any) => r.c === 'produto.preco_ifood').e).toBe(2);
    expect(cols.find((r: any) => r.c === 'produto.no_ifood').d).toBe('false');
    const { t, categoria } = await loja(true);
    const p = await produtos.criar(t, null as any, 'presidente', base(categoria));
    await expect(q(`update produto set preco_ifood = -1 where id = $1`, [p.id])).rejects.toMatchObject({ code: '23514' });
    const o = await produtos.criarOpcaoCatalogo(t, { nome: 'Cheddar', codigoPdv: '502' });
    await expect(q(`update opcao set preco_ifood = -1 where id = $1`, [o.id])).rejects.toMatchObject({ code: '23514' });
  });
});
