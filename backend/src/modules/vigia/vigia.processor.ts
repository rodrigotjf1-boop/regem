import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ehServidorLocal } from '../../common/modo';
import { VigiaService, vigiaLigado } from './vigia.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A ROTINA do vigia do servidor da loja (mig 414). Só na NUVEM (é ela que recebe o sinal de todos os servidores; o
 * servidor da loja nem tem a tabela), de minuto em minuto — o mesmo passo da batida —, uma volta por vez. Nasce
 * DESLIGADA (`VIGIA_LIGADO`). Uma volta que falha não derruba a próxima; o motivo vai para o log.
 */
@Injectable()
export class VigiaProcessor {
  private readonly logger = new Logger('Vigia');
  private rodando = false;

  constructor(private readonly vigia: VigiaService) {}

  @Interval(60_000)
  async processar(): Promise<void> {
    if (ehServidorLocal() || !vigiaLigado() || this.rodando) return;
    this.rodando = true;
    try {
      await this.vigia.volta();
    } catch (e: any) {
      this.logger.warn(`vigia: a volta falhou — ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }
}
