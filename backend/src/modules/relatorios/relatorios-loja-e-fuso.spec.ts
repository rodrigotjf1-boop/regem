import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { DeliveryService } from '../delivery/delivery.service';
import { VendasService } from '../vendas/vendas.service';
import { RelatoriosService } from './relatorios.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// RELATÓRIOS: LOJA EM USO, DIA/HORA DA OPERAÇÃO E CLASSE ABC — contra Postgres (TEST_PG_URL).
//
//  · ERR-187: os relatórios somavam a EMPRESA INTEIRA; o gerente da loja A via as vendas da B.
//    Decisão do dono (08/10/2026): cada relatório é da loja em uso; o total só para quem vê a rede.
//  · ERR-120: o dia era cortado no fuso da SESSÃO do banco (UTC na nuvem): a venda das 22h30 caía
//    no dia seguinte e o gráfico por hora saía 3 horas adiantado.
//  · ERR-193: o produto que sozinho passa de 80% do faturamento caía na classe C.
//
// As mesmas contas rodam com a sessão do banco em três fusos — a resposta tem de ser a mesma na
// nuvem (UTC), no servidor da loja (fuso da máquina) e em qualquer outro.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe.each(['UTC', 'America/Sao_Paulo', 'Asia/Tokyo']) : describe.skip.each(['UTC']);
jest.setTimeout(90_000);

// Datas FIXAS: quinta, 10/09/2026, no relógio de Brasília.
const DIA = '2026-09-10';
const INI = `${DIA} 00:00:00`;
const FIM = `${DIA} 23:59:59`;
const br = (relogio: string) => `${relogio}-03`;

