import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { VendasService } from './vendas.service';

/**
 * S3 — Materializador de IMPRESSÃO no EDGE (sync espelhado + modos).
 *
 * Vendas registradas no MODO NUVEM (presidente) descem pelo sync (comanda + itens),
 * mas a impressora do caixa é LOCAL: a nuvem não a alcança. Aqui, no edge, pegamos as
 * comandas de PDV fechadas que desceram e ainda não imprimiram localmente e enfileiramos
 * o cupom na impressora de cupom LOCAL (via VendasService.materializarImpressaoLocal).
 *
 * Só roda no edge (EDGE_MODE). Idempotente:
 *  - ignora comandas que já têm `impressao_job` (a venda local já imprimiu no registro);
 *  - marca cada comanda processada em `impressao_edge_feito` (não reprocessa em loop);
 *  - piso de 45s desde a criação: dá tempo do enfileiramento PÓS-transação da venda
 *    local acontecer, então nunca reimprime a própria venda do edge;
 *  - exclui pedidos externos/delivery (o EdgePedidosProcessor já materializa esses).
 */
@Injectable()
export class EdgeImpressaoProcessor {
  private readonly logger = new Logger('EdgeImpressao');
  private rodando = false;
  private readonly isEdge = String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';
  // F2 (roteamento por loja): setada → só imprime as comandas DESTA unidade. Vazia → tenant-wide.
  private readonly unidadeId = (process.env.EDGE_UNIDADE_ID || '').trim() || null;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly vendas: VendasService,
  ) {}

  @Interval(12000)
  async processar() {
    if (!this.isEdge || this.rodando) return;
    this.rodando = true;
    try {
      const r: any = await this.db.execute(sql`
        select c.id, c.tenant_id as "tenantId", c.created_at as "createdAt"
        from comanda c
        where c.status = 'fechada'
          ${this.unidadeId ? sql`and c.unidade_id = ${this.unidadeId}` : sql``}
          and c.created_at > now() - interval '12 hours'
          and c.created_at < now() - interval '45 seconds'
          and not exists (select 1 from impressao_edge_feito f where f.comanda_id = c.id)
          and not exists (select 1 from impressao_job j where j.comanda_id = c.id)
          and not exists (select 1 from pedido_externo pe where pe.comanda_id = c.id)
        order by c.created_at asc
        limit 50
      `);
      const pendentes = r.rows ?? r;
      const GRACA_MIN = 20; // sem impressora: reprocessa por até 20 min (dá tempo de configurar)
      for (const c of pendentes) {
        let enfileirados = 0;
        let erro = false;
        try {
          const res = await this.vendas.materializarImpressaoLocal(c.tenantId, c.id);
          enfileirados = res.enfileirados;
          if (enfileirados > 0)
            this.logger.log(`cupom da venda ${c.id} materializado no edge (${enfileirados} via[s])`);
        } catch (e: any) {
          erro = true; // falha real (transitória) → NÃO marca feito; tenta de novo no próximo ciclo
          this.logger.warn(`falha ao materializar ${c.id}: ${e?.message ?? e}`);
        }
        // P2 — só marca 'feito' quando REALMENTE enfileirou; senão o cupom se perdia por falta
        // de impressora (configurar depois nunca reimprimia). Sem impressora: deixa reprocessar
        // até configurarem uma; passada a graça, desiste + avisa (não fica em loop pra sempre).
        const idadeMin = (Date.now() - new Date(c.createdAt).getTime()) / 60000;
        if (enfileirados > 0 || (!erro && enfileirados === 0 && idadeMin > GRACA_MIN)) {
          await this.db
            .execute(sql`insert into impressao_edge_feito (comanda_id) values (${c.id}) on conflict do nothing`)
            .catch(() => {});
          if (enfileirados === 0)
            this.logger.warn(`comanda ${c.id}: cupom NAO impresso — sem impressora de cupom (desisti apos ${GRACA_MIN}min)`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`ciclo falhou: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }
}
