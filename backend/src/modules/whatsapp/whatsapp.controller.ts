import { Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { WhatsappService } from './whatsapp.service';
import { CloudOnly } from '../../common/cloud-only.decorator';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Onboarding do WhatsApp da loja (gestor). O resolver é público (com secret).
@Controller()
@CloudOnly()
export class WhatsappController {
  constructor(private readonly service: WhatsappService) {}

  @Post('whatsapp/conectar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  conectar(@CurrentUser() user: AuthUser) {
    return this.service.conectar(user.tenantId);
  }

  @Get('whatsapp/status')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('bot')
  status(@CurrentUser() user: AuthUser) {
    return this.service.status(user.tenantId);
  }

  @Delete('whatsapp/desconectar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  desconectar(@CurrentUser() user: AuthUser) {
    return this.service.desconectar(user.tenantId);
  }

  // ===== Número de MARKETING (F5b) — 2º WhatsApp p/ campanhas (gate 'delivery', contexto CRM). =====
  @Post('whatsapp/marketing/conectar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  conectarMarketing(@CurrentUser() user: AuthUser) {
    return this.service.conectarMarketing(user.tenantId);
  }

  @Get('whatsapp/marketing/status')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('delivery')
  statusMarketing(@CurrentUser() user: AuthUser) {
    return this.service.statusMarketing(user.tenantId);
  }

  @Delete('whatsapp/marketing/desconectar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  desconectarMarketing(@CurrentUser() user: AuthUser) {
    return this.service.desconectarMarketing(user.tenantId);
  }

  // Diagnóstico: vars setadas? Evolution respondeu? lista as instâncias.
  @Get('whatsapp/diagnostico')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  diagnostico(@CurrentUser() user: AuthUser) {
    return this.service.diagnostico(user.tenantId);
  }

  // Vincula uma instância existente do Evolution (sem criar/parear de novo).
  @Post('whatsapp/vincular')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  vincular(@CurrentUser() user: AuthUser, @Body() dto: { instancia?: string }) {
    return this.service.vincular(user.tenantId, dto?.instancia ?? '');
  }

  // ===== Inbox (caixa de entrada sobre a instância Evolution) =====
  @Get('whatsapp/conversas')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('bot')
  conversas(@CurrentUser() user: AuthUser) {
    return this.service.listarConversas(user.tenantId);
  }

  @Get('whatsapp/mensagens')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('bot')
  mensagens(@CurrentUser() user: AuthUser, @Query('jids') jids: string, @Query('jid') jid: string) {
    return this.service.mensagens(user.tenantId, jids || jid || '');
  }

  @Post('whatsapp/enviar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('bot')
  enviar(@CurrentUser() user: AuthUser, @Body() dto: { numero?: string; jid?: string; texto?: string }) {
    const numero = dto?.numero ?? (dto?.jid ?? '').split('@')[0];
    return this.service.enviar(user.tenantId, numero ?? '', dto?.texto ?? '');
  }

  // Baixa a mídia de uma mensagem sob demanda (miniatura no inbox).
  @Get('whatsapp/midia')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('bot')
  midia(
    @CurrentUser() user: AuthUser,
    @Query('id') id: string,
    @Query('jid') jid: string,
    @Query('fromMe') fromMe: string,
  ) {
    return this.service.midia(user.tenantId, id ?? '', jid ?? '', fromMe === 'true');
  }

  // Cardápios ativos (para o inbox perguntar de qual, se houver mais de um).
  @Get('whatsapp/cardapios')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('bot')
  cardapios(@CurrentUser() user: AuthUser) {
    return this.service.listarCardapios(user.tenantId);
  }

  // Envia o cardápio em PDF para o número da conversa.
  @Post('whatsapp/enviar-cardapio')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('bot')
  enviarCardapio(
    @CurrentUser() user: AuthUser,
    @Body() dto: { numero?: string; cardapioId?: string },
  ) {
    return this.service.enviarCardapio(user.tenantId, dto?.numero ?? '', dto?.cardapioId);
  }

  // Pausa/retoma o robô só nesta conversa (o humano assume).
  @Post('whatsapp/pausar-conversa')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('bot')
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

  // Status de um pedido por NÚMERO (senha), para o robô responder o cliente.
  // O n8n manda instância + secret + telefone + numero e recebe um texto pronto.
  @Get('publico/bot/pedido-status')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  statusPedidoBot(
    @Query('instancia') instancia: string,
    @Query('secret') secret: string,
    @Query('numero') numero?: string,
    @Query('telefone') telefone?: string,
  ) {
    return this.service.statusPedidoBot(instancia ?? '', secret ?? '', telefone ?? '', numero ?? '');
  }

  // Pedidos RECENTES do cliente por telefone (contexto da IA "cadê meu pedido").
  // Autenticado pelo secret do bot — não exige token de cliente.
  @Get('publico/bot/pedidos')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  pedidosBot(
    @Query('instancia') instancia: string,
    @Query('secret') secret: string,
    @Query('telefone') telefone?: string,
  ) {
    return this.service.pedidosPorTelefoneBot(instancia ?? '', secret ?? '', telefone ?? '');
  }
}
