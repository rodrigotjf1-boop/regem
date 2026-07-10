import { Body, Controller, Delete, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { FidelidadeService } from './fidelidade.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Gestão dos planos de fidelidade (Delivery · Config). Só gestor.
@Controller('fidelidade')
@UseGuards(JwtAuthGuard, RolesGuard)
export class FidelidadeController {
  constructor(private readonly service: FidelidadeService) {}

  @Get('planos')
  @Roles('presidente', 'gerente', 'supervisao')
  planos(@CurrentUser() user: AuthUser) {
    return this.service.listarPlanos(user.tenantId);
  }

  @Post('planos')
  @Roles('presidente', 'gerente')
  salvar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.salvarPlano(user.tenantId, user.unidadeId ?? null, dto);
  }

  @Delete('planos/:id')
  @Roles('presidente', 'gerente')
  remover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removerPlano(user.tenantId, id);
  }

  @Post('planos/:id/finalizar')
  @Roles('presidente', 'gerente')
  finalizar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.finalizarPlano(user.tenantId, id);
  }

  @Get('planos/:id/participantes')
  @Roles('presidente', 'gerente', 'supervisao')
  participantes(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Query('telefone') telefone?: string,
  ) {
    return this.service.participantes(user.tenantId, id, telefone);
  }

  @Put('planos/:id/pontos')
  @Roles('presidente', 'gerente', 'supervisao')
  ajustar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.ajustarPontos(user.tenantId, id, dto);
  }

  @Get('relatorio')
  @Roles('presidente', 'gerente')
  relatorio(@CurrentUser() user: AuthUser, @Query('periodo') periodo?: string) {
    return this.service.relatorioResgates(user.tenantId, periodo ?? 'dia');
  }
}
