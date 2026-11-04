import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ehServidorLocal } from '../../common/modo';
import { AtendimentoService } from './atendimento.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * "ENDEREÇO ATUALIZADO!" AO CLIENTE (PR 3b-2 do pedido alterado). Só na NUVEM (o WhatsApp mora lá): a mudança de endereço
 * que a equipe fez pelo caso urgente, com o pedido já na rua, vale na hora (nuvem) ou quando o servidor da loja aplica (a
 * decisão sobe pelo sincronismo); esta rotina manda a mensagem ao cliente uma vez (`AtendimentoService.avisarEnderecosMudados`).
 * De 20 em 20 segundos; uma volta de cada vez nesta réplica (a marca antes do envio cuida das outras réplicas).
 */
@Injectable()
export class AvisoDoEnderecoProcessor {
  private readonly logger = new Logger('AvisoDoEndereco');
  private rodando = false;

  constructor(private readonly atendimento: AtendimentoService) {}

  @Interval(20_000)
  async processar(): Promise<number> {
    if (ehServidorLocal() || this.rodando) return 0;
    this.rodando = true;
    try {
      return await this.atendimento.avisarEnderecosMudados();
    } catch (e: any) {
      this.logger.warn(`aviso do endereço mudado: a volta falhou — ${e?.message ?? e}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }
}
