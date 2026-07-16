import { eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

// Filtro de unidade (RBAC de filial), usado nas queries dos módulos por-loja.
// `atual` vem do decorator @UnidadeAtual():
//   - usuário de loja (execução/supervisão/gerente) → sempre a própria unidade;
//   - presidente/C&O → a unidade escolhida no seletor (ou null = rede toda).
//
// Duas variantes conforme a natureza do dado:
//  • DADO TRANSACIONAL (pertence a UMA loja: estoque, caixa, comanda, ponto…):
//    filtra `col = atual`. Sem `atual` (presidente na rede) → sem filtro.
//  • DADO DE CONFIG/PLANO (pode ser "padrão da rede" com unidade_id NULL, herdado
//    pelas filiais): filtra `col = atual OR col IS NULL`, para a loja ver o próprio
//    override + o padrão da rede.

/** Fragmento SQL cru para dado transacional. `col` = nome da coluna (ex.: 'unidade_id'
 *  ou 'a.unidade_id'). Retorna '' quando presidente (rede toda). */
export function sqlUnidade(col: string, atual: string | null): SQL {
  return atual ? sql`and ${sql.raw(col)} = ${atual}` : sql``;
}

/** Idem, para config/plano onde NULL = padrão da rede. */
export function sqlUnidadeOuRede(col: string, atual: string | null): SQL {
  return atual ? sql`and (${sql.raw(col)} = ${atual} or ${sql.raw(col)} is null)` : sql``;
}

/** Condição para o query-builder do Drizzle (dado transacional). Use dentro de
 *  `and(...)`; devolve `undefined` (ignorado) quando presidente na rede. */
export function condUnidade(col: AnyPgColumn, atual: string | null): SQL | undefined {
  return atual ? eq(col, atual) : undefined;
}

/** Idem para config/plano (NULL = padrão da rede). */
export function condUnidadeOuRede(col: AnyPgColumn, atual: string | null): SQL | undefined {
  return atual ? or(eq(col, atual), isNull(col)) : undefined;
}
