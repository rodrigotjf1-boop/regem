import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { entrega99, modoEntrega, SEM_LOGISTICA_DO_CANAL } from './modo-entrega';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Quem entrega o pedido — a regra única do backend (antes só o app e o painel sabiam).
const IFOOD_LOJA = { delivery: { deliveredBy: 'MERCHANT' } };
const IFOOD_PLATAFORMA = { delivery: { deliveredBy: 'IFOOD' } };
const DE99_LOJA = {
  delivery_type: 2,
  receive_address: { locator: '56244631', handover_page_url: 'https://food-b-h5.99app.com/pt-BR/v2/confirmation-entrega' },
};
const DE99_PLATAFORMA = { delivery_type: 1 };

describe('modo de entrega', () => {
  it('iFood e 99: entrega da loja × entregador da plataforma × retirada', () => {
    expect(modoEntrega({ canal: 'ifood', tipo: 'entrega', raw: IFOOD_LOJA })).toBe('propria_canal');
    expect(modoEntrega({ canal: 'ifood', tipo: 'entrega', raw: IFOOD_PLATAFORMA })).toBe('logistica_canal');
    expect(modoEntrega({ canal: 'ifood', tipo: 'entrega', raw: { delivery: { deliveredBy: 'ifood' } } })).toBe('logistica_canal');
    expect(modoEntrega({ canal: '99food', tipo: 'entrega', raw: DE99_LOJA })).toBe('propria_canal');
    expect(modoEntrega({ canal: '99food', tipo: 'entrega', raw: DE99_PLATAFORMA })).toBe('logistica_canal');
    expect(modoEntrega({ canal: '99food', tipo: 'entrega', raw: { delivery_type: '1' } })).toBe('logistica_canal');
    expect(modoEntrega({ canal: '99food', tipo: 'entrega', raw: { fulfillment_mode: 1, delivery_type: 2 } })).toBe('retirada');
    expect(modoEntrega({ canal: '99food', tipo: 'entrega', raw: { delivery_type: 0 } })).toBe('retirada');
    expect(modoEntrega({ canal: 'ifood', tipo: 'retirada', raw: IFOOD_LOJA })).toBe('retirada');
  });

  it('sem o campo no pedido, iFood/99 contam como entrega da loja (quem tem o pedido na mão entrega)', () => {
    expect(modoEntrega({ canal: 'ifood', tipo: 'entrega', raw: null })).toBe('propria_canal');
    expect(modoEntrega({ canal: 'ifood', tipo: 'entrega', raw: {} })).toBe('propria_canal');
    expect(modoEntrega({ canal: '99food', tipo: 'entrega', raw: {} })).toBe('propria_canal');
    // raw guardado como texto
    expect(modoEntrega({ canal: 'ifood', tipo: 'entrega', raw: JSON.stringify(IFOOD_PLATAFORMA) })).toBe('logistica_canal');
  });

  it('os outros canais são entrega da loja (código de 4 dígitos do Regem)', () => {
    for (const canal of ['cardapio', 'anotaai', 'cardapioweb', 'pdv', 'opendelivery', 'totem', ''])
      expect(modoEntrega({ canal, tipo: 'entrega', raw: IFOOD_PLATAFORMA })).toBe('propria_loja');
    expect(modoEntrega({ canal: 'cardapio', tipo: 'retirada' })).toBe('retirada');
  });

  it('plano B da 99: localizador e página só com https', () => {
    expect(entrega99(DE99_LOJA)).toEqual({
      localizador: '56244631',
      pagina: 'https://food-b-h5.99app.com/pt-BR/v2/confirmation-entrega',
    });
    expect(entrega99({ receive_address: { locator: '', handover_page_url: 'javascript:alert(1)' } })).toEqual({
      localizador: null,
      pagina: null,
    });
    expect(entrega99(null)).toEqual({ localizador: null, pagina: null });
  });
});

// O filtro SQL da fila tem de dizer o MESMO que `modoEntrega` (V6: SQL em string contra o banco).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('modo-entrega.spec: sem TEST_PG_URL — filtro da fila contra o Postgres PULADO');

descrever('fila do entregador: tira o pedido da logística do canal (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  let tenant = '';

  const casos: { nome: string; canal: string; raw: any; entra: boolean }[] = [
    { nome: 'ifood-loja', canal: 'ifood', raw: IFOOD_LOJA, entra: true },
    { nome: 'ifood-plataforma', canal: 'ifood', raw: IFOOD_PLATAFORMA, entra: false },
    { nome: 'ifood-minusculo', canal: 'ifood', raw: { delivery: { deliveredBy: 'ifood' } }, entra: false },
    { nome: 'ifood-sem-campo', canal: 'ifood', raw: null, entra: true },
    { nome: '99-loja', canal: '99food', raw: DE99_LOJA, entra: true },
    { nome: '99-plataforma', canal: '99food', raw: DE99_PLATAFORMA, entra: false },
    { nome: '99-plataforma-texto', canal: '99food', raw: { delivery_type: '1' }, entra: false },
    { nome: 'cardapio', canal: 'cardapio', raw: IFOOD_PLATAFORMA, entra: true },
  ];

  beforeAll(async () => {
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste modo de entrega') returning id`)).rows[0].id;
    for (const c of casos)
      await pool.query(
        `insert into pedido_externo (tenant_id, canal, external_id, status, tipo, cliente_nome, itens, total, raw)
         values ($1, $2, $3, 'pronto', 'entrega', $4, '[]'::jsonb, 10, $5::jsonb)`,
        [tenant, c.canal, randomUUID(), c.nome, c.raw == null ? null : JSON.stringify(c.raw)],
      );
  });

  afterAll(async () => {
    if (tenant) {
      await pool.query('delete from pedido_externo where tenant_id = $1', [tenant]);
      await pool.query('delete from empresa where id = $1', [tenant]);
    }
    await pool.end();
    // Apagar a empresa percorre todas as tabelas filhas: com a suíte inteira rodando, passa dos
    // 5 s padrão do gancho (visto em 09/10/2026 — os 5 testes passam, a limpeza estourava).
  }, 60_000);

  it('só os pedidos que a loja entrega ficam na fila — igual à regra do app', async () => {
    const r: any = await db.execute(sql`
      select cliente_nome, canal, tipo, raw from pedido_externo
       where tenant_id = ${tenant} and status = 'pronto' and ${SEM_LOGISTICA_DO_CANAL}`);
    const naFila = (r.rows ?? r).map((x: any) => x.cliente_nome).sort();
    expect(naFila).toEqual(casos.filter((c) => c.entra).map((c) => c.nome).sort());
    // e cada um que ficou é, pela regra pura, entrega da loja
    for (const x of r.rows ?? r) expect(modoEntrega(x)).not.toBe('logistica_canal');
  });
});
