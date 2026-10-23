import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool, PoolClient } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { idConfigDaLoja, idEntitlement } from '../../common/id-deterministico';
import { TABELAS_DESDE_ZERO, TABELAS_SYNC } from './sync-config';
import { FinanceiroService } from '../financeiro/financeiro.service';
import { TefService } from '../tef/tef.service';
import { DeliveryService } from '../delivery/delivery.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONFIGURAÇÃO DE LINHA ÚNICA COM O ID DA CHAVE (fase 3A-2 do pedido de 22–23/10/2026, mig 339).
// `delivery_config` (cabeçalho, rodapé, modelos de cupom), `tef_config`, `kds_cor_config` e `entitlement` sincronizam nos
// dois sentidos, mas nasciam com id aleatório: a linha que a nuvem e o servidor da loja criavam para a mesma chave se
// recusava (23505) nos dois sentidos, para sempre. Agora o id nasce da chave, igual no código e na migration, e a
// migration zera no servidor da loja o cursor destas quatro tabelas para elas irem e voltarem uma vez.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('config-linha-unica.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const RAIZ = join(__dirname, '..', '..', '..', '..');
const MIGRATION = readFileSync(join(RAIZ, 'database', 'migrations', '339_config_linha_unica_id_pela_chave.sql'), 'utf8');
const TABELAS = ['delivery_config', 'tef_config', 'kds_cor_config', 'entitlement'];

