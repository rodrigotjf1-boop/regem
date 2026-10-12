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
import { repetirNaCorridaDeCatalogo } from '../../common/corrida-de-catalogo';
import { CfThrottlerGuard } from '../../common/cf-throttler.guard';
import { CloudOnlyGuard } from '../../common/cloud-only.guard';
import { IntegracaoApiModule } from './integracao-api.module';
import { IntegracaoTokenService } from './integracao-token.service';
import { WebhookIntegracaoService } from './webhook-integracao.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O CARDÁPIO E AS FICHAS AVISAM QUEM ESTÁ CONECTADO (Farol — mig 316), contra o Postgres real e por
// HTTP, com um RECEPTOR local no papel do Farol (confere a assinatura Standard Webhooks).
//
// Como nas outras specs da integração: o banco do CI é montado como SERVIDOR DA LOJA e as migrations
// só da nuvem (295–299, 303, 304, 315 e a 316) sobem num schema só deste teste, na frente do `public`.
// As 12 tabelas do cardápio e das fichas são COPIADAS para o schema — os gatilhos da 316 vivem só nas
// cópias —, sem FK para tabela compartilhada (LIC-088/ERR-109). O job roda SÓ nas empresas desta
// spec (V32/LIC-084).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('integracao-retrato-aviso.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(180_000);

const MIGS = join(__dirname, '..', '..', '..', '..', 'database', 'migrations');
const mig = (n: string) => readFileSync(join(MIGS, n), 'utf8');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');
// As tabelas que ganham gatilho nas migrations das vendas e dos cupons (296, 298)…
const FONTES = ['pedido_externo', 'comanda', 'comanda_item', 'cliente', 'cupom', 'cupom_uso'];
// …e as doze que ganham na 316.
const CARDAPIO = [
  'categoria_produto', 'setor', 'produto', 'produto_variacao', 'produto_combo_item', 'complemento_grupo',
  'complemento_opcao', 'opcao', 'item_estoque', 'ficha_tecnica', 'ficha_ingrediente', 'item_conversao',
];
const ESCOPOS_FAROL = ['catalogo.ler', 'fichas.ler', 'producao.ler'];

type Recebido = { caminho: string; cabecalhos: IncomingHttpHeaders; corpo: string };

