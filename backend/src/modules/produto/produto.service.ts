import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  produto,
  produtoVariacao,
  produtoComboItem,
  produtoFaixaPreco,
  produtoSugestao,
  complementoGrupo,
  complementoOpcao,
  categoriaProduto,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { CreateProdutoDto } from './dto/create-produto.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class ProdutoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  // ----- Categorias (hierárquicas) -----
  listarCategorias(tenantId: string) {
    return this.db
      .select()
      .from(categoriaProduto)
      .where(eq(categoriaProduto.tenantId, tenantId));
  }

  async criarCategoria(tenantId: string, dto: CreateCategoriaDto) {
    const [row] = await this.db
      .insert(categoriaProduto)
      .values({
        tenantId,
        nome: dto.nome,
        parentId: dto.parentId,
        ordem: dto.ordem ?? 0,
      })
      .returning();
    return row;
  }

  // ----- Produtos -----
  async listar(tenantId: string) {
    const res: any = await this.db.execute(sql`
      select p.id, p.codigo, p.nome, p.descricao, p.tipo,
             p.unidade_medida as "unidadeMedida", p.preco_venda as "precoVenda",
             p.preco_custo as "precoCusto", p.controla_estoque as "controlaEstoque",
             p.validade_dias as "validadeDias", p.vai_para_producao as "vaiParaProducao",
             p.disponivel_cardapio as "disponivelCardapio",
             p.disponivel_balcao as "disponivelBalcao",
             p.ativo, p.categoria_id as "categoriaId", p.ficha_id as "fichaId",
             p.setor_producao_id as "setorProducaoId", p.imagem_ref as "imagemRef",
             c.nome as "categoriaNome", f.nome as "fichaNome"
      from produto p
      left join categoria_produto c on c.id = p.categoria_id
      left join ficha_tecnica f on f.id = p.ficha_id
      where p.tenant_id = ${tenantId} and p.deleted_at is null
      order by p.nome
    `);
    return res.rows ?? res;
  }

  async getOne(tenantId: string, id: string) {
    const [p] = await this.db
      .select()
      .from(produto)
      .where(and(eq(produto.id, id), eq(produto.tenantId, tenantId)));
    if (!p) throw new NotFoundException('Produto não encontrado');
    const variacoes = await this.db
      .select()
      .from(produtoVariacao)
      .where(eq(produtoVariacao.produtoId, id));
    const combo = await this.db
      .select()
      .from(produtoComboItem)
      .where(eq(produtoComboItem.comboProdutoId, id));
    const complementos = await this.complementosDe(tenantId, id);
    const faixas = await this.db
      .select()
      .from(produtoFaixaPreco)
      .where(eq(produtoFaixaPreco.produtoId, id))
      .orderBy(produtoFaixaPreco.ordem);
    const sugestoes = await this.sugestoesDe(tenantId, id);
    return { ...p, variacoes, combo, complementos, faixas, sugestoes };
  }

  // IDs dos produtos sugeridos ("Peça também") vinculados a este produto.
  async sugestoesDe(tenantId: string, produtoId: string) {
    const rows = await this.db
      .select({ sugeridoId: produtoSugestao.sugeridoId })
      .from(produtoSugestao)
      .where(and(eq(produtoSugestao.tenantId, tenantId), eq(produtoSugestao.produtoId, produtoId)))
      .orderBy(produtoSugestao.ordem);
    return rows.map((r) => r.sugeridoId);
  }

  // Substitui (replace-all) as sugestões vinculadas ao produto.
  async setSugestoes(tenantId: string, produtoId: string, sugeridoIds: string[]) {
    await this.db
      .delete(produtoSugestao)
      .where(and(eq(produtoSugestao.tenantId, tenantId), eq(produtoSugestao.produtoId, produtoId)));
    const limpos = [...new Set((sugeridoIds ?? []).filter((s) => s && s !== produtoId))];
    if (limpos.length) {
      await this.db.insert(produtoSugestao).values(
        limpos.map((sugeridoId, ordem) => ({ tenantId, produtoId, sugeridoId, ordem })),
      );
    }
  }

  // ===== Faixas de preço por volume (B2B) =====
  faixasDe(tenantId: string, produtoId: string) {
    return this.db
      .select()
      .from(produtoFaixaPreco)
      .where(
        and(
          eq(produtoFaixaPreco.tenantId, tenantId),
          eq(produtoFaixaPreco.produtoId, produtoId),
        ),
      )
      .orderBy(produtoFaixaPreco.ordem);
  }

  async setFaixas(
    tenantId: string,
    produtoId: string,
    faixas: { qtdMin: number; preco: number }[],
  ) {
    await this.db
      .delete(produtoFaixaPreco)
      .where(
        and(
          eq(produtoFaixaPreco.tenantId, tenantId),
          eq(produtoFaixaPreco.produtoId, produtoId),
        ),
      );
    if (faixas?.length) {
      await this.db.insert(produtoFaixaPreco).values(
        faixas
          .filter((f) => Number(f.qtdMin) > 0)
          .map((f, i) => ({
            tenantId,
            produtoId,
            qtdMin: Number(f.qtdMin),
            preco: String(Number(f.preco) || 0),
            ordem: i,
          })),
      );
    }
    return this.faixasDe(tenantId, produtoId);
  }

  // ===== Complementos (opcionais/adicionais) =====
  async complementosDe(tenantId: string, produtoId: string) {
    const grupos = await this.db
      .select()
      .from(complementoGrupo)
      .where(
        and(
          eq(complementoGrupo.tenantId, tenantId),
          eq(complementoGrupo.produtoId, produtoId),
        ),
      )
      .orderBy(complementoGrupo.ordem);
    if (!grupos.length) return [];
    const opcoes = await this.db
      .select()
      .from(complementoOpcao)
      .where(eq(complementoOpcao.tenantId, tenantId))
      .orderBy(complementoOpcao.ordem);
    return grupos.map((g) => ({
      ...g,
      opcoes: opcoes.filter((o) => o.grupoId === g.id),
    }));
  }

  async criarGrupo(
    tenantId: string,
    produtoId: string,
    dto: {
      nome: string;
      tipo: 'remover' | 'adicionar' | 'escolha';
      min?: number;
      max?: number;
      obrigatorio?: boolean;
    },
  ) {
    const tipo = ['remover', 'adicionar', 'escolha'].includes(dto.tipo)
      ? dto.tipo
      : 'adicionar';
    const [g] = await this.db
      .insert(complementoGrupo)
      .values({
        tenantId,
        produtoId,
        nome: dto.nome,
        tipo,
        min: dto.min ?? 0,
        max: dto.max,
        obrigatorio: dto.obrigatorio ?? false,
      })
      .returning();
    return g;
  }

  async criarOpcao(
    tenantId: string,
    grupoId: string,
    dto: {
      nome: string;
      precoDelta?: number;
      fichaIngredienteId?: string;
      itemId?: string;
      produtoRefId?: string;
      quantidade?: number;
    },
  ) {
    const [o] = await this.db
      .insert(complementoOpcao)
      .values({
        tenantId,
        grupoId,
        nome: dto.nome,
        precoDelta: dto.precoDelta != null ? String(dto.precoDelta) : '0',
        fichaIngredienteId: dto.fichaIngredienteId,
        itemId: dto.itemId,
        produtoRefId: dto.produtoRefId,
        quantidade: dto.quantidade != null ? String(dto.quantidade) : '1',
      })
      .returning();
    return o;
  }

  async removerGrupo(tenantId: string, grupoId: string) {
    await this.db
      .delete(complementoGrupo)
      .where(
        and(
          eq(complementoGrupo.id, grupoId),
          eq(complementoGrupo.tenantId, tenantId),
        ),
      );
    return { ok: true };
  }

  async removerOpcao(tenantId: string, opcaoId: string) {
    await this.db
      .delete(complementoOpcao)
      .where(
        and(
          eq(complementoOpcao.id, opcaoId),
          eq(complementoOpcao.tenantId, tenantId),
        ),
      );
    return { ok: true };
  }

  async criar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: CreateProdutoDto,
  ) {
    const row = await this.db.transaction(async (tx) => {
      const [p] = await tx
        .insert(produto)
        .values({
          tenantId,
          unidadeId: dto.unidadeId,
          codigo: dto.codigo,
          nome: dto.nome,
          descricao: dto.descricao,
          categoriaId: dto.categoriaId,
          fichaId: dto.fichaId,
          tipo: dto.tipo ?? 'simples',
          unidadeMedida: dto.unidadeMedida ?? 'un',
          precoVenda: String(dto.precoVenda),
          precoCusto: dto.precoCusto != null ? String(dto.precoCusto) : undefined,
          controlaEstoque: dto.controlaEstoque ?? true,
          validadeDias: dto.validadeDias,
          vaiParaProducao: dto.vaiParaProducao ?? true,
          setorProducaoId: dto.setorProducaoId,
          tempoPreparoMin: dto.tempoPreparoMin,
          ncm: dto.ncm,
          cfop: dto.cfop,
          cest: dto.cest,
          origem: dto.origem,
          csosn: dto.csosn,
          cstIcms: dto.cstIcms,
          unidadeTrib: dto.unidadeTrib,
          aliqIcms: dto.aliqIcms != null ? String(dto.aliqIcms) : undefined,
          precoPromocional:
            dto.precoPromocional != null ? String(dto.precoPromocional) : undefined,
          selos: dto.selos ?? [],
          disponivelCardapio: dto.disponivelCardapio ?? true,
          disponivelBalcao: dto.disponivelBalcao ?? true,
          destaque: dto.destaque ?? false,
          vendaMultiplo: dto.vendaMultiplo,
          duracaoMin: dto.duracaoMin,
          gtin: dto.gtin,
          cstPis: dto.cstPis,
          aliqPis: dto.aliqPis != null ? String(dto.aliqPis) : undefined,
          cstCofins: dto.cstCofins,
          aliqCofins: dto.aliqCofins != null ? String(dto.aliqCofins) : undefined,
          imagemRef: dto.imagemRef,
        })
        .returning();

      if (dto.variacoes?.length) {
        await tx.insert(produtoVariacao).values(
          dto.variacoes.map((v) => ({
            tenantId,
            produtoId: p.id,
            nome: v.nome,
            codigo: v.codigo,
            precoVenda: String(v.precoVenda),
            fatorFicha: v.fatorFicha != null ? String(v.fatorFicha) : '1',
            atributos: v.atributos ?? {},
          })),
        );
      }
      if (dto.combo?.length) {
        await tx.insert(produtoComboItem).values(
          dto.combo.map((c) => ({
            tenantId,
            comboProdutoId: p.id,
            componenteProdutoId: c.componenteProdutoId,
            quantidade: c.quantidade != null ? String(c.quantidade) : '1',
          })),
        );
      }
      return p;
    });

    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'cadastro',
      acao: 'cadastrou_produto',
      entidadeTipo: 'produto',
      entidadeId: row.id,
      detalhe: { nome: row.nome, preco: Number(row.precoVenda) },
    });
    if (dto.sugestoes !== undefined) await this.setSugestoes(tenantId, row.id, dto.sugestoes);
    return row;
  }

  async atualizar(tenantId: string, id: string, dto: CreateProdutoDto) {
    const patch: any = { updatedAt: new Date() };
    const set = (k: string, v: any) => {
      if (v !== undefined) patch[k] = v;
    };
    set('codigo', dto.codigo);
    set('nome', dto.nome);
    set('descricao', dto.descricao);
    set('categoriaId', dto.categoriaId);
    set('fichaId', dto.fichaId);
    set('tipo', dto.tipo);
    set('unidadeMedida', dto.unidadeMedida);
    if (dto.precoVenda !== undefined) patch.precoVenda = String(dto.precoVenda);
    if (dto.precoCusto !== undefined)
      patch.precoCusto = dto.precoCusto != null ? String(dto.precoCusto) : null;
    set('controlaEstoque', dto.controlaEstoque);
    set('validadeDias', dto.validadeDias);
    set('vaiParaProducao', dto.vaiParaProducao);
    set('setorProducaoId', dto.setorProducaoId);
    set('tempoPreparoMin', dto.tempoPreparoMin);
    set('ncm', dto.ncm);
    set('cfop', dto.cfop);
    set('cest', dto.cest);
    set('origem', dto.origem);
    set('csosn', dto.csosn);
    set('cstIcms', dto.cstIcms);
    set('unidadeTrib', dto.unidadeTrib);
    if (dto.aliqIcms !== undefined)
      patch.aliqIcms = dto.aliqIcms != null ? String(dto.aliqIcms) : null;
    if (dto.precoPromocional !== undefined)
      patch.precoPromocional = dto.precoPromocional != null ? String(dto.precoPromocional) : null;
    set('selos', dto.selos);
    set('disponivelCardapio', dto.disponivelCardapio);
    set('disponivelBalcao', dto.disponivelBalcao);
    set('destaque', dto.destaque);
    set('vendaMultiplo', dto.vendaMultiplo);
    set('duracaoMin', dto.duracaoMin);
    set('gtin', dto.gtin);
    set('cstPis', dto.cstPis);
    if (dto.aliqPis !== undefined)
      patch.aliqPis = dto.aliqPis != null ? String(dto.aliqPis) : null;
    set('cstCofins', dto.cstCofins);
    if (dto.aliqCofins !== undefined)
      patch.aliqCofins = dto.aliqCofins != null ? String(dto.aliqCofins) : null;
    set('imagemRef', dto.imagemRef);

    const [row] = await this.db
      .update(produto)
      .set(patch)
      .where(and(eq(produto.id, id), eq(produto.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Produto não encontrado');

    // Substitui variações/combo quando enviados (edição completa).
    if (dto.variacoes) {
      await this.db
        .delete(produtoVariacao)
        .where(eq(produtoVariacao.produtoId, id));
      if (dto.variacoes.length)
        await this.db.insert(produtoVariacao).values(
          dto.variacoes.map((v) => ({
            tenantId,
            produtoId: id,
            nome: v.nome,
            codigo: v.codigo,
            precoVenda: String(v.precoVenda),
            fatorFicha: v.fatorFicha != null ? String(v.fatorFicha) : '1',
            atributos: v.atributos ?? {},
          })),
        );
    }
    if (dto.combo) {
      await this.db
        .delete(produtoComboItem)
        .where(eq(produtoComboItem.comboProdutoId, id));
      if (dto.combo.length)
        await this.db.insert(produtoComboItem).values(
          dto.combo.map((c) => ({
            tenantId,
            comboProdutoId: id,
            componenteProdutoId: c.componenteProdutoId,
            quantidade: c.quantidade != null ? String(c.quantidade) : '1',
          })),
        );
    }
    if (dto.sugestoes !== undefined) await this.setSugestoes(tenantId, id, dto.sugestoes);
    return row;
  }

  async remover(tenantId: string, id: string) {
    const [row] = await this.db
      .update(produto)
      .set({ deletedAt: new Date() })
      .where(and(eq(produto.id, id), eq(produto.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Produto não encontrado');
    return { ok: true };
  }
}
