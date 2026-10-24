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
import { ClienteDmsId, ClienteHub, gerarChave, type AplicativoAprovado, type ItemDeParada } from '../../dms/integracao-dms';
import { AutorizacaoLojaModule } from './autorizacao-loja.module';
import { HubDmsService } from './hub-dms.service';
import { ROTAS_FORA_DO_PREFIXO } from './ligacao.regras';
import { clienteDoParceiro } from './parceiros.regras';
import { gerarTokenIntegracao } from './token-integracao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A AUTORIZAÇÃO POR CLIQUE DO APLICATIVO DE PARCEIRO (Hub DMS, F4 parte F, R1b; mig 340) — contra o Postgres real e por
// HTTP de verdade. O DMS ID é de mentira (assina ES384 de verdade); o hub entra como no `autorizacao-clique.http.spec`
// (o cliente do hub trocado por um com a lista de parada já lida) e a lista de aprovados vai pelo mesmo caminho que a
// lista do hub usa (`guardarParceiros`). As tabelas da integração são só da NUVEM: vêm das migrations de verdade num
// schema só deste teste, sem as chaves estrangeiras para empresa/unidade compartilhadas (LIC-088, ERR-109).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('autorizacao-clique-parceiro.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGS, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

// Identificadores visivelmente fictícios: o repositório é público.
const APP_LIAME = 'aplicativo-liame-de-teste';
const APP_P = 'aplicativoparceiro01'; // o parceiro dos casos gerais
const APP_P2 = 'aplicativoparceiro02'; // as vagas na tela
const APP_P3 = 'aplicativoparceiro03'; // a corrida da troca
const APP_P4 = 'aplicativoparceiro04'; // a janela e a suspensão
const APP_FORA = 'aplicativoparceiro99'; // não aprovado
const KID = 'chave-de-teste';
const VOLTA = 'https://app.parceiro.exemplo/volta';
const SENHA = 'senha-certa-do-teste';
const TODAS = 'pedidos.ler catalogo.ler clientes.anonimizacao.ler cupons.ler custos.ler cupons.criar';
const RAZAO = 'Parceiro Exemplo Sistemas Ltda';
const CNPJ_P = '12ABC34501DE36'; // alfanumérico com o dígito errado, de propósito

const aprovado = (aplicativo: string, o: Partial<AplicativoAprovado> = {}): AplicativoAprovado => ({
  aplicativo,
  nome: 'Painel Exemplo',
  para_que_serve: 'mostra os pedidos da loja num painel da cozinha',
  empresa: { razao_social: RAZAO, cnpj: CNPJ_P },
  etapa: 'teste',
  permissoes: [
    { nome: 'pedidos.ler', motivo: 'Mostrar os pedidos da loja no painel.', necessaria: true },
    { nome: 'catalogo.ler', motivo: 'O nome dos itens no painel.', necessaria: false },
    { nome: 'cupons.ler', motivo: 'Mostrar o cupom usado no pedido.', necessaria: false },
    { nome: 'custos.ler', motivo: 'A margem de cada item no painel.', necessaria: false }, // sensível: fora na etapa de teste
  ],
  enderecos_de_volta: [VOLTA],
  bases_dos_avisos: ['https://api.parceiro.exemplo/avisos/'],
  lojas_max: 3,
  so_leitura: true,
  dado_pessoal: false,
  aprovado_em: '2026-10-24T12:00:00.000Z',
  ...o,
});
const LISTA = {
  versao: 1,
  itens: [
    aprovado(APP_P),
    aprovado(APP_P2, { nome: 'Painel Dois' }),
    aprovado(APP_P3, { nome: 'Painel Três' }),
    aprovado(APP_P4, { nome: 'Painel Quatro' }),
    // o client_id do Liame na lista do hub: o Regem decide "é DMS" antes, e ele segue Liame
    aprovado(APP_LIAME, { nome: 'Painel Clone' }),
  ],
};

type DmsIdFalso = { servidor: Server; emissor: string; emitir(o?: { aplicativo?: string }): string };

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
      const aplicativo = o.aplicativo ?? APP_P;
      const corpo = b64({ iss: emissor, aud: recurso(), sub: aplicativo, client_id: aplicativo, scope: TODAS, iat: agora, exp: agora + 3600, jti: randomUUID() });
      const assinatura = sign('sha384', Buffer.from(`${cabeca}.${corpo}`), { key: privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url');
      return `${cabeca}.${corpo}.${assinatura}`;
    },
  };
}

const esperarAte = async (cond: () => boolean | Promise<boolean>, ms = 15_000) => {
  const ate = Date.now() + ms;
  while (Date.now() < ate) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
};

