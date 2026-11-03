import { Body, Controller, Get, Param, Post, Put, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { RolesGuard } from '../../auth/roles.guard';
import { Roles } from '../../auth/roles.decorator';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { lerAjustes } from './relacionamento';
import { RelacionamentoService } from './relacionamento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Delivery › Marketing › Automáticas (Onda 3 · PR 2, mig 356). Só NUVEM e só gestão (dado de cliente é pessoal), como as
// campanhas: gerente e presidente com a permissão de delivery (conferido aqui, não na tela).
@Controller('marketing/automaticas')
@CloudOnly()
@UseGuards(JwtAuthGuard, RolesGuard, PermissoesGuard)
@RequirePerm('delivery')
@Roles('presidente', 'gerente')
export class RelacionamentoController {
  constructor(private readonly service: RelacionamentoService) {}

  @Get()
  painel(@CurrentUser() user: AuthUser) {
    return this.service.painel(user.tenantId);
  }

  /** Grava só o que veio e mudou; confere tudo antes de gravar qualquer coisa. Devolve o painel de novo. */
  @Put()
  async salvar(@CurrentUser() user: AuthUser, @Body() dto: any) {
    lerAjustes(dto);
    await this.service.salvar(user, dto);
    return this.service.painel(user.tenantId);
  }

  /** "Enviar à Meta" o modelo de uma automática (API oficial). */
  @Post('modelo/:tipo')
  async enviarModelo(@CurrentUser() user: AuthUser, @Param('tipo') tipo: string) {
    await this.service.enviarModelo(user, tipo);
    return this.service.painel(user.tenantId);
  }
}

// O botão "Ver meu saldo" (e o link do QR): público, é o cliente tocando. Marca o clique e leva a Sua conta › Benefícios
// do cardápio da loja.
@Controller('publico/relacionamento')
@CloudOnly()
export class RelacionamentoPublicoController {
  constructor(private readonly service: RelacionamentoService) {}

  @Get('r/:id')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  async redirect(@Param('id') id: string, @Res() res: Response) {
    let url = 'https://app.dmsregem.com';
    try {
      url = await this.service.destinoDoClique(id);
    } catch {
      /* segue para o app */
    }
    res.redirect(302, url);
  }
}
