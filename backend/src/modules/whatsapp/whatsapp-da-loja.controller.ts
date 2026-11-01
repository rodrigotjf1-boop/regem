import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Injectable,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { WhatsappService } from './whatsapp.service';
import { WhatsappProvedorService } from './whatsapp-provedor.service';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { minutosDoPedido } from './whatsapp.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Quem está usando a caixa no servidor da loja (o colaborador logado lá) — só para registrar quem pausou/respondeu. */
export const CABECALHO_USUARIO_DA_LOJA = 'x-regem-usuario';
/** A empresa do colaborador logado no servidor da loja: tem de ser a do TOKEN do servidor. */
export const CABECALHO_EMPRESA_DA_LOJA = 'x-regem-empresa';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const usuario = (v: unknown) => (UUID.test(String(v ?? '')) ? String(v) : null);

/**
 * Servidor reaproveitado de outra loja (o token é de uma empresa, o colaborador logado de outra): recusa — a caixa
 * mostraria as conversas de uma empresa a quem é de outra. Mesma trava da fila dos entregadores.
 */
export function conferirEmpresaDaLoja(ctx: SyncCtxData | undefined, empresa: unknown): void {
  const e = Array.isArray(empresa) ? empresa[0] : empresa;
  if (!ctx?.tenantId || String(e ?? '') !== ctx.tenantId)
    throw new ForbiddenException('Este servidor da loja está ligado a outra empresa — a caixa de conversas não abre aqui.');
}

/** Roda DEPOIS do SyncTokenGuard (que põe `req.sync`). */
@Injectable()
export class EmpresaDaLojaGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    conferirEmpresaDaLoja(req.sync, req.headers?.[CABECALHO_EMPRESA_DA_LOJA]);
    return true;
  }
}

// A CAIXA DE CONVERSAS DO WHATSAPP pedida pelo SERVIDOR DA LOJA (Fase 1 do robô, 29/10/2026).
//
// O WhatsApp (Evolution, API oficial, histórico, robô) só existe na nuvem. No servidor da loja, a tela Delivery ›
// WhatsApp chama as MESMAS rotas de sempre; o servidor confere o login e a permissão do colaborador lá e repassa para
// cá (módulo whatsapp-loja). Autenticação pelo token do servidor (x-sync-token) — a empresa vem do TOKEN, nunca do
// corpo, e tem de ser a do colaborador logado (EmpresaDaLojaGuard); a credencial de integrador (GoGeM) não passa
// (conferirRotaDoIntegrador). Só na nuvem.
@Controller('whatsapp/da-loja')
@CloudOnly()
@UseGuards(SyncTokenGuard, EmpresaDaLojaGuard)
export class WhatsappDaLojaController {
  constructor(
    private readonly service: WhatsappService,
    private readonly provedores: WhatsappProvedorService,
    private readonly cloud: WhatsappCloudService,
  ) {}

  @Get('status')
  status(@SyncCtx() ctx: SyncCtxData) {
    return this.service.status(ctx.tenantId);
  }

  @Get('conversas')
  conversas(@SyncCtx() ctx: SyncCtxData) {
    return this.provedores.conversas(ctx.tenantId);
  }

  @Get('mensagens')
  mensagens(@SyncCtx() ctx: SyncCtxData, @Query('jids') jids: string, @Query('jid') jid: string) {
    return this.provedores.mensagens(ctx.tenantId, jids || jid || '');
  }

  @Post('enviar')
  @HttpCode(201)
  enviar(
    @SyncCtx() ctx: SyncCtxData,
    @Body() dto: { numero?: string; jid?: string; texto?: string },
    @Headers(CABECALHO_USUARIO_DA_LOJA) quem?: string,
  ) {
    const numero = dto?.numero ?? (dto?.jid ?? '').split('@')[0];
    return this.provedores.enviar(ctx.tenantId, numero ?? '', dto?.texto ?? '', usuario(quem));
  }

  @Get('midia')
  midia(
    @SyncCtx() ctx: SyncCtxData,
    @Query('id') id: string,
    @Query('jid') jid: string,
    @Query('fromMe') fromMe: string,
  ) {
    return this.service.midia(ctx.tenantId, id ?? '', jid ?? '', fromMe === 'true');
  }

  @Get('cardapios')
  cardapios(@SyncCtx() ctx: SyncCtxData) {
    return this.service.listarCardapios(ctx.tenantId);
  }

  @Post('enviar-cardapio')
  @HttpCode(201)
  enviarCardapio(@SyncCtx() ctx: SyncCtxData, @Body() dto: { numero?: string; cardapioId?: string }) {
    return this.provedores.enviarCardapio(ctx.tenantId, dto?.numero ?? '', dto?.cardapioId);
  }

  @Post('pausar-conversa')
  @HttpCode(201)
  pausarConversa(
    @SyncCtx() ctx: SyncCtxData,
    @Body() dto: { numero?: string; pausar?: boolean; minutos?: number },
    @Headers(CABECALHO_USUARIO_DA_LOJA) quem?: string,
  ) {
    return this.service.pausarConversa(ctx.tenantId, dto?.numero ?? '', dto?.pausar !== false, {
      minutos: minutosDoPedido(dto?.minutos),
      por: usuario(quem),
    });
  }

  @Get('historico-config')
  historicoConfig(@SyncCtx() ctx: SyncCtxData) {
    return this.cloud.historicoConfig(ctx.tenantId);
  }

  @Post('historico-config')
  @HttpCode(201)
  salvarHistoricoConfig(@SyncCtx() ctx: SyncCtxData, @Body() dto: any) {
    return this.cloud.salvarHistoricoConfig(ctx.tenantId, Number(dto?.retencaoDias) || 0);
  }

  @Get('robo-config')
  roboConfig(@SyncCtx() ctx: SyncCtxData) {
    return this.provedores.roboConfig(ctx.tenantId);
  }
}
