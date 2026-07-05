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
  categoriaProduto,
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

  // Menu público: categorias + produtos ativos (nome, descrição, preço).
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
    return {
      nome: cfg.nomePublico ?? 'Cardápio',
      modo: cfg.modo,
      categorias: cats.map((c) => ({ id: c.id, nome: c.nome })),
      produtos: (prods.rows ?? prods).map((p: any) => {
        const promo = p.precoPromocional != null ? Number(p.precoPromocional) : null;
        return {
          id: p.id,
          nome: p.nome,
          descricao: p.descricao,
          precoVenda: promo ?? Number(p.precoVenda), // preço efetivo
          precoDe: promo != null ? Number(p.precoVenda) : null, // "de" quando há promoção
          categoriaId: p.categoriaId,
          imagemRef: p.imagemRef,
          selos: p.selos ?? [],
          duracaoMin: p.duracaoMin,
        };
      }),
    };
  }

  // Recebe o pedido do cliente. Preço vem SEMPRE do banco (nunca do cliente).
  async receberPedido(
    token: string,
    dto: {
      mesa?: string;
      cliente?: string;
      itens: { produtoId: string; quantidade: number; observacao?: string }[];
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

    // Modo MESA (QR na mesa): itens vão para a comanda da mesa.
    if (cfg.modo === 'mesa' && dto.mesa) {
      const comandaId = await this.comandaDaMesa(
        cfg.tenantId,
        cfg.unidadeId,
        dto.mesa,
      );
      for (const it of dto.itens) {
        await this.vendas.adicionarItem(cfg.tenantId, null as any, comandaId, {
          produtoId: it.produtoId,
          quantidade: Number(it.quantidade) || 1,
          observacao: it.observacao,
        });
      }
      return { ok: true, modo: 'mesa', mesa: dto.mesa };
    }

    // Modo RETIRADA/TOTEM: vira um pedido externo (canal 'cardapio').
    const total = dto.itens.reduce(
      (s, it) => s + Number(porId.get(it.produtoId)!.precoVenda) * (Number(it.quantidade) || 1),
      0,
    );
    const ped = await this.delivery.ingest(cfg.tenantId, cfg.unidadeId, 'cardapio', {
      cliente: dto.cliente ?? 'Cardápio',
      tipo: 'retirada',
      total,
      itens: dto.itens.map((it) => {
        const p = porId.get(it.produtoId)!;
        return {
          produtoId: it.produtoId,
          descricao: p.nome,
          quantidade: Number(it.quantidade) || 1,
          precoUnitario: Number(p.precoVenda),
          observacao: it.observacao,
        };
      }),
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
