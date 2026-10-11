import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { custoTotalFicha, type FichaCusto } from '../../common/regras-negocio';
import { dependenciasDasFichas } from '../fichas/fichas-carga';
import { FichasService } from '../fichas/fichas.service';
import { EstoqueService } from './estoque.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PRODUTO DO ESTOQUE FEITO NA LOJA — pedido do dono em 10/10/2026: "ligar um produto ou insumo a uma
// ficha técnica … a cebola crispy é algo produzido na própria loja, tem sua ficha técnica de custo, e
// é um insumo para produzir o sanduíche". Decisão dele: a venda continua baixando o produto pronto
// (como qualquer insumo); a ligação serve ao CUSTO e ao cadastro.

describe('custo da linha que usa um produto feito na loja (regra pura)', () => {
  // Cebola crispy: 2 kg feitos com R$ 30 de ingredientes → R$ 15 o kg. Sanduíche usa 0,02 kg dela.
  const mapa: Record<string, FichaCusto> = {
    crispy: { rendimento: 2, ingredientes: [{ quantidade: 3, fatorCorrecao: 1, custoUnitario: 10 }] },
    sanduiche: { rendimento: 1, ingredientes: [{ quantidade: 0.02, fatorCorrecao: 1, custoUnitario: 0, fichaDoItemId: 'crispy' }, { quantidade: 1, fatorCorrecao: 1, custoUnitario: 2 }] },
    semCusto: { rendimento: 1, ingredientes: [] },
    usaSemCusto: { rendimento: 1, ingredientes: [{ quantidade: 2, fatorCorrecao: 1, custoUnitario: 7, fichaDoItemId: 'semCusto' }] },
  };
  it('o custo vem da ficha que produz o produto (custo total ÷ rendimento), não do que está gravado na linha', () => {
    expect(custoTotalFicha('sanduiche', mapa)).toBeCloseTo(0.02 * 15 + 2, 6);
  });
  it('ficha do produto ainda sem custo: vale o custo gravado na linha', () => {
    expect(custoTotalFicha('usaSemCusto', mapa)).toBe(14);
  });
  it('dependências das fichas: sub-receita e produto feito na loja contam; insumo comum não', () => {
    const ings = [
      { fichaId: 'sanduiche', itemId: 'item-crispy' },
      { fichaId: 'sanduiche', itemId: 'item-pao' },
      { fichaId: 'combo', subFichaId: 'sanduiche' },
    ];
    expect(dependenciasDasFichas(ings, new Map([['item-crispy', 'crispy']]))).toEqual({ sanduiche: ['crispy'], combo: ['sanduiche'] });
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('produto-feito-na-loja.spec: sem TEST_PG_URL — parte com banco PULADA');
jest.setTimeout(120_000);

descrever('produto do estoque feito na loja: ligação com a ficha, custo e ciclo (Postgres real)', () => {
  let pool: Pool;
  let db: any;
  const empresas: string[] = [];
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const estoque = () => new (EstoqueService as any)(db, auditoria) as EstoqueService;
  const fichas = () => new (FichasService as any)(db) as FichasService;
  const ator = { colaboradorId: undefined, categoria: 'gerente' };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['ficha_ingrediente', 'ficha_tecnica', 'movimento_estoque', 'item_conversao', 'item_estoque_unidade', 'item_estoque'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // Cebola (R$ 10/kg, comprada) → ficha "Cebola crispy" (3 kg de cebola rendem 2 kg) → produto
  // "Cebola crispy" (kg, feito na loja) → ficha "Sanduíche" (0,02 kg de cebola crispy + pão).
  async function cenario() {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, 'Empresa de teste')`, [t]);
    empresas.push(t);
    const s = estoque();
    const f = fichas();
    const cebola: any = await s.createItem(t, { nome: 'Cebola de teste', unidadeMedida: 'kg' } as any, null, ator);
    const pao: any = await s.createItem(t, { nome: 'Pão de teste', unidadeMedida: 'unidade' } as any, null, ator);
    const fichaCrispy: any = await f.create(t, {
      nome: 'Cebola crispy de teste', rendimento: 2, rendimentoUnidade: 'kg',
      ingredientes: [{ itemId: cebola.id, insumoNome: 'Cebola de teste', quantidade: 3, unidade: 'kg', custoUnitario: 10 }],
    } as any);
    return { t, s, f, cebola, pao, fichaCrispy };
  }
  const gravado = async (id: string) => (await q(`select ficha_id from item_estoque where id = $1`, [id]))[0].ficha_id as string | null;

  it('cadastro: liga o produto à ficha que o produz; a lista devolve a ficha e o custo por ela', async () => {
    const x = await cenario();
    const crispy: any = await x.s.createItem(x.t, { nome: 'Cebola crispy pronta de teste', unidadeMedida: 'kg', fichaId: x.fichaCrispy.id } as any, null, ator);
    expect(await gravado(crispy.id)).toBe(x.fichaCrispy.id);
    const lista: any[] = await x.s.listItens(x.t, true, null);
    expect(lista.find((i) => i.id === crispy.id)).toMatchObject({ fichaId: x.fichaCrispy.id, fichaNome: 'Cebola crispy de teste', custoFicha: 15 }); // R$ 30 ÷ 2 kg
    expect(lista.find((i) => i.id === x.cebola.id)).toMatchObject({ fichaId: null, fichaNome: null, custoFicha: null }); // produto comprado: como era
    // quem não vê valores em R$ recebe a ligação, não o custo
    expect(((await x.s.listItens(x.t, false, null)) as any[]).find((i) => i.id === crispy.id)).toMatchObject({ fichaNome: 'Cebola crispy de teste', custoFicha: null });
    // a ficha diz o que ela produz
    expect(((await x.f.getOne(x.t, x.fichaCrispy.id)) as any).produtosFeitos).toEqual([{ id: crispy.id, nome: 'Cebola crispy pronta de teste' }]);
    expect((((await x.f.list(x.t)) as any[]).find((f) => f.id === x.fichaCrispy.id)).produtosFeitos).toHaveLength(1);

    // alterar: ausente mantém; null desfaz; ligar de novo
    await x.s.updateItem(x.t, crispy.id, { estoqueMinimo: 1 } as any, null, ator);
    expect(await gravado(crispy.id)).toBe(x.fichaCrispy.id);
    await x.s.updateItem(x.t, crispy.id, { fichaId: null } as any, null, ator);
    expect(await gravado(crispy.id)).toBeNull();
    await x.s.updateItem(x.t, crispy.id, { fichaId: x.fichaCrispy.id } as any, null, ator);
    expect(await gravado(crispy.id)).toBe(x.fichaCrispy.id);
  });

  it('a ficha tem de render na unidade do produto — ao ligar e ao trocar a unidade de quem já está ligado', async () => {
    const x = await cenario();
    await expect(x.s.createItem(x.t, { nome: 'Crispy em unidade de teste', unidadeMedida: 'unidade', fichaId: x.fichaCrispy.id } as any, null, ator))
      .rejects.toThrow(/A ficha "Cebola crispy de teste" rende em "kg" e o produto "Crispy em unidade de teste" é contado em "unidade"/);
    expect(await q(`select 1 from item_estoque where tenant_id = $1 and nome = 'Crispy em unidade de teste'`, [x.t])).toHaveLength(0); // não ficou produto pela metade
    await expect(x.s.createItem(x.t, { nome: 'Outro de teste', unidadeMedida: 'kg', fichaId: randomUUID() } as any, null, ator)).rejects.toThrow(/Ficha técnica não encontrada/);

    const crispy: any = await x.s.createItem(x.t, { nome: 'Cebola crispy pronta de teste', unidadeMedida: 'kg', fichaId: x.fichaCrispy.id } as any, null, ator);
    await expect(x.s.updateItem(x.t, crispy.id, { unidadeMedida: 'pacote' } as any, null, ator)).rejects.toThrow(/tem de render na unidade principal do produto/);
    expect((await q(`select unidade_medida from item_estoque where id = $1`, [crispy.id]))[0].unidade_medida).toBe('kg');
    // ficha escrita com apelido ("Kg") vale: compara pela unidade da lista
    await q(`update ficha_tecnica set rendimento_unidade = 'Kg' where id = $1`, [x.fichaCrispy.id]);
    await expect(x.s.updateItem(x.t, crispy.id, { fichaId: x.fichaCrispy.id } as any, null, ator)).resolves.toBeTruthy();
    // ficha excluída: a ligação deixa de valer nas leituras, e trocar a unidade só desfaz a ligação
    await x.f.remove(x.t, x.fichaCrispy.id);
    expect(((await x.s.listItens(x.t, true, null)) as any[]).find((i) => i.id === crispy.id)).toMatchObject({ fichaId: null, custoFicha: null });
    await x.s.updateItem(x.t, crispy.id, { unidadeMedida: 'pacote' } as any, null, ator);
    expect(await gravado(crispy.id)).toBeNull();
  });

  it('custo: na ficha do sanduíche, a linha da cebola crispy vale o custo da ficha dela, sempre atualizado', async () => {
    const x = await cenario();
    const crispy: any = await x.s.createItem(x.t, { nome: 'Cebola crispy pronta de teste', unidadeMedida: 'kg', fichaId: x.fichaCrispy.id } as any, null, ator);
    // a linha é gravada com custo ZERO (o produto nunca foi comprado): o custo tem de vir da ficha dele
    const sanduiche: any = await x.f.create(x.t, {
      nome: 'Sanduíche de teste', rendimento: 1, rendimentoUnidade: 'porção',
      ingredientes: [
        { itemId: crispy.id, insumoNome: 'Cebola crispy pronta de teste', quantidade: 0.02, unidade: 'kg', custoUnitario: 0 },
        { itemId: x.pao.id, insumoNome: 'Pão de teste', quantidade: 1, unidade: 'unidade', custoUnitario: 2 },
      ],
    } as any);
    expect(Number(sanduiche.custoTotal)).toBeCloseTo(0.02 * 15 + 2, 4); // R$ 2,30
    const linha = sanduiche.ingredientes.find((i: any) => i.itemId === crispy.id);
    expect(linha).toMatchObject({ fichaDoItemId: x.fichaCrispy.id, fichaDoItemNome: 'Cebola crispy de teste' });
    expect(Number(linha.custoUnitario)).toBeCloseTo(15, 4);
    expect(sanduiche.ingredientes.find((i: any) => i.itemId === x.pao.id)).toMatchObject({ fichaDoItemId: null, fichaDoItemNome: null });

    // a cebola encareceu na ficha da crispy → o sanduíche acompanha, sem ninguém regravar a ficha dele
    await x.f.update(x.t, x.fichaCrispy.id, { ingredientes: [{ itemId: x.cebola.id, insumoNome: 'Cebola de teste', quantidade: 3, unidade: 'kg', custoUnitario: 20 }] } as any);
    expect(Number(((await x.f.getOne(x.t, sanduiche.id)) as any).custoTotal)).toBeCloseTo(0.02 * 30 + 2, 4); // R$ 2,60
    expect(((await x.s.listItens(x.t, true, null)) as any[]).find((i) => i.id === crispy.id).custoFicha).toBe(30);
    // desfeita a ligação, a linha volta a valer o que está gravado nela (zero)
    await x.s.updateItem(x.t, crispy.id, { fichaId: null } as any, null, ator);
    expect(Number(((await x.f.getOne(x.t, sanduiche.id)) as any).custoTotal)).toBeCloseTo(2, 4);
  });

  it('ciclo: o produto não pode ser feito por uma ficha que o usa, nem entrar na ficha que o produz', async () => {
    const x = await cenario();
    const crispy: any = await x.s.createItem(x.t, { nome: 'Cebola crispy pronta de teste', unidadeMedida: 'kg', fichaId: x.fichaCrispy.id } as any, null, ator);
    const linhaCrispy = { itemId: crispy.id, insumoNome: 'Cebola crispy pronta de teste', quantidade: 0.1, unidade: 'kg', custoUnitario: 0 };
    const linhaCebola = { itemId: x.cebola.id, insumoNome: 'Cebola de teste', quantidade: 3, unidade: 'kg', custoUnitario: 10 };
    // a ficha que produz a crispy não pode levar a própria crispy
    await expect(x.f.update(x.t, x.fichaCrispy.id, { ingredientes: [linhaCebola, linhaCrispy] } as any)).rejects.toThrow(/é feito por esta ficha: ele não pode ser ingrediente dela mesma/);
    await expect(x.f.update(x.t, x.fichaCrispy.id, { ingredientes: [linhaCebola, linhaCrispy] } as any)).rejects.toThrow(BadRequestException);
    expect(((await x.f.getOne(x.t, x.fichaCrispy.id)) as any).ingredientes).toHaveLength(1); // a recusa não mexeu na ficha

    // cadeia: molho (kg) usa a crispy; a ficha da crispy não pode passar a usar o produto "molho" feito por essa ficha
    const fichaMolho: any = await x.f.create(x.t, { nome: 'Molho de teste', rendimento: 1, rendimentoUnidade: 'kg', ingredientes: [linhaCrispy] } as any);
    const molho: any = await x.s.createItem(x.t, { nome: 'Molho pronto de teste', unidadeMedida: 'kg', fichaId: fichaMolho.id } as any, null, ator);
    await expect(x.f.update(x.t, x.fichaCrispy.id, { ingredientes: [linhaCebola, { itemId: molho.id, insumoNome: 'Molho pronto de teste', quantidade: 0.1, unidade: 'kg', custoUnitario: 0 }] } as any))
      .rejects.toThrow(/"Molho pronto de teste" é feito pela ficha "Molho de teste", que depende desta/);
    // …nem como sub-receita (a dependência pelo produto feito na loja também conta)
    await expect(x.f.update(x.t, x.fichaCrispy.id, { ingredientes: [linhaCebola, { subFichaId: fichaMolho.id, insumoNome: 'Molho de teste', quantidade: 0.1 }] } as any))
      .rejects.toThrow(/ciclo de fichas/);

    // pelo lado do CADASTRO: a cebola (crua) não pode passar a ser "feita" pela ficha do molho, que a usa por dentro
    await expect(x.s.updateItem(x.t, x.cebola.id, { fichaId: fichaMolho.id } as any, null, ator))
      .rejects.toThrow(/A ficha "Molho de teste" usa "Cebola de teste" como ingrediente \(direto ou por outra ficha\)/);
    expect(await gravado(x.cebola.id)).toBeNull();
    // e trocar a ficha de quem já está ligado, para outra que não o usa, continua valendo
    const fichaLivre: any = await x.f.create(x.t, { nome: 'Crispy rápida de teste', rendimento: 1, rendimentoUnidade: 'kg', ingredientes: [linhaCebola] } as any);
    await expect(x.s.updateItem(x.t, crispy.id, { fichaId: fichaLivre.id } as any, null, ator)).resolves.toBeTruthy();
    expect(await gravado(crispy.id)).toBe(fichaLivre.id);
  });
});
