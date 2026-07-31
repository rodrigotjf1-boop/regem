import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { DesligamentoService } from './desligamento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Desligamento e cadastro do contador são atos de gestão (presidente/gerente).
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@Roles('presidente', 'gerente')
@RequirePerm('desligamento')
export class DesligamentoController {
  constructor(private readonly service: DesligamentoService) {}

  @Get('contadores')
  listar(@CurrentUser() user: AuthUser) {
    return this.service.listarContadores(user.tenantId);
  }

  @Put('contadores')
  salvar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.salvarContador(user.tenantId, user.colaboradorId, dto);
  }

  @Delete('contadores/:id')
  remover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removerContador(user.tenantId, id);
  }

  @Post('colaboradores/:id/desligar')
  desligar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.desligar(user.tenantId, user.colaboradorId!, user.categoria, id, dto);
  }
}
