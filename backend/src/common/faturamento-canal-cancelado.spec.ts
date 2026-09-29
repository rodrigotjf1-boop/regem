import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DashboardService } from '../modules/dashboard/dashboard.service';
import { DiretoriaService } from '../modules/diretoria/diretoria.service';
import { RelatoriosService } from '../modules/relatorios/relatorios.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// PEDIDO DE CANAL CANCELADO PELO CANAL NÃO É VENDA DE BALCÃO (A18 da trilha C).
//
// O defeito: o cancelamento que vem do canal (iFood, 99Food, Anota Aí, Cardápio Web — o
// `refletirStatusExterno`) e o do cliente na encomenda (`cancelarSistema`) mudam o pedido
// para `cancelado`, mas a comanda que nasceu dele continua `fechada`. A regra única
// (`comandaEhDeCanal`) só reconhecia a comanda de pedido que VALE como venda — com o pedido
// cancelado, a comanda perdia o vínculo e o Painel, a Visão C&O e o detalhe de balcão a
// contavam como VENDA DE BALCÃO: o pedido que o marketplace cancelou virava faturamento
// presencial.
//
// A regra passou a ser: comanda ligada a QUALQUER pedido externo não é balcão. O estorno de
// caixa/estoque desse caminho (`estornarVendaExterna`) é outra decisão e não mudou aqui.
//
// Contra o Postgres real: o que se prova é a consulta dos serviços de verdade, no mesmo
// banco, com empresas criadas só por esta spec (as outras rodam em paralelo — LIC-084).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('faturamento-canal-cancelado.spec: sem TEST_PG_URL — PULADO');

