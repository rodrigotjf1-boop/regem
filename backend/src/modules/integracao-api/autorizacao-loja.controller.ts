import { Body, Controller, Get, HttpCode, Param, Post, Query, UseFilters, UseGuards } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import type { AuthUser } from '../../auth/auth-user';
import { AutorizacaoLojaService } from './autorizacao-loja.service';
import { ProblemaFilter } from './problema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AUTORIZAÇÃO PELA LOJA (trilha C, C1b) — o lado de quem está logado no Regem, SÓ NUVEM:
// a página "Autorizar o Liame" (`/integracoes/autorizar`) e a tela "Aplicativos conectados"
// (`/integracoes`). A empresa vem SEMPRE da sessão. Só o presidente autoriza, vê e revoga —
// o gerente e o técnico do suporte recebem 403 (o suporte é tratado como gerente no RolesGuard).
@ApiTags('Integração — autorização pela loja')
@Controller()
@CloudOnly()
@UseGuards(JwtAuthGuard, RolesGuard)
export class AutorizacaoLojaController {
  constructor(private readonly service: AutorizacaoLojaService) {}

  // Qualquer nível chega aqui (a página precisa dizer "só o presidente autoriza"): quem não é
  // presidente recebe só a recusa — sem lojas, sem escopos.
  @Get('integracao-autorizacao/pedido')
  @ApiOperation({ summary: 'O que a página de autorização mostra para quem está logado.' })
  @ApiQuery({ name: 'cliente', description: 'O aplicativo que pede a autorização (ex.: liame).' })
  @ApiQuery({ name: 'redirect_uri', description: 'Endereço de volta — tem de ser um dos cadastrados para o cliente.' })
  @ApiQuery({ name: 'state', description: 'Volta como veio.' })
  @ApiQuery({ name: 'code_challenge', description: 'Desafio do PKCE (S256).' })
  @ApiQuery({ name: 'code_challenge_method', description: 'Sempre S256.' })
  pedido(@CurrentUser() user: AuthUser, @Query() q: any) {
    return this.service.pedido(user, q);
  }

  @Post('integracao-autorizacao')
  @Roles('presidente')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @ApiOperation({ summary: 'O presidente autoriza: devolve o endereço de volta com o código de uso único.' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['cliente', 'redirect_uri', 'state', 'code_challenge', 'code_challenge_method', 'lojas', 'custo', 'cupom'],
      properties: {
        cliente: { type: 'string' },
        redirect_uri: { type: 'string' },
        state: { type: 'string' },
        code_challenge: { type: 'string' },
        code_challenge_method: { type: 'string', enum: ['S256'] },
        lojas: { type: 'array', items: { type: 'string', format: 'uuid' } },
        custo: { type: 'boolean', description: 'Liberar o custo dos itens (exige "Ver valores em R$").' },
        cupom: { type: 'boolean', description: 'Liberar a criação de cupom de campanha.' },
      },
    },
  })
  autorizar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.autorizar(user, dto);
  }

  @Get('aplicativos-conectados')
  @Roles('presidente')
  @ApiOperation({ summary: 'Ferramentas que leem dados da empresa: acessos ativos e os últimos revogados.' })
  aplicativos(@CurrentUser() user: AuthUser) {
    return this.service.aplicativos(user);
  }

  @Post('aplicativos-conectados/revogar-todos')
  @Roles('presidente')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoga todos os acessos de um aplicativo nesta empresa.' })
  @ApiBody({ schema: { type: 'object', required: ['cliente'], properties: { cliente: { type: 'string' } } } })
  revogarTodos(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.revogarTodos(user, dto?.cliente);
  }

  @Post('aplicativos-conectados/:id/revogar')
  @Roles('presidente')
  @HttpCode(200)
  @ApiOperation({ summary: 'Revoga um acesso (o aplicativo passa a receber 401 na chamada seguinte).' })
  revogar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.revogar(user, id);
  }
}

// A TROCA DO CÓDIGO — `/api/v1/integracao/autorizacao/token`, SÓ NUVEM, entre servidores: quem
// chama é o servidor do aplicativo, com o segredo de cliente (não há sessão nem token de loja
// ainda). Erros em `application/problem+json`, como o resto da API de integração.
@ApiTags('Integração (token por loja)')
@Controller('integracao/autorizacao')
@CloudOnly()
@UseFilters(ProblemaFilter)
export class AutorizacaoTokenController {
  constructor(private readonly service: AutorizacaoLojaService) {}

  @Post('token')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  @ApiOperation({
    summary: 'Troca o código da autorização pelos tokens das lojas (uma tentativa; o código vale 10 minutos).',
    description:
      'Corpo: `code`, `code_verifier` (PKCE S256), `redirect_uri` (o mesmo do pedido), `client_id` e ' +
      '`client_secret`. Resposta: `{ lojas: [{ loja_id, loja_nome, empresa_nome, fuso, moeda, escopos, ' +
      'cardapio_url, token }] }` — o token de cada loja aparece só aqui. A loja que já tinha um token deste ' +
      'cliente troca: o antigo passa a devolver 401.',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['code', 'code_verifier', 'redirect_uri', 'client_id', 'client_secret'],
      properties: {
        code: { type: 'string' },
        code_verifier: { type: 'string' },
        redirect_uri: { type: 'string' },
        client_id: { type: 'string' },
        client_secret: { type: 'string' },
      },
    },
  })
  token(@Body() body: any) {
    return this.service.trocar(body);
  }
}
