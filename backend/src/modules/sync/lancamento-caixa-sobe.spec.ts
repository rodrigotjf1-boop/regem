import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService } from './sync.service';
import { comTravaDaEmpresa } from '../../common/corrida-de-catalogo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O LANÇAMENTO DE CAIXA ALTERADO NA LOJA CHEGA À NUVEM (mig 413; verificação do dono, 12/11/2026). O "Cobrar e entregar"
// aponta o lançamento da venda para o caixa de quem recebeu DEPOIS de gravado (e o pedido alterado muda o valor); a
// tabela subia só ao nascer e a nuvem ignorava a repetição — 74 lançamentos de venda sem caixa na nuvem. Postgres real:
// o carimbo, o push da nuvem (a mais nova vence), o reenvio único do servidor da loja e a correção da nuvem.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('lancamento-caixa-sobe.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

const RAIZ = join(__dirname, '..', '..', '..');
const MIG = readFileSync(join(RAIZ, '..', 'database', 'migrations', '413_lancamento_caixa_alteracao_sobe.sql'), 'utf8');
const DAEMON = readFileSync(join(RAIZ, 'edge', 'sync-daemon.mjs'), 'utf8');

// O texto do reenvio do servidor da loja, como o daemon o roda.
function sqlDoReenvio(): string {
  const m = DAEMON.match(/const SQL_REENVIO_CAIXA = `([\s\S]+?)`;/);
  if (!m) throw new Error('SQL_REENVIO_CAIXA não encontrado no sync-daemon.mjs');
  return m[1];
}

// A correção da nuvem (item 2 da 413), presa à empresa do teste: o banco do CI é dividido entre os specs.
function sqlDaCorrecao(tenantId: string): string {
  const ini = MIG.indexOf('update lancamento_caixa l');
  const fim = MIG.indexOf("and l.categoria = 'venda';", ini);
  if (ini < 0 || fim < 0) throw new Error('a correção da nuvem não foi achada na 413');
  const texto = MIG.slice(ini, fim + "and l.categoria = 'venda'".length);
  const preso = texto.replace('where pe.tenant_id = l.tenant_id', `where l.tenant_id = '${tenantId}' and pe.tenant_id = l.tenant_id`);
  if (preso === texto) throw new Error('a correção da nuvem mudou de forma: ajuste o teste');
  return preso;
}

