import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import * as bcrypt from 'bcryptjs';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { uuidDeChave } from '../../common/id-deterministico';
import {
  ordemProducao,
  fichaTecnica,
  colaborador,
  setor,
  unidade,
  impressaoJob,
  tarefaInstancia,
  tarefaDef,
} from '../../db/schema';
import { ProducaoService } from '../producao/producao.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { dataNoFuso, hojeISO } from '../../common/data';
import { garantirImpressoraDaLoja } from '../../common/impressora-da-loja';
import { gravarOuEncaminharImpressao } from '../../common/impressao-destino';
import { ehServidorLocal } from '../../common/modo';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A ordem do dia de uma recorrência: a definição + o dia (o mesmo id na nuvem e no servidor da loja). */
export const idOrdemRecorrente = (tarefaDefId: string, data: string) => uuidDeChave(tarefaDefId, data);

// Ordem de produção: o PLANO (o que/quanto/quando/quem). A execução (baixa insumos
// + entrada do produzido) é o `produzir()`, disparado na CONCLUSÃO com a qtd REAL.
@Injectable()
export class OrdemProducaoService {
  private readonly log = new Logger(OrdemProducaoService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly producao: ProducaoService,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Escopo multi-loja. Quem tem unidade no JWT só enxerga e só age na PRÓPRIA loja
  // (mais as ordens de rede, sem unidade); quem não tem unidade é rede e vê o tenant
  // inteiro. Sem isso, o gerente da loja A listava, concluía e cancelava ordem da loja B.
  private escopoUnidade(escopoUnidadeId?: string | null) {
    return escopoUnidadeId
      ? or(isNull(ordemProducao.unidadeId), eq(ordemProducao.unidadeId, escopoUnidadeId))
      : null;
  }

  // A unidade gravada na ordem nunca é aceita crua do corpo do request: ou vem do
  // escopo do usuário, ou é conferida contra o tenant.
  private async unidadeDoTenant(tenantId: string, unidadeId?: string | null) {
    if (!unidadeId) return null;
    const [u] = await this.db
      .select({ id: unidade.id })
      .from(unidade)
      .where(and(eq(unidade.id, unidadeId), eq(unidade.tenantId, tenantId)));
    if (!u) throw new BadRequestException('Unidade inválida.');
    return u.id;
  }

  /** Situações com desfecho: a ordem não pede mais nenhuma ação. */
  static readonly ENCERRADAS = ['concluida_total', 'concluida_parcial', 'nao_concluida', 'cancelada'];

  private encerrada(o: any): boolean {
    return OrdemProducaoService.ENCERRADAS.includes(o.status);
  }

  // Carrega a ordem COM TRAVA de linha e roda `fn` no mesmo commit. Ler o status e
  // depois agir em cima dele, sem trava, deixava duas conclusões simultâneas passarem
  // pela mesma guarda — e cada uma baixava o estoque inteiro.
  private async comTrava<T>(
    tenantId: string,
    id: string,
    escopoUnidadeId: string | null,
    fn: (tx: any, o: any) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const cond: any[] = [
        eq(ordemProducao.id, id),
        eq(ordemProducao.tenantId, tenantId),
        isNull(ordemProducao.deletedAt),
      ];
      const esc = this.escopoUnidade(escopoUnidadeId);
      if (esc) cond.push(esc);
      const [o] = await tx
        .select()
        .from(ordemProducao)
        .where(and(...cond))
        .for('update');
      if (!o) throw new NotFoundException('Ordem de produção não encontrada.');
      return fn(tx, o);
    });
  }

  // Quantidade da ordem → quantidade NA UNIDADE DE RENDIMENTO, que é o que o
  // produzir() entende. A explosão (§1.2) é `qtd_liquida × fc × quantidade ÷ rendimento`:
  // produzir uma ficha inteira é passar `rendimento`, não `1`.
  //   • com porcaoTamanho: a ordem é em PORÇÕES → 1 porção = porcaoTamanho de rendimento.
  //     Ex.: rende 1000 ml, porção 100 ml, ordem de 10 porções → 1000 (a ficha inteira).
  //   • sem porcaoTamanho: a ordem é MÚLTIPLO da ficha (mig 130) → × rendimento.
  //     Ex.: rende 1000 ml, ordem de 2 → 2000.
  // Dividir por `rendimento` aqui dividia de novo o que a explosão já divide: a baixa
  // saía `rendimento` vezes menor que o real (ficha de 1000 ml consumia 1/1000 dos insumos).
  private multiplicadorFicha(ficha: any, quantidade: number): number {
    const porcao = Number(ficha?.porcaoTamanho) || 0;
    const rend = Number(ficha?.rendimento) || 0;
    if (porcao > 0) return quantidade * porcao;
    return rend > 0 ? quantidade * rend : quantidade;
  }

  async criar(
    tenantId: string,
    atorId: string,
    dto: any,
    escopoUnidadeId: string | null = null,
  ) {
    const [ficha] = await this.db
      .select()
      .from(fichaTecnica)
      .where(and(eq(fichaTecnica.id, dto?.fichaId), eq(fichaTecnica.tenantId, tenantId)));
    if (!ficha) throw new NotFoundException('Ficha técnica não encontrada.');
    const qtd = Number(dto?.quantidadePlanejada);
    if (!(qtd > 0)) throw new BadRequestException('Informe a quantidade planejada.');
    if (!dto?.dataProducao) throw new BadRequestException('Informe a data de produção.');

    // Usuário preso a uma loja cria SEMPRE na dele; rede informa e nós conferimos.
    const unidadeIdOrdem = escopoUnidadeId
      ? escopoUnidadeId
      : await this.unidadeDoTenant(tenantId, dto?.unidadeId ?? null);

    const canais: string[] = Array.isArray(dto?.canais)
      ? dto.canais.filter((c: string) =>
          ['app', 'kds', 'linha_tempo', 'impressao'].includes(c),
        )
      : [];
    await garantirImpressoraDaLoja(this.db, tenantId, dto?.impressoraId ?? null, unidadeIdOrdem);

    const [row] = await this.db
      .insert(ordemProducao)
      .values({
        tenantId,
        unidadeId: unidadeIdOrdem,
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
        // Encomenda de atacado (mig 185): vínculo com a venda + data combinada.
        comandaId: dto?.comandaId ?? null,
        origem: dto?.origem ?? null,
        dataEntrega: dto?.dataEntrega ?? null,
        obs: dto?.obs ?? null,
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
        // Loja com servidor local ativo: vai por comando para ele (a fila da nuvem não é lida lá).
        await gravarOuEncaminharImpressao(this.db, {
          tenantId,
          unidadeId: ordem.unidadeId ?? null,
          equipamentoId: ordem.impressoraId,
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
            // Uma tarefa de linha do tempo por ordem de produção (mig 277): o id sai da
            // própria ordem, então a rotina rodando nos dois lados não cria duas.
            id: uuidDeChave(ordem.id, 'linha_tempo'),
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

  // `situacao` corta no SERVIDOR, antes do limite: 'abertas' = tudo que ainda pede ação (a fazer,
  // em produção e as pendências de lançamento), sem período; 'encerradas' = o que já teve desfecho,
  // que a tela pede por período. Sem ele a lista são as 500 mais recentes de QUALQUER situação —
  // e uma pendência antiga some atrás de 500 ordens concluídas depois dela.
  async listar(
    tenantId: string,
    filtro: { status?: string; setorId?: string; de?: string; ate?: string; pendentes?: boolean; situacao?: 'abertas' | 'encerradas' } = {},
    escopoUnidadeId: string | null = null,
  ) {
    const cond: any[] = [eq(ordemProducao.tenantId, tenantId), isNull(ordemProducao.deletedAt)];
    const esc = this.escopoUnidade(escopoUnidadeId);
    if (esc) cond.push(esc);
    if (filtro.situacao === 'encerradas') cond.push(inArray(ordemProducao.status, OrdemProducaoService.ENCERRADAS));
    if (filtro.situacao === 'abertas') cond.push(notInArray(ordemProducao.status, OrdemProducaoService.ENCERRADAS));
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

  async mudarStatus(
    tenantId: string,
    id: string,
    novo: string,
    patch: any = {},
    tx: any = this.db,
  ) {
    const [row] = await tx
      .update(ordemProducao)
      .set({ status: novo, updatedAt: new Date(), ...patch })
      .where(and(eq(ordemProducao.id, id), eq(ordemProducao.tenantId, tenantId)))
      .returning();
    return row;
  }

  async liberar(tenantId: string, id: string, escopoUnidadeId: string | null = null) {
    return this.comTrava(tenantId, id, escopoUnidadeId, async (tx, o) => {
      if (!['planejada', 'liberada'].includes(o.status))
        throw new BadRequestException('Ordem não pode ser liberada neste estado.');
      return this.mudarStatus(tenantId, id, 'liberada', {}, tx);
    });
  }

  async iniciar(tenantId: string, id: string, escopoUnidadeId: string | null = null) {
    return this.comTrava(tenantId, id, escopoUnidadeId, async (tx, o) => {
      if (o.status === 'cancelada' || o.status.startsWith('conclu'))
        throw new BadRequestException('Ordem já encerrada.');
      return this.mudarStatus(tenantId, id, 'em_producao', { iniciadaEm: new Date() }, tx);
    });
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
    escopoUnidadeId: string | null = null,
  ) {
    // Via impressa: não movimenta agora; fica aguardando lançamento manual.
    if (dto.viaImpressa) {
      return this.comTrava(tenantId, id, escopoUnidadeId, async (tx, o) => {
        if (this.encerrada(o)) throw new BadRequestException('Ordem já encerrada.');
        return this.mudarStatus(tenantId, id, 'aguardando_lancamento', {}, tx);
      });
    }

    // Assinatura digital: PIN de quem executou. Fica FORA da trava de propósito — é
    // um bcrypt por colaborador do tenant, e segurar a linha durante isso serializaria
    // a loja inteira atrás de uma conclusão.
    const assinanteId = await this.validarPin(tenantId, dto.pin);

    if (dto.tipo === 'nao') {
      if (!dto.motivo?.trim()) throw new BadRequestException('Informe o motivo da não conclusão.');
      const row = await this.comTrava(tenantId, id, escopoUnidadeId, async (tx, o) => {
        if (this.encerrada(o)) throw new BadRequestException('Ordem já encerrada.');
        return this.mudarStatus(
          tenantId,
          id,
          'nao_concluida',
          {
            concluidaEm: new Date(),
            concluidaPorId: assinanteId,
            motivo: dto.motivo!.trim(),
          },
          tx,
        );
      });
      await this.auditar(tenantId, assinanteId, id, 'nao_concluida', { motivo: dto.motivo });
      return { ...row, estoque: null };
    }

    // Baixa de insumos e encerramento da ordem no MESMO commit, com a linha travada:
    // duas conclusões simultâneas não passam mais as duas pela guarda de status.
    const { row, estoque, planejada, real, novoStatus } = await this.comTrava(
      tenantId,
      id,
      escopoUnidadeId,
      async (tx, o) => {
        if (this.encerrada(o)) throw new BadRequestException('Ordem já encerrada.');

        const planejada = Number(o.quantidadePlanejada) || 0;
        const real = dto.tipo === 'total' ? planejada : Number(dto.quantidadeProduzida);
        if (!(real > 0)) throw new BadRequestException('Informe a quantidade produzida.');
        if (dto.tipo === 'parcial' && real >= planejada)
          throw new BadRequestException('Parcial deve ser menor que o planejado. Use "total".');

        // Converte a quantidade da ordem -> unidade de rendimento e executa.
        const [ficha] = await tx
          .select()
          .from(fichaTecnica)
          .where(and(eq(fichaTecnica.id, o.fichaId), eq(fichaTecnica.tenantId, tenantId)));
        if (!ficha) throw new NotFoundException('Ficha técnica não encontrada.');
        const mult = this.multiplicadorFicha(ficha, real);

        // Idempotência (mig 024, índice único por ref): a ordem É a referência. Antes
        // `refId` nunca era gravado na criação, então o produzir() sorteava um UUID novo
        // a cada chamada e o índice nunca via duplicata — a trava do banco não existia.
        const refId = o.refId ?? o.id;
        const estoque = await this.producao.produzir(
          tenantId,
          assinanteId,
          'colaborador',
          {
            fichaId: o.fichaId,
            quantidade: mult,
            itemSaidaId: o.itemSaidaId ?? undefined,
            refId,
          } as any,
          tx,
          o.unidadeId,
        );

        const novoStatus = dto.tipo === 'total' ? 'concluida_total' : 'concluida_parcial';
        const row = await this.mudarStatus(
          tenantId,
          id,
          novoStatus,
          {
            quantidadeProduzida: String(real),
            concluidaEm: new Date(),
            concluidaPorId: assinanteId,
            refId: estoque?.refId ?? refId,
          },
          tx,
        );
        return { row, estoque, planejada, real, novoStatus };
      },
    );

    await this.auditar(tenantId, assinanteId, id, novoStatus, {
      planejada,
      produzida: real,
      insumosBaixados: estoque?.insumosBaixados,
    });
    return { ...row, estoque };
  }

  async cancelar(
    tenantId: string,
    atorId: string,
    id: string,
    motivo?: string,
    escopoUnidadeId: string | null = null,
  ) {
    // Sob trava: cancelar e concluir ao mesmo tempo baixava o estoque de uma ordem
    // que terminava cancelada.
    const row = await this.comTrava(tenantId, id, escopoUnidadeId, async (tx, o) => {
      if (o.status.startsWith('conclu'))
        throw new BadRequestException('Ordem concluída não é cancelada.');
      return this.mudarStatus(
        tenantId,
        id,
        'cancelada',
        {
          motivo: motivo?.trim() || 'cancelada',
          concluidaEm: new Date(),
          concluidaPorId: atorId ?? null,
        },
        tx,
      );
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
  //
  // A loja, a ficha e a impressora passam pelas mesmas conferências do `criar`: a loja é a do
  // escopo de quem pede (ou é conferida contra a empresa) — nunca aceita crua do pedido —, a ficha
  // tem de ser da empresa e a impressora, da loja.
  async criarRecorrencia(tenantId: string, atorId: string, dto: any, escopoUnidadeId: string | null = null) {
    const unidadeId = escopoUnidadeId ?? (await this.unidadeDoTenant(tenantId, dto?.unidadeId ?? null));
    if (!dto?.fichaId || !unidadeId)
      throw new BadRequestException('Recorrência exige ficha e unidade.');
    const [ficha] = await this.db
      .select({ id: fichaTecnica.id })
      .from(fichaTecnica)
      .where(and(eq(fichaTecnica.id, dto.fichaId), eq(fichaTecnica.tenantId, tenantId)));
    if (!ficha) throw new NotFoundException('Ficha técnica não encontrada.');
    await garantirImpressoraDaLoja(this.db, tenantId, dto?.impressoraId ?? null, unidadeId);
    const [def] = await this.db
      .insert(tarefaDef)
      .values({
        tenantId,
        unidadeId,
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
    // Data no fuso da loja: às 21h em SP o UTC já é amanhã e a ordem de hoje não nascia.
    await this.gerarRecorrentes(tenantId, hojeISO()).catch(() => {});
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
        // O id sai da chave de negócio (a definição + o dia): esta rotina roda na nuvem E no
        // servidor da loja, e o sincronismo casa linha por id. Com id aleatório cada lado criava
        // a SUA ordem do dia — e a segunda a chegar batia no índice único (tenant, def, data).
        await this.db.insert(ordemProducao).values({
          id: idOrdemRecorrente(d.id, data),
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
    // A via em papel das de hoje (quem pediu "Impressão"): não espera a próxima passada da rotina.
    // Se falhar aqui a ordem fica criada e a rotina de 10 em 10 minutos tenta de novo.
    if (data === hojeISO())
      await this.imprimirRecorrentesDoDia(tenantId).catch((e: any) =>
        this.log.warn(`via da ordem recorrente não gravada agora (a rotina tenta de novo): ${e?.message ?? e}`),
      );
    return criadas;
  }

  // A VIA EM PAPEL DA ORDEM QUE SE REPETE — uma vez por ordem, na impressora escolhida.
  //
  // A ordem do dia pode nascer na nuvem ou no servidor da loja (e chegar ao outro lado pelo
  // sincronismo), então "imprimir quando criar" imprimiria duas vezes ou nenhuma. Em vez disso
  // esta rotina (de 10 em 10 minutos, e logo depois de gerar) olha as ordens recorrentes de HOJE
  // que pedem impressão e ainda não foram iniciadas, e grava a via com um id que sai da própria
  // ordem — a fila de impressão do lado que imprime serve de registro de "já saiu".
  //  • No servidor da loja: imprime ele (a fila dele é lida pelo worker da loja).
  //  • Na nuvem: só para loja SEM servidor local cadastrado (fila lida pelo agente dos caixas);
  //    a loja que tem servidor é ele quem imprime, quando estiver ligado.
  // Só entram as ordens criadas pela recorrência (o id delas diz): a ordem avulsa imprime na
  // criação, pelo `despacharCanais`. Devolve quantas vias gravou.
  async imprimirRecorrentesDoDia(soTenant?: string): Promise<number> {
    const hoje = hojeISO();
    const r: any = await this.db.execute(sql`
      select o.id, o.tenant_id as "tenantId", o.unidade_id as "unidadeId", o.impressora_id as "impressoraId",
             o.quantidade_planejada::text as "quantidadePlanejada", o.unidade,
             o.data_producao::text as "dataProducao", o.hora_inicio::text as "horaInicio", f.nome as "fichaNome"
        from ordem_producao o
        join equipamento e on e.id = o.impressora_id and e.tenant_id = o.tenant_id and e.tipo = 'impressora' and e.ativo
        left join ficha_tecnica f on f.id = o.ficha_id
       where o.data_producao = ${hoje}::date
         and o.tarefa_def_id is not null
         and o.id = md5(o.tarefa_def_id::text || o.data_producao::text)::uuid
         and o.canais @> '["impressao"]'::jsonb
         and o.status in ('planejada', 'liberada')
         and o.deleted_at is null
         ${soTenant ? sql`and o.tenant_id = ${soTenant}` : sql``}
         ${
           ehServidorLocal()
             ? sql``
             : sql`and not exists (
                     select 1 from equipamento s
                      where s.tenant_id = o.tenant_id and s.tipo = 'servidor_local' and s.ativo and s.integrador is null
                        and (o.unidade_id is null or s.unidade_id is null or s.unidade_id = o.unidade_id))`
         }
         and not exists (select 1 from impressao_job j where j.id = md5(o.id::text || 'impressao')::uuid)`);
    const ordens = (r.rows ?? r) as any[];
    if (!ordens.length) return 0;
    // Uma gravação para todas as vias (o texto é montado aqui; o id repetido não entra de novo).
    const vias = ordens.map(
      (o) => sql`(${uuidDeChave(o.id, 'impressao')}::uuid, ${o.tenantId}::uuid, ${o.unidadeId}::uuid, ${o.impressoraId}::uuid, 'producao',
                  ${this.renderOrdemTicket({ ...o, horaInicio: o.horaInicio ? String(o.horaInicio).slice(0, 5) : null }, { nome: o.fichaNome })}::text)`,
    );
    const feito: any = await this.db.execute(sql`
      insert into impressao_job (id, tenant_id, unidade_id, equipamento_id, via, conteudo)
      values ${sql.join(vias, sql`, `)}
      on conflict (id) do nothing
      returning id`);
    return ((feito.rows ?? feito) as any[]).length;
  }

  // ── Fase 3 — Relatório planejado × produzido (onde a quebra aparece) ──────────
  async relatorio(
    tenantId: string,
    de?: string,
    ate?: string,
    escopoUnidadeId: string | null = null,
  ) {
    const cond: any[] = [
      eq(ordemProducao.tenantId, tenantId),
      isNull(ordemProducao.deletedAt),
      inArray(ordemProducao.status, ['concluida_total', 'concluida_parcial']),
    ];
    if (de) cond.push(gte(ordemProducao.dataProducao, de));
    if (ate) cond.push(lte(ordemProducao.dataProducao, ate));
    const escRel = this.escopoUnidade(escopoUnidadeId);
    if (escRel) cond.push(escRel);
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
    const itens = rows.map((r) => {
      const p = Number(r.planejada) || 0;
      const q = Number(r.produzida) || 0;
      return { ...r, planejada: p, produzida: q, quebra: Number((p - q).toFixed(3)), aderencia: p ? Number(((q / p) * 100).toFixed(1)) : null };
    });
    // Os totais saem do banco, sobre o período INTEIRO: somados na lista, paravam nas 1000 linhas
    // dela e o resumo encolhia sem aviso. `itens` continua limitado; `ordens` diz quantas são.
    const [tot] = await this.db
      .select({
        ordens: sql<number>`count(*)::int`,
        planejado: sql<string>`coalesce(sum(${ordemProducao.quantidadePlanejada}), 0)`,
        produzido: sql<string>`coalesce(sum(${ordemProducao.quantidadeProduzida}), 0)`,
      })
      .from(ordemProducao)
      .where(and(...cond));
    const totPlan = Number(tot?.planejado) || 0;
    const totProd = Number(tot?.produzido) || 0;
    return {
      itens,
      resumo: {
        ordens: Number(tot?.ordens) || 0,
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
    const corte = dataNoFuso(new Date(Date.now() - 24 * 3600 * 1000));
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
