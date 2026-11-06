import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ehServidorLocal } from '../../common/modo';
import { EstornoPixService } from './estorno-pix.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A ROTINA do estorno do Pix no cancelamento (mig 372). Só na NUVEM (o token do gateway mora lá), de minuto em minuto, uma
 * volta por vez. Uma volta que falha não derruba a próxima; o motivo vai para o log.
 */
@Injectable()
export class EstornoPixProcessor {
  private readonly logger = new Logger('EstornoPix');
  private rodando = false;

  constructor(private readonly estorno: EstornoPixService) {}

  @Interval(60_000)
  async processar(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      await this.estorno.volta();
    } catch (e: any) {
      this.logger.warn(`estorno do Pix: a volta falhou — ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }
}
