import { Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { WhatsappService } from './whatsapp.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Onboarding do WhatsApp da loja (gestor). O resolver é público (com secret).
@Controller()
export class WhatsappController {
  constructor(private readonly service: WhatsappService) {}

  @Post('whatsapp/conectar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  conectar(@CurrentUser() user: AuthUser) {
    return this.service.conectar(user.tenantId);
  }

  @Get('whatsapp/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  status(@CurrentUser() user: AuthUser) {
    return this.service.status(user.tenantId);
  }

  @Delete('whatsapp/desconectar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  desconectar(@CurrentUser() user: AuthUser) {
    return this.service.desconectar(user.tenantId);
  }

  // Resolver do bot multi-tenant: o n8n manda instância + secret e recebe a loja.
  @Get('publico/bot/resolver')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  resolver(@Query('instancia') instancia: string, @Query('secret') secret: string) {
    return this.service.resolver(instancia ?? '', secret ?? '');
  }
}
