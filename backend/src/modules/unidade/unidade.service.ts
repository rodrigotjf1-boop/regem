import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
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

  async update(tenantId: string, id: string, dto: CreateUnidadeDto) {
    const [row] = await this.db
      .update(unidade)
      .set({ nome: dto.nome, endereco: dto.endereco })
      .where(
        and(
          eq(unidade.id, id),
          eq(unidade.tenantId, tenantId),
          isNull(unidade.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Unidade não encontrada.');
    return row;
  }

  async remove(tenantId: string, id: string) {
    // Guarda: não excluir unidade com setores, turnos ou janelas ativas.
    const r: any = await this.db.execute(sql`
      select
        (select count(*) from setor where unidade_id = ${id} and deleted_at is null)
      + (select count(*) from turno where unidade_id = ${id} and deleted_at is null)
      + (select count(*) from janela_pico where unidade_id = ${id} and deleted_at is null)
        as n
    `);
    if (Number((r.rows ?? r)[0]?.n ?? 0) > 0) {
      throw new BadRequestException(
        'Remova antes os setores, turnos e janelas desta unidade.',
      );
    }
    const [row] = await this.db
      .update(unidade)
      .set({ deletedAt: new Date() })
      .where(and(eq(unidade.id, id), eq(unidade.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Unidade não encontrada.');
    return { ok: true };
  }
}
