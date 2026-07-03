import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  produto,
  produtoVariacao,
  produtoComboItem,
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
             p.ativo, p.categoria_id as "categoriaId", p.ficha_id as "fichaId",
             p.setor_producao_id as "setorProducaoId",
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
    return { ...p, variacoes, combo };
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
