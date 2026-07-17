import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  complemento,
  complementoItem,
  produtoComplemento,
  opcao,
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

  async criarCategoria(tenantId: string, dto: CreateCategoriaDto & { descricao?: string; imagemRef?: string; disponibilidade?: any }) {
    // Nova categoria entra no fim da ordem (fallback = ordem de cadastro).
    const r: any = await this.db.execute(sql`
      select coalesce(max(ordem), -1) + 1 as prox from categoria_produto where tenant_id = ${tenantId}
    `);
    const prox = Number((r.rows ?? r)[0]?.prox ?? 0);
    const [row] = await this.db
      .insert(categoriaProduto)
      .values({
        tenantId,
        nome: dto.nome,
        parentId: dto.parentId,
        descricao: dto.descricao ?? null,
        imagemRef: dto.imagemRef ?? null,
        disponibilidade: this.sanitizarDisponibilidade(dto.disponibilidade),
        ordem: dto.ordem ?? prox,
      })
      .returning();
    return row;
  }

  // Normaliza as janelas de disponibilidade: [{ dias:[0..6], inicio:'HH:MM', fim:'HH:MM' }].
  private sanitizarDisponibilidade(v: any): any {
    if (!Array.isArray(v)) return [];
    const hhmm = (s: any) => (/^\d{2}:\d{2}$/.test(String(s)) ? String(s) : null);
    return v
      .map((j: any) => ({
        dias: Array.isArray(j?.dias) ? j.dias.map((d: any) => Number(d)).filter((d: number) => d >= 0 && d <= 6) : [],
        inicio: hhmm(j?.inicio) ?? '00:00',
        fim: hhmm(j?.fim) ?? '23:59',
      }))
      .filter((j: any) => j.dias.length > 0);
  }

  async atualizarCategoria(tenantId: string, id: string, dto: any) {
    const set: any = {};
    if (dto.nome != null) set.nome = dto.nome;
    if (dto.descricao !== undefined) set.descricao = dto.descricao || null;
    if (dto.imagemRef !== undefined) set.imagemRef = dto.imagemRef || null;
    if (dto.disponibilidade !== undefined) set.disponibilidade = this.sanitizarDisponibilidade(dto.disponibilidade);
    if (dto.ativo != null) set.ativo = !!dto.ativo;
    if (dto.parentId !== undefined) set.parentId = dto.parentId || null;
    const [row] = await this.db
      .update(categoriaProduto)
      .set(set)
      .where(and(eq(categoriaProduto.id, id), eq(categoriaProduto.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Categoria não encontrada');
    return row;
  }

  // Reordena por arrastar: aplica a ordem conforme a posição na lista de ids.
  async reordenarCategorias(tenantId: string, ids: string[]) {
    for (let i = 0; i < ids.length; i++) {
      await this.db
        .update(categoriaProduto)
        .set({ ordem: i })
        .where(and(eq(categoriaProduto.id, ids[i]), eq(categoriaProduto.tenantId, tenantId)));
    }
    return { ok: true };
  }

  async excluirCategoria(tenantId: string, id: string) {
    // Solta os produtos da categoria (não apaga os produtos) e remove a categoria.
    await this.db.execute(sql`
      update produto set categoria_id = null where tenant_id = ${tenantId} and categoria_id = ${id}
    `);
    await this.db
      .delete(categoriaProduto)
      .where(and(eq(categoriaProduto.id, id), eq(categoriaProduto.tenantId, tenantId)));
    return { ok: true };
  }

  // ----- Opções (catálogo reutilizável, Fase 2) -----
  async listarOpcoes(tenantId: string) {
    // Traz a opção + nome da ficha/insumo ligado (para exibir o tipo com clareza).
    const res: any = await this.db.execute(sql`
      select o.id, o.nome, o.codigo_pdv as "codigoPdv", o.descricao,
             o.imagem_ref as "imagemRef", o.tipo, o.preco_custo as "precoCusto",
             o.controla_estoque as "controlaEstoque", o.ficha_id as "fichaId",
             o.item_id as "itemId", o.produto_ref_id as "produtoRefId",
             o.ativo, o.esgotado,
             f.nome as "fichaNome", i.nome as "itemNome",
             (select count(*)::int from complemento_item ci where ci.opcao_id = o.id) as "usado"
      from opcao o
      left join ficha_tecnica f on f.id = o.ficha_id
      left join item_estoque i on i.id = o.item_id
      where o.tenant_id = ${tenantId}
      order by o.nome
    `);
    return res.rows ?? res;
  }

  // ----- Complementos (etapas reutilizáveis, Fase 3) -----
  async listarComplementos(tenantId: string) {
    const res: any = await this.db.execute(sql`
      select c.id, c.nome, c.regra, c.obrigatorio, c.min, c.max, c.canais, c.ativo,
             coalesce(json_agg(
               json_build_object('opcaoId', ci.opcao_id, 'preco', ci.preco, 'ordem', ci.ordem, 'nome', o.nome)
               order by ci.ordem
             ) filter (where ci.id is not null), '[]') as itens
      from complemento c
      left join complemento_item ci on ci.complemento_id = c.id
      left join opcao o on o.id = ci.opcao_id
      where c.tenant_id = ${tenantId}
      group by c.id
      order by c.nome
    `);
    return res.rows ?? res;
  }

  private complementoVals(dto: any) {
    const regra = ['uma', 'varias_sem_repeticao', 'varias_com_repeticao'].includes(dto?.regra) ? dto.regra : 'uma';
    const obrigatorio = !!dto?.obrigatorio;
    // 'uma' = radio (máx 1). Vários = min/max configuráveis.
    const max = regra === 'uma' ? 1 : dto?.max != null && dto.max !== '' ? Number(dto.max) : null;
    const min = regra === 'uma' ? (obrigatorio ? 1 : 0) : Math.max(obrigatorio ? 1 : 0, Number(dto?.min) || 0);
    const canaisOk = ['delivery', 'balcao', 'mesa_publico', 'mesa_interno'];
    const canais = Array.isArray(dto?.canais) ? dto.canais.filter((x: any) => canaisOk.includes(x)) : canaisOk;
    return {
      nome: String(dto?.nome ?? '').trim(),
      regra,
      obrigatorio,
      min,
      max,
      canais,
      ativo: dto?.ativo != null ? !!dto.ativo : true,
    };
  }

  private async salvarItensComplemento(tenantId: string, complementoId: string, itens: any[]) {
    await this.db.delete(complementoItem).where(eq(complementoItem.complementoId, complementoId));
    const validos = (itens ?? []).filter((it) => it?.opcaoId);
    if (validos.length) {
      await this.db.insert(complementoItem).values(
        validos.map((it, i) => ({
          tenantId,
          complementoId,
          opcaoId: it.opcaoId,
          preco: it.preco != null && it.preco !== '' ? String(Number(it.preco) || 0) : '0',
          ordem: it.ordem != null ? Number(it.ordem) : i,
        })),
      );
    }
  }

  async criarComplemento(tenantId: string, dto: any) {
    const vals = this.complementoVals(dto);
    if (!vals.nome) throw new NotFoundException('Informe o nome do complemento.');
    const [row] = await this.db.insert(complemento).values({ tenantId, ...vals }).returning();
    await this.salvarItensComplemento(tenantId, row.id, dto?.itens ?? []);
    return row;
  }

  async atualizarComplemento(tenantId: string, id: string, dto: any) {
    const vals = this.complementoVals(dto);
    const [row] = await this.db
      .update(complemento)
      .set({ ...vals, updatedAt: new Date() })
      .where(and(eq(complemento.id, id), eq(complemento.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Complemento não encontrado');
    if (dto?.itens !== undefined) await this.salvarItensComplemento(tenantId, id, dto.itens);
    // Propaga para os produtos que usam este complemento (materialização de verdade).
    await this.reMaterializarPorComplemento(tenantId, id);
    return row;
  }

  async excluirComplemento(tenantId: string, id: string) {
    // Materializado sai dos produtos que usavam este complemento.
    const alvos = await this.db
      .select({ produtoId: produtoComplemento.produtoId })
      .from(produtoComplemento)
      .where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.complementoId, id)));
    await this.db.delete(produtoComplemento).where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.complementoId, id)));
    // complemento_item cai por cascade (FK on delete cascade).
    await this.db.delete(complemento).where(and(eq(complemento.id, id), eq(complemento.tenantId, tenantId)));
    for (const a of alvos) await this.materializarProduto(tenantId, a.produtoId);
    return { ok: true };
  }

  // ----- Produto ↔ complementos (etapas) + materialização (Fase 4) -----
  // A materialização regenera os grupos/opções do MOTOR (complemento_grupo/opcao)
  // a partir dos complementos reutilizáveis ligados ao produto. Só mexe nos grupos
  // com `origem_complemento_id` (os manuais do editor antigo ficam intactos).
  async materializarProduto(tenantId: string, produtoId: string) {
    // 1) Remove os grupos materializados anteriores (e suas opções).
    const antigos = await this.db
      .select({ id: complementoGrupo.id })
      .from(complementoGrupo)
      .where(
        and(
          eq(complementoGrupo.tenantId, tenantId),
          eq(complementoGrupo.produtoId, produtoId),
          isNotNull(complementoGrupo.origemComplementoId),
        ),
      );
    for (const g of antigos) {
      await this.db.delete(complementoOpcao).where(eq(complementoOpcao.grupoId, g.id));
      await this.db.delete(complementoGrupo).where(eq(complementoGrupo.id, g.id));
    }

    // 2) Recria a partir dos complementos ligados (na ordem definida).
    const ligados = await this.db
      .select({ complementoId: produtoComplemento.complementoId, ordem: produtoComplemento.ordem })
      .from(produtoComplemento)
      .where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.produtoId, produtoId)))
      .orderBy(produtoComplemento.ordem);

    for (const [i, lig] of ligados.entries()) {
      const [comp] = await this.db
        .select()
        .from(complemento)
        .where(and(eq(complemento.id, lig.complementoId), eq(complemento.tenantId, tenantId)));
      if (!comp || comp.ativo === false) continue;
      const [g] = await this.db
        .insert(complementoGrupo)
        .values({
          tenantId,
          produtoId,
          nome: comp.nome,
          tipo: 'adicionar', // etapa de escolha/adição (motor)
          min: comp.min ?? 0,
          max: comp.max ?? null,
          obrigatorio: comp.obrigatorio ?? false,
          ordem: i,
          origemComplementoId: comp.id,
        })
        .returning();
      // Opções ligadas ao complemento → opções do grupo (com o link de estoque da opção).
      const itens = await this.db
        .select({
          preco: complementoItem.preco,
          ordem: complementoItem.ordem,
          opcaoId: opcao.id,
          nome: opcao.nome,
          tipo: opcao.tipo,
          fichaId: opcao.fichaId,
          itemId: opcao.itemId,
          produtoRefId: opcao.produtoRefId,
        })
        .from(complementoItem)
        .innerJoin(opcao, eq(opcao.id, complementoItem.opcaoId))
        .where(eq(complementoItem.complementoId, comp.id))
        .orderBy(complementoItem.ordem);
      for (const [j, it] of itens.entries()) {
        await this.db.insert(complementoOpcao).values({
          tenantId,
          grupoId: g.id,
          nome: it.nome,
          precoDelta: it.preco != null ? String(it.preco) : '0',
          // Link de baixa por tipo de opção: insumo→item; simples/ficha→produto (se houver).
          itemId: it.tipo === 'insumo' ? it.itemId ?? null : null,
          produtoRefId: it.tipo !== 'insumo' ? it.produtoRefId ?? null : null,
          quantidade: '1',
          ordem: j,
          origemOpcaoId: it.opcaoId,
        });
      }
    }
    return { ok: true };
  }

  async getProdutoComplementos(tenantId: string, produtoId: string) {
    return this.db
      .select({ complementoId: produtoComplemento.complementoId, ordem: produtoComplemento.ordem })
      .from(produtoComplemento)
      .where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.produtoId, produtoId)))
      .orderBy(produtoComplemento.ordem);
  }

  async setProdutoComplementos(tenantId: string, produtoId: string, ids: string[]) {
    await this.db.delete(produtoComplemento).where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.produtoId, produtoId)));
    const lista = (ids ?? []).filter(Boolean);
    if (lista.length) {
      await this.db.insert(produtoComplemento).values(
        lista.map((complementoId, i) => ({ tenantId, produtoId, complementoId, ordem: i })),
      );
    }
    await this.materializarProduto(tenantId, produtoId);
    return { ok: true };
  }

  // Reaplica a materialização em todos os produtos que usam um complemento.
  private async reMaterializarPorComplemento(tenantId: string, complementoId: string) {
    const alvos = await this.db
      .select({ produtoId: produtoComplemento.produtoId })
      .from(produtoComplemento)
      .where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.complementoId, complementoId)));
    for (const a of alvos) await this.materializarProduto(tenantId, a.produtoId);
  }

  // Reaplica em todos os produtos cujos complementos usam uma opção.
  private async reMaterializarPorOpcao(tenantId: string, opcaoId: string) {
    const comps = await this.db
      .select({ complementoId: complementoItem.complementoId })
      .from(complementoItem)
      .where(and(eq(complementoItem.tenantId, tenantId), eq(complementoItem.opcaoId, opcaoId)));
    const vistos = new Set<string>();
    for (const c of comps) {
      if (vistos.has(c.complementoId)) continue;
      vistos.add(c.complementoId);
      await this.reMaterializarPorComplemento(tenantId, c.complementoId);
    }
  }

  private opcaoVals(dto: any) {
    const tipo = ['simples', 'ficha', 'insumo'].includes(dto?.tipo) ? dto.tipo : 'simples';
    return {
      nome: String(dto?.nome ?? '').trim(),
      codigoPdv: dto?.codigoPdv?.trim() || null,
      descricao: dto?.descricao?.trim() || null,
      imagemRef: dto?.imagemRef || null,
      tipo,
      precoCusto: dto?.precoCusto != null && dto.precoCusto !== '' ? String(Number(dto.precoCusto) || 0) : '0',
      controlaEstoque: !!dto?.controlaEstoque,
      // Só guarda a referência do tipo escolhido (evita lixo dos outros tipos).
      fichaId: tipo === 'ficha' ? dto?.fichaId || null : null,
      itemId: tipo === 'insumo' ? dto?.itemId || null : null,
      produtoRefId: tipo === 'simples' ? dto?.produtoRefId || null : null,
      ativo: dto?.ativo != null ? !!dto.ativo : true,
      esgotado: dto?.esgotado != null ? !!dto.esgotado : false,
    };
  }

  async criarOpcaoCatalogo(tenantId: string, dto: any) {
    const vals = this.opcaoVals(dto);
    if (!vals.nome) throw new NotFoundException('Informe o nome da opção.');
    const [row] = await this.db.insert(opcao).values({ tenantId, ...vals }).returning();
    return row;
  }

  async atualizarOpcao(tenantId: string, id: string, dto: any) {
    const vals = this.opcaoVals(dto);
    const [row] = await this.db
      .update(opcao)
      .set({ ...vals, updatedAt: new Date() })
      .where(and(eq(opcao.id, id), eq(opcao.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Opção não encontrada');
    // Nome/preço-custo/estoque da opção mudou → repropaga aos produtos afetados.
    await this.reMaterializarPorOpcao(tenantId, id);
    return row;
  }

  async excluirOpcao(tenantId: string, id: string) {
    await this.db.delete(opcao).where(and(eq(opcao.id, id), eq(opcao.tenantId, tenantId)));
    return { ok: true };
  }

  // ----- Produtos -----
  async listar(tenantId: string) {
    const res: any = await this.db.execute(sql`
      select p.id, p.codigo, p.nome, p.descricao, p.tipo,
             p.unidade_medida as "unidadeMedida", p.preco_venda as "precoVenda",
             p.preco_custo as "precoCusto", p.controla_estoque as "controlaEstoque",
             p.validade_dias as "validadeDias", p.vai_para_producao as "vaiParaProducao",
             p.disponivel_cardapio as "disponivelCardapio",
             p.pausado_estoque as "pausadoEstoque", p.pausa_motivo as "pausaMotivo",
             p.permite_negativo as "permiteNegativo",
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
  // Reativa um produto esgotado SEM dar entrada no estoque: liga "permite negativo"
  // (não bloqueia mais por saldo — contagem negativa) e o tira da pausa. Desmarcar
  // (ativo=false) volta ao controle normal. O controle de estoque (baixa) continua,
  // por isso o saldo do insumo fica negativo (informativo).
  async permiteNegativo(tenantId: string, id: string, ativo: boolean) {
    const patch: Record<string, unknown> = { permiteNegativo: ativo, updatedAt: new Date() };
    if (ativo) {
      patch.pausadoEstoque = false;
      patch.pausaMotivo = null;
      patch.disponivelCardapio = true;
    }
    const [row] = await this.db
      .update(produto)
      .set(patch)
      .where(and(eq(produto.id, id), eq(produto.tenantId, tenantId)))
      .returning({ id: produto.id });
    if (!row) throw new NotFoundException('Produto não encontrado');
    return { ok: true, permiteNegativo: ativo };
  }

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
