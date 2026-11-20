import { Body, Controller, Inject, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { registrarInteracoes } from './interacoes-do-cardapio';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Os cliques do cardápio (F4 do plano do perfil do cliente, mig 466): a porta PÚBLICA do cardápio (o token da loja), em
// lotes, limitada por endereço. Só nuvem (o cardápio online mora lá). Responde sempre `{ ok: true }` — a tela não espera
// nada, e a resposta não diz de fora se a loja tem o módulo ligado.
@Controller('publico/cardapio')
@CloudOnly()
export class InteracoesDoCardapioController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  @Post(':token/interacoes')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  async registrar(@Param('token') token: string, @Body() dto: any) {
    await registrarInteracoes(this.db, token, dto);
    return { ok: true };
  }
}
