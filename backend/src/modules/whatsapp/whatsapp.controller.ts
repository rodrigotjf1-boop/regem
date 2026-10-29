import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { WhatsappService } from './whatsapp.service';
import { WhatsappProvedorService } from './whatsapp-provedor.service';
import { WhatsappNumeroService, Papel } from './whatsapp-numero.service';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { CABECALHO_SEGREDO_ROBO, segredoDaChamada } from '../../common/segredo-robo';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** `minutos` do Pausar: ausente = o tempo da loja; 0 = até alguém retomar; senão 1–1440. */
export function minutosDoPedido(v: unknown): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 1440)
    throw new BadRequestException('minutos deve ser um número inteiro de 0 a 1440 (0 = até alguém retomar).');
  return n;
}

// Onboarding do WhatsApp da loja (gestor). O resolver é público (com secret).
@Controller()
@CloudOnly()
export class WhatsappController {
  constructor(
    private readonly service: WhatsappService,
    private readonly provedores: WhatsappProvedorService,
    private readonly numeros: WhatsappNumeroService,
    private readonly cloud: WhatsappCloudService,
  ) {}

  // ===== Números por PAPEL × PROVEDOR (modelo novo, mig 225) =====
  // Tela de configuração: principal (chatbot só responde) + marketing (disparo).
  @Get('whatsapp/numeros')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('delivery')
  listarNumeros(@CurrentUser() user: AuthUser) {
    return this.numeros.listar(user.tenantId);
  }

  @Post('whatsapp/numeros')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  salvarNumero(
    @CurrentUser() user: AuthUser,
    @Body()
    dto: {
      papel?: string;
      provedor?: string;
      numero?: string | null;
      instancia?: string | null;
      phoneId?: string | null;
      wabaId?: string | null;
      verificado?: boolean;
      termoAceito?: string | null;
    },
  ) {
    return this.numeros.salvarNumero(user.tenantId, (dto?.papel ?? '') as Papel, dto ?? {});
  }

  @Delete('whatsapp/numeros/:papel')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  removerNumero(@CurrentUser() user: AuthUser, @Param('papel') papel: string) {
    return this.numeros.remover(user.tenantId, (papel ?? '') as Papel);
  }

  @Post('whatsapp/conectar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  conectar(@CurrentUser() user: AuthUser) {
    return this.service.conectar(user.tenantId);
  }

  // `whatsapp/status` e a caixa de conversas (conversas, mensagens, enviar, mídia, cardápios, pausar, histórico, tempo
  // de pausa) moram no WhatsappCaixaController: são as rotas que o servidor da loja também atende, repassando à nuvem.

  @Delete('whatsapp/desconectar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  desconectar(@CurrentUser() user: AuthUser) {
    return this.service.desconectar(user.tenantId);
  }

  // ===== Número de MARKETING (F5b) — 2º WhatsApp p/ campanhas (gate 'delivery', contexto CRM). =====
  @Post('whatsapp/marketing/conectar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  conectarMarketing(@CurrentUser() user: AuthUser) {
    return this.service.conectarMarketing(user.tenantId);
  }

  @Get('whatsapp/marketing/status')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('delivery')
  statusMarketing(@CurrentUser() user: AuthUser) {
    return this.service.statusMarketing(user.tenantId);
  }

  @Delete('whatsapp/marketing/desconectar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  desconectarMarketing(@CurrentUser() user: AuthUser) {
    return this.service.desconectarMarketing(user.tenantId);
  }

  // Diagnóstico: vars setadas? Evolution respondeu? lista as instâncias.
  @Get('whatsapp/diagnostico')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  diagnostico(@CurrentUser() user: AuthUser) {
    return this.service.diagnostico(user.tenantId);
  }

  // Vincula uma instância existente do Evolution (sem criar/parear de novo).
  @Post('whatsapp/vincular')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  vincular(@CurrentUser() user: AuthUser, @Body() dto: { instancia?: string }) {
    return this.service.vincular(user.tenantId, dto?.instancia ?? '');
  }

