import { Body, Controller, ForbiddenException, Get, Header, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { ModuloService } from '../modulo/modulo.service';
import { TelaSenhasService } from './tela-senhas.service';
import { TelaAtual, TelaSenhasGuard } from './tela-senhas.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

const ator = (user: AuthUser) => ({ id: user.colaboradorId, perfil: user.categoria });

/**
 * A TV de senhas lendo o quadro (sem login: a guarda confere o id e o segredo do pareamento). Público de propósito,
 * como o pareamento: a TV não tem sessão. Só números — nada do cliente. O KDS é módulo ativável: desligado na loja,
 * a TV também para (403 com o motivo, e a tela diz isso em vez de pedir o código de novo).
 */
@Controller('publico/senhas')
export class TelaSenhasPublicoController {
  constructor(
    private readonly service: TelaSenhasService,
    private readonly modulos: ModuloService,
  ) {}

  @Get()
  @UseGuards(TelaSenhasGuard)
  @Header('Cache-Control', 'no-store')
  async quadro(@TelaAtual() tela: any) {
    if (!(await this.modulos.ativo(tela.tenantId, tela.unidadeId ?? null, 'kds')))
      throw new ForbiddenException('O KDS está desligado nesta loja: a tela de senhas volta quando ele for ligado.');
    return this.service.quadro({
      id: tela.id,
      tenantId: tela.tenantId,
      unidadeId: tela.unidadeId ?? null,
      nome: tela.nome,
      telaTamanhos: tela.telaTamanhos,
    });
  }
}

/** Os ajustes de uma TV, na gaveta de Configurações › Equipamentos (presidente e gerente, com a permissão do KDS). */
@Controller('tela-senhas')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TelaSenhasController {
  constructor(private readonly service: TelaSenhasService) {}

  @Get(':id/ajustes')
  @UseGuards(PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('kds')
  ajustes(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.ajustesDaTela(user.tenantId, id);
  }

  @Put(':id/ajustes')
  @UseGuards(PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('kds')
  salvar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.salvarAjustes(user.tenantId, id, dto ?? {}, ator(user));
  }
}
