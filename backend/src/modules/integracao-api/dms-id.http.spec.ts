jest.mock('../../common/mailer', () => ({
  ...jest.requireActual('../../common/mailer'),
  enviarEmail: jest.fn(async () => true),
}));

import 'reflect-metadata';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Controller, Get, Global, INestApplication, Module, UseFilters, UseGuards } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DRIZZLE } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { CfThrottlerGuard } from '../../common/cf-throttler.guard';
import { CloudOnlyGuard } from '../../common/cloud-only.guard';
import { LIMITE_INTEGRACAO_POR_MINUTO } from '../../common/integracao-limite';
import { enviarEmail } from '../../common/mailer';
import { gerarChave } from '../../dms/integracao-dms';
import { ESCOPOS_INTEGRACAO } from './escopos';
import { IntegracaoApiModule } from './integracao-api.module';
import { IntegracaoTokenService } from './integracao-token.service';
import { Escopos, IntegracaoTokenGuard } from './integracao-token.guard';
import { CAMINHO_DOS_METADADOS, LIGACAO_INVALIDA, ROTAS_FORA_DO_PREFIXO, TROCA_RECUSADA } from './ligacao.regras';
import { BASE_TIPO_PROBLEMA, ProblemaFilter } from './problema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A VIA DO DMS ID (Hub DMS, F3, parte A, mig 329) — contra o Postgres real e por HTTP de verdade (Nest com os guards
// globais de produção: limite por IP e CloudOnly).
//
// O DMS ID é de mentira, mas assina de verdade (ES384, a chave EC P-384 que o Logto usa) e publica as chaves num
// servidor HTTP: o token é conferido pelo código de produção (`DmsIdService`, com o pacote comum). As tabelas da
// integração são só da NUVEM e o banco do CI é o de uma loja: a 295 e a 329 vêm das migrations de verdade, num schema
// só deste teste, sem as chaves estrangeiras para `empresa`/`unidade` compartilhadas (LIC-088, ERR-109).
//
// O último teste roda o kit de conformidade do Padrão DMS (`test/dms/`, cópia igual à do hub) contra a API: é a prova
// que o Padrão pede antes de abrir a porta. Ele roda direto no Node 22.6 ou mais (TypeScript sem compilar); no Node
// 20 da produção fica pulado, e o CI o roda num passo com o Node 22 (`KIT_DMS_OBRIGATORIO`).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('dms-id.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

const MIGRACOES = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGRACOES, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

const KIT = join(__dirname, '..', '..', '..', 'test', 'dms', 'kit-conformidade.mts');
const COPIA_DO_PACOTE = join(__dirname, '..', '..', 'dms', 'integracao-dms.ts');
const [NODE_MAIOR, NODE_MENOR] = process.versions.node.split('.').map(Number);
const NODE_RODA_O_KIT = NODE_MAIOR > 22 || (NODE_MAIOR === 22 && NODE_MENOR >= 6);
const itDoKit = NODE_RODA_O_KIT || process.env.KIT_DMS_OBRIGATORIO === 'true' ? it : it.skip;
if (!NODE_RODA_O_KIT) console.warn(`dms-id.http.spec: Node ${process.versions.node} não roda o kit (precisa do 22.6+) — kit PULADO`);

// Identificadores visivelmente fictícios: o repositório é público.
const APP_LIAME = 'aplicativo-liame-de-teste';
const APP_FAROL = 'aplicativo-farol-de-teste';
const APP_FORA = 'aplicativo-fora-da-lista';
const KID = 'chave-de-teste';
const FORMATO_LIGACAO = /^dms_lg_regem_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{6}$/;

type DmsIdFalso = { servidor: Server; emissor: string; emitir(o?: OpcoesToken): string };
type OpcoesToken = {
  aplicativo?: string;
  scope?: string;
  destino?: string;
  expiraEmSeg?: number;
  emissor?: string;
  chave?: KeyObject;
  alg?: string;
};

