import 'reflect-metadata';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
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
import { IntegracaoApiModule } from './integracao-api.module';
import { IntegracaoTokenService } from './integracao-token.service';
import { Escopos, IntegracaoTokenGuard } from './integracao-token.guard';
import { HubDmsService } from './hub-dms.service';
import { ROTAS_FORA_DO_PREFIXO } from './ligacao.regras';
import { BASE_TIPO_PROBLEMA, ProblemaFilter } from './problema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O HUB DA DMS no Regem (Hub DMS, F3, parte A2) — por HTTP de verdade, contra o Postgres real e um servidor de mentira
// que faz o DMS ID (as chaves públicas e o token do aplicativo do Regem) e o hub (batida, lista de parada, registro e
// erros). O cliente é o do pacote comum, sem dublê: o que chega ao hub de mentira é o que chegaria ao hub de verdade.
//
// As tabelas da integração são só da NUVEM e o banco do CI é o de uma loja: 295, 303, 323 e 329 entram num schema só
// deste teste, sem as chaves estrangeiras para `empresa`/`unidade` compartilhadas (LIC-088, ERR-109).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('hub-dms.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(90_000);

const MIGRACOES = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGRACOES, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

// Identificadores visivelmente fictícios: o repositório é público.
const APP_LIAME = 'aplicativo-liame-de-teste';
const APP_REGEM = 'aplicativo-regem-de-teste';
const SEGREDO_DO_REGEM = 'segredo-do-aplicativo-regem-0123456789';
const TOKEN_DO_HUB = 'token-do-hub-de-teste';
const KID = 'chave-de-teste';

type Pedido = { metodo: string; caminho: string; cabecalhos: IncomingMessage['headers']; corpo: any };
type Lista = { versao: number; itens: { nivel: string; produto: string | null; alvo: string | null }[] };

