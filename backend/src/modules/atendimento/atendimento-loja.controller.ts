import { Body, Controller, Get, HttpCode, Post, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { DisputaIfoodService, RespostaDaDisputa } from './disputa-ifood.service';

// Pedidos do SERVIDOR DA LOJA à nuvem sobre a central de atendimento (V37): a credencial do iFood fica só na nuvem.
// Autenticação pelo token do servidor (x-sync-token) — a empresa vem do token, nunca do corpo. Só na nuvem.
@Controller('atendimento')
export class AtendimentoLojaController {
  constructor(private readonly disputa: DisputaIfoodService) {}

  // A loja responde a uma disputa do iFood: a senha de gerente/presidente já foi conferida no servidor dela.
  @Post('disputa-da-loja')
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  disputaDaLoja(@SyncCtx() ctx: SyncCtxData, @Body() dto: RespostaDaDisputa & { chamadoId?: string; liberadorId?: string; liberadorNome?: string; atorId?: string }) {
    return this.disputa.responderVindoDaLoja(ctx.tenantId, dto);
  }

  // A foto que o cliente mandou na disputa (o iFood só entrega com a credencial da loja, que mora na nuvem).
  @Get('foto-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  async fotoDaLoja(
    @SyncCtx() ctx: SyncCtxData,
    @Query('chamado') chamado: string,
    @Query('n') n: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.disputa.foto(ctx.tenantId, String(chamado ?? ''), Number(n) || 0);
    res.setHeader('Content-Type', f.tipo);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(f.bytes);
  }
}
