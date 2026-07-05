import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
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
}
