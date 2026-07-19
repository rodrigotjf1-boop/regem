import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('dashboard')
export class DashboardController {
  constructor(private readonly service: DashboardService) {}

  @Get()
  @Roles('presidente', 'gerente')
  resumo(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeId: string | null,
    @Query('data') data?: string,
  ) {
    const d =
      data ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    // Bloco financeiro (R$) só quando o perfil permite "ver_financeiro".
    return this.service.resumo(user.tenantId, d, !!user.permissoes?.ver_financeiro, unidadeId);
  }

  @Get('timeline')
  @Roles('presidente', 'gerente')
  timeline(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeId: string | null,
    @Query('data') data?: string,
  ) {
    const d =
      data ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    return this.service.timeline(user.tenantId, d, unidadeId);
  }
}
