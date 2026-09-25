import { randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { FiscalService } from '../fiscal/fiscal.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { VendasService } from '../vendas/vendas.service';
import { DeliveryService } from '../delivery/delivery.service';
import { GogemAvisoService } from './gogem-aviso.service';
import { MSG_NAO_GRAVADO } from './aviso-gogem';

/* eslint-disable @typescript-eslint/no-explicit-any */

// VENDA DO TOTEM CANCELADA NO REGEM → O GOGEM ESTORNA. Postgres de verdade; só a nuvem do GoGeM
// é falsa (o `fetch` global responde o que cada caso pede).
//
// O que isto garante ao cliente: cancelou no Regem uma venda do totem paga no cartão/PIX, o pedido
// de estorno EXISTE (gravado com o cancelamento) e SAI — agora, ou pelo job quando a rede voltar —
// uma vez só. E nada sai para quem não pagou no totem, nem para os cancelamentos que o próprio
// GoGeM originou.
//
// O job roda sempre limitado à empresa deste teste (`rodarFila(n, [tenant])`): no CI as specs
// dividem o banco em paralelo, e a fila da nuvem inteira pegaria o aviso de outra spec (LIC-084).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cancelamento-totem-gogem.spec: sem TEST_PG_URL — PULADO');

const TOKEN_INTEGRACAO = 'tok-integracao-gogem-teste';
const SENHA_GESTOR = 'Senha-Do-Gestor-1';

const json = (status: number, corpo: unknown) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const estornoFeito = (valorCentavos = 2000) =>
  json(200, {
    status: 'cancelado',
    pedidoId: 'g-1',
    estorno: {
      feito: true, meio: 'credito', valorCentavos, refundId: 'r-1',
      mensagem: 'Estorno solicitado ao Mercado Pago (cai na fatura/conta em alguns dias).',
    },
  });

descrever('venda do totem cancelada no Regem → aviso ao GoGeM (Postgres real)', () => {
  jest.setTimeout(60_000);
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditado: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditado.push(e) } as any;
  const eventos = { emit: () => true } as any;
  const fiscal = new FiscalService(db, auditoria);
  const producao = new ProducaoPedidoService(db, auditoria, eventos);
  const aviso = new GogemAvisoService(db, auditoria);
  const vendas = new VendasService(db, auditoria, eventos, producao, fiscal, {} as any, aviso);
  const estornos = { estornarPedido: async () => undefined } as any;
  const delivery = new DeliveryService(
    db, vendas, producao, estornos, estornos, eventos, { flashPedidos: () => undefined } as any,
    undefined, undefined, undefined, undefined, undefined, aviso,
  );

  const edgeOriginal = process.env.EDGE_MODE;
  const syncOriginal = process.env.SYNC_TOKEN;
  let tenant = '';
  let unidade = '';
  let totem = '';
  let gestor = '';
  let senha = 900;

  // ── a nuvem do GoGeM, de mentira ────────────────────────────────────────────────────────
  const chamadas: { url: string; metodo: string; token: string; corpo: any }[] = [];
  let responder: () => Promise<Response> = async () => estornoFeito();
  let espiao: jest.SpyInstance;

  // ── ajudantes ───────────────────────────────────────────────────────────────────────────
  const linhas = (q: string, p: any[]) => pool.query(q, p).then((r) => r.rows);
  const avisosDa = (chave: string) =>
    linhas(`select * from aviso_integracao where tenant_id = $1 and chave = $2`, [tenant, chave]);
  const auditoriasDe = (acao: string) => auditado.filter((a) => a.acao === acao);

  async function vendaDoTotem(): Promise<{ comandaId: string; chave: string }> {
    const chave = randomUUID();
    const r: any = await vendas.venderTotem(
      tenant,
      { unidadeId: unidade, equipamentoId: totem },
      {
        idempotencyKey: chave,
        itens: [{ codigoPdv: 'XB1', quantidade: 1 }],
        pagamentos: [{ forma: 'credito', valor: 20 }],
      } as any,
    );
    return { comandaId: r.comandaId, chave };
  }

  async function pedidoDoTotem(forma = 'cartao', criadoHaMin = 0): Promise<{ id: string; chave: string }> {
    senha++;
    const chave = randomUUID();
    const r = await pool.query(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome,
         tipo, itens, total, forma_pagamento, status, pago, criado_em)
       values ($1,$2,'totem',$3,$4,'Cliente do totem','retirada',$5::jsonb,'20.00',$6,'novo',false,
               now() - make_interval(mins => $7))
       returning id`,
      [tenant, unidade, chave, String(senha),
       JSON.stringify([{ codigo: 'XB1', descricao: 'X-Burguer', quantidade: 1, precoUnitario: 20 }]),
       forma, criadoHaMin],
    );
    return { id: r.rows[0].id, chave };
  }

  const liberar = (pedidoId: string): Promise<any> =>
    delivery.liberarPagamentoTotem(tenant, { unidadeId: unidade, equipamentoId: totem }, pedidoId, [
      { forma: 'credito', valor: 20, nsu: '123456', autorizacao: 'A1B2' },
    ]);
  const cancelarCupom = (comandaId: string): Promise<any> =>
    vendas.cancelar(tenant, gestor, 'gerente', comandaId, { motivo: 'Cliente desistiu' });
  const cancelarNoHub = (pedidoId: string): Promise<any> =>
    delivery.cancelar(tenant, gestor, 'gerente', pedidoId, 'Cliente desistiu', SENHA_GESTOR);
  /** Dá como vencida a próxima tentativa (em vez de esperar o recuo). */
  const vencer = (chave: string) =>
    pool.query(`update aviso_integracao set proxima_tentativa_em = now() - interval '1 second'
                 where tenant_id = $1 and chave = $2`, [tenant, chave]);

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // nuvem: o token vem do equipamento servidor_local
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste aviso GoGeM') returning id`)).rows[0].id;
    unidade = (await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [tenant])).rows[0].id;
    for (const t of ['edge_status', 'edge_heartbeat'])
      await pool.query(
        `create table if not exists ${t} (id uuid primary key default gen_random_uuid(),
           tenant_id uuid, unidade_id uuid, recebido_em timestamptz not null default now())`,
      );
    const item = (await pool.query(`insert into item_estoque (tenant_id, nome) values ($1,'Pão') returning id`, [tenant])).rows[0].id;
    await pool.query(
      `insert into produto (tenant_id, codigo, nome, ncm, cfop, csosn, origem, unidade_trib, preco_venda,
         vai_para_producao, controla_estoque, item_id)
       values ($1,'XB1','X-Burguer','21069090','5102','102','0','UN','20.00',true,true,$2)`,
      [tenant, item],
    );
    totem = (
      await pool.query(
        `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo)
         values ($1,$2,'Totem 1','totem',$3,true) returning id`,
        [tenant, unidade, randomBytes(8).toString('hex')],
      )
    ).rows[0].id;
    // Um servidor de LOJA cadastrado antes — "o primeiro servidor_local" que o `limit(1)` sem
    // ordem pegava, e o GoGeM recusava com 401 (ERR-108) — e a credencial do GoGeM, MARCADA pela
    // própria chamada dele (mig 290). O aviso tem de sair com a do GoGeM.
    await pool.query(
      `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo, last_push_ts, created_at)
       values ($1,$2,'Servidor da loja','servidor_local',$3,true, now(), now() - interval '30 days')`,
      [tenant, unidade, 'tok-servidor-da-loja-nao-e-do-gogem'],
    );
    await pool.query(
      `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo, integrador, integrador_visto_em)
       values ($1,null,'Integração GoGeM','servidor_local',$2,true,'gogem', now())`,
      [tenant, TOKEN_INTEGRACAO],
    );
    const funcao = (
      await pool.query(`insert into funcao (tenant_id, nome, categoria) values ($1,'Gerente','gerente') returning id`, [tenant])
    ).rows[0].id;
    gestor = (
      await pool.query(
        `insert into colaborador (tenant_id, nome, funcao_id, senha_hash) values ($1,'Gestora',$2,$3) returning id`,
        [tenant, funcao, await bcrypt.hash(SENHA_GESTOR, 4)],
      )
    ).rows[0].id;
    // Cancelar cupom exige caixa aberto (o estorno entra nele).
    await pool.query(
      `insert into caixa_sessao (tenant_id, unidade_id, terminal_id, origem, status)
       values ($1,$2,null,'pdv','aberta')`,
      [tenant, unidade],
    );
    espiao = jest.spyOn(global, 'fetch').mockImplementation(async (url: any, init: any) => {
      const headers = new Headers(init?.headers ?? {});
      chamadas.push({
        url: String(url),
        metodo: String(init?.method ?? 'GET'),
        token: headers.get('x-sync-token') ?? '',
        corpo: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return responder();
    });
  }, 120_000);

  afterAll(async () => {
    espiao?.mockRestore();
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    if (syncOriginal === undefined) delete process.env.SYNC_TOKEN;
    else process.env.SYNC_TOKEN = syncOriginal;
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  beforeEach(() => {
    chamadas.length = 0;
    responder = async () => estornoFeito();
  });

  // ── 1. onde o aviso sai ────────────────────────────────────────────────────────────────

  it('cupom de venda do totem paga no cartão: aviso com idempotencyKey e regemComandaId — e o operador vê o estorno', async () => {
    const v = await vendaDoTotem();
    const r = await cancelarCupom(v.comandaId);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0]).toMatchObject({
      metodo: 'POST',
      token: TOKEN_INTEGRACAO,
      corpo: { idempotencyKey: v.chave, regemComandaId: v.comandaId, motivo: 'Cliente desistiu' },
    });
    expect(chamadas[0].url).toBe('https://api.gogem.com.br/api/v1/sync/regem/pedido-cancelado');
    expect(r.estornoGogem.situacao).toBe('solicitado');
    expect(r.estornoGogem.mensagem).toContain('20,00');

    const [a] = await avisosDa(v.chave);
    expect(a).toMatchObject({ status: 'entregue', tentativas: 1, ultimo_status_http: 200, referencia_tipo: 'comanda' });
    expect(a.entregue_em).not.toBeNull();
    expect(auditoriasDe('aviso_gogem_entregue').some((x) => x.detalhe?.chave === v.chave)).toBe(true);
  });

  it('hub, pedido do totem: aviso com idempotencyKey = external_id (e a comanda, se houver)', async () => {
    const p = await pedidoDoTotem();
    const venda = await liberar(p.id);
    chamadas.length = 0;
    const r = await cancelarNoHub(p.id);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].corpo).toEqual({
      idempotencyKey: p.chave, regemComandaId: venda.comandaId, motivo: 'Cliente desistiu',
    });
    expect(r.status).toBe('cancelado');
    expect(r.estornoGogem.situacao).toBe('solicitado');
    const [a] = await avisosDa(p.chave);
    expect(a).toMatchObject({ status: 'entregue', referencia_tipo: 'pedido_externo', referencia_id: p.id });
  });

  it('hub, pedido do totem em DINHEIRO (nunca cobrado): o aviso vai, e o operador devolve no balcão', async () => {
    const p = await pedidoDoTotem('dinheiro');
    responder = async () =>
      json(200, {
        status: 'cancelado', pedidoId: null,
        estorno: { feito: false, meio: 'dinheiro', valorCentavos: 2000, mensagem: 'Pago em dinheiro.' },
      });
    const r = await cancelarNoHub(p.id);

    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].corpo).toEqual({ idempotencyKey: p.chave, motivo: 'Cliente desistiu' }); // sem comanda
    expect(r.estornoGogem.situacao).toBe('sem_estorno_eletronico');
    expect((await avisosDa(p.chave))[0].status).toBe('entregue');
  });

  it('venda que NÃO é do totem (PDV, com operador): nenhum aviso', async () => {
    const chave = randomUUID();
    const c = (
      await pool.query(
        `insert into comanda (tenant_id, unidade_id, status, forma, total, idempotency_key, aberta_por_id, fechada_em)
         values ($1,$2,'fechada','credito','20.00',$3,$4,now()) returning id`,
        [tenant, unidade, chave, gestor],
      )
    ).rows[0].id;
    const r = await cancelarCupom(c);

    expect(r).toEqual({ ok: true });
    expect(chamadas).toHaveLength(0);
    expect(await avisosDa(chave)).toHaveLength(0);
  });

  // ── 2. o dinheiro do cliente não depende da rede naquela hora ───────────────────────────

  it('GoGeM fora: o aviso fica gravado, o job reenvia com recuo — e entrega UMA vez só', async () => {
    responder = async () => Promise.reject(new TypeError('fetch failed'));
    const v = await vendaDoTotem();
    const r = await cancelarCupom(v.comandaId);

    expect(r.estornoGogem.situacao).toBe('pendente');
    let [a] = await avisosDa(v.chave);
    expect(a).toMatchObject({ status: 'pendente', tentativas: 1 });
    expect(new Date(a.proxima_tentativa_em).getTime()).toBeGreaterThan(Date.now());

    // Antes do recuo vencer, o job não manda de novo.
    responder = async () => estornoFeito();
    chamadas.length = 0;
    await aviso.rodarFila(20, [tenant]);
    expect(chamadas.filter((c) => c.corpo?.idempotencyKey === v.chave)).toHaveLength(0);

    // O GoGeM voltou e o recuo venceu: sai, é entregue — e não sai de novo.
    await vencer(v.chave);
    await aviso.rodarFila(20, [tenant]);
    await aviso.rodarFila(20, [tenant]);
    expect(chamadas.filter((c) => c.corpo?.idempotencyKey === v.chave)).toHaveLength(1);
    [a] = await avisosDa(v.chave);
    expect(a).toMatchObject({ status: 'entregue', tentativas: 2 });
  });

  it('o Mercado Pago falhou naquela hora (200, feito:false, cartão): o aviso VOLTA para a fila', async () => {
    responder = async () =>
      json(200, {
        status: 'cancelado', pedidoId: 'g-2',
        estorno: { feito: false, meio: 'credito', valorCentavos: 2000, mensagem: 'Cancelado, mas o estorno eletrônico falhou: timeout' },
      });
    const v = await vendaDoTotem();
    const r = await cancelarCupom(v.comandaId);

    expect(r.estornoGogem.situacao).toBe('pendente');
    expect((await avisosDa(v.chave))[0].status).toBe('pendente');

    // Na próxima, o GoGeM tenta o estorno de novo e consegue.
    responder = async () => estornoFeito();
    await vencer(v.chave);
    await aviso.rodarFila(20, [tenant]);
    expect((await avisosDa(v.chave))[0].status).toBe('entregue');
  });

  it('401 do GoGeM: alerta UMA vez e sem laço de reenvio', async () => {
    responder = async () => json(401, { statusCode: 401, message: 'Token inválido.' });
    const v = await vendaDoTotem();
    const r = await cancelarCupom(v.comandaId);

    expect(r.estornoGogem.situacao).toBe('integracao_recusou');
    let [a] = await avisosDa(v.chave);
    expect(a.status).toBe('aguardando_integracao');
    expect(new Date(a.proxima_tentativa_em).getTime()).toBeGreaterThan(Date.now() + 5 * 3600_000); // 6 h
    const alertas = () => auditoriasDe('aviso_gogem_integracao_recusou').filter((x) => x.detalhe?.chave === v.chave);
    expect(alertas()).toHaveLength(1);

    // O job não insiste enquanto o recuo de 6 h não vence.
    chamadas.length = 0;
    await aviso.rodarFila(20, [tenant]);
    expect(chamadas.filter((c) => c.corpo?.idempotencyKey === v.chave)).toHaveLength(0);

    // Venceu e continua recusado: tenta, mas não alerta de novo.
    await vencer(v.chave);
    await aviso.rodarFila(20, [tenant]);
    expect(chamadas.filter((c) => c.corpo?.idempotencyKey === v.chave)).toHaveLength(1);
    expect(alertas()).toHaveLength(1);
    [a] = await avisosDa(v.chave);
    expect(a.status).toBe('aguardando_integracao');
  });

  it('429 com Retry-After: passageiro — espera o que o GoGeM pediu, sem alerta de estorno manual', async () => {
    responder = async () =>
      new Response(JSON.stringify({ statusCode: 429, message: 'ThrottlerException: Too Many Requests' }), {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '600' },
      });
    const v = await vendaDoTotem();
    const r = await cancelarCupom(v.comandaId);

    expect(r.estornoGogem.situacao).toBe('pendente');
    const [a] = await avisosDa(v.chave);
    expect(a.status).toBe('pendente');
    // O recuo da 1ª tentativa seria 1 min; o GoGeM pediu 10 — vale o maior.
    expect(new Date(a.proxima_tentativa_em).getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    const alertas = auditado.filter(
      (x) => ['aviso_gogem_recusado', 'aviso_gogem_integracao_recusou'].includes(x.acao) && x.detalhe?.chave === v.chave,
    );
    expect(alertas).toHaveLength(0);
  });

  it('429 no meio do lote: o resto NÃO sai — volta à fila sem contar tentativa (na nuvem, um IP para todas as lojas)', async () => {
    const chaves = [randomUUID(), randomUUID(), randomUUID()];
    for (const [i, chave] of chaves.entries())
      await pool.query(
        `insert into aviso_integracao (tenant_id, destino, tipo, chave, corpo, tentativas, proxima_tentativa_em)
         values ($1,'gogem','pedido_cancelado',$2,$3::jsonb, 3, now() - make_interval(mins => $4))`,
        [tenant, chave, JSON.stringify({ idempotencyKey: chave, motivo: 'teste' }), 10 - i],
      );
    responder = async () =>
      new Response('{"statusCode":429}', { status: 429, headers: { 'retry-after': '120' } });
    try {
      const r = await aviso.rodarFila(3, [tenant]);
      expect(r.enviados).toBe(1);
      expect(chamadas).toHaveLength(1); // o primeiro tomou 429; os outros dois nem saíram
      const depois = await linhas(
        `select chave, status, tentativas, proxima_tentativa_em from aviso_integracao
          where tenant_id = $1 and chave = any($2) order by created_at`,
        [tenant, chaves],
      );
      expect(depois.map((x: any) => x.status)).toEqual(['pendente', 'pendente', 'pendente']);
      expect(depois.map((x: any) => x.tentativas)).toEqual([4, 3, 3]); // só o que saiu contou
      for (const x of depois)
        expect(new Date(x.proxima_tentativa_em).getTime()).toBeGreaterThan(Date.now() + 110_000);
    } finally {
      await pool.query(`delete from aviso_integracao where tenant_id = $1 and chave = any($2)`, [tenant, chaves]);
    }
  });

  it('o job reserva só o que pediu (LIMIT de verdade — LIC-069): 3 vencidos, limite 1 → sai 1', async () => {
    const chaves = [randomUUID(), randomUUID(), randomUUID()];
    for (const chave of chaves)
      await pool.query(
        `insert into aviso_integracao (tenant_id, destino, tipo, chave, corpo, proxima_tentativa_em)
         values ($1,'gogem','pedido_cancelado',$2,$3::jsonb, now() - interval '1 minute')`,
        [tenant, chave, JSON.stringify({ idempotencyKey: chave, motivo: 'teste' })],
      );
    try {
      const r = await aviso.rodarFila(1, [tenant]);
      expect(r.enviados).toBe(1);
      const estados = await linhas(
        `select status, count(*)::int n from aviso_integracao where tenant_id = $1 and chave = any($2) group by status`,
        [tenant, chaves],
      );
      expect(estados).toEqual(expect.arrayContaining([{ status: 'entregue', n: 1 }, { status: 'pendente', n: 2 }]));
    } finally {
      // Os dois que sobraram não podem vazar para os próximos testes.
      await pool.query(`delete from aviso_integracao where tenant_id = $1 and chave = any($2)`, [tenant, chaves]);
    }
  });

  // ── 3. o que NÃO avisa ─────────────────────────────────────────────────────────────────

  it('cancelamentos que o próprio GoGeM originou (#574) e pedido sem pagamento: nenhum aviso', async () => {
    // (a) cupom fiscal não impresso — o GoGeM já estorna pelo `pagamentos/estorno`
    const p1 = await pedidoDoTotem();
    await liberar(p1.id);
    await delivery.falhaImpressaoTotem(tenant, p1.id, 'papel acabou');

    // (b) retido que expirou sem pagamento, e (c) cliente que desistiu no totem
    const p2 = await pedidoDoTotem('cartao', 10);
    await delivery.expirarRetidosTotem(5);
    const p3 = await pedidoDoTotem();
    await delivery.cancelarPedidoTotem(tenant, p3.id, 'cliente desistiu no totem');

    // (d) nota não emitida — o fiscal ativo com a configuração incompleta recusa no pré-voo
    await pool.query(`insert into fiscal_config (tenant_id, unidade_id, ativo, ambiente, uf) values ($1,null,true,'2','RJ')`, [tenant]);
    let p4: { id: string; chave: string };
    try {
      p4 = await pedidoDoTotem();
      const r = await liberar(p4.id);
      expect(r.nfce?.status).toBe('nao_emitida');
    } finally {
      await pool.query(`delete from fiscal_config where tenant_id = $1`, [tenant]);
    }

    for (const p of [p1, p2, p3, p4!]) expect(await avisosDa(p.chave)).toHaveLength(0);
    expect(chamadas).toHaveLength(0);
    expect((await linhas(`select status from pedido_externo where id = $1`, [p2.id]))[0].status).toBe('cancelado');
  });

  it('a mesma venda cancelada no cupom e depois no hub: UM aviso, UM pedido de estorno', async () => {
    const p = await pedidoDoTotem();
    const venda = await liberar(p.id);
    chamadas.length = 0;
    const r1 = await cancelarCupom(venda.comandaId);
    const r2 = await cancelarNoHub(p.id);

    expect(await avisosDa(p.chave)).toHaveLength(1);
    expect(chamadas).toHaveLength(1);
    expect(r1.estornoGogem.situacao).toBe('solicitado');
    expect(r2.estornoGogem.situacao).toBe('solicitado'); // o desfecho que já existe, sem pedir de novo
  });

  // ── 4. servidor da loja e instalação sem a migration ────────────────────────────────────

  it('no SERVIDOR DA LOJA o aviso vai para a NUVEM do Regem, com o token de sync dele — nunca direto ao GoGeM', async () => {
    // O token da integração não mora na loja, e o GoGeM recusa qualquer outro (ERR-108): a nuvem
    // recebe o aviso e envia por ela.
    const v = await vendaDoTotem();
    const cloudOriginal = process.env.CLOUD_API;
    process.env.EDGE_MODE = 'true';
    process.env.SYNC_TOKEN = 'tok-do-servidor-da-loja';
    process.env.CLOUD_API = 'https://api.regem.teste/api/v1/';
    responder = async () =>
      new Response(
        JSON.stringify({
          aceito: true,
          avisoId: 'x',
          estorno: { situacao: 'solicitado', mensagem: 'Estorno de R$ 20,00 solicitado ao Mercado Pago pelo GoGeM.' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    let r: any;
    try {
      r = await cancelarCupom(v.comandaId);
    } finally {
      delete process.env.EDGE_MODE;
      if (syncOriginal === undefined) delete process.env.SYNC_TOKEN;
      else process.env.SYNC_TOKEN = syncOriginal;
      if (cloudOriginal === undefined) delete process.env.CLOUD_API;
      else process.env.CLOUD_API = cloudOriginal;
    }
    expect(chamadas).toHaveLength(1);
    const [a] = await avisosDa(v.chave);
    expect(chamadas[0]).toMatchObject({
      url: 'https://api.regem.teste/api/v1/gogem/avisos/pedido-cancelado',
      token: 'tok-do-servidor-da-loja',
      corpo: { avisoId: a.id, chave: v.chave, corpo: { idempotencyKey: v.chave, regemComandaId: v.comandaId } },
    });
    expect(chamadas.some((c) => c.url.includes('gogem.com.br'))).toBe(false);
    // Para a loja, "entregue" é a nuvem ter aceitado — e o operador vê o que a nuvem conseguiu.
    expect(a.status).toBe('entregue');
    expect(r.estornoGogem.situacao).toBe('solicitado');
    expect(auditoriasDe('aviso_gogem_repassado').some((x) => x.detalhe?.chave === v.chave)).toBe(true);
  });

  it('servidor da loja sem a ligação com a nuvem (sem CLOUD_API): o aviso espera, e o operador sabe', async () => {
    const v = await vendaDoTotem();
    const cloudOriginal = process.env.CLOUD_API;
    process.env.EDGE_MODE = 'true';
    process.env.SYNC_TOKEN = 'tok-do-servidor-da-loja';
    delete process.env.CLOUD_API;
    let r: any;
    try {
      r = await cancelarCupom(v.comandaId);
    } finally {
      delete process.env.EDGE_MODE;
      if (syncOriginal === undefined) delete process.env.SYNC_TOKEN;
      else process.env.SYNC_TOKEN = syncOriginal;
      if (cloudOriginal !== undefined) process.env.CLOUD_API = cloudOriginal;
    }
    expect(chamadas).toHaveLength(0);
    expect(r.estornoGogem.situacao).toBe('integracao_recusou');
    expect(r.estornoGogem.mensagem).toContain('não está ligado à nuvem');
    expect((await avisosDa(v.chave))[0].status).toBe('aguardando_integracao');
  });

  it('sem a tabela (mig 289 não aplicada): a venda CANCELA e o operador sabe que o estorno é manual', async () => {
    const v = await vendaDoTotem();
    await pool.query(`alter table aviso_integracao rename to aviso_integracao_fora`);
    let r: any;
    try {
      r = await cancelarCupom(v.comandaId);
    } finally {
      await pool.query(`alter table aviso_integracao_fora rename to aviso_integracao`);
    }
    expect(r.ok).toBe(true);
    expect(r.estornoGogem).toEqual(MSG_NAO_GRAVADO);
    expect((await linhas(`select status from comanda where id = $1`, [v.comandaId]))[0].status).toBe('cancelada');
    expect(chamadas).toHaveLength(0);
  });
});
