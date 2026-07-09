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
import { EstoqueService } from './estoque.service';
import { CreateItemDto } from './dto/create-item.dto';
import { CreateMovimentoDto } from './dto/create-movimento.dto';

@Controller('estoque')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class EstoqueController {
  constructor(private readonly service: EstoqueService) {}

  @Post('itens')
  @RequirePerm('estoque', 'criar')
  createItem(@CurrentUser() user: AuthUser, @Body() dto: CreateItemDto) {
    return this.service.createItem(user.tenantId, dto);
  }

  @Get('itens')
  listItens(@CurrentUser() user: AuthUser) {
    // Custo/valor em R$ conforme a permissão "ver_financeiro" do perfil.
    return this.service.listItens(user.tenantId, !!user.permissoes?.ver_financeiro);
  }

  @Patch('itens/:id')
  @RequirePerm('estoque', 'editar')
  updateItem(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: CreateItemDto,
  ) {
    return this.service.updateItem(user.tenantId, id, dto);
  }

  // ----- Categorias de insumo (cadastro próprio) -----
  @Get('categorias-item')
  listCategorias(@CurrentUser() user: AuthUser) {
    return this.service.listCategorias(user.tenantId);
  }

  @Post('categorias-item')
  @Roles('presidente', 'gerente', 'supervisao')
  createCategoria(
    @CurrentUser() user: AuthUser,
    @Body() dto: { nome: string; cor?: string },
  ) {
    return this.service.createCategoria(user.tenantId, dto);
  }

  @Delete('categorias-item/:id')
  @Roles('presidente', 'gerente', 'supervisao')
  removerCategoria(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removerCategoria(user.tenantId, id);
  }

  @Post('movimentos')
  @RequirePerm('estoque', 'editar')
  createMovimento(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateMovimentoDto,
  ) {
    return this.service.createMovimento(user.tenantId, dto);
  }

  @Get('movimentos')
  listMovimentos(
    @CurrentUser() user: AuthUser,
    @Query('itemId') itemId: string,
  ) {
    return this.service.listMovimentos(user.tenantId, itemId);
  }

  // Inteligência de estoque: valorização + reposição (ROP) + curva ABC no período.
  @Get('inteligencia')
  @Roles('presidente', 'gerente', 'supervisao')
  inteligencia(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio: string,
    @Query('fim') fim: string,
  ) {
    const hoje = new Date().toISOString().slice(0, 10);
    const ini =
      inicio ||
      new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10);
    return this.service.inteligencia(
      user.tenantId,
      ini,
      fim || hoje,
      !!user.permissoes?.ver_financeiro,
    );
  }

  // Validades FEFO: lotes por vencimento com status.
  @Get('validades')
  @Roles('presidente', 'gerente', 'supervisao')
  validades(@CurrentUser() user: AuthUser) {
    return this.service.validades(user.tenantId);
  }

  // CMV real (EI + Compras − EF) × teórico → desvio. Período padrão: mês corrente.
  // CMV é relatório de custo (financeiro) → exige a permissão "ver_financeiro".
  @Get('cmv')
  @RequirePerm('ver_financeiro')
  cmv(
    @CurrentUser() user: AuthUser,
    @Query('inicio') inicio?: string,
    @Query('fim') fim?: string,
  ) {
    const hoje = new Date();
    const ini =
      inicio ||
      new Date(hoje.getFullYear(), hoje.getMonth(), 1)
        .toISOString()
        .slice(0, 10);
    return this.service.cmvReal(user.tenantId, ini, fim || hoje.toISOString().slice(0, 10));
  }

  // Gera o snapshot de estoque de hoje (bootstrap/teste; o job mensal faz automático).
  @Post('snapshot')
  @Roles('presidente', 'gerente')
  snapshot(@CurrentUser() user: AuthUser) {
    return this.service.gerarSnapshot(user.tenantId);
  }

  // Alertas persistidos (ROP/FEFO) — gerados pelos jobs, resolvidos pelo gestor.
  @Get('alertas')
  @Roles('presidente', 'gerente', 'supervisao')
  alertas(@CurrentUser() user: AuthUser) {
    return this.service.listarAlertas(user.tenantId);
  }

  @Post('alertas/:id/resolver')
  @Roles('presidente', 'gerente', 'supervisao')
  resolverAlerta(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.resolverAlerta(user.tenantId, id, user.colaboradorId);
  }
}
