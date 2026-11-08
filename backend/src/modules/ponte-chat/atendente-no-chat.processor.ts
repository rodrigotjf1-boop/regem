import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ehServidorLocal } from '../../common/modo';
import { PonteChatService } from './ponte-chat.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A ROTINA "o atendente virtual não respondeu" no chat do iFood e da 99 (F5 do atendente virtual, mig 383 — V88). Só na
 * NUVEM, a cada minuto: a fala do cliente entregue ao atendente há mais de 2 min, sem resposta e sem caso, vira caso
 * (`atendente-no-chat.ts` › `semRespostaDoAtendente`). Uma volta de cada vez; a que falha não derruba a próxima.
 */
@Injectable()
export class AtendenteNoChatProcessor {
  private readonly logger = new Logger('AtendenteNoChat');
  private rodando = false;

  constructor(private readonly ponte: PonteChatService) {}

  @Interval(60_000)
  async processar(): Promise<number> {
    if (ehServidorLocal() || this.rodando) return 0;
    this.rodando = true;
    try {
      return await this.ponte.semRespostaDoAtendente();
    } catch (e: any) {
      this.logger.warn(`atendente virtual no chat: a volta falhou — ${e?.message ?? e}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }
}
