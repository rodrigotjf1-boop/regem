import { BadRequestException, Inject, Injectable } from '@nestjs/common';
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

        // Baixa de estoque
        if (p.controlaEstoque) {
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
                  qtd * fatorFicha * (Number(c.q) || 1),
                );
            }
          } else if (p.fichaId) {
            await this.baixaFicha(tx, tenantId, p.fichaId, qtd * fatorFicha);
          }
        }

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
}
