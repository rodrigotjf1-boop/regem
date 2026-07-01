import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { turno, unidade } from '../../db/schema';
import { CreateTurnoDto } from './dto/create-turno.dto';

@Injectable()
export class TurnoService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateTurnoDto) {
    const [u] = await this.db
      .select({ id: unidade.id })
      .from(unidade)
      .where(
        and(
          eq(unidade.id, dto.unidadeId),
          eq(unidade.tenantId, tenantId),
          isNull(unidade.deletedAt),
        ),
      );
    if (!u) throw new BadRequestException('Unidade inválida para este tenant');

    const [row] = await this.db
      .insert(turno)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        setorId: dto.setorId,
        nome: dto.nome,
        horaInicio: dto.horaInicio,
        horaFim: dto.horaFim,
      })
      .returning();
    return row;
  }

  findAll(tenantId: string) {
    return this.db
      .select()
      .from(turno)
      .where(and(eq(turno.tenantId, tenantId), isNull(turno.deletedAt)));
  }
}
