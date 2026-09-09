import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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

  // Métricas/ROI de uma campanha (enviados/falhas + cupons resgatados + pedidos atribuídos).
  @Get(':id/metricas')
  metricas(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.metricas(user.tenantId, id);
  }

  @Get('previa')
  previa(
    @CurrentUser() user: AuthUser,
    @Query('segmento') segmento?: string,
    @Query('recuperacaoDias') recuperacaoDias?: string,
  ) {
    return this.service.previa(user.tenantId, segmento ?? 'todos', Number(recuperacaoDias) || undefined);
  }

  @Post()
  criar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criar(user.tenantId, user.colaboradorId ?? null, user.unidadeId ?? null, dto);
  }

  // Opt-out de um CLIENTE cadastrado (toggle do flag).
  @Post('opt-out')
  optOut(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.toggleOptOut(user.tenantId, String(dto?.clienteId ?? ''), !!dto?.optOut);
  }

  // Adiciona um TELEFONE à lista de exclusão (cobre quem não é cliente cadastrado).
  @Post('excluir-telefone')
  excluirTelefone(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.optOutPorTelefone(user.tenantId, String(dto?.telefone ?? ''), 'manual');
  }
}
