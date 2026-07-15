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
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { FinanceiroService } from './financeiro.service';
import { CreateTituloDto } from './dto/create-titulo.dto';
import { PagarTituloDto } from './dto/pagar-titulo.dto';

// Financeiro. Contas a pagar/receber, resumo, fluxo e DRE exigem a permissão
// "financeiro" do perfil; o caixa/turno e as formas de pagamento são operacionais
// (gerente/atendente). RBAC no servidor.
@Controller('financeiro')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@Roles('presidente', 'gerente')
export class FinanceiroController {
  constructor(private readonly service: FinanceiroService) {}

  // ----- Contas a pagar/receber + relatórios financeiros — permissão 'financeiro'. -----
  @Get('titulos')
  @RequirePerm('financeiro')
  listar(
    @CurrentUser() user: AuthUser,
    @Query('tipo') tipo?: string,
    @Query('status') status?: string,
  ) {
    return this.service.listar(user.tenantId, tipo || undefined, status || undefined);
  }

  @Get('resumo')
  @RequirePerm('financeiro')
  resumo(@CurrentUser() user: AuthUser) {
    return this.service.resumo(user.tenantId);
  }

  @Get('fluxo')
  @RequirePerm('financeiro')
  fluxo(@CurrentUser() user: AuthUser, @Query('dias') dias?: string) {
    return this.service.fluxoCaixa(user.tenantId, dias ? Number(dias) : 30);
  }

  @Get('dre')
  @RequirePerm('financeiro')
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
  @RequirePerm('financeiro')
  criar(@CurrentUser() user: AuthUser, @Body() dto: CreateTituloDto) {
    return this.service.criar(user.tenantId, user.colaboradorId, user.categoria, dto);
  }

  @Patch('titulos/:id')
  @RequirePerm('financeiro')
  atualizar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateTituloDto,
  ) {
    return this.service.atualizar(user.tenantId, user.colaboradorId, user.categoria, id, dto);
  }

  @Delete('titulos/:id')
  @RequirePerm('financeiro')
  cancelar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.cancelar(user.tenantId, user.colaboradorId, user.categoria, id);
  }

  @Post('titulos/:id/pagar')
  @RequirePerm('financeiro')
  pagar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: PagarTituloDto,
  ) {
    return this.service.pagar(user.tenantId, user.colaboradorId, user.categoria, id, dto);
  }

  @Post('titulos/:id/estornar')
  @RequirePerm('financeiro')
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
  @RequirePerm('formas_pagamento')
  criarFormaPagamento(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criarFormaPagamento(user.tenantId, dto);
  }

  @Patch('formas-pagamento/:id')
  @Roles('presidente', 'gerente')
  @RequirePerm('formas_pagamento')
  atualizarFormaPagamento(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.atualizarFormaPagamento(user.tenantId, id, dto);
  }

  @Delete('formas-pagamento/:id')
  @Roles('presidente', 'gerente')
  @RequirePerm('formas_pagamento')
  removerFormaPagamento(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removerFormaPagamento(user.tenantId, id);
  }

  @Post('formas-pagamento/:id/ativa')
  @Roles('presidente', 'gerente')
  @RequirePerm('formas_pagamento')
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

  // Relatório de fechamentos de caixa (só gestão) — permissão "turnos".
  @Get('caixa/fechamentos')
  @Roles('presidente', 'gerente')
  @RequirePerm('turnos')
  fechamentos(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    return this.service.fechamentos(user.tenantId, inicio, fim);
  }
}
