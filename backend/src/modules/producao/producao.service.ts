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
        const [ficha] = await tx
          .select()
          .from(fichaTecnica)
          .where(
            and(
              eq(fichaTecnica.id, dto.fichaId),
              eq(fichaTecnica.tenantId, tenantId),
            ),
          );
        if (!ficha) throw new NotFoundException('Ficha não encontrada');
        const rendimento = Number(ficha.rendimento) || 1;

        const ings = await tx
          .select()
          .from(fichaIngrediente)
          .where(eq(fichaIngrediente.fichaId, dto.fichaId));

        // Agrega consumo por item de estoque (um insumo pode repetir na ficha).
        const consumoPorItem = new Map<string, number>();
        let custoTotal = 0;

        for (const ing of ings) {
          const baixa = qtdBaixaExplosao(
            Number(ing.quantidade),
            Number(ing.fatorCorrecao),
            qtd,
            rendimento,
          );
          if (baixa <= 0) continue;

          // Custo unitário do insumo = custo médio do item (se ligado ao estoque),
          // senão o custo snapshot do ingrediente. Alimenta o custo teórico.
          let custoUnit = Number(ing.custoUnitario) || 0;
          if (ing.itemId) {
            const [item] = await tx
              .select({ custoMedio: itemEstoque.custoMedio })
              .from(itemEstoque)
              .where(eq(itemEstoque.id, ing.itemId));
            custoUnit = Number(item?.custoMedio ?? ing.custoUnitario) || 0;
            consumoPorItem.set(
              ing.itemId,
              (consumoPorItem.get(ing.itemId) ?? 0) + baixa,
            );
          }
          custoTotal += baixa * custoUnit;
        }

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
