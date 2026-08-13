import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CardapioService } from './cardapio.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { CloudOnly } from '../../common/cloud-only.decorator';

// Público (sem login): o token na URL identifica o cardápio/loja.
// Cardápio ONLINE = sempre nuvem (cardapioBaseUrl) → não roda no edge.
@Controller('publico/cardapio')
@CloudOnly()
export class CardapioPublicoController {
  constructor(private readonly service: CardapioService) {}

  @Get(':token')
  menu(@Param('token') token: string) {
    return this.service.menu(token);
  }

  // Rate limit apertado no envio de pedido (endpoint público).
  @Post(':token/pedido')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  pedido(@Param('token') token: string, @Body() dto: any) {
    return this.service.receberPedido(token, dto);
  }

  @Post(':token/cupom')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  cupom(@Param('token') token: string, @Body() dto: any) {
    return this.service.validarCupomPublico(token, dto?.codigo ?? '', dto?.subtotal ?? 0, dto?.telefone);
  }

  // Cupons que o cliente pode usar agora (sugestão no checkout).
  @Get(':token/cupons-disponiveis')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  cuponsDisponiveis(
    @Param('token') token: string,
    @Query('telefone') telefone?: string,
    @Query('subtotal') subtotal?: string,
  ) {
    return this.service.cuponsDisponiveis(token, telefone, Number(subtotal) || 0);
  }

  // "Peça também": sugestões para o carrinho (produtos = ids no carrinho, csv).
  @Get(':token/peca-tambem')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  pecaTambem(@Param('token') token: string, @Query('produtos') produtos?: string) {
    return this.service.pecaTambem(token, produtos);
  }

  @Get(':token/pedido/:id')
  status(@Param('token') token: string, @Param('id') id: string, @Query('ref') ref?: string) {
    return this.service.statusPedido(token, id, ref);
  }

  @Post(':token/pedido/:id/pagar')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  pagar(@Param('token') token: string, @Param('id') id: string) {
    return this.service.pagarPedidoPublico(token, id);
  }

  // Público: o cliente cancela a própria encomenda (com estorno do sinal dentro do
  // prazo). `ref` = client_ref do pedido (prova de dono). mig 188/S3.
  @Post(':token/pedido/:id/cancelar')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  cancelarEncomenda(
    @Param('token') token: string,
    @Param('id') id: string,
    @Body() body: any,
  ) {
    return this.service.cancelarEncomendaPublico(token, id, body?.clienteToken, body?.ref);
  }

  // Público: recorrências de encomenda do cliente + pausar/retomar/cancelar. mig 190/S5.
  @Get(':token/recorrencias')
  recorrencias(@Param('token') token: string, @Query('ct') ct?: string) {
    return this.service.recorrenciasDoCliente(token, ct);
  }

  @Post(':token/recorrencias/:id/:acao')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  alterarRecorrencia(
    @Param('token') token: string,
    @Param('id') id: string,
    @Param('acao') acao: 'pausar' | 'retomar' | 'cancelar',
    @Body() body: any,
  ) {
    return this.service.alterarRecorrenciaCliente(token, id, body?.clienteToken, acao);
  }

  // Verifica o pagamento sob demanda (consulta o gateway) — o cliente clica
  // "Verificar pagamento" e a página faz polling disto (não depende do webhook).
  @Post(':token/pedido/:id/verificar-pagamento')
  @Throttle({ default: { ttl: 60000, limit: 40 } })
  verificarPagamento(@Param('token') token: string, @Param('id') id: string) {
    return this.service.verificarPagamentoPublico(token, id);
  }

  // Webhook do Mercado Pago (confirmação de PIX). Sem token de loja: correlaciona
  // pelo gateway_payment_id do pedido. Aceita o id no body (data.id) ou na query.
  @Post('pagamento/mercadopago/webhook')
  mpWebhook(@Body() body: any, @Query() q: any, @Headers() h: any) {
    const paymentId =
      body?.data?.id ?? body?.resource ?? q?.['data.id'] ?? q?.id ?? '';
    // Assinatura (defesa em profundidade): validada só se MP_WEBHOOK_SECRET setado.
    return this.service.webhookMercadoPago(
      String(paymentId || ''),
      h?.['x-signature'],
      h?.['x-request-id'],
    );
  }

  // Webhook do PagBank (Orders). Sem token de loja: correlaciona pelo id do pedido
  // (gateway_payment_id). O id do pedido vem no corpo (id / order.id / charges[].order_id).
  @Post('pagamento/pagbank/webhook')
  pagbankWebhook(@Body() body: any, @Query() q: any) {
    const orderId =
      body?.id ?? body?.order?.id ?? body?.data?.id ?? body?.charges?.[0]?.order_id ?? q?.id ?? '';
    return this.service.webhookPagBank(String(orderId || ''));
  }

  @Get(':token/pontos')
  pontos(@Param('token') token: string, @Query('ct') ct?: string) {
    return this.service.pontosPublico(token, ct);
  }

