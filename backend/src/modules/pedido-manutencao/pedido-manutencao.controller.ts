import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { PedidoManutencaoService } from './pedido-manutencao.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const CO = ['presidente', 'gerente'];

@Controller('manutencao')
@UseGuards(JwtAuthGuard)
export class PedidoManutencaoController {
  constructor(private readonly service: PedidoManutencaoService) {}

  // Qualquer colaborador registra um pedido de manutenção.
  @Post()
  criar(
    @CurrentUser() user: AuthUser,
    @Body() dto: any,
    @UnidadeAtual() atual: string | null,
  ) {
    return this.service.criar(user.tenantId, user.colaboradorId, dto, atual);
  }

  @Get()
  listar(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.listar(user.tenantId, atual);
  }

  // ---- Gestão (C&O / gerente delegado) ----
  @Post(':id/delegar')
  @UseGuards(RolesGuard)
  @Roles(...CO)
  delegar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.delegar(user.tenantId, user.colaboradorId!, user.categoria, id, dto?.responsavelId);
  }

  @Post(':id/status')
  @UseGuards(RolesGuard)
  @Roles(...CO)
  status(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.mudarStatus(user.tenantId, user.colaboradorId!, user.categoria, id, dto?.status, dto?.motivo);
  }

  @Post(':id/decisao-15d')
  @UseGuards(RolesGuard)
  @Roles(...CO)
  decisao(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.decidir15d(user.tenantId, user.colaboradorId!, user.categoria, id, dto?.decisao);
  }

  @Post(':id/excluir')
  @UseGuards(RolesGuard)
  @Roles(...CO)
  excluir(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.excluir(user.tenantId, user.colaboradorId!, user.categoria, id, dto?.motivo);
  }
}