descrever('relatórios por loja, no dia e na hora da operação (sessão do banco em %s)', (fusoDaSessao) => {
  const pool = new Pool({ connectionString: URL_PG, options: `-c timezone=${fusoDaSessao}` });
  const db = drizzle(pool) as any;
  const relatorios = new RelatoriosService(db, { custoEfetivoMapa: async () => ({}) } as any);
  const vendas = new (VendasService as any)(db) as VendasService;
  const delivery = new (DeliveryService as any)(db) as DeliveryService;
  const empresas: string[] = [];
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  let t: string, A: string, B: string, sessaoA: string, sessaoB: string;

  async function empresa(nome: string) {
    const [{ id }] = await q(`insert into empresa (nome) values ($1) returning id`, [nome]);
    empresas.push(id);
    return id as string;
  }
  const loja = async (tenant: string, nome: string) => (await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [tenant, nome]))[0].id as string;
  async function venda(tenant: string, unidade: string | null, quando: string, total: number, item: string) {
    const [{ id }] = await q(
      `insert into comanda (tenant_id, unidade_id, status, total, forma, aberta_em, fechada_em)
       values ($1, $2, 'fechada', $3, 'dinheiro', $4::timestamptz - interval '10 minutes', $4::timestamptz) returning id`,
      [tenant, unidade, total, br(quando)],
    );
    await q(`insert into comanda_item (tenant_id, comanda_id, descricao, quantidade, preco_unitario) values ($1, $2, $3, 1, $4)`, [tenant, id, item, total]);
    return id as string;
  }
  const retirada = (tenant: string, comandaId: string, quando: string, descricao: string) =>
    q(
      `insert into audit_log (tenant_id, tipo, acao, entidade_tipo, detalhe, created_at) values ($1, 'venda', 'removeu_item_comanda', 'comanda_item', $2::jsonb, $3::timestamptz)`,
      [tenant, JSON.stringify({ descricao, comandaId, justificativa: 'teste' }), br(quando)],
    );

  beforeAll(async () => {
    t = await empresa('Relatórios por loja — teste');
    A = await loja(t, 'Loja A de teste');
    B = await loja(t, 'Loja B de teste');

    // ── loja A ──
    const a1 = await venda(t, A, `${DIA} 12:00:00`, 40, 'Prato A de teste');
    await venda(t, A, `${DIA} 22:30:00`, 100, 'Campeão de teste'); // em UTC já é dia 11, 01h30
    await q(
      `insert into comanda (tenant_id, unidade_id, status, total, forma, aberta_em, created_at, cancelada_em)
       values ($1, $2, 'cancelada', 15, 'dinheiro', $3::timestamptz, $3::timestamptz, $3::timestamptz + interval '20 minutes')`,
      [t, A, br(`${DIA} 22:50:00`)],
    );
    sessaoA = (await q(`insert into caixa_sessao (tenant_id, unidade_id, status, origem, valor_abertura, aberta_em, fechada_em) values ($1, $2, 'fechada', 'pdv', 0, $3::timestamptz, $3::timestamptz + interval '2 hours') returning id`, [t, A, br(`${DIA} 21:15:00`)]))[0].id;
    await q(`insert into lancamento_caixa (tenant_id, unidade_id, tipo, valor, categoria, forma, data, sessao_id) values ($1, $2, 'saida', 50, 'sangria', 'dinheiro', $3, $4)`, [t, A, DIA, sessaoA]);
    await retirada(t, a1, `${DIA} 22:40:00`, '1× Suco A de teste');

    // ── loja B ──
    const b1 = await venda(t, B, `${DIA} 13:00:00`, 10, 'Prato B de teste');
    const b2 = await venda(t, B, `${DIA} 23:41:00`, 30, 'Burger B de teste');
    await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, status, tipo, total, valor_bruto, taxa_entrega, taxa_entrega_dono, comanda_id, endereco_bairro, criado_em, confirmado_em)
       values ($1, $2, 'ifood', 'confirmado', 'entrega', 30, 30, 6, 'marketplace', $3, 'Bairro de teste', $4::timestamptz, $4::timestamptz)`,
      [t, B, b2, br(`${DIA} 23:40:00`)],
    );
    sessaoB = (await q(`insert into caixa_sessao (tenant_id, unidade_id, status, origem, valor_abertura, aberta_em, fechada_em) values ($1, $2, 'fechada', 'pdv', 0, $3::timestamptz, $3::timestamptz + interval '2 hours') returning id`, [t, B, br(`${DIA} 10:00:00`)]))[0].id;
    await q(`insert into lancamento_caixa (tenant_id, unidade_id, tipo, valor, categoria, forma, data, sessao_id) values ($1, $2, 'saida', 20, 'sangria', 'dinheiro', $3, $4)`, [t, B, DIA, sessaoB]);
    await retirada(t, b1, `${DIA} 13:05:00`, '1× Suco B de teste');

    // ── vizinhos do dia: não são do dia 10 em Brasília (em UTC, o primeiro "seria") ──
    await venda(t, A, '2026-09-09 23:50:00', 5, 'Da véspera de teste');
    await venda(t, A, '2026-09-11 00:20:00', 7, 'Do dia seguinte de teste');
    await venda(t, A, '2026-08-31 22:00:00', 3, 'De agosto de teste'); // em UTC já é setembro

    // ── produção: uma com a loja no registro, uma antiga (sem loja) com a movimentação na B, uma sem nada ──
    const [{ id: ficha }] = await q(`insert into ficha_tecnica (tenant_id, nome) values ($1, 'Molho de teste') returning id`, [t]);
    const [{ id: item }] = await q(`insert into item_estoque (tenant_id, nome, unidade_medida) values ($1, 'Tomate de teste', 'kg') returning id`, [t]);
    const producao = (unidade: string | null, refId: string, qtd: number, quando: string) =>
      q(
        `insert into audit_log (tenant_id, unidade_id, tipo, acao, entidade_tipo, entidade_id, detalhe, created_at)
         values ($1, $2, 'estoque', 'produziu_ficha', 'ficha_tecnica', $3, $4::jsonb, $5::timestamptz)`,
        [t, unidade, ficha, JSON.stringify({ refId, quantidade: qtd, custoTotal: qtd * 2 }), br(quando)],
      );
    await producao(A, randomUUID(), 4, `${DIA} 22:10:00`);
    const refAntiga = randomUUID();
    await producao(null, refAntiga, 6, `${DIA} 09:00:00`);
    await q(`insert into movimento_estoque (tenant_id, unidade_id, item_id, tipo, quantidade, ref_tipo, ref_id, data) values ($1, $2, $3, 'saida', 1, 'producao', $4, $5)`, [t, B, item, refAntiga, DIA]);
    await producao(null, randomUUID(), 9, `${DIA} 09:30:00`);

    // ── mapa de calor: janela móvel ("últimos N dias"), então a entrega é de agora ──
    await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, status, tipo, total, taxa_entrega, endereco_bairro, criado_em)
       values ($1, $2, 'cardapio', 'concluido', 'entrega', 50, 6, 'Bairro do mapa de teste', now() - interval '1 hour')`,
      [t, B],
    );
  });

  afterAll(async () => {
    for (const id of empresas) {
      for (const tabela of ['movimento_estoque', 'lancamento_caixa', 'caixa_sessao', 'pedido_externo', 'comanda_item', 'comanda', 'item_estoque'])
        await q(`delete from ${tabela} where tenant_id = $1`, [id]);
      // A `audit_log` é append-only no banco (mig 023): as linhas de produção e de retirada que
      // este teste precisou gravar ficam, e com elas a empresa de teste que as possui. As
      // empresas sem registro de auditoria saem.
      await q(`delete from ficha_tecnica where tenant_id = $1`, [id]).catch(() => undefined);
      await q(`delete from unidade where tenant_id = $1`, [id]).catch(() => undefined);
      await q(`delete from empresa where id = $1`, [id]).catch(() => undefined);
    }
    await pool.end();
  });

  it('a sessão do banco está no fuso pedido', async () => {
    expect((await q(`show timezone`))[0].TimeZone).toBe(fusoDaSessao);
  });

  it('vendas: o dia 10 de Brasília tem as quatro vendas do dia — a das 22h30 dentro, as vizinhas fora', async () => {
    const r: any = await relatorios.vendas(t, INI, FIM, true, null);
    expect(r.resumo).toMatchObject({ vendas: 4, faturado: 180, canceladas: 1 });
    expect(r.porDia).toEqual([{ dia: DIA, qtd: 4, total: 180 }]);
    expect(r.porHora.map((h: any) => [h.hora, h.qtd])).toEqual([[12, 1], [13, 1], [22, 1], [23, 1]]); // hora de Brasília
  });

  it('vendas: cada loja vê só o que é dela; o total é a soma', async () => {
    const a: any = await relatorios.vendas(t, INI, FIM, true, A);
    const b: any = await relatorios.vendas(t, INI, FIM, true, B);
    expect(a.resumo).toMatchObject({ vendas: 2, faturado: 140, canceladas: 1 });
    expect(b.resumo).toMatchObject({ vendas: 2, faturado: 40, canceladas: 0 });
    const total: any = await relatorios.vendas(t, INI, FIM, true, null);
    expect(total.resumo.faturado).toBe(a.resumo.faturado + b.resumo.faturado);
  });

  it('produtos, atendentes e ranking: só os da loja', async () => {
    const nomes = (r: any) => r.itens.map((p: any) => p.descricao).sort();
    expect(nomes(await relatorios.produtos(t, INI, FIM, true, A))).toEqual(['Campeão de teste', 'Prato A de teste']);
    expect(nomes(await relatorios.produtos(t, INI, FIM, true, B))).toEqual(['Burger B de teste', 'Prato B de teste']);
    expect(nomes(await relatorios.rankingProdutos(t, INI, FIM, true, B))).toEqual(['Burger B de teste', 'Prato B de teste']);
    expect(nomes(await relatorios.rankingProdutos(t, INI, FIM, true, null))).toHaveLength(4);
    const vendasDe = async (u: string | null) => ((await relatorios.atendentes(t, INI, FIM, true, u)) as any).atendentes.reduce((s: number, x: any) => s + x.vendas, 0);
    expect([await vendasDe(A), await vendasDe(B), await vendasDe(null)]).toEqual([2, 2, 4]);
  });

  it('balcão e delivery: o pedido de entrega é da loja B; por dia e por hora no relógio de Brasília', async () => {
    const balcaoA: any = await relatorios.detalheCanal(t, 'balcao', INI, FIM, true, A);
    expect(balcaoA.resumo).toMatchObject({ vendas: 2, faturado: 140 });
    expect(balcaoA.porDia).toEqual([{ dia: DIA, qtd: 2, total: 140 }]);
    expect(balcaoA.porHora.map((h: any) => h.hora)).toEqual([12, 22]);
    const deliveryB: any = await relatorios.detalheCanal(t, 'delivery', INI, FIM, true, B);
    expect(deliveryB.resumo).toMatchObject({ vendas: 1, faturado: 30 });
    expect(deliveryB.porRegiao).toEqual([{ regiao: 'Bairro de teste', qtd: 1, total: 30 }]);
    expect(deliveryB.porPlataforma.map((p: any) => p.plataforma)).toEqual(['ifood']);
    expect(((await relatorios.detalheCanal(t, 'delivery', INI, FIM, true, A)) as any).resumo.vendas).toBe(0);
  });

  it('operações de caixa: cancelamento e sangria da loja', async () => {
    const a: any = await relatorios.operacoesCaixa(t, INI, FIM, true, A);
    const b: any = await relatorios.operacoesCaixa(t, INI, FIM, true, B);
    const total: any = await relatorios.operacoesCaixa(t, INI, FIM, true, null);
    expect([a.cancelamentosTotal.qtd, b.cancelamentosTotal.qtd, total.cancelamentosTotal.qtd]).toEqual([1, 0, 1]);
    expect([a.movimentosTotal.sangrias, b.movimentosTotal.sangrias, total.movimentosTotal.sangrias]).toEqual([50, 20, 70]);
  });

  it('turnos: o da loja; o cupom de turno de OUTRA loja não é entregue', async () => {
    const ids = async (u: string | null) => ((await relatorios.turnos(t, INI, FIM, true, u)) as any).turnos.map((x: any) => x.id).sort();
    expect(await ids(A)).toEqual([sessaoA]); // aberto às 21h15 de Brasília: é do dia 10
    expect(await ids(B)).toEqual([sessaoB]);
    expect(await ids(null)).toEqual([sessaoA, sessaoB].sort());
    expect(await relatorios.turnoDetalhe(t, sessaoB, true, A)).toBeNull();
    expect(((await relatorios.turnoDetalhe(t, sessaoB, true, B)) as any).sessao.id).toBe(sessaoB);
    expect(((await relatorios.turnoDetalhe(t, sessaoB, true, null)) as any).sessao.id).toBe(sessaoB);
  });

  it('conferência de valores e faturamento do delivery: os pedidos da loja, no dia de Brasília', async () => {
    expect(((await relatorios.conferenciaValores(t, INI, FIM, B)) as any).cobertura.pedidos).toBe(1);
    expect(((await relatorios.conferenciaValores(t, INI, FIM, A)) as any).cobertura.pedidos).toBe(0);
    const fd: any = await relatorios.faturamentoDelivery(t, INI, FIM, B);
    expect(fd.pedidos).toBe(1);
    expect(fd.porDia.map((d: any) => d.dia)).toEqual([DIA]); // criado às 23h40 de Brasília: ainda é dia 10
    expect(((await relatorios.faturamentoDelivery(t, INI, FIM, A)) as any).pedidos).toBe(0);
  });

  it('faturamento por mês: a venda das 22h de 31/08 é de AGOSTO', async () => {
    const r: any = await relatorios.faturamentoPeriodo(t, '2026-08-01 00:00:00', '2026-09-30 23:59:59', A);
    expect(r.porMes).toEqual([
      { ym: '2026-08', total: 3, gorjeta: 0, vendas: 1 },
      { ym: '2026-09', total: 152, gorjeta: 0, vendas: 4 }, // 5 + 40 + 100 + 7
    ]);
    expect(((await relatorios.faturamentoPeriodo(t, '2026-08-01 00:00:00', '2026-09-30 23:59:59', B)) as any).total).toBe(40);
  });

  it('produção: a da loja (pelo registro ou, nos antigos, pela movimentação de estoque); sem loja nenhuma, só no total', async () => {
    const qtd = async (u: string | null) => ((await relatorios.producao(t, INI, FIM, 'dia', true, u)) as any).resumo.qtd;
    expect([await qtd(A), await qtd(B), await qtd(null)]).toEqual([4, 6, 19]);
    const r: any = await relatorios.producao(t, INI, FIM, 'dia', true, A);
    expect(r.porPeriodo.map((p: any) => p.periodo)).toEqual([DIA]); // 22h10 de Brasília: dia 10
  });

  it('cancelamentos de itens: a retirada é da loja da comanda; o dia é o de Brasília', async () => {
    const itens = async (u: string | null) => ((await vendas.remocoesItens(t, DIA, DIA, u)) as any[]).map((r) => r.descricao).sort();
    expect(await itens(A)).toEqual(['1× Suco A de teste']); // retirado às 22h40 de Brasília
    expect(await itens(B)).toEqual(['1× Suco B de teste']);
    expect(await itens(null)).toEqual(['1× Suco A de teste', '1× Suco B de teste']);
    expect(await vendas.remocoesItens(t, '2026-09-11', '2026-09-11', null)).toEqual([]);
  });

  it('mapa de calor: as entregas da loja', async () => {
    // Janela de 1 dia: só a entrega de agora entra — a do dia 10/09 (data fixa) fica sempre fora,
    // qualquer que seja o dia em que o teste rode.
    const bairros = async (u: string | null) => ((await delivery.mapaCalorBairros(t, 1, u)) as any).bairros.map((x: any) => x.bairro);
    expect(await bairros(B)).toEqual(['Bairro do mapa de teste']);
    expect(await bairros(A)).toEqual([]);
    expect(await bairros(null)).toEqual(['Bairro do mapa de teste']);
  });

  it('outra empresa não aparece em nenhum recorte', async () => {
    const outra = await empresa('Outra empresa — teste');
    const lojaDela = await loja(outra, 'Loja da outra');
    await venda(outra, lojaDela, `${DIA} 12:00:00`, 999, 'Venda alheia de teste');
    expect(((await relatorios.vendas(t, INI, FIM, true, null)) as any).resumo.faturado).toBe(180);
    expect(((await relatorios.vendas(t, INI, FIM, true, lojaDela)) as any).resumo.vendas).toBe(0); // loja de outra empresa: nada
  });

  // ── curva ABC ──
  it('curva ABC: o campeão que passa de 80% é A; quem cruza o limite fica na classe de cima', async () => {
    const e = await empresa('Curva ABC — teste');
    const u = await loja(e, 'Loja ABC');
    for (const [nome, valor] of [['P1 de teste', 900], ['P2 de teste', 60], ['P3 de teste', 30], ['P4 de teste', 10]] as [string, number][])
      await venda(e, u, `${DIA} 12:00:00`, valor, nome);
    const r: any = await relatorios.produtos(e, INI, FIM, true, null);
    expect(r.itens.map((p: any) => [p.descricao, p.classe, p.pct])).toEqual([
      ['P1 de teste', 'A', 90],
      ['P2 de teste', 'B', 6],
      ['P3 de teste', 'C', 3],
      ['P4 de teste', 'C', 1],
    ]);
  });

  it('curva ABC: um produto só é classe A', async () => {
    const e = await empresa('Curva ABC de um — teste');
    await venda(e, await loja(e, 'Loja única'), `${DIA} 12:00:00`, 50, 'Único de teste');
    const r: any = await relatorios.produtos(e, INI, FIM, true, null);
    expect(r.itens.map((p: any) => p.classe)).toEqual(['A']);
  });
});
