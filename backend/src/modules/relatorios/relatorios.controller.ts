import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
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

  @Get('balcao')
  balcao(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.detalheCanal(user.tenantId, 'balcao', inicio, fim);
  }

  @Get('delivery')
  delivery(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.detalheCanal(user.tenantId, 'delivery', inicio, fim);
  }

  @Get('ranking-produtos')
  ranking(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.rankingProdutos(user.tenantId, inicio, fim);
  }

  @Get('turnos')
  turnos(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.turnos(user.tenantId, inicio, fim);
  }

  @Get('turnos/:id')
  turnoDetalhe(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.turnoDetalhe(user.tenantId, id);
  }

  @Get('faturamento')
  faturamento(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.faturamentoPeriodo(user.tenantId, inicio, fim);
  }

  @Get('faturamento-delivery')
  faturamentoDelivery(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.faturamentoDelivery(user.tenantId, inicio, fim);
  }

  @Get('producao')
  producao(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
    @Query('agrupamento') agrupamento?: 'dia' | 'semana' | 'mes',
  ) {
    return this.service.producao(user.tenantId, inicio, fim, agrupamento);
  }
}
