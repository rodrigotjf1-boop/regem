import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Fila de impressão térmica. O WORKER do edge autentica por token 'servidor_local'
// (x-sync-token) — nunca JWT de usuário; tenant é forçado pelo token.
@Controller('impressao')
export class ImpressaoController {
  constructor(private readonly service: ProducaoPedidoService) {}

  @Get('pendentes')
  @UseGuards(SyncTokenGuard)
  pendentes(@SyncCtx() ctx: SyncCtxData) {
    return this.service.jobsPendentes(ctx.tenantId);
  }

  @Post(':id/impresso')
  @UseGuards(SyncTokenGuard)
  impresso(@SyncCtx() ctx: SyncCtxData, @Param('id') id: string) {
    return this.service.marcarImpresso(ctx.tenantId, id);
  }

  @Post(':id/erro')
  @UseGuards(SyncTokenGuard)
  erro(
    @SyncCtx() ctx: SyncCtxData,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.marcarErro(ctx.tenantId, id, dto?.erro);
  }

  // Fila recente para o painel (status + impressora). Gestor logado.
  @Get('fila')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  fila(@CurrentUser() user: AuthUser) {
    return this.service.filaRecente(user.tenantId);
  }

  // Página de teste para uma impressora (gestor logado).
  @Post('impressoras/:id/teste')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  teste(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.enfileirarTeste(user.tenantId, id);
  }

  // Reimprimir (gestor logado) — reenfileira um job com erro.
  @Post(':id/reimprimir')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  reimprimir(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reimprimir(user.tenantId, id);
  }
}
