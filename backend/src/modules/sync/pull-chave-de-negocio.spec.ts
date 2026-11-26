import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PULL E AS PERDAS SILENCIOSAS (1.30.16; análise de rede de 25–26/11/2026).
// ERR-616: o vínculo produto × fornecedor da nuvem recusado por 23505 (o mesmo par aqui com outro id) era pulado e o
// cursor andava — agora a loja adota o id da nuvem (edge/pull-chave-de-negocio.mjs, ESM puro avaliado como texto).
// ERR-617: a linha que não entrava em 20 ciclos sumia com um aviso no log — agora fica em sync_fila 'descartado' e a
// distribuição recebe os ids.
const EDGE = join(__dirname, '..', '..', '..', 'edge');
function carregar(): Record<string, any> {
  const fonte = readFileSync(join(EDGE, 'pull-chave-de-negocio.mjs'), 'utf8');
  const nomes = [...fonte.matchAll(/^export (?:const|async function|function) (\w+)/gm)].map((m) => m[1]);
  const corpo = fonte.replace(/^export (const|async function|function) /gm, '$1 ') + `\nreturn { ${nomes.join(', ')} };`;
  return new Function(corpo)();
}
const m = carregar();

describe('o pull e a chave de negócio (edge/pull-chave-de-negocio.mjs)', () => {
  it('item_fornecedor: tira a cópia local de mesma chave e outro id; outra tabela ou chave incompleta: nada', () => {
    const row = { id: 'id-da-nuvem', item_id: 'item-a', fornecedor_id: 'forn-b', tenant_id: 't' };
    expect(m.sqlAdotarIdDaNuvem('item_fornecedor', row)).toEqual({
      text: 'delete from item_fornecedor where item_id = $2 and fornecedor_id = $3 and id <> $1',
      values: ['id-da-nuvem', 'item-a', 'forn-b'],
    });
    expect(m.sqlAdotarIdDaNuvem('produto', row)).toBeNull();
    expect(m.sqlAdotarIdDaNuvem('item_fornecedor', { ...row, fornecedor_id: null })).toBeNull();
    expect(m.sqlAdotarIdDaNuvem('item_fornecedor', { ...row, id: undefined })).toBeNull();
  });

  it('o daemon usa a regra nos dois pontos do pull, rebobina a tabela uma vez e guarda o descartado (não some mais calado)', () => {
    const daemon = readFileSync(join(EDGE, 'sync-daemon.mjs'), 'utf8');
    expect(daemon.match(/else if \(await entrarPelaChave\(tabela, row, e\)\) aplicadas\+\+;/g)).toHaveLength(2);
    expect(daemon).toMatch(/\{ marca: 'reparo_item_fornecedor_chave_v1', tabelas: \['item_fornecedor'\] \}/);
    expect(daemon).toMatch(/values \('descartado', \$1, \$2, \$3, \$4\) on conflict \(tipo, tabela, registro_id\) do nothing/);
    expect(daemon).toMatch(/reportarTelemetria\('sync', 'pull_linha_descartada'/);
    expect(daemon).not.toMatch(/descartados\+\+/);
  });
});

// Contra Postgres (TEST_PG_URL): o MESMO caminho do pull — o upsert pelo id recusa (23505), o ponto de salvamento desfaz,
// e a adoção entra num ponto NOVO.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pull-chave-de-negocio.spec: sem TEST_PG_URL — a parte com banco foi PULADA');

descrever('a adoção do id da nuvem no Postgres (ERR-616)', () => {
  jest.setTimeout(60_000);
  const pool = new Pool({ connectionString: URL_PG });
  const T = randomUUID();
  const ITEM = randomUUID();
  const FORN = randomUUID();
  afterAll(async () => {
    await pool.query('delete from item_fornecedor where tenant_id = $1', [T]).catch(() => undefined);
    await pool.query('delete from item_estoque where tenant_id = $1', [T]).catch(() => undefined);
    await pool.query('delete from fornecedor where tenant_id = $1', [T]).catch(() => undefined);
    await pool.query('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it('o par já existe aqui com outro id: o upsert pelo id recusa; a adoção tira a cópia local e grava a da nuvem', async () => {
    await pool.query(`insert into empresa (id, nome) values ($1, 'teste chave de negocio')`, [T]);
    await pool.query(`insert into item_estoque (id, tenant_id, nome) values ($1, $2, 'Produto de teste')`, [ITEM, T]);
    await pool.query(`insert into fornecedor (id, tenant_id, nome) values ($1, $2, 'Fornecedor de teste')`, [FORN, T]);
    const LOCAL = randomUUID();
    const NUVEM = randomUUID();
    await pool.query('insert into item_fornecedor (id, tenant_id, item_id, fornecedor_id) values ($1, $2, $3, $4)', [LOCAL, T, ITEM, FORN]);

    const linha = { id: NUVEM, tenant_id: T, item_id: ITEM, fornecedor_id: FORN };
    const upsertPeloId = (c: any) =>
      c.query(
        `insert into item_fornecedor (id, tenant_id, item_id, fornecedor_id) values ($1, $2, $3, $4)
         on conflict (id) do update set item_id = excluded.item_id, fornecedor_id = excluded.fornecedor_id`,
        [linha.id, linha.tenant_id, linha.item_id, linha.fornecedor_id],
      );
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query('savepoint p1');
      const erro = await upsertPeloId(c).then(() => null, (e: any) => e);
      expect(erro?.code).toBe('23505'); // o que acontecia: erro duro, linha pulada
      await c.query('rollback to savepoint p1');
      await c.query('savepoint p2');
      const adotar = m.sqlAdotarIdDaNuvem('item_fornecedor', linha);
      await c.query(adotar.text, adotar.values);
      await upsertPeloId(c);
      await c.query('release savepoint p2');
      await c.query('commit');
    } finally {
      c.release();
    }
    const r = await pool.query('select id from item_fornecedor where tenant_id = $1', [T]);
    expect(r.rows).toEqual([{ id: NUVEM }]);
  });
});
