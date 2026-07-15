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
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { TefService } from './tef.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const GESTOR = ['presidente', 'gerente', 'supervisao'];

@Controller('tef')
export class TefController {
  constructor(private readonly service: TefService) {}

  // ----- PDV (JWT) -----
  @Post('pagamentos')
  @UseGuards(JwtAuthGuard)
  criar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criar(user.tenantId, user.colaboradorId, dto);
  }

  @Get('pagamentos')
  @UseGuards(JwtAuthGuard)
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listar(user.tenantId);
  }

  @Get('pagamentos/:id')
  @UseGuards(JwtAuthGuard)
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.get(user.tenantId, id);
  }

  @Post('pagamentos/:id/vincular')
  @UseGuards(JwtAuthGuard)
  vincular(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.vincularComanda(user.tenantId, id, dto?.comandaId);
  }

  @Post('pagamentos/:id/cancelar')
  @UseGuards(JwtAuthGuard)
  cancelar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.cancelar(user.tenantId, user.colaboradorId, user.categoria, id);
  }

  // Simulador (teste): aprova a cobrança como se o pinpad tivesse aprovado.
  @Post('pagamentos/:id/simular')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...GESTOR)
  simular(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.resultado(user.tenantId, id, {
      status: dto?.status === 'negado' ? 'negado' : 'aprovado',
      nsu: dto?.nsu ?? String(Date.now()).slice(-9),
      autorizacao: dto?.autorizacao ?? '123456',
      bandeira: dto?.bandeira ?? 'VISA',
      mensagem: 'Simulado',
    });
  }

  @Get('config')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('tef')
  config(@CurrentUser() user: AuthUser) {
    return this.service.getConfig(user.tenantId, null);
  }

  @Put('config')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('tef')
  setConfig(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setConfig(user.tenantId, dto?.unidadeId ?? null, dto);
  }

  // ----- Agente TEF do edge (token servidor_local) -----
  @Get('pendentes')
  @UseGuards(SyncTokenGuard)
  pendentes(@SyncCtx() ctx: SyncCtxData) {
    return this.service.pendentes(ctx.tenantId);
  }

  @Post(':id/resultado')
  @UseGuards(SyncTokenGuard)
  resultado(@SyncCtx() ctx: SyncCtxData, @Param('id') id: string, @Body() dto: any) {
    return this.service.resultado(ctx.tenantId, id, dto);
  }
}
