import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { TRAVA_DA_EMPRESA } from '../../common/corrida-de-catalogo';
import { sqlRecebeMarketing } from '../../common/marketing-quem-recebe';

/* eslint-disable @typescript-eslint/no-explicit-any */

// F1-0 do plano do perfil do cliente (docs/plano-perfil-cliente.md), contra o Postgres real:
//  • ERR-535 — a campanha alcançava quem a loja só conheceu pelo iFood ou pela 99 (a 99 manda o telefone real e o pedido
//    entra no `cliente`). `sqlRecebeMarketing` passa a exigir cliente DIRETO: base importada, OU pedido fora do iFood/99,
//    OU nenhum pedido por eles.
//  • mig 458 (ERR-536) — os totais do cliente acompanham o cancelamento (e a volta), a troca de cliente do pedido e a exclusão; e,
//    uma vez e só na nuvem, os totais guardados que diferem dos pedidos são recalculados.
// Tudo numa transação DESFEITA no fim (o critério da parte única é do banco inteiro e não pode mexer nas specs paralelas).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cliente-agregados-458.spec: sem TEST_PG_URL — PULADO');

const ARQUIVO = join(__dirname, '..', '..', '..', '..', 'database', 'migrations', '458_cliente_agregados_sempre_certos.sql');

describe('migration 458 (arquivo)', () => {
  const texto = readFileSync(ARQUIVO, 'utf8');
  it('roda nos dois lados (o gatilho vale na loja), sem drop, com a parte única só na nuvem', () => {
    expect(texto).not.toMatch(/^\s*--\s*@cloud-only\b/im);
    expect(texto).not.toMatch(/\bdrop\b|\btruncate\b|^\s*delete\b/im);
    expect(texto).toMatch(/create or replace trigger trg_pedido_externo_agregados_cliente\b/);
    expect(texto).toMatch(/create or replace trigger trg_pedido_externo_agregados_cliente_del\b/);
    expect(texto).toMatch(/to_regclass\(current_schema\(\) \|\| '\.edge_status'\) is null then\s+return;/);
  });
});

