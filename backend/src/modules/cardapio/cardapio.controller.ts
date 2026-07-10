import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CardapioService } from './cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Público (sem login): o token na URL identifica o cardápio/loja.
@Controller('publico/cardapio')
export class CardapioPublicoController {
  constructor(private readonly service: CardapioService) {}

  @Get(':token')
  menu(@Param('token') token: string) {
    return this.service.menu(token);
  }

  // Rate limit apertado no envio de pedido (endpoint público).
  @Post(':token/pedido')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  pedido(@Param('token') token: string, @Body() dto: any) {
    return this.service.receberPedido(token, dto);
  }

  @Post(':token/cupom')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  cupom(@Param('token') token: string, @Body() dto: any) {
    return this.service.validarCupomPublico(token, dto?.codigo ?? '', dto?.subtotal ?? 0);
  }

  @Get(':token/pedido/:id')
  status(@Param('token') token: string, @Param('id') id: string) {
    return this.service.statusPedido(token, id);
  }

  @Post(':token/pedido/:id/pagar')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  pagar(@Param('token') token: string, @Param('id') id: string) {
    return this.service.pagarPedidoPublico(token, id);
  }

  @Get(':token/pontos')
  pontos(@Param('token') token: string, @Query('telefone') telefone: string) {
    return this.service.pontosPublico(token, telefone ?? '');
  }

  @Get(':token/promos')
  promos(@Param('token') token: string) {
    return this.service.promosPublico(token);
  }

  // Pedidos recentes de um telefone (robô: "cadê meu pedido?").
  @Get(':token/pedidos')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  pedidosTelefone(@Param('token') token: string, @Query('telefone') telefone: string) {
    return this.service.pedidosPorTelefone(token, telefone ?? '');
  }

  // Handoff: o robô abre um chamado de atendimento para a loja.
  @Post(':token/atendimento')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  atendimento(@Param('token') token: string, @Body() dto: any) {
    return this.service.abrirAtendimento(token, dto);
  }
}

// Gestão (JWT).
@Controller('cardapio')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CardapioController {
  constructor(private readonly service: CardapioService) {}

  @Get('config')
  config(@CurrentUser() user: AuthUser) {
    return this.service.getConfig(user.tenantId, null);
  }

  @Put('config')
  @Roles('presidente', 'gerente')
  setConfig(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setConfig(user.tenantId, dto?.unidadeId ?? null, dto);
  }

  @Get('bairros')
  bairros(@CurrentUser() user: AuthUser) {
    return this.service.listarBairros(user.tenantId, null);
  }

  @Put('bairros')
  @Roles('presidente', 'gerente')
  setBairros(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setBairros(user.tenantId, dto?.unidadeId ?? null, dto?.bairros ?? []);
  }

  @Get('banners')
  banners(@CurrentUser() user: AuthUser) {
    return this.service.listarBanners(user.tenantId);
  }

  @Put('banners')
  @Roles('presidente', 'gerente')
  setBanners(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setBanners(user.tenantId, dto?.unidadeId ?? null, dto?.banners ?? []);
  }

  @Get('cupons')
  cupons(@CurrentUser() user: AuthUser) {
    return this.service.listarCupons(user.tenantId);
  }

  @Post('cupons')
  @Roles('presidente', 'gerente')
  criarCupom(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criarCupom(user.tenantId, dto?.unidadeId ?? null, dto);
  }

  @Delete('cupons/:id')
  @Roles('presidente', 'gerente')
  removerCupom(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removerCupom(user.tenantId, id);
  }
}
