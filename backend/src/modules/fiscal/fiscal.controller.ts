import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { FiscalService } from './fiscal.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// A GESTÃO fiscal (config, lista de notas, cancelamento) exige a permissão "fiscal".
// A EMISSÃO da NFC-e no PDV/delivery é operacional (fica liberada ao operador).
@Controller('fiscal')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class FiscalController {
  constructor(private readonly service: FiscalService) {}

  @Get('config')
  @RequirePerm('fiscal_config')
  config(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeAtual: string | null,
    @Query('unidadeId') unidadeId?: string,
  ) {
    return this.service.getConfig(
      user.tenantId,
      (user.categoria === 'presidente' ? unidadeId || unidadeAtual : unidadeAtual) || null,
    );
  }

  @Put('config')
  @Roles('presidente')
  setConfig(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setConfig(user.tenantId, dto?.unidadeId || null, dto);
  }

  @Post('comandas/:id/emitir')
  emitir(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.emitir(user.tenantId, user.colaboradorId, id);
  }

  @Get('notas')
  @RequirePerm('fiscal')
  notas(@CurrentUser() user: AuthUser) {
    return this.service.listarNotas(user.tenantId);
  }

  @Get('notas/:id')
  @RequirePerm('fiscal')
  nota(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.getNota(user.tenantId, id);
  }

  @Post('notas/:id/cancelar')
  @Roles('presidente', 'gerente')
  cancelar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.cancelar(user.tenantId, user.colaboradorId, id, dto?.justificativa);
  }
}
