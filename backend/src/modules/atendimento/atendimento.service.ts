import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { atendimentoChamado } from '../../db/schema';
import { DeliveryService } from '../delivery/delivery.service';
import { AuthUser } from '../../auth/auth-user';
import { lerItensDaPerda } from '../vendas/itens-da-perda';
import { JANELA_DO_MESMO_CHAMADO_H, Prioridade, abrirChamado, abrirChamadoPeloRobo, juntarMensagem } from './abrir-chamado';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type { Prioridade };

/** A prioridade pedida: só `prioridade: 'urgente'` ou `urgente: true` mudam o padrão. Todo o resto é 'normal'. */
export function prioridadeDe(dto: { prioridade?: unknown; urgente?: unknown } | null | undefined): Prioridade {
  if (dto?.prioridade === 'urgente') return 'urgente';
  return dto?.urgente === true || dto?.urgente === 'true' ? 'urgente' : 'normal';
}

// A abertura de chamado mora em `abrir-chamado.ts` (o WhatsApp também abre — Bloco 4); estes nomes continuam valendo daqui.
export { juntarMensagem, JANELA_DO_MESMO_CHAMADO_H };

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
      prioridade?: Prioridade;
    },
  ) {
    return abrirChamado(this.db, (ev, p) => this.events.emit(ev, p), tenantId, unidadeId, dto);
  }

  /**
   * Chamado aberto PELO ROBÔ. Se o mesmo cliente (pela chave do telefone: com/sem 55 e nono dígito) já tem um chamado
   * aberto nas últimas 12 h, é o mesmo pedido de ajuda: não abre outro (a IA às vezes chama duas vezes na mesma
   * resposta). O que chega é somado ao aberto: a mensagem nova vai junto, e `urgente` SOBE a prioridade (nunca desce) —
   * aí a tela é avisada de novo, porque mudou o que a equipe precisa ver.
   * Exceção: um pedido de CANCELAMENTO ou MUDANÇA ligado a um pedido, quando o aberto é de outro tipo, abre o seu
   * próprio chamado — o botão "Aceitar cancelamento" depende do tipo e do pedido do chamado.
   * Sem telefone, abre sempre (não há como saber se é o mesmo cliente). Duas chamadas no mesmo instante ainda podem abrir
   * dois — nenhum índice impede; o pior caso é um chamado a mais no painel.
   */
  async abrirPeloRobo(
    tenantId: string,
    unidadeId: string | null,
    dto: {
      tipo?: string;
      cliente?: string;
      telefone?: string;
      pedidoNumero?: string;
      pedidoId?: string;
      mensagem?: string;
      prioridade?: Prioridade;
    },
  ) {
    return abrirChamadoPeloRobo(this.db, (ev, p) => this.events.emit(ev, p), tenantId, unidadeId, dto);
  }

  // Urgente primeiro (cliente irritado espera menos); dentro de cada grupo, o mais novo em cima — como sempre foi.
  listar(tenantId: string, status = 'aberto') {
    return this.db
      .select()
      .from(atendimentoChamado)
      .where(and(eq(atendimentoChamado.tenantId, tenantId), eq(atendimentoChamado.status, status)))
      .orderBy(sql`(${atendimentoChamado.prioridade} = 'urgente') desc`, desc(atendimentoChamado.criadoEm))
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
    dto: { aceita?: boolean; senha?: string; motivo?: string; reaproveitado?: boolean; perdaItens?: unknown },
    terminalId: string | null = null,
  ) {
    const [row] = await this.db
      .select()
      .from(atendimentoChamado)
      .where(and(eq(atendimentoChamado.tenantId, user.tenantId), eq(atendimentoChamado.id, id)));
    if (!row) throw new NotFoundException('Chamado não encontrado');
    if (row.tipo !== 'cancelamento') {
      throw new BadRequestException('Este chamado não é um pedido de cancelamento.');
    }

    let comprovante: { enfileirados: number; aviso: string | null } | undefined;
    if (dto.aceita) {
      if (!row.pedidoId) throw new BadRequestException('Chamado sem pedido vinculado.');
      // Delega ao Delivery (valida a senha do gestor, estorna financeiro/fidelidade, imprime o comprovante). O destino
      // dos insumos vem da tela, como no cancelamento do painel (ERR-339): antes ia `true` fixo — todo cancelamento pelo
      // chamado gravava "reaproveitado" e escondia o "Registrar perda" depois.
      const cancelado: any = await this.delivery.cancelar(
        user.tenantId,
        user.colaboradorId,
        user.categoria,
        row.pedidoId,
        String(dto.motivo ?? '').trim() || 'Cancelamento solicitado pelo cliente',
        dto.senha,
        dto.reaproveitado !== false,
        terminalId,
        lerItensDaPerda(dto.perdaItens),
      );
      comprovante = cancelado?.comprovante;
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
    return { ok: true, decisao: dto.aceita ? 'aceito' : 'recusado', ...(comprovante ? { comprovante } : {}) };
  }
}
