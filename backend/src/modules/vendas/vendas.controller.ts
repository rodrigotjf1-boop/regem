import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { VendasService } from './vendas.service';
import { VendaBalcaoDto } from './dto/venda-balcao.dto';

// PDV — qualquer usuário autenticado (operador de balcão) pode vender.
@Controller('vendas')
@UseGuards(JwtAuthGuard)
export class VendasController {
  constructor(private readonly service: VendasService) {}

  @Post('balcao')
  balcao(@CurrentUser() user: AuthUser, @Body() dto: VendaBalcaoDto) {
    return this.service.vendaBalcao(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      dto,
    );
  }

  // ----- Mesas & comandas -----
  @Get('comandas')
  listarComandas(@CurrentUser() user: AuthUser) {
    return this.service.listarComandas(user.tenantId);
  }

  @Post('comandas')
  abrir(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.abrirComanda(user.tenantId, user.colaboradorId, dto);
  }

  @Get('comandas/:id')
  getComanda(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getComanda(user.tenantId, id);
  }

  @Post('comandas/:id/itens')
  adicionarItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.adicionarItem(user.tenantId, user.colaboradorId, id, dto);
  }

  @Delete('comandas/itens/:itemId')
  removerItem(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string) {
    return this.service.removerItem(user.tenantId, itemId);
  }

  @Post('comandas/:id/fechar')
  fechar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.fecharComanda(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      id,
      dto,
    );
  }

  // ----- Config do PDV (cancelamento configurável) -----
  @Get('config')
  config(@CurrentUser() user: AuthUser) {
    return this.service.getConfig(user.tenantId);
  }

  @Post('config/cancelamento-livre')
  @UseGuards(RolesGuard)
  @Roles('presidente')
  setCancelamentoLivre(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setCancelamentoLivre(user.tenantId, !!dto.ativo);
  }

  // ----- Cupons & cancelamento -----
  @Get('cupons')
  cupons(@CurrentUser() user: AuthUser) {
    return this.service.listarCupons(user.tenantId);
  }

  @Get('cupons/:id')
  cupom(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getCupom(user.tenantId, id);
  }

  @Post('comandas/:id/cancelar')
  cancelar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.cancelar(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      id,
      dto,
    );
  }
}
