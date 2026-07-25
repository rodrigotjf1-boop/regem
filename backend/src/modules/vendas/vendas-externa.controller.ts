import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { VendasService } from './vendas.service';
import { VendaExternaPdvDto } from './dto/venda-externa-pdv.dto';

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
}
