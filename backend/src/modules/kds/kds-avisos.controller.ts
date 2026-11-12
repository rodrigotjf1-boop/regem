import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { AlertaKdsService } from './alerta-kds.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Os avisos GUARDADOS do rodapé do KDS (onda 3 da auditoria do KDS, mig 412) — o que a tela do KDS usa: o urgente que
// espera o "Ciente" (a tela recarregada recupera), o "Ciente" que vale para todas as telas e o histórico. Quem abre a fila
// do KDS abre isto (o mesmo módulo e os mesmos guardas da fila).
@Controller('kds/avisos')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard, ModuloGuard)
export class KdsAvisosController {
  constructor(private readonly avisos: AlertaKdsService) {}

  @Get('pendentes')
  @RequireModulo('kds')
  pendentes(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.avisos.pendentes(user.tenantId, unidade);
  }

  @Get('historico')
  @RequireModulo('kds')
  historico(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Query('horas') horas?: string) {
    return this.avisos.historico(user.tenantId, unidade, horas);
  }

  @Post(':id/ciente')
  @RequireModulo('kds')
  ciente(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.avisos.ciente(user.tenantId, id, { id: user.colaboradorId, nome: user.nome ?? null }, dto?.kdsId);
  }
}
