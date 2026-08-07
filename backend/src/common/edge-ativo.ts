import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// F10 — a empresa tem um servidor local (edge) ATIVO agora? Decide pelo último
// `edge_heartbeat` do tenant dentro de uma janela (o edge bate a cada ~30s; sem
// batida por JANELA_MIN, consideramos o edge fora). Fonte única (antes a lógica
// vivia duplicada e com janelas divergentes em cloud-fallback e frota).
export const EDGE_JANELA_MIN = 3;

export async function edgeAtivo(db: any, tenantId: string, janelaMin = EDGE_JANELA_MIN): Promise<boolean> {
  // No próprio edge não há heartbeat de si mesmo (é tabela da nuvem) → false, e o
  // edge continua editando a própria config. O corte real vale na NUVEM.
  if (process.env.EDGE_MODE === 'true') return false;
  if (!tenantId) return false;
  const r: any = await db.execute(sql`
    select 1 from edge_heartbeat
    where tenant_id = ${tenantId} and recebido_em >= now() - make_interval(mins => ${janelaMin})
    limit 1`);
  return (r.rows ?? r).length > 0;
}