/** O DMS ID e o hub de mentira num servidor só. `fora` = o hub responde 500 a tudo (o DMS ID segue de pé). */
async function subirFalsos(recurso: () => string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'ES384' };
  const pedidos: Pedido[] = [];
  const estado = { lista: { versao: 1, itens: [] } as Lista, fora: false };
  const servidor: Server = createServer((req, res) => {
    let texto = '';
    req.on('data', (d) => (texto += d));
    req.on('end', () => {
      let corpo: any = texto;
      try {
        corpo = texto ? JSON.parse(texto) : null;
      } catch {
        /* corpo de formulário (o pedido de token) */
      }
      pedidos.push({ metodo: req.method ?? '', caminho: req.url ?? '', cabecalhos: req.headers, corpo });
      const responder = (status: number, json: unknown, extra: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...extra });
        res.end(json === undefined ? undefined : JSON.stringify(json));
      };
      if (req.url === '/oidc/jwks') return responder(200, { keys: [jwk] });
      if (req.url === '/oidc/token') return responder(200, { access_token: TOKEN_DO_HUB, expires_in: 3600, token_type: 'Bearer' });
      if (estado.fora) return responder(500, { detail: 'hub fora (teste)' });
      if (req.headers.authorization !== `Bearer ${TOKEN_DO_HUB}`) return responder(401, {});
      if (req.url === '/api/v1/batida') return responder(200, { parada_versao: estado.lista.versao });
      if (req.url === '/api/v1/parada') {
        if (req.headers['if-none-match'] === `"v${estado.lista.versao}"`) return responder(304, undefined);
        return responder(200, estado.lista, { etag: `"v${estado.lista.versao}"` });
      }
      if (req.url === '/api/v1/registro') return responder(202, { recebidas: corpo?.chamadas?.length ?? 0, novas: 0, repetidas: 0 });
      if (req.url === '/api/v1/erros') return responder(202, { recebidos: corpo?.erros?.length ?? 0, contados: 0, grupos: [] });
      return responder(404, {});
    });
  });
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const emitir = (o: { scope?: string } = {}) => {
    const agora = Math.floor(Date.now() / 1000);
    const cabeca = b64({ alg: 'ES384', typ: 'at+jwt', kid: KID });
    const corpo = b64({
      iss: `${base}/oidc`,
      aud: recurso(),
      sub: APP_LIAME,
      client_id: APP_LIAME,
      scope: o.scope ?? 'pedidos.ler cupons.ler cupons.criar',
      iat: agora,
      exp: agora + 3600,
      jti: randomUUID(),
    });
    const assinatura = sign('sha384', Buffer.from(`${cabeca}.${corpo}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${cabeca}.${corpo}.${assinatura}`;
  };
  return { servidor, base, pedidos, estado, emitir };
}

const esperarAte = async (cond: () => boolean, ms = 5_000) => {
  const ate = Date.now() + ms;
  while (Date.now() < ate) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
};

descrever('API de integração — o hub da DMS (Hub DMS, F3 A2)', () => {
  const SCHEMA = `teste_hubdms_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  const db = drizzle(pool) as any;
  const auditoria = { registrar: async () => undefined } as unknown as AuditoriaService;
  const svc = new IntegracaoTokenService(db, auditoria);
  const empresas: string[] = [];
  const segredos: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const ENV = [
    'EDGE_MODE', 'DMS_ID_LIGADO', 'DMS_ID_EMISSOR', 'DMS_ID_RECURSO', 'DMS_ID_APLICATIVOS', 'HUB_LIGADO', 'HUB_URL',
    'HUB_RECURSO', 'HUB_APLICATIVO', 'HUB_SEGREDO', 'ACEITAR_INTEGRACOES', 'APP_VERSION',
  ] as const;
  const envOriginal = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  let falsos: Awaited<ReturnType<typeof subirFalsos>>;
  let app: INestApplication;
  let hub: HubDmsService;
  let origem = '';
  let recurso = '';

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

  // Rota de TESTE que quebra com credencial e e-mail na mensagem: o 5xx vai à lista de erros do hub, limpo.
  @Controller('integracao/teste-quebra')
  @UseGuards(IntegracaoTokenGuard)
  @UseFilters(ProblemaFilter)
  class RotaQueQuebra {
    @Get()
    quebrar() {
      throw new Error(`falhou com rgm_it_${'Z'.repeat(43)} para fulana@exemplo.com.br`);
    }
  }

  @Global()
  @Module({
    providers: [{ provide: DRIZZLE, useValue: db }, { provide: AuditoriaService, useValue: auditoria }],
    exports: [DRIZZLE, AuditoriaService],
  })
  class InfraTeste {}

  @Module({
    imports: [InfraTeste, ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]), IntegracaoApiModule],
    controllers: [RotaComEscopo, RotaQueQuebra],
    providers: [
      { provide: APP_GUARD, useClass: CfThrottlerGuard },
      { provide: APP_GUARD, useClass: CloudOnlyGuard },
    ],
  })
  class AppTeste {}

  const chamar = (caminho: string, o: { token?: string; ligacao?: string; corpo?: unknown } = {}) =>
    fetch(`${origem}${caminho}`, {
      method: o.corpo === undefined ? 'GET' : 'POST',
      headers: {
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.ligacao ? { 'DMS-Ligacao': o.ligacao } : {}),
        ...(o.corpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: o.corpo === undefined ? undefined : JSON.stringify(o.corpo),
    });

  async function empresa(nome: string, lojas: string[]) {
    const [e] = await q(`insert into empresa (nome) values ($1) returning id`, [`${nome} ${randomUUID().slice(0, 6)}`]);
    empresas.push(e.id);
    const ids: string[] = [];
    for (const [i, l] of lojas.entries()) {
      const [u] = await q(`insert into unidade (tenant_id, nome, tipo) values ($1, $2, $3) returning id`, [e.id, l, i === 0 ? 'matriz' : 'filial']);
      ids.push(u.id);
    }
    return { tenant: e.id as string, lojas: ids };
  }

  async function presidente(tenant: string) {
    const [f] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Presidente (função)', 'presidente') returning id`, [tenant]);
    const [c] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, 'Presidente', $2) returning id`, [tenant, f.id]);
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

  /** As chamadas que chegaram ao hub de mentira, de todos os lotes. */
  const registradas = () => falsos.pedidos.filter((p) => p.caminho === '/api/v1/registro').flatMap((p) => p.corpo?.chamadas ?? []);
  const errosNoHub = () => falsos.pedidos.filter((p) => p.caminho === '/api/v1/erros').flatMap((p) => p.corpo?.erros ?? []);
  /**
   * Manda a fila até chegarem `n` registros (e `erros` erros) ao hub de mentira. O registro sai depois que a resposta
   * fecha (assíncrono): mandar uma vez só, logo depois da resposta, corre contra ele.
   */
  const esperarNoHub = async (n: number, erros = 0) => {
    const ate = Date.now() + 5_000;
    while (Date.now() < ate) {
      await hub.enviarAgora();
      if (registradas().length >= n && errosNoHub().length >= erros) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`o hub de mentira recebeu ${registradas().length} registro(s) e ${errosNoHub().length} erro(s); esperava ${n} e ${erros}`);
  };
  /** Manda o que estava na fila (das chamadas anteriores) e zera o que o hub de mentira viu. */
  const esvaziarFila = async () => {
    await new Promise((r) => setTimeout(r, 150));
    await hub.enviarAgora();
    falsos.pedidos.length = 0;
  };

  let A: { tenant: string; lojas: string[] };
  let presA = '';
  let liame: { id: string; token: string; prefixo: string };
  let farol: { id: string; token: string; prefixo: string };
  let ligacao = '';
  let prefixoLigacao = '';

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a API é da NUVEM
    delete process.env.ACEITAR_INTEGRACOES;
    delete process.env.APP_VERSION;
    await pool.query(`create schema ${SCHEMA}`);
    await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig('295_integracao_token_loja.sql'))));
    await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig('303_integracao_autorizacao.sql'))));
    await repetirNaCorridaDeCatalogo(() => pool.query(mig('323_integracao_gogem.sql')));
    await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig('329_integracao_ligacao.sql'))));

    A = await empresa('Empresa A', ['A1 matriz', 'A2 filial']);
    presA = await presidente(A.tenant);
    liame = await emitir(A.tenant, A.lojas[0], presA, ['pedidos.ler', 'cupons.ler']);
    farol = await emitir(A.tenant, A.lojas[1], presA, ['catalogo.ler'], 'farol');

    falsos = await subirFalsos(() => recurso);
    process.env.HUB_LIGADO = 'true';
    process.env.HUB_URL = falsos.base;
    process.env.HUB_RECURSO = `${falsos.base}/api/v1`;
    process.env.HUB_APLICATIVO = APP_REGEM;
    process.env.HUB_SEGREDO = SEGREDO_DO_REGEM;
    process.env.DMS_ID_EMISSOR = `${falsos.base}/oidc`;
    process.env.DMS_ID_LIGADO = 'true';
    process.env.DMS_ID_APLICATIVOS = JSON.stringify({ liame: APP_LIAME });

    app = await NestFactory.create(AppTeste, { logger: false });
    app.setGlobalPrefix('api/v1', { exclude: ROTAS_FORA_DO_PREFIXO });
    await app.listen(0, '127.0.0.1');
    origem = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
    recurso = `${origem}/api/v1/integracao`;
    process.env.DMS_ID_RECURSO = recurso;
    hub = app.get(HubDmsService);

    const troca = await chamar('/api/v1/integracao/dms-id/ligacao', { token: falsos.emitir(), corpo: { token_integracao: liame.token } });
    expect(troca.status).toBe(200);
    const corpo: any = await troca.json();
    ligacao = corpo.ligacao;
    prefixoLigacao = corpo.prefixo;
    segredos.push(ligacao);
  });

  afterAll(async () => {
    await app?.close();
    await new Promise((r) => falsos?.servidor.close(r));
    for (const k of ENV) {
      if (envOriginal[k] === undefined) delete process.env[k];
      else process.env[k] = envOriginal[k];
    }
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  }, 120_000);

  it('ligado: pede o token do aplicativo do Regem ao DMS ID e bate no hub com a versão e a chave própria', async () => {
    expect(hub.ligado).toBe(true);
    expect(await esperarAte(() => falsos.pedidos.some((p) => p.caminho === '/api/v1/batida'))).toBe(true);
    const token = falsos.pedidos.find((p) => p.caminho === '/oidc/token')!;
    expect(token.cabecalhos.authorization).toBe(`Basic ${Buffer.from(`${APP_REGEM}:${SEGREDO_DO_REGEM}`).toString('base64')}`);
    expect(String(token.corpo)).toContain('grant_type=client_credentials');
    const batida = falsos.pedidos.find((p) => p.caminho === '/api/v1/batida')!;
    expect(batida.cabecalhos.authorization).toBe(`Bearer ${TOKEN_DO_HUB}`);
    expect(batida.corpo).toMatchObject({ versao: 'nuvem', aceita_integracoes: true });
  });

  it('cada chamada vai ao registro do hub: quem, por qual credencial, a rota, o resultado e a duração — nunca o segredo', async () => {
    await esvaziarFila();
    expect((await chamar('/api/v1/integracao/loja', { token: liame.token })).status).toBe(200);
    expect((await chamar('/api/v1/integracao/loja', { token: `rgm_it_${'x'.repeat(43)}` })).status).toBe(401);
    expect((await chamar('/api/v1/integracao/loja', { token: falsos.emitir(), ligacao })).status).toBe(200);
    expect((await chamar('/api/v1/integracao/teste-escopo', { token: falsos.emitir(), ligacao })).status).toBe(403);
    await esperarNoHub(4);
    // Cada registro pelo que ele é, não pela posição: o registro sai depois da resposta, e o de uma chamada anterior
    // (a troca do beforeAll, que busca o nome da loja no banco) pode chegar junto, sob carga.
    const r = registradas().filter((c: any) => c.ferramenta !== 'POST /integracao/dms-id/ligacao');
    expect(r).toHaveLength(4);
    expect(new Set(r.map((c: any) => c.codigo)).size).toBe(4);
    const achar = (f: (c: any) => boolean) => {
      const achados = r.filter(f);
      expect(achados).toHaveLength(1);
      return achados[0];
    };
    const peloToken = achar((c) => c.credencial === 'token_integracao' && c.status_http === 200);
    const recusado = achar((c) => c.status_http === 401);
    const pelaLigacao = achar((c) => c.credencial === 'dms_id' && c.status_http === 200);
    const semEscopo = achar((c) => c.status_http === 403);
    expect(peloToken).toMatchObject({
      credencial: 'token_integracao',
      aplicativo: 'liame',
      ligacao_prefixo: liame.prefixo,
      conta: A.lojas[0],
      conta_nome: 'A1 matriz',
      ferramenta: 'GET /integracao/loja',
      resultado: 'aceita',
      status_http: 200,
    });
    expect(peloToken.problema).toBeUndefined();
    expect(peloToken.duracao_ms).toBeGreaterThanOrEqual(0);
    expect(recusado).toMatchObject({ credencial: 'token_integracao', resultado: 'recusada', problema: 'token-invalido', status_http: 401 });
    expect(recusado.aplicativo).toBeUndefined();
    expect(pelaLigacao).toMatchObject({ credencial: 'dms_id', aplicativo: 'liame', ligacao_prefixo: prefixoLigacao, conta_nome: 'A1 matriz', resultado: 'aceita' });
    expect(semEscopo).toMatchObject({ ferramenta: 'GET /integracao/teste-escopo', resultado: 'recusada', problema: 'escopo-insuficiente', status_http: 403 });
    const tudo = JSON.stringify(falsos.pedidos.map((p) => p.corpo));
    for (const s of segredos) {
      expect(tudo).not.toContain(s);
      expect(tudo).not.toContain(s.slice(13, 40));
    }
  });

  it('a lista de parada do hub para o que ela diz (aplicativo, credencial, rota, geral) com 503 integracao-parada', async () => {
    const parar = async (itens: Lista['itens']) => {
      falsos.estado.lista = { versao: falsos.estado.lista.versao + 1, itens };
      await hub.lerParadaAgora();
    };
    const jwt = falsos.emitir();
    try {
      await parar([{ nivel: 'aplicativo', produto: null, alvo: 'liame' }]);
      const parada = await chamar('/api/v1/integracao/loja', { token: liame.token });
      expect(parada.status).toBe(503);
      expect(Number(parada.headers.get('retry-after'))).toBe(60);
      expect(parada.headers.get('content-type')).toContain('application/problem+json');
      expect(await parada.json()).toMatchObject({
        type: `${BASE_TIPO_PROBLEMA}integracao-parada`,
        status: 503,
        detail: expect.stringContaining('parada pela DMS'),
      });
      expect((await chamar('/api/v1/integracao/loja', { token: jwt, ligacao })).status).toBe(503);
      expect((await chamar('/api/v1/integracao/loja', { token: farol.token })).status).toBe(200); // o Farol não

      await parar([{ nivel: 'ligacao', produto: 'regem', alvo: prefixoLigacao }]);
      expect((await chamar('/api/v1/integracao/loja', { token: jwt, ligacao })).status).toBe(503);
      expect((await chamar('/api/v1/integracao/loja', { token: liame.token })).status).toBe(200); // o rgm_it_ é outra credencial

      await parar([{ nivel: 'ferramenta', produto: 'regem', alvo: 'GET /integracao/loja' }]);
      expect((await chamar('/api/v1/integracao/loja', { token: liame.token })).status).toBe(503);
      expect((await chamar('/api/v1/integracao/teste-escopo', { token: liame.token })).status).toBe(403); // outra rota segue

      await parar([{ nivel: 'ferramenta', produto: 'regemcast', alvo: 'GET /integracao/loja' }]);
      expect((await chamar('/api/v1/integracao/loja', { token: liame.token })).status).toBe(200); // a rota de outro produto

      await parar([{ nivel: 'geral', produto: null, alvo: null }]);
      expect((await chamar('/api/v1/integracao/loja', { token: farol.token })).status).toBe(503);
      const troca = await chamar('/api/v1/integracao/dms-id/ligacao', { token: jwt, corpo: { token_integracao: liame.token } });
      expect(troca.status).toBe(503);
      expect(((await troca.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}integracao-parada`);
    } finally {
      await parar([]);
    }
    expect((await chamar('/api/v1/integracao/loja', { token: liame.token })).status).toBe(200);
    await esvaziarFila();
    expect((await chamar('/api/v1/integracao/loja', { token: liame.token })).status).toBe(200);
    await parar([{ nivel: 'aplicativo', produto: null, alvo: 'liame' }]);
    expect((await chamar('/api/v1/integracao/loja', { token: liame.token })).status).toBe(503);
    await parar([]);
    await esperarNoHub(2);
    const daLoja = registradas().filter((c: any) => c.ferramenta === 'GET /integracao/loja');
    expect(daLoja.some((c: any) => c.resultado === 'aceita' && c.status_http === 200 && c.problema === undefined)).toBe(true);
    expect(daLoja.some((c: any) => c.resultado === 'recusada' && c.problema === 'integracao-parada' && c.status_http === 503)).toBe(true);
  });

  it('a chave própria ACEITAR_INTEGRACOES para tudo, antes de qualquer conferência', async () => {
    process.env.ACEITAR_INTEGRACOES = 'false';
    try {
      for (const r of [
        await chamar('/api/v1/integracao/loja', { token: liame.token }),
        await chamar('/api/v1/integracao/loja', { token: falsos.emitir(), ligacao }),
        await chamar('/api/v1/integracao/loja', { token: `rgm_it_${'y'.repeat(43)}` }),
        await chamar('/api/v1/integracao/loja'),
        await chamar('/api/v1/integracao/dms-id/ligacao', { token: falsos.emitir(), corpo: { token_integracao: liame.token } }),
      ]) {
        expect(r.status).toBe(503);
        expect(((await r.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}integracao-parada`);
      }
    } finally {
      delete process.env.ACEITAR_INTEGRACOES;
    }
    expect((await chamar('/api/v1/integracao/loja', { token: liame.token })).status).toBe(200);
  });

  it('o erro inesperado (5xx) vai à lista de erros do hub, sem credencial e sem dado pessoal', async () => {
    await esvaziarFila();
    const r = await chamar('/api/v1/integracao/teste-quebra', { token: liame.token });
    expect(r.status).toBe(500);
    expect(((await r.json()) as any).detail).toBe('Erro interno. Tente de novo em instantes.');
    await esperarNoHub(1, 1);
    const [erro] = errosNoHub();
    expect(erro).toMatchObject({ origem: 'backend', tipo: 'Error', lugar: 'GET /integracao/teste-quebra', quantidade: 1 });
    expect(erro.mensagem).toContain('<segredo>');
    expect(erro.mensagem).not.toContain('rgm_it_');
    expect(erro.mensagem).not.toContain('fulana@');
    const chamada = registradas().find((c: any) => c.ferramenta === 'GET /integracao/teste-quebra');
    expect(chamada).toMatchObject({ resultado: 'erro', problema: 'erro-interno', status_http: 500 });
    expect(erro.codigo).toBe(chamada.codigo);
  });

  it('o hub fora do ar não derruba nada: as chamadas seguem, e a última lista de parada continua valendo', async () => {
    falsos.estado.lista = { versao: falsos.estado.lista.versao + 1, itens: [{ nivel: 'aplicativo', produto: null, alvo: 'farol' }] };
    await hub.lerParadaAgora();
    falsos.estado.fora = true;
    try {
      expect((await chamar('/api/v1/integracao/loja', { token: liame.token })).status).toBe(200);
      await expect(hub.enviarAgora()).resolves.toBeUndefined();
      await expect(hub.lerParadaAgora()).resolves.toBeUndefined();
      expect((await chamar('/api/v1/integracao/loja', { token: farol.token })).status).toBe(503); // a cópia da lista vale
      expect(hub.estado?.ultimaFalha).toMatch(/o hub respondeu 500/);
    } finally {
      falsos.estado.fora = false;
      falsos.estado.lista = { versao: falsos.estado.lista.versao + 1, itens: [] };
      await hub.lerParadaAgora();
    }
    // O que ficou na fila com o hub fora sai quando ele volta.
    falsos.pedidos.length = 0;
    await esperarNoHub(1);
    expect(registradas().some((c: any) => c.ligacao_prefixo === liame.prefixo && c.resultado === 'aceita')).toBe(true);
  });
});
