import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { ModuloGuard } from '../../auth/modulo.guard';
import { RequireModulo } from '../../auth/require-modulo.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { MODULO_VAGAS, VagasService } from './vagas.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A página PÚBLICA de vagas (sem login): `/v/<codigo>` no front. O código da página identifica a loja; só responde com a
// página LIGADA e o módulo ligado. O envio da ficha tem limite curto por IP (o mesmo celular reenvia, um robô não).
@Controller('publico/vagas')
@CloudOnly()
export class VagasPublicoController {
  constructor(private readonly vagas: VagasService) {}

  @Get(':codigo')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  pagina(@Param('codigo') codigo: string) {
    return this.vagas.paginaPublica(codigo);
  }

  @Post(':codigo/ficha')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  ficha(@Param('codigo') codigo: string, @Body() dto: any) {
    return this.vagas.receberFicha(codigo, dto);
  }
}

// Pessoas › Candidatos (a loja). Dado pessoal de candidato: só com a permissão `candidatos` (gerente e presidente por
// padrão; supervisão só se o presidente liberar no perfil) e com o módulo "Vagas e candidatos" ligado na loja. A loja é a
// do usuário (presidente: a escolhida no topo; na rede, a lista mostra todas e os ajustes pedem uma loja).
@Controller('vagas')
@CloudOnly()
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard, ModuloGuard)
@RequirePerm('candidatos')
@RequireModulo(MODULO_VAGAS)
export class VagasController {
  constructor(private readonly vagas: VagasService) {}

  @Get('candidatos')
  lista(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.vagas.lista(user.tenantId, unidade);
  }

  @Get('candidatos/:id')
  ficha(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Param('id') id: string) {
    return this.vagas.ficha(user.tenantId, unidade, id);
  }

  @Patch('candidatos/:id/situacao')
  situacao(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Param('id') id: string, @Body() dto: any) {
    return this.vagas.mudarSituacao(user, unidade, id, dto);
  }

  @Post('candidatos/:id/anotacao')
  anotacao(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Param('id') id: string, @Body() dto: any) {
    return this.vagas.anotar(user, unidade, id, dto);
  }

  @Post('candidatos/:id/entrevista')
  entrevista(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Param('id') id: string, @Body() dto: any) {
    return this.vagas.marcarEntrevista(user, unidade, id, dto);
  }

  // Apagar os dados (LGPD) — irreversível: só gerente e presidente.
  @Delete('candidatos/:id')
  @Roles('presidente', 'gerente')
  apagar(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Param('id') id: string) {
    return this.vagas.apagar(user, unidade, id);
  }

  @Get('pagina')
  pagina(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.vagas.pagina(user.tenantId, unidade);
  }

  // O que o candidato vê (e o que liga a página na internet): só gerente e presidente.
  @Put('pagina')
  @Roles('presidente', 'gerente')
  salvarPagina(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Body() dto: any) {
    return this.vagas.salvarPagina(user, unidade, dto);
  }

  @Get('qr')
  qrs(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.vagas.qrs(user.tenantId, unidade);
  }

  @Post('qr')
  @Roles('presidente', 'gerente')
  criarQr(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Body() dto: any) {
    return this.vagas.criarQr(user, unidade, dto);
  }

  @Delete('qr/:id')
  @Roles('presidente', 'gerente')
  apagarQr(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null, @Param('id') id: string) {
    return this.vagas.apagarQr(user, unidade, id);
  }
}
