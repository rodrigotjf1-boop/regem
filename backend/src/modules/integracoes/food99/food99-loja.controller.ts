import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { CloudOnly } from '../../../common/cloud-only.decorator';
import { DRIZZLE, DrizzleDB } from '../../../db/drizzle.module';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../../sync/sync-token.guard';
import { ehIdDoProduto99, enviosDa99 } from './food99-envios';

/**
 * O servidor da loja pedindo à NUVEM o "último envio à 99" de um produto (R3 F2; V37): a fila do envio só existe aqui.
 * Token de sync do servidor (o `SyncTokenGuard` vem do `EquipamentoModule`, V81); a nuvem responde pela empresa do
 * TOKEN (quem chama confere que é a mesma do usuário da tela). Só leitura, só os envios daquele produto.
 */
@Controller('food99/loja')
@CloudOnly()
@UseGuards(SyncTokenGuard)
export class Food99LojaController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  @Get('envios')
  async envios(@SyncCtx() ctx: SyncCtxData, @Query('ref') ref: string) {
    if (!ehIdDoProduto99(ref)) throw new BadRequestException('Informe o produto (ref).');
    return { tenantId: ctx.tenantId, envios: await enviosDa99(this.db, ctx.tenantId, ref) };
  }
}
