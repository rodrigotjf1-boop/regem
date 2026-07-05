import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const GESTOR = ['presidente', 'gerente', 'supervisao'];

@Controller('delivery')
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}

  // Ingestão pelo EDGE (token servidor_local): { canal, pedido }.
  @Post('ingest')
  @UseGuards(SyncTokenGuard)
  ingest(@SyncCtx() ctx: SyncCtxData, @Body() dto: any) {
    return this.service.ingest(
      ctx.tenantId,
      ctx.unidadeId ?? null,
      dto?.canal ?? 'ifood',
      dto?.pedido ?? dto,
    );
  }

  // ----- Gestão (PDV) -----
  @Get('pedidos')
  @UseGuards(JwtAuthGuard)
  pedidos(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId);
  }

  @Post('pedidos/:id/aceitar')
  @UseGuards(JwtAuthGuard)
  aceitar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.aceitar(user.tenantId, user.colaboradorId, id);
  }

  @Post('pedidos/:id/avancar')
  @UseGuards(JwtAuthGuard)
  avancar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.avancar(user.tenantId, id);
  }

  @Post('pedidos/:id/cancelar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...GESTOR)
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
      dto?.motivo,
    );
  }

  @Get('config')
  @UseGuards(JwtAuthGuard)
  config(@CurrentUser() user: AuthUser) {
    return this.service.getConfig(user.tenantId, null);
  }

  @Put('config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  setConfig(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setConfig(user.tenantId, dto?.unidadeId ?? null, dto);
  }

  // Simulador (teste): injeta um pedido iFood de exemplo — como se o edge tivesse
  // recebido. Facilita validar o fluxo sem credenciais reais.
  @Post('simular')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...GESTOR)
  simular(@CurrentUser() user: AuthUser, @Body() dto: any) {
    const exemplo = {
      id: 'SIM-' + Date.now(),
      displayId: '#' + Math.floor(Math.random() * 9000 + 1000),
      orderType: 'DELIVERY',
      customer: { name: dto?.cliente ?? 'Cliente Simulado' },
      delivery: { deliveryAddress: { formattedAddress: 'Rua Exemplo, 100' } },
      items: dto?.items ?? [
        { externalCode: dto?.codigo, name: dto?.produto ?? 'Item delivery', quantity: 1, unitPrice: dto?.preco ?? 25 },
      ],
      total: { orderAmount: dto?.preco ?? 25 },
      payments: { methods: [{ method: 'online' }] },
    };
    return this.service.ingest(user.tenantId, null, 'ifood', exemplo);
  }
}
