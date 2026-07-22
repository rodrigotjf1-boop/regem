import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { UnidadeAtual } from '../../../auth/unidade-atual.decorator';
import { AuthUser } from '../../../auth/auth-user';
import { Food99Service } from './food99.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Integração 99Food / DiDi Food. O webhook é PÚBLICO (o 99food chama de fora, no
// callback registrado no portal). Exige URL pública → roda na nuvem.
@Controller('integracoes/99food')
export class Food99Controller {
  constructor(private readonly service: Food99Service) {}

  // Webhook do 99food (orderNew/orderCancel/orderFinish). PÚBLICO.
  // Lê o CORPO CRU (req.rawBody, habilitado no main.ts) porque o order_id é
  // inteiro 64-bit — JSON.parse do body-parser corromperia. O service extrai o id
  // como string por regex. Responde no formato StandardResponse (errno 0).
  @Post('webhook')
  @Throttle({ default: { ttl: 60000, limit: 240 } })
  async webhook(@Req() req: RawBodyRequest<Request>, @Body() body: any) {
    const raw = req.rawBody?.toString('utf8') || (body ? JSON.stringify(body) : '');
    return this.service
      .processarWebhook(raw)
      .catch(() => ({ errno: 0, errmsg: 'error-handled' }));
  }

  // Salva as credenciais do app (app_id + app_secret + app_shop_id). Só gestor.
  @Post('credenciais')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  salvar(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body() dto: { appId?: string; appSecret?: string; appShopId?: string; unidadeId?: string },
  ) {
    return this.service.salvarCredenciais(
      user.tenantId,
      (dto?.unidadeId ?? atual) || null,
      (dto?.appId ?? '').trim(),
      (dto?.appSecret ?? '').trim(),
      (dto?.appShopId ?? '').trim(),
    );
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  status(@CurrentUser() user: AuthUser) {
    return this.service.status(user.tenantId);
  }

  // Gera/retorna um auth_token fresco da loja (p/ colar na Ferramenta de Sandbox).
  @Get('token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  token(@CurrentUser() user: AuthUser) {
    return this.service.tokenAtual(user.tenantId);
  }

  // Sobe um cardápio mínimo (1 item) na loja de teste — pré-requisito do Sandbox.
  @Post('cardapio-teste')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  cardapioTeste(@CurrentUser() user: AuthUser) {
    return this.service.subirCardapioTeste(user.tenantId);
  }

  // Puxa UM pedido pelo order_id (teste ponta a ponta sem depender do webhook).
  @Post('puxar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  puxar(@CurrentUser() user: AuthUser, @Body() dto: { orderId?: string }) {
    return this.service.puxarPedido(user.tenantId, String(dto?.orderId ?? '').trim());
  }

  @Post('desconectar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  desconectar(@CurrentUser() user: AuthUser) {
    return this.service.desconectar(user.tenantId);
  }
}
