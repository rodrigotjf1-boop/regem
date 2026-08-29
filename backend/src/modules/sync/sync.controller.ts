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
  pull(
    @SyncCtx() ctx: SyncCtxData,
    @Query('desde') desde?: string,
    @Query('cursores') cursores?: string,
  ) {
    return this.service.pull(ctx.tenantId, desde, parseCursores(cursores));
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

// Parse do mapa de cursores keyset (query `?cursores=<json>`). Presença de um OBJETO
// válido (mesmo vazio `{}`, no 1º pull do edge novo) liga o caminho keyset; JSON inválido
// ou não-objeto → undefined → caminho legado (edge antigo). Só aceita valores string.
function parseCursores(s?: string): Record<string, string> | undefined {
  if (!s) return undefined;
  try {
    const o = JSON.parse(s);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return undefined;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) if (typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return undefined;
  }
}
