import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { createServer, IncomingHttpHeaders, Server } from 'node:http';
import { join } from 'node:path';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Global, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DRIZZLE } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CfThrottlerGuard } from '../../common/cf-throttler.guard';
import { CloudOnlyGuard } from '../../common/cloud-only.guard';
import { IntegracaoApiModule } from './integracao-api.module';
import { IntegracaoTokenService } from './integracao-token.service';
import { WebhookIntegracaoService } from './webhook-integracao.service';
import { BASE_TIPO_PROBLEMA } from './problema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AVISOS (webhooks) DA API DE INTEGRAÇÃO (trilha C, C3b — mig 304), contra o Postgres real e por
// HTTP (Nest com os guards globais de produção), com um RECEPTOR local que confere a assinatura
// como o Liame confere (Standard Webhooks).
//
// Como nas outras specs da integração: o banco do CI é montado como SERVIDOR DA LOJA e as
// migrations só da nuvem (295–298 e a 304) sobem num schema só deste teste, na frente do `public`;
// as tabelas que ganham gatilho são COPIADAS para o schema (os gatilhos vivem só nas cópias), sem
// FK para tabela compartilhada (LIC-088/ERR-109). O job lê só a tabela de versões publicadas — as
// linhas dela são gravadas direto aqui (o carimbador tem as specs dele). O job roda SÓ nas
// empresas desta spec (V32/LIC-084).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('integracao-webhook.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGS, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');
const FONTES = ['pedido_externo', 'comanda', 'comanda_item', 'cliente', 'cupom', 'cupom_uso'];
const TODOS = ['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler'];

type Recebido = { caminho: string; cabecalhos: IncomingHttpHeaders; corpo: string };
type Resposta = { status: number; cabecalhos?: Record<string, string>; atrasoMs?: number };

