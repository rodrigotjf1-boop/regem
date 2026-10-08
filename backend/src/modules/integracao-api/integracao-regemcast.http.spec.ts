import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Global, INestApplication, Module } from '@nestjs/common';
import { APP_GUARD, NestFactory } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { DRIZZLE } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { CfThrottlerGuard } from '../../common/cf-throttler.guard';
import { CloudOnlyGuard } from '../../common/cloud-only.guard';
import { ProdutoService } from '../produto/produto.service';
import { FichasService } from '../fichas/fichas.service';
import { EdgeFlashSyncService } from '../sync/edge-flash-sync.service';
import { registrarEvento, registrarSaida, registrarVolta } from '../../common/consentimento-marketing';
import { esquecerCliente } from '../cliente/esquecer-cliente';
import { IntegracaoApiModule } from './integracao-api.module';
import { IntegracaoTokenService } from './integracao-token.service';
import { VendasIntegracaoService } from './vendas-integracao.service';
import { ClientesIntegracaoService } from './clientes-integracao.service';
import { CarimbadorIntegracaoService, LIMIAR_CONTRAPRESSAO } from './carimbador-integracao.service';
import { errosPagina, errosPedidoRegem } from './contrato-liame.teste-spec';

/* eslint-disable @typescript-eslint/no-explicit-any */

// API DE INTEGRAÇÃO PARA O REGEMCAST (mig 302 — contrato em docs/integracao-regemcast.md), contra
// o Postgres real e por HTTP (Nest com os guards globais de produção).
//
// O banco do CI é montado como servidor de loja (EDGE_MODE=true): as migrations só da nuvem (295,
// 296, 297, 299, 300 e 302) não existem nele. Elas sobem num schema SÓ DESTE TESTE, na frente do
// `public`; as tabelas em que a 296 e a 302 põem gatilho (pedido_externo, comanda, comanda_item,
// cliente, cliente_endereco) e a lista de exclusão (226, só nuvem) são CÓPIAS nesse schema, sem
// chave estrangeira (LIC-088/ERR-109): as outras specs, no mesmo banco, nunca disparam os gatilhos.
// O carimbador roda SÓ nas empresas desta spec.
//
// O que se prova: o token da EMPRESA (todas as lojas), a lista de clientes (quem sai, quem não
// sai, a ficha), as vendas com os campos do RegemCast, a resposta do Liame INTACTA, o incremental,
// a lápide, o cursor que sobrevive à troca do token e a carga de 3 anos em fatias com contrapressão.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('integracao-regemcast.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(180_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGS, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade|cliente)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');
const FONTES = ['pedido_externo', 'comanda', 'comanda_item', 'cliente', 'cliente_endereco'];
const ESCOPOS_CAST = ['pedidos.ler', 'clientes.telefone.ler', 'clientes.ler'];

const diasAtras = (d: number, h = 12) => new Date(Date.now() - d * 86_400_000 - h * 3_600_000).toISOString();

// ── O contrato do lado do RegemCast (`regem.regras.ts` do conector, PR #90 de lá) ──
const CANAL = /^[a-z0-9_]+$/;
const E164 = /^\+55\d{10,11}$/;
const INSTANTE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const CHAVES_CLIENTE = ['id', 'versao', 'atualizado_em', 'nome', 'telefone', 'canais', 'bairro', 'cidade', 'opt_out',
  'aceite_marketing', 'criado_em', 'removido'].sort();

function errosClienteCast(c: any): string[] {
  const e: string[] = [];
  if (c.removido === true) {
    if (Object.keys(c).sort().join() !== ['atualizado_em', 'id', 'removido', 'versao'].join()) e.push('lápide com campo a mais');
    return e;
  }
  if (Object.keys(c).sort().join() !== CHAVES_CLIENTE.join()) e.push(`chaves: ${Object.keys(c).sort().join()}`);
  if (typeof c.id !== 'string' || !c.id) e.push('id');
  if (!Number.isSafeInteger(c.versao) || c.versao < 1) e.push('versao');
  if (!INSTANTE.test(c.atualizado_em)) e.push('atualizado_em');
  if (!(c.telefone === null || E164.test(c.telefone))) e.push('telefone');
  if (!Array.isArray(c.canais) || c.canais.some((x: any) => !CANAL.test(x))) e.push('canais');
  if (typeof c.opt_out?.ativo !== 'boolean') e.push('opt_out.ativo');
  if (!(c.aceite_marketing === null || typeof c.aceite_marketing?.aceito === 'boolean')) e.push('aceite_marketing');
  if (c.removido !== false) e.push('removido');
  return e;
}

function errosVendaCast(v: any): string[] {
  const e = errosPedidoRegem(v); // a base é a mesma venda do contrato do Liame
  if (!(v.tipo === null || ['entrega', 'retirada', 'balcao', 'mesa'].includes(v.tipo))) e.push('tipo');
  if (!Number.isSafeInteger(v.taxa_entrega_centavos) || v.taxa_entrega_centavos < 0) e.push('taxa_entrega_centavos');
  for (const k of ['unidade_id', 'unidade_nome', 'bairro', 'cidade']) if (!(k in v)) e.push(k);
  if (v.cliente?.telefone != null && !E164.test(v.cliente.telefone)) e.push('cliente.telefone');
  return e;
}

