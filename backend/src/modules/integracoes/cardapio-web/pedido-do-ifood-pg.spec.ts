import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema';
import { CardapioWebService, ehPedidoDoIfood } from './cardapio-web.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO DO iFOOD QUE O CARDÁPIO WEB TAMBÉM DEVOLVE (decisão do dono, 16/11/2026) — contra Postgres (TEST_PG_URL).
// A consulta do Cardápio Web devolve os pedidos que ele recebeu do iFood (`sales_channel: 'ifood'`). Com o iFood ligado
// DIRETO no Regem para a mesma loja, o pedido chegaria duas vezes e viraria duas vendas: não entra pelo Cardápio Web.
// A ingestão (`delivery.ingest`) e a busca do detalhe (`pedido`, chamada à API de fora) são simuladas; a decisão lê o
// banco de verdade.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pedido-do-ifood-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

descrever('o pedido do iFood que o Cardápio Web devolve (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const T = randomUUID();
  let lojaA: string;
  let lojaB: string;
  const WEBHOOK = `wh-${randomUUID()}`;
  const ingest = jest.fn(async () => ({}));
  const refletir = jest.fn(async () => 'ignorado');
  const svc = new CardapioWebService(db, { ingest, refletirStatusExterno: refletir } as any);
  // O detalhe de cada pedido, como a API do Cardápio Web devolveria.
  const detalhes: Record<string, any> = {};
  const detalhe = jest.spyOn(svc, 'pedido').mockImplementation(async (_t: string, id: string) => detalhes[id] ?? null);
  const ingerir = (unidade: string | null, lite: any[]) => (svc as any).ingerirLista(T, unidade, lite) as Promise<{ n: number; falhas: number }>;
  const entraram = () => ingest.mock.calls.map((c: any[]) => String(c[3].id)).sort();
  const pedidoCw = (id: string, canal: string) => {
    detalhes[id] = { id, sales_channel: canal, status: 'confirmed', items: [], payments: [] };
    return { id, sales_channel: canal, status: 'confirmed' };
  };
  const ifoodDireto = async (unidade: string | null, ativo = true) =>
    q(`insert into integracao (tenant_id, unidade_id, canal, ativo) values ($1, $2, 'ifood', $3)`, [T, unidade, ativo]);
  const semIfoodDireto = () => q(`delete from integracao where tenant_id = $1 and canal = 'ifood'`, [T]);

  beforeAll(async () => {
    await q(`insert into empresa (id, nome) values ($1, 'teste pedido do iFood pelo Cardápio Web')`, [T]);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: lojaB }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja B') returning id`, [T]);
    // A integração do Cardápio Web da loja A, ligada, com o token do aviso (para o webhook achar a empresa).
    await q(
      `insert into integracao (tenant_id, unidade_id, canal, ativo, token, config) values ($1, $2, 'cardapio_web', true, 'tk', $3::jsonb)`,
      [T, lojaA, JSON.stringify({ webhookToken: WEBHOOK, env: 'sandbox' })],
    );
  });
  afterAll(async () => {
    detalhe.mockRestore();
    for (const t of ['pedido_externo', 'integracao', 'unidade']) await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => undefined);
    await q(`delete from empresa where id = $1`, [T]).catch(() => undefined);
    await pool.end();
  });
  beforeEach(async () => {
    ingest.mockClear();
    detalhe.mockClear();
    await semIfoodDireto();
  });

  it('reconhece a origem pelo `sales_channel` da documentação, e só o iFood', () => {
    expect(ehPedidoDoIfood({ sales_channel: 'ifood' })).toBe(true);
    expect(ehPedidoDoIfood({ sales_channel: ' IFOOD ' })).toBe(true);
    for (const outro of ['catalog', 'store_front_catalog', 'portal', 'whatsapp_extension', '', undefined, null])
      expect(ehPedidoDoIfood({ sales_channel: outro })).toBe(false);
    expect(ehPedidoDoIfood(null)).toBe(false);
  });

  it('com o iFood ligado direto na loja: o pedido do iFood não entra (nem busca o detalhe) e o do cardápio entra', async () => {
    await ifoodDireto(lojaA);
    const r = await ingerir(lojaA, [pedidoCw('101', 'ifood'), pedidoCw('102', 'catalog'), pedidoCw('103', 'whatsapp_extension')]);
    expect(entraram()).toEqual(['102', '103']);
    expect(r).toEqual({ n: 2, falhas: 0 }); // o barrado não é falha: o cursor anda
    expect(detalhe.mock.calls.map((c) => c[1]).sort()).toEqual(['102', '103']);
  });

  it('com o iFood ligado direto SEM loja (a empresa toda): também não entra', async () => {
    await ifoodDireto(null);
    await ingerir(lojaA, [pedidoCw('111', 'ifood')]);
    expect(entraram()).toEqual([]);
  });

  it('sem o iFood direto, ou com ele desligado, o pedido do iFood entra pelo Cardápio Web como sempre', async () => {
    await ingerir(lojaA, [pedidoCw('121', 'ifood')]);
    expect(entraram()).toEqual(['121']);
    ingest.mockClear();
    await ifoodDireto(lojaA, false);
    await ingerir(lojaA, [pedidoCw('122', 'ifood')]);
    expect(entraram()).toEqual(['122']);
  });

  it('o iFood direto de OUTRA loja não barra o pedido do iFood desta', async () => {
    await ifoodDireto(lojaB);
    await ingerir(lojaA, [pedidoCw('131', 'ifood')]);
    expect(entraram()).toEqual(['131']);
  });

  it('a lista sem a origem: a guarda confere pelo detalhe', async () => {
    await ifoodDireto(lojaA);
    detalhes['141'] = { id: '141', sales_channel: 'ifood', status: 'confirmed' };
    detalhes['142'] = { id: '142', sales_channel: 'portal', status: 'confirmed' };
    const r = await ingerir(lojaA, [{ id: '141', status: 'confirmed' }, { id: '142', status: 'confirmed' }]);
    expect(entraram()).toEqual(['142']);
    expect(r).toEqual({ n: 1, falhas: 0 });
  });

  it('o pedido do iFood que JÁ entrou pelo Cardápio Web segue sendo acompanhado', async () => {
    await q(`insert into pedido_externo (tenant_id, unidade_id, canal, external_id, status) values ($1, $2, 'cardapio_web', '151', 'confirmado')`, [T, lojaA]);
    await ifoodDireto(lojaA);
    const lite = pedidoCw('151', 'ifood');
    detalhes['151'].status = 'closed';
    await ingerir(lojaA, [{ ...lite, status: 'closed' }]);
    expect(entraram()).toEqual(['151']);
    expect(refletir).toHaveBeenCalledWith(T, 'cardapio_web', '151', 'concluido');
  });

  it('o aviso (webhook) segue a mesma regra e responde "tratado" ao barrar', async () => {
    await ifoodDireto(lojaA);
    pedidoCw('161', 'ifood');
    pedidoCw('162', 'catalog');
    expect(await svc.processarWebhook(WEBHOOK, '161')).toEqual({ ok: true });
    expect(entraram()).toEqual([]);
    expect(await svc.processarWebhook(WEBHOOK, '162')).toEqual({ ok: true });
    expect(entraram()).toEqual(['162']);
  });
});
