import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { SuporteService } from './suporte.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// F9 — controle do acesso de suporte pela LOJA. Só o presidente (o técnico é
// cat='suporte' e nunca passa em @Roles('presidente') — não pode se desbloquear).
@Controller('suporte')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('presidente')
export class SuporteController {
  constructor(private readonly service: SuporteService) {}

  @Get('estado')
  estado(@CurrentUser() user: AuthUser) {
    return this.service.estado(user.tenantId);
  }

  @Get('sessoes')
  sessoes(@CurrentUser() user: AuthUser) {
    return this.service.sessoes(user.tenantId);
  }

  @Patch('bloquear')
  bloquear(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.bloquear(user.tenantId, user.colaboradorId, user.categoria, !!dto?.bloquear);
  }
}
