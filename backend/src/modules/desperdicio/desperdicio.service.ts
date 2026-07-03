import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { desperdicio } from '../../db/schema';
import { AuthUser } from '../../auth/auth-user';
import { CreateDesperdicioDto } from './dto/create-desperdicio.dto';

@Injectable()
export class DesperdicioService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateDesperdicioDto) {
    const [row] = await this.db
      .insert(desperdicio)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        setorId: dto.setorId,
        colaboradorId: dto.colaboradorId,
        descricao: dto.descricao,
        quantidade: dto.quantidade != null ? String(dto.quantidade) : undefined,
        unidadeMedida: dto.unidadeMedida,
        motivo: dto.motivo,
        fotoRef: dto.fotoRef,
        data: dto.data,
      })
      .returning();
    return row;
  }

  // Escopo RBAC: supervisor vê só o próprio setor; demais perfis veem tudo do tenant.
  findAll(user: AuthUser) {
    const conds = [
      eq(desperdicio.tenantId, user.tenantId),
      isNull(desperdicio.deletedAt),
    ];
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
