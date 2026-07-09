import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { etiqueta, setor, funcao } from '../../db/schema';
import { CreateEtiquetaDto } from './dto/create-etiqueta.dto';

@Injectable()
export class EtiquetaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateEtiquetaDto) {
    // Setor e função precisam ser do mesmo tenant; a unidade deriva do setor.
    const [s] = await this.db
      .select({ id: setor.id, unidadeId: setor.unidadeId })
      .from(setor)
      .where(
        and(
          eq(setor.id, dto.setorId),
          eq(setor.tenantId, tenantId),
          isNull(setor.deletedAt),
        ),
      );
    if (!s) throw new BadRequestException('Setor inválido para este tenant');

    const [f] = await this.db
      .select({ id: funcao.id })
      .from(funcao)
      .where(
        and(
          eq(funcao.id, dto.funcaoId),
          eq(funcao.tenantId, tenantId),
          isNull(funcao.deletedAt),
        ),
      );
    if (!f) throw new BadRequestException('Função inválida para este tenant');

    try {
      const [row] = await this.db
        .insert(etiqueta)
        .values({
          tenantId,
          unidadeId: s.unidadeId,
          setorId: dto.setorId,
          funcaoId: dto.funcaoId,
          sigla: dto.sigla,
          contador: dto.contador ?? 1,
          cor: dto.cor,
          icone: dto.icone,
          titularPadraoColaboradorId: dto.titularPadraoColaboradorId,
        })
        .returning();
      return row;
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictException(
          'Já existe etiqueta com essa sigla+contador na unidade',
        );
      }
      throw e;
    }
  }

  async update(
    tenantId: string,
    id: string,
    dto: { sigla?: string; contador?: number; cor?: string; icone?: string },
  ) {
    try {
      const [row] = await this.db
        .update(etiqueta)
        .set({
          sigla: dto.sigla,
          contador: dto.contador ?? 1,
          cor: dto.cor,
          icone: dto.icone,
        })
        .where(
          and(
            eq(etiqueta.id, id),
            eq(etiqueta.tenantId, tenantId),
            isNull(etiqueta.deletedAt),
          ),
        )
        .returning();
      if (!row) throw new NotFoundException('Etiqueta não encontrada.');
      return row;
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new ConflictException(
          'Já existe etiqueta com essa sigla+contador na unidade',
        );
      }
      throw e;
    }
  }

  async remove(tenantId: string, id: string) {
    const [row] = await this.db
      .update(etiqueta)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(etiqueta.id, id),
          eq(etiqueta.tenantId, tenantId),
          isNull(etiqueta.deletedAt),
        ),
      )
      .returning({ id: etiqueta.id });
    if (!row) throw new NotFoundException('Etiqueta não encontrada.');
    return { ok: true };
  }

  findAll(tenantId: string) {
    // Enriquece com a hierarquia da função (categoria → cor da vaga) e a cor do setor.
    return this.db
      .select({
        id: etiqueta.id,
        unidadeId: etiqueta.unidadeId,
        setorId: etiqueta.setorId,
        funcaoId: etiqueta.funcaoId,
        sigla: etiqueta.sigla,
        contador: etiqueta.contador,
        cor: etiqueta.cor,
        icone: etiqueta.icone,
        categoria: funcao.categoria,
        funcaoNome: funcao.nome,
        setorNome: setor.nome,
        setorCor: setor.cor,
      })
      .from(etiqueta)
      .leftJoin(funcao, eq(etiqueta.funcaoId, funcao.id))
      .leftJoin(setor, eq(etiqueta.setorId, setor.id))
      .where(and(eq(etiqueta.tenantId, tenantId), isNull(etiqueta.deletedAt)));
  }
}
