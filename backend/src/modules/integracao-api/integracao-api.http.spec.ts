import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
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
import { BASE_TIPO_PROBLEMA, ProblemaFilter } from './problema';
import { LIMITE_INTEGRACAO_POR_MINUTO } from '../../common/integracao-limite';

/* eslint-disable @typescript-eslint/no-explicit-any */

// TOKEN DE INTEGRAÇÃO POR LOJA (trilha C, C1a) — contra o Postgres real e por HTTP de verdade
// (Nest com os guards globais de produção: limite por IP e CloudOnly).
//
// `integracao_token_loja` é só da NUVEM (mig 295, `-- @cloud-only`) e o banco do CI é montado
// como servidor de loja: a tabela vem da migration de verdade, num schema só deste teste, na
// frente do `public` — sem as chaves estrangeiras para `empresa`/`unidade` compartilhadas
// (LIC-088: com elas, o `delete` em cascata das outras specs atravessaria a cópia e o `drop
// schema` do fim entraria em impasse).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('integracao-api.http.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const MIG = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '295_integracao_token_loja.sql');
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

descrever('API de integração — token por loja', () => {
  const SCHEMA = `teste_integracao_${process.pid}_${Date.now()}`;
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  const db = drizzle(pool) as any;
  // Auditoria FALSA que guarda o que recebeu: o `audit_log` é append-only no banco (mig 023) —
  // com a de verdade, o `delete from empresa` do fim não conseguiria limpar as empresas do teste.
  // O conteúdo gravado é conferido aqui (e procurado pelo token no último teste).
  const registros: any[] = [];
  const auditoria = { registrar: async (e: any) => void registros.push(e) } as unknown as AuditoriaService;
  const svc = new IntegracaoTokenService(db, auditoria);
  const empresas: string[] = [];
  const emitidos: string[] = []; // todo token em claro deste teste — nenhum pode estar no banco
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const dist = { sub: randomUUID(), nome: 'Diretoria Teste', perfil: 'diretoria' };
  const edgeOriginal = process.env.EDGE_MODE;
  const cardapioOriginal = process.env.CARDAPIO_PUBLIC_URL;
  let app: INestApplication;
  let base = '';

  // Rota de TESTE com escopo exigido: prova o 403 por HTTP (as rotas de vendas e cupons que
  // exigem escopo entram nos próximos PRs).
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

  @Global()
  @Module({
    providers: [{ provide: DRIZZLE, useValue: db }, { provide: AuditoriaService, useValue: auditoria }],
    exports: [DRIZZLE, AuditoriaService],
  })
  class InfraTeste {}

  @Module({
    imports: [InfraTeste, ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]), IntegracaoApiModule],
    controllers: [RotaComEscopo],
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

  const chamar = (caminho: string, token?: string | null, init: RequestInit = {}) =>
    fetch(`${base}${caminho}`, {
      ...init,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) },
    });

  async function empresa(nome: string, lojas: string[]) {
    const [e] = await q(`insert into empresa (nome) values ($1) returning id`, [`${nome} ${randomUUID().slice(0, 6)}`]);
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
    return { tenant: e.id as string, lojas: ids };
  }

  async function pessoa(tenant: string, nome: string, categoria: string, perfilId: string | null = null) {
    const [f] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, $3) returning id`, [
      tenant,
      `${nome} (função)`,
      categoria,
    ]);
    const [c] = await q(
      `insert into colaborador (tenant_id, nome, funcao_id, perfil_acesso_id) values ($1, $2, $3, $4) returning id`,
      [tenant, nome, f.id, perfilId],
    );
    return c.id as string;
  }

  async function emitir(tenant: string, loja: string, presidente: string, escopos: string[]) {
    const r = await svc.emitir(
      { tenantId: tenant, unidadeId: loja, autorizadoPor: presidente, escopos, evidencia: 'autorização por escrito (teste)' },
      dist,
    );
    emitidos.push(r.token);
    return r;
  }

  let A: { tenant: string; lojas: string[] };
  let B: { tenant: string; lojas: string[] };
  let D: { tenant: string; lojas: string[] };
  let presA = '';
  let gerenteA = '';
  let presB = '';
  let presD = '';
  let cardapioA1 = '';
  let cardapioRedeD = '';

  beforeAll(async () => {
    delete process.env.EDGE_MODE; // a API é da NUVEM
    process.env.CARDAPIO_PUBLIC_URL = 'https://cardapio.teste';
    await pool.query(`create schema ${SCHEMA}`);
    await repetirNaCorridaDeCatalogo(() => pool.query(semFkCompartilhada(readFileSync(MIG, 'utf8'))));
    const [fk] = await q(
      `select count(*)::int n from pg_constraint c join pg_namespace s on s.oid = c.connamespace
        where s.nspname = $1 and c.contype = 'f'
          and c.confrelid in ('public.empresa'::regclass, 'public.unidade'::regclass)`,
      [SCHEMA],
    );
    if (fk.n) throw new Error('a cópia do integracao_token_loja ainda aponta para empresa/unidade compartilhadas');

    A = await empresa('Empresa A', ['A1 matriz', 'A2 filial', 'A3 fecha']);
    B = await empresa('Empresa B', ['B1']);
    D = await empresa('Empresa D', ['D1 única']);
    presA = await pessoa(A.tenant, 'Presidente A', 'presidente');
    gerenteA = await pessoa(A.tenant, 'Gerente A', 'gerente');
    presB = await pessoa(B.tenant, 'Presidente B', 'presidente');
    presD = await pessoa(D.tenant, 'Presidente D', 'presidente');
    cardapioA1 = `a1-${randomBytes(6).toString('hex')}`;
    cardapioRedeD = `d-${randomBytes(6).toString('hex')}`;
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo) values ($1, $2, $3, true)`, [
      A.tenant,
      A.lojas[0],
      cardapioA1,
    ]);
    // Cardápio da REDE (sem loja) numa empresa de loja única: vende para a D1.
    await q(`insert into cardapio_config (tenant_id, unidade_id, token, ativo) values ($1, null, $2, true)`, [
      D.tenant,
      cardapioRedeD,
    ]);
    ({ app, base } = await subir());
  });

  afterAll(async () => {
    await app?.close();
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
    if (cardapioOriginal === undefined) delete process.env.CARDAPIO_PUBLIC_URL;
    else process.env.CARDAPIO_PUBLIC_URL = cardapioOriginal;
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]);
    await pool.query(`drop schema if exists ${SCHEMA} cascade`);
    await pool.end();
  }, 120_000);

  describe('emissão pelo console (diretoria da distribuição)', () => {
    it('emite: o token sai uma vez, o banco guarda o hash e a empresa vê no log dela', async () => {
      const r = await emitir(A.tenant, A.lojas[0], presA, ['pedidos.ler', 'custos.ler']);
      expect(r.token).toMatch(/^rgm_it_[A-Za-z0-9_-]{43}$/);
      const [linha] = await q(`select * from integracao_token_loja where id = $1`, [r.id]);
      expect(linha).toMatchObject({
        tenant_id: A.tenant,
        unidade_id: A.lojas[0],
        cliente: 'liame',
        prefixo: r.token.slice(0, 12),
        escopos: ['pedidos.ler', 'custos.ler'],
        autorizado_por: presA,
        autorizado_por_nome: 'Presidente A',
        autorizado_via: 'console_distribuicao',
        emitido_por_dist: dist.sub,
        revogado_em: null,
      });
      const log = registros.filter((e) => e.tenantId === A.tenant && e.acao === 'integracao.token_emitido');
      expect(log).toHaveLength(1);
      expect(log[0]).toMatchObject({ atorTipo: 'distribuicao', atorId: dist.sub, entidadeId: r.id });
      expect(log[0].detalhe).toMatchObject({ prefixo: r.prefixo, autorizadoPor: 'Presidente A' });
    });

    it('recusa: escopo vazio ou desconhecido, loja de outra empresa, quem não é presidente, sem evidência', async () => {
      const base0 = { tenantId: A.tenant, unidadeId: A.lojas[0], autorizadoPor: presA, evidencia: 'ok, autorizado' };
      await expect(svc.emitir({ ...base0, escopos: [] }, dist)).rejects.toThrow(/ao menos um escopo/);
      await expect(svc.emitir({ ...base0, escopos: ['pedidos.ler', 'tudo'] }, dist)).rejects.toThrow(/tudo/);
      await expect(svc.emitir({ ...base0, unidadeId: B.lojas[0], escopos: ['pedidos.ler'] }, dist)).rejects.toThrow(
        /Loja não encontrada nesta empresa/,
      );
      await expect(svc.emitir({ ...base0, autorizadoPor: presB, escopos: ['pedidos.ler'] }, dist)).rejects.toThrow(
        /presidente ativo desta empresa/,
      );
      await expect(svc.emitir({ ...base0, autorizadoPor: gerenteA, escopos: ['pedidos.ler'] }, dist)).rejects.toThrow(
        /presidente ativo desta empresa/,
      );
      await expect(svc.emitir({ ...base0, evidencia: '  ', escopos: ['pedidos.ler'] }, dist)).rejects.toThrow(
        /autorização do presidente/,
      );
      await expect(svc.emitir({ ...base0, tenantId: 'x', escopos: ['pedidos.ler'] }, dist)).rejects.toThrow(/tenantId/);
    });

    it('custos.ler só com presidente que vê valores em R$ (perfil de hoje)', async () => {
      const C = await empresa('Empresa C', ['C1']);
      const [perfil] = await q(
        `insert into perfil_acesso (tenant_id, nome, nivel, permissoes) values ($1, 'Presidente sem R$', 'presidente', $2)
         returning id`,
        [C.tenant, JSON.stringify({ dashboard: true, ver_financeiro: false })],
      );
      const presC = await pessoa(C.tenant, 'Presidente C', 'presidente', perfil.id);
      const pedido = { tenantId: C.tenant, unidadeId: C.lojas[0], autorizadoPor: presC, evidencia: 'autorizado (teste)' };
      await expect(svc.emitir({ ...pedido, escopos: ['pedidos.ler', 'custos.ler'] }, dist)).rejects.toThrow(
        /Ver valores em R\$/,
      );
      const ok = await svc.emitir({ ...pedido, escopos: ['pedidos.ler'] }, dist);
      emitidos.push(ok.token);
      expect(ok.escopos).toEqual(['pedidos.ler']);
    });

    it('o painel da empresa mostra só as lojas, os presidentes e os tokens DELA', async () => {
      await emitir(B.tenant, B.lojas[0], presB, ['pedidos.ler']);
      const p = await svc.painelEmpresa(A.tenant);
      expect(p.lojas.map((l: any) => l.id).sort()).toEqual([...A.lojas].sort());
      expect(p.presidentes.map((x) => x.id)).toEqual([presA]); // o gerente não aparece
      expect(p.tokens.length).toBeGreaterThan(0);
      expect(p.tokens.every((t: any) => A.lojas.includes(t.lojaId))).toBe(true);
      expect(JSON.stringify(p)).not.toContain('token_hash');
    });
  });

  describe('por HTTP', () => {
    it('GET /integracao/loja devolve a loja do token (e só ela), com o cardápio dela', async () => {
      const a1 = await emitir(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
      const r = await chamar(`/integracao/loja?loja_id=${B.lojas[0]}&tenantId=${B.tenant}`, a1.token);
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({
        loja_id: A.lojas[0],
        loja_nome: 'A1 matriz',
        empresa_nome: expect.stringMatching(/^Empresa A /),
        fuso: 'America/Sao_Paulo',
        moeda: 'BRL',
        escopos: ['pedidos.ler'],
        cardapio_url: `https://cardapio.teste/c/${cardapioA1}`,
      });
    });

    it('uma loja não lê a outra: cada token só vê a própria loja e empresa', async () => {
      const a2 = await emitir(A.tenant, A.lojas[1], presA, ['cupons.ler']);
      const b1 = await emitir(B.tenant, B.lojas[0], presB, ['cupons.ler']);
      const ra2: any = await (await chamar('/integracao/loja', a2.token)).json();
      const rb1: any = await (await chamar('/integracao/loja', b1.token)).json();
      expect(ra2.loja_id).toBe(A.lojas[1]);
      expect(ra2.cardapio_url).toBeNull(); // a filial não tem cardápio próprio nem recebe o da rede
      expect(rb1.loja_id).toBe(B.lojas[0]);
      expect(rb1.empresa_nome).toMatch(/^Empresa B /);
      expect(JSON.stringify(rb1)).not.toContain(A.tenant);
    });

    it('cardápio da rede (sem loja) vale para a loja que recebe os pedidos dele', async () => {
      const d1 = await emitir(D.tenant, D.lojas[0], presD, ['pedidos.ler']);
      const r: any = await (await chamar('/integracao/loja', d1.token)).json();
      expect(r.cardapio_url).toBe(`https://cardapio.teste/c/${cardapioRedeD}`);
    });

    it('sem token, formato errado ou token desconhecido → 401 problem+json', async () => {
      for (const t of [null, 'abc', `rgm_it_${randomBytes(32).toString('base64url')}`]) {
        const r = await chamar('/integracao/loja', t);
        expect(r.status).toBe(401);
        expect(r.headers.get('content-type')).toContain('application/problem+json');
        const corpo: any = await r.json();
        expect(corpo).toMatchObject({ type: `${BASE_TIPO_PROBLEMA}token-invalido`, title: 'Token inválido', status: 401 });
      }
    });

    it('revogado, vencido e loja apagada → 401 em todas as rotas', async () => {
      const revogado = await emitir(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
      await svc.revogarPeloConsole(revogado.id, 'teste de revogação', dist);
      const vencido = await emitir(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
      await q(`update integracao_token_loja set expira_em = now() - interval '1 minute' where id = $1`, [vencido.id]);
      const lojaApagada = await emitir(A.tenant, A.lojas[2], presA, ['pedidos.ler']);
      await q(`update unidade set deleted_at = now() where id = $1`, [A.lojas[2]]);
      for (const t of [revogado.token, vencido.token, lojaApagada.token]) {
        const g = await chamar('/integracao/loja', t);
        const p = await chamar('/integracao/autorizacao/revogar', t, { method: 'POST' });
        expect([g.status, p.status]).toEqual([401, 401]);
        expect(((await p.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}token-invalido`);
      }
    });

    it('escopo que a rota exige e o token não tem → 403 problem+json', async () => {
      const t = await emitir(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
      const r = await chamar('/integracao/teste-escopo', t.token);
      expect(r.status).toBe(403);
      const corpo: any = await r.json();
      expect(corpo.type).toBe(`${BASE_TIPO_PROBLEMA}escopo-insuficiente`);
      expect(corpo.detail).toContain('cupons.criar');
      const com = await emitir(A.tenant, A.lojas[0], presA, ['cupons.criar']);
      expect((await chamar('/integracao/teste-escopo', com.token)).status).toBe(200);
    });

    it('POST /integracao/autorizacao/revogar: a integração desliga o próprio token', async () => {
      const t = await emitir(B.tenant, B.lojas[0], presB, ['pedidos.ler']);
      const r = await chamar('/integracao/autorizacao/revogar', t.token, { method: 'POST' });
      expect(r.status).toBe(200);
      const corpo: any = await r.json();
      expect(corpo.revogado).toBe(true);
      expect(corpo.revogado_em).toBeTruthy();
      expect((await chamar('/integracao/loja', t.token)).status).toBe(401); // vale na chamada seguinte
      const [linha] = await q(`select revogado_por, motivo_revogacao from integracao_token_loja where id = $1`, [t.id]);
      expect(linha.revogado_por).toBe('integracao:liame');
      const log = registros.filter((e) => e.acao === 'integracao.token_revogado' && e.entidadeId === t.id);
      expect(log.map((e) => [e.tenantId, e.atorTipo])).toEqual([[B.tenant, 'integracao']]);
    });

    it('revogar pelo console é idempotente', async () => {
      const t = await emitir(B.tenant, B.lojas[0], presB, ['pedidos.ler']);
      expect((await svc.revogarPeloConsole(t.id, 'primeira vez', dist)).jaRevogado).toBe(false);
      expect((await svc.revogarPeloConsole(t.id, 'de novo', dist)).jaRevogado).toBe(true);
      await expect(svc.revogarPeloConsole(randomUUID(), 'não existe', dist)).rejects.toThrow(/não encontrado/);
    });

    it('limite do token: a 61ª chamada no minuto → 429 problem+json com Retry-After', async () => {
      const t = await emitir(D.tenant, D.lojas[0], presD, ['pedidos.ler']);
      for (let i = 0; i < LIMITE_INTEGRACAO_POR_MINUTO; i++) {
        const r = await chamar('/integracao/loja', t.token);
        expect(r.status).toBe(200);
      }
      const r = await chamar('/integracao/loja', t.token);
      expect(r.status).toBe(429);
      expect(Number(r.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
      expect(((await r.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}limite-de-chamadas`);
    });

    it('limite por IP: esgotado, barra quem não tem token válido (429 problem+json) e NÃO o token válido', async () => {
      const t = await emitir(D.tenant, D.lojas[0], presD, ['pedidos.ler']);
      const outra = await subir(); // balde de IP próprio: não atrapalha os outros testes
      const em = (token: string | null) =>
        fetch(`${outra.base}/integracao/loja`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
      try {
        expect((await em(t.token)).status).toBe(200); // valida o token (1 chamada no balde do IP)
        let r: Response | null = null;
        for (let i = 0; i < 130 && (!r || r.status !== 429); i++) r = await em('invalido');
        expect(r!.status).toBe(429);
        expect(r!.headers.get('content-type')).toContain('application/problem+json');
        expect(Number(r!.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
        expect(((await r!.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}limite-de-chamadas`);
        // O token já validado segue passando: o limite dele é o próprio (60/min).
        expect((await em(t.token)).status).toBe(200);
        // Token bem formado mas desconhecido continua no balde do IP (esgotado).
        expect((await em(`rgm_it_${randomBytes(32).toString('base64url')}`)).status).toBe(429);
      } finally {
        await outra.app.close();
      }
    });

    it('servidor da loja (EDGE_MODE=true): a rota não existe (404)', async () => {
      const t = await emitir(A.tenant, A.lojas[0], presA, ['pedidos.ler']);
      process.env.EDGE_MODE = 'true';
      const edge = await subir();
      try {
        const r = await fetch(`${edge.base}/integracao/loja`, { headers: { authorization: `Bearer ${t.token}` } });
        expect(r.status).toBe(404);
        // O 404 vem do guard GLOBAL (CloudOnly) e ainda sai no formato do contrato.
        expect(r.headers.get('content-type')).toContain('application/problem+json');
        expect(((await r.json()) as any).type).toBe(`${BASE_TIPO_PROBLEMA}nao-encontrado`);
      } finally {
        await edge.app.close();
        delete process.env.EDGE_MODE;
      }
    });
  });

  it('o banco não guarda o token: nenhum dos emitidos aparece em coluna nenhuma (nem na auditoria)', async () => {
    expect(emitidos.length).toBeGreaterThan(5);
    const tokens = await q(`select row_to_json(t)::text as j from integracao_token_loja t`);
    const tudo = [...tokens.map((x) => x.j), ...registros.map((e) => JSON.stringify(e))].join('\n');
    for (const t of emitidos) {
      expect(tudo).not.toContain(t);
      expect(tudo).not.toContain(t.slice(12)); // nem a parte secreta
    }
  });
});
