import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ENTREGADORES AO VIVO — a consulta ÚNICA (antes ficava só no `EntregadorService`, que é só da
// nuvem). Lê `entregador_posicao`, tabela SÓ DA NUVEM (o app do entregador manda a posição
// para a nuvem): quem chama isto é sempre a nuvem. O servidor da loja pede à nuvem pela rota do
// token de sync (`EntregadoresAoVivoService`).
//
// POR LOJA: numa rede, cada loja vê os entregadores dela — os da loja (ou sem loja definida) e
// qualquer um que esteja com pedido desta loja em rota — e o mapa centra no endereço DELA.
// Antes vinham os de todas as lojas, centrados numa loja qualquer.

export type EntregadorAoVivo = {
  colaborador_id: string;
  nome: string;
  lat: number;
  lng: number;
  criado_em: string; // última posição
  em_rota: number; // pedidos em rota com ele
  pedidos: string[]; // os números desses pedidos
};

export type AoVivo = {
  centro: { lat: number; lng: number } | null;
  entregadores: EntregadorAoVivo[];
};

const linhas = (r: any): any[] => r?.rows ?? r ?? [];

/** Endereço da loja (cardápio), senão o da rede. Existe nos dois lados (sincroniza). */
export async function centroDaLoja(db: any, tenantId: string, unidadeId: string | null) {
  const r: any = await db.execute(sql`
    select end_lat, end_lng from cardapio_config
     where tenant_id = ${tenantId}
       ${unidadeId ? sql`and (unidade_id = ${unidadeId} or unidade_id is null)` : sql``}
     order by (unidade_id is null) asc limit 1`);
  const l = linhas(r)[0];
  const lat = Number(l?.end_lat);
  const lng = Number(l?.end_lng);
  return l?.end_lat != null && l?.end_lng != null && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng }
    : null;
}

/** Última posição (15 min) de cada entregador da loja, com os pedidos em rota. SÓ NA NUVEM. */
export async function consultarAoVivo(db: any, tenantId: string, unidadeId: string | null): Promise<AoVivo> {
  const r: any = await db.execute(sql`
    select l.colaborador_id, l.lat, l.lng, l.atualizado_em as criado_em, c.nome,
           coalesce(rota.n, 0) as em_rota, coalesce(rota.pedidos, '{}') as pedidos
      from entregador_posicao l
      join colaborador c on c.id = l.colaborador_id and c.tenant_id = l.tenant_id
      left join lateral (
        select count(*)::int as n,
               array_agg(coalesce(p.numero::text, p.display_id, '') order by p.despachado_em) as pedidos
          from pedido_externo p
         where p.tenant_id = l.tenant_id and p.entregador_id = l.colaborador_id and p.status = 'despachado'
           ${unidadeId ? sql`and (p.unidade_id = ${unidadeId} or p.unidade_id is null)` : sql``}
      ) rota on true
     where l.tenant_id = ${tenantId} and l.atualizado_em >= now() - interval '15 minutes'
       ${unidadeId ? sql`and (c.unidade_id is null or c.unidade_id = ${unidadeId} or coalesce(rota.n, 0) > 0)` : sql``}
     order by c.nome`);
  return {
    centro: await centroDaLoja(db, tenantId, unidadeId),
    entregadores: linhas(r).map((x: any) => ({
      colaborador_id: String(x.colaborador_id),
      nome: String(x.nome ?? ''),
      lat: Number(x.lat),
      lng: Number(x.lng),
      criado_em: x.criado_em instanceof Date ? x.criado_em.toISOString() : String(x.criado_em),
      em_rota: Number(x.em_rota) || 0,
      pedidos: (Array.isArray(x.pedidos) ? x.pedidos : []).map(String).filter(Boolean),
    })),
  };
}
