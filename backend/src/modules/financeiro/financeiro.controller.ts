import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { FinanceiroService } from './financeiro.service';
import { CreateTituloDto } from './dto/create-titulo.dto';
import { PagarTituloDto } from './dto/pagar-titulo.dto';

// Financeiro (contas a pagar/receber + caixa) — presidente e gerente.
@Controller('financeiro')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('presidente', 'gerente')
export class FinanceiroController {
  constructor(private readonly service: FinanceiroService) {}

  @Get('titulos')
  listar(
    @CurrentUser() user: AuthUser,
    @Query('tipo') tipo?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listar(user.tenantId, tipo || undefined, status || undefined);
  }

  @Get('resumo')
  resumo(@CurrentUser() user: AuthUser) {
    return this.service.resumo(user.tenantId);
  }

  @Get('fluxo')
  fluxo(@CurrentUser() user: AuthUser, @Query('dias') dias?: string) {
    return this.service.fluxoCaixa(user.tenantId, dias ? Number(dias) : 30);
  }

  @Get('dre')
  dre(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    const hoje = new Date();
    const ini = inicio || new Date(hoje.getFullYear(), hoje.getMonth(), 1).toISOString().slice(0, 10);
    return this.service.dreCaixa(user.tenantId, ini, fim || hoje.toISOString().slice(0, 10));
  }

  @Post('titulos')
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateTituloDto) {
    return this.service.criar(user.tenantId, user.colaboradorId, user.categoria, dto);
  }

  @Post('titulos/:id/pagar')
  pagar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PagarTituloDto,
  ) {
    return this.service.pagar(user.tenantId, user.colaboradorId, user.categoria, id, dto);
  }

  @Post('titulos/:id/estornar')
  estornar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.estornar(user.tenantId, user.colaboradorId, user.categoria, id);
  }

  // ----- Caixa (sessão) — atendente também opera o caixa (Fase A). -----
  @Get('caixa')
  @Roles('presidente', 'gerente', 'atendente')
  caixa(@CurrentUser() user: AuthUser) {
    return this.service.caixaAtual(user.tenantId);
  }

  @Post('caixa/abrir')
  @Roles('presidente', 'gerente', 'atendente')
  abrirCaixa(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.abrirSessao(user.tenantId, user.colaboradorId, dto);
  }

  @Post('caixa/movimentar')
  @Roles('presidente', 'gerente', 'atendente')
  movimentarCaixa(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.movimentarCaixa(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      dto,
    );
  }

  // ----- Formas de pagamento (cadastro) — leitura liberada ao operador. -----
  @Get('formas-pagamento')
  @Roles('presidente', 'gerente', 'atendente')
  formasPagamento(@CurrentUser() user: AuthUser) {
    return this.service.listarFormasPagamento(user.tenantId);
  }

  @Post('formas-pagamento')
  @Roles('presidente', 'gerente')
  criarFormaPagamento(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criarFormaPagamento(user.tenantId, dto);
  }

  @Post('formas-pagamento/:id/ativa')
  @Roles('presidente', 'gerente')
  ativarFormaPagamento(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.setFormaPagamentoAtiva(user.tenantId, id, !!dto.ativo);
  }

  // Config do caixa: liberar sangria/suprimento pelo atendente (presidente).
  @Get('caixa/config')
  @Roles('presidente', 'gerente', 'atendente')
  configCaixa(@CurrentUser() user: AuthUser) {
    return this.service.getConfigCaixa(user.tenantId);
  }

  @Post('caixa/config/livre')
  @Roles('presidente')
  setCaixaLivre(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setCaixaLivre(user.tenantId, !!dto.ativo);
  }

  @Post('caixa/fechar')
  @Roles('presidente', 'gerente', 'atendente')
  fecharCaixa(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.fecharSessao(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      dto,
    );
  }
}