descrever('API de integração — RegemCast (token da empresa, GET /clientes e /pedidos)', () => {
  const SCHEMA = `teste_integracao_regemcast_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 6 });
  const db = drizzle(pool) as any;
  const auditoria = { registrar: async () => undefined } as unknown as AuditoriaService;
  const tokensSvc = new IntegracaoTokenService(db, auditoria);
  const produtoSvc = new ProdutoService(db, auditoria, new EdgeFlashSyncService(db), new FichasService(db));
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const edgeOriginal = process.env.EDGE_MODE;
  let app: INestApplication;
  let base = '';
  let carimbador: CarimbadorIntegracaoService;
  let clientesSvc: ClientesIntegracaoService;

  @Global()
  @Module({
    providers: [
      { provide: DRIZZLE, useValue: db },
      { provide: AuditoriaService, useValue: auditoria },
      { provide: ProdutoService, useValue: produtoSvc },
    ],
    exports: [DRIZZLE, AuditoriaService, ProdutoService],
  })
  class InfraTeste {}

  @Module({
    imports: [InfraTeste, ThrottlerModule.forRoot([{ ttl: 60000, limit: 600 }]), IntegracaoApiModule],
    providers: [
      { provide: APP_GUARD, useClass: CfThrottlerGuard },
      { provide: APP_GUARD, useClass: CloudOnlyGuard },
    ],
  })
  class AppTeste {}

  const chamar = (caminho: string, token: string) => fetch(`${base}${caminho}`, { headers: { authorization: `Bearer ${token}` } });

  // ───────────────────────────── montagem dos dados ─────────────────────────────

  async function empresa(nome: string, lojas: string[]) {
    const [e] = await q(`insert into empresa (nome) values ($1) returning id, nome`, [`${nome} ${randomUUID().slice(0, 6)}`]);
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
    const [p] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, $2, $3) returning id`, [
      e.id,
      `Presidente ${nome}`,
      f.id,
    ]);
    return { tenant: e.id as string, nome: e.nome as string, lojas: ids, presidente: p.id as string };
  }
  type Emp = Awaited<ReturnType<typeof empresa>>;

  const evidencia = 'autorização por escrito (teste)';
  const emitirLiame = async (emp: Emp, loja: string, escopos: string[]) =>
    (await tokensSvc.emitir({ tenantId: emp.tenant, unidadeId: loja, autorizadoPor: emp.presidente, escopos, evidencia }, dist)).token;
  const emitirCast = (emp: Emp, escopos: string[]) =>
    tokensSvc.emitir({ tenantId: emp.tenant, cliente: 'regemcast', autorizadoPor: emp.presidente, escopos, evidencia }, dist);

  async function cliente(tenant: string, nome: string, telefone: string | null, optOut = false) {
    const [c] = await q(`insert into cliente (tenant_id, nome, telefone, opt_out_marketing) values ($1, $2, $3, $4) returning id`, [
      tenant,
      nome,
      telefone,
      optOut,
    ]);
    return c.id as string;
  }

  async function endereco(tenant: string, clienteId: string, bairro: string, cidade: string | null, principal: boolean) {
    await q(`insert into cliente_endereco (tenant_id, cliente_id, bairro, cidade, principal) values ($1, $2, $3, $4, $5)`, [
      tenant,
      clienteId,
      bairro,
      cidade,
      principal,
    ]);
  }

  async function pedido(
    tenant: string,
    o: {
      loja: string;
      canal: string;
      tipo?: 'entrega' | 'retirada';
      criado: string;
      total: number;
      cliente?: string | null;
      taxa?: number;
      bairro?: string | null;
      cidade?: string | null;
    },
  ) {
    const [p] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, tipo, status, criado_em, confirmado_em, valor_bruto, total,
                                   taxa_entrega, cliente_id, endereco_bairro, endereco_cidade, itens, external_id)
       values ($1, $2, $3, $4, 'confirmado', $5::timestamptz, $5::timestamptz, $6, $6, $7, $8, $9, $10, $11::jsonb, $12) returning id`,
      [
        tenant,
        o.loja,
        o.canal,
        o.tipo ?? 'entrega',
        o.criado,
        String(o.total),
        String(o.taxa ?? 0),
        o.cliente ?? null,
        o.bairro ?? null,
        o.cidade ?? null,
        JSON.stringify([{ nome: 'Pizza Calabresa', quantidade: 1, preco: o.total }]),
        `ext-${randomUUID()}`,
      ],
    );
    return p.id as string;
  }

  async function comanda(tenant: string, loja: string, fechada: string, total: number, mesa = false) {
    const [c] = await q(
      `insert into comanda (tenant_id, unidade_id, status, aberta_em, fechada_em, total, mesa_id, aberta_por_id)
       values ($1, $2, 'fechada', $3::timestamptz, $3::timestamptz, $4, $5, $6) returning id`,
      [tenant, loja, fechada, String(total), mesa ? randomUUID() : null, randomUUID()],
    );
    await q(`insert into comanda_item (tenant_id, comanda_id, descricao, quantidade, preco_unitario) values ($1, $2, 'Chope', 1, $3)`, [
      tenant,
      c.id,
      String(total),
    ]);
    return c.id as string;
  }

  /** Roda o carimbador até a fila, os pendentes e as cargas das empresas dadas acabarem. */
  async function assentar(tenants: string[]) {
    for (let i = 0; i < 120; i++) {
      await carimbador.ciclo({ tenantIds: tenants }, 30_000);
      await q(
        `update integracao_versao set mudou_em = mudou_em - interval '11 minutes'
          where fonte = 'comanda' and pendente and tenant_id = any($1::uuid[])`,
        [tenants],
      );
      const [s] = await q(
        `select (select count(*) from integracao_mudanca where tenant_id = any($1::uuid[]))::int as fila,
                (select count(*) from integracao_versao where pendente and tenant_id = any($1::uuid[]))::int as pendentes,
                (select count(*) from integracao_token_loja t
                   left join integracao_carga_janela j on j.tenant_id = t.tenant_id and j.cliente = t.cliente
                  where t.tenant_id = any($1::uuid[]) and t.cliente = 'regemcast' and t.revogado_em is null
                    and (j.feita_em is null or t.criado_em > j.feita_em))::int as cargas`,
        [tenants],
      );
      if (!s.fila && !s.pendentes && !s.cargas) return;
    }
    throw new Error('o carimbador não assentou');
  }

  /** Lê a rota inteira, página a página, conferindo cada página contra o contrato. */
  async function lerTudo(token: string, rota: 'clientes' | 'pedidos', o: { limite?: number; cursor?: string | null; extra?: string } = {}) {
    let cursor: string | null = o.cursor ?? null;
    const itens: any[] = [];
    const paginas: any[] = [];
    for (;;) {
      const qs = `limite=${o.limite ?? 500}${cursor ? `&cursor=${cursor}` : (o.extra ?? '')}`;
      const r = await chamar(`/integracao/${rota}?${qs}`, token);
      expect(r.status).toBe(200);
      const pg: any = await r.json();
      expect(typeof pg.proximo_cursor).toBe('string'); // o conector guarda sempre
      expect(errosPagina(pg, rota === 'clientes' ? errosClienteCast : () => [])).toEqual([]);
      paginas.push(pg);
      itens.push(...pg.itens);
      cursor = pg.proximo_cursor;
      if (!pg.tem_mais) break;
    }
    return { itens, cursor, paginas };
  }

  /** A última versão de cada id. */
  const ultimas = (itens: any[]) => {
    const m = new Map<string, any>();
    for (const v of itens) if (!m.has(v.id) || m.get(v.id).versao < v.versao) m.set(v.id, v);
    return m;
  };

  // ───────────────────────────── cenário ─────────────────────────────

  let R: Emp; // a empresa conectada: 2 lojas
  let O: Emp; // outra empresa (isolamento)
  let tLiame = ''; // Liame na loja R1 (pedidos + telefone)
  let tCast = ''; // RegemCast da empresa R (sem a 99)
  let tCastId = '';
  let tCast99 = ''; // RegemCast da empresa R com a 99
  let tCastO = '';
  const c: Record<string, string> = {};
  const v: Record<string, string> = {};

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a API é da NUVEM
    await pool.query(`create schema ${SCHEMA}`);
    for (const t of FONTES) await pool.query(`create table ${SCHEMA}.${t} (like public.${t} including all)`);
    // A lista de exclusão como a 226 cria (só a tabela — a 226 também altera `campanha`).
    await pool.query(`
      create table ${SCHEMA}.marketing_optout (
        id uuid primary key default gen_random_uuid(), tenant_id uuid not null, telefone text not null,
        cliente_id uuid, motivo text, criado_em timestamptz not null default now());
      create unique index on ${SCHEMA}.marketing_optout (tenant_id, telefone);`);
    await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig('295_integracao_token_loja.sql'))));
    await pool.query(mig('296_integracao_versao_vendas.sql'));
    await pool.query(mig('297_pedido_externo_comanda_idx.sql'));
    for (const n of ['299_pedido_origem.sql', '300_marketing_consentimento.sql', '302_integracao_regemcast.sql']) {
      const conf: any = await pool.query(semFkCompartilhada(mig(n)));
      const linhas = (Array.isArray(conf) ? conf[conf.length - 1] : conf).rows;
      if (!linhas.length || linhas.some((l: any) => !l.ok)) throw new Error(`conferência da ${n}: ${JSON.stringify(linhas)}`);
    }
    // A 302 de novo: idempotente (a conferência continua toda verde).
    const de_novo: any = await pool.query(mig('302_integracao_regemcast.sql'));
    expect((de_novo[de_novo.length - 1].rows as any[]).every((l) => l.ok)).toBe(true);
    const [fk] = await q(
      `select count(*)::int n from pg_constraint c join pg_namespace s on s.oid = c.connamespace
        where s.nspname = $1 and c.contype = 'f'`,
      [SCHEMA],
    );
    if (fk.n) throw new Error('o schema do teste não pode ter chave estrangeira (LIC-088)');
    const [gat] = await q(
      `select count(*)::int n from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace s on s.oid = c.relnamespace
        where g.tgname like 'trg_integracao_%' and s.nspname = 'public'`,
    );
    if (gat.n) throw new Error('a 296/302 não podem ter posto gatilho nas tabelas compartilhadas');

    const a = await NestFactory.create(AppTeste, { logger: false });
    a.setGlobalPrefix('api/v1');
    await a.listen(0, '127.0.0.1');
    app = a;
    base = `http://127.0.0.1:${(a.getHttpServer().address() as any).port}/api/v1`;
    app.get(VendasIntegracaoService).atrasoSeg = 0;
    clientesSvc = app.get(ClientesIntegracaoService);
    clientesSvc.atrasoSeg = 0; // o atraso tem teste próprio
    carimbador = app.get(CarimbadorIntegracaoService);

    R = await empresa('Pizzaria R', ['R1 Centro', 'R2 Tijuca']);
    O = await empresa('Outra O', ['O1']);
    const [r1, r2] = R.lojas;

    // ── A base de clientes e as vendas JÁ EXISTEM antes da conexão (a carga é que traz) ──
    c.ana = await cliente(R.tenant, 'Ana Souza', '21999998888');
    await endereco(R.tenant, c.ana, 'Centro', 'Niterói', false);
    await endereco(R.tenant, c.ana, 'Tijuca', 'Rio de Janeiro', true);
    c.bia = await cliente(R.tenant, 'Bia só iFood', '2199997777');
    c.caio = await cliente(R.tenant, 'Caio só 99', '21988887777');
    c.duda = await cliente(R.tenant, 'Duda', '21977776666');
    c.edu = await cliente(R.tenant, 'Edu sem telefone', null);
    c.fabi = await cliente(R.tenant, 'Fabi importada', '2196665555'); // celular antigo, sem o 9
    await endereco(R.tenant, c.fabi, '~3.2 km', 'Rio de Janeiro', true);
    c.gabi = await cliente(R.tenant, 'Gabi na lista', '21987654321');
    await q(`insert into marketing_optout (tenant_id, telefone, motivo) values ($1, '552187654321', 'palavra_chave')`, [R.tenant]);
    c.hugo = await cliente(R.tenant, 'Hugo saiu pelo painel', '21944443333', true);
    c.ivo = await cliente(R.tenant, 'Ivo aceitou', '21933332222');
    await registrarEvento(db, { tenantId: R.tenant, telefone: '21933332222', clienteId: c.ivo, origem: 'cardapio_checkout',
      texto: 'Quero receber promoções pelo WhatsApp' }, 'aceite');
    c.jota = await cliente(R.tenant, 'Jota saiu e voltou', '21922221111');
    await registrarSaida(db, { tenantId: R.tenant, telefone: '5521922221111', origem: 'whatsapp', motivo: 'palavra_chave' });
    await registrarVolta(db, { tenantId: R.tenant, telefone: '5521922221111', origem: 'whatsapp' });
    c.zeca = await cliente(O.tenant, 'Zeca de outra empresa', '21911110000');
    await pedido(O.tenant, { loja: O.lojas[0], canal: 'cardapio', criado: diasAtras(1), total: 20, cliente: c.zeca });

    v.anaCardapio = await pedido(R.tenant, { loja: r1, canal: 'cardapio', criado: diasAtras(2), total: 64.9, taxa: 5,
      cliente: c.ana, bairro: 'Tijuca', cidade: 'Rio de Janeiro' });
    v.anaAiqfome = await pedido(R.tenant, { loja: r1, canal: 'aiqfome', criado: diasAtras(3), total: 30, cliente: c.ana });
    v.anaAntiga = await pedido(R.tenant, { loja: r2, canal: 'cardapio', tipo: 'retirada', criado: diasAtras(700), total: 50,
      cliente: c.ana, bairro: 'Tijuca' });
    v.biaIfood = await pedido(R.tenant, { loja: r1, canal: 'ifood', criado: diasAtras(4), total: 40, cliente: c.bia });
    v.caio99 = await pedido(R.tenant, { loja: r2, canal: '99food', criado: diasAtras(5), total: 45, cliente: c.caio });
    v.dudaAnota = await pedido(R.tenant, { loja: r2, canal: 'anotaai', tipo: 'entrega', criado: diasAtras(6), total: 70,
      cliente: c.duda, bairro: '~3.2 km', cidade: null, taxa: 8 });
    v.dudaIfood = await pedido(R.tenant, { loja: r2, canal: 'iFood ', criado: diasAtras(7), total: 33, cliente: c.duda });
    v.eduCardapio = await pedido(R.tenant, { loja: r1, canal: 'cardapio', criado: diasAtras(8), total: 25, cliente: c.edu });
    v.balcao = await comanda(R.tenant, r1, diasAtras(1), 30);
    v.mesa = await comanda(R.tenant, r2, diasAtras(1), 90, true);

    tLiame = await emitirLiame(R, r1, ['pedidos.ler', 'clientes.telefone.ler']);
    const cast = await emitirCast(R, ESCOPOS_CAST);
    tCast = cast.token;
    tCastId = cast.id;
    tCast99 = (await emitirCast(R, [...ESCOPOS_CAST, 'vendas.99food.ler'])).token;
    tCastO = (await emitirCast(O, ESCOPOS_CAST)).token;
    await assentar([R.tenant, O.tenant]);
  });

  afterAll(async () => {
    await app?.close();
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  }, 120_000);

  // ───────────────────────────── emissão ─────────────────────────────

  describe('emissão do token (console da distribuição)', () => {
    it('RegemCast é da empresa inteira: sem loja, e só com os escopos dele', async () => {
      const r = await emitirCast(O, ['pedidos.ler']);
      expect(r.loja).toBeNull();
      expect(r.cliente).toBe('regemcast');
      await expect(
        tokensSvc.emitir({ tenantId: O.tenant, cliente: 'regemcast', unidadeId: O.lojas[0], autorizadoPor: O.presidente,
          escopos: ESCOPOS_CAST, evidencia }, dist),
      ).rejects.toThrow(/empresa inteira/);
      await expect(emitirCast(O, ['pedidos.ler', 'cupons.ler'])).rejects.toThrow(/não vale para o RegemCast: cupons\.ler/);
      await expect(
        tokensSvc.emitir({ tenantId: O.tenant, cliente: 'liame', autorizadoPor: O.presidente, escopos: ['pedidos.ler'], evidencia }, dist),
      ).rejects.toThrow(/unidadeId/);
      await expect(
        tokensSvc.emitir({ tenantId: O.tenant, cliente: 'liame', unidadeId: O.lojas[0], autorizadoPor: O.presidente,
          escopos: ['clientes.ler'], evidencia }, dist),
      ).rejects.toThrow(/não vale para o Liame: clientes\.ler/);
      await expect(
        tokensSvc.emitir({ tenantId: O.tenant, cliente: 'farol', autorizadoPor: O.presidente, escopos: ['pedidos.ler'], evidencia }, dist),
      ).rejects.toThrow(/desconhecido/);
      await q(`update integracao_token_loja set revogado_em = now() where tenant_id = $1 and escopos = '{pedidos.ler}'`, [O.tenant]);
    });

    it('a trava do banco: token sem loja só para o regemcast', async () => {
      await expect(
        q(`insert into integracao_token_loja (tenant_id, unidade_id, cliente, prefixo, token_hash, escopos, autorizado_por,
                                            autorizado_por_nome, autorizado_via)
           values ($1, null, 'liame', 'rgm_it_xxxxx', $2, '{pedidos.ler}', $3, 'Presidente', 'console_distribuicao')`,
          [O.tenant, `hash-${randomUUID()}`, O.presidente]),
      ).rejects.toMatchObject({ code: '23514' });
    });

    it('o painel do console lista para quem se emite, com os escopos de cada um', async () => {
      const p: any = await tokensSvc.painelEmpresa(R.tenant);
      expect(p.clientes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ chave: 'liame', abrangencia: 'loja' }),
          { chave: 'regemcast', rotulo: 'RegemCast', abrangencia: 'empresa',
            escopos: ['pedidos.ler', 'clientes.telefone.ler', 'clientes.ler', 'vendas.99food.ler'] },
        ]),
      );
      expect(p.tokens.find((t: any) => t.id === tCastId)).toBeTruthy();
    });
  });

  // ───────────────────────────── /loja ─────────────────────────────

  it('GET /loja com o token da empresa: a empresa, as lojas (matriz primeiro) e os escopos', async () => {
    const r = await chamar('/integracao/loja', tCast);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      empresa_id: R.tenant,
      empresa_nome: R.nome,
      lojas: [
        { id: R.lojas[0], nome: 'R1 Centro' },
        { id: R.lojas[1], nome: 'R2 Tijuca' },
      ],
      fuso: 'America/Sao_Paulo',
      moeda: 'BRL',
      escopos: ESCOPOS_CAST,
    });
    // o do Liame continua no formato de loja
    const l: any = await (await chamar('/integracao/loja', tLiame)).json();
    expect(l.loja_id).toBe(R.lojas[0]);
    expect(l.lojas).toBeUndefined();
  });

  // ───────────────────────────── /clientes ─────────────────────────────

  describe('GET /clientes', () => {
    it('quem sai: com telefone e com relação com a loja; nunca só marketplace; nada de outra empresa', async () => {
      const { itens } = await lerTudo(tCast, 'clientes');
      const ids = new Set(itens.map((x) => x.id));
      expect([...ids].sort()).toEqual([c.ana, c.duda, c.fabi, c.gabi, c.hugo, c.ivo, c.jota].sort());
      expect(itens.length).toBe(ids.size); // uma versão de cada (nada mudou depois da carga)
      // a empresa O vê só o dela
      const o = await lerTudo(tCastO, 'clientes');
      expect(o.itens.map((x) => x.id)).toEqual([c.zeca]);
    });

    it('a ficha: telefone E.164 sem inventar o 9, canais, bairro do endereço principal, opt-out e aceite', async () => {
      const m = ultimas((await lerTudo(tCast, 'clientes')).itens);
      expect(m.get(c.ana)).toMatchObject({
        nome: 'Ana Souza',
        telefone: '+5521999998888',
        canais: ['aiqfome', 'cardapio'],
        bairro: 'Tijuca',
        cidade: 'Rio de Janeiro',
        opt_out: { ativo: false, em: null, origem: null },
        aceite_marketing: null,
        removido: false,
        versao: 1,
      });
      expect(m.get(c.ana).criado_em).toMatch(INSTANTE);
      expect(m.get(c.duda).canais).toEqual(['anotaai', 'ifood']); // "iFood " vira o canal do contrato
      expect(m.get(c.fabi)).toMatchObject({ telefone: '+552196665555', canais: [], bairro: null, cidade: 'Rio de Janeiro' });
      expect(m.get(c.gabi).opt_out).toMatchObject({ ativo: true, origem: 'lista_de_exclusao' }); // lista SEM o 9
      expect(m.get(c.gabi).opt_out.em).toMatch(INSTANTE);
      expect(m.get(c.hugo).opt_out).toEqual({ ativo: true, em: null, origem: 'painel' });
      expect(m.get(c.ivo).aceite_marketing).toMatchObject({
        aceito: true,
        origem: 'cardapio_checkout',
        texto: 'Quero receber promoções pelo WhatsApp',
      });
      expect(m.get(c.jota).opt_out).toMatchObject({ ativo: false, origem: 'whatsapp' }); // saiu e voltou
      expect(m.get(c.jota).opt_out.em).toMatch(INSTANTE);
    });

    it('com o escopo da 99: o cliente que só comprou pela 99 também sai', async () => {
      const ids = (await lerTudo(tCast99, 'clientes')).itens.map((x) => x.id);
      expect(ids).toContain(c.caio);
      expect(ids).not.toContain(c.bia); // iFood nunca
      expect(ids).not.toContain(c.edu); // sem telefone nunca
    });

    it('nunca sai página vazia com tem_mais: true (o filtro vem antes do limite)', async () => {
      const { paginas } = await lerTudo(tCast, 'clientes', { limite: 1 });
      for (const p of paginas) if (p.tem_mais) expect(p.itens.length).toBe(1);
      expect(paginas.reduce((s, p) => s + p.itens.length, 0)).toBe(7);
    });

    it('o atraso: o recém-carimbado não sai, e a página vazia vem com tem_mais: false e o cursor', async () => {
      clientesSvc.atrasoSeg = 3600;
      try {
        const r: any = await (await chamar('/integracao/clientes', tCast)).json();
        expect(r).toEqual({ itens: [], proximo_cursor: expect.any(String), tem_mais: false });
      } finally {
        clientesSvc.atrasoSeg = 0;
      }
    });

    it('escopo: sem clientes.ler, 403; o cursor de uma rota não vale na outra; o de outra empresa, 400', async () => {
      const r = await chamar('/integracao/clientes', tLiame);
      expect(r.status).toBe(403);
      expect(((await r.json()) as any).detail).toMatch(/clientes\.ler/);
      const { cursor } = await lerTudo(tCast, 'clientes');
      expect((await chamar(`/integracao/pedidos?cursor=${cursor}`, tCast)).status).toBe(400);
      expect((await chamar(`/integracao/clientes?cursor=${cursor}`, tCastO)).status).toBe(400);
    });
  });

  // ───────────────────────────── /pedidos ─────────────────────────────

  describe('GET /pedidos', () => {
    it('token da empresa: as duas lojas, 3 anos (sem mandar confirmados_desde) e os campos do RegemCast', async () => {
      const { itens } = await lerTudo(tCast, 'pedidos');
      for (const x of itens) expect(errosVendaCast(x)).toEqual([]);
      const m = ultimas(itens);
      for (const id of Object.values(v)) expect(m.has(id)).toBe(true); // R1, R2, comandas e a de 700 dias
      expect(m.get(v.anaCardapio)).toMatchObject({
        canal: 'cardapio',
        tipo: 'entrega',
        bairro: 'Tijuca',
        cidade: 'Rio de Janeiro',
        taxa_entrega_centavos: 500,
        unidade_id: R.lojas[0],
        unidade_nome: 'R1 Centro',
        cliente: { id: c.ana, telefone: '+5521999998888' },
      });
      expect(m.get(v.anaAntiga)).toMatchObject({ tipo: 'retirada', bairro: null, cidade: null, unidade_nome: 'R2 Tijuca' });
      expect(m.get(v.dudaAnota)).toMatchObject({ tipo: 'entrega', bairro: null, taxa_entrega_centavos: 800 }); // distância não é bairro
      expect(m.get(v.balcao)).toMatchObject({ tipo: 'balcao', cliente: null, taxa_entrega_centavos: 0, bairro: null });
      expect(m.get(v.mesa)).toMatchObject({ tipo: 'mesa', unidade_id: R.lojas[1] });
      // marketplace nunca traz o cliente (aiqfome incluso, pela lista do RegemCast); a 99 só com o escopo
      expect(m.get(v.biaIfood).cliente).toBeNull();
      expect(m.get(v.anaAiqfome).cliente).toBeNull();
      expect(m.get(v.caio99).cliente).toBeNull();
      const m99 = ultimas((await lerTudo(tCast99, 'pedidos')).itens);
      expect(m99.get(v.caio99).cliente).toMatchObject({ id: c.caio, telefone: '+5521988887777' });
      expect(m99.get(v.biaIfood).cliente).toBeNull();
      // e nada da outra empresa
      const o = await lerTudo(tCastO, 'pedidos');
      expect(o.itens.length).toBe(1);
      expect(o.itens.every((x) => !m.has(x.id))).toBe(true);
    });

    it('a resposta do Liame NÃO muda: só a loja dele, sem os campos do RegemCast, e a régua dele', async () => {
      const desde = new Date(Date.now() - 90 * 86_400_000).toISOString().replace(/\.\d+Z$/, '.000Z');
      const { itens } = await lerTudo(tLiame, 'pedidos', { extra: `&confirmados_desde=${desde}` });
      for (const x of itens) {
        expect(errosPedidoRegem(x)).toEqual([]);
        for (const k of ['unidade_id', 'unidade_nome', 'tipo', 'bairro', 'cidade', 'taxa_entrega_centavos']) expect(k in x).toBe(false);
      }
      const ids = itens.map((x) => x.id);
      expect(ids).toEqual(expect.arrayContaining([v.anaCardapio, v.anaAiqfome, v.biaIfood, v.eduCardapio, v.balcao]));
      expect(ids).not.toContain(v.anaAntiga); // fora da janela que o Liame pediu
      expect(ids).not.toContain(v.mesa); // da outra loja
      const m = ultimas(itens);
      expect(m.get(v.anaAiqfome).cliente).toMatchObject({ id: c.ana }); // a regra do Liame segue a dele
      expect(m.get(v.biaIfood).cliente).toBeNull();
    });
  });

  // ───────────────────────────── incremental ─────────────────────────────

  describe('o incremental', () => {
    it('o que muda a ficha vira versão nova; o que não muda, não', async () => {
      const { cursor } = await lerTudo(tCast, 'clientes');
      await q(`update cliente set nome = 'Ana Souza Lima' where id = $1`, [c.ana]);
      await q(`update cliente set importacao = '{"origem":"teste"}'::jsonb where id = $1`, [c.duda]); // fora da ficha
      await endereco(R.tenant, c.fabi, 'Méier', 'Rio de Janeiro', true);
      await q(`update cliente_endereco set principal = false where cliente_id = $1 and bairro = '~3.2 km'`, [c.fabi]);
      await pedido(R.tenant, { loja: R.lojas[0], canal: 'cardapio', criado: new Date().toISOString(), total: 22, cliente: c.fabi });
      await registrarSaida(db, { tenantId: R.tenant, telefone: '21933332222', clienteId: c.ivo, origem: 'cardapio_perfil',
        motivo: 'recusa' }, 'recusa');
      await registrarSaida(db, { tenantId: R.tenant, telefone: '21922221111', origem: 'whatsapp', motivo: 'palavra_chave' });
      await assentar([R.tenant]);

      const novos = await lerTudo(tCast, 'clientes', { cursor });
      const m = ultimas(novos.itens);
      expect([...m.keys()].sort()).toEqual([c.ana, c.fabi, c.ivo, c.jota].sort());
      expect(m.get(c.ana)).toMatchObject({ nome: 'Ana Souza Lima', versao: 2 });
      expect(m.get(c.fabi)).toMatchObject({ bairro: 'Méier', canais: ['cardapio'] });
      expect(m.get(c.ivo)).toMatchObject({ aceite_marketing: { aceito: false, origem: 'cardapio_perfil' }, opt_out: { ativo: true } });
      expect(m.get(c.jota).opt_out).toMatchObject({ ativo: true, origem: 'whatsapp' });
      // e o fim da lista devolve o cursor de onde continuar
      const fim: any = await (await chamar(`/integracao/clientes?cursor=${novos.cursor}`, tCast)).json();
      expect(fim).toEqual({ itens: [], proximo_cursor: novos.cursor, tem_mais: false });
    });

    it('"Excluir conta" (LGPD) vira lápide; quem some antes de sair não deixa rastro', async () => {
      const { cursor } = await lerTudo(tCast, 'clientes');
      const fantasma = await cliente(R.tenant, 'Nunca publicado', '21900001111');
      await q(`delete from cliente where id = $1`, [fantasma]);
      await esquecerCliente(db, R.tenant, c.duda);
      await assentar([R.tenant]);
      const { itens } = await lerTudo(tCast, 'clientes', { cursor });
      expect(itens).toEqual([{ id: c.duda, versao: expect.any(Number), atualizado_em: expect.stringMatching(INSTANTE), removido: true }]);
      expect(await q(`select 1 from integracao_versao where recurso = 'contato' and recurso_id = $1`, [fantasma])).toEqual([]);
    });

    it('o cursor é da EMPRESA: o token novo segue do mesmo ponto', async () => {
      const primeira: any = await (await chamar('/integracao/clientes?limite=2', tCast)).json();
      expect(primeira.tem_mais).toBe(true);
      const novo = await emitirCast(R, ESCOPOS_CAST);
      await tokensSvc.revogarPeloConsole(tCastId, 'troca de token (teste)', dist);
      expect((await chamar('/integracao/clientes', tCast)).status).toBe(401);
      const r = await chamar(`/integracao/clientes?limite=500&cursor=${primeira.proximo_cursor}`, novo.token);
      expect(r.status).toBe(200);
      const resto: any = await r.json();
      const todos = await lerTudo(novo.token, 'clientes');
      expect([...primeira.itens, ...resto.itens].map((x: any) => x.id)).toEqual(todos.itens.map((x) => x.id));
      tCast = novo.token;
      tCastId = novo.id;
      await assentar([R.tenant]); // o token novo recomeça a carga — nada vira versão nova
      expect((await lerTudo(tCast, 'clientes', { cursor: todos.cursor })).itens).toEqual([]);
    });
  });

  // ───────────────────────────── robustez ─────────────────────────────

  describe('robustez: o gatilho nunca derruba a gravação do cliente', () => {
    it('sem a fila (tabela sumiu): cliente, endereço e consentimento gravam assim mesmo', async () => {
      await pool.query(`alter table ${SCHEMA}.integracao_mudanca rename to integracao_mudanca_fora`);
      try {
        const id = await cliente(R.tenant, 'Robustez', '21900002222');
        await q(`update cliente set nome = 'Robustez 2' where id = $1`, [id]);
        await endereco(R.tenant, id, 'Centro', 'Rio de Janeiro', true);
        await q(`update cliente_endereco set bairro = 'Lapa' where cliente_id = $1`, [id]);
        await q(`delete from cliente_endereco where cliente_id = $1`, [id]);
        await registrarEvento(db, { tenantId: R.tenant, telefone: '21900002222', clienteId: id, origem: 'cardapio_checkout' }, 'aceite');
        await q(`delete from cliente where id = $1`, [id]);
        expect(await q(`select 1 from cliente where id = $1`, [id])).toEqual([]);
        expect(await q(`select 1 from marketing_consentimento where cliente_id = $1`, [id])).toHaveLength(1);
      } finally {
        await pool.query(`alter table ${SCHEMA}.integracao_mudanca_fora rename to integracao_mudanca`);
      }
    });

    it('empresa sem token com clientes.ler (só o Liame): o gatilho da ficha não anota nada', async () => {
      const N = await empresa('Só Liame N', ['N1']);
      await emitirLiame(N, N.lojas[0], ['pedidos.ler', 'clientes.telefone.ler']);
      const id = await cliente(N.tenant, 'Cliente N', '21900003333');
      await endereco(N.tenant, id, 'Centro', 'Rio de Janeiro', true);
      await q(`update cliente set nome = 'Cliente N2' where id = $1`, [id]);
      await registrarEvento(db, { tenantId: N.tenant, telefone: '21900003333', clienteId: id, origem: 'whatsapp' }, 'saida');
      await pedido(N.tenant, { loja: N.lojas[0], canal: 'cardapio', criado: new Date().toISOString(), total: 9, cliente: id });
      await assentar([N.tenant]);
      expect(await q(`select 1 from integracao_versao where tenant_id = $1 and recurso = 'contato'`, [N.tenant])).toEqual([]);
      expect(await q(`select 1 from integracao_carga_janela where tenant_id = $1`, [N.tenant])).toEqual([]);
    });
  });

  // ───────────────────────────── carga ─────────────────────────────

  it('a carga de 3 anos entra em fatias, só com a fila folgada, e pula as semanas sem venda', async () => {
    const P = await empresa('Base grande P', ['P1']);
    const n = LIMIAR_CONTRAPRESSAO + 1;
    await q(
      `insert into cliente (tenant_id, nome, telefone)
       select $1, 'Cliente ' || g, '2198' || lpad(g::text, 7, '0') from generate_series(1, $2) g`,
      [P.tenant, n],
    );
    for (const d of [1, 100, 800, 1200]) {
      await pedido(P.tenant, { loja: P.lojas[0], canal: 'cardapio', criado: diasAtras(d), total: 10 });
    }
    await emitirCast(P, ESCOPOS_CAST);
    const escopo = { tenantIds: [P.tenant] };

    // 1ª fatia: 2.000 clientes; a fila encheu → a contrapressão segura as próximas
    expect(await carimbador.fazerCargasJanela(escopo)).toBe(LIMIAR_CONTRAPRESSAO);
    expect(await carimbador.fazerCargasJanela(escopo)).toBe(0);
    const [j1] = await q(`select clientes_ok, feita_em from integracao_carga_janela where tenant_id = $1`, [P.tenant]);
    expect(j1).toEqual({ clientes_ok: false, feita_em: null });

    // a fila esvazia (as outras empresas nunca esperaram por ela) → o resto entra, até o fim
    await assentar([P.tenant]);
    const [j2] = await q(`select clientes_ok, feita_em is not null as feita from integracao_carga_janela where tenant_id = $1`, [
      P.tenant,
    ]);
    expect(j2).toEqual({ clientes_ok: true, feita: true });
    const token = (await emitirCast(P, ESCOPOS_CAST)).token; // o token novo recomeça a carga: nada muda
    await assentar([P.tenant]);
    const cl = await lerTudo(token, 'clientes');
    expect(new Set(cl.itens.map((x) => x.id)).size).toBe(n);
    expect(cl.itens.length).toBe(n);
    expect(cl.paginas.length).toBe(Math.ceil(n / 500));
    const pe = await lerTudo(token, 'pedidos');
    expect(pe.itens.length).toBe(3); // 1, 100 e 800 dias; a de 1.200 dias fica fora dos 3 anos
  });

  it('a carga das vendas pula direto para a venda anterior (semana sem venda não custa uma ida ao banco)', async () => {
    const Q = await empresa('Loja Q', ['Q1']);
    for (const d of [1, 100, 800, 1200]) {
      await pedido(Q.tenant, { loja: Q.lojas[0], canal: 'cardapio', criado: diasAtras(d), total: 10 });
    }
    await comanda(Q.tenant, Q.lojas[0], diasAtras(400), 15);
    await emitirCast(Q, ESCOPOS_CAST);
    const fatia = () => carimbador.fatiaDaCarga(Q.tenant, 'regemcast', 1096);
    expect(await fatia()).toBe(0); // os clientes: nenhum
    // uma fatia por venda: 1, 100, 400 (comanda) e 800 dias; a de 1.200 fica fora dos 3 anos
    expect([await fatia(), await fatia(), await fatia(), await fatia()]).toEqual([1, 1, 1, 1]);
    expect(await fatia()).toBe(-1);
    expect(await fatia()).toBe(-1); // terminada, nada a fazer
    const fila = await q(`select recurso, count(*)::int n from integracao_mudanca where tenant_id = $1 and carga group by 1 order by 1`, [
      Q.tenant,
    ]);
    expect(fila).toEqual([
      { recurso: 'comanda', n: 1 },
      { recurso: 'pedido', n: 3 },
    ]);
  });
});
