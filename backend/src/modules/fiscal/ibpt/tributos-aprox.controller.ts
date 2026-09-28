import { Body, Controller, Delete, Get, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import { PermissoesGuard } from '../../../auth/permissoes.guard';
import { RequirePerm } from '../../../auth/require-perm.decorator';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { UnidadeAtual } from '../../../auth/unidade-atual.decorator';
import { AuthUser } from '../../../auth/auth-user';
import { CloudOnly } from '../../../common/cloud-only.decorator';
import { IbptService } from './ibpt.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Tributos aproximados (Lei 12.741) na Configuração fiscal da LOJA: que tabela do IBPT vale e o
 * token OPCIONAL do lojista (mig 292). Mesmas regras da credencial fiscal: a leitura nunca traz o
 * token (só os 4 últimos); a escrita é só na nuvem e só do presidente, que pode escolher a loja
 * (sem loja = vale para a rede).
 */
@Controller('fiscal/tributos-aprox')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class TributosAproxController {
  constructor(private readonly ibpt: IbptService) {}

  @Get()
  @RequirePerm('fiscal_config')
  situacao(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() unidadeAtual: string | null,
    @Query('unidadeId') unidadeId?: string,
  ) {
    return this.ibpt.situacaoDaLoja(
      user.tenantId,
      (user.categoria === 'presidente' ? unidadeId || unidadeAtual : unidadeAtual) || null,
    );
  }

  @CloudOnly()
  @Put('token')
  @Roles('presidente')
  salvarToken(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.ibpt.salvarToken(user.tenantId, user.colaboradorId, dto?.unidadeId || null, dto?.token);
  }

  @CloudOnly()
  @Delete('token')
  @Roles('presidente')
  removerToken(@CurrentUser() user: AuthUser, @Query('unidadeId') unidadeId?: string) {
    return this.ibpt.removerToken(user.tenantId, user.colaboradorId, unidadeId || null);
  }
}
