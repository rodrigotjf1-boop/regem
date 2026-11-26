import { randomUUID } from 'node:crypto';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { DRIZZLE } from '../db/drizzle.module';
import * as schema from '../db/schema';
import { AuditoriaService } from '../modules/auditoria/auditoria.service';
import { MisterTelasService, TEXTOS_DAS_TELAS, recusaDaTela } from '../modules/mister/mister-telas.service';
import type { EscopoDoMister } from '../modules/mister/mister-ferramentas.service';
import { UnidadeController } from '../modules/unidade/unidade.controller';
import { UnidadeService } from '../modules/unidade/unidade.service';
import { CABECALHO_DO_BILHETE, bilhetesVivos, emitirBilhete, resumoDoCorpo } from './bilhete-do-mister';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O BILHETE DO MISTER DE PONTA A PONTA (versão 10, C3) — contra Postgres (TEST_PG_URL), com um servidor HTTP de verdade em
// 127.0.0.1: o `UnidadeController` (uma leitura `le` do mapa, com `JwtAuthGuard`, `RolesGuard` e `PermissoesGuard`), o banco
// e o `MisterTelasService`. Prova que a leitura vale a pessoa lida no banco AGORA, só da empresa dela, e que o bilhete não
// serve duas vezes, em outro caminho, em outro método, forjado, nem para quem foi bloqueado ou não tem a permissão da tela.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('bilhete-do-mister-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('o bilhete do Mister lê a tela como a pessoa (Postgres e HTTP de verdade)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let app: INestApplication;
  let telas: MisterTelasService;
  let base = '';
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  /** Uma empresa com uma loja e uma pessoa (o perfil dá o nível e as permissões). */
  async function empresa(nivel: 'presidente' | 'gerente', permissoes: Record<string, unknown>) {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [t, `Bilhete ${t.slice(0, 6)}`]);
    empresas.push(t);
    const [{ id: loja }] = await q(`insert into unidade (tenant_id, nome) values ($1, $2) returning id`, [t, `Loja ${t.slice(0, 6)}`]);
    const [{ id: perfil }] = await q(`insert into perfil_acesso (tenant_id, nome, nivel, login_web, permissoes) values ($1, 'perfil de teste', $2, true, $3::jsonb) returning id`, [
      t,
      nivel,
      JSON.stringify(permissoes),
    ]);
    const [{ id }] = await q(`insert into colaborador (tenant_id, nome, perfil_acesso_id) values ($1, 'Pessoa de teste', $2) returning id`, [t, perfil]);
    return { t, id: id as string, loja: loja as string, nomeDaLoja: `Loja ${t.slice(0, 6)}` };
  }
  const escopo = (p: { t: string; id: string }, nivel: 'presidente' | 'gerente' = 'presidente'): EscopoDoMister =>
    ({ tenantId: p.t, colaboradorId: p.id, empresa: 'x', nome: 'x', nivel, lojas: [], lojaUnica: true, presa: null, semLoja: false, permissoes: {} as any, verValores: true }) as EscopoDoMister;
  const LOJA = { atual: null, nome: 'a loja' };

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    const db = drizzle(pool, { schema });
    @Module({
      controllers: [UnidadeController],
      providers: [
        UnidadeService,
        MisterTelasService,
        { provide: DRIZZLE, useValue: db },
        { provide: JwtService, useValue: new JwtService({ secret: 'segredo-de-teste' }) },
        { provide: AuditoriaService, useValue: { registrar: async () => undefined } },
      ],
    })
    class ModuloDoTeste {}
    app = await NestFactory.create(ModuloDoTeste, { logger: false });
    app.setGlobalPrefix('api/v1');
    await app.listen(0, '127.0.0.1');
    base = `http://127.0.0.1:${(app.getHttpServer().address() as any).port}`;
    telas = app.get(MisterTelasService);
  });
  afterAll(async () => {
    await app?.close();
    for (const id of empresas) {
      for (const tabela of ['audit_log', 'colaborador', 'perfil_acesso', 'unidade']) await q(`delete from ${tabela} where tenant_id = $1`, [id]);
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool?.end();
  });

  it('o presidente lê as lojas da empresa DELE (a outra empresa não aparece) e o bilhete se gasta', async () => {
    const a = await empresa('presidente', {});
    const b = await empresa('presidente', {});
    const r = await telas.ler(escopo(a), { rota: 'GET /api/v1/unidades' }, LOJA);
    expect(r.ok).toBe(true);
    const nomes = (r.dados.resposta as any[]).map((l) => l.nome);
    expect(nomes).toContain(a.nomeDaLoja);
    expect(nomes).not.toContain(b.nomeDaLoja);
    expect(r.dados.tela).toBe('As lojas da empresa');
    expect(bilhetesVivos()).toBe(0);
  });

  it('o bilhete forjado, o reaproveitado, o de outro caminho e o de outro método recebem 401', async () => {
    const a = await empresa('presidente', {});
    const forjado = await fetch(`${base}/api/v1/unidades`, { headers: { [CABECALHO_DO_BILHETE]: 'a'.repeat(64) } });
    expect(forjado.status).toBe(401);

    const um = emitirBilhete({ tenantId: a.t, colaboradorId: a.id, caminho: '/api/v1/unidades' });
    expect((await fetch(`${base}/api/v1/unidades`, { headers: { [CABECALHO_DO_BILHETE]: um } })).status).toBe(200);
    expect((await fetch(`${base}/api/v1/unidades`, { headers: { [CABECALHO_DO_BILHETE]: um } })).status).toBe(401);

    const outroCaminho = emitirBilhete({ tenantId: a.t, colaboradorId: a.id, caminho: '/api/v1/unidades?x=1' });
    expect((await fetch(`${base}/api/v1/unidades`, { headers: { [CABECALHO_DO_BILHETE]: outroCaminho } })).status).toBe(401);
    // Gastou na primeira tentativa: nem o caminho certo abre depois.
    expect((await fetch(`${base}/api/v1/unidades?x=1`, { headers: { [CABECALHO_DO_BILHETE]: outroCaminho } })).status).toBe(401);

    const escrever = emitirBilhete({ tenantId: a.t, colaboradorId: a.id, caminho: '/api/v1/unidades' });
    const post = await fetch(`${base}/api/v1/unidades`, { method: 'POST', headers: { [CABECALHO_DO_BILHETE]: escrever, 'content-type': 'application/json' }, body: JSON.stringify({ nome: 'Invasora' }) });
    expect(post.status).toBe(401);
    expect(await q(`select 1 from unidade where tenant_id = $1 and nome = 'Invasora'`, [a.t])).toHaveLength(0);
    expect(bilhetesVivos()).toBe(0);
  });

  it('o bilhete de uma empresa com a pessoa de OUTRA empresa não abre nada', async () => {
    const a = await empresa('presidente', {});
    const b = await empresa('presidente', {});
    const misturado = emitirBilhete({ tenantId: a.t, colaboradorId: b.id, caminho: '/api/v1/unidades' });
    expect((await fetch(`${base}/api/v1/unidades`, { headers: { [CABECALHO_DO_BILHETE]: misturado } })).status).toBe(401);
  });

  it('quem foi bloqueado ou excluído agora não lê (a pessoa é lida no banco a cada bilhete, sem cache)', async () => {
    const a = await empresa('presidente', {});
    expect((await telas.ler(escopo(a), { rota: 'GET /api/v1/unidades' }, LOJA)).ok).toBe(true);
    await q(`update colaborador set status = 'bloqueado' where id = $1`, [a.id]);
    expect(await telas.ler(escopo(a), { rota: 'GET /api/v1/unidades' }, LOJA)).toEqual(recusaDaTela(TEXTOS_DAS_TELAS.semPermissao));
    await q(`update colaborador set status = 'ativo', deleted_at = now() where id = $1`, [a.id]);
    expect(await telas.ler(escopo(a), { rota: 'GET /api/v1/unidades' }, LOJA)).toEqual(recusaDaTela(TEXTOS_DAS_TELAS.semPermissao));
  });

  it('o gerente sem a permissão da tela recebe a recusa do perfil (as mesmas travas da tela)', async () => {
    const g = await empresa('gerente', {});
    expect(await telas.ler(escopo(g, 'gerente'), { rota: 'GET /api/v1/unidades' }, LOJA)).toEqual(recusaDaTela(TEXTOS_DAS_TELAS.semPermissao));
    const comPermissao = await empresa('gerente', { unidades: true });
    const r = await telas.ler(escopo(comPermissao, 'gerente'), { rota: 'GET /api/v1/unidades' }, LOJA);
    expect(r.ok).toBe(true);
  });

  it('C4: a escrita pela API com o bilhete preso ao método e ao corpo — grava a certa; o corpo trocado e o método trocado recebem 401', async () => {
    const a = await empresa('presidente', {});
    const r = await telas.escrever(escopo(a), 'POST', '/api/v1/unidades', { nome: 'Loja pelo Mister', tipo: 'loja' }, null);
    expect(r?.status).toBe(201);
    expect(await q(`select 1 from unidade where tenant_id = $1 and nome = 'Loja pelo Mister'`, [a.t])).toHaveLength(1);
    // O bilhete de um corpo não abre outro corpo, nem outro método.
    const id = emitirBilhete({ tenantId: a.t, colaboradorId: a.id, caminho: '/api/v1/unidades', metodo: 'POST', corpoHash: resumoDoCorpo({ nome: 'Uma', tipo: 'loja' }) });
    const trocado = await fetch(`${base}/api/v1/unidades`, { method: 'POST', headers: { [CABECALHO_DO_BILHETE]: id, 'content-type': 'application/json' }, body: JSON.stringify({ nome: 'Outra', tipo: 'loja' }) });
    expect(trocado.status).toBe(401);
    const id2 = emitirBilhete({ tenantId: a.t, colaboradorId: a.id, caminho: '/api/v1/unidades', metodo: 'POST', corpoHash: resumoDoCorpo({ nome: 'Uma', tipo: 'loja' }) });
    const get = await fetch(`${base}/api/v1/unidades`, { headers: { [CABECALHO_DO_BILHETE]: id2 } });
    expect(get.status).toBe(401);
    expect(await q(`select nome from unidade where tenant_id = $1 and nome in ('Uma', 'Outra')`, [a.t])).toEqual([]);
    // O gerente sem a permissão: a mesma trava da tela (403).
    const g = await empresa('gerente', {});
    expect((await telas.escrever(escopo(g, 'gerente'), 'POST', '/api/v1/unidades', { nome: 'Não', tipo: 'loja' }, null))?.status).toBe(403);
    expect(bilhetesVivos()).toBe(0);
  });

  it('com a sessão do PIN pendente, a leitura espera o PIN e nem chama a API', async () => {
    const a = await empresa('presidente', {});
    expect(await telas.ler({ ...escopo(a), pinPendente: true }, { rota: 'GET /api/v1/unidades' }, LOJA)).toEqual(recusaDaTela(TEXTOS_DAS_TELAS.esperaOPin));
    expect(bilhetesVivos()).toBe(0);
  });
});
