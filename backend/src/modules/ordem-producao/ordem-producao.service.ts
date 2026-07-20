import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  ordemProducao,
  fichaTecnica,
  colaborador,
  setor,
  impressaoJob,
  tarefaInstancia,
  tarefaDef,
} from '../../db/schema';
import { ProducaoService } from '../producao/producao.service';
import { AuditoriaService } from '../auditoria/auditoria.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Ordem de produção: o PLANO (o que/quanto/quando/quem). A execução (baixa insumos
// + entrada do produzido) é o `produzir()`, disparado na CONCLUSÃO com a qtd REAL.
@Injectable()
export class OrdemProducaoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly producao: ProducaoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // porções (un) → múltiplo da ficha que o produzir() entende.
  // Se a ficha define porcaoTamanho: 1 ficha = rendimento / porcaoTamanho porções.
  // Sem porção: a quantidade já é o múltiplo da ficha.
  private multiplicadorFicha(ficha: any, quantidade: number): number {
    const porcao = Number(ficha?.porcaoTamanho) || 0;
    const rend = Number(ficha?.rendimento) || 0;
    if (porcao > 0 && rend > 0) return (quantidade * porcao) / rend;
    return quantidade;
  }

  async criar(tenantId: string, atorId: string, dto: any) {
    const [ficha] = await this.db
      .select()
      .from(fichaTecnica)
      .where(and(eq(fichaTecnica.id, dto?.fichaId), eq(fichaTecnica.tenantId, tenantId)));
    if (!ficha) throw new NotFoundException('Ficha técnica não encontrada.');
    const qtd = Number(dto?.quantidadePlanejada);
    if (!(qtd > 0)) throw new BadRequestException('Informe a quantidade planejada.');
    if (!dto?.dataProducao) throw new BadRequestException('Informe a data de produção.');

    const canais: string[] = Array.isArray(dto?.canais)
      ? dto.canais.filter((c: string) =>
          ['app', 'kds', 'linha_tempo', 'impressao'].includes(c),
        )
      : [];

    const [row] = await this.db
      .insert(ordemProducao)
      .values({
        tenantId,
        unidadeId: dto?.unidadeId ?? null,
        fichaId: dto.fichaId,
        itemSaidaId: dto?.itemSaidaId ?? null,
        quantidadePlanejada: String(qtd),
        unidade: dto?.unidade ?? 'un',
        dataProducao: dto.dataProducao,
        horaInicio: dto?.horaInicio ?? null,
        horaFim: dto?.horaFim ?? null,
        setorId: dto?.setorId ?? null,
        funcaoId: dto?.funcaoId ?? null,
        colaboradorId: dto?.colaboradorId ?? null,
        status: dto?.liberar ? 'liberada' : 'planejada',
        canais,
        kdsEquipamentoId: dto?.kdsEquipamentoId ?? null,
        impressoraId: dto?.impressoraId ?? null,
        tarefaDefId: dto?.tarefaDefId ?? null,
        criadoPorId: atorId ?? null,
      })
      .returning();
    await this.despacharCanais(tenantId, row, ficha);
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil: 'sistema',
      tipo: 'ordem_producao',
      acao: 'ordem_producao_criada',
      detalhe: { ordemId: row.id, fichaId: dto.fichaId, quantidade: qtd },
      origem: 'ordem-producao',
    });
    return row;
  }

  // Fase 2 — canais escolhidos na ordem:
  //  • impressao   → enfileira uma ordem de serviço (com bloco de assinatura) na impressora
  //  • linha_tempo → cria uma tarefa_instancia (aparece na linha do tempo do gerente/C&O)
  //  • kds/app     → a ordem já fica visível no quadro/no app pelo próprio status (sem job)
  private async despacharCanais(tenantId: string, ordem: any, ficha: any) {
    const canais: string[] = Array.isArray(ordem.canais) ? ordem.canais : [];

    if (canais.includes('impressao') && ordem.impressoraId) {
      try {
        await this.db.insert(impressaoJob).values({
          tenantId,
          unidadeId: ordem.unidadeId ?? null,
          equipamentoId: ordem.impressoraId,
          pedidoId: null,
          via: 'producao',
          conteudo: this.renderOrdemTicket(ordem, ficha),
        });
      } catch { /* impressão nunca bloqueia a criação */ }
    }

    if (canais.includes('linha_tempo') && ordem.unidadeId) {
      try {
        const [ti] = await this.db
          .insert(tarefaInstancia)
          .values({
            tenantId,
            unidadeId: ordem.unidadeId,
            data: ordem.dataProducao,
            funcaoId: ordem.funcaoId ?? null,
            setorId: ordem.setorId ?? null,
            colaboradorResolvidoId: ordem.colaboradorId ?? null,
            estado: 'pendente',
          })
          .returning({ id: tarefaInstancia.id });
        if (ti?.id)
          await this.db
            .update(ordemProducao)
            .set({ tarefaInstanciaId: ti.id, updatedAt: new Date() })
            .where(eq(ordemProducao.id, ordem.id));
      } catch { /* linha do tempo é best-effort */ }
    }
  }

  // Ordem de serviço impressa — com bloco de assinatura para lançamento manual depois.
  private renderOrdemTicket(ordem: any, ficha: any): string {
    const linhas = [
      '*** ORDEM DE PRODUÇÃO ***',
      `Ficha: ${ficha?.nome ?? '-'}`,
      `Planejado: ${ordem.quantidadePlanejada} ${ordem.unidade}`,
      `Data: ${ordem.dataProducao}${ordem.horaInicio ? ` ${ordem.horaInicio}` : ''}`,
      '',
      'Concluído:  [ ] Total   [ ] Parcial',
      'Rendeu: __________ ' + (ordem.unidade ?? 'un'),
      'Data/hora: ____/____  __:__',
      'Responsável: _____________________',
      'Assinatura: ______________________',
      '',
      '(lançar no sistema após a produção)',
    ];
    return linhas.join('\n');
  }

  async listar(
    tenantId: string,
    filtro: { status?: string; setorId?: string; de?: string; ate?: string; pendentes?: boolean } = {},
  ) {
    const cond = [eq(ordemProducao.tenantId, tenantId), isNull(ordemProducao.deletedAt)];
    if (filtro.status) cond.push(eq(ordemProducao.status, filtro.status));
    if (filtro.setorId) cond.push(eq(ordemProducao.setorId, filtro.setorId));
    if (filtro.de) cond.push(gte(ordemProducao.dataProducao, filtro.de));
    if (filtro.ate) cond.push(lte(ordemProducao.dataProducao, filtro.ate));
    // Pendências do gerente/C&O: tudo que ainda precisa de desfecho.
    if (filtro.pendentes)
      cond.push(inArray(ordemProducao.status, ['aguardando_lancamento', 'pendencia_critica']));

    const rows = await this.db
      .select({
        id: ordemProducao.id,
        fichaId: ordemProducao.fichaId,
        fichaNome: fichaTecnica.nome,
        quantidadePlanejada: ordemProducao.quantidadePlanejada,
        quantidadeProduzida: ordemProducao.quantidadeProduzida,
        unidade: ordemProducao.unidade,
        dataProducao: ordemProducao.dataProducao,
        horaInicio: ordemProducao.horaInicio,
        horaFim: ordemProducao.horaFim,
        status: ordemProducao.status,
        setorId: ordemProducao.setorId,
        setorNome: setor.nome,
        funcaoId: ordemProducao.funcaoId,
        colaboradorId: ordemProducao.colaboradorId,
        colaboradorNome: colaborador.nome,
        canais: ordemProducao.canais,
        kdsEquipamentoId: ordemProducao.kdsEquipamentoId,
        motivo: ordemProducao.motivo,
        obs: ordemProducao.obs,
        concluidaEm: ordemProducao.concluidaEm,
      })
      .from(ordemProducao)
      .leftJoin(fichaTecnica, eq(fichaTecnica.id, ordemProducao.fichaId))
      .leftJoin(setor, eq(setor.id, ordemProducao.setorId))
      .leftJoin(colaborador, eq(colaborador.id, ordemProducao.colaboradorId))
      .where(and(...cond))
      .orderBy(desc(ordemProducao.dataProducao), desc(ordemProducao.createdAt))
      .limit(500);
    return rows;
  }

  private async carregar(tenantId: string, id: string) {
    const [o] = await this.db
      .select()
      .from(ordemProducao)
      .where(and(eq(ordemProducao.id, id), eq(ordemProducao.tenantId, tenantId), isNull(ordemProducao.deletedAt)));
    if (!o) throw new NotFoundException('Ordem de produção não encontrada.');
    return o;
  }

  async mudarStatus(tenantId: string, id: string, novo: string, patch: any = {}) {
    const [row] = await this.db
      .update(ordemProducao)
      .set({ status: novo, updatedAt: new Date(), ...patch })
      .where(and(eq(ordemProducao.id, id), eq(ordemProducao.tenantId, tenantId)))
      .returning();
    return row;
  }

  async liberar(tenantId: string, id: string) {
    const o = await this.carregar(tenantId, id);
    if (!['planejada', 'liberada'].includes(o.status))
      throw new BadRequestException('Ordem não pode ser liberada neste estado.');
    return this.mudarStatus(tenantId, id, 'liberada');
  }

  async iniciar(tenantId: string, id: string) {
    const o = await this.carregar(tenantId, id);
    if (o.status === 'cancelada' || o.status.startsWith('conclu'))
      throw new BadRequestException('Ordem já encerrada.');
    return this.mudarStatus(tenantId, id, 'em_producao', { iniciadaEm: new Date() });
  }

  // Confirma a assinatura por PIN de um colaborador do tenant e devolve seu id.
  private async validarPin(tenantId: string, pin?: string): Promise<string> {
    if (!pin) throw new BadRequestException('Confirme com o PIN.');
    const gente = await this.db
      .select({ id: colaborador.id, pinHash: colaborador.pinHash })
      .from(colaborador)
      .where(
        and(
          eq(colaborador.tenantId, tenantId),
          isNotNull(colaborador.pinHash),
          isNull(colaborador.deletedAt),
        ),
      );
    for (const c of gente) {
      if (c.pinHash && (await bcrypt.compare(String(pin), c.pinHash))) return c.id;
    }
    throw new ForbiddenException('PIN inválido.');
  }

  // Conclusão: 'total' | 'parcial' | 'nao'. Total/parcial disparam o produzir() com a
  // quantidade REAL (parcial usa a menor). 'nao' não movimenta estoque.
  async concluir(
    tenantId: string,
    id: string,
    dto: {
      tipo: 'total' | 'parcial' | 'nao';
      quantidadeProduzida?: number;
      pin?: string;
      motivo?: string;
      viaImpressa?: boolean;
    },
  ) {
    const o = await this.carregar(tenantId, id);
    if (o.status === 'cancelada' || ['concluida_total', 'concluida_parcial', 'nao_concluida'].includes(o.status))
      throw new BadRequestException('Ordem já encerrada.');

    // Via impressa: não movimenta agora; fica aguardando lançamento manual.
    if (dto.viaImpressa) {
      return this.mudarStatus(tenantId, id, 'aguardando_lancamento');
    }

    // Assinatura digital: PIN de quem executou.
    const assinanteId = await this.validarPin(tenantId, dto.pin);

    if (dto.tipo === 'nao') {
      if (!dto.motivo?.trim()) throw new BadRequestException('Informe o motivo da não conclusão.');
      const row = await this.mudarStatus(tenantId, id, 'nao_concluida', {
        concluidaEm: new Date(),
        concluidaPorId: assinanteId,
        motivo: dto.motivo.trim(),
      });
      await this.auditar(tenantId, assinanteId, id, 'nao_concluida', { motivo: dto.motivo });
      return { ...row, estoque: null };
    }

    const planejada = Number(o.quantidadePlanejada) || 0;
    const real =
      dto.tipo === 'total'
        ? planejada
        : Number(dto.quantidadeProduzida);
    if (!(real > 0)) throw new BadRequestException('Informe a quantidade produzida.');
    if (dto.tipo === 'parcial' && real >= planejada)
      throw new BadRequestException('Parcial deve ser menor que o planejado. Use "total".');

    // Converte porções → múltiplo da ficha e dispara a execução real.
    const [ficha] = await this.db
      .select()
      .from(fichaTecnica)
      .where(eq(fichaTecnica.id, o.fichaId));
    const mult = this.multiplicadorFicha(ficha, real);
    const refId = o.refId ?? undefined;
    const estoque = await this.producao.produzir(tenantId, assinanteId, 'colaborador', {
      fichaId: o.fichaId,
      quantidade: mult,
      itemSaidaId: o.itemSaidaId ?? undefined,
      refId,
    } as any);

    const novoStatus = dto.tipo === 'total' ? 'concluida_total' : 'concluida_parcial';
    const row = await this.mudarStatus(tenantId, id, novoStatus, {
      quantidadeProduzida: String(real),
      concluidaEm: new Date(),
      concluidaPorId: assinanteId,
      refId: estoque?.refId ?? refId ?? null,
    });
    await this.auditar(tenantId, assinanteId, id, novoStatus, {
      planejada,
      produzida: real,
      insumosBaixados: estoque?.insumosBaixados,
    });
    return { ...row, estoque };
  }

  async cancelar(tenantId: string, atorId: string, id: string, motivo?: string) {
    const o = await this.carregar(tenantId, id);
    if (o.status.startsWith('conclu')) throw new BadRequestException('Ordem concluída não é cancelada.');
    const row = await this.mudarStatus(tenantId, id, 'cancelada', {
      motivo: motivo?.trim() || 'cancelada',
      concluidaEm: new Date(),
      concluidaPorId: atorId ?? null,
    });
    await this.auditar(tenantId, atorId, id, 'cancelada', { motivo });
    return row;
  }

  private async auditar(tenantId: string, atorId: string, ordemId: string, acao: string, detalhe: any) {
    await this.auditoria
      .registrar({
        tenantId,
        atorId,
        atorPerfil: 'colaborador',
        tipo: 'ordem_producao',
        acao: `ordem_producao_${acao}`,
        detalhe: { ordemId, ...detalhe },
        origem: 'ordem-producao',
      })
      .catch(() => {});
  }

  // ── Fase 3 — Recorrência (reaproveita tarefa_def) ─────────────────────────────
  // Cria uma definição recorrente que carrega a config da produção no jsonb. O job
  // diário materializa a ordem do dia a partir dela (idempotente pelo índice único).
  async criarRecorrencia(tenantId: string, atorId: string, dto: any) {
    if (!dto?.fichaId || !dto?.unidadeId)
      throw new BadRequestException('Recorrência exige ficha e unidade.');
    const [def] = await this.db
      .insert(tarefaDef)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        setorId: dto?.setorId ?? null,
        funcaoId: dto?.funcaoId ?? null,
        origem: 'recorrente',
        titulo: `Produção: ${dto?.titulo ?? 'ordem'}`,
        recorrenciaTipo: dto?.recorrenciaTipo ?? 'diaria',
        recorrenciaConfig: {
          ordemProducao: {
            fichaId: dto.fichaId,
            itemSaidaId: dto?.itemSaidaId ?? null,
            quantidade: Number(dto?.quantidadePlanejada) || 1,
            unidade: dto?.unidade ?? 'un',
            setorId: dto?.setorId ?? null,
            funcaoId: dto?.funcaoId ?? null,
            colaboradorId: dto?.colaboradorId ?? null,
            canais: Array.isArray(dto?.canais) ? dto.canais : [],
            kdsEquipamentoId: dto?.kdsEquipamentoId ?? null,
            impressoraId: dto?.impressoraId ?? null,
            horaInicio: dto?.horaInicio ?? null,
          },
          dias: dto?.dias ?? null, // [0..6] p/ recorrência semanal; null = todo dia
        },
        horario: dto?.horaInicio ?? null,
      })
      .returning();
    // Já gera a de hoje se se aplicar.
    await this.gerarRecorrentes(tenantId, new Date().toISOString().slice(0, 10)).catch(() => {});
    return def;
  }

  // Materializa as ordens recorrentes de uma data (chamado pelo job diário).
  async gerarRecorrentes(tenantId: string, data: string) {
    const diaSemana = new Date(data + 'T12:00:00').getDay();
    const defs = await this.db
      .select()
      .from(tarefaDef)
      .where(
        and(
          eq(tarefaDef.tenantId, tenantId),
          eq(tarefaDef.origem, 'recorrente'),
          isNull(tarefaDef.deletedAt),
        ),
      );
    let criadas = 0;
    for (const d of defs) {
      const cfg: any = d.recorrenciaConfig;
      const op = cfg?.ordemProducao;
      if (!op?.fichaId) continue; // não é uma def de produção
      if (Array.isArray(cfg?.dias) && cfg.dias.length && !cfg.dias.includes(diaSemana)) continue;
      try {
        // Índice único (tenant, tarefa_def_id, data) evita duplicar.
        await this.db.insert(ordemProducao).values({
          tenantId,
          unidadeId: d.unidadeId,
          fichaId: op.fichaId,
          itemSaidaId: op.itemSaidaId ?? null,
          quantidadePlanejada: String(op.quantidade ?? 1),
          unidade: op.unidade ?? 'un',
          dataProducao: data,
          horaInicio: op.horaInicio ?? null,
          setorId: op.setorId ?? d.setorId ?? null,
          funcaoId: op.funcaoId ?? d.funcaoId ?? null,
          colaboradorId: op.colaboradorId ?? null,
          status: 'liberada',
          canais: op.canais ?? [],
          kdsEquipamentoId: op.kdsEquipamentoId ?? null,
          impressoraId: op.impressoraId ?? null,
          tarefaDefId: d.id,
        });
        criadas++;
      } catch { /* já existe (índice único) — ok */ }
    }
    return criadas;
  }

  // ── Fase 3 — Relatório planejado × produzido (onde a quebra aparece) ──────────
  async relatorio(tenantId: string, de?: string, ate?: string) {
    const cond = [
      eq(ordemProducao.tenantId, tenantId),
      isNull(ordemProducao.deletedAt),
      inArray(ordemProducao.status, ['concluida_total', 'concluida_parcial']),
    ];
    if (de) cond.push(gte(ordemProducao.dataProducao, de));
    if (ate) cond.push(lte(ordemProducao.dataProducao, ate));
    const rows = await this.db
      .select({
        id: ordemProducao.id,
        fichaNome: fichaTecnica.nome,
        dataProducao: ordemProducao.dataProducao,
        unidade: ordemProducao.unidade,
        planejada: ordemProducao.quantidadePlanejada,
        produzida: ordemProducao.quantidadeProduzida,
        status: ordemProducao.status,
      })
      .from(ordemProducao)
      .leftJoin(fichaTecnica, eq(fichaTecnica.id, ordemProducao.fichaId))
      .where(and(...cond))
      .orderBy(desc(ordemProducao.dataProducao))
      .limit(1000);
    let totPlan = 0, totProd = 0;
    const itens = rows.map((r) => {
      const p = Number(r.planejada) || 0;
      const q = Number(r.produzida) || 0;
      totPlan += p; totProd += q;
      return { ...r, planejada: p, produzida: q, quebra: Number((p - q).toFixed(3)), aderencia: p ? Number(((q / p) * 100).toFixed(1)) : null };
    });
    return {
      itens,
      resumo: {
        ordens: itens.length,
        planejadoTotal: Number(totPlan.toFixed(3)),
        produzidoTotal: Number(totProd.toFixed(3)),
        quebraTotal: Number((totPlan - totProd).toFixed(3)),
        aderenciaMedia: totPlan ? Number(((totProd / totPlan) * 100).toFixed(1)) : null,
      },
    };
  }

  // Job diário: ordens em aguardando_lancamento cuja data prevista passou de 1 dia
  // viram pendencia_critica (sobem no painel do gerente/C&O; exigem desfecho).
  async promoverPendenciasCriticas() {
    const corte = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const rows = await this.db
      .update(ordemProducao)
      .set({ status: 'pendencia_critica', updatedAt: new Date() })
      .where(
        and(
          eq(ordemProducao.status, 'aguardando_lancamento'),
          lte(ordemProducao.dataProducao, corte),
          isNull(ordemProducao.deletedAt),
        ),
      )
      .returning({ id: ordemProducao.id, tenantId: ordemProducao.tenantId });
    return rows.length;
  }
}
