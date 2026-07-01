import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { etiqueta, setor, funcao } from '../../db/schema';
import { CreateEtiquetaDto } from './dto/create-etiqueta.dto';

@Injectable()
export class EtiquetaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateEtiquetaDto) {
    // Setor e função precisam ser do mesmo tenant; a unidade deriva do setor.
    const [s] = await this.db
      .select({ id: setor.id, unidadeId: setor.unidadeId })
      .from(setor)
      .where(
        and(
          eq(setor.id, dto.setorId),
          eq(setor.tenantId, tenantId),
          isNull(setor.deletedAt),
        ),
      );
    if (!s) throw new BadRequestException('Setor inválido para este tenant');

    const [f] = await this.db
      .select({ id: funcao.id })
      .from(funcao)
      .where(
        and(
          eq(funcao.id, dto.funcaoId),
          eq(funcao.tenantId, tenantId),
          isNull(funcao.deletedAt),
        ),
      );
    if (!f) throw new BadRequestException('Função inválida para este tenant');

    try {
      const [row] = await this.db
        .insert(etiqueta)
        .values({
          tenantId,
          unidadeId: s.unidadeId,
          setorId: dto.setorId,
          funcaoId: dto.funcaoId,
          sigla: dto.sigla,
          contador: dto.contador ?? 1,
          cor: dto.cor,
          icone: dto.icone,
          titularPadraoColaboradorId: dto.titularPadraoColaboradorId,
        })
        .returning();
      return row;
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictException(
          'Já existe etiqueta com essa sigla+contador na unidade',
        );
      }
      throw e;
    }
  }

  findAll(tenantId: string) {
    return this.db
      .select()
      .from(etiqueta)
      .where(and(eq(etiqueta.tenantId, tenantId), isNull(etiqueta.deletedAt)));
  }
}
