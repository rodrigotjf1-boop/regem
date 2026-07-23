import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { pedidoManutencao, colaborador } from '../../db/schema';
import { condUnidade } from '../../common/filtro-unidade';
import { AuditoriaService } from '../auditoria/auditoria.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const STATUS = ['aberto', 'em_andamento', 'concluido_parcial', 'concluido', 'cancelado'];

@Injectable()
export class PedidoManutencaoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Abre um pedido de manutenção (qualquer colaborador). Até 3 fotos. Cria alerta
  // ao presidente/C&O (que muda status ou delega ao gerente).
  async criar(
    tenantId: string,
    atorId: string | null,
    dto: {
      titulo?: string;
      descricao?: string;
      equipamentoId?: string;
      equipamentoRef?: string;
      prioridade?: string;
      fotos?: string[];
      unidadeId?: string;
    },
    atual: string | null = null,
  ) {
    const titulo = (dto.titulo ?? '').trim();
    if (!titulo) throw new BadRequestException('Descreva o que está com defeito.');
    const fotos = Array.isArray(dto.fotos) ? dto.fotos.filter(Boolean).slice(0, 3) : [];
    const prazo = new Date();
    prazo.setDate(prazo.getDate() + 15);
    const [row] = await this.db
      .insert(pedidoManutencao)
      .values({
        tenantId,
        unidadeId: atual ?? dto.unidadeId ?? null,
        equipamentoId: dto.equipamentoId ?? null,
        equipamentoRef: dto.equipamentoRef ?? null,
        titulo,
        descricao: dto.descricao ?? null,
        fotos: fotos as any,
        prioridade: ['baixa', 'normal', 'alta', 'critica'].includes(dto.prioridade ?? '')
          ? (dto.prioridade as string)
          : 'normal',
        criadoPorId: atorId ?? null,
        prazo15d: prazo.toISOString().slice(0, 10),
      })
      .returning();
    // Alerta ao C&O/gerente (mesmo canal dos alertas de sistema).
    this.events.emit('kds.alerta.sistema', {
      tenantId,
      titulo: '🛠️ Novo pedido de manutenção',
      detalhe: titulo,
      prioridade: row.prioridade === 'critica' ? 'danger' : 'alta',
    });
    await this.auditoria.registrar({
      tenantId,
      atorId: atorId ?? undefined,
      atorPerfil: 'execucao',
      tipo: 'modulos',
      acao: 'abriu_manutencao',
      entidadeTipo: 'pedido_manutencao',
      entidadeId: row.id,
      detalhe: { titulo },
    });
    return row;
  }

  async listar(tenantId: string, atual: string | null = null) {
    const rows = await this.db
      .select({
        id: pedidoManutencao.id,
        titulo: pedidoManutencao.titulo,
        descricao: pedidoManutencao.descricao,
        equipamentoRef: pedidoManutencao.equipamentoRef,
        fotos: pedidoManutencao.fotos,
        prioridade: pedidoManutencao.prioridade,
        status: pedidoManutencao.status,
        responsavelId: pedidoManutencao.responsavelId,
        responsavelNome: colaborador.nome,
        prazo15d: pedidoManutencao.prazo15d,
        decisao15d: pedidoManutencao.decisao15d,
        motivo: pedidoManutencao.motivo,
        resolvidoEm: pedidoManutencao.resolvidoEm,
        createdAt: pedidoManutencao.createdAt,
      })
      .from(pedidoManutencao)
      .leftJoin(colaborador, eq(colaborador.id, pedidoManutencao.responsavelId))
      .where(
        and(
          eq(pedidoManutencao.tenantId, tenantId),
          condUnidade(pedidoManutencao.unidadeId, atual),
          isNull(pedidoManutencao.deletedAt),
        ),
      )
      .orderBy(desc(pedidoManutencao.createdAt))
      .limit(200);
    return rows;
  }

  private async carregar(tenantId: string, id: string) {
    const [p] = await this.db
      .select()
      .from(pedidoManutencao)
      .where(
        and(
          eq(pedidoManutencao.id, id),
          eq(pedidoManutencao.tenantId, tenantId),
          isNull(pedidoManutencao.deletedAt),
        ),
      );
    if (!p) throw new NotFoundException('Pedido de manutenção não encontrado.');
    return p;
  }

  // C&O delega ao gerente responsável.
  async delegar(tenantId: string, atorId: string, atorPerfil: string, id: string, responsavelId: string) {
    await this.carregar(tenantId, id);
    const [row] = await this.db
      .update(pedidoManutencao)
      .set({ responsavelId, delegadoEm: new Date(), status: 'em_andamento', updatedAt: new Date() })
      .where(eq(pedidoManutencao.id, id))
      .returning();
    await this.auditoria.registrar({
      tenantId, atorId, atorPerfil,
      tipo: 'modulos', acao: 'delegou_manutencao',
      entidadeTipo: 'pedido_manutencao', entidadeId: id, detalhe: { responsavelId },
    });
    return row;
  }

  // Muda o status (só C&O ou o gerente delegado). Concluído parcial segue aguardando.
  async mudarStatus(tenantId: string, atorId: string, atorPerfil: string, id: string, status: string, motivo?: string) {
    if (!STATUS.includes(status)) throw new BadRequestException('Status inválido.');
    const p = await this.carregar(tenantId, id);
    const patch: any = { status, updatedAt: new Date() };
    if (status === 'concluido') {
      patch.resolvidoEm = new Date();
      patch.resolvidoPorId = atorId;
    }
    if (motivo != null) patch.motivo = motivo;
    const [row] = await this.db
      .update(pedidoManutencao)
      .set(patch)
      .where(eq(pedidoManutencao.id, id))
      .returning();
    await this.auditoria.registrar({
      tenantId, atorId, atorPerfil,
      tipo: 'modulos', acao: 'status_manutencao',
      entidadeTipo: 'pedido_manutencao', entidadeId: id, detalhe: { de: p.status, para: status, motivo },
    });
    return row;
  }

  // Resposta do C&O ao alerta de 15 dias: manter | concluir | excluir.
  async decidir15d(tenantId: string, atorId: string, atorPerfil: string, id: string, decisao: string) {
    if (!['manter', 'concluir', 'excluir'].includes(decisao))
      throw new BadRequestException('Decisão inválida.');
    await this.carregar(tenantId, id);
    if (decisao === 'excluir') return this.excluir(tenantId, atorId, atorPerfil, id, 'Descartado após 15 dias');
    const patch: any = { decisao15d: decisao, updatedAt: new Date() };
    if (decisao === 'concluir') {
      patch.status = 'concluido';
      patch.resolvidoEm = new Date();
      patch.resolvidoPorId = atorId;
    }
    const [row] = await this.db
      .update(pedidoManutencao)
      .set(patch)
      .where(eq(pedidoManutencao.id, id))
      .returning();
    return row;
  }

  async excluir(tenantId: string, atorId: string, atorPerfil: string, id: string, motivo?: string) {
    if (!motivo?.trim()) throw new BadRequestException('Informe o motivo da exclusão.');
    await this.carregar(tenantId, id);
    const [row] = await this.db
      .update(pedidoManutencao)
      .set({ deletedAt: new Date(), motivo, updatedAt: new Date() })
      .where(eq(pedidoManutencao.id, id))
      .returning();
    await this.auditoria.registrar({
      tenantId, atorId, atorPerfil,
      tipo: 'modulos', acao: 'excluiu_manutencao',
      entidadeTipo: 'pedido_manutencao', entidadeId: id, detalhe: { motivo },
    });
    return row;
  }

  // Job diário (15 dias): pedidos abertos há mais de 15 dias, ainda não alertados,
  // disparam a pergunta ao C&O (manter / concluir / excluir). Retorna quantos.
  async promoverAntigos(): Promise<number> {
    const abertos = await this.db
      .select({ id: pedidoManutencao.id, tenantId: pedidoManutencao.tenantId, titulo: pedidoManutencao.titulo })
      .from(pedidoManutencao)
      .where(
        and(
          isNull(pedidoManutencao.deletedAt),
          isNull(pedidoManutencao.alerta15dEm),
          lt(pedidoManutencao.prazo15d, sql`current_date`),
          sql`${pedidoManutencao.status} not in ('concluido','cancelado')`,
        ),
      );
    for (const p of abertos) {
      await this.db
        .update(pedidoManutencao)
        .set({ alerta15dEm: new Date(), updatedAt: new Date() })
        .where(eq(pedidoManutencao.id, p.id));
      this.events.emit('kds.alerta.sistema', {
        tenantId: p.tenantId,
        titulo: '⏳ Manutenção pendente há 15 dias',
        detalhe: `${p.titulo} — manter, concluir ou excluir?`,
        prioridade: 'danger',
      });
    }
    return abertos.length;
  }
}
