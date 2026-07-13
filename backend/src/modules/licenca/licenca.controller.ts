import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { LicencaService } from './licenca.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Controller()
export class LicencaController {
  constructor(private readonly service: LicencaService) {}

  // Status da conta (trial/assinatura) — o front usa para o aviso e o paywall.
  @Get('licenca/status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: AuthUser) {
    return this.service.statusConta(user.tenantId);
  }

  // ===== Portal da revenda (presidente/C&O) =====
  @Get('revenda')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente')
  revendas() {
    return this.service.listarRevendas();
  }

  @Post('revenda')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente')
  criarRevenda(@Body() dto: any) {
    return this.service.criarRevenda(dto?.nome);
  }

  @Post('revenda/token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente')
  emitir(@Body() dto: any) {
    return this.service.emitirToken(dto);
  }

  @Get('revenda/frota')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente')
  frota() {
    return this.service.frota();
  }

  @Post('ativacao/:id/modulos')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente')
  modulos(@Param('id') id: string, @Body() dto: any) {
    return this.service.atualizarModulos(id, dto?.modulos ?? [], dto?.plano);
  }

  @Post('ativacao/:id/suspender')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente')
  suspender(@Param('id') id: string) {
    return this.service.mudarStatus(id, 'suspenso');
  }

  @Post('ativacao/:id/reativar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente')
  reativar(@Param('id') id: string) {
    return this.service.mudarStatus(id, 'ativado');
  }

  @Post('ativacao/:id/revogar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente')
  revogar(@Param('id') id: string) {
    return this.service.mudarStatus(id, 'revogado');
  }

  @Post('ativacao/:id/rebind')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente')
  rebind(@Param('id') id: string) {
    return this.service.rebind(id);
  }

  // ===== Provisionamento (edge, público por token) =====
  @Post('provisionamento/ativar')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  ativar(@Body() dto: any) {
    return this.service.ativar(dto?.token ?? '', dto?.fingerprint ?? '');
  }

  // ===== Edge (token de dispositivo servidor_local) =====
  @Get('edge/lease')
  @UseGuards(SyncTokenGuard)
  lease(@SyncCtx() ctx: SyncCtxData) {
    return this.service.renovarLease(ctx.tenantId);
  }

  @Post('edge/heartbeat')
  @UseGuards(SyncTokenGuard)
  heartbeat(@SyncCtx() ctx: SyncCtxData, @Body() dto: any) {
    return this.service.heartbeat(ctx.tenantId, dto);
  }
}
