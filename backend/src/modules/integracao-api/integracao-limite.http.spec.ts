import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Global, INestApplication, Logger, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DRIZZLE } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { CfThrottlerGuard } from '../../common/cf-throttler.guard';
import { CloudOnlyGuard } from '../../common/cloud-only.guard';
import { LIMITE_INTEGRACAO_POR_MINUTO } from '../../common/integracao-limite';
import { gerarChave, resumoChave } from '../../dms/integracao-dms';
import { IntegracaoApiModule } from './integracao-api.module';
import { IntegracaoTokenService } from './integracao-token.service';
import { BASE_TIPO_PROBLEMA } from './problema';
import { validarLigacaoIntegracao, validarTokenIntegracao } from './validar-token-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O LIMITE DE CHAMADAS da API de integração NO BANCO (Hub DMS, F3-8; mig 333) — contra o Postgres real.
//
// A contagem vai na mesma instrução da validação; as duas vias somam na linha do id do acesso; a janela de 1 minuto
// começa na primeira chamada; sem a tabela, a validação segue (o guard conta na memória). As tabelas da integração são
// só da NUVEM e o banco do CI é o de uma loja: as migrations entram num schema só deste teste, sem as chaves
// estrangeiras para `empresa`/`unidade` compartilhadas (LIC-088, ERR-109). O teste da tabela ausente fica por último:
// ele liga, neste arquivo, os 5 minutos em que a contagem no banco não é tentada.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('integracao-limite.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

const MIGRACOES = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGRACOES, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

const APP_LIAME = 'aplicativo-liame-de-teste';
const APLICATIVOS = Object.freeze({ liame: APP_LIAME });
const DO_TOKEN = { aplicativo: APP_LIAME, permissoes: ['pedidos.ler'] };

