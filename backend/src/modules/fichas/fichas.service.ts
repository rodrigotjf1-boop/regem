import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { fichaIngrediente, fichaTecnica, itemConversao, itemEstoque } from '../../db/schema';
import { arredondarEstoque, arredondarInformado, fatorParaEstoque, type Conversao } from '../../common/conversao-unidade';
import { unidadeOuPadrao } from '../estoque/unidades';
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

// Custo/CMV nos dois contextos: balcão (padrão, mantém os nomes atuais) e delivery
// (balcão + linhas somente_delivery). `temCustoDelivery` = a ficha tem extras de
// delivery (a UI mostra os dois valores quando true).
function computarDois(f: any, custoBalcao: number, custoDelivery: number) {
  const balcao = computar(f, custoBalcao);
  const deliv = computar(f, custoDelivery);
  return {
    ...balcao,
    custoTotalDelivery: deliv.custoTotal,
    custoPorcaoDelivery: deliv.custoPorcao,
    cmvDelivery: deliv.cmv,
    margemDelivery: deliv.margem,
    temCustoDelivery: custoDelivery > custoBalcao + 0.0001,
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
      somenteDelivery: !!i.somenteDelivery,
    })),
  };
}

@Injectable()
export class FichasService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Unidade do insumo escrito à mão (sem produto do estoque nem sub-receita): tem de ser da lista.
  // Conferida ANTES de gravar qualquer coisa — a recusa (400) não pode deixar ficha sem ingredientes.
  private conferirUnidadesLivres(linhas: CreateIngredienteDto[] | undefined) {
    for (const i of linhas ?? [])
      if (!i.subFichaId && !i.itemId) unidadeOuPadrao(i.unidade, `Unidade de "${String(i.insumoNome ?? '').slice(0, 40)}"`);
  }

  async create(tenantId: string, dto: CreateFichaDto) {
    this.conferirUnidadesLivres(dto.ingredientes);
    const [f] = await this.db
      .insert(fichaTecnica)
      .values({
        tenantId,
        nome: dto.nome,
        categoria: dto.categoria ?? 'base',
        rendimento: dto.rendimento != null ? String(dto.rendimento) : '1',
        rendimentoUnidade: dto.rendimentoUnidade === undefined ? undefined : unidadeOuPadrao(dto.rendimentoUnidade, 'Unidade do rendimento', 'porção'),
        porcaoTamanho: dto.porcaoTamanho != null ? String(dto.porcaoTamanho) : undefined,
        porcaoUnidade: dto.porcaoUnidade,
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
      const linhas = await this.linhasParaGravar(tenantId, dto.ingredientes);
      await this.db.insert(fichaIngrediente).values(
        linhas.map((i, idx) => ({
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
          somenteDelivery: i.somenteDelivery ?? false,
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
          .where(
            and(
              inArray(fichaIngrediente.fichaId, fichas.map((f) => f.id)),
              isNull(fichaIngrediente.deletedAt), // ingrediente removido não entra no custo
            ),
          )
      : [];
    const mapa: Record<string, FichaCusto> = {};
    const nome: Record<string, string> = {};
    for (const f of fichas) {
      nome[f.id] = f.nome;
      mapa[f.id] = fichaCustoDe(f, ings.filter((i) => i.fichaId === f.id));
    }
    return { fichas, ings, mapa, nome };
  }

  // Unidade de estoque e conversões dos produtos ligados às linhas (para converter a quantidade).
  async unidadesDosItens(tenantId: string, itemIds: (string | null | undefined)[]) {
    const ids = [...new Set(itemIds.filter((x): x is string => !!x))];
    const mapa = new Map<string, { unidade: string; conversoes: Conversao[] }>();
    if (!ids.length) return mapa;
    const itens = await this.db
      .select({ id: itemEstoque.id, unidade: itemEstoque.unidadeMedida })
      .from(itemEstoque)
      .where(and(eq(itemEstoque.tenantId, tenantId), inArray(itemEstoque.id, ids)));
    for (const i of itens) mapa.set(i.id, { unidade: i.unidade, conversoes: [] });
    const convs = await this.db
      .select({
        itemId: itemConversao.itemId,
        unidadeDe: itemConversao.unidadeDe,
        fator: itemConversao.fator,
        unidadePara: itemConversao.unidadePara,
      })
      .from(itemConversao)
      .where(and(eq(itemConversao.tenantId, tenantId), inArray(itemConversao.itemId, ids)));
    for (const c of convs) mapa.get(c.itemId)?.conversoes.push(c);
    return mapa;
  }

  // A linha chega com a quantidade e o custo NA UNIDADE ESCOLHIDA ("2 unidade" de um bacon em
  // kg, a R$ 0,50 a fatia) e é GRAVADA na unidade do estoque (0,02778 kg, a R$ 36 o kg) — a mesma
  // em que a venda e a produção baixam e em que o custo da ficha é somado. É por isso que nenhuma
  // rotina de baixa precisou mudar. Linha sem produto ligado (ou sub-receita), ou com unidade que
  // o produto não tem, fica como veio.
  private async linhasParaGravar<T extends CreateIngredienteDto>(tenantId: string, linhas: T[]): Promise<T[]> {
    const unidades = await this.unidadesDosItens(
      tenantId,
      linhas.map((i) => (i.subFichaId ? null : i.itemId)),
    );
    return linhas.map((i) => {
      // Insumo escrito à mão (sem produto do estoque nem sub-receita): a unidade é só rótulo, mas
      // sai da MESMA lista do estoque — "un" vira "unidade"; o que não existe é recusado (400).
      if (!i.subFichaId && !i.itemId)
        return { ...i, unidade: unidadeOuPadrao(i.unidade, `Unidade de "${String(i.insumoNome ?? '').slice(0, 40)}"`) };
      const u = !i.subFichaId && i.itemId ? unidades.get(i.itemId) : undefined;
      const fator = u ? fatorParaEstoque(i.unidade, u.unidade, u.conversoes) ?? 1 : 1;
      if (fator === 1) return i;
      return {
        ...i,
        quantidade: i.quantidade != null ? arredondarEstoque(Number(i.quantidade) * fator) : i.quantidade,
        custoUnitario: i.custoUnitario != null ? arredondarEstoque(Number(i.custoUnitario) / fator) : i.custoUnitario,
      };
    });
  }

  // Devolve cada linha como a pessoa a informou (quantidade e custo na unidade escolhida) e,
  // ao lado, o que está gravado: a quantidade na unidade do estoque. Anexa o nome da sub-ficha.
  private async enriquecer(tenantId: string, ings: any[], nome: Record<string, string>) {
    const unidades = await this.unidadesDosItens(tenantId, ings.map((i) => (i.subFichaId ? null : i.itemId)));
    return ings.map((i) => {
      const u = !i.subFichaId && i.itemId ? unidades.get(i.itemId) : undefined;
      const fator = u ? fatorParaEstoque(i.unidade, u.unidade, u.conversoes) ?? 1 : 1;
      return {
        ...i,
        ...(fator === 1
          ? {}
          : {
              quantidade: String(arredondarInformado(Number(i.quantidade) / fator)),
              custoUnitario: String(arredondarInformado(Number(i.custoUnitario) * fator)),
            }),
        quantidadeEstoque: Number(i.quantidade),
        unidadeEstoque: u?.unidade ?? null,
        fatorUnidade: fator,
        subFichaNome: i.subFichaId ? nome[i.subFichaId] ?? null : null,
      };
    });
  }

  // Mapa fichaId → custo por porção (balcão e delivery). Usado por outros módulos
  // (catálogo) p/ derivar o custo de um produto ligado a uma ficha.
  async custoPorPorcao(
    tenantId: string,
  ): Promise<Record<string, { balcao: number; delivery: number }>> {
    const { fichas, mapa } = await this.carregarTudo(tenantId);
    const out: Record<string, { balcao: number; delivery: number }> = {};
    for (const f of fichas) {
      const rend = Number(f.rendimento) || 1;
      out[f.id] = {
        balcao: custoTotalFicha(f.id, mapa) / rend,
        delivery: custoTotalFicha(f.id, mapa, true) / rend,
      };
    }
    return out;
  }

  async list(tenantId: string) {
    const { fichas, ings, mapa, nome } = await this.carregarTudo(tenantId);
    const linhas = await this.enriquecer(tenantId, ings, nome);
    return fichas.map((f) => {
      const fi = linhas
        .filter((i) => i.fichaId === f.id)
        .sort((a, b) => Number(a.ordem) - Number(b.ordem));
      const custoBalcao = custoTotalFicha(f.id, mapa);
      const custoDelivery = custoTotalFicha(f.id, mapa, true);
      return {
        ...f,
        ingredientes: fi,
        ...computarDois(f, custoBalcao, custoDelivery),
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
    const custoBalcao = custoTotalFicha(id, mapa);
    const custoDelivery = custoTotalFicha(id, mapa, true);
    return {
      ...f,
      ingredientes: await this.enriquecer(tenantId, fi, nome),
      ...computarDois(f, custoBalcao, custoDelivery),
    };
  }

  async update(tenantId: string, id: string, dto: UpdateFichaDto) {
    await this.getOne(tenantId, id);
    this.conferirUnidadesLivres(dto.ingredientes);
    if (dto.rendimentoUnidade !== undefined) unidadeOuPadrao(dto.rendimentoUnidade, 'Unidade do rendimento', 'porção');
    const patch: any = {};
    if (dto.nome !== undefined) patch.nome = dto.nome;
    if (dto.categoria !== undefined) patch.categoria = dto.categoria;
    if (dto.rendimento !== undefined) patch.rendimento = String(dto.rendimento);
    if (dto.rendimentoUnidade !== undefined)
      patch.rendimentoUnidade = unidadeOuPadrao(dto.rendimentoUnidade, 'Unidade do rendimento', 'porção');
    // Tamanho da porção (mig 130): converte porções (un) ↔ rendimento na ordem de produção.
    if (dto.porcaoTamanho !== undefined)
      patch.porcaoTamanho = dto.porcaoTamanho != null ? String(dto.porcaoTamanho) : null;
    if (dto.porcaoUnidade !== undefined) patch.porcaoUnidade = dto.porcaoUnidade || null;
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
      // SOFT-delete (mig 242), não delete físico: a tabela sincroniza para o servidor
      // local por delta de linha. Apagar de verdade some da nuvem mas NÃO some do edge
      // — ele ficaria com o ingrediente antigo somado ao novo e baixaria insumo a mais.
      await this.db
        .update(fichaIngrediente)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(fichaIngrediente.fichaId, id),
            eq(fichaIngrediente.tenantId, tenantId),
            isNull(fichaIngrediente.deletedAt),
          ),
        );
      const linhas = await this.linhasParaGravar(tenantId, dto.ingredientes);
      if (linhas.length)
        await this.db.insert(fichaIngrediente).values(
          linhas.map((i, idx) => ({
            tenantId,
            fichaId: id,
            itemId: i.subFichaId ? undefined : i.itemId,
            subFichaId: i.subFichaId,
            insumoNome: i.insumoNome,
            quantidade: i.quantidade != null ? String(i.quantidade) : '0',
            unidade: i.unidade,
            fatorCorrecao: i.fatorCorrecao != null ? String(i.fatorCorrecao) : '1',
            custoUnitario: i.custoUnitario != null ? String(i.custoUnitario) : '0',
            somenteDelivery: i.somenteDelivery ?? false,
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
    const [linha] = await this.linhasParaGravar(tenantId, [dto]);
    await this.db.insert(fichaIngrediente).values({
      tenantId,
      fichaId,
      itemId: dto.subFichaId ? undefined : dto.itemId,
      subFichaId: dto.subFichaId,
      insumoNome: dto.insumoNome,
      quantidade: linha.quantidade != null ? String(linha.quantidade) : '0',
      unidade: dto.unidade,
      fatorCorrecao: dto.fatorCorrecao != null ? String(dto.fatorCorrecao) : '1',
      custoUnitario: linha.custoUnitario != null ? String(linha.custoUnitario) : '0',
      somenteDelivery: dto.somenteDelivery ?? false,
      ordem: dto.ordem ?? 0,
    });
    return this.getOne(tenantId, fichaId);
  }

  async removeIngrediente(tenantId: string, id: string) {
    // Soft-delete: a exclusão precisa DESCER para o servidor local (ver mig 242).
    await this.db
      .update(fichaIngrediente)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(fichaIngrediente.id, id),
          eq(fichaIngrediente.tenantId, tenantId),
        ),
      );
    return { ok: true };
  }
}
