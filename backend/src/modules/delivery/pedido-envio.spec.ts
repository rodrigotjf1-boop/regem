import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { DeliveryService } from './delivery.service';
import { fetchExterno } from '../../common/fetch-externo';
import { enviosDoPedido, expurgarEnvios, falhasDeEnvio, gravarEnvio, NaoEnviado, resumirEnvio } from './pedido-envio';
import type { ChamadaExterna, Observacao } from '../../common/chamadas-externas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// REGISTRO DOS ENVIOS DO PEDIDO (mig 305) — decisão do dono (02/10/2026): registrar e mostrar o que
// o Regem manda ao canal e ao cliente, SEM mudar o envio.
//
// Três blocos: (1) como o resultado observado vira registro — sem banco; (2) a tabela, contra o
// Postgres real; (3) os envios do `DeliveryService` com canais de mentira e a rede simulada — a
// chamada que sai é a mesma de sempre, e o que ficou gravado conta a verdade.

const chamada = (c: Partial<ChamadaExterna>): ChamadaExterna => ({ metodo: 'POST', destino: 'canal.exemplo/x', status: 200, ok: true, ms: 10, ...c });
const obs = (o: Partial<Observacao<unknown>>): Observacao<unknown> => ({ lancou: false, chamadas: [], ...o });

