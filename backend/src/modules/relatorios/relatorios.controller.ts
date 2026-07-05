import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { RelatoriosService } from './relatorios.service';

// Relatórios de venda — gestão (presidente/gerente/supervisão).
@Controller('relatorios')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('presidente', 'gerente', 'supervisao')
export class RelatoriosController {
  constructor(private readonly service: RelatoriosService) {}

  @Get('vendas')
  vendas(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.vendas(user.tenantId, inicio, fim);
  }

  @Get('produtos')
  produtos(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.produtos(user.tenantId, inicio, fim);
  }

  @Get('atendentes')
  atendentes(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.atendentes(user.tenantId, inicio, fim);
  }
}
