import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { MODULO_PERFIL } from './perfil-cliente.service';
import { CalendarioDaLojaService } from './calendario-da-loja.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Delivery › Clientes › Calendário de eventos (F2 do docs/plano-perfil-cliente.md, mig 461). Só NUVEM, presidente e
// gerente com a permissão de delivery e o módulo "Perfil do cliente" ligado — conferidos aqui, não na tela. A loja é a do
// usuário (`@UnidadeAtual()`): o gerente preso a uma loja lê e muda só a dela (e lê os eventos de todas as lojas).
// Prefixo próprio: `GET /perfil-cliente/:clienteId` recusaria "calendario" como id.
@Controller('calendario-da-loja')
@CloudOnly()
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard, ModuloGuard)
@RequirePerm('delivery')
@RequireModulo(MODULO_PERFIL)
@Roles('presidente', 'gerente')
export class CalendarioDaLojaController {
  constructor(private readonly calendario: CalendarioDaLojaService) {}

  /** O calendário do período (padrão: de hoje a 60 dias; no máximo 120). */
  @Get()
  async listar(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeId: string | null,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    const p = this.calendario.periodo(de || undefined, ate || undefined);
    return { ...p, eventos: await this.calendario.listar(user.tenantId, unidadeId, p.de, p.ate) };
  }

  @Post('eventos')
  criar(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null, @Body() dto: any) {
    return this.calendario.criar(user, unidadeId, dto);
  }

  @Patch('eventos/:id')
  editar(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeId: string | null,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: any,
  ) {
    return this.calendario.editar(user, unidadeId, id, dto);
  }

  @Delete('eventos/:id')
  excluir(@CurrentUser() user: AuthUser, @UnidadeAtual() unidadeId: string | null, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.calendario.excluir(user, unidadeId, id);
  }
}
