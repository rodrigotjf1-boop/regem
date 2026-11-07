import { and, eq } from 'drizzle-orm';
import { entitlement } from '../db/schema';
import { idEntitlement } from './id-deterministico';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Liga/desliga um módulo da empresa (`entitlement`), à prova de dois salvamentos ao mesmo tempo (ERR-391). A tabela tem
 * DOIS únicos — o id da chave (mig 339: a linha que a nuvem e o servidor da loja criam é a MESMA) e empresa+módulo — e o
 * `on conflict (tenant_id, modulo)` de um só deixava o segundo salvamento esbarrar no id (23505). Agora: cria a linha se
 * ainda não existe ("não faz nada" vale para qualquer único) e grava o valor pela chave natural.
 */
export async function gravarEntitlement(db: any, tenantId: string, modulo: string, ativo: boolean): Promise<void> {
  await db.insert(entitlement).values({ id: idEntitlement(tenantId, modulo), tenantId, modulo, ativo }).onConflictDoNothing();
  await db
    .update(entitlement)
    .set({ ativo, updatedAt: new Date() })
    .where(and(eq(entitlement.tenantId, tenantId), eq(entitlement.modulo, modulo)));
}
