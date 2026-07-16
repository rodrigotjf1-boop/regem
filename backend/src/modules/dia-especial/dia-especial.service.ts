import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, gte, isNull, lte, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { diaEspecial, escalaAlocacao } from '../../db/schema';
import { CreateDiaEspecialDto } from './dto/create-dia-especial.dto';

@Injectable()
export class DiaEspecialService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateDiaEspecialDto) {
    const [row] = await this.db
      .insert(diaEspecial)
      .values({
        tenantId,
        unidadeId: dto.unidadeId ?? null,
        colaboradorId: dto.colaboradorId ?? null,
        data: dto.data,
        dataFim: dto.dataFim ?? null,
        tipo: dto.tipo ?? 'evento',
        nome: dto.nome,
        descricao: dto.descricao ?? null,
      })
      .returning();

    // Férias de um colaborador: DESMARCA (soft-delete) as alocações dele no
    // intervalo — ele sai da escala nesses dias (a vaga fica aberta p/ cobertura).
    let desmarcadas = 0;
    if (dto.tipo === 'ferias' && dto.colaboradorId) {
      const ate = dto.dataFim ?? dto.data;
      const res = await this.db
        .update(escalaAlocacao)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(
          and(
            eq(escalaAlocacao.tenantId, tenantId),
            eq(escalaAlocacao.colaboradorId, dto.colaboradorId),
            gte(escalaAlocacao.data, dto.data),
            lte(escalaAlocacao.data, ate),
            isNull(escalaAlocacao.deletedAt),
          ),
        )
        .returning({ id: escalaAlocacao.id });
      desmarcadas = res.length;
    }
    return { ...row, desmarcadas };
  }

  // Dias que tocam o período [de, ate] (sobreposição por data/dataFim).
  listar(tenantId: string, de?: string, ate?: string) {
    const conds = [
      eq(diaEspecial.tenantId, tenantId),
      isNull(diaEspecial.deletedAt),
    ];
    if (ate) conds.push(lte(diaEspecial.data, ate));
    if (de)
      conds.push(
        gte(sql`coalesce(${diaEspecial.dataFim}, ${diaEspecial.data})`, de),
      );
    return this.db
      .select()
      .from(diaEspecial)
      .where(and(...conds))
      .orderBy(asc(diaEspecial.data));
  }

  async update(tenantId: string, id: string, dto: CreateDiaEspecialDto) {
    const [row] = await this.db
      .update(diaEspecial)
      .set({
        unidadeId: dto.unidadeId ?? null,
        colaboradorId: dto.colaboradorId ?? null,
        data: dto.data,
        dataFim: dto.dataFim ?? null,
        tipo: dto.tipo ?? 'evento',
        nome: dto.nome,
        descricao: dto.descricao ?? null,
      })
      .where(
        and(
          eq(diaEspecial.id, id),
          eq(diaEspecial.tenantId, tenantId),
          isNull(diaEspecial.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Dia especial não encontrado');
    return row;
  }

  async remover(tenantId: string, id: string) {
    const [row] = await this.db
      .update(diaEspecial)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(diaEspecial.id, id),
          eq(diaEspecial.tenantId, tenantId),
          isNull(diaEspecial.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Dia especial não encontrado');
    return { ok: true };
  }
}
