import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// VIA DA RETIRADA À PARTE (pedido do dono, 20/10/2026): "serviços para retirada feitos no delivery,
// que é considerado pedido externo e que vão para o PDV para a retirada — direcionar a impressão desse
// à parte e não tratar somente como delivery". No servidor da loja, com os serviços de verdade:
//  • retirada com regra própria → a via sai na impressora escolhida (ex.: a do caixa);
//  • retirada sem regra própria → nas mesmas do delivery (nada muda até a loja escolher);
//  • o pedido de ENTREGA segue na regra do delivery.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('via-da-retirada.spec: sem TEST_PG_URL — PULADO');

descrever('via da retirada à parte (Postgres real)', () => {
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
    process.env.EDGE_MODE = 'true'; // é o servidor da loja que imprime a via no aceite
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
      for (const t of ['pedido_envio', 'pedido_notificacao', 'impressao_job', 'producao_pedido', 'pedido_externo', 'lancamento_caixa', 'comanda', 'delivery_config', 'equipamento', 'produto', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  async function loja(regras: any) {
    const t = (await q(`insert into empresa (nome) values ('teste via da retirada') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    await q(`insert into produto (tenant_id, codigo, nome, preco_venda, vai_para_producao) values ($1,'XT1','Lanche de teste','20.00',false)`, [t]);
    const impressora = async (nome: string, host: string) =>
      (await q(
        `insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo, conexao, host, porta, papel, faz_cupom)
         values ($1,$2,'impressora',$3,$4,true,'rede',$5,9100,'cupom',true) returning id`,
        [t, u, nome, 'tok-' + randomUUID(), host],
      ))[0].id as string;
    const doDelivery = await impressora('Caixa delivery', '10.0.0.10');
    const doCaixa = await impressora('Caixa balcão', '10.0.0.20');
    await q(`insert into delivery_config (tenant_id, impressao_regras) values ($1, $2::jsonb)`, [t, JSON.stringify(regras({ doDelivery, doCaixa }))]);
    return { t, u, doDelivery, doCaixa };
  }
  // Aceita no servidor da loja e devolve a impressora em que a via saiu.
  async function aceitarEVer(t: string, u: string, tipo: 'retirada' | 'entrega'): Promise<string[]> {
    const [p] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total)
       values ($1,$2,'anotaai',$3,'77','Cliente de teste',$4,'novo',
               '[{"codigo":"XT1","descricao":"Lanche de teste","quantidade":1,"precoUnitario":20}]'::jsonb, 20)
       returning id`,
      [t, u, randomUUID(), tipo],
    );
    pedidos.push(p.id);
    await delivery.aceitar(t, null, p.id);
    const comanda = (await q('select comanda_id from pedido_externo where id = $1', [p.id]))[0].comanda_id;
    // A via sai logo depois do aceite (sem segurar a resposta): espera o trabalho aparecer.
    let jobs: any[] = [];
    for (let i = 0; i < 50 && !jobs.length; i++) {
      jobs = await q(`select equipamento_id from impressao_job where comanda_id = $1 and via = 'cliente'`, [comanda]);
      if (!jobs.length) await espera(100);
    }
    return jobs.map((j) => j.equipamento_id);
  }

  it('com regra própria: a retirada sai na impressora do caixa; a entrega segue na do delivery', async () => {
    const l = await loja(({ doDelivery, doCaixa }: any) => ({
      delivery: { impressoras: [{ id: doDelivery, vias: 1 }] },
      retirada: { mesmasDoDelivery: false, impressoras: [{ id: doCaixa, vias: 1 }] },
    }));
    expect(await aceitarEVer(l.t, l.u, 'retirada')).toEqual([l.doCaixa]);
    expect(await aceitarEVer(l.t, l.u, 'entrega')).toEqual([l.doDelivery]);
  });

  it('sem regra própria: a retirada sai nas mesmas do delivery (nada muda até a loja escolher)', async () => {
    const l = await loja(({ doDelivery }: any) => ({ delivery: { impressoras: [{ id: doDelivery, vias: 1 }] } }));
    expect(await aceitarEVer(l.t, l.u, 'retirada')).toEqual([l.doDelivery]);
  });
});
