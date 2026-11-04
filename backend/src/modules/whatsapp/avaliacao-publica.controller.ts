import { Controller, Get, Param, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { PedirAvaliacaoProcessor } from './pedir-avaliacao.processor';

// O LINK DO PEDIDO DE AVALIAÇÃO (mig 365): o cliente toca, o Regem anota "tocou" (o "ainda não avaliou" da regra do dono =
// ainda não tocou — o Google não conta quem avaliou) e leva ao link de avaliação da loja no Google. Sem login (é o link
// da mensagem); o id é o da linha de `avaliacao_pedida` (não dá para adivinhar). Id que não vale: o app do Regem, como o
// link da campanha. Só na nuvem.
@Controller('publico/avaliacao')
@CloudOnly()
export class AvaliacaoPublicaController {
  constructor(private readonly avaliacao: PedirAvaliacaoProcessor) {}

  @Get(':id')
  @Throttle({ default: { ttl: 60000, limit: 120 } })
  async redirecionar(@Param('id') id: string, @Res() res: Response) {
    let url = 'https://app.dmsregem.com';
    try {
      url = (await this.avaliacao.destinoDoToque(id)) ?? url;
    } catch {
      /* segue para o app */
    }
    res.redirect(302, url);
  }
}
