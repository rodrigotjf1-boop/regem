import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema';
import { Food99Service } from './food99.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CANCELAMENTO PARCIAL DA 99 (`orderPartialCancel`, achado O8 da auditoria do KDS de 11/11/2026) pelo caminho de
// verdade do aviso (`processarWebhook`, com a integração semeada), contra o Postgres real. A 99 é de mentira: o detalhe
// que ela devolve segue o formato real (o de `pedido_externo.raw`: `order_items` e `price` no topo). Antes deste conserto
// o aviso cancelava o pedido INTEIRO (estornava a venda e tirava o pedido da cozinha).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('food99-parcial-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const LOJA = `loja-${randomUUID().slice(0, 8)}`;
const PEDIDO = '5764607801871630353';
const aviso = (tipo: 'orderPartialCancel' | 'orderCancel', pedido = PEDIDO) =>
  `{"app_id":123,"app_shop_id":"${LOJA}","type":"${tipo}","timestamp":1592970557,"data":{"order_id":${pedido}}}`;
const item = (mdu: string, name: string, amount: number, submit_refund_amount = 0) => ({ mdu_id: mdu, app_item_id: `app-${mdu}`, name, amount, submit_refund_amount });

descrever('cancelamento parcial da 99 (Postgres)', () => {
  let pool: Pool;
  let db: any;
  let food99: Food99Service;
  let loja: string;
  let pedidoId: string;
  const T = randomUUID();
  const avisos: any[] = [];
  const reflexos: any[][] = [];
  let detalheDa99: any = null;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const casos = () => q(`select * from atendimento_chamado where tenant_id = $1 order by criado_em`, [T]);
  const sign = process.env.FOOD99_REQUIRE_SIGN;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    process.env.FOOD99_REQUIRE_SIGN = 'false'; // o teste não assina o aviso (a assinatura tem os seus testes)
    const delivery: any = { refletirStatusExterno: async (...a: any[]) => void reflexos.push(a) };
    food99 = new Food99Service(db, delivery, { emit: (ev: string, p: any) => avisos.push({ ev, p }) } as any);
    (food99 as any).pedido = async () => detalheDa99;
    await q(`insert into empresa (id, nome) values ($1, 'teste 99 cancelamento parcial')`, [T]);
    [{ id: loja }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja Centro') returning id`, [T]);
    await q(
      `insert into integracao (tenant_id, canal, ativo, merchant_id, client_id, client_secret, config) values ($1,'99food',true,$2,'app','segredo','{}')`,
      [T, LOJA],
    );
  });
  afterAll(async () => {
    if (sign === undefined) delete process.env.FOOD99_REQUIRE_SIGN;
    else process.env.FOOD99_REQUIRE_SIGN = sign;
    if (!pool) return;
    for (const t of ['atendimento_chamado', 'pedido_externo', 'integracao', 'unidade']) await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    avisos.length = 0;
    reflexos.length = 0;
    delete process.env.EDGE_MODE;
    await q(`delete from atendimento_chamado where tenant_id = $1`, [T]);
    await q(`delete from pedido_externo where tenant_id = $1`, [T]);
    [{ id: pedidoId }] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, numero, cliente_nome, status, total)
       values ($1,$2,'99food',$3,42,'Cliente Teste','confirmado',60) returning id`,
      [T, loja, PEDIDO],
    );
    detalheDa99 = {
      order_id: PEDIDO,
      status: 100,
      order_items: [item('A1', 'Coca-Cola 2L', 1, 1), item('B2', 'Batata frita', 3, 2), item('C3', 'X-Burger', 2)],
      price: { refund_price: 2390 },
    };
  });

  it('parte saiu: o pedido NÃO é cancelado; a equipe recebe o caso "Mudança no pedido", urgente — e a 99 reenviando não abre outro', async () => {
    expect(await food99.processarWebhook(aviso('orderPartialCancel'))).toEqual({ errno: 0, errmsg: 'ok' });
    expect(await food99.processarWebhook(aviso('orderPartialCancel'))).toEqual({ errno: 0, errmsg: 'ok' });
    expect(reflexos).toEqual([]); // antes: refletirStatusExterno(..., 'cancelado') — a venda estornada e a cozinha sem o pedido
    const cs = await casos();
    expect(cs.length).toBe(1);
    expect(cs[0]).toMatchObject({
      tipo: 'mudanca',
      canal: '99food',
      status: 'aberto',
      prioridade: 'urgente',
      pedido_id: pedidoId,
      pedido_numero: '42',
      unidade_id: loja,
      cliente: 'Cliente Teste',
    });
    expect(cs[0].externo_id).toMatch(new RegExp(`^parcial-${PEDIDO}-[0-9a-f]{16}$`));
    expect(cs[0].mensagem).toContain('Saiu: 1× Coca-Cola 2L; 2× Batata frita (ficam 1).');
    expect(cs[0].mensagem).toContain('A 99 devolveu R$ 23,90 ao cliente.');
    expect(cs[0].detalhe.parcial99).toMatchObject({ pedidoExterno: PEDIDO, devolvido: 23.9 });
    expect(cs[0].detalhe.parcial99.tirados.map((t: any) => t.mdu)).toEqual(['A1', 'B2']);
    expect(avisos.filter((a) => a.ev === 'atendimento.novo').length).toBe(1);
  });

  it('a 99 tira MAIS um item depois: outro caso, com tudo o que saiu', async () => {
    await food99.processarWebhook(aviso('orderPartialCancel'));
    detalheDa99.order_items[2].submit_refund_amount = 1;
    await food99.processarWebhook(aviso('orderPartialCancel'));
    const cs = await casos();
    expect(cs.length).toBe(2);
    expect(cs[1].mensagem).toContain('1× X-Burger (ficam 1)');
    expect(reflexos).toEqual([]);
  });

  it('pedido que já saiu da loja: o caso fica com a prioridade normal', async () => {
    await q(`update pedido_externo set status = 'despachado' where id = $1`, [pedidoId]);
    await food99.processarWebhook(aviso('orderPartialCancel'));
    const [c] = await casos();
    expect(c.prioridade).toBe('normal');
  });

  it('o detalhe diz que a 99 cancelou o pedido (situação 9xx): cancela pelo serviço de sempre, sem caso', async () => {
    detalheDa99.status = 921;
    expect(await food99.processarWebhook(aviso('orderPartialCancel'))).toEqual({ errno: 0, errmsg: 'ok' });
    expect(reflexos).toEqual([[T, '99food', PEDIDO, 'cancelado']]);
    expect(await casos()).toEqual([]);
  });

  it('não sobrou item nenhum: cancela o pedido, sem caso', async () => {
    detalheDa99.order_items = [item('A1', 'Coca-Cola 2L', 1, 1), item('B2', 'Batata frita', 3, 3)];
    await food99.processarWebhook(aviso('orderPartialCancel'));
    expect(reflexos).toEqual([[T, '99food', PEDIDO, 'cancelado']]);
    expect(await casos()).toEqual([]);
  });

  it('sem o detalhe da 99 agora: pede o reenvio e não mexe em nada', async () => {
    detalheDa99 = null;
    expect((await food99.processarWebhook(aviso('orderPartialCancel'))).errno).not.toBe(0);
    expect(reflexos).toEqual([]);
    expect(await casos()).toEqual([]);
  });

  it('o pedido ainda não chegou ao Regem: pede o reenvio (ERR-061)', async () => {
    expect((await food99.processarWebhook(aviso('orderPartialCancel', '5764607801871639999'))).errno).not.toBe(0);
    expect(reflexos).toEqual([]);
    expect(await casos()).toEqual([]);
  });

  it('o cancelamento do pedido inteiro (`orderCancel`) continua cancelando', async () => {
    expect(await food99.processarWebhook(aviso('orderCancel'))).toEqual({ errno: 0, errmsg: 'ok' });
    expect(reflexos).toEqual([[T, '99food', PEDIDO, 'cancelado']]);
    expect(await casos()).toEqual([]);
  });
});
