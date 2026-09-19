import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { CloudFallbackProcessor } from './cloud-fallback.processor';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O resgate da NUVEM (pedido online preso porque o servidor local caiu) só pode agir quando
// o servidor da loja está de fato fora — e só no caso para o qual existe: loja COM servidor
// local. Postgres real (a decisão é uma consulta).
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('cloud-fallback.spec: sem TEST_PG_URL — PULADO');

jest.setTimeout(60_000);

descrever('resgate da nuvem de pedido online preso', () => {
  let pool: Pool;
  const q = (s: string, p: any[] = []) => pool.query(s, p);
  const aceitos: string[] = [];
  let proc: CloudFallbackProcessor;
  const antes = process.env.EDGE_MODE;

  const empresa = async () => {
    const t = randomUUID();
    const u = randomUUID();
    await q(`insert into empresa (id, nome) values ($1,'teste fallback')`, [t]);
    criadas.push(t);
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$2,'Loja')`, [u, t]);
    return { t, u };
  };
  const pedidoNovo = async (t: string, u: string, canal = 'ifood') =>
    (await q(`insert into pedido_externo (tenant_id, unidade_id, canal, external_id, status, criado_em, itens, total)
              values ($1,$2,$3,$4,'novo', now() - interval '6 minutes', '[]'::jsonb, 10) returning id`,
      [t, u, canal, randomUUID()])).rows[0].id as string;

  beforeAll(async () => {
    delete process.env.EDGE_MODE;
    pool = new Pool({ connectionString: URL_PG });
    // Tabelas só-nuvem ausentes no banco do CI (montado como servidor local).
    await q(`create table if not exists edge_heartbeat (id uuid primary key default gen_random_uuid(),
             ativacao_id uuid, tenant_id uuid, unidade_id uuid, versao text, estado text, ultimo_sync timestamptz,
             disco_livre_mb integer, clientes integer, fingerprint text, saude jsonb, erro text,
             recebido_em timestamptz not null default now())`);
    proc = new CloudFallbackProcessor(drizzle(pool, { schema }) as any, {
      // Como o aceitar real: o pedido sai de 'novo' (senão fica elegível para sempre e,
      // no banco compartilhado do CI, empurra os pedidos dos testes para fora do limit 50).
      aceitar: async (_t: string, _a: any, id: string) => {
        aceitos.push(id);
        await q("update pedido_externo set status = 'confirmado' where id = $1", [id]);
      },
    } as any);
  });
  const criadas: string[] = [];
  afterAll(async () => {
    if (antes !== undefined) process.env.EDGE_MODE = antes;
    if (!pool) return;
    for (const t of criadas) {
      await q('delete from pedido_externo where tenant_id = $1', [t]).catch(() => {});
      await q('delete from edge_status where tenant_id = $1', [t]).catch(() => {});
      await q('delete from edge_heartbeat where tenant_id = $1', [t]).catch(() => {});
      await q('delete from equipamento where tenant_id = $1', [t]).catch(() => {});
    }
    await pool.end();
  });

  const servidorLocal = (t: string, u: string | null) =>
    q(`insert into equipamento (tenant_id, unidade_id, nome, token, tipo, ativo) values ($1,$2,'Servidor',$3,'servidor_local',true)`,
      [t, u, 'tok-' + randomUUID()]);

  it('servidor local VIVO (edge_status agora; edge_heartbeat amostrado há 20 min) → NÃO resgata', async () => {
    const { t, u } = await empresa();
    await servidorLocal(t, u);
    await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, recebido_em) values ($1,$2,$3,'1.30.0', now())`, [randomUUID(), t, u]);
    await q(`insert into edge_heartbeat (tenant_id, unidade_id, recebido_em) values ($1,$2, now() - interval '20 minutes')`, [t, u]);
    const id = await pedidoNovo(t, u);
    await proc.processar();
    expect(aceitos).not.toContain(id);
  });

  it('loja SEM servidor local, pedido do iFood aguardando aceite há 6 min → NÃO aceita pela loja', async () => {
    const { t, u } = await empresa();
    const id = await pedidoNovo(t, u);
    await proc.processar();
    expect(aceitos).not.toContain(id);
  });

  it('loja COM servidor local e SEM batida (caiu) → resgata (é o caso para o qual o resgate existe)', async () => {
    const { t, u } = await empresa();
    await servidorLocal(t, u);
    await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, recebido_em) values ($1,$2,$3,'1.30.0', now() - interval '10 minutes')`, [randomUUID(), t, u]);
    const id = await pedidoNovo(t, u);
    await proc.processar();
    expect(aceitos).toContain(id);
  });

  it('servidor da MATRIZ vivo não cobre a FILIAL caída', async () => {
    const { t, u } = await empresa();
    const filial = randomUUID();
    await q(`insert into unidade (id, tenant_id, nome) values ($1,$2,'Filial')`, [filial, t]);
    await servidorLocal(t, u);
    await servidorLocal(t, filial);
    await q(`insert into edge_status (equipamento_id, tenant_id, unidade_id, versao, recebido_em) values ($1,$2,$3,'1.30.0', now())`, [randomUUID(), t, u]);
    const id = await pedidoNovo(t, filial);
    await proc.processar();
    expect(aceitos).toContain(id);
  });
});
