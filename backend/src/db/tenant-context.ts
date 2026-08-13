// Contexto de tenant por requisição (RLS por tenant — defesa em profundidade).
//
// O pooler da Supabase roda em MODO TRANSAÇÃO: variável de sessão (`SET`) não gruda
// entre statements. Por isso o tenant "atual" da policy RLS é fixado com
// `set_config('app.tenant', $1, true)` (LOCAL à transação) e todo query do request
// precisa rodar NA MESMA transação. Este módulo guarda essa transação (`tx`) num
// AsyncLocalStorage; o proxy do DRIZZLE (drizzle.module) roteia cada query para a
// `tx` ambiente quando existe. Sem transação ambiente → usa o pool normal.
//
// GATE: só liga com RLS_ENABLED=true. Desligado (default), getAmbientTx() é sempre
// undefined → o proxy cai no pool real → caminho IDÊNTICO ao de antes (zero impacto).
import { AsyncLocalStorage } from 'node:async_hooks';
import { sql } from 'drizzle-orm';

// Ligado só quando o ambiente pede explicitamente. Default = false (produção atual).
export const RLS_ENABLED = process.env.RLS_ENABLED === 'true';

// A transação carrega a API do Drizzle (mesma superfície do db) — tipada como any
// para não acoplar ao tipo interno de transação do Drizzle.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Store = { tx: any; tenantId: string };

const als = new AsyncLocalStorage<Store>();

// Transação ambiente do request (com o GUC app.tenant já fixado), se houver.
export function getAmbientTx(): any | undefined {
  return als.getStore()?.tx;
}

// Tenant do contexto atual (útil para jobs/logs).
export function getTenantContext(): string | undefined {
  return als.getStore()?.tenantId;
}

// Roda `fn` com a transação/tenant no contexto (o proxy passa a rotear para `tx`).
export function runWithTenantTx<T>(tenantId: string, tx: any, fn: () => Promise<T>): Promise<T> {
  return als.run({ tx, tenantId }, fn);
}

// Executa `fn` sob o tenant dado FORA do ciclo HTTP autenticado — jobs/pollers e rotas
// públicas (token → tenant). Abre uma transação, fixa o GUC app.tenant e roda `fn`
// recebendo a própria transação (`tx`), que respeita a policy RLS. Com RLS desligado,
// não abre transação: chama `fn(db)` direto (zero overhead). Ex.:
//   await comTenant(this.db, tenantId, (tx) => tx.select()...);
export async function comTenant<T>(db: any, tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> {
  if (!RLS_ENABLED) return fn(db);
  return db.transaction(async (tx: any) => {
    await tx.execute(sql`select set_config('app.tenant', ${tenantId}, true)`);
    return runWithTenantTx(tenantId, tx, () => fn(tx));
  });
}
