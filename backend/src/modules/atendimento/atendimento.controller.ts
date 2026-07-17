import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { AtendimentoService } from './atendimento.service';

// Chamados de atendimento (handoff). Operados por quem está no balcão/gestão.
@Controller('atendimento')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AtendimentoController {
  constructor(private readonly service: AtendimentoService) {}

  @Get()
  @Roles('presidente', 'gerente', 'supervisao', 'atendente')
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId);
  }

  @Post(':id/resolver')
  @Roles('presidente', 'gerente', 'supervisao', 'atendente')
  resolver(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.resolver(user.tenantId, id, user.colaboradorId);
  }

  // Veredito de um pedido de cancelamento feito pelo cliente: aceita (cancela o
  // pedido de fato — exige senha de gestor) ou recusa (só encerra o chamado).
  @Post(':id/cancelamento')
  @Roles('presidente', 'gerente', 'supervisao', 'atendente')
  decidirCancelamento(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { aceita?: boolean; senha?: string; motivo?: string },
  ) {
    return this.service.decidirCancelamento(user, id, dto);
  }
}
