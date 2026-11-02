import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ChatIfoodService } from './chat-ifood.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CHAT OFICIAL DO iFOOD NA CENTRAL (Onda 1, PR 5): a configuração do widget — o id da DISTRIBUIÇÃO (env) e as lojas
// do iFood da integração da empresa. Sem o widget, desligado; no servidor da loja, vem da nuvem (V37), e "não li" é
// diferente de "não tem".
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('chat-ifood-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('chat oficial do iFood: a configuração (Postgres)', () => {
  let pool: Pool;
  let svc: ChatIfoodService;
  const T = randomUUID();
  const OUTRA = randomUUID();
  const WIDGET = randomUUID();
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const env = { w: process.env.IFOOD_WIDGET_ID, edge: process.env.EDGE_MODE, api: process.env.CLOUD_API, tok: process.env.SYNC_TOKEN };
  const integrar = (tenant: string, merchant: string | null, ativo = true) =>
    q(`insert into integracao (tenant_id, canal, ativo, merchant_id) values ($1, 'ifood', $2, $3)`, [tenant, ativo, merchant]);

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new ChatIfoodService(drizzle(pool, { schema }) as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste chat ifood'), ($2, 'outra empresa')`, [T, OUTRA]);
  });
  afterAll(async () => {
    for (const [k, v] of Object.entries({ IFOOD_WIDGET_ID: env.w, EDGE_MODE: env.edge, CLOUD_API: env.api, SYNC_TOKEN: env.tok })) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (!pool) return;
    await q(`delete from integracao where tenant_id = any($1)`, [[T, OUTRA]]).catch(() => {});
    await q(`delete from empresa where id = any($1)`, [[T, OUTRA]]).catch(() => {});
    await pool.end();
  });
  beforeEach(async () => {
    process.env.IFOOD_WIDGET_ID = WIDGET;
    delete process.env.EDGE_MODE;
    await q(`delete from integracao where tenant_id = any($1)`, [[T, OUTRA]]);
  });

  it('sem o widget da distribuição (ou com um id que não é UUID): desligado', async () => {
    await integrar(T, randomUUID());
    delete process.env.IFOOD_WIDGET_ID;
    expect(await svc.config(T)).toEqual({ disponivel: false, motivo: 'sem_widget' });
    process.env.IFOOD_WIDGET_ID = 'widgetUUID';
    expect(await svc.config(T)).toEqual({ disponivel: false, motivo: 'sem_widget' });
  });

  it('sem o iFood ligado na empresa (ou desligado): "sem_ifood" — a de OUTRA empresa não conta', async () => {
    expect(await svc.config(T)).toEqual({ disponivel: false, motivo: 'sem_ifood' });
    await integrar(OUTRA, randomUUID());
    expect(await svc.config(T)).toEqual({ disponivel: false, motivo: 'sem_ifood' });
    await integrar(T, randomUUID(), false);
    expect(await svc.config(T)).toEqual({ disponivel: false, motivo: 'sem_ifood' });
  });

  it('com o iFood ligado: o widget e a loja do iFood; várias ids separadas por vírgula, sem lixo, até 10', async () => {
    const m = randomUUID();
    await integrar(T, ` ${m} `);
    expect(await svc.config(T)).toEqual({ disponivel: true, widgetId: WIDGET, merchantIds: [m] });
    const varios = Array.from({ length: 12 }, () => randomUUID());
    await q(`update integracao set merchant_id = $2 where tenant_id = $1`, [T, `${varios[0]}, lixo,${varios.slice(1).join(',')}`]);
    const r: any = await svc.config(T);
    expect(r.merchantIds).toEqual(varios.slice(0, 10));
  });

  it('no SERVIDOR DA LOJA: pede à nuvem com o token do servidor; sem resposta, "sem_nuvem" (não "sem chat")', async () => {
    process.env.EDGE_MODE = 'true';
    delete process.env.CLOUD_API;
    expect(await svc.config(T)).toEqual({ disponivel: false, motivo: 'sem_nuvem' });
    process.env.CLOUD_API = 'https://nuvem.teste/api/v1/';
    process.env.SYNC_TOKEN = 'tok-loja';
    const pedidos: any[] = [];
    const fetchAntes = global.fetch;
    const m = randomUUID();
    let resposta: () => Promise<Response> = async () => new Response(JSON.stringify({ disponivel: true, widgetId: WIDGET, merchantIds: [m, 'lixo'] }), { status: 200 });
    global.fetch = (async (url: any, init: any) => {
      pedidos.push({ url: String(url), token: init?.headers?.['x-sync-token'] });
      return resposta();
    }) as any;
    try {
      expect(await svc.config(T)).toEqual({ disponivel: true, widgetId: WIDGET, merchantIds: [m] });
      expect(pedidos[0]).toEqual({ url: 'https://nuvem.teste/api/v1/atendimento/chat-ifood-da-loja', token: 'tok-loja' });
      resposta = async () => new Response(JSON.stringify({ disponivel: false, motivo: 'sem_widget' }), { status: 200 });
      expect(await svc.config(T)).toEqual({ disponivel: false, motivo: 'sem_widget' });
      resposta = async () => new Response('erro', { status: 502 });
      expect(await svc.config(T)).toEqual({ disponivel: false, motivo: 'sem_nuvem' });
      resposta = async () => {
        throw new Error('sem rede');
      };
      expect(await svc.config(T)).toEqual({ disponivel: false, motivo: 'sem_nuvem' });
    } finally {
      global.fetch = fetchAntes;
    }
  });
});
