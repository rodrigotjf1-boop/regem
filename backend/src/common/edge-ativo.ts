import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// F10 — a empresa tem um servidor local (edge) ATIVO agora? Decide pelo último
// `edge_heartbeat` do tenant dentro de uma janela (o edge bate a cada ~30s; sem
// batida por JANELA_MIN, consideramos o edge fora). Fonte única (antes a lógica
// vivia duplicada e com janelas divergentes em cloud-fallback e frota).
export const EDGE_JANELA_MIN = 3;

export async function edgeAtivo(
  db: any,
  tenantId: string,
  unidadeId: string | null = null,
  janelaMin = EDGE_JANELA_MIN,
): Promise<boolean> {
  // No próprio edge não há heartbeat de si mesmo (é tabela da nuvem) → false, e o
  // edge continua editando a própria config. O corte real vale na NUVEM.
  if (process.env.EDGE_MODE === 'true') return false;
  if (!tenantId) return false;
  // F2 (por LOJA): quando se pergunta por uma unidade, o edge DELA tem que estar vivo —
  // não basta o tenant ter algum edge (senão a filial materializaria o pedido da matriz).
  // `unidade_id is null` cobre a transição: edge ainda no formato antigo de heartbeat
  // (sem unidade) conta como tenant-wide até atualizar p/ o heartbeat rico (F1).
  const r: any = await db.execute(sql`
    select 1 from edge_heartbeat
    where tenant_id = ${tenantId}
      and recebido_em >= now() - make_interval(mins => ${janelaMin})
      ${unidadeId ? sql`and (unidade_id = ${unidadeId} or unidade_id is null)` : sql``}
    limit 1`);
  return (r.rows ?? r).length > 0;
}
