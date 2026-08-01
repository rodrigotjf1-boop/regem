import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { KdsAlertaService } from './kds-alerta.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Cadastro dos alertas do rodapé do KDS (presidente/C&O/gerente). O disparo em si é
// feito pelo scheduler do serviço; aqui é só o CRUD + o disparo manual (teste/urgente).
@Controller('kds/alertas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class KdsAlertaController {
  constructor(private readonly service: KdsAlertaService) {}

  @Get()
  @Roles('presidente', 'gerente')
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId);
  }

  @Post()
  @Roles('presidente', 'gerente')
  criar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criar(user.tenantId, user.colaboradorId ?? null, dto);
  }

  @Patch(':id')
  @Roles('presidente', 'gerente')
  atualizar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.atualizar(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  remover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.remover(user.tenantId, id);
  }

  // Disparo manual/urgente — o presidente/gerente joga um alerta no rodapé na hora.
  @Post('disparar')
  @Roles('presidente', 'gerente')
  disparar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.dispararManual(user.tenantId, dto);
  }
}
