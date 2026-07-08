import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { fichaIngrediente, fichaTecnica } from '../../db/schema';
import {
  custoTotalFicha,
  fichaAlcancavel,
  type FichaCusto,
} from '../../common/regras-negocio';
import { CreateFichaDto } from './dto/create-ficha.dto';
import { CreateIngredienteDto } from './dto/create-ingrediente.dto';
import { UpdateFichaDto } from './dto/update-ficha.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
// custoTotal já resolvido (recursivo, com sub-fichas) → deriva porção, CMV, preço.
function computar(f: any, custoTotal: number) {
  const rendimento = Number(f.rendimento) || 1;
  const custoPorcao = custoTotal / rendimento;
  const precoVenda = f.precoVenda != null ? Number(f.precoVenda) : null;
  const cmv =
    precoVenda && precoVenda > 0 ? (custoPorcao / precoVenda) * 100 : null;
  const metaCmv = f.metaCmv != null ? Number(f.metaCmv) : null;
  // G5: preço sugerido = custo da porção ÷ CMV-alvo (ex.: custo ÷ 0,315 p/ CMV 31,5%).
  const precoSugerido =
    metaCmv && metaCmv > 0 && custoPorcao > 0
      ? custoPorcao / (metaCmv / 100)
      : null;
  // Markup = preço/custo; margem = (preço−custo)/preço. Confusão clássica — mostramos os dois.
  const markup =
    precoVenda && custoPorcao > 0 ? precoVenda / custoPorcao : null;
  const margem =
    precoVenda && precoVenda > 0 ? ((precoVenda - custoPorcao) / precoVenda) * 100 : null;
  return {
    custoTotal: Number(custoTotal.toFixed(2)),
    custoPorcao: Number(custoPorcao.toFixed(2)),
    cmv: cmv != null ? Number(cmv.toFixed(1)) : null,
    precoSugerido: precoSugerido != null ? Number(precoSugerido.toFixed(2)) : null,
    markup: markup != null ? Number(markup.toFixed(2)) : null,
    margem: margem != null ? Number(margem.toFixed(1)) : null,
  };
}

