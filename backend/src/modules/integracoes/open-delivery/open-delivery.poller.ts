import { Injectable, Logger } from '@nestjs/common';
import { ehServidorLocal } from '../../../common/modo';
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
    // Pedido de marketplace nasce na NUVEM e desce pelo sync (como iFood/99/Anota Aí/CW).
    if (ehServidorLocal()) return;
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
    // Só reconhece (ACK) o que foi processado: pedido novo que falhou (detalhe indisponível,
    // erro ao gravar) fica sem ACK e volta no próximo polling — antes todos eram
    // reconhecidos e o pedido se perdia (ERR-061). Reprocessar é seguro (ingest idempotente).
    const processados: any[] = [];
    for (const ev of eventos) {
      // Só pedidos novos entram na fila; demais eventos são só reconhecidos.
      if (String(ev.eventType).toUpperCase() !== 'CREATED') {
        processados.push(ev);
        continue;
      }
      try {
        const raw = await this.od.pedido(ig, ev.orderId);
        if (!raw) {
          this.logger.warn(`pedido ${ev.orderId}: detalhe indisponível — sem ACK, volta no próximo polling`);
          continue;
        }
        const norm = adaptarOpenDelivery(raw);
        const ped = await this.delivery.ingest(ig.tenantId, ig.unidadeId, ig.canal, raw, {
          taxaEntrega: Number(raw?.total?.deliveryFee?.value ?? raw?.total?.deliveryFee) || 0,
        });
        // Gravado: já pode ser reconhecido, mesmo que o confirm abaixo falhe (o pedido
        // está no Regem; o confirm segue o fluxo normal da loja).
        processados.push(ev);
        // Auto-confirma no marketplace (loja aceita na hora, como o autoKds).
        await this.od.confirmar(ig, ev.orderId, ped?.displayId ?? norm.displayId);
      } catch (e: any) {
        this.logger.warn(`pedido ${ev.orderId}: ${e?.message ?? e}`);
      }
    }
    await this.od.acknowledge(ig, processados);
    const pendentes = eventos.length - processados.length;
    this.logger.log(`loja ${ig.tenantId}: ${processados.length} evento(s)${pendentes ? `, ${pendentes} para repetir` : ''}`);
  }
}
