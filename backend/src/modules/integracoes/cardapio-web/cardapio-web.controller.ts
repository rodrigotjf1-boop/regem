import { Body, Controller, Get, Headers, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { UnidadeAtual } from '../../../auth/unidade-atual.decorator';
import { AuthUser } from '../../../auth/auth-user';
import { CardapioWebService } from './cardapio-web.service';

// Onboarding OAuth do Cardápio Web (API Aberta). O callback é PÚBLICO (redirect
// do navegador vindo do portal do CW) — a segurança está no `state` + PKCE.
@Controller('integracoes/cardapio-web')
export class CardapioWebController {
  constructor(private readonly service: CardapioWebService) {}

  // Gestor pede a URL de consentimento; o front redireciona o navegador p/ ela.
  @Get('conectar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  conectar(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.iniciarConexao(user.tenantId, atual);
  }

  // Callback do portal do CW: ?code=&state= → troca por token e volta pro app.
  @Get('oauth/callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    const front = (process.env.APP_URL ?? process.env.FRONT_URL ?? '').replace(/\/+$/, '');
    let ok = false;
    if (code && state) {
      const r = await this.service.concluirConexao(code, state).catch(() => ({ ok: false }));
      ok = r.ok;
    }
    // Volta para a tela de integrações do Regem com o resultado.
    return res.redirect(`${front || ''}/delivery?cw=${ok ? 'ok' : 'erro'}`);
  }

  // Modo chave (X-API-KEY): a loja cola o token gerado no painel + código da loja.
  @Post('chave')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  salvarChave(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body()
    dto: {
      apiKey?: string;
      chave?: string;
      codigoLoja?: string;
      merchantId?: string;
      ambiente?: string;
      unidadeId?: string;
    },
  ) {
    return this.service.salvarChave(
      user.tenantId,
      (dto?.unidadeId ?? atual) || null,
      (dto?.apiKey ?? dto?.chave ?? '').trim(),
      (dto?.codigoLoja ?? dto?.merchantId ?? '').trim() || null,
      dto?.ambiente,
    );
  }

  // Puxa os pedidos recentes agora (teste ponta a ponta, sem webhook público).
  @Post('puxar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  puxar(@CurrentUser() user: AuthUser) {
    return this.service.puxarAgora(user.tenantId);
  }

  // Importa o catálogo do Cardápio Web → cria os produtos no Regem (onboarding).
  @Post('importar-catalogo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  importarCatalogo(@CurrentUser() user: AuthUser) {
    return this.service.importarCatalogo(user.tenantId);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  status(@CurrentUser() user: AuthUser) {
    return this.service.status(user.tenantId);
  }

  // Webhook do Cardápio Web (tempo real) — PÚBLICO (o CW chama de fora).
  // Corpo esperado: { order_id, event_id }. Valida X-Webhook-Token; responde
  // rápido (200) e ingere de forma idempotente. Requer URL pública p/ funcionar.
  @Post('webhook')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  async webhook(
    @Headers('x-webhook-token') token: string | undefined,
    @Body() body: { order_id?: string | number; orderId?: string | number },
  ) {
    const orderId = String(body?.order_id ?? body?.orderId ?? '');
    if (!orderId) return { ok: false };
    // Não bloqueia a resposta em erros de rede/ingestão (o poller reconcilia).
    return this.service.processarWebhook(token, orderId).catch(() => ({ ok: false }));
  }

  // Exporta o cardápio do Regem PRA o Cardápio Web (cria categorias/itens lá).
  @Post('exportar-catalogo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  exportarCatalogo(@CurrentUser() user: AuthUser) {
    return this.service.exportarCatalogo(user.tenantId);
  }

  // Exporta só 1 item de teste (valida a auth/endpoint sem despejar o cardápio).
  @Post('exportar-teste')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  exportarTeste(@CurrentUser() user: AuthUser) {
    return this.service.exportarItemTeste(user.tenantId);
  }

  @Post('desconectar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  desconectar(@CurrentUser() user: AuthUser) {
    return this.service.desconectar(user.tenantId);
  }
}
