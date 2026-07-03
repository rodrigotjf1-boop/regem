import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  recebimento,
  recebimentoItem,
  movimentoEstoque,
  lote,
  itemEstoque,
  tituloFinanceiro,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { CreateRecebimentoDto } from './dto/create-recebimento.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class RecebimentoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Cria o recebimento como rascunho (status 'aberto') — ainda NÃO mexe no estoque.
  async create(tenantId: string, dto: CreateRecebimentoDto) {
    return this.db.transaction(async (tx) => {
      const [rec] = await tx
        .insert(recebimento)
        .values({
          tenantId,
          unidadeId: dto.unidadeId,
          fornecedorId: dto.fornecedorId,
          data: dto.data ?? undefined,
          vencimento: dto.vencimento ?? undefined,
          notaRef: dto.notaRef,
          notaFotoRef: dto.notaFotoRef,
          obs: dto.obs,
          status: 'aberto',
        })
        .returning();

      if (dto.itens?.length) {
        await tx.insert(recebimentoItem).values(
          dto.itens.map((it) => ({
            tenantId,
            recebimentoId: rec.id,
            itemId: it.itemId,
            qtdEsperada: String(it.qtdEsperada ?? 0),
            qtdRecebida: String(it.qtdRecebida ?? 0),
            custoUnitario:
              it.custoUnitario != null ? String(it.custoUnitario) : undefined,
            divergencia: it.divergencia ?? 'ok',
            validade: it.validade,
            fotoRef: it.fotoRef,
            obs: it.obs,
          })),
        );
      }
      return rec;
    });
  }

  async findAll(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select r.id, r.data, r.status, r.nota_ref as "notaRef",
        f.nome as "fornecedorNome",
        (select count(*) from recebimento_item ri where ri.recebimento_id = r.id) as "itens",
        (select count(*) from recebimento_item ri
          where ri.recebimento_id = r.id and ri.divergencia <> 'ok') as "divergencias"
      from recebimento r
      left join fornecedor f on f.id = r.fornecedor_id
      where r.tenant_id = ${tenantId} and r.deleted_at is null
      order by r.data desc, r.created_at desc
    `);
    return (r.rows ?? r).map((x: any) => ({
      ...x,
      itens: Number(x.itens),
      divergencias: Number(x.divergencias),
    }));
  }

  async findOne(tenantId: string, id: string) {
    const h: any = await this.db.execute(sql`
      select r.*, f.nome as "fornecedorNome"
      from recebimento r
      left join fornecedor f on f.id = r.fornecedor_id
      where r.id = ${id} and r.tenant_id = ${tenantId} and r.deleted_at is null
    `);
    const header = (h.rows ?? h)[0];
    if (!header) throw new NotFoundException('Recebimento não encontrado');

    const it: any = await this.db.execute(sql`
      select ri.id, ri.item_id as "itemId", ri.qtd_esperada as "qtdEsperada",
        ri.qtd_recebida as "qtdRecebida", ri.divergencia, ri.validade,
        ri.obs, i.nome as "itemNome", i.unidade_medida as "unidade"
      from recebimento_item ri
      join item_estoque i on i.id = ri.item_id
      where ri.recebimento_id = ${id}
      order by i.nome
    `);
    return { ...header, itens: it.rows ?? it };
  }

  // Confirma: lança as entradas no ledger, cria lotes (se validade) e fecha.
  async confirmar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    id: string,
  ) {
    const res = await this.db.transaction(async (tx) => {
      const [rec] = await tx
        .select()
        .from(recebimento)
        .where(
          and(eq(recebimento.id, id), eq(recebimento.tenantId, tenantId)),
        );
      if (!rec) throw new NotFoundException('Recebimento não encontrado');
      if (rec.status === 'conferido') {
        throw new BadRequestException('Recebimento já confirmado');
      }

      const itens = await tx
        .select()
        .from(recebimentoItem)
        .where(eq(recebimentoItem.recebimentoId, id));

      let entradas = 0;
      let valorTotal = 0;
      for (const it of itens) {
        const qtd = Number(it.qtdRecebida);
        if (qtd > 0) {
          const custo =
            it.custoUnitario != null ? Number(it.custoUnitario) : null;
          if (custo != null) valorTotal += qtd * custo;

          // Saldo do item ANTES desta entrada (para o custo médio ponderado).
          let saldoAntes = 0;
          if (custo != null) {
            const s: any = await tx.execute(
              sql`select coalesce(sum(case tipo when 'entrada' then quantidade when 'saida' then -quantidade else quantidade end),0) as saldo
                  from movimento_estoque where tenant_id=${tenantId} and item_id=${it.itemId}`,
            );
            saldoAntes = Number((s.rows ?? s)[0].saldo);
          }

          await tx.insert(movimentoEstoque).values({
            tenantId,
            itemId: it.itemId,
            tipo: 'entrada',
            quantidade: String(qtd),
            custoUnitario: custo != null ? String(custo) : undefined,
            motivo: 'recebimento',
            data: rec.data,
          });
          entradas++;

          if (it.validade) {
            await tx.insert(lote).values({
              tenantId,
              itemId: it.itemId,
              recebimentoId: id,
              validade: it.validade,
              quantidade: String(qtd),
              custoUnitario: custo != null ? String(custo) : undefined,
              entrada: rec.data,
            });
          }

          // Custo médio ponderado móvel:
          // novo = (saldoAntes×custoMédioAtual + qtd×custoEntrada) / (saldoAntes + qtd)
          if (custo != null) {
            const [item] = await tx
              .select({ custoMedio: itemEstoque.custoMedio })
              .from(itemEstoque)
              .where(eq(itemEstoque.id, it.itemId));
            const base = Math.max(saldoAntes, 0);
            const cmAtual = Number(item?.custoMedio ?? 0);
            const novo =
              base + qtd > 0 ? (base * cmAtual + qtd * custo) / (base + qtd) : custo;
            await tx
              .update(itemEstoque)
              .set({ custoMedio: String(novo), updatedAt: new Date() })
              .where(
                and(
                  eq(itemEstoque.id, it.itemId),
                  eq(itemEstoque.tenantId, tenantId),
                ),
              );
          }
        }
      }

      // Contas a pagar nascem do recebimento (fornecedor + valor).
      if (rec.fornecedorId && valorTotal > 0) {
        await tx.insert(tituloFinanceiro).values({
          tenantId,
          unidadeId: rec.unidadeId,
          tipo: 'pagar',
          descricao: `Recebimento ${rec.notaRef ? `NF ${rec.notaRef}` : rec.data}`,
          categoria: 'fornecedor',
          fornecedorId: rec.fornecedorId,
          valor: String(valorTotal.toFixed(2)),
          vencimento: rec.vencimento ?? undefined,
          origem: 'recebimento',
          origemId: id,
          criadoPorId: atorId,
        });
      }

      await tx
        .update(recebimento)
        .set({
          status: 'conferido',
          conferidoEm: new Date(),
          conferidoPorId: atorId,
        })
        .where(eq(recebimento.id, id));

      return { ok: true, entradas };
    });

    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'recebimento',
      acao: 'confirmou_recebimento',
      entidadeTipo: 'recebimento',
      entidadeId: id,
      detalhe: { entradas: res.entradas },
    });
    return res;
  }
}
