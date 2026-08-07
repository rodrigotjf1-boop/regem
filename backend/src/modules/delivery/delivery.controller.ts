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
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { AuthUser } from '../../auth/auth-user';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { CloudOnly } from '../../common/cloud-only.decorator';
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
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  pedidos(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    // Painel de Delivery exclui retirada (tem o hub "Balcão retirada / encomendas").
    return this.service.listar(user.tenantId, atual, { excluirRetirada: true });
  }

  @Post('pedidos/:id/aceitar')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  aceitar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.aceitar(user.tenantId, user.colaboradorId, id);
  }

  @Post('pedidos/:id/avancar')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
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

  // Despacha direto para "em rota" (AVANÇAR do Painel: pula 'pronto').
  @Post('pedidos/:id/despachar')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  despachar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    return this.service.despachar(user.tenantId, id, {
      entregadorId: dto?.entregadorId ?? null,
      entregadorNome: dto?.entregadorNome ?? null,
      entregadorTelefone: dto?.entregadorTelefone ?? null,
    });
  }

  @Post('pedidos/:id/retornar')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  retornar(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.retornarProducao(user.tenantId, id);
  }

  // Finaliza a entrega. Pago online → conclui direto. A-receber (sem forma no corpo)
  // → responde { precisaConferencia: true } para o front abrir a conferência; com
  // { forma } → registra o recebimento no caixa de entregas e conclui.
  @Post('pedidos/:id/finalizar')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  finalizar(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: { forma?: string; valorRecebido?: number },
  ) {
    return this.service.finalizar(user.tenantId, user.colaboradorId, id, dto ?? {});
  }

  // Imprime o cupom do entregador (com o QR de despacho) — Fase 4.
  @Post('pedidos/:id/cupom-entregador')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  cupomEntregador(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null, @Param('id') id: string) {
    return this.service.imprimirCupomEntregador(user.tenantId, atual, id);
  }

  // "Voltar pedido" (coluna Finalizado) — exige senha de gestor (presidente/C&O).
  @Post('pedidos/:id/voltar')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  voltar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.voltarPedido(user.tenantId, user.colaboradorId, id, dto?.senha);
  }

  // Hub "Retirada / Encomendas" (Fase 1): só pedidos de retirada/encomenda,
  // agrupados por origem (regem/integrado/marketplace).
  @Get('retirada')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  retirada(@CurrentUser() user: AuthUser, @UnidadeAtual() atual: string | null) {
    return this.service.listarRetirada(user.tenantId, atual);
  }

  // Entrega no balcão: conclui e cobra (a-pagar) no caixa do atendente.
  @Post('pedidos/:id/entregar')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
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
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  avisarPronto(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.avisarPronto(user.tenantId, id);
  }

  @Post('pedidos/:id/alterar')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  alterar(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() dto: any) {
    return this.service.alterar(user.tenantId, user.colaboradorId, id, {
      adicionar: dto?.adicionar ?? [],
      remover: dto?.remover ?? [],
      endereco: dto?.endereco,
    });
  }

  @Post('pedidos/:id/reimprimir')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  reimprimir(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: any,
  ) {
    // dto.equipamentoId (opcional): "Imprimir em…" — override da impressora.
    return this.service.reimprimir(user.tenantId, user.colaboradorId, id, dto?.equipamentoId ?? null);
  }

  @Get('pedidos/:id/itens')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  itens(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.itensComanda(user.tenantId, id);
  }

  @Get('entregadores')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  entregadores(@CurrentUser() user: AuthUser) {
    return this.service.listarEntregadores(user.tenantId);
  }

  @Get('bairros')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  bairros(@CurrentUser() user: AuthUser) {
    return this.service.listarBairros(user.tenantId);
  }

  // Mapa de calor de entregas por bairro (gestão) — só presidente/gerente.
  // RBAC no servidor: supervisão/execução não recebem o payload.
  @Get('mapa-calor')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  mapaCalor(@CurrentUser() user: AuthUser, @Query('dias') dias?: string) {
    return this.service.mapaCalorBairros(user.tenantId, Number(dias) || 30);
  }

  // Integrações (credenciais) — secrets nunca voltam no GET.
  @CloudOnly()
  @Get('integracoes')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  integracoes(@CurrentUser() user: AuthUser) {
    return this.service.listarIntegracoes(user.tenantId);
  }

  @CloudOnly()
  @Put('integracoes')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  salvarIntegracao(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.salvarIntegracao(user.tenantId, dto);
  }

  // Testa a conexão de um gateway de PIX (Mercado Pago / Iugu): valida o token na
  // API do provedor. Usa o token do corpo (o que está no campo) ou, se vazio, o salvo.
  @CloudOnly()
  @Post('integracoes/:canal/testar-pix')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  testarPix(@CurrentUser() user: AuthUser, @Param('canal') canal: string, @Body() dto: any) {
    return this.service.testarGatewayPix(user.tenantId, canal, dto?.token);
  }

  // Cancelamento é liberado pela senha de um gestor (a trava está no service),
  // então um atendente também pode cancelar informando a senha autorizadora.
  @Post('pedidos/:id/cancelar')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
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
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  criarManual(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.criarManual(user.tenantId, dto?.unidadeId ?? null, dto);
  }

  @Post('pedidos/:id/nf')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  nf(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.service.emitirNf(user.tenantId, user.colaboradorId, id);
  }

  @Post('pausar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles(...GESTOR)
  @RequirePerm('delivery')
  pausar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.pausar(user.tenantId, Number(dto?.minutos) || 30, dto?.motivo);
  }

  @Post('despausar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles(...GESTOR)
  @RequirePerm('delivery')
  despausar(@CurrentUser() user: AuthUser) {
    return this.service.despausar(user.tenantId);
  }

  @Get('config')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  config(@CurrentUser() user: AuthUser) {
    return this.service.getConfig(user.tenantId, null);
  }

  @Put('config')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  setConfig(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.service.setConfig(user.tenantId, dto?.unidadeId ?? null, dto);
  }

  // Perfis de cupom efetivos (padrão + override) — Fase 1 do construtor de cupons.
  @Get('cupom-perfis')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  cupomPerfis(@CurrentUser() user: AuthUser) {
    return this.service.getCupomPerfis(user.tenantId, null);
  }

  // Simulador (teste): injeta um pedido iFood de exemplo — como se o edge tivesse
  // recebido. Facilita validar o fluxo sem credenciais reais.
  @CloudOnly()
  @Post('simular')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles(...GESTOR)
  @RequirePerm('delivery')
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
