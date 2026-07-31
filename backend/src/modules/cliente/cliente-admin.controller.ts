import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { ClienteService } from './cliente.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Busca de cliente pela gestão (Delivery · Novo pedido) — autenticado.
@Controller('clientes')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('delivery')
export class ClienteAdminController {
  constructor(private readonly service: ClienteService) {}

  @Get('buscar')
  @Roles('presidente', 'gerente', 'supervisao', 'atendente')
  buscar(@CurrentUser() user: AuthUser, @Query('telefone') telefone?: string) {
    return this.service.buscarPorTelefone(user.tenantId, telefone ?? '');
  }

  // Diagnóstico do webhook do OTP — mostra o status/resposta do n8n.
  @Post('otp-teste')
  @Roles('presidente')
  otpTeste(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.testarWebhook(user.tenantId, dto?.telefone);
  }
}
