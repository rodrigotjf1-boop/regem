import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { RealtimeGateway } from '../modules/realtime/realtime.gateway';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { esquecerMemoriaDasSessoes } from './sessao-encerrada';

/* eslint-disable @typescript-eslint/no-explicit-any */

// SAIR ENCERRA A SESSÃO NO SERVIDOR (R3-01 da 3ª rodada de segurança, 19/11/2026; ERR-534; mig 457) — contra Postgres
// (TEST_PG_URL). A rodada mostrou: /auth/me com o cookie → 200; /auth/logout → apaga o cookie; a MESMA cópia do cookie,
// guardada antes → 200 de novo. Agora a sessão nasce com um número (`jti`) e "Sair" o encerra no servidor: o guarda das
// rotas e o tempo real recusam a cópia, mesmo noutro processo (pelo banco); as outras sessões da pessoa seguem.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('sessao-encerrada-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('sair encerra a sessão no servidor (Postgres real)', () => {
  const empresas: string[] = [];
  const jtis: string[] = [];
  let pool: Pool;
  let db: any;
  const jwt = new JwtService({ secret: 'segredo-de-teste', signOptions: { expiresIn: '12h' } });
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const auditadas: any[] = [];
  const avisos: any[] = [];
  let service: AuthService;

  async function pessoa() {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [t, `Sair teste ${t.slice(0, 6)}`]);
    empresas.push(t);
    const [{ id: funcao }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'gerente de teste', 'gerente') returning id`, [t]);
    const [{ id }] = await q(`insert into colaborador (tenant_id, nome, funcao_id) values ($1, 'Pessoa de teste', $2) returning id`, [t, funcao]);
    return { t, id: id as string };
  }
  // O token como o login emite (`AuthService.assinar`, o mesmo do login por senha e por PIN).
  function sessao(p: { t: string; id: string }): string {
    const { access_token } = (service as any).assinar({
      colaboradorId: p.id, tenantId: p.t, categoria: 'gerente', setorId: null, unidadeId: null, permissoes: {}, nome: 'Pessoa', funcaoNome: 'Gerente',
    });
    jtis.push((jwt.decode(access_token) as any).jti);
    return access_token;
  }
  async function passar(bearer: string, guard = new JwtAuthGuard(jwt, db)) {
    const req: any = { headers: { authorization: `Bearer ${bearer}` } };
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any);
    return req;
  }
  const recusa = (bearer: string, guard?: JwtAuthGuard) => passar(bearer, guard).then(() => null, (e) => e);

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    const auditoria = { registrar: async (r: any) => void auditadas.push(r) } as any;
    const eventos = { emit: (ev: string, p: any) => void avisos.push([ev, p]) } as any;
    service = new AuthService(db, jwt, auditoria, eventos);
  });
  beforeEach(() => {
    auditadas.length = 0;
    avisos.length = 0;
  });
  afterAll(async () => {
    if (jtis.length) await q(`delete from sessao_encerrada where jti = any($1::uuid[])`, [jtis]);
    for (const id of empresas) {
      for (const tabela of ['audit_log', 'colaborador', 'funcao']) await q(`delete from ${tabela} where tenant_id = $1`, [id]);
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool.end();
  });

  it('cada sessão nasce com o número dela (jti), diferente a cada entrada', async () => {
    const p = await pessoa();
    const a = jwt.decode(sessao(p)) as any;
    const b = jwt.decode(sessao(p)) as any;
    expect(a.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.jti).not.toBe(b.jti);
  });

  it('a rodada: a cópia do token guardada antes de sair é recusada depois — na hora e por outro guarda', async () => {
    const p = await pessoa();
    const copia = sessao(p);
    await passar(copia); // logado e funcionando
    expect(await service.sair(copia)).toEqual({ encerrada: true });
    const e = await recusa(copia, new JwtAuthGuard(jwt, db)); // outra instância do guarda (outro módulo do Nest)
    expect(e).toBeInstanceOf(UnauthorizedException);
    expect(e.message).toBe('Sessão encerrada. Entre de novo.');
    // auditoria e o aviso ao tempo real
    expect(auditadas).toEqual([expect.objectContaining({ tenantId: p.t, atorId: p.id, acao: 'sessao_encerrada', tipo: 'auth' })]);
    expect(avisos).toEqual([['sessao.encerrada', { jti: (jwt.decode(copia) as any).jti }]]);
  });

  it('vale pelo banco também (outro processo, sem a memória deste): a linha fica com o vencimento do token', async () => {
    const p = await pessoa();
    const copia = sessao(p);
    await service.sair(copia);
    esquecerMemoriaDasSessoes();
    const e = await recusa(copia);
    expect(e?.message).toBe('Sessão encerrada. Entre de novo.');
    const { jti, exp } = jwt.decode(copia) as any;
    const [linha] = await q(`select extract(epoch from expira_em)::bigint as exp from sessao_encerrada where jti = $1`, [jti]);
    expect(Number(linha.exp)).toBe(exp);
  });

  it('a conferência "não encerrada" guardada há pouco não segura a saída feita AQUI (a memória vale na hora)', async () => {
    const p = await pessoa();
    const copia = sessao(p);
    esquecerMemoriaDasSessoes();
    await passar(copia); // grava "não estava encerrada" por 30 s
    await service.sair(copia);
    expect((await recusa(copia))?.message).toBe('Sessão encerrada. Entre de novo.');
  });

  it('a outra sessão da mesma pessoa (outro aparelho) continua', async () => {
    const p = await pessoa();
    const pc = sessao(p);
    const celular = sessao(p);
    await service.sair(pc);
    esquecerMemoriaDasSessoes();
    const req = await passar(celular);
    expect(req.user).toMatchObject({ colaboradorId: p.id, tenantId: p.t });
  });

  it('sair é idempotente e nunca falha: a segunda saída não audita de novo; ausente, lixo e vencido não encerram nada', async () => {
    const p = await pessoa();
    const copia = sessao(p);
    expect(await service.sair(copia)).toEqual({ encerrada: true });
    expect(await service.sair(copia)).toEqual({ encerrada: false });
    expect(auditadas).toHaveLength(1);
    expect(await service.sair(undefined)).toEqual({ encerrada: false });
    expect(await service.sair('lixo')).toEqual({ encerrada: false });
    const vencido = jwt.sign({ sub: p.id, tenant: p.t, cat: 'gerente', jti: randomUUID() }, { expiresIn: -10 });
    expect(await service.sair(vencido)).toEqual({ encerrada: false });
    const forjado = new JwtService({ secret: 'outro-segredo' }).sign({ sub: p.id, tenant: p.t, cat: 'gerente', jti: randomUUID() });
    expect(await service.sair(forjado)).toEqual({ encerrada: false });
  });

  it('o token emitido antes desta mudança (sem jti) segue até vencer — não há o que encerrar', async () => {
    const p = await pessoa();
    const antigo = jwt.sign({ sub: p.id, tenant: p.t, cat: 'gerente' });
    expect(await service.sair(antigo)).toEqual({ encerrada: false });
    const req = await passar(antigo);
    expect(req.user.colaboradorId).toBe(p.id);
  });

  it('a saída varre as linhas vencidas há mais de um dia (a tabela não cresce para sempre)', async () => {
    const velha = randomUUID();
    jtis.push(velha);
    await q(`insert into sessao_encerrada (jti, expira_em) values ($1, now() - interval '2 days')`, [velha]);
    const p = await pessoa();
    await service.sair(sessao(p));
    expect(await q(`select 1 from sessao_encerrada where jti = $1`, [velha])).toHaveLength(0);
  });

  it('a rota: o cookie (nuvem) ou o Bearer (servidor da loja) — os dois encerram, e o cookie é apagado', async () => {
    const p = await pessoa();
    const controller = new AuthController(service);
    const apagados: string[] = [];
    const res: any = { clearCookie: (nome: string) => apagados.push(nome) };
    const doCookie = sessao(p);
    const r1 = await controller.logout({ headers: { cookie: `regem_sess=${encodeURIComponent(doCookie)}` } } as any, res);
    expect(r1).toEqual({ ok: true, encerrada: true });
    expect(apagados).toEqual(['regem_sess']);
    const doBearer = sessao(p);
    const r2 = await controller.logout({ headers: { authorization: `Bearer ${doBearer}` } } as any, res);
    expect(r2).toEqual({ ok: true, encerrada: true });
    esquecerMemoriaDasSessoes();
    for (const t of [doCookie, doBearer]) expect((await recusa(t))?.message).toBe('Sessão encerrada. Entre de novo.');
    // sem nada: só apaga o cookie
    expect(await controller.logout({ headers: {} } as any, res)).toEqual({ ok: true, encerrada: false });
  });

  it('o tempo real (V97): a sessão encerrada não entra, pelo banco; a ativa entra', async () => {
    const p = await pessoa();
    const g = new RealtimeGateway(jwt as any, {} as any, undefined, db);
    (g as any).server = { to: () => ({ emit: () => undefined }) };
    const conectar = async (token: string) => {
      const salas: string[] = [];
      let derrubado = false;
      const erros: any[] = [];
      await g.handleConnection({
        handshake: { auth: { jwt: token }, headers: {} },
        data: {},
        join: (s: string) => salas.push(s),
        emit: (ev: string, x: any) => erros.push([ev, x]),
        disconnect: () => { derrubado = true; },
      } as any);
      return { salas, derrubado, erros };
    };
    const copia = sessao(p);
    const ativa = sessao(p);
    await service.sair(copia);
    esquecerMemoriaDasSessoes();
    const r = await conectar(copia);
    expect([r.salas, r.derrubado, r.erros]).toEqual([[], true, [['erro', { motivo: 'sessão encerrada' }]]]);
    const ok = await conectar(ativa);
    expect(ok.derrubado).toBe(false);
    expect(ok.salas).toEqual(expect.arrayContaining([`tenant:${p.t}`, `sessao:${(jwt.decode(ativa) as any).jti}`]));
  });
});
