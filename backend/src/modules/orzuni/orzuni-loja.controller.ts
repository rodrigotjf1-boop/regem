import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from '@nestjs/common';
import { CloudOnly } from '../../common/cloud-only.decorator';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { SyncCtx, SyncCtxData, SyncTokenGuard } from '../sync/sync-token.guard';
import { ehAlvoIfood, ehIdDoAlvo, enviosDoAlvo } from './envios-do-alvo';

/**
 * O servidor da loja pedindo à NUVEM o "último envio ao iFood" de um produto ou opção (R2b; V37): a fila do envio só
 * existe aqui. Token de sync do servidor; a nuvem responde pela empresa do TOKEN (quem chama confere que é a mesma
 * do usuário da tela). Só leitura, só os envios daquele item.
 */
@Controller('orzuni/loja')
@CloudOnly()
@UseGuards(SyncTokenGuard)
export class OrzuniLojaController {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  @Get('envios')
  async envios(@SyncCtx() ctx: SyncCtxData, @Query('alvo') alvo: string, @Query('ref') ref: string) {
    if (!ehAlvoIfood(alvo) || !ehIdDoAlvo(ref)) throw new BadRequestException('Informe o item (alvo e ref).');
    return { tenantId: ctx.tenantId, envios: await enviosDoAlvo(this.db, ctx.tenantId, alvo, ref) };
  }
}
