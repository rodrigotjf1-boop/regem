jest.mock('../../common/mailer', () => ({
  ...jest.requireActual('../../common/mailer'),
  enviarEmail: jest.fn(async () => true),
}));

import 'reflect-metadata';
import { createHash, generateKeyPairSync, randomBytes, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Global, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { DRIZZLE } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { CfThrottlerGuard } from '../../common/cf-throttler.guard';
import { CloudOnlyGuard } from '../../common/cloud-only.guard';
import { enviarEmail } from '../../common/mailer';
import { ClienteDmsId, ClienteHub, type ItemDeParada } from '../../dms/integracao-dms';
import { AutorizacaoLojaModule } from './autorizacao-loja.module';
import { AUTORIZACAO_LOJA } from './escopos';
import { HubDmsService } from './hub-dms.service';
import { IntegracaoTokenService } from './integracao-token.service';
import { ROTAS_FORA_DO_PREFIXO } from './ligacao.regras';
import { BASE_TIPO_PROBLEMA } from './problema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A AUTORIZAÇÃO POR CLIQUE (Hub DMS, F3, parte C; mig 336) — contra o Postgres real e por HTTP de verdade (Nest com os
// guards globais de produção: limite por IP e CloudOnly). O lado do aplicativo vem com o token de um DMS ID de mentira
// que assina de verdade (ES384, como o `dms-id.http.spec`); o lado do presidente, com a sessão do Regem (JWT, como o
// `autorizacao-loja.http.spec`). Os casos espelham os do RegemCast (`autorizacao.pg.spec`, B1), com o que é do Regem:
// o presidente, a senha bcrypt, as lojas e uma ligação por loja.
//
// As tabelas da integração são só da NUVEM e o banco do CI é o de uma loja: a 295, a 303, a 329 e a 336 vêm das
// migrations de verdade, num schema só deste teste, sem as chaves estrangeiras para `empresa`/`unidade` compartilhadas
// (LIC-088, ERR-109). A auditoria é de mentira, mas grava numa cópia do `audit_log` no schema do teste: é de lá que
// "Aplicativos conectados" lê o histórico.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('autorizacao-clique.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGS, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

// Identificadores visivelmente fictícios: o repositório é público.
const APP_LIAME = 'aplicativo-liame-de-teste';
const APP_FAROL = 'aplicativo-farol-de-teste';
const APP_FORA = 'aplicativo-fora-da-lista';
const KID = 'chave-de-teste';
const VOLTA = 'https://liame.teste/v1/oauth/callback';
const SENHA = 'senha-certa-do-teste';
const FORMATO_LIGACAO = /^dms_lg_regem_[A-Za-z0-9_-]{43}_[A-Za-z0-9_-]{6}$/;
const TODAS = 'pedidos.ler clientes.anonimizacao.ler cupons.ler cupons.uso.ler custos.ler cupons.criar clientes.telefone.ler';

type DmsIdFalso = { servidor: Server; emissor: string; emitir(o?: { aplicativo?: string; destino?: string }): string };

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
    emitir(o = {}) {
      const agora = Math.floor(Date.now() / 1000);
      const cabeca = b64({ alg: 'ES384', typ: 'at+jwt', kid: KID });
      const aplicativo = o.aplicativo ?? APP_LIAME;
      const corpo = b64({
        iss: emissor,
        aud: o.destino ?? recurso(),
        sub: aplicativo,
        client_id: aplicativo,
        scope: TODAS,
        iat: agora,
        exp: agora + 3600,
        jti: randomUUID(),
      });
      const assinatura = sign('sha384', Buffer.from(`${cabeca}.${corpo}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
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

/** Um CNPJ fictício: a raiz inventada, a filial e dígitos verificadores que não conferem. */
const cnpjFicticio = (raiz: string, filial = '0001') => `${raiz}${filial}00`;
const raizNova = () => String(10_000_000 + Math.floor(Math.random() * 89_999_999));

descrever('autorização por clique (Hub DMS, F3, parte C)', () => {
  const SCHEMA = `teste_clique_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 8 });
  const db = drizzle(pool) as any;
  const registros: any[] = [];
  const auditoria = {
    registrar: async (e: any) => {
      registros.push(e);
      await pool
        .query(
          `insert into audit_log (tenant_id, unidade_id, actor_tipo, actor_id, actor_perfil, tipo, acao, entidade_tipo, entidade_id, detalhe, origem)
           values ($1, $2, coalesce($3, 'usuario'), $4, $5, $6, $7, $8, $9, $10, coalesce($11, 'web'))`,
          [e.tenantId, e.unidadeId ?? null, e.atorTipo ?? null, e.atorId ?? null, e.atorPerfil ?? null, e.tipo ?? null, e.acao, e.entidadeTipo ?? null, e.entidadeId ?? null, e.detalhe ? JSON.stringify(e.detalhe) : null, e.origem ?? null],
        )
        .catch(() => {});
    },
  } as unknown as AuditoriaService;
  const tokensSvc = new IntegracaoTokenService(db, auditoria);
  const empresas: string[] = [];
  const segredos: string[] = []; // todo número, código e segredo em claro deste teste — nenhum pode estar no banco
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const email = enviarEmail as unknown as jest.Mock;
  const ENV = [
    'EDGE_MODE', 'TRUST_CLOUDFLARE', 'CARDAPIO_PUBLIC_URL', 'APP_URL', 'ACEITAR_INTEGRACOES',
    'DMS_ID_LIGADO', 'DMS_ID_EMISSOR', 'DMS_ID_RECURSO', 'DMS_ID_APLICATIVOS',
    'AUTORIZACAO_POR_CLIQUE', 'AUTORIZACAO_DMS_RAZAO_SOCIAL', 'AUTORIZACAO_DMS_CNPJ',
    AUTORIZACAO_LOJA.liame.envRedirect, AUTORIZACAO_LOJA.liame.envSegredo,
  ];
  const original: Record<string, string | undefined> = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  let app: INestApplication;
  let origem = '';
  let jwt: JwtService;
  let dmsId: DmsIdFalso;
  let hub: HubDmsService;
  let ip = 0;

  @Global()
  @Module({
    imports: [JwtModule.register({ secret: 'segredo-so-deste-teste', signOptions: { expiresIn: '1h' } })],
    providers: [{ provide: DRIZZLE, useValue: db }, { provide: AuditoriaService, useValue: auditoria }, JwtAuthGuard, RolesGuard],
    exports: [DRIZZLE, AuditoriaService, JwtModule, JwtAuthGuard, RolesGuard],
  })
  class InfraTeste {}

  @Module({
    imports: [InfraTeste, ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]), AutorizacaoLojaModule],
    providers: [
      { provide: APP_GUARD, useClass: CfThrottlerGuard },
      { provide: APP_GUARD, useClass: CloudOnlyGuard },
    ],
  })
  class AppTeste {}

  type Pessoa = { id: string; tenant: string; nome: string; cat: string };
  const sessao = (p: Pessoa) => jwt.sign({ sub: p.id, tenant: p.tenant, cat: p.cat, nome: p.nome });

  /** Uma chamada. `quem`: a sessão do Regem; `token`: o do DMS ID; `ligacao`: o `DMS-Ligacao`; `form`: corpo em formulário. */
  const chamar = (
    caminho: string,
    o: { quem?: Pessoa; token?: string | null; ligacao?: string; corpo?: any; form?: boolean; ip?: string } = {},
  ) =>
    fetch(`${origem}/api/v1${caminho}`, {
      method: o.corpo === undefined ? 'GET' : 'POST',
      headers: {
        'cf-connecting-ip': o.ip ?? `10.7.${Math.floor(++ip / 250)}.${ip % 250}`,
        ...(o.corpo === undefined ? {} : { 'content-type': o.form ? 'application/x-www-form-urlencoded' : 'application/json' }),
        ...(o.quem ? { authorization: `Bearer ${sessao(o.quem)}` } : o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.ligacao ? { 'DMS-Ligacao': o.ligacao } : {}),
      },
      body: o.corpo === undefined ? undefined : o.form ? new URLSearchParams(o.corpo).toString() : JSON.stringify(o.corpo),
    });

  async function empresa(nome: string, lojas: string[], raiz = raizNova()) {
    const [e] = await q(`insert into empresa (nome, cnpj) values ($1, $2) returning id, nome`, [`${nome} ${randomUUID().slice(0, 6)}`, cnpjFicticio(raiz)]);
    empresas.push(e.id);
    const ids: string[] = [];
    for (const [i, l] of lojas.entries()) {
      const [u] = await q(
        `insert into unidade (tenant_id, nome, tipo, created_at) values ($1, $2, $3, now() - make_interval(mins => $4)) returning id`,
        [e.id, l, i === 0 ? 'matriz' : 'filial', 100 - i],
      );
      ids.push(u.id);
    }
    return { tenant: e.id as string, nome: e.nome as string, lojas: ids, raiz };
  }
  type Emp = Awaited<ReturnType<typeof empresa>>;

  async function pessoa(tenant: string, nome: string, cat: string, o: { perfilId?: string | null; email?: string | null } = {}): Promise<Pessoa> {
    const [f] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, $3) returning id`, [tenant, `${nome} (função)`, cat]);
    const [c] = await q(
      `insert into colaborador (tenant_id, nome, funcao_id, perfil_acesso_id, email, senha_hash) values ($1, $2, $3, $4, $5, $6) returning id`,
      [tenant, nome, f.id, o.perfilId ?? null, o.email ?? null, bcrypt.hashSync(SENHA, 4)],
    );
    return { id: c.id, tenant, nome, cat };
  }

  /** O Liame empurra o pedido (em formulário, como na RFC 9126). */
  async function pedir(o: { token?: string | null; mudar?: Record<string, string>; contaCnpj?: string | null } = {}) {
    const verificador = randomBytes(48).toString('base64url');
    const state = randomBytes(24).toString('base64url');
    const corpo: Record<string, string> = {
      response_type: 'code',
      redirect_uri: VOLTA,
      scope: TODAS,
      state,
      code_challenge: createHash('sha256').update(verificador, 'ascii').digest('base64url'),
      code_challenge_method: 'S256',
      conta_nome: 'Conta do Liame',
      conta_email: 'conta@liame.exemplo',
      ...(o.contaCnpj ? { conta_cnpj: o.contaCnpj } : {}),
      ...(o.mudar ?? {}),
    };
    const r = await chamar('/integracao/autorizacao/pedido', { token: o.token === undefined ? dmsId.emitir() : o.token, corpo, form: true });
    const c: any = await r.json().catch(() => null);
    const numero = r.status === 201 ? (c.request_uri as string) : null;
    if (numero) segredos.push(numero);
    return { r, c, numero, verificador, state };
  }

  const tela = (quem: Pessoa, numero: string | null, clientId = APP_LIAME) =>
    chamar(`/integracoes/autorizacao?${new URLSearchParams({ client_id: clientId, request_uri: numero ?? '' })}`, { quem });

  async function autorizar(quem: Pessoa, numero: string | null, o: { senha?: string; lojas: string[]; opcionais?: string[]; confirmo?: boolean; ip?: string }) {
    const r = await chamar('/integracoes/autorizacao', {
      quem,
      ip: o.ip,
      // A conta do pedido de teste vem sem CNPJ, e sem CNPJ é outra empresa (Padrão §3): por padrão, confirma.
      corpo: { clientId: APP_LIAME, requestUri: numero, senha: o.senha ?? SENHA, lojas: o.lojas, opcionais: o.opcionais ?? [], confirmoOutraEmpresa: o.confirmo ?? true },
    });
    const c: any = await r.json().catch(() => null);
    const volta = r.status === 200 ? new URL(c.redirect) : null;
    const codigo = volta?.searchParams.get('code') ?? null;
    if (codigo) segredos.push(codigo);
    return { r, c, volta, codigo };
  }

  const trocar = (codigo: string | null, verificador: string, o: { token?: string; mais?: Record<string, any> } = {}) =>
    chamar('/integracao/autorizacao/token', {
      token: o.token ?? dmsId.emitir(),
      corpo: { grant_type: 'authorization_code', code: codigo, code_verifier: verificador, redirect_uri: VOLTA, ...(o.mais ?? {}) },
    });

  /** Pedido, autorização e troca, de ponta a ponta. Devolve as lojas ligadas. */
  async function ligar(quem: Pessoa, lojas: string[], opcionais: string[] = []) {
    const p = await pedir();
    const a = await autorizar(quem, p.numero, { lojas, opcionais });
    expect(a.r.status).toBe(200);
    const t = await trocar(a.codigo, p.verificador);
    const c: any = await t.json();
    expect(t.status).toBe(200);
    for (const l of c.lojas) segredos.push(l.ligacao);
    return c.lojas as any[];
  }

  /** O token antigo da loja (o do console da distribuição), em claro. */
  async function tokenDoConsole(e: Emp, loja: string, quem: Pessoa, escopos = ['pedidos.ler', 'cupons.ler']) {
    const t = (await tokensSvc.emitir({ tenantId: e.tenant, unidadeId: loja, cliente: 'liame', autorizadoPor: quem.id, escopos, evidencia: 'teste' }, dist)) as any;
    segredos.push(t.token);
    return t as { id: string; token: string };
  }

  const lerLoja = (ligacao: string) => chamar('/integracao/loja', { token: dmsId.emitir(), ligacao });

  function pararNoHub(itens: ItemDeParada[]) {
    (hub as any).cliente = new ClienteHub({
      url: 'https://hub.exemplo.test',
      recurso: 'https://hub.exemplo.test/api/v1',
      dmsId: new ClienteDmsId({ emissor: 'https://id.exemplo.test/oidc', aplicativo: 'app-regem-teste', segredo: 'segredo-de-teste-1234567' }),
      produto: 'regem',
      versao: 'teste',
      listaInicial: { versao: 1, itens },
    });
  }

  let A: Emp; // duas lojas
  let B: Emp; // uma loja
  let C: Emp; // presidente sem "Ver valores em R$"
  let presA: Pessoa;
  let gerenteA: Pessoa;
  let presA2: Pessoa;
  let presB: Pessoa;
  let presC: Pessoa;

  beforeAll(async () => {
    process.env.EDGE_MODE = '';
    delete process.env.EDGE_MODE; // a autorização é da NUVEM
    process.env.TRUST_CLOUDFLARE = 'true';
    process.env.CARDAPIO_PUBLIC_URL = 'https://cardapio.teste';
    process.env.APP_URL = 'https://app.regem.teste';
    process.env[AUTORIZACAO_LOJA.liame.envRedirect] = VOLTA;
    process.env.AUTORIZACAO_POR_CLIQUE = 'true';
    process.env.AUTORIZACAO_DMS_RAZAO_SOCIAL = 'DMS Exemplo Ltda';
    process.env.AUTORIZACAO_DMS_CNPJ = '33444555000100';
    await pool.query(`create schema ${SCHEMA}`);
    await pool.query(`create table ${SCHEMA}.audit_log (like public.audit_log including defaults)`);
    for (const m of ['295_integracao_token_loja.sql', '303_integracao_autorizacao.sql', '329_integracao_ligacao.sql']) {
      await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig(m))));
    }
    // A 336 como vai para a nuvem — a conferência dela, linha a linha — e de novo: tem de ser idempotente.
    for (let vez = 0; vez < 2; vez++) {
      const r = (await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig('336_integracao_autorizacao_clique.sql'))))) as unknown as any[];
      const conferencia = r[r.length - 1].rows;
      expect(conferencia).toHaveLength(9);
      if (conferencia.some((l: any) => l.ok !== true)) throw new Error(`conferência da 336: ${JSON.stringify(conferencia)}`);
    }
    const [fk] = await q(
      `select count(*)::int n from pg_constraint c join pg_namespace s on s.oid = c.connamespace
        where s.nspname = $1 and c.contype = 'f' and c.confrelid in ('public.empresa'::regclass, 'public.unidade'::regclass)`,
      [SCHEMA],
    );
    if (fk.n) throw new Error('as cópias das tabelas de integração ainda apontam para empresa/unidade compartilhadas');

    A = await empresa('Brasa', ['Brasa Centro', 'Brasa Praia']);
    B = await empresa('Lanche', ['Lanche Único']);
    C = await empresa('Sem Reais', ['Sem Reais Loja']);
    presA = await pessoa(A.tenant, 'Paulo Presidente', 'presidente', { email: 'paulo@brasa.exemplo' });
    presA2 = await pessoa(A.tenant, 'Marta Presidente', 'presidente', { email: 'marta@brasa.exemplo' });
    gerenteA = await pessoa(A.tenant, 'Bia Gerente', 'gerente');
    presB = await pessoa(B.tenant, 'Presidente B', 'presidente');
    const [semReais] = await q(
      `insert into perfil_acesso (tenant_id, nome, nivel, permissoes) values ($1, 'Presidente sem R$', 'presidente', $2) returning id`,
      [C.tenant, JSON.stringify({ dashboard: true, ver_financeiro: false })],
    );
    presC = await pessoa(C.tenant, 'Presidente C', 'presidente', { perfilId: semReais.id });

    dmsId = await subirDmsIdFalso(() => `${origem}/api/v1/integracao`);
    process.env.DMS_ID_LIGADO = 'true';
    process.env.DMS_ID_EMISSOR = dmsId.emissor;
    process.env.DMS_ID_APLICATIVOS = JSON.stringify({ liame: APP_LIAME, farol: APP_FAROL });
    app = await NestFactory.create(AppTeste, { logger: false });
    app.setGlobalPrefix('api/v1', { exclude: ROTAS_FORA_DO_PREFIXO });
    await app.listen(0, '127.0.0.1');
    origem = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
    process.env.DMS_ID_RECURSO = `${origem}/api/v1/integracao`;
    jwt = app.get(JwtService);
    hub = app.get(HubDmsService);
  });

  afterEach(() => {
    (hub as any).cliente = null;
    delete process.env.ACEITAR_INTEGRACOES;
    process.env.AUTORIZACAO_POR_CLIQUE = 'true';
  });

  afterAll(async () => {
    await app?.close();
    await new Promise((ok) => dmsId?.servidor.close(ok));
    // Nenhum segredo em claro ficou no banco (nem no texto guardado, nem na auditoria).
    const tudo = JSON.stringify(await q(`select * from integracao_autorizacao`)) + JSON.stringify(await q(`select * from integracao_pedido`)) + JSON.stringify(registros);
    const vazou = segredos.filter((s) => tudo.includes(s));
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
    expect(vazou).toEqual([]);
  }, 120_000);

  // ───────────────────────────── o pedido empurrado ─────────────────────────────

  describe('o pedido empurrado', () => {
    it('com o token do DMS ID, em formulário, devolve o número (uso único, 10 minutos) e guarda só o resumo dele', async () => {
      const p = await pedir({ contaCnpj: '44.555.666/0001-00' });
      expect(p.r.status).toBe(201);
      expect(p.r.headers.get('cache-control')).toBe('no-store');
      expect(p.c).toEqual({ request_uri: expect.stringMatching(/^urn:ietf:params:oauth:request_uri:rgm_[A-Za-z0-9_-]{43}$/), expires_in: 600 });
      const [g] = await q(
        `select cliente, aplicativo, numero_hash, redirect_uri, necessarias, opcionais, conta_que_pede, usado_em,
                extract(epoch from (vence_em - criado_em))::int as vale_seg
           from integracao_pedido where numero_hash = $1`,
        [createHash('sha256').update(p.numero as string).digest('hex')],
      );
      expect(g).toMatchObject({
        cliente: 'liame',
        aplicativo: APP_LIAME,
        redirect_uri: VOLTA,
        necessarias: ['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler'],
        opcionais: ['clientes.telefone.ler', 'custos.ler', 'cupons.criar'],
        conta_que_pede: { nome: 'Conta do Liame', cnpj: '44555666000100', email: 'conta@liame.exemplo', marca: null },
        usado_em: null,
        vale_seg: 600,
      });
    });

    it('sem token: 401 em problem+json, com o desafio do Bearer e os metadados do recurso', async () => {
      const p = await pedir({ token: null });
      expect(p.r.status).toBe(401);
      expect(p.r.headers.get('content-type')).toContain('application/problem+json');
      expect(p.r.headers.get('www-authenticate')).toContain(`resource_metadata="${origem}/.well-known/oauth-protected-resource/api/v1/integracao"`);
    });

    it('token para outro destino: 401; aplicativo da lista que não usa o clique: 401 cliente-invalido; campo errado: 400 com a frase', async () => {
      expect((await pedir({ token: dmsId.emitir({ destino: 'https://outro.exemplo/api' }) })).r.status).toBe(401);
      const farol = await pedir({ token: dmsId.emitir({ aplicativo: APP_FAROL }) });
      expect(farol.r.status).toBe(401);
      expect(farol.c).toMatchObject({ type: `${BASE_TIPO_PROBLEMA}cliente-invalido`, detail: 'Este aplicativo não usa a autorização por clique do Regem.' });
      const fora = await pedir({ token: dmsId.emitir({ aplicativo: APP_FORA }) });
      expect(fora.c).toMatchObject({ type: `${BASE_TIPO_PROBLEMA}cliente-invalido` });
      const torto = await pedir({ mudar: { redirect_uri: 'https://ataque.exemplo/cb' } });
      expect(torto.r.status).toBe(400);
      expect(torto.c).toMatchObject({ type: `${BASE_TIPO_PROBLEMA}parametro-invalido`, detail: 'redirect_uri não é um endereço de volta cadastrado para este aplicativo.' });
    });

    it('desligada: 404 antes do token; a chave própria desligada e o Liame parado no hub: 503 integracao-parada', async () => {
      process.env.AUTORIZACAO_POR_CLIQUE = 'false';
      expect((await pedir({ token: null })).r.status).toBe(404);
      process.env.AUTORIZACAO_POR_CLIQUE = 'true';
      process.env.ACEITAR_INTEGRACOES = 'false';
      const chave = await pedir();
      expect(chave.r.status).toBe(503);
      expect(chave.c).toMatchObject({ type: `${BASE_TIPO_PROBLEMA}integracao-parada` });
      // A chave própria vale antes do token (Padrão §10): sem token nenhum, também 503.
      expect((await pedir({ token: null })).r.status).toBe(503);
      delete process.env.ACEITAR_INTEGRACOES;
      pararNoHub([{ nivel: 'aplicativo', produto: null, alvo: 'liame' }]);
      expect((await pedir()).r.status).toBe(503);
    });
  });

  // ───────────────────────────── a página ─────────────────────────────

  describe('a página', () => {
    it('para o presidente, a tela inteira: as lojas dele sem marcar (C-2), o custo desligado e a mesma empresa pela raiz (C-3)', async () => {
      const p = await pedir({ contaCnpj: cnpjFicticio(A.raiz, '0002') });
      const r = await tela(presA, p.numero);
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
      const c: any = await r.json();
      expect(c).toMatchObject({ situacao: 'escolha', aplicativo: { nome: 'Liame', inicio: 'https://app.agencialiame.com' }, pessoa: { nome: 'Paulo Presidente' } });
      expect(c.tela.titulo).toBe('O Liame quer ler as vendas das suas lojas');
      expect(c.tela.lojas.map((l: any) => [l.id, l.marcada, l.conectadaDesde])).toEqual([[A.lojas[0], false, null], [A.lojas[1], false, null]]);
      expect(c.tela.contaQuePede.outraEmpresa).toBe(false);
      expect(c.tela.confirmacao).toBeNull();
      expect(c.tela.opcionais.map((o: any) => [o.id, o.disponivel])).toEqual([['custos.ler', true], ['cupons.criar', true]]);
      expect(c.tela.dadosDosClientes.map((o: any) => o.id)).toEqual(['clientes.telefone.ler']);
      expect(c.tela.aplicativo).toMatchObject({ empresa: 'DMS Exemplo Ltda', cnpj: '33.444.555/0001-00' });
      expect(JSON.stringify(c)).not.toContain(B.lojas[0]);
    });

    it('quem não é presidente vê a recusa; pedido torto, de outro aplicativo ou já usado é inválido; parado é pausado; desligada é indisponível', async () => {
      const p = await pedir();
      expect(await (await tela(gerenteA, p.numero)).json()).toEqual({
        situacao: 'nao_presidente',
        aplicativo: { nome: 'Liame', inicio: 'https://app.agencialiame.com' },
        pessoa: { nome: 'Bia Gerente', nivel: 'gerente' },
      });
      expect(await (await tela(presA, 'urn:ietf:params:oauth:request_uri:rgm_torto')).json()).toMatchObject({ situacao: 'invalido', aplicativo: { nome: 'Liame' } });
      expect(await (await tela(presA, p.numero, APP_FAROL)).json()).toEqual({ situacao: 'invalido', aplicativo: null });
      pararNoHub([{ nivel: 'geral', produto: null, alvo: null }]);
      expect((await (await tela(presA, p.numero)).json()).situacao).toBe('pausado');
      (hub as any).cliente = null;
      process.env.AUTORIZACAO_POR_CLIQUE = 'false';
      expect(await (await tela(presA, p.numero)).json()).toEqual({ situacao: 'indisponivel' });
    });
  });

  // ───────────────────────────── autorizar ─────────────────────────────

  describe('autorizar', () => {
    it('devolve o endereço cadastrado com o código, o state e o iss, grava a prova com o texto e gasta o pedido', async () => {
      const p = await pedir({ contaCnpj: cnpjFicticio(A.raiz, '0003') });
      const a = await autorizar(presA, p.numero, { lojas: [A.lojas[1]], opcionais: ['cupons.criar'] });
      expect(a.r.status).toBe(200);
      expect(`${a.volta?.origin}${a.volta?.pathname}`).toBe(VOLTA);
      expect(a.volta?.searchParams.get('state')).toBe(p.state);
      expect(a.volta?.searchParams.get('iss')).toBe(origem);
      expect(a.codigo).toMatch(/^rgm_ac_[A-Za-z0-9_-]{43}$/);
      const [prova] = await q(
        `select a.lojas, a.escopos, a.autorizado_por_nome, a.outra_empresa, a.opcionais_desligados, a.texto_versao, a.texto, a.conta_que_pede,
                p.usado_em is not null as pedido_gasto
           from integracao_autorizacao a join integracao_pedido p on p.id = a.pedido_id
          where a.codigo_hash = $1`,
        [createHash('sha256').update(a.codigo as string).digest('hex')],
      );
      expect(prova).toMatchObject({
        lojas: [A.lojas[1]],
        escopos: ['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler', 'cupons.criar'],
        autorizado_por_nome: 'Paulo Presidente',
        outra_empresa: false,
        opcionais_desligados: ['clientes.telefone.ler', 'custos.ler'],
        texto_versao: 1,
        pedido_gasto: true,
      });
      expect(prova.texto.titulo).toBe('O Liame quer ler as vendas das suas lojas');
      expect(prova.texto.lojas.map((l: any) => l.marcada)).toEqual([false, true]);
      expect(prova.texto.opcionais.map((o: any) => [o.id, o.ligada])).toEqual([['custos.ler', false], ['cupons.criar', true]]);
      const aud = registros.find((x) => x.acao === 'integracao.autorizacao_concedida' && x.detalhe?.via === 'clique' && x.entidadeId);
      expect(aud?.detalhe).toMatchObject({ cliente: 'liame', textoVersao: 1, outraEmpresa: false, autorizadoPor: 'Paulo Presidente' });
      // O pedido gasto não serve de novo.
      expect((await autorizar(presA, p.numero, { lojas: [A.lojas[1]] })).r.status).toBe(410);
    });

    it('o gerente recebe 403 e nada é gravado; recusar volta com access_denied, state e iss e gasta o pedido', async () => {
      const p = await pedir();
      const g = await autorizar(gerenteA, p.numero, { lojas: [A.lojas[0]] });
      expect(g.r.status).toBe(403);
      expect((await q(`select count(*)::int n from integracao_pedido where numero_hash = $1 and usado_em is null`, [createHash('sha256').update(p.numero as string).digest('hex')]))[0].n).toBe(1);
      const r = await chamar('/integracoes/autorizacao/recusar', { quem: gerenteA, corpo: { clientId: APP_LIAME, requestUri: p.numero } });
      expect(r.status).toBe(200);
      const volta = new URL(((await r.json()) as any).redirect);
      expect(Object.fromEntries(volta.searchParams)).toEqual({ error: 'access_denied', state: p.state, iss: origem });
      expect((await chamar('/integracoes/autorizacao/recusar', { quem: gerenteA, corpo: { clientId: APP_LIAME, requestUri: p.numero } })).status).toBe(410);
      expect(registros.some((x) => x.acao === 'integracao.autorizacao_recusada')).toBe(true);
    });

    it('outra empresa só autoriza com a confirmação; a opcional que não foi pedida e o custo sem "Ver valores em R$" são recusados', async () => {
      const p = await pedir({ contaCnpj: '44.555.666/0001-00' });
      const sem = await autorizar(presA, p.numero, { lojas: [A.lojas[0]], confirmo: false });
      expect(sem.r.status).toBe(400);
      expect(sem.c.message).toBe('Marque a confirmação para ligar a conta de outra empresa.');
      // A recusa não gastou o pedido: com a confirmação, passa.
      const com = await autorizar(presA, p.numero, { lojas: [A.lojas[0]], confirmo: true });
      expect(com.r.status).toBe(200);
      const [prova] = await q(`select outra_empresa, texto from integracao_autorizacao where codigo_hash = $1`, [createHash('sha256').update(com.codigo as string).digest('hex')]);
      expect(prova.outra_empresa).toBe(true);
      expect(prova.texto.confirmouOutraEmpresa).toBe(true);

      const p2 = await pedir({ mudar: { scope: 'pedidos.ler cupons.ler' } });
      expect((await autorizar(presA, p2.numero, { lojas: [A.lojas[0]], opcionais: ['custos.ler'] })).r.status).toBe(400);

      const p3 = await pedir();
      const custo = await autorizar(presC, p3.numero, { lojas: [C.lojas[0]], opcionais: ['custos.ler'] });
      expect(custo.r.status).toBe(400);
      expect(custo.c.message).toContain('Ver valores em R$');
      const telaC: any = await (await tela(presC, p3.numero)).json();
      expect(telaC.tela.opcionais[0]).toMatchObject({ id: 'custos.ler', disponivel: false });
    });

    it('cinco senhas erradas em 15 minutos travam a autorização (423), e travada nem a senha certa passa; a página mostra a trava', async () => {
      const p = await pedir();
      const status: number[] = [];
      const frases: string[] = [];
      for (let i = 0; i < 5; i++) {
        const a = await autorizar(presA2, p.numero, { lojas: [A.lojas[0]], senha: 'errada' });
        status.push(a.r.status);
        frases.push(a.c.message);
      }
      expect(status).toEqual([422, 422, 422, 422, 423]);
      expect(frases[0]).toBe('Senha incorreta. Nada foi autorizado. Mais 4 senhas erradas travam a autorização por 15 minutos.');
      expect(frases[3]).toBe('Senha incorreta. Nada foi autorizado. Mais uma senha errada trava a autorização por 15 minutos.');
      expect(frases[4]).toBe('A autorização está travada por 15 minutos: foram cinco senhas erradas seguidas. Nada foi liberado.');
      expect((await autorizar(presA2, p.numero, { lojas: [A.lojas[0]] })).r.status).toBe(423);
      expect(await (await tela(presA2, p.numero)).json()).toMatchObject({ situacao: 'travada', minutos: 15 });
      // O pedido não foi gasto e a senha do colaborador não mudou: a entrada no Regem segue normal.
      expect((await q(`select count(*)::int n from integracao_pedido where numero_hash = $1 and usado_em is null`, [createHash('sha256').update(p.numero as string).digest('hex')]))[0].n).toBe(1);
      const [c] = await q(`select senha_hash from colaborador where id = $1`, [presA2.id]);
      expect(bcrypt.compareSync(SENHA, c.senha_hash)).toBe(true);
      await q(`delete from integracao_autorizacao_trava where colaborador_id = $1`, [presA2.id]);
    });

    it('a senha errada mais velha que 15 minutos não conta para a trava; a certa zera a conta', async () => {
      await q(
        `insert into integracao_autorizacao_trava (colaborador_id, tenant_id, erros, erro_em) values ($1, $2, 4, now() - interval '16 minutes')
         on conflict (colaborador_id) do update set erros = 4, erro_em = now() - interval '16 minutes', travada_ate = null`,
        [presA2.id, A.tenant],
      );
      const p = await pedir();
      const a = await autorizar(presA2, p.numero, { lojas: [A.lojas[0]], senha: 'errada' });
      expect(a.r.status).toBe(422);
      expect(a.c.message).toContain('Mais 4 senhas erradas');
      expect((await autorizar(presA2, p.numero, { lojas: [A.lojas[0]] })).r.status).toBe(200);
      expect((await q(`select erros, travada_ate from integracao_autorizacao_trava where colaborador_id = $1`, [presA2.id]))[0]).toEqual({ erros: 0, travada_ate: null });
    });

    it('pedido vencido: a página o mostra como inválido e autorizar dá 410, mesmo com a senha certa; a senha errada nele conta', async () => {
      const p = await pedir();
      await q(`update integracao_pedido set vence_em = now() - interval '1 second', criado_em = now() - interval '11 minutes' where numero_hash = $1`, [
        createHash('sha256').update(p.numero as string).digest('hex'),
      ]);
      expect((await (await tela(presB, p.numero)).json()).situacao).toBe('invalido');
      expect((await autorizar(presB, p.numero, { lojas: [B.lojas[0]] })).r.status).toBe(410);
      expect((await autorizar(presB, p.numero, { lojas: [B.lojas[0]], senha: 'errada' })).r.status).toBe(422);
      await q(`delete from integracao_autorizacao_trava where colaborador_id = $1`, [presB.id]);
    });

    it('duas autorizações do mesmo pedido ao mesmo tempo: uma passa, a outra recebe 410', async () => {
      const p = await pedir();
      const aux = await pool.connect();
      try {
        await aux.query('begin');
        await aux.query(`select id from integracao_pedido where numero_hash = $1 for update`, [createHash('sha256').update(p.numero as string).digest('hex')]);
        const uma = autorizar(presB, p.numero, { lojas: [B.lojas[0]], ip: '10.8.0.1' });
        const outra = autorizar(presB, p.numero, { lojas: [B.lojas[0]], ip: '10.8.0.2' });
        // As duas esperam a linha do pedido (a trava da autorização); solta.
        const esperando = await esperarAte(async () => {
          const [w] = await q(`select count(*)::int n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`);
          return w.n >= 2;
        });
        expect(esperando).toBe(true);
        await aux.query('commit');
        const status = [(await uma).r.status, (await outra).r.status].sort();
        expect(status).toEqual([200, 410]);
      } finally {
        aux.release();
      }
    });
  });

  // ───────────────────────────── a troca do código ─────────────────────────────

  describe('a troca do código', () => {
    it('entrega o segredo da ligação de cada loja, a ligação lê a loja pela via do DMS ID e os presidentes recebem o e-mail', async () => {
      email.mockClear();
      const p = await pedir();
      const a = await autorizar(presA, p.numero, { lojas: A.lojas });
      const t = await trocar(a.codigo, p.verificador);
      expect(t.status).toBe(200);
      expect(t.headers.get('cache-control')).toBe('no-store');
      const c: any = await t.json();
      expect(c.lojas.map((l: any) => [l.loja_id, l.prefixo.startsWith('dms_lg_regem_'), FORMATO_LIGACAO.test(l.ligacao)])).toEqual([
        [A.lojas[0], true, true],
        [A.lojas[1], true, true],
      ]);
      for (const l of c.lojas) segredos.push(l.ligacao);
      expect(c.lojas[0]).toMatchObject({ loja_nome: 'Brasa Centro', permissoes: ['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler'] });
      expect(c.lojas[0]).not.toHaveProperty('token');
      const linhas = await q(
        `select t.unidade_id, t.autorizado_via, t.autorizacao_id is not null as do_clique, l.aplicativo
           from integracao_token_loja t join integracao_ligacao l on l.id = t.id
          where t.tenant_id = $1 and t.revogado_em is null order by t.unidade_id`,
        [A.tenant],
      );
      expect(linhas.every((l) => l.autorizado_via === 'autorizacao_loja' && l.do_clique && l.aplicativo === APP_LIAME)).toBe(true);
      const loja = await lerLoja(c.lojas[1].ligacao);
      expect(loja.status).toBe(200);
      expect(((await loja.json()) as any).loja_id).toBe(A.lojas[1]);
      expect(await esperarAte(() => email.mock.calls.length >= 2)).toBe(true);
      expect(email.mock.calls.map((x: any[]) => x[1])).toEqual([
        'O Liame foi autorizado nas lojas Brasa Centro e Brasa Praia',
        'O Liame foi autorizado nas lojas Brasa Centro e Brasa Praia',
      ]);
      expect(email.mock.calls.map((x: any[]) => x[0]).sort()).toEqual(['marta@brasa.exemplo', 'paulo@brasa.exemplo']);
    });

    it('o código usado de novo é recusado e desliga o que ele criou', async () => {
      const p = await pedir();
      const a = await autorizar(presB, p.numero, { lojas: [B.lojas[0]] });
      const t1: any = await (await trocar(a.codigo, p.verificador)).json();
      segredos.push(t1.lojas[0].ligacao);
      expect((await lerLoja(t1.lojas[0].ligacao)).status).toBe(200);
      const t2 = await trocar(a.codigo, p.verificador);
      expect(t2.status).toBe(400);
      expect(await t2.json()).toMatchObject({ type: `${BASE_TIPO_PROBLEMA}autorizacao-invalida`, detail: 'Código de autorização inválido, vencido ou já usado.' });
      expect((await lerLoja(t1.lojas[0].ligacao)).status).toBe(401);
      expect(registros.some((x) => x.acao === 'integracao.ligacao_revogada' && x.detalhe?.motivo === 'codigo_reutilizado')).toBe(true);
    });

    it('verificador errado ou endereço diferente gastam o código: a segunda tentativa, mesmo certa, não liga nada', async () => {
      for (const errado of [{ code_verifier: randomBytes(48).toString('base64url') }, { redirect_uri: 'https://liame.teste/v1/oauth/outro' }]) {
        const p = await pedir();
        const a = await autorizar(presB, p.numero, { lojas: [B.lojas[0]] });
        const antes = await q(`select count(*)::int n from integracao_ligacao where tenant_id = $1`, [B.tenant]);
        expect((await trocar(a.codigo, p.verificador, { mais: errado })).status).toBe(400);
        expect((await trocar(a.codigo, p.verificador)).status).toBe(400);
        expect(await q(`select count(*)::int n from integracao_ligacao where tenant_id = $1`, [B.tenant])).toEqual(antes);
      }
    });

    it('quem autorizou deixou de ser presidente antes da troca: recusada e nada liga', async () => {
      const ex = await pessoa(B.tenant, 'Ex Presidente', 'presidente');
      const p = await pedir();
      const a = await autorizar(ex, p.numero, { lojas: [B.lojas[0]] });
      await q(`update funcao set categoria = 'gerente' where id = (select funcao_id from colaborador where id = $1)`, [ex.id]);
      const antes = await q(`select count(*)::int n from integracao_ligacao where tenant_id = $1`, [B.tenant]);
      expect((await trocar(a.codigo, p.verificador)).status).toBe(400);
      expect(await q(`select count(*)::int n from integracao_ligacao where tenant_id = $1`, [B.tenant])).toEqual(antes);
    });

    it('o Liame parado no hub depois do clique: a troca é recusada (503) e nada liga; código de aplicativo fora da lista: 401', async () => {
      const p = await pedir();
      const a = await autorizar(presB, p.numero, { lojas: [B.lojas[0]] });
      pararNoHub([{ nivel: 'aplicativo', produto: null, alvo: 'liame' }]);
      const antes = await q(`select count(*)::int n from integracao_ligacao where tenant_id = $1`, [B.tenant]);
      expect((await trocar(a.codigo, p.verificador)).status).toBe(503);
      expect(await q(`select count(*)::int n from integracao_ligacao where tenant_id = $1`, [B.tenant])).toEqual(antes);
      (hub as any).cliente = null;
      expect((await trocar(a.codigo, p.verificador, { token: dmsId.emitir({ aplicativo: APP_FORA }) })).status).toBe(401);
    });

    it('código vencido não liga', async () => {
      const p = await pedir();
      const a = await autorizar(presB, p.numero, { lojas: [B.lojas[0]] });
      await q(`update integracao_autorizacao set expira_em = now() - interval '1 second', criado_em = now() - interval '11 minutes' where codigo_hash = $1`, [
        createHash('sha256').update(a.codigo as string).digest('hex'),
      ]);
      expect((await trocar(a.codigo, p.verificador)).status).toBe(400);
    });

    it('a loja que já lia pelo token do console: a troca soma, o token antigo e a ligação dele param de valer', async () => {
      const e = await empresa('Soma', ['Soma Loja']);
      const pres = await pessoa(e.tenant, 'Presidente Soma', 'presidente');
      const antigo = await tokenDoConsole(e, e.lojas[0], pres, ['pedidos.ler', 'custos.ler']);
      // A troca automática (parte A) já tinha dado uma ligação a esse token.
      const auto = await chamar('/integracao/dms-id/ligacao', { token: dmsId.emitir(), corpo: { token_integracao: antigo.token } });
      expect(auto.status).toBe(200);
      const ligacaoAntiga = ((await auto.json()) as any).ligacao as string;
      segredos.push(ligacaoAntiga);
      const [l] = await ligar(pres, e.lojas, ['cupons.criar']);
      expect(l.permissoes).toEqual(['pedidos.ler', 'custos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler', 'cupons.criar']);
      expect((await chamar('/integracao/loja', { token: antigo.token })).status).toBe(401);
      expect((await lerLoja(ligacaoAntiga)).status).toBe(401);
      expect((await lerLoja(l.ligacao)).status).toBe(200);
      // A troca automática com o token antigo não traz nada de volta.
      expect((await chamar('/integracao/dms-id/ligacao', { token: dmsId.emitir(), corpo: { token_integracao: antigo.token } })).status).toBe(401);
    });

    it('pedir mais uma permissão numa loja já ligada: a tela "pede mais", a loja soma num acesso novo e os presidentes recebem "passou a receber"', async () => {
      const e = await empresa('Mais', ['Mais Loja']);
      const pres = await pessoa(e.tenant, 'Presidente Mais', 'presidente', { email: 'pres@mais.exemplo' });
      email.mockClear();
      const [antes] = await ligar(pres, e.lojas);
      // O e-mail da primeira ligação sai sem esperar: espera ele chegar antes de limpar.
      expect(await esperarAte(() => email.mock.calls.length >= 1)).toBe(true);
      email.mockClear();
      const p = await pedir();
      const t: any = await (await tela(pres, p.numero)).json();
      expect(t.tela.modo).toBe('mais');
      expect(t.tela.titulo).toBe('O Liame pede mais 3 permissões');
      const a = await autorizar(pres, p.numero, { lojas: e.lojas, opcionais: ['clientes.telefone.ler'] });
      const c: any = await (await trocar(a.codigo, p.verificador)).json();
      segredos.push(c.lojas[0].ligacao);
      expect(c.lojas[0].permissoes).toEqual(['pedidos.ler', 'clientes.telefone.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler']);
      expect((await lerLoja(antes.ligacao)).status).toBe(401);
      expect((await lerLoja(c.lojas[0].ligacao)).status).toBe(200);
      expect(await esperarAte(() => email.mock.calls.length >= 1)).toBe(true);
      expect(email.mock.calls[0][1]).toBe('O Liame passou a receber o telefone do cliente na Mais Loja');
    });

    it('a corrida que só o índice único decide: a troca que chega no meio de outra da mesma loja é recusada (400, nunca 500) e fica UM acesso ativo', async () => {
      const e = await empresa('Corrida', ['Corrida Loja']);
      const pres = await pessoa(e.tenant, 'Presidente Corrida', 'presidente');
      const p = await pedir();
      const a = await autorizar(pres, p.numero, { lojas: e.lojas });
      const [aut] = await q(`select id from integracao_autorizacao where codigo_hash = $1`, [createHash('sha256').update(a.codigo as string).digest('hex')]);
      const aux = await pool.connect();
      try {
        // Outra troca da mesma loja no meio (a linha nova dela ainda não está gravada).
        await aux.query('begin');
        await aux.query(
          `insert into integracao_token_loja (tenant_id, unidade_id, cliente, prefixo, token_hash, escopos, autorizado_por, autorizado_por_nome, autorizado_via, autorizacao_id)
           values ($1, $2, 'liame', 'rgm_it_Cor01', $3, '{pedidos.ler}', $4, 'Presidente Corrida', 'autorizacao_loja', $5)`,
          [e.tenant, e.lojas[0], randomBytes(32).toString('hex'), pres.id, aut.id],
        );
        const troca = trocar(a.codigo, p.verificador);
        const esperando = await esperarAte(async () => {
          const [w] = await q(`select count(*)::int n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()`);
          return w.n >= 1;
        });
        expect(esperando).toBe(true);
        await aux.query('commit');
        const r = await troca;
        expect(r.status).toBe(400);
        expect(await r.json()).toMatchObject({ detail: 'Outra autorização desta loja terminou agora mesmo. Peça a autorização de novo.' });
      } finally {
        aux.release();
      }
      expect((await q(`select count(*)::int n from integracao_token_loja where unidade_id = $1 and revogado_em is null`, [e.lojas[0]]))[0].n).toBe(1);
    });
  });

  // ───────────────────────────── Aplicativos conectados e o fluxo de 01/10 ─────────────────────────────

  describe('Aplicativos conectados e o fluxo de 01/10', () => {
    it('mostra o acesso do clique com o texto guardado e o histórico, e revogar corta a ligação', async () => {
      const e = await empresa('Conectados', ['Conectados Loja']);
      const pres = await pessoa(e.tenant, 'Presidente Conectados', 'presidente');
      const [l] = await ligar(pres, e.lojas, ['cupons.criar']);
      const r: any = await (await chamar('/aplicativos-conectados', { quem: pres })).json();
      const acesso = r.aplicativos.find((x: any) => x.cliente === 'liame').acessos[0];
      // A conta do pedido de teste vem sem CNPJ: é outra empresa, confirmada no clique.
      expect(acesso).toMatchObject({ ativo: true, via: 'clique', lojaId: e.lojas[0], autorizacao: { por: 'Presidente Conectados', versao: 1, outraEmpresa: true } });
      expect(acesso.autorizacao.contaQuePede).toEqual({ nome: 'Conta do Liame', cnpj: null, email: 'conta@liame.exemplo', marca: null });
      expect(acesso.autorizacao.texto.titulo).toBe('O Liame quer ler as vendas da sua loja');
      expect(acesso.historico.map((h: any) => h.texto)).toEqual(['Presidente Conectados autorizou com a senha (texto versão 1).', 'A ligação foi entregue ao Liame.']);
      expect((await chamar(`/aplicativos-conectados/${acesso.id}/revogar`, { quem: pres, corpo: {} })).status).toBe(200);
      expect((await lerLoja(l.ligacao)).status).toBe(401);
    });

    it('com a chave ligada, a troca sem o token do DMS ID segue a de 01/10, e a limpeza dela não apaga a prova do clique', async () => {
      process.env[AUTORIZACAO_LOJA.liame.envSegredo] = randomBytes(32).toString('base64url');
      const e = await empresa('Velha', ['Velha Loja']);
      const pres = await pessoa(e.tenant, 'Presidente Velha', 'presidente');
      // Uma prova do clique "velha" (vencida há dias): a limpeza da página de 01/10 não pode levá-la.
      const [velha] = await q(
        `insert into integracao_autorizacao (tenant_id, cliente, codigo_hash, desafio, redirect_uri, lojas, escopos, autorizado_por, autorizado_por_nome,
                                             criado_em, expira_em, texto_versao, texto)
         values ($1, 'liame', $2, $3, $4, $5::uuid[], '{pedidos.ler}', $6, 'Presidente Velha', now() - interval '3 days', now() - interval '3 days' + interval '10 minutes', 1, '{"titulo":"x"}')
         returning id`,
        [e.tenant, randomBytes(32).toString('hex'), 'a'.repeat(43), VOLTA, `{${e.lojas[0]}}`, pres.id],
      );
      const verificador = randomBytes(48).toString('base64url');
      const r = await chamar('/integracao-autorizacao', {
        quem: pres,
        corpo: {
          cliente: 'liame', redirect_uri: VOLTA, state: randomBytes(24).toString('base64url'),
          code_challenge: createHash('sha256').update(verificador, 'ascii').digest('base64url'), code_challenge_method: 'S256',
          lojas: e.lojas, custo: false, cupom: false,
        },
      });
      expect(r.status).toBe(200);
      const codigo = new URL(((await r.json()) as any).redirect).searchParams.get('code') as string;
      segredos.push(codigo);
      const t = await chamar('/integracao/autorizacao/token', {
        corpo: { code: codigo, code_verifier: verificador, redirect_uri: VOLTA, client_id: 'liame', client_secret: process.env[AUTORIZACAO_LOJA.liame.envSegredo] },
      });
      expect(t.status).toBe(200);
      const c: any = await t.json();
      segredos.push(c.lojas[0].token);
      expect(c.lojas[0].token).toMatch(/^rgm_it_/);
      expect((await q(`select count(*)::int n from integracao_autorizacao where id = $1`, [velha.id]))[0].n).toBe(1);
    });
  });
});
