// Aplica um arquivo .sql no Postgres apontado por DATABASE_URL (.env).
// Uso: node scripts/apply-sql.mjs ../database/migrations/004_auth.sql
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

const file = process.argv[2];
if (!file) {
  console.error('uso: node scripts/apply-sql.mjs <arquivo.sql>');
  process.exit(1);
}
const sql = readFileSync(path.resolve(cwd, file), 'utf8');

const client = new pg.Client({ connectionString });
await client.connect();
try {
  await client.query(sql);
  console.log('OK aplicado:', file);
} catch (e) {
  console.error('FALHOU:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
