import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  colaborador,
  documentoControlado,
  ciencia,
  empresa,
} from '../../db/schema';
import { CreateDocumentoDto } from './dto/create-documento.dto';
import { UpdateDocumentoDto } from './dto/update-documento.dto';
import { SUGESTOES_DOCUMENTO } from './sugestoes-documento';

/* eslint-disable @typescript-eslint/no-explicit-any */
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

  // Lista com contagem de ciências da versão vigente e se o usuário já assinou.
  async findAll(tenantId: string, colaboradorId?: string) {
    const docs = await this.db
      .select()
      .from(documentoControlado)
      .where(
        and(
          eq(documentoControlado.tenantId, tenantId),
          isNull(documentoControlado.deletedAt),
        ),
      )
      .orderBy(desc(documentoControlado.createdAt));
    if (docs.length === 0) return [];
    const ids = docs.map((d) => d.id);
    const cts = await this.db
      .select()
      .from(ciencia)
      .where(
        and(eq(ciencia.tenantId, tenantId), inArray(ciencia.documentoId, ids)),
      );
    return docs.map((d) => {
      const daVersao = cts.filter(
        (c) => c.documentoId === d.id && c.versao === d.versao,
      );
      return {
        ...d,
        cienciaCount: daVersao.length,
        jaCiente: colaboradorId
          ? daVersao.some((c) => c.colaboradorId === colaboradorId)
          : false,
      };
    });
  }

  async update(tenantId: string, id: string, dto: UpdateDocumentoDto) {
    await this.getOwned(tenantId, id);
    const patch: any = {};
    for (const k of ['tipo', 'titulo', 'escopo', 'conteudo'] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    if (Object.keys(patch).length) {
      patch.updatedAt = new Date();
      await this.db
        .update(documentoControlado)
        .set(patch)
        .where(
          and(
            eq(documentoControlado.id, id),
            eq(documentoControlado.tenantId, tenantId),
          ),
        );
    }
    return this.getOwned(tenantId, id);
  }

  async remove(tenantId: string, id: string) {
    await this.getOwned(tenantId, id);
    await this.db
      .update(documentoControlado)
      .set({ deletedAt: new Date() })
      .where(eq(documentoControlado.id, id));
    return { ok: true };
  }

  // Modelos de documento sugeridos pelo ramo da empresa (rascunhos editáveis).
  async sugestoesRamo(tenantId: string) {
    const [emp] = await this.db
      .select({ ramo: empresa.ramo })
      .from(empresa)
      .where(eq(empresa.id, tenantId));
    const ramo = emp?.ramo ?? 'food_service';
    return {
      ramo,
      sugestoes: SUGESTOES_DOCUMENTO[ramo] ?? SUGESTOES_DOCUMENTO.geral,
    };
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
      .select({
        id: ciencia.id,
        colaboradorId: ciencia.colaboradorId,
        nome: colaborador.nome,
        versao: ciencia.versao,
        data: ciencia.data,
      })
      .from(ciencia)
      .leftJoin(colaborador, eq(colaborador.id, ciencia.colaboradorId))
      .where(
        and(
          eq(ciencia.tenantId, tenantId),
          eq(ciencia.documentoId, documentoId),
        ),
      )
      .orderBy(desc(ciencia.data));
  }
}
