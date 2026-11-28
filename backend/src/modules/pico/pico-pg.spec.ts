import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { PicoService } from './pico.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-646 (rodada 7 de segurança, MIS-B-01): a janela de pico é dado de UMA loja. Contra o Postgres real: quem tem loja lê,
// cria, muda e apaga só na sua; o presidente (loja null) em todas; a loja de outra empresa não entra.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pico-pg.spec: sem TEST_PG_URL — PULADO');

descrever('as janelas de pico ficam na loja de quem pede (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db = drizzle(pool, { schema }) as any;
  const q = async (s: string, p: any[] = []) => (await pool.query(s, p)).rows;
  const svc = new PicoService(db);
  const T = randomUUID();
  const OUTRA_EMPRESA = randomUUID();
  let lojaA: string;
  let lojaB: string;
  let lojaDeFora: string;
  const janela = (unidadeId: string, nome: string) => ({ unidadeId, nome, horaInicio: '11:00', horaFim: '14:00' }) as any;

  beforeAll(async () => {
    await q(`insert into empresa (id, nome) values ($1, 'teste pico'), ($2, 'teste pico fora')`, [T, OUTRA_EMPRESA]);
    [{ id: lojaA }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja A') returning id`, [T]);
    [{ id: lojaB }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja B') returning id`, [T]);
    [{ id: lojaDeFora }] = await q(`insert into unidade (tenant_id, nome) values ($1, 'Loja de fora') returning id`, [OUTRA_EMPRESA]);
  });
  afterAll(async () => {
    await q(`delete from janela_pico where tenant_id = any($1::uuid[])`, [[T, OUTRA_EMPRESA]]).catch(() => undefined);
    await q(`delete from unidade where tenant_id = any($1::uuid[])`, [[T, OUTRA_EMPRESA]]).catch(() => undefined);
    await q(`delete from empresa where id = any($1::uuid[])`, [[T, OUTRA_EMPRESA]]).catch(() => undefined);
    await pool.end();
  });

  it('ERR-646: o gerente da loja A cria, lê, muda e apaga só na A; o presidente em todas; loja de outra empresa não entra', async () => {
    // Criar: o gerente da A não cria na B; ninguém cria numa loja de outra empresa.
    const naA = await svc.create(T, janela(lojaA, 'Almoço A'), lojaA);
    await expect(svc.create(T, janela(lojaB, 'Almoço B'), lojaA)).rejects.toThrow('escolha a sua loja');
    await expect(svc.create(T, janela(lojaDeFora, 'De fora'), null)).rejects.toThrow('Loja não encontrada');
    const naB = await svc.create(T, janela(lojaB, 'Almoço B'), null);

    // Ler: a loja passada é a de quem pede (o controlador decide).
    expect((await svc.findAll(T, lojaA)).map((j: any) => j.id)).toEqual([naA.id]);
    expect((await svc.findAll(T)).map((j: any) => j.id).sort()).toEqual([naA.id, naB.id].sort());

    // Mudar e apagar a da outra loja: "não encontrada", e ela continua como estava.
    await expect(svc.update(T, naB.id, { nome: 'Mexido' }, lojaA)).rejects.toThrow('não encontrada');
    await expect(svc.remove(T, naB.id, lojaA)).rejects.toThrow('não encontrada');
    expect((await q(`select nome, deleted_at from janela_pico where id = $1`, [naB.id]))[0]).toEqual({ nome: 'Almoço B', deleted_at: null });

    // Na própria loja, muda e apaga; o presidente muda a de qualquer loja.
    expect((await svc.update(T, naA.id, { nome: 'Almoço da A', horaInicio: '11:00', horaFim: '15:00' }, lojaA)).nome).toBe('Almoço da A');
    expect((await svc.update(T, naB.id, { nome: 'Almoço da B', horaInicio: '11:00', horaFim: '15:00' }, null)).nome).toBe('Almoço da B');
    expect(await svc.remove(T, naA.id, lojaA)).toEqual({ ok: true });
  });
});
