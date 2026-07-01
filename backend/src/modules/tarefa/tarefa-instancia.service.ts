import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { tarefaDef, tarefaInstancia, escalaAlocacao } from '../../db/schema';
import { InstanciarTarefaDto } from './dto/instanciar-tarefa.dto';
import { ConcluirTarefaDto } from './dto/concluir-tarefa.dto';

@Injectable()
export class TarefaInstanciaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Late-binding: resolve o colaborador da tarefa pela escala do dia.
  async instanciar(tenantId: string, dto: InstanciarTarefaDto) {
    const [def] = await this.db
      .select()
      .from(tarefaDef)
      .where(
        and(
          eq(tarefaDef.id, dto.tarefaDefId),
          eq(tarefaDef.tenantId, tenantId),
          isNull(tarefaDef.deletedAt),
        ),
      );
    if (!def) throw new NotFoundException('Tarefa não encontrada');

    // 1) override explícito vence; 2) senão, quem está na etiqueta naquela data.
    let colaboradorResolvidoId: string | null = def.colaboradorOverrideId ?? null;
    if (!colaboradorResolvidoId && def.etiquetaId) {
      const [aloc] = await this.db
        .select({ colaboradorId: escalaAlocacao.colaboradorId })
        .from(escalaAlocacao)
        .where(
          and(
            eq(escalaAlocacao.tenantId, tenantId),
            eq(escalaAlocacao.etiquetaId, def.etiquetaId),
            eq(escalaAlocacao.data, dto.data),
            isNull(escalaAlocacao.deletedAt),
          ),
        )
        .limit(1);
      colaboradorResolvidoId = aloc?.colaboradorId ?? null;
    }

    const [row] = await this.db
      .insert(tarefaInstancia)
      .values({
        tenantId,
        unidadeId: def.unidadeId,
        tarefaDefId: def.id,
        data: dto.data,
        etiquetaId: def.etiquetaId,
        colaboradorResolvidoId,
      })
      .returning();
    return row;
  }

  findAll(tenantId: string, data?: string) {
    const conds = [
      eq(tarefaInstancia.tenantId, tenantId),
      isNull(tarefaInstancia.deletedAt),
    ];
    if (data) conds.push(eq(tarefaInstancia.data, data));
    return this.db
      .select()
      .from(tarefaInstancia)
      .where(and(...conds));
  }

  async concluir(
    tenantId: string,
    id: string,
    dto: ConcluirTarefaDto,
    colaboradorId: string,
  ) {
    const [row] = await this.db
      .update(tarefaInstancia)
      .set({
        estado: dto.estado,
        motivo: dto.motivo,
        fotoRef: dto.fotoRef,
        concluidoPorId: colaboradorId,
        concluidoEm: new Date(),
        conclusaoEmMassa: dto.conclusaoEmMassa ?? false,
      })
      .where(
        and(eq(tarefaInstancia.id, id), eq(tarefaInstancia.tenantId, tenantId)),
      )
      .returning();
    if (!row) throw new NotFoundException('Instância não encontrada');
    return row;
  }
}
