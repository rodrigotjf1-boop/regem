import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { atendimentoChamado } from '../../db/schema';
import { DeliveryService } from '../delivery/delivery.service';
import { AuthUser } from '../../auth/auth-user';
import { chaveTelefone, sqlChaveTelefone } from '../../common/telefone-chave';

/* eslint-disable @typescript-eslint/no-explicit-any */

export type Prioridade = 'normal' | 'urgente';

/** A prioridade pedida: só `prioridade: 'urgente'` ou `urgente: true` mudam o padrão. Todo o resto é 'normal'. */
export function prioridadeDe(dto: { prioridade?: unknown; urgente?: unknown } | null | undefined): Prioridade {
  if (dto?.prioridade === 'urgente') return 'urgente';
  return dto?.urgente === true || dto?.urgente === 'true' ? 'urgente' : 'normal';
}

/** Junta a mensagem nova à do chamado que já estava aberto, sem repetir a mesma frase e sem crescer sem fim. */
export function juntarMensagem(antes: string | null | undefined, nova: string | null | undefined): string | null {
  const a = String(antes ?? '').trim();
  const n = String(nova ?? '').trim();
  if (!n || a.includes(n)) return a || null;
  if (!a) return n.slice(0, 1000);
  return `${a}\n${n}`.slice(-1000);
}

/** Por quanto tempo um chamado ABERTO do mesmo telefone conta como o mesmo pedido de ajuda. */
export const JANELA_DO_MESMO_CHAMADO_H = 12;

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
        prioridade: dto.prioridade === 'urgente' ? 'urgente' : 'normal',
      })
      .returning();
    this.events.emit('atendimento.novo', { tenantId, chamado: row });
    return { ok: true, id: row.id, prioridade: row.prioridade };
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
    const k = chaveTelefone(dto.telefone);
    if (!k) return this.abrir(tenantId, unidadeId, dto);
    const [aberto] = await this.db
      .select()
      .from(atendimentoChamado)
      .where(
        and(
          eq(atendimentoChamado.tenantId, tenantId),
          eq(atendimentoChamado.status, 'aberto'),
          gte(atendimentoChamado.criadoEm, sql.raw(`now() - interval '${Number(JANELA_DO_MESMO_CHAMADO_H)} hours'`)),
          sql`${sqlChaveTelefone(sql`${atendimentoChamado.telefone}`)} = ${k}`,
        ),
      )
      .orderBy(desc(atendimentoChamado.criadoEm))
      .limit(1);
    const tipoNovo = String(dto.tipo ?? '');
    const precisaDoProprio =
      (tipoNovo === 'cancelamento' || tipoNovo === 'mudanca') && !!dto.pedidoId && aberto?.tipo !== tipoNovo;
    if (!aberto || precisaDoProprio) return this.abrir(tenantId, unidadeId, dto);

    const subiu = dto.prioridade === 'urgente' && aberto.prioridade !== 'urgente';
    const mensagem = juntarMensagem(aberto.mensagem, dto.mensagem);
    const patch: Record<string, unknown> = {};
    if (subiu) patch.prioridade = 'urgente';
    if (mensagem !== (aberto.mensagem ?? null)) patch.mensagem = mensagem;
    if (!aberto.pedidoId && dto.pedidoId) {
      patch.pedidoId = dto.pedidoId;
      if (!aberto.pedidoNumero && dto.pedidoNumero != null) patch.pedidoNumero = String(dto.pedidoNumero);
    }
    let row: any = aberto;
    if (Object.keys(patch).length) {
      [row] = await this.db
        .update(atendimentoChamado)
        .set(patch as any)
        .where(and(eq(atendimentoChamado.tenantId, tenantId), eq(atendimentoChamado.id, aberto.id)))
        .returning();
    }
    if (subiu) this.events.emit('atendimento.novo', { tenantId, chamado: row });
    return { ok: true, id: aberto.id, prioridade: (row?.prioridade ?? aberto.prioridade) as Prioridade, jaAberto: true };
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
    dto: { aceita?: boolean; senha?: string; motivo?: string },
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
      // Delega ao Delivery (valida a senha do gestor, estorna financeiro/fidelidade, imprime o comprovante).
      const cancelado: any = await this.delivery.cancelar(
        user.tenantId,
        user.colaboradorId,
        user.categoria,
        row.pedidoId,
        dto.motivo ?? 'Cancelamento solicitado pelo cliente',
        dto.senha,
        true,
        terminalId,
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
