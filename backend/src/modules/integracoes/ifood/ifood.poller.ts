import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { FalhasDoPoller } from '../../../common/falhas-do-poller';
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
  // Falha de rede passageira = aviso; erro só se a loja ficar 5 min sem resposta (ERR-244).
  private readonly falhas = new FalhasDoPoller(this.logger);
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
          this.falhas.funcionou(ig.id, `poller iFood loja ${ig.tenantId}`);
        } catch (e: any) {
          this.falhas.falhou(ig.id, `poller iFood loja ${ig.tenantId}`, e);
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

  // Regra oficial do iFood: PERSISTIR antes do acknowledgment — evento reconhecido não volta.
  // Só entra no ACK o evento processado com sucesso (ou que não exige nada); o que falhou
  // (detalhe indisponível, erro ao gravar) fica sem ACK e volta no próximo polling (o iFood
  // guarda por 8 h). Reprocessar é seguro: o ingest é idempotente (índice único por pedido).
  // Antes TODOS eram reconhecidos no fim e o pedido se perdia numa falha passageira (ERR-061).
  private async processar(ig: IntegIfood) {
    const eventos = await this.ifood.polling(ig);
    if (!eventos.length) return;
    const processados: any[] = [];
    for (const ev of eventos) {
      const code = String(ev.code ?? ev.fullCode ?? '').toUpperCase();
      try {
        if (code === 'PLC' || code === 'PLACED') {
          // Pedido novo: busca os detalhes e ingere (idempotente por externalId).
          // O confirm no iFood sai do fluxo do Regem (delivery.aceitar → statusBack).
          const raw = await this.ifood.pedido(ig, ev.orderId);
          if (!raw) {
            this.logger.warn(`pedido ${ev.orderId}: detalhe indisponível — sem ACK, volta no próximo polling`);
            continue;
          }
          await this.delivery.ingest(ig.tenantId, ig.unidadeId, 'ifood', raw, {
            taxaEntrega: Number(raw?.total?.deliveryFee ?? raw?.deliveryFee) || 0,
            // Pedido agendado: guarda a janela p/ não despachar antes da hora.
            agendamento: agendamentoIfood(raw) ?? undefined,
          });
        } else if (code === 'CFM' || code === 'CONFIRMED') {
          // iFood confirmou (aceite feito no app/tablet do iFood, fora do kanban do
          // Regem) → materializa localmente, senão o pedido não vira produção/KDS. Com o
          // servidor da loja ligado, quem aceita é ele (o pedido segue 'novo' até lá).
          await this.delivery.materializarSeNovoExterno(ig.tenantId, 'ifood', String(ev.orderId));
        } else if (code === 'RTP' || code === 'READY_TO_PICKUP' || code === 'DSP' || code === 'DISPATCHED' || code === 'CON' || code === 'CONCLUDED') {
          // iFood marcou pronto p/ retirada (RTP), despachou (DSP) ou concluiu (CON) → garante
          // a produção e move o pedido. Pedido ainda 'novo' numa loja com servidor local ligado:
          // o servidor ainda vai aceitá-lo — o evento fica SEM confirmação de leitura e volta no
          // próximo polling (o iFood guarda por 8 h), até a venda existir (ERR-251).
          const alvo = code.startsWith('R') ? 'pronto' : code.startsWith('D') ? 'despachado' : 'concluido';
          await this.delivery.materializarSeNovoExterno(ig.tenantId, 'ifood', String(ev.orderId));
          const r = await this.delivery.refletirStatusExterno(ig.tenantId, 'ifood', String(ev.orderId), alvo);
          if (r === 'adiado') continue;
        } else if (code === 'CAN' || code === 'CANCELLED') {
          // iFood cancelou o pedido → reflete localmente (sem status-back de volta).
          await this.delivery.refletirStatusExterno(ig.tenantId, 'ifood', String(ev.orderId), 'cancelado');
        }
        // Demais códigos: nada a fazer — reconhecidos.
        processados.push(ev);
      } catch (e: any) {
        this.logger.warn(`evento ${code} ${ev.orderId}: ${e?.message ?? e} — sem ACK, volta no próximo polling`);
      }
    }
    await this.ifood.acknowledge(ig, processados);
    const pendentes = eventos.length - processados.length;
    this.logger.log(`loja ${ig.tenantId}: ${processados.length} evento(s)${pendentes ? `, ${pendentes} para repetir` : ''}`);
  }
}
