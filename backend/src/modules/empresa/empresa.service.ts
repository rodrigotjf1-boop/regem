import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { empresa } from '../../db/schema';
import { CreateEmpresaDto } from './dto/create-empresa.dto';

@Injectable()
export class EmpresaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(dto: CreateEmpresaDto) {
    const [row] = await this.db.insert(empresa).values(dto).returning();
    return row;
  }

  findAll() {
    return this.db.select().from(empresa).where(isNull(empresa.deletedAt));
  }

  async findOne(id: string) {
    const [row] = await this.db
      .select()
      .from(empresa)
      .where(and(eq(empresa.id, id), isNull(empresa.deletedAt)));
    if (!row) throw new NotFoundException('Empresa não encontrada');
    return row;
  }

  // Config do presidente: janela de espelho do servidor local e hora do snapshot de
  // estoque. Grava SÓ o que veio — antes o campo único era obrigatório; com dois, salvar
  // a hora não pode resetar a janela para o padrão.
  async atualizarConfig(id: string, dto: { mirrorDias?: number; snapshotHora?: string }) {
    const patch: Record<string, any> = { updatedAt: new Date() };
    if (dto.mirrorDias != null)
      patch.mirrorDias = Math.min(3650, Math.max(7, Math.round(Number(dto.mirrorDias) || 60)));
    if (dto.snapshotHora != null) {
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(dto.snapshotHora))
        throw new BadRequestException('Hora do fechamento inválida (use HH:MM).');
      patch.snapshotHora = dto.snapshotHora;
    }
    const [row] = await this.db
      .update(empresa)
      .set(patch)
      .where(and(eq(empresa.id, id), isNull(empresa.deletedAt)))
      .returning();
    if (!row) throw new NotFoundException('Empresa não encontrada');
    return row;
  }
}
