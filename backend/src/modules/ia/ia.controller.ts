import { Body, Controller, Delete, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { IaEmpresaService } from './ia-empresa.service';

// A CHAVE DE IA DA EMPRESA e o medidor de uso (mig 415). Só o presidente, só na nuvem: é o segredo de uma conta paga do
// lojista e o gasto dela. Nenhuma rota devolve a chave — só o provedor, os 4 últimos caracteres e a situação.
@Controller('ia')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class IaController {
  constructor(private readonly ia: IaEmpresaService) {}

  /** De onde vem a IA da empresa e, se ela tem chave própria, a situação dela. */
  @Get('chave')
  @CloudOnly()
  @Roles('presidente')
  @RequirePerm('visao_co')
  situacao(@CurrentUser() user: AuthUser) {
    return this.ia.situacao(user.tenantId);
  }

  /** Cadastra ou troca a chave. Ela é provada no provedor antes de ser guardada. */
  @Post('chave')
  @CloudOnly()
  @Roles('presidente')
  @RequirePerm('visao_co')
  salvar(@CurrentUser() user: AuthUser, @Body() dto: unknown) {
    return this.ia.salvar(user, dto);
  }

  /** Prova de novo a chave guardada (depois de pôr crédito, por exemplo). */
  @Post('chave/testar')
  @CloudOnly()
  @Roles('presidente')
  @RequirePerm('visao_co')
  testar(@CurrentUser() user: AuthUser) {
    return this.ia.testar(user);
  }

  /** Apaga a chave da empresa. */
  @Delete('chave')
  @CloudOnly()
  @Roles('presidente')
  @RequirePerm('visao_co')
  remover(@CurrentUser() user: AuthUser) {
    return this.ia.remover(user);
  }

  /** O uso da IA no período (padrão: os últimos 30 dias), com o custo estimado. */
  @Get('uso')
  @CloudOnly()
  @Roles('presidente')
  @RequirePerm('visao_co')
  uso(@CurrentUser() user: AuthUser, @Query('de') de?: string, @Query('ate') ate?: string) {
    return this.ia.uso(user.tenantId, de, ate);
  }
}
