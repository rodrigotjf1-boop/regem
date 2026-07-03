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
}
