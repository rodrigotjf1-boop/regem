import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { hojeISO } from '../../common/data';
import { somarDias } from './calendario-regra';
import { calcularSensibilidadeDaEmpresa } from './sensibilidade-da-empresa';

const MIG = (n: string) => join(__dirname, '..', '..', '..', '..', 'database', 'migrations', n);
const semFkCompartilhada = (s: string) =>
  s.replace(/\s+references\s+(empresa|unidade|cliente|cupom)\s*\(\s*id\s*\)(\s+on\s+delete\s+cascade)?/gi, '');

/* eslint-disable @typescript-eslint/no-explicit-any */

// F3 parte 2 do plano do perfil do cliente: o que move cada cliente, gravado (Postgres, transação desfeita).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('sensibilidade-pg.spec: sem TEST_PG_URL — PULADO');

descrever('a sensibilidade a eventos (Postgres)', () => {
  jest.setTimeout(120_000);
  // As tabelas só da nuvem (459, 461, 463) num schema SÓ DESTE TESTE, sem chave estrangeira para as compartilhadas (LIC-088).
  const SCHEMA = `teste_sens_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const admin = new Pool({ connectionString: URL_PG });
  const pool = new Pool({ connectionString: URL_PG, options: `-c search_path=${SCHEMA},public` });
  beforeAll(async () => {
    await admin.query(`create schema ${SCHEMA}`);
    for (const m of ['459_perfil_do_cliente.sql', '461_calendario_da_loja.sql', '463_cliente_evento_sensibilidade.sql'])
      await pool.query(semFkCompartilhada(readFileSync(MIG(m), 'utf8')));
  }, 60_000);
  afterAll(async () => {
    await pool.end();
    await admin.query(`drop schema if exists ${SCHEMA} cascade`).catch(() => {});
    await admin.end();
  }, 60_000);

  it('grava quem pede no dinheiro no bolso (selo), quem pede todo dia (sem selo); só pedido direto; de novo sem duplicar', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const q = (s: string, p: any[] = []) => c.query(s, p).then((r) => r.rows);
      const t = (await q(`insert into empresa (nome) values ('teste sensibilidade') returning id`))[0].id as string;
      const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
      const db = drizzle(c as any);
      const ate = somarDias(hojeISO(), -1);
      const inicio = somarDias(ate, -399);
      // O calendário (a cópia da rotina): dinheiro no bolso a cada 10 dias (cai em todos os dias da semana).
      await q(
        `insert into calendario_loja_dia (unidade_id, dia, tenant_id, eventos)
         select $1, d::date, $2,
                case when (d::date - $3::date) % 10 = 0 then '[{"grupo":"dinheiro","tipo":"dinheiro","nome":"x","origem":"regra","chave":"x"}]'::jsonb
                     else '[]'::jsonb end
           from generate_series($3::date, $4::date, interval '1 day') d`,
        [u, t, inicio, ate],
      );
      const cliente = async (nome: string, tel: string) => {
        const id = (await q(`insert into cliente (tenant_id, nome, telefone) values ($1,$2,$3) returning id`, [t, nome, tel]))[0].id as string;
        await q(`insert into cliente_perfil (cliente_id, tenant_id, primeiro_pedido_em) values ($1,$2, ($3::date + time '20:00') at time zone 'America/Sao_Paulo')`, [id, t, inicio]);
        return id;
      };
      const pedidos = async (cli: string, filtro: string, canal = 'cardapio_web', status = 'concluido') =>
        q(
          `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total, cliente_id, criado_em)
           select $1, $2, $5, gen_random_uuid()::text, '1', 'X', 'entrega', $6, '[]'::jsonb, 50, $3, (d::date + time '20:00') at time zone 'America/Sao_Paulo'
             from generate_series($4::date, $7::date, interval '1 day') d
            where ${filtro}`,
          [t, u, cli, inicio, canal, status, ate],
        );
      const ana = await cliente('Ana', '21988880001'); // pede justamente no dinheiro no bolso
      const bia = await cliente('Bia', '21988880002'); // pede todo dia
      const caio = await cliente('Caio', '21988880003'); // como a Ana (a loja segue "mexendo" sem ela)
      await pedidos(ana, `(d::date - $4::date) % 10 = 0 or ((d::date - $4::date) % 28 = 3)`);
      await pedidos(caio, `(d::date - $4::date) % 10 = 0 or ((d::date - $4::date) % 28 = 5)`);
      await pedidos(bia, `true`);
      // iFood e cancelado não contam (a Bia "pediria" mais no dinheiro só por eles).
      await pedidos(bia, `(d::date - $4::date) % 10 = 0`, 'ifood');
      await pedidos(bia, `(d::date - $4::date) % 10 = 0`, 'cardapio_web', 'cancelado');

      const r1 = await calcularSensibilidadeDaEmpresa(db, t);
      expect(r1?.rrDaLoja.dinheiro.mede).toBe(true);
      const linhas = await q(`select cliente_id, tipo, selo, dias_com_pedido, pedidos, rr::float as rr from cliente_evento_sensibilidade where tenant_id = $1 order by rr desc`, [t]);
      const a = linhas.find((l: any) => l.cliente_id === ana);
      const b = linhas.find((l: any) => l.cliente_id === bia);
      expect(a).toMatchObject({ tipo: 'dinheiro', selo: true });
      expect(a.dias_com_pedido).toBeGreaterThanOrEqual(39);
      expect(b).toMatchObject({ tipo: 'dinheiro', selo: false });
      // A Bia: só os pedidos diretos e não cancelados em dia de dinheiro (um por dia).
      expect(b.pedidos).toBe(b.dias_com_pedido);
      expect(b.rr).toBeLessThan(1.5);

      // De novo: reescreve, sem duplicar.
      await calcularSensibilidadeDaEmpresa(db, t);
      expect(await q(`select count(*)::int as n from cliente_evento_sensibilidade where tenant_id = $1`, [t])).toEqual([{ n: 3 }]);
      // A Ana perdeu o perfil (pediu "não analisar"): na volta seguinte a linha dela sai; as outras ficam.
      await q(`delete from cliente_perfil where cliente_id = $1`, [ana]);
      await calcularSensibilidadeDaEmpresa(db, t);
      expect((await q(`select cliente_id from cliente_evento_sensibilidade where tenant_id = $1`, [t])).map((x: any) => x.cliente_id).sort()).toEqual(
        [bia, caio].sort(),
      );
      // Só a Bia (pede igual todo dia): o dinheiro no bolso deixa de mexer na loja — ninguém é medido nele (primeiro a loja).
      await q(`delete from cliente_perfil where cliente_id = $1`, [caio]);
      const r2 = await calcularSensibilidadeDaEmpresa(db, t);
      expect(r2?.rrDaLoja.dinheiro.mede).toBe(false);
      expect(await q(`select count(*)::int as n from cliente_evento_sensibilidade where tenant_id = $1`, [t])).toEqual([{ n: 0 }]);
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('sem a cópia do calendário, não mede (null)', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      const t = (await c.query(`insert into empresa (nome) values ('sem calendário') returning id`)).rows[0].id as string;
      expect(await calcularSensibilidadeDaEmpresa(drizzle(c as any), t)).toBeNull();
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
