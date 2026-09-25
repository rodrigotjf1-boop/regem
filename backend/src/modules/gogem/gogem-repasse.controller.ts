import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { GogemAvisoService } from './gogem-aviso.service';

/**
 * O servidor da LOJA não fala com o GoGeM: o token da integração não mora lá (credencial de
 * integração é da distribuição), e o GoGeM recusa qualquer outro (ERR-108). Ele repassa o aviso de
 * cancelamento para cá, com o token de sync dele; a nuvem grava na fila dela e envia ao GoGeM com o
 * token que o GoGeM marcou. Idempotente pelo id do aviso da loja e pela chave da venda.
 */
@CloudOnly()
@Controller('gogem')
export class GogemRepasseController {
  constructor(private readonly avisos: GogemAvisoService) {}

  @Post('avisos/pedido-cancelado')
  @HttpCode(200)
  @UseGuards(SyncTokenGuard)
  pedidoCancelado(@SyncCtx() sync: SyncCtxData, @Body() repasse: any) {
    return this.avisos.receberDaLoja(sync, repasse);
  }
}