  // Ajustes do robô que não são do cardápio (mig 342): por quanto tempo ele fica calado depois que o humano assume.
  // Ler fica no WhatsappCaixaController (a caixa da loja também lê); salvar é só pela nuvem.
  @Post('whatsapp/robo-config')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  salvarRoboConfig(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.provedores.salvarRoboConfig(user, dto);
  }

  // Modelos aprovados na Meta (API oficial). Alimenta a escolha do modelo num
  // aviso ou campanha, e mostra ao lojista o que ja foi aprovado.
  @Get('whatsapp/cloud/templates')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('bot')
  cloudTemplates(@CurrentUser() user: AuthUser) {
    return this.cloud.listarTemplates(user.tenantId);
  }

  // Desempenho dos modelos na Meta (enviados/entregues/lidos/cliques + custo) — por LOJA.
  @Get('whatsapp/cloud/templates/analytics')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('delivery')
  templatesAnalytics(
    @CurrentUser() user: AuthUser,
    @Query('desde') desde?: string,
    @Query('ate') ate?: string,
  ) {
    return this.cloud.templateAnalytics(user.tenantId, { desde, ate });
  }

  // ===== Gestão LOCAL de templates (Opção B — criar/submeter pelo Regem, mig 227) =====
  @Get('whatsapp/cloud/templates/locais')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('delivery')
  templatesLocais(@CurrentUser() user: AuthUser) {
    return this.cloud.templatesLocais(user.tenantId);
  }

  @Post('whatsapp/cloud/templates/salvar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  templateSalvar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    return this.cloud.salvarTemplate(user.tenantId, dto ?? {});
  }

  @Post('whatsapp/cloud/templates/:id/submeter')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  templateSubmeter(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cloud.submeterTemplate(user.tenantId, id);
  }

  @Post('whatsapp/cloud/templates/sincronizar')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  templatesSincronizar(@CurrentUser() user: AuthUser) {
    return this.cloud.sincronizarTemplates(user.tenantId);
  }

  // (Re)envia a biblioteca de modelos do Regem à WABA da loja (submete p/ aprovação).
  @Post('whatsapp/cloud/modelos-regem')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  modelosRegem(@CurrentUser() user: AuthUser) {
    return this.cloud.seedModelosRegem(user.tenantId);
  }

  // (Re)envia a biblioteca de UTILIDADE (avisos de status) à WABA do número principal.
  @Post('whatsapp/cloud/modelos-utilidade')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  modelosUtilidade(@CurrentUser() user: AuthUser) {
    return this.cloud.seedUtilidade(user.tenantId);
  }

  @Delete('whatsapp/cloud/templates/:id')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  templateRemover(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.cloud.removerTemplate(user.tenantId, id);
  }

  // ===== Embedded Signup (Fase 3 frente 2) — conectar o WABA da própria loja =====
  // Config pública (App ID + Configuration ID) para o front montar o popup da Meta.
  @Get('whatsapp/cloud/embedded-config')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  embeddedConfig() {
    return this.cloud.embeddedConfig();
  }

  // Finaliza o cadastro incorporado: grava phone_id/WABA da loja + assina o app.
  @Post('whatsapp/cloud/embedded-signup')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  embeddedSignup(
    @CurrentUser() user: AuthUser,
    @Body() dto: { code?: string; phoneNumberId?: string; wabaId?: string; papel?: string; coexistence?: boolean },
  ) {
    return this.cloud.finalizarEmbeddedSignup(user.tenantId, dto ?? {});
  }

  // Registra o número na Cloud API (ativa o envio) — corrige o 133010 "Account not
  // registered". Recebe o papel e o PIN de verificação em duas etapas (6 dígitos).
  @Post('whatsapp/cloud/registrar-numero')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  registrarNumero(@CurrentUser() user: AuthUser, @Body() dto: { papel?: string; pin?: string }) {
    return this.cloud.registrarNumeroPapel(user.tenantId, dto?.papel ?? 'marketing', dto?.pin ?? '');
  }

