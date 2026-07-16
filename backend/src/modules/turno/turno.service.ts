import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
        pausaInicio: dto.pausaInicio || null,
        pausaFim: dto.pausaFim || null,
      })
      .returning();
    return row;
  }

  async update(
    tenantId: string,
    id: string,
    dto: {
      nome?: string;
      horaInicio?: string;
      horaFim?: string;
      pausaInicio?: string;
      pausaFim?: string;
    },
  ) {
    const [row] = await this.db
      .update(turno)
      .set({
        nome: dto.nome,
        horaInicio: dto.horaInicio,
        horaFim: dto.horaFim,
        pausaInicio: dto.pausaInicio || null,
        pausaFim: dto.pausaFim || null,
      })
      .where(
        and(
          eq(turno.id, id),
          eq(turno.tenantId, tenantId),
          isNull(turno.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Turno não encontrado.');
    return row;
  }

  async remove(tenantId: string, id: string) {
    const [row] = await this.db
      .update(turno)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(turno.id, id),
          eq(turno.tenantId, tenantId),
          isNull(turno.deletedAt),
        ),
      )
      .returning({ id: turno.id });
    if (!row) throw new NotFoundException('Turno não encontrado.');
    return { ok: true };
  }

  findAll(tenantId: string, unidadeId?: string | null) {
    return this.db
      .select()
      .from(turno)
      .where(
        and(
          eq(turno.tenantId, tenantId),
          isNull(turno.deletedAt),
          ...(unidadeId ? [eq(turno.unidadeId, unidadeId)] : []),
        ),
      );
  }
}
