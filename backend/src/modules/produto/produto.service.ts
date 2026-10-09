import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';
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
  complementoDestinoProducao,
  opcaoDestinoProducao,
  produtoDestinoProducao,
  equipamento,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EdgeFlashSyncService } from '../sync/edge-flash-sync.service';
import { lojasAtivas, pausasPorProduto } from '../../common/pausa-loja';
import { FichasService } from '../fichas/fichas.service';
import { arredondarEstoque, fatorParaEstoque, unidadesDoProduto } from '../../common/conversao-unidade';
import { CreateCategoriaDto } from './dto/create-categoria.dto';
import { CreateProdutoDto } from './dto/create-produto.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class ProdutoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly flash: EdgeFlashSyncService,
    private readonly fichas: FichasService,
  ) {}

  // ----- Ligação direta com um produto do estoque (mig 309) -----
  // "Na hora de ligar é só perguntar se vai calcular valor unitário ou do fardo" (dono,
  // 08/10/2026). A unidade escolhida tem de ser a do estoque ou uma das conversões do cadastro
  // dele; devolve o que GRAVAR: a unidade (null = a do estoque) e o fator — quanto da unidade do
  // estoque vale 1 da escolhida (fardo de 12, por unidade → 1/12).
  private async vinculoComEstoque(
    tenantId: string,
    itemId: string | null | undefined,
    unidade: string | null | undefined,
  ): Promise<{ unidade: string | null; fator: number }> {
    const escolhida = String(unidade ?? '').trim();
    if (!itemId || !escolhida) return { unidade: null, fator: 1 };
    const u = (await this.fichas.unidadesDosItens(tenantId, [itemId])).get(itemId);
    if (!u) throw new BadRequestException('Produto do estoque não encontrado.');
    const fator = fatorParaEstoque(escolhida, u.unidade, u.conversoes);
    if (fator == null) {
      const validas = unidadesDoProduto(u.unidade, u.conversoes).map((x) => x.unidade).join(' ou ');
      throw new BadRequestException(
        `"${escolhida}" não é uma unidade deste produto do estoque. Escolha ${validas}.`,
      );
    }
    if (fator === 1) return { unidade: null, fator: 1 }; // a própria unidade do estoque
    return { unidade: escolhida, fator: arredondarEstoque(fator) };
  }

  // ----- Categorias (hierárquicas) -----
  listarCategorias(tenantId: string) {
    return this.db
      .select()
      .from(categoriaProduto)
      .where(and(eq(categoriaProduto.tenantId, tenantId), isNull(categoriaProduto.deletedAt)));
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
    set.updatedAt = new Date(); // LWW p/ o sync bidirecional (P3)
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
    const agora = new Date();
    for (let i = 0; i < ids.length; i++) {
      await this.db
        .update(categoriaProduto)
        .set({ ordem: i, updatedAt: agora }) // updatedAt p/ a reordenação subir no sync (P3)
        .where(and(eq(categoriaProduto.id, ids[i]), eq(categoriaProduto.tenantId, tenantId)));
    }
    return { ok: true };
  }

  async excluirCategoria(tenantId: string, id: string) {
    // Solta os produtos da categoria (não apaga os produtos) e remove a categoria.
    await this.db.execute(sql`
      update produto set categoria_id = null, updated_at = now() where tenant_id = ${tenantId} and categoria_id = ${id}
    `);
    // Soft-delete p/ a exclusão propagar ao edge/nuvem pelo sync (P3).
    await this.db
      .update(categoriaProduto)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(categoriaProduto.id, id), eq(categoriaProduto.tenantId, tenantId)));
    return { ok: true };
  }

  // ----- Opções (catálogo reutilizável, Fase 2) -----
  // veCustoDaFicha: quem pede pode ver custo de ficha técnica (a mesma regra de GET /fichas).
  // veFinanceiro: quem pede pode ver custo de estoque (a mesma regra do custo do produto).
  async listarOpcoes(tenantId: string, veCustoDaFicha = false, veFinanceiro = false) {
    // Traz a opção + nome da ficha/insumo ligado (para exibir o tipo com clareza).
    const res: any = await this.db.execute(sql`
      select o.id, o.nome, o.codigo_pdv as "codigoPdv", o.descricao,
             o.imagem_ref as "imagemRef", o.tipo, o.preco_custo as "precoCusto",
             o.controla_estoque as "controlaEstoque", o.ficha_id as "fichaId",
             o.item_id as "itemId", o.produto_ref_id as "produtoRefId",
             o.item_unidade as "itemUnidade", i.unidade_medida as "itemUnidadeEstoque",
             i.custo_medio as "itemCustoMedio",
             o.padrao_marcada as "padraoMarcada", o.ativo, o.esgotado,
             f.nome as "fichaNome", i.nome as "itemNome",
             (select count(*)::int from complemento_item ci where ci.opcao_id = o.id and ci.deleted_at is null) as "usado"
      from opcao o
      -- Ficha EXCLUÍDA não conta como vínculo: ela não baixa estoque na venda (acumularFicha),
      -- então a tela não pode mostrar o adicional como ligado a ela.
      left join ficha_tecnica f on f.id = o.ficha_id and f.deleted_at is null
      left join item_estoque i on i.id = o.item_id
      where o.tenant_id = ${tenantId} and o.deleted_at is null
      order by o.nome
    `);
    const rows = (res.rows ?? res) as any[];
    // "A ficha é o custo" (dono, 08/10/2026): o adicional ligado a uma ficha técnica custa o
    // que UMA porção dela custa — é essa porção que a venda baixa do estoque. O "preço de
    // custo" digitado segue valendo para as opções sem ficha.
    const temFicha = rows.some((o) => o.tipo === 'ficha' && o.fichaNome);
    const custoDaFicha = veCustoDaFicha && temFicha ? await this.fichas.custoPorPorcao(tenantId) : {};
    // Adicional ligado DIRETO a um insumo: o que sai do estoque a cada escolha é 1 da unidade
    // escolhida na ligação (`itemFator` unidades de estoque) e o custo é o custo médio × o fator.
    const insumos = rows.filter((o) => o.tipo === 'insumo' && o.itemId);
    const unidades = insumos.length
      ? await this.fichas.unidadesDosItens(tenantId, insumos.map((o) => o.itemId))
      : new Map<string, { unidade: string; conversoes: any[] }>();
    return rows.map((o) => {
      const c = o.tipo === 'ficha' && o.fichaNome ? custoDaFicha[o.fichaId] : undefined;
      const u = o.tipo === 'insumo' && o.itemId ? unidades.get(o.itemId) : undefined;
      const itemFator = u ? fatorParaEstoque(o.itemUnidade, u.unidade, u.conversoes) ?? 1 : null;
      const medio = o.itemCustoMedio != null ? Number(o.itemCustoMedio) : null;
      const { itemCustoMedio: _fora, ...resto } = o; // o custo médio cru não sai daqui
      void _fora;
      return {
        ...resto,
        // O "preço de custo" digitado é valor em R$: só para quem vê valores (ERR-162).
        precoCusto: veFinanceiro ? resto.precoCusto : null,
        // null = sem ficha ligada, ou quem pede não vê custo de ficha. Em centavos, como o
        // "custo por porção" da tela de fichas — o mesmo número nos dois lugares.
        custoFicha: c ? Number(c.balcao.toFixed(2)) : null,
        itemFator,
        // null = sem insumo ligado, ou quem pede não vê valores.
        custoItem: veFinanceiro && itemFator != null && medio != null ? Number((medio * itemFator).toFixed(4)) : null,
      };
    });
  }

  // ----- Complementos (etapas reutilizáveis, Fase 3) -----
  async listarComplementos(tenantId: string) {
    const res: any = await this.db.execute(sql`
      select c.id, c.nome, c.regra, c.obrigatorio, c.min, c.max, c.canais, c.ativo,
             c.imprime_etiqueta as "imprimeEtiqueta",
             coalesce(json_agg(
               json_build_object('opcaoId', ci.opcao_id, 'preco', ci.preco, 'ordem', ci.ordem,
                                 'padraoMarcada', ci.padrao_marcada, 'nome', o.nome,
                                 'codigoPdv', o.codigo_pdv)
               order by ci.ordem
             ) filter (where ci.id is not null), '[]') as itens
      from complemento c
      left join complemento_item ci on ci.complemento_id = c.id and ci.deleted_at is null
      left join opcao o on o.id = ci.opcao_id
      where c.tenant_id = ${tenantId} and c.deleted_at is null
      group by c.id
      order by c.nome
    `);
    return res.rows ?? res;
  }

  // Fingerprint de um grupo p/ dedup "idêntico": nome + min/max/obrig + conjunto de
  // opções (nome:preço:código), ordenado → insensível à ordem das opções.
  private fpGrupo(
    nome: string,
    min: number | null,
    max: number | null,
    obrig: boolean,
    ops: { nome: any; codigo: any; preco: any }[],
  ) {
    const n = (s: any) => String(s ?? '').trim().toLowerCase();
    const opsFp = ops
      .map((o) => `${n(o.nome)}:${(Number(o.preco) || 0).toFixed(2)}:${n(o.codigo)}`)
      .sort()
      .join('|');
    return `${n(nome)}#${min ?? 0}#${max ?? ''}#${obrig ? 1 : 0}#${opsFp}`;
  }

  // Sobe os complementos que vieram DIRETO no motor (complemento_grupo com
  // origem_complemento_id nulo — imports Anota Aí/Cardápio Web e o editor antigo do
  // produto) para o CATÁLOGO reutilizável (complemento/opcao/complemento_item), com
  // dedup por conteúdo idêntico, e "adota" o grupo do motor (carimba a origem) para
  // que apareça na aba Complementos e vire reutilizável — sem duplicar pro cliente.
  // Idempotente: rodar 2× não recria nada (os já adotados saem do filtro origem-nula).
  async promoverComplementosParaCatalogo(tenantId: string) {
    const n = (s: any) => String(s ?? '').trim().toLowerCase();
    const opcaoKey = (nome: any, codigo: any) => `${n(nome)}|${n(codigo)}`;

    // dedup de opção (aba Opções) por (nome, código) — pré-carrega o catálogo atual.
    const opcaoMap = new Map<string, string>();
    for (const o of await this.db
      .select({ id: opcao.id, nome: opcao.nome, codigoPdv: opcao.codigoPdv })
      .from(opcao)
      .where(and(eq(opcao.tenantId, tenantId), isNull(opcao.deletedAt)))) {
      opcaoMap.set(opcaoKey(o.nome, o.codigoPdv), o.id);
    }

    // dedup de complemento (grupo) por fingerprint — pré-carrega o catálogo atual.
    const compMap = new Map<string, string>();
    const catComps = await this.db
      .select()
      .from(complemento)
      .where(and(eq(complemento.tenantId, tenantId), isNull(complemento.deletedAt)));
    for (const c of catComps) {
      const its = await this.db
        .select({ nome: opcao.nome, codigoPdv: opcao.codigoPdv, preco: complementoItem.preco })
        .from(complementoItem)
        .innerJoin(opcao, eq(opcao.id, complementoItem.opcaoId))
        .where(and(eq(complementoItem.complementoId, c.id), isNull(complementoItem.deletedAt)));
      const fp = this.fpGrupo(c.nome, c.min, c.max, c.obrigatorio, its.map((x) => ({ nome: x.nome, codigo: x.codigoPdv, preco: x.preco })));
      if (!compMap.has(fp)) compMap.set(fp, c.id);
    }

    // grupos do motor ainda "soltos" (não materializados de nenhum complemento).
    const grupos = await this.db
      .select()
      .from(complementoGrupo)
      .where(and(eq(complementoGrupo.tenantId, tenantId), isNull(complementoGrupo.origemComplementoId), isNull(complementoGrupo.deletedAt)))
      .orderBy(complementoGrupo.produtoId, complementoGrupo.ordem);

    let criados = 0;
    let reusados = 0;
    let vinculados = 0;
    for (const g of grupos) {
      const ops = await this.db
        .select()
        .from(complementoOpcao)
        .where(and(eq(complementoOpcao.grupoId, g.id), isNull(complementoOpcao.deletedAt)))
        .orderBy(complementoOpcao.ordem);
      const fp = this.fpGrupo(g.nome, g.min, g.max, g.obrigatorio, ops.map((o) => ({ nome: o.nome, codigo: o.codigoPdv, preco: o.precoDelta })));

      let compId = compMap.get(fp);
      if (!compId) {
        const regra = g.max === 1 ? 'uma' : 'varias_sem_repeticao';
        const [novo] = await this.db
          .insert(complemento)
          .values({ tenantId, nome: g.nome, regra, obrigatorio: g.obrigatorio, min: g.min ?? 0, max: g.max ?? null })
          .returning();
        compId = novo.id;
        for (const [i, o] of ops.entries()) {
          const k = opcaoKey(o.nome, o.codigoPdv);
          let opId = opcaoMap.get(k);
          if (!opId) {
            const [no] = await this.db
              .insert(opcao)
              .values({
                tenantId,
                nome: o.nome,
                codigoPdv: o.codigoPdv ?? null,
                controlaEstoque: o.controlaEstoque ?? false,
                itemId: o.itemId ?? null,
                produtoRefId: o.produtoRefId ?? null,
                padraoMarcada: o.padraoMarcada ?? false,
              })
              .returning();
            opId = no.id;
            opcaoMap.set(k, opId);
          }
          await this.db.insert(complementoItem).values({
            tenantId,
            complementoId: compId,
            opcaoId: opId,
            preco: String(o.precoDelta ?? '0'),
            padraoMarcada: o.padraoMarcada ?? false,
            ordem: i,
          });
        }
        compMap.set(fp, compId);
        criados++;
      } else {
        reusados++;
      }

      // vincula produto ↔ complemento (se ainda não vinculado).
      const jaLig = await this.db
        .select({ id: produtoComplemento.id })
        .from(produtoComplemento)
        .where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.produtoId, g.produtoId), eq(produtoComplemento.complementoId, compId), isNull(produtoComplemento.deletedAt)));
      if (!jaLig.length) {
        await this.db.insert(produtoComplemento).values({ tenantId, produtoId: g.produtoId, complementoId: compId, ordem: g.ordem ?? 0 });
        vinculados++;
      }

      // adota o grupo do motor: agora é a materialização deste complemento (evita
      // recriar/duplicar) e carimba a origem nas opções p/ re-materialização coerente.
      const agora = new Date();
      await this.db.update(complementoGrupo).set({ origemComplementoId: compId, updatedAt: agora }).where(eq(complementoGrupo.id, g.id));
      for (const o of ops) {
        const opId = opcaoMap.get(opcaoKey(o.nome, o.codigoPdv));
        if (opId) await this.db.update(complementoOpcao).set({ origemOpcaoId: opId, updatedAt: agora }).where(eq(complementoOpcao.id, o.id));
      }
    }
    return { gruposProcessados: grupos.length, complementosCriados: criados, complementosReusados: reusados, produtosVinculados: vinculados };
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
      imprimeEtiqueta: !!dto?.imprimeEtiqueta, // gera etiqueta do item (mig 168, Fase 5)
    };
  }

  private async salvarItensComplemento(tenantId: string, complementoId: string, itens: any[]) {
    // Soft-delete dos itens antigos (a exclusão precisa propagar pelo sync — P3).
    await this.db
      .update(complementoItem)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(complementoItem.complementoId, complementoId), isNull(complementoItem.deletedAt)));
    const validos = (itens ?? []).filter((it) => it?.opcaoId);
    if (validos.length) {
      await this.db.insert(complementoItem).values(
        validos.map((it, i) => ({
          tenantId,
          complementoId,
          opcaoId: it.opcaoId,
          preco: it.preco != null && it.preco !== '' ? String(Number(it.preco) || 0) : '0',
          padraoMarcada: !!it.padraoMarcada, // pré-marcada nesta etapa (mig 126)
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
      .where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.complementoId, id), isNull(produtoComplemento.deletedAt)));
    const agora = new Date();
    // Soft-delete em cascata manual (o sync só propaga exclusão por deleted_at — P3):
    // ligação produto↔complemento, os itens do complemento e o próprio complemento.
    await this.db
      .update(produtoComplemento)
      .set({ deletedAt: agora, updatedAt: agora })
      .where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.complementoId, id)));
    await this.db
      .update(complementoItem)
      .set({ deletedAt: agora, updatedAt: agora })
      .where(and(eq(complementoItem.tenantId, tenantId), eq(complementoItem.complementoId, id)));
    await this.db
      .update(complemento)
      .set({ deletedAt: agora, updatedAt: agora })
      .where(and(eq(complemento.id, id), eq(complemento.tenantId, tenantId)));
    for (const a of alvos) await this.materializarProduto(tenantId, a.produtoId);
    return { ok: true };
  }

  // ----- Produto ↔ complementos (etapas) + materialização (Fase 4) -----
  // A materialização regenera os grupos/opções do MOTOR (complemento_grupo/opcao)
  // a partir dos complementos reutilizáveis ligados ao produto. Só mexe nos grupos
  // com `origem_complemento_id` (os manuais do editor antigo ficam intactos).
  async materializarProduto(tenantId: string, produtoId: string) {
    // 1) Soft-delete dos grupos materializados anteriores (e opções) — soft para a
    //    remoção/regeração propagar ao EDGE pelo sync (deleted_at). Recriados abaixo.
    const agora = new Date();
    const antigos = await this.db
      .select({ id: complementoGrupo.id })
      .from(complementoGrupo)
      .where(
        and(
          eq(complementoGrupo.tenantId, tenantId),
          eq(complementoGrupo.produtoId, produtoId),
          isNotNull(complementoGrupo.origemComplementoId),
          isNull(complementoGrupo.deletedAt),
        ),
      );
    for (const g of antigos) {
      // updatedAt junto: o push edge→nuvem usa updated_at como cursor (P3).
      await this.db.update(complementoOpcao).set({ deletedAt: agora, updatedAt: agora }).where(eq(complementoOpcao.grupoId, g.id));
      await this.db.update(complementoGrupo).set({ deletedAt: agora, updatedAt: agora }).where(eq(complementoGrupo.id, g.id));
    }

    // 2) Recria a partir dos complementos ligados (na ordem definida).
    const ligados = await this.db
      .select({ complementoId: produtoComplemento.complementoId, ordem: produtoComplemento.ordem })
      .from(produtoComplemento)
      .where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.produtoId, produtoId), isNull(produtoComplemento.deletedAt)))
      .orderBy(produtoComplemento.ordem);

    for (const [i, lig] of ligados.entries()) {
      const [comp] = await this.db
        .select()
        .from(complemento)
        .where(and(eq(complemento.id, lig.complementoId), eq(complemento.tenantId, tenantId), isNull(complemento.deletedAt)));
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
          padraoItem: complementoItem.padraoMarcada,
          opcaoId: opcao.id,
          nome: opcao.nome,
          tipo: opcao.tipo,
          fichaId: opcao.fichaId,
          itemId: opcao.itemId,
          itemUnidade: opcao.itemUnidade,
          produtoRefId: opcao.produtoRefId,
          codigoPdv: opcao.codigoPdv,
          controlaEstoque: opcao.controlaEstoque,
          padraoOpcao: opcao.padraoMarcada,
        })
        .from(complementoItem)
        .innerJoin(opcao, eq(opcao.id, complementoItem.opcaoId))
        .where(and(eq(complementoItem.complementoId, comp.id), isNull(complementoItem.deletedAt), isNull(opcao.deletedAt)))
        .orderBy(complementoItem.ordem);
      // Unidade e conversões dos insumos ligados: a quantidade que sai do estoque é gravada na
      // unidade DELE (mig 309) — 1 unidade de um bacon em kg (1 kg = 72) = 0,01389 kg.
      const unidadesDosInsumos = await this.fichas.unidadesDosItens(
        tenantId,
        itens.map((it) => (it.tipo === 'insumo' ? it.itemId : null)),
      );
      for (const [j, it] of itens.entries()) {
        // mig 126 — discriminador: SEM código PDV a opção é INFORMATIVA (observação:
        // "ponto de carne", "talheres"): não baixa estoque, não soma preço e não
        // carrega link de estoque. COM código PDV é item real.
        const informativa = !(it.codigoPdv ?? '').trim();
        await this.db.insert(complementoOpcao).values({
          tenantId,
          grupoId: g.id,
          nome: it.nome,
          precoDelta: informativa ? '0' : it.preco != null ? String(it.preco) : '0',
          // Link de baixa por tipo de opção: insumo→item; simples/ficha→produto (se houver).
          itemId: informativa ? null : it.tipo === 'insumo' ? it.itemId ?? null : null,
          produtoRefId: informativa ? null : it.tipo !== 'insumo' ? it.produtoRefId ?? null : null,
          quantidade: String(this.quantidadeDoInsumo(it, unidadesDosInsumos)),
          codigoPdv: informativa ? null : it.codigoPdv,
          controlaEstoque: informativa ? false : !!it.controlaEstoque,
          // Pré-marcada: o item da etapa manda; se não, o padrão da própria opção.
          padraoMarcada: !!(it.padraoItem || it.padraoOpcao),
          ordem: j,
          origemOpcaoId: it.opcaoId,
        });
      }
    }
    return { ok: true };
  }

  // Quanto da unidade do ESTOQUE sai a cada vez que a opção é escolhida. Sem insumo ligado, sem
  // unidade escolhida ou com unidade que o insumo não tem mais: 1 (o comportamento de sempre).
  private quantidadeDoInsumo(
    it: { tipo: string; itemId: string | null; itemUnidade: string | null },
    unidades: Map<string, { unidade: string; conversoes: any[] }>,
  ): number {
    if (it.tipo !== 'insumo' || !it.itemId || !it.itemUnidade) return 1;
    const u = unidades.get(it.itemId);
    const fator = u ? fatorParaEstoque(it.itemUnidade, u.unidade, u.conversoes) : null;
    return fator == null ? 1 : arredondarEstoque(fator);
  }

  // ----- Direcionamento do catálogo (tela em massa: produto → KDS/impressora) -----
  // Lista os produtos com os destinos JÁ definidos + os campos usados nos filtros
  // (categoria, setor, preparado×pronto). Sem destino = herda setor/impressora única.
  async listarDirecionamento(tenantId: string) {
    const res: any = await this.db.execute(sql`
      select p.id, p.nome, p.tipo, p.ficha_id as "fichaId",
             p.categoria_id as "categoriaId", c.nome as "categoriaNome",
             p.setor_producao_id as "setorProducaoId", s.nome as "setorNome",
             p.disponivel_cardapio as "disponivelCardapio",
             p.disponivel_balcao as "disponivelBalcao",
             p.vai_para_producao as "vaiParaProducao",
             coalesce(
               (select json_agg(d.equipamento_id) from produto_destino_producao d
                 where d.produto_id = p.id and d.tenant_id = p.tenant_id),
               '[]'
             ) as destinos
      from produto p
      left join categoria_produto c on c.id = p.categoria_id
      left join setor s on s.id = p.setor_producao_id
      where p.tenant_id = ${tenantId} and p.deleted_at is null and p.ativo = true
      order by c.nome nulls last, p.nome
    `);
    return (res.rows ?? res).map((r: any) => ({
      ...r,
      destinos: Array.isArray(r.destinos) ? r.destinos.filter(Boolean) : [],
      // "Preparado" = tem ficha técnica (explode ao vender). Sem ficha = pronto/revenda.
      preparado: !!r.fichaId,
    }));
  }

  // Grava o direcionamento de VÁRIOS produtos de uma vez.
  //  modo 'substituir' = troca os destinos; 'adicionar' = soma aos existentes.
  //
  // Uma transação e duas consultas, qualquer que seja a quantidade de produtos. Antes era um laço
  // (apagar, ler e inserir POR produto, sem transação): "marcar todos" virava centenas de idas ao
  // banco e, se uma falhasse no meio, parte dos produtos ficava sem destino nenhum. Só entra o que
  // é DESTA empresa: o produto pelo `tenant_id` e o destino tem de ser KDS ou impressora dela.
  async setDirecionamentoLote(
    tenantId: string,
    produtoIds: string[],
    equipamentoIds: string[],
    modo: 'substituir' | 'adicionar' = 'substituir',
    ator?: { id: string | null; perfil: string | null },
  ) {
    const lista = (v: unknown): string[] => [...new Set((Array.isArray(v) ? v : []).filter((x): x is string => typeof x === 'string' && !!x))];
    const produtos = lista(produtoIds);
    const equipamentos = lista(equipamentoIds);
    if (!produtos.length) throw new BadRequestException('Selecione ao menos um produto.');
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (![...produtos, ...equipamentos].every((x) => UUID.test(x))) throw new BadRequestException('Produto ou destino inválido.');

    const destinos = equipamentos.length
      ? await this.db
          .select({ id: equipamento.id, nome: equipamento.nome })
          .from(equipamento)
          .where(and(eq(equipamento.tenantId, tenantId), inArray(equipamento.id, equipamentos), inArray(equipamento.tipo, ['kds', 'impressora'])))
      : [];
    if (destinos.length !== equipamentos.length) throw new BadRequestException('Destino não encontrado. Atualize a tela e tente de novo.');

    const alterados = await this.db.transaction(async (tx) => {
      if (modo === 'substituir') {
        // Sai só o destino que não continua: a linha que fica não é regravada.
        await tx
          .delete(produtoDestinoProducao)
          .where(
            and(
              eq(produtoDestinoProducao.tenantId, tenantId),
              inArray(produtoDestinoProducao.produtoId, produtos),
              equipamentos.length ? notInArray(produtoDestinoProducao.equipamentoId, equipamentos) : undefined,
            ),
          );
      }
      const doTenant: any = await tx.execute(sql`
        select count(*)::int as n from produto p
         where p.tenant_id = ${tenantId} and p.id in (${sql.join(produtos.map((id) => sql`${id}::uuid`), sql`, `)})`);
      if (equipamentos.length) {
        // Produto × destino que ainda não existe; o índice único (produto, destino) segura a corrida.
        await tx.execute(sql`
          insert into produto_destino_producao (tenant_id, produto_id, equipamento_id)
          select p.tenant_id, p.id, e.id
            from produto p
            join equipamento e on e.tenant_id = p.tenant_id
           where p.tenant_id = ${tenantId}
             and p.id in (${sql.join(produtos.map((id) => sql`${id}::uuid`), sql`, `)})
             and e.id in (${sql.join(equipamentos.map((id) => sql`${id}::uuid`), sql`, `)})
          on conflict (produto_id, equipamento_id) do nothing`);
      }
      return Number((doTenant.rows ?? doTenant)[0]?.n ?? 0);
    });

    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.id ?? null,
      atorPerfil: ator?.perfil ?? '',
      tipo: 'cadastro',
      acao: 'direcionou_produtos',
      entidadeTipo: 'produto',
      entidadeId: null,
      detalhe: { produtos: alterados, modo, destinos: destinos.map((d) => d.nome) },
    });
    return { ok: true, produtos: alterados, destinos: equipamentos.length };
  }

  // ----- Destinos próprios de COMPLEMENTO e OPÇÃO (mig 127) -----
  // Vazio = herda do produto (padrão). Preenchido = prevalece sobre o do produto.
  async getComplementoDestinos(tenantId: string, complementoId: string) {
    const rows = await this.db
      .select({ equipamentoId: complementoDestinoProducao.equipamentoId })
      .from(complementoDestinoProducao)
      .where(
        and(
          eq(complementoDestinoProducao.tenantId, tenantId),
          eq(complementoDestinoProducao.complementoId, complementoId),
        ),
      );
    return rows.map((r) => r.equipamentoId);
  }

  async setComplementoDestinos(tenantId: string, complementoId: string, ids: string[]) {
    await this.db
      .delete(complementoDestinoProducao)
      .where(
        and(
          eq(complementoDestinoProducao.tenantId, tenantId),
          eq(complementoDestinoProducao.complementoId, complementoId),
        ),
      );
    const lista = [...new Set((ids ?? []).filter(Boolean))];
    if (lista.length) {
      await this.db.insert(complementoDestinoProducao).values(
        lista.map((equipamentoId) => ({ tenantId, complementoId, equipamentoId })),
      );
    }
    return { ok: true };
  }

  async getOpcaoDestinos(tenantId: string, opcaoId: string) {
    const rows = await this.db
      .select({ equipamentoId: opcaoDestinoProducao.equipamentoId })
      .from(opcaoDestinoProducao)
      .where(
        and(eq(opcaoDestinoProducao.tenantId, tenantId), eq(opcaoDestinoProducao.opcaoId, opcaoId)),
      );
    return rows.map((r) => r.equipamentoId);
  }

  async setOpcaoDestinos(tenantId: string, opcaoId: string, ids: string[]) {
    await this.db
      .delete(opcaoDestinoProducao)
      .where(
        and(eq(opcaoDestinoProducao.tenantId, tenantId), eq(opcaoDestinoProducao.opcaoId, opcaoId)),
      );
    const lista = [...new Set((ids ?? []).filter(Boolean))];
    if (lista.length) {
      await this.db.insert(opcaoDestinoProducao).values(
        lista.map((equipamentoId) => ({ tenantId, opcaoId, equipamentoId })),
      );
    }
    return { ok: true };
  }

  async getProdutoComplementos(tenantId: string, produtoId: string) {
    return this.db
      .select({ complementoId: produtoComplemento.complementoId, ordem: produtoComplemento.ordem })
      .from(produtoComplemento)
      .where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.produtoId, produtoId), isNull(produtoComplemento.deletedAt)))
      .orderBy(produtoComplemento.ordem);
  }

  async setProdutoComplementos(tenantId: string, produtoId: string, ids: string[]) {
    // Soft-delete das ligações antigas (a troca precisa propagar pelo sync — P3).
    await this.db
      .update(produtoComplemento)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.produtoId, produtoId), isNull(produtoComplemento.deletedAt)));
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
      .where(and(eq(produtoComplemento.tenantId, tenantId), eq(produtoComplemento.complementoId, complementoId), isNull(produtoComplemento.deletedAt)));
    for (const a of alvos) await this.materializarProduto(tenantId, a.produtoId);
  }

  // Reaplica em todos os produtos cujos complementos usam uma opção.
  private async reMaterializarPorOpcao(tenantId: string, opcaoId: string) {
    const comps = await this.db
      .select({ complementoId: complementoItem.complementoId })
      .from(complementoItem)
      .where(and(eq(complementoItem.tenantId, tenantId), eq(complementoItem.opcaoId, opcaoId), isNull(complementoItem.deletedAt)));
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
      // mig 126 — pré-marcada por padrão (ex.: "Talheres? Sim"). Útil sobretudo nas
      // opções informativas (sem código PDV), que servem de observação ao preparo.
      padraoMarcada: !!dto?.padraoMarcada,
      ativo: dto?.ativo != null ? !!dto.ativo : true,
      esgotado: dto?.esgotado != null ? !!dto.esgotado : false,
    };
  }

  // podeCusto: quem chama pode ver/alterar valores em R$ (a rota passa `ver_financeiro`). Sem
  // isso o custo digitado é ignorado ao gravar e não volta na resposta.
  async criarOpcaoCatalogo(tenantId: string, dto: any, podeCusto = true) {
    const vals = this.opcaoVals(dto);
    if (!vals.nome) throw new NotFoundException('Informe o nome da opção.');
    if (!podeCusto) vals.precoCusto = '0';
    const { unidade: itemUnidade } = await this.vinculoComEstoque(tenantId, vals.itemId, dto?.itemUnidade);
    const [row] = await this.db.insert(opcao).values({ tenantId, ...vals, itemUnidade }).returning();
    return podeCusto ? row : { ...row, precoCusto: null };
  }

  async atualizarOpcao(tenantId: string, id: string, dto: any, podeCusto = true) {
    const vals: Record<string, any> = this.opcaoVals(dto);
    // O custo só muda quando quem salva pode ver valores E mandou o campo. Ausente (ou vazio)
    // mantém o que estava: a tela de quem não vê o custo recebe nulo e devolve nulo — pausar a
    // opção por ela zerava o custo.
    const mandouCusto = dto?.precoCusto != null && dto.precoCusto !== '';
    if (!podeCusto || !mandouCusto) delete vals.precoCusto;
    // Unidade da ligação com o insumo: quem não manda o campo (telas que regravam a opção
    // inteira para mudar "esgotado", por exemplo) mantém a que estava — se o insumo é o mesmo.
    let unidadePedida = dto?.itemUnidade;
    if (unidadePedida === undefined && vals.itemId) {
      const [atual] = await this.db
        .select({ itemId: opcao.itemId, itemUnidade: opcao.itemUnidade })
        .from(opcao)
        .where(and(eq(opcao.id, id), eq(opcao.tenantId, tenantId)));
      if (atual?.itemId === vals.itemId) unidadePedida = atual.itemUnidade;
    }
    const { unidade: itemUnidade } = await this.vinculoComEstoque(tenantId, vals.itemId, unidadePedida);
    const [row] = await this.db
      .update(opcao)
      .set({ ...vals, itemUnidade, updatedAt: new Date() })
      .where(and(eq(opcao.id, id), eq(opcao.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Opção não encontrada');
    // Nome/preço-custo/estoque da opção mudou → repropaga aos produtos afetados.
    await this.reMaterializarPorOpcao(tenantId, id);
    return podeCusto ? row : { ...row, precoCusto: null };
  }

  async excluirOpcao(tenantId: string, id: string) {
    // Soft-delete p/ propagar a exclusão pelo sync (P3). Rematerializa quem a usava.
    await this.db
      .update(opcao)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(opcao.id, id), eq(opcao.tenantId, tenantId)));
    await this.reMaterializarPorOpcao(tenantId, id);
    return { ok: true };
  }

  // Coleta os complementos que usam qualquer uma das opções (para rematerializar
  // UMA vez por complemento, não uma vez por opção).
  private async complementosDeOpcoes(tenantId: string, ids: string[]): Promise<string[]> {
    if (!ids.length) return [];
    const comps = await this.db
      .select({ complementoId: complementoItem.complementoId })
      .from(complementoItem)
      .where(and(eq(complementoItem.tenantId, tenantId), inArray(complementoItem.opcaoId, ids), isNull(complementoItem.deletedAt)));
    return [...new Set(comps.map((c) => c.complementoId))];
  }

  // Exclusão em MASSA: um único UPDATE (soft-delete) + rematerializa os complementos
  // afetados uma vez cada. Evita centenas de requisições/queries do delete 1-a-1.
  async excluirOpcoesMassa(tenantId: string, ids: string[]) {
    const alvo = [...new Set((ids ?? []).filter(Boolean))].slice(0, 5000);
    if (!alvo.length) return { ok: true, excluidas: 0 };
    const comps = await this.complementosDeOpcoes(tenantId, alvo); // antes de apagar
    const res = await this.db
      .update(opcao)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(opcao.tenantId, tenantId), inArray(opcao.id, alvo), isNull(opcao.deletedAt)))
      .returning({ id: opcao.id });
    for (const cid of comps) await this.reMaterializarPorComplemento(tenantId, cid);
    return { ok: true, excluidas: res.length };
  }

  // Preço de custo em MASSA: um único UPDATE + rematerializa os afetados.
  async precoCustoOpcoesMassa(tenantId: string, ids: string[], precoCusto: number) {
    const alvo = [...new Set((ids ?? []).filter(Boolean))].slice(0, 5000);
    if (!alvo.length) return { ok: true, atualizadas: 0 };
    const valor = String(Number.isFinite(precoCusto) && precoCusto >= 0 ? precoCusto : 0);
    const res = await this.db
      .update(opcao)
      .set({ precoCusto: valor, updatedAt: new Date() })
      .where(and(eq(opcao.tenantId, tenantId), inArray(opcao.id, alvo), isNull(opcao.deletedAt)))
      .returning({ id: opcao.id });
    for (const cid of await this.complementosDeOpcoes(tenantId, alvo)) await this.reMaterializarPorComplemento(tenantId, cid);
    return { ok: true, atualizadas: res.length };
  }

  // ----- Produtos -----
  // verFin: o perfil pode ver valores financeiros? Só então o custo (custo efetivo
  // derivado da ficha / item de estoque / override) é devolvido — senão vem null.
  async listar(tenantId: string, verFin = false, atual: string | null = null) {
    const res: any = await this.db.execute(sql`
      select p.id, p.codigo, p.nome, p.descricao, p.tipo,
             p.unidade_medida as "unidadeMedida", p.preco_venda as "precoVenda",
             p.preco_custo as "precoCusto", p.controla_estoque as "controlaEstoque",
             p.validade_dias as "validadeDias", p.vai_para_producao as "vaiParaProducao",
             p.controla_validade as "controlaValidade",
             p.validade_fechado_dias as "validadeFechadoDias",
             p.validade_aberto_dias as "validadeAbertoDias",
             p.disponivel_cardapio as "disponivelCardapio",
             p.pausado_estoque as "pausadoEstoque", p.pausa_motivo as "pausaMotivo",
             p.permite_negativo as "permiteNegativo",
             p.disponivel_balcao as "disponivelBalcao",
             p.canais_pausados as "canaisPausados",
             p.ativo, p.categoria_id as "categoriaId", p.ficha_id as "fichaId",
             p.item_id as "itemId", p.item_unidade as "itemUnidade", p.item_fator as "itemFator",
             p.setor_producao_id as "setorProducaoId", p.imagem_ref as "imagemRef",
             c.nome as "categoriaNome", f.nome as "fichaNome",
             ie.nome as "itemNome", ie.custo_medio as "itemCustoMedio", ie.unidade_medida as "itemUnidadeEstoque"
      from produto p
      left join categoria_produto c on c.id = p.categoria_id
      left join ficha_tecnica f on f.id = p.ficha_id
      left join item_estoque ie on ie.id = p.item_id
      where p.tenant_id = ${tenantId} and p.deleted_at is null
      order by p.nome
    `);
    const rows0 = (res.rows ?? res) as any[];
    // Pausa por estoque POR LOJA (mig 260). `pausadoEstoque` = pausado na loja escolhida; em
    // "todas as lojas", pausado em alguma delas, com `lojasPausadas` dizendo em quais.
    // Empresa sem loja cadastrada: o campo antigo do produto.
    const [lojas, pausas] = await Promise.all([lojasAtivas(this.db, tenantId), pausasPorProduto(this.db, tenantId)]);
    const rows = rows0.map((p) => {
      if (!lojas.length) return { ...p, lojasPausadas: [] };
      const emQuais = pausas.get(p.id) ?? [];
      return {
        ...p,
        pausadoEstoque: atual ? emQuais.some((l) => l.id === atual) : emQuais.length > 0,
        lojasPausadas: lojas.length > 1 && !atual ? emQuais.map((l) => l.nome) : [],
      };
    });
    // Custo derivado: só quem pode ver financeiro recebe os valores.
    if (!verFin) {
      return rows.map((p) => ({
        ...p,
        precoCusto: null,
        itemCustoMedio: null,
        custoEfetivo: null,
        custoEfetivoDelivery: null,
        custoFonte: null,
      }));
    }
    const fichaCusto = await this.fichas.custoPorPorcao(tenantId);
    return rows.map((p) => {
      const override = p.precoCusto != null && p.precoCusto !== '' ? Number(p.precoCusto) : null;
      const fc = p.fichaId ? fichaCusto[p.fichaId] : null;
      // Custo de UMA unidade vendida: o custo médio do item × quanto dele sai por venda (mig 309).
      const itemMedio = p.itemCustoMedio != null ? Number(p.itemCustoMedio) * (Number(p.itemFator) || 1) : null;
      // Prioridade: override manual → custo da ficha → custo médio do item de estoque.
      let custo: number | null = null;
      let custoDelivery: number | null = null;
      let fonte: 'manual' | 'ficha' | 'estoque' | null = null;
      if (override != null) {
        custo = override;
        custoDelivery = override;
        fonte = 'manual';
      } else if (fc) {
        custo = fc.balcao;
        custoDelivery = fc.delivery;
        fonte = 'ficha';
      } else if (itemMedio != null) {
        custo = itemMedio;
        custoDelivery = itemMedio; // industrializado não tem embalagem própria na ficha
        fonte = 'estoque';
      }
      return {
        ...p,
        custoEfetivo: custo,
        custoEfetivoDelivery: custoDelivery,
        custoFonte: fonte,
      };
    });
  }

  // Mapa produtoId → custo EFETIVO (balcão), pela MESMA prioridade do listar
  // (override manual → custo da ficha → custo médio do item de estoque). Reusado
  // pelos relatórios (curva ABC com colunas de custo e lucro).
  async custoEfetivoMapa(tenantId: string): Promise<Record<string, number>> {
    const res: any = await this.db.execute(sql`
      select p.id, p.preco_custo as "precoCusto", p.ficha_id as "fichaId",
             ie.custo_medio * p.item_fator as "itemCustoMedio"
      from produto p
      left join item_estoque ie on ie.id = p.item_id
      where p.tenant_id = ${tenantId} and p.deleted_at is null
    `);
    const rows = (res.rows ?? res) as any[];
    const fichaCusto = await this.fichas.custoPorPorcao(tenantId);
    const out: Record<string, number> = {};
    for (const p of rows) {
      const override = p.precoCusto != null && p.precoCusto !== '' ? Number(p.precoCusto) : null;
      const fc = p.fichaId ? fichaCusto[p.fichaId] : null;
      const itemMedio = p.itemCustoMedio != null ? Number(p.itemCustoMedio) : null;
      const custo = override != null ? override : fc ? fc.balcao : itemMedio;
      if (custo != null && Number.isFinite(custo)) out[p.id] = custo;
    }
    return out;
  }

  // L-CAT-2 — Snapshot de catálogo para integração externa autenticada por
  // dispositivo (totem GoGeM), keyed por código PDV (produto.codigo) e
  // codigoPdv da opção. Somente leitura; tenant sempre do dispositivo.
  // SET-BASED: 4 queries no total (categorias + produtos + grupos + opções),
  // nunca 2×N. O poller do GoGeM chama isto a cada 5 min por loja com timeout
  // de 15s — a versão N+1 (um `complementosDe` por produto, e cada um relendo
  // TODAS as opções do tenant) estourava o timeout/gateway (aborted/502/500).
  async catalogoParaSync(tenantId: string, unidadeId: string | null) {
    const [categorias, produtos] = await Promise.all([
      this.listarCategorias(tenantId),
      this.listar(tenantId),
    ]);
    const produtoIds = (produtos as any[]).map((p) => p.id);
    const grupos: any[] = produtoIds.length
      ? await this.db
          .select()
          .from(complementoGrupo)
          .where(
            and(
              eq(complementoGrupo.tenantId, tenantId),
              inArray(complementoGrupo.produtoId, produtoIds),
              isNull(complementoGrupo.deletedAt),
            ),
          )
          .orderBy(complementoGrupo.ordem)
      : [];
    const grupoIds = grupos.map((g) => g.id);
    const opcoes: any[] = grupoIds.length
      ? await this.db
          .select()
          .from(complementoOpcao)
          .where(
            and(
              eq(complementoOpcao.tenantId, tenantId),
              inArray(complementoOpcao.grupoId, grupoIds),
              isNull(complementoOpcao.deletedAt),
            ),
          )
          .orderBy(complementoOpcao.ordem)
      : [];
    // Índices em memória (a ordem já vem do SQL).
    const gruposPorProduto = new Map<string, any[]>();
    for (const g of grupos) {
      const lista = gruposPorProduto.get(g.produtoId);
      if (lista) lista.push(g);
      else gruposPorProduto.set(g.produtoId, [g]);
    }
    const opcoesPorGrupo = new Map<string, any[]>();
    for (const o of opcoes) {
      const lista = opcoesPorGrupo.get(o.grupoId);
      if (lista) lista.push(o);
      else opcoesPorGrupo.set(o.grupoId, [o]);
    }
    // Pausa por estoque DA LOJA do dispositivo (mig 260); sem loja, o campo antigo.
    const pausasCat = unidadeId ? await pausasPorProduto(this.db, tenantId) : null;
    const itens = (produtos as any[]).map((p) => {
      const gruposDoProduto = gruposPorProduto.get(p.id) ?? [];
      return {
        id: p.id,
        codigo: p.codigo,
        nome: p.nome,
        descricao: p.descricao,
        // URL pública da foto (Supabase) — o `imagem_ref` já é reescrito para a
        // URL pública pelo reconcile de mídia; o GoGeM grava direto em imagemUrl.
        imagem: p.imagemRef ?? null,
        precoVenda: p.precoVenda,
        categoriaId: p.categoriaId,
        disponivelCardapio: p.disponivelCardapio,
        disponivelBalcao: p.disponivelBalcao,
        // Canais de delivery pausados p/ este produto — o consumidor do sync
        // (Orzuni→iFood, GoGeM) esconde/pausa o item no canal correspondente.
        canaisPausados: p.canaisPausados ?? [],
        // Pausado por estoque (esgotado) — o GoGeM reflete como indisponível.
        pausadoEstoque: pausasCat
          ? (pausasCat.get(p.id) ?? []).some((l) => l.id === unidadeId)
          : p.pausadoEstoque ?? false,
        ativo: p.ativo,
        grupos: gruposDoProduto.map((g) => ({
          id: g.id,
          nome: g.nome,
          tipo: g.tipo,
          min: g.min,
          max: g.max,
          obrigatorio: g.obrigatorio,
          ordem: g.ordem,
          opcoes: (opcoesPorGrupo.get(g.id) ?? []).map((o) => ({
            id: o.id,
            nome: o.nome,
            precoDelta: o.precoDelta,
            codigoPdv: o.codigoPdv,
            ordem: o.ordem,
          })),
        })),
      };
    });
    return {
      geradoEm: new Date().toISOString(),
      categorias,
      produtos: itens,
    };
  }

  /**
   * Pausa/despausa um produto para um CANAL (ex.: 'gogem'/'totem'), casando por
   * `codigo` (de-para PDV). Usado pela integração de totem (GoGeM→Regem) via
   * X-Sync-Token: pausar no GoGeM adiciona o canal em `canais_pausados`, e some
   * do totem; despausar remove. Não mexe em `disponivel_cardapio` (não afeta os
   * outros canais). Flash-sync reflete no cardápio online.
   */
  async pausarCanalPorCodigo(
    tenantId: string,
    codigo: string,
    canal: string,
    pausar: boolean,
  ) {
    const [p] = await this.db
      .select({ id: produto.id, canaisPausados: produto.canaisPausados })
      .from(produto)
      .where(and(eq(produto.tenantId, tenantId), eq(produto.codigo, codigo)));
    if (!p)
      throw new NotFoundException(
        `Produto com código "${codigo}" não encontrado.`,
      );

    const atuais: string[] = Array.isArray(p.canaisPausados)
      ? (p.canaisPausados as string[]).map(String)
      : [];
    const set = new Set(atuais);
    if (pausar) set.add(canal);
    else set.delete(canal);
    const canaisPausados = [...set];

    await this.db
      .update(produto)
      .set({ canaisPausados })
      .where(and(eq(produto.id, p.id), eq(produto.tenantId, tenantId)));
    void this.flash.flashProdutos([p.id]);
    return { codigo, canal, pausado: pausar, canaisPausados };
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
      .where(and(eq(produtoVariacao.produtoId, id), isNull(produtoVariacao.deletedAt)));
    const combo = await this.db
      .select()
      .from(produtoComboItem)
      .where(and(eq(produtoComboItem.comboProdutoId, id), isNull(produtoComboItem.deletedAt)));
    const complementos = await this.complementosDe(tenantId, id);
    const faixas = await this.db
      .select()
      .from(produtoFaixaPreco)
      .where(eq(produtoFaixaPreco.produtoId, id))
      .orderBy(produtoFaixaPreco.ordem);
    const sugestoes = await this.sugestoesDe(tenantId, id);
    return { ...p, variacoes, combo, complementos, faixas, sugestoes };
  }

  // Duplica um produto: clona o registro + variações, combo, links de complemento,
  // faixas de preço e destinos de produção. O código PDV é zerado (o usuário
  // reatribui) e o nome ganha "(cópia)". Ficha/item de estoque são referências —
  // apenas apontam para os mesmos, não duplicam a ficha nem o insumo.
  async duplicar(tenantId: string, id: string) {
    const [orig]: any = await this.db
      .select()
      .from(produto)
      .where(and(eq(produto.id, id), eq(produto.tenantId, tenantId), isNull(produto.deletedAt)));
    if (!orig) throw new NotFoundException('Produto não encontrado');
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const { id: _i, createdAt: _c, updatedAt: _u, deletedAt: _d, ...rest } = orig;
    /* eslint-enable @typescript-eslint/no-unused-vars */
    const [novo] = await this.db
      .insert(produto)
      .values({ ...rest, nome: `${orig.nome} (cópia)`, codigo: null })
      .returning();

    // `chave` = propriedade JS que aponta pro produto pai (a coluna Drizzle usa
    // snake_case, mas o insert recebe a chave camelCase da linha selecionada).
    const clonar = async (tabela: any, coluna: any, chave: string) => {
      // Ignora linha já excluída (mig 242) — senão duplicar o produto ressuscitaria a
      // variação/componente que o lojista tinha apagado. `deleted_at` também não pode
      // ser copiado para a cópia nova.
      const vivo = (tabela as any).deletedAt ? isNull((tabela as any).deletedAt) : undefined;
      const linhas: any[] = await this.db
        .select()
        .from(tabela)
        .where(vivo ? and(eq(coluna, id), vivo) : eq(coluna, id));
      if (!linhas.length) return;
      await this.db.insert(tabela).values(
        linhas.map((l) => {
          const { id: _x, deletedAt: _d, ...r } = l;
          return { ...r, [chave]: novo.id };
        }),
      );
    };
    await clonar(produtoVariacao, produtoVariacao.produtoId, 'produtoId');
    await clonar(produtoComboItem, produtoComboItem.comboProdutoId, 'comboProdutoId');
    await clonar(produtoComplemento, produtoComplemento.produtoId, 'produtoId');
    await clonar(produtoFaixaPreco, produtoFaixaPreco.produtoId, 'produtoId');
    await clonar(produtoDestinoProducao, produtoDestinoProducao.produtoId, 'produtoId');
    return novo;
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
    // A reativação vale para o produto inteiro: tira a pausa por estoque de TODAS as lojas.
    if (ativo)
      await this.db.execute(sql`
        update produto_pausa_estoque set pausado = false, motivo = null
         where tenant_id = ${tenantId} and produto_id = ${id} and pausado = true`);
    // Reativar/despausar reflete no cardápio online já (bloqueio/liberação do item).
    void this.flash.flashProdutos([id]);
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
    faixas: { qtdMin: number; preco?: number; descontoPct?: number }[],
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
            // Modo atacado % (mig 184): guarda o desconto da faixa quando informado.
            descontoPct:
              f.descontoPct == null || Number.isNaN(Number(f.descontoPct))
                ? null
                : String(Math.min(Math.max(Number(f.descontoPct), 0), 100)),
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
          isNull(complementoGrupo.deletedAt),
        ),
      )
      .orderBy(complementoGrupo.ordem);
    if (!grupos.length) return [];
    // Só as opções DESTES grupos — sem o filtro a query varria todas as opções
    // do tenant a cada chamada (índice: complemento_opcao(grupo_id)).
    const opcoes = await this.db
      .select()
      .from(complementoOpcao)
      .where(
        and(
          eq(complementoOpcao.tenantId, tenantId),
          inArray(
            complementoOpcao.grupoId,
            grupos.map((g) => g.id),
          ),
          isNull(complementoOpcao.deletedAt),
        ),
      )
      .orderBy(complementoOpcao.ordem);
    // A regra da etapa ("pode repetir a mesma opção?") mora no complemento reutilizável de
    // origem — o grupo do produto não a guarda. É por ela que o balcão e a mesa mostram − n +
    // (a venda só conta a repetição onde a regra permite). Grupo sem origem: não repete.
    const origens = [...new Set(grupos.map((g) => g.origemComplementoId).filter(Boolean))] as string[];
    const regras = origens.length
      ? await this.db
          .select({ id: complemento.id, regra: complemento.regra })
          .from(complemento)
          .where(and(eq(complemento.tenantId, tenantId), inArray(complemento.id, origens)))
      : [];
    const regraDaOrigem = new Map(regras.map((c) => [c.id, c.regra]));
    return grupos.map((g) => ({
      ...g,
      regra:
        (g.origemComplementoId && regraDaOrigem.get(g.origemComplementoId)) ||
        (g.max === 1 ? 'uma' : 'varias_sem_repeticao'),
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
    // Soft-delete (deleted_at) para a remoção propagar ao edge pelo sync (P2).
    const agora = new Date();
    await this.db
      .update(complementoOpcao)
      .set({ deletedAt: agora })
      .where(eq(complementoOpcao.grupoId, grupoId));
    await this.db
      .update(complementoGrupo)
      .set({ deletedAt: agora })
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
      .update(complementoOpcao)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(complementoOpcao.id, opcaoId),
          eq(complementoOpcao.tenantId, tenantId),
        ),
      );
    return { ok: true };
  }

  // A categoria organiza o catálogo de vendas (cardápio digital + balcão/PDV), por
  // isso é OBRIGATÓRIA no produto. Insumos internos não são `produto` — vivem em
  // item_estoque, com categoria própria (categoria_item).
  private exigirCategoria(categoriaId?: string | null) {
    if (!categoriaId) {
      throw new BadRequestException(
        'Selecione uma categoria: ela organiza o produto no cardápio digital e no balcão/PDV.',
      );
    }
  }

  async criar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: CreateProdutoDto,
  ) {
    this.exigirCategoria(dto.categoriaId);
    const vinculo = await this.vinculoComEstoque(tenantId, dto.itemId, dto.itemUnidade);
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
          itemId: dto.itemId, // item de estoque de revenda (fonte de custo)
          itemUnidade: vinculo.unidade,
          itemFator: String(vinculo.fator),
          tipo: dto.tipo ?? 'simples',
          unidadeMedida: dto.unidadeMedida ?? 'un',
          precoVenda: String(dto.precoVenda),
          precoCusto: dto.precoCusto != null ? String(dto.precoCusto) : undefined,
          controlaEstoque: dto.controlaEstoque ?? true,
          validadeDias: dto.validadeDias,
          controlaValidade: dto.controlaValidade ?? false,
          validadeFechadoDias: dto.validadeFechadoDias,
          validadeAbertoDias: dto.validadeAbertoDias,
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
          canaisPausados: dto.canaisPausados ?? [],
          disponivelCardapio: dto.disponivelCardapio ?? true,
          disponivelBalcao: dto.disponivelBalcao ?? true,
          destaque: dto.destaque ?? false,
          atacadoAtivo: dto.atacadoAtivo ?? false,
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
    // Se o campo veio no payload, não pode vir vazio (limpar categoria é proibido).
    if (dto.categoriaId !== undefined) this.exigirCategoria(dto.categoriaId);
    const patch: any = { updatedAt: new Date() };
    const set = (k: string, v: any) => {
      if (v !== undefined) patch[k] = v;
    };
    set('codigo', dto.codigo);
    set('nome', dto.nome);
    set('descricao', dto.descricao);
    set('categoriaId', dto.categoriaId);
    set('fichaId', dto.fichaId);
    set('itemId', dto.itemId); // item de estoque de revenda (fonte de custo)
    // Unidade da ligação com o estoque (mig 309). Mexeu no item ou na unidade → o fator é
    // refeito; trocou só o item, a unidade volta para a do estoque dele.
    if (dto.itemId !== undefined || dto.itemUnidade !== undefined) {
      const [atual] = await this.db
        .select({ itemId: produto.itemId, itemUnidade: produto.itemUnidade })
        .from(produto)
        .where(and(eq(produto.id, id), eq(produto.tenantId, tenantId)));
      if (!atual) throw new NotFoundException('Produto não encontrado');
      const itemId = dto.itemId !== undefined ? dto.itemId : atual.itemId;
      const mudouItem = dto.itemId !== undefined && (dto.itemId ?? null) !== (atual.itemId ?? null);
      const unidade = dto.itemUnidade !== undefined ? dto.itemUnidade : mudouItem ? null : atual.itemUnidade;
      const vinculo = await this.vinculoComEstoque(tenantId, itemId, unidade);
      patch.itemUnidade = vinculo.unidade;
      patch.itemFator = String(vinculo.fator);
    }
    set('tipo', dto.tipo);
    set('unidadeMedida', dto.unidadeMedida);
    if (dto.precoVenda !== undefined) patch.precoVenda = String(dto.precoVenda);
    if (dto.precoCusto !== undefined)
      patch.precoCusto = dto.precoCusto != null ? String(dto.precoCusto) : null;
    set('controlaEstoque', dto.controlaEstoque);
    set('validadeDias', dto.validadeDias);
    set('controlaValidade', dto.controlaValidade);
    set('validadeFechadoDias', dto.validadeFechadoDias);
    set('validadeAbertoDias', dto.validadeAbertoDias);
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
    set('canaisPausados', dto.canaisPausados);
    set('disponivelCardapio', dto.disponivelCardapio);
    set('disponivelBalcao', dto.disponivelBalcao);
    set('destaque', dto.destaque);
    set('atacadoAtivo', dto.atacadoAtivo);
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
    // Flash-sync: edição local reflete no cardápio ONLINE em segundos (edge → nuvem).
    void this.flash.flashProdutos([id]);

    // Substitui variações/combo quando enviados (edição completa).
    // SOFT-delete (mig 242): as duas tabelas sincronizam para o servidor local por delta
    // de linha. Delete físico some da nuvem e NÃO some do edge — a variação/componente
    // antigo continuaria lá e a baixa da ficha sairia errada.
    if (dto.variacoes) {
      await this.db
        .update(produtoVariacao)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(produtoVariacao.produtoId, id),
            eq(produtoVariacao.tenantId, tenantId),
            isNull(produtoVariacao.deletedAt),
          ),
        );
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
        .update(produtoComboItem)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(produtoComboItem.comboProdutoId, id),
            eq(produtoComboItem.tenantId, tenantId),
            isNull(produtoComboItem.deletedAt),
          ),
        );
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
