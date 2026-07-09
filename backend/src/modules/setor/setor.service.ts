import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { setor, unidade } from '../../db/schema';
import { CreateSetorDto } from './dto/create-setor.dto';

@Injectable()
export class SetorService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateSetorDto) {
    // A unidade referenciada precisa ser do mesmo tenant (ref cross-tenant-safe).
    const [uni] = await this.db
      .select({ id: unidade.id })
      .from(unidade)
      .where(
        and(
          eq(unidade.id, dto.unidadeId),
          eq(unidade.tenantId, tenantId),
          isNull(unidade.deletedAt),
        ),
      );
    if (!uni) throw new BadRequestException('Unidade inválida para este tenant');

    const [row] = await this.db
      .insert(setor)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        nome: dto.nome,
        icone: dto.icone,
        cor: dto.cor,
      })
      .returning();
    return row;
  }

  // Edição (presidente/gerente): nome/ícone/cor do setor.
  async update(
    tenantId: string,
    id: string,
    dto: { nome?: string; icone?: string; cor?: string },
  ) {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.nome !== undefined) patch.nome = dto.nome;
    if (dto.icone !== undefined) patch.icone = dto.icone;
    if (dto.cor !== undefined) patch.cor = dto.cor;
    const [row] = await this.db
      .update(setor)
      .set(patch)
      .where(
        and(
          eq(setor.id, id),
          eq(setor.tenantId, tenantId),
          isNull(setor.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Setor não encontrado');
    return row;
  }

  async remove(tenantId: string, id: string) {
    // Guarda: não excluir setor com funções, turnos, etiquetas ou janelas ativas.
    const r: any = await this.db.execute(sql`
      select
        (select count(*) from funcao where setor_id = ${id} and deleted_at is null)
      + (select count(*) from turno where setor_id = ${id} and deleted_at is null)
      + (select count(*) from etiqueta where setor_id = ${id} and deleted_at is null)
      + (select count(*) from janela_pico where setor_id = ${id} and deleted_at is null)
        as n
    `);
    if (Number((r.rows ?? r)[0]?.n ?? 0) > 0) {
      throw new BadRequestException(
        'Remova antes as funções, turnos, etiquetas e janelas deste setor.',
      );
    }
    const [row] = await this.db
      .update(setor)
      .set({ deletedAt: new Date() })
      .where(and(eq(setor.id, id), eq(setor.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Setor não encontrado');
    return { ok: true };
  }

  findAll(tenantId: string) {
    return this.db
      .select()
      .from(setor)
      .where(and(eq(setor.tenantId, tenantId), isNull(setor.deletedAt)));
  }
}
