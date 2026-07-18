// Aplica TODAS as migrations (database/migrations/*.sql, em ordem) no banco
// apontado por DATABASE_URL do backend/.env.local. Uso: node scripts/apply-all-local.mjs
// Idempotente na prática (as migrations usam IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
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

// No EDGE (EDGE_MODE=true no .env.local) pulamos migrations marcadas `@cloud-only`
// no topo — são tabelas SÓ da distribuição (ex.: telemetria, frota), que vivem na
// NUVEM e o edge nunca escreve. Em dev/nuvem (sem EDGE_MODE) aplica tudo.
const ehEdge = /^\s*EDGE_MODE\s*=\s*true\s*$/im.test(env);

// Em dev (monorepo) as migrations ficam em ../database/migrations; no edge
// empacotado elas vao para ./database/migrations (dentro de backend/). Aceita os dois.
const candidatos = [
  path.join(cwd, '..', 'database', 'migrations'),
  path.join(cwd, 'database', 'migrations'),
];
const dir = candidatos.find((d) => existsSync(d));
if (!dir) {
  console.error('Pasta de migrations nao encontrada. Procurei em:\n  ' + candidatos.join('\n  '));
  process.exit(1);
}
const arquivos = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

const client = new pg.Client({ connectionString });
try {
  await client.connect();
  let aplicadas = 0, puladas = 0;
  for (const f of arquivos) {
    const sql = readFileSync(path.join(dir, f), 'utf8');
    // Distribuição-only: não cria no banco da LOJA (edge).
    if (ehEdge && /@cloud-only/i.test(sql)) {
      console.log('PULA', f, '(cloud-only — só na nuvem)');
      puladas++;
      continue;
    }
    try {
      await client.query(sql);
      console.log('OK  ', f);
      aplicadas++;
    } catch (e) {
      console.error('ERRO', f, '→', e.message);
    }
  }
  console.log(`\n${aplicadas} migration(s) aplicada(s)${puladas ? `, ${puladas} pulada(s) (cloud-only)` : ''}.`);
} catch (e) {
  console.error('Falha de conexão:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
