import { sql } from 'drizzle-orm';
import type { DrizzleDB } from '../../db/drizzle.module';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Um entregador na fila da loja, como o painel do delivery mostra (nome, iniciais e situação). */
export type EntregadorNaFila = { colaboradorId: string; nome: string | null; iniciais: string; status: string };

/**
 * A FILA DE ENTREGADORES de uma loja: quem entrou pelo app (`entregador_fila`) — os que esperam
 * primeiro, na ordem de chegada; depois os que estão em entrega. Da loja OU sem loja (V4).
 *
 * A fila existe só na NUVEM: é lá que o app do entregador grava. Por isso o servidor da loja não
 * lê daqui — pede à nuvem (`EntregadoresAoVivoService.filaDaLoja`).
 */
export async function consultarFila(db: DrizzleDB, tenantId: string, unidadeId: string | null): Promise<EntregadorNaFila[]> {
  const r: any = await db.execute(sql`
    select f.colaborador_id, c.nome, f.status, f.entrou_em
    from entregador_fila f join colaborador c on c.id = f.colaborador_id
    where f.tenant_id = ${tenantId}
      ${unidadeId ? sql`and (f.unidade_id = ${unidadeId} or f.unidade_id is null)` : sql``}
    order by (f.status = 'aguardando') desc, f.entrou_em asc`);
  return (r.rows ?? r).map((x: any) => {
    const partes = String(x.nome ?? '').trim().split(/\s+/).filter(Boolean);
    const iniciais =
      ((partes[0]?.[0] ?? '') + (partes.length > 1 ? partes[partes.length - 1][0] : '')).toUpperCase() || '?';
    return { colaboradorId: x.colaborador_id, nome: x.nome, iniciais, status: x.status };
  });
}
