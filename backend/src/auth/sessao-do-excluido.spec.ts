import { randomUUID } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../db/schema';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

// SESSÃO DE QUEM FOI EXCLUÍDO (ERR-192) — contra Postgres (TEST_PG_URL). Excluir em Cadastros
// grava `deleted_at` e deixa o `status` em "ativo". O guard revalidava só o status: quem era
// excluído e já estava logado seguia com acesso até o token vencer (12 h), e entrava de novo
// pelo PIN. Aqui: a sessão cai quando o cache do guard vence, e o PIN é recusado.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
jest.setTimeout(60_000);

descrever('sessão de colaborador excluído (Postgres real)', () => {
  const empresas: string[] = [];
  let pool: Pool;
  let db: any;
  const jwt = new JwtService({ secret: 'segredo-de-teste', signOptions: { expiresIn: '12h' } });
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;

  async function empresa() {
    const id = randomUUID();
    await q(`insert into empresa (id, nome) values ($1, $2)`, [id, `Sessão teste ${id.slice(0, 6)}`]);
    empresas.push(id);
    return id;
  }
  async function pessoa(t: string, o: { pin?: string; unidadeId?: string } = {}) {
    const [{ id: funcao }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, 'gerente de teste', 'gerente') returning id`, [t]);
    const pinHash = o.pin ? await bcrypt.hash(o.pin, 4) : null;
    const [{ id }] = await q(
      `insert into colaborador (tenant_id, nome, funcao_id, unidade_id, pin_hash) values ($1, 'Pessoa de teste', $2, $3, $4) returning id`,
      [t, funcao, o.unidadeId ?? null, pinHash],
    );
    return id as string;
  }
  const token = (t: string, id: string) => jwt.sign({ sub: id, tenant: t, cat: 'gerente', perm: { relatorios_vendas: true } });
  // Uma requisição com o token: devolve o `req` que o guard preencheu.
  async function passar(guard: JwtAuthGuard, bearer: string) {
    const req: any = { headers: { authorization: `Bearer ${bearer}` } };
    await guard.canActivate({ switchToHttp: () => ({ getRequest: () => req }) } as any);
    return req;
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    db = drizzle(pool, { schema });
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    for (const id of empresas) {
      for (const tabela of ['audit_log', 'colaborador', 'funcao', 'unidade']) await q(`delete from ${tabela} where tenant_id = $1`, [id]);
      await q(`delete from empresa where id = $1`, [id]);
    }
    await pool.end();
  });

  it('colaborador ativo passa; o nível vem do banco', async () => {
    const t = await empresa();
    const id = await pessoa(t);
    const req = await passar(new JwtAuthGuard(jwt, db), token(t, id));
    expect(req.user).toMatchObject({ colaboradorId: id, tenantId: t, categoria: 'gerente' });
  });

  it('excluído em Cadastros: o MESMO token deixa de valer', async () => {
    const t = await empresa();
    const id = await pessoa(t);
    const bearer = token(t, id);
    await passar(new JwtAuthGuard(jwt, db), bearer); // estava logado e funcionando
    await q(`update colaborador set deleted_at = now() where id = $1`, [id]); // o que a rota de excluir faz
    expect((await q(`select status from colaborador where id = $1`, [id]))[0].status).toBe('ativo'); // o status não muda

    const erro = await passar(new JwtAuthGuard(jwt, db), bearer).catch((e) => e);
    expect(erro).toBeInstanceOf(UnauthorizedException);
    expect(erro.message).toMatch(/Acesso encerrado/);
  });

  it('a exclusão vale quando o cache de 30 s do guard vence (como o bloqueio)', async () => {
    const t = await empresa();
    const id = await pessoa(t);
    const bearer = token(t, id);
    const guard = new JwtAuthGuard(jwt, db);
    await passar(guard, bearer); // guarda o estado "ativo" por 30 s
    await q(`update colaborador set deleted_at = now() where id = $1`, [id]);

    await expect(passar(guard, bearer)).resolves.toBeDefined(); // dentro da janela, ainda passa
    const agora = Date.now();
    jest.spyOn(Date, 'now').mockReturnValue(agora + 31_000);
    await expect(passar(guard, bearer)).rejects.toThrow(/Acesso encerrado/);
  });

  it('bloqueado continua barrado (comportamento de antes)', async () => {
    const t = await empresa();
    const id = await pessoa(t);
    await q(`update colaborador set status = 'bloqueado' where id = $1`, [id]);
    await expect(passar(new JwtAuthGuard(jwt, db), token(t, id))).rejects.toThrow(/Acesso bloqueado/);
  });

  it('restaurado (deleted_at de volta a nulo) volta a passar', async () => {
    const t = await empresa();
    const id = await pessoa(t);
    await q(`update colaborador set deleted_at = now() where id = $1`, [id]);
    await expect(passar(new JwtAuthGuard(jwt, db), token(t, id))).rejects.toThrow(UnauthorizedException);
    await q(`update colaborador set deleted_at = null where id = $1`, [id]);
    await expect(passar(new JwtAuthGuard(jwt, db), token(t, id))).resolves.toBeDefined();
  });

  it('login por PIN: quem foi excluído não entra; o colega com outro PIN entra', async () => {
    const t = await empresa();
    const [{ id: unidade }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja de teste') returning id`, [t]);
    const excluido = await pessoa(t, { pin: '4321', unidadeId: unidade });
    const colega = await pessoa(t, { pin: '8765', unidadeId: unidade });
    const auditoria = { registrar: jest.fn().mockResolvedValue(undefined) };
    const auth = new (AuthService as any)(db, jwt, auditoria) as AuthService;

    const antes: any = await auth.pinLogin({ unidadeId: unidade, pin: '4321' });
    expect(jwt.decode(antes.access_token)).toMatchObject({ sub: excluido });

    await q(`update colaborador set deleted_at = now() where id = $1`, [excluido]);
    await expect(auth.pinLogin({ unidadeId: unidade, pin: '4321' })).rejects.toThrow(/PIN inválido/);
    expect(auditoria.registrar).toHaveBeenCalledWith(expect.objectContaining({ acao: 'pin_falhou' })); // conta para o bloqueio por tentativas

    const outro: any = await auth.pinLogin({ unidadeId: unidade, pin: '8765' });
    expect(jwt.decode(outro.access_token)).toMatchObject({ sub: colega });
  });
});
