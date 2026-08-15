import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../../auth/jwt-auth.guard';
import { RolesGuard } from '../../../auth/roles.guard';
import { Roles } from '../../../auth/roles.decorator';
import { CurrentUser } from '../../../auth/current-user.decorator';
import { UnidadeAtual } from '../../../auth/unidade-atual.decorator';
import { AuthUser } from '../../../auth/auth-user';
import { Food99Service } from './food99.service';
import { CloudOnly } from '../../../common/cloud-only.decorator';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Integração 99Food / DiDi Food. O webhook é PÚBLICO (o 99food chama de fora, no
// callback registrado no portal). Exige URL pública → roda na nuvem.
@Controller('integracoes/99food')
@CloudOnly()
export class Food99Controller {
  constructor(private readonly service: Food99Service) {}

  // Webhook do 99food (orderNew/orderCancel/orderFinish). PÚBLICO.
  // Lê o CORPO CRU (req.rawBody, habilitado no main.ts) porque o order_id é
  // inteiro 64-bit — JSON.parse do body-parser corromperia. O service extrai o id
  // como string por regex. Responde no formato StandardResponse (errno 0).
  @Post('webhook')
  @Throttle({ default: { ttl: 60000, limit: 240 } })
  async webhook(@Req() req: RawBodyRequest<Request>, @Body() body: any) {
    const raw = req.rawBody?.toString('utf8') || (body ? JSON.stringify(body) : '');
    // Assinatura do 99food: MD5(corpo_cru + app_secret) no header didi-header-sign.
    const rawSign = req.headers['didi-header-sign'];
    const sign = Array.isArray(rawSign) ? rawSign[0] : rawSign;
    return this.service
      .processarWebhook(raw, sign)
      .catch(() => ({ errno: 0, errmsg: 'error-handled' }));
  }

  // Salva as credenciais do app (app_id + app_secret + app_shop_id). Só gestor.
  @Post('credenciais')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  salvar(
    @CurrentUser() user: AuthUser,
    @UnidadeAtual() atual: string | null,
    @Body() dto: { appId?: string; appSecret?: string; appShopId?: string; unidadeId?: string },
  ) {
    return this.service.salvarCredenciais(
      user.tenantId,
      (dto?.unidadeId ?? atual) || null,
      (dto?.appId ?? '').trim(),
      (dto?.appSecret ?? '').trim(),
      (dto?.appShopId ?? '').trim(),
    );
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  status(@CurrentUser() user: AuthUser) {
    return this.service.status(user.tenantId);
  }

  // PRODUÇÃO — onboarding self-service: gera o link de autorização (getUrl). O
  // lojista abre, autoriza a loja 99food dele; o resto vem por webhook shopBindStatus.
  @Post('conectar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  conectar(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null, @Body() dto: { unidadeId?: string }) {
    return this.service.conectar(user.tenantId, (dto?.unidadeId ?? atual) || null);
  }

  // Lista as lojas autorizadas ao app que ainda não estão vinculadas (fallback do
  // webhook: puxa direto do 99food via getAuthorizedShops). O lojista escolhe a dele.
  @Get('lojas-autorizadas')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  lojasAutorizadas(@CurrentUser() user: AuthUser) {
    return this.service.lojasAutorizadas(user.tenantId);
  }

  // Confirma a loja recém-vinculada oferecida ("é a minha loja").
  @Post('vincular')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  vincular(@CurrentUser() user: AuthUser, @Body() dto: { appShopId?: string }) {
    return this.service.vincular(user.tenantId, String(dto?.appShopId ?? '').trim());
  }

  // Descarta a loja recém-vinculada oferecida (não era a do lojista).
  @Post('recusar-bind')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  recusarBind(@CurrentUser() user: AuthUser) {
    return this.service.recusarBind(user.tenantId);
  }

  // Gera/retorna um auth_token fresco da loja (p/ colar na Ferramenta de Sandbox).
  @Get('token')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  token(@CurrentUser() user: AuthUser) {
    return this.service.tokenAtual(user.tenantId);
  }

  // Exporta o cardápio do Regem PRA o 99Food (cria os itens lá).
  @Post('exportar-catalogo')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  exportarCatalogo(@CurrentUser() user: AuthUser) {
    return this.service.exportarCatalogo(user.tenantId);
  }

  // Sobe um cardápio mínimo (1 item) na loja de teste — pré-requisito do Sandbox.
  @Post('cardapio-teste')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  cardapioTeste(@CurrentUser() user: AuthUser) {
    return this.service.subirCardapioTeste(user.tenantId);
  }

  // Puxa UM pedido pelo order_id (teste ponta a ponta sem depender do webhook).
  @Post('puxar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  puxar(@CurrentUser() user: AuthUser, @Body() dto: { orderId?: string }) {
    return this.service.puxarPedido(user.tenantId, String(dto?.orderId ?? '').trim());
  }

  @Post('desconectar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  desconectar(@CurrentUser() user: AuthUser) {
    return this.service.desconectar(user.tenantId);
  }

  // Liga o recebimento de cancelamento/reembolso do cliente (shop/apply/set) — passo
  // necessário para a homologação do cancelamento (dispara orderCancelApply).
  @Post('apply-set')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  applySet(@CurrentUser() user: AuthUser, @Body() dto: { cancel?: boolean; refund?: boolean }) {
    return this.service.ativarApply(user.tenantId, dto?.cancel ?? true, dto?.refund ?? true);
  }

  // Confirma a entrega self-delivery pelo código do cliente (verifyDeliveryCode → 600).
  @Post('verificar-entrega')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  verificarEntrega(@CurrentUser() user: AuthUser, @Body() dto: { orderId?: string; codigo?: string }) {
    return this.service.verificarEntregaPorTenant(
      user.tenantId,
      String(dto?.orderId ?? '').trim(),
      String(dto?.codigo ?? '').trim(),
    );
  }
}
