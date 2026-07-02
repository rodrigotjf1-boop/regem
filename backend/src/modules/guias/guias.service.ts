import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { guia, guiaPasso } from '../../db/schema';
import { CreateGuiaDto } from './dto/create-guia.dto';
import { CreatePassoDto } from './dto/create-passo.dto';
import { UpdateGuiaDto } from './dto/update-guia.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class GuiasService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateGuiaDto) {
    const [g] = await this.db
      .insert(guia)
      .values({
        tenantId,
        titulo: dto.titulo,
        codigo: dto.codigo,
        descricao: dto.descricao,
        ramo: dto.ramo,
        frequencia: dto.frequencia ?? 'diaria',
        estado: dto.estado ?? 'rascunho',
        setorId: dto.setorId,
        funcaoId: dto.funcaoId,
        unidadeId: dto.unidadeId,
      })
      .returning();

    if (dto.passos?.length) {
      await this.db.insert(guiaPasso).values(
        dto.passos.map((p, idx) => ({
          tenantId,
          guiaId: g.id,
          descricao: p.descricao,
          mediaRef: p.mediaRef,
          ordem: p.ordem ?? idx,
        })),
      );
    }
    return this.getOne(tenantId, g.id);
  }

  async list(tenantId: string) {
    const guias = await this.db
      .select()
      .from(guia)
      .where(and(eq(guia.tenantId, tenantId), isNull(guia.deletedAt)))
      .orderBy(asc(guia.titulo));
    if (guias.length === 0) return [];
    const ids = guias.map((g) => g.id);
    const passos = await this.db
      .select()
      .from(guiaPasso)
      .where(inArray(guiaPasso.guiaId, ids))
      .orderBy(asc(guiaPasso.ordem));
    return guias.map((g) => ({
      ...g,
      passos: passos.filter((p) => p.guiaId === g.id),
    }));
  }

  async getOne(tenantId: string, id: string) {
    const [g] = await this.db
      .select()
      .from(guia)
      .where(
        and(eq(guia.id, id), eq(guia.tenantId, tenantId), isNull(guia.deletedAt)),
      );
    if (!g) throw new NotFoundException('Guia não encontrado');
    const passos = await this.db
      .select()
      .from(guiaPasso)
      .where(eq(guiaPasso.guiaId, id))
      .orderBy(asc(guiaPasso.ordem));
    return { ...g, passos };
  }

  async update(tenantId: string, id: string, dto: UpdateGuiaDto) {
    await this.getOne(tenantId, id);
    const patch: any = {};
    for (const k of [
      'titulo',
      'codigo',
      'descricao',
      'ramo',
      'frequencia',
      'estado',
      'setorId',
      'funcaoId',
    ] as const) {
      if (dto[k] !== undefined) patch[k] = dto[k];
    }
    if (Object.keys(patch).length) {
      await this.db
        .update(guia)
        .set(patch)
        .where(and(eq(guia.id, id), eq(guia.tenantId, tenantId)));
    }
    return this.getOne(tenantId, id);
  }

  async remove(tenantId: string, id: string) {
    await this.getOne(tenantId, id);
    await this.db
      .update(guia)
      .set({ deletedAt: new Date() })
      .where(and(eq(guia.id, id), eq(guia.tenantId, tenantId)));
    return { ok: true };
  }

  async addPasso(tenantId: string, guiaId: string, dto: CreatePassoDto) {
    await this.getOne(tenantId, guiaId);
    await this.db.insert(guiaPasso).values({
      tenantId,
      guiaId,
      descricao: dto.descricao,
      mediaRef: dto.mediaRef,
      ordem: dto.ordem ?? 0,
    });
    return this.getOne(tenantId, guiaId);
  }

  async removePasso(tenantId: string, id: string) {
    await this.db
      .delete(guiaPasso)
      .where(and(eq(guiaPasso.id, id), eq(guiaPasso.tenantId, tenantId)));
    return { ok: true };
  }
}