descrever('totais do cliente e quem recebe marketing (Postgres)', () => {
  jest.setTimeout(120_000);
  const pool = new Pool({ connectionString: URL_PG });
  const sql458 = readFileSync(ARQUIVO, 'utf8');
  afterAll(async () => {
    await pool.end();
  }, 60_000);

  async function preparar(c: PoolClient) {
    const q = (s: string, p: any[] = []) => c.query(s, p).then((r) => r.rows);
    // "Como nuvem": a parte única só roda onde existe `edge_status` (o banco do CI é de loja).
    if (!(await q(`select to_regclass(current_schema() || '.edge_status') as t`))[0].t) {
      await q(`create table edge_status (equipamento_id uuid primary key, tenant_id uuid, unidade_id uuid, versao text, recebido_em timestamptz)`);
    }
    // A lista de exclusão é só da nuvem; no banco de loja do CI ela não existe.
    await q(`create table if not exists marketing_optout (
      id uuid primary key default gen_random_uuid(), tenant_id uuid not null, telefone text not null,
      cliente_id uuid, motivo text, criado_em timestamptz not null default now())`);
    const t = (await q(`insert into empresa (nome) values ('teste mig 458') returning id`))[0].id as string;
    const u = (await q(`insert into unidade (tenant_id, nome) values ($1,'Loja') returning id`, [t]))[0].id as string;
    const cliente = async (nome: string, telefone: string, importado = false) =>
      (await q(
        `insert into cliente (tenant_id, nome, telefone, importacao) values ($1,$2,$3,$4) returning id`,
        [t, nome, telefone, importado ? JSON.stringify({ fonte: 'anotaai', segmento: 'ativo' }) : null],
      ))[0].id as string;
    const pedido = async (clienteId: string, canal: string, total: number, status = 'concluido', diasAtras = 1) =>
      (await q(
        `insert into pedido_externo (tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, tipo, status, itens, total, cliente_id, criado_em)
         values ($1,$2,$3,$4,'1','Cliente de teste','entrega',$5,'[]'::jsonb,$6,$7, now() - make_interval(days => $8::int)) returning id`,
        [t, u, canal, randomUUID(), status, total, clienteId, diasAtras],
      ))[0].id as string;
    const totais = async (id: string) =>
      (await q(`select total_pedidos::int as n, total_gasto::numeric::float8 as gasto from cliente where id = $1`, [id]))[0];
    return { q, t, cliente, pedido, totais };
  }

  it('recalcula uma vez os totais errados e, daí em diante, acompanha cancelar, voltar, trocar de cliente e apagar', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      // Trava `empresa` ANTES dos inserts: esta transação insere empresa e depois roda a migration (ERR-377).
      await c.query(TRAVA_DA_EMPRESA);
      const { q, cliente, pedido, totais } = await preparar(c);
      const ana = await cliente('Ana', '21999990001');
      const bia = await cliente('Bia', '21999990002');
      const p1 = await pedido(ana, 'cardapio', 50);
      const p2 = await pedido(ana, 'cardapio', 30);
      // O defeito de antes da 458: o pedido cancelado continuava contando nos totais guardados.
      await q(`update pedido_externo set status = 'cancelado' where id = $1`, [p2]);
      await q(`update cliente set total_pedidos = 2, total_gasto = 80 where id = $1`, [ana]);

      await c.query(sql458); // a parte única (como nuvem) recalcula
      expect(await totais(ana)).toEqual({ n: 1, gasto: 50 });

      await q(`update pedido_externo set status = 'cancelado' where id = $1`, [p1]); // cancelar
      expect(await totais(ana)).toEqual({ n: 0, gasto: 0 });
      await q(`update pedido_externo set status = 'concluido' where id = $1`, [p1]); // desfazer o cancelamento
      expect(await totais(ana)).toEqual({ n: 1, gasto: 50 });

      await q(`update pedido_externo set cliente_id = $1 where id = $2`, [bia, p1]); // o pedido passa para outro cadastro
      expect(await totais(ana)).toEqual({ n: 0, gasto: 0 });
      expect(await totais(bia)).toEqual({ n: 1, gasto: 50 });

      await q(`delete from pedido_externo where id = $1`, [p1]); // o pedido apagado sai do total
      expect(await totais(bia)).toEqual({ n: 0, gasto: 0 });
    } finally {
      await c.query('rollback');
      c.release();
    }
  });

  it('marketing só para cliente direto: quem pediu só pelo iFood/99 fica de fora; importado, misto e sem pedido ficam', async () => {
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(TRAVA_DA_EMPRESA);
      const { t, cliente, pedido } = await preparar(c);
      const so99 = await cliente('Só 99', '21988880001');
      const soIfood = await cliente('Só iFood', '21988880002');
      const misto = await cliente('Misto', '21988880003');
      const importado99 = await cliente('Importado que pediu na 99', '21988880004', true);
      const semPedido = await cliente('Cadastrado sem pedido', '21988880005');
      const direto = await cliente('Direto', '21988880006');
      await pedido(so99, '99food', 40);
      await pedido(soIfood, 'ifood', 40);
      await pedido(misto, '99food', 40);
      await pedido(misto, 'anotaai', 40);
      await pedido(importado99, '99food', 40);
      await pedido(direto, 'cardapio_web', 40);

      const db = drizzle(c as any);
      const r: any = await db.execute(sql`select c.nome from cliente c where c.tenant_id = ${t}::uuid ${sqlRecebeMarketing()} order by c.nome`);
      const nomes = (r.rows ?? r).map((x: any) => x.nome);
      expect(nomes).toEqual(['Cadastrado sem pedido', 'Direto', 'Importado que pediu na 99', 'Misto'].sort());
      expect(nomes).not.toContain('Só 99');
      expect(nomes).not.toContain('Só iFood');
      void semPedido;
    } finally {
      await c.query('rollback');
      c.release();
    }
  });
});
