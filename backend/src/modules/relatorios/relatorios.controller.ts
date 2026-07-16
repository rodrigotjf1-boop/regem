import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { RelatoriosService } from './relatorios.service';

// Relatórios de venda — gestão (presidente/gerente/supervisão).
@Controller('relatorios')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@Roles('presidente', 'gerente', 'supervisao')
@RequirePerm('relatorios_vendas')
export class RelatoriosController {
  constructor(private readonly service: RelatoriosService) {}

  // Vê valores em R$ conforme o perfil (permissão "ver_financeiro"). Sem ela, os
  // campos financeiros vêm anulados (RBAC no servidor, não no front).
  private verFin(user: AuthUser) {
    return !!user.permissoes?.ver_financeiro;
  }

  @Get('vendas')
  vendas(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.vendas(user.tenantId, inicio, fim, this.verFin(user));
  }

  @Get('produtos')
  produtos(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.produtos(user.tenantId, inicio, fim, this.verFin(user));
  }

  @Get('atendentes')
  atendentes(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.atendentes(user.tenantId, inicio, fim, this.verFin(user));
  }

  @Get('operacoes-caixa')
  operacoesCaixa(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.operacoesCaixa(user.tenantId, inicio, fim, this.verFin(user));
  }

  @Get('balcao')
  balcao(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.detalheCanal(user.tenantId, 'balcao', inicio, fim, this.verFin(user));
  }

  @Get('delivery')
  delivery(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.detalheCanal(user.tenantId, 'delivery', inicio, fim, this.verFin(user));
  }

  @Get('ranking-produtos')
  ranking(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.rankingProdutos(user.tenantId, inicio, fim, this.verFin(user));
  }

  @Get('turnos')
  turnos(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.turnos(user.tenantId, inicio, fim, this.verFin(user));
  }

  @Get('turnos/:id')
  turnoDetalhe(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.turnoDetalhe(user.tenantId, id, this.verFin(user));
  }

  // Relatórios puramente financeiros — presidente/C&O apenas.
  @Get('faturamento')
  @RequirePerm('ver_financeiro')
  faturamento(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.faturamentoPeriodo(user.tenantId, inicio, fim);
  }

  @Get('faturamento-delivery')
  @RequirePerm('ver_financeiro')
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
    return this.service.producao(user.tenantId, inicio, fim, agrupamento, this.verFin(user));
  }
}
