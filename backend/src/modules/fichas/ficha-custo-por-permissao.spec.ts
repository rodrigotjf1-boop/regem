import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FichasController } from './fichas.controller';
import { FichasService } from './fichas.service';
import { fichaSemCusto } from './ficha-sem-custo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CUSTO DA FICHA SÓ VAI PARA QUEM TEM A PERMISSÃO "FICHAS TÉCNICAS" (decisão do dono,
// 07/10/2026) — contra Postgres (TEST_PG_URL).
// `GET /fichas` e `GET /fichas/:id` são abertas a quem está logado (produtos e ordens de produção
// escolhem a ficha por elas) e devolviam `custoTotal`, `custoPorcao`, CMV e o custo de cada
// ingrediente a qualquer perfil — medido com um perfil de execução sem nenhuma permissão.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ficha-custo-por-permissao.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const DE_CUSTO = ['custoTotal', 'custoPorcao', 'cmv', 'precoSugerido', 'markup', 'margem', 'custoTotalDelivery', 'custoPorcaoDelivery', 'cmvDelivery', 'margemDelivery'];

descrever('custo da ficha técnica conforme a permissão (Postgres real)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let rotas: FichasController;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const quem = (t: string, categoria: string, permissoes: any) => ({ tenantId: t, colaboradorId: randomUUID(), categoria, permissoes }) as any;

  beforeAll(() => {
    pool = new Pool({ connectionString: URL_PG });
    rotas = new FichasController(new FichasService(drizzle(pool, { schema }) as any));
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['ficha_ingrediente', 'ficha_tecnica'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    }
    await pool.end();
  });

  // Molho: 2 kg a R$ 5 + embalagem só no delivery (1 a R$ 2); rende 4; preço R$ 10; meta 30%.
  // Prato: 1 porção do molho (sub-receita) + 1 un a R$ 4; rende 1; preço R$ 20.
  async function cenario() {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, 'teste custo da ficha')`, [t]);
    empresas.push(t);
    const ficha = async (nome: string, rendimento: number, preco: number) =>
      (await q(`insert into ficha_tecnica (tenant_id, nome, rendimento, preco_venda, meta_cmv) values ($1, $2, $3, $4, 30) returning id`, [t, nome, rendimento, preco]))[0].id as string;
    const ing = (fichaId: string, nome: string, quantidade: number, custo: number, extra: { sub?: string; delivery?: boolean } = {}) =>
      q(`insert into ficha_ingrediente (tenant_id, ficha_id, sub_ficha_id, insumo_nome, quantidade, fator_correcao, custo_unitario, somente_delivery) values ($1, $2, $3, $4, $5, 1, $6, $7)`,
        [t, fichaId, extra.sub ?? null, nome, quantidade, custo, !!extra.delivery]);
    const molho = await ficha('Molho de teste', 4, 10);
    await ing(molho, 'Tomate de teste', 2, 5);
    await ing(molho, 'Embalagem de teste', 1, 2, { delivery: true });
    const prato = await ficha('Prato de teste', 1, 20);
    await ing(prato, 'Molho de teste', 1, 0, { sub: molho });
    await ing(prato, 'Massa de teste', 1, 4);
    return { t, molho, prato };
  }
  const semNenhumCusto = (f: any) => {
    for (const c of DE_CUSTO) expect(f[c]).toBeNull();
    expect(f.custoOculto).toBe(true);
    for (const i of f.ingredientes) expect(i.custoUnitario).toBeNull();
  };

  it('com a permissão "Fichas técnicas": o custo vem inteiro (a resposta de antes, sem campo novo)', async () => {
    const c = await cenario();
    for (const u of [quem(c.t, 'gerente', { fichas: true }), quem(c.t, 'supervisao', { fichas: true, ver_financeiro: false })]) {
      const lista = (await rotas.list(u)) as any[];
      const molho = lista.find((f) => f.id === c.molho);
      expect(molho).toMatchObject({ custoTotal: 10, custoPorcao: 2.5, cmv: 25, custoTotalDelivery: 12, custoPorcaoDelivery: 3, temCustoDelivery: true });
      expect(molho.precoSugerido).toBeCloseTo(8.33, 2);
      expect(molho).not.toHaveProperty('custoOculto');
      expect(molho.ingredientes.map((i: any) => Number(i.custoUnitario)).sort()).toEqual([2, 5]);
      // sub-receita: o prato soma a porção do molho (2,50) + a massa (4,00)
      expect(lista.find((f) => f.id === c.prato)).toMatchObject({ custoTotal: 6.5, custoPorcao: 6.5, cmv: 32.5 });
      const um = (await rotas.getOne(u, c.molho)) as any;
      expect(um).toMatchObject({ custoTotal: 10, custoPorcao: 2.5 });
      expect(um).not.toHaveProperty('custoOculto');
    }
  });

  it('presidente vê o custo mesmo com o pacote de permissões vazio ou desatualizado no token', async () => {
    const c = await cenario();
    for (const permissoes of [undefined, {}, { fichas: false }]) {
      const molho = ((await rotas.list(quem(c.t, 'presidente', permissoes))) as any[]).find((f) => f.id === c.molho);
      expect(molho.custoPorcao).toBe(2.5);
      expect(((await rotas.getOne(quem(c.t, 'presidente', permissoes), c.prato)) as any).custoTotal).toBe(6.5);
    }
  });

  it('sem a permissão: a ficha vem (nome, rendimento, ingredientes e quantidades), o custo não — na lista e na ficha', async () => {
    const c = await cenario();
    const semPermissao = [
      quem(c.t, 'execucao', {}),
      quem(c.t, 'execucao', undefined),
      quem(c.t, 'gerente', { fichas: false, ver_financeiro: true }), // "ver valores em R$" NÃO libera o custo da ficha
      quem(c.t, 'supervisao', { estoque: { ver: true }, producao_kds: true }),
    ];
    for (const u of semPermissao) {
      const lista = (await rotas.list(u)) as any[];
      expect(lista).toHaveLength(2);
      for (const f of lista) semNenhumCusto(f);
      const molho = lista.find((f) => f.id === c.molho);
      // o que as telas de produto e de ordem de produção usam continua lá
      expect(molho).toMatchObject({ nome: 'Molho de teste', temCustoDelivery: true });
      expect(Number(molho.rendimento)).toBe(4);
      expect(Number(molho.precoVenda)).toBe(10); // preço de venda não é custo: está no cardápio
      expect(molho.ingredientes.map((i: any) => [i.insumoNome, Number(i.quantidade)]).sort()).toEqual([['Embalagem de teste', 1], ['Tomate de teste', 2]]);
      const prato = (await rotas.getOne(u, c.prato)) as any;
      semNenhumCusto(prato);
      expect(prato.ingredientes.find((i: any) => i.subFichaId === c.molho).subFichaNome).toBe('Molho de teste');
    }
  });

  it('nenhum número de dinheiro escapa por outro campo (a resposta inteira, em texto, não tem os valores)', async () => {
    const c = await cenario();
    // valores escolhidos para não coincidir com quantidade, rendimento ou preço: 7,77 e 3,33
    await q(`update ficha_ingrediente set custo_unitario = 7.77 where ficha_id = $1 and insumo_nome = 'Tomate de teste'`, [c.molho]);
    await q(`update ficha_ingrediente set custo_unitario = 3.33 where ficha_id = $1 and insumo_nome = 'Massa de teste'`, [c.prato]);
    const comPermissao = JSON.stringify(await rotas.list(quem(c.t, 'gerente', { fichas: true })));
    expect(comPermissao).toContain('7.77');
    expect(comPermissao).toContain('15.54'); // custo total do molho: 2 × 7,77
    const texto = JSON.stringify(await rotas.list(quem(c.t, 'execucao', {}))) + JSON.stringify(await rotas.getOne(quem(c.t, 'execucao', {}), c.prato));
    for (const valor of ['7.77', '3.33', '15.54', '3.89', '7.22', '17.54'])
      expect(texto).not.toContain(valor);
  });

  it('o corte não altera o objeto original (o serviço é usado por outros módulos)', () => {
    const original = { id: 'x', nome: 'Ficha', custoTotal: 9, cmv: 30, ingredientes: [{ insumoNome: 'a', custoUnitario: '4.5' }] };
    const cortada = fichaSemCusto(original);
    expect(original).toEqual({ id: 'x', nome: 'Ficha', custoTotal: 9, cmv: 30, ingredientes: [{ insumoNome: 'a', custoUnitario: '4.5' }] });
    expect(cortada).toMatchObject({ id: 'x', nome: 'Ficha', custoTotal: null, cmv: null, custoOculto: true, ingredientes: [{ insumoNome: 'a', custoUnitario: null }] });
  });

  it('a ficha de outra empresa continua não existindo, com ou sem a permissão', async () => {
    const a = await cenario();
    const b = await cenario();
    await expect(rotas.getOne(quem(a.t, 'gerente', { fichas: true }), b.molho)).rejects.toThrow('Ficha não encontrada');
    await expect(rotas.getOne(quem(a.t, 'execucao', {}), b.molho)).rejects.toThrow('Ficha não encontrada');
    expect(((await rotas.list(quem(a.t, 'execucao', {}))) as any[]).map((f) => f.id).sort()).toEqual([a.molho, a.prato].sort());
  });
});
