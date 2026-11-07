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
import { assinaturaDoAvisoOk } from './instagram';
import { InstagramService } from './instagram.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Os segredos que podem assinar o aviso: o do Instagram (o padrão) e o do app da Meta — os dois são da distribuição. */
function segredosDoAviso(): string[] {
  return [process.env.INSTAGRAM_WEBHOOK_SECRET, process.env.INSTAGRAM_APP_SECRET, process.env.WA_CLOUD_APP_SECRET]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean);
}

// AS PORTAS PÚBLICAS DO INSTAGRAM (mig 377), só na nuvem: o desafio e o aviso de mensagem da Meta, e a volta do login.
@Controller()
@CloudOnly()
export class InstagramPublicoController {
  private readonly logger = new Logger('Instagram');
  constructor(private readonly service: InstagramService) {}

  // O desafio: a Meta chama ao salvar o endereço no painel e exige o hub.challenge cru no corpo.
  @Get('publico/instagram/webhook')
  @Throttle({ default: { ttl: 60000, limit: 60 } })
  verificar(@Query('hub.mode') mode?: string, @Query('hub.verify_token') token?: string, @Query('hub.challenge') challenge?: string): string {
    const esperado = String(process.env.INSTAGRAM_VERIFY_TOKEN ?? '');
    const a = Buffer.from(String(token ?? ''), 'utf8');
    const b = Buffer.from(esperado, 'utf8');
    if (!esperado || mode !== 'subscribe' || a.length !== b.length || !timingSafeEqual(a, b)) {
      this.logger.warn(`Verificação do aviso do Instagram recusada (mode=${mode ?? '-'}).`);
      throw new UnauthorizedException('Verificação inválida.');
    }
    return String(challenge ?? '');
  }

  // O aviso de mensagem: assinatura conferida sobre o corpo CRU; responde 200 na hora e trata em seguida (a Meta tem
  // prazo curto e reentrega o que não confirmamos — o `mid` não deixa entrar duas vezes).
  @Post('publico/instagram/webhook')
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 600 } })
  evento(@Req() req: any) {
    if (!segredosDoAviso().some((s) => assinaturaDoAvisoOk(req.rawBody, req.headers?.['x-hub-signature-256'], s))) {
      this.logger.warn('Aviso do Instagram com assinatura inválida — descartado.');
      throw new UnauthorizedException('Assinatura inválida.');
    }
    this.service.processar(req.body ?? {}).catch((e: any) => this.logger.error(`aviso do Instagram: ${e?.message ?? e}`));
    return { ok: true };
  }

  // A volta do login do Instagram: o navegador da pessoa chega aqui e volta para os ajustes, com a situação.
  @Get('publico/instagram/retorno')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async retorno(@Query() q: { code?: string; state?: string; error?: string }, @Res() res: Response) {
    res.redirect(302, await this.service.retorno(q ?? {}));
  }
}

// AS ROTAS DA TELA: conectar, desconectar e o estado (gerente e presidente, só na nuvem — o login volta para ela); a
// conversa do caso (quem atende a fila) e a resposta (a gestão), que valem nas duas pontas (no servidor da loja, pela
// nuvem — V37).
@Controller('atendimento')
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('pedidos')
export class InstagramController {
  constructor(private readonly service: InstagramService) {}

  @Get('instagram')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  estado(@CurrentUser() user: AuthUser) {
    return this.service.ajuste(user.tenantId);
  }

  @Post('instagram/conectar')
  @HttpCode(200)
  @CloudOnly()
  @Roles('presidente', 'gerente')
  conectar(@CurrentUser() user: AuthUser) {
    return this.service.conectar(user);
  }

  @Delete('instagram')
  @CloudOnly()
  @Roles('presidente', 'gerente')
  desconectar(@CurrentUser() user: AuthUser) {
    return this.service.desconectar(user);
  }

  @Get(':id/instagram')
  @Roles('presidente', 'gerente', 'supervisao', 'execucao')
  conversa(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.conversa(user.tenantId, id);
  }

  @Post(':id/instagram')
  @HttpCode(200)
  @Roles('presidente', 'gerente', 'supervisao')
  responder(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: unknown) {
    return this.service.responder(user, id, dto);
  }
}
