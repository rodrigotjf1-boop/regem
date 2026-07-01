import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { escalaAlocacao, etiqueta, turno } from '../../db/schema';
import { CreateAlocacaoDto } from './dto/create-alocacao.dto';

@Injectable()
export class EscalaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateAlocacaoDto) {
    // A unidade deriva da etiqueta (ambas do mesmo tenant).
    const [et] = await this.db
      .select({ id: etiqueta.id, unidadeId: etiqueta.unidadeId })
      .from(etiqueta)
      .where(
        and(
          eq(etiqueta.id, dto.etiquetaId),
          eq(etiqueta.tenantId, tenantId),
          isNull(etiqueta.deletedAt),
        ),
      );
    if (!et) throw new BadRequestException('Etiqueta inválida para este tenant');

    const [tn] = await this.db
      .select({ id: turno.id })
      .from(turno)
      .where(
        and(
          eq(turno.id, dto.turnoId),
          eq(turno.tenantId, tenantId),
          isNull(turno.deletedAt),
        ),
      );
    if (!tn) throw new BadRequestException('Turno inválido para este tenant');

    // Sobreposição: o colaborador não pode estar em duas vagas no mesmo dia/turno.
    if (dto.colaboradorId) {
      const conflito = await this.db
        .select({ id: escalaAlocacao.id })
        .from(escalaAlocacao)
        .where(
          and(
            eq(escalaAlocacao.tenantId, tenantId),
            eq(escalaAlocacao.data, dto.data),
            eq(escalaAlocacao.turnoId, dto.turnoId),
            eq(escalaAlocacao.colaboradorId, dto.colaboradorId),
            isNull(escalaAlocacao.deletedAt),
          ),
        );
      if (conflito.length) {
        throw new ConflictException('Colaborador já alocado neste turno/dia');
      }
    }

    try {
      const [row] = await this.db
        .insert(escalaAlocacao)
        .values({
          tenantId,
          unidadeId: et.unidadeId,
          data: dto.data,
          turnoId: dto.turnoId,
          etiquetaId: dto.etiquetaId,
          colaboradorId: dto.colaboradorId,
          tipo: dto.tipo ?? 'titular',
        })
        .returning();
      return row;
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictException(
          'Esta etiqueta já está alocada neste turno/dia',
        );
      }
      throw e;
    }
  }

  findAll(tenantId: string, data?: string) {
    const conds = [
      eq(escalaAlocacao.tenantId, tenantId),
      isNull(escalaAlocacao.deletedAt),
    ];
    if (data) conds.push(eq(escalaAlocacao.data, data));
    return this.db
      .select()
      .from(escalaAlocacao)
      .where(and(...conds));
  }
}
