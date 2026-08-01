import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DeliveryService } from '../../delivery/delivery.service';
import { agendamentoIfood } from '../../delivery/adapters';
import { IfoodService, IntegIfood } from './ifood.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Poller da nuvem: a cada 30s consulta os eventos de cada loja iFood ativa,
// ingere os pedidos novos (código PLC) e reconhece TODOS os eventos (senão o
// iFood repete). Não roda no EDGE. Idempotente por externalId no delivery.ingest.
@Injectable()
export class IfoodPoller {
  private readonly logger = new Logger('IfoodPoller');
  private rodando = false;
  constructor(
    private readonly ifood: IfoodService,
    private readonly delivery: DeliveryService,
  ) {}

  @Interval(30000)
  async tick() {
    if (String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true') return;
    if (this.rodando) return; // evita sobreposição
    this.rodando = true;
    try {
      const integs = await this.ifood.integracoesAtivas();
      for (const ig of integs) {
        try {
          await this.processar(ig);
        } catch (e: any) {
          this.logger.error(`poller iFood loja ${ig.tenantId}: ${e?.message ?? e}`, e?.stack);
        }
        // Blindagem: reenvia cancelamentos que não chegaram ao iFood (não perde o cancel).
        try {
          const n = await this.ifood.reconciliarCancels(ig);
          if (n) this.logger.log(`loja ${ig.tenantId}: ${n} cancelamento(s) reconciliado(s)`);
        } catch (e: any) {
          this.logger.warn(`loja ${ig.tenantId} reconciliarCancels: ${e?.message ?? e}`);
        }
      }
    } finally {
      this.rodando = false;
    }
  }

  private async processar(ig: IntegIfood) {
    const eventos = await this.ifood.polling(ig);
    if (!eventos.length) return;
    for (const ev of eventos) {
      const code = String(ev.code ?? ev.fullCode ?? '').toUpperCase();
      try {
        if (code === 'PLC' || code === 'PLACED') {
          // Pedido novo: busca os detalhes e ingere (idempotente por externalId).
          // O confirm no iFood sai do fluxo do Regem (delivery.aceitar → statusBack).
          const raw = await this.ifood.pedido(ig, ev.orderId);
          if (!raw) continue;
          await this.delivery.ingest(ig.tenantId, ig.unidadeId, 'ifood', raw, {
            taxaEntrega: Number(raw?.total?.deliveryFee ?? raw?.deliveryFee) || 0,
            // Pedido agendado: guarda a janela p/ não despachar antes da hora.
            agendamento: agendamentoIfood(raw) ?? undefined,
          });
        } else if (code === 'CFM' || code === 'CONFIRMED') {
          // iFood confirmou (aceite feito no app/tablet do iFood, fora do kanban do
          // Regem) → materializa localmente, senão o pedido não vira produção/KDS.
          await this.delivery.materializarSeNovoExterno(ig.tenantId, 'ifood', String(ev.orderId));
        } else if (code === 'RTP' || code === 'READY_TO_PICKUP') {
          // iFood marcou pronto p/ retirada → garante produção e move pra "Pronto".
          await this.delivery.materializarSeNovoExterno(ig.tenantId, 'ifood', String(ev.orderId));
          await this.delivery.refletirStatusExterno(ig.tenantId, 'ifood', String(ev.orderId), 'pronto');
        } else if (code === 'DSP' || code === 'DISPATCHED') {
          // iFood despachou (saiu para entrega) → garante produção e move pra "Em rota".
          await this.delivery.materializarSeNovoExterno(ig.tenantId, 'ifood', String(ev.orderId));
          await this.delivery.refletirStatusExterno(ig.tenantId, 'ifood', String(ev.orderId), 'despachado');
        } else if (code === 'CAN' || code === 'CANCELLED') {
          // iFood cancelou o pedido → reflete localmente (sem status-back de volta).
          await this.delivery.refletirStatusExterno(ig.tenantId, 'ifood', String(ev.orderId), 'cancelado');
        } else if (code === 'CON' || code === 'CONCLUDED') {
          // iFood concluiu (ex.: envio imediato) → garante produção e reflete localmente.
          await this.delivery.materializarSeNovoExterno(ig.tenantId, 'ifood', String(ev.orderId));
          await this.delivery.refletirStatusExterno(ig.tenantId, 'ifood', String(ev.orderId), 'concluido');
        }
        // Demais códigos apenas reconhecemos abaixo.
      } catch (e: any) {
        this.logger.warn(`evento ${code} ${ev.orderId}: ${e?.message ?? e}`);
      }
    }
    await this.ifood.acknowledge(ig, eventos);
    this.logger.log(`loja ${ig.tenantId}: ${eventos.length} evento(s)`);
  }
}
