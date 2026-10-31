import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService } from './sync.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A OBSERVAÇÃO DO PEDIDO (mig 346) nasce só na NUVEM (cardápio online e robô) e a loja não a edita. O servidor da loja
// ainda sem a coluna (antes do .zip) — ou com a linha ainda não reconciliada — manda o pedido sem ela (ou nula) quando
// muda a situação; o envio da loja não pode apagar a observação daqui (o entregador a perderia).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('observacao-so-da-nuvem.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('observação do pedido × envio da loja (Postgres)', () => {
  let pool: Pool;
  let svc: SyncService;
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' });
  const pedido = async (observacao: string | null) =>
    (
      await q(
        `insert into pedido_externo (tenant_id, canal, display_id, cliente_nome, tipo, itens, total, status, observacao)
         values ($1,'cardapio','70','Ana','entrega','[]'::jsonb,30,'novo',$2) returning id`,
        [T, observacao],
      )
    )[0].id as string;
  const daLoja = async (id: string, mudar: Record<string, unknown>) => {
    const linha = JSON.parse(JSON.stringify((await q('select * from pedido_externo where id = $1', [id]))[0]));
    return { ...linha, status: 'confirmado', updated_at: new Date(Date.now() + 1000).toISOString(), ...mudar };
  };
  const ler = async (id: string) => (await q('select status, observacao from pedido_externo where id = $1', [id]))[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: URL_PG });
    svc = new SyncService(drizzle(pool, { schema }) as any);
    await q(`insert into empresa (id, nome) values ($1, 'teste observação do pedido')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1,$2,'servidor_local','Servidor',$3)`, [
      SERVIDOR,
      T,
      'tok-servidor-' + SERVIDOR,
    ]);
  });
  afterAll(async () => {
    if (!pool) return;
    await q('delete from pedido_externo where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it('a loja aceita o pedido mandando a observação NULA: a situação muda e a observação fica', async () => {
    const id = await pedido('interfone ruim, ligar ao chegar');
    const r: any = await svc.push(ctx() as any, [{ tabela: 'pedido_externo', linhas: [await daLoja(id, { observacao: null })] } as any]);
    expect(r.resultado.pedido_externo.aplicadas).toBe(1);
    expect(await ler(id)).toEqual({ status: 'confirmado', observacao: 'interfone ruim, ligar ao chegar' });
  });

  it('a loja ainda sem a coluna (antes do .zip): o pedido sobe sem a chave e a observação fica', async () => {
    const id = await pedido('não buzinar');
    const linha: any = await daLoja(id, {});
    delete linha.observacao;
    await svc.push(ctx() as any, [{ tabela: 'pedido_externo', linhas: [linha] } as any]);
    expect(await ler(id)).toEqual({ status: 'confirmado', observacao: 'não buzinar' });
  });

  it('a loja não escreve a observação (ela nasce só na nuvem)', async () => {
    const id = await pedido(null);
    await svc.push(ctx() as any, [{ tabela: 'pedido_externo', linhas: [await daLoja(id, { observacao: 'escrito na loja' })] } as any]);
    expect(await ler(id)).toEqual({ status: 'confirmado', observacao: null });
  });
});
