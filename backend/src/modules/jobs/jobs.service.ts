import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { MidiaService } from '../midia/midia.service';
import { EstoqueService } from '../estoque/estoque.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Agendador de jobs do backend. (Instância única no EasyPanel — sem lock distribuído.)
@Injectable()
export class JobsService {
  private readonly log = new Logger('Jobs');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly midia: MidiaService,
    private readonly estoque: EstoqueService,
    private readonly events: EventEmitter2,
  ) {}

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

  // §1.3 — Snapshot mensal de estoque (fecha o mês → CMV real O(1)).
  @Cron('0 2 1 * *') // dia 1, 02:00
  async snapshotMensal() {
    let n = 0;
    for (const tenantId of await this.tenantsAtivos()) {
      await this.estoque.gerarSnapshot(tenantId);
      n++;
    }
    this.log.log(`Snapshot mensal de estoque gerado para ${n} tenant(s)`);
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