/** Quantas sessões estão presas atrás da conexão de pid `$1` (a que o teste segura) — V72, ERR-298. */
const SQL_PRESOS_POR = `with recursive presos as (
    select pid from pg_stat_activity where $1::int = any(pg_blocking_pids(pid))
    union
    select a.pid from pg_stat_activity a join presos p on p.pid = any(pg_blocking_pids(a.pid))
  ) select count(*)::int as n from presos`;

const raizNova = () => String(10_000_000 + Math.floor(Math.random() * 89_999_999));

descrever('autorização por clique do aplicativo de parceiro (Hub DMS, F4 parte F, R1b)', () => {
  const SCHEMA = `teste_clique_parceiro_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 10 });
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
  const empresas: string[] = [];
  const segredos: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const email = enviarEmail as unknown as jest.Mock;
  const ENV = [
    'EDGE_MODE', 'TRUST_CLOUDFLARE', 'APP_URL', 'ACEITAR_INTEGRACOES', 'PARCEIROS_LIGADOS',
    'DMS_ID_LIGADO', 'DMS_ID_EMISSOR', 'DMS_ID_RECURSO', 'DMS_ID_APLICATIVOS',
    'AUTORIZACAO_POR_CLIQUE', 'AUTORIZACAO_DMS_RAZAO_SOCIAL', 'AUTORIZACAO_DMS_CNPJ',
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
    imports: [InfraTeste, ThrottlerModule.forRoot([{ ttl: 60000, limit: 1000 }]), AutorizacaoLojaModule],
    providers: [
      { provide: APP_GUARD, useClass: CfThrottlerGuard },
      { provide: APP_GUARD, useClass: CloudOnlyGuard },
    ],
  })
  class AppTeste {}

  type Pessoa = { id: string; tenant: string; nome: string; cat: string };
  const sessao = (p: Pessoa) => jwt.sign({ sub: p.id, tenant: p.tenant, cat: p.cat, nome: p.nome });

  const chamar = (caminho: string, o: { quem?: Pessoa; token?: string | null; ligacao?: string; corpo?: any; form?: boolean } = {}) =>
    fetch(`${origem}/api/v1${caminho}`, {
      method: o.corpo === undefined ? 'GET' : 'POST',
      headers: {
        'cf-connecting-ip': `10.9.${Math.floor(++ip / 250)}.${ip % 250}`,
        ...(o.corpo === undefined ? {} : { 'content-type': o.form ? 'application/x-www-form-urlencoded' : 'application/json' }),
        ...(o.quem ? { authorization: `Bearer ${sessao(o.quem)}` } : o.token ? { authorization: `Bearer ${o.token}` } : {}),
        ...(o.ligacao ? { 'DMS-Ligacao': o.ligacao } : {}),
      },
      body: o.corpo === undefined ? undefined : o.form ? new URLSearchParams(o.corpo).toString() : JSON.stringify(o.corpo),
    });

  async function empresa(nome: string, lojas: string[]) {
    const [e] = await q(`insert into empresa (nome, cnpj) values ($1, $2) returning id, nome`, [`${nome} ${randomUUID().slice(0, 6)}`, `${raizNova()}000100`]);
    empresas.push(e.id);
    const ids: string[] = [];
    for (const [i, l] of lojas.entries()) {
      const [u] = await q(`insert into unidade (tenant_id, nome, tipo) values ($1, $2, $3) returning id`, [e.id, l, i === 0 ? 'matriz' : 'filial']);
      ids.push(u.id);
    }
    return { tenant: e.id as string, nome: e.nome as string, lojas: ids };
  }
  type Emp = Awaited<ReturnType<typeof empresa>>;

  async function presidente(tenant: string, nome: string, mail: string | null = null): Promise<Pessoa> {
    const [f] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, 'presidente') returning id`, [tenant, `${nome} (função)`]);
    const [c] = await q(`insert into colaborador (tenant_id, nome, funcao_id, email, senha_hash) values ($1, $2, $3, $4, $5) returning id`, [
      tenant,
      nome,
      f.id,
      mail,
      bcrypt.hashSync(SENHA, 4),
    ]);
    return { id: c.id, tenant, nome, cat: 'presidente' };
  }

  /** O parceiro empurra o pedido (formulário, RFC 9126). */
  async function pedir(o: { aplicativo?: string; scope?: string; contaCnpj?: string | null } = {}) {
    const verificador = randomBytes(48).toString('base64url');
    const corpo: Record<string, string> = {
      response_type: 'code',
      redirect_uri: VOLTA,
      scope: o.scope ?? 'pedidos.ler catalogo.ler cupons.ler',
      state: randomBytes(24).toString('base64url'),
      code_challenge: createHash('sha256').update(verificador, 'ascii').digest('base64url'),
      code_challenge_method: 'S256',
      conta_nome: 'Conta no Painel',
      conta_email: 'conta@painel.exemplo',
      ...(o.contaCnpj ? { conta_cnpj: o.contaCnpj } : {}),
    };
    const r = await chamar('/integracao/autorizacao/pedido', { token: dmsId.emitir({ aplicativo: o.aplicativo ?? APP_P }), corpo, form: true });
    const c: any = await r.json().catch(() => null);
    const numero = r.status === 201 ? (c.request_uri as string) : null;
    if (numero) segredos.push(numero);
    return { r, c, numero, verificador };
  }

  const tela = async (quem: Pessoa, numero: string | null, aplicativo = APP_P) => {
    const r = await chamar(`/integracoes/autorizacao?${new URLSearchParams({ client_id: aplicativo, request_uri: numero ?? '' })}`, { quem });
    return { r, c: (await r.json()) as any };
  };

  async function autorizar(
    quem: Pessoa,
    numero: string | null,
    o: { lojas: string[]; opcionais?: string[]; resumo?: string | null; aplicativo?: string; confirmo?: boolean },
  ) {
    const r = await chamar('/integracoes/autorizacao', {
      quem,
      corpo: {
        clientId: o.aplicativo ?? APP_P,
        requestUri: numero,
        senha: SENHA,
        lojas: o.lojas,
        opcionais: o.opcionais ?? [],
        confirmoOutraEmpresa: o.confirmo ?? true,
        ...(o.resumo ? { resumo: o.resumo } : {}),
      },
    });
    const c: any = await r.json().catch(() => null);
    const codigo = r.status === 200 ? new URL(c.redirect).searchParams.get('code') : null;
    if (codigo) segredos.push(codigo);
    return { r, c, codigo };
  }

  const trocar = (codigo: string | null, verificador: string, aplicativo = APP_P) =>
    chamar('/integracao/autorizacao/token', {
      token: dmsId.emitir({ aplicativo }),
      corpo: { grant_type: 'authorization_code', code: codigo, code_verifier: verificador, redirect_uri: VOLTA },
    });

  /** Pedido → tela (para o resumo) → autorizar → troca. */
  async function ligar(quem: Pessoa, lojas: string[], o: { aplicativo?: string; opcionais?: string[]; scope?: string } = {}) {
    const aplicativo = o.aplicativo ?? APP_P;
    const p = await pedir({ aplicativo, scope: o.scope });
    expect(p.r.status).toBe(201);
    const t = await tela(quem, p.numero, aplicativo);
    expect(t.c.situacao).toBe('escolha');
    const a = await autorizar(quem, p.numero, { lojas, opcionais: o.opcionais, resumo: t.c.tela.resumo, aplicativo });
    expect(a.r.status).toBe(200);
    const r = await trocar(a.codigo, p.verificador, aplicativo);
    const c: any = await r.json();
    expect(r.status).toBe(200);
    for (const l of c.lojas) segredos.push(l.ligacao);
    return c.lojas as any[];
  }

  /** Um acesso de parceiro vivo numa loja, preparado no banco (para contar vaga sem passar pelo clique). */
  async function acessoNoBanco(e: Emp, loja: string, quem: Pessoa, aplicativo: string, o: { usoHaDias?: number } = {}) {
    const t = gerarTokenIntegracao();
    segredos.push(t.token);
    const [linha] = await q(
      `insert into integracao_token_loja (tenant_id, unidade_id, cliente, prefixo, token_hash, escopos, autorizado_por, autorizado_por_nome, autorizado_via, evidencia)
       values ($1, $2, $3, $4, $5, '{pedidos.ler}', $6, 'Presidente', 'autorizacao_loja', 'teste') returning id`,
      [e.tenant, loja, clienteDoParceiro(aplicativo), t.prefixo, t.hash, quem.id],
    );
    const lg = gerarChave('lg', 'regem');
    segredos.push(lg.chave);
    await q(
      `insert into integracao_ligacao (id, tenant_id, aplicativo, prefixo, segredo_hash, criado_em, ultimo_uso_em)
       values ($1, $2, $3, $4, $5, now() - make_interval(days => $6::int), now() - make_interval(days => $6::int))`,
      [linha.id, e.tenant, aplicativo, lg.prefixo, lg.resumo, o.usoHaDias ?? 0],
    );
    return linha.id as string;
  }

  /** O hub com a lista de parada já lida (e os parceiros aprovados), como o cliente de verdade deixa. */
  function ligarHub(parada: ItemDeParada[] = []) {
    (hub as any).cliente = new ClienteHub({
      url: 'https://hub.exemplo.test',
      recurso: 'https://hub.exemplo.test/api/v1',
      dmsId: new ClienteDmsId({ emissor: 'https://id.exemplo.test/oidc', aplicativo: 'app-regem-teste', segredo: 'segredo-de-teste-1234567' }),
      produto: 'regem',
      versao: 'teste',
      listaInicial: { versao: 1, itens: parada },
    });
    (hub as any).guardarParceiros(LISTA);
  }

  let A: Emp; // duas lojas
  let B: Emp;
  let D: Emp;
  let E: Emp;
  let presA: Pessoa;
  let presB: Pessoa;
  let presD: Pessoa;
  let presE: Pessoa;

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a autorização é da NUVEM
    process.env.TRUST_CLOUDFLARE = 'true';
    process.env.APP_URL = 'https://app.regem.teste';
    process.env.AUTORIZACAO_POR_CLIQUE = 'true';
    process.env.AUTORIZACAO_DMS_RAZAO_SOCIAL = 'DMS Exemplo Ltda';
    process.env.AUTORIZACAO_DMS_CNPJ = '33444555000100';
    process.env.PARCEIROS_LIGADOS = 'true';
    await pool.query(`create schema ${SCHEMA}`);
    await pool.query(`create table ${SCHEMA}.audit_log (like public.audit_log including defaults)`);
    for (const m of ['295_integracao_token_loja.sql', '303_integracao_autorizacao.sql', '323_integracao_gogem.sql', '329_integracao_ligacao.sql', '336_integracao_autorizacao_clique.sql']) {
      await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig(m))));
    }
    // A 340 como vai para a nuvem — a conferência, linha a linha — e de novo: tem de ser idempotente.
    for (let vez = 0; vez < 2; vez++) {
      const r = (await repetirNaCorridaDeCatalogo(() => pool.query(mig('340_integracao_ler_desde.sql')))) as unknown as any[];
      const conferencia = r[r.length - 1].rows;
      expect(conferencia.map((l: any) => [l.objeto, l.ok])).toEqual(conferencia.map((l: any) => [l.objeto, true]));
      expect(conferencia).toHaveLength(2);
    }

    A = await empresa('Brasa', ['Brasa Centro', 'Brasa Praia']);
    B = await empresa('Lanche', ['Lanche Único']);
    D = await empresa('Doce', ['Doce Único']);
    E = await empresa('Esfiha', ['Esfiha Único']);
    presA = await presidente(A.tenant, 'Paulo Presidente', 'paulo@brasa.exemplo');
    presB = await presidente(B.tenant, 'Presidente B', 'presidente@lanche.exemplo');
    presD = await presidente(D.tenant, 'Presidente D');
    presE = await presidente(E.tenant, 'Presidente E');

    dmsId = await subirDmsIdFalso(() => `${origem}/api/v1/integracao`);
    process.env.DMS_ID_LIGADO = 'true';
    process.env.DMS_ID_EMISSOR = dmsId.emissor;
    process.env.DMS_ID_APLICATIVOS = JSON.stringify({ liame: APP_LIAME });
    app = await NestFactory.create(AppTeste, { logger: false });
    app.setGlobalPrefix('api/v1', { exclude: ROTAS_FORA_DO_PREFIXO });
    await app.listen(0, '127.0.0.1');
    origem = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
    process.env.DMS_ID_RECURSO = `${origem}/api/v1/integracao`;
    jwt = app.get(JwtService);
    hub = app.get(HubDmsService);
  });

  beforeEach(() => ligarHub());

  afterEach(() => {
    (hub as any).cliente = null;
    delete process.env.ACEITAR_INTEGRACOES;
  });

  afterAll(async () => {
    await app?.close();
    await new Promise((ok) => dmsId?.servidor.close(ok));
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

  it('o pedido do parceiro aprovado vale; o fora da lista e a chave desligada, não; o pedido sem nenhuma necessária é recusado', async () => {
    expect((await pedir()).r.status).toBe(201);
    expect((await pedir({ aplicativo: APP_FORA })).r.status).toBe(401);
    const soOpcionais = await pedir({ scope: 'catalogo.ler cupons.ler' });
    expect(soOpcionais.r.status).toBe(400);
    expect(soOpcionais.c.detail).toMatch(/necessária/);
    // o que passa do teto (cupons.criar) ou a sensível na etapa de teste (custos.ler) nem pode ser pedido
    expect((await pedir({ scope: 'pedidos.ler custos.ler' })).r.status).toBe(400);
    delete process.env.PARCEIROS_LIGADOS;
    try {
      expect((await pedir()).r.status).toBe(401);
    } finally {
      process.env.PARCEIROS_LIGADOS = 'true';
    }
  });

  it('a tela do parceiro: selo e empresa conferida, o "para que serve" entre aspas, a confirmação sempre, as frases sem o anúncio, a janela no "não pode", as vagas e o resumo', async () => {
    // a conta que pede diz ser a própria empresa (a mesma raiz de CNPJ): a confirmação aparece assim mesmo
    const [{ cnpj }] = await q(`select cnpj from empresa where id = $1`, [A.tenant]);
    const p = await pedir({ contaCnpj: `${String(cnpj).slice(0, 8)}000200` });
    const { c } = await tela(presA, p.numero);
    expect(c.situacao).toBe('escolha');
    const t = c.tela;
    expect(t.classe).toBe('parceiro');
    expect(t.versao).toBe(1);
    expect(t.aplicativo).toMatchObject({ nome: 'Painel Exemplo', selo: 'Verificado pela DMS', empresa: RAZAO, cnpj: '12.ABC.345/01DE-36' });
    expect(t.titulo).toBe('O Painel Exemplo pede acesso às suas lojas');
    expect(t.abertura).toContain('“mostra os pedidos da loja num painel da cozinha”');
    expect(t.contaQuePede.outraEmpresa).toBe(false); // a etiqueta da conta é a calculada
    expect(t.confirmacao.texto).toContain(`vão para a ${RAZAO} (CNPJ 12.ABC.345/01DE-36)`);
    expect(t.necessarias.map((x: any) => x.id)).toEqual(['pedidos.ler']);
    expect(t.necessarias[0].frase).not.toContain('de qual anúncio');
    expect(t.necessarias[0].frase).toContain('Sem o anúncio');
    expect(t.opcionais.map((x: any) => x.id)).toEqual(['cupons.ler', 'catalogo.ler']);
    expect(t.opcionais.find((x: any) => x.id === 'catalogo.ler').frase).toContain('Sem preço');
    expect(t.naoPode.at(-1)).toEqual({ rotulo: 'Ver vendas antigas', frase: 'Ele não lê as vendas de antes desta autorização.' });
    expect(JSON.stringify(t)).not.toMatch(/Liame/);
    expect(t.lojasDoTeste).toEqual({ maximo: 3, vagas: 3 });
    expect(t.resumo).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('autorizar exige o resumo do texto mostrado (409 sem ele ou diferente) e a confirmação; com eles, grava a prova da classe parceiro', async () => {
    // a conta diz ser da mesma empresa: a confirmação é exigida assim mesmo, e a prova grava "outra empresa"
    const [{ cnpj }] = await q(`select cnpj from empresa where id = $1`, [A.tenant]);
    const p = await pedir({ contaCnpj: `${String(cnpj).slice(0, 8)}000200` });
    const { c } = await tela(presA, p.numero);
    const semConfirmar = await autorizar(presA, p.numero, { lojas: [A.lojas[0]], resumo: c.tela.resumo, confirmo: false });
    expect(semConfirmar.r.status).toBe(400);
    expect(semConfirmar.c.message).toMatch(/confirmação/);
    expect((await autorizar(presA, p.numero, { lojas: [A.lojas[0]] })).r.status).toBe(409);
    expect((await autorizar(presA, p.numero, { lojas: [A.lojas[0]], resumo: 'x'.repeat(43) })).r.status).toBe(409);
    // a lista do hub muda o nome entre a tela e o clique: o resumo antigo não vale mais
    (hub as any).guardarParceiros({ versao: 2, itens: LISTA.itens.map((i) => (i.aplicativo === APP_P ? { ...i, nome: 'Painel Novo Nome' } : i)) });
    expect((await autorizar(presA, p.numero, { lojas: [A.lojas[0]], resumo: c.tela.resumo })).r.status).toBe(409);
    (hub as any).guardarParceiros(LISTA);
    const ok = await autorizar(presA, p.numero, { lojas: [A.lojas[0]], resumo: c.tela.resumo });
    expect(ok.r.status).toBe(200);
    const [prova] = await q(`select outra_empresa, texto_versao, texto, cliente from integracao_autorizacao where codigo_hash is not null order by criado_em desc limit 1`);
    expect(prova).toMatchObject({ outra_empresa: true, texto_versao: 1, cliente: clienteDoParceiro(APP_P) });
    expect(prova.texto).toMatchObject({ classe: 'parceiro', confirmouOutraEmpresa: true });
    expect(prova.texto.aplicativo.nome).toBe('Painel Exemplo');
  });

  it('a troca entrega a ligação do parceiro (permissões cortadas pelo teto de HOJE, janela agora), a porta a aceita, e o e-mail fala da empresa conferida e não do Liame', async () => {
    email.mockClear();
    const p = await pedir();
    const t = await tela(presA, p.numero);
    const a = await autorizar(presA, p.numero, { lojas: [A.lojas[1]], opcionais: ['catalogo.ler', 'cupons.ler'], resumo: t.c.tela.resumo });
    expect(a.r.status).toBe(200);
    // entre o clique e a troca, a DMS tira o catálogo do que aprovou: a ligação nasce sem ele
    (hub as any).guardarParceiros({
      versao: 2,
      itens: LISTA.itens.map((i) => (i.aplicativo === APP_P ? { ...i, permissoes: i.permissoes.filter((x) => x.nome !== 'catalogo.ler') } : i)),
    });
    const r = await trocar(a.codigo, p.verificador);
    expect(r.status).toBe(200);
    const lojas = ((await r.json()) as any).lojas as any[];
    for (const l of lojas) segredos.push(l.ligacao);
    (hub as any).guardarParceiros(LISTA);
    expect(lojas).toHaveLength(1);
    expect(lojas[0].permissoes).toEqual(['pedidos.ler', 'cupons.ler']);
    const [acesso] = await q(`select cliente, escopos, ler_desde, criado_em from integracao_token_loja where id = (select id from integracao_ligacao where prefixo = $1)`, [lojas[0].prefixo]);
    expect(acesso.cliente).toBe(clienteDoParceiro(APP_P));
    expect(Math.abs(new Date(acesso.ler_desde).getTime() - Date.now())).toBeLessThan(60_000);
    // a ligação nova vale na porta (R1a), com o token do aplicativo do parceiro
    expect((await chamar('/integracao/loja', { token: dmsId.emitir({ aplicativo: APP_P }), ligacao: lojas[0].ligacao })).status).toBe(200);
    expect(await esperarAte(() => email.mock.calls.length > 0, 5_000)).toBe(true);
    const [para, assunto, html, texto] = email.mock.calls[0];
    expect(para).toBe('paulo@brasa.exemplo');
    expect(assunto).toBe('O Painel Exemplo foi autorizado na loja Brasa Praia');
    expect(texto).toContain(`Os dados vão para a ${RAZAO} (CNPJ 12.ABC.345/01DE-36), dona do Painel Exemplo, conferida pela DMS.`);
    expect(texto).toContain('nem as vendas de antes da autorização');
    expect(`${html}${texto}`).not.toMatch(/Liame/);
  });

  it('as 3 lojas na tela: sem vaga e sem loja ligada aqui, a situação "limite"; ao autorizar, marcar além das vagas é recusado', async () => {
    await acessoNoBanco(B, B.lojas[0], presB, APP_P2);
    await acessoNoBanco(D, D.lojas[0], presD, APP_P2);
    // a empresa A: uma vaga (3 − 2 em outras); marcar as duas lojas é recusado, uma passa
    const p = await pedir({ aplicativo: APP_P2 });
    const { c } = await tela(presA, p.numero, APP_P2);
    expect(c.tela.lojasDoTeste).toEqual({ maximo: 3, vagas: 1 });
    const duas = await autorizar(presA, p.numero, { lojas: A.lojas, resumo: c.tela.resumo, aplicativo: APP_P2 });
    expect(duas.r.status).toBe(400);
    expect(duas.c.message).toMatch(/marque até 1/);
    // a terceira loja em outra empresa: a empresa A fica sem vaga e sem loja ligada → "limite"
    await acessoNoBanco(E, E.lojas[0], presE, APP_P2);
    const p2 = await pedir({ aplicativo: APP_P2 });
    const t2 = await tela(presA, p2.numero, APP_P2);
    expect(t2.c.situacao).toBe('limite');
    expect(t2.c.frase).toMatch(/limite de 3 lojas/);
    // a ligação suspensa (90 dias sem uso) não segura vaga
    await q(`update integracao_ligacao set ultimo_uso_em = now() - interval '100 days', criado_em = now() - interval '100 days' where aplicativo = $1 and tenant_id = $2`, [APP_P2, E.tenant]);
    expect((await tela(presA, p2.numero, APP_P2)).c.situacao).toBe('escolha');
  });

  it('as 3 lojas na troca, com duas empresas cruzando sob a trava (V72): uma leva, a outra é recusada e registrada', async () => {
    await acessoNoBanco(B, B.lojas[0], presB, APP_P3); // 1 em uso
    const pA = await pedir({ aplicativo: APP_P3 });
    const tA = await tela(presA, pA.numero, APP_P3);
    const aA = await autorizar(presA, pA.numero, { lojas: [A.lojas[0]], resumo: tA.c.tela.resumo, aplicativo: APP_P3 });
    expect(aA.r.status).toBe(200);
    const pD = await pedir({ aplicativo: APP_P3 });
    const tD = await tela(presD, pD.numero, APP_P3);
    expect(tD.c.tela.lojasDoTeste.vagas).toBe(1); // 1 em uso + a pendente da A
    const aD = await autorizar(presD, pD.numero, { lojas: [D.lojas[0]], resumo: tD.c.tela.resumo, aplicativo: APP_P3 });
    expect(aD.r.status).toBe(200);
    // outra empresa troca antes das duas: sobra uma vaga para duas trocas
    await acessoNoBanco(E, E.lojas[0], presE, APP_P3);

    const trava = await pool.connect();
    try {
      await trava.query('begin');
      await trava.query(`select pg_advisory_xact_lock(hashtext('parceiro-lojas'), hashtext($1))`, [APP_P3]);
      const [{ pid }] = (await trava.query('select pg_backend_pid() as pid')).rows;
      const r1 = trocar(aA.codigo, pA.verificador, APP_P3);
      const r2 = trocar(aD.codigo, pD.verificador, APP_P3);
      // as duas trocas ficam presas atrás da trava do aplicativo (sem a trava no código, nenhuma espera)
      expect(await esperarAte(async () => (await q(SQL_PRESOS_POR, [pid]))[0].n >= 2)).toBe(true);
      await trava.query('commit');
      const respostas = await Promise.all([r1, r2]);
      const corpos = await Promise.all(respostas.map((r) => r.json()));
      expect(respostas.map((r) => r.status).sort()).toEqual([200, 400]);
      const recusa: any = corpos[respostas.findIndex((r) => r.status === 400)];
      expect(recusa.detail).toMatch(/limite de 3 lojas/);
      for (const c of corpos) for (const l of c.lojas ?? []) segredos.push(l.ligacao);
    } finally {
      trava.release();
    }
    const [{ n }] = await q(`select count(*)::int as n from integracao_token_loja where cliente = $1 and revogado_em is null`, [clienteDoParceiro(APP_P3)]);
    expect(n).toBe(3);
    const [recusada] = await q(`select detalhe from audit_log where acao = 'integracao.troca_recusada' order by created_at desc limit 1`);
    expect(recusada.detalhe).toMatchObject({ motivo: 'limite_de_lojas', maximo: 3, emUso: 3, pedidas: 1 });
  });

  it('a janela atravessa o modo "mais" (herda a data, e a tela diz qual) e não atravessa a suspensão (começa de novo, sem as permissões de antes)', async () => {
    const [primeira] = await ligar(presB, [B.lojas[0]], { aplicativo: APP_P4 });
    const idDe = async (prefixo: string) => (await q(`select id from integracao_ligacao where prefixo = $1`, [prefixo]))[0].id as string;
    const id1 = await idDe(primeira.prefixo);
    // a janela de 10 dias atrás, e uma permissão gravada que passa do teto de hoje (não aparece nem é herdada)
    await q(`update integracao_token_loja set ler_desde = now() - interval '10 days', escopos = '{pedidos.ler,cupons.criar}' where id = $1`, [id1]);
    // o modo "mais": a tela diz a data de verdade, e o acesso novo herda a janela
    const p = await pedir({ aplicativo: APP_P4, scope: 'pedidos.ler cupons.ler' });
    const { c } = await tela(presB, p.numero, APP_P4);
    expect(c.tela.modo).toBe('mais');
    expect(c.tela.jaLiberado.permissoes.map((x: any) => x.id)).toEqual(['pedidos.ler']);
    const dez = new Date(Date.now() - 10 * 86_400_000).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    expect(c.tela.abertura).toContain(`desde ${dez}`);
    expect(c.tela.naoPode.at(-1).frase).toBe(`Ele não lê as vendas de antes de ${dez}, quando a autorização dele começou.`);
    const a = await autorizar(presB, p.numero, { lojas: [B.lojas[0]], opcionais: ['cupons.ler'], resumo: c.tela.resumo, aplicativo: APP_P4 });
    const [segunda] = (await (await trocar(a.codigo, p.verificador, APP_P4)).json()).lojas;
    segredos.push(segunda.ligacao);
    const [herdou] = await q(`select ler_desde, escopos from integracao_token_loja where id = $1`, [await idDe(segunda.prefixo)]);
    expect(Math.abs(new Date(herdou.ler_desde).getTime() - (Date.now() - 10 * 86_400_000))).toBeLessThan(60_000);
    expect(herdou.escopos).toEqual(['pedidos.ler', 'cupons.ler']);

    // a ligação parada há 100 dias: a tela trata a loja como nova (não "já lê desde"), autorizar de novo começa a janela
    // agora, só com o que foi liberado agora, e o e-mail é o da autorização nova
    await q(`update integracao_ligacao set ultimo_uso_em = now() - interval '100 days', criado_em = now() - interval '100 days' where prefixo = $1`, [segunda.prefixo]);
    email.mockClear();
    const p3 = await pedir({ aplicativo: APP_P4 });
    const t3 = await tela(presB, p3.numero, APP_P4);
    expect(t3.c.tela.modo).toBe('nova');
    expect(t3.c.tela.naoPode.at(-1).frase).toBe('Ele não lê as vendas de antes desta autorização.');
    const a3 = await autorizar(presB, p3.numero, { lojas: [B.lojas[0]], resumo: t3.c.tela.resumo, aplicativo: APP_P4 });
    const [terceira] = (await (await trocar(a3.codigo, p3.verificador, APP_P4)).json()).lojas;
    segredos.push(terceira.ligacao);
    const [recomecou] = await q(`select ler_desde, escopos from integracao_token_loja where id = $1`, [await idDe(terceira.prefixo)]);
    expect(Math.abs(new Date(recomecou.ler_desde).getTime() - Date.now())).toBeLessThan(60_000);
    expect(recomecou.escopos).toEqual(['pedidos.ler']);
    expect(await esperarAte(() => email.mock.calls.length > 0, 5_000)).toBe(true);
    expect(email.mock.calls.map((x: any[]) => x[1])).toEqual(['O Painel Quatro foi autorizado na loja Lanche Único']);
  });

  it('Aplicativos conectados: o nome e a empresa da prova, o selo do parceiro, as frases dele, a situação suspensa; "Revogar todos" do parceiro só nesta empresa', async () => {
    const r: any = await (await chamar('/aplicativos-conectados', { quem: presB })).json();
    const p = r.aplicativos.find((a: any) => a.cliente === clienteDoParceiro(APP_P4));
    expect(p).toMatchObject({ rotulo: 'Painel Quatro', classe: 'parceiro', descricao: `Aplicativo da ${RAZAO}, verificada pela DMS` });
    expect(p.frases['pedidos.ler'].texto).toContain('Sem o anúncio');
    // o acesso de agora está vivo; o suspenso (a segunda ligação) já foi trocado
    expect(p.acessos.filter((x: any) => x.ativo).every((x: any) => !x.suspenso)).toBe(true);
    const viva = p.acessos.find((x: any) => x.ativo);
    await q(`update integracao_ligacao set ultimo_uso_em = now() - interval '95 days', criado_em = now() - interval '95 days' where id = $1`, [viva.id]);
    const r2: any = await (await chamar('/aplicativos-conectados', { quem: presB })).json();
    expect(r2.aplicativos.find((a: any) => a.cliente === clienteDoParceiro(APP_P4)).acessos.find((x: any) => x.id === viva.id).suspenso).toBe(true);
    // revogar todos do parceiro na empresa B não toca a empresa A (o mesmo parceiro APP_P em A segue)
    const antesEmA = await q(`select count(*)::int as n from integracao_token_loja where tenant_id = $1 and revogado_em is null`, [A.tenant]);
    const rev = await chamar('/aplicativos-conectados/revogar-todos', { quem: presB, corpo: { cliente: clienteDoParceiro(APP_P4) } });
    expect(rev.status).toBe(200);
    expect(((await rev.json()) as any).revogados).toBeGreaterThan(0);
    expect(await q(`select count(*)::int as n from integracao_token_loja where tenant_id = $1 and revogado_em is null`, [A.tenant])).toEqual(antesEmA);
  });

  it('o parceiro parado no hub pelo client_id: o pedido recebe 503 e a tela diz "pausado"; pelo cliente do Regem, não para', async () => {
    const p = await pedir();
    ligarHub([{ nivel: 'aplicativo', produto: null, alvo: clienteDoParceiro(APP_P) }]);
    expect((await pedir()).r.status).toBe(201);
    ligarHub([{ nivel: 'aplicativo', produto: null, alvo: APP_P }]);
    expect((await pedir()).r.status).toBe(503);
    expect((await tela(presA, p.numero)).c.situacao).toBe('pausado');
  });

  it('o client_id do Liame na lista do hub segue Liame: a tela é a do produto da DMS', async () => {
    const verificador = randomBytes(48).toString('base64url');
    const r = await chamar('/integracao/autorizacao/pedido', {
      token: dmsId.emitir({ aplicativo: APP_LIAME }),
      form: true,
      corpo: {
        response_type: 'code',
        redirect_uri: 'https://api.agencialiame.com/v1/oauth/callback',
        scope: 'pedidos.ler clientes.anonimizacao.ler cupons.ler cupons.uso.ler',
        state: randomBytes(24).toString('base64url'),
        code_challenge: createHash('sha256').update(verificador, 'ascii').digest('base64url'),
        code_challenge_method: 'S256',
        conta_nome: 'Conta do Liame',
        conta_email: 'conta@liame.exemplo',
      },
    });
    expect(r.status).toBe(201);
    const numero = ((await r.json()) as any).request_uri;
    segredos.push(numero);
    const { c } = await tela(presA, numero, APP_LIAME);
    expect(c.tela.aplicativo.selo).toBe('Produto da DMS');
    expect(c.tela.classe).toBeUndefined();
    expect(c.tela.resumo).toBeUndefined();
    expect(c.tela.aplicativo.nome).toBe('Liame');
  });
});
