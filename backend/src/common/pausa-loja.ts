import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Pausa por falta de estoque POR LOJA (mig 260 — decisão do dono: "a pausa por falta em
// estoque é só por unidade"). Uma linha por (produto, loja) em `produto_pausa_estoque`.
// `produto.pausado_estoque` segue existindo como "pausado em TODAS as lojas": é o que vale
// para empresa sem loja cadastrada e para quem ainda não conhece a loja.

const rows = (r: any) => (r.rows ?? r) as any[];

export async function lojasAtivas(db: any, tenantId: string): Promise<string[]> {
  const r = await db.execute(
    sql`select id from unidade where tenant_id = ${tenantId} and deleted_at is null order by id`,
  );
  return rows(r).map((x) => x.id);
}

// A loja de um cardápio/canal: a dele; se não tem, a única loja da empresa; se a empresa
// tem várias e o cardápio é da rede (ou não tem loja nenhuma) → null = vale o campo antigo.
export async function lojaDoCanal(
  db: any,
  tenantId: string,
  unidadeId: string | null | undefined,
): Promise<string | null> {
  if (unidadeId) return unidadeId;
  const lojas = await lojasAtivas(db, tenantId);
  return lojas.length === 1 ? lojas[0] : null;
}

// Produtos pausados por estoque NAQUELA loja.
export async function pausadosNaLoja(
  db: any,
  tenantId: string,
  unidadeId: string,
  produtoIds: string[] | null = null,
): Promise<Set<string>> {
  if (produtoIds && !produtoIds.length) return new Set();
  const r = await db.execute(sql`
    select produto_id from produto_pausa_estoque
     where tenant_id = ${tenantId} and unidade_id = ${unidadeId}
       and pausado = true and deleted_at is null
       ${produtoIds ? sql`and produto_id in ${produtoIds}` : sql``}`);
  return new Set(rows(r).map((x) => x.produto_id));
}

// produto → lojas em que está pausado (com o nome da loja, para a tela de gestão).
export async function pausasPorProduto(
  db: any,
  tenantId: string,
): Promise<Map<string, { id: string; nome: string }[]>> {
  const r = await db.execute(sql`
    select pe.produto_id, un.id, un.nome
      from produto_pausa_estoque pe
      join unidade un on un.id = pe.unidade_id and un.deleted_at is null
     where pe.tenant_id = ${tenantId} and pe.pausado = true and pe.deleted_at is null
     order by un.nome`);
  const mapa = new Map<string, { id: string; nome: string }[]>();
  for (const x of rows(r)) {
    const l = mapa.get(x.produto_id) ?? [];
    l.push({ id: x.id, nome: x.nome });
    mapa.set(x.produto_id, l);
  }
  return mapa;
}
