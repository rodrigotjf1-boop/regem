import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { expurgarEnvios } from './pedido-envio';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Por quanto tempo o registro dos envios do pedido fica guardado. */
export const DIAS_GUARDA_ENVIOS = 90;

/**
 * Expurgo diário do registro dos envios (mig 305). Roda na NUVEM e no SERVIDOR DA LOJA: a tabela
 * não sincroniza, cada máquina limpa o próprio diário. Um `delete` em lote por data; com duas
 * réplicas rodando ao mesmo tempo, a segunda só não acha nada. Nunca lança.
 */
@Injectable()
export class PedidoEnvioProcessor {
  private readonly logger = new Logger('PedidoEnvio');

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  @Cron('20 4 * * *') // 04:20 todos os dias
  async expurgar(dias = DIAS_GUARDA_ENVIOS): Promise<number> {
    try {
      const n = await expurgarEnvios(this.db, dias);
      if (n) this.logger.log(`registro de envios: ${n} linha(s) com mais de ${dias} dias apagada(s)`);
      return n;
    } catch (e: any) {
      if (e?.code !== '42P01') this.logger.warn(`expurgo do registro de envios não rodou: ${e?.message ?? e}`);
      return 0;
    }
  }
}