descrever('comanda de pedido cancelado pelo canal não conta como balcão', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const dashboard = new DashboardService(db);
  const diretoria = new DiretoriaService(db);
  const relatorios = new RelatoriosService(db, {} as any);
  const empresas: string[] = [];

  // Cenário (valores em reais, taxa de serviço zero para a conta ficar à vista):
  //   balcão ......... comanda fechada sem pedido, R$ 40 ............. CONTA como balcão
  //   iFood aceito ... pedido confirmado R$ 30 + a comanda dele ....... CONTA como canal
  //   iFood cancelado  pedido CANCELADO pelo iFood R$ 25 + comanda fechada  NÃO conta em lugar nenhum
  //   encomenda ...... pedido do cardápio cancelado pelo cliente depois de aceito, R$ 12 + comanda fechada  idem
  async function montar(base: string) {
    const e = await pool.query(`insert into empresa (nome) values ('Teste A18') returning id`);
    const tenant = e.rows[0].id as string;
    empresas.push(tenant);
    const u = await pool.query(
      `insert into unidade (tenant_id, nome) values ($1, 'Loja A18') returning id`,
      [tenant],
    );
    const loja = u.rows[0].id as string;
    const comanda = async (minutos: number, total: number, item: string) => {
      const c = await pool.query(
        `insert into comanda (tenant_id, unidade_id, status, total, forma, aberta_em, fechada_em)
         values ($1, $2, 'fechada', $3, 'dinheiro',
                 $4::timestamptz + make_interval(mins => $5),
                 $4::timestamptz + make_interval(mins => $5 + 1))
         returning id`,
        [tenant, loja, total, base, minutos],
      );
      await pool.query(
        `insert into comanda_item (tenant_id, comanda_id, descricao, quantidade, preco_unitario)
         values ($1, $2, $3, 1, $4)`,
        [tenant, c.rows[0].id, item, total],
      );
      return c.rows[0].id as string;
    };
    const pedido = async (
      minutos: number,
      canal: string,
      status: string,
      valor: number,
      comandaId: string,
    ) => {
      await pool.query(
        `insert into pedido_externo (tenant_id, unidade_id, canal, status, total, valor_bruto,
                                     taxa_entrega, taxa_entrega_dono, comanda_id, criado_em,
                                     confirmado_em, cancelado_em)
         values ($1, $2, $3, $4, $5, $5, 6, 'marketplace', $6,
                 $7::timestamptz + make_interval(mins => $8),
                 $7::timestamptz + make_interval(mins => $8),
                 case when $4 = 'cancelado' then $7::timestamptz + make_interval(mins => $8 + 30) end)`,
        [tenant, loja, canal, status, valor, comandaId, base, minutos],
      );
    };

    await comanda(0, 40, 'Prato do balcão');
    await pedido(60, 'ifood', 'confirmado', 30, await comanda(60, 30, 'Burger do iFood'));
    await pedido(120, 'ifood', 'cancelado', 25, await comanda(120, 25, 'Burger cancelado no iFood'));
    await pedido(180, 'cardapio', 'cancelado', 12, await comanda(180, 12, 'Encomenda cancelada'));
    return { tenant, loja };
  }

  afterAll(async () => {
    for (const t of empresas) await pool.query('delete from empresa where id = $1', [t]);
    await pool.end();
  }, 60000);

  // Datas FIXAS (LIC-006): 10/09/2026, 12h de Brasília. O Painel corta o dia no fuso de SP.
  const DIA = '2026-09-10';
  const BASE = '2026-09-10 12:00:00-03';

  it('Painel: o balcão fica só com a venda de balcão; o faturado é balcão + pedidos que valem', async () => {
    const { tenant, loja } = await montar(BASE);
    const r: any = await dashboard.resumo(tenant, DIA, true, loja);
    expect(r.comercial.balcaoFaturado).toBe(40);
    expect(r.comercial.deliveryFaturado).toBe(30);
    expect(r.comercial.faturado).toBe(70);
    // Duas vendas no dia (balcão + iFood aceito) — os cancelados não entram na divisão.
    expect(r.comercial.ticketMedio).toBe(35);
    // Sem a loja (rede toda), o mesmo número.
    const rede: any = await dashboard.resumo(tenant, DIA, true, null);
    expect(rede.comercial.balcaoFaturado).toBe(40);
    expect(rede.comercial.faturado).toBe(70);
  }, 60000);

  it('Relatório de balcão × delivery: o cancelado pelo canal não entra em nenhum dos dois', async () => {
    const { tenant } = await montar(BASE);
    const balcao: any = await relatorios.detalheCanal(tenant, 'balcao', DIA, DIA, true);
    expect(balcao.resumo.vendas).toBe(1);
    expect(balcao.resumo.faturado).toBe(40);
    expect(balcao.maisVendidos.map((m: any) => m.descricao)).toEqual(['Prato do balcão']);
    const delivery: any = await relatorios.detalheCanal(tenant, 'delivery', DIA, DIA, true);
    // O recorte de delivery segue sendo só o pedido que vale (igual a antes).
    expect(delivery.resumo.vendas).toBe(1);
    expect(delivery.resumo.faturado).toBe(30);
    expect(delivery.porPlataforma).toEqual([{ plataforma: 'ifood', qtd: 1, total: 30 }]);
  }, 60000);

  it('Ranking de produtos: item de comanda que veio de pedido nunca cai na coluna de balcão', async () => {
    const { tenant } = await montar(BASE);
    const r: any = await relatorios.rankingProdutos(tenant, DIA, DIA, true);
    const por = (d: string) => r.itens.find((i: any) => i.descricao === d);
    expect(por('Prato do balcão')).toMatchObject({ qtdBalcao: 1, qtdDelivery: 0 });
    expect(por('Burger do iFood')).toMatchObject({ qtdBalcao: 0, qtdDelivery: 1 });
    expect(por('Burger cancelado no iFood')).toMatchObject({ qtdBalcao: 0 });
    expect(por('Encomenda cancelada')).toMatchObject({ qtdBalcao: 0 });
  }, 60000);

  it('Visão C&O: o faturamento do mês da loja não leva o pedido cancelado pelo canal', async () => {
    // A Visão C&O lê o MÊS CORRENTE (current_date): a base é o início do mês + 2 h.
    const inicioMes = await pool.query(
      `select (date_trunc('month', now()) + interval '2 hours')::text as t`,
    );
    const { tenant, loja } = await montar(inicioMes.rows[0].t);
    const r: any = await diretoria.multiunidade(tenant);
    const linha = r.unidades.find((u: any) => u.id === loja);
    expect(linha.faturamento).toBe(70);
    expect(linha.vendas).toBe(2);
    expect(r.rede.faturamento).toBe(70);
  }, 60000);

  it('venda de balcão sozinha continua contando inteira', async () => {
    const e = await pool.query(`insert into empresa (nome) values ('Teste A18 só balcão') returning id`);
    const tenant = e.rows[0].id as string;
    empresas.push(tenant);
    await pool.query(
      `insert into comanda (tenant_id, status, total, taxa_servico_pct, fechada_em)
       values ($1, 'fechada', 55, 10, $2::timestamptz)`,
      [tenant, BASE],
    );
    const r: any = await dashboard.resumo(tenant, DIA, true, null);
    // R$ 55 com 10% de serviço = R$ 50 de faturamento + R$ 5 de gorjeta.
    expect(r.comercial.balcaoFaturado).toBe(50);
    expect(r.comercial.gorjeta).toBe(5);
    expect(r.comercial.faturado).toBe(50);
  }, 60000);
});
