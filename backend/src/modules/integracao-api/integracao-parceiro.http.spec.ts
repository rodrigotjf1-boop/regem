import 'reflect-metadata';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
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
import { gerarChave, type AplicativoAprovado } from '../../dms/integracao-dms';
import { HubDmsService } from './hub-dms.service';
import { IntegracaoApiModule } from './integracao-api.module';
import { IntegracaoTokenService } from './integracao-token.service';
import { Escopos, IntegracaoCtx, IntegracaoTokenGuard, type IntegracaoCtxData } from './integracao-token.guard';
import { ROTAS_FORA_DO_PREFIXO } from './ligacao.regras';
import { clienteDoParceiro, LIMITE_PARCEIRO_EMPRESA_POR_MINUTO } from './parceiros.regras';
import { BASE_TIPO_PROBLEMA, ProblemaFilter } from './problema';
import { gerarTokenIntegracao } from './token-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O APLICATIVO DE PARCEIRO na porta de integração (Hub DMS, F4, parte F, PR R1a) — contra o Postgres real e por HTTP de
// verdade (Nest com os guards globais de produção).
//
// O DMS ID e o hub são de mentira num servidor só: o DMS ID assina de verdade (ES384) e o hub publica a lista de parada e
// a lista de aplicativos de parceiro aprovados (pacote 0.9.0). As ligações de parceiro são preparadas direto no banco: o
// clique que as cria para parceiro é a parte R1b. As tabelas da integração são só da NUVEM e o banco do CI é o de uma
// loja: elas vêm das migrations de verdade, num schema só deste teste, sem as chaves estrangeiras para empresa/unidade
// compartilhadas (LIC-088, ERR-109).
//
// O último teste roda o kit do Padrão no modo do DMS ID com as credenciais de parceiro (a classe, a ligação suspensa e a
// parada), que a parte F tornou obrigatórias.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('integracao-parceiro.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

const MIGRACOES = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGRACOES, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');
const FONTES = ['pedido_externo', 'comanda', 'comanda_item', 'cliente'];

const KIT = join(__dirname, '..', '..', '..', 'test', 'dms', 'kit-conformidade.mts');
const COPIA_DO_PACOTE = join(__dirname, '..', '..', 'dms', 'integracao-dms.ts');
const [NODE_MAIOR, NODE_MENOR] = process.versions.node.split('.').map(Number);
const NODE_RODA_O_KIT = NODE_MAIOR > 22 || (NODE_MAIOR === 22 && NODE_MENOR >= 6);
const itDoKit = NODE_RODA_O_KIT || process.env.KIT_DMS_OBRIGATORIO === 'true' ? it : it.skip;

// Identificadores visivelmente fictícios: o repositório é público.
const APP_LIAME = 'aplicativo-liame-de-teste';
const APP_PARCEIRO = 'aplicativoparceiro01'; // etapa de teste
const APP_PARCEIRO_PROD = 'aplicativoparceiro02'; // produção com dado pessoal
const APP_PARCEIRO_FORA = 'aplicativoparceiro99'; // não está na lista do hub
const APP_FORA = 'aplicativo-fora-da-lista';
const APP_REGEM = 'aplicativo-regem-de-teste';
const SEGREDO_DO_REGEM = 'segredo-do-aplicativo-regem-0123456789';
const TOKEN_DO_HUB = 'token-do-hub-de-teste';
const KID = 'chave-de-teste';

type Pedido = { metodo: string; caminho: string; corpo: any };
type ItemDeParada = { nivel: string; produto: string | null; alvo: string | null };

const aprovado = (o: Partial<AplicativoAprovado>): AplicativoAprovado => ({
  aplicativo: APP_PARCEIRO,
  nome: 'Painel Exemplo',
  para_que_serve: 'mostra os pedidos da loja num painel',
  empresa: { razao_social: 'Exemplo Sistemas Ltda', cnpj: '12ABC34501DE36' },
  etapa: 'teste',
  permissoes: [
    { nome: 'pedidos.ler', motivo: 'Mostrar os pedidos da loja no painel.', necessaria: true },
    { nome: 'catalogo.ler', motivo: 'O nome dos itens no painel.', necessaria: false },
    { nome: 'custos.ler', motivo: 'A margem de cada item no painel.', necessaria: false },
    { nome: 'clientes.anonimizacao.ler', motivo: 'Apagar do painel quem pediu para ser esquecido.', necessaria: false },
  ],
  enderecos_de_volta: ['https://app.exemplo.test/volta'],
  bases_dos_avisos: ['https://api.exemplo.test/avisos/'],
  lojas_max: 3,
  so_leitura: true,
  dado_pessoal: false,
  aprovado_em: '2026-10-24T12:00:00.000Z',
  ...o,
});

