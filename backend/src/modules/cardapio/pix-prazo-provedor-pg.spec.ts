import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CardapioService } from './cardapio.service';
import { decidirPrazoPixDoProvedor } from './prazo-pix-provedor';
import { ESPERA_SEM_RESPOSTA_MS } from './prazo-pix-rede';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PRAZO DO PIX DO MERCADO PAGO E DO PAGBANK (ERR-454), no Postgres de verdade, com os dois provedores de mentira. O
// que se prova: o pedido PAGO cujo aviso nunca chegou ENTRA em vez de ser cancelado (era o defeito: dinheiro na conta da
// loja, pedido cancelado, sem estorno); o não pago é cancelado como sempre (e a cobrança do Mercado Pago também); com o
// provedor fora do ar o pedido espera até 1 h; a loja sem o token segue o prazo de antes; e a rotina não cruza com ela
// mesma. As conferências são pelo ESTADO do pedido no banco: no CI outra spec também chama esta rotina, e quem cancela
// pode ser ela (com o mesmo resultado em todos os casos daqui).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pix-prazo-provedor-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

describe('prazo do Pix com consulta ao provedor — a decisão', () => {
  const criado = new Date('2026-11-12T12:00:00.000Z');
  const aos = (min: number) => criado.getTime() + min * 60_000;
  it('pago aprova; não pago cancela; sem resposta espera até 1 h do pedido e então cancela', () => {
    expect(decidirPrazoPixDoProvedor(true, aos(11), criado)).toBe('aprovar');
    expect(decidirPrazoPixDoProvedor(true, aos(500), criado)).toBe('aprovar'); // pago é pago, a qualquer hora
    expect(decidirPrazoPixDoProvedor(false, aos(11), criado)).toBe('cancelar');
    expect(decidirPrazoPixDoProvedor(null, aos(11), criado)).toBe('esperar');
    expect(decidirPrazoPixDoProvedor(null, criado.getTime() + ESPERA_SEM_RESPOSTA_MS, criado)).toBe('esperar');
    expect(decidirPrazoPixDoProvedor(null, criado.getTime() + ESPERA_SEM_RESPOSTA_MS + 1, criado)).toBe('cancelar');
  });
});

