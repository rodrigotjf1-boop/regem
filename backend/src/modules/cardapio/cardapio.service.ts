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
             imagem_ref as "imagemRef", selos, duracao_min as "duracaoMin"
      from produto
      where tenant_id = ${cfg.tenantId} and deleted_at is null
        and ativo = true and disponivel_cardapio = true
      order by nome
    `);
    const lista = (prods.rows ?? prods) as any[];
    const ids = lista.map((p) => p.id);

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
        fidelidadeAtiva: cfg.fidelidadeAtiva,
        whatsapp: cfg.whatsapp,
      },
      modo: cfg.modo,
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
          variacoes: variacoes
            .filter((v) => v.produtoId === p.id && v.ativo !== false)
            .map((v) => ({ id: v.id, nome: v.nome, precoVenda: Number(v.precoVenda) })),
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
    const ped = await this.delivery.ingest(cfg.tenantId, cfg.unidadeId, 'cardapio', {
      cliente: dto.cliente ?? 'Cardápio',
      tipo: 'retirada',
      total,
      itens: itensOut,
    });
    return { ok: true, modo: 'retirada', pedidoId: ped.id, displayId: ped.displayId };
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
