import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  comanda,
  comandaItem,
  produto,
  produtoVariacao,
  produtoComboItem,
  fichaTecnica,
  fichaIngrediente,
  itemEstoque,
  movimentoEstoque,
  lancamentoCaixa,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { VendaBalcaoDto } from './dto/venda-balcao.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class VendasService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly events: EventEmitter2,
  ) {}

  // Baixa por explosão de UMA ficha: cada insumo (com item de estoque) sai valorado
  // ao custo médio. multiplicador = qtd vendida × fator da variação × qtd do combo.
  private async baixaFicha(
    tx: any,
    tenantId: string,
    fichaId: string,
    multiplicador: number,
  ) {
    const [ficha] = await tx
      .select({ rendimento: fichaTecnica.rendimento })
      .from(fichaTecnica)
      .where(eq(fichaTecnica.id, fichaId));
    const rendimento = Number(ficha?.rendimento) || 1;
    const ings = await tx
      .select()
      .from(fichaIngrediente)
      .where(eq(fichaIngrediente.fichaId, fichaId));
    for (const ing of ings) {
      if (!ing.itemId) continue; // insumo não ligado ao estoque → não baixa
      const consumo =
        ((Number(ing.quantidade) * Number(ing.fatorCorrecao)) / rendimento) *
        multiplicador;
      if (consumo <= 0) continue;
      const [item] = await tx
        .select({ custoMedio: itemEstoque.custoMedio })
        .from(itemEstoque)
        .where(eq(itemEstoque.id, ing.itemId));
      await tx.insert(movimentoEstoque).values({
        tenantId,
        itemId: ing.itemId,
        tipo: 'saida',
        quantidade: String(consumo),
        custoUnitario: item?.custoMedio != null ? String(item.custoMedio) : undefined,
        motivo: 'venda',
        data: hojeISO(),
      });
    }
  }

  // Baixa de um produto vendido (simples/variável/combo), respeitando controla_estoque.
  private async baixaProduto(
    tx: any,
    tenantId: string,
    p: any,
    fatorFicha: number,
    quantidade: number,
  ) {
    if (!p.controlaEstoque) return;
    if (p.tipo === 'combo') {
      const comps = await tx
        .select({
          fichaId: produto.fichaId,
          controla: produto.controlaEstoque,
          q: produtoComboItem.quantidade,
        })
        .from(produtoComboItem)
        .innerJoin(produto, eq(produto.id, produtoComboItem.componenteProdutoId))
        .where(eq(produtoComboItem.comboProdutoId, p.id));
      for (const c of comps) {
        if (c.fichaId && c.controla)
          await this.baixaFicha(
            tx,
            tenantId,
            c.fichaId,
            quantidade * fatorFicha * (Number(c.q) || 1),
          );
      }
    } else if (p.fichaId) {
      await this.baixaFicha(tx, tenantId, p.fichaId, quantidade * fatorFicha);
    }
  }

  // Venda balcão rápida: paga na hora → comanda fechada + baixa + caixa + pedido KDS.
  async vendaBalcao(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: VendaBalcaoDto,
  ) {
    if (!dto.itens?.length)
      throw new BadRequestException('Adicione ao menos um item.');

    const res = await this.db.transaction(async (tx) => {
      const taxa = Number(dto.taxaServicoPct) || 0;
      const [cmd] = await tx
        .insert(comanda)
        .values({
          tenantId,
          unidadeId: dto.unidadeId,
          mesa: dto.mesa,
          status: 'fechada',
          taxaServicoPct: String(taxa),
          fechadaEm: new Date(),
          abertaPorId: atorId,
        })
        .returning();

      let total = 0;
      const pedidoKds: any[] = [];

      for (const it of dto.itens) {
        const [p] = await tx
          .select()
          .from(produto)
          .where(and(eq(produto.id, it.produtoId), eq(produto.tenantId, tenantId)));
        if (!p) throw new BadRequestException('Produto inválido');
        const qtd = Number(it.quantidade) || 1;

        let preco = Number(p.precoVenda);
        let descricao = p.nome;
        let fatorFicha = 1;
        if (it.variacaoId) {
          const [v] = await tx
            .select()
            .from(produtoVariacao)
            .where(eq(produtoVariacao.id, it.variacaoId));
          if (v) {
            preco = Number(v.precoVenda);
            descricao = `${p.nome} · ${v.nome}`;
            fatorFicha = Number(v.fatorFicha) || 1;
          }
        }
        total += preco * qtd;

        await tx.insert(comandaItem).values({
          tenantId,
          comandaId: cmd.id,
          produtoId: p.id,
          variacaoId: it.variacaoId,
          fichaId: p.fichaId,
          descricao,
          quantidade: String(qtd),
          precoUnitario: String(preco),
          criadoPorId: atorId,
        });

        await this.baixaProduto(tx, tenantId, p, fatorFicha, qtd);

        if (p.vaiParaProducao)
          pedidoKds.push({
            descricao,
            quantidade: qtd,
            setorProducaoId: p.setorProducaoId ?? null,
          });
      }

      const totalComTaxa = total * (1 + taxa / 100);
      await tx.insert(lancamentoCaixa).values({
        tenantId,
        unidadeId: dto.unidadeId,
        tipo: 'entrada',
        valor: String(totalComTaxa.toFixed(2)),
        data: hojeISO(),
        categoria: 'venda',
        forma: dto.forma,
        descricao: dto.mesa ? `Venda balcão · mesa ${dto.mesa}` : 'Venda balcão',
        criadoPorId: atorId,
      });

      return {
        comandaId: cmd.id,
        subtotal: Number(total.toFixed(2)),
        taxaServicoPct: taxa,
        total: Number(totalComTaxa.toFixed(2)),
        pedidoKds,
        unidadeId: dto.unidadeId ?? null,
      };
    });

    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'venda',
      acao: 'venda_balcao',
      entidadeTipo: 'comanda',
      entidadeId: res.comandaId,
      detalhe: { total: res.total, itens: dto.itens.length },
    });

    // Pedido para o KDS de produção (tempo real).
    if (res.pedidoKds.length) {
      this.events.emit('kds.pedido', {
        tenantId,
        unidadeId: res.unidadeId,
        comandaId: res.comandaId,
        mesa: dto.mesa ?? null,
        itens: res.pedidoKds,
      });
    }

    return res;
  }

  // ===== Mesas & comandas (J3) =====
  async abrirComanda(
    tenantId: string,
    atorId: string,
    dto: { mesa?: string; cliente?: string; unidadeId?: string },
  ) {
    const [c] = await this.db
      .insert(comanda)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        mesa: dto.mesa,
        cliente: dto.cliente,
        status: 'aberta',
        abertaPorId: atorId,
      })
      .returning();
    return c;
  }

  async listarComandas(tenantId: string) {
    const res: any = await this.db.execute(sql`
      select c.id, c.mesa, c.cliente, c.aberta_em as "abertaEm",
             coalesce(sum(ci.quantidade * ci.preco_unitario),0) as total,
             count(ci.id) as itens
      from comanda c
      left join comanda_item ci on ci.comanda_id = c.id
      where c.tenant_id = ${tenantId} and c.status = 'aberta'
      group by c.id
      order by c.aberta_em desc
    `);
    return res.rows ?? res;
  }

  async getComanda(tenantId: string, id: string) {
    const [c] = await this.db
      .select()
      .from(comanda)
      .where(and(eq(comanda.id, id), eq(comanda.tenantId, tenantId)));
    if (!c) throw new NotFoundException('Comanda não encontrada');
    const itens = await this.db
      .select()
      .from(comandaItem)
      .where(eq(comandaItem.comandaId, id));
    return { ...c, itens };
  }

  async adicionarItem(
    tenantId: string,
    atorId: string,
    comandaId: string,
    dto: { produtoId: string; variacaoId?: string; quantidade: number },
  ) {
    const [c] = await this.db
      .select()
      .from(comanda)
      .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
    if (!c) throw new NotFoundException('Comanda não encontrada');
    if (c.status !== 'aberta')
      throw new BadRequestException('Comanda não está aberta');

    const [p] = await this.db
      .select()
      .from(produto)
      .where(and(eq(produto.id, dto.produtoId), eq(produto.tenantId, tenantId)));
    if (!p) throw new BadRequestException('Produto inválido');

    let preco = Number(p.precoVenda);
    let descricao = p.nome;
    if (dto.variacaoId) {
      const [v] = await this.db
        .select()
        .from(produtoVariacao)
        .where(eq(produtoVariacao.id, dto.variacaoId));
      if (v) {
        preco = Number(v.precoVenda);
        descricao = `${p.nome} · ${v.nome}`;
      }
    }
    const qtd = Number(dto.quantidade) || 1;
    const [item] = await this.db
      .insert(comandaItem)
      .values({
        tenantId,
        comandaId,
        produtoId: p.id,
        variacaoId: dto.variacaoId,
        fichaId: p.fichaId,
        descricao,
        quantidade: String(qtd),
        precoUnitario: String(preco),
        criadoPorId: atorId,
      })
      .returning();

    // Cozinha começa já (o pedido vai pro KDS ao lançar, não ao fechar).
    if (p.vaiParaProducao) {
      this.events.emit('kds.pedido', {
        tenantId,
        unidadeId: c.unidadeId,
        comandaId,
        mesa: c.mesa,
        itens: [
          { descricao, quantidade: qtd, setorProducaoId: p.setorProducaoId ?? null },
        ],
      });
    }
    return item;
  }

  async removerItem(tenantId: string, itemId: string) {
    await this.db
      .delete(comandaItem)
      .where(
        and(eq(comandaItem.id, itemId), eq(comandaItem.tenantId, tenantId)),
      );
    return { ok: true };
  }

  // Fecha a comanda: baixa por explosão de todos os itens + caixa. (Pedido já foi ao KDS.)
  async fecharComanda(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    comandaId: string,
    dto: { forma?: string; taxaServicoPct?: number },
  ) {
    const res = await this.db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(comanda)
        .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
      if (!c) throw new NotFoundException('Comanda não encontrada');
      if (c.status !== 'aberta')
        throw new BadRequestException('Comanda não está aberta');

      const itens = await tx
        .select()
        .from(comandaItem)
        .where(eq(comandaItem.comandaId, comandaId));
      if (!itens.length)
        throw new BadRequestException('Comanda sem itens');

      let total = 0;
      for (const it of itens) {
        total += Number(it.precoUnitario) * Number(it.quantidade);
        const [p] = await tx
          .select()
          .from(produto)
          .where(eq(produto.id, it.produtoId as string));
        if (p) {
          let fator = 1;
          if (it.variacaoId) {
            const [v] = await tx
              .select()
              .from(produtoVariacao)
              .where(eq(produtoVariacao.id, it.variacaoId));
            if (v) fator = Number(v.fatorFicha) || 1;
          }
          await this.baixaProduto(tx, tenantId, p, fator, Number(it.quantidade));
        }
      }

      const taxa =
        dto.taxaServicoPct != null
          ? dto.taxaServicoPct
          : Number(c.taxaServicoPct) || 0;
      const totalComTaxa = total * (1 + taxa / 100);
      await tx.insert(lancamentoCaixa).values({
        tenantId,
        unidadeId: c.unidadeId,
        tipo: 'entrada',
        valor: String(totalComTaxa.toFixed(2)),
        data: hojeISO(),
        categoria: 'venda',
        forma: dto.forma,
        descricao: c.mesa ? `Comanda · mesa ${c.mesa}` : 'Comanda',
        criadoPorId: atorId,
      });
      await tx
        .update(comanda)
        .set({
          status: 'fechada',
          fechadaEm: new Date(),
          taxaServicoPct: String(taxa),
        })
        .where(eq(comanda.id, comandaId));

      return {
        comandaId,
        subtotal: Number(total.toFixed(2)),
        taxaServicoPct: taxa,
        total: Number(totalComTaxa.toFixed(2)),
      };
    });

    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'venda',
      acao: 'fechou_comanda',
      entidadeTipo: 'comanda',
      entidadeId: comandaId,
      detalhe: { total: res.total },
    });
    return res;
  }
}
