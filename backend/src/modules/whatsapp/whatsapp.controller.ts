import { Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
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

  // Diagnóstico: vars setadas? Evolution respondeu? lista as instâncias.
  @Get('whatsapp/diagnostico')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  diagnostico(@CurrentUser() user: AuthUser) {
    return this.service.diagnostico(user.tenantId);
  }

  // Vincula uma instância existente do Evolution (sem criar/parear de novo).
  @Post('whatsapp/vincular')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  vincular(@CurrentUser() user: AuthUser, @Body() dto: { instancia?: string }) {
    return this.service.vincular(user.tenantId, dto?.instancia ?? '');
  }

  // ===== Inbox (caixa de entrada sobre a instância Evolution) =====
  @Get('whatsapp/conversas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  conversas(@CurrentUser() user: AuthUser) {
    return this.service.listarConversas(user.tenantId);
  }

  @Get('whatsapp/mensagens')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  mensagens(@CurrentUser() user: AuthUser, @Query('jids') jids: string, @Query('jid') jid: string) {
    return this.service.mensagens(user.tenantId, jids || jid || '');
  }

  @Post('whatsapp/enviar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  enviar(@CurrentUser() user: AuthUser, @Body() dto: { numero?: string; jid?: string; texto?: string }) {
    const numero = dto?.numero ?? (dto?.jid ?? '').split('@')[0];
    return this.service.enviar(user.tenantId, numero ?? '', dto?.texto ?? '');
  }

  // Cardápios ativos (para o inbox perguntar de qual, se houver mais de um).
  @Get('whatsapp/cardapios')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  cardapios(@CurrentUser() user: AuthUser) {
    return this.service.listarCardapios(user.tenantId);
  }

  // Envia o cardápio em PDF para o número da conversa.
  @Post('whatsapp/enviar-cardapio')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  enviarCardapio(
    @CurrentUser() user: AuthUser,
    @Body() dto: { numero?: string; cardapioId?: string },
  ) {
    return this.service.enviarCardapio(user.tenantId, dto?.numero ?? '', dto?.cardapioId);
  }

  // Pausa/retoma o robô só nesta conversa (o humano assume).
  @Post('whatsapp/pausar-conversa')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  pausarConversa(@CurrentUser() user: AuthUser, @Body() dto: { numero?: string; pausar?: boolean }) {
    return this.service.pausarConversa(user.tenantId, dto?.numero ?? '', dto?.pausar !== false);
  }

  // Resolver do bot multi-tenant: o n8n manda instância + secret e recebe a loja.
  @Get('publico/bot/resolver')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  resolver(
    @Query('instancia') instancia: string,
    @Query('secret') secret: string,
    @Query('numero') numero?: string,
  ) {
    return this.service.resolver(instancia ?? '', secret ?? '', numero ?? '');
  }
}
