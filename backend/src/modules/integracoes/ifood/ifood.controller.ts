import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { UnidadeAtual } from '../../../auth/unidade-atual.decorator';
import { AuthUser } from '../../../auth/auth-user';
import { IfoodService } from './ifood.service';

// iFood — modelo PARCEIRO: as credenciais do app (Client ID/Secret) são globais da
// Regem (env), a loja não as informa. A loja apenas SOLICITA a integração; a
// distribuição pede a autorização do merchant no Portal do Desenvolvedor e finaliza
// com o Merchant ID (em /distribuicao → Integrações). Só gestor.
@Controller('integracoes/ifood')
export class IfoodController {
  constructor(private readonly service: IfoodService) {}

  @Post('solicitar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  solicitar(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.solicitarIntegracao(user.tenantId, atual, user.colaboradorId ?? null);
  }

  @Post('desativar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  desativar(@CurrentUser() user: AuthUser) {
    return this.service.desativarIntegracao(user.tenantId);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  status(@CurrentUser() user: AuthUser) {
    return this.service.statusIntegracao(user.tenantId);
  }
}
