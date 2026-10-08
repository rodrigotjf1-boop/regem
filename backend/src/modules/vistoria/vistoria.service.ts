import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNull, lte, desc, getTableColumns } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { colaborador, vistoria } from '../../db/schema';
import { condUnidade } from '../../common/filtro-unidade';
import { hojeISO } from '../../common/data';
import type { Periodo } from '../../common/periodo';
import { CreateVistoriaDto } from './dto/create-vistoria.dto';

@Injectable()
export class VistoriaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // `atorId`: quem está logado. A coluna `colaborador_id` existia e nunca era preenchida — a
  // vistoria ficava sem dono. Vem da sessão, não do corpo: ninguém registra em nome de outro.
  async create(tenantId: string, dto: CreateVistoriaDto, atual: string | null = null, atorId?: string | null) {
    const [row] = await this.db
      .insert(vistoria)
      .values({
        tenantId,
        unidadeId: atual ?? dto.unidadeId,
        setorId: dto.setorId,
        colaboradorId: atorId ?? undefined,
        tipo: dto.tipo,
        observacao: dto.observacao,
        fotoRef: dto.fotoRef,
        data: dto.data ?? hojeISO(),
      })
      .returning();
    return row;
  }

  // `periodo` (pela DATA da vistoria) é o que a tela pede para a lista não crescer para sempre;
  // sem ele, devolve tudo — como sempre foi para quem não manda.
  findAll(tenantId: string, atual: string | null = null, periodo: Periodo = { inicio: null, fim: null }) {
    return this.db
      .select({
        ...getTableColumns(vistoria),
        // Quem registrou (do MESMO tenant; vistoria antiga, de antes do preenchimento, vem nula).
        registradoPorNome: colaborador.nome,
      })
      .from(vistoria)
      .leftJoin(colaborador, and(eq(colaborador.id, vistoria.colaboradorId), eq(colaborador.tenantId, vistoria.tenantId)))
      .where(
        and(
          eq(vistoria.tenantId, tenantId),
          condUnidade(vistoria.unidadeId, atual),
          isNull(vistoria.deletedAt),
          periodo.inicio ? gte(vistoria.data, periodo.inicio) : undefined,
          periodo.fim ? lte(vistoria.data, periodo.fim) : undefined,
        ),
      )
      .orderBy(desc(vistoria.createdAt));
  }
}