// Insumo de custo (pro cálculo recursivo) a partir da ficha + suas linhas.
function fichaCustoDe(f: any, ings: any[]): FichaCusto {
  return {
    rendimento: Number(f.rendimento) || 1,
    ingredientes: ings.map((i) => ({
      quantidade: Number(i.quantidade),
      fatorCorrecao: Number(i.fatorCorrecao),
      custoUnitario: Number(i.custoUnitario),
      subFichaId: i.subFichaId ?? null,
    })),
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
      // Sub-fichas devem existir no tenant (ficha nova não pode fechar ciclo).
      const subs = dto.ingredientes
        .map((i) => i.subFichaId)
        .filter((x): x is string => !!x);
      if (subs.length) {
        const { fichas } = await this.carregarTudo(tenantId);
        const validos = new Set(fichas.map((x) => x.id));
        for (const s of subs) {
          if (!validos.has(s)) {
            throw new BadRequestException('Sub-ficha inválida para este tenant.');
          }
        }
      }
      await this.db.insert(fichaIngrediente).values(
        dto.ingredientes.map((i, idx) => ({
          tenantId,
          fichaId: f.id,
          itemId: i.subFichaId ? undefined : i.itemId,
          subFichaId: i.subFichaId,
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

  // Carrega todas as fichas do tenant + ingredientes → mapa p/ custo recursivo.
  private async carregarTudo(tenantId: string) {
    const fichas = await this.db
      .select()
      .from(fichaTecnica)
      .where(
        and(eq(fichaTecnica.tenantId, tenantId), isNull(fichaTecnica.deletedAt)),
      )
      .orderBy(asc(fichaTecnica.nome));
    const ings = fichas.length
      ? await this.db
          .select()
          .from(fichaIngrediente)
          .where(inArray(fichaIngrediente.fichaId, fichas.map((f) => f.id)))
      : [];
    const mapa: Record<string, FichaCusto> = {};
    const nome: Record<string, string> = {};
    for (const f of fichas) {
      nome[f.id] = f.nome;
      mapa[f.id] = fichaCustoDe(f, ings.filter((i) => i.fichaId === f.id));
    }
    return { fichas, ings, mapa, nome };
  }

  // Anexa o nome da sub-ficha a cada ingrediente que a referencia (p/ exibição).
  private enriquecer(ings: any[], nome: Record<string, string>) {
    return ings.map((i) => ({
      ...i,
      subFichaNome: i.subFichaId ? nome[i.subFichaId] ?? null : null,
    }));
  }

  async list(tenantId: string) {
    const { fichas, ings, mapa, nome } = await this.carregarTudo(tenantId);
    return fichas.map((f) => {
      const fi = ings
        .filter((i) => i.fichaId === f.id)
        .sort((a, b) => Number(a.ordem) - Number(b.ordem));
      const custoTotal = custoTotalFicha(f.id, mapa);
      return {
        ...f,
        ingredientes: this.enriquecer(fi, nome),
        ...computar(f, custoTotal),
      };
    });
  }

  async getOne(tenantId: string, id: string) {
    const { fichas, ings, mapa, nome } = await this.carregarTudo(tenantId);
    const f = fichas.find((x) => x.id === id);
    if (!f) throw new NotFoundException('Ficha não encontrada');
    const fi = ings
      .filter((i) => i.fichaId === id)
      .sort((a, b) => Number(a.ordem) - Number(b.ordem));
    const custoTotal = custoTotalFicha(id, mapa);
    return {
      ...f,
      ingredientes: this.enriquecer(fi, nome),
      ...computar(f, custoTotal),
    };
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
    // Ingredientes (replace-all) quando enviados — valida ciclo das sub-fichas.
    if (dto.ingredientes) {
      for (const s of dto.ingredientes
        .map((i) => i.subFichaId)
        .filter((x): x is string => !!x)) {
        await this.validarSubFicha(tenantId, id, s);
      }
      await this.db
        .delete(fichaIngrediente)
        .where(
          and(
            eq(fichaIngrediente.fichaId, id),
            eq(fichaIngrediente.tenantId, tenantId),
          ),
        );
      if (dto.ingredientes.length)
        await this.db.insert(fichaIngrediente).values(
          dto.ingredientes.map((i, idx) => ({
            tenantId,
            fichaId: id,
            itemId: i.subFichaId ? undefined : i.itemId,
            subFichaId: i.subFichaId,
            insumoNome: i.insumoNome,
            quantidade: i.quantidade != null ? String(i.quantidade) : '0',
            unidade: i.unidade,
            fatorCorrecao: i.fatorCorrecao != null ? String(i.fatorCorrecao) : '1',
            custoUnitario: i.custoUnitario != null ? String(i.custoUnitario) : '0',
            ordem: i.ordem ?? idx,
          })),
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

  // Garante que a sub-ficha existe no tenant e que a ligação não cria ciclo.
  private async validarSubFicha(
    tenantId: string,
    fichaId: string,
    subFichaId: string,
  ) {
    if (subFichaId === fichaId) {
      throw new BadRequestException('Uma ficha não pode ser sub-receita dela mesma.');
    }
    const { fichas, ings } = await this.carregarTudo(tenantId);
    if (!fichas.some((f) => f.id === subFichaId)) {
      throw new BadRequestException('Sub-ficha inválida para este tenant.');
    }
    const arestas: Record<string, string[]> = {};
    for (const i of ings) {
      if (i.subFichaId) (arestas[i.fichaId] ??= []).push(i.subFichaId);
    }
    // Adicionar pai→sub cria ciclo se a sub-ficha já alcança o pai.
    if (fichaAlcancavel(subFichaId, fichaId, arestas)) {
      throw new BadRequestException(
        'Isso criaria um ciclo de fichas (A usa B que usa A).',
      );
    }
  }

  async addIngrediente(
    tenantId: string,
    fichaId: string,
    dto: CreateIngredienteDto,
  ) {
    await this.getOne(tenantId, fichaId);
    if (dto.subFichaId) await this.validarSubFicha(tenantId, fichaId, dto.subFichaId);
    await this.db.insert(fichaIngrediente).values({
      tenantId,
      fichaId,
      itemId: dto.subFichaId ? undefined : dto.itemId,
      subFichaId: dto.subFichaId,
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
