import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
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

  // ===== CRM / segmentação (F3) — dado de cliente é PII: só gestão. =====
  @Get('crm/resumo')
  @Roles('presidente', 'gerente', 'supervisao')
  crmResumo(@CurrentUser() user: AuthUser) {
    return this.service.crmResumo(user.tenantId);
  }

  @Get('crm')
  @Roles('presidente', 'gerente', 'supervisao')
  crm(
    @CurrentUser() user: AuthUser,
    @Query('segmento') segmento?: string,
    @Query('busca') busca?: string,
    @Query('canal') canal?: string,
    @Query('bairro') bairro?: string,
    @Query('ordenar') ordenar?: string,
    @Query('direcao') direcao?: string,
    @Query('limite') limite?: string,
    @Query('offset') offset?: string,
  ) {
    return this.service.crmClientes(user.tenantId, {
      segmento: segmento ?? 'todos',
      busca: busca ?? '',
      canal: canal ?? '',
      bairro: bairro ?? '',
      ordenar: ordenar ?? '',
      direcao: direcao ?? '',
      limite: Number(limite) || 50,
      offset: Number(offset) || 0,
    });
  }

  // Bairros distintos (filtro do CRM).
  @Get('crm/bairros')
  @Roles('presidente', 'gerente', 'supervisao')
  crmBairros(@CurrentUser() user: AuthUser) {
    return this.service.crmBairros(user.tenantId);
  }

  // Exportação de dados sensíveis (LGPD): só presidente (sempre) e gerente quando o
  // presidente conceder a chave `clientes_exportar`. Toda exportação é auditada.
  @Post('export')
  @Roles('presidente', 'gerente')
  @RequirePerm('clientes_exportar')
  exportar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.exportar(user, dto ?? {});
  }

  @Get('crm/:id/historico')
  @Roles('presidente', 'gerente', 'supervisao')
  crmHistorico(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.crmHistorico(user.tenantId, id);
  }

  // Funil de conversão do cardápio (F4).
  @Get('funil')
  @Roles('presidente', 'gerente', 'supervisao')
  funil(@CurrentUser() user: AuthUser, @Query('dias') dias?: string) {
    return this.service.crmFunil(user.tenantId, Number(dias) || 30);
  }
}
