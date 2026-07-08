import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  contagemLista,
  contagemListaItem,
  contagemExecucao,
  contagemItem,
  itemEstoque,
  movimentoEstoque,
  colaborador,
} from '../../db/schema';
import {
  CreateContagemListaDto,
  SalvarContagemItemDto,
} from './dto/create-contagem-lista.dto';

@Injectable()
export class ContagemService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
  ) {}

  // Saldo (ledger) por item, para o snapshot da contagem.
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

  async createLista(tenantId: string, dto: CreateContagemListaDto) {
    // Só itens do tenant.
    const validos = (
      await this.db
        .select({ id: itemEstoque.id })
        .from(itemEstoque)
        .where(
          and(
            eq(itemEstoque.tenantId, tenantId),
            inArray(itemEstoque.id, dto.itemIds),
            isNull(itemEstoque.deletedAt),
          ),
        )
    ).map((i) => i.id);
    const [lista] = await this.db
      .insert(contagemLista)
      .values({
        tenantId,
        nome: dto.nome,
        recorrencia: dto.recorrencia ?? 'semanal',
        diaSemana: dto.diaSemana,
        diaMes: dto.diaMes,
        hora: dto.hora,
        delegadoId: dto.delegadoId,
        enviarKds: dto.enviarKds ?? true,
        enviarDashboard: dto.enviarDashboard ?? true,
      })
      .returning();
    if (validos.length)
      await this.db
        .insert(contagemListaItem)
        .values(validos.map((itemId) => ({ tenantId, listaId: lista.id, itemId })));
    return { ...lista, itens: validos.length };
  }

  async listListas(tenantId: string) {
    const listas = await this.db
      .select()
      .from(contagemLista)
      .where(and(eq(contagemLista.tenantId, tenantId), isNull(contagemLista.deletedAt)))
      .orderBy(contagemLista.nome);
    // contagem de itens + última execução por lista (em memória).
    const ids = listas.map((l) => l.id);
    const cnt = ids.length
      ? await this.db
          .select({ listaId: contagemListaItem.listaId, n: sql<number>`count(*)` })
          .from(contagemListaItem)
          .where(inArray(contagemListaItem.listaId, ids))
          .groupBy(contagemListaItem.listaId)
      : [];
    const nItens = new Map(cnt.map((c: any) => [c.listaId, Number(c.n)]));
    const execs = ids.length
      ? await this.db
          .select({
            listaId: contagemExecucao.listaId,
            data: contagemExecucao.data,
            status: contagemExecucao.status,
          })
          .from(contagemExecucao)
          .where(inArray(contagemExecucao.listaId, ids))
          .orderBy(desc(contagemExecucao.data))
      : [];
    const ultima = new Map<string, any>();
    for (const e of execs) if (!ultima.has(e.listaId)) ultima.set(e.listaId, e);
    return listas.map((l) => ({
      ...l,
      itens: nItens.get(l.id) ?? 0,
      ultimaContagem: ultima.get(l.id)?.data ?? null,
      pendenteHoje: this.dueHoje(l),
    }));
  }

  // A lista deve ser contada hoje? (recorrência × dia atual no fuso SP)
  private dueHoje(l: any): boolean {
    const spDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const d = new Date(`${spDate}T00:00:00Z`);
    if (!l.ativo) return false;
    if (l.recorrencia === 'diaria') return true;
    if (l.recorrencia === 'semanal') return l.diaSemana === d.getUTCDay();
    if (l.recorrencia === 'mensal') return l.diaMes === d.getUTCDate();
    return false;
  }

  async removerLista(tenantId: string, id: string) {
    const [row] = await this.db
      .update(contagemLista)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(contagemLista.id, id),
          eq(contagemLista.tenantId, tenantId),
          isNull(contagemLista.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Lista não encontrada');
    return { ok: true };
  }

  // Abre uma execução: snapshot do saldo de cada item da lista.
  async iniciarExecucao(tenantId: string, listaId: string, atorId: string) {
    const [lista] = await this.db
      .select()
      .from(contagemLista)
      .where(
        and(
          eq(contagemLista.id, listaId),
          eq(contagemLista.tenantId, tenantId),
          isNull(contagemLista.deletedAt),
        ),
      );
    if (!lista) throw new NotFoundException('Lista não encontrada');
    const itens = await this.db
      .select({ itemId: contagemListaItem.itemId })
      .from(contagemListaItem)
      .where(eq(contagemListaItem.listaId, listaId));
    const itemIds = itens.map((i) => i.itemId);
    const saldos = await this.saldos(tenantId, itemIds);
    const [exec] = await this.db
      .insert(contagemExecucao)
      .values({ tenantId, listaId, delegadoId: lista.delegadoId, criadaPorId: atorId })
      .returning();
    if (itemIds.length)
      await this.db.insert(contagemItem).values(
        itemIds.map((itemId) => ({
          tenantId,
          execucaoId: exec.id,
          itemId,
          saldoSistema: String(saldos.get(itemId) ?? 0),
        })),
      );
    return this.getExecucao(tenantId, exec.id);
  }

  async getExecucao(tenantId: string, execId: string) {
    const [exec] = await this.db
      .select()
      .from(contagemExecucao)
      .where(and(eq(contagemExecucao.id, execId), eq(contagemExecucao.tenantId, tenantId)));
    if (!exec) throw new NotFoundException('Contagem não encontrada');
    const itens = await this.db
      .select({
        itemId: contagemItem.itemId,
        nome: itemEstoque.nome,
        unidadeMedida: itemEstoque.unidadeMedida,
        saldoSistema: contagemItem.saldoSistema,
        contado: contagemItem.contado,
      })
      .from(contagemItem)
      .leftJoin(itemEstoque, eq(contagemItem.itemId, itemEstoque.id))
      .where(eq(contagemItem.execucaoId, execId));
    return { ...exec, itens };
  }

  // Salva os contados; opcionalmente ajusta o estoque (movimento 'ajuste').
  async salvarContagem(
    tenantId: string,
    execId: string,
    atorId: string,
    dto: { itens: SalvarContagemItemDto[]; aplicarAjuste?: boolean },
  ) {
    const [exec] = await this.db
      .select()
      .from(contagemExecucao)
      .where(and(eq(contagemExecucao.id, execId), eq(contagemExecucao.tenantId, tenantId)));
    if (!exec) throw new NotFoundException('Contagem não encontrada');

    const atuais = await this.db
      .select()
      .from(contagemItem)
      .where(eq(contagemItem.execucaoId, execId));
    const saldoDe = new Map(atuais.map((a) => [a.itemId, Number(a.saldoSistema)]));

    for (const it of dto.itens) {
      if (!saldoDe.has(it.itemId)) continue;
      await this.db
        .update(contagemItem)
        .set({ contado: String(it.contado) })
        .where(
          and(eq(contagemItem.execucaoId, execId), eq(contagemItem.itemId, it.itemId)),
        );
      if (dto.aplicarAjuste) {
        const diff = Number(it.contado) - (saldoDe.get(it.itemId) ?? 0);
        if (Math.abs(diff) > 1e-9)
          await this.db.insert(movimentoEstoque).values({
            tenantId,
            itemId: it.itemId,
            tipo: 'ajuste',
            quantidade: String(diff),
            motivo: 'contagem',
            data: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
          });
      }
    }

    await this.db
      .update(contagemExecucao)
      .set({ status: 'concluida', concluidaEm: new Date() })
      .where(eq(contagemExecucao.id, execId));

    // Avisa dashboard/KDS que a contagem foi concluída.
    this.events.emit('kds.alerta.sistema', {
      tenantId,
      titulo: 'Contagem concluída',
      detalhe: dto.aplicarAjuste ? 'Estoque ajustado pela contagem.' : 'Contagem registrada.',
      prioridade: 'baixa',
    });
    return { ok: true };
  }

  // Alerta por horário: toda hora cheia, avisa as listas que vencem agora.
  @Cron('0 * * * *')
  async alertasContagem() {
    const listas = await this.db
      .select()
      .from(contagemLista)
      .where(
        and(
          eq(contagemLista.ativo, true),
          eq(contagemLista.enviarKds, true),
          isNull(contagemLista.deletedAt),
        ),
      );
    const spHora = Number(
      new Date()
        .toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false })
        .slice(0, 2),
    );
    for (const l of listas) {
      if (l.hora == null) continue;
      if (Number(String(l.hora).slice(0, 2)) !== spHora) continue;
      if (!this.dueHoje(l)) continue;
      let alvo = '';
      if (l.delegadoId) {
        const [c] = await this.db
          .select({ nome: colaborador.nome })
          .from(colaborador)
          .where(eq(colaborador.id, l.delegadoId));
        if (c?.nome) alvo = ` — responsável: ${c.nome}`;
      }
      this.events.emit('kds.alerta.sistema', {
        tenantId: l.tenantId,
        titulo: `Contagem: ${l.nome}`,
        detalhe: `Hora de contar o estoque desta lista${alvo}.`,
        prioridade: 'media',
      });
    }
  }
}