  // Limite de envio (conversas iniciadas / 24h) + usado hoje — lido direto da Meta.
  @Get('whatsapp/cloud/limite')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('delivery')
  limiteEnvio(@CurrentUser() user: AuthUser) {
    return this.cloud.limiteEnvio(user.tenantId);
  }

  // Confere na Meta de qual numero e um Phone Number ID, antes de vincular.
  @Get('whatsapp/cloud/verificar-numero')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  cloudVerificarNumero(@Query('phoneNumberId') phoneNumberId: string) {
    return this.cloud.verificarNumero(phoneNumberId ?? '');
  }

  // ===== Escolha do provedor de WhatsApp (F2c) =====
  // Devolve tambem o TEXTO dos termos: a tela exibe exatamente o que sera gravado
  // na auditoria no aceite, sem chance de divergirem.
  @Get('whatsapp/provedor')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente', 'supervisao')
  @RequirePerm('bot')
  provedorEstado(@CurrentUser() user: AuthUser) {
    return this.provedores.estado(user.tenantId);
  }

  @Post('whatsapp/provedor')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  provedorDefinir(
    @CurrentUser() user: AuthUser,
    @Body()
    dto: {
      provedor?: string;
      aceite?: boolean;
      termoVersao?: string;
      waCloudPhoneId?: string;
      waCloudWabaId?: string;
      waCloudNumero?: string;
    },
  ) {
    return this.provedores.definir(user, dto ?? {});
  }

  // Equivalente ao "Desconectar" do Evolution, para o lado da API oficial.
  @Delete('whatsapp/cloud/vinculo')
  @UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
  @Roles('presidente', 'gerente')
  @RequirePerm('bot')
  cloudDesvincular(@CurrentUser() user: AuthUser) {
    return this.provedores.desvincularCloud(user);
  }

  // Resolver do bot multi-tenant: o n8n manda instância + a senha do robô e recebe a loja.
  // A senha vai no cabeçalho `x-regem-robo-segredo`; `?secret=` só para os fluxos antigos.
  @Get('publico/bot/resolver')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  resolver(
    @Query('instancia') instancia: string,
    @Query('secret') secret: string,
    @Query('numero') numero?: string,
    @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string,
  ) {
    return this.service.resolver(instancia ?? '', segredoDaChamada(segredo, secret), numero ?? '');
  }

  // Status de um pedido por NÚMERO (senha), para o robô responder o cliente.
  // O n8n manda instância + a senha do robô + telefone + numero e recebe um texto pronto.
  @Get('publico/bot/pedido-status')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  statusPedidoBot(
    @Query('instancia') instancia: string,
    @Query('secret') secret: string,
    @Query('numero') numero?: string,
    @Query('telefone') telefone?: string,
    @Query('phoneNumberId') phoneNumberId?: string,
    @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string,
  ) {
    return this.service.statusPedidoBot(
      instancia ?? '',
      segredoDaChamada(segredo, secret),
      telefone ?? '',
      numero ?? '',
      phoneNumberId ?? '',
    );
  }

  // Pedidos RECENTES do cliente por telefone (contexto da IA "cadê meu pedido").
  // Autenticado pela senha do robô — não exige token de cliente.
  @Get('publico/bot/pedidos')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  pedidosBot(
    @Query('instancia') instancia: string,
    @Query('secret') secret: string,
    @Query('telefone') telefone?: string,
    @Query('phoneNumberId') phoneNumberId?: string,
    @Headers(CABECALHO_SEGREDO_ROBO) segredo?: string,
  ) {
    return this.service.pedidosPorTelefoneBot(
      instancia ?? '',
      segredoDaChamada(segredo, secret),
      telefone ?? '',
      phoneNumberId ?? '',
    );
  }
}
