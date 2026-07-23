import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { MidiaService } from '../midia/midia.service';
import { EstoqueService } from '../estoque/estoque.service';
import { OrdemProducaoService } from '../ordem-producao/ordem-producao.service';
import { PedidoManutencaoService } from '../pedido-manutencao/pedido-manutencao.service';
import { EtiquetaValidadeService } from '../etiqueta-validade/etiqueta-validade.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Agendador de jobs do backend. (Instância única no EasyPanel — sem lock distribuído.)
@Injectable()
export class JobsService {
  private readonly log = new Logger('Jobs');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly midia: MidiaService,
    private readonly estoque: EstoqueService,
    private readonly ordemProducao: OrdemProducaoService,
    private readonly manutencao: PedidoManutencaoService,
    private readonly etiquetas: EtiquetaValidadeService,
    private readonly events: EventEmitter2,
  ) {}

  // Alertas de etiquetas de validade (a vencer / vencidas) ao C&O/gerente. Mig 136.
  @Cron('15 6 * * *') // 06:15 todos os dias
  async alertasEtiquetas() {
    try {
      const n = await this.etiquetas.alertasValidade();
      if (n) this.log.log(`etiquetas a vencer/vencidas avaliadas: ${n}`);
    } catch (e: any) {
      this.log.error(`alertasEtiquetas: ${e?.message ?? e}`);
    }
  }

  // Pedidos de manutenção abertos há mais de 15 dias perguntam ao C&O o que fazer
  // (manter / concluir / excluir). Dispara o alerta uma vez por pedido. Mig 134.
  @Cron('40 6 * * *') // 06:40 todos os dias
  async promoverManutencaoAntiga() {
    try {
      const n = await this.manutencao.promoverAntigos();
      if (n) this.log.log(`manutenção pendente > 15 dias: ${n}`);
    } catch (e: any) {
      this.log.error(`promoverManutencaoAntiga: ${e?.message ?? e}`);
    }
  }

  // Ordens de produção "aguardando lançamento" com data prevista > 1 dia viram
  // pendência crítica (sobem no painel do gerente/C&O; exigem desfecho). Mig 130.
  @Cron('20 6 * * *') // 06:20 todos os dias
  async promoverOrdensPendentes() {
    try {
      const n = await this.ordemProducao.promoverPendenciasCriticas();
      if (n) this.log.log(`ordens de produção → pendência crítica: ${n}`);
    } catch (e: any) {
      this.log.error(`promoverOrdensPendentes: ${e?.message ?? e}`);
    }
  }

  // Gera as ordens de produção RECORRENTES do dia (a partir de tarefa_def). Mig 130.
  @Cron('30 5 * * *') // 05:30 todos os dias
  async gerarOrdensRecorrentes() {
    const hoje = new Date().toISOString().slice(0, 10);
    for (const tid of await this.tenantsAtivos()) {
      try {
        const n = await this.ordemProducao.gerarRecorrentes(tid, hoje);
        if (n) this.log.log(`ordens recorrentes geradas (${tid}): ${n}`);
      } catch (e: any) {
        this.log.error(`gerarOrdensRecorrentes[${tid}]: ${e?.message ?? e}`);
      }
    }
  }

  private async tenantsAtivos(): Promise<string[]> {
    const r: any = await this.db.execute(
      sql`select id from empresa where deleted_at is null`,
    );
    return (r.rows ?? r).map((x: any) => x.id);
  }

  // Expurgo LGPD: apaga do storage as fotos de ponto vencidas (data_expurgo < hoje).
  @Cron('0 3 * * *') // 03:00 todos os dias
  async expurgarFotosPonto() {
    const r: any = await this.db.execute(sql`
      select id, foto_ref as "fotoRef" from ponto_marcacao
      where foto_ref is not null and data_expurgo is not null
        and data_expurgo < current_date
      limit 500
    `);
    const rows = r.rows ?? r;
    if (!rows.length) return;
    let apagadas = 0;
    for (const row of rows) {
      const ok = await this.midia.remover(row.fotoRef);
      // Zera a referência mesmo se o storage falhar — evita reprocessar sem fim.
      await this.db.execute(
        sql`update ponto_marcacao set foto_ref = null where id = ${row.id}`,
      );
      if (ok) apagadas++;
    }
    this.log.log(
      `Expurgo LGPD: ${apagadas}/${rows.length} fotos de ponto removidas do storage`,
    );
  }

  // Expurgo LGPD: apaga as fotos de comprovação de tarefas vencidas (retenção 30d).
  @Cron('5 3 * * *') // 03:05 todos os dias
  async expurgarFotosTarefa() {
    const r: any = await this.db.execute(sql`
      select id, foto_ref as "fotoRef", fotos from tarefa_instancia
      where data_expurgo is not null and data_expurgo < current_date
      limit 500
    `);
    const rows = r.rows ?? r;
    if (!rows.length) return;
    let apagadas = 0;
    for (const row of rows) {
      const refs: string[] = Array.isArray(row.fotos) ? row.fotos : [];
      if (row.fotoRef && !refs.includes(row.fotoRef)) refs.push(row.fotoRef);
      for (const ref of refs) if (await this.midia.remover(ref)) apagadas++;
      await this.db.execute(
        sql`update tarefa_instancia set foto_ref = null, fotos = '[]'::jsonb, data_expurgo = null where id = ${row.id}`,
      );
    }
    this.log.log(
      `Expurgo LGPD: ${apagadas} foto(s) de tarefa removida(s) do storage (${rows.length} tarefa(s))`,
    );
  }

  // §1.4 — Ponto de pedido: alerta os itens no/abaixo do ROP (por tenant, em tempo real).
  @Cron('0 6 * * *') // 06:00
  async pontoDePedido() {
    const hoje = new Date().toISOString().slice(0, 10);
    const ini = new Date(Date.now() - 27 * 86400000).toISOString().slice(0, 10); // janela 28d
    for (const tenantId of await this.tenantsAtivos()) {
      const { itens } = await this.estoque.inteligencia(tenantId, ini, hoje);
      const repor = itens.filter((i: any) => i.repor);
      if (!repor.length) {
        await this.estoque.resolverAlertasSistema(tenantId, 'ponto_pedido');
        continue;
      }
      const titulo = `${repor.length} item(ns) no ponto de pedido`;
      const detalhe = repor.slice(0, 6).map((i: any) => i.nome).join(', ');
      await this.estoque.registrarAlerta(tenantId, 'ponto_pedido', {
        titulo,
        detalhe,
        prioridade: 'alta',
      });
      this.events.emit('kds.alerta.sistema', { tenantId, titulo, detalhe, prioridade: 'alta' });
      this.log.log(`ROP tenant ${tenantId}: ${repor.length} item(ns) a repor`);
    }
  }

  // §1.3 — Snapshot DIÁRIO de estoque (fecha o dia → CMV real O(1) e preciso em
  // qualquer período, não só na virada do mês). Upsert por (tenant,item,data),
  // idempotente: reexecutar no mesmo dia atualiza. Um snapshot por unidade sai
  // naturalmente porque gerarSnapshot grava item.unidade_id.
  @Cron('0 2 * * *') // todo dia, 02:00
  async snapshotDiario() {
    let n = 0;
    for (const tenantId of await this.tenantsAtivos()) {
      await this.estoque.gerarSnapshot(tenantId);
      n++;
    }
    this.log.log(`Snapshot diário de estoque gerado para ${n} tenant(s)`);
  }

  // §1.6 — Validades FEFO: alerta lotes vencidos/vencendo (≤2d crítico) por tenant.
  @Cron('10 6 * * *') // 06:10
  async validadesFefo() {
    for (const tenantId of await this.tenantsAtivos()) {
      const lotes = await this.estoque.validades(tenantId);
      const criticos = lotes.filter(
        (l: any) => l.status === 'vencido' || l.status === 'critico',
      );
      if (!criticos.length) {
        await this.estoque.resolverAlertasSistema(tenantId, 'validade');
        continue;
      }
      const vencidos = criticos.filter((l: any) => l.status === 'vencido').length;
      const titulo = `${criticos.length} lote(s) vencendo${vencidos ? ` · ${vencidos} vencido(s)` : ''}`;
      const detalhe = criticos.slice(0, 6).map((l: any) => l.itemNome).join(', ');
      const prioridade = vencidos ? 'danger' : 'alta';
      await this.estoque.registrarAlerta(tenantId, 'validade', { titulo, detalhe, prioridade });
      this.events.emit('kds.alerta.sistema', { tenantId, titulo, detalhe, prioridade });
      this.log.log(`FEFO tenant ${tenantId}: ${criticos.length} lote(s) crítico(s)`);
    }
  }
}
