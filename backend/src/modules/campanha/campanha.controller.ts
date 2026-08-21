import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { CampanhaService } from './campanha.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Campanhas de WhatsApp por segmento — só nuvem, só gestão (dado de cliente é PII).
@Controller('campanhas')
@CloudOnly()
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('delivery')
@Roles('presidente', 'gerente')
export class CampanhaController {
  constructor(private readonly service: CampanhaService) {}

  @Get()
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId);
  }

  @Get('previa')
  previa(@CurrentUser() user: AuthUser, @Query('segmento') segmento?: string) {
    return this.service.previa(user.tenantId, segmento ?? 'todos');
  }

  @Post()
  criar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criar(user.tenantId, user.colaboradorId ?? null, dto);
  }

  @Post('opt-out')
  optOut(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.toggleOptOut(user.tenantId, String(dto?.clienteId ?? ''), !!dto?.optOut);
  }
}
