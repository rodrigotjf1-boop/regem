import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CardapioService } from '../cardapio/cardapio.service';
import { ProducaoService } from '../producao/producao.service';
import { VendasService } from '../vendas/vendas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// FICHA EXCLUÍDA NÃO BAIXA ESTOQUE (decisão do dono, 07/10/2026) — contra Postgres
// (TEST_PG_URL). A exclusão só marca `deleted_at` e o produto segue apontando para a ficha;
// três caminhos explodem a ficha e os três têm de concordar: a venda, a produção e o
// "esgotado" do cardápio (que espelha a venda). O ingrediente REMOVIDO de uma ficha viva
// segue a mesma regra nos três.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
jest.setTimeout(60_000);

descrever('ficha excluída e ingrediente removido não baixam estoque (Postgres real)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let db: any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  // Os três métodos são internos: chamados direto no protótipo, com o banco real no lugar da
  // transação. Nenhum deles usa outra dependência do serviço.
  const consumoDaVenda = async (t: string, fichaId: string, delivery = false) => {
    const consumo = new Map<string, number>();
    await (VendasService.prototype as any).acumularFicha.call(VendasService.prototype, db, t, fichaId, 1, consumo, new Set(), delivery);
    return Object.fromEntries(consumo);
  };
  const consumoDaProducao = async (t: string, fichaId: string) => {
    const consumo = new Map<string, number>();
    const custo = await (ProducaoService.prototype as any).explodir.call(ProducaoService.prototype, db, t, fichaId, 1, consumo, new Set(), { unidadeId: null, refId: randomUUID() });
    return { consumo: Object.fromEntries(consumo), custo };
  };
  const esgotados = async (t: string, produtos: any[]) => {
    const u = undefined as any;
    const svc = new CardapioService(db, u, u, u, u, u, u, u);
    return [...(await (svc as any).computeEsgotados(t, produtos))];
  };

  async function empresa() {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `Ficha teste ${id.slice(0, 6)}`]);
    empresas.push(id);
    return id;
  }
  const insumo = async (t: string, nome: string, saldo: number) => {
    const [i] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida, custo_medio) values ($1, $2, 'kg', 10) returning id`, [t, nome]);
    if (saldo) await q(`insert into movimento_estoque (tenant_id, item_id, tipo, quantidade) values ($1, $2, 'entrada', $3)`, [t, i.id, saldo]);
    return i.id as string;
  };
  const ficha = async (t: string, nome: string) =>
    (await q(`insert into ficha_tecnica (tenant_id, nome, rendimento) values ($1, $2, 1) returning id`, [t, nome]))[0].id as string;
  const ingrediente = async (t: string, fichaId: string, alvo: { item?: string; sub?: string }, quantidade: number, removido = false) =>
    q(
      `insert into ficha_ingrediente (tenant_id, ficha_id, item_id, sub_ficha_id, insumo_nome, quantidade, fator_correcao, custo_unitario, deleted_at)
       values ($1, $2, $3, $4, 'de teste', $5, 1, 10, $6)`,
      [t, fichaId, alvo.item ?? null, alvo.sub ?? null, quantidade, removido ? new Date() : null],
    );
  const excluir = (fichaId: string) => q(`update ficha_tecnica set deleted_at = now() where id = $1`, [fichaId]);
  const produto = (fichaId: string) => ({ id: randomUUID(), tipo: 'simples', controlaEstoque: true, permiteNegativo: false, fichaId });

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterAll(async () => {
    for (const id of empresas) {
      for (const tabela of ['ficha_ingrediente', 'ficha_tecnica', 'movimento_estoque', 'item_estoque']) await q(`delete from ${tabela} where tenant_id = $1`, [id]);
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool.end();
  });

  it('venda: a ficha viva baixa os ingredientes; excluída, não baixa nada', async () => {
    const t = await empresa();
    const queijo = await insumo(t, 'Queijo de teste', 5);
    const f = await ficha(t, 'Pizza de teste');
    await ingrediente(t, f, { item: queijo }, 0.2);

    expect(await consumoDaVenda(t, f)).toEqual({ [queijo]: 0.2 });
    await excluir(f);
    expect(await consumoDaVenda(t, f)).toEqual({});
  });

  it('venda: a sub-receita excluída é pulada e o resto da ficha continua baixando', async () => {
    const t = await empresa();
    const queijo = await insumo(t, 'Queijo de teste', 5);
    const tomate = await insumo(t, 'Tomate de teste', 5);
    const molho = await ficha(t, 'Molho de teste');
    await ingrediente(t, molho, { item: tomate }, 0.5);
    const pizza = await ficha(t, 'Pizza de teste');
    await ingrediente(t, pizza, { item: queijo }, 0.2);
    await ingrediente(t, pizza, { sub: molho }, 1);

    expect(await consumoDaVenda(t, pizza)).toEqual({ [queijo]: 0.2, [tomate]: 0.5 });
    await excluir(molho);
    expect(await consumoDaVenda(t, pizza)).toEqual({ [queijo]: 0.2 });
  });

  it('venda: a ficha de outra empresa não é explodida', async () => {
    const t = await empresa();
    const outra = await empresa();
    const queijo = await insumo(outra, 'Queijo de outra empresa', 5);
    const f = await ficha(outra, 'Pizza de outra empresa');
    await ingrediente(outra, f, { item: queijo }, 0.2);

    expect(await consumoDaVenda(t, f)).toEqual({});
    expect(await consumoDaVenda(outra, f)).toEqual({ [queijo]: 0.2 });
  });

  it('produção: a ficha excluída não é produzida; como sub-receita é pulada, sem consumo e sem custo', async () => {
    const t = await empresa();
    const queijo = await insumo(t, 'Queijo de teste', 5);
    const tomate = await insumo(t, 'Tomate de teste', 5);
    const molho = await ficha(t, 'Molho de teste');
    await ingrediente(t, molho, { item: tomate }, 0.5);
    const pizza = await ficha(t, 'Pizza de teste');
    await ingrediente(t, pizza, { item: queijo }, 0.2);
    await ingrediente(t, pizza, { sub: molho }, 1);

    expect(await consumoDaProducao(t, pizza)).toEqual({ consumo: { [queijo]: 0.2, [tomate]: 0.5 }, custo: 7 });
    await excluir(molho);
    expect(await consumoDaProducao(t, pizza)).toEqual({ consumo: { [queijo]: 0.2 }, custo: 2 });
    await expect(consumoDaProducao(t, molho)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('cardápio: insumo zerado esgota o produto; com a ficha excluída, não esgota mais', async () => {
    const t = await empresa();
    const semSaldo = await insumo(t, 'Zerado de teste', 0);
    const f = await ficha(t, 'Prato de teste');
    await ingrediente(t, f, { item: semSaldo }, 1);
    const p = produto(f);

    expect(await esgotados(t, [p])).toEqual([p.id]);
    await excluir(f);
    expect(await esgotados(t, [p])).toEqual([]);
  });

  it('cardápio: o ingrediente REMOVIDO da ficha, mesmo zerado, não esgota o produto', async () => {
    const t = await empresa();
    const semSaldo = await insumo(t, 'Zerado de teste', 0);
    const comSaldo = await insumo(t, 'Com saldo de teste', 5);
    const f = await ficha(t, 'Prato de teste');
    await ingrediente(t, f, { item: semSaldo }, 1, true); // saiu da receita numa edição
    await ingrediente(t, f, { item: comSaldo }, 1);
    const p = produto(f);

    expect(await esgotados(t, [p])).toEqual([]);
    expect(await consumoDaVenda(t, f)).toEqual({ [comSaldo]: 1 }); // a venda já ignorava: os dois concordam
  });

  it('cardápio: a sub-receita excluída não esgota o produto que a usava', async () => {
    const t = await empresa();
    const semSaldo = await insumo(t, 'Zerado de teste', 0);
    const comSaldo = await insumo(t, 'Com saldo de teste', 5);
    const molho = await ficha(t, 'Molho de teste');
    await ingrediente(t, molho, { item: semSaldo }, 1);
    const prato = await ficha(t, 'Prato de teste');
    await ingrediente(t, prato, { item: comSaldo }, 1);
    await ingrediente(t, prato, { sub: molho }, 1);
    const p = produto(prato);

    expect(await esgotados(t, [p])).toEqual([p.id]);
    await excluir(molho);
    expect(await esgotados(t, [p])).toEqual([]);
  });
});
