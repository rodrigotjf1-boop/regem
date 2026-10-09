import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ContagemService } from './contagem.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONTAGEM POR MARCA — pedido do dono em 09/10/2026: "ter uma forma na hora de conferência ou
// contagem de estoque e ter o mesmo produto só que de marcas diferentes, ter como registrar na
// contagem". Decisão dele: a contagem pede a quantidade de CADA marca, a soma ajusta o estoque — que
// continua UM só por produto — e o detalhe por marca fica guardado na contagem.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('contagem-por-marca.spec: sem TEST_PG_URL — PULADA');
jest.setTimeout(120_000);

descrever('contagem por marca: a soma é o contado, o estoque é um só (Postgres real)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let db: any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
  const eventos = { emit: jest.fn() };
  const contagem = () => new (ContagemService as any)(db, eventos, auditoria) as ContagemService;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    for (const id of empresas) {
      for (const tabela of ['movimento_estoque', 'contagem_item', 'contagem_execucao', 'contagem_lista_item', 'contagem_lista', 'item_estoque', 'colaborador'])
        await q(`delete from ${tabela} where tenant_id = $1`, [id]).catch(() => {});
      await q(`delete from empresa where id = $1`, [id]).catch(() => {});
    }
    await pool.end();
  });

  // Uma lista de contagem com três produtos: três marcas, uma marca e nenhuma. O queijo tem 10 em estoque.
  async function cenario() {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [t, `Contagem marca teste ${t.slice(0, 6)}`]);
    empresas.push(t);
    const quem = (await q(`insert into colaborador (tenant_id, nome) values ($1, 'Ana de teste') returning id`, [t]))[0].id as string;
    const produto = async (nome: string, marcas: string[]) =>
      (await q(`insert into item_estoque (tenant_id, nome, unidade_medida, marcas) values ($1, $2, 'unidade', $3::jsonb) returning id`, [t, nome, JSON.stringify(marcas)]))[0].id as string;
    const queijo = await produto('Fatia de queijo de teste', ['Marca Alfa', 'Marca Beta', 'Marca Gama']);
    const carne = await produto('Carne de teste', ['Marca Delta']);
    const sal = await produto('Sal de teste', []);
    await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade, motivo) values ($1, $2, 'entrada', 10, 'teste')`, [t, queijo]);
    const s = contagem();
    const lista: any = await s.createLista(t, { nome: 'Geral de teste', recorrencia: 'avulsa', itemIds: [queijo, carne, sal] } as any);
    return { t, quem, queijo, carne, sal, s, listaId: lista.id as string };
  }
  const saldo = async (itemId: string) =>
    Number((await q(`select coalesce(sum(case tipo when 'entrada' then quantidade when 'saida' then -quantidade else quantidade end), 0)::float8 as s from movimento_estoque where item_id = $1`, [itemId]))[0].s);
  const gravado = async (execId: string) =>
    q(`select i.nome, ci.contado::float8 as contado, ci.por_marca as "porMarca" from contagem_item ci join item_estoque i on i.id = ci.item_id where ci.execucao_id = $1 order by i.nome`, [execId]);

  it('abrir a contagem devolve as marcas de cada produto', async () => {
    const x = await cenario();
    const exec: any = await x.s.iniciarExecucao(x.t, x.listaId, x.quem);
    const de = (id: string) => exec.itens.find((i: any) => i.itemId === id);
    expect(de(x.queijo)).toMatchObject({ nome: 'Fatia de queijo de teste', marcas: ['Marca Alfa', 'Marca Beta', 'Marca Gama'], porMarca: null, contado: null });
    expect(de(x.carne)).toMatchObject({ marcas: ['Marca Delta'], porMarca: null });
    expect(de(x.sal)).toMatchObject({ marcas: [], porMarca: null });
  });

  it('salvar por marca: guarda o detalhe (com a grafia do cadastro), a soma é o contado e ajusta UM estoque', async () => {
    const x = await cenario();
    const exec: any = await x.s.iniciarExecucao(x.t, x.listaId, x.quem);
    const r: any = await x.s.salvarContagem(x.t, exec.id, x.quem, {
      aplicarAjuste: true,
      itens: [
        // a mesma marca escrita de dois jeitos soma; a que não foi contada (Gama) fica de fora
        { itemId: x.queijo, contado: 6, porMarca: [{ marca: 'Marca Alfa', quantidade: 3 }, { marca: 'marca beta', quantidade: 2 }, { marca: 'MARCA ALFA', quantidade: 1 }] },
        { itemId: x.carne, contado: 5, porMarca: [{ marca: 'Marca Delta', quantidade: 5 }] }, // uma marca só: não há o que separar
        { itemId: x.sal, contado: 2 },
      ],
    } as any);
    expect(r).toMatchObject({ ok: true, contados: 3 });
    expect(await gravado(exec.id)).toEqual([
      { nome: 'Carne de teste', contado: 5, porMarca: null },
      { nome: 'Fatia de queijo de teste', contado: 6, porMarca: { 'Marca Alfa': 4, 'Marca Beta': 2 } },
      { nome: 'Sal de teste', contado: 2, porMarca: null },
    ]);
    // o estoque do queijo foi de 10 para 6: UM saldo, UM ajuste — as marcas não viram produtos
    expect([await saldo(x.queijo), await saldo(x.carne), await saldo(x.sal)]).toEqual([6, 5, 2]);
    expect(await q(`select tipo, quantidade::float8 as qtd from movimento_estoque where item_id = $1 and motivo = 'contagem'`, [x.queijo])).toEqual([{ tipo: 'ajuste', qtd: -4 }]);
    expect(await q(`select count(*)::int as n from item_estoque where tenant_id = $1`, [x.t])).toEqual([{ n: 3 }]);

    // segunda contagem (fração): 0,1 + 0,2 = 0,3 — a soma em ponto flutuante não derruba a conferência
    const outra: any = await x.s.iniciarExecucao(x.t, x.listaId, x.quem);
    expect(outra.itens.find((i: any) => i.itemId === x.queijo)).toMatchObject({ porMarca: null }); // contagem nova começa em branco
    await x.s.salvarContagem(x.t, outra.id, x.quem, { aplicarAjuste: true, itens: [{ itemId: x.queijo, contado: 0.3, porMarca: [{ marca: 'Marca Alfa', quantidade: 0.1 }, { marca: 'Marca Gama', quantidade: 0.2 }] }] } as any);
    expect(await saldo(x.queijo)).toBeCloseTo(0.3, 6);

    // o histórico traz o detalhe por marca de CADA contagem (a mais nova primeiro)
    const h: any[] = await x.s.historico(x.t, x.listaId);
    expect(h).toHaveLength(2);
    expect(h[0]).toMatchObject({ id: outra.id, contados: 1, porMarca: [{ nome: 'Fatia de queijo de teste', unidadeMedida: 'unidade', contado: 0.3, porMarca: { 'Marca Alfa': 0.1, 'Marca Gama': 0.2 } }] });
    expect(h[1]).toMatchObject({ id: exec.id, contados: 3, porMarca: [{ nome: 'Fatia de queijo de teste', contado: 6, porMarca: { 'Marca Alfa': 4, 'Marca Beta': 2 } }] });
    // quem abre a contagem concluída vê o que foi contado de cada marca
    const aberta: any = await x.s.getExecucao(x.t, exec.id);
    expect(aberta.itens.find((i: any) => i.itemId === x.queijo)).toMatchObject({ porMarca: { 'Marca Alfa': 4, 'Marca Beta': 2 } });
  });

  it('recusa a soma que não bate com o total e a marca que o produto não tem — sem gravar nada', async () => {
    const x = await cenario();
    const exec: any = await x.s.iniciarExecucao(x.t, x.listaId, x.quem);
    const salvar = (porMarca: any[], contado: number) =>
      x.s.salvarContagem(x.t, exec.id, x.quem, { aplicarAjuste: true, itens: [{ itemId: x.sal, contado: 1 }, { itemId: x.queijo, contado, porMarca }] } as any);
    await expect(salvar([{ marca: 'Marca Alfa', quantidade: 3 }, { marca: 'Marca Beta', quantidade: 2 }], 4)).rejects.toThrow(/"Fatia de queijo de teste": a soma das marcas \(5\) não bate com o total contado \(4\)/);
    await expect(salvar([{ marca: 'Marca Delta', quantidade: 5 }], 5)).rejects.toThrow(/"Marca Delta" não é marca cadastrada de "Fatia de queijo de teste"/);
    await expect(salvar([{ marca: 'Marca Delta', quantidade: 5 }], 5)).rejects.toThrow(BadRequestException);
    // nada foi gravado: a contagem segue aberta, sem contado e sem ajuste (nem o do sal, que vinha certo)
    expect((await q(`select status from contagem_execucao where id = $1`, [exec.id]))[0].status).toBe('aberta');
    expect((await gravado(exec.id)).every((l: any) => l.contado === null && l.porMarca === null)).toBe(true);
    expect(await q(`select 1 from movimento_estoque where tenant_id = $1 and motivo = 'contagem'`, [x.t])).toHaveLength(0);
    expect(await saldo(x.queijo)).toBe(10);
  });
});
