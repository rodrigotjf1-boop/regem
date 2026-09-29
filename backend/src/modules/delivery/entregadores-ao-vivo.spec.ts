import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { consultarAoVivo } from './entregadores-ao-vivo';
import { EntregadoresAoVivoService } from './entregadores-ao-vivo.service';
import { EntregadoresAoVivoController } from './entregadores-ao-vivo.controller';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Entregadores ao vivo nas telas da loja (Mapa ao vivo e o mapa no KDS, mig 293), contra o
// Postgres de verdade (V6), com a "nuvem" falsa para o servidor da loja.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('entregadores-ao-vivo.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('entregadores ao vivo por loja (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const ambiente = { EDGE_MODE: process.env.EDGE_MODE, CLOUD_API: process.env.CLOUD_API, SYNC_TOKEN: process.env.SYNC_TOKEN };
  let tenant = '';
  let lojaA = '';
  let lojaB = '';
  const ent: Record<string, string> = {};

  // DeliveryService só com o que a configuração usa (getConfig/setConfig leem this.db).
  const delivery = () => {
    const d: any = Object.create(DeliveryService.prototype);
    d.db = db;
    return d as DeliveryService;
  };

  beforeAll(async () => {
    tenant = (await q(`insert into empresa (nome) values ('Teste mapa ao vivo') returning id`)).rows[0].id;
    lojaA = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja A') returning id`, [tenant])).rows[0].id;
    lojaB = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja B') returning id`, [tenant])).rows[0].id;
    const funcao = (await q(`insert into funcao (tenant_id, nome, categoria) values ($1,'Entregador','execucao') returning id`, [tenant])).rows[0].id;
    // Ana (loja A), Beto (loja B), Caio (sem loja), Duda (loja B, mas levando pedido da loja A),
    // Eva (loja A, posição velha — 30 min).
    for (const [nome, loja] of [['Ana', lojaA], ['Beto', lojaB], ['Caio', null], ['Duda', lojaB], ['Eva', lojaA]] as const) {
      ent[nome] = (await q(
        `insert into colaborador (tenant_id, nome, funcao_id, unidade_id) values ($1,$2,$3,$4) returning id`,
        [tenant, nome, funcao, loja],
      )).rows[0].id;
      await q(
        `insert into entregador_posicao (colaborador_id, tenant_id, lat, lng, atualizado_em)
         values ($1,$2,$3,$4, now() - ($5 || ' minutes')::interval)`,
        [ent[nome], tenant, -22.8, -43.3, nome === 'Eva' ? 30 : 1],
      );
    }
    await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, status, tipo, numero, entregador_id, despachado_em, itens, total)
       values ($1,$2,'cardapio',$3,'despachado','entrega',284,$4, now(), '[]'::jsonb, 10)`,
      [tenant, lojaA, randomUUID(), ent.Duda],
    );
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, end_lat, end_lng) values ($1,$2,$3,-22.84,-43.28)`, [tenant, lojaA, randomUUID()]);
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, end_lat, end_lng) values ($1,null,$2,-22.9,-43.2)`, [tenant, randomUUID()]);
  });

  afterAll(async () => {
    for (const [k, v] of Object.entries(ambiente)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (tenant) {
      await q('delete from pedido_externo where tenant_id = $1', [tenant]);
      await q('delete from entregador_posicao where tenant_id = $1', [tenant]);
      await q('delete from empresa where id = $1', [tenant]);
    }
    await pool.end();
  });

  it('cada loja vê os entregadores DELA (e quem leva pedido dela), centrada no endereço dela', async () => {
    const a = await consultarAoVivo(db, tenant, lojaA);
    expect(a.entregadores.map((e) => e.nome)).toEqual(['Ana', 'Caio', 'Duda']);
    expect(a.centro).toEqual({ lat: -22.84, lng: -43.28 });
    const duda = a.entregadores.find((e) => e.nome === 'Duda')!;
    expect(duda).toMatchObject({ em_rota: 1, pedidos: ['284'], lat: -22.8, lng: -43.3 });
    expect(typeof duda.criado_em).toBe('string');

    const b = await consultarAoVivo(db, tenant, lojaB);
    expect(b.entregadores.map((e) => e.nome)).toEqual(['Beto', 'Caio', 'Duda']);
    // o pedido da loja A não conta como "em rota" na tela da loja B
    expect(b.entregadores.find((e) => e.nome === 'Duda')).toMatchObject({ em_rota: 0, pedidos: [] });
    expect(b.centro).toEqual({ lat: -22.9, lng: -43.2 }); // loja B sem endereço → o da rede

    // Sem loja (presidente na rede): todos com posição recente; a posição de 30 min não entra.
    const rede = await consultarAoVivo(db, tenant, null);
    expect(rede.entregadores.map((e) => e.nome)).toEqual(['Ana', 'Beto', 'Caio', 'Duda']);
  });

  it('chave da loja: ausente mantém, "false" em texto é false, lixo é recusado', async () => {
    const d = delivery();
    expect((await d.getConfig(tenant, lojaA) as any).kdsMapaEntregadores).toBe(false);
    expect((await d.setConfig(tenant, lojaA, { kdsMapaEntregadores: true }) as any).kdsMapaEntregadores).toBe(true);
    expect((await d.setConfig(tenant, lojaA, { autoAceitar: false }) as any).kdsMapaEntregadores).toBe(true);
    expect((await d.setConfig(tenant, lojaA, { kdsMapaEntregadores: 'false' }) as any).kdsMapaEntregadores).toBe(false);
    await expect(d.setConfig(tenant, lojaA, { kdsMapaEntregadores: 'sim' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('KDS: com a chave desligada não sai nenhuma posição; ligada, sai o mapa da loja', async () => {
    const d = delivery();
    const svc = new EntregadoresAoVivoService(db, d);
    const ctl = new EntregadoresAoVivoController(svc, db);
    const operador: any = { tenantId: tenant, colaboradorId: ent.Ana, categoria: 'execucao' };
    await d.setConfig(tenant, lojaA, { kdsMapaEntregadores: false });
    expect(await ctl.kds(operador, lojaA)).toEqual({ habilitado: false, centro: null, entregadores: [] });
    await d.setConfig(tenant, lojaA, { kdsMapaEntregadores: true });
    const r: any = await ctl.kds(operador, lojaA);
    expect(r.habilitado).toBe(true);
    expect(r.entregadores.map((e: any) => e.nome)).toEqual(['Ana', 'Caio', 'Duda']);
    // A rota do token de sync responde a empresa E a loja do token.
    const loja: any = await ctl.loja({ tenantId: tenant, unidadeId: lojaB, equipamentoId: 'x', token: 't' });
    expect(loja.tenantId).toBe(tenant);
    expect(loja.entregadores.map((e: any) => e.nome)).toEqual(['Beto', 'Caio', 'Duda']);
  });

  it('servidor da loja: pede à nuvem, UMA chamada para várias telas; sem nuvem, "sem conexão" centrado na loja', async () => {
    const pedidos: string[] = [];
    let responder: 'ok' | 'outra-empresa' | 'fora' = 'ok';
    const servidor: Server = createServer((req, res) => {
      pedidos.push(`${req.url} ${req.headers['x-sync-token']}`);
      if (responder === 'fora') return void res.writeHead(503).end();
      const corpo = {
        tenantId: responder === 'ok' ? tenant : randomUUID(),
        centro: { lat: 1, lng: 2 },
        entregadores: [{ colaborador_id: 'x', nome: 'Da nuvem', lat: 1, lng: 2, criado_em: 'agora', em_rota: 0, pedidos: [] }],
      };
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(corpo));
    });
    await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', () => ok()));
    try {
      process.env.EDGE_MODE = 'true';
      process.env.CLOUD_API = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/api/v1`;
      process.env.SYNC_TOKEN = 'token-da-loja';
      const svc = new EntregadoresAoVivoService(db, delivery());
      // Três telas pedindo juntas → uma chamada só à nuvem.
      const [a, b, c] = await Promise.all([1, 2, 3].map(() => svc.daLoja(tenant, lojaA)));
      expect(pedidos).toEqual(['/api/v1/delivery/entregadores-ao-vivo/loja token-da-loja']);
      expect(a.entregadores.map((e) => e.nome)).toEqual(['Da nuvem']);
      expect(b).toBe(a);
      expect(c.semConexao).toBeUndefined();

      // Nuvem respondendo por OUTRA empresa: não mostra nada de ninguém.
      responder = 'outra-empresa';
      const outra = await new EntregadoresAoVivoService(db, delivery()).daLoja(tenant, lojaA);
      expect(outra).toEqual({ centro: { lat: -22.84, lng: -43.28 }, entregadores: [], semConexao: true });

      // Nuvem fora: mapa vazio, centrado na loja (do banco local), com o aviso.
      responder = 'fora';
      const fora = await new EntregadoresAoVivoService(db, delivery()).daLoja(tenant, lojaA);
      expect(fora).toEqual({ centro: { lat: -22.84, lng: -43.28 }, entregadores: [], semConexao: true });
    } finally {
      delete process.env.EDGE_MODE;
      await new Promise<void>((ok) => servidor.close(() => ok()));
    }
  });
});
