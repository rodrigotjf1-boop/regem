import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { documentoControlado, ciencia } from '../../db/schema';
import { CreateDocumentoDto } from './dto/create-documento.dto';

@Injectable()
export class DocumentoService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateDocumentoDto) {
    const [row] = await this.db
      .insert(documentoControlado)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        tipo: dto.tipo,
        titulo: dto.titulo,
        escopo: dto.escopo,
        conteudo: dto.conteudo as any,
      })
      .returning();
    return row;
  }

  private async getOwned(tenantId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(documentoControlado)
      .where(
        and(
          eq(documentoControlado.id, id),
          eq(documentoControlado.tenantId, tenantId),
          isNull(documentoControlado.deletedAt),
        ),
      );
    if (!row) throw new NotFoundException('Documento não encontrado');
    return row;
  }

  findAll(tenantId: string) {
    return this.db
      .select()
      .from(documentoControlado)
      .where(
        and(
          eq(documentoControlado.tenantId, tenantId),
          isNull(documentoControlado.deletedAt),
        ),
      );
  }

  async publicar(tenantId: string, id: string) {
    await this.getOwned(tenantId, id);
    const [row] = await this.db
      .update(documentoControlado)
      .set({ estado: 'vigente', publicadoEm: new Date() })
      .where(eq(documentoControlado.id, id))
      .returning();
    return row;
  }

  // Registro de ciência do colaborador logado (prova de que leu a versão vigente).
  async darCiencia(tenantId: string, documentoId: string, colaboradorId: string) {
    const doc = await this.getOwned(tenantId, documentoId);
    const [row] = await this.db
      .insert(ciencia)
      .values({ tenantId, colaboradorId, documentoId, versao: doc.versao })
      .onConflictDoNothing()
      .returning();
    if (row) return row;

    const [existing] = await this.db
      .select()
      .from(ciencia)
      .where(
        and(
          eq(ciencia.colaboradorId, colaboradorId),
          eq(ciencia.documentoId, documentoId),
          eq(ciencia.versao, doc.versao),
        ),
      );
    return existing;
  }

  listCiencias(tenantId: string, documentoId: string) {
    return this.db
      .select()
      .from(ciencia)
      .where(
        and(
          eq(ciencia.tenantId, tenantId),
          eq(ciencia.documentoId, documentoId),
        ),
      );
  }
}
