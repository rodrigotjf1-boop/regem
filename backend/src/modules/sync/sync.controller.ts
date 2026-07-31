import { Body, Controller, Get, Headers, Post, Query, UseGuards } from '@nestjs/common';
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

  // Restauração sob demanda: deltas das tabelas transacionais (nuvem → edge).
  @Get('restore')
  restore(@SyncCtx() ctx: SyncCtxData, @Query('desde') desde?: string) {
    return this.service.restore(ctx.tenantId, desde);
  }

  @Post('push')
  push(
    @SyncCtx() ctx: SyncCtxData,
    @Body() dto: SyncPushDto,
    @Headers('x-sync-seq') seq?: string,
    @Headers('x-sync-ts') ts?: string,
    @Headers('x-sync-sig') sig?: string,
  ) {
    return this.service.push(ctx, dto.lotes, { seq, ts, sig });
  }
}
