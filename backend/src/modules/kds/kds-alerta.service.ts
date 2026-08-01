import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { kdsAlertaConfig } from '../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Motor de alertas do KDS (Fase B). CRUD dos alertas cadastrados + um scheduler que
// dispara os AGENDADOS (horário+dia) e os CONDICIONAIS (limiar de pedidos) para o
// rodapé do KDS via evento 'kds.alerta.sistema' (o gateway repassa como 'kds:alerta').
// A sobreposição/override (urgente curto preempta o longo) é resolvida no cliente.
@Injectable()
export class KdsAlertaService {
  private readonly logger = new Logger('KdsAlerta');
  // Dedup em memória: agendado = 1x por minuto; condicional = cooldown por config.
  private disparados = new Map<string, number>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
  ) {}

  // ===== CRUD (presidente/C&O/gerente) =====
  async listar(tenantId: string) {
    return this.db
      .select()
      .from(kdsAlertaConfig)
      .where(eq(kdsAlertaConfig.tenantId, tenantId))
      .orderBy(kdsAlertaConfig.createdAt);
  }

  async criar(tenantId: string, criadoPor: string | null, dto: any) {
    this.valida(dto);
    const [row] = await this.db
      .insert(kdsAlertaConfig)
      .values({
        tenantId,
        unidadeId: dto.unidadeId ?? null,
        titulo: String(dto.titulo).slice(0, 200),
        detalhe: dto.detalhe ? String(dto.detalhe).slice(0, 500) : null,
        prioridade: this.prio(dto.prioridade),
        tipo: dto.tipo === 'condicional' ? 'condicional' : 'agendado',
        horarios: Array.isArray(dto.horarios) ? dto.horarios : [],
        diasSemana: Array.isArray(dto.diasSemana) ? dto.diasSemana : [0, 1, 2, 3, 4, 5, 6],
        condicao: dto.condicao ?? null,
        duracaoSeg: Math.max(3, Math.min(3600, Number(dto.duracaoSeg) || 60)),
        ativo: dto.ativo != null ? !!dto.ativo : true,
        criadoPor,
      })
      .returning();
    return row;
  }

  async atualizar(tenantId: string, id: string, dto: any) {
    const patch: any = { updatedAt: new Date() };
    if (dto.titulo != null) patch.titulo = String(dto.titulo).slice(0, 200);
    if (dto.detalhe !== undefined) patch.detalhe = dto.detalhe ? String(dto.detalhe).slice(0, 500) : null;
    if (dto.prioridade != null) patch.prioridade = this.prio(dto.prioridade);
    if (dto.tipo != null) patch.tipo = dto.tipo === 'condicional' ? 'condicional' : 'agendado';
    if (dto.horarios != null) patch.horarios = Array.isArray(dto.horarios) ? dto.horarios : [];
    if (dto.diasSemana != null) patch.diasSemana = Array.isArray(dto.diasSemana) ? dto.diasSemana : [];
    if (dto.condicao !== undefined) patch.condicao = dto.condicao ?? null;
    if (dto.duracaoSeg != null) patch.duracaoSeg = Math.max(3, Math.min(3600, Number(dto.duracaoSeg) || 60));
    if (dto.ativo != null) patch.ativo = !!dto.ativo;
    const [row] = await this.db
      .update(kdsAlertaConfig)
      .set(patch)
      .where(and(eq(kdsAlertaConfig.id, id), eq(kdsAlertaConfig.tenantId, tenantId)))
      .returning();
    if (!row) throw new BadRequestException('Alerta não encontrado.');
    return row;
  }

  async remover(tenantId: string, id: string) {
    await this.db
      .delete(kdsAlertaConfig)
      .where(and(eq(kdsAlertaConfig.id, id), eq(kdsAlertaConfig.tenantId, tenantId)));
    return { ok: true };
  }

  // Dispara um alerta AGORA (teste / disparo manual pela tela do KDS).
  async dispararManual(tenantId: string, dto: any) {
    this.emitir(tenantId, {
      titulo: String(dto?.titulo ?? 'Alerta').slice(0, 200),
      detalhe: dto?.detalhe ? String(dto.detalhe).slice(0, 500) : '',
      prioridade: this.prio(dto?.prioridade),
      duracaoSeg: Math.max(3, Math.min(3600, Number(dto?.duracaoSeg) || 60)),
    });
    return { ok: true };
  }

  // ===== Scheduler =====
  @Interval(20000)
  async tick() {
    let configs: any[];
    try {
      configs = await this.db.select().from(kdsAlertaConfig).where(eq(kdsAlertaConfig.ativo, true));
    } catch (e: any) {
      this.logger.warn(`tick: ${e?.message ?? e}`);
      return;
    }
    if (!configs.length) return;
    const { hhmm, dia, ymd } = this.agoraSP();
    // Cache de contagem por tenant (só busca se houver condicional daquele tenant).
    const contagem = new Map<string, { balcao: number; delivery: number; total: number }>();
    for (const c of configs) {
      try {
        if (c.tipo === 'agendado') this.tickAgendado(c, hhmm, dia, ymd);
        else await this.tickCondicional(c, contagem);
      } catch (e: any) {
        this.logger.warn(`alerta ${c.id}: ${e?.message ?? e}`);
      }
    }
    this.limparDedup();
  }

  private tickAgendado(c: any, hhmm: string, dia: number, ymd: string) {
    const horarios: string[] = Array.isArray(c.horarios) ? c.horarios : [];
    const dias: number[] = Array.isArray(c.diasSemana) ? c.diasSemana : [0, 1, 2, 3, 4, 5, 6];
    if (!horarios.includes(hhmm) || !dias.includes(dia)) return;
    const chave = `ag|${c.id}|${ymd}|${hhmm}`; // 1x por minuto
    if (this.disparados.has(chave)) return;
    this.disparados.set(chave, Date.now());
    this.emitir(c.tenantId, c);
  }

  private async tickCondicional(
    c: any,
    contagem: Map<string, { balcao: number; delivery: number; total: number }>,
  ) {
    const cond = c.condicao ?? {};
    const fonte = String(cond.fonte ?? 'pedidos_total');
    if (fonte === 'externo') return; // disparo externo vem por webhook (dispararManual)
    let cont = contagem.get(c.tenantId);
    if (!cont) {
      cont = await this.contarPedidos(c.tenantId);
      contagem.set(c.tenantId, cont);
    }
    const valor =
      fonte === 'pedidos_balcao' ? cont.balcao : fonte === 'pedidos_delivery' ? cont.delivery : cont.total;
    const limiar = Number(cond.limiar) || 0;
    const op = String(cond.operador ?? '>=');
    const ok =
      op === '>' ? valor > limiar : op === '<' ? valor < limiar : op === '<=' ? valor <= limiar : op === '==' ? valor === limiar : valor >= limiar;
    const chave = `cond|${c.id}`;
    const ultimo = this.disparados.get(chave) ?? 0;
    // Cooldown = duração + 60s (não repete o alerta enquanto ainda está no ar).
    const cooldown = (Number(c.duracaoSeg) || 60) * 1000 + 60000;
    if (ok && Date.now() - ultimo > cooldown) {
      this.disparados.set(chave, Date.now());
      this.emitir(c.tenantId, c, ` (${valor})`);
    }
  }

  private async contarPedidos(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select
        count(*) filter (where tipo = 'retirada') as balcao,
        count(*) filter (where tipo = 'entrega') as delivery,
        count(*) as total
      from pedido_externo
      where tenant_id = ${tenantId} and status in ('confirmado', 'pronto')`);
    const row = (r?.rows ?? r)?.[0] ?? {};
    return {
      balcao: Number(row.balcao) || 0,
      delivery: Number(row.delivery) || 0,
      total: Number(row.total) || 0,
    };
  }

  private emitir(tenantId: string, c: any, sufixo = '') {
    this.events.emit('kds.alerta.sistema', {
      tenantId,
      titulo: String(c.titulo ?? 'Alerta') + sufixo,
      detalhe: c.detalhe ?? '',
      prioridade: this.prio(c.prioridade),
      duracaoSeg: Math.max(3, Math.min(3600, Number(c.duracaoSeg) || 60)),
    });
  }

  // ===== helpers =====
  private prio(p: any): string {
    return ['danger', 'alta', 'info', 'ok'].includes(p) ? p : 'alta';
  }

  private valida(dto: any) {
    if (!dto?.titulo || !String(dto.titulo).trim()) throw new BadRequestException('Título obrigatório.');
    if (dto.tipo === 'condicional' && !dto.condicao?.fonte)
      throw new BadRequestException('Alerta condicional exige uma condição (fonte/limiar).');
    if ((dto.tipo ?? 'agendado') === 'agendado' && !(Array.isArray(dto.horarios) && dto.horarios.length))
      throw new BadRequestException('Alerta agendado exige ao menos um horário.');
  }

  // Hora/dia/data no fuso de São Paulo (mesma referência do resto do sistema).
  private agoraSP() {
    const partes = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => partes.find((p) => p.type === t)?.value ?? '';
    const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      hhmm: `${get('hour')}:${get('minute')}`,
      ymd: `${get('year')}-${get('month')}-${get('day')}`,
      dia: DIAS[get('weekday')] ?? 0,
    };
  }

  // Remove chaves de dedup antigas (>2h) pra não crescer sem limite.
  private limparDedup() {
    const corte = Date.now() - 2 * 3600 * 1000;
    for (const [k, t] of this.disparados) if (t < corte) this.disparados.delete(k);
  }
}
