import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { rotaDoTerminalDePonto, SESSAO_SO_DO_PONTO, tokenAbreOTempoReal } from './sessao-do-ponto';
import { RealtimeGateway } from '../modules/realtime/realtime.gateway';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A SESSÃO DO TERMINAL DE PONTO (avaliação de segurança de 16/11/2026, A-03 e, na segunda rodada, B-01): o PIN gera
// SEMPRE uma sessão que só serve para enviar a foto e marcar o ponto — na nuvem e no servidor da loja, para qualquer
// nível — e que não abre o tempo real. Antes, o PIN abria a API inteira com o perfil da pessoa.

describe('sessão do terminal de ponto: as regras', () => {
  it('o tempo real só aceita a sessão geral: nem a de um uso só (`so`), nem a presa a um aparelho (`ap`)', () => {
    expect(tokenAbreOTempoReal({})).toBe(true);
    expect(tokenAbreOTempoReal({ so: undefined, ap: null } as any)).toBe(true);
    expect(tokenAbreOTempoReal({ so: SESSAO_SO_DO_PONTO })).toBe(false);
    expect(tokenAbreOTempoReal({ so: 'marca-futura' })).toBe(false);
    expect(tokenAbreOTempoReal({ ap: 'aparelho' })).toBe(false);
    expect(tokenAbreOTempoReal(null)).toBe(false);
    expect(tokenAbreOTempoReal(undefined)).toBe(false);
  });

  it('as rotas do terminal: enviar a foto e marcar o ponto, por POST; o resto não', () => {
    expect(rotaDoTerminalDePonto({ method: 'POST', originalUrl: '/api/v1/ponto/marcar' })).toBe(true);
    expect(rotaDoTerminalDePonto({ method: 'post', originalUrl: '/api/v1/midia/upload?x=1' })).toBe(true);
    expect(rotaDoTerminalDePonto({ method: 'POST', url: '/api/v1/ponto/marcar/' })).toBe(true);
    for (const [method, originalUrl] of [
      ['GET', '/api/v1/ponto/marcar'],
      ['POST', '/api/v1/ponto/marcar/outra'],
      ['POST', '/api/v1/ponto/ajustes'],
      ['GET', '/api/v1/colaboradores'],
      ['POST', '/api/v1/colaboradores'],
      ['POST', '/api/v1/midia/upload/../../colaboradores'],
      ['POST', '/api/v2/ponto/marcar'],
      ['POST', ''],
    ]) {
      expect([method, originalUrl, rotaDoTerminalDePonto({ method, originalUrl })]).toEqual([method, originalUrl, false]);
    }
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
// A limpeza apaga cada empresa de teste em cascata (umas 160 tabelas filhas): com o banco ocupado, passa dos 5 s padrão.
jest.setTimeout(60_000);
if (!URL_PG) console.warn('sessao-do-ponto.spec: sem TEST_PG_URL — a parte com Postgres foi PULADA');

descrever('sessão do terminal de ponto: o PIN e o guarda (Postgres real)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let db: any;
  let auth: AuthService;
  const jwt = new JwtService({ secret: 'segredo-de-teste', signOptions: { expiresIn: '12h' } });
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const edgeOriginal = process.env.EDGE_MODE;

  async function loja() {
    const t = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [t, `Ponto teste ${t.slice(0, 6)}`]);
    empresas.push(t);
    const [{ id: unidade }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja de teste') returning id`, [t]);
    const [{ id: funcao }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'gerente de teste', 'gerente') returning id`, [t]);
    const pessoa = async (pin: string, podeNuvem: boolean) => {
      const [{ id }] = await q(
        `insert into colaborador (tenant_id, nome, funcao_id, unidade_id, pin_hash, pode_nuvem) values ($1, 'Pessoa de teste', $2, $3, $4, $5) returning id`,
        [t, funcao, unidade, await bcrypt.hash(pin, 4), podeNuvem],
      );
      return id as string;
    };
    return { t, unidade, pessoa };
  }
  /** Passa o token pelo guarda numa rota; devolve o `req` preenchido (ou lança a recusa). */
  async function chamar(bearer: string, method: string, originalUrl: string) {
    const req: any = { method, originalUrl, headers: { authorization: `Bearer ${bearer}` } };
    await new JwtAuthGuard(jwt, db).canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any);
    return req;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
    auth = new (AuthService as any)(db, jwt, { registrar: async () => undefined }) as AuthService;
  });
  afterEach(() => {
    if (edgeOriginal === undefined) delete process.env.EDGE_MODE;
    else process.env.EDGE_MODE = edgeOriginal;
  });
  afterAll(async () => {
    for (const id of empresas) {
      for (const tabela of ['audit_log', 'colaborador', 'funcao', 'unidade']) await q(`delete from ${tabela} where tenant_id = $1`, [id]);
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool.end();
  });

  it('na nuvem, sem o acesso online: o PIN entra, mas a sessão só marca o ponto e envia a foto', async () => {
    delete process.env.EDGE_MODE;
    const { unidade, pessoa } = await loja();
    const id = await pessoa('4321', false);
    const r: any = await auth.pinLogin({ unidadeId: unidade, pin: '4321' });
    expect(jwt.decode(r.access_token)).toMatchObject({ sub: id, so: SESSAO_SO_DO_PONTO });
    // o que o terminal faz depois do PIN passa
    await expect(chamar(r.access_token, 'POST', '/api/v1/midia/upload')).resolves.toBeDefined();
    await expect(chamar(r.access_token, 'POST', '/api/v1/ponto/marcar')).resolves.toBeDefined();
    // o resto da API, não (era o contorno do `pode_nuvem`)
    for (const [metodo, rota] of [['GET', '/api/v1/colaboradores'], ['GET', '/api/v1/auth/me'], ['POST', '/api/v1/colaboradores'], ['GET', '/api/v1/financeiro/resumo']]) {
      await expect(chamar(r.access_token, metodo, rota)).rejects.toBeInstanceOf(ForbiddenException);
    }
  });

  // SEGUNDA RODADA: a primeira versão deixava de fora quem tem o acesso online, o presidente e o servidor da loja — e
  // o PIN (4 a 6 dígitos, 10 erros a cada 5 minutos) se acerta em horas. Agora vale para todos.
  it('na nuvem, com o acesso online: o PIN também gera a sessão só do ponto', async () => {
    delete process.env.EDGE_MODE;
    const { unidade, pessoa } = await loja();
    await pessoa('5678', true);
    const r: any = await auth.pinLogin({ unidadeId: unidade, pin: '5678' });
    expect((jwt.decode(r.access_token) as any).so).toBe(SESSAO_SO_DO_PONTO);
    await expect(chamar(r.access_token, 'POST', '/api/v1/ponto/marcar')).resolves.toBeDefined();
    await expect(chamar(r.access_token, 'GET', '/api/v1/colaboradores')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('o presidente: o PIN dele também só marca o ponto (a gestão é pela senha)', async () => {
    delete process.env.EDGE_MODE;
    const { t, unidade } = await loja();
    const [{ id: funcao }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'Presidente', 'presidente') returning id`, [t]);
    await q(`insert into colaborador (tenant_id, nome, funcao_id, pin_hash, pode_nuvem) values ($1, 'Dono de teste', $2, $3, true)`, [t, funcao, await bcrypt.hash('1357', 4)]);
    const r: any = await auth.pinLogin({ unidadeId: unidade, pin: '1357' });
    expect(jwt.decode(r.access_token)).toMatchObject({ cat: 'presidente', so: SESSAO_SO_DO_PONTO });
    await expect(chamar(r.access_token, 'GET', '/api/v1/financeiro/resumo')).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('no servidor da loja: o PIN gera a mesma sessão só do ponto', async () => {
    process.env.EDGE_MODE = 'true';
    const { unidade, pessoa } = await loja();
    await pessoa('2468', false);
    const r: any = await auth.pinLogin({ unidadeId: unidade, pin: '2468' });
    expect((jwt.decode(r.access_token) as any).so).toBe(SESSAO_SO_DO_PONTO);
    await expect(chamar(r.access_token, 'POST', '/api/v1/midia/upload')).resolves.toBeDefined();
    await expect(chamar(r.access_token, 'GET', '/api/v1/colaboradores')).rejects.toBeInstanceOf(ForbiddenException);
  });

  // B-01: o guarda das rotas recusava a sessão do ponto e o tempo real aceitava o mesmo token. Aqui com o JWT de
  // verdade, o gateway de verdade e o banco de verdade (a consulta do "segue com acesso" confere as colunas reais).
  describe('o tempo real', () => {
    async function conectar(bearer: string) {
      const salas: string[] = [];
      let derrubado = false;
      const g = new RealtimeGateway(jwt, {} as any, undefined, db);
      (g as any).server = { to: () => ({ emit: () => undefined }) };
      const sock: any = { handshake: { auth: { jwt: bearer }, headers: {} }, data: {}, join: (s: string) => salas.push(s), emit: () => undefined, disconnect: () => { derrubado = true; } };
      await g.handleConnection(sock);
      return { salas, derrubado };
    }
    const sessaoGeral = (t: string, id: string, unidade: string) => jwt.sign({ sub: id, tenant: t, cat: 'gerente', uni: unidade });

    it('a sessão do PIN não entra em sala nenhuma; a sessão geral da mesma pessoa entra', async () => {
      delete process.env.EDGE_MODE;
      const { t, unidade, pessoa } = await loja();
      const id = await pessoa('9753', false);
      const doPin: any = await auth.pinLogin({ unidadeId: unidade, pin: '9753' });
      expect(await conectar(doPin.access_token)).toEqual({ salas: [], derrubado: true });
      const geral = await conectar(sessaoGeral(t, id, unidade));
      expect(geral.derrubado).toBe(false);
      expect(geral.salas).toEqual(expect.arrayContaining([`tenant:${t}`, `unidade:${unidade}`]));
    });

    it('quem foi excluído ou bloqueado depois de entrar não abre mais o tempo real com o token que ficou', async () => {
      const { t, unidade, pessoa } = await loja();
      const excluido = await pessoa('1111', true);
      const bloqueado = await pessoa('2222', true);
      const tokenDoExcluido = sessaoGeral(t, excluido, unidade);
      const tokenDoBloqueado = sessaoGeral(t, bloqueado, unidade);
      expect((await conectar(tokenDoExcluido)).derrubado).toBe(false);
      await q(`update colaborador set deleted_at = now() where id = $1`, [excluido]);
      await q(`update colaborador set status = 'bloqueado' where id = $1`, [bloqueado]);
      expect(await conectar(tokenDoExcluido)).toEqual({ salas: [], derrubado: true });
      expect(await conectar(tokenDoBloqueado)).toEqual({ salas: [], derrubado: true });
    });
  });
});
