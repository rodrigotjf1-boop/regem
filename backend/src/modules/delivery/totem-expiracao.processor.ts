import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { ehServidorLocal } from '../../common/modo';
import { DeliveryService } from './delivery.service';

/**
 * R4 — encerra pedido de totem que ficou esperando pagamento eletrônico e não voltou.
 *
 * O cliente que desiste no meio do pagamento simplesmente vai embora: ninguém cancela
 * nada. Sem isto, o pedido fica para sempre no painel da loja como "aguardando".
 * Cinco minutos contados da criação — que é exatamente quando o pagamento começou.
 * Dinheiro NÃO expira: ali o cliente está indo até o caixa e a fila pode demorar mais.
 */
export const MINUTOS_PARA_EXPIRAR = 5;

@Injectable()
export class TotemExpiracaoProcessor {
  private readonly logger = new Logger('TotemExpiracao');
  private rodando = false;

  constructor(private readonly delivery: DeliveryService) {}

  @Interval(60_000)
  async processar() {
    // SÓ no servidor da loja — é lá que o pedido retido nasce e é liberado. `pedido_externo`
    // sincroniza nos dois sentidos (LWW por `updated_at`): se a NUVEM também rodasse isto, ela
    // cancelaria um pedido que a loja acabou de liberar e o sync ainda não levou — e, por ser
    // a escrita mais nova, o cancelamento venceria e desceria sobre uma venda PAGA.
    if (!ehServidorLocal()) return;
    if (this.rodando) return;
    this.rodando = true;
    try {
      await this.delivery.expirarRetidosTotem(MINUTOS_PARA_EXPIRAR);
    } catch (e: any) {
      this.logger.warn(`falha ao expirar retidos: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }
}
