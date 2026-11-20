import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { lerConfigDoClube, lerGatilhoEntregue, lerPremio } from './clube.regras';
import { ClubeService } from './clube.service';
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
}

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
