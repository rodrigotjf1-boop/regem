import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { janelaPico } from '../../db/schema';
import { CreateJanelaPicoDto } from './dto/create-janela-pico.dto';

@Injectable()
export class PicoService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateJanelaPicoDto) {
    const [row] = await this.db
      .insert(janelaPico)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        nome: dto.nome,
        diaSemana: dto.diaSemana ?? null,
        horaInicio: dto.horaInicio,
        horaFim: dto.horaFim,
      })
      .returning();
    return row;
  }

  findAll(tenantId: string, unidadeId?: string) {
    const conds = [
      eq(janelaPico.tenantId, tenantId),
      isNull(janelaPico.deletedAt),
    ];
    if (unidadeId) conds.push(eq(janelaPico.unidadeId, unidadeId));
    return this.db
      .select()
      .from(janelaPico)
      .where(and(...conds))
      .orderBy(asc(janelaPico.horaInicio));
  }

  async update(
    tenantId: string,
    id: string,
    dto: {
      nome?: string;
      diaSemana?: number | null;
      horaInicio?: string;
      horaFim?: string;
    },
  ) {
    const [row] = await this.db
      .update(janelaPico)
      .set({
        nome: dto.nome,
        diaSemana: dto.diaSemana ?? null,
        horaInicio: dto.horaInicio,
        horaFim: dto.horaFim,
      })
      .where(
        and(
          eq(janelaPico.id, id),
          eq(janelaPico.tenantId, tenantId),
          isNull(janelaPico.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Janela de pico não encontrada.');
    return row;
  }

  async remove(tenantId: string, id: string) {
    await this.db
      .update(janelaPico)
      .set({ deletedAt: new Date() })
      .where(and(eq(janelaPico.tenantId, tenantId), eq(janelaPico.id, id)));
    return { ok: true };
  }
}
