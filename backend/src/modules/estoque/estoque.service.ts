import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, desc, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { itemEstoque, movimentoEstoque } from '../../db/schema';
import { CreateItemDto } from './dto/create-item.dto';
import { CreateMovimentoDto } from './dto/create-movimento.dto';

@Injectable()
export class EstoqueService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async createItem(tenantId: string, dto: CreateItemDto) {
    const [row] = await this.db
      .insert(itemEstoque)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        nome: dto.nome,
        unidadeMedida: dto.unidadeMedida ?? 'un',
        estoqueMinimo:
          dto.estoqueMinimo != null ? String(dto.estoqueMinimo) : undefined,
        categoria: dto.categoria,
      })
      .returning();
    return row;
  }

  // Saldo derivado do ledger (entrada +, saida -, ajuste sinalizado).
  async listItens(tenantId: string) {
    const res: any = await this.db.execute(sql`
      select i.id, i.nome, i.unidade_medida as "unidadeMedida",
             i.estoque_minimo as "estoqueMinimo",
             coalesce(sum(case m.tipo
               when 'entrada' then m.quantidade
               when 'saida'   then -m.quantidade
               else m.quantidade end), 0) as saldo
      from item_estoque i
      left join movimento_estoque m on m.item_id = i.id
      where i.tenant_id = ${tenantId} and i.deleted_at is null
      group by i.id
      order by i.nome
    `);
    return res.rows ?? res;
  }

  async createMovimento(tenantId: string, dto: CreateMovimentoDto) {
    const [it] = await this.db
      .select({ id: itemEstoque.id })
      .from(itemEstoque)
      .where(
        and(
          eq(itemEstoque.id, dto.itemId),
          eq(itemEstoque.tenantId, tenantId),
          isNull(itemEstoque.deletedAt),
        ),
      );
    if (!it) throw new BadRequestException('Item inválido para este tenant');

    const [row] = await this.db
      .insert(movimentoEstoque)
      .values({
        tenantId,
        itemId: dto.itemId,
        tipo: dto.tipo,
        quantidade: String(dto.quantidade),
        motivo: dto.motivo,
        data: dto.data,
      })
      .returning();
    return row;
  }

  listMovimentos(tenantId: string, itemId: string) {
    return this.db
      .select()
      .from(movimentoEstoque)
      .where(
        and(
          eq(movimentoEstoque.tenantId, tenantId),
          eq(movimentoEstoque.itemId, itemId),
        ),
      )
      .orderBy(desc(movimentoEstoque.createdAt));
  }
}
