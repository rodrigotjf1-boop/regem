import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { vistoria } from '../../db/schema';
import { CreateVistoriaDto } from './dto/create-vistoria.dto';

@Injectable()
export class VistoriaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateVistoriaDto) {
    const [row] = await this.db
      .insert(vistoria)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        setorId: dto.setorId,
        tipo: dto.tipo,
        observacao: dto.observacao,
        fotoRef: dto.fotoRef,
        data: dto.data,
      })
      .returning();
    return row;
  }

  findAll(tenantId: string) {
    return this.db
      .select()
      .from(vistoria)
      .where(and(eq(vistoria.tenantId, tenantId), isNull(vistoria.deletedAt)))
      .orderBy(desc(vistoria.createdAt));
  }
}
