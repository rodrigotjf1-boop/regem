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
import { AuditoriaService } from '../auditoria/auditoria.service';

// Ator da operação (para auditoria) — vem do @CurrentUser do controller.
type Ator = { colaboradorId?: string; categoria?: string };

@Injectable()
export class SetorService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  async create(tenantId: string, dto: CreateSetorDto, ator?: Ator) {
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
    // Auditoria: setor criado.
    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.colaboradorId,
      atorPerfil: ator?.categoria,
      tipo: 'cadastro',
      acao: 'setor_criado',
      entidadeTipo: 'setor',
      entidadeId: row.id,
      origem: 'web',
    });
    return row;
  }

  // Edição (presidente/gerente): nome/ícone/cor do setor.
  async update(
    tenantId: string,
    id: string,
    dto: { nome?: string; icone?: string; cor?: string },
    ator?: Ator,
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
    // Auditoria: setor editado.
    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.colaboradorId,
      atorPerfil: ator?.categoria,
      tipo: 'cadastro',
      acao: 'setor_editado',
      entidadeTipo: 'setor',
      entidadeId: id,
      origem: 'web',
    });
    return row;
  }

  async remove(tenantId: string, id: string, ator?: Ator) {
    // Guarda: não excluir setor com funções, turnos, etiquetas ou janelas ativas.
    const r: any = await this.db.execute(sql`
      select
        (select count(*) from funcao where setor_id = ${id} and deleted_at is null) as funcoes,
        (select count(*) from turno where setor_id = ${id} and deleted_at is null) as turnos,
        (select count(*) from etiqueta where setor_id = ${id} and deleted_at is null) as etiquetas,
        (select count(*) from janela_pico where setor_id = ${id} and deleted_at is null) as janelas
    `);
    const c = (r.rows ?? r)[0] ?? {};
    // Diz EXATAMENTE o que está preso: "remova as funções e turnos" genérico não
    // ajuda quem não sabe onde procurar.
    const presos = [
      [Number(c.funcoes) || 0, 'função', 'funções'],
      [Number(c.turnos) || 0, 'turno', 'turnos'],
      [Number(c.etiquetas) || 0, 'etiqueta', 'etiquetas'],
      [Number(c.janelas) || 0, 'janela de pico', 'janelas de pico'],
    ]
      .filter(([n]) => (n as number) > 0)
      .map(([n, sing, plur]) => `${n} ${n === 1 ? sing : plur}`);
    if (presos.length) {
      throw new BadRequestException(
        `Este setor ainda tem ${presos.join(' e ')}. Exclua esses itens antes de remover o setor.`,
      );
    }
    const [row] = await this.db
      .update(setor)
      .set({ deletedAt: new Date() })
      .where(and(eq(setor.id, id), eq(setor.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Setor não encontrado');
    // Auditoria: setor removido.
    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.colaboradorId,
      atorPerfil: ator?.categoria,
      tipo: 'cadastro',
      acao: 'setor_removido',
      entidadeTipo: 'setor',
      entidadeId: id,
      origem: 'web',
    });
    return { ok: true };
  }

  findAll(tenantId: string, unidadeId?: string | null) {
    return this.db
      .select()
      .from(setor)
      .where(
        and(
          eq(setor.tenantId, tenantId),
          isNull(setor.deletedAt),
          ...(unidadeId ? [eq(setor.unidadeId, unidadeId)] : []),
        ),
      );
  }
}
