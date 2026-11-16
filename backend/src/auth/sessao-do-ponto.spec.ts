import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { pinGeraSessaoSoDoPonto, rotaDoTerminalDePonto, SESSAO_SO_DO_PONTO } from './sessao-do-ponto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A SESSÃO DO TERMINAL DE PONTO (avaliação de segurança de 16/11/2026, A-03): na nuvem, o PIN de quem não tem o acesso
// online (`pode_nuvem`) gera uma sessão que só serve para enviar a foto e marcar o ponto. Antes, o login por senha
// recusava essa pessoa e o PIN lhe abria a API inteira.

describe('sessão do terminal de ponto: as regras', () => {
  it('só na nuvem, só para quem não tem o acesso online e não é presidente', () => {
    expect(pinGeraSessaoSoDoPonto({ servidorDaLoja: false, nivel: 'gerente', podeNuvem: false })).toBe(true);
    expect(pinGeraSessaoSoDoPonto({ servidorDaLoja: false, nivel: 'execucao', podeNuvem: null })).toBe(true);
    expect(pinGeraSessaoSoDoPonto({ servidorDaLoja: false, nivel: 'gerente', podeNuvem: true })).toBe(false);
    expect(pinGeraSessaoSoDoPonto({ servidorDaLoja: false, nivel: 'presidente', podeNuvem: false })).toBe(false);
    // no servidor da loja, o PIN entra como sempre (a operação da loja é local)
    expect(pinGeraSessaoSoDoPonto({ servidorDaLoja: true, nivel: 'gerente', podeNuvem: false })).toBe(false);
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

  it('na nuvem, com o acesso online: o PIN gera a sessão de sempre', async () => {
    delete process.env.EDGE_MODE;
    const { unidade, pessoa } = await loja();
    await pessoa('5678', true);
    const r: any = await auth.pinLogin({ unidadeId: unidade, pin: '5678' });
    expect((jwt.decode(r.access_token) as any).so).toBeUndefined();
    await expect(chamar(r.access_token, 'GET', '/api/v1/colaboradores')).resolves.toBeDefined();
  });

  it('no servidor da loja: o PIN gera a sessão de sempre, mesmo sem o acesso online', async () => {
    process.env.EDGE_MODE = 'true';
    const { unidade, pessoa } = await loja();
    await pessoa('2468', false);
    const r: any = await auth.pinLogin({ unidadeId: unidade, pin: '2468' });
    expect((jwt.decode(r.access_token) as any).so).toBeUndefined();
    await expect(chamar(r.access_token, 'GET', '/api/v1/colaboradores')).resolves.toBeDefined();
  });
});
