import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { sqlUnidadeOuRede } from '../../common/filtro-unidade';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class LoteService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Lotes ativos ordenados por validade (FEFO: vence primeiro, sai primeiro).
  //
  // Escopo por loja: pela loja do LOTE (mig 246) — antes herdava a do insumo, e o lote
  // da loja B aparecia na tela da A quando o insumo era compartilhado. Lote antigo sem
  // loja aparece para as duas. (Comentário original, mantido pelo histórico:)
  // Escopo por loja: `lote` NÃO tinha `unidade_id` própria, então herdava a do insumo —
  // a da loja OU nula (catálogo da rede, que qualquer filial usa). Sem isso a tela
  // listava lote de TODAS as lojas do tenant. Usar `= atual` puro (como a tela de
  // validades fazia) seria pior: esconderia todo insumo de rede, e a tela nasceria
  // vazia em quem nunca preencheu a unidade no cadastro.
  async listar(tenantId: string, atual: string | null = null) {
    const r: any = await this.db.execute(sql`
      select l.id, l.validade, l.entrada, l.codigo,
        (l.quantidade - coalesce((select sum(ml.quantidade) from movimento_lote ml where ml.lote_id = l.id), 0)) as quantidade,
        l.quantidade as "quantidadeEntrada",
        i.nome as "itemNome", i.unidade_medida as "unidade"
      from lote l
      join item_estoque i on i.id = l.item_id
      where l.tenant_id = ${tenantId} and l.deleted_at is null
        and l.esgotado = false
        -- Saldo DERIVADO (mig 248): lote.quantidade é o que ENTROU e nunca muda; o
        -- consumido é a soma de movimento_lote. Antes esta coluna era o saldo e nunca
        -- decrementava, então lote já todo consumido seguia na lista para sempre.
        and (l.quantidade - coalesce((select sum(ml.quantidade) from movimento_lote ml where ml.lote_id = l.id), 0)) > 0 ${sqlUnidadeOuRede('l.unidade_id', atual)}
      order by l.validade asc nulls last
    `);
    return (r.rows ?? r).map((x: any) => ({
      ...x,
      quantidade: Number(x.quantidade),
    }));
  }
}