/** O DMS ID de mentira: a chave ES384, as chaves públicas por HTTP e a emissão do token. */
async function subirDmsIdFalso(recurso: () => string): Promise<DmsIdFalso> {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'ES384' };
  const servidor = createServer((req, res) => {
    if (req.url !== '/oidc/jwks') {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  const emissor = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}/oidc`;
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  return {
    servidor,
    emissor,
    emitir(o: OpcoesToken = {}) {
      const agora = Math.floor(Date.now() / 1000);
      const cabeca = b64({ alg: o.alg ?? 'ES384', typ: 'at+jwt', kid: KID });
      const aplicativo = o.aplicativo ?? APP_LIAME;
      const corpo = b64({
        iss: o.emissor ?? emissor,
        aud: o.destino ?? recurso(),
        sub: aplicativo,
        client_id: aplicativo,
        scope: o.scope ?? 'pedidos.ler cupons.ler cupons.uso.ler cupons.criar clientes.anonimizacao.ler',
        iat: agora,
        exp: agora + (o.expiraEmSeg ?? 3600),
        jti: randomUUID(),
      });
      if (o.alg === 'none') return `${cabeca}.${corpo}.`;
      const assinatura = sign('sha384', Buffer.from(`${cabeca}.${corpo}`), {
        key: o.chave ?? privateKey,
        dsaEncoding: 'ieee-p1363',
      }).toString('base64url');
      return `${cabeca}.${corpo}.${assinatura}`;
    },
  };
}

const esperarAte = async (cond: () => boolean | Promise<boolean>, ms = 5_000) => {
  const ate = Date.now() + ms;
  while (Date.now() < ate) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

/** O corpo sem o código de rastreio: "a mesma resposta" é a resposta inteira (a regra do kit). */
const semRastreio = (c: any) => {
  const { request_id: _r, ...resto } = c ?? {};
  return JSON.stringify(resto);
};

descrever('API de integração — a via do DMS ID (Hub DMS, F3)', () => {
  const SCHEMA = `teste_dmsid_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  const db = drizzle(pool) as any;
  const registros: any[] = [];
  const auditoria = { registrar: async (e: any) => void registros.push(e) } as unknown as AuditoriaService;
  const svc = new IntegracaoTokenService(db, auditoria);
  const empresas: string[] = [];
  const segredos: string[] = []; // todo segredo de ligação e token deste teste — nenhum pode ficar no banco
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const ENV = ['EDGE_MODE', 'DMS_ID_LIGADO', 'DMS_ID_EMISSOR', 'DMS_ID_RECURSO', 'DMS_ID_APLICATIVOS', 'APP_URL'] as const;
  const envOriginal = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const email = enviarEmail as unknown as jest.Mock;
  let app: INestApplication;
  let origem = '';
  let recurso = '';
  let dmsId: DmsIdFalso;

  // Rota de TESTE com escopo exigido (`cupons.criar`): prova o 403 por HTTP e é a leitura do kit.
  @Controller('integracao/teste-escopo')
  @UseGuards(IntegracaoTokenGuard)
  @UseFilters(ProblemaFilter)
  class RotaComEscopo {
    @Get()
    @Escopos('cupons.criar')
    ok() {
      return { ok: true };
    }
  }

  @Global()
  @Module({
    providers: [{ provide: DRIZZLE, useValue: db }, { provide: AuditoriaService, useValue: auditoria }],
    exports: [DRIZZLE, AuditoriaService],
  })
  class InfraTeste {}

  @Module({
    imports: [InfraTeste, ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]), IntegracaoApiModule],
    controllers: [RotaComEscopo],
    providers: [
      { provide: APP_GUARD, useClass: CfThrottlerGuard },
      { provide: APP_GUARD, useClass: CloudOnlyGuard },
    ],
  })
  class AppTeste {}

  async function subir(): Promise<{ app: INestApplication; origem: string }> {
    const a = await NestFactory.create(AppTeste, { logger: false });
    a.setGlobalPrefix('api/v1', { exclude: ROTAS_FORA_DO_PREFIXO });
    await a.listen(0, '127.0.0.1');
    return { app: a, origem: `http://127.0.0.1:${(a.getHttpServer().address() as any).port}` };
  }

  /** Uma chamada à API. `token`: o `Authorization: Bearer`; `ligacao`: o `DMS-Ligacao`. */
  const chamar = (caminho: string, o: { token?: string | null; ligacao?: string | null; method?: string; corpo?: unknown; em?: string } = {}) =>
    fetch(`${o.em ?? origem}${caminho}`, {
      method: o.method ?? (o.corpo === undefined ? 'GET' : 'POST'),
      headers: {
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.ligacao ? { 'DMS-Ligacao': o.ligacao } : {}),
        ...(o.corpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: o.corpo === undefined ? undefined : JSON.stringify(o.corpo),
    });

  const trocar = (token: string | null, tokenIntegracao: unknown, em?: string) =>
    chamar('/api/v1/integracao/dms-id/ligacao', { token, corpo: { token_integracao: tokenIntegracao }, em });

  async function empresa(nome: string, lojas: string[]) {
    const [e] = await q(`insert into empresa (nome) values ($1) returning id`, [`${nome} ${randomUUID().slice(0, 6)}`]);
    empresas.push(e.id);
    const ids: string[] = [];
    for (const [i, l] of lojas.entries()) {
      const [u] = await q(
        `insert into unidade (tenant_id, nome, tipo, created_at) values ($1, $2, $3, now() - make_interval(mins => $4))
         returning id`,
        [e.id, l, i === 0 ? 'matriz' : 'filial', 100 - i],
      );
      ids.push(u.id);
    }
    return { tenant: e.id as string, lojas: ids };
  }

  async function presidente(tenant: string, nome: string, emailDela: string | null) {
    const [f] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, 'presidente') returning id`, [
      tenant,
      `${nome} (função)`,
    ]);
    const [c] = await q(`insert into colaborador (tenant_id, nome, funcao_id, email) values ($1, $2, $3, $4) returning id`, [
      tenant,
      nome,
      f.id,
      emailDela,
    ]);
    return c.id as string;
  }

  async function emitir(tenant: string, loja: string, pres: string, escopos: string[], cliente = 'liame') {
    const r = await svc.emitir(
      { tenantId: tenant, unidadeId: loja, autorizadoPor: pres, escopos, cliente, evidencia: 'autorização por escrito (teste)' },
      dist,
    );
    segredos.push(r.token);
    return r;
  }

  /** Emite o token e troca pela ligação (com o aplicativo do cliente). */
  async function ligada(tenant: string, loja: string, pres: string, escopos: string[], cliente = 'liame') {
    const t = await emitir(tenant, loja, pres, escopos, cliente);
    const r = await trocar(dmsId.emitir({ aplicativo: cliente === 'farol' ? APP_FAROL : APP_LIAME }), t.token);
    expect(r.status).toBe(200);
    const corpo: any = await r.json();
    segredos.push(corpo.ligacao);
    return { token: t, ligacao: corpo.ligacao as string, corpo };
  }

  let A: { tenant: string; lojas: string[] };
  let B: { tenant: string; lojas: string[] };
  let presA = '';
  let presB = '';

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a API é da NUVEM
    process.env.APP_URL = 'https://app.exemplo.test';
    await pool.query(`create schema ${SCHEMA}`);
    await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig('295_integracao_token_loja.sql'))));
    // A trava dos escopos de hoje (15, com os do Farol): a 323 pede a 303.
    await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig('303_integracao_autorizacao.sql'))));
    await repetirNaCorridaDeCatalogo(() => pool.query(mig('323_integracao_gogem.sql')));
    const r329: any = await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig('329_integracao_ligacao.sql'))));
    const conferencia = (Array.isArray(r329) ? r329[r329.length - 1] : r329).rows;
    expect(conferencia.map((l: any) => [l.objeto, l.ok])).toEqual(conferencia.map((l: any) => [l.objeto, true]));
    expect(conferencia).toHaveLength(6);
    // De novo: a 329 é idempotente.
    await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig('329_integracao_ligacao.sql'))));
    const [fk] = await q(
      `select count(*)::int n from pg_constraint c join pg_namespace s on s.oid = c.connamespace
        where s.nspname = $1 and c.contype = 'f'
          and c.confrelid in ('public.empresa'::regclass, 'public.unidade'::regclass)`,
      [SCHEMA],
    );
    if (fk.n) throw new Error('a cópia das tabelas ainda aponta para empresa/unidade compartilhadas');

    A = await empresa('Empresa A', ['A1 matriz', 'A2 filial', 'A3 fecha']);
    B = await empresa('Empresa B', ['B1']);
    presA = await presidente(A.tenant, 'Ana Presidente', 'presidente.a@exemplo.test');
    presB = await presidente(B.tenant, 'Bruno Presidente', null);

    dmsId = await subirDmsIdFalso(() => recurso);
    ({ app, origem } = await subir());
    recurso = `${origem}/api/v1/integracao`;
    process.env.DMS_ID_LIGADO = 'true';
    process.env.DMS_ID_EMISSOR = dmsId.emissor;
    process.env.DMS_ID_RECURSO = recurso;
    process.env.DMS_ID_APLICATIVOS = JSON.stringify({ liame: APP_LIAME, farol: APP_FAROL });
  });

  afterAll(async () => {
    await app?.close();
    await new Promise((r) => dmsId?.servidor.close(r));
    for (const k of ENV) {
      if (envOriginal[k] === undefined) delete process.env[k];
      else process.env[k] = envOriginal[k];
    }
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  }, 120_000);

  it('desligada: metadados e troca respondem 404, e o 401 de sempre ganha o desafio (WWW-Authenticate)', async () => {
    const t = await emitir(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
    process.env.DMS_ID_LIGADO = 'false';
    try {
      const m = await chamar(`/${CAMINHO_DOS_METADADOS}`);
      expect(m.status).toBe(404);
      expect(m.headers.get('content-type')).toContain('application/problem+json');
      const x = await trocar(dmsId.emitir(), t.token);
      expect(x.status).toBe(404);
      expect(((await x.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}nao-encontrado`);
      // Desligada, o token do DMS ID é só um Bearer que não é `rgm_it_`: o 401 de sempre, com o desafio.
      const comJwt = await chamar('/api/v1/integracao/loja', { token: dmsId.emitir(), ligacao: gerarChave('lg', 'regem').chave });
      expect(comJwt.status).toBe(401);
      expect(((await comJwt.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}token-invalido`);
      expect(comJwt.headers.get('www-authenticate')).toBe('Bearer error="invalid_token"');
      const sem = await chamar('/api/v1/integracao/loja');
      expect(sem.status).toBe(401);
      expect(sem.headers.get('www-authenticate')).toBe('Bearer');
      expect((await chamar('/api/v1/integracao/loja', { token: t.token })).status).toBe(200);
    } finally {
      process.env.DMS_ID_LIGADO = 'true';
    }
  });

  it('ligada: os metadados do recurso (RFC 9728) apontam o DMS ID e as permissões do Regem', async () => {
    const r = await chamar(`/${CAMINHO_DOS_METADADOS}`);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toContain('max-age=300');
    expect(await r.json()).toEqual({
      resource: recurso,
      authorization_servers: [dmsId.emissor],
      scopes_supported: [...ESCOPOS_INTEGRACAO],
      bearer_methods_supported: ['header'],
      resource_name: 'Regem (API de integração)',
    });
  });

  it('a troca: o rgm_it_ vira a ligação, o segredo sai uma vez, a auditoria registra e o presidente é avisado', async () => {
    email.mockClear();
    const t = await emitir(A.tenant, A.lojas[0], presA, ['pedidos.ler', 'cupons.ler', 'cupons.criar']);
    const acessos = async () => (await q(`select count(*)::int n from integracao_token_loja where tenant_id = $1`, [A.tenant]))[0].n;
    const antes = await acessos();
    const r = await trocar(dmsId.emitir(), t.token);
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    const corpo: any = await r.json();
    segredos.push(corpo.ligacao);
    expect(corpo.ligacao).toMatch(FORMATO_LIGACAO);
    expect(corpo).toEqual({
      ligacao: corpo.ligacao,
      prefixo: corpo.ligacao.slice(0, 18),
      loja_id: A.lojas[0],
      permissoes: ['pedidos.ler', 'cupons.ler', 'cupons.criar'],
      segredo_em: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
    // V51: a ligação não é um acesso novo — nenhuma linha de token nasce, e o que liga carimbador, avisos e "conectado"
    // continua sendo o token de antes.
    expect(await acessos()).toBe(antes);
    const [l] = await q(`select * from integracao_ligacao where id = $1`, [t.id]);
    expect(l).toMatchObject({
      id: t.id,
      tenant_id: A.tenant,
      aplicativo: APP_LIAME,
      prefixo: corpo.prefixo,
      segredo_hash: createHash('sha256').update(corpo.ligacao).digest('hex'),
      revogado_em: null,
    });
    const log = registros.filter((e) => e.entidadeId === t.id && e.acao === 'integracao.ligacao_criada');
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ tenantId: A.tenant, unidadeId: A.lojas[0], atorTipo: 'integracao', entidadeTipo: 'integracao_ligacao' });
    expect(log[0].detalhe).toEqual({ cliente: 'liame', prefixo: corpo.prefixo, token: t.prefixo });
    // O aviso ao dono (Padrão §3, B1-4): e-mail ao presidente, com a loja, sem o aplicativo do DMS ID.
    expect(await esperarAte(() => email.mock.calls.length > 0)).toBe(true);
    const [para, assunto, html, texto] = email.mock.calls[0];
    expect(para).toBe('presidente.a@exemplo.test');
    expect(assunto).toBe('O acesso do Liame à loja A1 matriz mudou de forma');
    expect(texto).toContain('Ana, desde ');
    expect(texto).toContain('https://app.exemplo.test/integracoes');
    for (const t2 of [html, texto, assunto]) {
      expect(t2).not.toContain(APP_LIAME);
      expect(t2).not.toContain(corpo.ligacao);
    }
  });

  it('pela ligação: o mesmo contexto do token, com as permissões que a loja deu E o token do DMS ID tem', async () => {
    const { token, ligacao } = await ligada(A.tenant, A.lojas[1], presA, ['pedidos.ler', 'cupons.ler', 'cupons.criar']);
    const soLeitura = dmsId.emitir({ scope: 'pedidos.ler cupons.ler catalogo.ler' });
    const loja = await chamar('/api/v1/integracao/loja', { token: soLeitura, ligacao });
    expect(loja.status).toBe(200);
    expect(await loja.json()).toMatchObject({ loja_id: A.lojas[1], loja_nome: 'A2 filial', escopos: ['pedidos.ler', 'cupons.ler'] });
    // A rota exige cupons.criar: a loja deu, o token do DMS ID não tem → 403 com o desafio.
    const sem = await chamar('/api/v1/integracao/teste-escopo', { token: soLeitura, ligacao });
    expect(sem.status).toBe(403);
    expect(await sem.json()).toMatchObject({ type: `${BASE_TIPO_PROBLEMA}escopo-insuficiente`, detail: 'Esta ligação não tem o escopo cupons.criar.' });
    expect(sem.headers.get('www-authenticate')).toContain('error="insufficient_scope", scope="cupons.criar"');
    expect((await chamar('/api/v1/integracao/teste-escopo', { token: dmsId.emitir(), ligacao })).status).toBe(200);
    // O rgm_it_ segue valendo ao lado, e o último uso pela ligação chega à ligação e ao token.
    expect((await chamar('/api/v1/integracao/loja', { token: token.token })).status).toBe(200);
    expect(
      await esperarAte(async () => {
        const [x] = await q(
          `select l.ultimo_uso_em is not null as l, t.ultimo_uso_em is not null as t
             from integracao_ligacao l join integracao_token_loja t on t.id = l.id where l.id = $1`,
          [token.id],
        );
        return x.l && x.t;
      }),
    ).toBe(true);
  });

  it('repetir a troca gira o segredo: o anterior para de valer na hora, e o dono não é avisado de novo', async () => {
    // Empresa só deste teste: o aviso sai sem esperar, e o de outro teste pode chegar a qualquer momento.
    const G = await empresa('Empresa G', ['G1 giro']);
    const presG = await presidente(G.tenant, 'Gil Presidente', 'presidente.g@exemplo.test');
    const daLojaG = () => email.mock.calls.filter((c) => String(c[1]).includes('G1 giro')).length;
    const { token, ligacao } = await ligada(G.tenant, G.lojas[0], presG, ['pedidos.ler']);
    expect(await esperarAte(() => daLojaG() === 1)).toBe(true);
    const r = await trocar(dmsId.emitir(), token.token);
    expect(r.status).toBe(200);
    const nova: any = await r.json();
    segredos.push(nova.ligacao);
    expect(nova.ligacao).not.toBe(ligacao);
    const velha = await chamar('/api/v1/integracao/loja', { token: dmsId.emitir(), ligacao });
    expect(velha.status).toBe(401);
    expect(((await velha.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}ligacao-invalida`);
    expect((await chamar('/api/v1/integracao/loja', { token: dmsId.emitir(), ligacao: nova.ligacao })).status).toBe(200);
    expect(registros.filter((e) => e.entidadeId === token.id && e.acao.startsWith('integracao.ligacao_')).map((e) => e.acao)).toEqual([
      'integracao.ligacao_criada',
      'integracao.ligacao_girada',
    ]);
    await new Promise((res) => setTimeout(res, 500));
    expect(daLojaG()).toBe(1);
  });

  it('o token do DMS ID que não vale → 401 token-invalido com o desafio; sem permissão do Regem → 403 com todas', async () => {
    const { ligacao } = await ligada(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
    const outraChave = generateKeyPairSync('ec', { namedCurve: 'P-384' }).privateKey;
    const metadados = `${origem}/${CAMINHO_DOS_METADADOS}`;
    for (const token of [
      dmsId.emitir({ expiraEmSeg: -120 }),
      dmsId.emitir({ destino: 'https://outro-produto.exemplo.test/api/v1/mcp' }),
      dmsId.emitir({ emissor: 'https://outro-emissor.exemplo.test/oidc' }),
      dmsId.emitir({ chave: outraChave }),
      dmsId.emitir({ alg: 'none' }),
      'nem-parece-jwt',
    ]) {
      const r = await chamar('/api/v1/integracao/loja', { token, ligacao });
      expect(r.status).toBe(401);
      expect(((await r.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}token-invalido`);
      const desafio = r.headers.get('www-authenticate') ?? '';
      expect(desafio).toContain(`resource_metadata="${metadados}"`);
      expect(desafio).toContain('error="invalid_token"');
    }
    const semToken = await chamar('/api/v1/integracao/loja', { ligacao });
    expect(semToken.status).toBe(401);
    expect(semToken.headers.get('www-authenticate')).toMatch(/^Bearer resource_metadata="[^"]+", scope="/);
    for (const scope of ['', 'orcamento.ler campanha.disparar']) {
      const r = await chamar('/api/v1/integracao/loja', { token: dmsId.emitir({ scope }), ligacao });
      expect(r.status).toBe(403);
      expect(((await r.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}escopo-insuficiente`);
      expect(r.headers.get('www-authenticate')).toContain(`error="insufficient_scope", scope="${ESCOPOS_INTEGRACAO.join(' ')}"`);
    }
  });

  it('a ligação que não vale → 401 ligacao-invalida, a MESMA resposta para todo motivo', async () => {
    const boa = await ligada(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
    const revogadoToken = await ligada(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
    await svc.revogarPeloConsole(revogadoToken.token.id, 'teste do acoplamento', dist);
    const revogadaSozinha = await ligada(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
    await q(`update integracao_ligacao set revogado_em = now(), revogado_por = 'teste' where id = $1`, [revogadaSozinha.token.id]);
    const lojaApagada = await ligada(A.tenant, A.lojas[2], presA, ['pedidos.ler']);
    await q(`update unidade set deleted_at = now() where id = $1`, [A.lojas[2]]);
    const vencido = await ligada(B.tenant, B.lojas[0], presB, ['pedidos.ler']);
    await q(`update integracao_token_loja set expira_em = now() - interval '1 minute' where id = $1`, [vencido.token.id]);

    const tokenA = dmsId.emitir();
    const casos: [string, { token: string; ligacao?: string }][] = [
      ['sem o cabeçalho', { token: tokenA }],
      ['inexistente', { token: tokenA, ligacao: gerarChave('lg', 'regem').chave }],
      ['de outro produto', { token: tokenA, ligacao: gerarChave('lg', 'regemcast').chave }],
      ['com a conferência errada', { token: tokenA, ligacao: `${boa.ligacao.slice(0, -1)}${boa.ligacao.endsWith('A') ? 'B' : 'A'}` }],
      ['token revogado pelo console', { token: tokenA, ligacao: revogadoToken.ligacao }],
      ['ligação revogada sozinha', { token: tokenA, ligacao: revogadaSozinha.ligacao }],
      ['loja apagada', { token: tokenA, ligacao: lojaApagada.ligacao }],
      ['token vencido', { token: tokenA, ligacao: vencido.ligacao }],
      ['aplicativo fora da lista', { token: dmsId.emitir({ aplicativo: APP_FORA }), ligacao: boa.ligacao }],
      ['de outro aplicativo da lista', { token: dmsId.emitir({ aplicativo: APP_FAROL }), ligacao: boa.ligacao }],
    ];
    const vistos: string[] = [];
    for (const [nome, c] of casos) {
      const r = await chamar('/api/v1/integracao/loja', c);
      const corpo: any = await r.json();
      expect([nome, r.status, corpo.type, corpo.detail]).toEqual([nome, 401, `${BASE_TIPO_PROBLEMA}ligacao-invalida`, LIGACAO_INVALIDA]);
      expect([nome, r.headers.get('www-authenticate')]).toEqual([nome, expect.stringMatching(/^Bearer resource_metadata="[^"]+", scope="/)]);
      vistos.push(`${r.headers.get('content-type')} ${semRastreio(corpo)}`);
    }
    expect(new Set(vistos).size).toBe(1);
    // A boa segue lendo.
    expect((await chamar('/api/v1/integracao/loja', { token: tokenA, ligacao: boa.ligacao })).status).toBe(200);
  });

  it('a troca recusa o que não vale (ligacao-invalida, a mesma frase); cada aplicativo troca só o do cliente dele', async () => {
    const farol = await emitir(A.tenant, A.lojas[0], presA, ['catalogo.ler'], 'farol');
    const revogado = await emitir(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
    await svc.revogarPeloConsole(revogado.id, 'teste da troca', dist);
    const comLigacaoRevogada = await ligada(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
    await q(`update integracao_ligacao set revogado_em = now(), revogado_por = 'teste' where id = $1`, [comLigacaoRevogada.token.id]);
    const tokenLiame = dmsId.emitir();
    for (const [nome, r] of [
      ['sem token_integracao', await chamar('/api/v1/integracao/dms-id/ligacao', { token: tokenLiame, corpo: {} })],
      ['fora do formato', await trocar(tokenLiame, 'rgm_it_curto')],
      ['desconhecido', await trocar(tokenLiame, `rgm_it_${'x'.repeat(43)}`)],
      ['revogado', await trocar(tokenLiame, revogado.token)],
      ['do Farol pelo aplicativo do Liame', await trocar(tokenLiame, farol.token)],
      ['do Farol por aplicativo fora da lista', await trocar(dmsId.emitir({ aplicativo: APP_FORA }), farol.token)],
      ['com a ligação revogada sozinha', await trocar(tokenLiame, comLigacaoRevogada.token.token)],
    ] as const) {
      const corpo: any = await r.json();
      expect([nome, r.status, corpo.type, corpo.detail]).toEqual([nome, 401, `${BASE_TIPO_PROBLEMA}ligacao-invalida`, TROCA_RECUSADA]);
    }
    // O token do DMS ID que não vale, na troca: 401 token-invalido com o desafio.
    const ruim = await trocar(dmsId.emitir({ expiraEmSeg: -120 }), farol.token);
    expect(ruim.status).toBe(401);
    expect(((await ruim.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}token-invalido`);
    expect(ruim.headers.get('www-authenticate')).toContain('error="invalid_token"');
    // O do Farol troca pelo aplicativo do Farol, e lê só o que a loja deu E o token tem.
    const ok = await trocar(dmsId.emitir({ aplicativo: APP_FAROL, scope: 'catalogo.ler fichas.ler' }), farol.token);
    expect(ok.status).toBe(200);
    const corpo: any = await ok.json();
    segredos.push(corpo.ligacao);
    expect(corpo.permissoes).toEqual(['catalogo.ler']);
    const loja = await chamar('/api/v1/integracao/loja', { token: dmsId.emitir({ aplicativo: APP_FAROL, scope: 'catalogo.ler' }), ligacao: corpo.ligacao });
    expect(await loja.json()).toMatchObject({ loja_id: A.lojas[0], escopos: ['catalogo.ler'] });
  });

  it('revogar pela ligação desliga o acesso inteiro (é a mesma linha do token)', async () => {
    const { token, ligacao } = await ligada(B.tenant, B.lojas[0], presB, ['pedidos.ler']);
    const r = await chamar('/api/v1/integracao/autorizacao/revogar', { token: dmsId.emitir(), ligacao, method: 'POST' });
    expect(r.status).toBe(200);
    expect(((await r.json()) as any).revogado).toBe(true);
    const depois = await chamar('/api/v1/integracao/loja', { token: dmsId.emitir(), ligacao });
    expect(depois.status).toBe(401);
    expect(((await depois.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}ligacao-invalida`);
    const pelo = await chamar('/api/v1/integracao/loja', { token: token.token });
    expect(pelo.status).toBe(401);
    expect(((await pelo.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}token-invalido`);
    const [linha] = await q(`select revogado_por from integracao_token_loja where id = $1`, [token.id]);
    expect(linha.revogado_por).toBe('integracao:liame');
  });

  it('tirar o aplicativo da lista (DMS_ID_APLICATIVOS) corta as ligações dele na chamada seguinte', async () => {
    const { ligacao } = await ligada(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
    const lista = process.env.DMS_ID_APLICATIVOS;
    process.env.DMS_ID_APLICATIVOS = JSON.stringify({ farol: APP_FAROL });
    try {
      const r = await chamar('/api/v1/integracao/loja', { token: dmsId.emitir(), ligacao });
      expect(r.status).toBe(401);
      expect(((await r.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}ligacao-invalida`);
    } finally {
      process.env.DMS_ID_APLICATIVOS = lista;
    }
    expect((await chamar('/api/v1/integracao/loja', { token: dmsId.emitir(), ligacao })).status).toBe(200);
  });

  it('a distribuição troca o aplicativo do cliente: a ligação do aplicativo antigo para, e o novo troca de novo', async () => {
    const APP_LIAME_NOVO = 'aplicativo-liame-novo-de-teste';
    const { token, ligacao } = await ligada(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
    const lista = process.env.DMS_ID_APLICATIVOS;
    process.env.DMS_ID_APLICATIVOS = JSON.stringify({ liame: APP_LIAME_NOVO, farol: APP_FAROL });
    try {
      const novo = dmsId.emitir({ aplicativo: APP_LIAME_NOVO });
      // A ligação pertence ao aplicativo que a trocou (Padrão §2.1), mesmo com o novo cadastrado para o cliente.
      const r = await chamar('/api/v1/integracao/loja', { token: novo, ligacao });
      expect(r.status).toBe(401);
      expect(((await r.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}ligacao-invalida`);
      // O novo troca o mesmo rgm_it_: a ligação passa a ser dele, e a do antigo não volta.
      const x = await trocar(novo, token.token);
      expect(x.status).toBe(200);
      const nova: any = await x.json();
      segredos.push(nova.ligacao);
      expect((await chamar('/api/v1/integracao/loja', { token: novo, ligacao: nova.ligacao })).status).toBe(200);
      expect((await chamar('/api/v1/integracao/loja', { token: dmsId.emitir(), ligacao: nova.ligacao })).status).toBe(401);
      const [l] = await q(`select aplicativo from integracao_ligacao where id = $1`, [token.id]);
      expect(l.aplicativo).toBe(APP_LIAME_NOVO);
    } finally {
      process.env.DMS_ID_APLICATIVOS = lista;
    }
  });

  it('o limite é um só para as duas vias (o id do token): a 61ª chamada no minuto → 429 com Retry-After', async () => {
    const { token, ligacao } = await ligada(B.tenant, B.lojas[0], presB, ['pedidos.ler']);
    const jwt = dmsId.emitir();
    for (let i = 0; i < LIMITE_INTEGRACAO_POR_MINUTO; i++) {
      const r = i % 2 ? await chamar('/api/v1/integracao/loja', { token: jwt, ligacao }) : await chamar('/api/v1/integracao/loja', { token: token.token });
      expect([i, r.status]).toEqual([i, 200]);
    }
    const r = await chamar('/api/v1/integracao/loja', { token: jwt, ligacao });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await r.json()).toMatchObject({ type: `${BASE_TIPO_PROBLEMA}limite-de-chamadas`, detail: expect.stringContaining('esta ligação') });
    expect((await chamar('/api/v1/integracao/loja', { token: token.token })).status).toBe(429);
  });

  it('a isenção do limite por IP vale para a credencial validada (token E ligação), nunca para um token com ligação inventada', async () => {
    const { ligacao } = await ligada(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
    const jwt = dmsId.emitir();
    const outra = await subir(); // balde de IP próprio: não atrapalha os outros testes
    try {
      expect((await chamar('/api/v1/integracao/loja', { token: jwt, ligacao, em: outra.origem })).status).toBe(200);
      let r: Response | null = null;
      for (let i = 0; i < 130 && (!r || r.status !== 429); i++) {
        r = await chamar('/api/v1/integracao/loja', { token: jwt, ligacao: gerarChave('lg', 'regem').chave, em: outra.origem });
      }
      expect(r!.status).toBe(429); // o token bom com ligação inventada esgota o balde do IP
      expect((await chamar('/api/v1/integracao/loja', { token: jwt, ligacao, em: outra.origem })).status).toBe(200);
    } finally {
      await outra.app.close();
    }
  });

  it('servidor da loja (EDGE_MODE=true): as rotas da via não existem (404)', async () => {
    process.env.EDGE_MODE = 'true';
    const edge = await subir();
    try {
      expect((await chamar(`/${CAMINHO_DOS_METADADOS}`, { em: edge.origem })).status).toBe(404);
      expect((await trocar(dmsId.emitir(), `rgm_it_${'x'.repeat(43)}`, edge.origem)).status).toBe(404);
    } finally {
      await edge.app.close();
      delete process.env.EDGE_MODE;
    }
  });

  itDoKit('passa no kit de conformidade do Padrão DMS, no modo do DMS ID (REST)', async () => {
    const kit = await subir(); // app própria: o balde de IP do kit não divide com os outros testes
    try {
      const recursoDoKit = `${kit.origem}/api/v1/integracao`;
      const aud = { destino: recursoDoKit };
      const lerETrocar = async (escopos: string[]) => {
        const t = await emitir(A.tenant, A.lojas[0], presA, escopos);
        const r = await trocar(dmsId.emitir(aud), t.token, kit.origem);
        expect(r.status).toBe(200);
        const c: any = await r.json();
        segredos.push(c.ligacao);
        return { token: t, ligacao: c.ligacao as string };
      };
      process.env.DMS_ID_RECURSO = recursoDoKit;
      const valida = await lerETrocar(['pedidos.ler', 'cupons.criar']);
      const revogada = await lerETrocar(['pedidos.ler', 'cupons.criar']);
      await svc.revogarPeloConsole(revogada.token.id, 'kit: ligação revogada', dist);
      const semPermissao = await lerETrocar(['pedidos.ler']);
      const credenciais = {
        KIT_TOKEN: dmsId.emitir(aud),
        KIT_LIGACAO: valida.ligacao,
        KIT_TOKEN_OUTRO_DESTINO: dmsId.emitir({ destino: 'https://outro-produto.exemplo.test/api/v1/mcp' }),
        KIT_TOKEN_VENCIDO: dmsId.emitir({ ...aud, expiraEmSeg: -120 }),
        KIT_TOKEN_SEM_PERMISSAO: dmsId.emitir({ ...aud, scope: '' }),
        KIT_TOKEN_OUTRO_APLICATIVO: dmsId.emitir({ ...aud, aplicativo: APP_FORA }),
        KIT_LIGACAO_REVOGADA: revogada.ligacao,
        KIT_LIGACAO_SEM_PERMISSAO: semPermissao.ligacao,
      };
      const config = {
        modo: 'dms_id',
        produto: 'regem',
        base: kit.origem,
        porta: 'rest',
        leitura: { caminho: '/api/v1/integracao/teste-escopo', permissao: 'cupons.criar' },
        limite: { chamadas: LIMITE_INTEGRACAO_POR_MINUTO + 1 },
        copiaDoPacote: COPIA_DO_PACOTE,
        credenciais: {
          token: 'KIT_TOKEN',
          ligacao: 'KIT_LIGACAO',
          tokenOutroDestino: 'KIT_TOKEN_OUTRO_DESTINO',
          tokenVencido: 'KIT_TOKEN_VENCIDO',
          tokenSemPermissao: 'KIT_TOKEN_SEM_PERMISSAO',
          tokenOutroAplicativo: 'KIT_TOKEN_OUTRO_APLICATIVO',
          ligacaoRevogada: 'KIT_LIGACAO_REVOGADA',
          ligacaoSemPermissao: 'KIT_LIGACAO_SEM_PERMISSAO',
        },
      };
      const pasta = mkdtempSync(join(tmpdir(), 'kit-dms-'));
      const arquivo = join(pasta, 'config.json');
      writeFileSync(arquivo, JSON.stringify(config));
      try {
        const { codigo, saida } = await new Promise<{ codigo: number | null; saida: string }>((pronto) => {
          const filho = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', KIT, arquivo], {
            env: { ...process.env, ...credenciais },
          });
          let s = '';
          filho.stdout.on('data', (d) => (s += d));
          filho.stderr.on('data', (d) => (s += d));
          filho.on('close', (c) => pronto({ codigo: c, saida: s }));
        });
        const linhas = saida.split(/\r?\n/).filter((l) => /^[✔✘–] /.test(l));
        expect({ codigo, falhas: linhas.filter((l) => l.startsWith('✘')), saida: codigo === 0 ? '' : saida }).toEqual({
          codigo: 0,
          falhas: [],
          saida: '',
        });
        // Todas as conferências do modo, e só a dos metadados da MCP pulada (a porta é REST).
        expect(linhas.filter((l) => l.startsWith('–')).map((l) => l.split(':')[0])).toEqual(['– dmsid-mcp-metadados']);
        expect(linhas.length).toBeGreaterThanOrEqual(15);
      } finally {
        rmSync(pasta, { recursive: true, force: true });
      }
    } finally {
      process.env.DMS_ID_RECURSO = recurso;
      await kit.app.close();
    }
  });

  it('o banco e a auditoria não guardam segredo: nenhum token nem ligação deste teste aparece em coluna nenhuma', async () => {
    expect(segredos.filter((s) => FORMATO_LIGACAO.test(s)).length).toBeGreaterThan(8);
    const linhas = await q(
      `select row_to_json(l)::text as j from integracao_ligacao l
       union all select row_to_json(t)::text from integracao_token_loja t`,
    );
    const tudo = [...linhas.map((x) => x.j), ...registros.map((e) => JSON.stringify(e))].join('\n');
    for (const s of segredos) {
      expect(tudo).not.toContain(s);
      expect(tudo).not.toContain(s.slice(18, 50)); // nem a parte secreta
    }
    // O aplicativo do DMS ID é da distribuição: não vai para a trilha que a loja lê.
    expect(registros.map((e) => JSON.stringify(e)).join('\n')).not.toContain(APP_LIAME);
  });
});
