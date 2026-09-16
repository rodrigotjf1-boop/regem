import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { consumirLotes } from '../../common/lotes';
import { desperdicio, itemEstoque, movimentoEstoque } from '../../db/schema';
import { AuthUser } from '../../auth/auth-user';
import { condUnidade, condUnidadeOuRede } from '../../common/filtro-unidade';
import { CreateDesperdicioDto } from './dto/create-desperdicio.dto';

@Injectable()
export class DesperdicioService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // `txExterna`: quem já está numa transação (a perda de etiqueta trava a linha e
  // muda o status no mesmo commit) passa a dela. Sem isto o desperdício commitaria
  // sozinho e uma falha logo depois deixaria perda registrada com etiqueta aberta —
  // mesmo motivo do `produzir(…, txExterna)` da ordem de produção.
  async create(
    tenantId: string,
    dto: CreateDesperdicioDto,
    atual: string | null = null,
    txExterna?: any,
  ) {
    const db: any = txExterna ?? this.db;
    // Desperdício vinculado a item baixa o estoque de verdade (movimento saída
    // motivo 'desperdicio') ao custo médio, e é valorizado por custo_unitario.
    // Sem item, permanece apenas um log textual (comportamento antigo).
    if (!dto.itemId) {
      const [row] = await db
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
    const [item] = await db
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
          // Insumo da loja OU da rede (unidade nula) — a mesma regra do recebimento
          // e dos lotes. Com `= atual` estrito, o insumo de rede (a maioria em quem
          // nunca separou catálogo por filial) dava 404 para o usuário de loja.
          condUnidadeOuRede(itemEstoque.unidadeId, atual),
          isNull(itemEstoque.deletedAt),
        ),
      );
    if (!item) throw new NotFoundException('Item de estoque não encontrado.');

    const corpo = async (tx: any) => {
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

      const [mov] = await tx
        .insert(movimentoEstoque)
        .values({
          tenantId,
          itemId: dto.itemId!,
          tipo: 'saida',
          quantidade: String(dto.quantidade),
          custoUnitario: item.custoMedio,
          motivo: 'desperdicio',
          refTipo: 'desperdicio',
          refId: row.id,
          data: dto.data ?? undefined,
        })
        .returning({ id: movimentoEstoque.id });
      // PVPS/FEFO (mig 248): tira do lote que vence primeiro. Sobra sem lote não
      // trava a perda — o registro do desperdício é o que importa.
      await consumirLotes(tx, tenantId, dto.itemId!, Number(dto.quantidade), mov.id);
      return row;
    };
    return txExterna ? corpo(txExterna) : this.db.transaction(corpo);
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
