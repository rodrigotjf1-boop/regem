import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FichasService } from '../fichas/fichas.service';
import { ProdutoController } from './produto.controller';
import { ProdutoService } from './produto.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CUSTO DA OPÇÃO (ADICIONAL) SEGUE A PERMISSÃO "VER VALORES EM R$" — contra Postgres (TEST_PG_URL),
// pelas rotas (`ProdutoController`).
//
// A lista de PRODUTOS já cortava o custo de quem não tem `ver_financeiro`; a lista de OPÇÕES do
// catálogo devolvia o "preço de custo" digitado a qualquer um com acesso ao cardápio, e quem não
// vê o custo podia alterá-lo (um a um ou em massa). Regra do ERR-162: valor em R$ é cortado no
// servidor em TODA rota que o devolve.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('opcao-custo-permissao.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('custo da opção do catálogo conforme a permissão (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const produtos = new (ProdutoService as any)(db, { registrar: async () => undefined }, { flashProdutos: async () => undefined }, new FichasService(db)) as ProdutoService;
  const rotas = new ProdutoController(produtos);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const quem = (t: string, permissoes: any, categoria = 'gerente') => ({ tenantId: t, colaboradorId: randomUUID(), categoria, permissoes }) as any;
  const custoNoBanco = async (id: string) => (await q(`select preco_custo::float8 as c from opcao where id = $1`, [id]))[0].c as number;

  afterAll(async () => {
    if (empresas.length) {
      await pool.query(`delete from opcao where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  async function cenario() {
    const t = (await q(`insert into empresa (nome) values ('teste custo da opção') returning id`))[0].id as string;
    empresas.push(t);
    const comValores = quem(t, { loja: true, ver_financeiro: true });
    const semValores = quem(t, { loja: true });
    const op: any = await rotas.criarOpcaoCatalogo(comValores, { nome: 'Opção de teste', codigoPdv: 'OP1', precoCusto: 4.5 });
    return { t, comValores, semValores, id: op.id as string };
  }

  it('lista: quem vê valores recebe o custo; quem não vê recebe nulo', async () => {
    const c = await cenario();
    const com = ((await rotas.listarOpcoes(c.comValores)) as any[]).find((o) => o.id === c.id);
    expect(Number(com.precoCusto)).toBe(4.5);
    const sem = ((await rotas.listarOpcoes(c.semValores)) as any[]).find((o) => o.id === c.id);
    expect(sem.precoCusto).toBeNull();
    expect(sem).toMatchObject({ nome: 'Opção de teste', codigoPdv: 'OP1' }); // o resto continua vindo
  });

  it('salvar sem a permissão não mexe no custo — nem com o campo vazio, nem com outro valor', async () => {
    const c = await cenario();
    // a tela de quem não vê valores manda o que recebeu (nulo) — pausar a opção não pode zerar o custo
    await rotas.atualizarOpcao(c.semValores, c.id, { nome: 'Opção de teste', codigoPdv: 'OP1', precoCusto: null, esgotado: true });
    expect(await custoNoBanco(c.id)).toBe(4.5);
    await rotas.atualizarOpcao(c.semValores, c.id, { nome: 'Opção de teste', codigoPdv: 'OP1', precoCusto: 99 });
    expect(await custoNoBanco(c.id)).toBe(4.5);
    expect((await q(`select esgotado, nome from opcao where id = $1`, [c.id]))[0]).toMatchObject({ nome: 'Opção de teste' }); // o resto salva
  });

  it('salvar com a permissão muda o custo; campo ausente mantém o que estava', async () => {
    const c = await cenario();
    await rotas.atualizarOpcao(c.comValores, c.id, { nome: 'Opção de teste', codigoPdv: 'OP1', precoCusto: 6 });
    expect(await custoNoBanco(c.id)).toBe(6);
    await rotas.atualizarOpcao(c.comValores, c.id, { nome: 'Opção de teste', codigoPdv: 'OP1' });
    expect(await custoNoBanco(c.id)).toBe(6);
    await rotas.atualizarOpcao(c.comValores, c.id, { nome: 'Opção de teste', codigoPdv: 'OP1', precoCusto: 0 });
    expect(await custoNoBanco(c.id)).toBe(0);
  });

  it('criar sem a permissão: a opção nasce com custo zero, mesmo mandando um valor', async () => {
    const c = await cenario();
    const nova: any = await rotas.criarOpcaoCatalogo(c.semValores, { nome: 'Outra opção de teste', precoCusto: 7 });
    expect(await custoNoBanco(nova.id)).toBe(0);
    expect(nova.precoCusto ?? null).toBeNull(); // a resposta também não devolve custo
  });

  it('custo em massa sem a permissão: recusado (403) e nada muda', async () => {
    const c = await cenario();
    // a rota recusa antes de chamar o serviço (a exceção sai na hora, não numa promessa)
    await expect((async () => rotas.precoCustoOpcoesMassa(c.semValores, { ids: [c.id], precoCusto: 1 }))()).rejects.toMatchObject({ status: 403 });
    expect(await custoNoBanco(c.id)).toBe(4.5);
    await rotas.precoCustoOpcoesMassa(c.comValores, { ids: [c.id], precoCusto: 1 });
    expect(await custoNoBanco(c.id)).toBe(1);
  });
});
