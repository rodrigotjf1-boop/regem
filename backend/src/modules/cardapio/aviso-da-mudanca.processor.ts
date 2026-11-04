import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ehServidorLocal } from '../../common/modo';
import { RoboPedidoService } from './robo-pedido.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A DECISÃO DA LOJA SOBRE A MUDANÇA PEDIDA PELO ROBÔ (PR 3 do pedido alterado). Só na NUVEM (o robô e o carrinho só
 * existem lá): a mudança que o cliente confirmou numa loja com servidor ligado vai como "pedida"; quando o servidor da
 * loja aplica ou recusa, a decisão sobe pelo sincronismo e esta rotina avisa o cliente na conversa — ou, passada a
 * validade sem resposta, avisa e chama a equipe (`RoboPedidoService.avisarDecisoesDasMudancas`). De 20 em 20 segundos;
 * uma volta de cada vez nesta réplica (a marca "avisada" antes do envio cuida das outras réplicas).
 */
@Injectable()
export class AvisoDaMudancaProcessor {
  private readonly logger = new Logger('AvisoDaMudanca');
  private rodando = false;

  constructor(private readonly robo: RoboPedidoService) {}

  @Interval(20_000)
  async processar(): Promise<number> {
    if (ehServidorLocal() || this.rodando) return 0;
    this.rodando = true;
    try {
      return await this.robo.avisarDecisoesDasMudancas();
    } catch (e: any) {
      this.logger.warn(`aviso da decisão da mudança: a volta falhou — ${e?.message ?? e}`);
      return 0;
    } finally {
      this.rodando = false;
    }
  }
}
