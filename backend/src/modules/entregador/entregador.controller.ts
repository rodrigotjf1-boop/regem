import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { EntregadorService } from './entregador.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// App do Entregador. Auth = login de colaborador (JWT); só nuvem.
@Controller('entregador')
@CloudOnly()
@UseGuards(JwtAuthGuard)
export class EntregadorController {
  constructor(private readonly service: EntregadorService) {}

  @Get('perfil')
  perfil(@CurrentUser() user: AuthUser) {
    return this.service.perfil(user);
  }

  @Post('dispositivo')
  dispositivo(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.registrarDispositivo(
      user.tenantId,
      user.colaboradorId,
      dto?.fcmToken ?? '',
      dto?.plataforma,
    );
  }

  // E1 — assume o pedido pelo código do cupom.
  @Post('scan')
  scan(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.scan(user, dto?.codigo ?? '');
  }

  // E1 — meus pedidos em rota.
  @Get('pedidos')
  pedidos(@CurrentUser() user: AuthUser) {
    return this.service.pedidos(user);
  }

  // E6 — minha saída (roteiro) ativa: paradas ordenadas.
  @Get('saida')
  saida(@CurrentUser() user: AuthUser) {
    return this.service.saidaAtiva(user.tenantId, user.colaboradorId);
  }

  // E6 — pega a próxima saída: forma o roteiro (até o máximo da loja) e atrela a mim.
  @Post('saida/proxima')
  proximaSaida(@CurrentUser() user: AuthUser) {
    return this.service.proximaSaida(user);
  }

  // E1 — finaliza a entrega (código opcional para marketplace de entrega própria).
  @Post('pedido/:id/finalizar')
  finalizar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.finalizar(user, id, dto?.codigo);
  }

  // E2 — o app manda a localização (durante entrega ativa).
  @Post('localizacao')
  localizacao(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.enviarLocalizacao(
      user,
      Number(dto?.lat),
      Number(dto?.lng),
      dto?.precisao != null ? Number(dto.precisao) : undefined,
    );
  }

  // E4 — o entregador avisa o cliente que está chegando.
  @Post('pedido/:id/chegando')
  chegando(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.avisarChegando(user, id);
  }

  // E2 — o gestor vê os entregadores ao vivo (RBAC delivery).
  @Get('ao-vivo')
  @UseGuards(RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('delivery')
  aoVivo(@CurrentUser() user: AuthUser) {
    return this.service.aoVivo(user.tenantId);
  }

  // ===== E5 — pagamento =====
  // App do entregador: meus ganhos de hoje.
  @Get('ganhos')
  ganhos(@CurrentUser() user: AuthUser) {
    return this.service.ganhos(user);
  }

  // App do entregador: minha preferência (opt-in de compartilhar contato no aviso).
  @Get('preferencia')
  minhaPreferencia(@CurrentUser() user: AuthUser) {
    return this.service.minhaPreferencia(user);
  }

  @Post('preferencia')
  salvarPreferencia(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.salvarPreferencia(user, dto?.compartilhaContato === true);
  }

  // Gestor: config do modelo de pagamento (valores = financeiro → presidente/gerente).
  @Get('pagamento/config')
  @UseGuards(RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  pagamentoConfig(@CurrentUser() user: AuthUser) {
    return this.service.configPagamento(user.tenantId);
  }

  @Post('pagamento/config')
  @UseGuards(RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  salvarPagamentoConfig(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.salvarConfigPagamento(user.tenantId, dto ?? {});
  }

  // Perfil de pagamento POR entregador (sobrepõe o padrão da loja).
  @Get('pagamento/perfis')
  @UseGuards(RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  perfisPagamento(@CurrentUser() user: AuthUser) {
    return this.service.listarPerfisPagamento(user.tenantId);
  }

  @Post('pagamento/perfil')
  @UseGuards(RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  salvarPerfil(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.salvarPerfilPagamento(user.tenantId, dto?.colaboradorId ?? '', dto ?? {});
  }

  // Gestor/atendente: fechamento do PERÍODO (dia/semana/quinzena, conforme a config de
  // cada entregador) — quanto pagar por entregador sobre as entregas ainda não acertadas.
  @Get('pagamento/fechamento')
  @UseGuards(RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao', 'atendente')
  @RequirePerm('delivery')
  fechamento(@CurrentUser() user: AuthUser) {
    return this.service.fechamentoEntregadores(user.tenantId);
  }

  // Finaliza e PAGA o entregador → registra o fechamento + gera a SANGRIA no caixa de
  // entregas + marca os pedidos como acertados.
  @Post('pagamento/fechar')
  @UseGuards(RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao', 'atendente')
  @RequirePerm('delivery')
  fechar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.pagarEntregador(user.tenantId, user.colaboradorId, dto?.colaboradorId ?? '');
  }
}