  @Get(':token/promos')
  promos(@Param('token') token: string) {
    return this.service.promosPublico(token);
  }

  // Resgata um prêmio de fidelidade disponível.
  @Post(':token/fidelidade/resgatar')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  resgatar(@Param('token') token: string, @Body() dto: any) {
    return this.service.resgatarFidelidade(token, dto?.resgateId ?? '', dto?.clienteToken);
  }

  // Prêmios resgatados, prontos para abater no próximo pedido.
  @Get(':token/fidelidade/premios')
  premios(@Param('token') token: string, @Query('ct') ct?: string) {
    return this.service.premiosFidelidade(token, ct);
  }

  // Saldo de cashback do cliente.
  @Get(':token/cashback')
  cashback(@Param('token') token: string, @Query('ct') ct?: string) {
    return this.service.cashbackSaldoPublico(token, ct);
  }

  // Troca pontos de cashback por um produto (gera vale).
  @Post(':token/cashback/resgatar')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  cashbackResgatar(@Param('token') token: string, @Body() dto: any) {
    return this.service.cashbackResgatarProduto(token, dto?.clienteToken, dto?.produtoId ?? '');
  }

  // Pedidos recentes do cliente (identificado pelo token do cliente).
  @Get(':token/pedidos')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  pedidosTelefone(@Param('token') token: string, @Query('ct') ct?: string) {
    return this.service.pedidosPorTelefone(token, ct);
  }

  // Último pedido do cliente (card do topo, com imagem dos produtos).
  @Get(':token/ultimo-pedido')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  ultimoPedido(@Param('token') token: string, @Query('ct') ct?: string) {
    return this.service.ultimoPedidoPublico(token, ct);
  }

  // Handoff: o robô abre um chamado de atendimento para a loja.
  @Post(':token/atendimento')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  atendimento(@Param('token') token: string, @Body() dto: any) {
    return this.service.abrirAtendimento(token, dto);
  }
}

// Gestão (JWT).
@Controller('cardapio')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
export class CardapioController {
  constructor(private readonly service: CardapioService) {}

  @Get('config')
  @RequirePerm('loja')
  config(@CurrentUser() user: AuthUser) {
    return this.service.getConfig(user.tenantId, null);
  }

  @Put('config')
  @Roles('presidente', 'gerente')
  @RequirePerm('loja')
  setConfig(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setConfig(user.tenantId, dto?.unidadeId ?? null, dto, user.categoria);
  }

  // Regras de sinal da encomenda por faixa de quantidade (mig 187).
  @Get('encomenda/regras-sinal')
  @RequirePerm('loja')
  regrasSinal(@CurrentUser() user: AuthUser) {
    return this.service.regrasSinalDe(user.tenantId, null);
  }

  @Put('encomenda/regras-sinal')
  @Roles('presidente', 'gerente')
  @RequirePerm('loja')
  setRegrasSinal(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setRegrasSinal(user.tenantId, dto?.unidadeId ?? null, dto?.regras ?? []);
  }

  // Auto-pausa por esgotamento de estoque (gestão do cardápio).
  @Get('auto-pausa')
  @RequirePerm('loja')
  autoPausa(@CurrentUser() user: AuthUser) {
    return this.service.autoPausaConfig(user.tenantId);
  }

  @Post('auto-pausa')
  @Roles('presidente', 'gerente')
  @RequirePerm('loja')
  setAutoPausa(@CurrentUser() user: AuthUser, @Body() dto: { ativo?: boolean }) {
    return this.service.setAutoPausa(user.tenantId, !!dto?.ativo);
  }

  @Get('bairros')
  @RequirePerm('loja')
  bairros(@CurrentUser() user: AuthUser) {
    return this.service.listarBairros(user.tenantId, null);
  }

  @Put('bairros')
  @Roles('presidente', 'gerente')
  @RequirePerm('loja')
  setBairros(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setBairros(user.tenantId, dto?.unidadeId ?? null, dto?.bairros ?? []);
  }

  @Get('banners')
  @RequirePerm('loja')
  banners(@CurrentUser() user: AuthUser) {
    return this.service.listarBanners(user.tenantId);
  }

  @Put('banners')
  @Roles('presidente', 'gerente')
  @RequirePerm('loja')
  setBanners(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setBanners(user.tenantId, dto?.unidadeId ?? null, dto?.banners ?? []);
  }

  @Get('cupons')
  @RequirePerm('cupons')
  cupons(@CurrentUser() user: AuthUser) {
    return this.service.listarCupons(user.tenantId);
  }

  @Post('cupons')
  @Roles('presidente', 'gerente')
  @RequirePerm('cupons')
  criarCupom(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criarCupom(user.tenantId, dto?.unidadeId ?? null, dto);
  }

  @Delete('cupons/:id')
  @Roles('presidente', 'gerente')
  @RequirePerm('cupons')
  removerCupom(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.removerCupom(user.tenantId, id);
  }
}
