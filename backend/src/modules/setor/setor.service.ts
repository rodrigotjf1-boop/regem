import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { setor, unidade } from '../../db/schema';
import { CreateSetorDto } from './dto/create-setor.dto';

@Injectable()
export class SetorService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateSetorDto) {
    // A unidade referenciada precisa ser do mesmo tenant (ref cross-tenant-safe).
    const [uni] = await this.db
      .select({ id: unidade.id })
      .from(unidade)
      .where(
        and(
          eq(unidade.id, dto.unidadeId),
          eq(unidade.tenantId, tenantId),
          isNull(unidade.deletedAt),
        ),
      );
    if (!uni) throw new BadRequestException('Unidade inválida para este tenant');

    const [row] = await this.db
      .insert(setor)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        nome: dto.nome,
        icone: dto.icone,
      })
      .returning();
    return row;
  }

  findAll(tenantId: string) {
    return this.db
      .select()
      .from(setor)
      .where(and(eq(setor.tenantId, tenantId), isNull(setor.deletedAt)));
  }
}
