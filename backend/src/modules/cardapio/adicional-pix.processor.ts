import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ehServidorLocal } from '../../common/modo';
import { AdicionalPixService } from './adicional-pix.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A ROTINA do Pix do adicional (mig 373). Só na NUVEM (os gateways e o robô moram lá), de 30 em 30 s — o Pix vale 5 min,
 * e o pagamento confirmado tem de entrar logo (o pedido está em produção). Uma volta por vez; a que falha não derruba a
 * próxima, o motivo vai para o log.
 */
@Injectable()
export class AdicionalPixProcessor {
  private readonly logger = new Logger('AdicionalPix');
  private rodando = false;

  constructor(private readonly adicional: AdicionalPixService) {}

  @Interval(30_000)
  async processar(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      await this.adicional.volta();
    } catch (e: any) {
      this.logger.warn(`Pix do adicional: a volta falhou — ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }
}
