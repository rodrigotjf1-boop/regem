import { readFileSync } from 'fs';
import { join } from 'path';
import { randomBytes, randomUUID } from 'crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../../db/schema';
import { comTravaDaEmpresa, repetirNaCorridaDeCatalogo } from '../../../common/corrida-de-catalogo';
import { MODULO_PRECOS_NA_99 } from '../../../common/precos-na-99';
import { PrecosNa99Service } from '../../distribuicao/precos-na-99.service';
import { DeliveryService } from '../../delivery/delivery.service';
import { Food99Service } from './food99.service';
import { Food99CatalogoEnvioService } from './food99-catalogo-envio.service';
import { Food99LojaController } from './food99-loja.controller';
import { desfechoDoErrno, grupoParaAtualizar, gruposComOItem, itemParaAtualizar, recuoMinutos99 } from './food99-catalogo.regras';
import { envioDa99ParaTela, enviosDa99 } from './food99-envios';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A 99 ITEM A ITEM (R3 da Gestão do catálogo, fase F2; migs 401 e 402): a fila gravada pelos GATILHOS do banco e o
// despacho pela API da 99 (docs 1961, 1967 e 1969), contra Postgres (TEST_PG_URL), com uma 99 falsa. As regras puras e
// as chamadas HTTP (o corpo que SAI, conferido contra a doc — V20) sem banco.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('food99-catalogo-envio.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(180_000);

const MIGRATION_402 = join(__dirname, '..', '..', '..', '..', '..', 'database', 'migrations', '402_food99_envio.sql');
const MIGRATION_404 = join(__dirname, '..', '..', '..', '..', '..', 'database', 'migrations', '404_food99_envio_opcao.sql');

// O item como a doc 1961 ("Get Store Menu Details") devolve, com os campos que a doc 1967 aceita de volta.
const ITEM_DA_99 = {
  app_item_id: '2051',
  app_external_id: '{"pdv":"x"}',
  item_name: 'X-Bacon da 99',
  short_desc: 'Descrição de lá',
  head_img: 'https://imgurl.host/static/xbacon.jpg',
  sold_info_intl: [{ time: [{ begin: '10:00', end: '23:00' }], day: [1, 2, 3, 4, 5, 6, 7] }],
  price: 4490,
  activity_price: 3990,
  priority: 3,
  status: 1,
  is_sold_separately: true,
  app_modifier_group_ids: ['mg1'],
};
// Os campos do corpo do "Update One Item" (doc 1967, "Request Body Parameters"), fora o auth_token.
const CAMPOS_DA_DOC_1967 = [
  'app_item_id', 'app_external_id', 'item_name', 'short_desc', 'sold_info_intl', 'head_img', 'price', 'activity_price',
  'priority', 'status', 'is_sold_separately',
];

