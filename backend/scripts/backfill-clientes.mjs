// Backfill CRM (F2): vincula pedidos históricos a um cliente (find-or-create por
// telefone normalizado — TODOS os canais) e recalcula os agregados de recência/
// frequência/valor. Idempotente (re-executável). Escopo por tenant.
//
// Uso (na pasta backend): node scripts/backfill-clientes.mjs
// Usa DATABASE_URL do .env (mesma fonte do apply-sql.mjs).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const cwd = process.cwd();
const env = readFileSync(path.join(cwd, '.env'), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
if (!line) {
  console.error('DATABASE_URL ausente no .env');
  process.exit(1);
}
const connectionString = line.slice('DATABASE_URL='.length).trim();

// Mesma normalização do ingest (delivery.service.normTel): só dígitos, sem DDI 55.
const norm = (raw) => {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  return d;
};

const client = new pg.Client({ connectionString });
await client.connect();
try {
  // 1) Pedidos com telefone e ainda sem cliente vinculado.
  const { rows } = await client.query(`
    select id, tenant_id, cliente_telefone, cliente_nome
    from pedido_externo
    where cliente_id is null and coalesce(cliente_telefone, '') <> ''`);
  console.log(`pedidos sem cliente vinculado: ${rows.length}`);

  const cache = new Map(); // `${tenant}|${tel}` -> clienteId
  let vinculados = 0;
  let criados = 0;
  for (const p of rows) {
    const tel = norm(p.cliente_telefone);
    if (tel.length < 10) continue;
    const key = `${p.tenant_id}|${tel}`;
    let cid = cache.get(key);
    if (!cid) {
      const ex = await client.query(
        'select id from cliente where tenant_id = $1 and telefone = $2 limit 1',
        [p.tenant_id, tel],
      );
      if (ex.rows[0]) {
        cid = ex.rows[0].id;
      } else {
        const ins = await client.query(
          'insert into cliente (tenant_id, telefone, nome) values ($1, $2, $3) returning id',
          [p.tenant_id, tel, p.cliente_nome || null],
        );
        cid = ins.rows[0].id;
        criados++;
      }
      cache.set(key, cid);
    }
    await client.query('update pedido_externo set cliente_id = $1 where id = $2', [cid, p.id]);
    vinculados++;
  }
  console.log(`pedidos vinculados: ${vinculados} · clientes criados: ${criados}`);

  // 2) Recalcula os agregados de TODOS os clientes (ignora cancelados).
  const agg = await client.query(`
    update cliente c set
      total_pedidos      = sub.n,
      total_gasto        = sub.gasto,
      primeiro_pedido_em = sub.primeiro,
      ultimo_pedido_em   = sub.ultimo,
      atualizado_em      = now()
    from (
      select cliente_id,
             count(*)::int as n,
             coalesce(sum(total::numeric), 0) as gasto,
             min(criado_em) as primeiro,
             max(criado_em) as ultimo
      from pedido_externo
      where cliente_id is not null and status <> 'cancelado'
      group by cliente_id
    ) sub
    where c.id = sub.cliente_id`);
  console.log(`clientes com agregados recalculados: ${agg.rowCount}`);
  console.log('OK backfill concluído.');
} catch (e) {
  console.error('FALHOU:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
