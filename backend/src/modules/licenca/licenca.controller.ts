import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { DistribuidorGuard } from '../../auth/distribuidor.guard';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { LicencaService } from './licenca.service';
import { PLANOS } from './planos';
import { CloudOnly } from '../../common/cloud-only.decorator';

/* eslint-disable @typescript-eslint/no-explicit-any */
@Controller()
@CloudOnly()
export class LicencaController {
  constructor(private readonly service: LicencaService) {}

  // Status da conta (trial/assinatura) — o front usa para o aviso e o paywall.
  @Get('licenca/status')
  @UseGuards(JwtAuthGuard)
  status(@CurrentUser() user: AuthUser) {
    return this.service.statusConta(user.tenantId);
  }

  // Catálogo de planos (página de assinatura) — só quem tem a permissão "planos".
  @Get('planos')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('planos')
  planos() {
    return PLANOS;
  }

  // Checkout de assinatura (Stripe) — devolve a URL da página de pagamento.
  @Post('assinatura/checkout')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('planos')
  checkout(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criarCheckout(user.tenantId, dto?.chave ?? '', dto?.ciclo ?? '');
  }

  // Webhook do Stripe (público, corpo cru + assinatura). Sem throttle.
  @Post('publico/stripe/webhook')
  @SkipThrottle()
  stripeWebhook(@Req() req: any, @Headers('stripe-signature') sig: string) {
    return this.service.stripeWebhook(req.rawBody, sig ?? '');
  }

  // ===== Portal da revenda (presidente/C&O) =====
  @Get('revenda')
  @UseGuards(JwtAuthGuard, DistribuidorGuard)
  revendas() {
    return this.service.listarRevendas();
  }

  @Post('revenda')
  @UseGuards(JwtAuthGuard, DistribuidorGuard)
  criarRevenda(@Body() dto: any) {
    return this.service.criarRevenda(dto?.nome);
  }

  @Post('revenda/token')
  @UseGuards(JwtAuthGuard, DistribuidorGuard)
  emitir(@Body() dto: any) {
    return this.service.emitirToken(dto);
  }

  @Get('revenda/frota')
  @UseGuards(JwtAuthGuard, DistribuidorGuard)
  frota() {
    return this.service.frota();
  }

  @Post('ativacao/:id/modulos')
  @UseGuards(JwtAuthGuard, DistribuidorGuard)
  modulos(@Param('id') id: string, @Body() dto: any) {
    return this.service.atualizarModulos(id, dto?.modulos ?? [], dto?.plano);
  }

  @Post('ativacao/:id/suspender')
  @UseGuards(JwtAuthGuard, DistribuidorGuard)
  suspender(@Param('id') id: string) {
    return this.service.mudarStatus(id, 'suspenso');
  }

  @Post('ativacao/:id/reativar')
  @UseGuards(JwtAuthGuard, DistribuidorGuard)
  reativar(@Param('id') id: string) {
    return this.service.mudarStatus(id, 'ativado');
  }

  @Post('ativacao/:id/revogar')
  @UseGuards(JwtAuthGuard, DistribuidorGuard)
  revogar(@Param('id') id: string) {
    return this.service.mudarStatus(id, 'revogado');
  }

  @Post('ativacao/:id/rebind')
  @UseGuards(JwtAuthGuard, DistribuidorGuard)
  rebind(@Param('id') id: string) {
    return this.service.rebind(id);
  }

  // ===== Provisionamento (edge, público por token) =====
  @Post('provisionamento/ativar')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  ativar(@Body() dto: any) {
    return this.service.ativar(dto?.token ?? '', dto?.fingerprint ?? '');
  }

  // Auto-instalação self-service (G-4): autentica a conta C&O + fingerprint e
  // devolve { syncToken, lease }. É o que o instalador chama no fim (sem token
  // emitido à mão pela distribuição).
  @Post('provisionamento/instalar')
  @Throttle({ default: { ttl: 60000, limit: 8 } })
  instalar(@Body() dto: any) {
    return this.service.instalarSelfService(dto ?? {});
  }

  // ===== Edge (token de dispositivo servidor_local) =====
  @Get('edge/lease')
  @UseGuards(SyncTokenGuard)
  lease(
    @SyncCtx() ctx: SyncCtxData,
    @Headers('x-sync-fp') fp?: string,
    @Headers('x-sync-fp-legacy') fpLegacy?: string,
  ) {
    return this.service.renovarLease(ctx.tenantId, fp, fpLegacy);
  }

  @Post('edge/heartbeat')
  @UseGuards(SyncTokenGuard)
  heartbeat(@SyncCtx() ctx: SyncCtxData, @Body() dto: any) {
    return this.service.heartbeat(ctx.tenantId, dto);
  }
}
