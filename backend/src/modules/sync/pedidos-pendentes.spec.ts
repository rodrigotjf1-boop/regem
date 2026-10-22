import { randomUUID } from 'node:crypto';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';
import { PedidosPorIdDto } from './dto/pedidos-por-id.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONFERÊNCIA RÁPIDA DOS PEDIDOS (ERR-280): o servidor da loja pergunta a cada ~30 s quais pedidos desta loja ele precisa
// ter e pede pelo id o que falta — sem depender do cursor do pull, que anda pela data e deixava para trás o pedido gravado
// com data anterior a ele. Aqui, o lado da nuvem: a lista (id + versão) e as linhas pelo id, com o mesmo escopo do pull.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pedidos-pendentes.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

describe('as rotas da conferência (sem banco)', () => {
  it('só a nuvem responde: as duas rotas são @CloudOnly (no servidor da loja, 404)', () => {
    expect(Reflect.getMetadata(CLOUD_ONLY, SyncController.prototype.pedidosPendentes)).toBe(true);
    expect(Reflect.getMetadata(CLOUD_ONLY, SyncController.prototype.pedidosPorId)).toBe(true);
  });

  it('o pedido pelo id aceita até 200 ids, todos uuid', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const validar = (body: unknown) => pipe.transform(body, { type: 'body', metatype: PedidosPorIdDto });
    const ids = (n: number) => Array.from({ length: n }, () => randomUUID());
    await expect(validar({ ids: ids(200) })).resolves.toBeInstanceOf(PedidosPorIdDto);
    await expect(validar({ ids: ids(201) })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar({ ids: ['nao-e-uuid'] })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar({ ids: 'x' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(validar({})).rejects.toBeInstanceOf(BadRequestException);
  });
});

descrever('conferência rápida dos pedidos — nuvem (Postgres)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const OUTRA_EMPRESA = randomUUID();
  const LOJA = randomUUID();
  const OUTRA_LOJA = randomUUID();
  const SERVIDOR = randomUUID();
  const ids: Record<string, string> = {};
  let clienteId = '';

  // Um pedido com a situação, a loja e as datas pedidas (`criado`/`mudou`: expressão SQL de data).
  const pedido = async (
    nome: string,
    o: { tenant?: string; loja?: string | null; status?: string; comanda?: boolean; criado?: string; mudou?: string; apagado?: boolean; cliente?: string },
  ) => {
    const [r] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, status, comanda_id, criado_em, updated_at, deleted_at, cliente_id, display_id)
       values ($1, $2, 'ifood', $3, $4, ${o.criado ?? 'now()'}, ${o.mudou ?? 'now()'}, $5, $6, $7) returning id`,
      [o.tenant ?? T, o.loja === undefined ? LOJA : o.loja, o.status ?? 'novo', o.comanda ? randomUUID() : null,
        o.apagado ? new Date() : null, o.cliente ?? null, nome],
    );
    ids[nome] = r.id;
    return r.id as string;
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    await q(`insert into empresa (id, nome) values ($1, 'conferencia rapida'), ($2, 'outra empresa')`, [T, OUTRA_EMPRESA]);
    // Duas lojas: o escopo por loja do pull vale (empresa com mais de uma).
    await q(`insert into unidade (id, tenant_id, nome) values ($1, $3, 'Loja A'), ($2, $3, 'Loja B')`, [LOJA, OUTRA_LOJA, T]);
    await q(`insert into equipamento (id, tenant_id, unidade_id, tipo, nome, token) values ($1, $2, $3, 'servidor_local', 'Servidor', $4)`,
      [SERVIDOR, T, LOJA, 'tok-conferencia-' + SERVIDOR]);
    clienteId = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1, 'Cliente do cardápio', '21999990000') returning id`, [T]))[0].id;
    // Os que esperam a loja têm 1 hora: fora dos "últimos 5 min" — só a regra de quem espera os lista.
    const HA_1_HORA = "now() - interval '1 hour'";
    await pedido('espera', { cliente: clienteId, criado: HA_1_HORA, mudou: HA_1_HORA });
    await pedido('outra_loja', { loja: OUTRA_LOJA, criado: HA_1_HORA, mudou: HA_1_HORA });
    await pedido('da_rede', { loja: null, criado: HA_1_HORA, mudou: HA_1_HORA });
    await pedido('novo_com_venda', { comanda: true, criado: HA_1_HORA, mudou: HA_1_HORA });
    await pedido('aceito_antes', { status: 'confirmado', comanda: true, criado: "now() - interval '2 hours'", mudou: "now() - interval '2 hours'" });
    await pedido('cancelado_agora', { status: 'cancelado', comanda: true, criado: "now() - interval '2 hours'", mudou: 'now()' });
    await pedido('velho', { criado: "now() - interval '30 hours'", mudou: "now() - interval '30 hours'" });
    await pedido('apagado', { apagado: true, criado: "now() - interval '1 hour'", mudou: "now() - interval '1 hour'" });
    await pedido('de_outra_empresa', { tenant: OUTRA_EMPRESA, loja: null });
    await q(`insert into pedido_externo_pagamento (tenant_id, pedido_externo_id, forma, valor) values ($1, $2, 'pix', 30), ($1, $2, 'dinheiro', 12.5)`,
      [T, ids.espera]);
  });
  afterAll(async () => {
    if (!pool) return;
    for (const t of [T, OUTRA_EMPRESA]) {
      await q('delete from pedido_externo_pagamento where tenant_id = $1', [t]).catch(() => undefined);
      await q('delete from pedido_externo where tenant_id = $1', [t]).catch(() => undefined);
      await q('delete from cliente where tenant_id = $1', [t]).catch(() => undefined);
      await q('delete from equipamento where tenant_id = $1', [t]).catch(() => undefined);
      await q('delete from unidade where tenant_id = $1', [t]).catch(() => undefined);
      await q('delete from empresa where id = $1', [t]).catch(() => undefined);
    }
    await pool.end();
  });

  // Como a resposta chega ao servidor da loja: em JSON.
  const lista = async () => JSON.parse(JSON.stringify(await svc.pedidosPendentes(T, LOJA))).pedidos as { id: string; v: string }[];

  it('lista o que espera a loja (novo, sem venda, 24 h) e o que mudou nos últimos 5 min — desta loja e da rede', async () => {
    const vistos = new Set((await lista()).map((p) => p.id));
    expect(vistos).toEqual(new Set([ids.espera, ids.da_rede, ids.cancelado_agora]));
  });

  it('não lista: outra loja, outra empresa, já aceito e parado, novo com venda, novo de mais de 24 h, apagado', async () => {
    const vistos = new Set((await lista()).map((p) => p.id));
    for (const fora of ['outra_loja', 'de_outra_empresa', 'aceito_antes', 'novo_com_venda', 'velho', 'apagado']) {
      expect(vistos.has(ids[fora])).toBe(false);
    }
  });

  it('o que espera a loja vem primeiro', async () => {
    const l = await lista();
    expect(l[l.length - 1].id).toBe(ids.cancelado_agora);
  });

  it('a versão é a da linha como o pull e o pedido pelo id a entregam — a loja compara com a cópia que eles gravaram lá', async () => {
    // Outra forma de escrever a mesma data (milissegundo, outro fuso) daria "mais velho" ou "mais novo" para sempre.
    const doPull = JSON.parse(JSON.stringify(await svc.pull(T, undefined, {}, LOJA, SERVIDOR)));
    const doPull1 = doPull.tabelas.pedido_externo.find((p: any) => p.id === ids.espera);
    const peloId = JSON.parse(JSON.stringify(await svc.pedidosPorId(T, [ids.espera], LOJA))).tabelas.pedido_externo[0];
    const v = (await lista()).find((p) => p.id === ids.espera)!.v;
    expect(v).toBe(doPull1.updated_at);
    expect(v).toBe(peloId.updated_at);
  });

  it('empresa de uma loja só: não filtra por loja (como o pull)', async () => {
    await q('update unidade set deleted_at = now() where id = $1', [OUTRA_LOJA]);
    try {
      const vistos = new Set((await lista()).map((p) => p.id));
      expect(vistos.has(ids.outra_loja)).toBe(true);
    } finally {
      await q('update unidade set deleted_at = null where id = $1', [OUTRA_LOJA]);
    }
  });

  it('pelo id: o pedido, os pagamentos dele e o cliente a que ele aponta, com a versão completa em __v', async () => {
    const r = JSON.parse(JSON.stringify(await svc.pedidosPorId(T, [ids.espera], LOJA)));
    expect(r.tabelas.pedido_externo.map((p: any) => p.id)).toEqual([ids.espera]);
    expect(r.tabelas.pedido_externo[0].__v).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d+/);
    expect(r.tabelas.pedido_externo_pagamento.map((p: any) => p.forma).sort()).toEqual(['dinheiro', 'pix']);
    expect(r.tabelas.cliente.map((c: any) => c.id)).toEqual([clienteId]);
  });

  it('pelo id não devolve o de outra loja nem o de outra empresa (o id vem do servidor da loja)', async () => {
    const r: any = await svc.pedidosPorId(T, [ids.outra_loja, ids.de_outra_empresa, ids.da_rede], LOJA);
    expect(r.tabelas.pedido_externo.map((p: any) => p.id)).toEqual([ids.da_rede]);
    expect(r.tabelas.cliente).toEqual([]);
    expect(r.tabelas.pedido_externo_pagamento).toEqual([]);
  });

  it('o envio da loja não devolve a "novo" o pedido que já saiu de "novo" aqui, mesmo com data "mais nova" (só avança)', async () => {
    const ctx = { tenantId: T, unidadeId: LOJA, equipamentoId: SERVIDOR, token: 'tok' } as any;
    const id = await pedido('aceito_na_nuvem', { status: 'confirmado', comanda: true, criado: "now() - interval '1 hour'", mudou: "now() - interval '1 hour'" });
    const linha = JSON.parse(JSON.stringify((await q('select * from pedido_externo where id = $1', [id]))[0]));
    const daLoja = (o: Record<string, unknown>, segundos: number) =>
      [{ tabela: 'pedido_externo', linhas: [{ ...linha, ...o, updated_at: new Date(Date.now() + segundos * 1000).toISOString() }] }] as any;
    const situacao = async () => (await q('select status, comanda_id is not null as tem_venda from pedido_externo where id = $1', [id]))[0];
    // A cópia da loja ainda "novo", sem venda, com a data do relógio dela adiantado: não volta.
    await svc.push(ctx, daLoja({ status: 'novo', comanda_id: null }, 60));
    expect(await situacao()).toEqual({ status: 'confirmado', tem_venda: true });
    // Avançar continua valendo: pronto, e depois cancelado.
    await svc.push(ctx, daLoja({ status: 'pronto' }, 120));
    expect((await situacao()).status).toBe('pronto');
    await svc.push(ctx, daLoja({ status: 'cancelado' }, 180));
    expect((await situacao()).status).toBe('cancelado');
  });

  it('pelo id: id torto é ignorado, lista vazia devolve vazio, e só os 200 primeiros contam', async () => {
    const vazio = { cliente: [], pedido_externo: [], pedido_externo_pagamento: [] };
    expect(((await svc.pedidosPorId(T, ['x', '', 'nao-uuid'] as any, LOJA)) as any).tabelas).toEqual(vazio);
    expect(((await svc.pedidosPorId(T, [], LOJA)) as any).tabelas).toEqual(vazio);
    expect(((await svc.pedidosPorId(T, undefined as any, LOJA)) as any).tabelas).toEqual(vazio);
    const muitos: string[] = Array.from({ length: 250 }, () => randomUUID());
    muitos[10] = ids.espera;
    muitos[220] = ids.da_rede;
    const r: any = await svc.pedidosPorId(T, muitos, LOJA);
    expect(r.tabelas.pedido_externo.map((p: any) => p.id)).toEqual([ids.espera]);
  });
});
