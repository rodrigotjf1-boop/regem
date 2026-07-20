import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { OrdemProducaoService } from './ordem-producao.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Ordem de produção — governada pela permissão de produção/KDS.
@Controller('ordens-producao')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('producao_kds')
export class OrdemProducaoController {
  constructor(private readonly service: OrdemProducaoService) {}

  @Get()
  listar(
    @CurrentUser() user: AuthUser,
    @Query('status') status?: string,
    @Query('setorId') setorId?: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
    @Query('pendentes') pendentes?: string,
  ) {
    return this.service.listar(user.tenantId, {
      status,
      setorId,
      de,
      ate,
      pendentes: pendentes === 'true',
    });
  }

  @Get('relatorio')
  relatorio(@CurrentUser() user: AuthUser, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.service.relatorio(user.tenantId, de, ate);
  }

  @Post()
  criar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criar(user.tenantId, user.colaboradorId, dto);
  }

  // Recorrência (reaproveita tarefa_def) — cria a definição + a ordem de hoje.
  @Post('recorrencia')
  @Roles('presidente', 'gerente', 'supervisao')
  criarRecorrencia(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criarRecorrencia(user.tenantId, user.colaboradorId, dto);
  }

  @Post(':id/liberar')
  liberar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.liberar(user.tenantId, id);
  }

  @Post(':id/iniciar')
  iniciar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.iniciar(user.tenantId, id);
  }

  // Conclusão (total | parcial | nao) — assinatura por PIN. viaImpressa adia p/ lançamento.
  @Post(':id/concluir')
  concluir(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.concluir(user.tenantId, id, {
      tipo: ['total', 'parcial', 'nao'].includes(dto?.tipo) ? dto.tipo : 'total',
      quantidadeProduzida: dto?.quantidadeProduzida != null ? Number(dto.quantidadeProduzida) : undefined,
      pin: dto?.pin,
      motivo: dto?.motivo,
      viaImpressa: !!dto?.viaImpressa,
    });
  }

  // Cancelar / forçar desfecho de pendência — só gestão.
  @Post(':id/cancelar')
  @Roles('presidente', 'gerente', 'supervisao')
  cancelar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.cancelar(user.tenantId, user.colaboradorId, id, dto?.motivo);
  }
}
