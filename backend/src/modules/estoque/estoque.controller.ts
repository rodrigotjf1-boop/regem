import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { EstoqueService } from './estoque.service';
import { CreateItemDto } from './dto/create-item.dto';
import { CreateMovimentoDto } from './dto/create-movimento.dto';

@Controller('estoque')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EstoqueController {
  constructor(private readonly service: EstoqueService) {}

  @Post('itens')
  @Roles('presidente', 'gerente', 'supervisao')
  createItem(@CurrentUser() user: AuthUser, @Body() dto: CreateItemDto) {
    return this.service.createItem(user.tenantId, dto);
  }

  @Get('itens')
  listItens(@CurrentUser() user: AuthUser) {
    return this.service.listItens(user.tenantId);
  }

  @Post('movimentos')
  @Roles('presidente', 'gerente', 'supervisao')
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
    return this.service.inteligencia(user.tenantId, ini, fim || hoje);
  }

  // Validades FEFO: lotes por vencimento com status.
  @Get('validades')
  @Roles('presidente', 'gerente', 'supervisao')
  validades(@CurrentUser() user: AuthUser) {
    return this.service.validades(user.tenantId);
  }
}
