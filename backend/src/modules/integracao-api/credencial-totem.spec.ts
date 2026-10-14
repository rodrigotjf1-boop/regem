import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Reflector } from '@nestjs/core';
import { UnauthorizedException } from '@nestjs/common';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EquipamentoService } from '../equipamento/equipamento.service';
import { CatalogoSyncController } from '../produto/catalogo-sync.controller';
import { VendasExternaController } from '../vendas/vendas-externa.controller';
import { DeliveryController } from '../delivery/delivery.controller';
import { CredencialDoTotemGuard } from './credencial-totem.guard';
import { IntegracaoApiController } from './integracao-api.controller';
import { ESCOPOS_KEY, IntegracaoTokenGuard } from './integracao-token.guard';
import { IntegracaoTokenService } from './integracao-token.service';
import { ProblemaException } from './problema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CREDENCIAL PRÓPRIA DO GOGEM (fase 1, mig 323) — contra o Postgres real.
//
// O GoGeM passa a chamar as cinco rotas do totem com um token da API de integração (`rgm_it_…`, um por
// loja, só o resumo guardado), no lugar do token de equipamento `servidor_local` (mig 290). Prova-se:
//   • só o cliente `gogem` recebe os três escopos do totem, e sempre de UMA loja;
//   • o token passa nas cinco rotas, cada uma com o seu escopo; o contexto é o da loja do token, com o
//     equipamento que já representava o GoGeM (a venda sai igual) — nunca o de outra loja;
//   • sem o escopo: 403; token de outro cliente (Farol): 403; revogado: 401, e NÃO cai para o token antigo;
//   • sem token novo, o `X-Sync-Token` antigo segue valendo (transição); no servidor da loja só ele vale;
//   • o token do GoGeM não lê nada da API de integração (vendas, clientes, cupons, catálogo, fichas, fila).
//
// O banco do CI é de servidor de loja: as migrations só da nuvem (295, 303 e a 323) sobem num schema SÓ
// DESTE TESTE, na frente do `public` (como na spec do Farol; LIC-088/ERR-109).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('credencial-totem.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGS, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');
const ESCOPOS_TOTEM = ['totem.catalogo.ler', 'totem.produtos.pausar', 'totem.vendas.lancar'];

// As cinco rotas do totem e o escopo de cada uma.
const ROTAS: Array<[any, string, string]> = [
  [CatalogoSyncController, 'catalogo', 'totem.catalogo.ler'],
  [CatalogoSyncController, 'pausar', 'totem.produtos.pausar'],
  [VendasExternaController, 'venderTotem', 'totem.vendas.lancar'],
  [VendasExternaController, 'falhaTotem', 'totem.vendas.lancar'],
  [DeliveryController, 'totemDinheiro', 'totem.vendas.lancar'],
];

