import { Body, Controller, Get, HttpCode, Post, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { DisputaIfoodService, RespostaDaDisputa } from './disputa-ifood.service';
import { Pedido99Service, RespostaAo99 } from './pedido-99.service';
import { ChatIfoodService } from './chat-ifood.service';
import { ChatDoCasoService } from './chat-do-caso.service';
import { AjustesDaPonteService } from '../ponte-chat/ajustes-da-ponte.service';

// Pedidos do SERVIDOR DA LOJA à nuvem sobre a central de atendimento (V37): a credencial do iFood fica só na nuvem.
// Autenticação pelo token do servidor (x-sync-token) — a empresa vem do token, nunca do corpo. Só na nuvem.
@Controller('atendimento')
export class AtendimentoLojaController {
  constructor(
    private readonly disputa: DisputaIfoodService,
    private readonly pedido99: Pedido99Service,
    private readonly chatIfood: ChatIfoodService,
    private readonly chat: ChatDoCasoService,
    private readonly ponte: AjustesDaPonteService,
  ) {}

  // A faixa da ponte do chat para a fila do servidor da loja (a situação mora na nuvem — V37). `unidade` = a loja em uso lá.
  @Get('ponte-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  ponteDaLoja(@SyncCtx() ctx: SyncCtxData, @Query('unidade') unidade?: string) {
    const u = typeof unidade === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(unidade) ? unidade : null;
    return this.ponte.situacao(ctx.tenantId, u);
  }

  // "Conversas agora" para a tela do servidor da loja: o login e a permissão de quem está lá foram conferidos lá.
  @Get('conversas-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  conversasDaLoja(@SyncCtx() ctx: SyncCtxData, @Query() q: { unidade?: string; categoria?: string; bot?: string }) {
    return this.chat.conversasVindoDaLoja(ctx.tenantId, q ?? {});
  }

  // "Assumir a conversa" vindo do servidor da loja (quem assumiu é conferido aqui: colaborador da empresa e da gestão).
  @Post('conversas-da-loja/assumir')
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  assumirDaLoja(
    @SyncCtx() ctx: SyncCtxData,
    @Body() dto: { canal?: unknown; chave?: unknown; nome?: unknown; atorId?: unknown; atorPerfil?: unknown; bot?: unknown },
  ) {
    return this.chat.assumirVindoDaLoja(ctx.tenantId, dto);
  }

  // O chat do iFood e da 99 dentro do caso, para a tela do servidor da loja (as mensagens moram só na nuvem — V37).
  @Get('chat-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  chatDaLoja(@SyncCtx() ctx: SyncCtxData, @Query('chamado') chamado: string) {
    return this.chat.conversaDaEmpresa(ctx.tenantId, String(chamado ?? ''));
  }

  // A resposta da equipe no chat, vinda do servidor da loja (quem respondeu foi conferido lá): entra na fila da ponte.
  @Post('chat-da-loja')
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  responderDaLoja(@SyncCtx() ctx: SyncCtxData, @Body() dto: { chamadoId?: unknown; texto?: unknown; atorId?: unknown; atorPerfil?: unknown }) {
    return this.chat.responderVindoDaLoja(ctx.tenantId, dto);
  }

  // A configuração do chat oficial do iFood para a tela do servidor da loja (a integração mora só na nuvem — V37).
  @Get('chat-ifood-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  chatIfoodDaLoja(@SyncCtx() ctx: SyncCtxData) {
    return this.chatIfood.montar(ctx.tenantId);
  }

  // A loja responde ao pedido de cancelamento/reembolso do cliente da 99 (senha já conferida no servidor dela).
  @Post('pedido99-da-loja')
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  pedido99DaLoja(@SyncCtx() ctx: SyncCtxData, @Body() dto: RespostaAo99 & { chamadoId?: string; liberadorId?: string; liberadorNome?: string; atorId?: string }) {
    return this.pedido99.responderVindoDaLoja(ctx.tenantId, dto);
  }

  // A loja responde a uma disputa do iFood: a senha de gerente/presidente já foi conferida no servidor dela.
  @Post('disputa-da-loja')
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  disputaDaLoja(@SyncCtx() ctx: SyncCtxData, @Body() dto: RespostaDaDisputa & { chamadoId?: string; liberadorId?: string; liberadorNome?: string; atorId?: string }) {
    return this.disputa.responderVindoDaLoja(ctx.tenantId, dto);
  }

  // A foto que o cliente mandou na disputa (o iFood só entrega com a credencial da loja, que mora na nuvem).
  @Get('foto-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  async fotoDaLoja(
    @SyncCtx() ctx: SyncCtxData,
    @Query('chamado') chamado: string,
    @Query('n') n: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const f = await this.disputa.foto(ctx.tenantId, String(chamado ?? ''), Number(n) || 0);
    res.setHeader('Content-Type', f.tipo);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(f.bytes);
  }
}
