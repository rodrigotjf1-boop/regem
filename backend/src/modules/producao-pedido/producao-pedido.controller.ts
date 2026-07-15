import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { ProducaoPedidoService } from './producao-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const GESTOR = ['presidente', 'gerente', 'supervisao'];

// Produção (Fase F1). Ver decisoes-design. KDS informa/avança; PDV é dono do ciclo.
@Controller('producao')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class ProducaoPedidoController {
  constructor(private readonly service: ProducaoPedidoService) {}

  // ----- KDS (operacional): fila por setor + avanço de status -----
  @Get('fila')
  fila(
    @CurrentUser() user: AuthUser,
    @Query('setorId') setorId?: string,
    @Query('unidadeId') unidadeId?: string,
    @Query('canal') canal?: string,
  ) {
    return this.service.filaKds(user.tenantId, {
      setorId: setorId || undefined,
      unidadeId: unidadeId || undefined,
      canal: canal || undefined,
    });
  }

  @Post('pedidos/:id/avancar')
  avancar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.avancar(user.tenantId, user.colaboradorId, id, dto?.escopo);
  }

  // ----- PDV (atendente é dono): consultar + cancelar em produção -----
  @Get('pedidos')
  pedidos(@CurrentUser() user: AuthUser, @Query('unidadeId') unidadeId?: string) {
    return this.service.filaPdv(user.tenantId, {
      unidadeId: unidadeId || undefined,
    });
  }

  @Post('pedidos/:id/cancelar')
  cancelar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.cancelarPedido(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      id,
      dto?.motivo,
    );
  }

  // ----- Config de roteamento e cores (gerência/presidente) -----
  @Get('produtos/:id/destinos')
  destinosProduto(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.destinosDoProduto(user.tenantId, id);
  }

  @Put('produtos/:id/destinos')
  @Roles(...GESTOR)
  @RequirePerm('producao_kds')
  setDestinosProduto(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.setDestinosProduto(
      user.tenantId,
      id,
      dto?.equipamentoIds ?? [],
    );
  }

  @Get('setores/:id/destinos')
  destinosSetor(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.destinosDoSetor(user.tenantId, id);
  }

  @Put('setores/:id/destinos')
  @Roles(...GESTOR)
  @RequirePerm('producao_kds')
  setDestinosSetor(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.setDestinosSetor(
      user.tenantId,
      id,
      dto?.equipamentoIds ?? [],
    );
  }

  @Get('cores')
  cores(@CurrentUser() user: AuthUser, @Query('unidadeId') unidadeId?: string) {
    return this.service.getCores(user.tenantId, unidadeId || null);
  }

  @Put('cores')
  @Roles('presidente', 'gerente')
  @RequirePerm('producao_kds')
  setCores(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setCores(user.tenantId, dto?.unidadeId || null, {
      verdeAteMin: dto?.verdeAteMin,
      amareloAteMin: dto?.amareloAteMin,
      usaPreparo: dto?.usaPreparo,
      usaEntregue: dto?.usaEntregue,
    });
  }

  // Config da senha (período de reset) — gerente/presidente.
  @Get('senha/config')
  senhaConfig(@CurrentUser() user: AuthUser, @Query('unidadeId') unidadeId?: string) {
    return this.service.getSenhaConfig(user.tenantId, unidadeId || null);
  }

  @Put('senha/config')
  @Roles('presidente', 'gerente')
  @RequirePerm('producao_kds')
  setSenhaPeriodo(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setSenhaPeriodo(
      user.tenantId,
      dto?.unidadeId || null,
      dto?.periodo,
    );
  }
}
