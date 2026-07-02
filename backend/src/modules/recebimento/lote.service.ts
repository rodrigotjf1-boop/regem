import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class LoteService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Lotes ativos ordenados por validade (FEFO: vence primeiro, sai primeiro).
  async listar(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select l.id, l.validade, l.quantidade, l.entrada,
        i.nome as "itemNome", i.unidade_medida as "unidade"
      from lote l
      join item_estoque i on i.id = l.item_id
      where l.tenant_id = ${tenantId} and l.deleted_at is null
        and l.esgotado = false and l.quantidade > 0
      order by l.validade asc nulls last
    `);
    return (r.rows ?? r).map((x: any) => ({
      ...x,
      quantidade: Number(x.quantidade),
    }));
  }
}