describe('configuração de linha única — regra do id e do sincronismo', () => {
  it('as quatro sincronizam nos dois sentidos e recomeçam do zero quando a loja não tem cursor delas', () => {
    for (const t of TABELAS) {
      expect([t, TABELAS_SYNC.find((x) => x.tabela === t)?.direcao]).toEqual([t, 'ambos']);
      expect([t, TABELAS_DESDE_ZERO.has(t)]).toEqual([t, true]);
    }
  });

  it('todo insert dessas tabelas no código passa o id da chave', () => {
    const src = join(__dirname, '..', '..');
    const arquivos: string[] = [];
    const andar = (dir: string) => {
      for (const nome of readdirSync(dir)) {
        const p = join(dir, nome);
        if (statSync(p).isDirectory()) andar(p);
        else if (nome.endsWith('.ts') && !nome.endsWith('.spec.ts')) arquivos.push(p);
      }
    };
    andar(src);
    const insertDe = /insert\((deliveryConfig|tefConfig|kdsCorConfig|entitlement)\)|into (delivery_config|tef_config|kds_cor_config|entitlement)\b/g;
    const achados: string[] = [];
    let total = 0;
    for (const arq of arquivos) {
      const texto = readFileSync(arq, 'utf8');
      for (const m of texto.matchAll(insertDe)) {
        total++;
        const depois = texto.slice(m.index!, m.index! + 400); // o insert e os valores logo em seguida
        if (!/idConfigDaLoja\(|idEntitlement\(/.test(depois)) achados.push(`${arq.slice(src.length)}: ${m[0]}`);
      }
    }
    expect(total).toBeGreaterThanOrEqual(12);
    expect(achados).toEqual([]);
  });
});

descrever('configuração de linha única — Postgres', () => {
  let pool: Pool;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const T = randomUUID();
  const LOJA = randomUUID();

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    await q(`insert into empresa (id, nome) values ($1, 'teste config linha unica')`, [T]);
  });
  afterAll(async () => {
    if (!pool) return;
    for (const t of TABELAS) await q(`delete from ${t} where tenant_id = $1`, [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it('o id do código é o mesmo da conta da migration (md5 no Postgres)', async () => {
    for (const [tabela, u] of [['delivery_config', null], ['delivery_config', LOJA], ['tef_config', LOJA], ['kds_cor_config', null]] as const) {
      const r = await q(`select md5($1 || $2 || coalesce($3::text, ''))::uuid::text as id`, [tabela, T, u]);
      expect(r.rows[0].id).toBe(idConfigDaLoja(tabela, T, u));
    }
    const r = await q(`select md5('entitlement' || $1 || $2)::uuid::text as id`, [T, 'pdv_caixa_livre']);
    expect(r.rows[0].id).toBe(idEntitlement(T, 'pdv_caixa_livre'));
    expect(idConfigDaLoja('delivery_config', T, null)).not.toBe(idConfigDaLoja('kds_cor_config', T, null));
  });

  it('os caminhos que criam a linha usam o id da chave', async () => {
    const db = drizzle(pool, { schema }) as any;
    const semAuditoria = { registrar: async () => undefined } as any;
    await new FinanceiroService(db, semAuditoria, {} as any).setCaixaLivre(T, true);
    await new TefService(db, semAuditoria).setConfig(T, LOJA, { ativo: false });
    const delivery = Object.create(DeliveryService.prototype);
    delivery.db = db;
    await delivery.setTotemModo(T, true);
    const producao = Object.create(ProducaoPedidoService.prototype);
    producao.db = db;
    producao.auditoria = semAuditoria;
    await producao.setSenhaPeriodo(T, LOJA, 'semanal');

    const id = async (tabela: string, onde: string, p: any[]) => (await q(`select id::text from ${tabela} where ${onde}`, p)).rows[0]?.id;
    expect(await id('entitlement', `tenant_id = $1 and modulo = 'pdv_caixa_livre'`, [T])).toBe(idEntitlement(T, 'pdv_caixa_livre'));
    expect(await id('tef_config', 'tenant_id = $1 and unidade_id = $2', [T, LOJA])).toBe(idConfigDaLoja('tef_config', T, LOJA));
    expect(await id('delivery_config', 'tenant_id = $1 and unidade_id is null', [T])).toBe(idConfigDaLoja('delivery_config', T, null));
    expect(await id('kds_cor_config', 'tenant_id = $1 and unidade_id = $2', [T, LOJA])).toBe(idConfigDaLoja('kds_cor_config', T, LOJA));
  });

  // A migration roda num schema SÓ do teste (cópias das quatro tabelas, com o gatilho de carimbo de verdade, e uma
  // `sync_state` própria): a `sync_state` e as tabelas compartilhadas não são tocadas por outra spec em paralelo.
  describe('migration 339', () => {
    let cli: PoolClient;
    const ESQ = 't339_' + randomUUID().replace(/-/g, '').slice(0, 12);
    const ESQ_NUVEM = ESQ + '_nuvem';
    const ANTES = '2026-10-01T12:00:00.000Z';
    const ids: Record<string, string> = {};

    const montar = async (esq: string, comSyncState: boolean) => {
      await cli.query(`create schema ${esq}`);
      for (const t of TABELAS) {
        await cli.query(`create table ${esq}.${t} (like public.${t} including all)`);
        await cli.query(`create trigger trg_bump_updated_at before update on ${esq}.${t} for each row execute function public.bump_updated_at()`);
      }
      if (comSyncState) await cli.query(`create table ${esq}.sync_state (chave text primary key, valor text)`);
    };

    beforeAll(async () => {
      cli = await pool.connect();
      await montar(ESQ, true);
      await montar(ESQ_NUVEM, false);
      await cli.query(`set search_path to ${ESQ}`);
      for (const [chave, sql, p] of [
        ['dc_empresa', `insert into delivery_config (id, tenant_id, unidade_id, updated_at) values ($1,$2,null,$3)`, [T, ANTES]],
        ['dc_loja', `insert into delivery_config (id, tenant_id, unidade_id, updated_at) values ($1,$2,$4,$3)`, [T, ANTES, LOJA]],
        ['tef', `insert into tef_config (id, tenant_id, unidade_id, updated_at) values ($1,$2,$4,$3)`, [T, ANTES, LOJA]],
        ['kds', `insert into kds_cor_config (id, tenant_id, unidade_id, updated_at) values ($1,$2,null,$3)`, [T, ANTES]],
        ['ent', `insert into entitlement (id, tenant_id, modulo, ativo, updated_at) values ($1,$2,'pdv_caixa_livre',true,$3)`, [T, ANTES]],
      ] as const) {
        ids[chave] = randomUUID();
        await cli.query(sql, [ids[chave], ...p]);
      }
      await cli.query(`insert into sync_state (chave, valor) values
        ('push_delivery_config', '2026-10-20T00:00:00Z|x'), ('push_entitlement__id', 'abc'),
        ('push_kds_cor_config', 'x'), ('push_tef_config', 'x'), ('push_comanda', 'fica'),
        ('pull_cursor', '2026-10-20T00:00:00Z'),
        ('pull_cursores', '{"delivery_config":"a|b","tef_config":"c","kds_cor_config":"d","entitlement":"e","comanda":"fica"}')`);
    });
    afterAll(async () => {
      if (!cli) return;
      await cli.query('reset search_path').catch(() => undefined);
      await cli.query(`drop schema if exists ${ESQ} cascade`).catch(() => undefined);
      await cli.query(`drop schema if exists ${ESQ_NUVEM} cascade`).catch(() => undefined);
      cli.release();
    });

    it('o gatilho de carimbo do teste é de verdade (um update comum troca a data)', async () => {
      const r = await cli.query(`update kds_cor_config set id = id where tenant_id = $1 returning updated_at`, [T]);
      expect(new Date(r.rows[0].updated_at).toISOString()).not.toBe(ANTES);
      // Volta a data com a marca do sincronismo (sem ela o gatilho carimbaria de novo).
      await cli.query('begin');
      await cli.query(`select set_config('regem.sync', 'on', true)`);
      await cli.query(`update kds_cor_config set updated_at = $2 where tenant_id = $1`, [T, ANTES]);
      await cli.query('commit');
    });

    it('no servidor da loja: id da chave, data preservada, só os cursores destas quatro zerados; e a segunda vez não muda nada', async () => {
      await cli.query(MIGRATION);
      const linha = async (t: string, onde: string) => (await cli.query(`select id::text, updated_at from ${t} where tenant_id = $1 and ${onde}`, [T])).rows[0];
      const esperado: [string, string, string][] = [
        ['delivery_config', 'unidade_id is null', idConfigDaLoja('delivery_config', T, null)],
        ['delivery_config', `unidade_id = '${LOJA}'`, idConfigDaLoja('delivery_config', T, LOJA)],
        ['tef_config', 'true', idConfigDaLoja('tef_config', T, LOJA)],
        ['kds_cor_config', 'true', idConfigDaLoja('kds_cor_config', T, null)],
        ['entitlement', `modulo = 'pdv_caixa_livre'`, idEntitlement(T, 'pdv_caixa_livre')],
      ];
      for (const [t, onde, id] of esperado) {
        const r = await linha(t, onde);
        expect([t, onde, r.id]).toEqual([t, onde, id]);
        expect([t, onde, new Date(r.updated_at).toISOString()]).toEqual([t, onde, ANTES]); // a data não muda
      }
      const estado = Object.fromEntries((await cli.query('select chave, valor from sync_state')).rows.map((x) => [x.chave, x.valor]));
      expect(Object.keys(estado).sort()).toEqual(['mig339_config_linha_unica', 'pull_cursor', 'pull_cursores', 'push_comanda']);
      expect(JSON.parse(estado.pull_cursores)).toEqual({ comanda: 'fica' });
      expect(estado.pull_cursor).toBe('2026-10-20T00:00:00Z'); // o piso global não muda

      // O daemon volta a gravar os cursores dessas tabelas; a próxima atualização por .zip reaplica TODAS as migrations
      // — a 339 não pode zerá-los de novo.
      await cli.query(`insert into sync_state (chave, valor) values ('push_delivery_config', 'novo')`);
      await cli.query(`update sync_state set valor = '{"comanda":"fica","delivery_config":"novo"}' where chave = 'pull_cursores'`);
      await cli.query(MIGRATION);
      for (const [t, onde, id] of esperado) expect((await linha(t, onde)).id).toBe(id);
      const depois = Object.fromEntries((await cli.query('select chave, valor from sync_state')).rows.map((x) => [x.chave, x.valor]));
      expect(depois.push_delivery_config).toBe('novo');
      expect(JSON.parse(depois.pull_cursores)).toEqual({ comanda: 'fica', delivery_config: 'novo' });
    });

    it('na nuvem (sem sync_state) a migration roda e só reescreve os ids', async () => {
      await cli.query(`set search_path to ${ESQ_NUVEM}`);
      const velho = randomUUID();
      await cli.query(`insert into delivery_config (id, tenant_id, unidade_id) values ($1,$2,null)`, [velho, T]);
      await cli.query(MIGRATION);
      const r = await cli.query(`select id::text from delivery_config where tenant_id = $1`, [T]);
      expect(r.rows.map((x) => x.id)).toEqual([idConfigDaLoja('delivery_config', T, null)]);
      await cli.query(`set search_path to ${ESQ}`);
    });
  });
});
