import 'reflect-metadata';
import { appendFileSync, readFileSync } from 'node:fs';
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
import { LicencaService } from '../licenca/licenca.service';
import { CardapioService } from '../cardapio/cardapio.service';
import { SyncService } from '../sync/sync.service';
import { IntegracaoApiModule } from './integracao-api.module';
import { IntegracaoTokenService } from './integracao-token.service';
import { CarimbadorIntegracaoService } from './carimbador-integracao.service';
import { CuponsIntegracaoService, hashPedidoIntegracao } from './cupons-integracao.service';
import { BASE_TIPO_PROBLEMA } from './problema';
import { errosCupomBancoLiame, errosCupomRegem, errosPagina, errosUsoCupomRegem } from './contrato-liame.teste-spec';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CUPONS DA API DE INTEGRAÇÃO (trilha C, C1c — PR3), contra o Postgres real e por HTTP (Nest com
// os guards globais de produção: limite por IP e CloudOnly).
//
// Como na spec das vendas: o banco do CI é montado como SERVIDOR DA LOJA (EDGE_MODE=true) e as
// migrations só da nuvem (295–298) sobem num schema só deste teste, na frente do `public`. As
// tabelas que ganham gatilho (`pedido_externo`, `comanda`, `comanda_item`, `cliente`, `cupom`,
// `cupom_uso`) são COPIADAS para o schema — os gatilhos vivem só nas cópias, e as outras specs, que
// rodam ao mesmo tempo no mesmo banco, nunca os disparam. Sem FK para tabela compartilhada
// (LIC-088/ERR-109); a FK `cupom_uso → cupom` (com a cascata de verdade) e o carimbo do cupom
// (`trg_bump_updated_at`, mig 272) são recriados DENTRO do schema. O `public.cupom` do banco do CI
// é o do servidor da loja: é contra ele que se confere o cupom que desce.
// O carimbador roda SÓ nas empresas desta spec (V32/LIC-084).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('integracao-cupons.http.spec: sem TEST_PG_URL — PULADO');
// Conferência extra, só local: grava cada resposta (JSON por linha) para validar com o zod do
// próprio Liame (o backend não tem zod).
const DUMP = process.env.INTEGRACAO_DUMP_RESPOSTAS;

jest.setTimeout(180_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGS, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');
const FONTES = ['pedido_externo', 'comanda', 'comanda_item', 'cliente', 'cupom', 'cupom_uso'];
const FUTURO = '2099-12-31';
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

descrever('API de integração — cupons (GET /cupons, GET /cupons/usos, POST /cupons, POST /cupons/{id}/desativar)', () => {
  const SCHEMA = `teste_integracao_cupons_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 10 });
  const db = drizzle(pool) as any;
  const registros: any[] = [];
  const auditoria = { registrar: async (e: any) => void registros.push(e) } as unknown as AuditoriaService;
  const tokensSvc = new IntegracaoTokenService(db, auditoria);
  const licenca = new LicencaService(db, {} as any, {} as any);
  // O checkout do cardápio de verdade (`validarCupomPublico` → `avaliarCupom`): só usa o banco.
  const cardapio = new CardapioService(db, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const empresas: string[] = [];
  const emitidos: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const edgeOriginal = process.env.EDGE_MODE;
  let app: INestApplication;
  let base = '';
  let cupons: CuponsIntegracaoService;
  let carimbador: CarimbadorIntegracaoService;

  @Global()
  @Module({
    providers: [
      { provide: DRIZZLE, useValue: db },
      { provide: AuditoriaService, useValue: auditoria },
      { provide: LicencaService, useValue: licenca },
    ],
    exports: [DRIZZLE, AuditoriaService, LicencaService],
  })
  class InfraTeste {}

  @Module({
    imports: [InfraTeste, ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]), IntegracaoApiModule],
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

  const chamar = (caminho: string, token: string) => fetch(`${base}${caminho}`, { headers: { authorization: `Bearer ${token}` } });
  async function post(caminho: string, token: string, corpo: any, chave?: string | null, url = base) {
    const r = await fetch(`${url}${caminho}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(chave === null ? {} : { 'idempotency-key': chave ?? `k-${randomUUID()}` }),
      },
      body: JSON.stringify(corpo ?? {}),
    });
    const texto = await r.text();
    const json = texto ? JSON.parse(texto) : null;
    // O reenvio devolve a resposta guardada (igual à original, já gravada) — e o teste de corrida
    // guarda uma resposta artificial de propósito: fora do dump.
    const reenvio = r.headers.get('idempotent-replayed') === 'true';
    if (DUMP && r.status < 300 && json && !reenvio) appendFileSync(DUMP, `${JSON.stringify({ rota: 'cupom', item: json })}\n`);
    return { status: r.status, corpo: json, tipo: r.headers.get('content-type') ?? '', repetido: r.headers.get('idempotent-replayed') };
  }

  // ───────────────────────────── montagem dos dados ─────────────────────────────

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

  const TODOS = ['cupons.ler', 'cupons.uso.ler', 'cupons.criar'];
  async function emitir(emp: { tenant: string; presidente: string }, loja: string, escopos: string[] = TODOS) {
    const r = await tokensSvc.emitir(
      { tenantId: emp.tenant, unidadeId: loja, autorizadoPor: emp.presidente, escopos, evidencia: 'autorização por escrito (teste)' },
      dist,
    );
    emitidos.push(r.token);
    return r.token;
  }
  async function emitirComId(emp: { tenant: string; presidente: string }, loja: string, escopos: string[] = TODOS) {
    const r = await tokensSvc.emitir(
      { tenantId: emp.tenant, unidadeId: loja, autorizadoPor: emp.presidente, escopos, evidencia: 'autorização por escrito (teste)' },
      dist,
    );
    emitidos.push(r.token);
    return { token: r.token, id: r.id };
  }

  async function cupom(
    tenant: string,
    o: {
      loja: string | null;
      codigo: string;
      tipo?: string;
      valor?: number | string;
      teto?: number | null;
      minimo?: number | null;
      ativo?: boolean;
      validade?: string | null;
      validoDe?: string | null;
      maxUsos?: number | null;
      nome?: string | null;
      somenteNovos?: boolean;
      maxPorCliente?: number | null;
      minDias?: number | null;
    },
  ) {
    const [c] = await q(
      `insert into cupom (tenant_id, unidade_id, codigo, tipo, valor, teto_desconto, minimo, ativo, validade, valido_de, max_usos, nome,
                          somente_novos, max_por_cliente, min_dias_sem_compra)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
      [
        tenant,
        o.loja,
        o.codigo,
        o.tipo ?? 'percentual',
        String(o.valor ?? 10),
        o.teto ?? null,
        o.minimo ?? null,
        o.ativo ?? true,
        o.validade ?? null,
        o.validoDe ?? null,
        o.maxUsos ?? null,
        o.nome ?? null,
        o.somenteNovos ?? false,
        o.maxPorCliente ?? null,
        o.minDias ?? null,
      ],
    );
    return c.id as string;
  }

  async function pedido(tenant: string, o: { loja: string | null; descontos?: any[] | null; cupom?: string | null; criado?: string }) {
    const [p] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, status, criado_em, confirmado_em, valor_bruto, total, descontos, cupom, itens, external_id)
       values ($1, $2, 'cardapio', 'confirmado', $3::timestamptz, $3::timestamptz, 50, 50, $4::jsonb, $5, '[]'::jsonb, $6) returning id`,
      [tenant, o.loja, o.criado ?? new Date().toISOString(), o.descontos ? JSON.stringify(o.descontos) : null, o.cupom ?? null, `ext-${randomUUID()}`],
    );
    return p.id as string;
  }

  async function uso(tenant: string, cupomId: string, pedidoId: string | null, usadoEm?: string) {
    const [u] = await q(
      `insert into cupom_uso (tenant_id, cupom_id, pedido_id, telefone, usado_em, created_at)
       values ($1, $2, $3, '21999990000', coalesce($4::timestamptz, now()), coalesce($4::timestamptz, now())) returning id`,
      [tenant, cupomId, pedidoId, usadoEm ?? null],
    );
    return u.id as string;
  }

  const carimbar = (tenants: string[]) => carimbador.ciclo({ tenantIds: tenants }, 30_000);

  /** Lê a rota inteira, página a página, validando cada página contra o contrato do Liame. */
  async function lerTudo(token: string, o: { rota?: 'cupons' | 'cupons/usos'; limite?: number; primeira?: string; cursor?: string | null } = {}) {
    const rota = o.rota ?? 'cupons';
    const validar = rota === 'cupons' ? errosCupomRegem : errosUsoCupomRegem;
    let cursor: string | null = o.cursor ?? null;
    const itens: any[] = [];
    let paginas = 0;
    for (;;) {
      const qs = `limite=${o.limite ?? 500}${cursor ? `&cursor=${cursor}` : (o.primeira ?? '')}`;
      const r = await chamar(`/integracao/${rota}?${qs}`, token);
      expect(r.status).toBe(200);
      const pg: any = await r.json();
      expect(errosPagina(pg, validar)).toEqual([]);
      if (rota === 'cupons') for (const c of pg.itens) expect(errosCupomBancoLiame(c)).toEqual([]);
      if (DUMP) appendFileSync(DUMP, `${JSON.stringify({ rota, pagina: pg })}\n`);
      itens.push(...pg.itens);
      cursor = pg.proximo_cursor;
      paginas++;
      if (!pg.tem_mais) break;
    }
    return { itens, cursor, paginas };
  }

  /** A última versão de cada item (a lista pode ter o mesmo item em versões diferentes). */
  const ultimas = (itens: any[]) => {
    const m = new Map<string, any>();
    for (const v of itens) if (!m.has(v.id) || m.get(v.id).versao < v.versao) m.set(v.id, v);
    return m;
  };

  // ───────────────────────────── cenário principal ─────────────────────────────

  let A: Awaited<ReturnType<typeof empresa>>; // 2 lojas
  let B: Awaited<ReturnType<typeof empresa>>; // outra empresa
  let D: Awaited<ReturnType<typeof empresa>>; // loja única
  let tA1 = '';
  let tA2 = '';
  let tB1 = '';
  let tD1 = '';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a API é da NUVEM
    await pool.query(`create schema ${SCHEMA}`);
    for (const t of FONTES) await pool.query(`create table ${SCHEMA}.${t} (like public.${t} including all)`);
    // O índice único do código com o NOME de produção (o `like` gera outro nome), a cascata
    // cupom_uso → cupom e o carimbo do cupom — tudo dentro do schema do teste.
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
    await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(mig('295_integracao_token_loja.sql'))));
    await pool.query(mig('296_integracao_versao_vendas.sql'));
    await pool.query(mig('297_pedido_externo_comanda_idx.sql'));
    const conferencia = (await pool.query(mig('298_integracao_cupons.sql')) as any) as any[];
    const ultima = Array.isArray(conferencia) ? conferencia[conferencia.length - 1] : conferencia;
    const falhas = ultima.rows.filter((r: any) => r.ok !== true).map((r: any) => r.objeto);
    if (falhas.length) throw new Error(`conferência da 298 falhou: ${falhas.join(', ')}`);
    // A 299 (origem do pedido do cardápio): o carimbador lê `pedido_origem` ao montar as vendas.
    const conf299 = (await pool.query(mig('299_pedido_origem.sql')) as any) as any[];
    const falhas299 = conf299[conf299.length - 1].rows.filter((r: any) => r.ok !== true).map((r: any) => r.objeto);
    if (falhas299.length) throw new Error(`conferência da 299 falhou: ${falhas299.join(', ')}`);
    // Só a FK interna cupom_uso → cupom, as duas no schema do teste (o `regclass` omite o schema do
    // search_path: compara-se o namespace da tabela-alvo).
    const fks = await q(
      `select c.conname, ta.relname as alvo, na.nspname as schema_alvo
         from pg_constraint c
         join pg_namespace s on s.oid = c.connamespace
         join pg_class ta on ta.oid = c.confrelid
         join pg_namespace na on na.oid = ta.relnamespace
        where s.nspname = $1 and c.contype = 'f'`,
      [SCHEMA],
    );
    if (fks.length !== 1 || fks.some((f) => f.schema_alvo !== SCHEMA)) {
      throw new Error(`o schema do teste não pode ter FK para tabela compartilhada (LIC-088): ${JSON.stringify(fks)}`);
    }
    const onde = await q(
      `select c.relname, s.nspname from pg_class c join pg_namespace s on s.oid = c.relnamespace
        where c.oid in (to_regclass('cupom'), to_regclass('cupom_uso'), to_regclass('pedido_externo'),
                        to_regclass('integracao_versao'), to_regclass('integracao_cupom'), to_regclass('integracao_idempotencia'))`,
    );
    if (onde.length !== 6 || onde.some((x) => x.nspname !== SCHEMA)) {
      throw new Error(`as tabelas do teste não estão na frente do public: ${JSON.stringify(onde)}`);
    }
    const [gat] = await q(
      `select count(*)::int n from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace s on s.oid = c.relnamespace
        where g.tgname like 'trg_integracao_%' and s.nspname = 'public'`,
    );
    if (gat.n) throw new Error('as migrations não podem ter posto gatilho nas tabelas compartilhadas');

    ({ app, base } = await subir());
    cupons = app.get(CuponsIntegracaoService);
    carimbador = app.get(CarimbadorIntegracaoService);
    cupons.atrasoSeg = 0; // o atraso de 15 s tem teste próprio

    A = await empresa('Empresa A', ['A1 matriz', 'A2 filial']);
    B = await empresa('Empresa B', ['B1']);
    D = await empresa('Empresa D', ['D1 única']);
    tA1 = await emitir(A, A.lojas[0]);
    tA2 = await emitir(A, A.lojas[1]);
    tB1 = await emitir(B, B.lojas[0]);
    tD1 = await emitir(D, D.lojas[0]);

    const [a1, a2] = A.lojas;
    ids.a1 = await cupom(A.tenant, {
      loja: a1,
      codigo: 'combosexta',
      nome: 'Combo de sexta',
      valor: 10,
      teto: 15,
      minimo: 40,
      validoDe: '2026-09-26',
      validade: '2026-10-31',
      maxUsos: 300,
      maxPorCliente: 1,
    });
    ids.a2 = await cupom(A.tenant, { loja: a2, codigo: 'FILIAL5', tipo: 'valor', valor: 5 });
    ids.rede = await cupom(A.tenant, { loja: null, codigo: 'FRETEGRATIS', tipo: 'fretegratis', valor: 0 });
    ids.zero = await cupom(A.tenant, { loja: a1, codigo: 'ZEROPCT', valor: 0 }); // a tela aceita 0%
    ids.b1 = await cupom(B.tenant, { loja: B.lojas[0], codigo: 'OUTRAEMPRESA', valor: 20 });
    ids.d1 = await cupom(D.tenant, { loja: D.lojas[0], codigo: 'DLOJA', valor: 7.5 });
    ids.dRede = await cupom(D.tenant, { loja: null, codigo: 'DREDE', tipo: 'valor', valor: 3.33 });

    // Usos: pedido do cardápio com o desconto do cupom (A1), pedido do frete grátis (A1), pedido da
    // A2, pedido SEM loja (cardápio da rede) na empresa de 2 lojas e na de loja única.
    ids.pedA1 = await pedido(A.tenant, {
      loja: a1,
      cupom: 'COMBOSEXTA',
      descontos: [
        { origem: 'cupom', rotulo: 'Cupom COMBOSEXTA', valor: 5.99, quemBanca: 'loja', campanha: 'COMBOSEXTA' },
        { origem: 'cashback', rotulo: 'Cashback', valor: 2, quemBanca: 'loja' },
      ],
    });
    ids.usoA1 = await uso(A.tenant, ids.a1, ids.pedA1);
    ids.pedFrete = await pedido(A.tenant, {
      loja: a1,
      cupom: 'FRETEGRATIS',
      descontos: [{ origem: 'frete', rotulo: 'Cupom FRETEGRATIS · frete grátis', valor: 7, alvo: 'DELIVERY_FEE', quemBanca: 'loja' }],
    });
    ids.usoFrete = await uso(A.tenant, ids.rede, ids.pedFrete);
    ids.pedA2 = await pedido(A.tenant, { loja: a2, cupom: 'FILIAL5', descontos: [{ origem: 'cupom', valor: 5, quemBanca: 'loja' }] });
    ids.usoA2 = await uso(A.tenant, ids.a2, ids.pedA2);
    ids.pedSemLojaA = await pedido(A.tenant, { loja: null, cupom: 'FRETEGRATIS', descontos: [] });
    ids.usoSemLojaA = await uso(A.tenant, ids.rede, ids.pedSemLojaA);
    ids.pedLegado = await pedido(A.tenant, { loja: a1, cupom: 'COMBOSEXTA', descontos: null }); // antes da mig 241
    ids.usoLegado = await uso(A.tenant, ids.a1, ids.pedLegado);
    ids.pedD = await pedido(D.tenant, { loja: null, cupom: 'DREDE', descontos: [{ origem: 'cupom', valor: 3.33, quemBanca: 'loja' }] });
    ids.usoD = await uso(D.tenant, ids.dRede, ids.pedD);

    await carimbar([A.tenant, B.tenant, D.tenant]);
  });

  afterAll(async () => {
    await app?.close();
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) {
      await pool.query('delete from sync_exclusao where tenant_id = any($1::uuid[])', [empresas]).catch(() => undefined);
      await pool.query('delete from cardapio_config where tenant_id = any($1::uuid[])', [empresas]).catch(() => undefined);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    }
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  }, 120_000);

  // ───────────────────────────── leitura ─────────────────────────────

  describe('GET /cupons — os cupons que valem para a loja do token', () => {
    it('cada campo como o contrato pede (e o banco do Liame aceita)', async () => {
      const m = ultimas((await lerTudo(tA1)).itens);
      expect(m.get(ids.a1)).toEqual({
        id: ids.a1,
        versao: expect.any(Number),
        atualizado_em: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/),
        codigo: 'COMBOSEXTA',
        nome: 'Combo de sexta',
        tipo: 'percentual',
        percentual: '10.00',
        valor_centavos: null,
        teto_desconto_centavos: 1500,
        pedido_minimo_centavos: 4000,
        valido_de: '2026-09-26',
        valido_ate: '2026-10-31',
        fuso: 'America/Sao_Paulo',
        ativo: true,
        max_usos: 300,
        usos: 2, // o do pedido com desconto e o do pedido antigo
        condicoes: { somente_novos: false, max_por_cliente: 1, min_dias_sem_compra: null },
        todas_as_lojas: false,
        removido: false,
      });
      expect(m.get(ids.rede)).toMatchObject({ tipo: 'frete_gratis', percentual: null, valor_centavos: null, todas_as_lojas: true, usos: 2 });
      // 0% (a tela aceita; o banco do Liame não): sai como "outro", sem percentual
      expect(m.get(ids.zero)).toMatchObject({ codigo: 'ZEROPCT', tipo: 'outro', percentual: null });
    });

    it('isolamento: a loja do token e os sem loja; outra loja e outra empresa não; loja única vê todos', async () => {
      const a1 = [...ultimas((await lerTudo(tA1)).itens).keys()].sort();
      const a2 = [...ultimas((await lerTudo(tA2)).itens).keys()].sort();
      const b1 = [...ultimas((await lerTudo(tB1)).itens).keys()].sort();
      const d1 = [...ultimas((await lerTudo(tD1)).itens).keys()].sort();
      expect(a1).toEqual([ids.a1, ids.rede, ids.zero].sort());
      expect(a2).toEqual([ids.a2, ids.rede].sort());
      expect(b1).toEqual([ids.b1]);
      expect(d1).toEqual([ids.d1, ids.dRede].sort());
    });

    it('sem cupons.ler → 403; cursor de outra loja, de outra rota ou adulterado → 400 (problem+json)', async () => {
      const soUso = await emitir(A, A.lojas[0], ['cupons.uso.ler']);
      const r = await chamar('/integracao/cupons', soUso);
      expect(r.status).toBe(403);
      expect(r.headers.get('content-type')).toContain('application/problem+json');
      expect(((await r.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}escopo-insuficiente`);
      const t = await emitir(A, A.lojas[0]);
      const pg: any = await (await chamar('/integracao/cupons?limite=1', t)).json();
      expect(pg.tem_mais).toBe(true);
      for (const [caminho, tok] of [
        [`/integracao/cupons?cursor=${pg.proximo_cursor}`, tA2],
        [`/integracao/cupons?cursor=${pg.proximo_cursor}`, tB1],
        [`/integracao/cupons/usos?cursor=${pg.proximo_cursor}`, t],
        ['/integracao/cupons?cursor=abc', t],
        ['/integracao/cupons?limite=0', t],
      ] as const) {
        const x = await chamar(caminho, tok);
        expect(x.status).toBe(400);
        expect([`${BASE_TIPO_PROBLEMA}cursor-invalido`, `${BASE_TIPO_PROBLEMA}parametro-invalido`]).toContain(((await x.json()) as any).type);
      }
    });
  });

  describe('GET /cupons/usos — sem dado do cliente', () => {
    it('uso = cupom, código, pedido (id da venda), momento e o desconto do cupom no pedido', async () => {
      const m = ultimas((await lerTudo(tA1, { rota: 'cupons/usos' })).itens);
      expect(m.get(ids.usoA1)).toEqual({
        id: ids.usoA1,
        versao: 1,
        atualizado_em: expect.any(String),
        cupom_id: ids.a1,
        codigo: 'COMBOSEXTA',
        pedido_id: ids.pedA1,
        usado_em: expect.stringMatching(/Z$/),
        desconto_centavos: 599, // só a parte do cupom (o cashback não)
        removido: false,
      });
      expect(m.get(ids.usoFrete)).toMatchObject({ codigo: 'FRETEGRATIS', desconto_centavos: 700 }); // o frete que o cupom zerou
      expect(m.get(ids.usoLegado)).toMatchObject({ desconto_centavos: null }); // pedido sem o detalhe: não se sabe
      // nada de telefone nem de cliente em lugar nenhum
      const tudo = JSON.stringify([...m.values()]);
      expect(tudo).not.toContain('21999990000');
      expect(tudo).not.toContain('telefone');
      // a loja do uso é a do pedido: a A1 não vê o uso da A2 nem o do pedido sem loja
      expect([...m.keys()].sort()).toEqual([ids.usoA1, ids.usoFrete, ids.usoLegado].sort());
    });

    it('empresa de loja única vê o uso do pedido sem loja; outra loja/empresa não vê', async () => {
      expect([...ultimas((await lerTudo(tD1, { rota: 'cupons/usos' })).itens).keys()]).toEqual([ids.usoD]);
      expect([...ultimas((await lerTudo(tA2, { rota: 'cupons/usos' })).itens).keys()]).toEqual([ids.usoA2]);
      expect((await lerTudo(tB1, { rota: 'cupons/usos' })).itens).toEqual([]);
    });

    it('sem cupons.uso.ler → 403; `desde` só na primeira página (e fica no cursor)', async () => {
      const soLer = await emitir(A, A.lojas[0], ['cupons.ler']);
      expect((await chamar('/integracao/cupons/usos', soLer)).status).toBe(403);
      const E = await empresa('Empresa desde', ['E1']);
      const t = await emitir(E, E.lojas[0]);
      const c = await cupom(E.tenant, { loja: E.lojas[0], codigo: 'DESDE1' });
      const velho = await uso(E.tenant, c, await pedido(E.tenant, { loja: E.lojas[0] }), new Date(Date.now() - 50 * 86_400_000).toISOString());
      const novo = await uso(E.tenant, c, await pedido(E.tenant, { loja: E.lojas[0] }));
      await carimbar([E.tenant]);
      const desde = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const r = await lerTudo(t, { rota: 'cupons/usos', primeira: `&desde=${desde}` });
      expect(r.itens.map((x) => x.id)).toEqual([novo]);
      expect((await lerTudo(t, { rota: 'cupons/usos' })).itens.map((x) => x.id).sort()).toEqual([velho, novo].sort());
      const x = await chamar(`/integracao/cupons/usos?cursor=${r.cursor}&desde=${new Date().toISOString()}`, t);
      expect(x.status).toBe(400);
    });
  });

  // ───────────────────────────── versão e lápide ─────────────────────────────

  describe('versão e lápide', () => {
    it('uso novo sobe a versão do cupom (usos); uso apagado (pedido cancelado) sai como lápide e o cupom desce a contagem', async () => {
      const t = await emitir(A, A.lojas[0]);
      const antes = ultimas((await lerTudo(t)).itens).get(ids.a1);
      const ped = await pedido(A.tenant, { loja: A.lojas[0], descontos: [{ origem: 'cupom', valor: 4, quemBanca: 'loja' }] });
      const u = await uso(A.tenant, ids.a1, ped);
      await carimbar([A.tenant]);
      const depois = ultimas((await lerTudo(t)).itens).get(ids.a1);
      expect(depois.usos).toBe(antes.usos + 1);
      expect(depois.versao).toBeGreaterThan(antes.versao);
      const usoPublicado = ultimas((await lerTudo(t, { rota: 'cupons/usos' })).itens).get(u);
      expect(usoPublicado).toMatchObject({ removido: false, desconto_centavos: 400 });
      // cancelar o pedido apaga o uso (`estornarCupomUso`): lápide com a última foto, versão nova
      await q(`delete from cupom_uso where tenant_id = $1 and pedido_id = $2`, [A.tenant, ped]);
      await carimbar([A.tenant]);
      const lapide = ultimas((await lerTudo(t, { rota: 'cupons/usos' })).itens).get(u);
      expect(lapide).toMatchObject({ id: u, removido: true, cupom_id: ids.a1, codigo: 'COMBOSEXTA', pedido_id: ped, desconto_centavos: 400 });
      expect(lapide.versao).toBeGreaterThan(usoPublicado.versao);
      const cupomDepois = ultimas((await lerTudo(t)).itens).get(ids.a1);
      expect(cupomDepois.usos).toBe(antes.usos);
      expect(cupomDepois.versao).toBeGreaterThan(depois.versao);
    });

    it('cupom apagado (DELETE da tela) sai como lápide inativa; os usos dele também (cascata)', async () => {
      const t = await emitir(A, A.lojas[0]);
      const c = await cupom(A.tenant, { loja: A.lojas[0], codigo: 'APAGAR1', tipo: 'valor', valor: 2 });
      const u = await uso(A.tenant, c, await pedido(A.tenant, { loja: A.lojas[0] }));
      await carimbar([A.tenant]);
      const antes = ultimas((await lerTudo(t)).itens).get(c);
      await q(`delete from cupom where id = $1`, [c]); // o `removerCupom` da tela
      await carimbar([A.tenant]);
      const lap = ultimas((await lerTudo(t)).itens).get(c);
      expect(lap).toMatchObject({ id: c, codigo: 'APAGAR1', tipo: 'valor', valor_centavos: 200, ativo: false, removido: true });
      expect(lap.versao).toBeGreaterThan(antes.versao);
      expect(ultimas((await lerTudo(t, { rota: 'cupons/usos' })).itens).get(u)).toMatchObject({ removido: true });
    });

    it('cupom criado e apagado antes de publicar não deixa rastro; mudança só de carimbo não gera versão', async () => {
      const t = await emitir(A, A.lojas[0]);
      const c = await cupom(A.tenant, { loja: A.lojas[0], codigo: 'EFEMERO' });
      await q(`delete from cupom where id = $1`, [c]);
      await carimbar([A.tenant]);
      expect(ultimas((await lerTudo(t)).itens).has(c)).toBe(false);
      expect(await q(`select 1 from integracao_versao where recurso_id = $1`, [c])).toEqual([]);
      // a tela "recria" o cupom com os mesmos valores (update igual): o gatilho não anota nada
      await q(`update cupom set valor = valor, codigo = codigo where id = $1`, [ids.d1]);
      expect(await q(`select 1 from integracao_mudanca where recurso_id = $1`, [ids.d1])).toEqual([]);
    });

    it('uso apagado pelo SERVIDOR DA LOJA (exclusão que sobe pelo push do sync) também vira lápide', async () => {
      const t = await emitir(A, A.lojas[0]);
      const ped = await pedido(A.tenant, { loja: A.lojas[0] });
      const u = await uso(A.tenant, ids.a1, ped);
      await carimbar([A.tenant]);
      const sync = new SyncService(db);
      const r = await sync.push({ tenantId: A.tenant, unidadeId: A.lojas[0], equipamentoId: randomUUID(), token: 'x' } as any, [
        {
          tabela: 'sync_exclusao',
          linhas: [{ id: randomUUID(), tenant_id: A.tenant, tabela: 'cupom_uso', registro_id: u, created_at: new Date().toISOString() }],
        },
      ]);
      expect(r.resultado.sync_exclusao.aplicadas).toBe(1);
      expect(await q(`select 1 from cupom_uso where id = $1`, [u])).toEqual([]);
      await carimbar([A.tenant]);
      expect(ultimas((await lerTudo(t, { rota: 'cupons/usos' })).itens).get(u)).toMatchObject({ removido: true });
    });
  });

  // ───────────────────────────── cursor ─────────────────────────────

  describe('cursor estável', () => {
    it('com escrita no meio da leitura: nada fica para trás; o que mudou volta com versão maior', async () => {
      const E = await empresa('Empresa cursor', ['E1']);
      const t = await emitir(E, E.lojas[0]);
      const criados: string[] = [];
      for (let i = 0; i < 5; i++) criados.push(await cupom(E.tenant, { loja: E.lojas[0], codigo: `CUR${i}XX`, valor: 5 + i }));
      await carimbar([E.tenant]);
      let r: any = await (await chamar('/integracao/cupons?limite=2', t)).json();
      const vistos = [...r.itens];
      const mudado = vistos[0].id;
      await q(`update cupom set ativo = false where id = $1`, [mudado]);
      const novo = await cupom(E.tenant, { loja: E.lojas[0], codigo: 'CURNOVO' });
      await carimbar([E.tenant]);
      do {
        r = await (await chamar(`/integracao/cupons?limite=2&cursor=${r.proximo_cursor}`, t)).json();
        expect(errosPagina(r, errosCupomRegem)).toEqual([]);
        vistos.push(...r.itens);
      } while (r.tem_mais);
      expect([...ultimas(vistos).keys()].sort()).toEqual([...criados, novo].sort());
      const doMudado = vistos.filter((v) => v.id === mudado);
      expect(doMudado.map((v) => v.ativo)).toEqual([true, false]);
      expect(doMudado[1].versao).toBeGreaterThan(doMudado[0].versao);
    });

    it('só devolve o carimbado há mais de 15 s; carimbos no mesmo milissegundo não se perdem', async () => {
      const E = await empresa('Empresa atraso', ['E1']);
      const t = await emitir(E, E.lojas[0]);
      const lista: string[] = [];
      for (let i = 0; i < 3; i++) lista.push(await cupom(E.tenant, { loja: E.lojas[0], codigo: `MS${i}ABC` }));
      await carimbar([E.tenant]);
      cupons.atrasoSeg = 15;
      try {
        const cedo = await lerTudo(t);
        expect(cedo.itens).toEqual([]);
        for (const [i, id] of lista.entries()) {
          await q(`update integracao_versao set atualizado_em = '2026-09-29T12:00:00.12340${i + 1}Z' where recurso_id = $1`, [id]);
        }
        const tarde = await lerTudo(t, { cursor: cedo.cursor, limite: 1 });
        expect(tarde.itens.map((v) => v.id)).toEqual(lista);
        expect(tarde.paginas).toBe(3);
      } finally {
        cupons.atrasoSeg = 0;
      }
    });
  });

  // ───────────────────────────── criação ─────────────────────────────

  const CORPO = {
    codigo: 'liamemeta10',
    nome: 'Meta · Combo de sexta',
    tipo: 'percentual',
    percentual: '10.00',
    teto_desconto_centavos: 1500,
    pedido_minimo_centavos: 4000,
    valido_de: '2026-01-01',
    valido_ate: FUTURO,
    max_usos: 300,
    condicoes: { max_por_cliente: 1 },
  };

  describe('POST /cupons', () => {
    let tCria = '';
    let criado: any = null;

    beforeAll(async () => {
      tCria = await emitir(A, A.lojas[0]);
    });

    it('cria na loja do token: 201 no formato 3.1, versão publicada, marca de origem, auditoria sem o token', async () => {
      const r = await post('/integracao/cupons', tCria, CORPO, 'acao-criar-1');
      expect(r.status).toBe(201);
      expect(r.repetido).toBeNull();
      expect(errosCupomRegem(r.corpo)).toEqual([]);
      expect(errosCupomBancoLiame(r.corpo)).toEqual([]);
      expect(r.corpo).toMatchObject({
        codigo: 'LIAMEMETA10',
        nome: 'Meta · Combo de sexta',
        tipo: 'percentual',
        percentual: '10.00',
        teto_desconto_centavos: 1500,
        pedido_minimo_centavos: 4000,
        valido_de: '2026-01-01',
        valido_ate: FUTURO,
        ativo: true,
        max_usos: 300,
        usos: 0,
        condicoes: { somente_novos: false, max_por_cliente: 1, min_dias_sem_compra: null },
        todas_as_lojas: false,
        removido: false,
        versao: 1,
      });
      criado = r.corpo;
      const [linha] = await q(`select * from cupom where id = $1`, [criado.id]);
      expect(linha).toMatchObject({ tenant_id: A.tenant, unidade_id: A.lojas[0], codigo: 'LIAMEMETA10', tipo: 'percentual', ativo: true, max_usos: 300, max_por_cliente: 1 });
      expect([Number(linha.valor), Number(linha.teto_desconto), Number(linha.minimo)]).toEqual([10, 15, 40]);
      const [marca] = await q(`select * from integracao_cupom where cupom_id = $1`, [criado.id]);
      expect(marca).toMatchObject({ tenant_id: A.tenant, unidade_id: A.lojas[0], cliente: 'liame', chave: 'acao-criar-1' });
      // a leitura devolve exatamente o que o 201 disse
      expect(ultimas((await lerTudo(tCria)).itens).get(criado.id)).toEqual(criado);
      const log = registros.filter((e) => e.acao === 'integracao.cupom_criado' && e.entidadeId === criado.id);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ tenantId: A.tenant, unidadeId: A.lojas[0], atorTipo: 'integracao', origem: 'integracao' });
      expect(log[0].detalhe).toMatchObject({ cliente: 'liame', codigo: 'LIAMEMETA10', idempotencia: 'acao-criar-1' });
    });

    it('o cupom criado é o que o checkout do cardápio aplica (10% até R$ 15, mínimo R$ 40, 1 por cliente)', async () => {
      const token = `ck-${randomUUID().slice(0, 12)}`;
      await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo) values ($1, $2, $3, true)`, [A.tenant, A.lojas[0], token]);
      const tel = '21988887777';
      expect(await cardapio.validarCupomPublico(token, 'liamemeta10', 200, tel)).toMatchObject({ valido: true, desconto: 15, cupomId: criado.id });
      expect(await cardapio.validarCupomPublico(token, 'LIAMEMETA10', 100, tel)).toMatchObject({ valido: true, desconto: 10 });
      expect(await cardapio.validarCupomPublico(token, 'LIAMEMETA10', 30, tel)).toMatchObject({ valido: false, motivo: 'Mínimo de R$ 40.00.' });
      // "1 por cliente" (max_por_cliente): sem telefone não dá; depois de um uso do telefone, não passa de novo
      expect(await cardapio.validarCupomPublico(token, 'LIAMEMETA10', 200)).toMatchObject({
        valido: false,
        motivo: 'Informe seu telefone para usar este cupom.',
      });
      await q(`insert into cupom_uso (tenant_id, cupom_id, telefone) values ($1, $2, $3)`, [A.tenant, criado.id, tel]);
      expect(await cardapio.validarCupomPublico(token, 'LIAMEMETA10', 200, tel)).toMatchObject({
        valido: false,
        motivo: 'Você já usou este cupom o máximo de vezes.',
      });
      ids.cardapioToken = token;
    });

    it('reenvio com a mesma chave e o mesmo corpo → a MESMA resposta (e um cupom só, uma auditoria só)', async () => {
      const corpoReordenado = { ...CORPO, condicoes: { max_por_cliente: 1 }, codigo: 'liamemeta10' };
      const r = await post('/integracao/cupons', tCria, corpoReordenado, 'acao-criar-1');
      expect(r.status).toBe(201);
      expect(r.repetido).toBe('true');
      expect(r.corpo).toEqual(criado);
      expect(await q(`select id from cupom where tenant_id = $1 and upper(codigo) = 'LIAMEMETA10'`, [A.tenant])).toHaveLength(1);
      expect(registros.filter((e) => e.acao === 'integracao.cupom_criado' && e.entidadeId === criado.id)).toHaveLength(1);
      // o token NOVO da mesma loja (troca de escopos) com a mesma chave: a mesma resposta
      const outro = await emitir(A, A.lojas[0]);
      expect((await post('/integracao/cupons', outro, CORPO, 'acao-criar-1')).corpo).toEqual(criado);
    });

    it('mesma chave com outro corpo → 422 chave-reutilizada; sem chave → 400', async () => {
      const r = await post('/integracao/cupons', tCria, { ...CORPO, percentual: '15.00' }, 'acao-criar-1');
      expect(r.status).toBe(422);
      expect(r.tipo).toContain('application/problem+json');
      expect(r.corpo.type).toBe(`${BASE_TIPO_PROBLEMA}chave-reutilizada`);
      const semChave = await post('/integracao/cupons', tCria, { ...CORPO, codigo: 'SEMCHAVE1' }, null);
      expect(semChave.status).toBe(400);
      expect(semChave.corpo.detail).toContain('Idempotency-Key');
      const comEspaco = await post('/integracao/cupons', tCria, { ...CORPO, codigo: 'SEMCHAVE1' }, 'chave com espaço');
      expect(comEspaco.status).toBe(400);
      expect(await q(`select 1 from cupom where upper(codigo) = 'SEMCHAVE1' and tenant_id = $1`, [A.tenant])).toEqual([]);
    });

    it('código existente (outra chave) → 409 codigo-em-uso e o cupom existente NÃO muda — nem o da loja', async () => {
      const antes = await q(`select * from cupom where id = $1`, [ids.a1]);
      const r = await post('/integracao/cupons', tCria, { ...CORPO, codigo: 'ComboSexta', percentual: '50.00' }, 'acao-409');
      expect(r.status).toBe(409);
      expect(r.corpo.type).toBe(`${BASE_TIPO_PROBLEMA}codigo-em-uso`);
      expect(await q(`select * from cupom where id = $1`, [ids.a1])).toEqual(antes);
      // o 409 também é a resposta guardada da chave
      const denovo = await post('/integracao/cupons', tCria, { ...CORPO, codigo: 'ComboSexta', percentual: '50.00' }, 'acao-409');
      expect([denovo.status, denovo.repetido, denovo.corpo.type]).toEqual([409, 'true', `${BASE_TIPO_PROBLEMA}codigo-em-uso`]);
      // o código de OUTRA empresa não conflita
      expect((await post('/integracao/cupons', tB1, { ...CORPO, codigo: 'LIAMEMETA10' }, 'b-cria-1')).status).toBe(201);
    });

    it.each([
      ['código curto', { ...CORPO, codigo: 'AB' }, 'codigo'],
      ['tipo outro', { ...CORPO, tipo: 'outro' }, 'tipo'],
      ['percentual 0', { ...CORPO, percentual: '0.00' }, 'percentual'],
      ['percentual acima de 100', { ...CORPO, percentual: '100.50' }, 'percentual'],
      ['valor 0', { codigo: 'VALOR0X', tipo: 'valor', valor_centavos: 0 }, 'valor_centavos'],
      ['fim no passado', { ...CORPO, valido_de: null, valido_ate: '2020-01-01' }, 'valido_ate'],
      ['datas invertidas', { ...CORPO, valido_de: FUTURO, valido_ate: '2098-01-01' }, 'valido_de'],
      ['número negativo', { ...CORPO, pedido_minimo_centavos: -1 }, 'pedido_minimo_centavos'],
      ['booleano que não é booleano', { ...CORPO, condicoes: { somente_novos: 'sim' } }, 'somente_novos'],
      ['campo desconhecido', { ...CORPO, ativo: false }, 'campo desconhecido'],
    ])('422 regra-invalida — %s (nada gravado)', async (_nome, corpo, campo) => {
      const t = await emitir(A, A.lojas[0]);
      const chave = `r422-${randomUUID()}`;
      const r = await post('/integracao/cupons', t, corpo, chave);
      expect(r.status).toBe(422);
      expect(r.corpo.type).toBe(`${BASE_TIPO_PROBLEMA}regra-invalida`);
      expect(r.corpo.detail).toContain(campo);
      const codigo = String((corpo as any).codigo ?? '').toUpperCase();
      if (codigo !== 'LIAMEMETA10') expect(await q(`select 1 from cupom where tenant_id = $1 and upper(codigo) = $2`, [A.tenant, codigo])).toEqual([]);
    });

    it('frete grátis e valor em centavos gravam o cupom como a tela grava', async () => {
      const t = await emitir(D, D.lojas[0]);
      const f = await post('/integracao/cupons', t, { codigo: 'FRETELIAME', tipo: 'frete_gratis' }, 'd-frete');
      const v = await post('/integracao/cupons', t, { codigo: 'VALELIAME', tipo: 'valor', valor_centavos: 1234 }, 'd-valor');
      expect([f.status, v.status]).toEqual([201, 201]);
      expect(f.corpo).toMatchObject({ tipo: 'frete_gratis', valor_centavos: null, percentual: null });
      expect(v.corpo).toMatchObject({ tipo: 'valor', valor_centavos: 1234 });
      const linhas = await q(`select codigo, tipo, valor::text as valor from cupom where id = any($1::uuid[]) order by codigo`, [[f.corpo.id, v.corpo.id]]);
      expect(linhas).toEqual([
        { codigo: 'FRETELIAME', tipo: 'fretegratis', valor: '0' },
        { codigo: 'VALELIAME', tipo: 'valor', valor: '12.34' },
      ]);
    });

    it('sem cupons.criar → 403 (criar e desativar)', async () => {
      const soLer = await emitir(A, A.lojas[0], ['cupons.ler', 'cupons.uso.ler']);
      const r1 = await post('/integracao/cupons', soLer, { ...CORPO, codigo: 'SEMESCOPO' }, 'e1');
      const r2 = await post(`/integracao/cupons/${criado.id}/desativar`, soLer, {}, 'e2');
      expect([r1.status, r2.status]).toEqual([403, 403]);
      expect(r1.corpo.detail).toContain('cupons.criar');
    });
  });

  // ───────────────────────────── corridas ─────────────────────────────

  describe('idempotência sob corrida (transação aberta — LIC-020)', () => {
    it('a mesma chave presa numa transação que não termina → 409 chave-em-uso; ao desistir, a chave volta a valer', async () => {
      const r0 = await emitirComId(A, A.lojas[0]);
      const c = await pool.connect();
      cupons.esperaChaveMs = 500;
      try {
        await c.query('begin');
        await c.query(
          `insert into integracao_idempotencia (tenant_id, unidade_id, cliente, chave, token_id, rota, hash_corpo)
           values ($1, $2, 'liame', 'corrida-1', $3, 'POST /cupons', 'x')`,
          [A.tenant, A.lojas[0], r0.id],
        );
        const r = await post('/integracao/cupons', r0.token, { ...CORPO, codigo: 'CORRIDA1' }, 'corrida-1');
        expect(r.status).toBe(409);
        expect(r.corpo.type).toBe(`${BASE_TIPO_PROBLEMA}chave-em-uso`);
        await c.query('rollback');
        const ok = await post('/integracao/cupons', r0.token, { ...CORPO, codigo: 'CORRIDA1' }, 'corrida-1');
        expect(ok.status).toBe(201);
      } finally {
        cupons.esperaChaveMs = 3000;
        c.release();
      }
    });

    it('a outra transação confirma enquanto este pedido espera → este devolve a resposta dela', async () => {
      const r0 = await emitirComId(A, A.lojas[0]);
      const corpo = { ...CORPO, codigo: 'CORRIDA2' };
      const guardada = { id: randomUUID(), codigo: 'CORRIDA2', versao: 1 };
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(
          `insert into integracao_idempotencia (tenant_id, unidade_id, cliente, chave, token_id, rota, hash_corpo, status_http, resposta)
           values ($1, $2, 'liame', 'corrida-2', $3, 'POST /cupons', $4, 201, $5::jsonb)`,
          [A.tenant, A.lojas[0], r0.id, hashPedidoIntegracao('POST', '/integracao/cupons', corpo), JSON.stringify(guardada)],
        );
        const pedidoHttp = post('/integracao/cupons', r0.token, corpo, 'corrida-2');
        await espera(400);
        await c.query('commit');
        const r = await pedidoHttp;
        expect([r.status, r.repetido]).toEqual([201, 'true']);
        expect(r.corpo).toEqual(guardada);
        expect(await q(`select 1 from cupom where tenant_id = $1 and codigo = 'CORRIDA2'`, [A.tenant])).toEqual([]);
      } finally {
        c.release();
      }
    });

    it('cinco pedidos iguais ao mesmo tempo → um cupom só; os outros recebem a mesma resposta (ou chave-em-uso)', async () => {
      const t = await emitir(A, A.lojas[0]);
      const rs = await Promise.all(Array.from({ length: 5 }, () => post('/integracao/cupons', t, { ...CORPO, codigo: 'PARALELO5' }, 'paralelo-5')));
      const criados = rs.filter((r) => r.status === 201);
      expect(criados.length).toBeGreaterThanOrEqual(1);
      expect(rs.every((r) => r.status === 201 || (r.status === 409 && r.corpo.type === `${BASE_TIPO_PROBLEMA}chave-em-uso`))).toBe(true);
      expect(new Set(criados.map((r) => r.corpo.id)).size).toBe(1);
      expect(rs.filter((r) => r.status === 201 && r.repetido === null)).toHaveLength(1);
      expect(await q(`select 1 from cupom where tenant_id = $1 and codigo = 'PARALELO5'`, [A.tenant])).toHaveLength(1);
    });

    it('o mesmo código criado ao mesmo tempo (outra chave, transação aberta) → 409 codigo-em-uso quando a outra confirma', async () => {
      const t = await emitir(A, A.lojas[0]);
      const c = await pool.connect();
      try {
        await c.query('begin');
        await c.query(`insert into cupom (tenant_id, unidade_id, codigo, tipo, valor) values ($1, $2, 'SIMULTANEO', 'valor', 1)`, [A.tenant, A.lojas[0]]);
        const pedidoHttp = post('/integracao/cupons', t, { ...CORPO, codigo: 'SIMULTANEO' }, 'simultaneo-1');
        await espera(400);
        await c.query('commit');
        const r = await pedidoHttp;
        expect(r.status).toBe(409);
        expect(r.corpo.type).toBe(`${BASE_TIPO_PROBLEMA}codigo-em-uso`);
      } finally {
        c.release();
      }
    });
  });

  // ───────────────────────────── desativar ─────────────────────────────

  describe('POST /cupons/{id}/desativar', () => {
    it('o cupom que o Liame criou: 200 ativo false, versão nova, DESCE para a loja (carimbo novo) e o checkout recusa', async () => {
      const t = await emitir(A, A.lojas[0]);
      const r0 = await post('/integracao/cupons', t, { ...CORPO, codigo: 'DESATIVA1' }, 'des-cria-1');
      expect(r0.status).toBe(201);
      const [antes] = await q(`select updated_at from cupom where id = $1`, [r0.corpo.id]);
      await espera(20);
      const r = await post(`/integracao/cupons/${r0.corpo.id}/desativar`, t, {}, 'des-1');
      expect(r.status).toBe(200);
      expect(errosCupomRegem(r.corpo)).toEqual([]);
      expect(r.corpo).toMatchObject({ id: r0.corpo.id, ativo: false, removido: false, codigo: 'DESATIVA1' });
      expect(r.corpo.versao).toBeGreaterThan(r0.corpo.versao);
      const [depois] = await q(`select ativo, updated_at from cupom where id = $1`, [r0.corpo.id]);
      expect(depois.ativo).toBe(false);
      expect(new Date(depois.updated_at).getTime()).toBeGreaterThan(new Date(antes.updated_at).getTime());
      expect(ultimas((await lerTudo(t)).itens).get(r0.corpo.id)).toEqual(r.corpo);
      expect(await cardapio.validarCupomPublico(ids.cardapioToken, 'DESATIVA1', 200)).toMatchObject({ valido: false, motivo: 'Cupom inválido.' });
      const log = registros.filter((e) => e.acao === 'integracao.cupom_desativado' && e.entidadeId === r0.corpo.id);
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ atorTipo: 'integracao', tenantId: A.tenant });
      // reenvio: a mesma resposta; já inativo com outra chave: 200 sem mudança (sem auditoria nova)
      const re = await post(`/integracao/cupons/${r0.corpo.id}/desativar`, t, {}, 'des-1');
      expect([re.status, re.repetido]).toEqual([200, 'true']);
      expect(re.corpo).toEqual(r.corpo);
      const ja = await post(`/integracao/cupons/${r0.corpo.id}/desativar`, t, {}, 'des-2');
      expect(ja.status).toBe(200);
      expect(ja.corpo).toEqual(r.corpo);
      expect(registros.filter((e) => e.acao === 'integracao.cupom_desativado' && e.entidadeId === r0.corpo.id)).toHaveLength(1);
      // a mesma chave para OUTRO cupom (outra rota) → 422
      const outro = await post(`/integracao/cupons/${ids.a1}/desativar`, t, {}, 'des-1');
      expect([outro.status, outro.corpo.type]).toEqual([422, `${BASE_TIPO_PROBLEMA}chave-reutilizada`]);
    });

    it('cupom da LOJA (criado na tela), de outra empresa, de outra loja, inexistente ou id inválido → 404 e nada muda', async () => {
      const t = await emitir(A, A.lojas[0]);
      const r0 = await post('/integracao/cupons', t, { ...CORPO, codigo: 'SOMENTEA1' }, 'a1-cria-404');
      const tA2b = await emitir(A, A.lojas[1]);
      for (const [id, tok] of [
        [ids.a1, t], // da loja: não foi a integração que criou
        [ids.b1, t], // de outra empresa
        [r0.corpo.id, tA2b], // criado pela integração na A1: a A2 não enxerga
        [randomUUID(), t],
        ['nao-e-uuid', t],
      ] as const) {
        const r = await post(`/integracao/cupons/${id}/desativar`, tok, {}, `n404-${randomUUID()}`);
        expect(r.status).toBe(404);
        expect(r.corpo.type).toBe(`${BASE_TIPO_PROBLEMA}nao-encontrado`);
      }
      expect((await q(`select ativo from cupom where id = any($1::uuid[])`, [[ids.a1, ids.b1, r0.corpo.id]])).map((x) => x.ativo)).toEqual([true, true, true]);
    });
  });

  // ───────────────────────────── licença ─────────────────────────────

  describe('licença nas escritas', () => {
    it('conta bloqueada → 403 conta-bloqueada na escrita nova (nada gravado, a chave não fica); o reenvio de uma escrita feita devolve a resposta; leitura segue', async () => {
      const L = await empresa('Empresa licenca', ['L1']);
      const t = await emitir(L, L.lojas[0]);
      const feito = await post('/integracao/cupons', t, { ...CORPO, codigo: 'ANTESDOBLOQUEIO' }, 'lic-1');
      expect(feito.status).toBe(201);
      await q(`update empresa set status = 'bloqueado' where id = $1`, [L.tenant]);
      (cupons as any).licencas.clear();
      try {
        const r = await post('/integracao/cupons', t, { ...CORPO, codigo: 'DEPOISDOBLOQUEIO' }, 'lic-2');
        expect(r.status).toBe(403);
        expect(r.corpo.type).toBe(`${BASE_TIPO_PROBLEMA}conta-bloqueada`);
        expect(await q(`select 1 from cupom where tenant_id = $1 and codigo = 'DEPOISDOBLOQUEIO'`, [L.tenant])).toEqual([]);
        expect(await q(`select 1 from integracao_idempotencia where tenant_id = $1 and chave = 'lic-2'`, [L.tenant])).toEqual([]);
        expect((await post(`/integracao/cupons/${feito.corpo.id}/desativar`, t, {}, 'lic-3')).status).toBe(403);
        const re = await post('/integracao/cupons', t, { ...CORPO, codigo: 'ANTESDOBLOQUEIO' }, 'lic-1');
        expect([re.status, re.repetido]).toEqual([201, 'true']);
        expect(re.corpo).toEqual(feito.corpo);
        expect((await chamar('/integracao/cupons', t)).status).toBe(200);
      } finally {
        await q(`update empresa set status = 'ativo' where id = $1`, [L.tenant]);
        (cupons as any).licencas.clear();
      }
      expect((await post('/integracao/cupons', t, { ...CORPO, codigo: 'DEPOISDOBLOQUEIO' }, 'lic-2')).status).toBe(201);
    });
  });

  // ───────────────────────────── carga, sync e robustez ─────────────────────────────

  describe('carga inicial e o cupom que desce para a loja', () => {
    it('empresa que conecta depois: todos os cupons e os usos de 91 dias; a carga não se repete', async () => {
      const E = await empresa('Empresa carga', ['E1']);
      const c1 = await cupom(E.tenant, { loja: E.lojas[0], codigo: 'ANTIGO1', validade: '2020-12-31' }); // vencido: entra
      const c2 = await cupom(E.tenant, { loja: null, codigo: 'ANTIGO2', tipo: 'valor', valor: 1 });
      const recente = await uso(E.tenant, c1, await pedido(E.tenant, { loja: E.lojas[0] }), new Date(Date.now() - 10 * 86_400_000).toISOString());
      const velho = await uso(E.tenant, c1, await pedido(E.tenant, { loja: E.lojas[0] }), new Date(Date.now() - 120 * 86_400_000).toISOString());
      expect(await q(`select 1 from integracao_mudanca where tenant_id = $1`, [E.tenant])).toEqual([]); // não conectada: nada
      const t = await emitir(E, E.lojas[0]);
      await carimbar([E.tenant]);
      expect([...ultimas((await lerTudo(t)).itens).keys()].sort()).toEqual([c1, c2].sort());
      expect(ultimas((await lerTudo(t)).itens).get(c1).usos).toBe(2); // a contagem é de todos os usos
      expect([...ultimas((await lerTudo(t, { rota: 'cupons/usos' })).itens).keys()]).toEqual([recente]);
      expect(velho).toBeTruthy();
      expect(await carimbador.fazerCargasCupons({ tenantIds: [E.tenant] })).toBe(0);
    });

    it('empresa carregada ANTES da 298 (só a carga das vendas feita) ganha a carga dos cupons sem repetir a das vendas', async () => {
      const E = await empresa('Empresa pre-298', ['E1']);
      const c = await cupom(E.tenant, { loja: E.lojas[0], codigo: 'PRE298' });
      // a carga das VENDAS já feita (depois do token) e nenhuma linha em integracao_carga_cupom
      await q(`insert into integracao_carga (tenant_id, feita_em) values ($1, now() + interval '1 minute')`, [E.tenant]);
      const t = await emitir(E, E.lojas[0]);
      expect(await carimbador.fazerCargas({ tenantIds: [E.tenant] })).toBe(0);
      await carimbar([E.tenant]);
      expect([...ultimas((await lerTudo(t)).itens).keys()]).toEqual([c]);
    });

    it('o cupom criado pela API DESCE para a loja pelo sync: está no pull, só com colunas que o servidor da loja tem', async () => {
      const t = await emitir(A, A.lojas[1]);
      const r0 = await post('/integracao/cupons', t, { ...CORPO, codigo: 'DESCEA2' }, 'desce-1');
      expect(r0.status).toBe(201);
      const sync = new SyncService(db);
      const colsLoja = new Set(
        (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'cupom'`)).map((x) => x.column_name),
      );
      for (const loja of A.lojas) {
        // o cupom é configuração: desce para os servidores das DUAS lojas (vale em todas — A8)
        const pull: any = await sync.pull(A.tenant, undefined, {}, loja);
        const linha = (pull.tabelas.cupom ?? []).find((x: any) => x.id === r0.corpo.id);
        expect(linha).toMatchObject({ codigo: 'DESCEA2', unidade_id: A.lojas[1], ativo: true, tipo: 'percentual' });
        for (const k of Object.keys(linha)) expect(colsLoja.has(k)).toBe(true);
      }
      // a desativação desce também: carimbo `updated_at` maior (a regra "mais nova vence" do servidor da loja)
      const antes: any = (await sync.pull(A.tenant, undefined, {}, A.lojas[1])).tabelas.cupom.find((x: any) => x.id === r0.corpo.id);
      await espera(20);
      expect((await post(`/integracao/cupons/${r0.corpo.id}/desativar`, t, {}, 'desce-2')).status).toBe(200);
      const depois: any = (await sync.pull(A.tenant, undefined, {}, A.lojas[1])).tabelas.cupom.find((x: any) => x.id === r0.corpo.id);
      expect(depois.ativo).toBe(false);
      expect(new Date(depois.updated_at).getTime()).toBeGreaterThan(new Date(antes.updated_at).getTime());
    });
  });

  describe('robustez: o gatilho nunca derruba o cupom nem o pedido', () => {
    it('sem a fila (tabela sumiu), cupom e uso gravam assim mesmo — só não ganham versão', async () => {
      await pool.query(`alter table ${SCHEMA}.integracao_mudanca rename to integracao_mudanca_fora`);
      try {
        const [antes] = await q(`select count(*)::int n from ${SCHEMA}.integracao_mudanca_fora`);
        const c = await cupom(A.tenant, { loja: A.lojas[0], codigo: 'SEMFILA1' });
        await q(`update cupom set valor = 11 where id = $1`, [c]);
        const u = await uso(A.tenant, c, null);
        await q(`delete from cupom_uso where id = $1`, [u]);
        await q(`delete from cupom where id = $1`, [c]);
        const [depois] = await q(`select count(*)::int n from ${SCHEMA}.integracao_mudanca_fora`);
        expect(depois.n).toBe(antes.n);
      } finally {
        await pool.query(`alter table ${SCHEMA}.integracao_mudanca_fora rename to integracao_mudanca`);
      }
    });

    it('empresa não conectada: o gatilho não anota nada', async () => {
      const N = await empresa('Empresa N', ['N1']);
      const c = await cupom(N.tenant, { loja: N.lojas[0], codigo: 'NCONECTA' });
      await uso(N.tenant, c, null);
      await q(`update cupom set ativo = false where id = $1`, [c]);
      await q(`delete from cupom where id = $1`, [c]);
      expect(await q(`select 1 from integracao_mudanca where tenant_id = $1`, [N.tenant])).toEqual([]);
    });
  });

  it('servidor da loja (EDGE_MODE=true): as quatro rotas não existem (404) e o carimbador não roda', async () => {
    process.env.EDGE_MODE = 'true';
    const edge = await subir();
    try {
      for (const [metodo, rota] of [
        ['GET', 'cupons'],
        ['GET', 'cupons/usos'],
        ['POST', 'cupons'],
        ['POST', `cupons/${ids.a1}/desativar`],
      ]) {
        const r = await fetch(`${edge.base}/integracao/${rota}`, {
          method: metodo,
          headers: { authorization: `Bearer ${tA1}`, 'content-type': 'application/json', 'idempotency-key': `edge-${randomUUID()}` },
          ...(metodo === 'POST' ? { body: JSON.stringify({ ...CORPO, codigo: 'NOEDGE' }) } : {}),
        });
        expect(r.status).toBe(404);
        expect(((await r.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}nao-encontrado`);
      }
      expect(await q(`select 1 from cupom where codigo = 'NOEDGE'`)).toEqual([]);
      const antes = await q(`select count(*)::int n from integracao_mudanca`);
      await edge.app.get(CarimbadorIntegracaoService).tick();
      expect(await q(`select count(*)::int n from integracao_mudanca`)).toEqual(antes);
    } finally {
      await edge.app.close();
      delete process.env.EDGE_MODE;
    }
  });

  it('o banco e a auditoria não guardam token nenhum', async () => {
    expect(emitidos.length).toBeGreaterThan(10);
    const linhas = await q(`select row_to_json(i)::text as j from integracao_idempotencia i`);
    const marcas = await q(`select row_to_json(m)::text as j from integracao_cupom m`);
    const tudo = [...linhas.map((x) => x.j), ...marcas.map((x) => x.j), ...registros.map((e) => JSON.stringify(e))].join('\n');
    for (const t of emitidos) {
      expect(tudo).not.toContain(t);
      expect(tudo).not.toContain(t.slice(12));
    }
  });
});