descrever('API de integração — o cardápio e as fichas avisam (mig 316)', () => {
  const SCHEMA = `teste_retrato_aviso_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public`, max: 8 });
  const db = drizzle(pool) as any;
  const auditoria = { registrar: async () => undefined } as unknown as AuditoriaService;
  const tokensSvc = new IntegracaoTokenService(db, auditoria);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const original = {
    edge: process.env.EDGE_MODE,
    chave: process.env.SEGREDOS_CHAVE,
    farol: process.env.INTEGRACAO_FAROL_WEBHOOK_URLS,
    liame: process.env.INTEGRACAO_LIAME_WEBHOOK_URLS,
  };
  let app: INestApplication;
  let base = '';
  let svc: WebhookIntegracaoService;

  // ───────────────────────────── o receptor (faz o papel do Farol) ─────────────────────────────

  const recebidos: Recebido[] = [];
  let receptor: Server;
  let baseFarol = '';
  let baseLiame = '';

  function subirReceptor(): Promise<void> {
    receptor = createServer((req, res) => {
      const partes: Buffer[] = [];
      req.on('data', (d) => partes.push(d));
      req.on('end', () => {
        recebidos.push({ caminho: req.url ?? '', cabecalhos: req.headers, corpo: Buffer.concat(partes).toString('utf8') });
        res.writeHead(204);
        res.end();
      });
    });
    return new Promise((ok) =>
      receptor.listen(0, '127.0.0.1', () => {
        const porta = (receptor.address() as any).port;
        baseFarol = `http://127.0.0.1:${porta}/v1/regem/avisos/`;
        baseLiame = `http://127.0.0.1:${porta}/v1/inbox/regem/`;
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
    return !!id && Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) < 300 && r.cabecalhos['webhook-signature'] === esperado;
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

  async function put(token: string, corpo: any) {
    const r = await fetch(`${base}/integracao/webhook`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(corpo),
    });
    const texto = await r.text();
    return { status: r.status, corpo: texto ? JSON.parse(texto) : null };
  }

  /** Insere uma linha e devolve o id. As colunas são as do banco. */
  async function ins(tabela: string, linha: Record<string, unknown>): Promise<string> {
    const colunas = Object.keys(linha);
    const [r] = await q(
      `insert into ${tabela} (${colunas.join(', ')}) values (${colunas.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
      colunas.map((c) => linha[c]),
    );
    return r.id as string;
  }

  type Emp = { tenant: string; lojas: string[]; presidente: string };

  async function empresa(nome: string, lojas: string[]): Promise<Emp> {
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
    const [c] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, $2, $3) returning id`, [e.id, `Presidente ${nome}`, f.id]);
    return { tenant: e.id as string, lojas: ids, presidente: c.id as string };
  }

  async function emitir(e: Emp, loja: string, cliente: string, escopos: string[]) {
    const r = await tokensSvc.emitir(
      { tenantId: e.tenant, unidadeId: loja, cliente, autorizadoPor: e.presidente, escopos, evidencia: 'autorização por escrito (teste)' },
      dist,
    );
    return r as { id: string; token: string };
  }

  const segredoNovo = () => `whsec_${randomBytes(32).toString('base64')}`;

  /** Emite o token e registra o aviso dele no receptor, com o "id de conexão" no caminho. */
  async function conectar(e: Emp, loja: string, conexao: string, escopos = ESCOPOS_FAROL, cliente = 'farol') {
    const t = await emitir(e, loja, cliente, escopos);
    const segredo = segredoNovo();
    const r = await put(t.token, { url: `${cliente === 'farol' ? baseFarol : baseLiame}${conexao}`, segredo });
    if (r.status !== 200) throw new Error(`registro do aviso falhou: ${r.status} ${JSON.stringify(r.corpo)}`);
    return { ...t, segredo, conexao };
  }

  const fila = (tenants = empresas) =>
    q(`select tenant_id::text as tenant, unidade_id::text as loja, recurso from integracao_retrato_mudanca where tenant_id = any($1::uuid[])`, [tenants]);
  /** Começa do zero: fila e marcas vazias, todo registro "em dia" e na vez, nada recebido. */
  async function zerar() {
    await q(`delete from integracao_retrato_mudanca where tenant_id = any($1::uuid[])`, [empresas]);
    await q(`delete from integracao_retrato_marca where tenant_id = any($1::uuid[])`, [empresas]);
    await q(
      `update integracao_webhook
          set avisado_ate = now(), proxima_verificacao_em = now(), falhas_seguidas = 0, primeira_falha_em = null,
              pausado_em = null, motivo_pausa = null
        where tenant_id = any($1::uuid[])`,
      [empresas],
    );
    recebidos.length = 0;
  }
  const naVez = () => q(`update integracao_webhook set proxima_verificacao_em = now() - interval '1 second' where tenant_id = any($1::uuid[])`, [empresas]);
  const ciclo = () => svc.ciclo({ tenantIds: empresas }, 30_000);
  const tiposDe = (conexao: string, cliente = 'farol') =>
    recebidos
      .filter((r) => r.caminho === `/v1/${cliente === 'farol' ? 'regem/avisos' : 'inbox/regem'}/${conexao}`)
      .map((r) => JSON.parse(r.corpo).tipo as string);
  /** Faz a mudança a partir do zero, roda um ciclo e devolve o tipo dos avisos que cada conexão recebeu. */
  async function depoisDe(mudar: () => Promise<unknown>) {
    await zerar();
    await mudar();
    await naVez();
    await ciclo();
    return { a1: tiposDe('conexao-a1'), a2: tiposDe('conexao-a2'), b1: tiposDe('conexao-b1'), d1: tiposDe('conexao-d1') };
  }

  let A: Emp; // duas lojas, as duas com o Farol
  let B: Emp; // outra empresa, uma loja
  let D: Emp; // empresa de UMA loja (a outra fechou)
  let regA1: Awaited<ReturnType<typeof conectar>>;
  const id: Record<string, string> = {};
  const CAT = 'catalogo.alterado';
  const FIC = 'fichas.alterado';

  async function cadastroDaA() {
    const t = A.tenant;
    const [a1, a2] = A.lojas;
    id.categoria = await ins('categoria_produto', { tenant_id: t, nome: 'Lanches', ordem: 1 });
    id.setorA1 = await ins('setor', { tenant_id: t, unidade_id: a1, nome: 'Chapa' });
    id.itemPao = await ins('item_estoque', { tenant_id: t, nome: 'Pão brioche', unidade_medida: 'unidade', custo_medio: '3.21' });
    id.itemQueijo = await ins('item_estoque', { tenant_id: t, nome: 'Queijo prato', unidade_medida: 'kg', custo_medio: '3.21' });
    id.conversao = await ins('item_conversao', { tenant_id: t, item_id: id.itemQueijo, unidade_de: 'kg', fator: '50', unidade_para: 'fatia' });
    id.fichaRede = await ins('ficha_tecnica', { tenant_id: t, nome: 'X-Burger', rendimento: '1', preco_venda: '30' });
    id.fichaA2 = await ins('ficha_tecnica', { tenant_id: t, unidade_id: a2, nome: 'Só da filial', rendimento: '1' });
    id.ingRede = await ins('ficha_ingrediente', {
      tenant_id: t, ficha_id: id.fichaRede, item_id: id.itemPao, insumo_nome: 'Pão brioche', quantidade: '1', unidade: 'unidade', custo_unitario: '3.21',
    });
    id.ingA2 = await ins('ficha_ingrediente', {
      tenant_id: t, ficha_id: id.fichaA2, item_id: id.itemQueijo, insumo_nome: 'Queijo prato', quantidade: '0.04', unidade: 'kg',
    });
    id.pRede = await ins('produto', { tenant_id: t, nome: 'X-Burger', tipo: 'variavel', preco_venda: '30', ficha_id: id.fichaRede, categoria_id: id.categoria });
    id.pA1 = await ins('produto', { tenant_id: t, unidade_id: a1, nome: 'Só da matriz', tipo: 'simples', preco_venda: '10' });
    id.pA2 = await ins('produto', { tenant_id: t, unidade_id: a2, nome: 'Só da filial', tipo: 'simples', preco_venda: '10' });
    id.pCombo = await ins('produto', { tenant_id: t, unidade_id: a1, nome: 'Combo da matriz', tipo: 'combo', preco_venda: '40' });
    id.vRede = await ins('produto_variacao', { tenant_id: t, produto_id: id.pRede, nome: 'Simples', preco_venda: '30', fator_ficha: '1' });
    id.vA2 = await ins('produto_variacao', { tenant_id: t, produto_id: id.pA2, nome: 'Grande', preco_venda: '12', fator_ficha: '2' });
    id.combo = await ins('produto_combo_item', { tenant_id: t, combo_produto_id: id.pCombo, componente_produto_id: id.pRede, quantidade: '1' });
    id.opcao = await ins('opcao', { tenant_id: t, nome: 'Bacon', tipo: 'insumo', item_id: id.itemPao, preco_custo: '2' });
    id.grupoA2 = await ins('complemento_grupo', { tenant_id: t, produto_id: id.pA2, nome: 'Adicionais', tipo: 'adicionar', min: 0, max: 3, ordem: 0 });
    id.coA2 = await ins('complemento_opcao', { tenant_id: t, grupo_id: id.grupoA2, nome: 'Bacon', ordem: 0, preco_delta: '4', origem_opcao_id: id.opcao });
  }

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a API é da NUVEM
    process.env.SEGREDOS_CHAVE = randomBytes(32).toString('base64');
    await subirReceptor();
    process.env.INTEGRACAO_FAROL_WEBHOOK_URLS = baseFarol;
    process.env.INTEGRACAO_LIAME_WEBHOOK_URLS = baseLiame;

    await pool.query(`create schema ${SCHEMA}`);
    for (const t of [...FONTES, ...CARDAPIO]) await pool.query(`create table ${SCHEMA}.${t} (like public.${t} including all)`);
    // O índice único do código do cupom com o NOME de produção (o `like` gera outro) — como na spec dos cupons.
    for (const x of await repetirNaCorridaDeCatalogo(() =>
      q(`select indexname from pg_indexes where schemaname = $1 and tablename = 'cupom' and indexdef ilike '%upper(codigo)%'`, [SCHEMA]),
    )) {
      await pool.query(`drop index ${SCHEMA}.${x.indexname}`);
    }
    await pool.query(`create unique index uq_cupom_tenant_codigo on ${SCHEMA}.cupom (tenant_id, upper(codigo))`);
    await pool.query(`create trigger trg_bump_updated_at before update on ${SCHEMA}.cupom for each row execute function public.bump_updated_at()`);
    // Cada arquivo é uma transação só; a conferência de alguns lê objetos dos schemas das specs vizinhas (ERR-194).
    const aplicar = (sqlDaMigration: string) => repetirNaCorridaDeCatalogo(() => pool.query(sqlDaMigration));
    await aplicar(semFkCompartilhada(mig('295_integracao_token_loja.sql')));
    await aplicar(mig('296_integracao_versao_vendas.sql'));
    await aplicar(mig('297_pedido_externo_comanda_idx.sql'));
    await aplicar(mig('298_integracao_cupons.sql'));
    await aplicar(mig('299_pedido_origem.sql'));
    await aplicar(semFkCompartilhada(mig('303_integracao_autorizacao.sql')));
    await aplicar(mig('304_integracao_webhook.sql'));
    await aplicar(mig('315_integracao_farol.sql'));
    // A 316, como vai para a nuvem, duas vezes (idempotente) — e a conferência dela, linha a linha.
    for (let i = 0; i < 2; i++) {
      const r = (await aplicar(mig('316_integracao_retrato_aviso.sql'))) as unknown as any[];
      const conferencia = r[r.length - 1].rows;
      expect(conferencia).toHaveLength(6);
      const falhas = conferencia.filter((l: any) => l.ok !== true).map((l: any) => l.objeto);
      if (falhas.length) throw new Error(`conferência da 316 falhou: ${falhas.join(', ')}`);
    }

    const [fk] = await q(
      `select count(*)::int n from pg_constraint c join pg_namespace s on s.oid = c.connamespace
        where s.nspname = $1 and c.contype = 'f'
          and c.confrelid in ('public.empresa'::regclass, 'public.unidade'::regclass)`,
      [SCHEMA],
    );
    if (fk.n) throw new Error('o schema do teste não pode apontar para empresa/unidade compartilhadas (LIC-088)');
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
    svc.atrasoSeg = 0; // o atraso de segurança tem teste próprio

    A = await empresa('Empresa A', ['A1 matriz', 'A2 filial']);
    B = await empresa('Empresa B', ['B1']);
    D = await empresa('Empresa D', ['D1 única', 'D2 fechada']);
    await cadastroDaA();
    id.pB = await ins('produto', { tenant_id: B.tenant, nome: 'Produto da B', tipo: 'simples', preco_venda: '10' });
    id.fichaB = await ins('ficha_tecnica', { tenant_id: B.tenant, nome: 'Ficha da B', rendimento: '1' });
    id.pD2 = await ins('produto', { tenant_id: D.tenant, unidade_id: D.lojas[1], nome: 'D da loja antiga', tipo: 'simples', preco_venda: '10' });
    await q(`update unidade set deleted_at = now() where id = $1`, [D.lojas[1]]);

    regA1 = await conectar(A, A.lojas[0], 'conexao-a1');
    await conectar(A, A.lojas[1], 'conexao-a2');
    await conectar(B, B.lojas[0], 'conexao-b1');
    await conectar(D, D.lojas[0], 'conexao-d1');
  });

  afterAll(async () => {
    await app?.close();
    (receptor as any)?.closeAllConnections?.();
    await new Promise((ok) => (receptor ? receptor.close(() => ok(null)) : ok(null)));
    for (const [k, v] of [
      ['EDGE_MODE', original.edge],
      ['SEGREDOS_CHAVE', original.chave],
      ['INTEGRACAO_FAROL_WEBHOOK_URLS', original.farol],
      ['INTEGRACAO_LIAME_WEBHOOK_URLS', original.liame],
    ] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  }, 120_000);

  beforeEach(() => {
    svc.atrasoSeg = 0;
    svc.intervaloSeg = 60;
    (svc as any).retratosParadosAte = 0;
  });

  // ───────────────────────────── o registro ─────────────────────────────

  describe('PUT /integracao/webhook com o token do Farol', () => {
    it('registra dentro do endereço do Farol; o do Liame e o de fora são recusados', async () => {
      const t = await emitir(B, B.lojas[0], 'farol', ESCOPOS_FAROL);
      const segredo = segredoNovo();
      const ok = await put(t.token, { url: `${baseFarol}${randomUUID()}`, segredo });
      expect(ok.status).toBe(200);
      expect(ok.corpo).toMatchObject({ pausado: false, entregues: 0 });
      expect(JSON.stringify(ok.corpo)).not.toContain(segredo);
      for (const url of [`${baseLiame}${randomUUID()}`, `https://outro.exemplo/v1/regem/avisos/${randomUUID()}`, `${baseFarol}a/b`]) {
        const r = await put(t.token, { url, segredo });
        expect(r.status).toBe(422);
        expect(r.corpo.type).toContain('endereco-nao-permitido');
      }
      // O token do Liame segue registrando no endereço DELE — e não no do Farol.
      const liame = await emitir(B, B.lojas[0], 'liame', ['pedidos.ler']);
      expect((await put(liame.token, { url: `${baseLiame}${randomUUID()}`, segredo: segredoNovo() })).status).toBe(200);
      expect((await put(liame.token, { url: `${baseFarol}${randomUUID()}`, segredo: segredoNovo() })).status).toBe(422);
      await q(`delete from integracao_webhook where token_id = any($1::uuid[])`, [[t.id, liame.id]]);
    });
  });

  // ───────────────────────────── os gatilhos ─────────────────────────────

  describe('os gatilhos da 316', () => {
    it('são 36, só nas cópias deste teste, e as colunas citadas nos argumentos existem', async () => {
      const gatilhos = await q(
        `select c.relname as tabela, g.tgname as nome, encode(g.tgargs, 'hex') as args
           from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace s on s.oid = c.relnamespace
          where s.nspname = $1 and g.tgname like 'trg_integracao_retrato_%'`,
        [SCHEMA],
      );
      expect(gatilhos).toHaveLength(36);
      expect([...new Set(gatilhos.map((g) => g.tabela))].sort()).toEqual([...CARDAPIO].sort());
      const colunas = await q(`select table_name as tabela, column_name as coluna from information_schema.columns where table_schema = $1`, [SCHEMA]);
      const tem = (tabela: string, coluna: string) => colunas.some((c) => c.tabela === tabela && c.coluna === coluna);
      for (const g of gatilhos) {
        // Os argumentos vêm separados por um byte zero.
        const [tipo, modo, pai, ignorar] = (g.args as string).split('00').map((h) => Buffer.from(h, 'hex').toString('utf8'));
        expect(['catalogo', 'fichas', 'ambos']).toContain(tipo);
        expect(['propria', 'rede', 'produto', 'grupo', 'ficha']).toContain(modo);
        if (modo === 'propria') expect(tem(g.tabela, 'unidade_id')).toBe(true);
        if (pai) expect(tem(g.tabela, pai)).toBe(true);
        for (const c of (ignorar ?? '').split(',').filter(Boolean)) expect([g.tabela, c, tem(g.tabela, c)]).toEqual([g.tabela, c, true]);
        expect(tem(g.tabela, 'id') && tem(g.tabela, 'tenant_id')).toBe(true);
      }
    });

    it('só anotam para a empresa com token de catálogo ou de fichas (V51)', async () => {
      // Sem token nenhum, e só com token de vendas (Liame): nada na fila.
      const S = await empresa('Empresa sem Farol', ['S1']);
      const pS = await ins('produto', { tenant_id: S.tenant, nome: 'Produto', tipo: 'simples', preco_venda: '10' });
      await emitir(S, S.lojas[0], 'liame', ['pedidos.ler', 'cupons.ler']);
      await q(`update produto set nome = 'Outro nome' where id = $1`, [pS]);
      await ins('ficha_tecnica', { tenant_id: S.tenant, nome: 'Ficha', rendimento: '1' });
      expect(await fila([S.tenant])).toEqual([]);
      // Com o token do Farol, passa a anotar; revogado, para.
      const f = await emitir(S, S.lojas[0], 'farol', ['catalogo.ler']);
      await q(`update produto set nome = 'Mais um nome' where id = $1`, [pS]);
      expect(await fila([S.tenant])).toEqual([{ tenant: S.tenant, loja: null, recurso: 'catalogo' }]);
      await q(`delete from integracao_retrato_mudanca where tenant_id = $1`, [S.tenant]);
      await q(`update integracao_token_loja set revogado_em = now() where id = $1`, [f.id]);
      await q(`update produto set nome = 'Nome depois de revogar' where id = $1`, [pS]);
      expect(await fila([S.tenant])).toEqual([]);
    });

    it('um comando com muitas linhas vira UMA linha na fila por loja e por tipo', async () => {
      await zerar();
      await q(
        `insert into produto (tenant_id, nome, tipo, preco_venda)
         select $1, 'Em massa ' || n, 'simples', 10 from generate_series(1, 800) n`,
        [A.tenant],
      );
      expect(await fila([A.tenant])).toEqual([{ tenant: A.tenant, loja: null, recurso: 'catalogo' }]);
      await q(`delete from integracao_retrato_mudanca where tenant_id = $1`, [A.tenant]);
      await q(`update produto set deleted_at = now() where tenant_id = $1 and nome like 'Em massa %'`, [A.tenant]);
      expect(await fila([A.tenant])).toEqual([{ tenant: A.tenant, loja: null, recurso: 'catalogo' }]);
    });

    it('não derrubam a escrita: com a fila fora do ar, o produto é salvo do mesmo jeito', async () => {
      await zerar();
      await pool.query(`alter table ${SCHEMA}.integracao_retrato_mudanca rename to fila_fora_do_ar`);
      try {
        await q(`update produto set nome = 'X-Burger salvo sem fila' where id = $1`, [id.pRede]);
        const [p] = await q(`select nome from produto where id = $1`, [id.pRede]);
        expect(p.nome).toBe('X-Burger salvo sem fila');
      } finally {
        await pool.query(`alter table ${SCHEMA}.fila_fora_do_ar rename to integracao_retrato_mudanca`);
      }
      expect(await fila([A.tenant])).toEqual([]);
    });
  });

  // ───────────────────────────── o que avisa, e a quem ─────────────────────────────

  describe('mudou o cardápio ou a ficha: o aviso sai para a loja certa', () => {
    const casos: Array<[string, () => Promise<unknown>, { a1: string[]; a2: string[] }]> = [
      ['produto da rede (nome)', () => q(`update produto set nome = 'X-Burger novo' where id = $1`, [id.pRede]), { a1: [CAT], a2: [CAT] }],
      ['produto novo da rede', () => ins('produto', { tenant_id: A.tenant, nome: 'Novo da rede', tipo: 'simples', preco_venda: '9' }), { a1: [CAT], a2: [CAT] }],
      ['produto de UMA loja', () => q(`update produto set descricao = 'agora com descrição' where id = $1`, [id.pA1]), { a1: [CAT], a2: [] }],
      ['produto desativado na filial', () => q(`update produto set ativo = false where id = $1`, [id.pA2]), { a1: [], a2: [CAT] }],
      ['produto apagado (exclusão lógica)', () => q(`update produto set deleted_at = now() where id = $1`, [id.pA1]), { a1: [CAT], a2: [] }],
      ['variação de produto da rede', () => q(`update produto_variacao set fator_ficha = 3 where id = $1`, [id.vRede]), { a1: [CAT], a2: [CAT] }],
      ['variação nova em produto da filial', () => ins('produto_variacao', { tenant_id: A.tenant, produto_id: id.pA2, nome: 'Gigante', preco_venda: '15' }), { a1: [], a2: [CAT] }],
      ['item de combo da matriz', () => q(`update produto_combo_item set quantidade = 2 where id = $1`, [id.combo]), { a1: [CAT], a2: [] }],
      ['grupo de adicionais da filial', () => q(`update complemento_grupo set max = 5 where id = $1`, [id.grupoA2]), { a1: [], a2: [CAT] }],
      ['opção de adicional da filial', () => q(`update complemento_opcao set nome = 'Bacon em dobro' where id = $1`, [id.coA2]), { a1: [], a2: [CAT] }],
      ['opção de adicional apagada de verdade', () => q(`delete from complemento_opcao where id = $1`, [id.coA2]), { a1: [], a2: [CAT] }],
      ['opção cujo grupo não existe mais (vale para todas)', () => ins('complemento_opcao', { tenant_id: A.tenant, grupo_id: randomUUID(), nome: 'Órfã', ordem: 0 }), { a1: [CAT], a2: [CAT] }],
      ['opção reutilizável (da rede)', () => q(`update opcao set tipo = 'simples' where id = $1`, [id.opcao]), { a1: [CAT], a2: [CAT] }],
      ['categoria (da rede)', () => q(`update categoria_produto set nome = 'Lanches da casa' where id = $1`, [id.categoria]), { a1: [CAT], a2: [CAT] }],
      ['setor da matriz', () => q(`update setor set nome = 'Chapa quente' where id = $1`, [id.setorA1]), { a1: [CAT], a2: [] }],
      ['ficha da rede (rendimento)', () => q(`update ficha_tecnica set rendimento = 2 where id = $1`, [id.fichaRede]), { a1: [FIC], a2: [FIC] }],
      ['ficha da filial', () => q(`update ficha_tecnica set nome = 'Só da filial, revista' where id = $1`, [id.fichaA2]), { a1: [], a2: [FIC] }],
      ['conversão de unidade do insumo', () => q(`update item_conversao set fator = 60 where id = $1`, [id.conversao]), { a1: [FIC], a2: [FIC] }],
    ];
    it.each(casos)('%s', async (_nome, mudar, esperado) => {
      const r = await depoisDe(mudar);
      expect({ a1: r.a1, a2: r.a2 }).toEqual(esperado);
      expect(r.b1).toEqual([]); // nunca a outra empresa
      expect(r.d1).toEqual([]);
    });

    // O ingrediente e o insumo mudam as DUAS leituras: um aviso por loja (o tipo é o de uma das duas).
    const dosDois: Array<[string, () => Promise<unknown>, { a1: number; a2: number }]> = [
      ['ingrediente de ficha da rede (quantidade)', () => q(`update ficha_ingrediente set quantidade = 2 where id = $1`, [id.ingRede]), { a1: 1, a2: 1 }],
      ['ingrediente novo em ficha da filial', () => ins('ficha_ingrediente', { tenant_id: A.tenant, ficha_id: id.fichaA2, insumo_nome: 'Sal', quantidade: '2', unidade: 'g' }), { a1: 0, a2: 1 }],
      ['insumo do estoque (nome)', () => q(`update item_estoque set nome = 'Pão brioche novo' where id = $1`, [id.itemPao]), { a1: 1, a2: 1 }],
    ];
    it.each(dosDois)('%s', async (_nome, mudar, esperado) => {
      const r = await depoisDe(mudar);
      expect({ a1: r.a1.length, a2: r.a2.length }).toEqual(esperado);
      for (const t of [...r.a1, ...r.a2]) expect([CAT, FIC]).toContain(t);
      expect(r.b1).toEqual([]);
      const tipos = (await q(`select distinct recurso from integracao_retrato_marca where tenant_id = $1 order by 1`, [A.tenant])).map((l) => l.recurso);
      expect(tipos).toEqual(['catalogo', 'fichas']);
    });

    it('produto que troca de loja avisa a que perdeu e a que ganhou', async () => {
      const p = await ins('produto', { tenant_id: A.tenant, unidade_id: A.lojas[0], nome: 'Vai mudar de loja', tipo: 'simples', preco_venda: '9' });
      const r = await depoisDe(() => q(`update produto set unidade_id = $2 where id = $1`, [p, A.lojas[1]]));
      expect({ a1: r.a1, a2: r.a2 }).toEqual({ a1: [CAT], a2: [CAT] });
    });

    it('empresa de uma loja só recebe sempre, mesmo quando o produto é da loja que fechou', async () => {
      const r = await depoisDe(() => q(`update produto set nome = 'D da loja antiga, revisto' where id = $1`, [id.pD2]));
      expect(r.d1).toEqual([CAT]);
      expect(r.a1).toEqual([]);
    });

    it('o aviso chega assinado, só com o tipo e a loja do token, e a posição avança', async () => {
      await zerar();
      await q(`update produto set nome = 'X-Burger assinado' where id = $1`, [id.pRede]);
      await naVez();
      expect(await ciclo()).toMatchObject({ enviados: 2, entregues: 2 });
      const r = recebidos.find((x) => x.caminho === '/v1/regem/avisos/conexao-a1') as Recebido;
      expect(JSON.parse(r.corpo)).toEqual({ tipo: CAT, loja_id: A.lojas[0] });
      expect(assinaturaConfere(r, regA1.segredo)).toBe(true);
      expect(r.cabecalhos['user-agent']).toBe('Regem-Integracao/1');
      const [l] = await q(`select entregues::int as entregues, ultimo_status_http, avisado_ate > registrado_em as avancou from integracao_webhook where token_id = $1`, [regA1.id]);
      expect(l).toMatchObject({ ultimo_status_http: 204, avancou: true });
      expect(l.entregues).toBeGreaterThan(0);
      // Sem mudança nova, o ciclo seguinte não manda nada.
      recebidos.length = 0;
      await naVez();
      expect(await ciclo()).toEqual({ enviados: 0, entregues: 0 });
      expect(recebidos).toHaveLength(0);
    });
  });

  // ───────────────────────────── o que NÃO avisa ─────────────────────────────

  describe('o que não muda nenhuma das duas leituras não avisa', () => {
    const calados: Array<[string, () => Promise<unknown>]> = [
      ['preço do produto', () => q(`update produto set preco_venda = 31, preco_custo = 12, preco_promocional = 29 where id = $1`, [id.pRede])],
      ['pausa do produto por estoque', () => q(`update produto set pausado_estoque = true, pausa_motivo = 'Estoque do insumo esgotado', updated_at = now() where id = $1`, [id.pRede])],
      ['custo médio do insumo (entrada de compra)', () => q(`update item_estoque set custo_medio = 9.99, updated_at = now() where id = $1`, [id.itemQueijo])],
      ['preço da variação', () => q(`update produto_variacao set preco_venda = 33 where id = $1`, [id.vRede])],
      ['custo do ingrediente', () => q(`update ficha_ingrediente set custo_unitario = 4.5, updated_at = now() where id = $1`, [id.ingRede])],
      ['preço de venda e meta de CMV da ficha', () => q(`update ficha_tecnica set preco_venda = 35, meta_cmv = 30 where id = $1`, [id.fichaRede])],
      ['custo e "esgotado" da opção reutilizável', () => q(`update opcao set preco_custo = 3, esgotado = true where id = $1`, [id.opcao])],
      ['regravar igual (o que o envio da loja faz com o que não mudou)', () =>
        q(`insert into categoria_produto (id, tenant_id, nome) select id, tenant_id, nome from categoria_produto where id = $1
           on conflict (id) do update set nome = excluded.nome, updated_at = now()`, [id.categoria])],
      ['alteração que não acha linha', () => q(`update produto set nome = 'ninguém' where id = $1`, [randomUUID()])],
    ];
    it.each(calados)('%s', async (_nome, mudar) => {
      const r = await depoisDe(mudar);
      expect(r).toEqual({ a1: [], a2: [], b1: [], d1: [] });
      expect(await fila([A.tenant])).toEqual([]);
    });
  });

  // ───────────────────────────── sincronismo, escopo, ritmo ─────────────────────────────

  describe('o que chega pelo sincronismo, o escopo e o ritmo', () => {
    it('a escrita no formato do envio da loja (insert … on conflict) avisa como a edição direta', async () => {
      const novo = randomUUID();
      const r = await depoisDe(() =>
        q(
          `insert into ficha_tecnica (id, tenant_id, unidade_id, nome, rendimento)
           values ($1, $2, null, 'Ficha que subiu da loja', 1), ($3, $2, $4, 'Só da filial, pelo sync', 4)
           on conflict (id) do update set nome = excluded.nome, rendimento = excluded.rendimento, updated_at = now()`,
          [novo, A.tenant, id.fichaA2, A.lojas[1]],
        ),
      );
      // Uma ficha nova da rede e uma da filial alterada, no mesmo lote: as duas lojas recebem.
      expect({ a1: r.a1, a2: r.a2 }).toEqual({ a1: [FIC], a2: [FIC] });
    });

    it('o aviso respeita o escopo do token: sem `fichas.ler` não vem `fichas.alterado`, e vice-versa', async () => {
      const E = await empresa('Empresa dos escopos', ['E1']);
      const p = await ins('produto', { tenant_id: E.tenant, nome: 'Produto', tipo: 'simples', preco_venda: '10' });
      const f = await ins('ficha_tecnica', { tenant_id: E.tenant, nome: 'Ficha', rendimento: '1' });
      await conectar(E, E.lojas[0], 'conexao-so-catalogo', ['catalogo.ler']);
      await conectar(E, E.lojas[0], 'conexao-so-fichas', ['fichas.ler']);
      await conectar(E, E.lojas[0], 'conexao-so-fila', ['producao.ler']);
      await depoisDe(() => q(`update ficha_tecnica set rendimento = 7 where id = $1`, [f]));
      expect(tiposDe('conexao-so-catalogo')).toEqual([]);
      expect(tiposDe('conexao-so-fichas')).toEqual([FIC]);
      expect(tiposDe('conexao-so-fila')).toEqual([]);
      await depoisDe(() => q(`update produto set nome = 'Produto novo' where id = $1`, [p]));
      expect(tiposDe('conexao-so-catalogo')).toEqual([CAT]);
      expect(tiposDe('conexao-so-fichas')).toEqual([]);
      expect(tiposDe('conexao-so-fila')).toEqual([]);
    });

    it('dez mudanças seguidas são um aviso por loja; a seguinte só depois do intervalo', async () => {
      await zerar();
      for (let i = 0; i < 10; i++) await q(`update produto set nome = $2 where id = $1`, [id.pRede, `X-Burger ${i}`]);
      await naVez();
      await ciclo();
      expect(tiposDe('conexao-a1')).toEqual([CAT]);
      expect(tiposDe('conexao-a2')).toEqual([CAT]);
      // Mudou de novo dentro do minuto: a loja não está na vez, nada sai…
      recebidos.length = 0;
      await q(`update produto set nome = 'X-Burger 11' where id = $1`, [id.pRede]);
      expect(await ciclo()).toEqual({ enviados: 0, entregues: 0 });
      expect(recebidos).toHaveLength(0);
      // …e, passada a vez, sai um.
      await naVez();
      await ciclo();
      expect(tiposDe('conexao-a1')).toEqual([CAT]);
    });

    it('a marca recém-carimbada espera o atraso de segurança antes de avisar', async () => {
      await zerar();
      svc.atrasoSeg = 15;
      await q(`update produto set nome = 'X-Burger com atraso' where id = $1`, [id.pRede]);
      await naVez();
      expect(await ciclo()).toEqual({ enviados: 0, entregues: 0 });
      const [m] = await q(`select count(*)::int as n from integracao_retrato_marca where tenant_id = $1`, [A.tenant]);
      expect(m.n).toBe(1); // a marca já existe; só não venceu o atraso
      svc.atrasoSeg = 0;
      await naVez();
      await ciclo();
      expect(tiposDe('conexao-a1')).toEqual([CAT]);
    });

    it('parado, o job não grava nada: fila vazia, nenhuma marca nova', async () => {
      await zerar();
      expect(await svc.carimbarRetratos({ tenantIds: empresas })).toBe(0);
      await naVez();
      expect(await ciclo()).toEqual({ enviados: 0, entregues: 0 });
      expect(await q(`select 1 from integracao_retrato_marca where tenant_id = any($1::uuid[])`, [empresas])).toEqual([]);
    });
  });

  // ───────────────────────────── o que isto NÃO liga, e o que não para ─────────────────────────────

  describe('o que o aviso do cardápio não liga e não derruba', () => {
    it('empresa só com o Farol: a cópia das vendas continua desligada (ERR-220)', async () => {
      const F = await empresa('Empresa só com o Farol', ['F1']);
      const p = await ins('produto', { tenant_id: F.tenant, nome: 'Produto', tipo: 'simples', preco_venda: '10' });
      await conectar(F, F.lojas[0], 'conexao-f1');
      await depoisDe(() => q(`update produto set nome = 'Produto alterado' where id = $1`, [p]));
      expect(tiposDe('conexao-f1')).toEqual([CAT]);
      for (const tabela of ['integracao_mudanca', 'integracao_versao', 'integracao_carga']) {
        const [l] = await q(`select count(*)::int as n from ${tabela} where tenant_id = $1`, [F.tenant]);
        expect([tabela, l.n]).toEqual([tabela, 0]);
      }
    });

    it('sem as tabelas da 316 o aviso das vendas segue: o passo novo se cala e a busca usa só as versões', async () => {
      const L = await empresa('Empresa do Liame', ['L1']);
      await conectar(L, L.lojas[0], 'conexao-liame', ['pedidos.ler'], 'liame');
      await zerar();
      await pool.query(`alter table ${SCHEMA}.integracao_retrato_mudanca rename to fila_ausente`);
      await pool.query(`alter table ${SCHEMA}.integracao_retrato_marca rename to marca_ausente`);
      try {
        await q(
          `insert into integracao_versao (recurso, recurso_id, tenant_id, fonte, unidade_id, versao, pendente, atualizado_em, situacao, foto)
           values ('venda', $1, $2, 'pedido_externo', $3, 1, false, clock_timestamp(), 'confirmado', '{}'::jsonb)`,
          [randomUUID(), L.tenant, L.lojas[0]],
        );
        await naVez();
        const r = await ciclo();
        expect(r.entregues).toBe(1);
        expect(tiposDe('conexao-liame', 'liame')).toEqual(['pedido.alterado']);
        expect((svc as any).retratosParadosAte).toBeGreaterThan(Date.now());
      } finally {
        await pool.query(`alter table ${SCHEMA}.fila_ausente rename to integracao_retrato_mudanca`);
        await pool.query(`alter table ${SCHEMA}.marca_ausente rename to integracao_retrato_marca`);
        (svc as any).retratosParadosAte = 0;
      }
      // Com as tabelas de volta, o cardápio volta a avisar.
      const r = await depoisDe(() => q(`update produto set nome = 'X-Burger de volta' where id = $1`, [id.pRede]));
      expect(r.a1).toEqual([CAT]);
    });
  });
});
