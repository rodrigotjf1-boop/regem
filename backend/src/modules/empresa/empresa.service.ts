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
}
