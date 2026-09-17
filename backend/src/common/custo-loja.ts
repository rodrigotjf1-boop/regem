import { sql } from 'drizzle-orm';
import { custoMedioPonderado } from './regras-negocio';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Custo médio, estoque mínimo e dias de segurança POR LOJA (mig 257, fase B2 do estoque
// por loja — decisão do dono: separação total por loja).
//
// O cadastro do insumo (`item_estoque`) pode ser compartilhado pelas lojas; esses três
// valores são de cada uma, em `item_estoque_unidade`. Leitura: o valor da loja quando existe
// a linha, senão o do cadastro. Empresa de UMA loja não usa a tabela: continua gravando e
// lendo `item_estoque` — nada muda para ela.

const rows = (r: any) => (r.rows ?? r) as any[];

export async function contarLojas(db: any, tenantId: string): Promise<number> {
  const r = await db.execute(
    sql`select count(*)::int as n from unidade where tenant_id = ${tenantId} and deleted_at is null`,
  );
  return Number(rows(r)[0]?.n ?? 0);
}

// A loja cujo custo/mínimo é o controlado: a própria, se a empresa tem mais de uma loja;
// null (o cadastro) se tem uma só ou nenhuma.
export async function lojaDeControle(
  db: any,
  tenantId: string,
  unidadeId: string | null | undefined,
): Promise<string | null> {
  if (!unidadeId) return null;
  return (await contarLojas(db, tenantId)) > 1 ? unidadeId : null;
}

// O id da linha vem do par (insumo, loja) — a mesma expressão da mig 258. Servidor local e
// nuvem geram o mesmo id para o mesmo par e o sync resolve por última escrita, em vez de
// duas linhas batendo no índice único.
const idDoPar = (itemId: string, unidadeId: string) =>
  sql`md5(${itemId}::text || ${unidadeId}::text)::uuid`;

// Custo médio do insumo NA LOJA (ou o do cadastro, sem loja / sem linha da loja).
export async function custoMedioNaLoja(
  db: any,
  tenantId: string,
  itemId: string,
  unidadeId: string | null,
): Promise<string | null> {
  const r = await db.execute(sql`
    select coalesce(iu.custo_medio, i.custo_medio) as c
      from item_estoque i
      left join item_estoque_unidade iu
        on iu.item_id = i.id and iu.unidade_id = ${unidadeId}::uuid and iu.deleted_at is null
     where i.id = ${itemId} and i.tenant_id = ${tenantId}`);
  const c = rows(r)[0]?.c;
  return c == null ? null : String(c);
}

// Custo médio para gravar numa SAÍDA (venda, desperdício, produção). A loja é a do
// movimento: a explícita, ou a que o gatilho da mig 253 vai resolver pela origem — a MESMA
// função, chamada antes do INSERT, para o custo gravado e a loja gravada nunca divergirem.
export async function custoMedioDaSaida(
  db: any,
  tenantId: string,
  itemId: string,
  unidadeId: string | null | undefined,
  refTipo: string | null = null,
  refId: string | null = null,
): Promise<string | null> {
  const r = await db.execute(sql`
    select coalesce(iu.custo_medio, i.custo_medio) as c
      from item_estoque i
      left join item_estoque_unidade iu
        on iu.item_id = i.id and iu.deleted_at is null
       and iu.unidade_id = coalesce(
             ${unidadeId ?? null}::uuid,
             regem_unidade_do_movimento(i.tenant_id, i.id, ${refTipo}::text, ${refId}::uuid))
     where i.id = ${itemId} and i.tenant_id = ${tenantId}`);
  const c = rows(r)[0]?.c;
  return c == null ? null : String(c);
}

// Custo médio ponderado de uma ENTRADA já gravada (compra, nota, produção). Tudo sai do
// próprio movimento: a loja é a que o gatilho gravou; o saldo "antes" é o da loja sem este
// movimento. Chamar DEPOIS do INSERT, na mesma transação.
//
// Empresa de duas lojas com entrada SEM loja (sem origem, insumo compartilhado): não pondera
// nada — decisão do dono, não se atribui por palpite. O custo da entrada fica gravado no
// próprio movimento.
export async function ponderarCustoDaEntrada(
  tx: any,
  tenantId: string,
  movimentoId: string,
  itemId: string,
  qtd: number,
  custo: number,
): Promise<void> {
  const mv = rows(
    await tx.execute(sql`select unidade_id from movimento_estoque where id = ${movimentoId}`),
  )[0];
  const lojas = await contarLojas(tx, tenantId);
  const loja: string | null = lojas > 1 ? (mv?.unidade_id ?? null) : null;
  if (lojas > 1 && !loja) return;

  const s = rows(
    await tx.execute(sql`
      select coalesce(sum(case tipo when 'entrada' then quantidade
                                    when 'saida'   then -quantidade
                                    else quantidade end), 0) as saldo
        from movimento_estoque
       where tenant_id = ${tenantId} and item_id = ${itemId} and id <> ${movimentoId}
         ${loja ? sql`and unidade_id = ${loja}` : sql``}`),
  )[0];
  const atual = Number((await custoMedioNaLoja(tx, tenantId, itemId, loja)) ?? 0);
  const novo = custoMedioPonderado(Number(s?.saldo ?? 0), atual, qtd, custo);

  if (loja) {
    await tx.execute(sql`
      insert into item_estoque_unidade (id, tenant_id, item_id, unidade_id, custo_medio)
      values (${idDoPar(itemId, loja)}, ${tenantId}, ${itemId}, ${loja}, ${String(novo)})
      on conflict (id) do update set custo_medio = excluded.custo_medio, updated_at = now()`);
  } else {
    await tx.execute(sql`
      update item_estoque set custo_medio = ${String(novo)}, updated_at = now()
       where id = ${itemId} and tenant_id = ${tenantId}`);
  }
}

export async function gravarEstoqueMinimoDaLoja(
  db: any,
  tenantId: string,
  itemId: string,
  loja: string,
  valor: number,
): Promise<void> {
  await db.execute(sql`
    insert into item_estoque_unidade (id, tenant_id, item_id, unidade_id, estoque_minimo)
    values (${idDoPar(itemId, loja)}, ${tenantId}, ${itemId}, ${loja}, ${String(valor)})
    on conflict (id) do update set estoque_minimo = excluded.estoque_minimo, updated_at = now()`);
}

// ── Fragmentos SQL para leituras agregadas (alias do insumo: `i`) ─────────────────────────
//
// Expande cada insumo em uma linha por LOJA que o usa (`u.uid`), com a linha da loja (`iu`).
// Sem loja escolhida (presidente em "todas", ou empresa de uma loja) entra também o balde
// SEM loja: os movimentos que ficaram sem loja continuam no total, valorizados pelo cadastro.
// `u.orfao` marca esse balde numa empresa QUE TEM loja: ele não tem mínimo próprio (o mínimo
// é de cada loja) — em empresa sem loja nenhuma é o único balde e leva o mínimo do cadastro.
export function sqlLojasDoItem(atual: string | null) {
  return sql`
    cross join lateral (
      select un.id as uid, false as orfao
        from unidade un
       where un.tenant_id = i.tenant_id and un.deleted_at is null
         and (i.unidade_id is null or un.id = i.unidade_id)
         ${atual ? sql`and un.id = ${atual}` : sql``}
      ${
        atual
          ? sql``
          : sql`union all
      select null::uuid, exists (
        select 1 from unidade un2 where un2.tenant_id = i.tenant_id and un2.deleted_at is null
      )`
      }
    ) u
    left join item_estoque_unidade iu
      on iu.item_id = i.id and iu.unidade_id = u.uid and iu.deleted_at is null`;
}

export const sqlCustoDaLoja = sql`coalesce(iu.custo_medio, i.custo_medio)`;
export const sqlMinimoDaLoja = sql`(case when u.orfao then 0 else coalesce(iu.estoque_minimo, i.estoque_minimo) end)`;
export const sqlDiasSegurancaDaLoja = sql`coalesce(iu.dias_seguranca, i.dias_seguranca)`;
