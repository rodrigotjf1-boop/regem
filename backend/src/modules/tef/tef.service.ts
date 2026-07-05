import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { tefConfig, pagamentoTef } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class TefService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ===== PDV cria a cobrança (o agente do edge processa no pinpad) =====
  async criar(
    tenantId: string,
    atorId: string,
    dto: {
      valor: number;
      forma?: string;
      parcelas?: number;
      comandaId?: string;
      unidadeId?: string | null;
    },
  ) {
    if (!(Number(dto.valor) > 0))
      throw new BadRequestException('Valor inválido.');
    const forma = ['credito', 'debito', 'pix'].includes(dto.forma ?? '')
      ? dto.forma!
      : 'credito';
    const cfg = await this.configRaw(tenantId, dto.unidadeId ?? null);
    const [row] = await this.db
      .insert(pagamentoTef)
      .values({
        tenantId,
        unidadeId: dto.unidadeId ?? null,
        comandaId: dto.comandaId ?? null,
        valor: String(Number(dto.valor).toFixed(2)),
        forma,
        parcelas: Number(dto.parcelas) || 1,
        provedor: cfg?.provedor ?? 'mock',
        status: 'pendente',
        criadoPorId: atorId,
      })
      .returning();
    return row;
  }

  get(tenantId: string, id: string) {
    return this.db
      .select()
      .from(pagamentoTef)
      .where(and(eq(pagamentoTef.id, id), eq(pagamentoTef.tenantId, tenantId)))
      .then((r) => r[0] ?? null);
  }

  listar(tenantId: string, limite = 50) {
    return this.db
      .select()
      .from(pagamentoTef)
      .where(eq(pagamentoTef.tenantId, tenantId))
      .orderBy(desc(pagamentoTef.criadoEm))
      .limit(limite);
  }

  async vincularComanda(tenantId: string, id: string, comandaId: string) {
    await this.db
      .update(pagamentoTef)
      .set({ comandaId })
      .where(and(eq(pagamentoTef.id, id), eq(pagamentoTef.tenantId, tenantId)));
    return { ok: true };
  }

  // PDV/gestor cancela uma cobrança pendente (ou estorna aprovada — o void real
  // é feito pelo agente do edge; aqui marcamos como cancelada).
  async cancelar(tenantId: string, atorId: string, atorPerfil: string, id: string) {
    const p = await this.get(tenantId, id);
    if (!p) throw new NotFoundException('Pagamento não encontrado');
    if (p.status === 'cancelado')
      throw new BadRequestException('Pagamento já cancelado.');
    const [row] = await this.db
      .update(pagamentoTef)
      .set({ status: 'cancelado', canceladoEm: new Date() })
      .where(eq(pagamentoTef.id, id))
      .returning();
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'financeiro',
      acao: 'cancelou_tef',
      entidadeTipo: 'pagamento_tef',
      entidadeId: id,
      detalhe: { valor: Number(p.valor), forma: p.forma },
    });
    return row;
  }

  // ===== Agente do edge (token servidor_local) =====
  pendentes(tenantId: string, limite = 20) {
    return this.db
      .select()
      .from(pagamentoTef)
      .where(
        and(
          eq(pagamentoTef.tenantId, tenantId),
          eq(pagamentoTef.status, 'pendente'),
        ),
      )
      .orderBy(pagamentoTef.criadoEm)
      .limit(limite);
  }

  // Resultado da maquininha reportado pelo agente do edge.
  async resultado(
    tenantId: string,
    id: string,
    dto: {
      status: 'aprovado' | 'negado';
      nsu?: string;
      autorizacao?: string;
      bandeira?: string;
      mensagem?: string;
    },
  ) {
    const p = await this.get(tenantId, id);
    if (!p) throw new NotFoundException('Pagamento não encontrado');
    if (p.status !== 'pendente')
      throw new BadRequestException('Pagamento não está pendente.');
    const status = dto.status === 'aprovado' ? 'aprovado' : 'negado';
    const [row] = await this.db
      .update(pagamentoTef)
      .set({
        status,
        nsu: dto.nsu,
        autorizacao: dto.autorizacao,
        bandeira: dto.bandeira,
        mensagem: dto.mensagem,
        processadoEm: new Date(),
      })
      .where(and(eq(pagamentoTef.id, id), eq(pagamentoTef.tenantId, tenantId)))
      .returning();
    return row;
  }

  // ===== Config =====
  private async configRaw(tenantId: string, unidadeId?: string | null) {
    const [row] = await this.db
      .select()
      .from(tefConfig)
      .where(
        and(
          eq(tefConfig.tenantId, tenantId),
          unidadeId ? eq(tefConfig.unidadeId, unidadeId) : sql`unidade_id is null`,
        ),
      );
    return row;
  }

  async getConfig(tenantId: string, unidadeId?: string | null) {
    const row = await this.configRaw(tenantId, unidadeId);
    return row ?? { ativo: false, provedor: 'mock' };
  }

  async setConfig(tenantId: string, unidadeId: string | null, dto: any) {
    const row = await this.configRaw(tenantId, unidadeId);
    const vals = {
      ativo: dto.ativo != null ? !!dto.ativo : row?.ativo ?? false,
      provedor: dto.provedor ?? row?.provedor ?? 'mock',
      terminalId: dto.terminalId ?? row?.terminalId ?? null,
    };
    if (row) {
      await this.db
        .update(tefConfig)
        .set({ ...vals, updatedAt: new Date() })
        .where(eq(tefConfig.id, row.id));
    } else {
      await this.db.insert(tefConfig).values({ tenantId, unidadeId, ...vals });
    }
    return this.getConfig(tenantId, unidadeId);
  }
}
