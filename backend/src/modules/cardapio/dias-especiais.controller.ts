/* eslint-disable @typescript-eslint/no-explicit-any */
import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { DiasEspeciaisService } from './dias-especiais.service';

// Delivery › Configurações › Horários › Dias especiais (fase H1; mig 512). As mesmas permissões do horário da semana
// (`PUT /cardapio/config`): ver com a permissão "loja"; mudar, presidente e gerente. A loja é a do cardápio: a
// configuração sem loja (a de hoje) quando a tela não manda uma.
const loja = (v: unknown): string | null => (typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v) ? v : null);

@Controller('cardapio/dias-especiais')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class DiasEspeciaisController {
  constructor(private readonly service: DiasEspeciaisService) {}

  @Get()
  @RequirePerm('loja')
  listar(@CurrentUser() user: AuthUser, @Query('situacao') situacao?: string, @Query('unidadeId') unidadeId?: string) {
    return this.service.listar(user.tenantId, loja(unidadeId), situacao === 'passados' ? 'passados' : 'proximos');
  }

  /**
   * Os feriados sem resposta (H2a): os próximos 60 dias na lista, os próximos 10 na faixa da tela (`?dias=10`). Lei, Escala
   * e o calendário do Marketing; o que já tem dia especial (até o "horário normal") não volta.
   */
  @Get('sem-resposta')
  @RequirePerm('loja')
  semResposta(@CurrentUser() user: AuthUser, @Query('dias') dias?: string, @Query('unidadeId') unidadeId?: string) {
    return this.service.semResposta(user.tenantId, loja(unidadeId), dias ? Number(dias) : undefined);
  }

  /** Os pedidos agendados de um período (o diálogo antes de fechar um dia). */
  @Get('agendados')
  @RequirePerm('loja')
  agendados(@CurrentUser() user: AuthUser, @Query('de') de?: string, @Query('ate') ate?: string, @Query('unidadeId') unidadeId?: string) {
    return this.service.agendados(user.tenantId, loja(unidadeId), String(de ?? '').slice(0, 10), ate ? String(ate).slice(0, 10) : undefined);
  }

  @Post()
  @Roles('presidente', 'gerente')
  @RequirePerm('loja')
  criar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criar(user, loja(dto?.unidadeId), dto ?? {});
  }

  @Patch(':id')
  @Roles('presidente', 'gerente')
  @RequirePerm('loja')
  editar(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: any) {
    return this.service.editar(user, id, dto ?? {});
  }

  @Delete(':id')
  @Roles('presidente', 'gerente')
  @RequirePerm('loja')
  excluir(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.excluir(user, id);
  }
}
