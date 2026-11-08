import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { TreinoDoAtendenteService } from './treino.service';

// TREINAR O ATENDENTE (F4 do atendente virtual, mig 382; protótipo `mockups/regem-central-atendimento.html`): "Testar o
// atendente" (a conversa de teste com o robô de verdade) e "O que ele aprendeu" (as respostas que a loja ensinou, que entram
// nas instruções do robô). Só GERENTE e PRESIDENTE — o RBAC é aqui, no servidor (o suporte entra como gerente, pelo
// RolesGuard) —, com a permissão de pedidos como o resto do atendimento. A empresa vem SEMPRE da sessão. Só na nuvem: o robô
// e estas tabelas moram lá (no servidor da loja o CloudOnlyGuard barra). Nenhuma rota tem parâmetro no 1º segmento: o
// `:id` só depois de `teste/` e de `conhecimento/`, com ParseUUIDPipe.
@Controller('atendimento')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('pedidos')
export class TreinoDoAtendenteController {
  constructor(private readonly service: TreinoDoAtendenteService) {}

  // ───────── a conversa de teste ─────────

  @Post('teste')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  criarTeste(@CurrentUser() user: AuthUser, @Body() dto: unknown) {
    return this.service.criarTeste(user, dto);
  }

  @Get('teste/:id')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  verTeste(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.verTeste(user, id);
  }

  @Post('teste/:id/mensagem')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  mandarMensagem(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: unknown) {
    return this.service.mandarMensagem(user, id, dto);
  }

  // ───────── o que ele aprendeu ─────────

  @Get('conhecimento')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  listarConhecimento(@CurrentUser() user: AuthUser) {
    return this.service.listarConhecimento(user);
  }

  @Post('conhecimento')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  criarConhecimento(@CurrentUser() user: AuthUser, @Body() dto: unknown) {
    return this.service.criarConhecimento(user, dto);
  }

  @Patch('conhecimento/:id')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  editarConhecimento(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: unknown) {
    return this.service.editarConhecimento(user, id, dto);
  }

  @Delete('conhecimento/:id')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  apagarConhecimento(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.apagarConhecimento(user, id);
  }
}
