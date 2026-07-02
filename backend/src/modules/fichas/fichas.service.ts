import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { fichaIngrediente, fichaTecnica } from '../../db/schema';
import { CreateFichaDto } from './dto/create-ficha.dto';
import { CreateIngredienteDto } from './dto/create-ingrediente.dto';
import { UpdateFichaDto } from './dto/update-ficha.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
function computar(f: any, ings: any[]) {
  const custoTotal = ings.reduce(
    (s, i) =>
      s +
      Number(i.quantidade) * Number(i.fatorCorrecao) * Number(i.custoUnitario),
    0,
  );
  const rendimento = Number(f.rendimento) || 1;
  const custoPorcao = custoTotal / rendimento;
  const precoVenda = f.precoVenda != null ? Number(f.precoVenda) : null;
  const cmv =
    precoVenda && precoVenda > 0 ? (custoPorcao / precoVenda) * 100 : null;
  return {
    custoTotal: Number(custoTotal.toFixed(2)),
    custoPorcao: Number(custoPorcao.toFixed(2)),
    cmv: cmv != null ? Number(cmv.toFixed(1)) : null,
  };
}

@Injectable()
export class FichasService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  async create(tenantId: string, dto: CreateFichaDto) {
    const [f] = await this.db
      .insert(fichaTecnica)
      .values({
        tenantId,
        nome: dto.nome,
        categoria: dto.categoria ?? 'base',
        rendimento: dto.rendimento != null ? String(dto.rendimento) : '1',
        rendimentoUnidade: dto.rendimentoUnidade,
        validade: dto.validade,
        precoVenda: dto.precoVenda != null ? String(dto.precoVenda) : undefined,
        metaCmv: dto.metaCmv != null ? String(dto.metaCmv) : undefined,
        setorId: dto.setorId,
        unidadeId: dto.unidadeId,
        popId: dto.popId,
      })
      .returning();

    if (dto.ingredientes?.length) {
      await this.db.insert(fichaIngrediente).values(
        dto.ingredientes.map((i, idx) => ({
          tenantId,
          fichaId: f.id,
          itemId: i.itemId,
          insumoNome: i.insumoNome,
          quantidade: i.quantidade != null ? String(i.quantidade) : '0',
          unidade: i.unidade,
          fatorCorrecao:
            i.fatorCorrecao != null ? String(i.fatorCorrecao) : '1',
          custoUnitario:
            i.custoUnitario != null ? String(i.custoUnitario) : '0',
          ordem: i.ordem ?? idx,
        })),
      );
    }
    return this.getOne(tenantId, f.id);
  }

  async list(tenantId: string) {
    const fichas = await this.db
      .select()
      .from(fichaTecnica)
      .where(
        and(eq(fichaTecnica.tenantId, tenantId), isNull(fichaTecnica.deletedAt)),
      )
      .orderBy(asc(fichaTecnica.nome));
    if (fichas.length === 0) return [];
    const ids = fichas.map((f) => f.id);
    const ings = await this.db
      .select()
      .from(fichaIngrediente)
      .where(inArray(fichaIngrediente.fichaId, ids));
    return fichas.map((f) => {
      const fi = ings.filter((i) => i.fichaId === f.id);
      return { ...f, ingredientes: fi, ...computar(f, fi) };
    });
  }

  async getOne(tenantId: string, id: string) {
    const [f] = await this.db
      .select()
      .from(fichaTecnica)
      .where(
        and(
          eq(fichaTecnica.id, id),
          eq(fichaTecnica.tenantId, tenantId),
          isNull(fichaTecnica.deletedAt),
        ),
      );
    if (!f) throw new NotFoundException('Ficha não encontrada');
    const ings = await this.db
      .select()
      .from(fichaIngrediente)
      .where(eq(fichaIngrediente.fichaId, id))
      .orderBy(asc(fichaIngrediente.ordem));
    return { ...f, ingredientes: ings, ...computar(f, ings) };
  }

  async update(tenantId: string, id: string, dto: UpdateFichaDto) {
    await this.getOne(tenantId, id);
    const patch: any = {};
    if (dto.nome !== undefined) patch.nome = dto.nome;
    if (dto.categoria !== undefined) patch.categoria = dto.categoria;
    if (dto.rendimento !== undefined) patch.rendimento = String(dto.rendimento);
    if (dto.rendimentoUnidade !== undefined)
      patch.rendimentoUnidade = dto.rendimentoUnidade;
    if (dto.validade !== undefined) patch.validade = dto.validade;
    if (dto.precoVenda !== undefined)
      patch.precoVenda = dto.precoVenda != null ? String(dto.precoVenda) : null;
    if (dto.metaCmv !== undefined) patch.metaCmv = String(dto.metaCmv);
    if (dto.setorId !== undefined) patch.setorId = dto.setorId;
    if (dto.popId !== undefined) patch.popId = dto.popId;
    if (dto.ativo !== undefined) patch.ativo = dto.ativo;
    if (Object.keys(patch).length) {
      await this.db
        .update(fichaTecnica)
        .set(patch)
        .where(
          and(eq(fichaTecnica.id, id), eq(fichaTecnica.tenantId, tenantId)),
        );
    }
    return this.getOne(tenantId, id);
  }

  async remove(tenantId: string, id: string) {
    await this.getOne(tenantId, id);
    await this.db
      .update(fichaTecnica)
      .set({ deletedAt: new Date() })
      .where(and(eq(fichaTecnica.id, id), eq(fichaTecnica.tenantId, tenantId)));
    return { ok: true };
  }

  async addIngrediente(
    tenantId: string,
    fichaId: string,
    dto: CreateIngredienteDto,
  ) {
    await this.getOne(tenantId, fichaId);
    await this.db.insert(fichaIngrediente).values({
      tenantId,
      fichaId,
      itemId: dto.itemId,
      insumoNome: dto.insumoNome,
      quantidade: dto.quantidade != null ? String(dto.quantidade) : '0',
      unidade: dto.unidade,
      fatorCorrecao: dto.fatorCorrecao != null ? String(dto.fatorCorrecao) : '1',
      custoUnitario: dto.custoUnitario != null ? String(dto.custoUnitario) : '0',
      ordem: dto.ordem ?? 0,
    });
    return this.getOne(tenantId, fichaId);
  }

  async removeIngrediente(tenantId: string, id: string) {
    await this.db
      .delete(fichaIngrediente)
      .where(
        and(
          eq(fichaIngrediente.id, id),
          eq(fichaIngrediente.tenantId, tenantId),
        ),
      );
    return { ok: true };
  }
}
