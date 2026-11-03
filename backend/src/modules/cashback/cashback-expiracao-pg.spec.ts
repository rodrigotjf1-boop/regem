import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { uuidDeChave } from '../../common/id-deterministico';
import { CashbackService } from './cashback.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O SALDO VENCIDO SAI DO EXTRATO (decisões do dono de 03/11/2026, itens 1 e 2):
//  • a rotina lança o "venceu" de todo saldo com a data passada — antes só a LEITURA expirava, e quem não voltava ficava
//    com o saldo vencido para sempre no banco (1.862 saldos, R$ 14.658,10 na nuvem em 03/11);
//  • o id do "venceu" vem do último lançamento positivo: a leitura e a rotina dão o mesmo, e ele nunca entra duas vezes
//    (um a mais deixaria a soma negativa e comeria o próximo crédito);
//  • mig 359: o saldo sem data ganha o prazo do plano do último crédito, contado de hoje; plano sem prazo fica sem data.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cashback-expiracao-pg.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

const MIG_359 = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '359_cashback_sem_data_ganha_o_prazo.sql');
const DIA = 86_400_000;

descrever('o saldo vencido sai do extrato (rotina) e o saldo sem data ganha o prazo (mig 359)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const db: any = drizzle(pool, { schema });
  const svc = new CashbackService(db);
  let tenant = '';
  let plano = '';

  beforeAll(async () => {
    tenant = (await pool.query(`insert into empresa (nome) values ('Teste vencimento na rotina') returning id`)).rows[0].id;
    plano = (
      await pool.query(`insert into cashback_plano (tenant_id, tipo, ativo, percentual, prazo_resgate_dias) values ($1, 'valor', true, 5, 30) returning id`, [tenant])
    ).rows[0].id;
  });

  afterAll(async () => {
    if (tenant) await pool.query('delete from empresa where id = $1', [tenant]);
    await pool.end();
  });

  /** Um lançamento (crédito do plano com prazo de 30 dias, ou outro), `diasAtras` dias atrás. Devolve o id. */
  const lancar = async (tel: string, delta: number, origem = 'credito', diasAtras = 0) =>
    (
      await pool.query(
        `insert into cashback_movimento (tenant_id, telefone, tipo, delta, origem, plano_id, criado_em)
         values ($1, $2, 'valor', $3, $4, $5, now() - make_interval(days => $6::int)) returning id`,
        [tenant, tel, String(delta), origem, origem === 'credito' ? plano : null, diasAtras],
      )
    ).rows[0].id as string;
  const vencer = (tel: string) => pool.query(`update cashback_saldo set expira_em = now() - interval '1 day' where tenant_id = $1 and telefone = $2`, [tenant, tel]);
  const saldo = async (tel: string) =>
    Number((await pool.query(`select saldo from cashback_saldo where tenant_id = $1 and telefone = $2 and tipo = 'valor'`, [tenant, tel])).rows[0]?.saldo ?? 0);
  const expiracoes = async (tel: string) =>
    (
      await pool.query(
        `select id, delta::float8 as delta from cashback_movimento where tenant_id = $1 and telefone = $2 and origem = 'expiracao' order by criado_em, delta`,
        [tenant, tel],
      )
    ).rows;
  const idEsperado = (tel: string, ultimoPositivo: string) => uuidDeChave('cashback-expiracao', tenant, tel, 'valor', ultimoPositivo);

  it('a rotina lança o "venceu" de quem passou da data, uma vez só; em dia, sem data e zerado ficam como estão', async () => {
    const vencido = '21977770001';
    const emDia = '21977770002';
    const semData = '21977770003';
    const zerado = '21977770004';
    const credito = await lancar(vencido, 10, 'credito', 40);
    await vencer(vencido);
    await lancar(emDia, 8);
    await lancar(semData, 6);
    await pool.query(`update cashback_saldo set expira_em = null where tenant_id = $1 and telefone = $2`, [tenant, semData]);
    await lancar(zerado, 5, 'credito', 40);
    await lancar(zerado, -5, 'resgate');
    await vencer(zerado);

    expect(await svc.expirarVencidos(tenant)).toBe(1);
    expect(await expiracoes(vencido)).toEqual([{ id: idEsperado(vencido, credito), delta: -10 }]);
    expect(await saldo(vencido)).toBe(0);
    expect(await svc.expirarVencidos(tenant)).toBe(0); // de novo: nada
    for (const tel of [emDia, semData, zerado]) expect(await expiracoes(tel)).toEqual([]);
    expect(await saldo(emDia)).toBe(8);
    expect(await saldo(semData)).toBe(6);
  });

  it('a leitura que expira na hora usa o MESMO id da rotina: o "venceu" nunca entra duas vezes', async () => {
    const tel = '21977770005';
    const credito = await lancar(tel, 12, 'credito', 40);
    await vencer(tel);
    expect((await svc.saldoCliente(tenant, tel)).valor).toBe(0); // o cardápio leu o saldo: expira na hora
    expect(await expiracoes(tel)).toEqual([{ id: idEsperado(tel, credito), delta: -12 }]);
    expect(await svc.expirarVencidos(tenant)).toBe(0);

    // e o inverso: a rotina primeiro, a leitura depois
    const tel2 = '21977770006';
    const credito2 = await lancar(tel2, 7, 'credito', 40);
    await vencer(tel2);
    expect(await svc.expirarVencidos(tenant)).toBe(1);
    expect((await svc.saldoCliente(tenant, tel2)).valor).toBe(0);
    expect(await expiracoes(tel2)).toEqual([{ id: idEsperado(tel2, credito2), delta: -7 }]);
  });

  it('o crédito novo abre outro ciclo: vence de novo com outro id, e a soma do extrato nunca fica negativa', async () => {
    const tel = '21977770007';
    await lancar(tel, 10, 'credito', 40);
    await vencer(tel);
    expect(await svc.expirarVencidos(tenant)).toBe(1);
    const novo = await lancar(tel, 4); // crédito novo: renova a data
    expect(await saldo(tel)).toBe(4);
    expect(await svc.expirarVencidos(tenant)).toBe(0); // em dia
    await vencer(tel);
    expect(await svc.expirarVencidos(tenant)).toBe(1);
    const e = await expiracoes(tel);
    expect(e.map((x: any) => x.delta).sort()).toEqual([-10, -4]);
    expect(e.map((x: any) => x.id)).toContain(idEsperado(tel, novo));
    const [{ soma }] = (await pool.query(`select sum(delta)::float8 as soma from cashback_movimento where tenant_id = $1 and telefone = $2`, [tenant, tel])).rows;
    expect(soma).toBe(0);
  });

  it('mig 359: o saldo sem data ganha o prazo do plano do último crédito, contado de hoje; plano sem prazo fica sem data', async () => {
    // A 359 é só da nuvem e mexe em TODOS os saldos: roda num schema só deste teste, com cópias das três tabelas (as
    // outras suítes dividem o banco do CI).
    const S = `teste_359_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const c = await pool.connect();
    try {
      await c.query(`create schema ${S}`);
      await c.query(`set search_path = ${S}, public`);
      for (const t of ['cashback_plano', 'cashback_movimento', 'cashback_saldo']) await c.query(`create table ${S}.${t} (like public.${t} including defaults)`);
      const [p30, pSem] = [randomUUID(), randomUUID()];
      await c.query(
        `insert into cashback_plano (id, tenant_id, tipo, ativo, percentual, prazo_resgate_dias) values ($1, $3, 'valor', true, 5, 30), ($2, $3, 'valor', true, 5, null)`,
        [p30, pSem, tenant],
      );
      const saldoCom = async (tel: string, valor: number, vencida: boolean, creditos: { plano: string; dias: number }[]) => {
        for (const cr of creditos)
          await c.query(
            `insert into cashback_movimento (tenant_id, telefone, tipo, delta, origem, plano_id, criado_em)
             values ($1, $2, 'valor', 1, 'credito', $3, now() - make_interval(days => $4::int))`,
            [tenant, tel, cr.plano, cr.dias],
          );
        await c.query(
          `insert into cashback_saldo (tenant_id, telefone, tipo, saldo, expira_em) values ($1, $2, 'valor', $3, case when $4 then now() - interval '2 days' end)`,
          [tenant, tel, String(valor), vencida],
        );
      };
      await saldoCom('21966660001', 9, false, [{ plano: p30, dias: 60 }]); // sem data, plano com prazo → hoje + 30
      await saldoCom('21966660002', 9, false, [
        { plano: p30, dias: 60 },
        { plano: pSem, dias: 5 },
      ]); // o último crédito é do plano sem prazo → fica sem data
      await saldoCom('21966660003', 9, true, [{ plano: p30, dias: 40 }]); // já tem data → não mexe
      await saldoCom('21966660004', 0, false, [{ plano: p30, dias: 10 }]); // zerado → não mexe
      const aplicar = async () => {
        const r: any = await c.query(readFileSync(MIG_359, 'utf8'));
        return (Array.isArray(r) ? r[r.length - 1] : r).rows as { objeto: string; ok: boolean }[];
      };
      const linhas = async () =>
        Object.fromEntries(
          (await c.query(`select telefone, extract(epoch from expira_em) * 1000 as vence from cashback_saldo order by telefone`)).rows.map((r: any) => [
            r.telefone,
            r.vence == null ? null : Math.round((Number(r.vence) - Date.now()) / DIA),
          ]),
        );
      expect(await aplicar()).toEqual([{ objeto: 'saldo positivo sem data com crédito de plano com prazo: nenhum', ok: true }]);
      const depois = await linhas();
      expect(depois).toEqual({ '21966660001': 30, '21966660002': null, '21966660003': -2, '21966660004': null });
      expect((await aplicar())[0].ok).toBe(true); // de novo: nada muda
      expect(await linhas()).toEqual(depois);
    } finally {
      await c.query('reset search_path').catch(() => {});
      await c.query(`drop schema if exists ${S} cascade`).catch(() => {});
      c.release();
    }
  });
});
