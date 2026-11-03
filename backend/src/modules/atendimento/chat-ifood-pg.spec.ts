import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { AJUSTE_IFOOD_PADRAO, ChatIfoodService, lerAjusteIfood } from './chat-ifood.service';

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
      // a loja desligou o chat (ajuste): o servidor da loja repassa "desligado", não "sem chat"
      resposta = async () => new Response(JSON.stringify({ disponivel: false, motivo: 'desligado' }), { status: 200 });
      expect(await svc.config(T)).toEqual({ disponivel: false, motivo: 'desligado' });
    } finally {
      global.fetch = fetchAntes;
    }
  });

  it('o que a tela manda no grupo do iFood: liga/desliga só com booleano (V15), 1/2/3 min, ausente fica de fora (V16)', () => {
    expect(lerAjusteIfood({ chat: false, avisarDisputa: true, avisarDeNovoMin: 3 })).toEqual({ chat: false, avisarDisputa: true, avisarDeNovoMin: 3 });
    expect(lerAjusteIfood({})).toEqual({});
    expect(() => lerAjusteIfood({ chat: 'nao' })).toThrow('chat');
    expect(() => lerAjusteIfood({ avisarDisputa: 1 })).toThrow('avisarDisputa');
    for (const ruim of [0, 4, '2', null]) expect(() => lerAjusteIfood({ avisarDeNovoMin: ruim })).toThrow('Avisar de novo: escolha 1, 2 ou 3 minutos.');
  });

  it('os ajustes: padrão; grava SÓ a própria chave (o token e o resto da config ficam — V82); auditado; sem iFood, recusa', async () => {
    const auditados: any[] = [];
    const comAuditoria = new ChatIfoodService(drizzle(pool, { schema }) as any, { registrar: async (a: any) => void auditados.push(a) } as any);
    const user = { tenantId: T, colaboradorId: null, categoria: 'gerente' } as any;
    expect(await comAuditoria.ajustes(T)).toEqual({ conectadoIfood: false, ajusteIfood: null, minutosDeNovo: [1, 2, 3] });
    await expect(comAuditoria.salvarAjustes(user, { chat: false })).rejects.toThrow('O iFood não está conectado nesta empresa.');
    await q(`insert into integracao (tenant_id, canal, ativo, merchant_id, config) values ($1, 'ifood', true, $2, $3)`, [
      T,
      randomUUID(),
      JSON.stringify({ accessToken: 'tok-guardado', pollingCursor: 7 }),
    ]);
    expect((await comAuditoria.ajustes(T)).ajusteIfood).toEqual(AJUSTE_IFOOD_PADRAO);
    expect((await comAuditoria.salvarAjustes(user, { avisarDeNovoMin: 3 })).ajusteIfood).toEqual({ ...AJUSTE_IFOOD_PADRAO, avisarDeNovoMin: 3 });
    expect((await comAuditoria.salvarAjustes(user, { chat: false })).ajusteIfood).toEqual({ chat: false, avisarDisputa: true, avisarDeNovoMin: 3 });
    const [{ config }] = await q(`select config from integracao where tenant_id = $1 and canal = 'ifood'`, [T]);
    expect(config).toEqual({ accessToken: 'tok-guardado', pollingCursor: 7, atendimentoIfood: { avisarDeNovoMin: 3, chat: false } });
    expect(auditados.map((a) => a.acao)).toEqual(['ajustou_atendimento_ifood', 'ajustou_atendimento_ifood']);
    expect(auditados[1].detalhe).toEqual({ de: { ...AJUSTE_IFOOD_PADRAO, avisarDeNovoMin: 3 }, para: { chat: false, avisarDisputa: true, avisarDeNovoMin: 3 } });
    // nada mudou: nem grava, nem audita
    await comAuditoria.salvarAjustes(user, {});
    expect(auditados).toHaveLength(2);
  });

  it('o chat desligado pela loja não aparece ("desligado", não "sem chat"); os avisos da disputa seguem o ajuste', async () => {
    await q(`insert into integracao (tenant_id, canal, ativo, merchant_id, config) values ($1, 'ifood', true, $2, $3)`, [
      T,
      randomUUID(),
      JSON.stringify({ atendimentoIfood: { chat: false, avisarDisputa: false, avisarDeNovoMin: 1 } }),
    ]);
    expect(await svc.config(T)).toEqual({ disponivel: false, motivo: 'desligado' });
    expect(await svc.avisos(T)).toEqual({ disputa: { avisar: false, deNovoMin: 1 } });
    // sem integração (ou valor torto): os padrões
    expect(await svc.avisos(OUTRA)).toEqual({ disputa: { avisar: true, deNovoMin: 2 } });
    await q(`update integracao set config = $2 where tenant_id = $1`, [T, JSON.stringify({ atendimentoIfood: { chat: 'sim', avisarDeNovoMin: 9 } })]);
    expect(await svc.avisos(T)).toEqual({ disputa: { avisar: true, deNovoMin: 2 } });
    expect((await svc.config(T)).disponivel).toBe(true);
    // no servidor da loja não há a integração: os padrões, sem ler o banco (mesmo com um ajuste gravado aqui)
    await q(`update integracao set config = $2 where tenant_id = $1`, [T, JSON.stringify({ atendimentoIfood: { avisarDisputa: false, avisarDeNovoMin: 1 } })]);
    process.env.EDGE_MODE = 'true';
    expect(await svc.avisos(T)).toEqual({ disputa: { avisar: true, deNovoMin: 2 } });
  });
});
