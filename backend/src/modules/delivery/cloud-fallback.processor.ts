import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { pedidoExterno, edgeHeartbeat } from '../../db/schema';
import { DeliveryService } from './delivery.service';

/**
 * P2 — Rede de segurança da NUVEM para pedidos online presos.
 *
 * Quando a loja opera em modo local, `receberPedido` NÃO materializa: adia para o
 * edge processar (ver EdgePedidosProcessor). Mas essa decisão é one-shot no momento
 * do pedido. Se o edge cair DEPOIS de deferir e ANTES de puxar/processar, o pedido
 * fica preso em `novo` sem comanda — a nuvem não re-materializa e o edge morto não
 * processa. Aqui a NUVEM resgata: pega pedidos online `novo`/sem comanda com mais de
 * TETO_MIN minutos E cujo tenant NÃO tem heartbeat recente do edge (edge caiu) e
 * chama `delivery.aceitar` na própria nuvem.
 *
 * Guardas contra corrida com o edge:
 *  - Só age se NÃO há heartbeat do edge nos últimos HB_MIN min (edge ativo → não toca).
 *  - Idade mínima TETO_MIN dá tempo do fluxo normal (sync + processador do edge).
 *  - `aceitar` seta comanda_id → idempotente; no próximo ciclo o pedido já não entra.
 *  - Só roda na NUVEM (no edge, EDGE_MODE=true, retorna cedo — lá quem materializa é
 *    o EdgePedidosProcessor).
 */
@Injectable()
export class CloudFallbackProcessor {
  private readonly logger = new Logger('CloudFallback');
  private rodando = false;
  private readonly isEdge = String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';
  private static readonly HB_MIN = 3; // heartbeat recente = edge ativo
  private static readonly TETO_MIN = 5; // idade mínima do pedido preso

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly delivery: DeliveryService,
  ) {}

  @Interval(60000)
  async processar() {
    if (this.isEdge || this.rodando) return;
    this.rodando = true;
    try {
      const corteIdade = new Date(Date.now() - CloudFallbackProcessor.TETO_MIN * 60 * 1000);
      const corteHb = new Date(Date.now() - CloudFallbackProcessor.HB_MIN * 60 * 1000);

      // Pedidos online presos há mais de TETO_MIN, sem comanda, cujo tenant não tem
      // heartbeat recente do edge (não existe edge ativo processando pra aquela loja).
      const presos = await this.db
        .select({ id: pedidoExterno.id, tenantId: pedidoExterno.tenantId })
        .from(pedidoExterno)
        .where(
          and(
            eq(pedidoExterno.status, 'novo'),
            isNull(pedidoExterno.comandaId),
            lt(pedidoExterno.criadoEm, corteIdade),
            sql`(${pedidoExterno.canal} is not null and ${pedidoExterno.canal} <> 'balcao')`,
            sql`not exists (select 1 from ${edgeHeartbeat} hb where hb.tenant_id = ${pedidoExterno.tenantId} and hb.recebido_em >= ${corteHb})`,
          ),
        )
        .limit(50);

      for (const p of presos) {
        try {
          await this.delivery.aceitar(p.tenantId, null, p.id);
          this.logger.warn(`pedido online ${p.id} resgatado na nuvem (edge inativo)`);
        } catch (e: any) {
          this.logger.warn(`falha ao resgatar ${p.id}: ${e?.message ?? e}`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`ciclo falhou: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }
}
