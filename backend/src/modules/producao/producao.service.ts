import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  fichaTecnica,
  fichaIngrediente,
  itemEstoque,
  movimentoEstoque,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  qtdBaixaExplosao,
  custoMedioPonderado,
} from '../../common/regras-negocio';
import { ProduzirDto } from './dto/produzir.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

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
      .where(eq(fichaIngrediente.fichaId, fichaId));

    const proximos = new Set(visitados);
    proximos.add(fichaId);
    let custoTotal = 0;

    for (const ing of ings) {
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
        );
      } else if (ing.itemId) {
        const [item] = await tx
          .select({ custoMedio: itemEstoque.custoMedio })
          .from(itemEstoque)
          .where(eq(itemEstoque.id, ing.itemId));
        const custoUnit = Number(item?.custoMedio ?? ing.custoUnitario) || 0;
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
  async produzir(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: ProduzirDto,
  ) {
    const refId = dto.refId ?? randomUUID();
    const qtd = Number(dto.quantidade);

    try {
      const res = await this.db.transaction(async (tx) => {
        // Explosão recursiva (fichas aninhadas): agrega consumo nos itens-raiz.
        const consumoPorItem = new Map<string, number>();
        const custoTotal = await this.explodir(
          tx,
          tenantId,
          dto.fichaId,
          qtd,
          consumoPorItem,
          new Set(),
        );

        // Lança a saída (uma por item agregado).
        let baixados = 0;
        for (const [itemId, quantidade] of consumoPorItem) {
          const [item] = await tx
            .select({ custoMedio: itemEstoque.custoMedio })
            .from(itemEstoque)
            .where(eq(itemEstoque.id, itemId));
          await tx.insert(movimentoEstoque).values({
            tenantId,
            itemId,
            tipo: 'saida',
            quantidade: String(quantidade),
            custoUnitario: item?.custoMedio ?? undefined,
            motivo: 'producao',
            refTipo: 'producao',
            refId,
            data: hojeISO(),
          });
          baixados++;
        }

        // Entrada do produto acabado ao custo teórico (opcional).
        const custoUnitProduzido = qtd > 0 ? custoTotal / qtd : 0;
        if (dto.itemSaidaId) {
          const s: any = await tx.execute(
            sql`select coalesce(sum(case tipo when 'entrada' then quantidade when 'saida' then -quantidade else quantidade end),0) as saldo
                from movimento_estoque where tenant_id=${tenantId} and item_id=${dto.itemSaidaId}`,
          );
          const saldoAntes = Number((s.rows ?? s)[0].saldo);
          await tx.insert(movimentoEstoque).values({
            tenantId,
            itemId: dto.itemSaidaId,
            tipo: 'entrada',
            quantidade: String(qtd),
            custoUnitario: String(custoUnitProduzido),
            motivo: 'producao',
            refTipo: 'producao',
            refId,
            data: hojeISO(),
          });
          const [prod] = await tx
            .select({ custoMedio: itemEstoque.custoMedio })
            .from(itemEstoque)
            .where(eq(itemEstoque.id, dto.itemSaidaId));
          const novo = custoMedioPonderado(
            saldoAntes,
            Number(prod?.custoMedio ?? 0),
            qtd,
            custoUnitProduzido,
          );
          await tx
            .update(itemEstoque)
            .set({ custoMedio: String(novo), updatedAt: new Date() })
            .where(
              and(
                eq(itemEstoque.id, dto.itemSaidaId),
                eq(itemEstoque.tenantId, tenantId),
              ),
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
      });

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
