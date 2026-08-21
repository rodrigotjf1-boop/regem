import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { EntregadorService } from './entregador.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// App do Entregador. Auth = login de colaborador (JWT); só nuvem.
@Controller('entregador')
@CloudOnly()
@UseGuards(JwtAuthGuard)
export class EntregadorController {
  constructor(private readonly service: EntregadorService) {}

  @Get('perfil')
  perfil(@CurrentUser() user: AuthUser) {
    return this.service.perfil(user);
  }

  @Post('dispositivo')
  dispositivo(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.registrarDispositivo(
      user.tenantId,
      user.colaboradorId,
      dto?.fcmToken ?? '',
      dto?.plataforma,
    );
  }

  // E1 — assume o pedido pelo código do cupom.
  @Post('scan')
  scan(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.scan(user, dto?.codigo ?? '');
  }

  // E1 — meus pedidos em rota.
  @Get('pedidos')
  pedidos(@CurrentUser() user: AuthUser) {
    return this.service.pedidos(user);
  }

  // E1 — finaliza a entrega (código opcional para marketplace de entrega própria).
  @Post('pedido/:id/finalizar')
  finalizar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.finalizar(user, id, dto?.codigo);
  }
}
