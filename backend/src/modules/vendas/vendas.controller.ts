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
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { TerminalAtual } from '../../auth/terminal-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { VendasService } from './vendas.service';
import { VendaBalcaoDto } from './dto/venda-balcao.dto';

// PDV — operador de balcão. Guarda de perfil no servidor: as áreas pdv/mesas/cupons
// exigem a permissão do perfil (@RequirePerm). Sem @RequirePerm/@Roles no método,
// segue liberado a qualquer autenticado (config/leituras auxiliares do PDV).
@Controller('vendas')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class VendasController {
  constructor(private readonly service: VendasService) {}

  @Post('balcao')
  @RequirePerm('pdv')
  balcao(
    @CurrentUser() user: AuthUser,
    @TerminalAtual() terminalId: string | null,
    @Body() dto: VendaBalcaoDto,
  ) {
    return this.service.vendaBalcao(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      dto,
      terminalId,
    );
  }

  // ----- Mesas (Fase F2) -----
  @Get('mesas')
  @RequirePerm('mesas')
  listarMesas(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeAtual: string | null,
    @Query('unidadeId') unidadeId?: string,
  ) {
    return this.service.listarMesas(
      user.tenantId,
      (user.categoria === 'presidente' ? unidadeId || unidadeAtual : unidadeAtual) || undefined,
    );
  }

  @Post('mesas')
  @RequirePerm('mesas')
  abrirMesa(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.abrirMesa(user.tenantId, user.colaboradorId, dto);
  }

  @Get('mesas/:id')
  getMesa(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getMesa(user.tenantId, id);
  }

  @Post('mesas/:id/comandas')
  @RequirePerm('mesas')
  abrirComandaNaMesa(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.abrirComandaNaMesa(user.tenantId, user.colaboradorId, id, dto);
  }

  @Post('mesas/:id/fechar')
  @RequirePerm('mesas')
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
  @RequirePerm('mesas')
  listarComandas(@CurrentUser() user: AuthUser) {
    return this.service.listarComandas(user.tenantId);
  }

  @Post('comandas')
  @RequirePerm('mesas')
  abrir(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.abrirComanda(user.tenantId, user.colaboradorId, dto);
  }

  @Get('comandas/:id')
  getComanda(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getComanda(user.tenantId, id);
  }

  @Post('comandas/:id/itens')
  @RequirePerm('mesas')
  adicionarItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.adicionarItem(user.tenantId, user.colaboradorId, id, dto);
  }

  @Delete('comandas/itens/:itemId')
  @RequirePerm('mesas')
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
  @RequirePerm('mesas')
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
  @RequirePerm('mesas')
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
  @RequirePerm('cupons')
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
  @RequirePerm('cupons')
  reimprimirCupom(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reimprimirCupom(user.tenantId, user.colaboradorId, id);
  }

  @Post('comandas/:id/cancelar')
  @RequirePerm('mesas')
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
