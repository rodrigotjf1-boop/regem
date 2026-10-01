import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
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
import { CfThrottlerGuard } from '../../common/cf-throttler.guard';
import { CloudOnlyGuard } from '../../common/cloud-only.guard';
import { AutorizacaoLojaModule } from './autorizacao-loja.module';
import { IntegracaoTokenService } from './integracao-token.service';
import { BASE_TIPO_PROBLEMA } from './problema';
import { AUTORIZACAO_LOJA } from './escopos';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AUTORIZAÇÃO PELA LOJA (trilha C, C1b) — contra o Postgres real e por HTTP de verdade: a página
// "Autorizar o Liame" (pedido e autorizar, com a sessão de verdade: `JwtAuthGuard` + `RolesGuard`),
// a troca do código pelos tokens (segredo de cliente + PKCE) e "Aplicativos conectados".
//
// `integracao_token_loja` (mig 295) e `integracao_autorizacao` (mig 303) são só da NUVEM e o banco
// do CI é montado como servidor de loja: as duas vêm das migrations de verdade, num schema só
// deste teste, na frente do `public` — sem as chaves estrangeiras para `empresa`/`unidade`
// compartilhadas (LIC-088).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('autorizacao-loja.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

const VOLTA = 'https://liame.teste/v1/oauth/callback';
const SEGREDO = randomBytes(32).toString('base64url');
const CFG = AUTORIZACAO_LOJA.liame;

