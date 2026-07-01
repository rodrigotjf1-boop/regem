import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { colaborador } from '../../db/schema';
import { CreateColaboradorDto } from './dto/create-colaborador.dto';

// Colunas públicas: nunca expõe senha_hash / pin_hash.
const publicCols = {
  id: colaborador.id,
  tenantId: colaborador.tenantId,
  nome: colaborador.nome,
  fotoRef: colaborador.fotoRef,
  funcaoId: colaborador.funcaoId,
  vinculo: colaborador.vinculo,
  email: colaborador.email,
  status: colaborador.status,
  createdAt: colaborador.createdAt,
  updatedAt: colaborador.updatedAt,
};

@Injectable()
export class ColaboradorService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateColaboradorDto) {
    const [row] = await this.db
      .insert(colaborador)
      .values({
        tenantId,
        nome: dto.nome,
        funcaoId: dto.funcaoId,
        vinculo: dto.vinculo ?? 'clt',
      })
      .returning(publicCols);
    return row;
  }

  findAll(tenantId: string) {
    return this.db
      .select(publicCols)
      .from(colaborador)
      .where(and(eq(colaborador.tenantId, tenantId), isNull(colaborador.deletedAt)));
  }
}
