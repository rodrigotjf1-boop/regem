import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from './sync-token.guard';
import { SyncPushDto } from './dto/push.dto';

// API de sync consumida pelo SERVIDOR LOCAL (ver docs/arquitetura-edge.md).
// Autenticada por TOKEN DE DISPOSITIVO ('servidor_local'), escopada ao tenant do token.
@Controller('sync')
@UseGuards(SyncTokenGuard)
export class SyncController {
  constructor(private readonly service: SyncService) {}

  @Get('pull')
  pull(@SyncCtx() ctx: SyncCtxData, @Query('desde') desde?: string) {
    return this.service.pull(ctx.tenantId, desde);
  }

  @Post('push')
  push(@SyncCtx() ctx: SyncCtxData, @Body() dto: SyncPushDto) {
    return this.service.push(ctx.tenantId, dto.lotes);
  }
}
