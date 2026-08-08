import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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

  // Config do presidente. Hoje: janela de espelho (mirror_dias) que o servidor local
  // puxa da nuvem. Clampa numa faixa sã (a nuvem guarda tudo; isto só limita o edge).
  async atualizarConfig(id: string, dto: { mirrorDias: number }) {
    const dias = Math.min(3650, Math.max(7, Math.round(Number(dto.mirrorDias) || 60)));
    const [row] = await this.db
      .update(empresa)
      .set({ mirrorDias: dias, updatedAt: new Date() })
      .where(and(eq(empresa.id, id), isNull(empresa.deletedAt)))
      .returning();
    if (!row) throw new NotFoundException('Empresa não encontrada');
    return row;
  }
}
