import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ColaboradorService } from './colaborador.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A HIERARQUIA NO CADASTRO DE COLABORADORES, contra o Postgres real (avaliação interna de segurança, 16/11/2026).
//
// O nível de quem entra é o do PERFIL de acesso (`perfil_acesso.nivel`); a função só vale quando não há perfil. O
// cadastro conferia o nível só pela FUNÇÃO escolhida e aceitava qualquer perfil da empresa no `perfilAcessoId`: um
// gerente criava um login com o perfil do presidente (ou outro gerente, com o próprio perfil). E a exclusão não conferia
// hierarquia nenhuma: um gerente excluía o presidente. Prova-se:
//   • gerente NÃO cria com perfil de nível igual ou acima do dele, mesmo com função de execução; abaixo, cria;
//   • presidente cria com qualquer perfil (sociedade);
//   • gerente NÃO exclui presidente nem outro gerente; exclui quem está abaixo;
//   • ninguém exclui a si mesmo (não sobra empresa sem presidente); presidente exclui outro presidente.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('colaborador-hierarquia-pg.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('colaboradores: a hierarquia no cadastro e na exclusão (Postgres real)', () => {
  let pool: Pool;
  let svc: ColaboradorService;
  const T = randomUUID();
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const funcoes: Record<string, string> = {};
  const perfis: Record<string, string> = {};
  const pessoas: Record<string, string> = {};
  const NIVEIS = ['presidente', 'gerente', 'supervisao', 'execucao'];

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG, max: 3 });
    const db = drizzle(pool, { schema }) as any;
    svc = new ColaboradorService(db, { registrar: async () => undefined } as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste hierarquia de colaboradores')`, [T]);
    await q(`insert into unidade (tenant_id, nome, tipo) values ($1, 'Loja', 'matriz')`, [T]);
    for (const n of NIVEIS) {
      [{ id: funcoes[n] }] = await q(`insert into funcao (tenant_id, nome, categoria) values ($1, $2, $3) returning id`, [T, `Função ${n}`, n]);
      [{ id: perfis[n] }] = await q(
        `insert into perfil_acesso (tenant_id, nome, nivel, login_web, permissoes) values ($1, $2, $3, true, '{}'::jsonb) returning id`,
        [T, `Perfil ${n}`, n],
      );
    }
    for (const [chave, nivel] of [['presidente', 'presidente'], ['socio', 'presidente'], ['gerente', 'gerente'], ['outroGerente', 'gerente'], ['atendente', 'execucao']]) {
      [{ id: pessoas[chave] }] = await q(
        `insert into colaborador (tenant_id, nome, funcao_id, perfil_acesso_id) values ($1, $2, $3, $4) returning id`,
        [T, `Pessoa ${chave}`, funcoes[nivel], perfis[nivel]],
      );
    }
  });

  afterAll(async () => {
    await q(`delete from colaborador_funcao where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from colaborador where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from perfil_acesso where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from funcao where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from unidade where tenant_id = $1`, [T]).catch(() => {});
    await q(`delete from empresa where id = $1`, [T]).catch(() => {});
    await pool.end();
  });

  const comoGerente = () => ({ colaboradorId: pessoas.gerente, categoria: 'gerente' });
  const comoPresidente = () => ({ colaboradorId: pessoas.presidente, categoria: 'presidente' });
  const novo = (perfil: string | undefined, sufixo: string) =>
    ({ nome: `Novo ${sufixo}`, funcaoId: funcoes.execucao, perfilAcessoId: perfil, usuario: `novo.${sufixo}`, senha: 'senha-de-teste' }) as any;
  const existe = async (usuario: string) => (await q(`select 1 from colaborador where tenant_id = $1 and usuario = $2`, [T, usuario])).length === 1;

  it('gerente NÃO cria colaborador com o perfil do presidente, mesmo escolhendo uma função de execução', async () => {
    await expect(svc.create(T, novo(perfis.presidente, 'presidente'), 'gerente', null, comoGerente())).rejects.toBeInstanceOf(ForbiddenException);
    expect(await existe('novo.presidente')).toBe(false);
  });

  it('gerente NÃO cria colaborador com perfil do próprio nível; abaixo do dele, cria', async () => {
    await expect(svc.create(T, novo(perfis.gerente, 'gerente'), 'gerente', null, comoGerente())).rejects.toBeInstanceOf(ForbiddenException);
    expect(await existe('novo.gerente')).toBe(false);
    const ok = await svc.create(T, novo(perfis.supervisao, 'supervisao'), 'gerente', null, comoGerente());
    expect(ok.perfilAcessoId).toBe(perfis.supervisao);
    // Sem perfil informado: o do nível da função, como sempre.
    const semPerfil = await svc.create(T, novo(undefined, 'semperfil'), 'gerente', null, comoGerente());
    expect(semPerfil.perfilAcessoId).toBe(perfis.execucao);
  });

  it('presidente cria com qualquer perfil (sociedade)', async () => {
    const ok = await svc.create(T, novo(perfis.presidente, 'socio2'), 'presidente', null, comoPresidente());
    expect(ok.perfilAcessoId).toBe(perfis.presidente);
  });

  it('gerente NÃO exclui o presidente nem outro gerente; exclui quem está abaixo', async () => {
    await expect(svc.remove(T, pessoas.presidente, comoGerente())).rejects.toBeInstanceOf(ForbiddenException);
    await expect(svc.remove(T, pessoas.outroGerente, comoGerente())).rejects.toBeInstanceOf(ForbiddenException);
    const [vivos] = await q(`select count(*)::int as n from colaborador where id = any($1::uuid[]) and deleted_at is null`, [[pessoas.presidente, pessoas.outroGerente]]);
    expect(vivos.n).toBe(2);
    await expect(svc.remove(T, pessoas.atendente, comoGerente())).resolves.toEqual({ ok: true });
  });

  it('ninguém exclui a si mesmo; presidente exclui outro presidente', async () => {
    await expect(svc.remove(T, pessoas.presidente, comoPresidente())).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.remove(T, pessoas.gerente, comoGerente())).rejects.toBeInstanceOf(BadRequestException);
    await expect(svc.remove(T, pessoas.socio, comoPresidente())).resolves.toEqual({ ok: true });
    const [p] = await q(`select deleted_at is null as vivo from colaborador where id = $1`, [pessoas.presidente]);
    expect(p.vivo).toBe(true);
  });

  it('sem dizer quem está excluindo, a exclusão é recusada (a regra não tem atalho)', async () => {
    await expect(svc.remove(T, pessoas.outroGerente)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
