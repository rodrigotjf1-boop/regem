import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { RelatoriosService } from './relatorios.service';
import { DiretoriaService } from '../diretoria/diretoria.service';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { TaxasService } from '../conferencia/taxas.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { hojeISO } from '../../common/data';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS NÚMEROS OFICIAIS BATEM ENTRE AS TELAS — contra Postgres (TEST_PG_URL). Achados da revisão do PDV de 24/11/2026 (lote 2):
// a venda do último segundo do dia ficava fora do relatório (G-02); a venda dividida caía inteira em "Múltiplo" (G-05); a
// série por mês somava outra base que o total oficial (G-01); a DRE contava sangria e suprimento como despesa e receita, e a
// gorjeta como receita (F-02); a comanda vazia da mesa virava uma venda de R$ 0 (B-04); e a Visão C&O deixava de fora a
// venda sem loja (G-04). Segunda volta (25/11/2026): o relatório de produtos juntava produtos de mesmo nome histórico com
// o custo de um só (PDV-G-02); as formas de uma venda dividida somavam um centavo a mais (PDV-G-01); o acerto baixado com
// R$ 0 deixava a receita da DRE negativa (PDV-F-02); e a calculadora de taxas perdia o último segundo do dia (G-02).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('relatorios-revisao-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('os números oficiais batem entre as telas (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const relatorios = new RelatoriosService(db, { custoEfetivoMapa: async () => ({}) } as any);
  const diretoria = new DiretoriaService(db);
  const empresas: string[] = [];
  const novaEmpresa = async () => {
    const t = randomUUID();
    empresas.push(t);
    await q(`insert into empresa (id, nome) values ($1, 'teste numeros oficiais')`, [t]);
    const [{ id: loja }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja') returning id`, [t]);
    return { t, loja: loja as string };
  };
  /** Uma venda fechada, com o instante dado no relógio de São Paulo. */
  const venda = async (t: string, loja: string | null, total: number, quando: string, forma = 'dinheiro') =>
    (
      await q(
        `insert into comanda (tenant_id, unidade_id, status, total, forma, fechada_em) values ($1, $2, 'fechada', $3, $4, ($5::timestamp at time zone 'America/Sao_Paulo')) returning id`,
        [t, loja, total, forma, quando],
      )
    )[0].id as string;

  afterAll(async () => {
    for (const t of empresas) {
      for (const tab of ['comanda_pagamento', 'pedido_externo', 'comanda', 'unidade']) await q(`delete from ${tab} where tenant_id = $1`, [t]).catch(() => undefined);
      await q(`delete from empresa where id = $1`, [t]).catch(() => undefined);
    }
    await pool.end();
  });

  it('G-02: a venda das 23:59:59,5 entra no relatório do próprio dia', async () => {
    const { t, loja } = await novaEmpresa();
    await venda(t, loja, 30, '2026-10-31 23:59:59.5');
    await venda(t, loja, 20, '2026-11-01 00:00:00');
    const r: any = await relatorios.vendas(t, '2026-10-31', '2026-10-31', true, null);
    expect(r.resumo.vendas).toBe(1);
    expect(r.resumo.faturado).toBe(30);
  });

  it('G-05: a venda dividida aparece em cada forma, com o valor de cada parte; a de forma única segue na dela', async () => {
    const { t, loja } = await novaEmpresa();
    const dividida = await venda(t, loja, 100, '2026-10-10 12:00:00', 'multiplo');
    await q(`insert into comanda_pagamento (tenant_id, comanda_id, forma, valor) values ($1, $2, 'dinheiro', 40), ($1, $2, 'pix', 60)`, [t, dividida]);
    await venda(t, loja, 25, '2026-10-10 13:00:00', 'pix');
    const r: any = await relatorios.vendas(t, '2026-10-10', '2026-10-10', true, null);
    const porForma = Object.fromEntries(r.porForma.map((f: any) => [String(f.forma).toLowerCase(), Number(f.total)]));
    expect(porForma).toEqual({ dinheiro: 40, pix: 85 });
    expect(r.porForma.some((f: any) => /m[úu]ltipl/i.test(String(f.forma)))).toBe(false);
    expect(r.resumo.vendas).toBe(2);
  });

  it('G-01: a série por mês soma o mesmo que o total oficial do período (com o pedido do canal)', async () => {
    const { t, loja } = await novaEmpresa();
    await venda(t, loja, 50, '2026-09-15 12:00:00');
    await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, tipo, status, total, criado_em) values ($1, $2, 'cardapio', 'entrega', 'concluido', 70, ('2026-09-20 20:00:00'::timestamp at time zone 'America/Sao_Paulo'))`,
      [t, loja],
    );
    const oficial: any = await relatorios.vendasOficiais(t, '2026-09-01', '2026-09-30', true, null);
    const serie: any = await relatorios.faturamentoPeriodo(t, '2026-09-01', '2026-09-30', null);
    expect(serie.total).toBe(Number(oficial.resumo.faturado));
    expect(serie.porMes).toEqual([expect.objectContaining({ ym: '2026-09', vendas: 2 })]);
  });

  it('F-02: a DRE não conta sangria e suprimento, e a gorjeta da venda sai das receitas', async () => {
    const { t, loja } = await novaEmpresa();
    const dia = '2026-10-05';
    const c = (
      await q(
        `insert into comanda (tenant_id, unidade_id, status, total, taxa_servico_pct, forma, fechada_em) values ($1, $2, 'fechada', 110, 10, 'dinheiro', now()) returning id`,
        [t, loja],
      )
    )[0].id;
    await q(
      `insert into lancamento_caixa (tenant_id, unidade_id, comanda_id, tipo, valor, data, categoria, forma) values
         ($1, $2, $3, 'entrada', 110, $4, 'venda', 'dinheiro'),
         ($1, $2, null, 'entrada', 100, $4, 'suprimento', 'dinheiro'),
         ($1, $2, null, 'saida', 60, $4, 'sangria', 'dinheiro'),
         ($1, $2, null, 'saida', 30, $4, 'fornecedor', 'pix')`,
      [t, loja, c, dia],
    );
    const financeiro = new FinanceiroService(db, { registrar: async () => undefined } as any, {} as any);
    const dre: any = await financeiro.dreCaixa(t, dia, dia, null);
    expect(dre.receitas).toBe(100);
    expect(dre.gorjeta).toBe(10);
    expect(dre.despesas).toEqual([{ categoria: 'fornecedor', valor: 30 }]);
    expect(dre.resultado).toBe(70);
    await q(`delete from lancamento_caixa where tenant_id = $1`, [t]);
  });

  it('B-04: fechar a mesa com uma comanda vazia não cria uma venda de R$ 0', async () => {
    const { t, loja } = await novaEmpresa();
    const [{ id: m }] = await q(`insert into mesa (tenant_id, unidade_id, numero, status) values ($1, $2, '7', 'aberta') returning id`, [t, loja]);
    const [{ id: vazia }] = await q(`insert into comanda (tenant_id, unidade_id, mesa_id, status) values ($1, $2, $3, 'aberta') returning id`, [t, loja, m]);
    const eventos = new EventEmitter2();
    const aud = { registrar: async () => undefined } as any;
    const vendas = new VendasService(db, aud, eventos, new ProducaoPedidoService(db, aud, eventos), new FiscalService(db, aud), {} as any);
    await vendas.fecharMesa(t, randomUUID(), 'presidente', m, { forma: 'dinheiro' }, null);
    expect(await q(`select status from comanda where id = $1`, [vazia])).toEqual([]);
    expect((await q(`select status from mesa where id = $1`, [m]))[0].status).toBe('fechada');
    const r: any = await relatorios.vendas(t, hojeISO(), hojeISO(), true, null);
    expect(r.resumo.vendas).toBe(0);
    await q(`delete from mesa where tenant_id = $1`, [t]);
  });

  it('G-04: a Visão C&O soma no total da rede a venda sem loja e a mostra à parte', async () => {
    const { t, loja } = await novaEmpresa();
    const agora = `${hojeISO()} 12:00:00`;
    await venda(t, loja, 100, agora);
    await venda(t, null, 40, agora);
    const r: any = await diretoria.multiunidade(t);
    expect(r.rede.faturamento).toBe(140);
    expect(r.rede.semLoja).toEqual(expect.objectContaining({ faturamento: 40, vendas: 1 }));
  });

  // ── Revisão de 25/11/2026 (segunda volta) ─────────────────────────────────────────────────────────────────────────────

  it('PDV-G-02: dois produtos com a mesma descrição histórica ficam em linhas próprias, cada um com o seu custo', async () => {
    const { t, loja } = await novaEmpresa();
    const [{ id: pa }] = await q(`insert into produto (tenant_id, nome) values ($1, 'Combo') returning id::text as id`, [t]);
    const [{ id: pb }] = await q(`insert into produto (tenant_id, nome) values ($1, 'Combo família') returning id::text as id`, [t]);
    const item = (comanda: string, produto: string | null, descricao: string, preco: number) =>
      q(`insert into comanda_item (tenant_id, comanda_id, produto_id, descricao, quantidade, preco_unitario) values ($1, $2, $3, $4, 1, $5)`, [t, comanda, produto, descricao, preco]);
    const c1 = await venda(t, loja, 30, '2026-10-12 12:00:00');
    await item(c1, pa, 'Combo', 30);
    const c2 = await venda(t, loja, 40, '2026-10-12 13:00:00');
    await item(c2, pb, 'Combo', 40); // o "Combo família" vendido quando ainda se chamava "Combo"
    const c3 = await venda(t, loja, 30, '2026-10-12 14:00:00');
    await item(c3, pa, 'Combo da casa', 30); // o mesmo produto A, já com o nome novo: continua uma linha só
    const comCusto = new RelatoriosService(db, { custoEfetivoMapa: async () => ({ [pa]: 5, [pb]: 20 }) } as any);
    const r: any = await comCusto.produtos(t, '2026-10-12', '2026-10-12', true, null);
    const linhas = r.itens.map((i: any) => ({ qtd: i.qtd, faturamento: Number(i.faturamento), custo: Number(i.custo) }));
    expect(linhas).toEqual(
      expect.arrayContaining([
        { qtd: 2, faturamento: 60, custo: 10 },
        { qtd: 1, faturamento: 40, custo: 20 },
      ]),
    );
    expect(linhas).toHaveLength(2);
    await q(`delete from comanda_item where tenant_id = $1`, [t]);
    await q(`delete from produto where tenant_id = $1`, [t]);
  });

  it('PDV-G-01: as formas de uma venda dividida somam exatamente o faturamento, sem o centavo do arredondamento', async () => {
    const { t, loja } = await novaEmpresa();
    // R$ 11,00 com 10% de serviço = R$ 10,00 de faturamento, pagos em três partes: 3,67 + 3,67 + 3,66.
    const [{ id: c }] = await q(
      `insert into comanda (tenant_id, unidade_id, status, total, taxa_servico_pct, forma, fechada_em) values ($1, $2, 'fechada', 11, 10, 'multiplo', ('2026-10-14 12:00:00'::timestamp at time zone 'America/Sao_Paulo')) returning id`,
      [t, loja],
    );
    await q(`insert into comanda_pagamento (tenant_id, comanda_id, forma, valor) values ($1, $2, 'dinheiro', 3.67), ($1, $2, 'pix', 3.67), ($1, $2, 'credito', 3.66)`, [t, c]);
    const r: any = await relatorios.vendas(t, '2026-10-14', '2026-10-14', true, null);
    const centavos = (v: any) => Math.round(Number(v) * 100);
    expect(centavos(r.resumo.faturado)).toBe(1000);
    expect(r.porForma.reduce((s: number, f: any) => s + centavos(f.total), 0)).toBe(1000);
  });

  it('PDV-F-02: o acerto baixado com R$ 0 não tira a gorjeta das receitas; o recebido pela metade tira metade', async () => {
    const { t, loja } = await novaEmpresa();
    const dia = '2026-10-06';
    const comanda = async () =>
      (await q(`insert into comanda (tenant_id, unidade_id, status, total, taxa_servico_pct, forma, fechada_em) values ($1, $2, 'fechada', 110, 10, 'dinheiro', now()) returning id`, [t, loja]))[0]
        .id as string;
    const semNada = await comanda();
    const metade = await comanda();
    await q(
      `insert into lancamento_caixa (tenant_id, unidade_id, comanda_id, tipo, valor, data, categoria, forma) values
         ($1, $2, $3, 'entrada', 0, $5, 'venda', 'dinheiro'),
         ($1, $2, $4, 'entrada', 55, $5, 'venda', 'dinheiro')`,
      [t, loja, semNada, metade, dia],
    );
    const financeiro = new FinanceiroService(db, { registrar: async () => undefined } as any, {} as any);
    const dre: any = await financeiro.dreCaixa(t, dia, dia, null);
    expect(dre.gorjeta).toBe(5);
    expect(dre.receitas).toBe(50);
    expect(dre.receitas).toBeGreaterThanOrEqual(0);
    await q(`delete from lancamento_caixa where tenant_id = $1`, [t]);
  });

  it('G-02 (2ª volta): a calculadora de taxas conta a venda das 23:59:59,5 de hoje no faturamento de 12 meses', async () => {
    const { t, loja } = await novaEmpresa();
    await venda(t, loja, 30, `${hojeISO()} 23:59:59.5`);
    await venda(t, loja, 20, `${hojeISO()} 10:00:00`);
    const taxas: any = new TaxasService(db, { registrar: async () => undefined } as any);
    const v = await taxas.vendas(t, loja, true);
    expect(v.rbt12).toBe(50);
  });
});
