import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { CABECALHO_USUARIO_DA_LOJA, EmpresaDaLojaGuard } from '../whatsapp/whatsapp-da-loja.controller';
import { lerConfigDoClube, lerGatilhoClassificacao, lerGatilhoEntregue, lerGatilhoReclamacao, lerPremio } from './clube.regras';
import { ClubeService } from './clube.service';
import { ClubeDesculpasService } from './clube-desculpas.service';
import { ClubeSurpresaService } from './clube-surpresa.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Delivery › Marketing › Clube (fase A0, mig 471). Só NUVEM e só gestão, como as campanhas e as automáticas: gerente e
// presidente com a permissão de delivery LEEM; só o presidente MUDA (o `@Roles` da rota vence o da classe). Cada rota
// que muda confere o corpo inteiro ANTES de gravar (V86) e devolve o que a tela precisa para se redesenhar.
@Controller('marketing/clube')
@CloudOnly()
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('delivery')
@Roles('presidente', 'gerente')
export class ClubeController {
  constructor(private readonly service: ClubeService) {}

  @Get()
  painel(@CurrentUser() user: AuthUser) {
    return this.service.painel(user.tenantId);
  }

  /** Os produtos ativos para o "produto grátis" (a gaveta do prêmio pede quando abre). */
  @Get('produtos')
  @Roles('presidente')
  produtos(@CurrentUser() user: AuthUser) {
    return this.service.produtos(user.tenantId);
  }

  @Put('config')
  @Roles('presidente')
  async salvarConfig(@CurrentUser() user: AuthUser, @Body() dto: any) {
    lerConfigDoClube(dto);
    await this.service.salvarConfig(user, dto);
    return this.service.painel(user.tenantId);
  }

  @Post('premios')
  @Roles('presidente')
  async criarPremio(@CurrentUser() user: AuthUser, @Body() dto: any) {
    lerPremio(dto);
    await this.service.criarPremio(user, dto);
    return this.service.painel(user.tenantId);
  }

  @Put('premios/:id')
  @Roles('presidente')
  async editarPremio(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    lerPremio(dto);
    await this.service.editarPremio(user, id, dto);
    return this.service.painel(user.tenantId);
  }

  @Delete('premios/:id')
  @Roles('presidente')
  async excluirPremio(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.service.excluirPremio(user, id);
    return this.service.painel(user.tenantId);
  }

  /** O gatilho "Pedido entregue" do prêmio surpresa (mig 474): liga, desliga e escolhe o prêmio. */
  @Put('gatilhos/entregue')
  @Roles('presidente')
  async salvarGatilhoEntregue(@CurrentUser() user: AuthUser, @Body() dto: any) {
    lerGatilhoEntregue(dto);
    await this.service.salvarGatilhoEntregue(user, dto);
    return this.service.painel(user.tenantId);
  }

  /** O gatilho "Depois de uma reclamação" (A1b): liga, os prêmios que a equipe pode mandar, o limite e quem manda. */
  @Put('gatilhos/reclamacao')
  @Roles('presidente')
  async salvarGatilhoReclamacao(@CurrentUser() user: AuthUser, @Body() dto: any) {
    lerGatilhoReclamacao(dto);
    await this.service.salvarGatilhoReclamacao(user, dto);
    return this.service.painel(user.tenantId);
  }

  /** O gatilho "Pela classificação do marketing" (A1c): liga, os segmentos, o prêmio e de quanto em quanto tempo. */
  @Put('gatilhos/classificacao')
  @Roles('presidente')
  async salvarGatilhoClassificacao(@CurrentUser() user: AuthUser, @Body() dto: any) {
    lerGatilhoClassificacao(dto);
    await this.service.salvarGatilhoClassificacao(user, dto);
    return this.service.painel(user.tenantId);
  }
}

// O LINK PESSOAL DO PRÊMIO (`/p/…`, sem login; A1b): o prêmio que não vem de um pedido (o de desculpas; depois a
// classificação e a campanha). O código do link (128 bits) é a chave; sem `JwtAuthGuard`, como a página do pedido.
@Controller('clube/premio')
export class ClubeLinkController {
  constructor(private readonly surpresa: ClubeSurpresaService) {}

  @Get(':codigo')
  @CloudOnly()
  premio(@Param('codigo') codigo: string) {
    return this.surpresa.doLink(codigo);
  }

  @Post(':codigo/revelar')
  @CloudOnly()
  @HttpCode(200)
  revelar(@Param('codigo') codigo: string) {
    return this.surpresa.revelarPeloLink(codigo);
  }
}

// O PRÊMIO DE DESCULPAS PEDIDO PELO SERVIDOR DA LOJA (A1b): o Atendimento de lá repassa à nuvem com o token do servidor,
// a empresa conferida (`EmpresaDaLojaGuard`, como a caixa de conversas) e quem está logado lá — o perfil que o servidor da
// loja conferiu no JWT dele (a nuvem confia no servidor da empresa, como no envio da caixa de conversas).
@Controller('clube/da-loja')
@CloudOnly()
@UseGuards(SyncTokenGuard, EmpresaDaLojaGuard)
export class ClubeDaLojaController {
  constructor(private readonly desculpas: ClubeDesculpasService) {}

  @Get('desculpas/:id')
  estado(@SyncCtx() ctx: SyncCtxData, @Param('id') id: string, @Query('perfil') perfil: string, @Headers(CABECALHO_USUARIO_DA_LOJA) quem?: string) {
    return this.desculpas.estado({ tenantId: ctx.tenantId, perfil: String(perfil ?? ''), colaboradorId: usuarioDaLoja(quem) }, id);
  }

  @Post('desculpas/:id')
  @HttpCode(201)
  mandar(@SyncCtx() ctx: SyncCtxData, @Param('id') id: string, @Body() dto: any, @Headers(CABECALHO_USUARIO_DA_LOJA) quem?: string) {
    return this.desculpas.mandar({ tenantId: ctx.tenantId, perfil: String(dto?.perfil ?? ''), colaboradorId: usuarioDaLoja(quem) }, id, dto);
  }
}

const UUID_DA_LOJA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const usuarioDaLoja = (v: unknown) => (UUID_DA_LOJA.test(String(v ?? '')) ? String(v) : null);

// O PRÊMIO SURPRESA PELA PÁGINA DO PEDIDO (`/r/…`, sem login; fase A1, mig 474): só pelo token do link do rastreio — a
// página roda na nuvem. Sem `JwtAuthGuard`, como o rastreio e a nota do pedido; o limite de chamadas é o global da API.
@Controller('rastreio')
export class ClubePublicoController {
  constructor(private readonly surpresa: ClubeSurpresaService) {}

  @Get(':token/premio')
  @CloudOnly()
  premio(@Param('token') token: string) {
    return this.surpresa.doPedido(token);
  }

  @Post(':token/premio/revelar')
  @CloudOnly()
  @HttpCode(200)
  revelar(@Param('token') token: string) {
    return this.surpresa.revelar(token);
  }
}
