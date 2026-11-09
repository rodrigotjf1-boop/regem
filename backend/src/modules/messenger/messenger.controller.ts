import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { assinaturaDoAvisoOk } from './messenger';
import { MessengerService } from './messenger.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS PORTAS PÚBLICAS DO MESSENGER (mig 386), só na nuvem: o desafio e o aviso de mensagem da Meta (o webhook do app da
// distribuição, `object: 'page'`), e a volta do login do Facebook.
@Controller()
@CloudOnly()
export class MessengerPublicoController {
  private readonly logger = new Logger('Messenger');
  constructor(private readonly service: MessengerService) {}

  // O desafio: a Meta chama ao salvar o endereço no painel e exige o hub.challenge cru no corpo.
  @Get('publico/messenger/webhook')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  verificar(@Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string): string {
    const esperado = String(process.env.FACEBOOK_VERIFY_TOKEN ?? '').trim();
    const a = Buffer.from(String(token ?? ''), 'utf8');
    const b = Buffer.from(esperado, 'utf8');
    if (!esperado || mode !== 'subscribe' || a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn(`Verificação do aviso do Messenger recusada (mode=${mode ?? '-'}).`);
      throw new UnauthorizedException('Verificação inválida.');
    }
    return String(challenge ?? '');
  }

  // O aviso de mensagem: assinatura (`X-Hub-Signature-256`) conferida sobre o corpo CRU com o segredo do app do Facebook;
  // responde 200 na hora e trata em seguida (a Meta tem prazo curto e reentrega o que não confirmamos — o `mid` não deixa
  // entrar duas vezes).
  @Post('publico/messenger/webhook')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 600 } })
  evento(@Req() req: any) {
    const segredo = String(process.env.FACEBOOK_APP_SECRET ?? '').trim();
    if (!assinaturaDoAvisoOk(req.rawBody, req.headers?.['x-hub-signature-256'], segredo)) {
      this.logger.warn('Aviso do Messenger com assinatura inválida — descartado.');
      throw new UnauthorizedException('Assinatura inválida.');
    }
    this.service.processar(req.body ?? {}).catch((e: any) => this.logger.error(`aviso do Messenger: ${e?.message ?? e}`));
    return { ok: true };
  }

  // A volta do login do Facebook: o navegador da pessoa chega aqui e volta para os ajustes, com a situação.
  @Get('publico/messenger/retorno')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async retorno(@Query() q: { code?: string; state?: string; error?: string }, @Res() res: Response) {
    res.redirect(302, await this.service.retorno(q ?? {}));
  }
}

// AS ROTAS DA TELA: o estado, conectar, a escolha da página e desconectar (gerente e presidente, só na nuvem — o login
// volta para ela); a conversa do caso (quem atende a fila) e a resposta (a gestão), que valem nas duas pontas (no servidor
// da loja, pela nuvem — V37).
@Controller('atendimento')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('pedidos')
export class MessengerController {
  constructor(private readonly service: MessengerService) {}

  @Get('messenger')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  estado(@CurrentUser() user: AuthUser) {
    return this.service.ajuste(user.tenantId);
  }

  @Post('messenger/conectar')
  @HttpCode(200)
  @CloudOnly()
  @Roles('presidente', 'gerente')
  conectar(@CurrentUser() user: AuthUser) {
    return this.service.conectar(user);
  }

  @Get('messenger/paginas')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  paginas(@CurrentUser() user: AuthUser) {
    return this.service.paginasDaEscolha(user);
  }

  @Post('messenger/escolher')
  @HttpCode(200)
  @CloudOnly()
  @Roles('presidente', 'gerente')
  escolher(@CurrentUser() user: AuthUser, @Body() dto: unknown) {
    return this.service.escolher(user, dto ?? {});
  }

  @Delete('messenger')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  desconectar(@CurrentUser() user: AuthUser) {
    return this.service.desconectar(user);
  }

  @Get(':id/messenger')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  conversa(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.conversa(user.tenantId, id);
  }

  @Post(':id/messenger')
  @HttpCode(200)
  @Roles('presidente', 'gerente', 'supervisao')
  responder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: unknown) {
    return this.service.responder(user, id, dto);
  }
}
