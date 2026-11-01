import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { ehServidorLocal } from '../../common/modo';
import { WhatsappService } from './whatsapp.service';
import { WhatsappProvedorService } from './whatsapp-provedor.service';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { minutosDoPedido } from './whatsapp.controller';
import { PedidoDeRepasse, repassarParaNuvem } from './repasse-da-loja';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CAIXA DE CONVERSAS DO WHATSAPP (tela Delivery › WhatsApp) — nas DUAS pontas, com as mesmas travas (perfil +
// permissão `bot`):
//  • na NUVEM, atende direto (Evolution, API oficial, histórico, pausa do robô);
//  • no SERVIDOR DA LOJA, confere o login e a permissão do colaborador AQUI e repassa à nuvem (whatsapp/da-loja, com o
//    token do servidor) — o WhatsApp só existe na nuvem. Decisão do dono (29/10/2026): o atendente da loja responde
//    pela caixa do Regem.
// NÃO é @CloudOnly: o WhatsappModule também sobe no servidor da loja (o PontoModule o importa), e uma rota repetida em
// outro módulo perderia para a do WhatsappController (registrada antes) — por isso cada rota existe uma vez só, aqui.
// Configurar números (QR, API oficial) segue no WhatsappController, só pela nuvem.
@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('bot')
export class WhatsappCaixaController {
  constructor(
    private readonly service: WhatsappService,
    private readonly provedores: WhatsappProvedorService,
    private readonly cloud: WhatsappCloudService,
  ) {}

  /** No servidor da loja, a nuvem responde; aqui fica só a conferência do login. */
  private repassar(user: AuthUser, p: Omit<PedidoDeRepasse, 'usuario'>) {
    return repassarParaNuvem({ ...p, usuario: { tenantId: user.tenantId, colaboradorId: user.colaboradorId } });
  }

  @Get('status')
  @Roles('presidente', 'gerente', 'supervisao')
  status(@CurrentUser() user: AuthUser) {
    if (ehServidorLocal()) return this.repassar(user, { metodo: 'GET', caminho: 'status' });
    return this.service.status(user.tenantId);
  }

  // Roteia pelo provedor da loja: Evolution guarda as conversas nele mesmo; na Cloud elas vêm do nosso banco.
  @Get('conversas')
  @Roles('presidente', 'gerente', 'supervisao')
  conversas(@CurrentUser() user: AuthUser) {
    if (ehServidorLocal()) return this.repassar(user, { metodo: 'GET', caminho: 'conversas' });
    return this.provedores.conversas(user.tenantId);
  }

  @Get('mensagens')
  @Roles('presidente', 'gerente', 'supervisao')
  mensagens(@CurrentUser() user: AuthUser, @Query('jids') jids?: string, @Query('jid') jid?: string) {
    if (ehServidorLocal()) return this.repassar(user, { metodo: 'GET', caminho: 'mensagens', query: { jids, jid } });
    return this.provedores.mensagens(user.tenantId, jids || jid || '');
  }

  // Enviado pelo atendente, o robô fica calado na conversa pelo tempo da loja (robo-pausa.ts).
  @Post('enviar')
  @Roles('presidente', 'gerente', 'supervisao')
  enviar(@CurrentUser() user: AuthUser, @Body() dto: { numero?: string; jid?: string; texto?: string }) {
    if (ehServidorLocal())
      return this.repassar(user, { metodo: 'POST', caminho: 'enviar', corpo: { numero: dto?.numero, jid: dto?.jid, texto: dto?.texto } });
    const numero = dto?.numero ?? (dto?.jid ?? '').split('@')[0];
    return this.provedores.enviar(user.tenantId, numero ?? '', dto?.texto ?? '', user.colaboradorId);
  }

  // Baixa a mídia de uma mensagem sob demanda (miniatura no inbox).
  @Get('midia')
  @Roles('presidente', 'gerente', 'supervisao')
  midia(
    @CurrentUser() user: AuthUser,
    @Query('id') id?: string,
    @Query('jid') jid?: string,
    @Query('fromMe') fromMe?: string,
  ) {
    if (ehServidorLocal()) return this.repassar(user, { metodo: 'GET', caminho: 'midia', query: { id, jid, fromMe } });
    return this.service.midia(user.tenantId, id ?? '', jid ?? '', fromMe === 'true');
  }

  // Cardápios ativos (para o inbox perguntar de qual, se houver mais de um).
  @Get('cardapios')
  @Roles('presidente', 'gerente', 'supervisao')
  cardapios(@CurrentUser() user: AuthUser) {
    if (ehServidorLocal()) return this.repassar(user, { metodo: 'GET', caminho: 'cardapios' });
    return this.service.listarCardapios(user.tenantId);
  }

  // Envia o cardápio em PDF para o número da conversa.
  @Post('enviar-cardapio')
  @Roles('presidente', 'gerente', 'supervisao')
  enviarCardapio(@CurrentUser() user: AuthUser, @Body() dto: { numero?: string; cardapioId?: string }) {
    if (ehServidorLocal())
      return this.repassar(user, {
        metodo: 'POST',
        caminho: 'enviar-cardapio',
        corpo: { numero: dto?.numero, cardapioId: dto?.cardapioId },
      });
    // Pela via da loja: Evolution ou API oficial (Bloco 6 — antes só a Evolution).
    return this.provedores.enviarCardapio(user.tenantId, dto?.numero ?? '', dto?.cardapioId);
  }

  // Pausa/retoma o robô só nesta conversa (o humano assume). `minutos`: por quanto tempo (0 = até alguém retomar;
  // ausente = o tempo da loja em robo-config).
  @Post('pausar-conversa')
  @Roles('presidente', 'gerente', 'supervisao')
  pausarConversa(@CurrentUser() user: AuthUser, @Body() dto: { numero?: string; pausar?: boolean; minutos?: number }) {
    const minutos = minutosDoPedido(dto?.minutos);
    if (ehServidorLocal())
      return this.repassar(user, {
        metodo: 'POST',
        caminho: 'pausar-conversa',
        corpo: { numero: dto?.numero, pausar: dto?.pausar, minutos: minutos ?? undefined },
      });
    return this.service.pausarConversa(user.tenantId, dto?.numero ?? '', dto?.pausar !== false, {
      minutos,
      por: user.colaboradorId,
    });
  }

  // Retenção do histórico de conversas da API oficial — lê/salva wa_retencao_dias da loja.
  @Get('historico-config')
  @Roles('presidente', 'gerente', 'supervisao')
  historicoConfig(@CurrentUser() user: AuthUser) {
    if (ehServidorLocal()) return this.repassar(user, { metodo: 'GET', caminho: 'historico-config' });
    return this.cloud.historicoConfig(user.tenantId);
  }

  @Post('historico-config')
  @Roles('presidente', 'gerente')
  salvarHistoricoConfig(@CurrentUser() user: AuthUser, @Body() dto: any) {
    if (ehServidorLocal())
      return this.repassar(user, { metodo: 'POST', caminho: 'historico-config', corpo: { retencaoDias: dto?.retencaoDias } });
    return this.cloud.salvarHistoricoConfig(user.tenantId, Number(dto?.retencaoDias) || 0);
  }

  // Por quanto tempo o robô fica calado depois que o humano assume (mig 342) — a caixa mostra nas opções de Pausar.
  @Get('robo-config')
  @Roles('presidente', 'gerente', 'supervisao')
  roboConfig(@CurrentUser() user: AuthUser) {
    if (ehServidorLocal()) return this.repassar(user, { metodo: 'GET', caminho: 'robo-config' });
    return this.provedores.roboConfig(user.tenantId);
  }
}
