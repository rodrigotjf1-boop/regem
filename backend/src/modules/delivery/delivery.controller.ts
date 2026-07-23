import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { TerminalAtual } from '../../auth/terminal-atual.decorator';
import { DeliveryService } from './delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const GESTOR = ['presidente', 'gerente', 'supervisao'];

@Controller('delivery')
export class DeliveryController {
  constructor(private readonly service: DeliveryService) {}

  // Ingestão pelo EDGE (token servidor_local): { canal, pedido }.
  @Post('ingest')
  @UseGuards(SyncTokenGuard)
  ingest(@SyncCtx() ctx: SyncCtxData, @Body() dto: any) {
    return this.service.ingest(
      ctx.tenantId,
      ctx.unidadeId ?? null,
      dto?.canal ?? 'ifood',
      dto?.pedido ?? dto,
    );
  }

  // ----- Gestão (PDV) -----
  @Get('pedidos')
  @UseGuards(JwtAuthGuard)
  pedidos(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.listar(user.tenantId, atual);
  }

  @Post('pedidos/:id/aceitar')
  @UseGuards(JwtAuthGuard)
  aceitar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.aceitar(user.tenantId, user.colaboradorId, id);
  }

  @Post('pedidos/:id/avancar')
  @UseGuards(JwtAuthGuard)
  avancar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.avancar(user.tenantId, id, {
      entregadorId: dto?.entregadorId ?? null,
      entregadorNome: dto?.entregadorNome ?? null,
      entregadorTelefone: dto?.entregadorTelefone ?? null,
    });
  }

  @Post('pedidos/:id/retornar')
  @UseGuards(JwtAuthGuard)
  retornar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.retornarProducao(user.tenantId, id);
  }

  // "Voltar pedido" (coluna Finalizado) — exige senha de gestor (presidente/C&O).
  @Post('pedidos/:id/voltar')
  @UseGuards(JwtAuthGuard)
  voltar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.voltarPedido(user.tenantId, user.colaboradorId, id, dto?.senha);
  }

  // Hub "Retirada / Encomendas" (Fase 1): só pedidos de retirada/encomenda,
  // agrupados por origem (regem/integrado/marketplace).
  @Get('retirada')
  @UseGuards(JwtAuthGuard)
  retirada(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.listarRetirada(user.tenantId, atual);
  }

  // Entrega no balcão: conclui e cobra (a-pagar) no caixa do atendente.
  @Post('pedidos/:id/entregar')
  @UseGuards(JwtAuthGuard)
  entregar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @TerminalAtual() terminalId: string | null,
    @Body() dto: any,
  ) {
    return this.service.entregarBalcao(user.tenantId, user.colaboradorId, id, terminalId, {
      forma: dto?.forma ?? null,
    });
  }

  // Avisar pronto (robô / status-back do canal).
  @Post('pedidos/:id/avisar-pronto')
  @UseGuards(JwtAuthGuard)
  avisarPronto(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.avisarPronto(user.tenantId, id);
  }

  @Post('pedidos/:id/alterar')
  @UseGuards(JwtAuthGuard)
  alterar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.alterar(user.tenantId, user.colaboradorId, id, {
      adicionar: dto?.adicionar ?? [],
      remover: dto?.remover ?? [],
      endereco: dto?.endereco,
    });
  }

  @Post('pedidos/:id/reimprimir')
  @UseGuards(JwtAuthGuard)
  reimprimir(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.reimprimir(user.tenantId, user.colaboradorId, id);
  }

  @Get('pedidos/:id/itens')
  @UseGuards(JwtAuthGuard)
  itens(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.itensComanda(user.tenantId, id);
  }

  @Get('entregadores')
  @UseGuards(JwtAuthGuard)
  entregadores(@CurrentUser() user: AuthUser) {
    return this.service.listarEntregadores(user.tenantId);
  }

  @Get('bairros')
  @UseGuards(JwtAuthGuard)
  bairros(@CurrentUser() user: AuthUser) {
    return this.service.listarBairros(user.tenantId);
  }

  // Mapa de calor de entregas por bairro (gestão) — só presidente/gerente.
  // RBAC no servidor: supervisão/execução não recebem o payload.
  @Get('mapa-calor')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  mapaCalor(@CurrentUser() user: AuthUser, @Query('dias') dias?: string) {
    return this.service.mapaCalorBairros(user.tenantId, Number(dias) || 30);
  }

  // Integrações (credenciais) — secrets nunca voltam no GET.
  @Get('integracoes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  integracoes(@CurrentUser() user: AuthUser) {
    return this.service.listarIntegracoes(user.tenantId);
  }

  @Put('integracoes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  salvarIntegracao(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.salvarIntegracao(user.tenantId, dto);
  }

  // Cancelamento é liberado pela senha de um gestor (a trava está no service),
  // então um atendente também pode cancelar informando a senha autorizadora.
  @Post('pedidos/:id/cancelar')
  @UseGuards(JwtAuthGuard)
  cancelar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.cancelar(
      user.tenantId,
      user.colaboradorId,
      user.categoria,
      id,
      dto?.motivo,
      dto?.senha,
      // mig 128 — insumo já baixado: true = reutilizado (volta ao estoque),
      // false = perda. Default true (comportamento anterior).
      dto?.reaproveitado !== false,
    );
  }

  // Novo pedido manual (delivery ou retirada) — atendente também pode lançar.
  @Post('pedidos')
  @UseGuards(JwtAuthGuard)
  criarManual(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criarManual(user.tenantId, dto?.unidadeId ?? null, dto);
  }

  @Post('pedidos/:id/nf')
  @UseGuards(JwtAuthGuard)
  nf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.emitirNf(user.tenantId, user.colaboradorId, id);
  }

  @Post('pausar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...GESTOR)
  pausar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.pausar(user.tenantId, Number(dto?.minutos) || 30, dto?.motivo);
  }

  @Post('despausar')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...GESTOR)
  despausar(@CurrentUser() user: AuthUser) {
    return this.service.despausar(user.tenantId);
  }

  @Get('config')
  @UseGuards(JwtAuthGuard)
  config(@CurrentUser() user: AuthUser) {
    return this.service.getConfig(user.tenantId, null);
  }

  @Put('config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('presidente', 'gerente')
  setConfig(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setConfig(user.tenantId, dto?.unidadeId ?? null, dto);
  }

  // Simulador (teste): injeta um pedido iFood de exemplo — como se o edge tivesse
  // recebido. Facilita validar o fluxo sem credenciais reais.
  @Post('simular')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(...GESTOR)
  simular(@CurrentUser() user: AuthUser, @Body() dto: any) {
    const exemplo = {
      id: 'SIM-' + Date.now(),
      displayId: '#' + Math.floor(Math.random() * 9000 + 1000),
      orderType: dto?.tipo === 'retirada' ? 'TAKEOUT' : 'DELIVERY',
      customer: { name: dto?.cliente ?? 'Cliente Simulado' },
      delivery: { deliveryAddress: { formattedAddress: 'Rua Exemplo, 100' } },
      items: dto?.items ?? [
        { externalCode: dto?.codigo, name: dto?.produto ?? 'Item delivery', quantity: 1, unitPrice: dto?.preco ?? 25 },
      ],
      total: { orderAmount: dto?.preco ?? 25 },
      payments: { methods: [{ method: dto?.forma ?? 'online' }] },
    };
    return this.service.ingest(user.tenantId, null, 'ifood', exemplo, {
      trocoPara: dto?.trocoPara,
    });
  }
}
