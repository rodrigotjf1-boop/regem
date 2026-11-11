import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { kdsAlertaConfig } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import type { AtorKds } from '../producao-pedido/kds-auditoria';
import { exigirBooleano } from '../../common/exigir';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Os pedidos em andamento de uma loja (o condicional olha cada loja). */
export type ContagemDaLoja = { balcao: number; delivery: number; total: number };

/** O valor passa do limite do alerta condicional? (operador '>', '<', '<=', '==' ou, sem operador, '>='). */
export function passaDoLimite(valor: number, cond: { operador?: unknown; limiar?: unknown }): boolean {
  const limiar = Number(cond?.limiar) || 0;
  const op = String(cond?.operador ?? '>=');
  return op === '>' ? valor > limiar : op === '<' ? valor < limiar : op === '<=' ? valor <= limiar : op === '==' ? valor === limiar : valor >= limiar;
}

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
    private readonly auditoria: AuditoriaService,
  ) {}

  // Quem criou, editou, excluiu ou disparou um alerta fica na auditoria (e no histórico do KDS).
  private auditar(tenantId: string, ator: AtorKds | undefined, acao: string, alerta: any, detalhe: Record<string, unknown> = {}) {
    return this.auditoria.registrar({
      tenantId,
      unidadeId: alerta?.unidadeId ?? null,
      atorId: ator?.id ?? null,
      atorPerfil: ator?.perfil ?? null,
      tipo: 'config',
      acao,
      entidadeTipo: 'kds_alerta',
      entidadeId: alerta?.id ?? null,
      detalhe: { titulo: alerta?.titulo ?? null, ...detalhe },
    });
  }

  // ===== CRUD (presidente/C&O/gerente) =====
  async listar(tenantId: string) {
    return this.db
      .select()
      .from(kdsAlertaConfig)
      .where(eq(kdsAlertaConfig.tenantId, tenantId))
      .orderBy(kdsAlertaConfig.createdAt);
  }

  // A loja do alerta é desta empresa? O alerta vai para a sala da LOJA (auditoria do KDS, 11/11/2026): a loja de outra
  // empresa mandaria o texto para as telas dela (V86). Vazio = a empresa inteira.
  private async lojaDoAlerta(tenantId: string, unidadeId: unknown): Promise<string | null> {
    if (unidadeId === undefined || unidadeId === null || unidadeId === '') return null;
    const id = String(unidadeId);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new BadRequestException('Escolha uma loja da lista.');
    const r: any = await this.db.execute(sql`select 1 from unidade where id = ${id} and tenant_id = ${tenantId}`);
    if (!(r.rows ?? r).length) throw new BadRequestException('Loja não encontrada nesta empresa.');
    return id;
  }

  async criar(tenantId: string, criadoPor: string | null, dto: any, ator?: AtorKds) {
    this.valida(dto);
    const unidadeId = await this.lojaDoAlerta(tenantId, dto.unidadeId);
    const [row] = await this.db
      .insert(kdsAlertaConfig)
      .values({
        tenantId,
        unidadeId,
        titulo: String(dto.titulo).slice(0, 200),
        detalhe: dto.detalhe ? String(dto.detalhe).slice(0, 500) : null,
        prioridade: this.prio(dto.prioridade),
        tipo: dto.tipo === 'condicional' ? 'condicional' : 'agendado',
        horarios: Array.isArray(dto.horarios) ? dto.horarios : [],
        diasSemana: Array.isArray(dto.diasSemana) ? dto.diasSemana : [0, 1, 2, 3, 4, 5, 6],
        condicao: dto.condicao ?? null,
        duracaoSeg: Math.max(3, Math.min(3600, Number(dto.duracaoSeg) || 60)),
        // Liga/desliga explícito (V15): "false" em texto não pode virar ligado.
        ativo: dto.ativo != null ? exigirBooleano(dto.ativo, 'ativo') : true,
        criadoPor,
      })
      .returning();
    await this.auditar(tenantId, ator, 'criou_alerta_kds', row, { tipo: row.tipo, prioridade: row.prioridade, ativo: row.ativo });
    return row;
  }

  async atualizar(tenantId: string, id: string, dto: any, ator?: AtorKds) {
    // As MESMAS regras da criação sobre o alerta como ele fica (antes editar não validava: um condicional sem condição
    // virava "≥ 0" e disparava sempre — auditoria do KDS, 11/11/2026).
    const [atual] = await this.db
      .select()
      .from(kdsAlertaConfig)
      .where(and(eq(kdsAlertaConfig.id, id), eq(kdsAlertaConfig.tenantId, tenantId)));
    if (!atual) throw new BadRequestException('Alerta não encontrado.');
    const fica = (campo: string, valor: any) => (dto[campo] !== undefined ? dto[campo] : valor);
    // Só quando a edição mexe no que se valida: ligar/desligar um alerta antigo não é barrado por regra nova.
    if (['titulo', 'tipo', 'condicao', 'horarios'].some((k) => dto[k] !== undefined))
      this.valida({
        titulo: fica('titulo', atual.titulo),
        tipo: fica('tipo', atual.tipo),
        condicao: fica('condicao', atual.condicao),
        horarios: fica('horarios', atual.horarios),
      });
    const patch: any = { updatedAt: new Date() };
    if (dto.unidadeId !== undefined) patch.unidadeId = await this.lojaDoAlerta(tenantId, dto.unidadeId);
    if (dto.titulo != null) patch.titulo = String(dto.titulo).slice(0, 200);
    if (dto.detalhe !== undefined) patch.detalhe = dto.detalhe ? String(dto.detalhe).slice(0, 500) : null;
    if (dto.prioridade != null) patch.prioridade = this.prio(dto.prioridade);
    if (dto.tipo != null) patch.tipo = dto.tipo === 'condicional' ? 'condicional' : 'agendado';
    if (dto.horarios != null) patch.horarios = Array.isArray(dto.horarios) ? dto.horarios : [];
    if (dto.diasSemana != null) patch.diasSemana = Array.isArray(dto.diasSemana) ? dto.diasSemana : [];
    if (dto.condicao !== undefined) patch.condicao = dto.condicao ?? null;
    if (dto.duracaoSeg != null) patch.duracaoSeg = Math.max(3, Math.min(3600, Number(dto.duracaoSeg) || 60));
    if (dto.ativo != null) patch.ativo = exigirBooleano(dto.ativo, 'ativo');
    const [row] = await this.db
      .update(kdsAlertaConfig)
      .set(patch)
      .where(and(eq(kdsAlertaConfig.id, id), eq(kdsAlertaConfig.tenantId, tenantId)))
      .returning();
    if (!row) throw new BadRequestException('Alerta não encontrado.');
    // o que veio para mudar (sem o carimbo de data), para o registro dizer o que foi mexido
    const campos = Object.keys(patch).filter((k) => k !== 'updatedAt');
    await this.auditar(tenantId, ator, 'editou_alerta_kds', row, { campos, ativo: row.ativo });
    return row;
  }

  async remover(tenantId: string, id: string, ator?: AtorKds) {
    const [row] = await this.db
      .delete(kdsAlertaConfig)
      .where(and(eq(kdsAlertaConfig.id, id), eq(kdsAlertaConfig.tenantId, tenantId)))
      .returning();
    if (row) await this.auditar(tenantId, ator, 'excluiu_alerta_kds', row, { tipo: row.tipo });
    return { ok: true };
  }

  // Dispara um alerta AGORA (teste / disparo manual pela tela do KDS).
  async dispararManual(tenantId: string, dto: any, ator?: AtorKds) {
    const alerta = {
      titulo: String(dto?.titulo ?? 'Alerta').slice(0, 200),
      detalhe: dto?.detalhe ? String(dto.detalhe).slice(0, 500) : '',
      prioridade: this.prio(dto?.prioridade),
      duracaoSeg: Math.max(3, Math.min(3600, Number(dto?.duracaoSeg) || 60)),
    };
    this.emitir(tenantId, alerta);
    // O alerta aparece na tela de todos os KDS da empresa: quem mandou fica registrado.
    await this.auditar(tenantId, ator, 'disparou_alerta_kds', alerta, { prioridade: alerta.prioridade, duracaoSeg: alerta.duracaoSeg });
    return { ok: true };
  }

  // ===== Scheduler =====
  // Uma volta por vez: com muitas empresas a volta pode passar de 20 s, e duas voltas juntas disputavam o banco.
  private rodando = false;

  @Interval(20000)
  async tick() {
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.umaVolta();
    } finally {
      this.rodando = false;
    }
  }

  private async umaVolta() {
    let configs: any[];
    try {
      configs = await this.db.select().from(kdsAlertaConfig).where(eq(kdsAlertaConfig.ativo, true));
    } catch (e: any) {
      this.logger.warn(`tick: ${e?.message ?? e}`);
      return;
    }
    if (!configs.length) return;
    const { hhmm, dia, ymd } = this.agoraSP();
    // A contagem de TODAS as empresas com condicional numa consulta só, por loja (antes: uma consulta por empresa, em
    // série, a cada 20 s — auditoria do KDS, 11/11/2026).
    const comCondicional = [...new Set(configs.filter((c) => c.tipo === 'condicional').map((c) => c.tenantId as string))];
    let contagem = new Map<string, Map<string, ContagemDaLoja>>();
    if (comCondicional.length) {
      try {
        contagem = await this.contarPedidos(comCondicional);
      } catch (e: any) {
        this.logger.warn(`tick (contagem): ${e?.message ?? e}`);
      }
    }
    for (const c of configs) {
      try {
        if (c.tipo === 'agendado') this.tickAgendado(c, hhmm, dia, ymd);
        else this.tickCondicional(c, contagem.get(c.tenantId) ?? new Map());
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
    // Alerta de uma loja vai só para as telas dela; sem loja, para a empresa inteira.
    this.emitir(c.tenantId, c, '', c.unidadeId ?? null);
  }

  // O condicional olha CADA LOJA (auditoria do KDS, 11/11/2026): antes somava os pedidos da empresa inteira, sem janela de
  // tempo — com as retiradas que ficaram "pronto" para sempre (ERR-438) e as encomendas de outros dias, "pedidos
  // aguardando ≥ N" disparava o tempo todo, e o alerta ia para todas as lojas. O alerta de uma loja olha só ela; o da
  // empresa olha cada loja e avisa a loja que passou do limite (com o número dela).
  private tickCondicional(c: any, porLoja: Map<string, ContagemDaLoja>) {
    const cond = c.condicao ?? {};
    const fonte = String(cond.fonte ?? 'pedidos_total');
    if (fonte === 'externo') return; // disparo externo vem por webhook (dispararManual)
    const lojas = c.unidadeId ? [c.unidadeId as string] : [...porLoja.keys()];
    for (const loja of lojas) {
      const cont = porLoja.get(loja) ?? { balcao: 0, delivery: 0, total: 0 };
      const valor = fonte === 'pedidos_balcao' ? cont.balcao : fonte === 'pedidos_delivery' ? cont.delivery : cont.total;
      if (!passaDoLimite(valor, cond)) continue;
      const chave = `cond|${c.id}|${loja}`;
      const ultimo = this.disparados.get(chave) ?? 0;
      // Cooldown = duração + 60s (não repete o alerta enquanto ainda está no ar).
      const cooldown = (Number(c.duracaoSeg) || 60) * 1000 + 60000;
      if (Date.now() - ultimo <= cooldown) continue;
      this.disparados.set(chave, Date.now());
      this.emitir(c.tenantId, c, ` (${valor})`, loja);
    }
  }

  // Os pedidos EM ANDAMENTO (confirmado/pronto) de cada loja das empresas pedidas, numa consulta só: só os das últimas
  // 12 horas (a mesma janela da fila do KDS) e sem a encomenda de daqui a mais de 1 hora. Toda loja da empresa entra (com
  // zero), para "menos de N pedidos" também valer na loja vazia.
  async contarPedidos(tenantIds: string[]): Promise<Map<string, Map<string, ContagemDaLoja>>> {
    const r: any = await this.db.execute(sql`
      select u.tenant_id, u.id as unidade_id,
             count(pe.id) filter (where pe.tipo = 'retirada') as balcao,
             count(pe.id) filter (where pe.tipo = 'entrega') as delivery,
             count(pe.id) as total
        from unidade u
        left join pedido_externo pe
          on pe.tenant_id = u.tenant_id and pe.unidade_id = u.id
         and pe.status in ('confirmado', 'pronto')
         and pe.criado_em > now() - interval '12 hours'
         and (pe.agendamento is null or pe.agendamento <= now() + interval '1 hour')
       where u.tenant_id in (${sql.join(tenantIds.map((t) => sql`${t}::uuid`), sql`, `)})
       group by u.tenant_id, u.id`);
    const mapa = new Map<string, Map<string, ContagemDaLoja>>();
    for (const row of (r?.rows ?? r) as any[]) {
      const t = String(row.tenant_id);
      if (!mapa.has(t)) mapa.set(t, new Map());
      mapa.get(t)!.set(String(row.unidade_id), {
        balcao: Number(row.balcao) || 0,
        delivery: Number(row.delivery) || 0,
        total: Number(row.total) || 0,
      });
    }
    return mapa;
  }

  private emitir(tenantId: string, c: any, sufixo = '', unidadeId: string | null = null) {
    this.events.emit('kds.alerta.sistema', {
      tenantId,
      ...(unidadeId ? { unidadeId } : {}),
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
    // Limite vazio virava 0 e "≥ 0" disparava sempre (auditoria do KDS, 11/11/2026).
    if (dto.tipo === 'condicional' && dto.condicao?.fonte !== 'externo') {
      const limiar = dto.condicao?.limiar;
      if (limiar === undefined || limiar === null || limiar === '' || !Number.isFinite(Number(limiar)))
        throw new BadRequestException('Informe o limite do alerta condicional (um número).');
    }
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
