import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
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

// Financeiro. Valores financeiros (títulos a pagar/receber, resumo, fluxo, DRE)
// são presidente/C&O — o gerente só opera o CAIXA/turno e as formas de pagamento
// (operacional). RBAC no servidor: cada bloco marca seu @Roles.
@Controller('financeiro')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('presidente', 'gerente')
export class FinanceiroController {
  constructor(private readonly service: FinanceiroService) {}

  // ----- Contas a pagar/receber + relatórios financeiros — presidente/C&O. -----
  @Get('titulos')
  @Roles('presidente')
  listar(
    @CurrentUser() user: AuthUser,
    @Query('tipo') tipo?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listar(user.tenantId, tipo || undefined, status || undefined);
  }

  @Get('resumo')
  @Roles('presidente')
  resumo(@CurrentUser() user: AuthUser) {
    return this.service.resumo(user.tenantId);
  }

  @Get('fluxo')
  @Roles('presidente')
  fluxo(@CurrentUser() user: AuthUser, @Query('dias') dias?: string) {
    return this.service.fluxoCaixa(user.tenantId, dias ? Number(dias) : 30);
  }

  @Get('dre')
  @Roles('presidente')
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
  @Roles('presidente')
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateTituloDto) {
    return this.service.criar(user.tenantId, user.colaboradorId, user.categoria, dto);
  }

  @Patch('titulos/:id')
  @Roles('presidente')
  atualizar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateTituloDto,
  ) {
    return this.service.atualizar(user.tenantId, user.colaboradorId, user.categoria, id, dto);
  }

  @Delete('titulos/:id')
  @Roles('presidente')
  cancelar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.cancelar(user.tenantId, user.colaboradorId, user.categoria, id);
  }

  @Post('titulos/:id/pagar')
  @Roles('presidente')
  pagar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PagarTituloDto,
  ) {
    return this.service.pagar(user.tenantId, user.colaboradorId, user.categoria, id, dto);
  }

  @Post('titulos/:id/estornar')
  @Roles('presidente')
  estornar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.estornar(user.tenantId, user.colaboradorId, user.categoria, id);
  }

  // ----- Caixa (sessão) — atendente também opera o caixa (Fase A). -----
  @Get('caixa')
  @Roles('presidente', 'gerente', 'atendente')
  caixa(@CurrentUser() user: AuthUser, @Query('origem') origem?: string) {
    return this.service.caixaAtual(
      user.tenantId,
      origem === 'delivery' ? 'delivery' : 'pdv',
    );
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
