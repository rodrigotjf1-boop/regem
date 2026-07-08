import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gte, isNull, lte, ne } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  escalaAlocacao,
  etiqueta,
  turno,
  setor,
  colaborador,
  funcao,
} from '../../db/schema';
import { CreateAlocacaoDto } from './dto/create-alocacao.dto';

@Injectable()
export class EscalaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

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
      return row;
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictException(
          'Esta etiqueta já está alocada neste turno/dia',
        );
      }
      throw e;
    }
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
  findAll(tenantId: string, data?: string) {
    const conds = [
      eq(escalaAlocacao.tenantId, tenantId),
      isNull(escalaAlocacao.deletedAt),
    ];
    if (data) conds.push(eq(escalaAlocacao.data, data));
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

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (dto.colaboradorId !== undefined)
      patch.colaboradorId = dto.colaboradorId || null;
    if (dto.tipo) patch.tipo = dto.tipo;
    const [row] = await this.db
      .update(escalaAlocacao)
      .set(patch)
      .where(and(eq(escalaAlocacao.id, id), eq(escalaAlocacao.tenantId, tenantId)))
      .returning();
    return row;
  }

  // Grade semanal: alocações de [inicio, inicio+6], para montar a matriz vaga × dia.
  semana(tenantId: string, inicio: string) {
    const fim = addDays(inicio, 6);
    return this.joined()
      .where(
        and(
          eq(escalaAlocacao.tenantId, tenantId),
          isNull(escalaAlocacao.deletedAt),
          gte(escalaAlocacao.data, inicio),
          lte(escalaAlocacao.data, fim),
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
