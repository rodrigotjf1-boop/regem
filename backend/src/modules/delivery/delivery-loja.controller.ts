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
}
