import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { VendasService } from './vendas.service';
import { VendaExternaPdvDto } from './dto/venda-externa-pdv.dto';
import { VendaExternaFalhaDto } from './dto/venda-externa-falha.dto';

// L-VEN-1 — lançamento de venda de origem externa (totem/autoatendimento) no Regem.
// Auth de SERVIÇO por X-Sync-Token (dispositivo servidor_local), NÃO por JWT de
// usuário: o tenant/unidade vêm do dispositivo, nunca do body. Este é o endpoint
// que o GoGeM usa para "vender de volta" no Regem por código PDV.
@Controller('vendas')
export class VendasExternaController {
  constructor(private readonly service: VendasService) {}

  @Post('externa-pdv')
  @UseGuards(SyncTokenGuard)
  venderTotem(@SyncCtx() ctx: SyncCtxData, @Body() dto: VendaExternaPdvDto) {
    return this.service.venderTotem(ctx.tenantId, ctx, dto);
  }

  // Pedido de totem que NÃO foi pago (erro no checkout). Endpoint SEPARADO da venda
  // para nunca virar venda/caixa: registra 'falha' + motivo (informativo, sem
  // estoque). O GoGeM relaya best-effort — 404 aqui é ignorado do lado do totem.
  @Post('externa-pdv/falha')
  @UseGuards(SyncTokenGuard)
  falhaTotem(@SyncCtx() ctx: SyncCtxData, @Body() dto: VendaExternaFalhaDto) {
    return this.service.registrarFalhaTotem(ctx.tenantId, ctx, dto);
  }
}
