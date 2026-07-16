import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { desperdicio, itemEstoque, movimentoEstoque } from '../../db/schema';
import { AuthUser } from '../../auth/auth-user';
import { condUnidade } from '../../common/filtro-unidade';
import { CreateDesperdicioDto } from './dto/create-desperdicio.dto';

@Injectable()
export class DesperdicioService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateDesperdicioDto, atual: string | null = null) {
    // Desperdício vinculado a item baixa o estoque de verdade (movimento saída
    // motivo 'desperdicio') ao custo médio, e é valorizado por custo_unitario.
    // Sem item, permanece apenas um log textual (comportamento antigo).
    if (!dto.itemId) {
      const [row] = await this.db
        .insert(desperdicio)
        .values({
          tenantId,
          unidadeId: atual ?? dto.unidadeId,
          setorId: dto.setorId,
          colaboradorId: dto.colaboradorId,
          descricao: dto.descricao,
          quantidade:
            dto.quantidade != null ? String(dto.quantidade) : undefined,
          unidadeMedida: dto.unidadeMedida,
          motivo: dto.motivo,
          fotoRef: dto.fotoRef,
          data: dto.data,
        })
        .returning();
      return row;
    }

    if (!dto.quantidade || dto.quantidade <= 0) {
      throw new BadRequestException(
        'Informe a quantidade para desperdício vinculado a item.',
      );
    }
    const [item] = await this.db
      .select({
        id: itemEstoque.id,
        custoMedio: itemEstoque.custoMedio,
        unidadeMedida: itemEstoque.unidadeMedida,
      })
      .from(itemEstoque)
      .where(
        and(
          eq(itemEstoque.id, dto.itemId),
          eq(itemEstoque.tenantId, tenantId),
          condUnidade(itemEstoque.unidadeId, atual),
          isNull(itemEstoque.deletedAt),
        ),
      );
    if (!item) throw new NotFoundException('Item de estoque não encontrado.');

    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(desperdicio)
        .values({
          tenantId,
          unidadeId: atual ?? dto.unidadeId,
          setorId: dto.setorId,
          colaboradorId: dto.colaboradorId,
          descricao: dto.descricao,
          itemId: dto.itemId,
          custoUnitario: item.custoMedio,
          quantidade: String(dto.quantidade),
          unidadeMedida: dto.unidadeMedida ?? item.unidadeMedida,
          motivo: dto.motivo,
          fotoRef: dto.fotoRef,
          data: dto.data,
        })
        .returning();

      await tx.insert(movimentoEstoque).values({
        tenantId,
        itemId: dto.itemId!,
        tipo: 'saida',
        quantidade: String(dto.quantidade),
        custoUnitario: item.custoMedio,
        motivo: 'desperdicio',
        refTipo: 'desperdicio',
        refId: row.id,
        data: dto.data ?? undefined,
      });
      return row;
    });
  }

  // Escopo RBAC: supervisor vê só o próprio setor; demais perfis veem tudo do tenant.
  findAll(user: AuthUser, atual: string | null = null) {
    const conds = [
      eq(desperdicio.tenantId, user.tenantId),
      isNull(desperdicio.deletedAt),
    ];
    const cu = condUnidade(desperdicio.unidadeId, atual);
    if (cu) conds.push(cu);
    if (user.categoria === 'supervisao' && user.setorId) {
      conds.push(eq(desperdicio.setorId, user.setorId));
    }
    return this.db
      .select()
      .from(desperdicio)
      .where(and(...conds))
      .orderBy(desc(desperdicio.createdAt));
  }
}