describe('resultado observado → registro', () => {
  const edge = process.env.EDGE_MODE;
  afterEach(() => {
    if (edge === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edge;
  });

  it('quem devolve verdadeiro/falso manda no resultado — mesmo com HTTP 200 (a 99 responde o erro no corpo)', () => {
    expect(resumirEnvio(obs({ valor: true, chamadas: [chamada({})] }))).toMatchObject({ resultado: 'enviado', motivo: null, httpStatus: 200 });
    expect(resumirEnvio(obs({ valor: false, chamadas: [chamada({ trecho: '{"errno":10012,"errmsg":"order finished"}' })] }))).toEqual({
      resultado: 'falhou',
      motivo: 'o canal recusou — {"errno":10012,"errmsg":"order finished"}',
      httpStatus: 200,
      duracaoMs: 10,
    });
  });

  it('quem não devolve nada é julgado pela ÚLTIMA chamada', () => {
    expect(resumirEnvio(obs({ chamadas: [chamada({ status: 401, ok: false }), chamada({ ms: 5 })] }))).toMatchObject({ resultado: 'enviado', duracaoMs: 15 });
    expect(resumirEnvio(obs({ chamadas: [chamada({}), chamada({ status: 400, ok: false, trecho: 'Field cancellationCode is required' })] }))).toMatchObject({
      resultado: 'falhou',
      motivo: 'HTTP 400 — Field cancellationCode is required',
      httpStatus: 400,
    });
  });

  it('sem resposta: diz se foi tempo esgotado ou rede', () => {
    expect(resumirEnvio(obs({ lancou: true, erro: new Error('x'), chamadas: [chamada({ status: null, ok: false, erro: 'timeout' })] }))).toMatchObject({ resultado: 'falhou', motivo: 'o canal não respondeu a tempo', httpStatus: null });
    expect(resumirEnvio(obs({ lancou: true, erro: new Error('x'), chamadas: [chamada({ status: null, ok: false, erro: 'rede' })] }))).toMatchObject({ motivo: 'falha de rede ao falar com o canal' });
    expect(resumirEnvio(obs({ lancou: true, erro: new Error('sem token do Cardápio Web') }))).toMatchObject({ resultado: 'falhou', motivo: 'sem token do Cardápio Web' });
  });

  it('nada saiu desta máquina: "não enviado", e o motivo diz se é a loja ou a nuvem', () => {
    delete process.env.EDGE_MODE;
    expect(resumirEnvio(obs({ valor: false }))).toMatchObject({ resultado: 'nao_enviado', motivo: 'integração do canal inativa ou sem credencial' });
    process.env.EDGE_MODE = 'true';
    expect(resumirEnvio(obs({}))).toMatchObject({ resultado: 'nao_enviado', motivo: expect.stringContaining('este servidor (loja) não tem a credencial do canal') });
  });

  it('quem decide não enviar explica — e pode dizer que nem vale registro', () => {
    expect(resumirEnvio(obs({ valor: new NaoEnviado('adiado: pedido agendado') }))).toMatchObject({ resultado: 'nao_enviado', motivo: 'adiado: pedido agendado' });
    expect(resumirEnvio(obs({ valor: new NaoEnviado('entrega feita pela 99', false) }))).toBeNull();
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pedido-envio.spec: sem TEST_PG_URL — blocos de banco PULADOS');

jest.setTimeout(60_000);

descrever('registro dos envios do pedido (Postgres real)', () => {
  let pool: Pool;
  let db: any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const empresas: string[] = [];
  const edge = process.env.EDGE_MODE;
  const fetchOriginal = global.fetch;

  beforeAll(() => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    delete process.env.EDGE_MODE;
  });
  afterAll(async () => {
    if (edge !== undefined) process.env.EDGE_MODE = edge;
    global.fetch = fetchOriginal;
    for (const t of empresas) {
      await q('delete from pedido_externo where tenant_id = $1', [t]).catch(() => {}); // leva os registros junto
      await q('delete from unidade where tenant_id = $1', [t]).catch(() => {});
      await q('delete from empresa where id = $1', [t]).catch(() => {});
    }
    await pool.end();
  });
  afterEach(() => {
    global.fetch = fetchOriginal;
    delete process.env.EDGE_MODE;
  });

  const empresa = async () => {
    const t = (await q(`insert into empresa (nome) values ('teste envios do pedido') returning id`))[0].id as string;
    empresas.push(t);
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    return { t, u };
  };
  const pedido = async (t: string, u: string | null, canal: string, extra: Record<string, any> = {}) => {
    const r = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, status, tipo, total, itens, agendamento, raw)
       values ($1,$2,$3,$4,$5,$6,10,'[]'::jsonb,$7,$8::jsonb) returning *`,
      [t, u, canal, extra.externalId ?? String(Math.floor(Math.random() * 1e12)), extra.status ?? 'confirmado', extra.tipo ?? 'entrega', extra.agendamento ?? null, JSON.stringify(extra.raw ?? {})],
    );
    const p = r[0];
    return { ...p, tenantId: p.tenant_id, unidadeId: p.unidade_id, externalId: p.external_id, motivoCancelamento: null };
  };
  const registros = (t: string, id: string) => enviosDoPedido(db, t, id);
  /** Espera os registros gravados em segundo plano (os avisos ao cliente usam `void`). */
  const ate = async (t: string, id: string, n: number) => {
    for (let i = 0; i < 40; i++) {
      const r = await registros(t, id);
      if (r.length >= n) return r;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    return registros(t, id);
  };

  describe('a tabela', () => {
    it('grava com a loja do pedido e diz qual servidor tentou', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood');
      await gravarEnvio(db, { tenantId: t, pedidoId: p.id, destino: 'ifood', acao: 'confirm', resultado: 'enviado', httpStatus: 202, duracaoMs: 120 });
      process.env.EDGE_MODE = 'true';
      await gravarEnvio(db, { tenantId: t, pedidoId: p.id, destino: 'ifood', acao: 'ready', resultado: 'nao_enviado', motivo: 'x'.repeat(900) });
      const r = await q(`select * from pedido_envio where pedido_id = $1 order by criado_em, acao`, [p.id]);
      expect(r).toHaveLength(2);
      expect(r[0]).toMatchObject({ tenant_id: t, unidade_id: u, destino: 'ifood', acao: 'confirm', resultado: 'enviado', http_status: 202, duracao_ms: 120, servidor: 'nuvem', motivo: null });
      expect(r[1]).toMatchObject({ acao: 'ready', resultado: 'nao_enviado', servidor: 'loja' });
      expect(r[1].motivo).toHaveLength(400); // aparado
    });

    it('nunca lança: pedido de outra empresa (ou inexistente) simplesmente não grava', async () => {
      const a = await empresa();
      const b = await empresa();
      const p = await pedido(a.t, a.u, 'ifood');
      await expect(gravarEnvio(db, { tenantId: b.t, pedidoId: p.id, destino: 'ifood', acao: 'confirm', resultado: 'enviado' })).resolves.toBeUndefined();
      await expect(gravarEnvio(db, { tenantId: a.t, pedidoId: randomUUID(), destino: 'ifood', acao: 'confirm', resultado: 'enviado' })).resolves.toBeUndefined();
      await expect(gravarEnvio(db, { tenantId: a.t, pedidoId: 'isto-nao-e-uuid', destino: 'ifood', acao: 'confirm', resultado: 'enviado' })).resolves.toBeUndefined();
      await expect(gravarEnvio(db, { tenantId: a.t, pedidoId: p.id, destino: 'ifood', acao: 'confirm', resultado: 'resultado-invalido' as any })).resolves.toBeUndefined();
      expect(await q(`select 1 from pedido_envio where pedido_id = $1`, [p.id])).toHaveLength(0);
    });

    it('linha do tempo em ordem; falhas das últimas 24 h, só da loja (ou sem loja) e só da empresa', async () => {
      const { t, u } = await empresa();
      const outraLoja = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja 2') returning id`, [t]))[0].id as string;
      const p = await pedido(t, u, 'anotaai');
      const daOutra = await pedido(t, outraLoja, 'anotaai');
      const semLoja = await pedido(t, null, 'ifood');
      await gravarEnvio(db, { tenantId: t, pedidoId: p.id, destino: 'anotaai', acao: 'ready', resultado: 'enviado' });
      await gravarEnvio(db, { tenantId: t, pedidoId: p.id, destino: 'anotaai', acao: 'finalizar', resultado: 'falhou', motivo: 'HTTP 500', httpStatus: 500 });
      await gravarEnvio(db, { tenantId: t, pedidoId: p.id, destino: 'cliente_whatsapp', acao: 'entregue', resultado: 'nao_enviado', motivo: 'sem robô' });
      await gravarEnvio(db, { tenantId: t, pedidoId: daOutra.id, destino: 'anotaai', acao: 'ready', resultado: 'falhou', motivo: 'HTTP 400' });
      await gravarEnvio(db, { tenantId: t, pedidoId: semLoja.id, destino: 'ifood', acao: 'confirm', resultado: 'falhou', motivo: 'HTTP 401' });
      await q(`update pedido_envio set criado_em = now() - interval '30 hours' where pedido_id = $1 and acao = 'confirm'`, [semLoja.id]);
      await gravarEnvio(db, { tenantId: t, pedidoId: semLoja.id, destino: 'ifood', acao: 'dispatch', resultado: 'falhou', motivo: 'HTTP 403' });

      expect((await registros(t, p.id)).map((r) => `${r.destino}/${r.acao}/${r.resultado}`)).toEqual(['anotaai/ready/enviado', 'anotaai/finalizar/falhou', 'cliente_whatsapp/entregue/nao_enviado']);

      const f = await falhasDeEnvio(db, t, u);
      expect(f).toMatchObject({ horas: 24, total: 2, pedidos: 2 });
      expect(f.itens.map((i: any) => `${i.canal}/${i.acao}`).sort()).toEqual(['anotaai/finalizar', 'ifood/dispatch']); // a de 30 h e a da outra loja ficam de fora
      expect(f.itens[0]).toHaveProperty('pedidoId');
      expect((await falhasDeEnvio(db, t, null)).total).toBe(3); // sem loja no contexto: todas as da empresa
      const outra = await empresa();
      expect(await falhasDeEnvio(db, outra.t, outra.u)).toMatchObject({ total: 0, itens: [] });
    });

    it('expurgo apaga em lote o que passou do prazo; apagar o pedido leva os registros junto', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood');
      await gravarEnvio(db, { tenantId: t, pedidoId: p.id, destino: 'ifood', acao: 'confirm', resultado: 'enviado' });
      await gravarEnvio(db, { tenantId: t, pedidoId: p.id, destino: 'ifood', acao: 'ready', resultado: 'enviado' });
      await q(`update pedido_envio set criado_em = now() - interval '100 days' where pedido_id = $1 and acao = 'confirm'`, [p.id]);
      expect(await expurgarEnvios(db, 90)).toBeGreaterThanOrEqual(1);
      expect((await registros(t, p.id)).map((r) => r.acao)).toEqual(['ready']);
      await q(`delete from pedido_externo where id = $1`, [p.id]);
      expect(await q(`select 1 from pedido_envio where pedido_id = $1`, [p.id])).toHaveLength(0);
    });
  });

  describe('os envios ao canal: a chamada é a mesma, e o registro conta o que aconteceu', () => {
    // A rede é simulada: cada canal de mentira chama o `fetchExterno` de verdade.
    const rede = (resposta: (url: string) => Response | Promise<Response>) => {
      const chamadas: string[] = [];
      global.fetch = jest.fn(async (url: any) => {
        chamadas.push(String(url));
        return resposta(String(url));
      }) as any;
      return chamadas;
    };
    const ok = (corpo = '{}') => new Response(corpo, { status: 200 });
    const post = async (url: string) => (await fetchExterno(url, { method: 'POST', body: '{}' })).ok;
    const servico = (canais: { od?: any; cw?: any; ifood?: any; food99?: any; anotaai?: any }) =>
      new (DeliveryService as any)(db, {}, {}, {}, {}, { emit: () => undefined }, { flashPedidos: () => undefined }, canais.od, canais.cw, canais.ifood, canais.food99, canais.anotaai, undefined) as any;

    it('iFood: confirm aceito → "enviado"; pronto recusado → "falhou" com o código e o que o canal disse', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood');
      const feitas: string[] = [];
      const ifood = {
        integracaoDoTenant: async () => ({ id: 'ig' }),
        confirmar: async (_ig: any, id: string) => {
          feitas.push(`confirm:${id}`);
          await post(`https://ifood.exemplo/orders/${id}/confirm`);
        },
        prontoRetirada: async (_ig: any, id: string) => void (await post(`https://ifood.exemplo/orders/${id}/readyToPickup`)),
      };
      const urls = rede((url) => (url.endsWith('/confirm') ? new Response('', { status: 202 }) : new Response('{"message":"Order is not in a valid state"}', { status: 409 })));
      const svc = servico({ ifood });
      await svc.statusBackIfood(t, p, 'confirm');
      await svc.statusBackIfood(t, p, 'ready');
      expect(feitas).toEqual([`confirm:${p.externalId}`]); // o canal foi chamado como sempre
      expect(urls).toEqual([`https://ifood.exemplo/orders/${p.externalId}/confirm`, `https://ifood.exemplo/orders/${p.externalId}/readyToPickup`]);
      const r = await registros(t, p.id);
      expect(r.map((x) => `${x.destino}/${x.acao}/${x.resultado}`)).toEqual(['ifood/confirm/enviado', 'ifood/ready/falhou']);
      expect(r[0]).toMatchObject({ httpStatus: 202, motivo: null, servidor: 'nuvem' });
      expect(r[1]).toMatchObject({ httpStatus: 409, motivo: 'HTTP 409 — {"message":"Order is not in a valid state"}' });
    });

    it('iFood agendado: a saída é ADIADA (como sempre) e o registro diz por quê — sem chamar o canal', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'ifood', { agendamento: new Date(Date.now() + 3 * 3_600_000) });
      const ifood = { integracaoDoTenant: async () => ({ id: 'ig' }), despachar: jest.fn() };
      const urls = rede(() => ok());
      await servico({ ifood }).statusBackIfood(t, { ...p, agendamento: p.agendamento }, 'dispatch');
      expect(ifood.despachar).not.toHaveBeenCalled();
      expect(urls).toEqual([]);
      expect(await registros(t, p.id)).toMatchObject([{ acao: 'dispatch', resultado: 'nao_enviado', motivo: expect.stringContaining('agendado') }]);
    });

    it('99Food: HTTP 200 com erro no corpo é "falhou"; entrega feita pela 99 não gera registro', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, '99food', { raw: { delivery_type: 2 } });
      const da99 = await pedido(t, u, '99food', { raw: { delivery_type: 1 } });
      const food99 = {
        integracaoDoTenant: async () => ({ id: 'ig' }),
        pronto: async (_ig: any, id: string) => (await (await fetchExterno(`https://99.exemplo/v1/order/order/ready?auth_token=TOKEN_SECRETO_DA_LOJA&order_id=${id}`)).json()).errno === 0,
        entregue: jest.fn(async () => true),
      };
      rede(() => ok('{"errno":10012,"errmsg":"order status not allowed"}'));
      const svc = servico({ food99 });
      await svc.statusBackFood99(t, p, 'ready');
      await svc.statusBackFood99(t, da99, 'delivered');
      const r = await registros(t, p.id);
      expect(r).toMatchObject([{ destino: '99food', acao: 'ready', resultado: 'falhou', httpStatus: 200, motivo: 'o canal recusou — {"errno":10012,"errmsg":"order status not allowed"}' }]);
      expect(JSON.stringify(r)).not.toContain('TOKEN_SECRETO_DA_LOJA');
      expect(food99.entregue).not.toHaveBeenCalled(); // entrega da 99: quem conclui é ela
      expect(await registros(t, da99.id)).toEqual([]);
    });

    it('Anota AI e Cardápio Web: verdadeiro/falso do canal vira enviado/falhou', async () => {
      const { t, u } = await empresa();
      const a = await pedido(t, u, 'anotaai');
      const c = await pedido(t, u, 'cardapio_web', { tipo: 'retirada' });
      const anotaai = {
        integracaoDoTenant: async () => ({ id: 'ig' }),
        pronto: (_ig: any, id: string) => post(`https://anota.exemplo/order/ready/${id}`),
        finalizar: (_ig: any, id: string) => post(`https://anota.exemplo/order/finalize/${id}`),
        cancelar: (_ig: any, id: string) => post(`https://anota.exemplo/order/cancel/${id}`),
      };
      const cw = { statusBack: (_t: string, id: string, acao: string) => post(`https://cw.exemplo/orders/${id}/${acao}`) };
      rede((url) => (url.includes('/finalize') ? new Response('nope', { status: 500 }) : ok()));
      const svc = servico({ anotaai, cw });
      await svc.statusBackAnotaAi(t, a, 'ready');
      await svc.statusBackAnotaAi(t, a, 'finalizar');
      await svc.statusBackCw(t, c, 'ready');
      await svc.statusBackCw(t, c, 'finalize');
      expect((await registros(t, a.id)).map((x) => `${x.acao}/${x.resultado}`)).toEqual(['ready/enviado', 'finalizar/falhou']);
      const rc = await registros(t, c.id);
      expect(rc.map((x) => `${x.destino}/${x.acao}/${x.resultado}`)).toEqual(['cardapio_web/ready/enviado', 'cardapio_web/finalize/falhou']);
      expect(rc[1].motivo).toBe('HTTP 500 — nope');
    });

    it('sem credencial do canal: nada sai e fica registrado "não enviado" — na loja, o motivo é a loja', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'anotaai');
      const q99 = await pedido(t, u, '99food');
      const urls = rede(() => ok());
      const svc = servico({ anotaai: { integracaoDoTenant: async () => null } }); // 99 nem existe neste servidor
      await svc.statusBackAnotaAi(t, p, 'ready');
      // Na loja, sem credencial E sem ligação com a nuvem (o repasse à nuvem tem spec própria:
      // status-canal-pela-nuvem.spec.ts). O registro sai em segundo plano.
      const [nuvem, token] = [process.env.CLOUD_API, process.env.SYNC_TOKEN];
      delete process.env.CLOUD_API;
      delete process.env.SYNC_TOKEN;
      process.env.EDGE_MODE = 'true';
      try {
        await svc.statusBackFood99(t, q99, 'confirm');
        expect(await ate(t, q99.id, 1)).toMatchObject([{ resultado: 'nao_enviado', servidor: 'loja', motivo: expect.stringContaining('este servidor (loja) não tem a credencial') }]);
      } finally {
        if (nuvem !== undefined) process.env.CLOUD_API = nuvem;
        if (token !== undefined) process.env.SYNC_TOKEN = token;
      }
      expect(urls).toEqual([]);
      expect(await registros(t, p.id)).toMatchObject([{ resultado: 'nao_enviado', servidor: 'nuvem', motivo: 'integração do canal inativa ou sem credencial' }]);
    });

    it('o envio que LANÇA não derruba nada (é chamado em segundo plano) e fica como "falhou"', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'open_delivery');
      const od = {
        integracaoDoTenant: async () => ({ id: 'ig' }),
        despachar: async () => {
          throw new Error('sem token');
        },
      };
      rede(() => ok());
      await expect(servico({ od }).statusBack(t, p, 'dispatch')).resolves.toMatchObject({ resultado: 'falhou' }); // resolve, nunca rejeita
      expect(await registros(t, p.id)).toMatchObject([{ destino: 'open_delivery', acao: 'dispatch', resultado: 'falhou', motivo: 'sem token' }]);
    });

    it('pedido de outro canal não chama nem registra (cada envio só cuida do seu canal)', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'cardapio');
      const urls = rede(() => ok());
      const svc = servico({ ifood: { integracaoDoTenant: jest.fn() }, anotaai: { integracaoDoTenant: jest.fn() } });
      await svc.statusBackIfood(t, p, 'confirm');
      await svc.statusBackAnotaAi(t, p, 'ready');
      await svc.statusBackCw(t, p, 'ready');
      await svc.statusBackFood99(t, p, 'ready');
      await svc.statusBack(t, p, 'dispatch');
      expect(urls).toEqual([]);
      expect(await registros(t, p.id)).toEqual([]);
    });
  });

  describe('os avisos ao cliente', () => {
    const servico = () => new (DeliveryService as any)(db, {}, {}, {}, {}, { emit: () => undefined }, { flashPedidos: () => undefined }) as any;

    it('robô de WhatsApp (n8n): respondeu 200 → "enviado"; respondeu 500 → "falhou"; status sem aviso não registra', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'cardapio');
      const antes = process.env.OTP_WEBHOOK_URL;
      process.env.OTP_WEBHOOK_URL = 'https://8.8.8.8/webhook/regem';
      try {
        const svc = servico();
        global.fetch = jest.fn(async () => new Response('ok', { status: 200 })) as any;
        await svc.notificarN8n(t, { evento: 'status', eventoStatus: 'saiu_entrega', pedidoId: p.id, telefone: '21999990000' });
        let r = await ate(t, p.id, 1);
        expect(r).toMatchObject([{ destino: 'cliente_whatsapp', acao: 'saiu_entrega', resultado: 'enviado', httpStatus: 200 }]);
        expect(JSON.stringify(r)).not.toContain('21999990000');

        global.fetch = jest.fn(async () => new Response('erro', { status: 500 })) as any;
        await svc.notificarN8n(t, { evento: 'status', eventoStatus: 'entregue', pedidoId: p.id });
        r = await ate(t, p.id, 2);
        expect(r[1]).toMatchObject({ acao: 'entregue', resultado: 'falhou', httpStatus: 500, motivo: 'o robô de WhatsApp respondeu HTTP 500' });

        // 'pronto' de ENTREGA não avisa o cliente (eventoStatus null): o robô recebe, o registro não mente
        await svc.notificarN8n(t, { evento: 'status', eventoStatus: null, pedidoId: p.id });
        await new Promise((ok) => setTimeout(ok, 150));
        expect(await registros(t, p.id)).toHaveLength(2);
      } finally {
        if (antes === undefined) delete process.env.OTP_WEBHOOK_URL;
        else process.env.OTP_WEBHOOK_URL = antes;
      }
    });

    it('sem robô configurado: "não enviado", com o motivo', async () => {
      const { t, u } = await empresa();
      const p = await pedido(t, u, 'cardapio');
      const antes = process.env.OTP_WEBHOOK_URL;
      delete process.env.OTP_WEBHOOK_URL;
      try {
        await servico().notificarN8n(t, { evento: 'status', eventoStatus: 'confirmado', pedidoId: p.id });
        expect(await ate(t, p.id, 1)).toMatchObject([{ destino: 'cliente_whatsapp', acao: 'confirmado', resultado: 'nao_enviado', motivo: 'o robô de WhatsApp não está configurado para esta loja' }]);
      } finally {
        if (antes !== undefined) process.env.OTP_WEBHOOK_URL = antes;
      }
    });
  });
});
