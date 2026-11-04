import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { pedidoAlteracao } from '../../db/schema';
import { DeliveryService } from './delivery.service';

/**
 * PEDIDO ALTERADO na tela da NUVEM (ou pelo robô) de uma loja com servidor ligado (mig 362, V53): a nuvem grava a alteração
 * como "pedida" e a manda por dois caminhos — o comando `alterar_pedido` (o sync-daemon grava a linha aqui) e o próprio
 * sincronismo. Aqui, no servidor da loja, a pedida é APLICADA pelo mesmo `alterar` da equipe (a cozinha, as vias e o
 * histórico saem DESTE servidor) ou RECUSADA com o motivo — e só este servidor decide. A decisão sobe pelo sincronismo.
 *
 * Idempotente: a pedida decidida sai da lista; o sincronismo não a faz voltar a "pedida" (`condicaoSobrescrever`).
 * Só roda no servidor da loja — na nuvem o EDGE_MODE é falso e o intervalo retorna cedo.
 */
@Injectable()
export class EdgeAlteracoesProcessor {
  private readonly logger = new Logger('EdgeAlteracoes');
  private rodando = false;
  private readonly isEdge = String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';
  // A loja DESTE servidor: só as alterações dela (o servidor da matriz nunca altera o pedido da filial).
  private readonly unidadeId = (process.env.EDGE_UNIDADE_ID || '').trim() || null;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly delivery: DeliveryService,
  ) {}

  @Interval(5000)
  async processar(): Promise<number> {
    if (!this.isEdge || this.rodando) return 0;
    this.rodando = true;
    let aplicadas = 0;
    try {
      const conds = [eq(pedidoAlteracao.situacao, 'pedida')];
      if (this.unidadeId) conds.push(or(eq(pedidoAlteracao.unidadeId, this.unidadeId), isNull(pedidoAlteracao.unidadeId))!);
      const pedidas = await this.db
        .select()
        .from(pedidoAlteracao)
        .where(and(...conds))
        .orderBy(asc(pedidoAlteracao.createdAt))
        .limit(10);
      // Uma de cada vez, na ordem em que foram pedidas (a segunda mudança no mesmo pedido vê a primeira).
      for (const a of pedidas) {
        const r = await this.delivery.aplicarAlteracaoPedida(a);
        if (r.aplicada) aplicadas++;
      }
    } catch (e: any) {
      this.logger.warn(`ciclo falhou: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
    return aplicadas;
  }
}
