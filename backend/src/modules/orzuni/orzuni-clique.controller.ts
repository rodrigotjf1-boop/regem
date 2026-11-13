import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { OrzuniCliqueService } from './orzuni-clique.service';

// O CLIQUE REGEM → ORZUNI (mig 416; plano "Clique Regem → Orzuni", R2): Delivery › Configurações › Integrações, cartão
// "Orzuni". Só o presidente liga, pede mais e desliga (OZ-2); o gerente vê a situação. A loja é a do topo da tela (ou a
// única da empresa). Ligar, concluir e desligar só na nuvem: a ligação e o pedido em curso moram lá.
@Controller('orzuni/clique')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class OrzuniCliqueController {
  constructor(private readonly clique: OrzuniCliqueService) {}

  @Get('situacao')
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  situacao(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.clique.situacao(user, unidade);
  }

  @Post('iniciar')
  @HttpCode(200)
  @CloudOnly()
  @Roles('presidente')
  @RequirePerm('delivery')
  iniciar(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Body() dto: any) {
    return this.clique.iniciar(user, unidade, dto);
  }

  @Post('concluir')
  @HttpCode(200)
  @CloudOnly()
  @Roles('presidente')
  @RequirePerm('delivery')
  concluir(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.clique.concluir(user, dto);
  }

  @Post('desligar')
  @HttpCode(200)
  @CloudOnly()
  @Roles('presidente')
  @RequirePerm('delivery')
  desligar(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.clique.desligar(user, unidade);
  }
}
