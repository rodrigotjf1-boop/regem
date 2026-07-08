import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  compraLista,
  compraItem,
  itemEstoque,
  movimentoEstoque,
  fornecedor,
  colaborador,
} from '../../db/schema';
import { custoMedioPonderado } from '../../common/regras-negocio';
import { CreateCompraListaDto } from './dto/create-compra-lista.dto';

@Injectable()
export class ComprasService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
  ) {}

  private async saldos(tenantId: string, itemIds: string[]) {
    const map = new Map<string, number>();
    if (!itemIds.length) return map;
    const res: any = await this.db.execute(sql`
      select item_id as "itemId",
             coalesce(sum(case tipo when 'entrada' then quantidade
               when 'saida' then -quantidade else quantidade end), 0) as saldo
      from movimento_estoque
      where tenant_id = ${tenantId} and item_id in ${itemIds}
      group by item_id
    `);
    for (const r of res.rows ?? res) map.set(r.itemId, Number(r.saldo));
    return map;
  }

  async createLista(tenantId: string, dto: CreateCompraListaDto) {
    const ids = dto.itens.map((i) => i.itemId);
    const validos = new Set(
      (
        await this.db
          .select({ id: itemEstoque.id })
          .from(itemEstoque)
          .where(
            and(
              eq(itemEstoque.tenantId, tenantId),
              inArray(itemEstoque.id, ids),
              isNull(itemEstoque.deletedAt),
            ),
          )
      ).map((i) => i.id),
    );
    const linhas = dto.itens.filter((i) => validos.has(i.itemId));
    if (!linhas.length)
      throw new BadRequestException('Nenhum item válido para este tenant.');
    const [lista] = await this.db
      .insert(compraLista)
      .values({
        tenantId,
        nome: dto.nome,
        fornecedorId: dto.fornecedorId,
        dataRecebimento: dto.dataRecebimento,
        delegadoId: dto.delegadoId,
        enviarKds: dto.enviarKds ?? true,
        enviarDashboard: dto.enviarDashboard ?? true,
      })
      .returning();
    await this.db.insert(compraItem).values(
      linhas.map((i) => ({
        tenantId,
        listaId: lista.id,
        itemId: i.itemId,
        quantidade: String(i.quantidade),
        custoUnitario: i.custoUnitario != null ? String(i.custoUnitario) : undefined,
      })),
    );
    return { ...lista, itens: linhas.length };
  }

  async listListas(tenantId: string) {
    const listas = await this.db
      .select({
        id: compraLista.id,
        nome: compraLista.nome,
        status: compraLista.status,
        dataRecebimento: compraLista.dataRecebimento,
        recebidaEm: compraLista.recebidaEm,
        fornecedorNome: fornecedor.nome,
        delegadoNome: colaborador.nome,
      })
      .from(compraLista)
      .leftJoin(fornecedor, eq(compraLista.fornecedorId, fornecedor.id))
      .leftJoin(colaborador, eq(compraLista.delegadoId, colaborador.id))
      .where(and(eq(compraLista.tenantId, tenantId), isNull(compraLista.deletedAt)))
      .orderBy(desc(compraLista.createdAt));
    const ids = listas.map((l) => l.id);
    const cnt = ids.length
      ? await this.db
          .select({ listaId: compraItem.listaId, n: sql<number>`count(*)` })
          .from(compraItem)
          .where(inArray(compraItem.listaId, ids))
          .groupBy(compraItem.listaId)
      : [];
    const nItens = new Map(cnt.map((c: any) => [c.listaId, Number(c.n)]));
    return listas.map((l) => ({ ...l, itens: nItens.get(l.id) ?? 0 }));
  }

  async getLista(tenantId: string, id: string) {
    const [lista] = await this.db
      .select()
      .from(compraLista)
      .where(
        and(
          eq(compraLista.id, id),
          eq(compraLista.tenantId, tenantId),
          isNull(compraLista.deletedAt),
        ),
      );
    if (!lista) throw new NotFoundException('Lista não encontrada');
    const itens = await this.db
      .select({
        itemId: compraItem.itemId,
        nome: itemEstoque.nome,
        unidadeMedida: itemEstoque.unidadeMedida,
        quantidade: compraItem.quantidade,
        custoUnitario: compraItem.custoUnitario,
      })
      .from(compraItem)
      .leftJoin(itemEstoque, eq(compraItem.itemId, itemEstoque.id))
      .where(eq(compraItem.listaId, id));
    return { ...lista, itens };
  }

  // Sugestão: itens abaixo do mínimo, com quantidade sugerida (mínimo − saldo).
  async sugerir(tenantId: string) {
    const res: any = await this.db.execute(sql`
      select i.id as "itemId", i.nome, i.unidade_medida as "unidadeMedida",
             i.estoque_minimo as "estoqueMinimo",
             coalesce(sum(case m.tipo when 'entrada' then m.quantidade
               when 'saida' then -m.quantidade else m.quantidade end), 0) as saldo
      from item_estoque i
      left join movimento_estoque m on m.item_id = i.id
      where i.tenant_id = ${tenantId} and i.deleted_at is null
      group by i.id
      order by i.nome
    `);
    return (res.rows ?? res)
      .map((r: any) => {
        const saldo = Number(r.saldo);
        const min = Number(r.estoqueMinimo);
        return { ...r, saldo, sugerido: Math.max(0, min - saldo) };
      })
      .filter((r: any) => r.sugerido > 0);
  }

  async removerLista(tenantId: string, id: string) {
    const [row] = await this.db
      .update(compraLista)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(compraLista.id, id),
          eq(compraLista.tenantId, tenantId),
          isNull(compraLista.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Lista não encontrada');
    return { ok: true };
  }

  // Receber a compra: entra no estoque (movimento 'entrada' com custo) + atualiza
  // custo médio ponderado por item; marca recebida e avisa KDS/dashboard.
  async receber(tenantId: string, id: string) {
    const [lista] = await this.db
      .select()
      .from(compraLista)
      .where(
        and(
          eq(compraLista.id, id),
          eq(compraLista.tenantId, tenantId),
          isNull(compraLista.deletedAt),
        ),
      );
    if (!lista) throw new NotFoundException('Lista não encontrada');
    if (lista.status === 'recebida')
      throw new BadRequestException('Compra já recebida.');

    const itens = await this.db
      .select()
      .from(compraItem)
      .where(eq(compraItem.listaId, id));
    const saldos = await this.saldos(tenantId, itens.map((i) => i.itemId));
    const data =
      lista.dataRecebimento ??
      new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

    for (const it of itens) {
      const qtd = Number(it.quantidade);
      if (qtd <= 0) continue;
      const custo = it.custoUnitario != null ? Number(it.custoUnitario) : null;
      await this.db.insert(movimentoEstoque).values({
        tenantId,
        itemId: it.itemId,
        tipo: 'entrada',
        quantidade: String(qtd),
        custoUnitario: custo != null ? String(custo) : undefined,
        motivo: 'recebimento',
        data,
      });
      if (custo != null) {
        const [cur] = await this.db
          .select({ custoMedio: itemEstoque.custoMedio })
          .from(itemEstoque)
          .where(eq(itemEstoque.id, it.itemId));
        const novo = custoMedioPonderado(
          saldos.get(it.itemId) ?? 0,
          Number(cur?.custoMedio ?? 0),
          qtd,
          custo,
        );
        await this.db
          .update(itemEstoque)
          .set({ custoMedio: String(novo), updatedAt: new Date() })
          .where(eq(itemEstoque.id, it.itemId));
      }
    }

    await this.db
      .update(compraLista)
      .set({ status: 'recebida', recebidaEm: new Date() })
      .where(eq(compraLista.id, id));

    if (lista.enviarKds)
      this.events.emit('kds.alerta.sistema', {
        tenantId,
        titulo: `Compra recebida: ${lista.nome}`,
        detalhe: 'Itens entraram no estoque.',
        prioridade: 'baixa',
      });
    return { ok: true };
  }
}
