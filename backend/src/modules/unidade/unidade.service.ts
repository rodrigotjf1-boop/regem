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
import { AuditoriaService } from '../auditoria/auditoria.service';

// Ator da operação (para auditoria) — vem do @CurrentUser do controller.
type Ator = { colaboradorId?: string; categoria?: string };

// Todas as operações são escopadas ao tenantId do usuário autenticado.
@Injectable()
export class UnidadeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  async create(tenantId: string, dto: CreateUnidadeDto, ator?: Ator) {
    const [row] = await this.db
      .insert(unidade)
      .values({ tenantId, nome: dto.nome, tipo: dto.tipo ?? 'filial', endereco: dto.endereco })
      .returning();
    // Auditoria: unidade criada.
    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.colaboradorId,
      atorPerfil: ator?.categoria,
      tipo: 'cadastro',
      acao: 'unidade_criada',
      entidadeTipo: 'unidade',
      entidadeId: row.id,
      origem: 'web',
    });
    return row;
  }

  findAll(tenantId: string) {
    return this.db
      .select()
      .from(unidade)
      .where(and(eq(unidade.tenantId, tenantId), isNull(unidade.deletedAt)));
  }

  async update(tenantId: string, id: string, dto: CreateUnidadeDto, ator?: Ator) {
    const [row] = await this.db
      .update(unidade)
      .set({ nome: dto.nome, ...(dto.tipo ? { tipo: dto.tipo } : {}), endereco: dto.endereco })
      .where(
        and(
          eq(unidade.id, id),
          eq(unidade.tenantId, tenantId),
          isNull(unidade.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Unidade não encontrada.');
    // Auditoria: unidade editada.
    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.colaboradorId,
      atorPerfil: ator?.categoria,
      tipo: 'cadastro',
      acao: 'unidade_editada',
      entidadeTipo: 'unidade',
      entidadeId: id,
      origem: 'web',
    });
    return row;
  }

  async remove(tenantId: string, id: string, ator?: Ator) {
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
    // Auditoria: unidade removida.
    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.colaboradorId,
      atorPerfil: ator?.categoria,
      tipo: 'cadastro',
      acao: 'unidade_removida',
      entidadeTipo: 'unidade',
      entidadeId: id,
      origem: 'web',
    });
    return { ok: true };
  }
}
