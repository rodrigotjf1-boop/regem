import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ProducaoService } from '../producao/producao.service';
import { VendasService } from '../vendas/vendas.service';
import { FichasService } from './fichas.service';
import { carregarFichas, custoPorUnidadeDaFicha } from './fichas-carga';
import { fichaSemCusto } from './ficha-sem-custo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// MARGEM DE PERDA NA FICHA TÉCNICA (mig 318) — contra Postgres (TEST_PG_URL).
// Pedido do dono (14/10/2026): "uma margem %, que seria uma margem de perda, que seria somada essa % no
// valor de custo; uma variável opcional". Sobre a base: "levar em consideração a ficha completa" — o custo
// inteiro (ingredientes, sub-receitas e a embalagem de cada venda), no balcão e no delivery.
// Cada teste confere o CUSTO que a ficha mostra — e que a BAIXA de estoque e o custo da produção NÃO mudam.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('margem-perda.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('margem de perda na ficha técnica (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const fichas = new FichasService(db, { registrar: async () => undefined } as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  afterAll(async () => {
    for (const id of empresas) {
      for (const t of ['ficha_ingrediente', 'ficha_tecnica', 'item_estoque']) await q(`delete from ${t} where tenant_id = $1`, [id]).catch(() => {});
      await q(`delete from empresa where id = $1`, [id]).catch(() => {});
    }
    await pool.end();
  });

  async function empresa() {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `Margem teste ${id.slice(0, 6)}`]);
    empresas.push(id);
    return id;
  }
  const item = async (t: string, nome: string, custo: number) =>
    (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1,$2,'unidade',$3) returning id`, [t, nome, custo]))[0].id as string;

  // Lanche (rende 1): 1 pão a R$ 8,00 + papel do balcão a R$ 0,50 + caixa do delivery a R$ 1,50.
  async function lanche(margemPerda?: number | null) {
    const t = await empresa();
    const pao = await item(t, 'Pão de teste', 8);
    const papel = await item(t, 'Papel de teste', 0.5);
    const caixa = await item(t, 'Caixa de teste', 1.5);
    const f: any = await fichas.create(t, {
      nome: 'Lanche de teste',
      rendimento: 1,
      precoVenda: 20,
      ...(margemPerda === undefined ? {} : { margemPerda }),
      ingredientes: [
        { insumoNome: 'Pão de teste', itemId: pao, quantidade: 1, unidade: 'unidade', custoUnitario: 8 },
        { insumoNome: 'Papel de teste', itemId: papel, quantidade: 1, unidade: 'unidade', custoUnitario: 0.5, somenteBalcao: true },
        { insumoNome: 'Caixa de teste', itemId: caixa, quantidade: 1, unidade: 'unidade', custoUnitario: 1.5, somenteDelivery: true },
      ],
    } as any);
    return { t, f, pao, papel, caixa };
  }

  it('sem margem, a conta de sempre; com 10%, o custo inteiro da ficha sobe 10% no balcão e no delivery', async () => {
    const sem = await lanche();
    expect(sem.f).toMatchObject({ custoTotal: 8.5, custoTotalDelivery: 9.5, margemPerda: null });
    const com = await lanche(10);
    expect(com.f.custoTotal).toBeCloseTo(9.35, 10); // (8 + 0,50) × 1,10
    expect(com.f.custoTotalDelivery).toBeCloseTo(10.45, 10); // (8 + 1,50) × 1,10
    expect(com.f.cmv).toBe(46.8); // 9,35 ÷ 20
    expect(Number(com.f.margemPerda)).toBe(10);
    expect(((await fichas.list(com.t)) as any[])[0]).toMatchObject({ custoTotal: com.f.custoTotal, custoTotalDelivery: com.f.custoTotalDelivery });
    const porPorcao = (await fichas.custoPorPorcao(com.t))[com.f.id];
    expect(porPorcao.balcao).toBeCloseTo(9.35, 10);
    expect(porPorcao.delivery).toBeCloseTo(10.45, 10);
  });

  it('salvar sem falar da margem a mantém; vazio ou 0 tiram; fora de 0 a 100 é recusado sem gravar', async () => {
    const { t, f } = await lanche(10);
    const margem = async () => (await q(`select margem_perda::float8 as m from ficha_tecnica where id = $1`, [f.id]))[0].m;
    await fichas.update(t, f.id, { nome: 'Lanche renomeado de teste' } as any);
    expect(await margem()).toBe(10);
    await fichas.update(t, f.id, { margemPerda: 2.5 } as any);
    expect(await margem()).toBe(2.5);
    await fichas.update(t, f.id, { margemPerda: 0 } as any);
    expect(await margem()).toBeNull();
    await fichas.update(t, f.id, { margemPerda: 7 } as any);
    await fichas.update(t, f.id, { margemPerda: null } as any);
    expect(await margem()).toBeNull();
    for (const ruim of [150, -1, Number.NaN]) {
      await expect(fichas.update(t, f.id, { margemPerda: ruim } as any)).rejects.toThrow(BadRequestException);
      await expect(fichas.update(t, f.id, { margemPerda: ruim } as any)).rejects.toThrow('Margem de perda: informe de 0 a 100%.');
    }
    expect(await margem()).toBeNull();
    // o banco também recusa (guarda dos outros caminhos)
    await expect(q(`update ficha_tecnica set margem_perda = 101 where id = $1`, [f.id])).rejects.toMatchObject({ code: '23514' });
  });

  it('a sub-receita entra com a margem DELA, e a margem da ficha que a usa vale sobre o total', async () => {
    const t = await empresa();
    const creme = await item(t, 'Creme de teste', 4);
    const molho: any = await fichas.create(t, {
      nome: 'Molho de teste', rendimento: 2, margemPerda: 25,
      ingredientes: [{ insumoNome: 'Creme de teste', itemId: creme, quantidade: 1, unidade: 'unidade', custoUnitario: 4 }],
    } as any);
    expect(molho.custoTotal).toBe(5); // 4 × 1,25
    const prato: any = await fichas.create(t, {
      nome: 'Prato de teste', rendimento: 1, margemPerda: 10,
      ingredientes: [{ insumoNome: 'Molho de teste', subFichaId: molho.id, quantidade: 1, unidade: 'porção' }],
    } as any);
    expect(prato.custoTotal).toBeCloseTo(2.75, 10); // 1 porção do molho = 5 ÷ 2 = 2,50; × 1,10
  });

  it('o produto feito na loja custa o da ficha dele, com a margem', async () => {
    const t = await empresa();
    const cebola = await item(t, 'Cebola de teste', 10);
    const crispy: any = await fichas.create(t, {
      nome: 'Cebola crispy de teste', rendimento: 2, rendimentoUnidade: 'kg', margemPerda: 20,
      ingredientes: [{ insumoNome: 'Cebola de teste', itemId: cebola, quantidade: 3, unidade: 'unidade', custoUnitario: 10 }],
    } as any);
    const { mapa } = await carregarFichas(db, t);
    expect(custoPorUnidadeDaFicha(crispy.id, mapa)).toBeCloseTo(18, 10); // 3 × 10 = 30 × 1,20 = 36 ÷ 2 kg
  });

  it('quem não vê custo não recebe a margem', async () => {
    const { f } = await lanche(10);
    const cortada: any = fichaSemCusto(f);
    expect(cortada.margemPerda).toBeNull(); // o corte zera os campos de custo (como o custoTotal)
    expect(cortada.custoTotal).toBeNull();
    expect(cortada.custoOculto).toBe(true);
  });

  it('a margem NÃO muda a baixa de estoque da venda nem o custo da produção', async () => {
    const consumo = async (t: string, fichaId: string) => {
      const c = new Map<string, number>();
      await (VendasService.prototype as any).acumularFicha.call(VendasService.prototype, db, t, fichaId, 1, c, new Set());
      return Object.fromEntries(c);
    };
    const producao = async (t: string, fichaId: string) => {
      const c = new Map<string, number>();
      const custo = await (ProducaoService.prototype as any).explodir.call(ProducaoService.prototype, db, t, fichaId, 1, c, new Set(), { unidadeId: null, refId: randomUUID() });
      return { consumo: Object.fromEntries(c), custo };
    };
    const sem = await lanche();
    const com = await lanche(30);
    expect(await consumo(com.t, com.f.id)).toEqual({ [com.pao]: 1 });
    expect(await consumo(sem.t, sem.f.id)).toEqual({ [sem.pao]: 1 });
    const p = await producao(com.t, com.f.id);
    expect(p.consumo).toEqual({ [com.pao]: 1 });
    expect(p.custo).toBeCloseTo(8, 9); // o custo do que foi produzido é o de verdade, sem margem
  });
});
