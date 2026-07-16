import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  escalaAlocacao,
  escalaRegra,
  etiqueta,
  turno,
  setor,
  colaborador,
  funcao,
  diaEspecial,
} from '../../db/schema';
import { CreateAlocacaoDto } from './dto/create-alocacao.dto';
import {
  validarAlocacao,
  bloqueios,
  gerarDiasTrabalho,
  folgasSemanais,
  avisosDsr,
  type Violacao,
} from '../../common/regras-escala';

@Injectable()
export class EscalaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Avisos/bloqueios das regras CLT para alocar `colaboradorId` no dia/turno,
  // considerando a semana (segunda–domingo) dele. `excluirId` ignora a própria
  // alocação (no PATCH). Bloqueio (ilegal) é lançado; avisos voltam na resposta.
  private async violacoes(
    tenantId: string,
    colaboradorId: string,
    data: string,
    turnoId: string,
    excluirId?: string,
  ): Promise<Violacao[]> {
    const [c] = await this.db
      .select({ jornadaTipo: colaborador.jornadaTipo })
      .from(colaborador)
      .where(and(eq(colaborador.id, colaboradorId), eq(colaborador.tenantId, tenantId)));
    const [t] = await this.db
      .select({
        horaInicio: turno.horaInicio,
        horaFim: turno.horaFim,
        pausaInicio: turno.pausaInicio,
        pausaFim: turno.pausaFim,
      })
      .from(turno)
      .where(and(eq(turno.id, turnoId), eq(turno.tenantId, tenantId)));
    if (!t) return [];

    const seg = segundaISO(data);
    const dom = addDays(seg, 6);
    const conds = [
      eq(escalaAlocacao.tenantId, tenantId),
      eq(escalaAlocacao.colaboradorId, colaboradorId),
      isNull(escalaAlocacao.deletedAt),
      gte(escalaAlocacao.data, seg),
      lte(escalaAlocacao.data, dom),
    ];
    if (excluirId) conds.push(ne(escalaAlocacao.id, excluirId));
    const outras = await this.db
      .select({
        data: escalaAlocacao.data,
        horaInicio: turno.horaInicio,
        horaFim: turno.horaFim,
        pausaInicio: turno.pausaInicio,
        pausaFim: turno.pausaFim,
      })
      .from(escalaAlocacao)
      .leftJoin(turno, eq(escalaAlocacao.turnoId, turno.id))
      .where(and(...conds));

    return validarAlocacao({
      jornadaTipo: c?.jornadaTipo,
      data,
      turno: t,
      outrasNaSemana: outras
        .filter((o) => o.horaInicio)
        .map((o) => ({
          data: o.data,
          turno: {
            horaInicio: o.horaInicio!,
            horaFim: o.horaFim!,
            pausaInicio: o.pausaInicio,
            pausaFim: o.pausaFim,
          },
        })),
    });
  }

  async create(tenantId: string, dto: CreateAlocacaoDto) {
    // A unidade deriva da etiqueta (ambas do mesmo tenant).
    const [et] = await this.db
      .select({ id: etiqueta.id, unidadeId: etiqueta.unidadeId })
      .from(etiqueta)
      .where(
        and(
          eq(etiqueta.id, dto.etiquetaId),
          eq(etiqueta.tenantId, tenantId),
          isNull(etiqueta.deletedAt),
        ),
      );
    if (!et) throw new BadRequestException('Etiqueta inválida para este tenant');

    const [tn] = await this.db
      .select({ id: turno.id })
      .from(turno)
      .where(
        and(
          eq(turno.id, dto.turnoId),
          eq(turno.tenantId, tenantId),
          isNull(turno.deletedAt),
        ),
      );
    if (!tn) throw new BadRequestException('Turno inválido para este tenant');

    // Sobreposição: o colaborador não pode estar em duas vagas no mesmo dia/turno.
    if (dto.colaboradorId) {
      const conflito = await this.db
        .select({ id: escalaAlocacao.id })
        .from(escalaAlocacao)
        .where(
          and(
            eq(escalaAlocacao.tenantId, tenantId),
            eq(escalaAlocacao.data, dto.data),
            eq(escalaAlocacao.turnoId, dto.turnoId),
            eq(escalaAlocacao.colaboradorId, dto.colaboradorId),
            isNull(escalaAlocacao.deletedAt),
          ),
        );
      if (conflito.length) {
        throw new ConflictException('Colaborador já alocado neste turno/dia');
      }
    }

    // Regras CLT: bloqueia o ilegal (interjornada/intrajornada); avisos voltam.
    let avisos: Violacao[] = [];
    if (dto.colaboradorId) {
      const vs = await this.violacoes(tenantId, dto.colaboradorId, dto.data, dto.turnoId);
      const bloq = bloqueios(vs);
      if (bloq.length) throw new BadRequestException(bloq.map((b) => b.msg).join(' '));
      avisos = vs;
    }

    try {
      const [row] = await this.db
        .insert(escalaAlocacao)
        .values({
          tenantId,
          unidadeId: et.unidadeId,
          data: dto.data,
          turnoId: dto.turnoId,
          etiquetaId: dto.etiquetaId,
          colaboradorId: dto.colaboradorId,
          tipo: dto.tipo ?? 'titular',
        })
        .returning();
      return { ...row, avisos };
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictException(
          'Esta etiqueta já está alocada neste turno/dia',
        );
      }
      throw e;
    }
  }

  // Reusa um turno idêntico (setor + horários + pausa) ou cria um novo. Evita
  // multiplicar turnos ao gerar escalas com o mesmo horário.
  private async resolverTurno(
    tenantId: string,
    unidadeId: string,
    setorId: string | null,
    dto: { jornadaTipo: string; horaInicio: string; horaFim: string; pausaInicio?: string | null; pausaFim?: string | null },
  ): Promise<string> {
    const [existe] = await this.db
      .select({ id: turno.id })
      .from(turno)
      .where(sql`
        ${turno.tenantId} = ${tenantId}
        and ${turno.unidadeId} = ${unidadeId}
        and ${turno.setorId} is not distinct from ${setorId}
        and ${turno.horaInicio} = ${dto.horaInicio}::time
        and ${turno.horaFim} = ${dto.horaFim}::time
        and ${turno.pausaInicio} is not distinct from ${dto.pausaInicio ?? null}::time
        and ${turno.pausaFim} is not distinct from ${dto.pausaFim ?? null}::time
        and ${turno.deletedAt} is null
        limit 1`);
    if (existe) return existe.id;
    const [novo] = await this.db
      .insert(turno)
      .values({
        tenantId,
        unidadeId,
        setorId: setorId ?? undefined,
        nome: `${dto.jornadaTipo} ${dto.horaInicio}-${dto.horaFim}`,
        horaInicio: dto.horaInicio,
        horaFim: dto.horaFim,
        pausaInicio: dto.pausaInicio ?? undefined,
        pausaFim: dto.pausaFim ?? undefined,
      })
      .returning({ id: turno.id });
    return novo.id;
  }

  // Geração recorrente: cria a regra e preenche as alocações do período segundo o
  // tipo de escala (motor puro em regras-escala). Feriados (dia_especial) são
  // pulados quando `feriadosFechar`. Pula dias já alocados (idempotente).
  async gerarEscala(
    tenantId: string,
    dto: {
      colaboradorId: string;
      etiquetaId: string;
      jornadaTipo: string;
      horaInicio: string;
      horaFim: string;
      pausaInicio?: string | null;
      pausaFim?: string | null;
      folgasSemana?: number[];
      dataInicio: string;
      dataFim: string;
      feriadosFechar?: boolean;
      respeitarClt?: boolean;
    },
  ) {
    const [et] = await this.db
      .select({ id: etiqueta.id, unidadeId: etiqueta.unidadeId, setorId: etiqueta.setorId })
      .from(etiqueta)
      .where(and(eq(etiqueta.id, dto.etiquetaId), eq(etiqueta.tenantId, tenantId), isNull(etiqueta.deletedAt)));
    if (!et) throw new BadRequestException('Etiqueta inválida para este tenant');
    if (dto.dataFim < dto.dataInicio)
      throw new BadRequestException('A data final deve ser maior ou igual à inicial.');

    // Regra INQUEBRÁVEL do tipo de escala: nº exato de folgas semanais (5x2=2, 6x1=1,
    // 4x3=3). Não se aplica quando é um ÚNICO dia (alocação avulsa, sem semana).
    const umDia = dto.dataInicio === dto.dataFim;
    const folgasExigidas = folgasSemanais(dto.jornadaTipo);
    if (!umDia && folgasExigidas !== null && (dto.folgasSemana?.length ?? 0) !== folgasExigidas) {
      throw new BadRequestException(
        `A escala ${dto.jornadaTipo} exige exatamente ${folgasExigidas} dia(s) de folga por semana.`,
      );
    }

    const turnoId = await this.resolverTurno(tenantId, et.unidadeId, et.setorId, dto);

    // Feriados da rede/unidade no período (para "fechar nos feriados").
    let feriados: string[] = [];
    if (dto.feriadosFechar !== false) {
      const rows = await this.db
        .select({ data: diaEspecial.data })
        .from(diaEspecial)
        .where(sql`
          ${diaEspecial.tenantId} = ${tenantId}
          and ${diaEspecial.tipo} = 'feriado'
          and (${diaEspecial.unidadeId} is null or ${diaEspecial.unidadeId} = ${et.unidadeId})
          and ${diaEspecial.data} between ${dto.dataInicio}::date and ${dto.dataFim}::date`);
      feriados = rows.map((r) => String(r.data));
    }

    const dias = gerarDiasTrabalho({
      jornadaTipo: dto.jornadaTipo,
      dataInicio: dto.dataInicio,
      dataFim: dto.dataFim,
      // Dia avulso sempre aloca o dia clicado (ignora o padrão de folga).
      folgasSemana: umDia ? [] : dto.folgasSemana,
      feriados,
    });

    const [regra] = await this.db
      .insert(escalaRegra)
      .values({
        tenantId,
        unidadeId: et.unidadeId,
        colaboradorId: dto.colaboradorId,
        etiquetaId: dto.etiquetaId,
        turnoId,
        jornadaTipo: dto.jornadaTipo,
        folgasSemana: dto.folgasSemana ?? [],
        dataInicio: dto.dataInicio,
        dataFim: dto.dataFim,
        feriadosFechar: dto.feriadosFechar !== false,
      })
      .returning({ id: escalaRegra.id });

    // Pula dias em que o colaborador já está nesse turno (evita duplicar/regen).
    let jaAlocado = new Set<string>();
    if (dias.length) {
      const existentes = await this.db
        .select({ data: escalaAlocacao.data })
        .from(escalaAlocacao)
        .where(
          and(
            eq(escalaAlocacao.tenantId, tenantId),
            eq(escalaAlocacao.turnoId, turnoId),
            eq(escalaAlocacao.colaboradorId, dto.colaboradorId),
            inArray(escalaAlocacao.data, dias),
            isNull(escalaAlocacao.deletedAt),
          ),
        );
      jaAlocado = new Set(existentes.map((r) => String(r.data)));
    }
    const novas = dias.filter((d) => !jaAlocado.has(d));
    let criadas = 0;
    if (novas.length) {
      const inseridas = await this.db
        .insert(escalaAlocacao)
        .values(
          novas.map((d) => ({
            tenantId,
            unidadeId: et.unidadeId,
            data: d,
            turnoId,
            etiquetaId: dto.etiquetaId,
            colaboradorId: dto.colaboradorId,
            tipo: 'titular',
            regraId: regra.id,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: escalaAlocacao.id });
      criadas = inseridas.length;
    }

    // Avisos CLT (intrajornada + carga horária + DSR domingo/mês) — não bloqueiam a
    // geração. Só quando "levar em conta CLT vigente" (padrão ligado).
    const avisos =
      dto.respeitarClt === false
        ? []
        : [
            ...validarAlocacao({
              jornadaTipo: dto.jornadaTipo,
              data: dto.dataInicio,
              turno: { horaInicio: dto.horaInicio, horaFim: dto.horaFim, pausaInicio: dto.pausaInicio, pausaFim: dto.pausaFim },
              outrasNaSemana: [],
            }),
            ...avisosDsr(dias, dto.dataInicio, dto.dataFim),
          ];

    return {
      regraId: regra.id,
      dias: dias.length,
      criadas,
      puladas: dias.length - criadas,
      avisos,
    };
  }

  // Edita horário/pausa de UM dia com ESCOPO (como um evento recorrente):
  //  - 'dia': só esta alocação;
  //  - 'futuras': esta e as próximas da mesma regra (data >= a deste dia);
  //  - 'datas': as datas informadas (o front calcula o padrão mensal escolhido).
  // Grava OVERRIDE por alocação (o turno-base fica intacto). Bloqueia CLT ilegal.
  async editarHorario(
    tenantId: string,
    id: string,
    dto: {
      escopo: 'dia' | 'futuras' | 'datas';
      horaInicio?: string | null;
      horaFim?: string | null;
      pausaInicio?: string | null;
      pausaFim?: string | null;
      datas?: string[];
    },
  ) {
    const [aloc] = await this.db
      .select({
        id: escalaAlocacao.id,
        regraId: escalaAlocacao.regraId,
        data: escalaAlocacao.data,
        colaboradorId: escalaAlocacao.colaboradorId,
        turnoId: escalaAlocacao.turnoId,
      })
      .from(escalaAlocacao)
      .where(and(eq(escalaAlocacao.id, id), eq(escalaAlocacao.tenantId, tenantId), isNull(escalaAlocacao.deletedAt)));
    if (!aloc) throw new NotFoundException('Alocação não encontrada');

    const [base] = await this.db
      .select({ hi: turno.horaInicio, hf: turno.horaFim, pi: turno.pausaInicio, pf: turno.pausaFim })
      .from(turno)
      .where(eq(turno.id, aloc.turnoId));

    // Valida CLT com os horários EFETIVOS (override onde informado, base no resto).
    const efetivo = {
      horaInicio: (dto.horaInicio ?? base?.hi) as string,
      horaFim: (dto.horaFim ?? base?.hf) as string,
      pausaInicio: dto.pausaInicio !== undefined ? dto.pausaInicio : base?.pi,
      pausaFim: dto.pausaFim !== undefined ? dto.pausaFim : base?.pf,
    };
    const bloq = bloqueios(
      validarAlocacao({ jornadaTipo: null, data: aloc.data, turno: efetivo, outrasNaSemana: [] }),
    );
    if (bloq.length) throw new BadRequestException(bloq.map((b) => b.msg).join(' '));

    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.horaInicio !== undefined) set.horaInicioOverride = dto.horaInicio;
    if (dto.horaFim !== undefined) set.horaFimOverride = dto.horaFim;
    if (dto.pausaInicio !== undefined) set.pausaInicioOverride = dto.pausaInicio;
    if (dto.pausaFim !== undefined) set.pausaFimOverride = dto.pausaFim;

    let alvo;
    if (dto.escopo === 'futuras') {
      if (!aloc.regraId)
        throw new BadRequestException('Este dia não faz parte de uma escala recorrente.');
      alvo = and(eq(escalaAlocacao.regraId, aloc.regraId), gte(escalaAlocacao.data, aloc.data));
    } else if (dto.escopo === 'datas') {
      const datas = dto.datas?.length ? dto.datas : [aloc.data];
      alvo = aloc.regraId
        ? and(eq(escalaAlocacao.regraId, aloc.regraId), inArray(escalaAlocacao.data, datas))
        : and(eq(escalaAlocacao.colaboradorId, aloc.colaboradorId as string), inArray(escalaAlocacao.data, datas));
    } else {
      alvo = eq(escalaAlocacao.id, id);
    }

    const res = await this.db
      .update(escalaAlocacao)
      .set(set)
      .where(and(eq(escalaAlocacao.tenantId, tenantId), alvo, isNull(escalaAlocacao.deletedAt)))
      .returning({ id: escalaAlocacao.id });
    return { ok: true, atualizadas: res.length };
  }

  // Marca a presença de uma alocação (presente / falta justificada+comprovante /
  // falta injustificada). Comprovante só faz sentido na falta justificada.
  async marcarPresenca(
    tenantId: string,
    id: string,
    dto: { presenca: string; comprovanteRef?: string | null; obs?: string | null },
  ) {
    const permitido = ['prevista', 'presente', 'falta_justificada', 'falta_injustificada'];
    if (!permitido.includes(dto.presenca))
      throw new BadRequestException('Status de presença inválido.');
    const [row] = await this.db
      .update(escalaAlocacao)
      .set({
        presenca: dto.presenca,
        comprovanteRef: dto.presenca === 'falta_justificada' ? dto.comprovanteRef ?? null : null,
        presencaObs: dto.obs ?? null,
        presencaEm: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(escalaAlocacao.id, id),
          eq(escalaAlocacao.tenantId, tenantId),
          isNull(escalaAlocacao.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Alocação não encontrada');
    return row;
  }

  // Relatório de faltas do período: lista + resumo por colaborador.
  async faltas(tenantId: string, de?: string, ate?: string) {
    const conds = [
      eq(escalaAlocacao.tenantId, tenantId),
      isNull(escalaAlocacao.deletedAt),
      inArray(escalaAlocacao.presenca, ['falta_justificada', 'falta_injustificada']),
    ];
    if (de) conds.push(gte(escalaAlocacao.data, de));
    if (ate) conds.push(lte(escalaAlocacao.data, ate));
    const lista = await this.joined().where(and(...conds)).orderBy(asc(escalaAlocacao.data));
    const resumo = new Map<
      string,
      { colaboradorId: string; nome: string; justificadas: number; injustificadas: number }
    >();
    for (const f of lista as any[]) {
      const key = f.colaboradorId ?? '—';
      const r =
        resumo.get(key) ??
        { colaboradorId: f.colaboradorId, nome: f.colaboradorNome ?? '—', justificadas: 0, injustificadas: 0 };
      if (f.presenca === 'falta_justificada') r.justificadas++;
      else r.injustificadas++;
      resumo.set(key, r);
    }
    return { faltas: lista, resumo: [...resumo.values()].sort((a, b) => (b.justificadas + b.injustificadas) - (a.justificadas + a.injustificadas)) };
  }

  // Colunas enriquecidas (vaga, setor, turno, responsável) compartilhadas.
  private readonly enriched = {
    id: escalaAlocacao.id,
    data: escalaAlocacao.data,
    tipo: escalaAlocacao.tipo,
    status: escalaAlocacao.status,
    etiquetaId: escalaAlocacao.etiquetaId,
    etiquetaSigla: etiqueta.sigla,
    etiquetaContador: etiqueta.contador,
    etiquetaCor: etiqueta.cor,
    // Hierarquia da função (define a cor da vaga na grade) + cor do setor.
    categoria: funcao.categoria,
    setorNome: setor.nome,
    setorIcone: setor.icone,
    setorCor: setor.cor,
    turnoId: escalaAlocacao.turnoId,
    turnoNome: turno.nome,
    // Override do dia (exceção) tem prioridade sobre o turno-base.
    turnoInicio: sql<string>`coalesce(${escalaAlocacao.horaInicioOverride}, ${turno.horaInicio})`,
    turnoFim: sql<string>`coalesce(${escalaAlocacao.horaFimOverride}, ${turno.horaFim})`,
    pausaInicio: sql<string | null>`coalesce(${escalaAlocacao.pausaInicioOverride}, ${turno.pausaInicio})`,
    pausaFim: sql<string | null>`coalesce(${escalaAlocacao.pausaFimOverride}, ${turno.pausaFim})`,
    regraId: escalaAlocacao.regraId,
    presenca: escalaAlocacao.presenca,
    comprovanteRef: escalaAlocacao.comprovanteRef,
    presencaObs: escalaAlocacao.presencaObs,
    colaboradorId: escalaAlocacao.colaboradorId,
    colaboradorNome: colaborador.nome,
  };

  private joined() {
    return this.db
      .select(this.enriched)
      .from(escalaAlocacao)
      .leftJoin(etiqueta, eq(escalaAlocacao.etiquetaId, etiqueta.id))
      .leftJoin(funcao, eq(etiqueta.funcaoId, funcao.id))
      .leftJoin(setor, eq(etiqueta.setorId, setor.id))
      .leftJoin(turno, eq(escalaAlocacao.turnoId, turno.id))
      .leftJoin(colaborador, eq(escalaAlocacao.colaboradorId, colaborador.id));
  }

  // Lista enriquecida (vaga, setor, turno, responsável) para a tela de Escala.
  findAll(tenantId: string, data?: string, unidadeId?: string | null) {
    const conds = [
      eq(escalaAlocacao.tenantId, tenantId),
      isNull(escalaAlocacao.deletedAt),
    ];
    if (data) conds.push(eq(escalaAlocacao.data, data));
    if (unidadeId) conds.push(eq(escalaAlocacao.unidadeId, unidadeId));
    return this.joined().where(and(...conds));
  }

  // Remove uma alocação (soft-delete). Reversível pela trilha de auditoria.
  async remover(tenantId: string, id: string) {
    const [row] = await this.db
      .update(escalaAlocacao)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(escalaAlocacao.id, id),
          eq(escalaAlocacao.tenantId, tenantId),
          isNull(escalaAlocacao.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Alocação não encontrada');
    return row;
  }

  // Altera o responsável (trocar pessoa / reabrir vaga) ou o tipo da alocação.
  async alterar(
    tenantId: string,
    id: string,
    dto: { colaboradorId?: string | null; tipo?: string },
  ) {
    const [atual] = await this.db
      .select()
      .from(escalaAlocacao)
      .where(
        and(
          eq(escalaAlocacao.id, id),
          eq(escalaAlocacao.tenantId, tenantId),
          isNull(escalaAlocacao.deletedAt),
        ),
      );
    if (!atual) throw new NotFoundException('Alocação não encontrada');

    // Se trocar de pessoa, ela não pode já estar em outra vaga no mesmo dia/turno.
    if (dto.colaboradorId) {
      const conflito = await this.db
        .select({ id: escalaAlocacao.id })
        .from(escalaAlocacao)
        .where(
          and(
            eq(escalaAlocacao.tenantId, tenantId),
            eq(escalaAlocacao.data, atual.data),
            eq(escalaAlocacao.turnoId, atual.turnoId),
            eq(escalaAlocacao.colaboradorId, dto.colaboradorId),
            ne(escalaAlocacao.id, id),
            isNull(escalaAlocacao.deletedAt),
          ),
        );
      if (conflito.length)
        throw new ConflictException('Colaborador já alocado neste turno/dia');
    }

    // Regras CLT ao trocar de pessoa: bloqueia ilegal; avisos voltam.
    let avisos: Violacao[] = [];
    if (dto.colaboradorId) {
      const vs = await this.violacoes(
        tenantId,
        dto.colaboradorId,
        atual.data,
        atual.turnoId,
        id,
      );
      const bloq = bloqueios(vs);
      if (bloq.length) throw new BadRequestException(bloq.map((b) => b.msg).join(' '));
      avisos = vs;
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.colaboradorId !== undefined)
      patch.colaboradorId = dto.colaboradorId || null;
    if (dto.tipo) patch.tipo = dto.tipo;
    const [row] = await this.db
      .update(escalaAlocacao)
      .set(patch)
      .where(and(eq(escalaAlocacao.id, id), eq(escalaAlocacao.tenantId, tenantId)))
      .returning();
    return { ...row, avisos };
  }

  // Alocações enriquecidas num período arbitrário [de, ate] (visões dia/mês).
  periodo(tenantId: string, de: string, ate: string, unidadeId?: string | null) {
    return this.joined()
      .where(
        and(
          eq(escalaAlocacao.tenantId, tenantId),
          isNull(escalaAlocacao.deletedAt),
          gte(escalaAlocacao.data, de),
          lte(escalaAlocacao.data, ate),
          ...(unidadeId ? [eq(escalaAlocacao.unidadeId, unidadeId)] : []),
        ),
      )
      .orderBy(asc(escalaAlocacao.data));
  }

  // Grade semanal: alocações de [inicio, inicio+6], para montar a matriz vaga × dia.
  semana(tenantId: string, inicio: string, unidadeId?: string | null) {
    const fim = addDays(inicio, 6);
    return this.joined()
      .where(
        and(
          eq(escalaAlocacao.tenantId, tenantId),
          isNull(escalaAlocacao.deletedAt),
          gte(escalaAlocacao.data, inicio),
          lte(escalaAlocacao.data, fim),
          ...(unidadeId ? [eq(escalaAlocacao.unidadeId, unidadeId)] : []),
        ),
      )
      .orderBy(asc(escalaAlocacao.data));
  }
}

// Soma dias a uma data ISO (YYYY-MM-DD) sem fuso — devolve outra ISO.
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Segunda-feira (YYYY-MM-DD) da semana de uma data ISO.
function segundaISO(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toISOString().slice(0, 10);
}
