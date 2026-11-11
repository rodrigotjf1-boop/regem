import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { TAXAS_PADRAO } from './taxas.regras';
import { TaxasService } from './taxas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "％ Taxas e margem" (R3 F5; mig 407) no Postgres de verdade: os valores de referência sem nada salvo, salvar (o que não
// veio fica; o número fora da faixa volta 400 com o campo; auditoria só quando muda), os números das vendas (itens por
// pedido e pagos na entrega da LOJA em 90 dias; o faturamento de 12 meses da EMPRESA só ao presidente) e o servidor da
// loja pedindo à nuvem.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('taxas-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIG = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '407_taxas_e_margem_por_loja.sql');

descrever('Taxas e margem da loja (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const auditados: any[] = [];
  const svc = new TaxasService(db, { registrar: async (e: any) => void auditados.push(e) } as any);
  const empresas: string[] = [];
  const presidente = { id: null, perfil: 'presidente' };
  const gerente = { id: null, perfil: 'gerente' };

  beforeAll(async () => {
    delete process.env.EDGE_MODE;
    const r = (await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(MIG, 'utf8'))))) as unknown as any[];
    const conferencia = (Array.isArray(r) ? r[r.length - 1] : r).rows;
    if (conferencia.length !== 2 || conferencia.some((l: any) => l.ok !== true)) throw new Error(`conferência da 407: ${JSON.stringify(conferencia)}`);
  });
  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['catalogo_taxas', 'comanda_item', 'pedido_externo', 'comanda', 'produto', 'colaborador', 'funcao', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });
  beforeEach(() => void (auditados.length = 0));

  async function empresa(lojas = 1) {
    const t = (await q(`insert into empresa (nome) values ('teste taxas e margem') returning id`))[0].id as string;
    empresas.push(t);
    const us: string[] = [];
    for (let i = 0; i < lojas; i++) us.push((await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [t, `Loja ${i + 1}`]))[0].id);
    return { t, lojas: us };
  }
  // Um pedido de app com N itens (comanda + itens) e se veio pago no app.
  async function pedido(t: string, u: string, canal: string, itens: number, pagoOnline: boolean, total = 50, diasAtras = 1, status = 'concluido') {
    const c = (await q(`insert into comanda (tenant_id, unidade_id, status, total, fechada_em) values ($1, $2, 'fechada', $3, now()) returning id`, [t, u, total]))[0].id;
    const p =
      (await q(`select id from produto where tenant_id = $1 limit 1`, [t]))[0]?.id ??
      (await q(`insert into produto (tenant_id, nome, preco_venda) values ($1, 'X', 10) returning id`, [t]))[0].id;
    await q(`insert into comanda_item (tenant_id, comanda_id, produto_id, descricao, quantidade, preco_unitario) values ($1, $2, $3, 'X', $4, 10)`, [t, c, p, itens]);
    await q(`insert into comanda_item (tenant_id, comanda_id, produto_id, descricao, quantidade, preco_unitario) values ($1, $2, null, 'obs', 5, 0)`, [t, c]);
    await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, status, total, valor_bruto, comanda_id, pago_online, criado_em)
       values ($1, $2, $3, $4, $5, $5, $6, $7, now() - make_interval(days => $8))`,
      [t, u, canal, status, total, c, pagoOnline, diasAtras],
    );
  }

  it('sem nada salvo: os valores de referência; uma empresa com duas lojas pede a loja', async () => {
    const e = await empresa();
    const r = await svc.ler(e.t, null, presidente);
    expect(r).toMatchObject({ loja: { id: e.lojas[0] }, taxas: TAXAS_PADRAO, salvas: false, atualizadoEm: null });
    expect(r.vendas).toMatchObject({ itensPorPedido: null, pedidos: 0, rbt12: 0, parteNaEntrega: { ifood: { pct: null, pedidos: 0 } }, dias: 90 });
    const duas = await empresa(2);
    await expect(svc.ler(duas.t, null, presidente)).rejects.toMatchObject({ status: 409, response: { code: 'ESCOLHA_A_LOJA' } });
  });

  it('salvar: o que não veio fica, o número fora da faixa volta 400 com o campo, auditoria só quando muda', async () => {
    const e = await empresa();
    const r = await svc.salvar(e.t, null, { taxas: { ifood: { loja: { com: '14,5' } }, geral: { margem: 22 } } }, presidente);
    expect(r).toMatchObject({ salvas: true, taxas: { ifood: { loja: { com: 14.5, pag: 3.2 } }, geral: { margem: 22, impostoModo: 'simples' } } });
    expect(r.atualizadoEm).toEqual(expect.any(String));
    expect(auditados).toEqual([expect.objectContaining({ acao: 'salvou_taxas_e_margem', unidadeId: e.lojas[0], detalhe: expect.objectContaining({ loja: 'Loja 1' }) })]);
    await svc.salvar(e.t, null, { geral: { margem: 22 } }, presidente); // nada mudou
    expect(auditados).toHaveLength(1);
    await expect(svc.salvar(e.t, null, { geral: { margem: 99 } }, presidente)).rejects.toMatchObject({ status: 400, response: { message: 'Margem (%): use um número de 0 a 90.' } });
    expect((await q(`select taxas -> 'geral' ->> 'margem' as m from catalogo_taxas where tenant_id = $1`, [e.t]))[0].m).toBe('22');
  });

  it('os números das vendas: itens por pedido e pagos na entrega da LOJA (90 dias); o faturamento da EMPRESA só ao presidente', async () => {
    const e = await empresa(2);
    await pedido(e.t, e.lojas[0], 'ifood', 2, true, 60);
    await pedido(e.t, e.lojas[0], 'ifood', 4, false, 40);
    await pedido(e.t, e.lojas[0], 'ifood', 3, false, 30);
    await pedido(e.t, e.lojas[0], '99food', 1, true, 20);
    await pedido(e.t, e.lojas[0], 'ifood', 9, false, 999, 120); // fora dos 90 dias
    await pedido(e.t, e.lojas[0], 'ifood', 9, false, 77, 1, 'cancelado'); // não vale
    await pedido(e.t, e.lojas[1], 'ifood', 7, false, 100); // outra loja
    // Balcão (não é de canal): entra no faturamento da empresa.
    await q(`insert into comanda (tenant_id, unidade_id, status, total, fechada_em) values ($1, $2, 'fechada', 500, now())`, [e.t, e.lojas[0]]);
    const r = await svc.ler(e.t, e.lojas[0], presidente);
    expect(r.vendas).toMatchObject({ pedidos: 4, itensPorPedido: 2.5, parteNaEntrega: { ifood: { pct: 66.7, pedidos: 3 }, '99food': { pct: 0, pedidos: 1 } } });
    // 12 meses, a empresa inteira: 60 + 40 + 30 + 20 + 999 (120 dias atrás) + 100 (loja 2) + 500 (balcão) — o cancelado fora.
    expect(r.vendas.rbt12).toBe(1749);
    const g = await svc.ler(e.t, e.lojas[0], gerente);
    expect(g.vendas).toMatchObject({ rbt12: null, rbt12Motivo: expect.stringMatching(/só aparece para o presidente/), pedidos: 4 });
  });

  it('vindo do servidor da loja: quem pediu tem de ser da gestão; o servidor de uma loja não vê outra; e o servidor pede à nuvem', async () => {
    const e = await empresa(2);
    const f = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Gerente', 'gerente') returning id`, [e.t]))[0].id;
    const ger = (await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, 'Gê', $2) returning id`, [e.t, f]))[0].id;
    await expect(svc.vindoDaLoja(e.t, e.lojas[0], 'GET', {})).rejects.toMatchObject({ status: 403 });
    await expect(svc.vindoDaLoja(e.t, e.lojas[0], 'GET', { atorId: ger, unidade: e.lojas[1] })).rejects.toMatchObject({ status: 403 });
    const r = await svc.vindoDaLoja(e.t, e.lojas[0], 'PUT', { atorId: ger, taxas: { geral: { margem: 15 } } });
    expect(r).toMatchObject({ tenantId: e.t, loja: { id: e.lojas[0] }, taxas: { geral: { margem: 15 } }, vendas: { rbt12: null } });

    // O servidor da loja: pede à nuvem (POST com quem agiu); sem conexão, 503; a recusa da nuvem volta como veio.
    const local = new TaxasService(db, { registrar: async () => undefined } as any);
    const pedidos: any[] = [];
    let resposta: () => Promise<Response> = async () => new Response(JSON.stringify({ tenantId: e.t, taxas: TAXAS_PADRAO, salvas: false }), { status: 200 });
    local.buscarNaNuvem = (async (url: any, init: any) => {
      pedidos.push({ url: String(url), corpo: JSON.parse(init.body) });
      return resposta();
    }) as any;
    const antes = { EDGE_MODE: process.env.EDGE_MODE, CLOUD_API: process.env.CLOUD_API, SYNC_TOKEN: process.env.SYNC_TOKEN };
    Object.assign(process.env, { EDGE_MODE: 'true', CLOUD_API: 'https://nuvem.teste/api/v1', SYNC_TOKEN: 'tk' });
    try {
      expect(await local.ler(e.t, e.lojas[0], { id: ger, perfil: 'gerente' })).toEqual({ taxas: TAXAS_PADRAO, salvas: false });
      expect(pedidos[0]).toEqual({ url: 'https://nuvem.teste/api/v1/catalogo/taxas/loja/ler', corpo: { unidade: e.lojas[0], atorId: ger } });
      resposta = async () => new Response(JSON.stringify({ statusCode: 400, message: 'Margem (%): use um número de 0 a 90.' }), { status: 400 });
      await expect(local.salvar(e.t, null, { geral: { margem: 95 } }, { id: ger, perfil: 'gerente' })).rejects.toMatchObject({ status: 400 });
      expect(pedidos[1]).toEqual({ url: 'https://nuvem.teste/api/v1/catalogo/taxas/loja', corpo: { geral: { margem: 95 }, unidade: null, atorId: ger } });
      resposta = async () => {
        throw new TypeError('fetch failed');
      };
      await expect(local.ler(e.t, null, { id: ger, perfil: 'gerente' })).rejects.toMatchObject({ status: 503 });
    } finally {
      for (const [k, v] of Object.entries(antes)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
