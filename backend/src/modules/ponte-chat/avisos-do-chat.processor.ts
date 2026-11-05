import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ehServidorLocal } from '../../common/modo';
import { AvisosDoChatService } from './avisos-do-chat.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A ROTINA dos avisos "saiu" e "obrigado" no chat do iFood e da 99 (ponte do chat, parte A2). Só na NUVEM, de 30 em 30 s:
 * a fila de saída e a ponte moram lá. Uma volta que falha não derruba a próxima; o motivo vai para o log.
 */
@Injectable()
export class AvisosDoChatProcessor {
  private readonly logger = new Logger('AvisosDoChat');
  private rodando = false;

  constructor(private readonly avisos: AvisosDoChatService) {}

  @Interval(30_000)
  async processar(): Promise<number> {
    if (ehServidorLocal() || this.rodando) return 0;
    this.rodando = true;
    try {
      return await this.avisos.enfileirarDaVolta();
    } catch (e: any) {
      this.logger.warn(`avisos do chat: a volta falhou — ${e?.message ?? e}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }
}
