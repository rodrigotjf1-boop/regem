import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissoesGuard } from '../../auth/permissoes.guard';
import { RequirePerm } from '../../auth/require-perm.decorator';
import { CurrentUser } from '../../auth/current-user.decorator';
import { AuthUser } from '../../auth/auth-user';
import { UnidadeAtual } from '../../auth/unidade-atual.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { ChegadaService } from './chegada.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O botão "Cheguei" do cliente (Onda 3, mig 354): página do pedido e Sua conta, no cardápio online — só na nuvem.
@Controller('publico/cardapio')
export class ChegadaPublicoController {
  constructor(private readonly chegada: ChegadaService) {}

  // Prova de dono: o `ref` do link do pedido ou o token do cliente (Sua conta). Corpo: { ref?, clienteToken?, onde?, obs? }.
  @Post(':token/pedido/:id/cheguei')
  @HttpCode(200)
  @CloudOnly()
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  cheguei(@Param('token') token: string, @Param('id') id: string, @Body() dto: any) {
    return this.chegada.porCardapio(token, id, dto);
  }
}

// O lado da LOJA: o aviso em qualquer tela (e o quadro "Clientes esperando") e a rota da nuvem que o servidor da loja
// chama para não esperar o sync.
@Controller('delivery')
export class ChegadaLojaController {
  constructor(private readonly chegada: ChegadaService) {}

  // As chegadas da loja em uso que ainda esperam o cliente, com o ajuste (desligado: lista vazia — a tela pergunta menos).
  // Mesma permissão da Retirada / Encomendas.
  @Get('retirada/chegadas')
  @UseGuards(JwtAuthGuard, PermissoesGuard)
  @RequirePerm('delivery')
  paraAsTelas(@CurrentUser() user: AuthUser, @UnidadeAtual() unidade: string | null) {
    return this.chegada.paraAsTelas(user.tenantId, unidade);
  }

  // O servidor da loja pede as chegadas das últimas horas (token do servidor; a empresa e a loja vêm do token). Só na
  // nuvem — no próprio servidor da loja a rota não responde.
  @Get('chegadas/loja')
  @CloudOnly()
  @UseGuards(SyncTokenGuard)
  paraOServidorDaLoja(@SyncCtx() ctx: SyncCtxData) {
    return this.chegada.paraOServidorDaLoja(ctx.tenantId, ctx.unidadeId ?? null);
  }
}
