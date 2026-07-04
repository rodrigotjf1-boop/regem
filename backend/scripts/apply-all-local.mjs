// Aplica TODAS as migrations (database/migrations/*.sql, em ordem) no banco
// apontado por DATABASE_URL do backend/.env.local. Uso: node scripts/apply-all-local.mjs
// Idempotente na prática (as migrations usam IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

const cwd = process.cwd();
const env = readFileSync(path.join(cwd, '.env.local'), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
if (!line) {
  console.error('DATABASE_URL ausente no .env.local');
  process.exit(1);
}
const connectionString = line.slice('DATABASE_URL='.length).trim();

const dir = path.join(cwd, '..', 'database', 'migrations');
const arquivos = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = new pg.Client({ connectionString });
try {
  await client.connect();
  for (const f of arquivos) {
    const sql = readFileSync(path.join(dir, f), 'utf8');
    try {
      await client.query(sql);
      console.log('OK  ', f);
    } catch (e) {
      console.error('ERRO', f, '→', e.message);
    }
  }
  console.log(`\n${arquivos.length} migration(s) processada(s) em regem_local.`);
} catch (e) {
  console.error('Falha de conexão:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
