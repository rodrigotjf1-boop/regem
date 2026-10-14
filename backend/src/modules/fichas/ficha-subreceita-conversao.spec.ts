import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { VendasService } from '../vendas/vendas.service';
import { FichasService } from './fichas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONVERSÃO NA FICHA TÉCNICA USADA COMO SUB-RECEITA (mig 319) — contra Postgres (TEST_PG_URL).
// Pedido do dono (14/10/2026): "uma ficha técnica que produz 10 sacos ... ao invés de 10 unidades de
// sacos seria 1 de 15 quilos, e não tem conversão na hora de um produto usar só uma porção ou pequena
// parte da ficha". A ficha ganha as conversões do rendimento e a linha da ficha que a usa é GRAVADA na
// unidade em que ela rende — como a linha de produto do estoque. Antes a unidade era só rótulo: "35
// grama" de uma cebola que rende 1 kg contava 35 kg (ERR-229).
// Cada teste olha o que ficou gravado, o que a tela recebe, o custo e o que a VENDA baixa.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('ficha-subreceita-conversao.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('ficha técnica usada como sub-receita, com conversão (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const fichas = new FichasService(db);
  const vendas = new (VendasService as any)(db) as VendasService;
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
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `Sub-receita teste ${id.slice(0, 6)}`]);
    empresas.push(id);
    return id;
  }
  const cebola = async (t: string) =>
    (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1, 'Cebola de teste', 'kg', 10) returning id`, [t]))[0].id as string;
  // A sub-receita: 15 kg de cebola (R$ 10 o kg = R$ 150) que rendem `rendimento` `unidade`.
  async function molho(t: string, item: string, rendimento: number, unidade: string, conversoes: any[] = []) {
    return (await fichas.create(t, {
      nome: 'Cebola ao molho de teste',
      rendimento,
      rendimentoUnidade: unidade,
      conversoes,
      ingredientes: [{ insumoNome: 'Cebola de teste', itemId: item, quantidade: 15, unidade: 'kg', custoUnitario: 10 }],
    } as any)) as any;
  }
  async function lanche(t: string, subId: string, quantidade: number, unidade: string) {
    return (await fichas.create(t, {
      nome: 'Lanche de teste',
      rendimento: 1,
      ingredientes: [{ insumoNome: 'Cebola ao molho de teste', subFichaId: subId, quantidade, unidade }],
    } as any)) as any;
  }
  const linha = async (fichaId: string) =>
    (await q(`select quantidade::float8 as quantidade, unidade from ficha_ingrediente where ficha_id = $1 and deleted_at is null`, [fichaId]))[0];
  // O que a VENDA baixaria ao vender `porcoes` desta ficha (a rotina de verdade, sem mudança).
  async function baixaDaVenda(t: string, fichaId: string, porcoes: number) {
    const consumo = new Map<string, number>();
    await (vendas as any).acumularFicha(db, t, fichaId, porcoes, consumo, new Set());
    return consumo;
  }

  it('35 grama de uma sub-receita que rende em kg: grava 0,035; a tela recebe 35 grama; custo e venda contam 35 g', async () => {
    const t = await empresa();
    const item = await cebola(t);
    const sub = await molho(t, item, 15, 'kg'); // R$ 10 o kg
    const pai = await lanche(t, sub.id, 35, 'grama');
    expect(await linha(pai.id)).toEqual({ quantidade: 0.035, unidade: 'grama' });
    expect(pai.ingredientes[0]).toMatchObject({ quantidade: '35', unidade: 'grama', unidadeEstoque: 'kg', quantidadeEstoque: 0.035, fatorUnidade: 0.001 });
    expect(Number(pai.ingredientes[0].custoUnitario)).toBeCloseTo(0.01, 9); // R$ 0,01 o grama
    expect(pai.custoTotal).toBe(0.35); // antes: 35 kg = R$ 350
    expect((await baixaDaVenda(t, pai.id, 1)).get(item)).toBeCloseTo(0.035, 10);
  });

  it('1 saco = 1,5 kg: 200 grama de uma ficha que rende 10 saco; a lista de unidades vem da ficha', async () => {
    const t = await empresa();
    const item = await cebola(t);
    const sub = await molho(t, item, 10, 'saco', [{ unidadeDe: 'saco', fator: 1.5, unidadePara: 'kg' }]); // R$ 15 o saco
    expect(sub.conversoes).toEqual([{ unidadeDe: 'saco', fator: 1.5, unidadePara: 'kg' }]);
    expect(sub.custoPorcao).toBe(15);
    const pai = await lanche(t, sub.id, 200, 'grama');
    expect((await linha(pai.id)).quantidade).toBeCloseTo(0.2 / 1.5, 12);
    expect(pai.ingredientes[0]).toMatchObject({ quantidade: '200', unidade: 'grama', unidadeEstoque: 'saco' });
    expect(pai.custoTotal).toBe(2); // 200 g a R$ 10 o kg
    expect((await baixaDaVenda(t, pai.id, 1)).get(item)).toBeCloseTo(0.2, 10);
    // E o saco inteiro continua valendo, sem conversão.
    const outro = await lanche(t, sub.id, 1, 'saco');
    expect(outro.custoTotal).toBe(15);
  });

  it('mudar a conversão refaz as linhas que usam a ficha: o que a pessoa informou continua valendo', async () => {
    const t = await empresa();
    const item = await cebola(t);
    const sub = await molho(t, item, 10, 'saco', [{ unidadeDe: 'saco', fator: 1.5, unidadePara: 'kg' }]);
    const pai = await lanche(t, sub.id, 200, 'grama');
    // A receita passa a render 10 sacos de 2 kg (o saco ficou maior): 200 g = 0,1 saco.
    const r: any = await fichas.update(t, sub.id, { rendimento: 10, conversoes: [{ unidadeDe: 'saco', fator: 2, unidadePara: 'kg' }] } as any);
    expect(r.subReceitasAjustadas).toBe(1);
    expect((await linha(pai.id)).quantidade).toBeCloseTo(0.1, 12);
    const depois: any = await fichas.getOne(t, pai.id);
    expect(depois.ingredientes[0]).toMatchObject({ quantidade: '200', unidade: 'grama' });
    // Salvar de novo sem mexer na unidade nem nas conversões não regrava nada.
    const deNovo: any = await fichas.update(t, sub.id, { nome: 'Cebola ao molho renomeada', conversoes: [{ unidadeDe: 'saco', fator: 2, unidadePara: 'kg' }] } as any);
    expect(deNovo.subReceitasAjustadas).toBe(0);
    expect((await linha(pai.id)).quantidade).toBeCloseTo(0.1, 12);
  });

  it('a unidade da linha deixou de ser alcançada: passa a ser a do rendimento, com a mesma parte da receita', async () => {
    const t = await empresa();
    const item = await cebola(t);
    const sub = await molho(t, item, 10, 'saco', [{ unidadeDe: 'saco', fator: 1.5, unidadePara: 'kg' }]);
    const pai = await lanche(t, sub.id, 200, 'grama');
    const custoAntes = pai.custoTotal;
    // Tirou a conversão: grama não chega mais ao saco.
    await fichas.update(t, sub.id, { conversoes: [] } as any);
    expect(await linha(pai.id)).toEqual({ quantidade: expect.closeTo(0.2 / 1.5, 12), unidade: 'saco' });
    expect((await fichas.getOne(t, pai.id)).custoTotal).toBe(custoAntes);
    // Passou a render 20 pote (mesma receita): a linha vira pote, com a mesma parte da receita.
    await fichas.update(t, sub.id, { rendimento: 20, rendimentoUnidade: 'pote', conversoes: [] } as any);
    expect(await linha(pai.id)).toEqual({ quantidade: expect.closeTo((0.2 / 1.5) * 2, 12), unidade: 'pote' });
    expect((await fichas.getOne(t, pai.id)).custoTotal).toBe(custoAntes);
    expect((await baixaDaVenda(t, pai.id, 1)).get(item)).toBeCloseTo(0.2, 10);
  });

  it('linha antiga em unidade que a sub-receita não alcançava: cadastrar a conversão faz valer o que estava escrito', async () => {
    const t = await empresa();
    const item = await cebola(t);
    const sub = await molho(t, item, 20, 'saco'); // sem conversão: "porção" não chega ao saco
    const pai = await lanche(t, sub.id, 1, 'porção');
    expect(await linha(pai.id)).toEqual({ quantidade: 1, unidade: 'porção' }); // contava 1 saco inteiro
    expect(pai.custoTotal).toBe(7.5);
    const r: any = await fichas.update(t, sub.id, { conversoes: [{ unidadeDe: 'saco', fator: 10, unidadePara: 'porção' }] } as any);
    expect(r.subReceitasAjustadas).toBe(1);
    expect(await linha(pai.id)).toEqual({ quantidade: 0.1, unidade: 'porção' });
    const depois: any = await fichas.getOne(t, pai.id);
    expect(depois.ingredientes[0]).toMatchObject({ quantidade: '1', unidade: 'porção' });
    expect(depois.custoTotal).toBe(0.75);
  });

  it('linha de sub-receita sem unidade fica na unidade do rendimento', async () => {
    const t = await empresa();
    const sub = await molho(t, await cebola(t), 15, 'kg');
    const pai = await lanche(t, sub.id, 0.05, '');
    expect(await linha(pai.id)).toEqual({ quantidade: 0.05, unidade: 'kg' });
  });

  it('conversão com unidade fora da lista, repetida ou que contradiz quilo e grama é recusada, sem gravar', async () => {
    const t = await empresa();
    const sub = await molho(t, await cebola(t), 10, 'saco', [{ unidadeDe: 'saco', fator: 1.5, unidadePara: 'kg' }]);
    const conversoes = async () => (await q(`select conversoes from ficha_tecnica where id = $1`, [sub.id]))[0].conversoes;
    for (const ruim of [
      [{ unidadeDe: 'saquinho', fator: 2, unidadePara: 'kg' }],
      [{ unidadeDe: 'saco', fator: 2, unidadePara: 'saco' }],
      [{ unidadeDe: 'kg', fator: 100, unidadePara: 'grama' }],
    ])
      await expect(fichas.update(t, sub.id, { nome: 'Não pode gravar', conversoes: ruim } as any)).rejects.toThrow(BadRequestException);
    expect(await conversoes()).toEqual([{ unidadeDe: 'saco', fator: 1.5, unidadePara: 'kg' }]);
    expect((await q(`select nome from ficha_tecnica where id = $1`, [sub.id]))[0].nome).toBe('Cebola ao molho de teste');
    // A que só repete a medida passa; a linha sem fator é descartada; ausente mantém.
    await fichas.update(t, sub.id, { conversoes: [{ unidadeDe: 'kg', fator: 1000, unidadePara: 'grama' }, { unidadeDe: 'saco', fator: 0, unidadePara: 'pote' }] } as any);
    expect(await conversoes()).toEqual([{ unidadeDe: 'kg', fator: 1000, unidadePara: 'grama' }]);
    await fichas.update(t, sub.id, { nome: 'Cebola ao molho de teste' } as any);
    expect(await conversoes()).toEqual([{ unidadeDe: 'kg', fator: 1000, unidadePara: 'grama' }]);
    // O banco recusa o que não é lista.
    await expect(q(`update ficha_tecnica set conversoes = '{}'::jsonb where id = $1`, [sub.id])).rejects.toMatchObject({ code: '23514' });
  });

  // A migration 320 (só nuvem) corrige as linhas gravadas antes da 319. Roda num esquema à parte, com
  // cópia das duas tabelas, dentro de uma transação desfeita no fim: não toca os dados dos outros testes.
  it('migration 320: grama × kg e ml × litro vão para a unidade do rendimento; o resto fica; rodar de novo não muda nada', async () => {
    const arquivo = readFileSync(join(__dirname, '../../../../database/migrations/320_ficha_subreceita_unidade_corrigida.sql'), 'utf8');
    expect(arquivo).toMatch(/^-- @cloud-only/);
    const esquema = `t320_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`create schema ${esquema}`);
      await c.query(`create table ${esquema}.ficha_tecnica (like public.ficha_tecnica including defaults)`);
      await c.query(`create table ${esquema}.ficha_ingrediente (like public.ficha_ingrediente including defaults)`);
      await c.query(`set local search_path = ${esquema}`);
      const t = randomUUID();
      const sub = async (unidade: string | null) =>
        (await c.query(`insert into ficha_tecnica (tenant_id, nome, rendimento, rendimento_unidade) values ($1, 'Sub', 1, $2) returning id`, [t, unidade])).rows[0].id;
      const ing = async (subId: string, quantidade: number, unidade: string, apagada = false) =>
        (await c.query(
          `insert into ficha_ingrediente (tenant_id, ficha_id, sub_ficha_id, insumo_nome, quantidade, unidade, deleted_at)
           values ($1, gen_random_uuid(), $2, 'Linha', $3, $4, case when $5 then now() end) returning id`,
          [t, subId, quantidade, unidade, apagada],
        )).rows[0].id;
      const subKg = await sub('kg');
      const linhas = {
        gramaEmKg: await ing(subKg, 35, 'grama'),
        pluralEmKg: await ing(await sub('Kg'), 30, 'Gramas'),
        kgEmGrama: await ing(await sub('grama'), 0.5, 'kg'),
        mlEmLitro: await ing(await sub('Litros'), 200, 'ml'),
        porcaoEmSaco: await ing(await sub('saco'), 1, 'porção'),
        kgEmKg: await ing(subKg, 0.2, 'kg'),
        apagada: await ing(subKg, 35, 'grama', true),
      };
      const ler = async () => {
        const r = (await c.query(`select id, quantidade::float8 as quantidade, unidade from ficha_ingrediente`)).rows;
        return Object.fromEntries(Object.entries(linhas).map(([k, id]) => {
          const l = r.find((x: any) => x.id === id);
          return [k, [l.quantidade, l.unidade]];
        }));
      };
      const conferencia = async () => {
        const r: any = await c.query(arquivo);
        return (Array.isArray(r) ? r[r.length - 1] : r).rows[0];
      };
      expect(await conferencia()).toEqual({ objeto: 'linhas de sub-receita em grama × kg ou ml × litro', ok: true });
      const esperado = {
        gramaEmKg: [0.035, 'kg'],
        pluralEmKg: [0.03, 'Kg'],
        kgEmGrama: [500, 'grama'],
        mlEmLitro: [0.2, 'Litros'],
        porcaoEmSaco: [1, 'porção'],
        kgEmKg: [0.2, 'kg'],
        apagada: [35, 'grama'],
      };
      expect(await ler()).toEqual(esperado);
      expect(await conferencia()).toMatchObject({ ok: true });
      expect(await ler()).toEqual(esperado);
    } finally {
      await c.query('rollback').catch(() => {});
      c.release();
    }
  });
});