descrever('API de integração — avisos (PUT/GET/DELETE /integracao/webhook e o job)', () => {
  const SCHEMA = `teste_integracao_webhook_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 10 });
  const db = drizzle(pool) as any;
  const registros: any[] = [];
  const auditoria = { registrar: async (e: any) => void registros.push(e) } as unknown as AuditoriaService;
  const tokensSvc = new IntegracaoTokenService(db, auditoria);
  const empresas: string[] = [];
  const segredos: string[] = []; // todo segredo em claro deste teste — nenhum pode estar no banco nem na auditoria
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const original = {
    edge: process.env.EDGE_MODE,
    chave: process.env.SEGREDOS_CHAVE,
    urls: process.env.INTEGRACAO_LIAME_WEBHOOK_URLS,
  };
  let app: INestApplication;
  let base = '';
  let svc: WebhookIntegracaoService;

  // ───────────────────────────── o receptor (faz o papel do Liame) ─────────────────────────────

  const recebidos: Recebido[] = [];
  let responder: (r: Recebido) => Resposta = () => ({ status: 202 });
  let receptor: Server;
  let baseReceptor = '';

  function subirReceptor(): Promise<void> {
    receptor = createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on('data', (d) => partes.push(d));
      req.on('end', () => {
        const r: Recebido = { caminho: req.url ?? '', cabecalhos: req.headers, corpo: Buffer.concat(partes).toString('utf8') };
        recebidos.push(r);
        const resp = responder(r);
        const enviar = () => {
          if (res.destroyed) return;
          res.writeHead(resp.status, { 'content-type': 'application/json', ...(resp.cabecalhos ?? {}) });
          res.end('{"status":"accepted"}');
        };
        // O atraso (destino que não responde) não segura o fim do teste.
        if (resp.atrasoMs) setTimeout(enviar, resp.atrasoMs).unref();
        else enviar();
      });
    });
    return new Promise((ok) =>
      receptor.listen(0, '127.0.0.1', () => {
        baseReceptor = `http://127.0.0.1:${(receptor.address() as any).port}/v1/inbox/regem/`;
        ok();
      }),
    );
  }

  /** A assinatura conferida como o destino confere (implementação à parte da do Regem). */
  function assinaturaConfere(r: Recebido, segredo: string): boolean {
    const id = String(r.cabecalhos['webhook-id'] ?? '');
    const ts = String(r.cabecalhos['webhook-timestamp'] ?? '');
    const chave = Buffer.from(segredo.slice('whsec_'.length), 'base64');
    const esperado = `v1,${createHmac('sha256', chave).update(`${id}.${ts}.${r.corpo}`).digest('base64')}`;
    const agora = Math.floor(Date.now() / 1000);
    return !!id && Math.abs(agora - Number(ts)) < 300 && r.cabecalhos['webhook-signature'] === esperado;
  }

  // ───────────────────────────── montagem ─────────────────────────────

  @Global()
  @Module({
    providers: [
      { provide: DRIZZLE, useValue: db },
      { provide: AuditoriaService, useValue: auditoria },
    ],
    exports: [DRIZZLE, AuditoriaService],
  })
  class InfraTeste {}

  @Module({
    imports: [InfraTeste, ThrottlerModule.forRoot([{ ttl: 60000, limit: 500 }]), IntegracaoApiModule],
    providers: [
      { provide: APP_GUARD, useClass: CfThrottlerGuard },
      { provide: APP_GUARD, useClass: CloudOnlyGuard },
    ],
  })
  class AppTeste {}

  async function http(metodo: string, token: string | null, corpo?: any) {
    const r = await fetch(`${base}/integracao/webhook`, {
      method: metodo,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(corpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const texto = await r.text();
    return { status: r.status, corpo: texto ? JSON.parse(texto) : null, tipo: r.headers.get('content-type') ?? '' };
  }

  async function empresa(nome: string, lojas: string[]) {
    const [e] = await q(`insert into empresa (nome) values ($1) returning id`, [`${nome} ${randomUUID().slice(0, 6)}`]);
    empresas.push(e.id);
    const ids: string[] = [];
    for (const [i, l] of lojas.entries()) {
      const [u] = await q(
        `insert into unidade (tenant_id, nome, tipo, created_at) values ($1, $2, $3, now() - make_interval(mins => $4)) returning id`,
        [e.id, l, i === 0 ? 'matriz' : 'filial', 100 - i],
      );
      ids.push(u.id);
    }
    const [f] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Presidência', 'presidente') returning id`, [e.id]);
    const [p] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, $2, $3) returning id`, [e.id, `Presidente ${nome}`, f.id]);
    return { tenant: e.id as string, lojas: ids, presidente: p.id as string };
  }

  async function emitir(emp: { tenant: string; presidente: string }, loja: string, escopos: string[] = TODOS) {
    const r = await tokensSvc.emitir(
      { tenantId: emp.tenant, unidadeId: loja, autorizadoPor: emp.presidente, escopos, evidencia: 'autorização por escrito (teste)' },
      dist,
    );
    return { token: r.token as string, id: r.id as string };
  }

  function segredoNovo(): string {
    const s = `whsec_${randomBytes(32).toString('base64')}`;
    segredos.push(s);
    return s;
  }

  /** Registra o aviso do token no receptor (cada token com o "id de conexão" dele no caminho). */
  async function registrar(token: string, conexao: string, segredo = segredoNovo()) {
    const r = await http('PUT', token, { url: `${baseReceptor}${conexao}`, segredo });
    expect(r.status).toBe(200);
    return segredo;
  }

  /** Uma versão PUBLICADA (como o carimbador grava), carimbada há `haSeg` segundos. */
  async function publicar(
    tenant: string,
    o: { recurso: 'venda' | 'cliente' | 'cupom' | 'cupom_uso'; loja?: string | null; id?: string; haSeg?: number; foto?: any },
  ) {
    const id = o.id ?? randomUUID();
    const fonte = o.recurso === 'venda' ? 'pedido_externo' : o.recurso;
    const [l] = await q(
      `insert into integracao_versao (recurso, recurso_id, tenant_id, fonte, unidade_id, versao, pendente, atualizado_em, situacao, foto)
       values ($1, $2, $3, $4, $5, 1, false, clock_timestamp() - make_interval(secs => $6), $7, $8::jsonb)
       on conflict (recurso, recurso_id) do update
          set versao = integracao_versao.versao + 1, atualizado_em = excluded.atualizado_em
       returning recurso_id::text as id, versao::int as versao`,
      [o.recurso, id, tenant, fonte, o.loja ?? null, o.haSeg ?? 0, o.recurso === 'venda' ? 'confirmado' : null, JSON.stringify(o.foto ?? {})],
    );
    return l as { id: string; versao: number };
  }

  const linha = async (tokenId: string) => (await q(`select * from integracao_webhook where token_id = $1`, [tokenId]))[0];
  /** Põe a loja "na vez" de novo (o intervalo de um minuto entre avisos tem teste próprio). */
  const naVez = (tokenIds: string[]) =>
    q(`update integracao_webhook set proxima_verificacao_em = now() - interval '1 second' where token_id = any($1::uuid[])`, [tokenIds]);
  const ciclo = () => svc.ciclo({ tenantIds: empresas }, 30_000);
  const doCaminho = (conexao: string) => recebidos.filter((r) => r.caminho === `/v1/inbox/regem/${conexao}`);

  let A: Awaited<ReturnType<typeof empresa>>; // 2 lojas
  let B: Awaited<ReturnType<typeof empresa>>; // outra empresa
  let D: Awaited<ReturnType<typeof empresa>>; // loja única

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a API é da NUVEM
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    await subirReceptor();
    process.env.INTEGRACAO_LIAME_WEBHOOK_URLS = baseReceptor;

    await pool.query(`create schema ${SCHEMA}`);
    for (const t of FONTES) await pool.query(`create table ${SCHEMA}.${t} (like public.${t} including all)`);
    for (const x of await q(
      `select indexname from pg_indexes where schemaname = $1 and tablename = 'cupom' and indexdef ilike '%upper(codigo)%'`,
      [SCHEMA],
    )) {
      await pool.query(`drop index ${SCHEMA}.${x.indexname}`);
    }
    await pool.query(`create unique index uq_cupom_tenant_codigo on ${SCHEMA}.cupom (tenant_id, upper(codigo))`);
    await pool.query(
      `alter table ${SCHEMA}.cupom_uso add constraint fk_teste_cupom_uso_cupom foreign key (cupom_id) references ${SCHEMA}.cupom (id) on delete cascade`,
    );
    await pool.query(`create trigger trg_bump_updated_at before update on ${SCHEMA}.cupom for each row execute function public.bump_updated_at()`);
    await pool.query(semFkCompartilhada(mig('295_integracao_token_loja.sql')));
    await pool.query(mig('296_integracao_versao_vendas.sql'));
    await pool.query(mig('297_pedido_externo_comanda_idx.sql'));
    await pool.query(mig('298_integracao_cupons.sql'));
    // A 304 de verdade, duas vezes (idempotente), com a conferência dela.
    for (let i = 0; i < 2; i++) {
      const r = (await pool.query(mig('304_integracao_webhook.sql'))) as any;
      const ultima = Array.isArray(r) ? r[r.length - 1] : r;
      expect(ultima.rows).toHaveLength(5);
      const falhas = ultima.rows.filter((x: any) => x.ok !== true).map((x: any) => x.objeto);
      if (falhas.length) throw new Error(`conferência da 304 falhou: ${falhas.join(', ')}`);
    }
    const onde = await q(
      `select c.relname, s.nspname from pg_class c join pg_namespace s on s.oid = c.relnamespace
        where c.oid in (to_regclass('integracao_webhook'), to_regclass('integracao_versao'), to_regclass('integracao_token_loja'))`,
    );
    if (onde.length !== 3 || onde.some((x) => x.nspname !== SCHEMA)) {
      throw new Error(`as tabelas do teste não estão na frente do public: ${JSON.stringify(onde)}`);
    }
    const [gat] = await q(
      `select count(*)::int n from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace s on s.oid = c.relnamespace
        where g.tgname like 'trg_integracao_%' and s.nspname = 'public'`,
    );
    if (gat.n) throw new Error('as migrations não podem ter posto gatilho nas tabelas compartilhadas');

    app = await NestFactory.create(AppTeste, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}/api/v1`;
    svc = app.get(WebhookIntegracaoService);
    svc.atrasoSeg = 0; // o atraso de 15 s tem teste próprio

    A = await empresa('Empresa A', ['A1 matriz', 'A2 filial']);
    B = await empresa('Empresa B', ['B1']);
    D = await empresa('Empresa D', ['D1 única']);
  });

  afterAll(async () => {
    await app?.close();
    (receptor as any)?.closeAllConnections?.();
    await new Promise((ok) => (receptor ? receptor.close(() => ok(null)) : ok(null)));
    for (const [k, v] of [
      ['EDGE_MODE', original.edge],
      ['SEGREDOS_CHAVE', original.chave],
      ['INTEGRACAO_LIAME_WEBHOOK_URLS', original.urls],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  }, 120_000);

  beforeEach(() => {
    recebidos.length = 0;
    responder = () => ({ status: 202 });
    svc.atrasoSeg = 0;
    svc.intervaloSeg = 60;
    svc.prazoEnvioMs = 5000;
  });

  // ───────────────────────────── registro ─────────────────────────────

  describe('PUT /integracao/webhook — o registro', () => {
    let t: { token: string; id: string };
    beforeAll(async () => {
      t = await emitir(A, A.lojas[0]);
    });

    it('sem token → 401; nada é gravado', async () => {
      const r = await http('PUT', null, { url: `${baseReceptor}x`, segredo: segredoNovo() });
      expect(r.status).toBe(401);
      expect(r.tipo).toContain('application/problem+json');
      expect(r.corpo.type).toBe(`${BASE_TIPO_PROBLEMA}token-invalido`);
    });

    it.each([
      ['lista no lugar do objeto', []],
      ['campo desconhecido', { url: 'x', segredo: 'y', eventos: ['tudo'] }],
      ['segredo sem o formato do padrão', { url: 'URL', segredo: 'senha-fraca' }],
      ['segredo curto', { url: 'URL', segredo: `whsec_${randomBytes(8).toString('base64')}` }],
      ['sem segredo', { url: 'URL' }],
    ])('corpo recusado (%s) → 400 parametro-invalido', async (_nome, corpo: any) => {
      const c = Array.isArray(corpo) ? corpo : { ...corpo, ...(corpo.url === 'URL' ? { url: `${baseReceptor}conexao-1` } : {}) };
      const r = await http('PUT', t.token, c);
      expect(r.status).toBe(400);
      expect(r.corpo.type).toBe(`${BASE_TIPO_PROBLEMA}parametro-invalido`);
      expect(await linha(t.id)).toBeUndefined();
    });

    it.each([
      ['outro servidor', 'http://127.0.0.1:9/v1/inbox/regem/conexao-1'],
      ['servidor interno', 'http://169.254.169.254/latest/meta-data'],
      ['outro caminho no mesmo servidor', 'BASE/../../admin'],
      ['com parâmetro', 'BASEconexao-1?para=http://evil.example'],
      ['dois trechos', 'BASEconexao-1/mais'],
      ['sem endereço', undefined],
    ])('endereço fora da lista da integração (%s) → 422 endereco-nao-permitido', async (_nome, url) => {
      const u = typeof url === 'string' ? url.replace('BASE/', baseReceptor).replace('BASE', baseReceptor) : url;
      const r = await http('PUT', t.token, { url: u, segredo: segredoNovo() });
      expect(r.status).toBe(422);
      expect(r.corpo.type).toBe(`${BASE_TIPO_PROBLEMA}endereco-nao-permitido`);
      expect(await linha(t.id)).toBeUndefined();
      expect(recebidos).toHaveLength(0); // registrar nunca faz chamada para o endereço
    });

    it('integração sem lista de endereços (a distribuição não liberou) → 422, sem dizer mais nada', async () => {
      process.env.INTEGRACAO_LIAME_WEBHOOK_URLS = 'isto-nao-e-endereco';
      try {
        const r = await http('PUT', t.token, { url: `${baseReceptor}conexao-1`, segredo: segredoNovo() });
        expect(r.status).toBe(422);
        expect(r.corpo.type).toBe(`${BASE_TIPO_PROBLEMA}endereco-nao-permitido`);
      } finally {
        process.env.INTEGRACAO_LIAME_WEBHOOK_URLS = baseReceptor;
      }
    });

    it('sem a chave de segredos no servidor → 503 aviso-indisponivel e nada guardado', async () => {
      const chave = process.env.SEGREDOS_CHAVE;
      delete process.env.SEGREDOS_CHAVE;
      try {
        const r = await http('PUT', t.token, { url: `${baseReceptor}conexao-1`, segredo: segredoNovo() });
        expect(r.status).toBe(503);
        expect(r.corpo.type).toBe(`${BASE_TIPO_PROBLEMA}aviso-indisponivel`);
        expect(await linha(t.id)).toBeUndefined();
      } finally {
        process.env.SEGREDOS_CHAVE = chave;
      }
    });

    it('GET sem registro → 404; DELETE sem registro → 204', async () => {
      expect((await http('GET', t.token)).status).toBe(404);
      expect((await http('DELETE', t.token)).status).toBe(204);
    });

    it('registra: a resposta e o GET mostram a situação, nunca o segredo; no banco, só cifrado; auditado sem o segredo', async () => {
      const antes = registros.length;
      const segredo = segredoNovo();
      const r = await http('PUT', t.token, { url: `${baseReceptor}conexao-1`, segredo });
      expect(r.status).toBe(200);
      expect(r.corpo).toEqual({
        url: `${baseReceptor}conexao-1`,
        registrado_em: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
        pausado: false,
        pausado_em: null,
        motivo_pausa: null,
        ultimo_envio_em: null,
        ultimo_status_http: null,
        falhas_seguidas: 0,
        entregues: 0,
      });
      expect((await http('GET', t.token)).corpo).toEqual(r.corpo);

      const l = await linha(t.id);
      expect(l.tenant_id).toBe(A.tenant);
      expect(l.unidade_id).toBe(A.lojas[0]);
      expect(l.cliente).toBe('liame');
      expect(l.segredo_cifrado.startsWith('v1:')).toBe(true);
      expect(l.segredo_cifrado).not.toContain(segredo.slice(6));

      const novos = registros.slice(antes);
      expect(novos).toHaveLength(1);
      expect(novos[0]).toMatchObject({
        tenantId: A.tenant,
        unidadeId: A.lojas[0],
        acao: 'integracao.webhook_registrado',
        origem: 'integracao',
        entidadeId: t.id,
        detalhe: { cliente: 'liame', url: `${baseReceptor}conexao-1`, novo: true },
      });
    });

    it('registrar de novo igual (o do dia a dia) não vira auditoria; trocar o segredo ou o endereço vira', async () => {
      const segredo = segredoNovo();
      await registrar(t.token, 'conexao-1', segredo);
      const antes = registros.length;
      await registrar(t.token, 'conexao-1', segredo);
      expect(registros.length).toBe(antes);
      await registrar(t.token, 'conexao-1', segredoNovo());
      expect(registros.length).toBe(antes + 1);
      await registrar(t.token, 'conexao-2');
      expect(registros.length).toBe(antes + 2);
      expect(registros[registros.length - 1].detalhe).toMatchObject({ url: `${baseReceptor}conexao-2`, novo: false });
      expect((await q(`select count(*)::int n from integracao_webhook where token_id = $1`, [t.id]))[0].n).toBe(1);
    });

    it('DELETE apaga o endereço e o segredo, audita, e repetir dá 204 de novo', async () => {
      const antes = registros.length;
      expect((await http('DELETE', t.token)).status).toBe(204);
      expect(await linha(t.id)).toBeUndefined();
      expect(registros.slice(antes).map((x) => x.acao)).toEqual(['integracao.webhook_removido']);
      expect((await http('DELETE', t.token)).status).toBe(204);
      expect(registros.length).toBe(antes + 1);
      expect((await http('GET', t.token)).status).toBe(404);
    });
  });

  // ───────────────────────────── o job ─────────────────────────────

  describe('o job: quando algo publicado muda, a loja recebe UM aviso assinado', () => {
    let tA1: { token: string; id: string };
    let tA2: { token: string; id: string };
    let tB: { token: string; id: string };
    let tD: { token: string; id: string };
    let sA1 = '';
    let sA2 = '';

    beforeAll(async () => {
      tA1 = await emitir(A, A.lojas[0]);
      tA2 = await emitir(A, A.lojas[1]);
      tB = await emitir(B, B.lojas[0]);
      tD = await emitir(D, D.lojas[0]);
      sA1 = await registrar(tA1.token, 'a1');
      sA2 = await registrar(tA2.token, 'a2');
      await registrar(tB.token, 'b1');
      await registrar(tD.token, 'd1');
    });

    beforeEach(async () => {
      // Cada teste começa "em dia": nada pendente de aviso, todas as lojas na vez.
      await q(
        `update integracao_webhook set avisado_ate = clock_timestamp(), proxima_verificacao_em = now() - interval '1 second',
                falhas_seguidas = 0, primeira_falha_em = null, pausado_em = null, motivo_pausa = null
          where tenant_id = any($1::uuid[])`,
        [empresas],
      );
    });

    it('nada novo: nenhum aviso e NENHUMA gravação (a linha fica igual)', async () => {
      const antes = await linha(tA1.id);
      expect(await ciclo()).toEqual({ enviados: 0, entregues: 0 });
      expect(recebidos).toHaveLength(0);
      expect(await linha(tA1.id)).toEqual(antes);
    });

    it('venda nova na loja → um POST assinado com o segredo dela, no formato do contrato', async () => {
      const v = await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[0] });
      expect(await ciclo()).toEqual({ enviados: 1, entregues: 1 });
      expect(recebidos).toHaveLength(1);
      const r = recebidos[0];
      expect(r.caminho).toBe('/v1/inbox/regem/a1');
      // `loja_id` = a loja do token: é por ele que o destino sabe qual loja reler.
      expect(JSON.parse(r.corpo)).toEqual({ tipo: 'pedido.alterado', id: v.id, versao: 1, loja_id: A.lojas[0] });
      expect(r.cabecalhos['content-type']).toBe('application/json');
      expect(assinaturaConfere(r, sA1)).toBe(true);
      expect(assinaturaConfere(r, sA2)).toBe(false); // o segredo é por conexão
      // Nada do token nem do segredo viaja no aviso.
      expect(r.cabecalhos.authorization).toBeUndefined();
      expect(JSON.stringify(r.cabecalhos) + r.corpo).not.toContain(sA1.slice(6));

      const l = await linha(tA1.id);
      expect(Number(l.entregues)).toBeGreaterThanOrEqual(1);
      expect(l.ultimo_status_http).toBe(202);
      expect(l.falhas_seguidas).toBe(0);
      expect(l.ultimo_erro).toBeNull();
      expect(new Date(l.proxima_verificacao_em).getTime()).toBeGreaterThan(Date.now() + 50_000);
      const [c] = await q(
        `select w.avisado_ate = v.atualizado_em as igual from integracao_webhook w, integracao_versao v
          where w.token_id = $1 and v.recurso = 'venda' and v.recurso_id = $2`,
        [tA1.id, v.id],
      );
      expect(c.igual).toBe(true);
    });

    it('só avisa o que foi carimbado há mais de 15 s (o mesmo atraso da leitura com cursor)', async () => {
      svc.atrasoSeg = 15;
      await q(`update integracao_webhook set avisado_ate = now() - interval '1 hour' where token_id = $1`, [tA1.id]);
      const v = await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[0], haSeg: 5 });
      expect((await ciclo()).enviados).toBe(0);
      await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[0], id: v.id, haSeg: 20 });
      expect((await ciclo()).entregues).toBe(1);
      expect(JSON.parse(recebidos[0].corpo)).toEqual({ tipo: 'pedido.alterado', id: v.id, versao: 2, loja_id: A.lojas[0] });
    });

    it('várias mudanças viram UM aviso (o da mais recente), e a loja só é avisada de novo depois de um minuto', async () => {
      await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[0] });
      await publicar(A.tenant, { recurso: 'cupom', loja: A.lojas[0] });
      const ultima = await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[0] });
      expect(await ciclo()).toEqual({ enviados: 1, entregues: 1 });
      expect(JSON.parse(recebidos[0].corpo)).toMatchObject({ tipo: 'pedido.alterado', id: ultima.id });

      await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[0] });
      expect((await ciclo()).enviados).toBe(0); // ainda não passou um minuto
      await naVez([tA1.id]);
      expect((await ciclo()).entregues).toBe(1);
      await naVez([tA1.id]);
      expect((await ciclo()).enviados).toBe(0); // já avisado: nada novo
      expect(recebidos).toHaveLength(2);
    });

    it('cada loja recebe só o que a leitura dela devolve', async () => {
      // Venda e uso de cupom: estritos por loja. Cupom sem loja e cliente anonimizado: a empresa toda.
      await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[1] });
      await ciclo();
      expect(doCaminho('a2')).toHaveLength(1);
      expect(doCaminho('a1')).toHaveLength(0);

      recebidos.length = 0;
      await naVez([tA1.id, tA2.id]);
      const uso = await publicar(A.tenant, { recurso: 'cupom_uso', loja: A.lojas[0], foto: { cupom_id: 'c-1', pedido_id: 'p-1' } });
      await ciclo();
      expect(doCaminho('a2')).toHaveLength(0);
      expect(JSON.parse(doCaminho('a1')[0].corpo)).toEqual({
        tipo: 'cupom.usado',
        id: uso.id,
        cupom_id: 'c-1',
        pedido_id: 'p-1',
        loja_id: A.lojas[0],
      });

      recebidos.length = 0;
      await naVez([tA1.id, tA2.id]);
      const cupomDaRede = await publicar(A.tenant, { recurso: 'cupom', loja: null });
      await ciclo();
      // O cupom é da rede (sem loja), mas cada aviso leva a loja do TOKEN que o recebe.
      const lojaDo: Record<string, string> = { a1: A.lojas[0], a2: A.lojas[1] };
      for (const c of ['a1', 'a2']) {
        expect(JSON.parse(doCaminho(c)[0].corpo)).toEqual({ tipo: 'cupom.alterado', id: cupomDaRede.id, versao: 1, loja_id: lojaDo[c] });
      }

      recebidos.length = 0;
      await naVez([tA1.id, tA2.id]);
      const esquecido = await publicar(A.tenant, { recurso: 'cliente', loja: null });
      await ciclo();
      for (const c of ['a1', 'a2']) {
        expect(JSON.parse(doCaminho(c)[0].corpo)).toEqual({ tipo: 'cliente.anonimizado', id: esquecido.id, loja_id: lojaDo[c] });
      }

      // Venda SEM loja (cardápio da rede): a empresa de várias lojas não avisa ninguém; a de loja única, avisa.
      recebidos.length = 0;
      await naVez([tA1.id, tA2.id, tD.id]);
      await publicar(A.tenant, { recurso: 'venda', loja: null });
      const semLojaD = await publicar(D.tenant, { recurso: 'venda', loja: null });
      await ciclo();
      expect(doCaminho('a1')).toHaveLength(0);
      expect(doCaminho('a2')).toHaveLength(0);
      expect(JSON.parse(doCaminho('d1')[0].corpo)).toMatchObject({ id: semLojaD.id });
      // E nada de uma empresa vaza para a outra.
      expect(doCaminho('b1')).toHaveLength(0);
    });

    it('só o recurso que o escopo do token libera vira aviso', async () => {
      const soCupom = await emitir(B, B.lojas[0], ['cupons.ler']);
      const s = await registrar(soCupom.token, 'b-so-cupom');
      await publicar(B.tenant, { recurso: 'venda', loja: B.lojas[0] });
      await publicar(B.tenant, { recurso: 'cupom_uso', loja: B.lojas[0] });
      await publicar(B.tenant, { recurso: 'cliente' });
      await ciclo();
      expect(doCaminho('b1')).toHaveLength(1); // o token com todos os escopos recebe
      expect(doCaminho('b-so-cupom')).toHaveLength(0);

      recebidos.length = 0;
      await naVez([soCupom.id]);
      const c = await publicar(B.tenant, { recurso: 'cupom', loja: B.lojas[0] });
      await ciclo();
      expect(JSON.parse(doCaminho('b-so-cupom')[0].corpo)).toEqual({ tipo: 'cupom.alterado', id: c.id, versao: 1, loja_id: B.lojas[0] });
      expect(assinaturaConfere(doCaminho('b-so-cupom')[0], s)).toBe(true);
      await http('DELETE', soCupom.token);
    });

    it('duas réplicas no mesmo instante mandam um aviso só', async () => {
      await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[0] });
      const r = await Promise.all([ciclo(), ciclo(), ciclo()]);
      expect(r.reduce((n, x) => n + x.enviados, 0)).toBe(1);
      expect(recebidos).toHaveLength(1);
    });

    it('destino com erro: nada se perde — recua, guarda o motivo e avisa quando ele volta', async () => {
      responder = () => ({ status: 500 });
      const v = await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[0] });
      const antes = await linha(tA1.id);
      expect(await ciclo()).toEqual({ enviados: 1, entregues: 0 });
      let l = await linha(tA1.id);
      expect(l.falhas_seguidas).toBe(1);
      expect(l.primeira_falha_em).not.toBeNull();
      expect(l.ultimo_status_http).toBe(500);
      expect(l.ultimo_erro).toContain('500');
      expect(l.avisado_ate).toEqual(antes.avisado_ate); // não andou
      const espera = new Date(l.proxima_verificacao_em).getTime() - Date.now();
      expect(espera).toBeGreaterThan(40_000);
      expect(espera).toBeLessThan(70_000);
      expect((await http('GET', tA1.token)).corpo).toMatchObject({ pausado: false, falhas_seguidas: 1, ultimo_status_http: 500 });

      responder = () => ({ status: 202 });
      expect((await ciclo()).enviados).toBe(0); // ainda no recuo
      await naVez([tA1.id]);
      expect(await ciclo()).toEqual({ enviados: 1, entregues: 1 });
      expect(JSON.parse(recebidos[recebidos.length - 1].corpo)).toMatchObject({ id: v.id });
      l = await linha(tA1.id);
      expect(l.falhas_seguidas).toBe(0);
      expect(l.primeira_falha_em).toBeNull();
      expect(l.ultimo_erro).toBeNull();
    });

    it('redirecionamento do destino não é seguido (o aviso não vai para outro lugar) e conta como falha', async () => {
      responder = (r) => (r.caminho.endsWith('/a1') ? { status: 302, cabecalhos: { location: `${baseReceptor}outro-lugar` } } : { status: 202 });
      await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[0] });
      expect(await ciclo()).toEqual({ enviados: 1, entregues: 0 });
      expect(recebidos.map((r) => r.caminho)).toEqual(['/v1/inbox/regem/a1']);
      expect((await linha(tA1.id)).ultimo_status_http).toBe(302);
    });

    it('destino que não responde: o prazo é curto e uma loja não segura as outras', async () => {
      svc.prazoEnvioMs = 300;
      responder = (r) => (r.caminho.endsWith('/a1') ? { status: 202, atrasoMs: 3000 } : { status: 202 });
      await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[0] });
      await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[1] });
      const inicio = Date.now();
      expect(await ciclo()).toEqual({ enviados: 2, entregues: 1 });
      expect(Date.now() - inicio).toBeLessThan(2500);
      const l = await linha(tA1.id);
      expect(l.falhas_seguidas).toBe(1);
      expect(l.ultimo_status_http).toBeNull();
      expect(l.ultimo_erro).toMatch(/demorou/);
      expect((await linha(tA2.id)).falhas_seguidas).toBe(0);
    });

    it('404 do destino só pausa depois de uma hora assim; pausado não recebe; registrar de novo religa', async () => {
      responder = () => ({ status: 404 });
      await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[0] });
      await ciclo();
      expect((await linha(tA1.id)).pausado_em).toBeNull(); // a primeira vez é só falha

      await q(`update integracao_webhook set primeira_falha_em = now() - interval '2 hours', proxima_verificacao_em = now() where token_id = $1`, [tA1.id]);
      await ciclo();
      const l = await linha(tA1.id);
      expect(l.pausado_em).not.toBeNull();
      expect(l.motivo_pausa).toContain('404');
      expect((await http('GET', tA1.token)).corpo).toMatchObject({ pausado: true, motivo_pausa: expect.stringContaining('404') });

      recebidos.length = 0;
      responder = () => ({ status: 202 });
      await naVez([tA1.id]);
      expect((await ciclo()).enviados).toBe(0); // pausado: nem tenta
      const antes = registros.length;
      const r = await http('PUT', tA1.token, { url: `${baseReceptor}a1`, segredo: sA1 });
      expect(r.corpo).toMatchObject({ pausado: false, falhas_seguidas: 0, motivo_pausa: null });
      expect(registros.length).toBe(antes + 1); // religar fica na auditoria
      expect(await ciclo()).toEqual({ enviados: 1, entregues: 1 }); // a novidade que ficou esperando
    });

    it('três dias de falha pausam', async () => {
      responder = () => ({ status: 503 });
      await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[1] });
      await q(`update integracao_webhook set primeira_falha_em = now() - interval '73 hours', falhas_seguidas = 80 where token_id = $1`, [tA2.id]);
      await ciclo();
      const l = await linha(tA2.id);
      expect(l.pausado_em).not.toBeNull();
      expect(l.motivo_pausa).toContain('três dias');
    });

    it('o segredo guardado não abre mais (a chave do servidor mudou): pausa sem chamar ninguém', async () => {
      const chave = process.env.SEGREDOS_CHAVE;
      await publicar(D.tenant, { recurso: 'venda', loja: D.lojas[0] });
      process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
      try {
        expect(await ciclo()).toEqual({ enviados: 1, entregues: 0 });
      } finally {
        process.env.SEGREDOS_CHAVE = chave;
      }
      expect(recebidos).toHaveLength(0);
      const l = await linha(tD.id);
      expect(l.pausado_em).not.toBeNull();
      expect(l.motivo_pausa).toContain('registre o aviso de novo');
    });

    it('token revogado não recebe mais nada, e a limpeza apaga o registro (com o segredo)', async () => {
      const t = await emitir(B, B.lojas[0]);
      await registrar(t.token, 'b-revogado');
      const r = await fetch(`${base}/integracao/autorizacao/revogar`, { method: 'POST', headers: { authorization: `Bearer ${t.token}` } });
      expect(r.status).toBe(200);
      await publicar(B.tenant, { recurso: 'venda', loja: B.lojas[0] });
      await ciclo();
      expect(doCaminho('b-revogado')).toHaveLength(0);
      expect(doCaminho('b1')).toHaveLength(1);
      expect(await linha(t.id)).toBeDefined();
      expect(await svc.limpar({ tenantIds: empresas })).toBe(1);
      expect(await linha(t.id)).toBeUndefined();
      expect(await linha(tB.id)).toBeDefined();
    });

    it('o job só olha as empresas do escopo (o teste não manda aviso de empresa alheia)', async () => {
      await publicar(A.tenant, { recurso: 'venda', loja: A.lojas[0] });
      expect(await svc.ciclo({ tenantIds: [B.tenant] })).toEqual({ enviados: 0, entregues: 0 });
      expect(await svc.ciclo({ tenantIds: [] })).toEqual({ enviados: 0, entregues: 0 });
      expect(recebidos).toHaveLength(0);
    });
  });

  // ───────────────────────────── o que nunca pode ficar guardado ─────────────────────────────

  it('nenhum segredo em claro no banco nem na auditoria', async () => {
    expect(segredos.length).toBeGreaterThan(5);
    const banco = JSON.stringify(await q(`select * from integracao_webhook`));
    const audit = JSON.stringify(registros);
    for (const s of segredos) {
      expect(banco).not.toContain(s.slice(6));
      expect(audit).not.toContain(s.slice(6));
    }
  });

  it('a busca da novidade cabe no índice das versões (mig 296), sem varrer a tabela', async () => {
    // Com a tabela pequena do teste o Postgres prefere varrer; sem a varredura, a consulta tem de
    // SE RESOLVER pelo índice — o que prova que a forma dela (empresa, recurso, carimbo) cabe nele.
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('set local enable_seqscan = off');
      const plano = await c.query(
        `explain (format json)
         select v.recurso_id from integracao_versao v
          where v.tenant_id = $1 and v.recurso = any($2::text[]) and v.atualizado_em > now() - interval '1 minute'
            and v.atualizado_em <= now()
          order by v.atualizado_em desc, v.recurso_id desc limit 1`,
        [A.tenant, ['venda', 'cupom']],
      );
      const texto = JSON.stringify(plano.rows);
      expect(texto).toContain('idx_integracao_versao_leitura');
      expect(texto).not.toContain('Seq Scan');
    } finally {
      await c.query('rollback').catch(() => undefined);
      c.release();
    }
  });
});
