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
  // Escopo por loja: `lote` NÃO tem `unidade_id` própria, então herda a do insumo —
  // a da loja OU nula (catálogo da rede, que qualquer filial usa). Sem isso a tela
  // listava lote de TODAS as lojas do tenant. Usar `= atual` puro (como a tela de
  // validades fazia) seria pior: esconderia todo insumo de rede, e a tela nasceria
  // vazia em quem nunca preencheu a unidade no cadastro.
  async listar(tenantId: string, atual: string | null = null) {
    const r: any = await this.db.execute(sql`
      select l.id, l.validade, l.quantidade, l.entrada,
        i.nome as "itemNome", i.unidade_medida as "unidade"
      from lote l
      join item_estoque i on i.id = l.item_id
      where l.tenant_id = ${tenantId} and l.deleted_at is null
        and l.esgotado = false and l.quantidade > 0 ${sqlUnidadeOuRede('i.unidade_id', atual)}
      order by l.validade asc nulls last
    `);
    return (r.rows ?? r).map((x: any) => ({
      ...x,
      quantidade: Number(x.quantidade),
    }));
  }
}