descrever('prazo do Pix do Mercado Pago e do PagBank (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const empresas: string[] = [];
  const deliveryFalso = {
    aceitar: async () => undefined,
    // só mexe no pedido das empresas DESTA spec: a rotina passa por todas, e no CI as specs dividem o banco (V32)
    cancelarSistema: async (_t: string, id: string) => {
      await pool.query(`update pedido_externo set status = 'cancelado' where id = $1 and tenant_id = any($2::uuid[])`, [id, empresas]);
    },
  } as any;
  const u = {} as any;
  const cardapio = new CardapioService(db, u, deliveryFalso, u, u, u, u, u);
  const fetchAntes = global.fetch;
  const mpEnvAntes = process.env.MP_ACCESS_TOKEN;
  const edgeAntes = process.env.EDGE_MODE;

  // ===== os provedores de mentira: a situação de cada pagamento e o que foi chamado =====
  const situacao = new Map<string, 'pago' | 'pendente' | 'fora'>();
  const chamadas: { provedor: 'mp' | 'pagbank'; metodo: string; id: string }[] = [];
  let demoraMs = 0;
  const resp = (status: number, corpo: any) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

  beforeAll(() => {
    delete process.env.EDGE_MODE; // como NUVEM (a rotina não roda no servidor da loja)
    delete process.env.MP_ACCESS_TOKEN; // o token vem só da integração da loja
    global.fetch = (async (url: any, init: any) => {
      const caminho = new URL(String(url)).pathname;
      const metodo = init?.method ?? 'GET';
      const mp = caminho.match(/^\/v1\/payments\/([^/]+)$/);
      const pb = caminho.match(/^\/orders\/([^/]+)$/);
      if (!mp && !pb) throw new Error(`fetch inesperado: ${url}`);
      const id = (mp ?? pb)![1];
      chamadas.push({ provedor: mp ? 'mp' : 'pagbank', metodo, id });
      if (demoraMs) await new Promise((r) => setTimeout(r, demoraMs));
      const s = situacao.get(id);
      if (s === 'fora') throw new TypeError('fetch failed');
      if (!s) return resp(404, { message: 'not found' });
      if (mp) return metodo === 'PUT' ? resp(200, { id, status: 'cancelled' }) : resp(200, { id, status: s === 'pago' ? 'approved' : 'pending', external_reference: null });
      return resp(200, { id, reference_id: null, charges: [{ status: s === 'pago' ? 'PAID' : 'WAITING' }] });
    }) as any;
  });
  beforeEach(() => {
    chamadas.length = 0;
    demoraMs = 0;
  });
  afterAll(async () => {
    global.fetch = fetchAntes;
    for (const [k, v] of [['MP_ACCESS_TOKEN', mpEnvAntes], ['EDGE_MODE', edgeAntes]] as const)
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    if (empresas.length) {
      for (const t of ['pedido_externo', 'integracao', 'cardapio_config'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  /** Empresa com o cardápio no ar (aceite manual, para a aprovação não depender da produção) e os tokens pedidos. */
  async function loja(tokens: ('mercadopago' | 'pagseguro')[] = ['mercadopago', 'pagseguro']) {
    const t = (await q(`insert into empresa (nome) values ('teste prazo pix') returning id`))[0].id as string;
    empresas.push(t);
    await q(`insert into cardapio_config (tenant_id, token, ativo, auto_kds) values ($1, $2, true, false)`, [t, `tk-${randomUUID()}`]);
    for (const canal of tokens) await q(`insert into integracao (tenant_id, canal, ativo, token) values ($1, $2, true, 'token-de-teste')`, [t, canal]);
    return t;
  }
  /** Um pedido esperando o Pix, criado há `minutosAtras`, com o pagamento na situação dada (ou sem provedor). */
  async function aguardando(t: string, provedor: 'mercadopago' | 'pagseguro' | null, s: 'pago' | 'pendente' | 'fora' | null, minutosAtras: number) {
    const pagamento = provedor ? `pay-${randomUUID()}` : null;
    if (pagamento && s) situacao.set(pagamento, s);
    const r = await q(
      `insert into pedido_externo (tenant_id, canal, tipo, itens, total, status, status_pagamento, gateway_provider, gateway_payment_id, criado_em)
       values ($1, 'cardapio', 'retirada', '[]', 25, 'novo', 'aguardando', $2, $3, $4) returning id`,
      [t, provedor, pagamento, new Date(Date.now() - minutosAtras * 60_000)],
    );
    return { id: r[0].id as string, pagamento };
  }
  const ler = async (id: string) => (await q(`select status, pago, status_pagamento from pedido_externo where id = $1`, [id]))[0];
  const chamadasDe = (pagamento: string | null) => chamadas.filter((c) => c.id === pagamento).map((c) => `${c.provedor} ${c.metodo}`);

  it('Mercado Pago PAGO e o aviso nunca chegou: o prazo APROVA — o pedido entra, e a cobrança não é cancelada', async () => {
    const t = await loja();
    const p = await aguardando(t, 'mercadopago', 'pago', 12);
    await cardapio.expirarPixNaoPagos();
    expect(await ler(p.id)).toMatchObject({ status: 'novo', pago: true, status_pagamento: 'aprovado' });
    expect(chamadasDe(p.pagamento)).toEqual(['mp GET']); // perguntou; não mandou cancelar a cobrança
  });

  it('PagBank PAGO e o aviso nunca chegou: o prazo APROVA', async () => {
    const t = await loja();
    const p = await aguardando(t, 'pagseguro', 'pago', 12);
    await cardapio.expirarPixNaoPagos();
    expect(await ler(p.id)).toMatchObject({ status: 'novo', pago: true, status_pagamento: 'aprovado' });
    expect(chamadasDe(p.pagamento)).toEqual(['pagbank GET']);
  });

  it('não pago: cancela como sempre — no Mercado Pago, a cobrança também', async () => {
    const t = await loja();
    const mp = await aguardando(t, 'mercadopago', 'pendente', 12);
    const pb = await aguardando(t, 'pagseguro', 'pendente', 12);
    await cardapio.expirarPixNaoPagos();
    expect(await ler(mp.id)).toMatchObject({ status: 'cancelado', pago: false });
    expect(await ler(pb.id)).toMatchObject({ status: 'cancelado', pago: false });
    expect(chamadasDe(mp.pagamento)).toEqual(['mp GET', 'mp PUT']);
    expect(chamadasDe(pb.pagamento)).toEqual(['pagbank GET']);
  });

  it('provedor fora do ar: o pedido ESPERA; passada 1 h do pedido, cancela', async () => {
    const t = await loja();
    const mpRecente = await aguardando(t, 'mercadopago', 'fora', 12);
    const pbRecente = await aguardando(t, 'pagseguro', 'fora', 12);
    const mpAntigo = await aguardando(t, 'mercadopago', 'fora', 61);
    const pbAntigo = await aguardando(t, 'pagseguro', 'fora', 61);
    await cardapio.expirarPixNaoPagos();
    expect(await ler(mpRecente.id)).toMatchObject({ status: 'novo', pago: false, status_pagamento: 'aguardando' });
    expect(await ler(pbRecente.id)).toMatchObject({ status: 'novo', pago: false, status_pagamento: 'aguardando' });
    expect((await ler(mpAntigo.id)).status).toBe('cancelado');
    expect((await ler(pbAntigo.id)).status).toBe('cancelado');
  });

  it('loja sem o token do provedor: não tem como perguntar — vale o prazo, como antes', async () => {
    const t = await loja([]);
    const mp = await aguardando(t, 'mercadopago', 'pago', 12);
    const pb = await aguardando(t, 'pagseguro', 'pago', 12);
    await cardapio.expirarPixNaoPagos();
    expect((await ler(mp.id)).status).toBe('cancelado');
    expect((await ler(pb.id)).status).toBe('cancelado');
    expect(chamadasDe(mp.pagamento)).toEqual([]);
    expect(chamadasDe(pb.pagamento)).toEqual([]);
  });

  it('o que não é destes provedores segue igual: sem cobrança no provedor, vencido cancela; dentro do prazo, fica', async () => {
    const t = await loja();
    const semProvedor = await aguardando(t, null, null, 12);
    const noPrazo = await aguardando(t, 'mercadopago', 'pago', 5);
    await cardapio.expirarPixNaoPagos();
    expect((await ler(semProvedor.id)).status).toBe('cancelado');
    expect(await ler(noPrazo.id)).toMatchObject({ status: 'novo', pago: false, status_pagamento: 'aguardando' }); // ainda nem venceu: a rotina não olha
    expect(chamadasDe(noPrazo.pagamento)).toEqual([]);
  });

  it('uma volta por vez: com o provedor lento, a segunda chamada sai sem consultar de novo', async () => {
    const t = await loja();
    const p = await aguardando(t, 'mercadopago', 'pago', 12);
    demoraMs = 300;
    await Promise.all([cardapio.expirarPixNaoPagos(), cardapio.expirarPixNaoPagos()]);
    expect(chamadasDe(p.pagamento)).toEqual(['mp GET']);
    expect(await ler(p.id)).toMatchObject({ pago: true, status_pagamento: 'aprovado' });
    await cardapio.expirarPixNaoPagos(); // a trava soltou: a volta seguinte roda (e não há mais o que fazer neste pedido)
    expect(chamadasDe(p.pagamento)).toEqual(['mp GET']);
  });
});
