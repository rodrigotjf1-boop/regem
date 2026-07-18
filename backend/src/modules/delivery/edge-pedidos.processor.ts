import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { pedidoExterno } from '../../db/schema';
import { DeliveryService } from './delivery.service';

/**
 * P1b — Processador de pedidos ONLINE no EDGE.
 *
 * Pedidos online (cardápio/marketplaces) nascem na NUVEM. Quando a loja está em
 * modo local, a nuvem NÃO materializa a produção (deixa o pedido em `novo` sem
 * comanda) e ele DESCE pelo sync. Aqui, no edge (EDGE_MODE), pegamos esses pedidos
 * (`status='novo'` e `comanda_id IS NULL`) e chamamos `delivery.aceitar` — que cria
 * a comanda + produção LOCALMENTE (KDS/garçom) e faz a baixa de estoque no edge.
 *
 * Idempotente: `aceitar` seta `comanda_id`; no próximo ciclo o pedido já não entra.
 * Só roda no edge — na nuvem o EDGE_MODE é falso e o intervalo retorna cedo.
 */
@Injectable()
export class EdgePedidosProcessor {
  private readonly logger = new Logger('EdgePedidos');
  private rodando = false;
  private readonly isEdge = String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly delivery: DeliveryService,
  ) {}

  @Interval(15000)
  async processar() {
    if (!this.isEdge || this.rodando) return;
    this.rodando = true;
    try {
      // Pedidos que desceram da nuvem e ainda não viraram produção local.
      const pendentes = await this.db
        .select({ id: pedidoExterno.id, tenantId: pedidoExterno.tenantId })
        .from(pedidoExterno)
        .where(
          and(
            eq(pedidoExterno.status, 'novo'),
            isNull(pedidoExterno.comandaId),
            // Só pedidos ONLINE (têm cliente/canal externo) — evita mexer em rascunhos.
            sql`(${pedidoExterno.canal} is not null and ${pedidoExterno.canal} <> 'balcao')`,
          ),
        )
        .limit(50);

      for (const p of pendentes) {
        try {
          await this.delivery.aceitar(p.tenantId, null, p.id);
          this.logger.log(`pedido online ${p.id} materializado no edge (comanda + produção)`);
        } catch (e: any) {
          this.logger.warn(`falha ao materializar ${p.id}: ${e?.message ?? e}`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`ciclo falhou: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }
}
