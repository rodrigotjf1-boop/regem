import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Food99Service } from './food99.service';
import { logisticaDasComandas, logisticaDosPedidos } from '../../delivery/logistica-canal';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O entregador na 99 (mig 294) contra o Postgres de verdade (V6), com a API da 99 falsa:
//  • ENTREGA DA LOJA: o verificador avisa "saiu para entrega" (selfdelivery/dispatch) uma vez por
//    pedido, com o telefone certo, e manda a posição do entregador (updateCourierTrack);
//  • LOGÍSTICA DA 99: o webhook deliveryStatus vira a situação do entregador no painel/KDS.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('food99-entregador.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const ID_LOJA_ANA = '5764608647577510001'; // 99 entrega da loja, Ana (compartilha contato)
const ID_LOJA_BETO = '5764608647577510002'; // 99 entrega da loja, Beto (não compartilha)
const ID_PLATAFORMA = '5764608647577510003'; // entregador da 99
const ID_ANTIGO = '5764608647577510004'; // saiu há 5 h
const ID_PRONTO = '5764608647577510005'; // ainda não saiu

descrever('99 — o entregador (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  let tenant = '';
  let ana = '';
  let beto = '';
  const pedido: Record<string, string> = {};
  const comanda: Record<string, string> = {};

  let chamadas: { caminho: string; corpo: string }[] = [];
  let resposta: any = { errno: 0, errmsg: 'ok' };
  const refletir = jest.fn(async () => undefined);
  let ig: any;

  function svc99(): any {
    const s: any = Object.create(Food99Service.prototype);
    s.db = db;
    s.logger = { log() {}, warn() {}, error() {} };
    s.delivery = { refletirStatusExterno: refletir };
    s.ultimaPosicao = new Map();
    s.authToken = async () => 'tk';
    s.integracaoDoTenant = async () => ig;
    s.postJson = async (caminho: string, tk: string, campos: string[]) => {
      chamadas.push({ caminho, corpo: `{${[`"auth_token":${JSON.stringify(tk)}`, ...campos].join(',')}}` });
      return resposta;
    };
    return s;
  }

  async function novoPedido(ext: string, status: string, raw: any, entregador: string | null, horasAtras = 0.1) {
    const c = (await q(`insert into comanda (tenant_id, status) values ($1,'aberta') returning id`, [tenant])).rows[0].id;
    const id = (await q(
      `insert into pedido_externo (tenant_id, canal, external_id, status, tipo, cliente_nome, itens, total, raw,
                                   entregador_id, entregador_nome, despachado_em, comanda_id)
       values ($1,'99food',$2,$3,'entrega','Cliente','[]'::jsonb,10,$4::jsonb,$5,
               (select nome from colaborador where id = $5), now() - ($6 || ' hours')::interval, $7) returning id`,
      [tenant, ext, status, JSON.stringify(raw), entregador, String(horasAtras), c],
    )).rows[0].id;
    pedido[ext] = id;
    comanda[ext] = c;
  }

  beforeAll(async () => {
    // O banco de teste é montado como o do SERVIDOR DA LOJA (EDGE_MODE no CI), que pula as
    // migrations só-nuvem. O verificador roda SÓ na nuvem e lê a preferência do entregador
    // (mig 208, @cloud-only): cria a tabela com a MESMA forma para o teste ver o banco da nuvem.
    await q(`create table if not exists entregador_preferencia (
      colaborador_id uuid primary key, tenant_id uuid not null,
      compartilha_contato boolean not null default false, atualizado_em timestamptz not null default now())`);
    tenant = (await q(`insert into empresa (nome) values ('Teste entregador 99') returning id`)).rows[0].id;
    ig = { id: 'ig', tenantId: tenant, unidadeId: null, appId: 'a', appSecret: 's', appShopId: 'shop', token: null, config: {} };
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Entregador','execucao') returning id`, [tenant])).rows[0].id;
    ana = (await q(`insert into colaborador (tenant_id, nome, funcao_id, telefone) values ($1,'Ana Paula',$2,'(21) 99999-0000') returning id`, [tenant, funcao])).rows[0].id;
    beto = (await q(`insert into colaborador (tenant_id, nome, funcao_id, telefone) values ($1,'Beto',$2,'(21) 98888-1111') returning id`, [tenant, funcao])).rows[0].id;
    await q(`insert into entregador_preferencia (colaborador_id, tenant_id, compartilha_contato) values ($1,$2,true)`, [ana, tenant]);
    await q(`insert into cardapio_config (tenant_id, token, contato_loja) values ($1,$2,'(21) 3333-4444')`, [tenant, randomUUID()]);
    const daLoja = { delivery_type: 2, fulfillment_mode: 0, expected_arrived_eta: 0 };
    await novoPedido(ID_LOJA_ANA, 'despachado', daLoja, ana);
    await novoPedido(ID_LOJA_BETO, 'despachado', daLoja, beto);
    await novoPedido(ID_PLATAFORMA, 'pronto', { delivery_type: 1, handover_code: '4821' }, null);
    await novoPedido(ID_ANTIGO, 'despachado', daLoja, ana, 5);
    await novoPedido(ID_PRONTO, 'pronto', daLoja, null);
  });

  afterAll(async () => {
    if (tenant) {
      await q('delete from pedido_logistica where tenant_id = $1', [tenant]);
      await q('delete from pedido_externo where tenant_id = $1', [tenant]);
      await q('delete from entregador_preferencia where tenant_id = $1', [tenant]);
      await q('delete from empresa where id = $1', [tenant]);
    }
    await pool.end();
  });

  const linha = async (ext: string) =>
    (await q(`select * from pedido_logistica where pedido_id = $1`, [pedido[ext]])).rows[0];

  it('saiu para entrega: avisa a 99 UMA vez por pedido da loja, com o telefone certo; nunca o da plataforma', async () => {
    chamadas = [];
    const s = svc99();
    expect(await s.reconciliarDespachos(ig)).toBe(2);
    expect(chamadas.map((c) => c.caminho)).toEqual(['/v1/order/selfdelivery/dispatch', '/v1/order/selfdelivery/dispatch']);
    const doAna = chamadas.find((c) => c.corpo.includes(ID_LOJA_ANA))!.corpo;
    const doBeto = chamadas.find((c) => c.corpo.includes(ID_LOJA_BETO))!.corpo;
    // id de 64 bits LITERAL (sem aspas, sem arredondar)
    expect(doAna).toContain(`"order_id":${ID_LOJA_ANA},`);
    const j = JSON.parse(doAna.replace(`"order_id":${ID_LOJA_ANA}`, '"order_id":0'));
    expect(j.courier_info).toEqual({
      courier_name: 'Ana Paula', courier_first_name: 'Ana', courier_last_name: 'Paula',
      courier_phone_code: '+55', courier_phone: '21999990000',
    });
    expect(j.limit_time.delivery_time - j.limit_time.pickup_time).toBeGreaterThanOrEqual(10 * 60);
    // Beto não deixou compartilhar: vai o telefone da LOJA, nunca o dele
    expect(doBeto).toContain('"courier_phone":"2133334444"');
    expect(doBeto).not.toContain('988881111');
    expect(await linha(ID_LOJA_ANA)).toMatchObject({ modo: 'propria_canal', despacho_erro: null, despacho_tentativas: 1 });
    expect((await linha(ID_LOJA_ANA)).despacho_enviado_em).not.toBeNull();
    expect(await linha(ID_PLATAFORMA)).toBeUndefined();
    expect(await linha(ID_ANTIGO)).toBeUndefined();
    expect(await linha(ID_PRONTO)).toBeUndefined();

    chamadas = [];
    expect(await s.reconciliarDespachos(ig)).toBe(0);
    expect(chamadas).toHaveLength(0);
  });

  it('posição do entregador: vai para a 99 nos pedidos avisados, no máximo a cada 30 s', async () => {
    chamadas = [];
    const s = svc99();
    await s.rastrearPedidosDoEntregador(tenant, ana, -22.84, -43.28);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].caminho).toBe('/v1/order/selfdelivery/updateCourierTrack');
    expect(chamadas[0].corpo).toContain(`"order_id":${ID_LOJA_ANA},`);
    expect(chamadas[0].corpo).toContain('"longitude":-43.28,"latitude":-22.84');
    const lim = await linha(ID_LOJA_ANA);
    expect(chamadas[0].corpo).toContain(`"delivery_time":${Math.floor(new Date(lim.limite_entrega).getTime() / 1000)}`);
    await s.rastrearPedidosDoEntregador(tenant, ana, -22.85, -43.29);
    expect(chamadas).toHaveLength(1); // 30 s ainda não passaram
    // quem não tem pedido avisado não gera chamada
    await s.rastrearPedidosDoEntregador(tenant, randomUUID(), 0, 0);
    expect(chamadas).toHaveLength(1);
  });

  it('a 99 recusou: guarda o motivo e tenta de novo, até 5 vezes; sem telefone nenhum, nem tenta', async () => {
    await q(`update pedido_externo set status = 'despachado', despachado_em = now() where id = $1`, [pedido[ID_PRONTO]]);
    const s = svc99();
    resposta = { errno: 40001, errmsg: 'order status error' };
    for (let i = 1; i <= 6; i++) await s.reconciliarDespachos(ig);
    resposta = { errno: 0, errmsg: 'ok' };
    const l = await linha(ID_PRONTO);
    expect(l).toMatchObject({ despacho_enviado_em: null, despacho_tentativas: 5 });
    expect(l.despacho_erro).toBe('errno 40001: order status error');

    // sem telefone da loja e sem o do entregador: não chama a 99 e não insiste
    await q(`update cardapio_config set contato_loja = null, whatsapp = null where tenant_id = $1`, [tenant]);
    const semTel = await novoPedidoSemTelefone();
    chamadas = [];
    await s.reconciliarDespachos(ig);
    expect(chamadas).toHaveLength(0);
    expect(await linha(semTel)).toMatchObject({ despacho_enviado_em: null, despacho_tentativas: 5 });
    expect((await linha(semTel)).despacho_erro).toContain('telefone de contato da loja');
  });

  async function novoPedidoSemTelefone() {
    const ext = '5764608647577510009';
    await novoPedido(ext, 'despachado', { delivery_type: 2 }, beto);
    return ext;
  }

  it('logística da 99: o webhook deliveryStatus vira a situação do entregador; evento velho não volta atrás', async () => {
    const s = svc99();
    const evento = (st: number, ts: number, extra = '') =>
      `{"app_id":1,"app_shop_id":"shop","timestamp":${ts},"type":"deliveryStatus","data":{"order_id":${ID_PLATAFORMA},` +
      `"delivery_status":${st},"rider_name":"Carlos 99","rider_phone":"21977776666"${extra}}}`;
    expect(await s.registrarLogistica(ig, ID_PLATAFORMA, evento(120, 1790000000, ',"rider_to_B_ETA":"1790000600"'))).toBe(true);
    expect(await linha(ID_PLATAFORMA)).toMatchObject({
      modo: 'logistica_canal', status: 120, entregador_nome: 'Carlos 99', entregador_telefone: '21977776666',
    });
    await s.registrarLogistica(ig, ID_PLATAFORMA, evento(130, 1790000500));
    await s.registrarLogistica(ig, ID_PLATAFORMA, evento(120, 1790000100)); // chegou atrasado: ignora
    const l = await linha(ID_PLATAFORMA);
    expect(l.status).toBe(130);
    expect(new Date(l.chegada_loja_prevista).getTime()).toBe(1790000600 * 1000); // mantém a previsão
    expect(refletir).not.toHaveBeenCalled();
    // saiu com o pedido → o pedido anda para "em rota" no Regem
    await s.registrarLogistica(ig, ID_PLATAFORMA, evento(140, 1790000900));
    expect(refletir).toHaveBeenCalledWith(tenant, '99food', ID_PLATAFORMA, 'despachado');
    // pedido que ainda não chegou ao Regem: pede reenvio à 99
    expect(await s.registrarLogistica(ig, '5764608647577519999', evento(120, 1790000000))).toBe(false);
  });

  it('painel e KDS: a situação aparece pelo pedido e pela comanda (com o código de coleta da 99)', async () => {
    const porPedido = await logisticaDosPedidos(db, tenant, [pedido[ID_PLATAFORMA], pedido[ID_LOJA_ANA], 'lixo']);
    expect(porPedido.get(pedido[ID_PLATAFORMA])).toMatchObject({
      modo: 'logistica_canal', status: 140, situacao: 'saiu com o pedido', entregadorNome: 'Carlos 99',
      entregadorTelefone: '21977776666',
    });
    expect(porPedido.get(pedido[ID_LOJA_ANA])).toMatchObject({
      modo: 'propria_canal', entregadorNome: 'Ana Paula', entregadorTelefone: null, saidaErro: null,
    });
    expect(porPedido.get(pedido[ID_LOJA_ANA])!.saidaAvisadaEm).not.toBeNull();
    const porComanda = await logisticaDasComandas(db, tenant, [comanda[ID_PLATAFORMA], comanda[ID_LOJA_ANA]]);
    expect(porComanda.get(comanda[ID_PLATAFORMA])).toMatchObject({ codigoColeta: '4821', situacao: 'saiu com o pedido' });
    expect(porComanda.get(comanda[ID_LOJA_ANA])).toMatchObject({ codigoColeta: null });
  });
});
