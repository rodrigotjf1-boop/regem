import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { unidade } from '../../db/schema';
import { CreateUnidadeDto } from './dto/create-unidade.dto';

// Todas as operações são escopadas ao tenantId do usuário autenticado.
@Injectable()
export class UnidadeService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateUnidadeDto) {
    const [row] = await this.db
      .insert(unidade)
      .values({ tenantId, nome: dto.nome, endereco: dto.endereco })
      .returning();
    return row;
  }

  findAll(tenantId: string) {
    return this.db
      .select()
      .from(unidade)
      .where(and(eq(unidade.tenantId, tenantId), isNull(unidade.deletedAt)));
  }
}
