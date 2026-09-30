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
import { CfThrottlerGuard } from '../../common/cf-throttler.guard';
import { CloudOnlyGuard } from '../../common/cloud-only.guard';
import { DashboardService } from '../dashboard/dashboard.service';
import { ProdutoService } from '../produto/produto.service';
import { FichasService } from '../fichas/fichas.service';
import { EdgeFlashSyncService } from '../sync/edge-flash-sync.service';
import { SyncService } from '../sync/sync.service';
import { IntegracaoApiModule } from './integracao-api.module';
import { IntegracaoTokenService } from './integracao-token.service';
import { VendasIntegracaoService } from './vendas-integracao.service';
import { CarimbadorIntegracaoService } from './carimbador-integracao.service';
import { BASE_TIPO_PROBLEMA } from './problema';
import { errosClienteAnonimizado, errosPagina, errosPedidoRegem } from './contrato-liame.teste-spec';
import { gravarOrigemPedido, medicaoDeAnuncios } from '../cardapio/origem-pedido';
import { OrigemPedidoService } from '../cardapio/origem-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// LEITURA DE VENDAS DA API DE INTEGRAÇÃO (trilha C, C1c — PR2), contra o Postgres real e por HTTP
// (Nest com os guards globais de produção: limite por IP e CloudOnly).
//
// O banco do CI é montado como servidor de loja (EDGE_MODE=true): as migrations só da nuvem (295,
// 296, 297) não existem nele. Elas sobem de verdade num schema só deste teste, na frente do
// `public` — e, como a 296 põe gatilhos em pedido_externo/comanda/comanda_item/cliente, essas
// quatro tabelas também são COPIADAS para o schema (`like … including all`, sem chave
// estrangeira): os gatilhos vivem só nas cópias, e as outras specs, que rodam ao mesmo tempo no
// mesmo banco, nunca os disparam. Sem FK para tabela compartilhada (LIC-088/ERR-109). O Painel
// (`DashboardService`, o de verdade) lê as mesmas cópias pelo `search_path`.
// O carimbador roda SÓ nas empresas desta spec (V32/LIC-084).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('integracao-vendas.http.spec: sem TEST_PG_URL — PULADO');
// Conferência extra, só local: grava cada página lida (JSON por linha) para validar com o zod do
// próprio Liame (o backend não tem zod).
const DUMP = process.env.INTEGRACAO_DUMP_RESPOSTAS;

