import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { MODULO_PERFIL, PerfilClienteService } from './perfil-cliente.service';

// Delivery › Clientes › Perfil do cliente (F1a do docs/plano-perfil-cliente.md). Só NUVEM e só gestão: o perfil é dado
// pessoal — presidente e gerente com a permissão de delivery, e o módulo "Perfil do cliente" ligado (conferido aqui, não
// na tela). A equipe que atende vê o cartão curto do caso (F6), por outra rota.
@Controller('perfil-cliente')
@CloudOnly()
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard, ModuloGuard)
@RequirePerm('delivery')
@RequireModulo(MODULO_PERFIL)
@Roles('presidente', 'gerente')
export class PerfilClienteController {
  constructor(private readonly service: PerfilClienteService) {}

  @Get('resumo')
  resumo(@CurrentUser() user: AuthUser) {
    return this.service.resumo(user.tenantId);
  }

  @Get(':clienteId')
  ficha(@CurrentUser() user: AuthUser, @Param('clienteId', new ParseUUIDPipe()) clienteId: string) {
    return this.service.ficha(user.tenantId, clienteId);
  }

  /** Recalcular agora a empresa inteira (o presidente, depois de ligar o módulo). Uma vez por minuto basta. */
  @Post('recalcular')
  @Roles('presidente')
  @Throttle({ default: { limit: 1, ttl: 60_000 } })
  recalcular(@CurrentUser() user: AuthUser) {
    return this.service.calcularEmpresa(user.tenantId);
  }
}
