import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  fichaTecnica,
  fichaIngrediente,
  movimentoEstoque,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { qtdBaixaExplosao } from '../../common/regras-negocio';
import { custoMedioDaSaida, ponderarCustoDaEntrada } from '../../common/custo-loja';
import { ProduzirDto } from './dto/produzir.dto';
import { hojeISO } from '../../common/data';
import { consumirLotes } from '../../common/lotes';

/* eslint-disable @typescript-eslint/no-explicit-any */

@Injectable()
export class ProducaoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Explode `qtdProduzir` unidades da ficha nos ITENS-RAIZ (acumula em consumoPorItem)
  // e devolve o custo teórico total. Sub-fichas explodem recursivamente; `visitados`
  // barra ciclo (A usa B usa A). Um item que aparece por vários caminhos é agregado.
  private async explodir(
    tx: any,
    tenantId: string,
    fichaId: string,
    qtdProduzir: number,
    consumoPorItem: Map<string, number>,
    visitados: Set<string>,
    // Loja da produção e a origem (mig 257): o custo do insumo é o DA LOJA que produz.
    loja: { unidadeId: string | null; refId: string },
  ): Promise<number> {
    if (visitados.has(fichaId)) {
      throw new BadRequestException('Ciclo de fichas detectado na explosão.');
    }
    const [ficha] = await tx
      .select()
      .from(fichaTecnica)
      .where(and(eq(fichaTecnica.id, fichaId), eq(fichaTecnica.tenantId, tenantId)));
    if (!ficha) throw new NotFoundException('Ficha não encontrada');
    const rendimento = Number(ficha.rendimento) || 1;

    const ings = await tx
      .select()
      .from(fichaIngrediente)
      // Ingrediente removido (soft-delete da mig 242) não entra na produção nem no custo.
      .where(and(eq(fichaIngrediente.fichaId, fichaId), isNull(fichaIngrediente.deletedAt)));

    const proximos = new Set(visitados);
    proximos.add(fichaId);
    let custoTotal = 0;

    for (const ing of ings) {
      // Linha `somente_delivery` (mig 147) é embalagem de pedido EXTERNO: só a venda de
      // delivery a consome. A venda já pulava (`vendas.acumularFicha`); a produção não,
      // então produzir uma ficha com caixa de delivery baixava caixa do estoque e ainda
      // somava o custo dela no custo do item produzido. Vale para sub-fichas também,
      // porque a recursão passa por aqui.
      if (ing.somenteDelivery) continue;
      const baixa = qtdBaixaExplosao(
        Number(ing.quantidade),
        Number(ing.fatorCorrecao),
        qtdProduzir,
        rendimento,
      );
      if (baixa <= 0) continue;

      if (ing.subFichaId) {
        // Sub-receita: explode `baixa` unidades dela nos itens-raiz.
        custoTotal += await this.explodir(
          tx,
          tenantId,
          ing.subFichaId,
          baixa,
          consumoPorItem,
          proximos,
          loja,
        );
      } else if (ing.itemId) {
        const cm = await custoMedioDaSaida(
          tx, tenantId, ing.itemId, loja.unidadeId, 'producao', loja.refId,
        );
        const custoUnit = Number(cm ?? ing.custoUnitario) || 0;
        consumoPorItem.set(
          ing.itemId,
          (consumoPorItem.get(ing.itemId) ?? 0) + baixa,
        );
        custoTotal += baixa * custoUnit;
      } else {
        // Insumo avulso (sem estoque): entra só no custo teórico.
        custoTotal += baixa * (Number(ing.custoUnitario) || 0);
      }
    }
    return custoTotal;
  }

  // Explosão de ficha (§1.2): baixa insumos (saída ao custo médio) e, se houver
  // item de saída, dá entrada do produto ao custo teórico. Idempotente por refId.
  //
  // `txExterna`: quando o chamador já está numa transação (a ordem de produção trava
  // a linha e conclui no mesmo commit), a explosão roda NA MESMA transação. Abrir uma
  // transação própria aqui significaria commit independente — estoque baixado com a
  // ordem não encerrada se o passo seguinte falhasse.
  async produzir(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: ProduzirDto,
    txExterna?: any,
    // Loja da produção (mig 253). Vem do CÓDIGO, nunca do corpo do request: a ordem passa
    // a dela; a produção manual, a loja da sessão. Sem ela, o gatilho resolve pela ordem.
    unidadeId?: string | null,
  ) {
    const refId = dto.refId ?? randomUUID();
    const qtd = Number(dto.quantidade);

    try {
      const corpo = async (tx: any) => {
        // Explosão recursiva (fichas aninhadas): agrega consumo nos itens-raiz.
        const consumoPorItem = new Map<string, number>();
        const custoTotal = await this.explodir(
          tx,
          tenantId,
          dto.fichaId,
          qtd,
          consumoPorItem,
          new Set(),
          { unidadeId: unidadeId ?? null, refId },
        );

        // Lança a saída (uma por item agregado).
        let baixados = 0;
        for (const [itemId, quantidade] of consumoPorItem) {
          const custoMedio = await custoMedioDaSaida(
            tx, tenantId, itemId, unidadeId, 'producao', refId,
          );
          const [mov] = await tx
            .insert(movimentoEstoque)
            .values({
              tenantId,
              unidadeId: unidadeId ?? undefined,
              itemId,
              tipo: 'saida',
              quantidade: String(quantidade),
              custoUnitario: custoMedio ?? undefined,
              motivo: 'producao',
              refTipo: 'producao',
              refId,
              data: hojeISO(),
            })
            .returning({ id: movimentoEstoque.id });
          // PVPS/FEFO (mig 248): o insumo que entra na receita sai do lote mais velho.
          await consumirLotes(tx, tenantId, itemId, quantidade, mov.id);
          baixados++;
        }

        // Entrada do produto acabado ao custo teórico (opcional).
        const custoUnitProduzido = qtd > 0 ? custoTotal / qtd : 0;
        if (dto.itemSaidaId) {
          const [entrada] = await tx.insert(movimentoEstoque).values({
            tenantId,
            unidadeId: unidadeId ?? undefined,
            itemId: dto.itemSaidaId,
            tipo: 'entrada',
            quantidade: String(qtd),
            custoUnitario: String(custoUnitProduzido),
            motivo: 'producao',
            refTipo: 'producao',
            refId,
            data: hojeISO(),
          }).returning({ id: movimentoEstoque.id });
          // Custo médio do produzido DA LOJA que produziu (mig 257).
          await ponderarCustoDaEntrada(
            tx, tenantId, entrada.id, dto.itemSaidaId, qtd, custoUnitProduzido,
          );
        }

        return {
          refId,
          fichaId: dto.fichaId,
          quantidade: qtd,
          insumosBaixados: baixados,
          custoTotal: Number(custoTotal.toFixed(2)),
          custoUnitProduzido: Number(custoUnitProduzido.toFixed(2)),
        };
      };
      const res = txExterna
        ? await corpo(txExterna)
        : await this.db.transaction(corpo);

      await this.auditoria.registrar({
        tenantId,
        atorId,
        atorPerfil,
        tipo: 'estoque',
        acao: 'produziu_ficha',
        entidadeTipo: 'ficha_tecnica',
        entidadeId: dto.fichaId,
        detalhe: { refId, quantidade: qtd, custoTotal: res.custoTotal },
      });
      return res;
    } catch (e: any) {
      if (e?.code === '23505') {
        throw new BadRequestException(
          'Produção já registrada (refId duplicado) — operação idempotente.',
        );
      }
      throw e;
    }
  }
}
