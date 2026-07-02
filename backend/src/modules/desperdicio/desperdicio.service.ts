import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { desperdicio } from '../../db/schema';
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

  findAll(tenantId: string) {
    return this.db
      .select()
      .from(desperdicio)
      .where(and(eq(desperdicio.tenantId, tenantId), isNull(desperdicio.deletedAt)))
      .orderBy(desc(desperdicio.createdAt));
  }
}
