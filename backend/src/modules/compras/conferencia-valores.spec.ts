import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { EstoqueService } from '../estoque/estoque.service';
import { ComprasService } from './compras.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// VALORES DA NOTA NA CONFERÊNCIA — pedido do dono em 10/10/2026: "no processo de conferência vai
// atualizando os valores de acordo com a nota de recebimento". Decisão dele: qualquer conferente
// informa o valor que está na nota; em branco, vale o valor do pedido.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('conferencia-valores.spec: sem TEST_PG_URL — PULADA');
jest.setTimeout(120_000);

descrever('conferência do pedido com os valores da nota (Postgres real)', () => {
  let pool: Pool;
  let db: any;
  const empresas: string[] = [];
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const estoque = () => new (EstoqueService as any)(db, auditoria) as EstoqueService;
  const compras = () => new (ComprasService as any)(db, { emit: () => true }, auditoria) as ComprasService;
  const ator = { colaboradorId: undefined, categoria: 'gerente' };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['titulo_financeiro', 'lote', 'movimento_estoque', 'compra_item', 'compra_lista', 'item_estoque_unidade', 'item_estoque', 'fornecedor', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // Pedido de 10 de cada: queijo a R$ 4,00, carne a R$ 2,00 e sal sem valor.
  async function cenario() {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, 'Empresa de teste')`, [t]);
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja de teste') returning id`, [t]))[0].id as string;
    const f = (await q(`insert into fornecedor (tenant_id, nome) values ($1, 'Fornecedor de teste') returning id`, [t]))[0].id as string;
    const s = estoque();
    const produto = async (nome: string) => ((await s.createItem(t, { nome, unidadeMedida: 'unidade' } as any, null, ator)) as any).id as string;
    const [queijo, carne, sal] = [await produto('Queijo de teste'), await produto('Carne de teste'), await produto('Sal de teste')];
    const c = compras();
    const lista: any = await c.createLista(t, {
      nome: 'Compra de teste', fornecedorId: f,
      itens: [{ itemId: queijo, quantidade: 10, custoUnitario: 4 }, { itemId: carne, quantidade: 10, custoUnitario: 2 }, { itemId: sal, quantidade: 10 }],
    } as any, u);
    const linhas = await q(`select ci.id, i.nome from compra_item ci join item_estoque i on i.id = ci.item_id where ci.lista_id = $1`, [lista.id]);
    const id = (nome: string) => linhas.find((l: any) => l.nome === nome).id as string;
    return { t, u, c, s, id: lista.id as string, queijo, carne, sal, linha: { queijo: id('Queijo de teste'), carne: id('Carne de teste'), sal: id('Sal de teste') } };
  }
  const gravado = async (listaId: string) =>
    q(`select i.nome, ci.qtd_recebida::float8 as recebido, ci.custo_unitario::float8 as custo, ci.custo_pedido::float8 as "custoPedido"
         from compra_item ci join item_estoque i on i.id = ci.item_id where ci.lista_id = $1 order by i.nome`, [listaId]);

  it('o valor da nota vira o custo da linha; o do pedido fica guardado; estoque, custo médio e conta a pagar saem do valor conferido', async () => {
    const x = await cenario();
    await x.c.receber(x.t, x.id, null, {
      notaRef: '  NF  4471 ',
      itens: [
        { compraItemId: x.linha.queijo, qtdRecebida: 8, validadeIndefinida: true, custoUnitario: 4.5 }, // a nota veio mais cara e com menos
        { compraItemId: x.linha.carne, qtdRecebida: 10, validadeIndefinida: true }, // sem valor informado: vale o do pedido
        { compraItemId: x.linha.sal, qtdRecebida: 10, validadeIndefinida: true, custoUnitario: 1.25 }, // o pedido não tinha valor
      ],
    } as any, x.u);
    expect(await gravado(x.id)).toEqual([
      { nome: 'Carne de teste', recebido: 10, custo: 2, custoPedido: null },
      { nome: 'Queijo de teste', recebido: 8, custo: 4.5, custoPedido: 4 },
      { nome: 'Sal de teste', recebido: 10, custo: 1.25, custoPedido: null },
    ]);
    // o que entrou no estoque entrou pelo valor da nota
    const movs = await q(`select i.nome, m.quantidade::float8 as qtd, m.custo_unitario::float8 as custo from movimento_estoque m join item_estoque i on i.id = m.item_id where m.tenant_id = $1 order by i.nome`, [x.t]);
    expect(movs).toEqual([{ nome: 'Carne de teste', qtd: 10, custo: 2 }, { nome: 'Queijo de teste', qtd: 8, custo: 4.5 }, { nome: 'Sal de teste', qtd: 10, custo: 1.25 }]);
    // custo médio do produto = o valor da nota (era a primeira entrada)
    const itens: any[] = await x.s.listItens(x.t, true, x.u);
    expect(Number(itens.find((i) => i.id === x.queijo).custoMedio)).toBeCloseTo(4.5, 6);
    expect(Number(itens.find((i) => i.id === x.sal).custoMedio)).toBeCloseTo(1.25, 6);
    // conta a pagar: 8 × 4,50 + 10 × 2,00 + 10 × 1,25 = 68,50 — e leva a nota
    expect(await q(`select valor::float8 as valor, descricao from titulo_financeiro where tenant_id = $1`, [x.t])).toEqual([{ valor: 68.5, descricao: 'Compra: Compra de teste · nota NF 4471' }]);
    expect((await q(`select nota_ref from compra_lista where id = $1`, [x.id]))[0].nota_ref).toBe('NF 4471');

    // a lista de pedidos mostra o valor do que CHEGOU (não do que foi pedido) e a nota
    const listas: any[] = await x.c.listListas(x.t, x.u);
    expect(listas.find((l) => l.id === x.id)).toMatchObject({ status: 'recebida', valorEstimado: 68.5, notaRef: 'NF 4471', itensComFalta: 1 });
    // quem vê valores em R$ recebe o valor da nota e o do pedido; quem não vê, nenhum dos dois
    const comValor: any = await x.c.getLista(x.t, x.id, x.u, true);
    expect(comValor.notaRef).toBe('NF 4471');
    expect(comValor.itens.find((i: any) => i.itemId === x.queijo)).toMatchObject({ custoUnitario: '4.5', custoPedido: '4' });
    const semValor: any = await x.c.getLista(x.t, x.id, x.u, false);
    expect(semValor.itens.find((i: any) => i.itemId === x.queijo)).toMatchObject({ custoUnitario: null, custoPedido: null });
  });

  it('valor igual ao do pedido não marca mudança; item que não veio não muda de valor; sem nota informada fica sem', async () => {
    const x = await cenario();
    await x.c.receber(x.t, x.id, null, {
      itens: [
        { compraItemId: x.linha.queijo, qtdRecebida: 10, validadeIndefinida: true, custoUnitario: 4 }, // o mesmo valor do pedido
        { compraItemId: x.linha.carne, qtdRecebida: 0, custoUnitario: 9 }, // não veio: o valor informado é ignorado
        { compraItemId: x.linha.sal, qtdRecebida: 10, validadeIndefinida: true, custoUnitario: 0 }, // veio de graça (bonificação)
      ],
    } as any, x.u);
    expect(await gravado(x.id)).toEqual([
      { nome: 'Carne de teste', recebido: 0, custo: 2, custoPedido: null },
      { nome: 'Queijo de teste', recebido: 10, custo: 4, custoPedido: null },
      { nome: 'Sal de teste', recebido: 10, custo: 0, custoPedido: null },
    ]);
    expect(await q(`select valor::float8 as valor, descricao from titulo_financeiro where tenant_id = $1`, [x.t])).toEqual([{ valor: 40, descricao: 'Compra: Compra de teste' }]);
    expect((await q(`select nota_ref from compra_lista where id = $1`, [x.id]))[0].nota_ref).toBeNull();
    // antes de receber, o valor da lista é a estimativa (pedido × valor informado)
    const outro = await cenario();
    expect(((await outro.c.listListas(outro.t, outro.u)) as any[]).find((l) => l.id === outro.id)).toMatchObject({ status: 'aberta', valorEstimado: 60, notaRef: null });
  });
});
