// Aplica TODAS as migrations (database/migrations/*.sql, em ordem) no banco de
// PRODUÇÃO apontado por DATABASE_URL do backend/.env. Idempotente na prática
// (IF NOT EXISTS / ON CONFLICT DO NOTHING) — migrations já aplicadas apenas
// logam ERRO e o script segue para a próxima.
//
// Uso:  cd backend && node scripts/apply-all-prod.mjs --sim
// O flag --sim é uma confirmação explícita (evita rodar em produção sem querer).
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

if (!process.argv.includes('--sim')) {
  console.error(
    'PRODUÇÃO. Confirme com: node scripts/apply-all-prod.mjs --sim',
  );
  process.exit(1);
}

const cwd = process.cwd();
const env = readFileSync(path.join(cwd, '.env'), 'utf8');
const line = env.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='));
if (!line) {
  console.error('DATABASE_URL ausente no .env');
  process.exit(1);
}
const connectionString = line.slice('DATABASE_URL='.length).trim();
const host = connectionString.replace(/\/\/[^@]+@/, '//***@');
console.log('Banco alvo:', host);

const dir = path.join(cwd, '..', 'database', 'migrations');
const arquivos = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = new pg.Client({ connectionString });
let ok = 0;
let erros = 0;
try {
  await client.connect();
  for (const f of arquivos) {
    const sql = readFileSync(path.join(dir, f), 'utf8');
    try {
      await client.query(sql);
      console.log('OK  ', f);
      ok++;
    } catch (e) {
      // Normal para migrations já aplicadas em statements sem IF NOT EXISTS.
      console.error('ERRO', f, '→', e.message);
      erros++;
    }
  }
  console.log(`\n${arquivos.length} arquivo(s): ${ok} OK, ${erros} com erro (já aplicadas/parciais).`);
} catch (e) {
  console.error('Falha de conexão:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
