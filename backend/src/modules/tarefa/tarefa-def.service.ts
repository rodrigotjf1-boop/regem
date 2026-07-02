import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { tarefaDef, unidade, etiqueta } from '../../db/schema';
import { CreateTarefaDefDto } from './dto/create-tarefa-def.dto';

@Injectable()
export class TarefaDefService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateTarefaDefDto) {
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

    if (dto.etiquetaId) {
      const [e] = await this.db
        .select({ id: etiqueta.id })
        .from(etiqueta)
        .where(
          and(
            eq(etiqueta.id, dto.etiquetaId),
            eq(etiqueta.tenantId, tenantId),
            isNull(etiqueta.deletedAt),
          ),
        );
      if (!e) throw new BadRequestException('Etiqueta inválida para este tenant');
    }

    const [row] = await this.db
      .insert(tarefaDef)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        setorId: dto.setorId,
        origem: dto.origem ?? 'avulsa',
        titulo: dto.titulo,
        horario: dto.horario,
        descricao: dto.descricao,
        etiquetaId: dto.etiquetaId,
        colaboradorOverrideId: dto.colaboradorOverrideId,
        recorrenciaTipo: dto.recorrenciaTipo ?? 'avulsa',
        proibidaNoPico: dto.proibidaNoPico ?? false,
        antecipavel: dto.antecipavel ?? false,
      })
      .returning();
    return row;
  }

  findAll(tenantId: string) {
    return this.db
      .select()
      .from(tarefaDef)
      .where(and(eq(tarefaDef.tenantId, tenantId), isNull(tarefaDef.deletedAt)));
  }
}
