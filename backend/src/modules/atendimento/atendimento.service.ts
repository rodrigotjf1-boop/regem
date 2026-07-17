import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { atendimentoChamado } from '../../db/schema';
import { DeliveryService } from '../delivery/delivery.service';
import { AuthUser } from '../../auth/auth-user';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class AtendimentoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
    private readonly delivery: DeliveryService,
  ) {}

  // Abre um chamado (handoff do robô → humano). Dispara alerta em tempo real.
  async abrir(
    tenantId: string,
    unidadeId: string | null,
    dto: {
      tipo?: string;
      cliente?: string;
      telefone?: string;
      pedidoNumero?: string;
      pedidoId?: string;
      mensagem?: string;
    },
  ) {
    const tipo = ['mudanca', 'erro', 'humano', 'outro', 'cancelamento'].includes(dto.tipo ?? '')
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
        pedidoId: dto.pedidoId ?? null,
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

  // Veredito do cancelamento pedido pelo cliente. `aceita` cancela o pedido de
  // fato (delegando ao Delivery, que exige senha de gestor); senão só encerra o
  // chamado marcando a decisão como recusada.
  async decidirCancelamento(
    user: AuthUser,
    id: string,
    dto: { aceita?: boolean; senha?: string; motivo?: string },
  ) {
    const [row] = await this.db
      .select()
      .from(atendimentoChamado)
      .where(and(eq(atendimentoChamado.tenantId, user.tenantId), eq(atendimentoChamado.id, id)));
    if (!row) throw new NotFoundException('Chamado não encontrado');
    if (row.tipo !== 'cancelamento') {
      throw new BadRequestException('Este chamado não é um pedido de cancelamento.');
    }

    if (dto.aceita) {
      if (!row.pedidoId) throw new BadRequestException('Chamado sem pedido vinculado.');
      // Delega ao Delivery (valida a senha do gestor, estorna financeiro/fidelidade).
      await this.delivery.cancelar(
        user.tenantId,
        user.colaboradorId,
        user.categoria,
        row.pedidoId,
        dto.motivo ?? 'Cancelamento solicitado pelo cliente',
        dto.senha,
      );
    }

    await this.db
      .update(atendimentoChamado)
      .set({
        status: 'resolvido',
        decisao: dto.aceita ? 'aceito' : 'recusado',
        resolvidoPorId: user.colaboradorId,
        resolvidoEm: new Date(),
      })
      .where(eq(atendimentoChamado.id, id));
    return { ok: true, decisao: dto.aceita ? 'aceito' : 'recusado' };
  }
}
