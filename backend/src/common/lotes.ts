import { sql } from 'drizzle-orm';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Consumo de lote — PVPS/FEFO (mig 248).
//
// Um ÚNICO ponto para os cinco lugares que dão saída de estoque (venda ×3, produção,
// desperdício) mais o ajuste negativo da contagem. Espalhar essa conta pelos seis seria
// repetir o erro do `hojeISO`, que existia em quatro cópias e foi corrigido em uma só.
//
// Regras, decididas com o dono:
//  • FEFO — consome primeiro o que vence primeiro. Lote sem validade vai ao fim da fila.
//  • NUNCA trava a operação. Se os lotes não cobrem a baixa (insumo que entrou sem
//    validade nem código, ou lote que acabou no papel antes do físico), consome o que
//    houver e devolve a sobra — a venda não pode parar por causa do rastreio.
//  • O saldo do lote é DERIVADO (`lote.quantidade` − soma das linhas), nunca um campo
//    mutável: `lote` sincroniza com LWW e um saldo mutável perderia baixa concorrente.

/** Consome `qtd` do item em FEFO e devolve quanto NÃO coube em lote nenhum. */
export async function consumirLotes(
  tx: any,
  tenantId: string,
  itemId: string,
  qtd: number,
  movimentoId: string,
): Promise<number> {
  let restante = Number(qtd);
  if (!(restante > 0)) return 0;

  // DOIS PASSOS, de propósito.
  //
  // Passo 1 trava as linhas de `lote`. Passo 2 soma o consumido — numa consulta
  // SEPARADA, porque em READ COMMITTED cada COMANDO pega um snapshot novo, mas um
  // agregado no mesmo SELECT do `for update` é avaliado no snapshot ANTIGO: a
  // transação que esperava a trava acordava e usava o saldo de antes. Conferido no
  // banco com duas baixas de 6 num lote de 10 — davam saldo −2, as duas levando tudo.
  //
  // `for update` mesmo sem UPDATE na linha: serializa o consumo DESTE lote.
  // `nulls last` = lote sem validade é o último a sair (FEFO).
  const trava: any = await tx.execute(sql`
    select l.id, l.quantidade
      from lote l
     where l.tenant_id = ${tenantId}
       and l.item_id = ${itemId}
       and l.deleted_at is null
       and l.esgotado = false
     order by l.validade asc nulls last, l.entrada asc, l.id asc
     for update
  `);
  const candidatos = (trava.rows ?? trava) as any[];
  if (!candidatos.length) return restante;

  const ids = candidatos.map((l) => l.id);
  const cons: any = await tx.execute(sql`
    select lote_id, coalesce(sum(quantidade), 0) as usado
      from movimento_lote
     where tenant_id = ${tenantId} and lote_id in ${ids}
     group by lote_id
  `);
  const usado = new Map<string, number>(
    (cons.rows ?? cons).map((x: any) => [x.lote_id, Number(x.usado)]),
  );
  const r = candidatos.map((l) => ({
    id: l.id,
    saldo: Number(l.quantidade) - (usado.get(l.id) ?? 0),
  }));

  for (const lt of r) {
    if (restante <= 0) break;
    const saldo = Number(lt.saldo);
    if (!(saldo > 0)) continue;
    const leva = Math.min(saldo, restante);
    await tx.execute(sql`
      insert into movimento_lote (tenant_id, movimento_id, lote_id, quantidade)
      values (${tenantId}, ${movimentoId}, ${lt.id}, ${String(leva)})
    `);
    restante -= leva;
  }
  // Arredondamento de numeric: sobra abaixo de um miligrama é zero, não dívida.
  return restante < 1e-9 ? 0 : restante;
}

/** Estorno: devolve aos lotes de ORIGEM o que o movimento `movimentoOriginalId` levou. */
export async function devolverLotes(
  tx: any,
  tenantId: string,
  movimentoOriginalId: string,
  movimentoEstornoId: string,
): Promise<number> {
  // Grava o NEGATIVO nas mesmas linhas: o saldo do lote volta sozinho, porque é a soma.
  // Devolver ao "estoque geral" sem isto deixaria o lote consumido para sempre e o
  // alerta de validade cego para mercadoria que voltou à prateleira.
  const r: any = await tx.execute(sql`
    insert into movimento_lote (tenant_id, movimento_id, lote_id, quantidade)
    select ${tenantId}, ${movimentoEstornoId}, ml.lote_id, -ml.quantidade
      from movimento_lote ml
     where ml.tenant_id = ${tenantId}
       and ml.movimento_id = ${movimentoOriginalId}
       and ml.quantidade > 0
    returning id
  `);
  return (r.rows ?? r).length;
}

/** Saldo real de cada lote de um item (o que entrou menos o consumido). */
export function saldoLoteSql(alias = 'l') {
  return sql`(${sql.raw(alias)}.quantidade - coalesce((
    select sum(ml.quantidade) from movimento_lote ml where ml.lote_id = ${sql.raw(alias)}.id
  ), 0))`;
}