descrever('lançamento de caixa alterado na loja chega à nuvem (mig 413)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });

  async function sessao(): Promise<string> {
    const id = randomUUID();
    await q(`insert into caixa_sessao (id, tenant_id, origem, status) values ($1, $2, 'pdv', 'aberta')`, [id, T]);
    return id;
  }
  async function lancamento(o: { sessaoId?: string | null; comandaId?: string | null; forma?: string; diasAtras?: number }) {
    const id = randomUUID();
    const criado = new Date(Date.now() - (o.diasAtras ?? 0) * 86_400_000 - 3_600_000);
    await q(
      `insert into lancamento_caixa (id, tenant_id, tipo, valor, categoria, forma, sessao_id, comanda_id, created_at, updated_at)
       values ($1, $2, 'entrada', 45.90, 'venda', $3, $4, $5, $6, $6)`,
      [id, T, o.forma ?? 'Cartão', o.sessaoId ?? null, o.comandaId ?? null, criado],
    );
    return id;
  }
  const linha = async (id: string) => (await q('select * from lancamento_caixa where id = $1', [id]))[0];
  // O carimbo em texto do próprio Postgres (microssegundo) e a comparação feita lá: o driver devolve a data como texto.
  const carimbo = async (id: string): Promise<string> =>
    (await q('select updated_at::text as t from lancamento_caixa where id = $1', [id]))[0].t;
  const maisNovoQue = async (id: string, t: string): Promise<boolean> =>
    (await q('select updated_at > $2::timestamptz as ok from lancamento_caixa where id = $1', [id, t]))[0].ok;

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    const tem = (
      await q(`select count(*)::int as n from information_schema.columns
                where table_schema = current_schema() and table_name = 'lancamento_caixa' and column_name = 'updated_at'`)
    )[0].n;
    if (!tem) await pool.query(comTravaDaEmpresa(MIG));
    await q(`insert into empresa (id, nome) values ($1, 'teste lançamento do caixa sobe')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`, [
      SERVIDOR,
      T,
      'tok-servidor-' + SERVIDOR,
    ]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    await q('delete from lancamento_caixa where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from pedido_externo where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from comanda where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from caixa_sessao where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it('a mudança feita pelo sistema carimba o updated_at; a aplicada pelo sync mantém o que veio', async () => {
    const id = await lancamento({});
    const antes = await carimbo(id);
    await q(`update lancamento_caixa set forma = 'Dinheiro' where id = $1`, [id]);
    expect(await maisNovoQue(id, antes)).toBe(true);
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('regem.sync', 'on', true)`);
      await c.query(`update lancamento_caixa set forma = 'Pix', updated_at = '2026-01-01T00:00:00Z' where id = $1`, [id]);
      await c.query('commit');
    } finally {
      c.release();
    }
    const fixo = await q(`select updated_at = '2026-01-01T00:00:00Z'::timestamptz as ok from lancamento_caixa where id = $1`, [id]);
    expect(fixo[0].ok).toBe(true);
  });

  it('a nuvem aceita a cópia MAIS NOVA da loja: o caixa e a forma do "Cobrar e entregar" chegam', async () => {
    const id = await lancamento({});
    const s = await sessao();
    const daLoja = { ...JSON.parse(JSON.stringify(await linha(id))), sessao_id: s, forma: 'Dinheiro', updated_at: new Date().toISOString() };
    await svc.push(ctx() as any, [{ tabela: 'lancamento_caixa', linhas: [daLoja] } as any]);
    expect(await linha(id)).toMatchObject({ sessao_id: s, forma: 'Dinheiro' });
  });

  it('a cópia MAIS VELHA da loja não desfaz o que a nuvem tem', async () => {
    const s = await sessao();
    const id = await lancamento({ sessaoId: s, forma: 'Dinheiro' });
    await q(`update lancamento_caixa set valor = 50 where id = $1`, [id]); // carimba agora
    const velha = {
      ...JSON.parse(JSON.stringify(await linha(id))),
      sessao_id: null,
      forma: 'Cartão',
      valor: '45.90',
      updated_at: new Date(Date.now() - 86_400_000).toISOString(),
    };
    await svc.push(ctx() as any, [{ tabela: 'lancamento_caixa', linhas: [velha] } as any]);
    const l = await linha(id);
    expect(l).toMatchObject({ sessao_id: s, forma: 'Dinheiro' });
    expect(Number(l.valor)).toBe(50);
  });

  it('o servidor da loja reenvia UMA vez só os lançamentos de venda que ele apontou para um caixa (180 dias)', async () => {
    const s = await sessao();
    const comanda = randomUUID();
    const comCaixa = await lancamento({ sessaoId: s, comandaId: comanda });
    const semCaixa = await lancamento({ comandaId: randomUUID() });
    const antigo = await lancamento({ sessaoId: s, comandaId: randomUUID(), diasAtras: 200 });
    const antes = new Map(await Promise.all([comCaixa, semCaixa, antigo].map(async (id) => [id, await carimbo(id)] as const)));
    // Como o daemon: a sessão dele leva a marca do sync (o carimbo do gatilho não troca a data posta).
    const c = await pool.connect();
    try {
      await c.query('begin');
      await c.query(`select set_config('regem.sync', 'on', true)`);
      await c.query(sqlDoReenvio() + ` and tenant_id = '${T}'`);
      await c.query('commit');
    } finally {
      c.release();
    }
    expect(await maisNovoQue(comCaixa, antes.get(comCaixa)!)).toBe(true);
    expect(await carimbo(semCaixa)).toBe(antes.get(semCaixa));
    expect(await carimbo(antigo)).toBe(antes.get(antigo));
  });

  it('a correção da nuvem põe no lançamento sem caixa o caixa e a forma que o pedido já tem', async () => {
    const s = await sessao();
    const comanda = randomUUID();
    await q(`insert into comanda (id, tenant_id, status, total) values ($1, $2, 'fechada', 45.90)`, [comanda, T]);
    await q(
      `insert into pedido_externo (tenant_id, canal, tipo, itens, total, status, comanda_id, caixa_sessao_id, forma_pagamento)
       values ($1, 'ifood', 'retirada', '[]'::jsonb, 45.90, 'concluido', $2, $3, 'dinheiro')`,
      [T, comanda, s],
    );
    const id = await lancamento({ comandaId: comanda, forma: 'Cartão' });
    const intocado = await lancamento({ comandaId: randomUUID(), forma: 'Cartão' });
    await q(sqlDaCorrecao(T));
    expect(await linha(id)).toMatchObject({ sessao_id: s, forma: 'dinheiro' });
    expect(await linha(intocado)).toMatchObject({ sessao_id: null, forma: 'Cartão' });
  });
});
