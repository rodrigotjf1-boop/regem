import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { GraphCliqueService } from './graph-clique.service';
import { ConcluirGraphDto } from './dto/concluir-graph.dto';
import { IniciarGraphDto } from './dto/iniciar-graph.dto';

// O CLIQUE REGEM → DMS GRAPH (G5a; mig 450): o cartão "DMS Graph" (Delivery › Configurações › Integrações e a linha em
// Atendimento › Fotos do cliente — as telas esperam a aprovação do protótipo). A ligação é da EMPRESA inteira (G-3). Só o
// presidente liga e desliga (GR-2 — RBAC aqui, no servidor); o gerente vê a situação. Ligar, concluir e desligar só na
// nuvem: a ligação e o pedido em curso moram lá. Tudo atrás de `GRAPH_LIGADO` (o serviço diz "não está ligado").
@Controller('graph/clique')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class GraphCliqueController {
  constructor(private readonly clique: GraphCliqueService) {}

  @Get('situacao')
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  situacao(@CurrentUser() user: AuthUser) {
    return this.clique.situacao(user);
  }

  @Post('iniciar')
  @HttpCode(200)
  @CloudOnly()
  @Roles('presidente')
  @RequirePerm('delivery')
  iniciar(@CurrentUser() user: AuthUser, @Body() dto: IniciarGraphDto) {
    return this.clique.iniciar(user, dto?.pedir);
  }

  @Post('concluir')
  @HttpCode(200)
  @CloudOnly()
  @Roles('presidente')
  @RequirePerm('delivery')
  concluir(@CurrentUser() user: AuthUser, @Body() dto: ConcluirGraphDto) {
    return this.clique.concluir(user, dto);
  }

  @Post('desligar')
  @HttpCode(200)
  @CloudOnly()
  @Roles('presidente')
  @RequirePerm('delivery')
  desligar(@CurrentUser() user: AuthUser) {
    return this.clique.desligar(user);
  }
}
