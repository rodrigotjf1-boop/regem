import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from 'pg';

// BACKUP QUE NINGUÉM RESTAUROU NÃO É BACKUP.
//
// O servidor local faz um dump diário cifrado (backend/edge/backup.ps1) e, até aqui,
// ninguém nunca tinha restaurado nenhum: não havia teste, e o resultado do `pg_restore`
// no rollback era apenas registrado no log, nunca conferido. Este teste fecha o ciclo
// inteiro — gera o dump no mesmo formato do backup (`--format=custom`), restaura num
// banco descartável e confere que o conteúdo chegou.
//
// A cifragem (DPAPI) não entra aqui de propósito: ela é do Windows e não roda no CI. O
// que este teste guarda é o que pode quebrar sozinho — formato do dump, versão das
// ferramentas e a restauração de fato.

const URL_PG = process.env.TEST_PG_URL;

const temFerramenta = (nome: string): boolean => {
  try {
    execFileSync(nome, ['--version'], { stdio: 'ignore', timeout: 15000 });
    return true;
  } catch {
    return false;
  }
};

const ferramentas = URL_PG ? temFerramenta('pg_dump') && temFerramenta('pg_restore') : false;
const descrever = URL_PG && ferramentas ? describe : describe.skip;
if (!URL_PG) console.warn('backup-restauracao.spec: sem TEST_PG_URL — PULADO');
else if (!ferramentas) console.warn('backup-restauracao.spec: pg_dump/pg_restore não encontrados no PATH — PULADO');

// AS FERRAMENTAS DA MESMA VERSÃO DO SERVIDOR (ERR-299, 24/10/2026). Na loja, o pg_dump e o pg_restore são os do
// Postgres que vem no instalador — a mesma versão do servidor. No CI, o servidor é o `postgres:16` e o pg_dump do PATH é
// o da imagem do runner, que subiu de versão sozinha: o pg_restore 17+ manda `SET transaction_timeout = 0;`, que o 16
// não conhece, e a restauração "falhava" com tudo restaurado. Por isso: (1) as ferramentas da versão do servidor, quando
// existem (`/usr/lib/postgresql/<versão>/bin`, o layout do Ubuntu e do Debian); (2) senão, as do PATH, e a única recusa
// aceita é essa, conhecida, com o cliente mais novo que o servidor — a contagem das tabelas continua conferindo tudo.
const maiorDaVersao = (texto: string): number => Number(/PostgreSQL\)?\s+(\d+)/.exec(texto)?.[1] ?? Number.NaN);
const ferramentaDaVersao = (nome: 'pg_dump' | 'pg_restore', maior: number): string => {
  const daMesmaVersao = `/usr/lib/postgresql/${maior}/bin/${nome}`;
  return Number.isFinite(maior) && existsSync(daMesmaVersao) ? daMesmaVersao : nome;
};
const SO_O_TRANSACTION_TIMEOUT = /could not execute query: ERROR:\s+unrecognized configuration parameter "transaction_timeout"/;

descrever('backup do servidor local — dump e restauração de verdade', () => {
  const ALVO = 'regem_restore_spec';
  let pasta = '';
  let urlAlvo = '';

  const urlDe = (banco: string) => String(URL_PG).replace(/\/[^/?]+(\?|$)/, `/${banco}$1`);

  beforeAll(() => {
    pasta = mkdtempSync(join(tmpdir(), 'regem-bak-'));
    urlAlvo = urlDe(ALVO);
  });

  afterAll(async () => {
    const admin = new Client({ connectionString: urlDe('postgres') });
    try {
      await admin.connect();
      await admin.query(`drop database if exists ${ALVO}`);
    } catch {
      /* banco já não existe */
    } finally {
      await admin.end().catch(() => undefined);
    }
    if (pasta && existsSync(pasta)) rmSync(pasta, { recursive: true, force: true });
  });

  it('o dump restaura num banco vazio e traz as tabelas de volta', async () => {
    const origem = new Client({ connectionString: URL_PG });
    await origem.connect();
    const antes = await origem.query(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    const versao = await origem.query("select current_setting('server_version_num')::int / 10000 as maior");
    await origem.end();
    expect(antes.rows[0].n).toBeGreaterThan(50); // o banco de teste tem as migrations aplicadas
    const maiorDoServidor = Number(versao.rows[0].maior);
    const pgDump = ferramentaDaVersao('pg_dump', maiorDoServidor);
    const pgRestore = ferramentaDaVersao('pg_restore', maiorDoServidor);
    const maiorDoCliente = maiorDaVersao(execFileSync(pgRestore, ['--version'], { encoding: 'utf8', timeout: 15000 }));

    const arquivo = join(pasta, 'teste.dump');
    execFileSync(pgDump, ['--format=custom', '--file', arquivo, String(URL_PG)], { timeout: 300000 });
    expect(existsSync(arquivo)).toBe(true);

    const admin = new Client({ connectionString: urlDe('postgres') });
    await admin.connect();
    await admin.query(`drop database if exists ${ALVO}`);
    await admin.query(`create database ${ALVO}`);
    await admin.end();

    // --no-owner: o backup da loja é restaurado noutro cluster/conta; dono não acompanha.
    const restauracao = spawnSync(pgRestore, ['--no-owner', '--dbname', urlAlvo, arquivo], { encoding: 'utf8', timeout: 300000 });
    if (restauracao.status !== 0) {
      const erros = String(restauracao.stderr ?? '')
        .split(/\r?\n/)
        .filter((l) => /pg_restore: error:/.test(l));
      const soAVersao = maiorDoCliente > maiorDoServidor && erros.length > 0 && erros.every((l) => SO_O_TRANSACTION_TIMEOUT.test(l));
      if (!soAVersao) {
        throw new Error(`pg_restore saiu ${restauracao.status} (cliente ${maiorDoCliente}, servidor ${maiorDoServidor}): ${restauracao.stderr}`);
      }
    }

    const destino = new Client({ connectionString: urlAlvo });
    await destino.connect();
    const depois = await destino.query(
      "select count(*)::int as n from information_schema.tables where table_schema = 'public'",
    );
    await destino.end();

    expect(depois.rows[0].n).toBe(antes.rows[0].n);
  }, 600000);
});
