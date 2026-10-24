import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { TABELAS_SYNC } from './sync-config';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A TV DE SENHAS NO SINCRONISMO (decisão do dono, 24/10/2026 — parear sem reinstalar). Ela é cadastrada e pareada no
// servidor da loja, e o filtro de equipamento (nos DOIS lados) a deixava de fora: numa reinstalação do servidor ela
// sumia e tinha de ser cadastrada e pareada de novo. Agora sobe (o envio do servidor da loja) e desce (o que a nuvem
// manda), com o mesmo segredo; o servidor da loja continua fora (anti auto-reativação por LWW).

const DAEMON = readFileSync(join(__dirname, '..', '..', '..', 'edge', 'sync-daemon.mjs'), 'utf8');
/** O filtro do envio do servidor da loja (o `PUSH_TABLES` do sync-daemon), lido do próprio arquivo. */
const filtroDoEnvio = (() => {
  const m = DAEMON.match(/\{\s*tabela:\s*'equipamento',[^}]*filtro:\s*"([^"]+)"/);
  return m ? m[1] : '';
})();
const filtroDaNuvem = TABELAS_SYNC.find((t) => t.tabela === 'equipamento')?.filtroSql ?? '';

describe('a TV de senhas sobe e desce no sincronismo', () => {
  it('os dois filtros a incluem; o servidor da loja segue fora dos dois', () => {
    expect(filtroDoEnvio).toContain("'tela_senhas'");
    expect(filtroDaNuvem).toContain("'tela_senhas'");
    expect(filtroDoEnvio).not.toContain('servidor_local');
    expect(filtroDaNuvem).not.toContain('servidor_local');
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('tela-senhas-sync.spec: sem TEST_PG_URL — a parte com Postgres foi PULADA');

descrever('os filtros, rodados no Postgres: a TV passa, o servidor da loja não', () => {
  jest.setTimeout(60_000);
  let pool: Pool;
  const T = randomUUID();
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    await q(`insert into empresa (id, nome) values ($1, 'teste tv no sync')`, [T]);
    for (const [tipo, nome] of [['tela_senhas', 'TV do balcão'], ['servidor_local', 'Servidor'], ['pdv', 'Caixa 1'], ['terminal_ponto', 'Ponto']]) {
      await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1, $2, $3, $4, $5)`, [randomUUID(), T, tipo, nome, 'tok-' + randomUUID()]);
    }
  });
  afterAll(async () => {
    if (!pool) return;
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it.each([
    ['o envio do servidor da loja (sobe)', () => filtroDoEnvio],
    ['o que a nuvem manda (desce)', () => filtroDaNuvem],
  ])('%s', async (_nome, filtro) => {
    const tipos = (await q(`select tipo from equipamento where tenant_id = $1 and (${filtro()}) order by tipo`, [T])).map((r: any) => r.tipo);
    expect(tipos).toEqual(['pdv', 'tela_senhas']);
  });
});
