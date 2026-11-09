import { Body, Controller, Get, HttpCode, NotFoundException, Optional, Post, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { DisputaIfoodService, RespostaDaDisputa } from './disputa-ifood.service';
import { Pedido99Service, RespostaAo99 } from './pedido-99.service';
import { ChatIfoodService } from './chat-ifood.service';
import { ChatDoCasoService } from './chat-do-caso.service';
import { AjustesDaPonteService } from '../ponte-chat/ajustes-da-ponte.service';
import { AvaliacaoIfoodService } from './avaliacao-ifood.service';
import { NumerosDoAtendimentoService } from './numeros.service';
import { InstagramService } from '../instagram/instagram.service';
import { MessengerService } from '../messenger/messenger.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A loja pedida pelo servidor da loja: um id válido, ou nenhuma (= todas). */
const unidadeDaConsulta = (u: unknown): string | null => (typeof u === 'string' && UUID_RE.test(u) ? u : null);

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
    // A resposta à avaliação do iFood vinda do servidor da loja (06/11/2026).
    private readonly avaliacao: AvaliacaoIfoodService,
    // Os números do atendimento (item 8): a conta mora na nuvem (as mensagens do chat do iFood e da 99 só existem lá).
    private readonly numeros: NumerosDoAtendimentoService,
    // O Instagram Direct (mig 377): a conversa e o acesso moram na nuvem.
    private readonly instagram: InstagramService,
    // O Messenger do Facebook (mig 386): a conversa e o acesso da página moram na nuvem.
    @Optional() private readonly messenger?: MessengerService,
  ) {}

  // A conversa do Messenger no caso, para a tela do servidor da loja (as mensagens moram só na nuvem — V37).
  @Get('messenger-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  messengerDaLoja(@SyncCtx() ctx: SyncCtxData, @Query('chamado') chamado: string) {
    if (!this.messenger) throw new NotFoundException('Messenger indisponível.');
    return this.messenger.conversa(ctx.tenantId, String(chamado ?? ''));
  }

  // A resposta no Messenger vinda do servidor da loja: quem respondeu é conferido aqui (colaborador ativo e da gestão).
  @Post('messenger-da-loja')
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  responderMessengerDaLoja(@SyncCtx() ctx: SyncCtxData, @Body() dto: { chamadoId?: unknown; texto?: unknown; atorId?: unknown }) {
    if (!this.messenger) throw new NotFoundException('Messenger indisponível.');
    return this.messenger.responderVindoDaLoja(ctx.tenantId, dto ?? {});
  }

  // A conversa do Instagram no caso, para a tela do servidor da loja (as mensagens moram só na nuvem — V37).
  @Get('instagram-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  instagramDaLoja(@SyncCtx() ctx: SyncCtxData, @Query('chamado') chamado: string) {
    return this.instagram.conversa(ctx.tenantId, String(chamado ?? ''));
  }

  // A resposta no Instagram vinda do servidor da loja: quem respondeu é conferido aqui (colaborador ativo e da gestão).
  @Post('instagram-da-loja')
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  responderInstagramDaLoja(@SyncCtx() ctx: SyncCtxData, @Body() dto: { chamadoId?: unknown; texto?: unknown; atorId?: unknown }) {
    return this.instagram.responderVindoDaLoja(ctx.tenantId, dto ?? {});
  }

  // Os COMENTÁRIOS dos posts do Instagram (F6, mig 384) para a tela do servidor da loja (moram só na nuvem — V37): a lista
  // e o comentário do caso (quem pediu — a gestão — foi conferido lá); a ação (responder, privada, esconder), com quem agiu
  // conferido AQUI (colaborador ativo da empresa e da gestão).
  @Get('instagram-comentarios-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  comentariosDaLoja(@SyncCtx() ctx: SyncCtxData, @Query() q: { filtro?: string; antes?: string }) {
    return this.instagram.comentarios.listar(ctx.tenantId, q ?? {});
  }

  @Get('instagram-comentario-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  comentarioDoCasoDaLoja(@SyncCtx() ctx: SyncCtxData, @Query('chamado') chamado: string) {
    return this.instagram.comentarios.doCaso(ctx.tenantId, String(chamado ?? ''));
  }

  @Post('instagram-comentarios-da-loja')
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  agirNoComentarioDaLoja(@SyncCtx() ctx: SyncCtxData, @Body() dto: { acao?: unknown; id?: unknown; texto?: unknown; esconder?: unknown; atorId?: unknown }) {
    return this.instagram.comentarios.agirVindoDaLoja(ctx.tenantId, dto ?? {});
  }

  // Os NÚMEROS DO ATENDIMENTO para a tela do servidor da loja: quem pediu (gerente ou presidente) e a loja em uso foram
  // conferidos lá; `unidade` vazia = todas as lojas (o presidente lá). A empresa vem do token.
  @Get('numeros-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  numerosDaLoja(@SyncCtx() ctx: SyncCtxData, @Query() q: { periodo?: string; unidade?: string }) {
    return this.numeros.numeros(ctx.tenantId, unidadeDaConsulta(q?.unidade), q?.periodo);
  }

  @Get('numeros-da-loja/casos')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  casosDaLoja(@SyncCtx() ctx: SyncCtxData, @Query() q: { periodo?: string; unidade?: string; motivo?: string; produto?: string }) {
    return this.numeros.casos(ctx.tenantId, unidadeDaConsulta(q?.unidade), q ?? {});
  }

  // A loja responde a uma avaliação do iFood: quem respondeu (a gestão) foi conferido no servidor dela.
  @Post('avaliacao-da-loja')
  @HttpCode(200)
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  avaliacaoDaLoja(@SyncCtx() ctx: SyncCtxData, @Body() dto: { chamadoId?: unknown; texto?: unknown; atorId?: unknown; atorNome?: unknown }) {
    return this.avaliacao.responderVindoDaLoja(ctx.tenantId, dto ?? {});
  }

  // A faixa da ponte do chat para a fila do servidor da loja (a situação mora na nuvem — V37). `unidade` = a loja em uso lá.
  @Get('ponte-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  ponteDaLoja(@SyncCtx() ctx: SyncCtxData, @Query('unidade') unidade?: string) {
    const u = typeof unidade === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(unidade) ? unidade : null;
    return this.ponte.situacao(ctx.tenantId, u);
  }

  // O alerta do Pix do adicional (mig 373) para a fila do servidor da loja — a tabela mora na nuvem (V37).
  @Get('adicionais-pix-da-loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  adicionaisPixDaLoja(@SyncCtx() ctx: SyncCtxData, @Query('unidade') unidade?: string) {
    const u = typeof unidade === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(unidade) ? unidade : null;
    return this.chat.adicionaisDaEmpresa(ctx.tenantId, u);
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
