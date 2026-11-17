import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TOTEM EM DINHEIRO (pedido do dono, 16/11/2026): "quando a compra no totem for em dinheiro, o cliente vai ao balcão com a
// via dele, faz o pagamento, o caixa emite uma via com a mesma senha atualizada com a informação de que foi paga no caixa
// [...] a via só sai depois do pagamento no caixa"; "pix e cartão: o pedido já está pago e ele recebe a via dele no totem,
// então não há necessidade de via no caixa, só a da produção"; e o pedido só sai da Retirada quando PAGO.
// No servidor da loja, com os serviços de verdade e os trabalhos de impressão no Postgres:
//  • o aceite do totem NÃO imprime a via do caixa; o "Cobrar e entregar" e o "Receber pagamento" imprimem, com
//    "PAGO NO CAIXA" e a forma cobrada no alto — uma vez só;
//  • o "avançar" não conclui o totem em dinheiro ainda não pago (o pago conclui);
//  • o pedido do totem que chega já aceito da nuvem (o pago no totem) sai só com a produção.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('totem-dinheiro-via-paga.spec: sem TEST_PG_URL — PULADO');

descrever('totem em dinheiro: a via do caixa só depois do pagamento, com "PAGO NO CAIXA" (Postgres real)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const beneficio = new Proxy({}, { get: () => async () => undefined }) as any;
  const delivery = new DeliveryService(db, vendas, producao, beneficio, beneficio, eventos, { flashPedidos: () => undefined } as any);
  const env0 = { EDGE_MODE: process.env.EDGE_MODE, CLOUD_API: process.env.CLOUD_API, SYNC_TOKEN: process.env.SYNC_TOKEN };
  const empresas: string[] = [];
  const pedidos: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(() => {
    process.env.EDGE_MODE = 'true'; // é o servidor da loja que imprime
    delete process.env.CLOUD_API; // o aviso ao canal pede à nuvem: sem ligação, só registra
    delete process.env.SYNC_TOKEN;
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(env0)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (pedidos.length) await pool.query('delete from impressao_edge_feito where comanda_id = any($1::uuid[])', [pedidos]).catch(() => {});
    if (empresas.length) {
      for (const t of ['pedido_envio', 'pedido_notificacao', 'impressao_job', 'producao_pedido', 'pedido_externo_pagamento', 'pedido_externo', 'lancamento_caixa', 'comanda', 'caixa_sessao', 'delivery_config', 'equipamento', 'produto', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste totem via paga') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    await q(`insert into produto (tenant_id, codigo, nome, preco_venda, vai_para_producao) values ($1,'XT1','Lanche de teste','20.00',false)`, [t]);
    await q(
      `insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo, conexao, host, porta, papel, faz_cupom)
       values ($1,$2,'impressora','Caixa',$3,true,'rede','10.0.0.20',9100,'cupom',true)`,
      [t, u, 'tok-' + randomUUID()],
    );
    return { t, u };
  }
  const abrirCaixa = (t: string, u: string) =>
    q(`insert into caixa_sessao (tenant_id, unidade_id, status, origem) values ($1,$2,'aberta','pdv')`, [t, u]);
  async function pedidoDoTotem(t: string, u: string, o: { canal?: string; forma?: string; pago?: boolean } = {}) {
    const [p] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, pago, forma_pagamento, itens, total)
       values ($1,$2,$3,$4,'12','Cliente do totem','retirada','novo',$5,$6,
               '[{"codigo":"XT1","descricao":"Lanche de teste","quantidade":1,"precoUnitario":20}]'::jsonb, 20)
       returning id`,
      [t, u, o.canal ?? 'totem', randomUUID(), o.pago ?? false, o.forma ?? 'dinheiro'],
    );
    pedidos.push(p.id);
    return p.id as string;
  }
  const comandaDe = async (id: string) => (await q('select comanda_id from pedido_externo where id = $1', [id]))[0].comanda_id as string;
  const viasDoCaixa = (comandaId: string) =>
    q(`select conteudo from impressao_job where comanda_id = $1 and via = 'cliente' order by criado_em, id`, [comandaId]);
  // A via sai depois da resposta (sem segurá-la): espera o trabalho aparecer, ou o tempo passar sem nada.
  async function esperarVias(comandaId: string, quantas: number): Promise<any[]> {
    let jobs: any[] = [];
    for (let i = 0; i < 40; i++) {
      jobs = await viasDoCaixa(comandaId);
      if (jobs.length >= quantas) break;
      await espera(100);
    }
    return jobs;
  }

  it('loja que produz antes de cobrar: o aceite NÃO imprime; o "Cobrar e entregar" imprime "PAGO NO CAIXA" com a forma', async () => {
    const { t, u } = await loja();
    const id = await pedidoDoTotem(t, u);
    await delivery.aceitar(t, null, id);
    const comanda = await comandaDe(id);
    await espera(800);
    expect(await viasDoCaixa(comanda)).toEqual([]); // ainda não pago: nada no caixa

    await delivery.avancar(t, id); // a cozinha terminou: confirmado → pronto
    // pronto e NÃO pago: o "avançar" não tira da lista
    await expect(delivery.avancar(t, id)).rejects.toThrow('ainda não foi pago: cobre em PDV · Balcão › Retirada / Encomendas, no "Cobrar e entregar"');
    expect((await q('select status from pedido_externo where id = $1', [id]))[0].status).toBe('pronto');

    await abrirCaixa(t, u);
    await delivery.entregarBalcao(t, null, id, null, { forma: 'credito' });
    const vias = await esperarVias(comanda, 1);
    expect(vias).toHaveLength(1);
    const linhas = String(vias[0].conteudo).split('\n');
    expect(linhas[0]).toBe('@CBD PAGO NO CAIXA'); // no ALTO da via
    expect(linhas[1]).toMatch(/^@CB Crédito - \d\d:\d\d$/);
    expect(vias[0].conteudo).toContain('Pagamento: Crédito'); // a forma cobrada, não a "dinheiro" gravada no aceite
    expect((await q('select status, pago from pedido_externo where id = $1', [id]))[0]).toMatchObject({ status: 'concluido', pago: true });
    await espera(400);
    expect(await viasDoCaixa(comanda)).toHaveLength(1); // uma vez só
  });

  it('loja que produz só depois de pagar: o "Receber pagamento" aceita e a via sai uma vez, com "PAGO NO CAIXA"', async () => {
    const { t, u } = await loja();
    const id = await pedidoDoTotem(t, u);
    await abrirCaixa(t, u);
    await delivery.receberPagamentoTotem(t, null, id, null, 'dinheiro');
    const comanda = await comandaDe(id);
    const vias = await esperarVias(comanda, 1);
    expect(vias).toHaveLength(1);
    expect(String(vias[0].conteudo).split('\n').slice(0, 2)).toEqual(['@CBD PAGO NO CAIXA', expect.stringMatching(/^@CB Dinheiro - \d\d:\d\d$/)]);
    await espera(400);
    expect(await viasDoCaixa(comanda)).toHaveLength(1); // o aceite de dentro do "Receber pagamento" não imprimiu outra
    // já pago: o "Entregar" conclui sem imprimir de novo
    await delivery.avancar(t, id); // → pronto
    await delivery.entregarBalcao(t, null, id, null);
    await espera(400);
    expect(await viasDoCaixa(comanda)).toHaveLength(1);
  });

  it('o totem JÁ PAGO conclui pelo "avançar" (a trava é só do que deve); outro canal segue como sempre', async () => {
    const { t, u } = await loja();
    const pago = await pedidoDoTotem(t, u, { pago: true, forma: 'credito' });
    await delivery.aceitar(t, null, pago);
    await delivery.avancar(t, pago);
    expect((await delivery.avancar(t, pago)).status).toBe('concluido');
    const cardapio = await pedidoDoTotem(t, u, { canal: 'cardapio' }); // retirada a pagar do cardápio: fora da regra do totem
    await delivery.aceitar(t, null, cardapio);
    await delivery.avancar(t, cardapio);
    expect((await delivery.avancar(t, cardapio)).status).toBe('concluido');
  });

  it('chegou já aceito da nuvem: o totem sai só com a produção (sem via do caixa); outro canal recebe a via', async () => {
    const { t, u } = await loja();
    const totem = await pedidoDoTotem(t, u, { pago: true, forma: 'pix' });
    await delivery.aceitar(t, null, totem); // a venda existe (como a que desce da nuvem)
    const cTotem = await comandaDe(totem);
    await q('delete from impressao_edge_feito where comanda_id = $1', [totem]); // como se nunca tivesse passado por aqui
    await delivery.imprimirPedidoAceitoFora(t, { id: totem, comandaId: cTotem, canal: 'totem', tipo: 'retirada', unidadeId: u });
    await espera(400);
    expect(await viasDoCaixa(cTotem)).toEqual([]);
    // marcado: o processador não volta a ele, nem sem papel de produção
    expect((await q('select 1 from impressao_edge_feito where comanda_id = $1', [totem])).length).toBe(1);

    const outro = await pedidoDoTotem(t, u, { canal: 'anotaai', pago: true, forma: 'pix' });
    await delivery.aceitar(t, null, outro);
    const cOutro = await comandaDe(outro);
    await esperarVias(cOutro, 1); // a do aceite
    await delivery.imprimirPedidoAceitoFora(t, { id: outro, comandaId: cOutro, canal: 'anotaai', tipo: 'retirada', unidadeId: u });
    expect(await esperarVias(cOutro, 2)).toHaveLength(2);
  });

  it('na nuvem o pagamento não imprime (a térmica é da loja)', async () => {
    const { t, u } = await loja();
    const id = await pedidoDoTotem(t, u);
    await abrirCaixa(t, u);
    process.env.EDGE_MODE = '';
    try {
      await delivery.receberPagamentoTotem(t, null, id, null, 'dinheiro');
    } finally {
      process.env.EDGE_MODE = 'true';
    }
    await espera(600);
    expect(await viasDoCaixa(await comandaDe(id))).toEqual([]);
  });
});
