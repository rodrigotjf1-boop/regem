import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService, ehEnvioRapido } from './sync.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ENVIO RÁPIDO do servidor da loja (flash-sync) fica fora da trava de push do dispositivo (ERR-278). Medido em
// 21/10/2026: no pico, o envio rápido (a cada mudança de situação de pedido, produto que esgota, pausa) e o ciclo do
// daemon se atropelavam na trava — o ciclo levava 429, contava como falha, alongava o intervalo (até 5 min) e a nuvem
// deixava de ver o servidor como vivo: pedidos de canal levando de 2 a 5,5 minutos para virar comanda na loja.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('push-envio-rapido.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

describe('o que é envio rápido (a regra)', () => {
  const lote = (tabela: string, n = 1) => ({ tabela, linhas: Array.from({ length: n }, () => ({ id: randomUUID() })) });

  it('um lote só, pequeno, de produto, pausa por estoque ou pedido, sem assinatura', () => {
    expect(ehEnvioRapido([lote('produto')])).toBe(true);
    expect(ehEnvioRapido([lote('produto_pausa_estoque')])).toBe(true);
    expect(ehEnvioRapido([lote('pedido_externo', 200)])).toBe(true);
  });

  it('o ciclo do daemon não é: assinado, vários lotes, outra tabela, grande ou torto', () => {
    expect(ehEnvioRapido([lote('produto')], { seq: '7', ts: new Date().toISOString(), sig: 'x' })).toBe(false);
    expect(ehEnvioRapido([lote('produto')], { seq: '7' })).toBe(false);
    expect(ehEnvioRapido([lote('produto'), lote('pedido_externo')])).toBe(false);
    expect(ehEnvioRapido([lote('comanda')])).toBe(false);
    expect(ehEnvioRapido([lote('pedido_externo', 201)])).toBe(false);
    expect(ehEnvioRapido([])).toBe(false);
    expect(ehEnvioRapido(undefined as any)).toBe(false);
    expect(ehEnvioRapido([{ tabela: 'produto' }] as any)).toBe(false);
  });
});

descrever('envio rápido × trava do ciclo (Postgres)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });
  // O ciclo do daemon empurrando agora: a linha da trava, recente.
  const cicloEmCurso = () =>
    q(`insert into sync_push_lock (equipamento_id, em) values ($1, now())
       on conflict (equipamento_id) do update set em = now()`, [SERVIDOR]);
  const trava = async () => (await q('select 1 from sync_push_lock where equipamento_id = $1', [SERVIDOR])).length;
  const recusaPorTrava = async (p: Promise<unknown>) => {
    const e: any = await p.then(() => null, (x) => x);
    return e instanceof HttpException && e.getStatus() === 429;
  };
  let produtoId = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste envio rapido')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`,
      [SERVIDOR, T, 'tok-servidor-' + SERVIDOR]);
    produtoId = (await q(`insert into produto (tenant_id, nome) values ($1, 'Lanche') returning id`, [T]))[0].id;
  });
  afterEach(async () => {
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    await q('delete from produto where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it('com o ciclo em curso, o envio rápido passa, grava — e a trava do ciclo continua lá', async () => {
    await cicloEmCurso();
    const linha = JSON.parse(JSON.stringify((await q('select * from produto where id = $1', [produtoId]))[0]));
    const r: any = await svc.push(ctx() as any, [
      { tabela: 'produto', linhas: [{ ...linha, nome: 'Lanche esgotado', updated_at: new Date(Date.now() + 1000).toISOString() }] } as any,
    ]);
    expect(r.resultado.produto.aplicadas).toBe(1);
    expect((await q('select nome from produto where id = $1', [produtoId]))[0].nome).toBe('Lanche esgotado');
    expect(await trava()).toBe(1); // a trava é do ciclo: o envio rápido não a soltou
  });

  it('com o ciclo em curso, outro envio do ciclo (vários lotes, ou assinado) continua levando 429', async () => {
    await cicloEmCurso();
    expect(await recusaPorTrava(svc.push(ctx() as any, [{ tabela: 'produto', linhas: [] }, { tabela: 'categoria_produto', linhas: [] }] as any))).toBe(true);
    expect(
      await recusaPorTrava(
        svc.push(ctx() as any, [{ tabela: 'produto', linhas: [] }] as any, { seq: '9', ts: new Date().toISOString(), sig: 'qualquer' }),
      ),
    ).toBe(true);
    expect(await trava()).toBe(1);
  });

  it('o ciclo sozinho pega a trava e solta no fim; o envio rápido não cria trava nenhuma', async () => {
    await svc.push(ctx() as any, [{ tabela: 'produto', linhas: [] }, { tabela: 'categoria_produto', linhas: [] }] as any);
    expect(await trava()).toBe(0);
    await svc.push(ctx() as any, [{ tabela: 'pedido_externo', linhas: [] }] as any);
    expect(await trava()).toBe(0);
  });
});
