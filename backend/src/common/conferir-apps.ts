import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * "Conferir com os apps" (R3 F4a; mig 405): nasce DESLIGADA — o direito `conferir_apps` da empresa, ligado pela
 * distribuição no console (decisão 5 do protótipo). O lojista nunca grava este direito.
 */
export const MODULO_CONFERIR_APPS = 'conferir_apps';

/** O direito está ligado nesta empresa? (lido nos dois lados: o entitlement desce para o servidor da loja pelo sync) */
export async function conferirAppsLigado(db: any, tenantId: string): Promise<boolean> {
  const r: any = await db.execute(sql`
    select exists (select 1 from entitlement e where e.tenant_id = ${tenantId} and e.modulo = ${MODULO_CONFERIR_APPS} and e.ativo) as ligado`);
  return (r.rows ?? r)[0]?.ligado === true;
}
