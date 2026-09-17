import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  recebimento,
  recebimentoItem,
  movimentoEstoque,
  lote,
  itemEstoque,
  fornecedor,
  unidade,
  tituloFinanceiro,
} from '../../db/schema';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ponderarCustoDaEntrada } from '../../common/custo-loja';
import { sqlUnidade, condUnidade, condUnidadeOuRede } from '../../common/filtro-unidade';
import { CreateRecebimentoDto } from './dto/create-recebimento.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Injectable()
export class RecebimentoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly events: EventEmitter2,
  ) {}

  // Nada que venha do corpo do request e aponte para outra tabela entra sem conferência
  // de dono: `itemId` e `fornecedorId` chegavam só com `@IsUUID()`, então o id de OUTRO
  // tenant passava. O `desperdicio` já fazia essa checagem — o recebimento era o
  // fora-da-curva. Uma consulta por tabela (não uma por item): a nota tem dezenas de linhas.
  private async conferirDonos(
    tenantId: string,
    dto: CreateRecebimentoDto,
    unidadeIdRec: string | null,
  ) {
    if (dto.fornecedorId) {
      const [f] = await this.db
        .select({ id: fornecedor.id })
        .from(fornecedor)
        .where(and(eq(fornecedor.id, dto.fornecedorId), eq(fornecedor.tenantId, tenantId)));
      if (!f) throw new BadRequestException('Fornecedor inválido.');
    }

    const ids = [...new Set((dto.itens ?? []).map((i) => i.itemId).filter(Boolean))];
    if (!ids.length) return;
    // Unidade do ITEM: a da nota, ou nula (catálogo da rede, herdado pelas filiais).
    // Assim a loja A não dá entrada num insumo que pertence à loja B.
    const achados = await this.db
      .select({ id: itemEstoque.id, nome: itemEstoque.nome })
      .from(itemEstoque)
      .where(
        and(
          eq(itemEstoque.tenantId, tenantId),
          inArray(itemEstoque.id, ids),
          isNull(itemEstoque.deletedAt),
          condUnidadeOuRede(itemEstoque.unidadeId, unidadeIdRec),
        ),
      );
    if (achados.length !== ids.length) {
      const ok = new Set(achados.map((i) => i.id));
      const faltando = ids.filter((i) => !ok.has(i));
      // Recusa nomeando, em vez de descartar a linha em silêncio: nota com item
      // descartado sem aviso vira estoque que não entrou e ninguém procura.
      throw new BadRequestException(
        `${faltando.length} item(ns) não pertencem a esta loja ou não existem mais.`,
      );
    }
  }

  // Cria o recebimento como rascunho (status 'aberto') — ainda NÃO mexe no estoque.
  async create(tenantId: string, dto: CreateRecebimentoDto, atual: string | null = null) {
    // Usuário preso a uma loja recebe SEMPRE na dele; a rede informa e nós conferimos.
    let unidadeIdRec = atual ?? dto.unidadeId ?? null;
    if (!atual && dto.unidadeId) {
      const [u] = await this.db
        .select({ id: unidade.id })
        .from(unidade)
        .where(and(eq(unidade.id, dto.unidadeId), eq(unidade.tenantId, tenantId)));
      if (!u) throw new BadRequestException('Unidade inválida.');
      unidadeIdRec = u.id;
    }
    await this.conferirDonos(tenantId, dto, unidadeIdRec);

    return this.db.transaction(async (tx) => {
      const [rec] = await tx
        .insert(recebimento)
        .values({
          tenantId,
          unidadeId: unidadeIdRec ?? undefined,
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

  async findAll(tenantId: string, atual: string | null = null) {
    const r: any = await this.db.execute(sql`
      select r.id, r.data, r.status, r.nota_ref as "notaRef",
        f.nome as "fornecedorNome",
        (select count(*) from recebimento_item ri where ri.recebimento_id = r.id) as "itens",
        (select count(*) from recebimento_item ri
          where ri.recebimento_id = r.id and ri.divergencia <> 'ok') as "divergencias"
      from recebimento r
      left join fornecedor f on f.id = r.fornecedor_id and f.tenant_id = r.tenant_id
      where r.tenant_id = ${tenantId} and r.deleted_at is null ${sqlUnidade('r.unidade_id', atual)}
      order by r.data desc, r.created_at desc
    `);
    return (r.rows ?? r).map((x: any) => ({
      ...x,
      itens: Number(x.itens),
      divergencias: Number(x.divergencias),
    }));
  }

  async findOne(tenantId: string, id: string, atual: string | null = null) {
    const h: any = await this.db.execute(sql`
      select r.*, f.nome as "fornecedorNome"
      from recebimento r
      left join fornecedor f on f.id = r.fornecedor_id and f.tenant_id = r.tenant_id
      where r.id = ${id} and r.tenant_id = ${tenantId} and r.deleted_at is null ${sqlUnidade('r.unidade_id', atual)}
    `);
    const header = (h.rows ?? h)[0];
    if (!header) throw new NotFoundException('Recebimento não encontrado');

    const it: any = await this.db.execute(sql`
      select ri.id, ri.item_id as "itemId", ri.qtd_esperada as "qtdEsperada",
        ri.qtd_recebida as "qtdRecebida", ri.divergencia, ri.validade,
        ri.obs, i.nome as "itemNome", i.unidade_medida as "unidade"
      from recebimento_item ri
      join item_estoque i on i.id = ri.item_id and i.tenant_id = ri.tenant_id
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
    atual: string | null = null,
  ) {
    const res = await this.db.transaction(async (tx) => {
      // TRAVA a linha antes de ler o status. Sem `for update` isto é check-then-act:
      // dois cliques simultâneos leem 'rascunho' ao mesmo tempo, os dois passam pela
      // guarda e o estoque — mais a CONTA A PAGAR — entra em dobro. Com a trava, o
      // segundo espera, relê a versão nova e cai no "já confirmado".
      const [rec] = await tx
        .select()
        .from(recebimento)
        .where(
          and(eq(recebimento.id, id), eq(recebimento.tenantId, tenantId), condUnidade(recebimento.unidadeId, atual)),
        )
        .for('update');
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

          // ref = a LINHA do recebimento, não o recebimento. O índice único da mig 024
          // é (tenant, ref_tipo, ref_id, item_id): usando o id do documento, duas linhas
          // do MESMO item na mesma nota colidiriam. Com o id da linha, a idempotência
          // fica garantida pelo banco, não só pela trava acima.
          const [mov] = await tx.insert(movimentoEstoque).values({
            tenantId,
            itemId: it.itemId,
            tipo: 'entrada',
            quantidade: String(qtd),
            custoUnitario: custo != null ? String(custo) : undefined,
            motivo: 'recebimento',
            refTipo: 'recebimento_item',
            refId: it.id,
            data: rec.data,
          }).returning({ id: movimentoEstoque.id });
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

          // Custo médio ponderado móvel DA LOJA da nota (mig 257):
          // novo = (saldoAntes×custoMédioAtual + qtd×custoEntrada) / (saldoAntes + qtd)
          if (custo != null)
            await ponderarCustoDaEntrada(tx, tenantId, mov.id, it.itemId, qtd, custo);
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
    // Reposição de estoque → o cardápio despausa sozinho os que voltaram a ter insumo.
    this.events.emit('estoque.baixado', { tenantId });
    return res;
  }
}