jest.setTimeout(120_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGS, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');
const FONTES = ['pedido_externo', 'comanda', 'comanda_item', 'cliente'];

/** Instante de Brasília (sem horário de verão desde 2019) em ISO com o fuso. */
const sp = (dia: string, hora: string) => `${dia}T${hora}:00-03:00`;
const diaSP = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const DIA1 = '2026-09-20';
const DIA2 = '2026-09-21';

descrever('API de integração — vendas (GET /pedidos e /clientes/anonimizados)', () => {
  const SCHEMA = `teste_integracao_vendas_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 6 });
  const db = drizzle(pool) as any;
  const registros: any[] = [];
  const auditoria = { registrar: async (e: any) => void registros.push(e) } as unknown as AuditoriaService;
  const tokensSvc = new IntegracaoTokenService(db, auditoria);
  const produtoSvc = new ProdutoService(db, auditoria, new EdgeFlashSyncService(db), new FichasService(db));
  const painel = new DashboardService(db);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const edgeOriginal = process.env.EDGE_MODE;
  let app: INestApplication;
  let base = '';
  let vendas: VendasIntegracaoService;
  let carimbador: CarimbadorIntegracaoService;

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
    const [p] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, $2, $3) returning id`, [
      e.id,
      `Presidente ${nome}`,
      f.id,
    ]);
    return { tenant: e.id as string, lojas: ids, presidente: p.id as string };
  }

  async function emitir(emp: { tenant: string; presidente: string }, loja: string, escopos: string[]) {
    const r = await tokensSvc.emitir(
      { tenantId: emp.tenant, unidadeId: loja, autorizadoPor: emp.presidente, escopos, evidencia: 'autorização por escrito (teste)' },
      dist,
    );
    return r.token;
  }

  type Item = { desc: string; qtd: number | string; preco: number; produto?: string | null };

  async function comanda(
    tenant: string,
    o: {
      loja: string | null;
      status?: string;
      aberta?: string;
      fechada?: string | null;
      cancelada?: string | null;
      total: number;
      taxa?: number;
      mesa?: boolean;
      totemChave?: string | null;
      operador?: string | null;
      itens?: Item[];
    },
  ) {
    const [c] = await q(
      `insert into comanda (tenant_id, unidade_id, status, aberta_em, fechada_em, cancelada_em, total, taxa_servico_pct,
                            mesa_id, idempotency_key, aberta_por_id)
       values ($1, $2, $3, $4::timestamptz, $5::timestamptz, $6::timestamptz, $7, $8, $9, $10, $11) returning id`,
      [
        tenant,
        o.loja,
        o.status ?? 'fechada',
        o.aberta ?? o.fechada ?? new Date().toISOString(),
        o.fechada === undefined ? new Date().toISOString() : o.fechada,
        o.cancelada ?? null,
        String(o.total),
        String(o.taxa ?? 0),
        o.mesa ? randomUUID() : null,
        o.totemChave ?? null,
        o.operador === undefined ? randomUUID() : o.operador,
      ],
    );
    for (const it of o.itens ?? []) {
      await q(
        `insert into comanda_item (tenant_id, comanda_id, produto_id, descricao, quantidade, preco_unitario)
         values ($1, $2, $3, $4, $5, $6)`,
        [tenant, c.id, it.produto ?? null, it.desc, String(it.qtd), String(it.preco)],
      );
    }
    return c.id as string;
  }

  async function pedido(
    tenant: string,
    o: {
      loja: string | null;
      canal: string;
      status?: string;
      criado: string;
      confirmado?: string | null;
      cancelado?: string | null;
      bruto?: number | null;
      total: number;
      descontos?: any[] | null;
      descontoLoja?: number;
      taxaEntrega?: number;
      dono?: string | null;
      extras?: any[] | null;
      cupom?: string | null;
      cliente?: string | null;
      comanda?: string | null;
      itens?: any[];
    },
  ) {
    const [p] = await q(
      `insert into pedido_externo (tenant_id, unidade_id, canal, status, criado_em, confirmado_em, cancelado_em, valor_bruto,
                                   total, descontos, desconto_loja, taxa_entrega, taxa_entrega_dono, taxas_extras_detalhe,
                                   cupom, cliente_id, comanda_id, itens, external_id)
       values ($1, $2, $3, $4, $5::timestamptz, $6::timestamptz, $7::timestamptz, $8, $9, $10::jsonb, $11, $12, $13, $14::jsonb,
               $15, $16, $17, $18::jsonb, $19) returning id`,
      [
        tenant,
        o.loja,
        o.canal,
        o.status ?? 'confirmado',
        o.criado,
        o.confirmado === undefined ? o.criado : o.confirmado,
        o.cancelado ?? null,
        o.bruto === undefined ? null : o.bruto === null ? null : String(o.bruto),
        String(o.total),
        o.descontos ? JSON.stringify(o.descontos) : null,
        String(o.descontoLoja ?? 0),
        String(o.taxaEntrega ?? 0),
        o.dono ?? null,
        o.extras ? JSON.stringify(o.extras) : null,
        o.cupom ?? null,
        o.cliente ?? null,
        o.comanda ?? null,
        JSON.stringify(o.itens ?? []),
        `ext-${randomUUID()}`,
      ],
    );
    return p.id as string;
  }

  async function cliente(tenant: string, telefone: string | null, extra: any = {}) {
    const [c] = await q(`insert into cliente (tenant_id, nome, telefone, importacao) values ($1, 'Cliente Teste', $2, $3::jsonb) returning id`, [
      tenant,
      telefone,
      extra.importacao ? JSON.stringify(extra.importacao) : null,
    ]);
    return c.id as string;
  }

  /** Roda o carimbador nas empresas dadas, com a espera da comanda "vencida" (10 min). */
  async function carimbar(tenants: string[]) {
    const amadurecer = () =>
      q(
        `update integracao_versao set mudou_em = mudou_em - interval '11 minutes'
          where fonte = 'comanda' and pendente and tenant_id = any($1::uuid[])`,
        [tenants],
      );
    await carimbador.ciclo({ tenantIds: tenants }, 30_000);
    await amadurecer();
    await carimbador.ciclo({ tenantIds: tenants }, 30_000);
  }

  /** Lê a rota inteira, página a página, validando cada página contra o contrato do Liame. */
  async function lerTudo(token: string, o: { rota?: string; limite?: number; primeira?: string; cursor?: string | null } = {}) {
    const rota = o.rota ?? 'pedidos';
    const validar = rota === 'pedidos' ? errosPedidoRegem : errosClienteAnonimizado;
    let cursor: string | null = o.cursor ?? null;
    const itens: any[] = [];
    let paginas = 0;
    for (;;) {
      const qs = `limite=${o.limite ?? 500}${cursor ? `&cursor=${cursor}` : (o.primeira ?? '')}`;
      const r = await chamar(`/integracao/${rota}?${qs}`, token);
      expect(r.status).toBe(200);
      const pg: any = await r.json();
      expect(errosPagina(pg, validar)).toEqual([]);
      if (DUMP) appendFileSync(DUMP, `${JSON.stringify({ rota, pagina: pg })}\n`);
      itens.push(...pg.itens);
      cursor = pg.proximo_cursor;
      paginas++;
      if (!pg.tem_mais) break;
    }
    return { itens, cursor, paginas };
  }

  const receitaPorDia = (itens: any[]) => {
    const m = new Map<string, number>();
    for (const v of itens) {
      if (v.situacao !== 'confirmado') continue;
      const d = diaSP(v.faturado_em);
      m.set(d, (m.get(d) ?? 0) + v.receita_centavos);
    }
    return m;
  };

  /** A última versão de cada venda (a lista pode ter a mesma venda em versões diferentes). */
  const ultimas = (itens: any[]) => {
    const m = new Map<string, any>();
    for (const v of itens) if (!m.has(v.id) || m.get(v.id).versao < v.versao) m.set(v.id, v);
    return m;
  };

  // ───────────────────────────── cenário principal ─────────────────────────────

  let A: Awaited<ReturnType<typeof empresa>>; // 2 lojas (filtro estrito por loja)
  let B: Awaited<ReturnType<typeof empresa>>; // outra empresa
  let D: Awaited<ReturnType<typeof empresa>>; // loja única, cardápio da rede (pedido sem loja)
  let tA1 = ''; // pedidos.ler + clientes.anonimizacao.ler (sem telefone, sem custo)
  let tA2 = '';
  let tB1 = '';
  let tD1 = '';
  const ids: Record<string, string> = {};
  let produtoBurger = '';

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a API é da NUVEM
    await pool.query(`create schema ${SCHEMA}`);
    for (const t of FONTES) await pool.query(`create table ${SCHEMA}.${t} (like public.${t} including all)`);
    await pool.query(semFkCompartilhada(mig('295_integracao_token_loja.sql')));
    await pool.query(mig('296_integracao_versao_vendas.sql'));
    await pool.query(mig('297_pedido_externo_comanda_idx.sql'));
    const conf299 = (await pool.query(mig('299_pedido_origem.sql')) as any) as any[];
    const linhas299 = conf299[conf299.length - 1].rows;
    if (linhas299.some((l: any) => !l.ok)) throw new Error(`conferência da 299: ${JSON.stringify(linhas299)}`);
    const [fk] = await q(
      `select count(*)::int n from pg_constraint c join pg_namespace s on s.oid = c.connamespace
        where s.nspname = $1 and c.contype = 'f'`,
      [SCHEMA],
    );
    if (fk.n) throw new Error('o schema do teste não pode ter chave estrangeira (LIC-088)');
    const onde = await q(
      `select c.relname, s.nspname from pg_class c join pg_namespace s on s.oid = c.relnamespace
        where c.oid in (to_regclass('pedido_externo'), to_regclass('comanda'), to_regclass('comanda_item'),
                        to_regclass('cliente'), to_regclass('integracao_versao'))`,
    );
    if (onde.length !== 5 || onde.some((x) => x.nspname !== SCHEMA)) {
      throw new Error(`as tabelas do teste não estão na frente do public: ${JSON.stringify(onde)}`);
    }
    const [gat] = await q(
      `select count(*)::int n from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace s on s.oid = c.relnamespace
        where g.tgname like 'trg_integracao_%' and s.nspname = 'public'`,
    );
    if (gat.n) throw new Error('a 296 não pode ter posto gatilho nas tabelas compartilhadas');

    ({ app, base } = await subir());
    vendas = app.get(VendasIntegracaoService);
    carimbador = app.get(CarimbadorIntegracaoService);
    vendas.atrasoSeg = 0; // o atraso de 15 s tem teste próprio

    A = await empresa('Empresa A', ['A1 matriz', 'A2 filial']);
    B = await empresa('Empresa B', ['B1']);
    D = await empresa('Empresa D', ['D1 única']);
    tA1 = await emitir(A, A.lojas[0], ['pedidos.ler', 'clientes.anonimizacao.ler']);
    tA2 = await emitir(A, A.lojas[1], ['pedidos.ler']);
    tB1 = await emitir(B, B.lojas[0], ['pedidos.ler']);
    tD1 = await emitir(D, D.lojas[0], ['pedidos.ler', 'clientes.anonimizacao.ler']);

    const [prod] = await q(`insert into produto (tenant_id, nome, preco_venda, preco_custo) values ($1, 'Burger', 25, 8.25) returning id`, [
      A.tenant,
    ]);
    produtoBurger = prod.id;
    const [a1, a2] = A.lojas;

    // ── A1, dia 1 ──
    // balcão com taxa de serviço de 10%: total 110 → faturamento 100 (a gorjeta não entra)
    ids.balcao = await comanda(A.tenant, {
      loja: a1,
      fechada: sp(DIA1, '12:00'),
      total: 110,
      taxa: 10,
      itens: [{ desc: 'Burger', qtd: 2, preco: 25, produto: produtoBurger }, { desc: 'Suco', qtd: 1, preco: 50 }],
    });
    // mesa
    ids.mesa = await comanda(A.tenant, { loja: a1, fechada: sp(DIA1, '13:00'), total: 55.5, mesa: true, itens: [{ desc: 'Prato', qtd: 1, preco: 55.5 }] });
    // totem direto (chave do aparelho, sem operador)
    ids.totem = await comanda(A.tenant, {
      loja: a1,
      fechada: sp(DIA1, '14:00'),
      total: 30,
      totemChave: `totem-${randomUUID()}`,
      operador: null,
      itens: [{ desc: 'Combo', qtd: 1, preco: 30 }],
    });
    // cardápio com cupom (desconto da loja) e frete da loja, já materializado numa comanda
    const cmdCardapio = await comanda(A.tenant, {
      loja: a1,
      fechada: sp(DIA1, '19:00'),
      total: 61,
      itens: [{ desc: 'Burger', qtd: 2, preco: 25, produto: produtoBurger }, { desc: 'Batata', qtd: 1, preco: 10 }],
    });
    ids.cardapio = await pedido(A.tenant, {
      loja: a1,
      canal: 'cardapio',
      criado: sp(DIA1, '18:55'),
      confirmado: sp(DIA1, '19:00'),
      bruto: 60,
      total: 61,
      descontos: [{ origem: 'cupom', rotulo: 'COMBOSEXTA', valor: 6, alvo: 'ITEM', quemBanca: 'loja' }],
      taxaEntrega: 7,
      dono: 'loja',
      cupom: 'COMBOSEXTA',
      comanda: cmdCardapio,
    });
    ids.cmdCardapio = cmdCardapio;
    // iFood: desconto do marketplace + gorjeta TIP + frete do terceiro → faturamento = 80
    const cmdIfood = await comanda(A.tenant, { loja: a1, fechada: sp(DIA1, '20:00'), total: 80, itens: [{ desc: 'Combo duplo', qtd: 1, preco: 80 }] });
    ids.ifood = await pedido(A.tenant, {
      loja: a1,
      canal: 'ifood',
      criado: sp(DIA1, '20:00'),
      bruto: 80,
      total: 83,
      descontos: [{ origem: 'marketplace', valor: 10, alvo: 'ITEM', quemBanca: 'marketplace' }],
      taxaEntrega: 8,
      dono: 'marketplace',
      extras: [{ tipo: 'TIP', rotulo: 'Gorjeta', valor: 5 }],
      comanda: cmdIfood,
    });
    // 99: desconto de FRETE da loja (não reduz produto) e frete da loja → 40 + 5 = 45
    ids.food99 = await pedido(A.tenant, {
      loja: a1,
      canal: '99food',
      criado: sp(DIA1, '21:00'),
      bruto: 40,
      total: 42,
      descontos: [{ origem: 'loja', valor: 3, alvo: 'DELIVERY_FEE', quemBanca: 'loja' }],
      taxaEntrega: 5,
      dono: 'loja',
      itens: [{ descricao: 'Pizza', quantidade: 1, precoUnitario: 40 }],
    });
    // cancelado depois de confirmado (comanda estornada)
    const cmdCancelada = await comanda(A.tenant, {
      loja: a1,
      status: 'cancelada',
      fechada: sp(DIA1, '21:30'),
      cancelada: sp(DIA1, '21:40'),
      total: 33,
      itens: [{ desc: 'Burger', qtd: 1, preco: 33 }],
    });
    ids.canceladoConfirmado = await pedido(A.tenant, {
      loja: a1,
      canal: 'cardapio',
      status: 'cancelado',
      criado: sp(DIA1, '21:30'),
      confirmado: sp(DIA1, '21:31'),
      cancelado: sp(DIA1, '21:40'),
      bruto: 33,
      total: 33,
      comanda: cmdCancelada,
    });
    // novo, nunca confirmado
    ids.novo = await pedido(A.tenant, { loja: a1, canal: 'ifood', status: 'novo', criado: sp(DIA1, '22:00'), confirmado: null, bruto: 50, total: 50 });
    // cancelado pelo canal com a comanda ainda FECHADA (A18): o Painel decide; a API espelha
    const cmdA18 = await comanda(A.tenant, { loja: a1, fechada: sp(DIA1, '22:10'), total: 12, itens: [{ desc: 'Refri', qtd: 2, preco: 6 }] });
    ids.a18 = await pedido(A.tenant, {
      loja: a1,
      canal: 'anotaai',
      status: 'cancelado',
      criado: sp(DIA1, '22:05'),
      confirmado: sp(DIA1, '22:06'),
      cancelado: sp(DIA1, '22:30'),
      bruto: 12,
      total: 12,
      comanda: cmdA18,
    });
    ids.cmdA18 = cmdA18;
    // venda às 23:30 de Brasília (02:30 UTC do dia seguinte): é do DIA 1 no Painel
    ids.tarde = await comanda(A.tenant, { loja: a1, fechada: sp(DIA1, '23:30'), total: 19.9, itens: [{ desc: 'Água', qtd: 2, preco: 9.95 }] });

    // ── A1, dia 2 ──
    ids.dia2 = await pedido(A.tenant, {
      loja: a1,
      canal: 'cardapio',
      criado: sp(DIA2, '10:00'),
      bruto: 25.9,
      total: 25.9,
      itens: [{ descricao: 'Milkshake', quantidade: 1, precoUnitario: 25.9, produtoId: 'produto-do-cardapio' }],
    });

    // ── A2 (outra loja da mesma empresa) e pedido SEM loja da empresa de 2 lojas ──
    ids.a2 = await comanda(A.tenant, { loja: a2, fechada: sp(DIA1, '12:30'), total: 44, itens: [{ desc: 'Pastel', qtd: 4, preco: 11 }] });
    ids.aSemLoja = await pedido(A.tenant, { loja: null, canal: 'cardapio', criado: sp(DIA1, '12:40'), bruto: 18, total: 18 });

    // ── B ──
    ids.b1 = await comanda(B.tenant, { loja: B.lojas[0], fechada: sp(DIA1, '12:00'), total: 99, itens: [{ desc: 'Outro', qtd: 1, preco: 99 }] });

    // ── D: loja única com cardápio da REDE (pedido sem loja) ──
    ids.dRede = await pedido(D.tenant, {
      loja: null,
      canal: 'cardapio',
      criado: sp(DIA1, '19:00'),
      bruto: 37.5,
      total: 42.5,
      taxaEntrega: 5,
      dono: 'loja',
      itens: [{ descricao: 'Açaí', quantidade: 1, precoUnitario: 37.5 }],
    });
    ids.dLoja = await comanda(D.tenant, { loja: D.lojas[0], fechada: sp(DIA1, '15:00'), total: 20, itens: [{ desc: 'Café', qtd: 4, preco: 5 }] });

    await carimbar([A.tenant, B.tenant, D.tenant]);
  });

  afterAll(async () => {
    await app?.close();
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    if (empresas.length) {
      await pool.query('delete from produto where tenant_id = any($1::uuid[])', [empresas]);
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    }
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  }, 120_000);

  // ───────────────────────────── faturamento = Painel ─────────────────────────────

  describe('receita = "Faturamento" do Painel, ao centavo (critério A2.5-2)', () => {
    it('loja de empresa com 2 lojas: soma por dia (faturado_em, fuso da loja) = Painel da loja', async () => {
      const { itens } = await lerTudo(tA1);
      const soma = receitaPorDia([...ultimas(itens).values()]);
      for (const dia of [DIA1, DIA2]) {
        const r = await painel.resumo(A.tenant, dia, true, A.lojas[0]);
        expect({ dia, api: soma.get(dia) ?? 0 }).toEqual({ dia, api: Math.round(r.comercial.faturado * 100) });
      }
      // valores conferidos à mão (definição única): balcão 100 + mesa 55,50 + totem 30 +
      // cardápio 61 + iFood 80 + 99 45 + 19,90 às 23:30 (dia 1) — e a comanda do pedido que o canal
      // cancelou entra como balcão ENQUANTO a regra do Painel disser isso (A18; muda com o #585).
      const esperadoSemA18 = 10000 + 5550 + 3000 + 6100 + 8000 + 4500 + 1990;
      expect([esperadoSemA18, esperadoSemA18 + 1200]).toContain(soma.get(DIA1));
      expect(soma.get(DIA2)).toBe(2590);
    });

    it('a outra loja e a empresa de loja única (com o pedido do cardápio da rede, sem loja) também batem', async () => {
      const a2 = await lerTudo(tA2);
      const d1 = await lerTudo(tD1);
      const pA2 = await painel.resumo(A.tenant, DIA1, true, A.lojas[1]);
      const pD = await painel.resumo(D.tenant, DIA1, true, null); // loja única: o Painel não filtra loja
      expect(receitaPorDia(a2.itens).get(DIA1)).toBe(Math.round(pA2.comercial.faturado * 100));
      expect(receitaPorDia(d1.itens).get(DIA1)).toBe(Math.round(pD.comercial.faturado * 100));
      expect(receitaPorDia(d1.itens).get(DIA1)).toBe(4250 + 2000);
    });

    it('cada campo como o contrato pede: canal, grupo, desconto da loja, cupom, estorno 0, datas', async () => {
      const m = ultimas((await lerTudo(tA1)).itens);
      expect(m.get(ids.balcao)).toMatchObject({ canal: 'balcao', grupo_canal: 'presencial', situacao: 'confirmado', receita_centavos: 10000 });
      expect(m.get(ids.mesa)).toMatchObject({ canal: 'mesa', grupo_canal: 'presencial', receita_centavos: 5550 });
      expect(m.get(ids.totem)).toMatchObject({ canal: 'totem', grupo_canal: 'presencial', receita_centavos: 3000 });
      expect(m.get(ids.cardapio)).toMatchObject({
        canal: 'cardapio',
        grupo_canal: 'cardapio',
        receita_centavos: 6100,
        desconto_loja_centavos: 600,
        estornado_centavos: 0,
        cupom: 'COMBOSEXTA',
        moeda: 'BRL',
        fuso: 'America/Sao_Paulo',
        cliente: null,
        origem: null,
        cancelado_em: null,
      });
      expect(m.get(ids.ifood)).toMatchObject({ canal: 'ifood', grupo_canal: 'marketplace', receita_centavos: 8000, desconto_loja_centavos: 0 });
      expect(m.get(ids.food99)).toMatchObject({ canal: '99food', grupo_canal: 'marketplace', receita_centavos: 4500 });
      // faturado_em: pedido = criação; comanda = fechamento (o que o Painel usa)
      expect(new Date(m.get(ids.cardapio).faturado_em).getTime()).toBe(new Date(sp(DIA1, '18:55')).getTime());
      expect(new Date(m.get(ids.cardapio).confirmado_em).getTime()).toBe(new Date(sp(DIA1, '19:00')).getTime());
      expect(new Date(m.get(ids.tarde).faturado_em).getTime()).toBe(new Date(sp(DIA1, '23:30')).getTime());
      expect(diaSP(m.get(ids.tarde).faturado_em)).toBe(DIA1);
      // itens: os da comanda do pedido; sem comanda, os do pedido (id "pedido:<posição>")
      expect(m.get(ids.cardapio).itens.map((i: any) => [i.nome, i.quantidade, i.receita_centavos])).toEqual([
        ['Burger', '2', 5000],
        ['Batata', '1', 1000],
      ]);
      expect(m.get(ids.food99).itens).toEqual([
        { id: 'pedido:0', produto_id: null, nome: 'Pizza', quantidade: '1', receita_centavos: 4000, custo_centavos: null },
      ]);
      // centavos inteiros em tudo
      for (const v of m.values()) {
        expect(Number.isInteger(v.receita_centavos) && Number.isInteger(v.desconto_loja_centavos)).toBe(true);
        for (const it of v.itens) expect(Number.isInteger(it.receita_centavos)).toBe(true);
      }
    });
  });

  // ───────────────────────────── a mesma venda uma vez só ─────────────────────────────

  describe('a mesma venda aparece uma vez só', () => {
    it('pedido com comanda = UMA venda (a do pedido); novo e cancelado sem confirmar não saem', async () => {
      const m = ultimas((await lerTudo(tA1)).itens);
      expect(m.has(ids.cardapio)).toBe(true);
      expect(m.has(ids.cmdCardapio)).toBe(false); // a comanda do pedido que vale não é venda à parte
      expect(m.has(ids.novo)).toBe(false);
      expect(m.get(ids.canceladoConfirmado)).toMatchObject({ situacao: 'cancelado', estornado_centavos: 0 });
      expect(m.get(ids.canceladoConfirmado).cancelado_em).toBeTruthy();
      expect(m.get(ids.a18)).toMatchObject({ situacao: 'cancelado' });
      // A comanda do A18 segue a regra do Painel (`comandaEhDeCanal`): hoje ela é balcão; com o
      // #585 deixa de ser. As duas formas batem com o Painel (teste acima).
      const pA = await painel.resumo(A.tenant, DIA1, true, A.lojas[0]);
      expect(m.has(ids.cmdA18)).toBe(Math.round(pA.comercial.faturado * 100) > 10000 + 5550 + 3000 + 6100 + 8000 + 4500 + 1990);
    });

    it('comanda publicada que depois vira parte de um pedido sai de novo como `removido`', async () => {
      const cmd = await comanda(A.tenant, { loja: A.lojas[0], fechada: sp(DIA1, '16:00'), total: 21, itens: [{ desc: 'Salgado', qtd: 3, preco: 7 }] });
      await carimbar([A.tenant]);
      const antes = ultimas((await lerTudo(tA1)).itens).get(cmd);
      expect(antes).toMatchObject({ situacao: 'confirmado', canal: 'balcao' });
      const ped = await pedido(A.tenant, { loja: A.lojas[0], canal: 'cardapio_web', criado: sp(DIA1, '15:58'), bruto: 21, total: 21, comanda: cmd });
      await carimbar([A.tenant]);
      const m = ultimas((await lerTudo(tA1)).itens);
      expect(m.get(cmd)).toMatchObject({ situacao: 'removido', canal: 'balcao', cancelado_em: null });
      expect(m.get(cmd).versao).toBeGreaterThan(antes.versao);
      expect(m.get(ped)).toMatchObject({ situacao: 'confirmado', canal: 'cardapio_web', grupo_canal: 'outro', receita_centavos: 2100 });
      expect(m.get(ped).itens.map((i: any) => i.nome)).toEqual(['Salgado']);
      // e o dia continua batendo com o Painel (a comanda saiu do balcão, o pedido entrou)
      const pA = await painel.resumo(A.tenant, DIA1, true, A.lojas[0]);
      expect(receitaPorDia([...m.values()]).get(DIA1)).toBe(Math.round(pA.comercial.faturado * 100));
    });

    it('venda apagada depois de publicada sai como `removido` (da foto guardada)', async () => {
      const cmd = await comanda(A.tenant, { loja: A.lojas[0], fechada: sp(DIA2, '11:00'), total: 5, itens: [{ desc: 'Bala', qtd: 5, preco: 1 }] });
      await carimbar([A.tenant]);
      await q(`delete from comanda where id = $1`, [cmd]);
      await carimbar([A.tenant]);
      const v = ultimas((await lerTudo(tA1)).itens).get(cmd);
      expect(v).toMatchObject({ situacao: 'removido', receita_centavos: 500, canal: 'balcao' });
      expect(v.itens.map((i: any) => i.nome)).toEqual(['Bala']);
    });
  });

  // ───────────────────────────── cancelamento, voltar, versão ─────────────────────────────

  describe('versão: cresce a cada mudança que importa, e só nela', () => {
    it('confirmado → cancelado → voltar pedido: três versões, cancelado_em só no cancelado', async () => {
      const ped = await pedido(A.tenant, { loja: A.lojas[0], canal: 'cardapio', criado: sp(DIA2, '12:00'), bruto: 30, total: 30 });
      await carimbar([A.tenant]);
      const v1 = ultimas((await lerTudo(tA1)).itens).get(ped);
      await q(`update pedido_externo set status = 'cancelado', cancelado_em = $2 where id = $1`, [ped, sp(DIA2, '12:30')]);
      await carimbar([A.tenant]);
      const v2 = ultimas((await lerTudo(tA1)).itens).get(ped);
      await q(`update pedido_externo set status = 'confirmado', cancelado_em = null where id = $1`, [ped]);
      await carimbar([A.tenant]);
      const v3 = ultimas((await lerTudo(tA1)).itens).get(ped);
      expect([v1.situacao, v2.situacao, v3.situacao]).toEqual(['confirmado', 'cancelado', 'confirmado']);
      expect(v1.versao).toBeLessThan(v2.versao);
      expect(v2.versao).toBeLessThan(v3.versao);
      expect(v2.cancelado_em).toBeTruthy();
      expect(v3.cancelado_em).toBeNull();
      expect(v2.estornado_centavos).toBe(0);
    });

    it('comanda fechada e depois cancelada → `cancelado`; mudança de entregador/rastreio não gera versão', async () => {
      const cmd = await comanda(A.tenant, { loja: A.lojas[0], fechada: sp(DIA2, '13:00'), total: 15, itens: [{ desc: 'X', qtd: 1, preco: 15 }] });
      const ped = await pedido(A.tenant, { loja: A.lojas[0], canal: 'ifood', criado: sp(DIA2, '13:05'), bruto: 22, total: 22 });
      await carimbar([A.tenant]);
      const antes = ultimas((await lerTudo(tA1)).itens);
      await q(`update comanda set status = 'cancelada', cancelada_em = $2 where id = $1`, [cmd, sp(DIA2, '13:10')]);
      await q(`update pedido_externo set entregador_nome = 'Fulano', entregador_telefone = '21988887777' where id = $1`, [ped]);
      const fila = await q(`select recurso, recurso_id::text from integracao_mudanca where recurso_id = any($1::uuid[])`, [[cmd, ped]]);
      expect(fila.map((f) => f.recurso_id)).toEqual([cmd]); // o pedido não entrou na fila
      await carimbar([A.tenant]);
      const depois = ultimas((await lerTudo(tA1)).itens);
      expect(depois.get(cmd)).toMatchObject({ situacao: 'cancelado' });
      expect(depois.get(cmd).versao).toBeGreaterThan(antes.get(cmd).versao);
      expect(depois.get(ped).versao).toBe(antes.get(ped).versao);
    });

    it('linha que chega pelo PUSH do sync (regem.sync = on) também ganha versão', async () => {
      const sync = new SyncService(db);
      const id = randomUUID();
      const agora = new Date().toISOString();
      const r = await sync.push({ tenantId: A.tenant, unidadeId: A.lojas[0], equipamentoId: randomUUID(), token: 'x' }, [
        {
          tabela: 'pedido_externo',
          linhas: [
            {
              id,
              unidade_id: A.lojas[0],
              canal: 'totem',
              status: 'confirmado',
              criado_em: sp(DIA2, '14:00'),
              confirmado_em: sp(DIA2, '14:00'),
              valor_bruto: 17,
              total: 17,
              itens: [{ descricao: 'Combo totem', quantidade: 1, precoUnitario: 17 }],
              updated_at: agora,
            },
          ],
        },
      ]);
      expect(r.resultado.pedido_externo.aplicadas).toBe(1);
      await carimbar([A.tenant]);
      expect(ultimas((await lerTudo(tA1)).itens).get(id)).toMatchObject({ canal: 'totem', grupo_canal: 'presencial', receita_centavos: 1700 });
    });
  });

  // ───────────────────────────── isolamento ─────────────────────────────

  describe('isolamento: uma loja não lê a outra, nem outra empresa', () => {
    it('cada token só vê a própria loja; empresa de 2 lojas NÃO vê o pedido sem loja', async () => {
      const a1 = ultimas((await lerTudo(tA1)).itens);
      const a2 = ultimas((await lerTudo(tA2)).itens);
      const b1 = ultimas((await lerTudo(tB1)).itens);
      expect(a1.has(ids.a2)).toBe(false);
      expect(a1.has(ids.b1)).toBe(false);
      expect(a1.has(ids.aSemLoja)).toBe(false);
      expect([...a2.keys()]).toEqual([ids.a2]);
      expect([...b1.keys()]).toEqual([ids.b1]);
    });

    it('empresa de loja ÚNICA: a venda sem loja (cardápio da rede) entra', async () => {
      const d = ultimas((await lerTudo(tD1)).itens);
      expect([...d.keys()].sort()).toEqual([ids.dRede, ids.dLoja].sort());
      expect(d.get(ids.dRede)).toMatchObject({ canal: 'cardapio', receita_centavos: 4250 });
    });

    it('cursor de uma loja não vale em outra (400); de outra empresa também não; o token NOVO da mesma loja segue do mesmo ponto', async () => {
      const tA1b = await emitir(A, A.lojas[0], ['pedidos.ler', 'clientes.anonimizacao.ler']); // limite de chamadas próprio
      const { cursor, paginas } = await lerTudo(tA1b, { limite: 2 });
      expect(paginas).toBeGreaterThan(3);
      for (const t of [tA2, tB1, tD1]) {
        const r = await chamar(`/integracao/pedidos?cursor=${cursor}`, t);
        expect(r.status).toBe(400);
        expect(r.headers.get('content-type')).toContain('application/problem+json');
        expect(((await r.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}cursor-invalido`);
      }
      // cursor de /pedidos em /clientes/anonimizados: também não
      expect((await chamar(`/integracao/clientes/anonimizados?cursor=${cursor}`, tA1b)).status).toBe(400);
      // outro token da MESMA loja (troca de escopos = token novo): continua de onde parou
      const novo = await emitir(A, A.lojas[0], ['pedidos.ler']);
      const r = await chamar(`/integracao/pedidos?cursor=${cursor}`, novo);
      expect(r.status).toBe(200);
      const pg: any = await r.json();
      expect(pg.itens).toEqual([]);
      expect(pg.tem_mais).toBe(false);
    });

    it('cursor adulterado, limite fora da faixa e confirmados_desde sem fuso → 400 problem+json', async () => {
      const t = await emitir(A, A.lojas[0], ['pedidos.ler']);
      for (const qs of ['cursor=xyz', 'limite=0', 'limite=501', 'limite=abc', 'confirmados_desde=2026-07-01']) {
        const r = await chamar(`/integracao/pedidos?${qs}`, t);
        expect(r.status).toBe(400);
        const corpo: any = await r.json();
        expect([`${BASE_TIPO_PROBLEMA}cursor-invalido`, `${BASE_TIPO_PROBLEMA}parametro-invalido`]).toContain(corpo.type);
      }
    });
  });

  // ───────────────────────────── escopos ─────────────────────────────

  describe('escopos', () => {
    it('sem pedidos.ler → 403; sem clientes.anonimizacao.ler → 403 (problem+json)', async () => {
      const soCupons = await emitir(A, A.lojas[0], ['cupons.ler']);
      const r1 = await chamar('/integracao/pedidos', soCupons);
      const r2 = await chamar('/integracao/clientes/anonimizados', tA2);
      expect([r1.status, r2.status]).toEqual([403, 403]);
      expect(((await r1.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}escopo-insuficiente`);
      expect(((await r2.json()) as any).detail).toContain('clientes.anonimizacao.ler');
    });

    it('token do PILOTO (sem telefone e sem custo): `cliente` e `custo_centavos` sempre nulos', async () => {
      const cli = await cliente(A.tenant, '21999998888');
      const cmd = await comanda(A.tenant, {
        loja: A.lojas[0],
        fechada: sp(DIA2, '15:00'),
        total: 50,
        itens: [{ desc: 'Burger', qtd: 2, preco: 25, produto: produtoBurger }],
      });
      const ped = await pedido(A.tenant, { loja: A.lojas[0], canal: 'cardapio', criado: sp(DIA2, '15:00'), bruto: 50, total: 50, cliente: cli, comanda: cmd });
      await carimbar([A.tenant]);
      const piloto = await emitir(A, A.lojas[0], ['pedidos.ler', 'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler', 'cupons.criar']);
      const v = ultimas((await lerTudo(piloto)).itens).get(ped);
      expect(v.cliente).toBeNull();
      expect(v.itens.map((i: any) => i.custo_centavos)).toEqual([null]);
      for (const x of (await lerTudo(piloto)).itens) {
        expect(x.cliente).toBeNull();
        for (const it of x.itens) expect(it.custo_centavos).toBeNull();
      }
      ids.pedCliente = ped;
      ids.cliente = cli;
    });

    it('com clientes.telefone.ler: id, telefone em E.164 e `novo`; marketplace nunca manda cliente', async () => {
      const cliIfood = await cliente(A.tenant, '21977776666');
      const pedIfood = await pedido(A.tenant, { loja: A.lojas[0], canal: 'ifood', criado: sp(DIA2, '16:00'), bruto: 10, total: 10, cliente: cliIfood });
      const segundo = await pedido(A.tenant, { loja: A.lojas[0], canal: 'cardapio', criado: sp(DIA2, '17:00'), bruto: 10, total: 10, cliente: ids.cliente });
      const importado = await cliente(A.tenant, '552133334444', { importacao: { fonte: 'anotaai', pedidos: 12 } });
      const pedImportado = await pedido(A.tenant, { loja: A.lojas[0], canal: 'cardapio', criado: sp(DIA2, '18:00'), bruto: 10, total: 10, cliente: importado });
      await carimbar([A.tenant]);
      const t = await emitir(A, A.lojas[0], ['pedidos.ler', 'clientes.telefone.ler']);
      const m = ultimas((await lerTudo(t)).itens);
      expect(m.get(ids.pedCliente).cliente).toEqual({ id: ids.cliente, telefone: '+5521999998888', novo: true });
      expect(m.get(segundo).cliente).toEqual({ id: ids.cliente, telefone: '+5521999998888', novo: false });
      expect(m.get(pedImportado).cliente).toEqual({ id: importado, telefone: '+552133334444', novo: false });
      expect(m.get(pedIfood).cliente).toBeNull();
      // o telefone não fica guardado na foto da versão (dado pessoal: lido do cadastro na hora)
      const fotos = await q(`select foto::text as f from integracao_versao where tenant_id = $1`, [A.tenant]);
      const tudo = fotos.map((x) => x.f).join('\n');
      for (const tel of ['21999998888', '21977776666', '2133334444']) expect(tudo).not.toContain(tel);
    });

    it('custos.ler: custo da Curva ABC × quantidade; some quando quem autorizou perde "ver valores em R$"', async () => {
      const t = await emitir(A, A.lojas[0], ['pedidos.ler', 'custos.ler']);
      const mapa = await produtoSvc.custoEfetivoMapa(A.tenant); // a MESMA função da Curva ABC
      expect(mapa[produtoBurger]).toBeCloseTo(8.25);
      const m = ultimas((await lerTudo(t)).itens);
      expect(m.get(ids.pedCliente).itens).toEqual([
        expect.objectContaining({ produto_id: produtoBurger, quantidade: '2', receita_centavos: 5000, custo_centavos: 1650 }),
      ]);
      expect(m.get(ids.balcao).itens.map((i: any) => i.custo_centavos)).toEqual([1650, null]); // suco sem produto → sem custo
      // o presidente que autorizou passa a um perfil SEM "ver valores em R$"
      const [perfil] = await q(
        `insert into perfil_acesso (tenant_id, nome, nivel, permissoes) values ($1, 'Presidente sem R$', 'presidente', $2) returning id`,
        [A.tenant, JSON.stringify({ dashboard: true, ver_financeiro: false })],
      );
      await q(`update colaborador set perfil_acesso_id = $2 where id = $1`, [A.presidente, perfil.id]);
      (vendas as any).permissao.clear(); // o cache é de até 5 min por token; aqui, a leitura seguinte
      const sem = ultimas((await lerTudo(t)).itens);
      expect(sem.get(ids.pedCliente).itens[0].custo_centavos).toBeNull();
      await q(`update colaborador set perfil_acesso_id = null where id = $1`, [A.presidente]);
      (vendas as any).permissao.clear();
    });
  });

  // ───────────────────────────── cursor ─────────────────────────────

  describe('cursor estável', () => {
    it('com escrita no meio da leitura: nada fica para trás; o que mudou volta com versão maior', async () => {
      const E = await empresa('Empresa E', ['E1']);
      const t = await emitir(E, E.lojas[0], ['pedidos.ler']);
      const criados: string[] = [];
      const receitaOriginal = new Map<string, number>();
      for (let i = 0; i < 5; i++) {
        const id = await pedido(E.tenant, { loja: E.lojas[0], canal: 'cardapio', criado: sp(DIA1, `1${i}:00`), bruto: 10 + i, total: 10 + i });
        criados.push(id);
        receitaOriginal.set(id, (10 + i) * 100);
      }
      await carimbar([E.tenant]);
      // página 1 (2 itens)
      let r: any = await (await chamar(`/integracao/pedidos?limite=2`, t)).json();
      expect(r.tem_mais).toBe(true);
      const vistos = [...r.itens];
      const mudado = vistos[0].id;
      // escrita no meio da leitura: muda um JÁ LIDO e cria um novo
      await q(`update pedido_externo set valor_bruto = 99 where id = $1`, [mudado]);
      const novo = await pedido(E.tenant, { loja: E.lojas[0], canal: 'cardapio', criado: sp(DIA1, '20:00'), bruto: 7, total: 7 });
      await carimbar([E.tenant]);
      do {
        r = await (await chamar(`/integracao/pedidos?limite=2&cursor=${r.proximo_cursor}`, t)).json();
        expect(errosPagina(r, errosPedidoRegem)).toEqual([]);
        vistos.push(...r.itens);
      } while (r.tem_mais);
      expect([...ultimas(vistos).keys()].sort()).toEqual([...criados, novo].sort());
      const doMudado = vistos.filter((v) => v.id === mudado);
      expect(doMudado.length).toBe(2); // de novo, depois do cursor, com a versão nova
      expect(doMudado[1].versao).toBeGreaterThan(doMudado[0].versao);
      expect([doMudado[0].receita_centavos, doMudado[1].receita_centavos]).toEqual([receitaOriginal.get(mudado), 9900]);
      const semMudanca = vistos.filter((v) => v.id !== mudado);
      expect(new Set(semMudanca.map((v) => v.id)).size).toBe(semMudanca.length); // nada repete à toa
    });

    it('transação longa que confirma DEPOIS do carimbo das outras não fica para trás do cursor', async () => {
      const E = await empresa('Empresa F', ['F1']);
      const t = await emitir(E, E.lojas[0], ['pedidos.ler']);
      await pedido(E.tenant, { loja: E.lojas[0], canal: 'cardapio', criado: sp(DIA1, '10:00'), bruto: 10, total: 10 });
      const c = await pool.connect();
      let atrasado = '';
      try {
        await c.query('begin');
        const [x] = (
          await c.query(
            `insert into pedido_externo (tenant_id, unidade_id, canal, status, criado_em, confirmado_em, valor_bruto, total)
             values ($1, $2, 'cardapio', 'confirmado', $3, $3, 12, 12) returning id`,
            [E.tenant, E.lojas[0], sp(DIA1, '09:00')],
          )
        ).rows;
        atrasado = x.id;
        await carimbar([E.tenant]); // carimba a outra venda; a desta transação ainda não existe
        const antes = await lerTudo(t);
        expect(antes.itens.map((v) => v.id)).not.toContain(atrasado);
        await c.query('commit');
        await carimbar([E.tenant]);
        const depois = await lerTudo(t, { cursor: antes.cursor }); // continua do cursor antigo
        expect(depois.itens.map((v) => v.id)).toEqual([atrasado]);
      } finally {
        c.release();
      }
    });

    it('só devolve o carimbado há mais de 15 s (o contrato pede pelo menos 5)', async () => {
      const E = await empresa('Empresa G', ['G1']);
      const t = await emitir(E, E.lojas[0], ['pedidos.ler']);
      const ped = await pedido(E.tenant, { loja: E.lojas[0], canal: 'cardapio', criado: sp(DIA1, '10:00'), bruto: 10, total: 10 });
      await carimbar([E.tenant]);
      vendas.atrasoSeg = 15;
      try {
        const cedo = await lerTudo(t);
        expect(cedo.itens).toEqual([]);
        await q(`update integracao_versao set atualizado_em = atualizado_em - interval '20 seconds' where recurso_id = $1`, [ped]);
        const tarde = await lerTudo(t, { cursor: cedo.cursor }); // o cursor da leitura vazia não pulou nada
        expect(tarde.itens.map((v) => v.id)).toEqual([ped]);
      } finally {
        vendas.atrasoSeg = 0;
      }
    });

    it('carimbos no mesmo milissegundo (microssegundos diferentes) não se perdem nem se repetem', async () => {
      const E = await empresa('Empresa H', ['H1']);
      const t = await emitir(E, E.lojas[0], ['pedidos.ler']);
      const lista: string[] = [];
      for (let i = 0; i < 3; i++) lista.push(await pedido(E.tenant, { loja: E.lojas[0], canal: 'cardapio', criado: sp(DIA1, '10:00'), bruto: 1, total: 1 }));
      await carimbar([E.tenant]);
      for (const [i, id] of lista.entries()) {
        await q(`update integracao_versao set atualizado_em = '2026-09-29T12:00:00.12340${i + 1}Z' where recurso_id = $1`, [id]);
      }
      const { itens, paginas } = await lerTudo(t, { limite: 1 });
      expect(itens.map((v) => v.id)).toEqual(lista);
      expect(itens.map((v) => v.atualizado_em)).toEqual([1, 2, 3].map((n) => `2026-09-29T12:00:00.12340${n}Z`));
      expect(paginas).toBe(3);
    });
  });

  // ───────────────────────────── carga inicial ─────────────────────────────

  describe('carga inicial (90 dias) e confirmados_desde', () => {
    it('empresa que conecta depois: as vendas dos últimos 91 dias entram; o filtro fica dentro do cursor', async () => {
      const E = await empresa('Empresa I', ['I1']);
      const dias = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
      // tudo ANTES de existir token: os gatilhos não anotam nada (empresa não conectada)
      const velho = await pedido(E.tenant, { loja: E.lojas[0], canal: 'cardapio', criado: dias(100), bruto: 1, total: 1 });
      const p80 = await pedido(E.tenant, { loja: E.lojas[0], canal: 'cardapio', criado: dias(80), bruto: 2, total: 2 });
      const p1 = await pedido(E.tenant, { loja: E.lojas[0], canal: 'ifood', criado: dias(1), bruto: 3, total: 3 });
      const c2 = await comanda(E.tenant, { loja: E.lojas[0], fechada: dias(2), total: 4, itens: [{ desc: 'y', qtd: 1, preco: 4 }] });
      expect(await q(`select 1 from integracao_mudanca where tenant_id = $1`, [E.tenant])).toEqual([]);
      const t = await emitir(E, E.lojas[0], ['pedidos.ler']);
      await carimbar([E.tenant]);
      const desde = dias(90);
      const carga = await lerTudo(t, { primeira: `&confirmados_desde=${desde}` });
      expect(carga.itens.map((v) => v.id).sort()).toEqual([p80, p1, c2].sort());
      // a venda velha muda depois (ganha versão), mas está fora da janela que o cursor carrega
      await q(`update pedido_externo set status = 'cancelado', cancelado_em = now() where id = $1`, [velho]);
      const p0 = await pedido(E.tenant, { loja: E.lojas[0], canal: 'cardapio', criado: new Date().toISOString(), bruto: 5, total: 5 });
      await carimbar([E.tenant]);
      const incremental = await lerTudo(t, { cursor: carga.cursor });
      expect(incremental.itens.map((v) => v.id)).toEqual([p0]);
      // confirmados_desde diferente do que está no cursor → 400
      const r = await chamar(`/integracao/pedidos?cursor=${carga.cursor}&confirmados_desde=${dias(10)}`, t);
      expect(r.status).toBe(400);
      // uma segunda leitura "desde" (a reconciliação do Liame) acha os recentes de novo
      const rec = await lerTudo(t, { primeira: `&confirmados_desde=${dias(3)}` });
      expect(rec.itens.map((v) => v.id).sort()).toEqual([p1, c2, p0].sort());
      // e a carga não se repete sem token novo
      expect(await carimbador.fazerCargas({ tenantIds: [E.tenant] })).toBe(0);
    });
  });

  // ───────────────────────────── clientes anonimizados ─────────────────────────────

  describe('clientes anonimizados', () => {
    it('cliente excluído vira aviso só na empresa dele, com cursor', async () => {
      const cA = await cliente(A.tenant, '21911112222');
      const cB = await cliente(B.tenant, '21933334444');
      const tB = await emitir(B, B.lojas[0], ['clientes.anonimizacao.ler']);
      await q(`delete from cliente where id = any($1::uuid[])`, [[cA, cB]]);
      await carimbar([A.tenant, B.tenant]);
      const a = await lerTudo(tA1, { rota: 'clientes/anonimizados' });
      const b = await lerTudo(tB, { rota: 'clientes/anonimizados' });
      expect(a.itens.map((x) => x.id)).toContain(cA);
      expect(a.itens.map((x) => x.id)).not.toContain(cB);
      expect(b.itens.map((x) => x.id)).toEqual([cB]);
      expect(b.itens[0]).toEqual({ id: cB, anonimizado_em: expect.any(String), versao: 1, atualizado_em: expect.any(String) });
      // a outra loja da mesma empresa (A2) também recebe — o cliente é da empresa
      const a2 = await emitir(A, A.lojas[1], ['clientes.anonimizacao.ler']);
      expect((await lerTudo(a2, { rota: 'clientes/anonimizados' })).itens.map((x) => x.id)).toContain(cA);
      // continuar do cursor não repete
      const de = await lerTudo(tB, { rota: 'clientes/anonimizados', cursor: b.cursor });
      expect(de.itens).toEqual([]);
    });
  });

  // ───────────────────────────── robustez ─────────────────────────────

  // ───────────────────────────── origem do pedido do cardápio (C3a, mig 299) ─────────────────────────────

  describe('origem do pedido do cardápio (C3a, mig 299)', () => {
    const umaHoraAtras = () => new Date(Date.now() - 3_600_000).toISOString();
    const ORIGEM = {
      lk: 'lk_combo01',
      utm_source: 'meta',
      utm_medium: 'paid',
      utm_campaign: 'Combo sexta',
      campaign_id: '120215566778899',
      adset_id: '120215566770000',
      fbclid: 'IwAR0ped001',
    };
    const origemSvc = () => new OrigemPedidoService(db);
    const linhasOrigem = (tenant: string) => q(`select * from pedido_origem where tenant_id = $1`, [tenant]);

    it('loja que mede: /pedidos devolve a origem como chegou, em versão nova; o reenvio não troca nada', async () => {
      const ped = await pedido(A.tenant, { loja: A.lojas[0], canal: 'cardapio', criado: sp(DIA2, '13:45'), bruto: 40, total: 40 });
      await carimbar([A.tenant]);
      const v1 = ultimas((await lerTudo(tA1)).itens).get(ped);
      expect(v1.origem).toBeNull();

      const capturado = umaHoraAtras();
      const bruto = { ...ORIGEM, ad_id: '{{ad.id}}', capturado_em: capturado };
      expect(await gravarOrigemPedido(db, { tenantId: A.tenant, unidadeId: A.lojas[0], pedidoId: ped, bruto })).toBe(true);
      await carimbar([A.tenant]);
      const v2 = ultimas((await lerTudo(tA1)).itens).get(ped);
      expect(v2.versao).toBeGreaterThan(v1.versao);
      expect(new Date(v2.origem.capturado_em).getTime()).toBe(new Date(capturado).getTime());
      expect(v2.origem).toEqual({
        ...ORIGEM,
        capturado_em: v2.origem.capturado_em,
        utm_content: null,
        utm_term: null,
        adgroup_id: null,
        ad_id: null, // a macro não expandida ficou de fora
        gclid: null,
        gbraid: null,
        wbraid: null,
      });

      // Reenvio pelo clientRef: a primeira origem fica e a venda não muda de versão.
      const outra = { utm_source: 'google', capturado_em: umaHoraAtras() };
      expect(await gravarOrigemPedido(db, { tenantId: A.tenant, unidadeId: A.lojas[0], pedidoId: ped, bruto: outra })).toBe(false);
      await carimbar([A.tenant]);
      const v3 = ultimas((await lerTudo(tA1)).itens).get(ped);
      expect(v3.versao).toBe(v2.versao);
      expect(v3.origem.utm_source).toBe('meta');
      // A outra loja da empresa não lê a venda (nem a origem dela).
      expect(ultimas((await lerTudo(tA2)).itens).has(ped)).toBe(false);
    });

    it('loja que não mede não grava: sem token, token revogado, token sem pedidos.ler, cardápio da rede com 2 lojas', async () => {
      const E = await empresa('Empresa E (sem token)', ['E1']);
      const pE = await pedido(E.tenant, { loja: E.lojas[0], canal: 'cardapio', criado: sp(DIA2, '14:00'), bruto: 10, total: 10 });
      expect(await gravarOrigemPedido(db, { tenantId: E.tenant, unidadeId: E.lojas[0], pedidoId: pE, bruto: ORIGEM })).toBe(false);
      expect(await medicaoDeAnuncios(db, E.tenant, E.lojas[0])).toBeNull();

      const F = await empresa('Empresa F', ['F1']);
      await emitir(F, F.lojas[0], ['pedidos.ler']);
      expect(await medicaoDeAnuncios(db, F.tenant, F.lojas[0])).toEqual({ ferramenta: 'o Liame, da DMS' });
      await q(`update integracao_token_loja set escopos = '{cupons.ler}' where tenant_id = $1`, [F.tenant]);
      expect(await medicaoDeAnuncios(db, F.tenant, F.lojas[0])).toBeNull();
      await q(`update integracao_token_loja set escopos = '{pedidos.ler}', revogado_em = now() where tenant_id = $1`, [F.tenant]);
      const pF = await pedido(F.tenant, { loja: F.lojas[0], canal: 'cardapio', criado: sp(DIA2, '14:05'), bruto: 10, total: 10 });
      expect(await gravarOrigemPedido(db, { tenantId: F.tenant, unidadeId: F.lojas[0], pedidoId: pF, bruto: ORIGEM })).toBe(false);
      expect(await medicaoDeAnuncios(db, F.tenant, F.lojas[0])).toBeNull();

      // Cardápio da REDE (sem loja) numa empresa de 2 lojas: nenhum token lê essas vendas.
      const pRedeA = await pedido(A.tenant, { loja: null, canal: 'cardapio', criado: sp(DIA2, '14:10'), bruto: 10, total: 10 });
      expect(await gravarOrigemPedido(db, { tenantId: A.tenant, unidadeId: null, pedidoId: pRedeA, bruto: ORIGEM })).toBe(false);
      expect(await medicaoDeAnuncios(db, A.tenant, null)).toBeNull();
      // Na empresa de loja única, o cardápio da rede entra (a leitura pega a empresa toda).
      expect(await medicaoDeAnuncios(db, D.tenant, null)).toEqual({ ferramenta: 'o Liame, da DMS' });
      const pRedeD = await pedido(D.tenant, { loja: null, canal: 'cardapio', criado: sp(DIA2, '14:15'), bruto: 10, total: 10 });
      expect(await gravarOrigemPedido(db, { tenantId: D.tenant, unidadeId: null, pedidoId: pRedeD, bruto: ORIGEM })).toBe(true);

      expect(await linhasOrigem(E.tenant)).toHaveLength(0);
      expect(await linhasOrigem(F.tenant)).toHaveLength(0);
      expect((await linhasOrigem(A.tenant)).some((l: any) => l.pedido_id === pRedeA)).toBe(false);
    });

    it('90 dias: some o código do clique, ficam campanha e anúncio, sem versão nova; origem de pedido apagado sai', async () => {
      const ped = await pedido(A.tenant, { loja: A.lojas[0], canal: 'cardapio', criado: sp(DIA2, '15:00'), bruto: 20, total: 20 });
      const bruto = { utm_source: 'meta', campaign_id: '777', fbclid: 'IwAR-velho', gclid: 'Cj0-velho', capturado_em: umaHoraAtras() };
      expect(await gravarOrigemPedido(db, { tenantId: A.tenant, unidadeId: A.lojas[0], pedidoId: ped, bruto })).toBe(true);
      await carimbar([A.tenant]);
      const antes = ultimas((await lerTudo(tA1)).itens).get(ped);
      expect(antes.origem).toMatchObject({ fbclid: 'IwAR-velho', gclid: 'Cj0-velho' });

      await q(`update pedido_origem set criado_em = now() - interval '91 days' where pedido_id = $1`, [ped]);
      const orfa = randomUUID(); // origem de um pedido que não existe mais
      await q(
        `insert into pedido_origem (pedido_id, tenant_id, capturado_em, utm_source, criado_em)
         values ($1, $2, now() - interval '2 days', 'meta', now() - interval '2 days')`,
        [orfa, A.tenant],
      );
      expect(await origemSvc().expurgar({ tenantIds: [] })).toEqual({ cliques: 0, orfas: 0 }); // escopo vazio: nada
      expect(await origemSvc().expurgar({ tenantIds: [A.tenant] })).toEqual({ cliques: 1, orfas: 1 });
      expect(await origemSvc().expurgar({ tenantIds: [A.tenant] })).toEqual({ cliques: 0, orfas: 0 }); // já feito

      await carimbar([A.tenant]);
      const depois = ultimas((await lerTudo(tA1)).itens).get(ped);
      expect(depois.versao).toBe(antes.versao);
      expect(depois.origem).toMatchObject({ utm_source: 'meta', campaign_id: '777', fbclid: null, gclid: null });
      const [linha] = await q(`select ids_expurgados_em from pedido_origem where pedido_id = $1`, [ped]);
      expect(linha.ids_expurgados_em).toBeTruthy();
      expect(await q(`select 1 from pedido_origem where pedido_id = $1`, [orfa])).toHaveLength(0);
    });
  });

  // ───────────────────────────── cupom da plataforma de pedidos da loja ─────────────────────────────

  it('cupom do Anota AI e do CardápioWeb chega em `cupom`; o "cupom" do marketplace não', async () => {
    const d = (o: Record<string, unknown>) => [{ origem: 'cupom', valor: 5, quemBanca: 'loja', ...o }];
    const anota = await pedido(A.tenant, { loja: A.lojas[0], canal: 'anotaai', criado: sp(DIA2, '16:00'), bruto: 45, total: 40, descontos: d({ rotulo: 'SEXTA10' }) });
    const cw = await pedido(A.tenant, {
      loja: A.lojas[0],
      canal: 'cardapio_web',
      criado: sp(DIA2, '16:05'),
      bruto: 45,
      total: 40,
      descontos: d({ rotulo: 'Cupom de sexta', campanha: 'SEXTA10' }),
    });
    const ifood = await pedido(A.tenant, {
      loja: A.lojas[0],
      canal: 'ifood',
      criado: sp(DIA2, '16:10'),
      bruto: 45,
      total: 35,
      descontos: d({ rotulo: 'FD_DESPIT_27D7135', quemBanca: 'marketplace' }),
    });
    await carimbar([A.tenant]);
    const m = ultimas((await lerTudo(tA1)).itens);
    expect(m.get(anota)).toMatchObject({ canal: 'anotaai', grupo_canal: 'outro', cupom: 'SEXTA10' });
    expect(m.get(cw)).toMatchObject({ canal: 'cardapio_web', grupo_canal: 'outro', cupom: 'SEXTA10' });
    expect(m.get(ifood)).toMatchObject({ canal: 'ifood', grupo_canal: 'marketplace', cupom: null });
  });

  describe('robustez: o gatilho nunca derruba a venda', () => {
    it('sem a fila (tabela sumiu), a venda grava assim mesmo — só não ganha versão', async () => {
      await pool.query(`alter table ${SCHEMA}.integracao_mudanca rename to integracao_mudanca_fora`);
      try {
        const [antes] = await q(`select count(*)::int n from ${SCHEMA}.integracao_mudanca_fora`);
        const ped = await pedido(A.tenant, { loja: A.lojas[0], canal: 'cardapio', criado: sp(DIA2, '19:00'), bruto: 3, total: 3 });
        await q(`update pedido_externo set status = 'pronto' where id = $1`, [ped]);
        const cmd = await comanda(A.tenant, { loja: A.lojas[0], fechada: sp(DIA2, '19:00'), total: 3, itens: [{ desc: 'z', qtd: 1, preco: 3 }] });
        await q(`update comanda_item set quantidade = 2 where comanda_id = $1`, [cmd]);
        await q(`delete from comanda_item where comanda_id = $1`, [cmd]);
        await q(`delete from comanda where id = $1`, [cmd]);
        await q(`delete from pedido_externo where id = $1`, [ped]);
        const cli = await cliente(A.tenant, null);
        await q(`delete from cliente where id = $1`, [cli]);
        // os gatilhos rodaram (e caíram no aviso), mas não escreveram na tabela renomeada
        const [depois] = await q(`select count(*)::int n from ${SCHEMA}.integracao_mudanca_fora`);
        expect(depois.n).toBe(antes.n);
      } finally {
        await pool.query(`alter table ${SCHEMA}.integracao_mudanca_fora rename to integracao_mudanca`);
      }
    });

    it('empresa não conectada: o gatilho não anota nada', async () => {
      const N = await empresa('Empresa N', ['N1']);
      const cmd = await comanda(N.tenant, { loja: N.lojas[0], total: 9, itens: [{ desc: 'n', qtd: 1, preco: 9 }] });
      await pedido(N.tenant, { loja: N.lojas[0], canal: 'ifood', criado: new Date().toISOString(), bruto: 9, total: 9, comanda: cmd });
      await q(`update comanda set total = 10 where id = $1`, [cmd]);
      expect(await q(`select 1 from integracao_mudanca where tenant_id = $1`, [N.tenant])).toEqual([]);
    });

    it('venda que a fórmula não aguenta fica marcada com o motivo e não segura as outras', async () => {
      const E = await empresa('Empresa J', ['J1']);
      const t = await emitir(E, E.lojas[0], ['pedidos.ler']);
      const ruim = await pedido(E.tenant, {
        loja: E.lojas[0],
        canal: 'cardapio',
        criado: sp(DIA1, '10:00'),
        bruto: 10,
        total: 10,
        descontos: [{ origem: 'cupom', valor: 'dez', quemBanca: 'loja', alvo: 'ITEM' }],
      });
      const boa = await pedido(E.tenant, { loja: E.lojas[0], canal: 'cardapio', criado: sp(DIA1, '11:00'), bruto: 11, total: 11 });
      await carimbar([E.tenant]);
      expect((await lerTudo(t)).itens.map((v) => v.id)).toEqual([boa]);
      const [marcada] = await q(`select pendente, erro from integracao_versao where recurso_id = $1`, [ruim]);
      expect(marcada.pendente).toBe(false);
      expect(marcada.erro).toMatch(/numeric|numérico|invalid input|entrada inválida/i);
      // a reconciliação diária devolve a venda com erro à fila (aqui ela falha de novo e segue marcada)
      await carimbador.reconciliar({ tenantIds: [E.tenant] });
      const [depois] = await q(`select erro from integracao_versao where recurso_id = $1`, [ruim]);
      expect(depois.erro).toBeNull();
      await carimbar([E.tenant]);
      const [denovo] = await q(`select erro from integracao_versao where recurso_id = $1`, [ruim]);
      expect(denovo.erro).toBeTruthy();
    });
  });

  it('servidor da loja (EDGE_MODE=true): as rotas de vendas não existem (404)', async () => {
    process.env.EDGE_MODE = 'true';
    const edge = await subir();
    try {
      for (const rota of ['pedidos', 'clientes/anonimizados']) {
        const r = await fetch(`${edge.base}/integracao/${rota}`, { headers: { authorization: `Bearer ${tA1}` } });
        expect(r.status).toBe(404);
        expect(((await r.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}nao-encontrado`);
      }
      // e o carimbador não roda lá (o tick sai na primeira linha)
      const antes = await q(`select count(*)::int n from integracao_mudanca`);
      await edge.app.get(CarimbadorIntegracaoService).tick();
      expect(await q(`select count(*)::int n from integracao_mudanca`)).toEqual(antes);
    } finally {
      await edge.app.close();
      delete process.env.EDGE_MODE;
    }
  });
});
