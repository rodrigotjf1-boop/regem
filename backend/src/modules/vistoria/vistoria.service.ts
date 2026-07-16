import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, desc } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { vistoria } from '../../db/schema';
import { condUnidade } from '../../common/filtro-unidade';
import { CreateVistoriaDto } from './dto/create-vistoria.dto';

@Injectable()
export class VistoriaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateVistoriaDto, atual: string | null = null) {
    const [row] = await this.db
      .insert(vistoria)
      .values({
        tenantId,
        unidadeId: atual ?? dto.unidadeId,
        setorId: dto.setorId,
        tipo: dto.tipo,
        observacao: dto.observacao,
        fotoRef: dto.fotoRef,
        data: dto.data,
      })
      .returning();
    return row;
  }

  findAll(tenantId: string, atual: string | null = null) {
    return this.db
      .select()
      .from(vistoria)
      .where(and(eq(vistoria.tenantId, tenantId), condUnidade(vistoria.unidadeId, atual), isNull(vistoria.deletedAt)))
      .orderBy(desc(vistoria.createdAt));
  }
}