describe('regras do envio à 99 (sem banco)', () => {
  it('updateItem: o item INTEIRO como a 99 tem, com o preço do Regem por cima — sem promoção nem grupo de complementos', () => {
    const corpo = itemParaAtualizar(ITEM_DA_99, { preco: 4990 });
    expect(corpo).toEqual({
      app_item_id: '2051',
      app_external_id: '{"pdv":"x"}',
      item_name: 'X-Bacon da 99',
      short_desc: 'Descrição de lá',
      head_img: 'https://imgurl.host/static/xbacon.jpg',
      sold_info_intl: ITEM_DA_99.sold_info_intl,
      price: 4990,
      priority: 3,
      status: 1,
      is_sold_separately: true,
    });
    // Só campos da doc; os quatro obrigatórios sempre; preço inteiro em centavos.
    expect(Object.keys(corpo).every((k) => CAMPOS_DA_DOC_1967.includes(k))).toBe(true);
    for (const k of ['app_item_id', 'item_name', 'price', 'status', 'is_sold_separately']) expect(corpo).toHaveProperty(k);
    expect(Number.isInteger(corpo.price)).toBe(true);
    expect(corpo).not.toHaveProperty('activity_price');
  });
  it('updateItem: nome e descrição do Regem; descrição vazia vai vazia; item pausado lá segue pausado', () => {
    expect(itemParaAtualizar({ ...ITEM_DA_99, status: 2 }, { nome: 'X-Bacon Duplo', descricao: '' })).toMatchObject({
      item_name: 'X-Bacon Duplo',
      short_desc: '',
      price: 4490,
      status: 2,
    });
    // Sem descrição lá e nada a mudar nela: não vai o campo.
    const semDesc = itemParaAtualizar({ app_item_id: 7, item_name: 'A', price: 100, status: 1 }, { preco: 200 });
    expect(semDesc).toEqual({ app_item_id: '7', item_name: 'A', price: 200, status: 1, is_sold_separately: true });
  });
  it('o errno da 99: 0 aplica; sem resposta, sem token, erro de sistema e autorização expirada tentam de novo; o resto é recusa', () => {
    expect(desfechoDoErrno(0, 'ok')).toMatchObject({ resultado: 'aplicado', repetir: false });
    for (const e of [-1, -2, -3, 10000, 10001, 10102]) expect(desfechoDoErrno(e, null).repetir).toBe(true);
    expect(desfechoDoErrno(10002, 'Parameter error.')).toMatchObject({
      resultado: 'recusado',
      repetir: false,
      resposta: { errno: 10002, frase: 'A 99 respondeu: Parameter error.' },
    });
    expect([1, 2, 3, 4, 5, 6, 9].map(recuoMinutos99)).toEqual([1, 2, 5, 10, 30, 60, 60]);
  });
  it('a tela: o motivo do "não enviado", a frase da recusa e o "tentando de novo"', () => {
    const base = { integracao_id: 'i1', loja: 'Loja 1', tipo: 'preco_item', tentativas: 0, quando: '2026-11-11T12:00:00Z' };
    expect(envioDa99ParaTela({ ...base, situacao: 'pendente', tentativas: 2 })).toMatchObject({ situacao: 'na_fila', frase: /tenta de novo/ });
    expect(envioDa99ParaTela({ ...base, situacao: 'feito', resultado: 'dispensado', resposta: { motivo: 'produto sem código PDV' } })).toMatchObject({
      situacao: 'nao_enviado',
      frase: 'produto sem código PDV',
    });
    expect(envioDa99ParaTela({ ...base, situacao: 'feito', resultado: 'aplicado', resposta: { antes: 44.9, depois: 49.9 } })).toMatchObject({
      unidadeId: 'i1',
      oQue: 'preco',
      situacao: 'aplicado',
      antes: 44.9,
      depois: 49.9,
    });
    expect(envioDa99ParaTela({ ...base, tipo: 'cadastro_item', situacao: 'desistiu' })).toMatchObject({ oQue: 'cadastro', situacao: 'desistiu' });
  });
  it('updateModifierGroup (doc 1971): o grupo INTEIRO como a 99 tem, só o preço da opção do código trocado', () => {
    // O grupo como a doc 1961 devolve (modifier_groups), com o campo livre do PDV.
    const g = {
      app_modifier_group_id: 'mg4',
      modifier_group_name: 'mg4',
      app_external_id: '{"k":"v"}',
      is_required: 1,
      quantity_min_permitted: 1,
      quantity_max_permitted: 1,
      buy_mode: 0,
      app_mg_items: [{ app_item_id: 'item_in_mg4', price: 0 }, { app_item_id: 'A01', price: 300 }, { app_item_id: 'sem_preco' }],
    };
    const corpo = grupoParaAtualizar(g, 'A01', 450);
    expect(corpo).toEqual({
      modifier_group_name: 'mg4',
      app_modifier_group_id: 'mg4',
      app_external_id: '{"k":"v"}',
      is_required: 1,
      quantity_min_permitted: 1,
      quantity_max_permitted: 1,
      buy_mode: 0,
      app_mg_items: [{ app_item_id: 'item_in_mg4', price: 0 }, { app_item_id: 'A01', price: 450 }, { app_item_id: 'sem_preco' }],
    });
    // Só campos da doc 1971 (fora o auth_token); os dois obrigatórios além do id sempre.
    const DOC_1971 = ['modifier_group_name', 'app_modifier_group_id', 'app_external_id', 'is_required', 'quantity_min_permitted', 'quantity_max_permitted', 'buy_mode', 'app_mg_items'];
    expect(Object.keys(corpo).every((k) => DOC_1971.includes(k))).toBe(true);
    expect(grupoParaAtualizar({ app_modifier_group_id: 7, app_mg_items: [] }, 'x', 1)).toEqual({ modifier_group_name: '', app_modifier_group_id: '7', buy_mode: 0, app_mg_items: [] });
    // Os grupos que têm a opção.
    expect(gruposComOItem([g, { app_mg_items: [{ app_item_id: 'B' }] }, null, { app_mg_items: 'x' }], 'A01')).toEqual([g]);
  });
});

