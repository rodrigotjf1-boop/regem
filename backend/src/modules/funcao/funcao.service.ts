import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { funcao } from '../../db/schema';
import { CreateFuncaoDto } from './dto/create-funcao.dto';

@Injectable()
export class FuncaoService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateFuncaoDto) {
    const [row] = await this.db
      .insert(funcao)
      .values({
        tenantId,
        nome: dto.nome,
        categoria: dto.categoria ?? 'execucao',
        setorId: dto.setorId,
      })
      .returning();
    return row;
  }

  findAll(tenantId: string) {
    return this.db
      .select()
      .from(funcao)
      .where(and(eq(funcao.tenantId, tenantId), isNull(funcao.deletedAt)));
  }
}
