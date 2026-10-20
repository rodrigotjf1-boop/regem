import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { DeliveryService } from './delivery.service';
import { EdgePedidosProcessor } from './edge-pedidos.processor';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-251 — PEDIDO DE CANAL ACEITO PELA NUVEM COM O SERVIDOR DA LOJA LIGADO (Mister Burguer, 16 a
// 20/10/2026). O iFood era aceito pela nuvem 1 s depois de chegar e a Anota Aí ~30 s depois, na
// consulta seguinte. O pedido descia já aceito, o servidor da loja o ignorava e nada saía no papel;
// quando o servidor tinha aceitado antes, os dois aceitavam: venda, lançamento e cozinha em DOBRO
// (119 vendas a mais, R$ 5.653,47). Contra o Postgres real, com os serviços de verdade:
//  • NUVEM: com o servidor da loja ligado, `materializarSeNovoExterno` não aceita ('adiado') e o
//    reflexo do status do canal não tira de 'novo' quem ainda não virou venda; o cancelamento passa
//    sempre; sem servidor ligado (ou com a batida velha), aceita como sempre — é o resgate;
//  • SERVIDOR DA LOJA: o pedido que chega JÁ ACEITO sai no papel uma vez (via + produção); o que
//    este servidor aceitou não sai de novo, nem se o vínculo do pedido trocar de comanda.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('canal-aceito-na-nuvem.spec: sem TEST_PG_URL — PULADO');

descrever('pedido de canal aceito pela nuvem com o servidor da loja ligado (ERR-251)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditoria = { registrar: async () => undefined } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any);
  const beneficio = new Proxy({}, { get: () => async () => undefined }) as any; // cashback e fidelidade
  const delivery = new DeliveryService(db, vendas, producao, beneficio, beneficio, eventos, { flashPedidos: () => undefined } as any);
  const env0 = {
    EDGE_MODE: process.env.EDGE_MODE,
    EDGE_UNIDADE_ID: process.env.EDGE_UNIDADE_ID,
    CLOUD_API: process.env.CLOUD_API,
    SYNC_TOKEN: process.env.SYNC_TOKEN,
  };
  const empresas: string[] = [];
  const pedidos: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // começa como NUVEM: é lá que os canais chegam
    // O aviso ao canal, no servidor da loja, pede à nuvem: sem ligação configurada, só registra.
    delete process.env.CLOUD_API;
    delete process.env.SYNC_TOKEN;
    // `edge_heartbeat` é só da nuvem; o banco do CI é de loja. Em paralelo, quem perde a corrida
    // do `create table if not exists` recebe 23505/42P07 — é "já existe" (ERR-128).
    await pool
      .query(
        `create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(),
           tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`,
      )
      .catch((e: any) => {
        if (!['23505', '42P07'].includes(e?.code)) throw e;
      });
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries(env0)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (pedidos.length) await pool.query('delete from impressao_edge_feito where comanda_id = any($1::uuid[])', [pedidos]).catch(() => {});
    if (empresas.length) {
      await pool
        .query(
          `delete from impressao_edge_feito where comanda_id in (select id from comanda where tenant_id = any($1::uuid[]))`,
          [empresas],
        )
        .catch(() => {});
      for (const t of ['pedido_envio', 'pedido_notificacao', 'impressao_job', 'producao_pedido', 'pedido_externo', 'lancamento_caixa', 'comanda', 'edge_status', 'edge_heartbeat', 'delivery_config', 'equipamento', 'produto', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  // A loja: um lanche que vai para a cozinha, a impressora da via do delivery (regra da mig 327) e a
  // da cozinha (padrão de produção). Impressoras de REDE: o servidor da loja imprime as duas.
  async function loja() {
    const t = (await q(`insert into empresa (nome) values ('teste canal aceito na nuvem') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    await q(
      `insert into produto (tenant_id, codigo, nome, preco_venda, vai_para_producao) values ($1,'XT1','Lanche de teste','20.00',true)`,
      [t],
    );
    const impressora = async (nome: string, cupom: boolean) =>
      (await q(
        `insert into equipamento (tenant_id, unidade_id, tipo, nome, token, ativo, conexao, host, porta, papel, faz_cupom, faz_producao, padrao)
         values ($1,$2,'impressora',$3,$4,true,'rede',$5,9100,$6,$7,$8,$9) returning id`,
        [t, u, nome, 'tok-' + randomUUID(), cupom ? '10.0.0.10' : '10.0.0.11', cupom ? 'cupom' : 'producao', cupom, !cupom, !cupom],
      ))[0].id as string;
    const cupom = await impressora('Caixa delivery', true);
    const cozinha = await impressora('Cozinha', false);
    await q(`insert into delivery_config (tenant_id, impressao_regras) values ($1, $2::jsonb)`, [
      t,
      JSON.stringify({ delivery: { impressoras: [{ id: cupom, vias: 1 }] } }),
    ]);
    return { t, u, cupom, cozinha };
  }
  const servidorLigado = (t: string, u: string, idade = '0 minutes') =>
    q(
      `insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, recebido_em)
       values ($1,$2,$3,'1.30.6', now() - $4::interval)`,
      [randomUUID(), t, u, idade],
    );
  async function pedidoNovo(t: string, u: string, canal = 'ifood') {
    const ext = randomUUID();
    const [p] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total)
       values ($1,$2,$3,$4,'1234','Cliente de teste','entrega','novo',
               '[{"codigo":"XT1","descricao":"Lanche de teste","quantidade":1,"precoUnitario":20}]'::jsonb, 20)
       returning id`,
      [t, u, canal, ext],
    );
    pedidos.push(p.id);
    return { id: p.id as string, ext };
  }
  const pedido = async (id: string) => (await q('select status, comanda_id from pedido_externo where id = $1', [id]))[0];
  const contar = async (sqlTexto: string, p: any[]) => Number((await q(sqlTexto, p))[0].n);

  it.each(['ifood', 'anotaai'])(
    'nuvem, servidor da loja LIGADO (%s): não aceita, o status do canal não pula a venda; o cancelamento passa',
    async (canal) => {
      delete process.env.EDGE_MODE;
      const { t, u } = await loja();
      await servidorLigado(t, u);
      const { id, ext } = await pedidoNovo(t, u, canal);
      expect(await delivery.materializarSeNovoExterno(t, canal, ext)).toBe('adiado');
      expect(await pedido(id)).toEqual({ status: 'novo', comanda_id: null });
      // "Despachado" vindo do canal antes de o servidor aceitar: fica para depois (antes o pedido
      // saía de 'novo' sem venda, e o servidor nunca mais o aceitava).
      expect(await delivery.refletirStatusExterno(t, canal, ext, 'despachado')).toBe('adiado');
      expect(await delivery.refletirStatusExterno(t, canal, ext, 'concluido')).toBe('adiado');
      expect((await pedido(id)).status).toBe('novo');
      expect(await contar('select count(*) n from comanda where tenant_id = $1', [t])).toBe(0);
      expect(await contar('select count(*) n from lancamento_caixa where tenant_id = $1', [t])).toBe(0);
      // O canal cancelou: passa mesmo com o servidor ligado (não há venda a esperar).
      expect(await delivery.refletirStatusExterno(t, canal, ext, 'cancelado')).toBe('aplicado');
      expect((await pedido(id)).status).toBe('cancelado');
    },
  );

  it('nuvem SEM servidor ligado (ou com a batida de 10 min atrás): aceita como sempre — o resgate', async () => {
    delete process.env.EDGE_MODE;
    const semServidor = await loja();
    const a = await pedidoNovo(semServidor.t, semServidor.u);
    expect(await delivery.materializarSeNovoExterno(semServidor.t, 'ifood', a.ext)).toBe('aceito');
    expect((await pedido(a.id)).status).toBe('confirmado');

    const batidaVelha = await loja();
    await servidorLigado(batidaVelha.t, batidaVelha.u, '10 minutes');
    const b = await pedidoNovo(batidaVelha.t, batidaVelha.u);
    expect(await delivery.materializarSeNovoExterno(batidaVelha.t, 'ifood', b.ext)).toBe('aceito');
    expect((await pedido(b.id)).comanda_id).not.toBeNull();
    // Já aceito: o status do canal entra normalmente, com o servidor ligado ou não.
    await servidorLigado(batidaVelha.t, batidaVelha.u);
    expect(await delivery.refletirStatusExterno(batidaVelha.t, 'ifood', b.ext, 'pronto')).toBe('aplicado');
    expect((await pedido(b.id)).status).toBe('pronto');
  });

  it('servidor da loja: o pedido que chega JÁ ACEITO sai uma vez (via + produção); o aceito aqui não repete', async () => {
    // 1) A nuvem aceitou (a loja estava fora): a venda e o card existem; no banco da loja, nenhum
    //    trabalho de impressão (a fila de impressão não sincroniza).
    delete process.env.EDGE_MODE;
    const l = await loja();
    const fora = await pedidoNovo(l.t, l.u);
    expect(await delivery.materializarSeNovoExterno(l.t, 'ifood', fora.ext)).toBe('aceito');
    const comandaFora = (await pedido(fora.id)).comanda_id as string;
    await q('delete from impressao_job where comanda_id = $1', [comandaFora]);
    await q(`update pedido_externo set confirmado_em = now() - interval '1 minute' where id = $1`, [fora.id]);
    // Um pedido velho (3 h) e um que já ficou pronto, também aceitos fora: não saem.
    const velho = await pedidoNovo(l.t, l.u);
    await delivery.materializarSeNovoExterno(l.t, 'ifood', velho.ext);
    const pronto = await pedidoNovo(l.t, l.u);
    await delivery.materializarSeNovoExterno(l.t, 'ifood', pronto.ext);
    await q(`delete from impressao_job where tenant_id = $1`, [l.t]);
    await q(`update pedido_externo set criado_em = now() - interval '3 hours', confirmado_em = now() - interval '3 hours' where id = $1`, [velho.id]);
    await q(`update pedido_externo set status = 'pronto', confirmado_em = now() - interval '1 minute' where id = $1`, [pronto.id]);

    // 2) O servidor da loja (só esta loja: o banco do CI é compartilhado).
    process.env.EDGE_MODE = 'true';
    process.env.EDGE_UNIDADE_ID = l.u;
    const proc = new EdgePedidosProcessor(db, delivery);
    await proc.processar();
    const jobs = await q('select equipamento_id, via, comanda_id from impressao_job where tenant_id = $1 order by via', [l.t]);
    expect(jobs).toEqual([
      { equipamento_id: l.cupom, via: 'cliente', comanda_id: comandaFora },
      { equipamento_id: l.cozinha, via: 'producao', comanda_id: comandaFora },
    ]);
    expect(await contar('select count(*) n from impressao_edge_feito where comanda_id = $1', [fora.id])).toBe(1);
    // De novo: nada repete.
    await proc.processar();
    expect(await contar('select count(*) n from impressao_job where tenant_id = $1', [l.t])).toBe(2);

    // 3) Aceito AQUI: imprime no aceite e marca o pedido; se o vínculo trocar de comanda (aceite
    //    em dobro com a nuvem), o processador não imprime de novo.
    const aqui = await pedidoNovo(l.t, l.u);
    await delivery.aceitar(l.t, null, aqui.id);
    // O aceite grava a marca e os 2 cupons (via + produção) em segundo plano: espera os três antes de medir. Medir com
    // um cupom ainda a caminho fazia o teste falhar às vezes no CI (3 em vez de 4) sem reimpressão nenhuma (ERR-255).
    const cupons = () => contar('select count(*) n from impressao_job where tenant_id = $1', [l.t]);
    const marcado = () => contar('select count(*) n from impressao_edge_feito where comanda_id = $1', [aqui.id]);
    for (let i = 0; i < 100 && !((await marcado()) === 1 && (await cupons()) >= 4); i++) await espera(100);
    const antes = await cupons();
    expect(antes).toBe(4); // os 2 de antes + via e produção do aceite daqui
    const [outra] = await q(
      `insert into comanda (tenant_id, unidade_id, status, total, fechada_em) values ($1,$2,'fechada',20, now()) returning id`,
      [l.t, l.u],
    );
    await q(`update pedido_externo set comanda_id = $2, confirmado_em = now() - interval '1 minute' where id = $1`, [aqui.id, outra.id]);
    await proc.processar();
    expect(await contar('select count(*) n from impressao_job where tenant_id = $1', [l.t])).toBe(antes);
  });
});
