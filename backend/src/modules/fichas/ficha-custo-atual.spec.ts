import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ponderarCustoDaEntrada } from '../../common/custo-loja';
import { lerCadastroDeCusto } from '../mister/mister-indicadores.leitura';
import { ProdutoService } from '../produto/produto.service';
import { FichasService } from './fichas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CUSTO DA FICHA ACOMPANHA AS COMPRAS — contra Postgres (TEST_PG_URL). `ficha_ingrediente.custo_unitario` é uma cópia de quando a
// ficha foi salva: depois de uma compra, a tela, o CMV e a Curva ABC ficavam com o custo velho, e o Mister usava o de hoje.
// A regra, a mesma nos dois: linha ligada ao estoque usa o custo médio atual (o da loja, se houver; senão, o do cadastro); sem custo
// médio, o valor gravado na linha; linha sem item, o valor digitado. Ler nunca grava nada de volta.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ficha-custo-atual.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('o custo da ficha acompanha as compras (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  // `as any`: esta spec também roda contra o código antigo, em que as leituras não recebem a loja.
  const fichas = new FichasService(db, auditoria) as any;
  const produtos = new (ProdutoService as any)(db, auditoria, { flashProdutos: async () => undefined }, fichas) as any;
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  afterAll(async () => {
    for (const t of ['produto', 'ficha_ingrediente', 'ficha_tecnica', 'movimento_estoque', 'item_estoque_unidade', 'item_conversao', 'item_estoque', 'unidade'])
      await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
    await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    await pool.end();
  });

  async function empresa(nLojas = 1) {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [t, `Custo atual ${t.slice(0, 6)}`]);
    empresas.push(t);
    const lojas: string[] = [];
    for (let i = 0; i < nLojas; i++) lojas.push((await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [t, `Loja ${i + 1}`]))[0].id);
    return { t, lojas };
  }
  const item = async (t: string, nome: string, custo: number, unidade = 'kg') =>
    (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1,$2,$3,$4) returning id`, [t, nome, unidade, custo]))[0].id as string;
  const custoNaLoja = (t: string, it: string, loja: string, custo: number) =>
    q(`insert into item_estoque_unidade (id, tenant_id, item_id, unidade_id, custo_medio) values (md5($2::text || $3::text)::uuid, $1, $2::uuid, $3::uuid, $4)`, [t, it, loja, custo]);
  // A compra pelo caminho de verdade: o movimento de entrada e o custo médio ponderado.
  async function comprar(t: string, it: string, qtd: number, custo: number, loja: string | null = null) {
    const [m] = await q(
      `insert into movimento_estoque (tenant_id, unidade_id, item_id, tipo, quantidade, custo_unitario, motivo, data)
       values ($1,$2,$3,'entrada',$4,$5,'recebimento', current_date) returning id`,
      [t, loja, it, qtd, custo],
    );
    await db.transaction((tx: any) => ponderarCustoDaEntrada(tx, t, m.id, it, qtd, custo));
  }
  const copiasGravadas = async (ficha: string) =>
    (await q(`select custo_unitario::float8 as c from ficha_ingrediente where ficha_id = $1 and deleted_at is null order by ordem`, [ficha])).map((l) => l.c);
  const daLista = async (t: string, id: string, loja: string | null = null) => (await fichas.list(t, loja)).find((f: any) => f.id === id);
  const noMister = async (t: string, id: string, loja: string | null = null, canal: 'balcao' | 'delivery' = 'balcao') =>
    (await lerCadastroDeCusto(db, t)).custoDaFicha(id, canal, loja);

  it('depois de uma compra, a tela, o CMV, o custo por porção e a Curva ABC usam o custo médio de hoje, igual ao Mister', async () => {
    const { t } = await empresa();
    const carne = await item(t, 'Carne', 10);
    const f = await fichas.create(t, {
      nome: 'Burger',
      rendimento: 1,
      precoVenda: 20,
      ingredientes: [{ insumoNome: 'Carne', itemId: carne, quantidade: 0.2, unidade: 'kg', custoUnitario: 10 }],
    });
    expect(f.custoTotal).toBeCloseTo(2, 6);
    const [p] = await q(`insert into produto (tenant_id, nome, preco_venda, ficha_id) values ($1,'Burger',20,$2) returning id`, [t, f.id]);

    await comprar(t, carne, 5, 20); // sem saldo antes: o custo médio passa a ser R$ 20

    const lida = await daLista(t, f.id);
    expect(lida.custoTotal).toBeCloseTo(4, 6);
    expect(lida.custoPorcao).toBeCloseTo(4, 6);
    expect(lida.cmv).toBe(20);
    expect(Number(lida.ingredientes[0].custoUnitario)).toBeCloseTo(20, 6); // a linha mostra o custo com que a ficha foi somada
    expect((await fichas.getOne(t, f.id)).custoTotal).toBeCloseTo(4, 6);
    expect((await fichas.custoPorPorcao(t))[f.id].balcao).toBeCloseTo(4, 6);
    expect((await produtos.custoEfetivoMapa(t))[p.id]).toBeCloseTo(4, 6); // o custo da Curva ABC
    const mister = await noMister(t, f.id);
    expect(mister.completo).toBe(true);
    expect(mister.custo).toBeCloseTo(lida.custoTotal, 6);
    expect(await copiasGravadas(f.id)).toEqual([10]); // ler não grava nada de volta
  });

  it('sem custo médio vale o gravado na linha; linha sem item, o digitado', async () => {
    const { t } = await empresa();
    const semMedio = await item(t, 'Tomate', 0);
    const f = await fichas.create(t, {
      nome: 'Salada',
      rendimento: 1,
      ingredientes: [
        { insumoNome: 'Tomate', itemId: semMedio, quantidade: 2, unidade: 'kg', custoUnitario: 7, ordem: 0 },
        { insumoNome: 'Sal da casa', quantidade: 1, unidade: 'kg', custoUnitario: 3, ordem: 1 },
      ],
    });
    expect((await daLista(t, f.id)).custoTotal).toBeCloseTo(17, 6);
    expect((await noMister(t, f.id)).custo).toBeCloseTo(17, 6);
    // Chegou a primeira compra do item ligado: ele passa ao custo médio; a linha sem item continua no digitado.
    await comprar(t, semMedio, 1, 9);
    expect((await daLista(t, f.id)).custoTotal).toBeCloseTo(2 * 9 + 3, 6);
    expect((await noMister(t, f.id)).custo).toBeCloseTo(2 * 9 + 3, 6);
    expect(await copiasGravadas(f.id)).toEqual([7, 3]);
  });

  it('ficha com um ingrediente sem custo não tem custo conhecido na Curva ABC e na integração: a soma daria margem falsa', async () => {
    const { t } = await empresa();
    const carne = await item(t, 'Carne', 10);
    const tomate = await item(t, 'Tomate', 0);
    const f = await fichas.create(t, {
      nome: 'Burger pela metade',
      rendimento: 1,
      ingredientes: [
        { insumoNome: 'Carne', itemId: carne, quantidade: 0.2, unidade: 'kg', ordem: 0 },
        { insumoNome: 'Tomate', itemId: tomate, quantidade: 0.1, unidade: 'kg', ordem: 1 },
      ],
    });
    const [p] = await q(`insert into produto (tenant_id, nome, preco_venda, ficha_id) values ($1,'Burger',20,$2) returning id`, [t, f.id]);
    expect((await fichas.custoPorPorcao(t))[f.id]).toMatchObject({ balcaoCompleto: false });
    expect((await produtos.custoEfetivoMapa(t))[p.id]).toBeUndefined();
    expect((await noMister(t, f.id)).completo).toBe(false); // a mesma resposta do Mister
    // Com o custo do último ingrediente, a ficha fecha nos dois lugares.
    await comprar(t, tomate, 1, 5);
    expect((await fichas.custoPorPorcao(t))[f.id]).toMatchObject({ balcaoCompleto: true });
    expect((await produtos.custoEfetivoMapa(t))[p.id]).toBeCloseTo(0.2 * 10 + 0.1 * 5, 6);
    expect((await noMister(t, f.id)).completo).toBe(true);
  });

  it('com duas lojas, cada uma vê o custo dela; sem a linha da loja (ou em "todas"), o do cadastro', async () => {
    const { t, lojas } = await empresa(2);
    const [a, b] = lojas;
    const carne = await item(t, 'Carne', 10);
    await custoNaLoja(t, carne, a, 30);
    const f = await fichas.create(t, {
      nome: 'Burger',
      rendimento: 2,
      ingredientes: [{ insumoNome: 'Carne', itemId: carne, quantidade: 1, unidade: 'kg', custoUnitario: 5 }],
    });
    const [p] = await q(`insert into produto (tenant_id, nome, preco_venda, ficha_id) values ($1,'Burger',20,$2) returning id`, [t, f.id]);
    expect((await daLista(t, f.id, a)).custoTotal).toBeCloseTo(30, 6);
    expect((await daLista(t, f.id, b)).custoTotal).toBeCloseTo(10, 6);
    expect((await daLista(t, f.id)).custoTotal).toBeCloseTo(10, 6);
    expect((await fichas.getOne(t, f.id, a)).custoTotal).toBeCloseTo(30, 6);
    expect((await fichas.custoPorPorcao(t, a))[f.id].balcao).toBeCloseTo(15, 6);
    expect((await produtos.custoEfetivoMapa(t, a))[p.id]).toBeCloseTo(15, 6);
    expect((await produtos.custoEfetivoMapa(t, b))[p.id]).toBeCloseTo(5, 6);
    expect((await noMister(t, f.id, a)).custo).toBeCloseTo(30, 6);
    expect((await noMister(t, f.id, b)).custo).toBeCloseTo(10, 6);
  });

  it('linha em unidade convertida: a conta é na unidade do estoque e a tela mostra o custo da unidade escolhida', async () => {
    const { t } = await empresa();
    const bacon = await item(t, 'Bacon', 36);
    await q(`insert into item_conversao (tenant_id, item_id, unidade_de, fator, unidade_para) values ($1,$2,'kg',72,'unidade')`, [t, bacon]);
    const f = await fichas.create(t, {
      nome: 'Com bacon',
      rendimento: 1,
      ingredientes: [{ insumoNome: 'Bacon', itemId: bacon, quantidade: 2, unidade: 'unidade', custoUnitario: 0.5 }],
    });
    expect((await daLista(t, f.id)).custoTotal).toBeCloseTo(1, 6); // 2 fatias a R$ 0,50
    await comprar(t, bacon, 1, 72); // o kg passa a R$ 72: a fatia, a R$ 1
    const lida = await daLista(t, f.id);
    expect(lida.custoTotal).toBeCloseTo(2, 6);
    expect(lida.ingredientes[0].unidade).toBe('unidade');
    expect(Number(lida.ingredientes[0].quantidade)).toBeCloseTo(2, 6);
    expect(Number(lida.ingredientes[0].custoUnitario)).toBeCloseTo(1, 6);
    expect((await noMister(t, f.id)).custo).toBeCloseTo(2, 6);
  });

  it('sub-receita, item feito na loja, embalagem de cada venda e margem de perda seguem a mesma regra', async () => {
    const { t } = await empresa();
    const farinha = await item(t, 'Farinha', 4);
    const caixa = await item(t, 'Caixa', 1, 'unidade');
    const massa = await fichas.create(t, {
      nome: 'Massa',
      rendimento: 2,
      rendimentoUnidade: 'kg',
      ingredientes: [{ insumoNome: 'Farinha', itemId: farinha, quantidade: 2, unidade: 'kg', custoUnitario: 4 }],
    });
    // Produto feito na loja: ele custa o que a ficha dele custa, mesmo com custo médio próprio.
    const molho = await fichas.create(t, {
      nome: 'Molho',
      rendimento: 1,
      rendimentoUnidade: 'kg',
      ingredientes: [{ insumoNome: 'Farinha', itemId: farinha, quantidade: 1, unidade: 'kg', custoUnitario: 4 }],
    });
    const feito = await item(t, 'Molho pronto', 99);
    await q(`update item_estoque set ficha_id = $2 where id = $1`, [feito, molho.id]);
    const f = await fichas.create(t, {
      nome: 'Pizza',
      rendimento: 1,
      margemPerda: 10,
      ingredientes: [
        { insumoNome: 'Massa', subFichaId: massa.id, quantidade: 1, unidade: 'kg', custoUnitario: 0, ordem: 0 },
        { insumoNome: 'Molho pronto', itemId: feito, quantidade: 1, unidade: 'kg', custoUnitario: 0, ordem: 1 },
        { insumoNome: 'Caixa', itemId: caixa, quantidade: 1, unidade: 'unidade', custoUnitario: 1, somenteDelivery: true, ordem: 2 },
      ],
    });
    await comprar(t, farinha, 1, 8); // a farinha dobra
    await comprar(t, caixa, 1, 3); // a caixa do delivery triplica
    const lida = await daLista(t, f.id);
    // Massa: 2 kg × 8 ÷ 2 = 8 o kg · molho pela ficha dele: 8 · com 10% de perda.
    expect(lida.custoTotal).toBeCloseTo((8 + 8) * 1.1, 2);
    expect(lida.custoTotalDelivery).toBeCloseTo((8 + 8 + 3) * 1.1, 2);
    const balcao = await noMister(t, f.id, null, 'balcao');
    const delivery = await noMister(t, f.id, null, 'delivery');
    expect(balcao.custo).toBeCloseTo((8 + 8) * 1.1, 6);
    expect(delivery.custo).toBeCloseTo((8 + 8 + 3) * 1.1, 6);
  });

  it('valor digitado numa linha ligada fica guardado: vale só enquanto o item não tem custo médio', async () => {
    const { t } = await empresa();
    const carne = await item(t, 'Carne', 20);
    const f = await fichas.create(t, {
      nome: 'Burger',
      rendimento: 1,
      ingredientes: [{ insumoNome: 'Carne', itemId: carne, quantidade: 1, unidade: 'kg', custoUnitario: 7 }],
    });
    expect((await daLista(t, f.id)).custoTotal).toBeCloseTo(20, 6);
    expect(await copiasGravadas(f.id)).toEqual([7]);
    await q(`update item_estoque set custo_medio = 0 where id = $1`, [carne]);
    expect((await daLista(t, f.id)).custoTotal).toBeCloseTo(7, 6);
  });
});
