import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { Roles } from '../../auth/roles.decorator';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from './auditoria.service';

@Controller('auditoria')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('auditoria')
export class AuditoriaController {
  constructor(private readonly service: AuditoriaService) {}

  @Get()
  @Roles('presidente', 'gerente')
  listar(
    @CurrentUser() user: AuthUser,
    @Query('tipo') tipo?: string,
    @Query('busca') busca?: string,
    @Query('de') de?: string,
    @Query('ate') ate?: string,
  ) {
    return this.service.listar(user.tenantId, {
      tipo: tipo || undefined,
      busca: busca || undefined,
      de: de || undefined,
      ate: ate || undefined,
    });
  }

  // Verifica a integridade da cadeia (hash-chain) da auditoria do tenant.
  @Get('verificar')
  @Roles('presidente')
  verificar(@CurrentUser() user: AuthUser) {
    return this.service.verificarCadeia(user.tenantId);
  }
}
