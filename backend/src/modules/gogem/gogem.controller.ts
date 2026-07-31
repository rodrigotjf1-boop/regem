import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { GogemPublishService } from './gogem-publish.service';

const GESTOR = ['presidente', 'gerente', 'supervisao'];

/**
 * Integração GoGeM: botão "Publicar no GoGeM" (empurra pausas/edições na hora).
 * Só gestão (presidente/gerente/supervisão). O front chama isto; o backend fala
 * com o GoGeM usando o token do servidor_local.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('integracoes/gogem')
export class GogemController {
  constructor(private readonly service: GogemPublishService) {}

  @Post('publicar')
  @Roles(...GESTOR)
  publicar(@CurrentUser() user: AuthUser) {
    return this.service.publicar(user.tenantId);
  }
}
