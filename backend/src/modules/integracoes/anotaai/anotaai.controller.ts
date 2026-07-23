import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { UnidadeAtual } from '../../../auth/unidade-atual.decorator';
import { AuthUser } from '../../../auth/auth-user';
import { AnotaAiService } from './anotaai.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Anota Aí — recebe pedidos por polling (não precisa de webhook público). Só gestor.
@Controller('integracoes/anotaai')
export class AnotaAiController {
  constructor(private readonly service: AnotaAiService) {}

  @Post('credenciais')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  salvar(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body() dto: { token?: string; lojaId?: string; unidadeId?: string },
  ) {
    return this.service.salvarCredenciais(
      user.tenantId,
      (dto?.unidadeId ?? atual) || null,
      (dto?.token ?? '').trim(),
      (dto?.lojaId ?? '').trim() || null,
    );
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  status(@CurrentUser() user: AuthUser) {
    return this.service.status(user.tenantId);
  }

  // Puxa os pedidos agora (teste ponta a ponta sem esperar o poller).
  @Post('puxar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  puxar(@CurrentUser() user: AuthUser) {
    return this.service.puxarAgora(user.tenantId);
  }

  // Importa o cardápio da Anota Aí → cria os produtos no Regem (onboarding).
  @Post('importar-catalogo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  importarCatalogo(@CurrentUser() user: AuthUser) {
    return this.service.importarCatalogo(user.tenantId);
  }

  @Post('desconectar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  desconectar(@CurrentUser() user: AuthUser) {
    return this.service.desconectar(user.tenantId);
  }
}
