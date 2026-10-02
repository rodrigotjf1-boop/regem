import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Pedidos do SERVIDOR LOCAL à nuvem sobre o delivery. Autenticação pelo token do servidor
// (x-sync-token) — a empresa vem do token, nunca do corpo.
@Controller('delivery')
export class DeliveryLojaController {
  constructor(private readonly service: DeliveryService) {}

  // A loja pede o AVISO DE STATUS ao cliente de um pedido dela (ver
  // DeliveryService.encaminharAvisoParaNuvem): a nuvem tem a integração do n8n da loja e o
  // histórico/modelos do WhatsApp oficial. 409 = pedido ainda não sincronizado (a loja tenta
  // de novo). Só na nuvem — no próprio servidor local a rota não existe.
  @Post('aviso-da-loja')
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  avisoDaLoja(@SyncCtx() ctx: SyncCtxData, @Body() dto: any) {
    return this.service.avisoVindoDaLoja(ctx.tenantId, dto);
  }

  // A loja pede que a NUVEM envie ao canal (iFood, 99Food, Anota AI, Cardápio Web, Open Delivery)
  // o status de um pedido dela — aceito, pronto, saiu, concluído, cancelado. A credencial dos
  // canais fica só na nuvem; sem isto, mudança de status feita no servidor da loja não chegava
  // ao canal. Responde o resultado do envio (a loja grava na linha do tempo dela). 409 = pedido
  // ainda não sincronizado (a loja tenta de novo). Só na nuvem.
  @Post('status-da-loja')
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  statusDaLoja(@SyncCtx() ctx: SyncCtxData, @Body() dto: any) {
    return this.service.statusVindoDaLoja({ tenantId: ctx.tenantId, unidadeId: ctx.unidadeId, equipamentoId: ctx.equipamentoId }, dto);
  }
}
