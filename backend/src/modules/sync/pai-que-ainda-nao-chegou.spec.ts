import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from '../../db/schema';
import { SyncService } from './sync.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A LINHA QUE ESPERA O PAI VOLTA DEPOIS (CAR-F-03 da revisão de 25/11/2026) — contra Postgres (TEST_PG_URL). O pagamento de um
// pedido dividido pode subir ANTES do pedido (ele ficou visível na loja depois de a tabela dos pedidos ser lida no ciclo): a
// nuvem recusava (23503) em silêncio, o servidor da loja andava o cursor e a linha nunca mais subia. Agora a resposta diz
// quais ids esperam o pai (`pendentes`), para a loja reenviar; e o reenvio, com o pai já na nuvem, entra.
const URL_PG = process.env.TEST_PG_URL;
const descrever = URL_PG ? describe : describe.skip;
if (!URL_PG) console.warn('pai-que-ainda-nao-chegou.spec: sem TEST_PG_URL — PULADO');
jest.setTimeout(60_000);

descrever('a linha recusada por falta do pai volta na resposta do envio (Postgres)', () => {
  const pool = new Pool({ connectionString: URL_PG });
  const svc = new SyncService(drizzle(pool, { schema }) as any);
  const q = (s: string, p: any[] = []) => pool.query(s, p).then((r) => r.rows);
  const T = randomUUID();
  const SERVIDOR = randomUUID();
  const ctx = () => ({ tenantId: T, unidadeId: null, equipamentoId: SERVIDOR, token: 'tok-servidor' }) as any;

  beforeAll(async () => {
    await q(`insert into empresa (id, nome) values ($1, 'teste pai que ainda não chegou')`, [T]);
    await q(`insert into equipamento (id, tenant_id, tipo, nome, token) values ($1, $2, 'servidor_local', 'Servidor', $3)`, [SERVIDOR, T, `tok-${SERVIDOR}`]);
  });
  afterAll(async () => {
    await q('delete from sync_push_lock where equipamento_id = $1', [SERVIDOR]).catch(() => undefined);
    await q('delete from pedido_externo_pagamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from pedido_externo where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from equipamento where tenant_id = $1', [T]).catch(() => undefined);
    await q('delete from empresa where id = $1', [T]).catch(() => undefined);
    await pool.end();
  });

  it('CAR-F-03: o pagamento cujo pedido ainda não chegou volta em `pendentes`; reenviado depois do pedido, entra', async () => {
    const pedido = randomUUID();
    const pagamento = { id: randomUUID(), tenant_id: T, pedido_externo_id: pedido, forma: 'dinheiro', valor: '20.00', created_at: new Date().toISOString() };
    const r1: any = await svc.push(ctx(), [{ tabela: 'pedido_externo_pagamento', linhas: [pagamento] } as any]);
    expect(r1.resultado.pedido_externo_pagamento).toMatchObject({ aplicadas: 0, ignoradas: 1, pendentes: [pagamento.id] });
    const pai = { id: pedido, tenant_id: T, canal: 'anotaai', tipo: 'entrega', status: 'concluido', total: '50.00', itens: [], created_at: new Date().toISOString() };
    await svc.push(ctx(), [{ tabela: 'pedido_externo', linhas: [pai] } as any]);
    const r2: any = await svc.push(ctx(), [{ tabela: 'pedido_externo_pagamento', linhas: [pagamento] } as any]);
    expect(r2.resultado.pedido_externo_pagamento).toMatchObject({ aplicadas: 1, ignoradas: 0 });
    expect(r2.resultado.pedido_externo_pagamento.pendentes).toBeUndefined();
    expect(await q('select valor::float8 as v from pedido_externo_pagamento where id = $1', [pagamento.id])).toEqual([{ v: 20 }]);
  });
});
