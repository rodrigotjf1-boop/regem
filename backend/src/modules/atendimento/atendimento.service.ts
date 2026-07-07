import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { atendimentoChamado } from '../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class AtendimentoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
  ) {}

  // Abre um chamado (handoff do robô → humano). Dispara alerta em tempo real.
  async abrir(
    tenantId: string,
    unidadeId: string | null,
    dto: { tipo?: string; cliente?: string; telefone?: string; pedidoNumero?: string; mensagem?: string },
  ) {
    const tipo = ['mudanca', 'erro', 'humano', 'outro'].includes(dto.tipo ?? '')
      ? dto.tipo
      : 'humano';
    const [row] = await this.db
      .insert(atendimentoChamado)
      .values({
        tenantId,
        unidadeId: unidadeId ?? null,
        tipo,
        cliente: dto.cliente?.trim() || null,
        telefone: dto.telefone?.trim() || null,
        pedidoNumero: dto.pedidoNumero != null ? String(dto.pedidoNumero) : null,
        mensagem: dto.mensagem?.trim() || null,
      })
      .returning();
    this.events.emit('atendimento.novo', { tenantId, chamado: row });
    return { ok: true, id: row.id };
  }

  listar(tenantId: string, status = 'aberto') {
    return this.db
      .select()
      .from(atendimentoChamado)
      .where(and(eq(atendimentoChamado.tenantId, tenantId), eq(atendimentoChamado.status, status)))
      .orderBy(desc(atendimentoChamado.criadoEm))
      .limit(100);
  }

  async resolver(tenantId: string, id: string, atorId: string) {
    const [row] = await this.db
      .update(atendimentoChamado)
      .set({ status: 'resolvido', resolvidoPorId: atorId, resolvidoEm: new Date() })
      .where(and(eq(atendimentoChamado.tenantId, tenantId), eq(atendimentoChamado.id, id)))
      .returning();
    if (!row) throw new NotFoundException('Chamado não encontrado');
    return { ok: true };
  }
}
