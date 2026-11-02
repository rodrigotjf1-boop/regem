import { Body, Controller, Get, Headers, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AtendimentoAppService } from './atendimento-app.service';

// O APP "REGEM ATENDIMENTO" (Onda 2, mig 353): a entrada com o PIN no celular pareado e o "Disponível / Ocupado". O resto
// o app faz pelas rotas de `atendimento/*` (as mesmas da tela), com a sessão presa ao celular.
@Controller('atendimento/app')
export class AtendimentoAppController {
  constructor(private readonly app: AtendimentoAppService) {}

  // Público de propósito: o celular ainda não tem sessão — é o que ele vem buscar. Quem prova é o APARELHO (id + segredo
  // do pareamento nos cabeçalhos, como o caixa) e a PESSOA (o PIN, com a trava de 10 erros em 5 min por celular). O
  // limite por IP é só teto de volume: a loja inteira chega pelo mesmo IP na troca de turno.
  @Post('entrar')
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  entrar(
    @Headers('x-terminal-id') terminalId: string | undefined,
    @Headers('x-terminal-secret') segredo: string | undefined,
    @Body() dto: { pin?: string },
  ) {
    return this.app.entrar(terminalId, segredo, dto?.pin);
  }

  // Quem está no app agora (da loja em uso) e a minha situação. A tabela mora só na nuvem (é com ela que o app fala).
  @Get('presenca')
  @CloudOnly()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @RequirePerm('pedidos')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  presenca(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.app.presenca(user, unidade);
  }

  // "Disponível" ou "Ocupado: embalando" — e o aviso de "ainda estou aqui" que o app manda a cada minuto.
  @Put('presenca')
  @CloudOnly()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @RequirePerm('pedidos')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  marcar(@CurrentUser() user: AuthUser, @Body() dto: unknown) {
    return this.app.marcar(user, dto);
  }

  // "Sair": sai da vez na hora (o app apaga a sessão dele).
  @Post('sair')
  @CloudOnly()
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @RequirePerm('pedidos')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  sair(@CurrentUser() user: AuthUser) {
    return this.app.sair(user);
  }
}
