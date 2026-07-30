import { Body, Controller, Get, Headers, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DistribuicaoService } from './distribuicao.service';
import { DistCtx, DistUser, DistribuicaoGuard, PerfilDist, PerfilDistGuard } from './distribuicao.guard';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Console da distribuição (Fase 1). Realm próprio: login, perfil, auditoria.
@Controller('distribuicao')
export class DistribuicaoController {
  constructor(private readonly service: DistribuicaoService) {}

  @Post('login')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  login(@Body() dto: any, @Req() req: any) {
    return this.service.login(dto?.email, dto?.senha, req?.ip);
  }

  // Cria o 1º usuário (diretoria) com a tabela vazia. Header x-bootstrap-secret =
  // DIST_BOOTSTRAP_SECRET (env). Some assim que existir 1 usuário.
  @Post('bootstrap')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  bootstrap(@Body() dto: any, @Headers('x-bootstrap-secret') seg: string) {
    return this.service.bootstrap(dto, seg ?? '');
  }

  @Get('me')
  @UseGuards(DistribuicaoGuard)
  me(@DistUser() u: DistCtx) {
    return u;
  }

  // Gestão de usuários — só Diretoria.
  @Get('usuarios')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  usuarios() {
    return this.service.listar();
  }

  @Post('usuarios')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  criarUsuario(@DistUser() u: DistCtx, @Body() dto: any) {
    return this.service.criar(dto, u);
  }

  // Frota — todos os perfis veem (lojas, versão do edge, online, licença).
  @Get('frota')
  @UseGuards(DistribuicaoGuard)
  frota() {
    return this.service.frota();
  }

  // Telemetria — Diretoria + Técnico (Financeiro não vê logs técnicos).
  @Get('telemetria')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  telemetria() {
    return this.service.telemetria();
  }

  @Post('telemetria/:id/resolver')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  resolverTelemetria(@DistUser() u: DistCtx, @Param('id') id: string) {
    return this.service.resolverTelemetria(id, u);
  }

  // Licenças — ver: Diretoria+Técnico+Financeiro. Agir: Diretoria+Financeiro.
  @Get('licencas')
  @UseGuards(DistribuicaoGuard)
  licencas() {
    return this.service.licencas();
  }

  @Post('licencas/:tenantId/revogar')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'financeiro')
  revogar(@DistUser() u: DistCtx, @Param('tenantId') id: string) {
    return this.service.revogarLicenca(id, u);
  }

  @Post('licencas/:tenantId/liberar')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'financeiro')
  liberar(@DistUser() u: DistCtx, @Param('tenantId') id: string, @Body() dto: any) {
    return this.service.liberarLicenca(id, dto?.dias ?? 30, u);
  }

  @Post('licencas/:tenantId/plano')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'financeiro')
  plano(@DistUser() u: DistCtx, @Param('tenantId') id: string, @Body() dto: any) {
    return this.service.mudarPlano(id, String(dto?.plano ?? ''), u);
  }

  // Releases (publicar/listar) — Diretoria. O edge lê o último no update-check.
  @Get('releases')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  releases() {
    return this.service.releases();
  }

  @Post('releases')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  publicarRelease(@DistUser() u: DistCtx, @Body() dto: any) {
    return this.service.publicarRelease(dto, u);
  }

  // Rollback remoto — Diretoria+Técnico (o edge executa no próximo ciclo).
  @Post('licencas/:tenantId/rollback')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  rollbackRemoto(@DistUser() u: DistCtx, @Param('tenantId') id: string) {
    return this.service.comandoRemoto(id, 'rollback', u);
  }

  // Auditoria — Diretoria (histórico das ações da distribuição).
  @Get('auditoria')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria')
  auditoria() {
    return this.service.listarAuditoria();
  }

  // Pedidos de integração — Diretoria + Técnico (quem conecta no portal do canal).
  @Get('pedidos-integracao')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  pedidosIntegracao() {
    return this.service.pedidosIntegracao();
  }

  @Post('pedidos-integracao/:id/resolver')
  @UseGuards(DistribuicaoGuard, PerfilDistGuard)
  @PerfilDist('diretoria', 'tecnico')
  resolverPedidoIntegracao(@DistUser() u: DistCtx, @Param('id') id: string, @Body() dto: any) {
    const acao =
      dto?.acao === 'recusado' ? 'recusado' : dto?.acao === 'removido' ? 'removido' : 'conectado';
    return this.service.resolverPedidoIntegracao(id, acao, u, { merchantId: dto?.merchantId });
  }
}
