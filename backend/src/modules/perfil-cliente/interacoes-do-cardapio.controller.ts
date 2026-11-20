import { Body, Controller, Get, Inject, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { registrarInteracoes } from './interacoes-do-cardapio';
import { paraOCliente } from './para-o-cliente';

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

  /**
   * O cardápio para o cliente identificado (F8): "seu de sempre", "você viu" e a ordem das categorias — só ids de produto
   * e de categoria, só com a prova (`ct` = o `clienteToken` do código do WhatsApp, como o "Peça de novo"). Sem prova,
   * com o módulo desligado ou "não analisar": tudo vazio (a resposta não diz de fora por quê).
   */
  @Get(':token/para-voce')
  @Throttle({ default: { ttl: 60000, limit: 30 } })
  paraVoce(@Param('token') token: string, @Query('ct') ct?: string) {
    return paraOCliente(this.db, token, ct);
  }
}
