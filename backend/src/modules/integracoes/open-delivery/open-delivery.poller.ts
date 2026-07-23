import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DeliveryService } from '../../delivery/delivery.service';
import { adaptarOpenDelivery } from '../../delivery/adapters';
import { IntegOD, OpenDeliveryService } from './open-delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Poller central (nuvem): a cada 30s consulta os eventos de cada integração
// Open Delivery ativa, ingere pedidos novos e reconhece os eventos.
@Injectable()
export class OpenDeliveryPoller {
  private readonly logger = new Logger('OpenDeliveryPoller');
  private rodando = false;

  constructor(
    private readonly od: OpenDeliveryService,
    private readonly delivery: DeliveryService,
  ) {}

  @Interval(30000)
  async tick() {
    if (this.rodando) return; // evita sobreposição se um ciclo demorar
    this.rodando = true;
    try {
      const integs = await this.od.integracoesAtivas();
      for (const ig of integs) {
        try {
          await this.processar(ig);
        } catch (e: any) {
          this.logger.error(`poller Open Delivery loja ${ig.tenantId}: ${e?.message ?? e}`, e?.stack);
        }
      }
    } finally {
      this.rodando = false;
    }
  }

  private async processar(ig: IntegOD) {
    const eventos = await this.od.polling(ig);
    if (!eventos.length) return;
    for (const ev of eventos) {
      // Só pedidos novos entram na fila; demais eventos são só reconhecidos.
      if (String(ev.eventType).toUpperCase() !== 'CREATED') continue;
      try {
        const raw = await this.od.pedido(ig, ev.orderId);
        if (!raw) continue;
        const norm = adaptarOpenDelivery(raw);
        const ped = await this.delivery.ingest(ig.tenantId, ig.unidadeId, ig.canal, raw, {
          taxaEntrega: Number(raw?.total?.deliveryFee?.value ?? raw?.total?.deliveryFee) || 0,
        });
        // Auto-confirma no marketplace (loja aceita na hora, como o autoKds).
        await this.od.confirmar(ig, ev.orderId, ped?.displayId ?? norm.displayId);
      } catch (e: any) {
        this.logger.warn(`pedido ${ev.orderId}: ${e?.message ?? e}`);
      }
    }
    await this.od.acknowledge(ig, eventos);
    this.logger.log(`loja ${ig.tenantId}: ${eventos.length} evento(s)`);
  }
}