describe('as chamadas à 99 (o corpo que sai, contra a doc — V20)', () => {
  const svc = new Food99Service(null as any, null as any);
  const ig = { id: 'ig', tenantId: 't', unidadeId: null, appId: 'a', appSecret: 's', appShopId: 'shop', token: 'tk-1', config: { tokenExp: Date.now() + 3_600_000 } } as any;
  const original = global.fetch;
  let pedidos: { url: string; metodo: string; corpo: any }[] = [];
  let respostas: any[] = [];
  beforeEach(() => {
    pedidos = [];
    respostas = [];
    global.fetch = (async (url: any, init: any) => {
      pedidos.push({ url: String(url), metodo: init?.method ?? 'GET', corpo: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify(respostas.shift() ?? { errno: 0, errmsg: 'ok', data: {} }), { status: 200 });
    }) as typeof fetch;
  });
  afterAll(() => {
    global.fetch = original;
  });

  it('Get Store Menu Details: GET /v3/item/item/list com o auth_token na URL; devolve os itens por app_item_id', async () => {
    respostas.push({ errno: 0, errmsg: 'ok', data: { menus: [], categories: [], items: [ITEM_DA_99, { app_item_id: 9, item_name: 'B' }], modifier_groups: [] } });
    const r = await svc.itensDoCardapio(ig);
    expect(pedidos[0]).toMatchObject({ metodo: 'GET', corpo: null });
    expect(pedidos[0].url).toMatch(/\/v3\/item\/item\/list\?auth_token=tk-1$/);
    expect(r.errno).toBe(0);
    expect([...r.itens.keys()]).toEqual(['2051', '9']);
    // Sem a lista que a doc promete: não diz "não existe" — é falha (tenta de novo).
    respostas.push({ errno: 0, errmsg: 'ok', data: {} });
    expect((await svc.itensDoCardapio(ig)).errno).toBe(-3);
  });
  it('a leitura traz também os grupos de complementos (modifier_groups); Update Modifier Group: POST com o grupo no corpo', async () => {
    const mg = { app_modifier_group_id: 'mg1', modifier_group_name: 'mg1', buy_mode: 0, app_mg_items: [{ app_item_id: 'A01', price: 100 }] };
    respostas.push({ errno: 0, errmsg: 'ok', data: { items: [], modifier_groups: [mg] } });
    expect((await svc.itensDoCardapio(ig)).grupos).toEqual([mg]);
    const corpo = grupoParaAtualizar(mg, 'A01', 250);
    expect(await svc.atualizarGrupo(ig, corpo)).toEqual({ errno: 0, errmsg: 'ok' });
    expect(pedidos[1].url).toMatch(/\/v3\/item\/item\/updateModifierGroup$/);
    expect(pedidos[1].metodo).toBe('POST');
    expect(pedidos[1].corpo).toEqual({ auth_token: 'tk-1', ...corpo });
  });
  it('Update One Item: POST /v3/item/item/updateItem com o auth_token e o item no corpo, como o exemplo da doc', async () => {
    const corpo = itemParaAtualizar(ITEM_DA_99, { preco: 4990 });
    expect(await svc.atualizarItem(ig, corpo)).toEqual({ errno: 0, errmsg: 'ok' });
    expect(pedidos[0].url).toMatch(/\/v3\/item\/item\/updateItem$/);
    expect(pedidos[0].metodo).toBe('POST');
    expect(pedidos[0].corpo).toEqual({ auth_token: 'tk-1', ...corpo });
  });
  it('Update Item Status: POST /v3/item/item/updateItemStatus {auth_token, app_item_ids, status}; o que deu certo e o que não', async () => {
    respostas.push({ errno: 0, errmsg: 'ok', data: { success: ['2051'], failed: ['77'] } });
    const r = await svc.situacaoDosItens(ig, ['2051', '77'], 2);
    expect(pedidos[0].url).toMatch(/\/v3\/item\/item\/updateItemStatus$/);
    expect(pedidos[0].corpo).toEqual({ auth_token: 'tk-1', app_item_ids: ['2051', '77'], status: 2 });
    expect(r).toEqual({ errno: 0, errmsg: 'ok', sucesso: ['2051'], falha: ['77'] });
  });
  it('autorização expirada (10102): pega um token novo e tenta UMA vez mais; sem resposta da 99 = -1', async () => {
    const espia = jest.spyOn(svc as any, 'authToken').mockResolvedValueOnce('tk-velho').mockResolvedValueOnce('tk-novo');
    respostas.push({ errno: 10102, errmsg: 'The shop authorization info has expired.' }, { errno: 0, errmsg: 'ok' });
    expect(await svc.atualizarItem(ig, { app_item_id: '1' })).toEqual({ errno: 0, errmsg: 'ok' });
    expect(pedidos.map((p) => p.corpo.auth_token)).toEqual(['tk-velho', 'tk-novo']);
    espia.mockRestore();
    global.fetch = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    expect(await svc.atualizarItem(ig, { app_item_id: '1' })).toEqual({ errno: -1, errmsg: null });
  });
});

descrever('a 99 item a item — fila e envio (Postgres real, 99 falsa)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  const food99 = new Food99Service(db, null as any);
  const envio = new Food99CatalogoEnvioService(db, auditoria, food99);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  // ── a 99 falsa: o cardápio por loja (integração) e o que chegou ─────────────────────────────────────────────────
  let cardapio: Record<string, any[]> = {};
  let gruposDa99: Record<string, any[]> = {}; // os grupos de complementos de cada loja na 99 (mig 404)
  let chamadas: { tipo: string; ig: string; corpo: any }[] = [];
  let respostaDoItem: () => { errno: number; errmsg: string | null } = () => ({ errno: 0, errmsg: 'ok' });
  let respostaDoGrupo: (corpo: any) => { errno: number; errmsg: string | null } = () => ({ errno: 0, errmsg: 'ok' });
  let leituras = 0;
  food99.itensDoCardapio = (async (ig: any) => {
    leituras++;
    return {
      errno: 0,
      errmsg: 'ok',
      itens: new Map((cardapio[ig.id] ?? []).map((it) => [String(it.app_item_id), { ...it }])),
      grupos: (gruposDa99[ig.id] ?? []).map((g) => JSON.parse(JSON.stringify(g))),
    };
  }) as any;
  food99.atualizarItem = (async (ig: any, corpo: any) => {
    chamadas.push({ tipo: 'item', ig: ig.id, corpo });
    return respostaDoItem();
  }) as any;
  food99.atualizarGrupo = (async (ig: any, corpo: any) => {
    chamadas.push({ tipo: 'grupo', ig: ig.id, corpo });
    return respostaDoGrupo(corpo);
  }) as any;
  food99.situacaoDosItens = (async (ig: any, ids: string[], status: 1 | 2) => {
    chamadas.push({ tipo: 'situacao', ig: ig.id, corpo: { ids, status } });
    const existe = (cardapio[ig.id] ?? []).some((it) => ids.includes(String(it.app_item_id)));
    return { errno: 0, errmsg: 'ok', sucesso: existe ? ids : [], falha: existe ? [] : ids };
  }) as any;

  beforeAll(async () => {
    // Só nuvem: o banco do CI é de loja. Trava `empresa` primeiro (ERR-377) e repete na corrida de catálogo. A 401 (os
    // campos) já veio pelo `apply-all-local` (vale nos dois lados).
    const r = (await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(MIGRATION_402, 'utf8'))))) as unknown as any[];
    const conferencia = (Array.isArray(r) ? r[r.length - 1] : r).rows;
    if (conferencia.length !== 4 || conferencia.some((l: any) => l.ok !== true)) throw new Error(`conferência da 402: ${JSON.stringify(conferencia)}`);
    // 404 (R3 F3b): a opção na mesma fila (`alvo`) e o gatilho da opção — a conferência tem de vir toda `ok`.
    const r404 = (await repetirNaCorridaDeCatalogo(() => pool.query(comTravaDaEmpresa(readFileSync(MIGRATION_404, 'utf8'))))) as unknown as any[];
    const conferencia404 = (Array.isArray(r404) ? r404[r404.length - 1] : r404).rows;
    if (conferencia404.length !== 3 || conferencia404.some((l: any) => l.ok !== true)) throw new Error(`conferência da 404: ${JSON.stringify(conferencia404)}`);
    // 406 (R3 F4b): a guarda do "ligar" no gatilho do produto. Aplicada aqui também porque o banco do CI é dividido entre
    // as specs: sem ela, a 402 desta spec trocaria a função no meio do teste da conferência (ERR-273).
    await repetirNaCorridaDeCatalogo(() =>
      pool.query(comTravaDaEmpresa(readFileSync(join(__dirname, '..', '..', '..', '..', '..', 'database', 'migrations', '406_ligar_produto_ao_app.sql'), 'utf8'))),
    );
    // `edge_status` é só da nuvem; outras specs a criam com o mínimo — aqui ela ganha as colunas que a liberação lê.
    await pool
      .query(`create table if not exists edge_status (id uuid primary key default gen_random_uuid(), tenant_id uuid,
                unidade_id uuid, recebido_em timestamptz not null default now())`)
      .catch((e: any) => {
        if (!['23505', '42P07'].includes(e?.code)) throw e;
      });
    await pool.query(`alter table edge_status add column if not exists equipamento_id uuid, add column if not exists versao text`);
  });

  afterAll(async () => {
    if (empresas.length) {
      await pool.query(`delete from edge_status where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      for (const t of ['food99_envio', 'produto_pausa_estoque', 'produto', 'opcao', 'categoria_produto', 'integracao', 'entitlement', 'equipamento', 'unidade'])
        await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  }, 120_000);

  beforeEach(() => {
    chamadas = [];
    auditados.length = 0;
    leituras = 0;
    respostaDoItem = () => ({ errno: 0, errmsg: 'ok' });
    respostaDoGrupo = () => ({ errno: 0, errmsg: 'ok' });
  });

  // ── a loja de teste ─────────────────────────────────────────────────────────────────────────────────────────────
  // A 99 é UMA por empresa (índice `uq_integracao_tenant_canal`): a integração fica na primeira loja (a que recebe os
  // pedidos); `na99: false` = a empresa não conectou a 99.
  async function loja(o: { lojas?: number; direito?: boolean; na99?: boolean } = {}) {
    const t = (await q(`insert into empresa (nome) values ('teste 99 item a item') returning id`))[0].id as string;
    empresas.push(t);
    const lojas: string[] = [];
    for (let i = 0; i < (o.lojas ?? 2); i++)
      lojas.push((await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [t, `Loja ${i + 1}`]))[0].id);
    if (o.direito !== false)
      await q(`insert into entitlement (id, tenant_id, modulo, ativo) values (md5('entitlement' || $1 || $3)::uuid, $2, $3, true)`, [t, t, MODULO_PRECOS_NA_99]);
    const igs: string[] = [];
    for (const u of o.na99 === false ? [] : lojas.slice(0, 1))
      igs.push(
        (
          await q(
            `insert into integracao (tenant_id, unidade_id, canal, ativo, merchant_id, client_id, client_secret, token, config)
             values ($1, $2, '99food', true, $3, 'app', 'segredo', 'tk', $4::jsonb) returning id`,
            [t, u, `shop-${u.slice(0, 8)}`, JSON.stringify({ tokenExp: Date.now() + 3_600_000 })],
          )
        )[0].id,
      );
    const cat = (await q(`insert into categoria_produto (tenant_id, nome) values ($1, 'Lanches') returning id`, [t]))[0].id as string;
    for (const ig of igs) cardapio[ig] = [{ ...ITEM_DA_99 }];
    return { t, lojas, igs, cat };
  }
  type Loja = Awaited<ReturnType<typeof loja>>;
  const produto = async (l: Loja, extra: Record<string, any> = {}) => {
    const cols = { tenant_id: l.t, nome: 'X-Bacon', codigo: '2051', categoria_id: l.cat, preco_venda: 39.9, na_99: true, ...extra };
    const k = Object.keys(cols);
    return (await q(`insert into produto (${k.join(',')}) values (${k.map((_, i) => `$${i + 1}`).join(',')}) returning id`, Object.values(cols)))[0]
      .id as string;
  };
  const fila = (t: string) =>
    q(`select integracao_id, tipo, versao, situacao, resultado, resposta, dados, tentativas, proxima_em > now() as adiado
         from food99_envio where tenant_id = $1 order by tipo, integracao_id`, [t]);
  const despachar = (l: Loja) => envio.processar({ tenantIds: [l.t] });

  it('sem o direito, sem a 99 conectada ou fora da 99: mudar o preço não enfileira nada', async () => {
    const semDireito = await loja({ direito: false });
    await q(`update produto set preco_99 = 49.9 where id = $1`, [await produto(semDireito)]);
    expect(await fila(semDireito.t)).toHaveLength(0);
    const semIntegracao = await loja({ na99: false });
    await q(`update produto set preco_99 = 49.9 where id = $1`, [await produto(semIntegracao)]);
    expect(await fila(semIntegracao.t)).toHaveLength(0);
    const l = await loja();
    await q(`update produto set preco_99 = 49.9 where id = $1`, [await produto(l, { na_99: false })]);
    await q(`update produto set preco_99 = 49.9 where id = $1`, [await produto(l, { codigo: null })]);
    expect(await fila(l.t)).toHaveLength(0);
  });

  it('preço: uma linha para a 99 da empresa (mesmo com duas lojas); edições seguidas viram UM envio; o item vai INTEIRO, em centavos', async () => {
    const l = await loja();
    const p = await produto(l);
    await q(`update produto set preco_99 = 47.9 where id = $1`, [p]);
    await q(`update produto set preco_99 = 49.9 where id = $1`, [p]);
    expect((await fila(l.t)).map((x: any) => [x.tipo, x.versao, x.situacao, x.integracao_id])).toEqual([
      ['preco_item', 2, 'pendente', l.igs[0]],
    ]);
    expect(await despachar(l)).toEqual({ enviados: 1, dispensados: 0, adiados: 0, desistidos: 0 });
    expect(chamadas).toEqual([{ tipo: 'item', ig: l.igs[0], corpo: itemParaAtualizar(ITEM_DA_99, { preco: 4990 }) }]);
    expect((await fila(l.t)).map((x: any) => [x.situacao, x.resultado, x.resposta?.antes, x.resposta?.depois])).toEqual([
      ['feito', 'aplicado', 44.9, 49.9],
    ]);
    expect(auditados.filter((a) => a.acao === 'enviou_a_99').map((a) => a.detalhe)).toEqual([
      expect.objectContaining({ chamada: 'updateItem', codigoPdv: '2051', preco: 4990, resultado: 'aplicado' }),
    ]);
    expect(await despachar(l)).toEqual({ enviados: 0, dispensados: 0, adiados: 0, desistidos: 0 });
  });

  it('pausa e preço do mesmo item na MESMA volta: a pausa não se desfaz (o updateItem leva o item pausado)', async () => {
    const l = await loja({ lojas: 1 });
    const p = await produto(l);
    await q(`update produto set canais_pausados = '["99food"]'::jsonb, preco_99 = 41 where id = $1`, [p]);
    expect(await despachar(l)).toMatchObject({ enviados: 2 });
    expect(chamadas.find((c) => c.tipo === 'situacao')?.corpo).toEqual({ ids: ['2051'], status: 2 });
    expect(chamadas.find((c) => c.tipo === 'item')?.corpo).toMatchObject({ price: 4100, status: 2 });
    expect(leituras).toBe(1); // o cardápio lido UMA vez na volta
    // Reativar: status 1. Mudar o preço de um item pausado SÓ no app da 99 não o reativa.
    await q(`update produto set canais_pausados = '[]'::jsonb where id = $1`, [p]);
    await despachar(l);
    expect(chamadas[chamadas.length - 1]).toMatchObject({ tipo: 'situacao', corpo: { status: 1 } });
    cardapio[l.igs[0]] = [{ ...ITEM_DA_99, status: 2 }];
    await q(`update produto set preco_99 = 42 where id = $1`, [p]);
    await despachar(l);
    expect(chamadas[chamadas.length - 1].corpo).toMatchObject({ price: 4200, status: 2 });
  });

  it('esgotado pelo estoque pausa; sair da 99 ("Está na 99" desmarcado) pausa o item lá — o Regem não apaga item da 99', async () => {
    const l = await loja();
    const p = await produto(l);
    // Esgotado na LOJA 2 (a 99 é da loja 1): não vai à 99.
    const esgota = (loja_: string) =>
      q(`insert into produto_pausa_estoque (id, tenant_id, produto_id, unidade_id, pausado) values ($4, $1, $2, $3, true)`, [l.t, p, loja_, randomUUID()]);
    await esgota(l.lojas[1]);
    expect(await fila(l.t)).toHaveLength(0);
    // Esgotado na LOJA 1: vai à 99 dela, pausando.
    await esgota(l.lojas[0]);
    expect((await fila(l.t)).map((x: any) => [x.tipo, x.integracao_id])).toEqual([['status_item', l.igs[0]]]);
    await despachar(l);
    expect(chamadas).toEqual([{ tipo: 'situacao', ig: l.igs[0], corpo: { ids: ['2051'], status: 2 } }]);
    // O esgotado de TODAS as lojas (no produto) também pausa.
    await q(`delete from produto_pausa_estoque where produto_id = $1`, [p]);
    await q(`update produto set pausado_estoque = true where id = $1`, [p]);
    chamadas = [];
    await despachar(l);
    expect(chamadas.map((c) => c.corpo.status)).toEqual([2]);
    // Sair da 99: o item lá fica pausado, mesmo sem esgotado.
    await q(`update produto set pausado_estoque = false where id = $1`, [p]);
    await despachar(l);
    chamadas = [];
    await q(`update produto set na_99 = false where id = $1`, [p]);
    await despachar(l);
    expect(chamadas).toEqual([{ tipo: 'situacao', ig: l.igs[0], corpo: { ids: ['2051'], status: 2 } }]);
  });

  it('nome e descrição: só os campos que mudaram, de um item que JÁ estava na 99; acima de 180 caracteres não vai', async () => {
    const l = await loja({ lojas: 1 });
    const p = await produto(l, { descricao: 'Pão, bacon' });
    await q(`update produto set nome = 'X-Bacon Duplo' where id = $1`, [p]);
    expect((await fila(l.t))[0]).toMatchObject({ tipo: 'cadastro_item', dados: { nome: true } });
    await q(`update produto set descricao = 'Pão, bacon duplo' where id = $1`, [p]);
    // Somados enquanto não saiu.
    expect((await fila(l.t))[0]).toMatchObject({ dados: { nome: true, descricao: true }, versao: 2 });
    await despachar(l);
    expect(chamadas[0].corpo).toEqual(
      itemParaAtualizar(ITEM_DA_99, { nome: 'X-Bacon Duplo', descricao: 'Pão, bacon duplo' }),
    );
    // Só o nome: a descrição de lá fica.
    chamadas = [];
    await q(`update produto set nome = 'X-Bacon Triplo' where id = $1`, [p]);
    await despachar(l);
    expect(chamadas[0].corpo).toMatchObject({ item_name: 'X-Bacon Triplo', short_desc: 'Descrição de lá' });
    chamadas = [];
    await q(`update produto set nome = $2 where id = $1`, [p, 'X'.repeat(181)]);
    expect(await despachar(l)).toMatchObject({ dispensados: 1 });
    expect(chamadas).toHaveLength(0);
    expect((await fila(l.t))[0].resposta.motivo).toMatch(/181 caracteres e a 99 aceita até 180/);
    // Entrar na 99 não sobrescreve o nome de lá.
    const novo = await produto(l, { codigo: '3001', na_99: false });
    await q(`update produto set na_99 = true, nome = 'Outro nome' where id = $1`, [novo]);
    expect((await fila(l.t)).filter((x: any) => x.tipo === 'cadastro_item')).toHaveLength(1);
  });

  it('item que a 99 não tem: "não encontrado" com a frase, sem chamar o updateItem; o status que a 99 recusa também', async () => {
    const l = await loja({ lojas: 1 });
    const p = await produto(l, { codigo: '9999' });
    await q(`update produto set preco_99 = 10, canais_pausados = '["99food"]'::jsonb where id = $1`, [p]);
    await despachar(l);
    expect(chamadas.map((c) => c.tipo)).toEqual(['situacao']);
    const linhas = await fila(l.t);
    expect(linhas.map((x: any) => [x.tipo, x.resultado])).toEqual([
      ['preco_item', 'nao_encontrado'],
      ['status_item', 'nao_encontrado'],
    ]);
    expect(linhas[0].resposta.frase).toMatch(/não tem item com o código 9999/);
    expect((await enviosDa99(db, l.t, p)).map((e) => [e.oQue, e.situacao, e.loja])).toEqual([
      ['preco', 'nao_encontrado', 'Loja 1'],
      ['pausa', 'nao_encontrado', 'Loja 1'],
    ]);
  });

  it('a 99 fora (sem resposta): adia e tenta de novo; recusa de parâmetro fica registrada; direito desligado = não enviado', async () => {
    const l = await loja({ lojas: 1 });
    const p = await produto(l);
    respostaDoItem = () => ({ errno: -1, errmsg: null });
    await q(`update produto set preco_99 = 50 where id = $1`, [p]);
    expect(await despachar(l)).toMatchObject({ adiados: 1 });
    expect((await fila(l.t))[0]).toMatchObject({ situacao: 'pendente', adiado: true, tentativas: 1 });
    expect((await enviosDa99(db, l.t, p))[0]).toMatchObject({ situacao: 'na_fila', frase: /tenta de novo/ });
    await q(`update food99_envio set proxima_em = now() where tenant_id = $1`, [l.t]);
    respostaDoItem = () => ({ errno: 10002, errmsg: 'Parameter error.' });
    expect(await despachar(l)).toMatchObject({ enviados: 1 });
    expect((await fila(l.t))[0]).toMatchObject({ situacao: 'feito', resultado: 'recusado' });
    await q(`update entitlement set ativo = false where tenant_id = $1`, [l.t]);
    await q(`update food99_envio set situacao = 'pendente', proxima_em = now() where tenant_id = $1`, [l.t]);
    expect(await despachar(l)).toMatchObject({ dispensados: 1 });
    expect((await fila(l.t))[0].resposta.motivo).toMatch(/desligados nesta empresa/);
  });

  it('"Exportar catálogo" da 99: com o direito, o preço na 99 do produto (vazio = o de venda); sem o direito, o de venda', async () => {
    const l = await loja({ lojas: 1 });
    await produto(l, { preco_99: 44.9 });
    await produto(l, { nome: 'Coca-Cola lata', codigo: '5001', preco_venda: 7, preco_99: null });
    // A leitura do catálogo de verdade (o SELECT escrito à mão traz o `preco_99` — V6).
    const entrega = Object.create(DeliveryService.prototype);
    entrega.db = db;
    const svc = new Food99Service(db, entrega);
    const original = global.fetch;
    const corpos: any[] = [];
    global.fetch = (async (_url: any, init: any) => {
      corpos.push(JSON.parse(String(init?.body ?? '{}')));
      return new Response(JSON.stringify({ errno: 0, errmsg: 'ok' }), { status: 200 });
    }) as typeof fetch;
    try {
      await svc.exportarCatalogo(l.t);
      const precos = (i: number) => Object.fromEntries(corpos[i].items.map((it: any) => [it.app_item_id, it.price]));
      expect(precos(0)).toEqual({ '2051': 4490, '5001': 700 });
      await q(`update entitlement set ativo = false where tenant_id = $1`, [l.t]);
      await svc.exportarCatalogo(l.t);
      expect(precos(1)).toEqual({ '2051': 3990, '5001': 700 });
    } finally {
      global.fetch = original;
    }
  });

  it('o servidor da loja lê o último envio pela nuvem: a rota responde pela empresa do token', async () => {
    const l = await loja({ lojas: 1 });
    const p = await produto(l);
    await q(`update produto set preco_99 = 45 where id = $1`, [p]);
    await despachar(l);
    const ctrl = new Food99LojaController(db);
    const r = await ctrl.envios({ tenantId: l.t } as any, p);
    expect(r.tenantId).toBe(l.t);
    expect(r.envios).toEqual([expect.objectContaining({ oQue: 'preco', situacao: 'aplicado', depois: 45 })]);
    // Outra empresa não vê.
    expect((await ctrl.envios({ tenantId: (await loja({ lojas: 1 })).t } as any, p)).envios).toEqual([]);
    await expect(ctrl.envios({ tenantId: l.t } as any, 'x')).rejects.toThrow(/Informe o produto/);
  });

  // ── o COMPLEMENTO (R3 F3b, mig 404): a mesma fila, `alvo = 'opcao'` ─────────────────────────────────────────────
  const GRUPOS_DA_99 = [
    { app_modifier_group_id: 'mg1', modifier_group_name: 'Adicionais', is_required: 2, quantity_min_permitted: 0, quantity_max_permitted: 3, buy_mode: 1,
      app_mg_items: [{ app_item_id: 'A01', price: 500 }, { app_item_id: 'A02', price: 400 }] },
    { app_modifier_group_id: 'mg2', modifier_group_name: 'Adicionais da batata', is_required: 2, quantity_min_permitted: 0, quantity_max_permitted: 2, buy_mode: 0,
      app_mg_items: [{ app_item_id: 'A02', price: 350 }, { app_item_id: 'A01', price: 450 }] },
    { app_modifier_group_id: 'mg3', modifier_group_name: 'Molhos', is_required: 1, quantity_min_permitted: 1, quantity_max_permitted: 1, buy_mode: 0,
      app_mg_items: [{ app_item_id: 'M01', price: 0 }] },
  ];
  const opcao = async (l: Loja, codigo = 'A01') =>
    (await q(`insert into opcao (tenant_id, nome, codigo_pdv) values ($1, 'Bacon extra', $2) returning id`, [l.t, codigo]))[0].id as string;

  it('complemento: o preço na 99 vai a CADA grupo da 99 que o tem, com o grupo inteiro e só o preço dele trocado', async () => {
    const l = await loja({ lojas: 1 });
    gruposDa99[l.igs[0]] = GRUPOS_DA_99;
    const o = await opcao(l);
    await q(`update opcao set preco_99 = 5.5 where id = $1`, [o]);
    expect((await q(`select tipo, alvo, situacao from food99_envio where ref_id = $1`, [o]))).toEqual([{ tipo: 'preco_item', alvo: 'opcao', situacao: 'pendente' }]);
    expect(await despachar(l)).toMatchObject({ enviados: 1 });
    expect(chamadas.map((c) => c.tipo)).toEqual(['grupo', 'grupo']);
    expect(chamadas.map((c) => c.corpo)).toEqual([grupoParaAtualizar(GRUPOS_DA_99[0], 'A01', 550), grupoParaAtualizar(GRUPOS_DA_99[1], 'A01', 550)]);
    expect(chamadas[0].corpo.app_mg_items).toEqual([{ app_item_id: 'A01', price: 550 }, { app_item_id: 'A02', price: 400 }]); // a outra opção fica
    const linha = (await q(`select resultado, resposta from food99_envio where ref_id = $1`, [o]))[0];
    expect(linha).toMatchObject({ resultado: 'aplicado', resposta: { grupos: 2, antes: 5, depois: 5.5 } });
    expect(auditados.find((a) => a.acao === 'enviou_a_99')).toMatchObject({ entidadeTipo: 'opcao', entidadeId: o, detalhe: { chamada: 'updateModifierGroup', grupos: 2, preco: 550 } });
    // Zero vale (o complemento grátis lá).
    chamadas = [];
    await q(`update opcao set preco_99 = 0 where id = $1`, [o]);
    await despachar(l);
    expect(chamadas.map((c) => c.corpo.app_mg_items.find((it: any) => it.app_item_id === 'A01').price)).toEqual([0, 0]);
  });

  it('complemento: pausa na 99 e "Em falta" pelo updateItemStatus; o que a 99 não tem em grupo nenhum = "não encontrado"', async () => {
    const l = await loja({ lojas: 1 });
    gruposDa99[l.igs[0]] = GRUPOS_DA_99;
    cardapio[l.igs[0]] = [{ ...ITEM_DA_99 }, { app_item_id: 'A01', item_name: 'Bacon extra', price: 500, status: 1, is_sold_separately: false }];
    const o = await opcao(l);
    // Só no Regem e só no iFood: nada vai à 99.
    await q(`update opcao set canais_pausados = '["regem","ifood"]'::jsonb where id = $1`, [o]);
    expect(await q(`select 1 from food99_envio where ref_id = $1`, [o])).toHaveLength(0);
    await q(`update opcao set canais_pausados = '["regem","ifood","99food"]'::jsonb where id = $1`, [o]);
    await despachar(l);
    expect(chamadas).toEqual([{ tipo: 'situacao', ig: l.igs[0], corpo: { ids: ['A01'], status: 2 } }]);
    chamadas = [];
    await q(`update opcao set canais_pausados = '[]'::jsonb where id = $1`, [o]);
    await despachar(l);
    await q(`update opcao set esgotado = true where id = $1`, [o]);
    await despachar(l);
    expect(chamadas.map((c) => c.corpo.status)).toEqual([1, 2]);
    // Fora de qualquer grupo da 99: não encontrado, sem chamar.
    const outra = await opcao(l, 'Z99');
    chamadas = [];
    await q(`update opcao set preco_99 = 3 where id = $1`, [outra]);
    await despachar(l);
    expect(chamadas).toHaveLength(0);
    expect((await q(`select resultado, resposta from food99_envio where ref_id = $1`, [outra]))[0]).toMatchObject({
      resultado: 'nao_encontrado',
      resposta: { frase: expect.stringMatching(/não tem o complemento com o código Z99 em nenhum grupo/) },
    });
    // Sem o direito: nada entra na fila.
    const sem = await loja({ lojas: 1, direito: false });
    const o2 = await opcao(sem);
    await q(`update opcao set preco_99 = 4, canais_pausados = '["99food"]'::jsonb where id = $1`, [o2]);
    expect(await q(`select 1 from food99_envio where ref_id = $1`, [o2])).toHaveLength(0);
  });

  it('complemento: um grupo recusa e o outro aceita = "aplicado em parte"; a 99 fora adia o envio inteiro', async () => {
    const l = await loja({ lojas: 1 });
    gruposDa99[l.igs[0]] = GRUPOS_DA_99;
    const o = await opcao(l);
    respostaDoGrupo = (corpo) => (corpo.app_modifier_group_id === 'mg2' ? { errno: 10002, errmsg: 'Parameter error.' } : { errno: 0, errmsg: 'ok' });
    await q(`update opcao set preco_99 = 6 where id = $1`, [o]);
    await despachar(l);
    expect((await q(`select resultado, resposta from food99_envio where ref_id = $1`, [o]))[0]).toMatchObject({
      resultado: 'parcial',
      resposta: { frase: expect.stringMatching(/aplicou o preço em 1 de 2 grupos/) },
    });
    respostaDoGrupo = () => ({ errno: -1, errmsg: null });
    await q(`update opcao set preco_99 = 7 where id = $1`, [o]);
    expect(await despachar(l)).toMatchObject({ adiados: 1 });
    expect((await q(`select situacao, tentativas from food99_envio where ref_id = $1`, [o]))[0]).toMatchObject({ situacao: 'pendente', tentativas: 1 });
    // A tela lê o "último envio à 99" do complemento pela mesma leitura.
    expect((await enviosDa99(db, l.t, o))[0]).toMatchObject({ oQue: 'preco', situacao: 'na_fila' });
  });

  it('console da distribuição: ligar exige os servidores de loja na versão da mig 401; o painel mostra os envios', async () => {
    const l = await loja({ lojas: 1, direito: false });
    const console_ = new PrecosNa99Service(db, auditoria);
    const eq = (
      await q(`insert into equipamento (tenant_id, unidade_id, tipo, nome, token) values ($1, $2, 'servidor_local', 'Servidor da loja', $3) returning id`, [
        l.t,
        l.lojas[0],
        `teste-${randomBytes(12).toString('hex')}`,
      ])
    )[0].id;
    await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao) values ($1, $2, $3, '1.30.12')`, [eq, l.t, l.lojas[0]]);
    await expect(console_.liberacao({ tenantId: l.t, ligar: true }, { nome: 'Teste' })).rejects.toThrow(/precisa estar na 1\.30\.13/);
    await q(`update edge_status set versao = '1.30.13' where equipamento_id = $1`, [eq]);
    expect(await console_.liberacao({ tenantId: l.t, ligar: true }, { nome: 'Teste' })).toEqual({ tenantId: l.t, liberado: true });
    expect(auditados.some((a) => a.acao === 'ligou_precos_na_99')).toBe(true);
    await q(`update produto set preco_99 = 46 where id = $1`, [await produto(l)]);
    const painel = await console_.painel(l.t);
    expect(painel).toMatchObject({ liberado: true, versaoMinima: '1.30.13', com99: true, servidores: [expect.objectContaining({ pronto: true })] });
    expect(painel.envios).toEqual([expect.objectContaining({ tipo: 'preco_item', situacao: 'pendente', codigo: '2051', loja: 'Loja 1' })]);
    await expect(console_.liberacao({ tenantId: l.t, ligar: 'sim' }, {})).rejects.toThrow(/Informe "ligar"/);
  });
});
