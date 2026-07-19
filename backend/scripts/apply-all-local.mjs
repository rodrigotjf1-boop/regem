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
// Tolerante a aspas e comentário na linha: EDGE_MODE=true, ="true", ='true', + # ...
const ehEdge = /^\s*EDGE_MODE\s*=\s*["']?true["']?\s*(#.*)?$/im.test(env);

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
  let aplicadas = 0, puladas = 0, jaExistiam = 0;
  let falhou = null;
  // Este script re-roda TODAS as migrations (não há tabela de controle). Migrations
  // antigas sem IF NOT EXISTS reclamam "já existe" ao reaplicar — isso é BENIGNO e
  // não pode abortar. Só erro REAL (SQL quebrado, coluna faltando) aborta + exit 1,
  // para não mascarar falha nem deixar o banco em estado parcial silencioso.
  const BENIGNOS = new Set([
    '42P07', // duplicate_table / duplicate index
    '42710', // duplicate_object (type, constraint, trigger, policy)
    '42701', // duplicate_column
    '42P06', // duplicate_schema
    '42723', // duplicate_function
    '42P04', // duplicate_database
    '42P16', // invalid_table_definition (ex.: PK já existe)
  ]);
  const ehBenigno = (e) =>
    BENIGNOS.has(e.code) || /already exists|já existe|does already/i.test(e.message ?? '');
  for (const f of arquivos) {
    const sql = readFileSync(path.join(dir, f), 'utf8');
    // Distribuição-only: não cria no banco da LOJA (edge).
    if (ehEdge && /@cloud-only/i.test(sql)) {
      console.log('PULA', f, '(cloud-only — só na nuvem)');
      puladas++;
      continue;
    }
    try {
      // Uma string multi-statement roda como transação implícita no Postgres: se
      // um comando falha, o arquivo inteiro é revertido (sem estado parcial).
      await client.query(sql);
      console.log('OK  ', f);
      aplicadas++;
    } catch (e) {
      if (ehBenigno(e)) {
        console.log('JÁ  ', f, '(já aplicada)');
        jaExistiam++;
        continue;
      }
      // ABORTA na 1ª falha REAL: migrations seguintes costumam depender desta.
      console.error('ERRO', f, '→', e.message, `(${e.code ?? 'sem code'})`);
      falhou = f;
      break;
    }
  }
  const resumo =
    `\n${aplicadas} nova(s), ${jaExistiam} já aplicada(s)` +
    `${puladas ? `, ${puladas} pulada(s) (cloud-only)` : ''}`;
  if (falhou) {
    console.error(`${resumo}. ABORTADO em ${falhou} (erro real) — corrija e rode de novo.`);
    process.exit(1);
  }
  console.log(`${resumo}.`);
} catch (e) {
  console.error('Falha de conexão:', e.message);
  process.exit(1);
} finally {
  await client.end().catch(() => {});
}
