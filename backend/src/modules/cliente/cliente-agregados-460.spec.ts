import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { comTravaDaEmpresa } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// mig 460: o recálculo dos totais do cliente (gatilho da 458) NÃO ESPERA a trava do cadastro. (A 460 nasceu de um diagnóstico
// errado do deadlock do CI — a causa real era outra suíte reaplicando a 344; ver ERR-539 —, mas é inofensiva e fica.) O CI
// acusou `deadlock detected` no teste do pedido agendado pelo robô (o gatilho esperava a linha do `cliente` dentro da
// transação que cancela o pedido). Aqui: com OUTRA conexão segurando o cadastro, cancelar o pedido passa na hora (com um
// `lock_timeout` curto, esperar daria erro) e o recálculo desta vez é pulado; sem a trava, recalcula.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cliente-agregados-460.spec: sem TEST_PG_URL — PULADO');

const ARQUIVO = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '460_cliente_agregados_sem_esperar.sql');

describe('migration 460 (arquivo)', () => {
  const texto = readFileSync(ARQUIVO, 'utf8');
  it('roda nos dois lados, sem drop, e pega o cadastro com skip locked', () => {
    expect(texto).not.toMatch(/^\s*--\s*@cloud-only\b/im);
    expect(texto).not.toMatch(/\bdrop\b|\btruncate\b|^\s*delete\b/im);
    expect(texto).toMatch(/for no key update skip locked/);
  });
});

descrever('o gatilho dos totais não espera a trava do cadastro (Postgres)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG, max: 4 });
  let t = '';
  afterAll(async () => {
    if (t) await pool.query(comTravaDaEmpresa(`delete from empresa where id = '${t}'`)).catch(() => {});
    await pool.end();
  }, 60_000);

  it('com o cadastro travado por outra transação, cancelar passa sem esperar; sem a trava, recalcula', async () => {
    // A 460 já está no banco (a montagem do CI aplica as migrations): nada de DDL aqui (LIC-088; ERR-539).
    t = (await pool.query(`insert into empresa (nome) values ('teste mig 460') returning id`)).rows[0].id;
    const u = (await pool.query(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t])).rows[0].id;
    const cli = (await pool.query(`insert into cliente (tenant_id, nome, telefone) values ($1,'Ana','21955550001') returning id`, [t])).rows[0].id;
    const ped = (await pool.query(
      `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total, cliente_id)
       values ($1,$2,'cardapio',$3,'1','Ana','entrega','concluido','[]'::jsonb,50,$4) returning id`,
      [t, u, randomUUID(), cli],
    )).rows[0].id;
    await pool.query(`update cliente set total_pedidos = 1, total_gasto = 50 where id = $1`, [cli]);

    const segura = await pool.connect();
    const cancela = await pool.connect();
    try {
      await segura.query('begin');
      await segura.query(`select id from cliente where id = $1 for update`, [cli]);
      await cancela.query('begin');
      await cancela.query(`set local lock_timeout = '2s'`);
      const inicio = Date.now();
      await cancela.query(`update pedido_externo set status = 'cancelado' where id = $1`, [ped]);
      expect(Date.now() - inicio).toBeLessThan(1500);
      await cancela.query('commit');
      await segura.query('rollback');
      // Pulou desta vez (o cadastro estava travado): os totais ficaram como estavam.
      expect((await pool.query(`select total_pedidos from cliente where id = $1`, [cli])).rows[0].total_pedidos).toBe(1);
      // Sem a trava, a próxima mudança recalcula.
      await pool.query(`update pedido_externo set status = 'concluido' where id = $1`, [ped]);
      await pool.query(`update pedido_externo set status = 'cancelado' where id = $1`, [ped]);
      expect((await pool.query(`select total_pedidos from cliente where id = $1`, [cli])).rows[0].total_pedidos).toBe(0);
    } finally {
      await cancela.query('rollback').catch(() => {});
      await segura.query('rollback').catch(() => {});
      cancela.release();
      segura.release();
    }
  });
});
