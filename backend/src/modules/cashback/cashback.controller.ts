import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CashbackService } from './cashback.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Gestão dos planos de cashback (Delivery · Config). Só gestor.
@Controller('cashback')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('cashback')
export class CashbackController {
  constructor(private readonly service: CashbackService) {}

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

  @Get('relatorio')
  @Roles('presidente', 'gerente')
  relatorio(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
    @Query('telefone') telefone?: string,
  ) {
    return this.service.relatorioResgates(user.tenantId, inicio, fim, telefone);
  }
}