descrever('API de integração — o limite de chamadas no banco (Hub DMS, F3-8)', () => {
  const SCHEMA = `teste_limite_${process.pid}_${Date.now()}`;
  const SEM_TABELA = `${SCHEMA}_sem`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  const poolSem = new Pool({ connectionString: URL_PG, options: `-c search_path=${SEM_TABELA},public` });
  const db = drizzle(pool) as any;
  const dbSem = drizzle(poolSem) as any;
  const auditoria = { registrar: async () => undefined } as unknown as AuditoriaService;
  const svc = new IntegracaoTokenService(db, auditoria);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const edgeOriginal = process.env.EDGE_MODE;
  let app: INestApplication;
  let origem = '';
  let tenant = '';
  let loja = '';
  let presidente = '';

  @Global()
  @Module({
    providers: [{ provide: DRIZZLE, useValue: db }, { provide: AuditoriaService, useValue: auditoria }],
    exports: [DRIZZLE, AuditoriaService],
  })
  class InfraTeste {}

  @Module({
    imports: [InfraTeste, ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]), IntegracaoApiModule],
    providers: [
      { provide: APP_GUARD, useClass: CfThrottlerGuard },
      { provide: APP_GUARD, useClass: CloudOnlyGuard },
    ],
  })
  class AppTeste {}

  const emitir = async (escopos = ['pedidos.ler']) =>
    svc.emitir({ tenantId: tenant, unidadeId: loja, autorizadoPor: presidente, escopos, evidencia: 'autorização por escrito (teste)' }, dist);
  const contagem = async (id: string) => (await q(`select chamadas, inicio from integracao_limite where chave = $1`, [id]))[0];

  /** Uma ligação do token, gravada direto (a troca tem o teste dela em dms-id.http.spec.ts). */
  async function ligacaoDo(tokenId: string) {
    const { chave, resumo, prefixo } = gerarChave('lg', 'regem');
    await q(`insert into integracao_ligacao (id, tenant_id, aplicativo, prefixo, segredo_hash) values ($1, $2, $3, $4, $5)`, [
      tokenId,
      tenant,
      APP_LIAME,
      prefixo,
      resumo,
    ]);
    return chave;
  }

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a API é da NUVEM
    for (const [schema, comLimite] of [
      [SCHEMA, true],
      [SEM_TABELA, false],
    ] as const) {
      const p = schema === SCHEMA ? pool : poolSem;
      await p.query(`create schema ${schema}`);
      await repetirNaCorridaDeCatalogo(() => p.query(semFkCompartilhada(mig('295_integracao_token_loja.sql'))));
      await repetirNaCorridaDeCatalogo(() => p.query(semFkCompartilhada(mig('303_integracao_autorizacao.sql'))));
      await repetirNaCorridaDeCatalogo(() => p.query(mig('323_integracao_gogem.sql')));
      await repetirNaCorridaDeCatalogo(() => p.query(semFkCompartilhada(mig('329_integracao_ligacao.sql'))));
      if (comLimite) {
        const r: any = await repetirNaCorridaDeCatalogo(() => p.query(mig('333_integracao_limite.sql')));
        const conferencia = (Array.isArray(r) ? r[r.length - 1] : r).rows;
        expect(conferencia.map((l: any) => [l.objeto, l.ok])).toEqual(conferencia.map((l: any) => [l.objeto, true]));
        expect(conferencia).toHaveLength(6);
        await repetirNaCorridaDeCatalogo(() => p.query(mig('333_integracao_limite.sql'))); // idempotente
      }
    }
    const [e] = await q(`insert into empresa (nome) values ($1) returning id`, [`Empresa Limite ${randomUUID().slice(0, 6)}`]);
    empresas.push(e.id);
    tenant = e.id;
    const [u] = await q(`insert into unidade (tenant_id, nome, tipo) values ($1, 'L1 matriz', 'matriz') returning id`, [tenant]);
    loja = u.id;
    const [f] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Presidente (função)', 'presidente') returning id`, [tenant]);
    const [c] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, 'Presidente', $2) returning id`, [tenant, f.id]);
    presidente = c.id;
    app = await NestFactory.create(AppTeste, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    origem = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
  });

  afterAll(async () => {
    await app?.close();
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.query(`drop schema if exists ${SEM_TABELA} cascade`);
    await pool.end();
    await poolSem.end();
  }, 120_000);

  it('a contagem fica no banco, na mesma validação, e as duas vias somam na linha do acesso', async () => {
    // Linha de acesso parado há mais de um dia: sai na primeira contagem (a limpeza roda uma vez por hora por processo).
    await q(`insert into integracao_limite (chave, inicio, chamadas) values ('acesso-velho', now() - interval '2 days', 3)`);
    const t = await emitir();
    for (let i = 1; i <= 3; i++) {
      const v: any = await validarTokenIntegracao(db, t.token, { contar: true });
      expect(v.limite).toEqual({ ok: true, retryAfterSeg: expect.any(Number) });
      expect(v.limite.retryAfterSeg).toBeGreaterThanOrEqual(1);
      expect(v.limite.retryAfterSeg).toBeLessThanOrEqual(60);
      expect((await contagem(t.id)).chamadas).toBe(i);
    }
    const segredo = await ligacaoDo(t.id);
    const pelaLigacao: any = await validarLigacaoIntegracao(db, segredo, DO_TOKEN, APLICATIVOS, { contar: true });
    expect(pelaLigacao).toMatchObject({ tokenId: t.id, via: 'ligacao', limite: { ok: true } });
    expect((await contagem(t.id)).chamadas).toBe(4); // a ligação soma na linha do token
    // Sem `contar` (a troca da ligação), não conta.
    expect(await validarTokenIntegracao(db, t.token)).not.toHaveProperty('limite');
    expect((await contagem(t.id)).chamadas).toBe(4);
    const limpa = async () => (await q(`select count(*)::int n from integracao_limite where chave = 'acesso-velho'`))[0].n === 0;
    let ok = false;
    for (let i = 0; i < 40 && !ok; i++) {
      ok = await limpa();
      if (!ok) await new Promise((r) => setTimeout(r, 50));
    }
    expect(ok).toBe(true);
  });

  it('passou de 60 na janela: ok falso com o tempo que falta; a janela vira depois de 1 minuto', async () => {
    const t = await emitir();
    await validarTokenIntegracao(db, t.token, { contar: true });
    await q(`update integracao_limite set chamadas = $2 where chave = $1`, [t.id, LIMITE_INTEGRACAO_POR_MINUTO - 1]);
    const ultima: any = await validarTokenIntegracao(db, t.token, { contar: true });
    expect(ultima.limite.ok).toBe(true); // a 60ª ainda passa
    const passou: any = await validarTokenIntegracao(db, t.token, { contar: true });
    expect(passou.limite.ok).toBe(false); // a 61ª não
    expect(passou.limite.retryAfterSeg).toBeGreaterThanOrEqual(1);
    await q(`update integracao_limite set inicio = now() - interval '61 seconds' where chave = $1`, [t.id]);
    const nova: any = await validarTokenIntegracao(db, t.token, { contar: true });
    expect(nova.limite.ok).toBe(true);
    expect((await contagem(t.id)).chamadas).toBe(1);
  });

  it('só conta o acesso que vale: revogado, desconhecido e ligação revogada não somam', async () => {
    const t = await emitir();
    const segredo = await ligacaoDo(t.id);
    await validarTokenIntegracao(db, t.token, { contar: true });
    await q(`update integracao_ligacao set revogado_em = now() where id = $1`, [t.id]);
    expect(await validarLigacaoIntegracao(db, segredo, DO_TOKEN, APLICATIVOS, { contar: true })).toBeNull();
    expect((await contagem(t.id)).chamadas).toBe(1);
    await svc.revogarPeloConsole(t.id, 'teste do limite', dist);
    expect(await validarTokenIntegracao(db, t.token, { contar: true })).toBeNull();
    expect((await contagem(t.id)).chamadas).toBe(1);
    expect(await validarTokenIntegracao(db, `rgm_it_${'q'.repeat(43)}`, { contar: true })).toBeNull();
  });

  it('pelo HTTP: a 61ª chamada no minuto → 429 com Retry-After, e a contagem é a do banco', async () => {
    const t = await emitir();
    for (let i = 0; i < LIMITE_INTEGRACAO_POR_MINUTO; i++) {
      const r = await fetch(`${origem}/api/v1/integracao/loja`, { headers: { authorization: `Bearer ${t.token}` } });
      expect([i, r.status]).toEqual([i, 200]);
    }
    const r = await fetch(`${origem}/api/v1/integracao/loja`, { headers: { authorization: `Bearer ${t.token}` } });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(((await r.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}limite-de-chamadas`);
    expect((await contagem(t.id)).chamadas).toBe(LIMITE_INTEGRACAO_POR_MINUTO + 1);
    // Quem decide é a linha do banco, nos dois sentidos (a memória deste processo, se contasse, já estaria acima de
    // 60): com a linha baixa, passa; com a linha no limite, recusa — é assim que vale entre cópias do serviço.
    await q(`update integracao_limite set chamadas = 1 where chave = $1`, [t.id]);
    const baixa = await fetch(`${origem}/api/v1/integracao/loja`, { headers: { authorization: `Bearer ${t.token}` } });
    expect(baixa.status).toBe(200);
    await q(`update integracao_limite set chamadas = $2 where chave = $1`, [t.id, LIMITE_INTEGRACAO_POR_MINUTO]);
    const outra = await fetch(`${origem}/api/v1/integracao/loja`, { headers: { authorization: `Bearer ${t.token}` } });
    expect(outra.status).toBe(429);
  });

  it('sem a tabela (migration não aplicada): a validação segue sem contar, com aviso — o guard conta na memória', async () => {
    const aviso = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const [e] = await poolSem.query(`insert into empresa (nome) values ($1) returning id`, [`Empresa Sem Limite ${randomUUID().slice(0, 6)}`]).then((r) => r.rows);
      empresas.push(e.id);
      const [u] = await poolSem.query(`insert into unidade (tenant_id, nome, tipo) values ($1, 'S1', 'matriz') returning id`, [e.id]).then((r) => r.rows);
      const [f] = await poolSem.query(`insert into funcao (tenant_id, nome, categoria) values ($1, 'P', 'presidente') returning id`, [e.id]).then((r) => r.rows);
      const [c] = await poolSem.query(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, 'P', $2) returning id`, [e.id, f.id]).then((r) => r.rows);
      const svcSem = new IntegracaoTokenService(dbSem, auditoria);
      const t = await svcSem.emitir({ tenantId: e.id, unidadeId: u.id, autorizadoPor: c.id, escopos: ['pedidos.ler'], evidencia: 'autorização (teste)' }, dist);
      const v = await validarTokenIntegracao(dbSem, t.token, { contar: true });
      expect(v).toMatchObject({ tokenId: t.id, cliente: 'liame' });
      expect(v).not.toHaveProperty('limite');
      expect(aviso.mock.calls.map((x) => String(x[0])).some((m) => /integracao_limite \(mig 333\) não existe/.test(m))).toBe(true);
      // Nos 5 minutos seguintes nem tenta (uma ida só por chamada, como antes da tabela).
      expect(await validarTokenIntegracao(dbSem, t.token, { contar: true })).not.toHaveProperty('limite');
    } finally {
      aviso.mockRestore();
    }
  });
});
