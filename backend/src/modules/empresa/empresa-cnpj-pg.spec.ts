import { randomBytes } from 'crypto';
import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { ROLES_KEY } from '../../auth/roles.decorator';
import { CLOUD_ONLY } from '../../common/cloud-only.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { CNPJ_DE_OUTRA, CNPJ_JA_EXISTE, EmpresaService } from './empresa.service';
import { EmpresaController } from './empresa.controller';
import { InformarCnpjDto } from './dto/informar-cnpj.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// GR-8 do DMS Graph (protótipo aprovado em 19/11/2026): o presidente informa o CNPJ da empresa que está sem, uma vez.
// Contra o Postgres real (TEST_PG_URL): os dígitos, a Receita (falsa), o índice único `empresa_cnpj_key` (outra empresa
// com o mesmo número → 409), a gravação condicional (duas abas ao mesmo tempo: uma grava) e a auditoria. E a rota: só o
// presidente, só na nuvem, e o DTO que passa pelo `ValidationPipe` da API (V100).

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('empresa-cnpj-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

/** Um CNPJ inventado com os dígitos certos, montado na hora (nunca escrito no arquivo). */
function cnpjDeTeste(): string {
  const base = Array.from(randomBytes(12), (b) => String(b % 10)).join('');
  const dv = (b: string) => {
    let soma = 0;
    let peso = b.length - 7;
    for (const c of b) {
      soma += Number(c) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base);
  return `${base}${d1}${dv(base + d1)}`;
}
const comMascara = (c: string) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;

descrever('o CNPJ da empresa que está sem (GR-8, Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const auditados: any[] = [];
  const auditoria = { registrar: async (e: any) => void auditados.push(e) } as any;
  const svc = new EmpresaService(db, auditoria);
  let receita: (c: string) => Promise<any> = async () => ({ estado: 'existe', situacao: 'ATIVA' });
  svc.consultarReceita = ((c: unknown) => receita(String(c))) as any;
  const empresas: string[] = [];

  async function empresa(cnpj: string | null = null) {
    const t = (await q(`insert into empresa (nome, cnpj) values ('Mister teste', $1) returning id`, [cnpj]))[0].id as string;
    empresas.push(t);
    return { t, ana: { tenantId: t, colaboradorId: null, categoria: 'presidente', nome: 'Ana' } as any };
  }

  beforeEach(() => {
    auditados.length = 0;
    receita = async () => ({ estado: 'existe', situacao: 'ATIVA' });
  });

  afterAll(async () => {
    if (empresas.length) await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    await pool.end();
  });

  it('sem CNPJ: grava só os 14 números (veio com máscara), audita; repetir recusa — trocar é do suporte', async () => {
    const { t, ana } = await empresa();
    const c = cnpjDeTeste();
    expect(await svc.informarCnpj(ana, comMascara(c))).toEqual({ cnpj: c });
    expect((await q(`select cnpj from empresa where id = $1`, [t]))[0].cnpj).toBe(c);
    expect(auditados).toEqual([expect.objectContaining({ tenantId: t, acao: 'informou_cnpj_da_empresa', entidadeTipo: 'empresa', detalhe: { cnpj: c, receita: 'existe' } })]);
    await expect(svc.informarCnpj(ana, cnpjDeTeste())).rejects.toMatchObject({ status: 409, message: CNPJ_JA_EXISTE });
    expect((await q(`select cnpj from empresa where id = $1`, [t]))[0].cnpj).toBe(c);
  });

  it('dígitos errados, Receita "não existe" e baixado: recusa sem gravar; Receita fora do ar não barra (como a landing)', async () => {
    const { t, ana } = await empresa();
    const c = cnpjDeTeste();
    const errado = `${c.slice(0, 13)}${(Number(c[13]) + 1) % 10}`;
    await expect(svc.informarCnpj(ana, errado)).rejects.toMatchObject({ status: 400, message: expect.stringMatching(/dígitos não batem/) });
    await expect(svc.informarCnpj(ana, '11111111111111')).rejects.toMatchObject({ status: 400 });
    receita = async () => ({ estado: 'nao_existe' });
    await expect(svc.informarCnpj(ana, c)).rejects.toMatchObject({ status: 400, message: 'Este CNPJ não existe na Receita.' });
    receita = async () => ({ estado: 'existe', situacao: 'BAIXADA' });
    await expect(svc.informarCnpj(ana, c)).rejects.toMatchObject({ status: 400, message: 'Este CNPJ está baixado na Receita.' });
    expect((await q(`select cnpj from empresa where id = $1`, [t]))[0].cnpj).toBeNull();
    expect(auditados).toEqual([]);
    receita = async () => ({ estado: 'indeterminado' });
    expect(await svc.informarCnpj(ana, c)).toEqual({ cnpj: c });
    expect(auditados[0].detalhe).toEqual({ cnpj: c, receita: 'indeterminado' });
  });

  it('outra empresa já usa o número: o índice único recusa (409) e nada muda', async () => {
    const c = cnpjDeTeste();
    await empresa(c);
    const { t, ana } = await empresa();
    await expect(svc.informarCnpj(ana, c)).rejects.toMatchObject({ status: 409, message: CNPJ_DE_OUTRA });
    expect((await q(`select cnpj from empresa where id = $1`, [t]))[0].cnpj).toBeNull();
    expect(auditados).toEqual([]);
  });

  it('duas abas ao mesmo tempo, CNPJs diferentes: só uma grava, a outra recebe 409 (o cruzamento forçado — V98)', async () => {
    const { t, ana } = await empresa();
    const [a, b] = [cnpjDeTeste(), cnpjDeTeste()];
    // As duas leem a empresa SEM CNPJ e só seguem para a gravação quando as duas chegaram aqui: sem a gravação
    // condicional, as duas gravariam (a segunda por cima da primeira).
    let chegaram = 0;
    let soltar!: () => void;
    const barreira = new Promise<void>((r) => (soltar = r));
    receita = async () => {
      chegaram++;
      if (chegaram === 2) soltar();
      await barreira;
      return { estado: 'existe', situacao: 'ATIVA' };
    };
    const r = await Promise.allSettled([svc.informarCnpj(ana, a), svc.informarCnpj(ana, b)]);
    const ok = r.filter((x) => x.status === 'fulfilled');
    const recusa = r.filter((x) => x.status === 'rejected') as PromiseRejectedResult[];
    expect([ok.length, recusa.length]).toEqual([1, 1]);
    expect(recusa[0].reason).toMatchObject({ status: 409 });
    const gravado = (await q(`select cnpj from empresa where id = $1`, [t]))[0].cnpj;
    expect([a, b]).toContain(gravado);
    expect((ok[0] as PromiseFulfilledResult<any>).value).toEqual({ cnpj: gravado });
    expect(auditados).toHaveLength(1);
  });
});

describe('a rota do CNPJ da empresa (RBAC no servidor, só nuvem, DTO)', () => {
  const rota = (EmpresaController.prototype as any).informarCnpj;

  it('login, perfil e permissão; só o presidente; só na nuvem', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, EmpresaController)).toEqual([JwtAuthGuard, RolesGuard, PermissoesGuard]);
    expect(Reflect.getMetadata(ROLES_KEY, rota)).toEqual(['presidente']);
    expect(Reflect.getMetadata(CLOUD_ONLY, rota)).toBe(true);
    const guarda = new RolesGuard(new Reflector());
    const contexto = (categoria: string) =>
      ({ getHandler: () => rota, getClass: () => EmpresaController, switchToHttp: () => ({ getRequest: () => ({ user: { categoria } }) }) }) as any;
    for (const categoria of ['gerente', 'suporte', 'supervisao', 'execucao']) {
      let erro: any = null;
      try {
        guarda.canActivate(contexto(categoria));
      } catch (e) {
        erro = e;
      }
      expect(erro).toBeInstanceOf(ForbiddenException);
    }
    expect(guarda.canActivate(contexto('presidente'))).toBe(true);
  });

  it('o corpo passa pelo mesmo ValidationPipe da API e o cnpj chega (V100); sem cnpj, recusa', async () => {
    const pipe = new ValidationPipe({ whitelist: true, transform: true });
    const meta = { type: 'body', metatype: InformarCnpjDto } as any;
    expect(await pipe.transform({ cnpj: '00.000.000/0000-00', extra: 'sai' }, meta)).toEqual({ cnpj: '00.000.000/0000-00' });
    await expect(pipe.transform({}, meta)).rejects.toBeTruthy();
    await expect(pipe.transform({ cnpj: 'x'.repeat(21) }, meta)).rejects.toBeTruthy();
  });
});