descrever('credencial própria do GoGeM — token de integração nas rotas do totem (Postgres real)', () => {
  const SCHEMA = `teste_credencial_totem_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 4 });
  const db = drizzle(pool) as any;
  const auditoria = { registrar: async () => undefined } as unknown as AuditoriaService;
  const tokensSvc = new IntegracaoTokenService(db, auditoria);
  const equipamentos = new EquipamentoService(db, auditoria as any);
  const guard = new CredencialDoTotemGuard(equipamentos, db);
  const guardDaApi = new IntegracaoTokenGuard(tokensSvc, new Reflector());
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const edgeOriginal = process.env.EDGE_MODE;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // o token de integração é da NUVEM
    await pool.query(`create schema ${SCHEMA}`);
    const aplicar = (sqlDaMigration: string) => repetirNaCorridaDeCatalogo(() => pool.query(sqlDaMigration));
    await aplicar(semFkCompartilhada(mig('295_integracao_token_loja.sql')));
    await aplicar(semFkCompartilhada(mig('303_integracao_autorizacao.sql')));
    // A 323 como vai para a nuvem — a conferência dela, linha a linha — e de novo (idempotente).
    const r = (await aplicar(mig('323_integracao_gogem.sql'))) as unknown as any[];
    const conferencia = r[r.length - 1].rows;
    expect(conferencia).toHaveLength(4);
    if (conferencia.some((l: any) => !l.ok)) throw new Error(`conferência da 323: ${JSON.stringify(conferencia)}`);
    await aplicar(mig('323_integracao_gogem.sql'));
  });
  afterAll(async () => {
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    for (const id of empresas) {
      await q(`delete from public.equipamento where tenant_id = $1`, [id]).catch(() => {});
      await q(`delete from public.colaborador where tenant_id = $1`, [id]).catch(() => {});
      await q(`delete from public.funcao where tenant_id = $1`, [id]).catch(() => {});
      await q(`delete from public.unidade where tenant_id = $1`, [id]).catch(() => {});
      await q(`delete from public.empresa where id = $1`, [id]).catch(() => {});
    }
    await pool.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await pool.end();
  });

  async function empresa(lojas = ['Loja A', 'Loja B']) {
    const [e] = await q(`insert into empresa (nome) values ($1) returning id`, [`Totem teste ${randomUUID().slice(0, 6)}`]);
    empresas.push(e.id);
    const ids: string[] = [];
    for (const [i, l] of lojas.entries()) {
      const [u] = await q(`insert into unidade (tenant_id, nome, tipo) values ($1, $2, $3) returning id`, [e.id, l, i === 0 ? 'matriz' : 'filial']);
      ids.push(u.id);
    }
    const [f] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Presidência', 'presidente') returning id`, [e.id]);
    const [c] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, 'Presidente Totem', $2) returning id`, [e.id, f.id]);
    return { tenant: e.id as string, lojas: ids, presidente: c.id as string };
  }
  type Emp = Awaited<ReturnType<typeof empresa>>;
  const emitir = (e: Emp, loja: string | null, cliente: string, escopos: string[]) =>
    tokensSvc.emitir(
      { tenantId: e.tenant, ...(loja ? { unidadeId: loja } : {}), cliente, autorizadoPor: e.presidente, escopos, evidencia: 'autorização por escrito (teste)' },
      dist,
    ) as Promise<{ id: string; token: string }>;
  /** O equipamento `servidor_local` que o GoGeM marcou (mig 290) — o token antigo dele. */
  async function credencialAntiga(e: Emp, loja: string | null) {
    const token = randomBytes(24).toString('hex');
    const [r] = await q(
      `insert into equipamento (tenant_id, unidade_id, nome, tipo, token, ativo, integrador, integrador_visto_em)
       values ($1, $2, 'Integração GoGeM', 'servidor_local', $3, true, 'gogem', now()) returning id`,
      [e.tenant, loja, token],
    );
    return { id: r.id as string, token };
  }
  function contexto(controller: any, metodo: string, headers: Record<string, string>) {
    const req: any = { headers, originalUrl: `/api/v1/${metodo}`, url: `/api/v1/${metodo}`, ip: '10.0.0.1' };
    return {
      req,
      ctx: {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => controller.prototype[metodo],
        getClass: () => controller,
      } as any,
    };
  }
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  async function recusa(p: Promise<unknown>) {
    try {
      await p;
      return 'passou';
    } catch (e: any) {
      return e instanceof ProblemaException ? e.getStatus() : e instanceof UnauthorizedException ? 401 : `erro: ${e?.message}`;
    }
  }

  it('só o GoGeM recebe os escopos do totem, e sempre de UMA loja', async () => {
    const e = await empresa();
    const ok = await emitir(e, e.lojas[0], 'gogem', ESCOPOS_TOTEM);
    expect(ok.token).toMatch(/^rgm_it_/);
    await expect(emitir(e, e.lojas[0], 'liame', ['pedidos.ler', 'totem.vendas.lancar'])).rejects.toThrow('Escopo que não vale para o Liame');
    await expect(emitir(e, null, 'gogem', ESCOPOS_TOTEM)).rejects.toThrow(/unidadeId/);
    const [t] = await q(`select cliente, escopos, unidade_id, token_hash <> $2 as so_resumo from integracao_token_loja where id = $1`, [ok.id, ok.token]);
    expect(t).toEqual({ cliente: 'gogem', escopos: ESCOPOS_TOTEM, unidade_id: e.lojas[0], so_resumo: true });
  });

  it('o token do GoGeM passa nas cinco rotas, com a loja do token e o equipamento que já o representava', async () => {
    const e = await empresa();
    const antigo = await credencialAntiga(e, e.lojas[0]);
    const novo = await emitir(e, e.lojas[0], 'gogem', ESCOPOS_TOTEM);
    for (const [controller, metodo] of ROTAS) {
      const { ctx, req } = contexto(controller, metodo, bearer(novo.token));
      await expect(guard.canActivate(ctx)).resolves.toBe(true);
      expect(req.sync).toEqual({ tenantId: e.tenant, unidadeId: e.lojas[0], equipamentoId: antigo.id, token: null, integracaoTokenId: novo.id });
    }
    // O equipamento de OUTRA loja não representa o GoGeM nesta: a origem fica vazia.
    const outra = await emitir(e, e.lojas[1], 'gogem', ESCOPOS_TOTEM);
    const { ctx, req } = contexto(VendasExternaController, 'venderTotem', bearer(outra.token));
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(req.sync.equipamentoId).toBeNull();
    // O último uso é gravado.
    await new Promise((r) => setTimeout(r, 200));
    const [u] = await q(`select ultimo_uso_em is not null as usado, ultimo_ip from integracao_token_loja where id = $1`, [novo.id]);
    expect(u).toEqual({ usado: true, ultimo_ip: '10.0.0.1' });
  });

  it('sem o escopo da rota: 403; token de outro cliente (Farol): 403', async () => {
    const e = await empresa();
    const soCatalogo = await emitir(e, e.lojas[0], 'gogem', ['totem.catalogo.ler']);
    expect(await recusa(guard.canActivate(contexto(CatalogoSyncController, 'catalogo', bearer(soCatalogo.token)).ctx))).toBe('passou');
    for (const [controller, metodo] of ROTAS.slice(1))
      expect([metodo, await recusa(guard.canActivate(contexto(controller, metodo, bearer(soCatalogo.token)).ctx))]).toEqual([metodo, 403]);
    const farol = await emitir(e, e.lojas[0], 'farol', ['catalogo.ler', 'fichas.ler', 'producao.ler']);
    for (const [controller, metodo] of ROTAS)
      expect([metodo, await recusa(guard.canActivate(contexto(controller, metodo, bearer(farol.token)).ctx))]).toEqual([metodo, 403]);
  });

  it('revogado: 401 — e NÃO cai para o token antigo, mesmo que ele venha junto', async () => {
    const e = await empresa();
    const antigo = await credencialAntiga(e, e.lojas[0]);
    const novo = await emitir(e, e.lojas[0], 'gogem', ESCOPOS_TOTEM);
    await tokensSvc.revogarPeloConsole(novo.id, 'teste de revogação', dist);
    const { ctx } = contexto(VendasExternaController, 'venderTotem', { ...bearer(novo.token), 'x-sync-token': antigo.token });
    expect(await recusa(guard.canActivate(ctx))).toBe(401);
  });

  it('transição: sem token novo, o X-Sync-Token antigo segue valendo; no servidor da loja só ele vale', async () => {
    const e = await empresa();
    const antigo = await credencialAntiga(e, e.lojas[0]);
    const a = contexto(VendasExternaController, 'venderTotem', { 'x-sync-token': antigo.token, 'x-integrador': 'gogem' });
    await expect(guard.canActivate(a.ctx)).resolves.toBe(true);
    expect(a.req.sync).toMatchObject({ tenantId: e.tenant, equipamentoId: antigo.id, integracaoTokenId: null });
    // Outro Authorization (não é token de integração) não conta: segue o caminho antigo.
    const b = contexto(VendasExternaController, 'venderTotem', { authorization: 'Bearer outra-coisa', 'x-sync-token': antigo.token });
    await expect(guard.canActivate(b.ctx)).resolves.toBe(true);
    // No servidor da loja o token de integração nem existe: sem X-Sync-Token, recusa.
    const novo = await emitir(e, e.lojas[0], 'gogem', ESCOPOS_TOTEM);
    process.env.EDGE_MODE = 'true';
    try {
      expect(await recusa(guard.canActivate(contexto(VendasExternaController, 'venderTotem', bearer(novo.token)).ctx))).toBe(401);
    } finally {
      delete process.env.EDGE_MODE;
    }
  });

  it('o token do GoGeM não lê nada da API de integração', async () => {
    const e = await empresa();
    const novo = await emitir(e, e.lojas[0], 'gogem', ESCOPOS_TOTEM);
    // TODAS as rotas com escopo do controller (lista fechada: rota nova com escopo entra sozinha aqui).
    const leituras = Object.getOwnPropertyNames(IntegracaoApiController.prototype).filter(
      (m) => m !== 'constructor' && (Reflect.getMetadata(ESCOPOS_KEY, (IntegracaoApiController.prototype as any)[m]) ?? []).length > 0,
    );
    expect(leituras.length).toBeGreaterThanOrEqual(10); // vendas, clientes (2), catálogo, fichas, fila, cupons (4)
    for (const metodo of leituras) {
      const req: any = { headers: bearer(novo.token), ip: '10.0.0.1' };
      const ctx: any = {
        switchToHttp: () => ({ getRequest: () => req }),
        getHandler: () => (IntegracaoApiController.prototype as any)[metodo],
        getClass: () => IntegracaoApiController,
      };
      expect([metodo, await recusa(guardDaApi.canActivate(ctx))]).toEqual([metodo, 403]);
    }
  });
});
