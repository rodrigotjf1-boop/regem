import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  cardapioConfig,
  produto,
  produtoVariacao,
  categoriaProduto,
  complementoGrupo,
  complementoOpcao,
  cardapioBairro,
  banner,
  cupom,
  fidelidadeCliente,
  pedidoExterno,
  comandaItem,
  mesa,
  comanda,
} from '../../db/schema';
import { VendasService } from '../vendas/vendas.service';
import { DeliveryService } from '../delivery/delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class CardapioService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly vendas: VendasService,
    private readonly delivery: DeliveryService,
  ) {}

  // ===== Config (gestor) =====
  private async configRaw(tenantId: string, unidadeId?: string | null) {
    const [row] = await this.db
      .select()
      .from(cardapioConfig)
      .where(
        and(
          eq(cardapioConfig.tenantId, tenantId),
          unidadeId
            ? eq(cardapioConfig.unidadeId, unidadeId)
            : sql`unidade_id is null`,
        ),
      );
    return row;
  }

  async getConfig(tenantId: string, unidadeId?: string | null) {
    return (
      (await this.configRaw(tenantId, unidadeId)) ?? {
        ativo: false,
        modo: 'mesa',
        token: null,
      }
    );
  }

  async setConfig(tenantId: string, unidadeId: string | null, dto: any) {
    const row = await this.configRaw(tenantId, unidadeId);
    const vals: any = {
      ativo: dto.ativo != null ? !!dto.ativo : row?.ativo ?? false,
      modo: dto.modo ?? row?.modo ?? 'mesa',
      nomePublico: dto.nomePublico ?? row?.nomePublico ?? null,
      ramo: dto.ramo ?? row?.ramo ?? 'food',
      logoEmoji: dto.logoEmoji ?? row?.logoEmoji ?? null,
      subtitulo: dto.subtitulo ?? row?.subtitulo ?? null,
      aberto: dto.aberto != null ? !!dto.aberto : row?.aberto ?? true,
      tempoEntregaMin: dto.tempoEntregaMin ?? row?.tempoEntregaMin ?? null,
      pedidoMinimo:
        dto.pedidoMinimo != null ? String(dto.pedidoMinimo) : row?.pedidoMinimo ?? null,
      avaliacao: dto.avaliacao != null ? String(dto.avaliacao) : row?.avaliacao ?? null,
      freteGratisAcima:
        dto.freteGratisAcima != null ? String(dto.freteGratisAcima) : row?.freteGratisAcima ?? null,
      pagamentos: dto.pagamentos ?? row?.pagamentos ?? [],
      fidelidadeAtiva: dto.fidelidadeAtiva != null ? !!dto.fidelidadeAtiva : row?.fidelidadeAtiva ?? false,
      whatsapp: dto.whatsapp ?? row?.whatsapp ?? null,
      parcelasMax:
        dto.parcelasMax != null ? Number(dto.parcelasMax) || null : row?.parcelasMax ?? null,
      autoKds: dto.autoKds != null ? !!dto.autoKds : row?.autoKds ?? true,
      formasCartao: Array.isArray(dto.formasCartao)
        ? dto.formasCartao.filter((x: any) => typeof x === 'string' && x.trim()).map((x: string) => x.trim())
        : row?.formasCartao ?? [],
      // Loja / contatos
      logoRef: dto.logoRef ?? row?.logoRef ?? null,
      documento: dto.documento ?? row?.documento ?? null,
      responsavelNome: dto.responsavelNome ?? row?.responsavelNome ?? null,
      responsavelContato: dto.responsavelContato ?? row?.responsavelContato ?? null,
      contatoLoja: dto.contatoLoja ?? row?.contatoLoja ?? null,
      instagram: dto.instagram ?? row?.instagram ?? null,
      site: dto.site ?? row?.site ?? null,
      // Endereço
      endCep: dto.endCep ?? row?.endCep ?? null,
      endRua: dto.endRua ?? row?.endRua ?? null,
      endNumero: dto.endNumero ?? row?.endNumero ?? null,
      endBairro: dto.endBairro ?? row?.endBairro ?? null,
      endCidade: dto.endCidade ?? row?.endCidade ?? null,
      endEstado: dto.endEstado ?? row?.endEstado ?? null,
      endReferencia: dto.endReferencia ?? row?.endReferencia ?? null,
      endComplemento: dto.endComplemento ?? row?.endComplemento ?? null,
      endLat: dto.endLat != null ? String(dto.endLat) : row?.endLat ?? null,
      endLng: dto.endLng != null ? String(dto.endLng) : row?.endLng ?? null,
      // Área de atendimento (bairro | raio)
      areaModo: dto.areaModo === 'raio' ? 'raio' : dto.areaModo === 'bairro' ? 'bairro' : row?.areaModo ?? 'bairro',
      raios: Array.isArray(dto.raios)
        ? dto.raios
            .map((r: any) => ({ ateKm: Number(r.ateKm) || 0, taxa: Number(r.taxa) || 0 }))
            .filter((r: any) => r.ateKm > 0)
            .sort((a: any, b: any) => a.ateKm - b.ateKm)
        : row?.raios ?? [],
      // Tipos de pedido
      tipoDelivery: dto.tipoDelivery != null ? !!dto.tipoDelivery : row?.tipoDelivery ?? true,
      tipoRetirada: dto.tipoRetirada != null ? !!dto.tipoRetirada : row?.tipoRetirada ?? false,
      tipoLocal: dto.tipoLocal != null ? !!dto.tipoLocal : row?.tipoLocal ?? false,
      // Horários
      horarios: Array.isArray(dto.horarios) ? dto.horarios : row?.horarios ?? [],
    };
    if (row) {
      await this.db
        .update(cardapioConfig)
        .set({ ...vals, updatedAt: new Date() })
        .where(eq(cardapioConfig.id, row.id));
    } else {
      vals.token = randomBytes(6).toString('hex'); // 12 chars
      await this.db.insert(cardapioConfig).values({ tenantId, unidadeId, ...vals });
    }
    return this.getConfig(tenantId, unidadeId);
  }

  // ===== Bairros (frete) — gestor =====
  listarBairros(tenantId: string, unidadeId?: string | null) {
    return this.db
      .select()
      .from(cardapioBairro)
      .where(eq(cardapioBairro.tenantId, tenantId))
      .orderBy(cardapioBairro.ordem);
  }

  async setBairros(
    tenantId: string,
    unidadeId: string | null,
    bairros: { nome: string; taxa: number; ativo?: boolean }[],
  ) {
    await this.db
      .delete(cardapioBairro)
      .where(eq(cardapioBairro.tenantId, tenantId));
    if (bairros?.length) {
      await this.db.insert(cardapioBairro).values(
        bairros
          .filter((b) => b.nome?.trim())
          .map((b, i) => ({
            tenantId,
            unidadeId,
            nome: b.nome.trim(),
            taxa: String(Number(b.taxa) || 0),
            ativo: b.ativo !== false,
            ordem: i,
          })),
      );
    }
    return this.listarBairros(tenantId, unidadeId);
  }

  // ===== Banners do cardápio (gestor) =====
  listarBanners(tenantId: string) {
    return this.db
      .select()
      .from(banner)
      .where(eq(banner.tenantId, tenantId))
      .orderBy(banner.ordem);
  }

  async setBanners(
    tenantId: string,
    unidadeId: string | null,
    banners: { imagemRef: string; titulo?: string; link?: string; ativo?: boolean }[],
  ) {
    await this.db.delete(banner).where(eq(banner.tenantId, tenantId));
    const validos = (banners ?? []).filter((b) => b.imagemRef?.trim());
    if (validos.length) {
      await this.db.insert(banner).values(
        validos.map((b, i) => ({
          tenantId,
          unidadeId,
          imagemRef: b.imagemRef.trim(),
          titulo: b.titulo?.trim() || null,
          link: b.link?.trim() || null,
          ativo: b.ativo !== false,
          ordem: i,
        })),
      );
    }
    return this.listarBanners(tenantId);
  }

  // ===== Cupons — gestor =====
  listarCupons(tenantId: string) {
    return this.db.select().from(cupom).where(eq(cupom.tenantId, tenantId));
  }

  async criarCupom(tenantId: string, unidadeId: string | null, dto: any) {
    if (!dto?.codigo?.trim()) throw new BadRequestException('Informe o código.');
    const codigo = dto.codigo.trim().toUpperCase();
    const vals = {
      tipo: dto.tipo === 'valor' ? 'valor' : 'percentual',
      valor: String(Number(dto.valor) || 0),
      minimo: dto.minimo != null ? String(dto.minimo) : null,
      ativo: dto.ativo != null ? !!dto.ativo : true,
      validade: dto.validade || null,
    };
    const [ja] = await this.db
      .select({ id: cupom.id })
      .from(cupom)
      .where(and(eq(cupom.tenantId, tenantId), sql`upper(codigo) = ${codigo}`));
    if (ja) {
      const [row] = await this.db
        .update(cupom)
        .set(vals)
        .where(eq(cupom.id, ja.id))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(cupom)
      .values({ tenantId, unidadeId, codigo, ...vals })
      .returning();
    return row;
  }

  async removerCupom(tenantId: string, id: string) {
    await this.db
      .delete(cupom)
      .where(and(eq(cupom.id, id), eq(cupom.tenantId, tenantId)));
    return { ok: true };
  }

  // Valida o cupom e devolve o desconto para um subtotal.
  private async avaliarCupom(tenantId: string, codigo: string, subtotal: number) {
    if (!codigo) return { valido: false, desconto: 0 };
    const [c] = await this.db
      .select()
      .from(cupom)
      .where(
        and(
          eq(cupom.tenantId, tenantId),
          sql`upper(codigo) = upper(${codigo})`,
          eq(cupom.ativo, true),
        ),
      );
    if (!c) return { valido: false, desconto: 0, motivo: 'Cupom inválido.' };
    if (c.validade && new Date(c.validade) < new Date())
      return { valido: false, desconto: 0, motivo: 'Cupom expirado.' };
    if (c.minimo && subtotal < Number(c.minimo))
      return { valido: false, desconto: 0, motivo: `Mínimo de ${Number(c.minimo)}.` };
    const desconto =
      c.tipo === 'valor'
        ? Math.min(subtotal, Number(c.valor))
        : Number((subtotal * (Number(c.valor) / 100)).toFixed(2));
    return { valido: true, desconto, codigo: c.codigo, tipo: c.tipo, valor: Number(c.valor) };
  }

  // ===== Público (por token) =====
  private async resolver(token: string) {
    const [cfg] = await this.db
      .select()
      .from(cardapioConfig)
      .where(eq(cardapioConfig.token, token));
    if (!cfg || !cfg.ativo)
      throw new NotFoundException('Cardápio indisponível.');
    return cfg;
  }

  // Esgotado automático: para cada produto que controla estoque, resolve os
  // itens de insumo (via ficha, recursiva) e marca esgotado se algum tem saldo
  // <= 0. Combos consideram os insumos dos componentes. Saldo = ledger.
  private async computeEsgotados(
    tenantId: string,
    produtos: any[],
  ): Promise<Set<string>> {
    const alvo = produtos.filter((p) => p.controlaEstoque);
    if (!alvo.length) return new Set();

    // Saldo por item (mesmo sinal do módulo de estoque).
    const saldoRows: any = await this.db.execute(sql`
      select item_id as "itemId",
             coalesce(sum(case when tipo = 'saida' then -quantidade else quantidade end), 0) as saldo
      from movimento_estoque
      where tenant_id = ${tenantId}
      group by item_id
    `);
    const saldo = new Map<string, number>();
    for (const r of saldoRows.rows ?? saldoRows)
      saldo.set(r.itemId, Number(r.saldo) || 0);

    // Mapa de ingredientes por ficha (carregado uma vez para o tenant).
    const ingRows: any = await this.db.execute(sql`
      select fi.ficha_id as "fichaId", fi.item_id as "itemId",
             fi.sub_ficha_id as "subFichaId"
      from ficha_ingrediente fi
      join ficha_tecnica ft on ft.id = fi.ficha_id
      where ft.tenant_id = ${tenantId}
    `);
    const ingMap = new Map<string, any[]>();
    for (const r of ingRows.rows ?? ingRows) {
      const arr = ingMap.get(r.fichaId) ?? [];
      arr.push(r);
      ingMap.set(r.fichaId, arr);
    }

    // Itens de combo → componentes.
    const comboRows: any = await this.db.execute(sql`
      select pci.combo_produto_id as "comboId", p.ficha_id as "fichaId"
      from produto_combo_item pci
      join produto p on p.id = pci.componente_produto_id
      where p.tenant_id = ${tenantId}
    `);
    const comboMap = new Map<string, string[]>();
    for (const r of comboRows.rows ?? comboRows) {
      if (!r.fichaId) continue;
      const arr = comboMap.get(r.comboId) ?? [];
      arr.push(r.fichaId);
      comboMap.set(r.comboId, arr);
    }

    const itensDaFicha = (fichaId: string, vis: Set<string>): string[] => {
      if (!fichaId || vis.has(fichaId)) return [];
      vis.add(fichaId);
      const out: string[] = [];
      for (const ing of ingMap.get(fichaId) ?? []) {
        if (ing.subFichaId) out.push(...itensDaFicha(ing.subFichaId, vis));
        else if (ing.itemId) out.push(ing.itemId);
      }
      return out;
    };

    const esgotados = new Set<string>();
    for (const p of alvo) {
      const fichas =
        p.tipo === 'combo' ? comboMap.get(p.id) ?? [] : p.fichaId ? [p.fichaId] : [];
      const itens = fichas.flatMap((f) => itensDaFicha(f, new Set()));
      if (itens.length && itens.some((it) => (saldo.get(it) ?? 0) <= 0))
        esgotados.add(p.id);
    }
    return esgotados;
  }

  // Menu público rico: loja (tema/hero/frete/pagamento) + produtos com
  // complementos (grupos min/max) + variações. Preço sempre do banco.
  async menu(token: string) {
    const cfg = await this.resolver(token);
    const cats = await this.db
      .select()
      .from(categoriaProduto)
      .where(eq(categoriaProduto.tenantId, cfg.tenantId))
      .orderBy(categoriaProduto.ordem);
    const prods: any = await this.db.execute(sql`
      select id, nome, descricao, preco_venda as "precoVenda",
             preco_promocional as "precoPromocional", categoria_id as "categoriaId",
             imagem_ref as "imagemRef", selos, duracao_min as "duracaoMin",
             tipo, ficha_id as "fichaId", controla_estoque as "controlaEstoque",
             destaque
      from produto
      where tenant_id = ${cfg.tenantId} and deleted_at is null
        and ativo = true and disponivel_cardapio = true
      order by nome
    `);
    const lista = (prods.rows ?? prods) as any[];
    const ids = lista.map((p) => p.id);

    // Esgotado automático pelo ledger: produto que controla estoque e cujo
    // insumo (item) tem saldo <= 0 fica marcado como esgotado no cardápio.
    const esgotados = await this.computeEsgotados(cfg.tenantId, lista);

    // Complementos (grupos + opções) e variações em lote.
    const grupos = ids.length
      ? await this.db
          .select()
          .from(complementoGrupo)
          .where(
            and(
              eq(complementoGrupo.tenantId, cfg.tenantId),
              inArray(complementoGrupo.produtoId, ids),
            ),
          )
          .orderBy(complementoGrupo.ordem)
      : [];
    const opcoes = grupos.length
      ? await this.db
          .select()
          .from(complementoOpcao)
          .where(eq(complementoOpcao.tenantId, cfg.tenantId))
          .orderBy(complementoOpcao.ordem)
      : [];
    const variacoes = ids.length
      ? await this.db
          .select()
          .from(produtoVariacao)
          .where(inArray(produtoVariacao.produtoId, ids))
      : [];

    return {
      loja: {
        nome: cfg.nomePublico ?? 'Cardápio',
        ramo: cfg.ramo,
        logoEmoji: cfg.logoEmoji,
        subtitulo: cfg.subtitulo,
        aberto: cfg.aberto,
        tempoEntregaMin: cfg.tempoEntregaMin,
        pedidoMinimo: cfg.pedidoMinimo != null ? Number(cfg.pedidoMinimo) : null,
        avaliacao: cfg.avaliacao != null ? Number(cfg.avaliacao) : null,
        freteGratisAcima:
          cfg.freteGratisAcima != null ? Number(cfg.freteGratisAcima) : null,
        pagamentos: cfg.pagamentos ?? [],
        formasCartao: cfg.formasCartao ?? [],
        fidelidadeAtiva: cfg.fidelidadeAtiva,
        whatsapp: cfg.whatsapp,
        parcelasMax: cfg.parcelasMax ?? null,
      },
      modo: cfg.modo,
      bairros: (await this.listarBairros(cfg.tenantId, cfg.unidadeId)).map((b) => ({
        id: b.id,
        nome: b.nome,
        taxa: Number(b.taxa),
      })),
      categorias: cats.map((c) => ({ id: c.id, nome: c.nome })),
      produtos: lista.map((p: any) => {
        const promo = p.precoPromocional != null ? Number(p.precoPromocional) : null;
        return {
          id: p.id,
          nome: p.nome,
          descricao: p.descricao,
          precoVenda: promo ?? Number(p.precoVenda),
          precoDe: promo != null ? Number(p.precoVenda) : null,
          categoriaId: p.categoriaId,
          imagemRef: p.imagemRef,
          selos: p.selos ?? [],
          duracaoMin: p.duracaoMin,
          destaque: p.destaque === true,
          esgotado: esgotados.has(p.id),
          variacoes: variacoes
            .filter((v) => v.produtoId === p.id && v.ativo !== false)
            .map((v) => ({
              id: v.id,
              nome: v.nome,
              precoVenda: Number(v.precoVenda),
              atributos: v.atributos ?? {},
            })),
          grupos: grupos
            .filter((g) => g.produtoId === p.id)
            .map((g) => ({
              id: g.id,
              nome: g.nome,
              tipo: g.tipo,
              min: g.min,
              max: g.max,
              obrigatorio: g.obrigatorio,
              opcoes: opcoes
                .filter((o) => o.grupoId === g.id)
                .map((o) => ({
                  id: o.id,
                  nome: o.nome,
                  precoDelta: Number(o.precoDelta),
                })),
            })),
        };
      }),
    };
  }

  // Público: valida um cupom para um subtotal.
  async validarCupomPublico(token: string, codigo: string, subtotal: number) {
    const cfg = await this.resolver(token);
    return this.avaliarCupom(cfg.tenantId, codigo, Number(subtotal) || 0);
  }

  // Público: status do pedido (timeline) por id.
  async statusPedido(token: string, pedidoId: string) {
    const cfg = await this.resolver(token);
    const [p] = await this.db
      .select()
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.id, pedidoId),
          eq(pedidoExterno.tenantId, cfg.tenantId),
        ),
      );
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    return {
      id: p.id,
      displayId: p.displayId,
      status: p.status,
      statusPagamento: p.statusPagamento,
      tipo: p.tipo,
      total: Number(p.total),
      taxaEntrega: Number(p.taxaEntrega),
      desconto: Number(p.desconto),
      itens: p.itens,
      criadoEm: p.criadoEm,
    };
  }

  // Público: pagamento online (MOCK — o gateway real é o "plug"). Aprova.
  async pagarPedidoPublico(token: string, pedidoId: string) {
    const cfg = await this.resolver(token);
    const [p] = await this.db
      .select()
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.id, pedidoId),
          eq(pedidoExterno.tenantId, cfg.tenantId),
        ),
      );
    if (!p) throw new NotFoundException('Pedido não encontrado.');
    if (p.pago) return { ok: true, jaPago: true };
    await this.db
      .update(pedidoExterno)
      .set({ pago: true, statusPagamento: 'aprovado' })
      .where(eq(pedidoExterno.id, pedidoId));
    return { ok: true, statusPagamento: 'aprovado' };
  }

  // Resolve as opções escolhidas (por id) validando o tenant. Preço do banco.
  private async resolverOpcoes(tenantId: string, opcaoIds: string[]) {
    if (!opcaoIds?.length) return { precoDelta: 0, labels: [] as string[] };
    const ops = await this.db
      .select({ nome: complementoOpcao.nome, precoDelta: complementoOpcao.precoDelta })
      .from(complementoOpcao)
      .where(
        and(
          eq(complementoOpcao.tenantId, tenantId),
          inArray(complementoOpcao.id, opcaoIds),
        ),
      );
    return {
      precoDelta: ops.reduce((s, o) => s + Number(o.precoDelta), 0),
      labels: ops.map((o) => o.nome),
    };
  }

  // Recebe o pedido do cliente. Preço/complementos vêm SEMPRE do banco.
  async receberPedido(
    token: string,
    dto: {
      mesa?: string;
      cliente?: string;
      telefone?: string;
      tipo?: string; // entrega | retirada
      endereco?: string; // texto livre (compat/legado)
      rua?: string;
      numero?: string;
      referencia?: string;
      telefone2?: string;
      bairroId?: string;
      formaPagamento?: string;
      bandeira?: string; // forma de cartão escolhida (rótulo)
      trocoPara?: number;
      cupom?: string;
      agendamento?: string; // serviços: data/hora
      profissional?: string; // serviços
      cnpj?: string; // indústria: faturamento
      itens: {
        produtoId: string;
        variacaoId?: string;
        quantidade: number;
        complementos?: string[];
        observacao?: string;
      }[];
    },
  ) {
    const cfg = await this.resolver(token);
    if (!dto.itens?.length) throw new BadRequestException('Pedido vazio.');
    const ids = [...new Set(dto.itens.map((i) => i.produtoId))];
    const prods = await this.db
      .select({
        id: produto.id,
        nome: produto.nome,
        precoVenda: produto.precoVenda,
        precoPromocional: produto.precoPromocional,
        ativo: produto.ativo,
      })
      .from(produto)
      .where(and(eq(produto.tenantId, cfg.tenantId), inArray(produto.id, ids)));
    const porId = new Map(prods.map((p) => [p.id, p]));
    for (const it of dto.itens) {
      const p = porId.get(it.produtoId);
      if (!p || p.ativo === false)
        throw new BadRequestException('Produto indisponível no pedido.');
    }

    // Modo MESA (QR na mesa): itens vão para a comanda (adicionarItem resolve
    // preço, variação e complementos internamente).
    if (cfg.modo === 'mesa' && dto.mesa) {
      const comandaId = await this.comandaDaMesa(cfg.tenantId, cfg.unidadeId, dto.mesa);
      for (const it of dto.itens) {
        await this.vendas.adicionarItem(cfg.tenantId, null as any, comandaId, {
          produtoId: it.produtoId,
          variacaoId: it.variacaoId,
          quantidade: Number(it.quantidade) || 1,
          complementos: it.complementos,
          observacao: it.observacao,
        });
      }
      return { ok: true, modo: 'mesa', mesa: dto.mesa };
    }

    // Modo RETIRADA/TOTEM: pedido externo com preço/rótulos calculados no servidor.
    const itensOut: any[] = [];
    let total = 0;
    for (const it of dto.itens) {
      const p = porId.get(it.produtoId)!;
      let base = p.precoPromocional != null ? Number(p.precoPromocional) : Number(p.precoVenda);
      let desc = p.nome;
      if (it.variacaoId) {
        const [v] = await this.db
          .select()
          .from(produtoVariacao)
          .where(eq(produtoVariacao.id, it.variacaoId));
        if (v) {
          base = Number(v.precoVenda);
          desc = `${p.nome} · ${v.nome}`;
        }
      }
      const { precoDelta, labels } = await this.resolverOpcoes(cfg.tenantId, it.complementos ?? []);
      const qtd = Number(it.quantidade) || 1;
      const preco = base + precoDelta;
      total += preco * qtd;
      itensOut.push({
        produtoId: it.produtoId,
        variacaoId: it.variacaoId,
        descricao: labels.length ? `${desc} (${labels.join(', ')})` : desc,
        quantidade: qtd,
        precoUnitario: preco,
        observacao: it.observacao,
      });
    }
    // Checkout: tipo, frete (bairro), cupom, pagamento.
    const tipo = dto.tipo === 'entrega' ? 'entrega' : 'retirada';
    let taxa = 0;
    let bairroNome: string | undefined;
    if (tipo === 'entrega') {
      if (dto.bairroId) {
        const [b] = await this.db
          .select()
          .from(cardapioBairro)
          .where(
            and(
              eq(cardapioBairro.id, dto.bairroId),
              eq(cardapioBairro.tenantId, cfg.tenantId),
            ),
          );
        taxa = b ? Number(b.taxa) : 0;
        bairroNome = b?.nome;
      }
      // frete grátis acima de X
      if (cfg.freteGratisAcima != null && total >= Number(cfg.freteGratisAcima)) taxa = 0;
    }
    // Endereço estruturado → compõe o texto p/ impressão/compatibilidade.
    const enderecoTexto =
      tipo === 'entrega'
        ? [
            [dto.rua, dto.numero].filter(Boolean).join(', '),
            bairroNome,
            dto.referencia ? `ref: ${dto.referencia}` : '',
          ]
            .filter((s) => s && s.trim())
            .join(' · ') || dto.endereco
        : undefined;
    const cup = await this.avaliarCupom(cfg.tenantId, dto.cupom ?? '', total);
    const desconto = cup.valido ? cup.desconto : 0;
    // Indústria (B2B): pedido é ORÇAMENTO — sem cobrança online, fatura por CNPJ.
    const orcamento = cfg.ramo === 'industria';
    const forma = orcamento ? 'faturamento' : dto.formaPagamento ?? 'entrega';
    const online = !orcamento && (forma === 'pix' || forma === 'cartao');
    const grande = Math.max(0, total - desconto + taxa);

    // Senha PRÓPRIA do cardápio (contador sequencial por tenant do canal).
    const cnt: any = await this.db.execute(
      sql`select count(*)::int as c from pedido_externo where tenant_id = ${cfg.tenantId} and canal = 'cardapio'`,
    );
    const senhaCardapio = String((((cnt.rows ?? cnt)[0]?.c ?? 0) as number) + 1);

    const ped = await this.delivery.ingest(
      cfg.tenantId,
      cfg.unidadeId,
      'cardapio',
      {
        cliente: dto.cliente ?? 'Cardápio',
        clienteTelefone: dto.telefone,
        tipo,
        endereco: enderecoTexto ?? dto.endereco,
        formaPagamento: forma,
        total: grande,
        displayId: senhaCardapio,
        itens: itensOut,
      },
      {
        taxaEntrega: taxa,
        cupom: cup.valido ? cup.codigo : undefined,
        desconto,
        trocoPara: dto.trocoPara,
        statusPagamento: orcamento
          ? 'orcamento'
          : online
            ? 'aguardando'
            : 'na_entrega',
        agendamento: dto.agendamento,
        profissional: dto.profissional,
        cnpj: dto.cnpj,
        clienteTelefone2: tipo === 'entrega' ? dto.telefone2 : undefined,
        enderecoRua: tipo === 'entrega' ? dto.rua : undefined,
        enderecoNumero: tipo === 'entrega' ? dto.numero : undefined,
        enderecoReferencia: tipo === 'entrega' ? dto.referencia : undefined,
        enderecoBairro: tipo === 'entrega' ? bairroNome : undefined,
        bandeira: dto.bandeira,
      },
    );

    // Envio automático ao KDS: aceita o pedido na hora (cria comanda + produção
    // com senha local + selo da plataforma). Orçamento (indústria) não produz.
    if (cfg.autoKds !== false && !orcamento && (ped as any)?.status === 'novo') {
      try {
        await this.delivery.aceitar(cfg.tenantId, null, ped.id);
      } catch {
        /* mantém o pedido em 'novo' se a produção falhar */
      }
    }

    // Fidelidade (L5): acumula pontos por telefone (1 ponto por real, arred.).
    let pontos: number | undefined;
    if (cfg.fidelidadeAtiva && dto.telefone) {
      pontos = await this.acumularPontos(
        cfg.tenantId,
        dto.telefone,
        dto.cliente,
        grande,
      );
    }

    return {
      ok: true,
      modo: tipo,
      pedidoId: ped.id,
      displayId: ped.displayId,
      total: grande,
      taxaEntrega: taxa,
      desconto,
      pagamentoOnline: online,
      orcamento,
      agendamento: dto.agendamento ?? null,
      pontos,
    };
  }

  // Fidelidade: soma pontos (1/real) ao saldo do telefone; devolve saldo novo.
  private async acumularPontos(
    tenantId: string,
    telefone: string,
    nome: string | undefined,
    valor: number,
  ): Promise<number> {
    const ganho = Math.round(Number(valor) || 0);
    const tel = telefone.replace(/\D/g, '');
    if (!tel) return 0;
    const [ja] = await this.db
      .select()
      .from(fidelidadeCliente)
      .where(
        and(
          eq(fidelidadeCliente.tenantId, tenantId),
          eq(fidelidadeCliente.telefone, tel),
        ),
      );
    if (ja) {
      const novo = (ja.pontos ?? 0) + ganho;
      await this.db
        .update(fidelidadeCliente)
        .set({ pontos: novo, nome: nome ?? ja.nome, atualizadoEm: new Date() })
        .where(eq(fidelidadeCliente.id, ja.id));
      return novo;
    }
    await this.db
      .insert(fidelidadeCliente)
      .values({ tenantId, telefone: tel, nome: nome ?? null, pontos: ganho });
    return ganho;
  }

  // Público: consulta o saldo de pontos por telefone.
  async pontosPublico(token: string, telefone: string) {
    const cfg = await this.resolver(token);
    if (!cfg.fidelidadeAtiva) return { ativo: false, pontos: 0 };
    const tel = (telefone ?? '').replace(/\D/g, '');
    if (!tel) return { ativo: true, pontos: 0 };
    const [row] = await this.db
      .select()
      .from(fidelidadeCliente)
      .where(
        and(
          eq(fidelidadeCliente.tenantId, cfg.tenantId),
          eq(fidelidadeCliente.telefone, tel),
        ),
      );
    return { ativo: true, pontos: row?.pontos ?? 0, nome: row?.nome ?? null };
  }

  // Acha (ou abre) a mesa pelo número e devolve a comanda ativa dela.
  private async comandaDaMesa(
    tenantId: string,
    unidadeId: string | null,
    numero: string,
  ): Promise<string> {
    const [m] = await this.db
      .select()
      .from(mesa)
      .where(
        and(
          eq(mesa.tenantId, tenantId),
          eq(mesa.numero, String(numero)),
          eq(mesa.status, 'aberta'),
        ),
      );
    let mesaId = m?.id;
    if (!mesaId) {
      const nova = await this.vendas.abrirMesa(tenantId, null as any, {
        numero: String(numero),
        modo: 'mesa',
        unidadeId: unidadeId ?? undefined,
      });
      mesaId = nova.id;
    }
    const [c] = await this.db
      .select({ id: comanda.id })
      .from(comanda)
      .where(and(eq(comanda.mesaId, mesaId), eq(comanda.status, 'aberta')));
    if (c) return c.id;
    // mesa sem comanda aberta (ex.: modo comandas) → abre uma
    const nc = await this.vendas.abrirComandaNaMesa(tenantId, null as any, mesaId, {});
    return nc.id;
  }
}
