import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
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

  // ----- Mesas (Fase F2) -----
  @Get('mesas')
  listarMesas(@CurrentUser() user: AuthUser, @Query('unidadeId') unidadeId?: string) {
    return this.service.listarMesas(user.tenantId, unidadeId || undefined);
  }

  @Post('mesas')
  abrirMesa(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.abrirMesa(user.tenantId, user.colaboradorId, dto);
  }

  @Get('mesas/:id')
  getMesa(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getMesa(user.tenantId, id);
  }

  @Post('mesas/:id/comandas')
  abrirComandaNaMesa(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.abrirComandaNaMesa(user.tenantId, user.colaboradorId, id, dto);
  }

  @Post('mesas/:id/fechar')
  fecharMesa(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.fecharMesa(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      id,
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
  removerItem(@CurrentUser() user: AuthUser, @Param('itemId') itemId: string, @Body() dto: any) {
    return this.service.removerItem(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      itemId,
      dto?.justificativa,
    );
  }

  // D1: excluir mesa vazia.
  @Delete('mesas/:id')
  excluirMesa(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.excluirMesa(user.tenantId, user.colaboradorId, id);
  }

  // D2: relatório de retiradas de item (gestão) — permissão "cancelamentos".
  @Get('remocoes')
  @UseGuards(RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('cancelamentos')
  remocoes(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.remocoesItens(user.tenantId, inicio, fim);
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

  // Busca por senha — precisa vir ANTES de :id p/ não ser capturada pela rota.
  @Get('cupons/busca')
  buscarCupom(@CurrentUser() user: AuthUser, @Query('senha') senha: string) {
    return this.service.buscarCupomPorSenha(user.tenantId, Number(senha));
  }

  @Get('cupons/:id')
  cupom(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getCupom(user.tenantId, id);
  }

  // Reimprime a 2ª via do comprovante (via do cliente) na impressora 'cupom'.
  @Post('cupons/:id/reimprimir')
  reimprimirCupom(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reimprimirCupom(user.tenantId, user.colaboradorId, id);
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
