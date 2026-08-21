import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { EntregadorService } from './entregador.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// App do Entregador (E0). Auth = login de colaborador (JWT); só nuvem.
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
}