/** O DMS ID e o hub de mentira num servidor só. */
async function subirFalsos(recurso: () => string) {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-384' });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, use: 'sig', alg: 'ES384' };
  const pedidos: Pedido[] = [];
  const estado = {
    parada: { versao: 1, itens: [] as ItemDeParada[] },
    paradaFora: true, // a primeira prova: o parceiro não entra antes de a parada ser lida
    aprovados: {
      versao: 1,
      itens: [
        aprovado({}),
        aprovado({ aplicativo: APP_PARCEIRO_PROD, nome: 'Painel Produção', etapa: 'producao', lojas_max: null, dado_pessoal: true }),
        // o client_id do Liame na lista do hub: o Regem decide "é DMS" antes, e ele nunca vira parceiro
        aprovado({ aplicativo: APP_LIAME, nome: 'Painel Clone', permissoes: [{ nome: 'pedidos.ler', motivo: 'Ler os pedidos da loja.', necessaria: true }] }),
      ],
    },
  };
  const servidor: Server = createServer((req: IncomingMessage, res) => {
    let texto = '';
    req.on('data', (d) => (texto += d));
    req.on('end', () => {
      let corpo: any = texto;
      try {
        corpo = texto ? JSON.parse(texto) : null;
      } catch {
        /* corpo de formulário (o pedido de token) */
      }
      pedidos.push({ metodo: req.method ?? '', caminho: req.url ?? '', corpo });
      const responder = (status: number, json: unknown, extra: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': 'application/json', ...extra });
        res.end(json === undefined ? undefined : JSON.stringify(json));
      };
      if (req.url === '/oidc/jwks') return responder(200, { keys: [jwk] });
      if (req.url === '/oidc/token') return responder(200, { access_token: TOKEN_DO_HUB, expires_in: 3600, token_type: 'Bearer' });
      if (req.headers.authorization !== `Bearer ${TOKEN_DO_HUB}`) return responder(401, {});
      if (req.url === '/api/v1/batida') return responder(200, { parada_versao: estado.parada.versao, aplicativos_versao: estado.aprovados.versao });
      if (req.url === '/api/v1/parada') {
        if (estado.paradaFora) return responder(500, { detail: 'parada fora (teste)' });
        if (req.headers['if-none-match'] === `"v${estado.parada.versao}"`) return responder(304, undefined);
        return responder(200, estado.parada, { etag: `"v${estado.parada.versao}"` });
      }
      if (req.url === '/api/v1/aplicativos') {
        if (req.headers['if-none-match'] === `"v${estado.aprovados.versao}"`) return responder(304, undefined);
        return responder(200, estado.aprovados, { etag: `"v${estado.aprovados.versao}"` });
      }
      if (req.url === '/api/v1/registro') return responder(202, { recebidas: corpo?.chamadas?.length ?? 0, novas: 0, repetidas: 0 });
      if (req.url === '/api/v1/erros') return responder(202, { recebidos: corpo?.erros?.length ?? 0, contados: 0, grupos: [] });
      return responder(404, {});
    });
  });
  await new Promise<void>((pronto) => servidor.listen(0, '127.0.0.1', pronto));
  const base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const emitir = (o: { aplicativo?: string; scope?: string; destino?: string; expiraEmSeg?: number } = {}) => {
    const agora = Math.floor(Date.now() / 1000);
    const cabeca = b64({ alg: 'ES384', typ: 'at+jwt', kid: KID });
    const aplicativo = o.aplicativo ?? APP_LIAME;
    const corpo = b64({
      iss: `${base}/oidc`,
      aud: o.destino ?? recurso(),
      sub: aplicativo,
      client_id: aplicativo,
      scope: o.scope ?? 'pedidos.ler catalogo.ler custos.ler cupons.ler cupons.criar clientes.anonimizacao.ler',
      iat: agora,
      exp: agora + (o.expiraEmSeg ?? 3600),
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

/** O corpo sem o código de rastreio: "a mesma resposta" é a resposta inteira. */
const semRastreio = (c: any) => {
  const { request_id: _r, ...resto } = c ?? {};
  return JSON.stringify(resto);
};

descrever('API de integração — o aplicativo de parceiro (Hub DMS, F4 parte F, R1a)', () => {
  const SCHEMA = `teste_parceiro_${process.pid}_${Date.now()}`;
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
    'HUB_RECURSO', 'HUB_APLICATIVO', 'HUB_SEGREDO', 'ACEITAR_INTEGRACOES', 'APP_VERSION', 'PARCEIROS_LIGADOS',
  ] as const;
  const envOriginal = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  let falsos: Awaited<ReturnType<typeof subirFalsos>>;
  let app: INestApplication;
  let hub: HubDmsService;
  let origem = '';
  let recurso = '';

  // Rotas de TESTE: o escopo do Liame que passa do teto do parceiro, um sensível, e o contexto que o guard montou.
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

  @Controller('integracao/teste-custo')
  @UseGuards(IntegracaoTokenGuard)
  @UseFilters(ProblemaFilter)
  class RotaDoCusto {
    @Get()
    @Escopos('custos.ler')
    ok() {
      return { ok: true };
    }
  }

  @Controller('integracao/teste-contexto')
  @UseGuards(IntegracaoTokenGuard)
  @UseFilters(ProblemaFilter)
  class RotaDoContexto {
    @Get()
    mostrar(@IntegracaoCtx() ctx: IntegracaoCtxData) {
      return { escopos: ctx.escopos, cliente: ctx.cliente, lerVendasDesde: ctx.lerVendasDesde ?? null };
    }
  }

  @Global()
  @Module({
    providers: [{ provide: DRIZZLE, useValue: db }, { provide: AuditoriaService, useValue: auditoria }],
    exports: [DRIZZLE, AuditoriaService],
  })
  class InfraTeste {}

  @Module({
    imports: [InfraTeste, ThrottlerModule.forRoot([{ ttl: 60000, limit: 5000 }]), IntegracaoApiModule],
    controllers: [RotaComEscopo, RotaDoCusto, RotaDoContexto],
    providers: [
      { provide: APP_GUARD, useClass: CfThrottlerGuard },
      { provide: APP_GUARD, useClass: CloudOnlyGuard },
    ],
  })
  class AppTeste {}

  const chamar = (caminho: string, o: { token?: string; ligacao?: string; method?: string; corpo?: unknown } = {}) =>
    fetch(`${origem}${caminho}`, {
      method: o.method ?? (o.corpo === undefined ? 'GET' : 'POST'),
      headers: {
        ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.ligacao ? { 'DMS-Ligacao': o.ligacao } : {}),
        ...(o.corpo === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: o.corpo === undefined ? undefined : JSON.stringify(o.corpo),
    });

  /** Chama como o parceiro (o token do aplicativo dele) com uma ligação. */
  const comoParceiro = (caminho: string, ligacao: string, aplicativo = APP_PARCEIRO, o: { method?: string; corpo?: unknown } = {}) =>
    chamar(caminho, { token: falsos.emitir({ aplicativo }), ligacao, ...o });

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

  /** Uma ligação do Liame (pelo caminho de produção: o token do console trocado pela ligação). */
  async function ligacaoDoLiame(tenant: string, loja: string, pres: string, escopos: string[]) {
    const t = await svc.emitir({ tenantId: tenant, unidadeId: loja, autorizadoPor: pres, escopos, cliente: 'liame', evidencia: 'autorização por escrito (teste)' }, dist);
    segredos.push(t.token);
    const r = await chamar('/api/v1/integracao/dms-id/ligacao', { token: falsos.emitir(), corpo: { token_integracao: t.token } });
    expect(r.status).toBe(200);
    const corpo: any = await r.json();
    segredos.push(corpo.ligacao);
    return { id: t.id as string, token: t.token as string, ligacao: corpo.ligacao as string, prefixo: corpo.prefixo as string };
  }

  /**
   * Uma ligação de parceiro preparada no banco (o clique que a cria é a parte R1b): o acesso (com o `rgm_it_` que nunca
   * sai) e a ligação, com a idade do acesso e da ligação e o último uso.
   */
  async function ligacaoDeParceiro(o: {
    tenant: string;
    loja: string;
    pres: string;
    escopos: string[];
    aplicativo?: string;
    cliente?: string;
    acessoHaDias?: number;
    ligacaoHaDias?: number;
    usoHaDias?: number | null;
    /** O início da janela gravado na troca do clique (`ler_desde`, R1b); ausente = nulo (vale a criação do acesso). */
    lerDesdeHaDias?: number | null;
  }) {
    const aplicativo = o.aplicativo ?? APP_PARCEIRO;
    const t = gerarTokenIntegracao();
    segredos.push(t.token);
    const [linha] = await q(
      `insert into integracao_token_loja
         (tenant_id, unidade_id, cliente, prefixo, token_hash, escopos, autorizado_por, autorizado_por_nome, autorizado_via, evidencia, criado_em, ler_desde)
       values ($1, $2, $3, $4, $5, $6::text[], $7, 'Presidente', 'autorizacao_loja', 'teste do parceiro', now() - make_interval(days => $8),
               case when $9::int is null then null else now() - make_interval(days => $9::int) end)
       returning id`,
      [o.tenant, o.loja, o.cliente ?? clienteDoParceiro(aplicativo), t.prefixo, t.hash, o.escopos, o.pres, o.acessoHaDias ?? 0, o.lerDesdeHaDias ?? null],
    );
    const lg = gerarChave('lg', 'regem');
    segredos.push(lg.chave);
    await q(
      `insert into integracao_ligacao (id, tenant_id, aplicativo, prefixo, segredo_hash, criado_em, ultimo_uso_em)
       values ($1, $2, $3, $4, $5, now() - make_interval(days => $6),
               case when $7::int is null then null else now() - make_interval(days => $7::int) end)`,
      [linha.id, o.tenant, aplicativo, lg.prefixo, lg.resumo, o.ligacaoHaDias ?? o.acessoHaDias ?? 0, o.usoHaDias ?? null],
    );
    return { id: linha.id as string, token: t.token, ligacao: lg.chave, prefixo: lg.prefixo };
  }

  const lerParada = async (itens: ItemDeParada[]) => {
    falsos.estado.parada = { versao: falsos.estado.parada.versao + 1, itens };
    await hub.lerParadaAgora();
    expect(hub.estado?.paradaVersao).toBe(falsos.estado.parada.versao);
  };

  let A: { tenant: string; lojas: string[] };
  let B: { tenant: string; lojas: string[] };
  let presA = '';
  let presB = '';
  let liame: Awaited<ReturnType<typeof ligacaoDoLiame>>;
  let parceiro: Awaited<ReturnType<typeof ligacaoDeParceiro>>;
  let desconhecida = '';

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a API é da NUVEM
    delete process.env.ACEITAR_INTEGRACOES;
    delete process.env.APP_VERSION;
    await pool.query(`create schema ${SCHEMA}`);
    for (const t of FONTES) await pool.query(`create table ${SCHEMA}.${t} (like public.${t} including all)`);
    await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig('295_integracao_token_loja.sql'))));
    await repetirNaCorridaDeCatalogo(() => pool.query(mig('296_integracao_versao_vendas.sql')));
    await repetirNaCorridaDeCatalogo(() => pool.query(mig('297_pedido_externo_comanda_idx.sql')));
    await repetirNaCorridaDeCatalogo(() => pool.query(mig('299_pedido_origem.sql')));
    await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig('303_integracao_autorizacao.sql'))));
    await repetirNaCorridaDeCatalogo(() => pool.query(mig('323_integracao_gogem.sql')));
    await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig('329_integracao_ligacao.sql'))));
    await repetirNaCorridaDeCatalogo(() => pool.query(mig('333_integracao_limite.sql')));
    // A janela de leitura do parceiro (R1b): o guard lê `ler_desde` para o parceiro aprovado.
    await repetirNaCorridaDeCatalogo(() => pool.query(mig('340_integracao_ler_desde.sql')));
    const [fk] = await q(
      `select count(*)::int n from pg_constraint c join pg_namespace s on s.oid = c.connamespace
        where s.nspname = $1 and c.contype = 'f'
          and c.confrelid in ('public.empresa'::regclass, 'public.unidade'::regclass)`,
      [SCHEMA],
    );
    if (fk.n) throw new Error('a cópia das tabelas ainda aponta para empresa/unidade compartilhadas (LIC-088)');

    A = await empresa('Empresa A', ['A1 matriz', 'A2 filial', 'A3 filial']);
    B = await empresa('Empresa B', ['B1 matriz', 'B2 filial']);
    presA = await presidente(A.tenant);
    presB = await presidente(B.tenant);

    falsos = await subirFalsos(() => recurso);
    process.env.HUB_LIGADO = 'true';
    process.env.HUB_URL = falsos.base;
    process.env.HUB_RECURSO = `${falsos.base}/api/v1`;
    process.env.HUB_APLICATIVO = APP_REGEM;
    process.env.HUB_SEGREDO = SEGREDO_DO_REGEM;
    process.env.DMS_ID_EMISSOR = `${falsos.base}/oidc`;
    process.env.DMS_ID_LIGADO = 'true';
    process.env.DMS_ID_APLICATIVOS = JSON.stringify({ liame: APP_LIAME });
    process.env.PARCEIROS_LIGADOS = 'true';
    app = await NestFactory.create(AppTeste, { logger: false });
    app.setGlobalPrefix('api/v1', { exclude: ROTAS_FORA_DO_PREFIXO });
    await app.listen(0, '127.0.0.1');
    origem = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
    recurso = `${origem}/api/v1/integracao`;
    process.env.DMS_ID_RECURSO = recurso;
    hub = app.get(HubDmsService);

    liame = await ligacaoDoLiame(A.tenant, A.lojas[0], presA, ['pedidos.ler', 'cupons.ler', 'cupons.criar']);
    parceiro = await ligacaoDeParceiro({ tenant: A.tenant, loja: A.lojas[0], pres: presA, escopos: ['pedidos.ler', 'catalogo.ler', 'custos.ler', 'cupons.criar'] });
    desconhecida = gerarChave('lg', 'regem').chave;
  });

  afterAll(async () => {
    await app?.close();
    if (falsos) await new Promise((r) => falsos.servidor.close(r));
    for (const k of ENV) {
      if (envOriginal[k] === undefined) delete process.env[k];
      else process.env[k] = envOriginal[k];
    }
    try {
      // nenhum segredo de token ou ligação deste teste fica no banco (só os resumos)
      const vazou = await q(
        `select count(*)::int n from integracao_token_loja t
           join integracao_ligacao l on l.id = t.id
          where t.token_hash = any($1::text[]) or l.segredo_hash = any($1::text[]) or l.prefixo = any($1::text[])`,
        [segredos],
      );
      expect(vazou[0].n).toBe(0);
    } finally {
      if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
      await pool.query(`drop schema if exists ${SCHEMA} cascade`);
      await pool.end();
    }
  });

  it('o parceiro aprovado não entra antes de a lista de parada ser lida (401 igual à ligação desconhecida); depois, entra', async () => {
    // a lista de aprovados é lida ao iniciar, com um token À PARTE (a permissão aplicativos.ler)
    expect(await esperarAte(() => hub.estado?.aprovadosVersao === 1)).toBe(true);
    expect(falsos.pedidos.some((p) => p.caminho === '/oidc/token' && String(p.corpo).includes('aplicativos.ler'))).toBe(true);
    expect(hub.estado?.paradaVersao).toBeNull();

    const antes = await comoParceiro('/api/v1/integracao/loja', parceiro.ligacao);
    const igual = await comoParceiro('/api/v1/integracao/loja', desconhecida);
    expect([antes.status, igual.status]).toEqual([401, 401]);
    expect(semRastreio(await antes.json())).toBe(semRastreio(await igual.json()));

    falsos.estado.paradaFora = false;
    await hub.lerParadaAgora();
    expect(hub.estado?.paradaVersao).toBe(1);
    const depois = await comoParceiro('/api/v1/integracao/loja', parceiro.ligacao);
    expect(depois.status).toBe(200);
  });

  it('as permissões do parceiro: a ligação E o token E o teto da classe na etapa (no teste, nenhuma sensível)', async () => {
    // a ligação tem 4; o token não tem catalogo.ler; custos.ler é sensível (etapa de teste); cupons.criar passa do teto
    const r = await chamar('/api/v1/integracao/teste-contexto', { token: falsos.emitir({ aplicativo: APP_PARCEIRO, scope: 'pedidos.ler custos.ler cupons.criar' }), ligacao: parceiro.ligacao });
    expect(r.status).toBe(200);
    const c: any = await r.json();
    expect(c.escopos).toEqual(['pedidos.ler']);
    expect(c.cliente).toBe(clienteDoParceiro(APP_PARCEIRO));
    for (const rota of ['teste-escopo', 'teste-custo']) {
      const negado = await comoParceiro(`/api/v1/integracao/${rota}`, parceiro.ligacao);
      expect(negado.status).toBe(403);
      expect((await negado.json()).type).toBe(`${BASE_TIPO_PROBLEMA}escopo-insuficiente`);
    }

    // na produção com dado pessoal aprovado, a sensível do teto entra; o que passa do teto, nunca
    const prod = await ligacaoDeParceiro({ tenant: A.tenant, loja: A.lojas[1], pres: presA, escopos: ['pedidos.ler', 'custos.ler', 'cupons.criar'], aplicativo: APP_PARCEIRO_PROD });
    const rp = await comoParceiro('/api/v1/integracao/teste-contexto', prod.ligacao, APP_PARCEIRO_PROD);
    expect(((await rp.json()) as any).escopos).toEqual(['pedidos.ler', 'custos.ler']);
    expect((await comoParceiro('/api/v1/integracao/teste-escopo', prod.ligacao, APP_PARCEIRO_PROD)).status).toBe(403);
  });

  it('o client_id de um produto da DMS na lista do hub segue DMS: sem teto de parceiro, e a ligação "de parceiro" dele não vale', async () => {
    const r = await chamar('/api/v1/integracao/teste-contexto', { token: falsos.emitir(), ligacao: liame.ligacao });
    const c: any = await r.json();
    expect(c.escopos).toEqual(['pedidos.ler', 'cupons.ler', 'cupons.criar']);
    expect(c.cliente).toBe('liame');
    expect(c.lerVendasDesde).toBeNull();
    const clone = await ligacaoDeParceiro({ tenant: A.tenant, loja: A.lojas[2], pres: presA, escopos: ['pedidos.ler'], aplicativo: APP_LIAME });
    expect((await chamar('/api/v1/integracao/loja', { token: falsos.emitir(), ligacao: clone.ligacao })).status).toBe(401);
  });

  it('desligado (PARCEIROS_LIGADOS ausente) ou fora da lista do hub: 401 igual à ligação desconhecida; o Liame segue', async () => {
    const fora = await ligacaoDeParceiro({ tenant: A.tenant, loja: A.lojas[1], pres: presA, escopos: ['pedidos.ler'], aplicativo: APP_PARCEIRO_FORA });
    const corpoDesconhecida = semRastreio(await (await comoParceiro('/api/v1/integracao/loja', desconhecida)).json());
    const rFora = await comoParceiro('/api/v1/integracao/loja', fora.ligacao, APP_PARCEIRO_FORA);
    expect(rFora.status).toBe(401);
    expect(semRastreio(await rFora.json())).toBe(corpoDesconhecida);

    delete process.env.PARCEIROS_LIGADOS;
    try {
      const r = await comoParceiro('/api/v1/integracao/loja', parceiro.ligacao);
      expect(r.status).toBe(401);
      expect(semRastreio(await r.json())).toBe(corpoDesconhecida);
      expect((await chamar('/api/v1/integracao/loja', { token: falsos.emitir(), ligacao: liame.ligacao })).status).toBe(200);
    } finally {
      process.env.PARCEIROS_LIGADOS = 'true';
    }
    expect((await comoParceiro('/api/v1/integracao/loja', parceiro.ligacao)).status).toBe(200);
  });

  it('a ligação de parceiro parada há 90 dias: 403 ligacao-suspensa; com uso há 89, 200; a do Liame parada há 100, 200', async () => {
    const parada = await ligacaoDeParceiro({ tenant: A.tenant, loja: A.lojas[2], pres: presA, escopos: ['pedidos.ler'], acessoHaDias: 91 });
    const r = await comoParceiro('/api/v1/integracao/loja', parada.ligacao);
    expect(r.status).toBe(403);
    expect(r.headers.get('content-type')).toMatch(/application\/problem\+json/);
    const c: any = await r.json();
    expect(c.type).toBe(`${BASE_TIPO_PROBLEMA}ligacao-suspensa`);
    expect(c.detail).toMatch(/90 dias/);

    const usada = await ligacaoDeParceiro({ tenant: B.tenant, loja: B.lojas[1], pres: presB, escopos: ['pedidos.ler'], acessoHaDias: 200, usoHaDias: 89 });
    expect((await comoParceiro('/api/v1/integracao/loja', usada.ligacao)).status).toBe(200);

    await q(`update integracao_ligacao set criado_em = now() - interval '100 days', ultimo_uso_em = now() - interval '100 days' where id = $1`, [liame.id]);
    expect((await chamar('/api/v1/integracao/loja', { token: falsos.emitir(), ligacao: liame.ligacao })).status).toBe(200);
  });

  it('a parada pelo client_id: o nível aplicativo com o client_id para o parceiro (503); com o cliente do Regem, não para; o hub registra pelo client_id', async () => {
    await lerParada([{ nivel: 'aplicativo', produto: null, alvo: clienteDoParceiro(APP_PARCEIRO) }]);
    expect((await comoParceiro('/api/v1/integracao/loja', parceiro.ligacao)).status).toBe(200);

    await lerParada([{ nivel: 'aplicativo', produto: null, alvo: APP_PARCEIRO }]);
    const r = await comoParceiro('/api/v1/integracao/loja', parceiro.ligacao);
    expect(r.status).toBe(503);
    expect((await r.json()).type).toBe(`${BASE_TIPO_PROBLEMA}integracao-parada`);
    expect((await chamar('/api/v1/integracao/loja', { token: falsos.emitir(), ligacao: liame.ligacao })).status).toBe(200);
    await lerParada([]);
    expect((await comoParceiro('/api/v1/integracao/loja', parceiro.ligacao)).status).toBe(200);

    // o registro central leva o client_id do parceiro (é por ele que o hub conta e suspende — F4-7)
    const ate = Date.now() + 5_000;
    let doParceiro: any[] = [];
    while (Date.now() < ate && !doParceiro.length) {
      await new Promise((res) => setTimeout(res, 50));
      await hub.enviarAgora();
      doParceiro = falsos.pedidos
        .filter((p) => p.caminho === '/api/v1/registro')
        .flatMap((p) => p.corpo?.chamadas ?? [])
        .filter((ch: any) => ch.ligacaoPrefixo === parceiro.prefixo || ch.ligacao_prefixo === parceiro.prefixo);
    }
    expect(doParceiro.length).toBeGreaterThan(0);
    expect(new Set(doParceiro.map((ch: any) => ch.aplicativo))).toEqual(new Set([APP_PARCEIRO]));
  });

  it(`o teto da empresa (${LIMITE_PARCEIRO_EMPRESA_POR_MINUTO}/min, todas as lojas) vale só para o parceiro, e cada empresa conta à parte`, async () => {
    const chaveA = `emp:${clienteDoParceiro(APP_PARCEIRO)}:${A.tenant}`;
    const chaveB = `emp:${clienteDoParceiro(APP_PARCEIRO)}:${B.tenant}`;
    await q(`delete from integracao_limite where chave like 'emp:%'`);
    try {
      await q(`insert into integracao_limite (chave, inicio, chamadas) values ($1, now(), $2)`, [chaveA, LIMITE_PARCEIRO_EMPRESA_POR_MINUTO]);
      const r = await comoParceiro('/api/v1/integracao/loja', parceiro.ligacao);
      expect(r.status).toBe(429);
      expect(Number(r.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
      const c: any = await r.json();
      expect(c.type).toBe(`${BASE_TIPO_PROBLEMA}limite-de-chamadas`);
      expect(c.detail).toMatch(/nesta empresa/);

      // a outra empresa conta à parte
      const emB = await ligacaoDeParceiro({ tenant: B.tenant, loja: B.lojas[0], pres: presB, escopos: ['pedidos.ler'] });
      expect((await comoParceiro('/api/v1/integracao/loja', emB.ligacao)).status).toBe(200);
      const [linhaB] = await q(`select chamadas from integracao_limite where chave = $1`, [chaveB]);
      expect(Number(linhaB.chamadas)).toBe(1);

      // o Liame não tem contador de empresa: nem um contador cheio o para, e a chamada dele não cria um
      await q(`insert into integracao_limite (chave, inicio, chamadas) values ($1, now(), 100000)`, [`emp:liame:${A.tenant}`]);
      expect((await chamar('/api/v1/integracao/loja', { token: falsos.emitir(), ligacao: liame.ligacao })).status).toBe(200);
      const [doLiame] = await q(`select chamadas from integracao_limite where chave = $1`, [`emp:liame:${A.tenant}`]);
      expect(Number(doLiame.chamadas)).toBe(100000);
      const chaves = (await q(`select chave from integracao_limite where chave like 'emp:%'`)).map((l: any) => l.chave as string);
      expect(chaves.sort()).toEqual([chaveA, chaveB, `emp:liame:${A.tenant}`].sort());
    } finally {
      await q(`delete from integracao_limite where chave like 'emp:%'`);
    }
  });

  it('a chamada recusada não gasta a cota da empresa: passou dos 60 da ligação, ligação suspensa ou parceiro fora da lista', async () => {
    const chaveA = `emp:${clienteDoParceiro(APP_PARCEIRO)}:${A.tenant}`;
    const contaDaEmpresa = async (chave: string) => {
      const [l] = await q(`select chamadas from integracao_limite where chave = $1`, [chave]);
      return l ? Number(l.chamadas) : 0;
    };
    await q(`delete from integracao_limite where chave like 'emp:%'`);
    try {
      // a ligação já no teto dela (60): a chamada leva 429 da LIGAÇÃO e não conta na empresa
      await q(
        `insert into integracao_limite (chave, inicio, chamadas) values ($1, now(), $2)
         on conflict (chave) do update set inicio = now(), chamadas = $2`,
        [parceiro.id, LIMITE_INTEGRACAO_POR_MINUTO],
      );
      const r = await comoParceiro('/api/v1/integracao/loja', parceiro.ligacao);
      expect(r.status).toBe(429);
      expect((await r.json()).detail).toMatch(/esta ligação/);
      expect(await contaDaEmpresa(chaveA)).toBe(0);
      await q(`delete from integracao_limite where chave = $1`, [parceiro.id]);

      // a ligação suspensa (403) não conta
      const suspensa = await ligacaoDeParceiro({ tenant: A.tenant, loja: A.lojas[1], pres: presA, escopos: ['pedidos.ler'], acessoHaDias: 95 });
      expect((await comoParceiro('/api/v1/integracao/loja', suspensa.ligacao)).status).toBe(403);
      expect(await contaDaEmpresa(chaveA)).toBe(0);

      // o parceiro fora da lista do hub (401) não conta na empresa dele
      const fora = await ligacaoDeParceiro({ tenant: A.tenant, loja: A.lojas[2], pres: presA, escopos: ['pedidos.ler'], aplicativo: APP_PARCEIRO_FORA });
      expect((await comoParceiro('/api/v1/integracao/loja', fora.ligacao, APP_PARCEIRO_FORA)).status).toBe(401);
      expect(await contaDaEmpresa(`emp:${clienteDoParceiro(APP_PARCEIRO_FORA)}:${A.tenant}`)).toBe(0);

      // e a que passa conta: uma
      expect((await comoParceiro('/api/v1/integracao/loja', parceiro.ligacao)).status).toBe(200);
      expect(await contaDaEmpresa(chaveA)).toBe(1);
    } finally {
      await q(`delete from integracao_limite where chave like 'emp:%' or chave = $1`, [parceiro.id]);
    }
  });

  it('as vendas e as anonimizações: o parceiro lê só as de depois que o acesso nasceu, sem a origem do anúncio; o Liame lê tudo, com a origem', async () => {
    const naJanela = await ligacaoDeParceiro({ tenant: B.tenant, loja: B.lojas[0], pres: presB, escopos: ['pedidos.ler', 'clientes.anonimizacao.ler'], acessoHaDias: 2 });
    const liameB = await ligacaoDoLiame(B.tenant, B.lojas[0], presB, ['pedidos.ler', 'clientes.anonimizacao.ler']);
    const venda = async (confirmadaHaDias: number) => {
      const id = randomUUID();
      await q(
        `insert into integracao_versao (recurso, recurso_id, tenant_id, fonte, unidade_id, versao, pendente, atualizado_em, situacao, confirmado_em, foto)
         values ('venda', $1, $2, 'pedido_externo', $3, 1, false, now() - interval '1 hour', 'confirmado',
                 now() - make_interval(days => $4), $5::jsonb)`,
        [id, B.tenant, B.lojas[0], confirmadaHaDias, JSON.stringify({ canal: 'cardapio', grupo: 'proprio', receita: 2500, desconto: 0, confirmado_em: new Date(Date.now() - confirmadaHaDias * 86_400_000).toISOString(), itens: [] })],
      );
      await q(`insert into pedido_origem (pedido_id, tenant_id, capturado_em, utm_source) values ($1, $2, now(), 'instagram')`, [id, B.tenant]);
      return id;
    };
    const antiga = await venda(3);
    const nova = await venda(1);

    const rp = await comoParceiro('/api/v1/integracao/pedidos', naJanela.ligacao);
    expect(rp.status).toBe(200);
    const doParceiro: any = await rp.json();
    expect(doParceiro.itens.map((v: any) => v.id)).toEqual([nova]);
    expect(doParceiro.itens[0].origem).toBeNull();

    const rl = await chamar('/api/v1/integracao/pedidos', { token: falsos.emitir(), ligacao: liameB.ligacao });
    expect(rl.status).toBe(200);
    const doLiame: any = await rl.json();
    expect(doLiame.itens.map((v: any) => v.id).sort()).toEqual([antiga, nova].sort());
    expect(doLiame.itens.find((v: any) => v.id === nova).origem.utm_source).toBe('instagram');

    // os pedidos de esquecer: o parceiro só os de depois que o acesso nasceu (dos de antes, ele nunca leu o cliente)
    const esquecido = async (haDias: number) => {
      const id = randomUUID();
      await q(
        `insert into integracao_versao (recurso, recurso_id, tenant_id, fonte, versao, pendente, atualizado_em, removido_em)
         values ('cliente', $1, $2, 'cliente', 1, false, now() - interval '1 hour', now() - make_interval(days => $3))`,
        [id, B.tenant, haDias],
      );
      return id;
    };
    const esquecidoAntes = await esquecido(3);
    const esquecidoDepois = await esquecido(1);
    const ap = await comoParceiro('/api/v1/integracao/clientes/anonimizados', naJanela.ligacao);
    expect(ap.status).toBe(200);
    expect(((await ap.json()) as any).itens.map((c: any) => c.id)).toEqual([esquecidoDepois]);
    const al = await chamar('/api/v1/integracao/clientes/anonimizados', { token: falsos.emitir(), ligacao: liameB.ligacao });
    expect(((await al.json()) as any).itens.map((c: any) => c.id).sort()).toEqual([esquecidoAntes, esquecidoDepois].sort());
  });

  it('a janela é a da autorização contínua (ler_desde, gravada na troca do clique); sem ela, a criação do acesso', async () => {
    const herdada = await ligacaoDeParceiro({ tenant: B.tenant, loja: B.lojas[1], pres: presB, escopos: ['pedidos.ler'], acessoHaDias: 1, lerDesdeHaDias: 30 });
    const r = await comoParceiro('/api/v1/integracao/teste-contexto', herdada.ligacao);
    const c: any = await r.json();
    const [{ ler }] = await q(`select to_char(ler_desde at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as ler from integracao_token_loja where id = $1`, [herdada.id]);
    expect(c.lerVendasDesde).toBe(ler);
    const sem = await ligacaoDeParceiro({ tenant: B.tenant, loja: B.lojas[0], pres: presB, escopos: ['pedidos.ler'], acessoHaDias: 2 });
    const c2: any = await (await comoParceiro('/api/v1/integracao/teste-contexto', sem.ligacao)).json();
    const [{ criado }] = await q(`select to_char(criado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as criado from integracao_token_loja where id = $1`, [sem.id]);
    expect(c2.lerVendasDesde).toBe(criado);
  });

  it('o rgm_it_ de um acesso de parceiro não entra (só a ligação vale para parceiro)', async () => {
    const r = await chamar('/api/v1/integracao/loja', { token: parceiro.token });
    expect(r.status).toBe(401);
    expect((await r.json()).type).toBe(`${BASE_TIPO_PROBLEMA}token-invalido`);
  });

  it('o parceiro não registra aviso nesta parte (PUT /webhook: 422; os avisos de parceiro vêm na R2)', async () => {
    const r = await comoParceiro('/api/v1/integracao/webhook', parceiro.ligacao, APP_PARCEIRO, {
      method: 'PUT',
      corpo: { url: 'https://api.exemplo.test/avisos/ligacao-1', segredo: 'x'.repeat(32) },
    });
    expect(r.status).toBe(422);
    expect((await r.json()).type).toBe(`${BASE_TIPO_PROBLEMA}endereco-nao-permitido`);
  });

  itDoKit('passa no kit do Padrão no modo do DMS ID com as credenciais de parceiro (a classe, a ligação suspensa e a parada)', async () => {
    const valida = await ligacaoDoLiame(A.tenant, A.lojas[1], presA, ['pedidos.ler', 'cupons.criar']);
    const revogada = await ligacaoDoLiame(A.tenant, A.lojas[2], presA, ['pedidos.ler', 'cupons.criar']);
    await svc.revogarPeloConsole(revogada.id, 'kit: ligação revogada', dist);
    const semPermissao = await ligacaoDoLiame(B.tenant, B.lojas[1], presB, ['pedidos.ler']);
    const paradaNoHub = await ligacaoDoLiame(B.tenant, B.lojas[0], presB, ['pedidos.ler', 'cupons.criar']);
    const doParceiro = await ligacaoDeParceiro({ tenant: B.tenant, loja: B.lojas[1], pres: presB, escopos: ['pedidos.ler', 'cupons.criar'] });
    const suspensa = await ligacaoDeParceiro({ tenant: B.tenant, loja: B.lojas[0], pres: presB, escopos: ['pedidos.ler'], acessoHaDias: 120 });
    await lerParada([{ nivel: 'ligacao', produto: 'regem', alvo: paradaNoHub.prefixo }]);
    const credenciais = {
      KIT_TOKEN: falsos.emitir(),
      KIT_LIGACAO: valida.ligacao,
      KIT_TOKEN_OUTRO_DESTINO: falsos.emitir({ destino: 'https://outro-produto.exemplo.test/api/v1/mcp' }),
      KIT_TOKEN_VENCIDO: falsos.emitir({ expiraEmSeg: -120 }),
      KIT_TOKEN_SEM_PERMISSAO: falsos.emitir({ scope: '' }),
      KIT_TOKEN_OUTRO_APLICATIVO: falsos.emitir({ aplicativo: APP_FORA }),
      KIT_LIGACAO_REVOGADA: revogada.ligacao,
      KIT_LIGACAO_SEM_PERMISSAO: semPermissao.ligacao,
      KIT_TOKEN_PARCEIRO: falsos.emitir({ aplicativo: APP_PARCEIRO, scope: 'pedidos.ler cupons.criar' }),
      KIT_LIGACAO_PARCEIRO: doParceiro.ligacao,
      KIT_LIGACAO_PARCEIRO_SUSPENSA: suspensa.ligacao,
      KIT_LIGACAO_PARADA: paradaNoHub.ligacao,
    };
    const config = {
      modo: 'dms_id',
      produto: 'regem',
      base: origem,
      porta: 'rest',
      leitura: { caminho: '/api/v1/integracao/teste-escopo', permissao: 'cupons.criar' },
      limite: { chamadas: LIMITE_INTEGRACAO_POR_MINUTO + 1 },
      copiaDoPacote: COPIA_DO_PACOTE,
      acimaDaClasse: { caminho: '/api/v1/integracao/teste-escopo', metodo: 'GET', permissao: 'cupons.criar' },
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
      credenciaisOpcionais: {
        tokenParceiro: 'KIT_TOKEN_PARCEIRO',
        ligacaoParceiro: 'KIT_LIGACAO_PARCEIRO',
        ligacaoParceiroSuspensa: 'KIT_LIGACAO_PARCEIRO_SUSPENSA',
        ligacaoParada: 'KIT_LIGACAO_PARADA',
      },
    };
    const pasta = mkdtempSync(join(tmpdir(), 'kit-dms-'));
    const arquivo = join(pasta, 'config.json');
    writeFileSync(arquivo, JSON.stringify(config));
    try {
      const { codigo, saida } = await new Promise<{ codigo: number | null; saida: string }>((pronto) => {
        const filho = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', KIT, arquivo], { env: { ...process.env, ...credenciais } });
        let s = '';
        filho.stdout.on('data', (d) => (s += d));
        filho.stderr.on('data', (d) => (s += d));
        filho.on('close', (c) => pronto({ codigo: c, saida: s }));
      });
      const linhas = saida.split(/\r?\n/).filter((l) => /^[✔✘–] /.test(l));
      expect({ codigo, falhas: linhas.filter((l) => l.startsWith('✘')), saida: codigo === 0 ? '' : saida }).toEqual({ codigo: 0, falhas: [], saida: '' });
      // as três da parte F agora RODAM (e passam); puladas, só as da conta, do cursor e da escrita e a da MCP
      expect(linhas.filter((l) => /^✔ dmsid-(acima-da-classe|ligacao-suspensa|parada-ligada)/.test(l)).map((l) => l.split(':')[0])).toEqual([
        '✔ dmsid-acima-da-classe',
        '✔ dmsid-ligacao-suspensa',
        '✔ dmsid-parada-ligada',
      ]);
      expect(linhas.filter((l) => l.startsWith('–')).map((l) => l.split(':')[0])).toEqual([
        '– dmsid-mesma-conta-ve',
        '– dmsid-outra-conta-nao-ve',
        '– dmsid-cursor-invalido',
        '– dmsid-cursor-de-outra-conta',
        '– dmsid-escrita-sem-idempotencia',
        '– dmsid-idempotencia-repete',
        '– dmsid-idempotencia-outro-corpo',
        '– dmsid-mcp-metadados',
      ]);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
      await lerParada([]);
    }
  });
});
