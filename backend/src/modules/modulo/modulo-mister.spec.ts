import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { MODULOS, ModuloService } from './modulo.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// MÓDULO "MISTER" — contra Postgres (TEST_PG_URL). Protótipo `mockups/regem-mister.html`, aprovado em 13/11/2026.
//
// É o primeiro módulo que NASCE DESLIGADO: até o presidente ligar em Visão C&O, o item "Mister" não aparece no menu de
// ninguém. O que se confere: desligado sem ninguém ter escolhido (na rede e em cada loja); os outros módulos continuam
// nascendo ligados; o presidente liga na rede e uma loja pode ficar de fora; o plano contratado não o limita (ele não é
// vendido à parte); e ligar/desligar vai à auditoria.

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('modulo-mister.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('módulo Mister: nasce desligado, o presidente liga, o plano não limita (Postgres real)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const auditados: any[] = [];
  const modulos = new ModuloService(db, { registrar: async (e: any) => void auditados.push(e) } as any);
  const empresas: string[] = [];
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);

  afterAll(async () => {
    if (empresas.length) {
      for (const t of ['modulo_ativacao', 'ativacao', 'unidade']) await pool.query(`delete from ${t} where tenant_id = any($1::uuid[])`, [empresas]).catch(() => {});
      await pool.query('delete from empresa where id = any($1::uuid[])', [empresas]).catch(() => {});
    }
    await pool.end();
  });

  async function empresa() {
    const t = (await q(`insert into empresa (nome) values ('teste modulo mister') returning id`))[0].id as string;
    empresas.push(t);
    const loja = async (nome: string) => (await q(`insert into unidade (tenant_id, nome) values ($1,$2) returning id`, [t, nome]))[0].id as string;
    const a = await loja('Loja Centro'), b = await loja('Loja Barra');
    const presidente = (unidadeId: string | null = null) => ({ tenantId: t, colaboradorId: randomUUID(), categoria: 'presidente', unidadeId }) as any;
    return { t, a, b, presidente };
  }

  it('está na lista, com o padrão desligado; os outros módulos seguem nascendo ligados', () => {
    expect(MODULOS.find((m) => m.chave === 'mister')).toEqual({ chave: 'mister', label: 'Mister', emoji: '✨', padrao: false });
    expect(MODULOS.filter((m) => m.padrao === false).map((m) => m.chave)).toEqual(['mister']);
  });

  it('nasce DESLIGADO na rede e em cada loja, sem ninguém ter escolhido nada', async () => {
    const e = await empresa();
    expect(await modulos.ativo(e.t, null, 'mister')).toBe(false);
    expect(await modulos.ativo(e.t, e.a, 'mister')).toBe(false);
    const estado: any = await modulos.estado(e.t);
    expect(estado.rede.mister).toBe(false);
    expect(estado.modulos.map((m: any) => m.chave)).toContain('mister');
    const meus = await modulos.meus(e.presidente());
    expect(meus.mister).toBe(false);
    // o que já existia não muda de padrão
    expect(estado.rede).toMatchObject({ mesas: true, kds: true, app_colaborador: true, vagas: true });
    expect(meus).toMatchObject({ mesas: true, kds: true });
    expect(await modulos.ativo(e.t, null, 'modulo_que_nao_existe')).toBe(true);
  });

  it('o presidente liga na rede; uma loja pode ficar de fora; desligar volta ao que era', async () => {
    const e = await empresa();
    auditados.length = 0;
    await modulos.setar(e.presidente(), { modulo: 'mister', ativo: true });
    expect(await modulos.ativo(e.t, null, 'mister')).toBe(true);
    expect(await modulos.ativo(e.t, e.a, 'mister')).toBe(true);
    expect((await modulos.meus(e.presidente(e.b))).mister).toBe(true);
    expect(auditados).toEqual([expect.objectContaining({ acao: 'modulo_ativado', detalhe: { modulo: 'mister', escopo: 'rede' } })]);

    await modulos.setar(e.presidente(), { modulo: 'mister', ativo: false, unidadeId: e.b });
    expect(await modulos.ativo(e.t, e.b, 'mister')).toBe(false);
    expect(await modulos.ativo(e.t, e.a, 'mister')).toBe(true);
    expect((await modulos.estado(e.t) as any).porUnidade[e.b]).toEqual({ mister: false });

    await modulos.setar(e.presidente(), { modulo: 'mister', ativo: false });
    expect(await modulos.ativo(e.t, e.a, 'mister')).toBe(false);
    expect((await modulos.estado(e.t) as any).rede.mister).toBe(false);
  });

  it('a loja pode ligar sozinha, com a rede no padrão (desligado)', async () => {
    const e = await empresa();
    await modulos.setar(e.presidente(), { modulo: 'mister', ativo: true, unidadeId: e.a });
    expect(await modulos.ativo(e.t, e.a, 'mister')).toBe(true);
    expect(await modulos.ativo(e.t, e.b, 'mister')).toBe(false);
    expect(await modulos.ativo(e.t, null, 'mister')).toBe(false);
  });

  it('o plano contratado não limita o Mister (não é vendido à parte) e continua limitando os outros', async () => {
    const e = await empresa();
    await q(`insert into ativacao (tenant_id, token_hash, status, modulos) values ($1,$2,'ativado','["kds"]'::jsonb)`, [e.t, 'teste-' + randomUUID()]);
    await modulos.setar(e.presidente(), { modulo: 'mister', ativo: true });
    expect(await modulos.ativo(e.t, null, 'mister')).toBe(true);
    await expect(modulos.setar(e.presidente(), { modulo: 'bot', ativo: true })).rejects.toThrow('não faz parte do plano contratado');
    expect(await modulos.ativo(e.t, null, 'bot')).toBe(false);
  });

  it('empresa de fora não muda com a escolha desta', async () => {
    const e = await empresa();
    const fora = await empresa();
    await modulos.setar(e.presidente(), { modulo: 'mister', ativo: true });
    expect(await modulos.ativo(fora.t, null, 'mister')).toBe(false);
  });
});