descrever('autorização pela loja — página, troca do código e aplicativos conectados', () => {
  const SCHEMA = `teste_autorizacao_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  const db = drizzle(pool) as any;
  // Auditoria FALSA que guarda o que recebeu (o `audit_log` é append-only: com a de verdade, o
  // `delete from empresa` do fim não limparia as empresas do teste).
  const registros: any[] = [];
  const auditoria = { registrar: async (e: any) => void registros.push(e) } as unknown as AuditoriaService;
  const tokensSvc = new IntegracaoTokenService(db, auditoria);
  const empresas: string[] = [];
  const segredos: string[] = []; // todo código e token em claro deste teste — nenhum pode estar no banco nem na auditoria
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const original: Record<string, string | undefined> = {};
  const guardar = (k: string, v: string | undefined) => {
    original[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  };
  let app: INestApplication;
  let base = '';
  let jwt: JwtService;
  let ip = 0;

  @Global()
  @Module({
    imports: [JwtModule.register({ secret: 'segredo-so-deste-teste', signOptions: { expiresIn: '1h' } })],
    providers: [
      { provide: DRIZZLE, useValue: db },
      { provide: AuditoriaService, useValue: auditoria },
      JwtAuthGuard,
      RolesGuard,
    ],
    exports: [DRIZZLE, AuditoriaService, JwtModule, JwtAuthGuard, RolesGuard],
  })
  class InfraTeste {}

  @Module({
    // O módulo da autorização traz o da API de integração (o token recém-nascido é usado em `/integracao/loja`).
    imports: [InfraTeste, ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]), AutorizacaoLojaModule],
    providers: [
      { provide: APP_GUARD, useClass: CfThrottlerGuard },
      { provide: APP_GUARD, useClass: CloudOnlyGuard },
    ],
  })
  class AppTeste {}

  async function subir(): Promise<{ app: INestApplication; base: string }> {
    const a = await NestFactory.create(AppTeste, { logger: false });
    a.setGlobalPrefix('api/v1');
    await a.listen(0, '127.0.0.1');
    const porta = (a.getHttpServer().address() as any).port;
    return { app: a, base: `http://127.0.0.1:${porta}/api/v1` };
  }

  type Pessoa = { id: string; tenant: string; nome: string; cat: string };
  const sessao = (p: Pessoa) => jwt.sign({ sub: p.id, tenant: p.tenant, cat: p.cat, nome: p.nome });

  // Cada chamada vem de um "IP" novo (TRUST_CLOUDFLARE no teste): o limite por IP das rotas é
  // conferido num teste só, com o IP fixo.
  const chamar = (caminho: string, o: { quem?: Pessoa; bearer?: string; corpo?: any; ip?: string; base?: string } = {}) =>
    fetch(`${o.base ?? base}${caminho}`, {
      method: o.corpo === undefined ? 'GET' : 'POST',
      headers: {
        'cf-connecting-ip': o.ip ?? `10.9.${Math.floor(++ip / 250)}.${ip % 250}`,
        ...(o.corpo === undefined ? {} : { 'content-type': 'application/json' }),
        ...(o.quem ? { authorization: `Bearer ${sessao(o.quem)}` } : o.bearer ? { authorization: `Bearer ${o.bearer}` } : {}),
      },
      body: o.corpo === undefined ? undefined : JSON.stringify(o.corpo),
    });

  async function empresa(nome: string, lojas: string[]) {
    const [e] = await q(`insert into empresa (nome) values ($1) returning id, nome`, [`${nome} ${randomUUID().slice(0, 6)}`]);
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
    return { tenant: e.id as string, nome: e.nome as string, lojas: ids };
  }

  async function pessoa(tenant: string, nome: string, cat: string, perfilId: string | null = null): Promise<Pessoa> {
    const [f] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, $3) returning id`, [tenant, `${nome} (função)`, cat]);
    const [c] = await q(
      `insert into colaborador (tenant_id, nome, funcao_id, perfil_acesso_id) values ($1, $2, $3, $4) returning id`,
      [tenant, nome, f.id, perfilId],
    );
    return { id: c.id, tenant, nome, cat };
  }

  /** O que o Liame manda ao abrir a página: `state` e o par do PKCE. */
  function pedidoNovo() {
    const verificador = randomBytes(48).toString('base64url');
    const state = randomBytes(32).toString('base64url');
    const p = {
      cliente: 'liame',
      redirect_uri: VOLTA,
      state,
      code_challenge: createHash('sha256').update(verificador, 'ascii').digest('base64url'),
      code_challenge_method: 'S256',
    };
    return { verificador, state, p, consulta: new URLSearchParams(p).toString() };
  }

  /** O presidente autoriza: devolve o código que voltou no endereço do Liame. */
  async function autorizar(quem: Pessoa, lojas: string[], extra: Record<string, any> = { custo: true, cupom: false }) {
    const ped = pedidoNovo();
    const r = await chamar('/integracao-autorizacao', { quem, corpo: { ...ped.p, lojas, ...extra } });
    const corpo: any = await r.json();
    const volta = r.status === 200 ? new URL(corpo.redirect) : null;
    const codigo = volta?.searchParams.get('code') ?? null;
    if (codigo) segredos.push(codigo);
    return { r, corpo, volta, codigo, ...ped };
  }

  const trocar = (codigo: string | null, verificador: string, mais: Record<string, any> = {}) =>
    chamar('/integracao/autorizacao/token', {
      corpo: { code: codigo, code_verifier: verificador, redirect_uri: VOLTA, client_id: 'liame', client_secret: SEGREDO, ...mais },
    });

  let A: { tenant: string; nome: string; lojas: string[] };
  let B: { tenant: string; nome: string; lojas: string[] };
  let C: { tenant: string; nome: string; lojas: string[] };
  let presA: Pessoa;
  let gerenteA: Pessoa;
  let presB: Pessoa;
  let presC: Pessoa;

  beforeAll(async () => {
    guardar('EDGE_MODE', undefined); // a autorização é da NUVEM
    guardar('TRUST_CLOUDFLARE', 'true');
    guardar('CARDAPIO_PUBLIC_URL', 'https://cardapio.teste');
    guardar(CFG.envSegredo, SEGREDO);
    guardar(CFG.envRedirect, VOLTA);
    await pool.query(`create schema ${SCHEMA}`);
    for (const m of ['295_integracao_token_loja.sql', '303_integracao_autorizacao.sql']) {
      await pool.query(semFkCompartilhada(readFileSync(join(MIGS, m), 'utf8')));
    }
    const [fk] = await q(
      `select count(*)::int n from pg_constraint c join pg_namespace s on s.oid = c.connamespace
        where s.nspname = $1 and c.contype = 'f'
          and c.confrelid in ('public.empresa'::regclass, 'public.unidade'::regclass)`,
      [SCHEMA],
    );
    if (fk.n) throw new Error('as cópias das tabelas de integração ainda apontam para empresa/unidade compartilhadas');

    A = await empresa('Empresa A', ['A1 matriz', 'A2 filial']);
    B = await empresa('Empresa B', ['B1']);
    C = await empresa('Empresa C', ['C1']);
    presA = await pessoa(A.tenant, 'Presidente A', 'presidente');
    gerenteA = await pessoa(A.tenant, 'Gerente A', 'gerente');
    presB = await pessoa(B.tenant, 'Presidente B', 'presidente');
    const [semReais] = await q(
      `insert into perfil_acesso (tenant_id, nome, nivel, permissoes) values ($1, 'Presidente sem R$', 'presidente', $2) returning id`,
      [C.tenant, JSON.stringify({ dashboard: true, ver_financeiro: false })],
    );
    presC = await pessoa(C.tenant, 'Presidente C', 'presidente', semReais.id);
    ({ app, base } = await subir());
    jwt = app.get(JwtService);
  });

  afterAll(async () => {
    await app?.close();
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  }, 120_000);

  describe('a página: o que cada pessoa recebe', () => {
    it('o presidente vê as lojas DELE, o que vai sempre e o que ele decide; nada de outra empresa', async () => {
      const ped = pedidoNovo();
      const r = await chamar(`/integracao-autorizacao/pedido?${ped.consulta}`, { quem: presA });
      expect(r.status).toBe(200);
      const c: any = await r.json();
      expect(c).toMatchObject({
        situacao: 'ok',
        cliente: { chave: 'liame', rotulo: 'Liame', site: 'app.agencialiame.com' },
        empresa: A.nome,
        quem: { nome: 'Presidente A', verFinanceiro: true },
        cancelarUrl: `${VOLTA}?error=access_denied&state=${ped.state}`,
      });
      expect(c.lojas.map((l: any) => [l.id, l.nome, l.tipo, l.conectadaDesde])).toEqual([
        [A.lojas[0], 'A1 matriz', 'matriz', null],
        [A.lojas[1], 'A2 filial', 'filial', null],
      ]);
      expect(c.sempre.map((e: any) => e.chave)).toEqual(['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler']);
      expect(c.opcionais.map((o: any) => [o.campo, o.chave, o.padrao, o.disponivel])).toEqual([
        ['custo', 'custos.ler', true, true],
        ['cupom', 'cupons.criar', false, true],
      ]);
      expect(JSON.stringify(c)).not.toContain(B.lojas[0]);
    });

    it('quem não é presidente recebe só a recusa e o caminho de volta — sem lojas, sem escopos', async () => {
      const ped = pedidoNovo();
      const r = await chamar(`/integracao-autorizacao/pedido?${ped.consulta}`, { quem: gerenteA });
      expect(r.status).toBe(200);
      const c: any = await r.json();
      expect(c).toMatchObject({ situacao: 'nao_presidente', quem: { nome: 'Gerente A', nivel: 'gerente' }, empresa: A.nome });
      expect(c.cancelarUrl).toBe(`${VOLTA}?error=access_denied&state=${ped.state}`);
      expect(c.lojas).toBeUndefined();
      expect(c.sempre).toBeUndefined();
      expect(c.opcionais).toBeUndefined();
    });

    it('presidente sem "Ver valores em R$": a chave do custo vem travada e desligada', async () => {
      const r = await chamar(`/integracao-autorizacao/pedido?${pedidoNovo().consulta}`, { quem: presC });
      const c: any = await r.json();
      expect(c.quem).toEqual({ nome: 'Presidente C', verFinanceiro: false });
      expect(c.opcionais.find((o: any) => o.campo === 'custo')).toMatchObject({ padrao: false, disponivel: false });
      expect(c.opcionais.find((o: any) => o.campo === 'cupom')).toMatchObject({ padrao: false, disponivel: true });
    });

    it('sem sessão: 401 (a página manda entrar e volta)', async () => {
      const r = await chamar(`/integracao-autorizacao/pedido?${pedidoNovo().consulta}`);
      expect(r.status).toBe(401);
      expect((await chamar('/aplicativos-conectados')).status).toBe(401);
    });

    it('pedido que não vale para na página: 400 igual para tudo e sem endereço de volta na resposta', async () => {
      const bom = pedidoNovo().p;
      const ruins: Record<string, any>[] = [
        { ...bom, cliente: 'outro' },
        { ...bom, cliente: 'regemcast' },
        { ...bom, redirect_uri: 'https://evil.example/v1/oauth/callback' },
        { ...bom, redirect_uri: `${VOLTA}/` },
        { ...bom, redirect_uri: 'https://api.agencialiame.com/v1/oauth/callback' }, // o de produção NÃO vale quando o ambiente dá outra lista
        { ...bom, state: 'curto' },
        { ...bom, code_challenge: 'curto' },
        { ...bom, code_challenge_method: 'plain' },
        (({ code_challenge: _c, ...resto }) => resto)(bom),
        (({ state: _s, ...resto }) => resto)(bom),
      ];
      for (const p of ruins) {
        const r = await chamar(`/integracao-autorizacao/pedido?${new URLSearchParams(p).toString()}`, { quem: presA });
        expect(r.status).toBe(400);
        const texto = await r.text();
        expect(texto).toContain('Este pedido de autorização não vale');
        expect(texto).not.toContain('evil.example');
        expect(texto).not.toContain('cancelarUrl');
        // Autorizar com o mesmo pedido também recusa (a tela não é a única barreira).
        const a = await chamar('/integracao-autorizacao', { quem: presA, corpo: { ...p, lojas: [A.lojas[0]], custo: false, cupom: false } });
        expect(a.status).toBe(400);
      }
      expect(await q(`select count(*)::int n from integracao_autorizacao`)).toEqual([{ n: 0 }]);
    });

    it('sem o segredo de cliente no ambiente: 503 — a página não abre e ninguém autoriza', async () => {
      const antes = process.env[CFG.envSegredo];
      delete process.env[CFG.envSegredo];
      try {
        const ped = pedidoNovo();
        const r = await chamar(`/integracao-autorizacao/pedido?${ped.consulta}`, { quem: presA });
        expect(r.status).toBe(503);
        const a = await chamar('/integracao-autorizacao', { quem: presA, corpo: { ...ped.p, lojas: [A.lojas[0]], custo: false, cupom: false } });
        expect(a.status).toBe(503);
        // E a troca recusa todo mundo, com qualquer segredo.
        const t = await trocar(`rgm_ac_${'a'.repeat(43)}`, 'v'.repeat(64), { client_secret: '' });
        expect(t.status).toBe(401);
      } finally {
        process.env[CFG.envSegredo] = antes;
      }
    });
  });

  describe('autorizar', () => {
    it('só o presidente: gerente leva 403 e nada é gravado', async () => {
      const a = await autorizar(gerenteA, [A.lojas[0]]);
      expect(a.r.status).toBe(403);
      expect(await q(`select count(*)::int n from integracao_autorizacao`)).toEqual([{ n: 0 }]);
    });

    it('recusa: sem loja, loja de outra empresa, chave ausente (não vira "não" calado) e custo sem permissão', async () => {
      expect((await autorizar(presA, [])).r.status).toBe(400);
      expect((await autorizar(presA, ['não-é-uuid'])).r.status).toBe(400);
      const outra = await autorizar(presA, [A.lojas[0], B.lojas[0]]);
      expect(outra.r.status).toBe(400);
      expect(outra.corpo.message).toMatch(/Loja não encontrada nesta empresa/);
      const semCusto = await autorizar(presA, [A.lojas[0]], { cupom: false });
      expect(semCusto.r.status).toBe(400);
      expect(semCusto.corpo.message).toMatch(/"custo"/);
      const semCupom = await autorizar(presA, [A.lojas[0]], { custo: true });
      expect(semCupom.r.status).toBe(400);
      expect(semCupom.corpo.message).toMatch(/"cupom"/);
      const semReais = await autorizar(presC, [C.lojas[0]], { custo: true, cupom: false });
      expect(semReais.r.status).toBe(400);
      expect(semReais.corpo.message).toMatch(/Ver valores em R\$/);
      expect(await q(`select count(*)::int n from integracao_autorizacao`)).toEqual([{ n: 0 }]);
    });

    it('autoriza: volta para o Liame com o código e o state; o banco guarda só o hash; NENHUM token nasce', async () => {
      const a = await autorizar(presA, [A.lojas[1], A.lojas[0]], { custo: true, cupom: false });
      expect(a.r.status).toBe(200);
      expect(a.volta!.origin + a.volta!.pathname).toBe(VOLTA);
      expect(a.volta!.searchParams.get('state')).toBe(a.state);
      expect(a.codigo).toMatch(/^rgm_ac_[A-Za-z0-9_-]{43}$/);
      const [linha] = await q(`select *, extract(epoch from (expira_em - criado_em))::int as validade from integracao_autorizacao where tenant_id = $1`, [A.tenant]);
      expect(linha).toMatchObject({
        cliente: 'liame',
        codigo_hash: createHash('sha256').update(a.codigo!).digest('hex'),
        desafio: a.p.code_challenge,
        redirect_uri: VOLTA,
        // Na ordem do contrato, o que vai sempre + o custo; sem criar cupom e sem o telefone do cliente.
        escopos: ['pedidos.ler', 'custos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler'],
        autorizado_por: presA.id,
        autorizado_por_nome: 'Presidente A',
        usado_em: null,
        validade: 600,
      });
      expect([...linha.lojas].sort()).toEqual([...A.lojas].sort());
      expect(await q(`select count(*)::int n from integracao_token_loja where tenant_id = $1`, [A.tenant])).toEqual([{ n: 0 }]);
      const log = registros.filter((e) => e.tenantId === A.tenant && e.acao === 'integracao.autorizacao_concedida');
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ atorId: presA.id, atorPerfil: 'presidente', entidadeId: linha.id });
      expect(log[0].detalhe).toMatchObject({ cliente: 'liame', lojas: ['A1 matriz', 'A2 filial'], autorizadoPor: 'Presidente A' });
    });

    it('o limite por IP segura quem repete a autorização (10 por minuto)', async () => {
      const ped = pedidoNovo();
      const status: number[] = [];
      for (let i = 0; i < 12; i++) {
        // Corpo recusado no serviço (sem loja): o limite conta a chamada assim mesmo.
        const r = await chamar('/integracao-autorizacao', { quem: presA, ip: '10.200.0.1', corpo: { ...ped.p, lojas: [], custo: false, cupom: false } });
        status.push(r.status);
      }
      expect(status.slice(0, 10).every((s) => s === 400)).toBe(true);
      expect(status.slice(10)).toEqual([429, 429]);
    });
  });

  describe('a troca do código (entre servidores)', () => {
    it('segredo de cliente errado: 401 e o código NÃO é gasto', async () => {
      const a = await autorizar(presB, [B.lojas[0]], { custo: false, cupom: false });
      for (const mais of [{ client_secret: 'errado' }, { client_secret: undefined }, { client_id: 'outro' }, { client_id: 'regemcast' }]) {
        const r = await trocar(a.codigo, a.verificador, mais);
        expect(r.status).toBe(401);
        expect(r.headers.get('content-type')).toContain('application/problem+json');
        expect(((await r.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}cliente-invalido`);
      }
      const [linha] = await q(`select usado_em from integracao_autorizacao where codigo_hash = $1`, [createHash('sha256').update(a.codigo!).digest('hex')]);
      expect(linha.usado_em).toBeNull();
      // Com o segredo certo, o mesmo código ainda vale.
      const ok = await trocar(a.codigo, a.verificador);
      expect(ok.status).toBe(200);
      const corpo: any = await ok.json();
      segredos.push(...corpo.lojas.map((l: any) => l.token));
    });

    it('troca: um token por loja, só aqui; o token funciona; o banco guarda o hash; a segunda troca é recusada', async () => {
      const a = await autorizar(presA, A.lojas, { custo: true, cupom: true });
      const r = await trocar(a.codigo, a.verificador);
      expect(r.status).toBe(200);
      const corpo: any = await r.json();
      segredos.push(...corpo.lojas.map((l: any) => l.token));
      expect(corpo.lojas.map((l: any) => [l.loja_id, l.loja_nome])).toEqual([
        [A.lojas[0], 'A1 matriz'],
        [A.lojas[1], 'A2 filial'],
      ]);
      const escopos = ['pedidos.ler', 'custos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler', 'cupons.criar'];
      for (const l of corpo.lojas) {
        expect(l).toMatchObject({ empresa_nome: A.nome, fuso: 'America/Sao_Paulo', moeda: 'BRL', escopos, cardapio_url: null });
        expect(l.token).toMatch(/^rgm_it_[A-Za-z0-9_-]{43}$/);
        // O token nasce valendo: a rota da integração responde pela loja DELE.
        const loja = await chamar('/integracao/loja', { bearer: l.token });
        expect(loja.status).toBe(200);
        expect(await loja.json()).toMatchObject({ loja_id: l.loja_id, escopos });
      }
      expect(new Set(corpo.lojas.map((l: any) => l.token)).size).toBe(2);
      const linhas = await q(
        `select unidade_id, cliente, autorizado_via, autorizado_por, autorizado_por_nome, emitido_por_dist, escopos, token_hash
           from integracao_token_loja where tenant_id = $1 and revogado_em is null`,
        [A.tenant],
      );
      expect(linhas).toHaveLength(2);
      for (const t of linhas) {
        expect(t).toMatchObject({ cliente: 'liame', autorizado_via: 'autorizacao_loja', autorizado_por: presA.id, autorizado_por_nome: 'Presidente A', emitido_por_dist: null, escopos });
        const doCorpo = corpo.lojas.find((l: any) => l.loja_id === t.unidade_id);
        expect(t.token_hash).toBe(createHash('sha256').update(doCorpo.token).digest('hex'));
      }
      const emitidos = registros.filter((e) => e.tenantId === A.tenant && e.acao === 'integracao.token_emitido');
      expect(emitidos.map((e) => e.detalhe.via)).toEqual(['autorizacao_loja', 'autorizacao_loja']);
      expect(emitidos.map((e) => e.unidadeId).sort()).toEqual([...A.lojas].sort());

      // O código vale uma vez.
      const de_novo = await trocar(a.codigo, a.verificador);
      expect(de_novo.status).toBe(400);
      expect(((await de_novo.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}autorizacao-invalida`);
      expect(await q(`select count(*)::int n from integracao_token_loja where tenant_id = $1 and revogado_em is null`, [A.tenant])).toEqual([{ n: 2 }]);
    });

    it('a tentativa que falha gasta o código: verificador errado, endereço de volta diferente', async () => {
      for (const mais of [{ code_verifier: randomBytes(48).toString('base64url') }, { redirect_uri: 'https://liame.teste/outro' }, { code_verifier: undefined }]) {
        const antes = await q(`select count(*)::int n from integracao_token_loja where tenant_id = $1`, [B.tenant]);
        const a = await autorizar(presB, [B.lojas[0]], { custo: false, cupom: false });
        const ruim = await trocar(a.codigo, a.verificador, mais);
        expect(ruim.status).toBe(400);
        const certa = await trocar(a.codigo, a.verificador);
        expect(certa.status).toBe(400);
        expect(await q(`select count(*)::int n from integracao_token_loja where tenant_id = $1`, [B.tenant])).toEqual(antes);
      }
    });

    it('código desconhecido, fora do formato, vencido: 400 igual', async () => {
      for (const c of [null, '', 'qualquer', `rgm_ac_${'z'.repeat(43)}`, `rgm_it_${'z'.repeat(43)}`]) {
        expect((await trocar(c, 'v'.repeat(64))).status).toBe(400);
      }
      const a = await autorizar(presB, [B.lojas[0]], { custo: false, cupom: false });
      await q(`update integracao_autorizacao set criado_em = now() - interval '11 minutes', expira_em = now() - interval '1 minute' where codigo_hash = $1`, [
        createHash('sha256').update(a.codigo!).digest('hex'),
      ]);
      const r = await trocar(a.codigo, a.verificador);
      expect(r.status).toBe(400);
      expect(((await r.json()) as any).detail).toBe('Código de autorização inválido, vencido ou já usado.');
    });

    it('duas trocas ao mesmo tempo: só uma leva os tokens', async () => {
      const D = await empresa('Empresa D', ['D1', 'D2', 'D3']);
      const presD = await pessoa(D.tenant, 'Presidente D', 'presidente');
      const a = await autorizar(presD, D.lojas, { custo: false, cupom: false });
      const [r1, r2] = await Promise.all([trocar(a.codigo, a.verificador), trocar(a.codigo, a.verificador)]);
      expect([r1.status, r2.status].sort()).toEqual([200, 400]);
      const corpo: any = await (r1.status === 200 ? r1 : r2).json();
      segredos.push(...corpo.lojas.map((l: any) => l.token));
      expect(await q(`select count(*)::int n from integracao_token_loja where tenant_id = $1`, [D.tenant])).toEqual([{ n: 3 }]);
    });

    it('loja que já estava conectada (o piloto, pela distribuição): o token antigo para de valer quando o novo nasce', async () => {
      const E = await empresa('Empresa E', ['E1', 'E2']);
      const presE = await pessoa(E.tenant, 'Presidente E', 'presidente');
      const antigo = await tokensSvc.emitir(
        { tenantId: E.tenant, unidadeId: E.lojas[0], autorizadoPor: presE.id, escopos: ['pedidos.ler'], evidencia: 'autorização por escrito (teste)' },
        dist,
      );
      const outraLoja = await tokensSvc.emitir(
        { tenantId: E.tenant, unidadeId: E.lojas[1], autorizadoPor: presE.id, escopos: ['pedidos.ler'], evidencia: 'autorização por escrito (teste)' },
        dist,
      );
      segredos.push(antigo.token, outraLoja.token);
      expect((await chamar('/integracao/loja', { bearer: antigo.token })).status).toBe(200);

      // A página mostra desde quando a loja está conectada.
      const pagina: any = await (await chamar(`/integracao-autorizacao/pedido?${pedidoNovo().consulta}`, { quem: presE })).json();
      expect(pagina.lojas.map((l: any) => Boolean(l.conectadaDesde))).toEqual([true, true]);

      const a = await autorizar(presE, [E.lojas[0]], { custo: false, cupom: false });
      // Só autorizar não troca nada: o antigo segue valendo até a troca do código.
      expect((await chamar('/integracao/loja', { bearer: antigo.token })).status).toBe(200);
      const r = await trocar(a.codigo, a.verificador);
      expect(r.status).toBe(200);
      const novo = ((await r.json()) as any).lojas[0];
      segredos.push(novo.token);
      expect((await chamar('/integracao/loja', { bearer: antigo.token })).status).toBe(401);
      expect((await chamar('/integracao/loja', { bearer: novo.token })).status).toBe(200);
      // A loja que NÃO entrou na autorização fica como estava.
      expect((await chamar('/integracao/loja', { bearer: outraLoja.token })).status).toBe(200);
      const [velho] = await q(`select revogado_por, motivo_revogacao from integracao_token_loja where id = $1`, [antigo.id]);
      expect(velho).toEqual({ revogado_por: 'autorizacao:Presidente E', motivo_revogacao: 'trocado por uma autorização nova' });
      const revogados = registros.filter((e) => e.tenantId === E.tenant && e.acao === 'integracao.token_revogado');
      expect(revogados).toHaveLength(1);
      expect(revogados[0]).toMatchObject({ entidadeId: antigo.id, detalhe: { por: 'autorizacao' } });
    });

    it('quem autorizou deixou de ser presidente antes da troca: recusa e nenhum token nasce', async () => {
      const F = await empresa('Empresa F', ['F1']);
      const presF = await pessoa(F.tenant, 'Presidente F', 'presidente');
      const a = await autorizar(presF, F.lojas, { custo: false, cupom: false });
      await q(`update funcao set categoria = 'gerente' where id = (select funcao_id from colaborador where id = $1)`, [presF.id]);
      expect((await trocar(a.codigo, a.verificador)).status).toBe(400);
      expect(await q(`select count(*)::int n from integracao_token_loja where tenant_id = $1`, [F.tenant])).toEqual([{ n: 0 }]);
    });

    it('presidente sem "Ver valores em R$": autoriza sem o custo e o token sai sem custos.ler', async () => {
      const a = await autorizar(presC, C.lojas, { custo: false, cupom: false });
      expect(a.r.status).toBe(200);
      const r = await trocar(a.codigo, a.verificador);
      const corpo: any = await r.json();
      segredos.push(corpo.lojas[0].token);
      expect(corpo.lojas[0].escopos).toEqual(['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler']);
    });
  });

  describe('aplicativos conectados', () => {
    it('o presidente vê os acessos da empresa DELE, sem nada do token; o gerente não vê', async () => {
      const r = await chamar('/aplicativos-conectados', { quem: presA });
      expect(r.status).toBe(200);
      const texto = await r.text();
      const c = JSON.parse(texto);
      expect(c.aplicativos).toHaveLength(1);
      expect(c.aplicativos[0]).toMatchObject({ cliente: 'liame', rotulo: 'Liame', descricao: CFG.descricao, abrangencia: 'loja', ativos: 2 });
      expect(c.aplicativos[0].acessos.map((a: any) => [a.lojaNome, a.ativo, a.via, a.autorizadoPor]).sort()).toEqual([
        ['A1 matriz', true, 'loja', 'Presidente A'],
        ['A2 filial', true, 'loja', 'Presidente A'],
      ]);
      for (const proibido of ['rgm_it_', 'prefixo', 'token_hash', 'tokenHash', 'ultimo_ip', 'ultimoIp', 'evidencia', B.lojas[0]]) {
        expect(texto).not.toContain(proibido);
      }
      expect((await chamar('/aplicativos-conectados', { quem: gerenteA })).status).toBe(403);
      // Empresa sem nada conectado: lista vazia (o estado vazio da tela).
      const G = await empresa('Empresa G', ['G1']);
      const presG = await pessoa(G.tenant, 'Presidente G', 'presidente');
      expect(await (await chamar('/aplicativos-conectados', { quem: presG })).json()).toEqual({ aplicativos: [] });
    });

    it('revogar: só o presidente da empresa do acesso; o aplicativo passa a receber 401; repetir não quebra', async () => {
      const [a1] = await q(`select id from integracao_token_loja where tenant_id = $1 and unidade_id = $2 and revogado_em is null`, [A.tenant, A.lojas[0]]);
      const a = await autorizar(presA, [A.lojas[0]], { custo: false, cupom: false });
      const novo = ((await (await trocar(a.codigo, a.verificador)).json()) as any).lojas[0];
      segredos.push(novo.token);
      const [atual] = await q(`select id from integracao_token_loja where tenant_id = $1 and unidade_id = $2 and revogado_em is null`, [A.tenant, A.lojas[0]]);
      expect(atual.id).not.toBe(a1.id);

      // Presidente de OUTRA empresa: o acesso "não existe" para ele; o gerente da própria: 403.
      expect((await chamar(`/aplicativos-conectados/${atual.id}/revogar`, { quem: presB, corpo: {} })).status).toBe(404);
      expect((await chamar(`/aplicativos-conectados/${atual.id}/revogar`, { quem: gerenteA, corpo: {} })).status).toBe(403);
      expect((await chamar('/aplicativos-conectados/nao-e-uuid/revogar', { quem: presA, corpo: {} })).status).toBe(400);
      expect((await chamar('/integracao/loja', { bearer: novo.token })).status).toBe(200);

      const r = await chamar(`/aplicativos-conectados/${atual.id}/revogar`, { quem: presA, corpo: {} });
      expect(r.status).toBe(200);
      expect(await r.json()).toMatchObject({ ok: true, jaRevogado: false });
      expect((await chamar('/integracao/loja', { bearer: novo.token })).status).toBe(401);
      const de_novo = await chamar(`/aplicativos-conectados/${atual.id}/revogar`, { quem: presA, corpo: {} });
      expect(await de_novo.json()).toMatchObject({ ok: true, jaRevogado: true });

      const tela: any = await (await chamar('/aplicativos-conectados', { quem: presA })).json();
      const acessos = tela.aplicativos[0].acessos;
      expect(tela.aplicativos[0].ativos).toBe(1);
      expect(acessos.find((x: any) => x.id === atual.id)).toMatchObject({ ativo: false, revogadoPor: { tipo: 'loja', nome: 'Presidente A' } });
      // O que foi trocado pela autorização nova aparece como troca, não como revogação de alguém.
      expect(acessos.find((x: any) => x.id === a1.id)).toMatchObject({ ativo: false, revogadoPor: { tipo: 'troca' } });
      const log = registros.filter((e) => e.acao === 'integracao.token_revogado' && e.entidadeId === atual.id);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ tenantId: A.tenant, atorId: presA.id, origem: 'web', detalhe: { por: 'loja' } });
    });

    it('revogar todas as lojas de um aplicativo: só as da empresa de quem pede', async () => {
      const antesB = await q(`select count(*)::int n from integracao_token_loja where tenant_id = $1 and revogado_em is null`, [B.tenant]);
      expect(antesB[0].n).toBeGreaterThan(0);
      expect((await chamar('/aplicativos-conectados/revogar-todos', { quem: presA, corpo: { cliente: 'outro' } })).status).toBe(400);
      expect((await chamar('/aplicativos-conectados/revogar-todos', { quem: gerenteA, corpo: { cliente: 'liame' } })).status).toBe(403);
      const r = await chamar('/aplicativos-conectados/revogar-todos', { quem: presA, corpo: { cliente: 'liame' } });
      expect(await r.json()).toEqual({ ok: true, revogados: 1 });
      expect(await q(`select count(*)::int n from integracao_token_loja where tenant_id = $1 and revogado_em is null`, [A.tenant])).toEqual([{ n: 0 }]);
      expect(await q(`select count(*)::int n from integracao_token_loja where tenant_id = $1 and revogado_em is null`, [B.tenant])).toEqual(antesB);
      expect(await (await chamar('/aplicativos-conectados/revogar-todos', { quem: presA, corpo: { cliente: 'liame' } })).json()).toEqual({ ok: true, revogados: 0 });
    });
  });

  describe('o que nunca aparece e onde não roda', () => {
    it('nenhum código nem token em claro no banco nem na auditoria', async () => {
      expect(segredos.length).toBeGreaterThan(10);
      const banco = JSON.stringify([
        await q(`select * from integracao_autorizacao`),
        await q(`select * from integracao_token_loja`),
      ]);
      const trilha = JSON.stringify(registros);
      for (const s of [...segredos, SEGREDO]) {
        expect(banco).not.toContain(s);
        expect(trilha).not.toContain(s);
      }
    });

    it('no servidor da loja as rotas não existem (404), com ou sem sessão', async () => {
      process.env.EDGE_MODE = 'true';
      const loja = await subir();
      try {
        const ped = pedidoNovo();
        const o = { base: loja.base, quem: presA };
        expect((await chamar(`/integracao-autorizacao/pedido?${ped.consulta}`, o)).status).toBe(404);
        expect((await chamar('/integracao-autorizacao', { ...o, corpo: { ...ped.p, lojas: [A.lojas[0]], custo: false, cupom: false } })).status).toBe(404);
        expect((await chamar('/aplicativos-conectados', o)).status).toBe(404);
        expect((await chamar('/aplicativos-conectados/revogar-todos', { ...o, corpo: { cliente: 'liame' } })).status).toBe(404);
        expect((await trocar(`rgm_ac_${'a'.repeat(43)}`, 'v'.repeat(64), {})).status).not.toBe(404); // a da nuvem segue de pé
        const t = await chamar('/integracao/autorizacao/token', { base: loja.base, corpo: { code: 'x', client_id: 'liame', client_secret: SEGREDO } });
        expect(t.status).toBe(404);
      } finally {
        await loja.app.close();
        delete process.env.EDGE_MODE;
      }
    });
  });
});
