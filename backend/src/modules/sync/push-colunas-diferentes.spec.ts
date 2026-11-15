import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService, dividirPorColunas } from './sync.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// LOTE DO PUSH COM LINHAS DE COLUNAS DIFERENTES (ERR-126): as colunas do INSERT saíam da 1ª linha e, numa linha sem uma
// delas, o valor sumia do SQL (`values ($1, , $2)`) — o lote inteiro caía com erro de sintaxe (42601), nem a linha boa
// entrava, e o servidor da loja reenviaria o mesmo lote a cada ciclo. Agora o lote se divide por colunas: cada linha grava
// só o que trouxe, e a coluna que não veio fica como está aqui (NULL na falta apagaria, no `do update`, o valor da nuvem).

describe('dividirPorColunas', () => {
  it('o lote normal (mesmas chaves em todas as linhas) volta como está', () => {
    const lote = { tabela: 'pedido_externo', linhas: [{ id: 'a', status: 'novo' }, { status: 'pronto', id: 'b' }] };
    expect(dividirPorColunas(lote as any)).toEqual([lote]);
  });

  it('linhas de chaves diferentes viram sublotes, na ordem em que cada conjunto aparece', () => {
    const lote = { tabela: 'pedido_externo', linhas: [{ id: 'a', cupom: 'X' }, { id: 'b' }, { id: 'c', cupom: 'Y' }] };
    expect(dividirPorColunas(lote as any)).toEqual([
      { tabela: 'pedido_externo', linhas: [{ id: 'a', cupom: 'X' }, { id: 'c', cupom: 'Y' }] },
      { tabela: 'pedido_externo', linhas: [{ id: 'b' }] },
    ]);
  });

  it('linha que não é objeto não derruba a divisão (o push a descarta como sempre)', () => {
    const lote = { tabela: 'pedido_externo', linhas: [{ id: 'a' }, null, 'x'] };
    expect(dividirPorColunas(lote as any).map((l) => l.linhas.length)).toEqual([1, 2]);
  });
});

const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('push-colunas-diferentes.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('push com linhas de colunas diferentes no mesmo lote (Postgres)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });
  const pedido = async (displayId: string, cupom: string | null) =>
    (
      await q(
        `insert into pedido_externo (tenant_id, canal, display_id, cliente_nome, tipo, itens, total, status, cupom)
         values ($1,'cardapio',$2,'Ana','entrega','[]'::jsonb,30,'novo',$3) returning id`,
        [T, displayId, cupom],
      )
    )[0].id as string;
  const daLoja = async (id: string, mudar: Record<string, unknown>) => {
    const linha = JSON.parse(JSON.stringify((await q('select * from pedido_externo where id = $1', [id]))[0]));
    return { ...linha, updated_at: new Date(Date.now() + 1000).toISOString(), ...mudar };
  };
  const ler = async (id: string) => (await q('select status, cupom from pedido_externo where id = $1', [id]))[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste push colunas diferentes')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`, [
      SERVIDOR,
      T,
      'tok-servidor-' + SERVIDOR,
    ]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q('delete from pedido_externo where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it('a 1ª linha com o cupom e a 2ª sem a chave: as duas entram e o cupom que já estava aqui fica', async () => {
    const a = await pedido('81', null);
    const b = await pedido('82', 'PROMO10');
    const comCupom = await daLoja(a, { status: 'confirmado', cupom: 'BEMVINDO' });
    const semCupom: any = await daLoja(b, { status: 'pronto' });
    delete semCupom.cupom;
    const r: any = await svc.push(ctx() as any, [{ tabela: 'pedido_externo', linhas: [comCupom, semCupom] } as any]);
    expect(r.resultado.pedido_externo).toEqual({ aplicadas: 2, ignoradas: 0 });
    expect(await ler(a)).toEqual({ status: 'confirmado', cupom: 'BEMVINDO' });
    expect(await ler(b)).toEqual({ status: 'pronto', cupom: 'PROMO10' });
  });

  it('o lote normal (todas as linhas com as mesmas colunas) segue num INSERT só e soma certo', async () => {
    const a = await pedido('83', null);
    const b = await pedido('84', null);
    const r: any = await svc.push(ctx() as any, [
      { tabela: 'pedido_externo', linhas: [await daLoja(a, { status: 'confirmado' }), await daLoja(b, { status: 'confirmado' })] } as any,
    ]);
    expect(r.resultado.pedido_externo).toEqual({ aplicadas: 2, ignoradas: 0 });
    expect((await ler(a)).status).toBe('confirmado');
    expect((await ler(b)).status).toBe('confirmado');
  });
});
