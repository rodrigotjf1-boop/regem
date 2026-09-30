import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql, SQL } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { ehServidorLocal } from '../../common/modo';
import { EXPURGO_CLIQUE_DIAS } from './origem-pedido';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Linhas por instrução (cada uma é uma transação curta) e teto de instruções por passada. */
const LOTE = 5000;
const MAX_LOTES = 50;

export type EscopoOrigem = { tenantIds?: string[] };

// Retenção da ORIGEM DO PEDIDO (mig 299). Job SÓ DA NUVEM, 1×/dia:
//   • apaga os códigos de clique (gclid, gbraid, wbraid, fbclid) dos pedidos com mais de 90 dias
//     — UTM e ids de campanha ficam com o pedido. É UPDATE: o gatilho da 299 só olha INSERÇÃO,
//     então a venda NÃO ganha versão nova (decisão do dono); a leitura da API já sai sem eles;
//   • remove a origem de pedido que não existe mais (a tabela não tem FK, de propósito).
// Em conjunto, em lotes com `skip locked` (duas réplicas não pegam a mesma linha). Os métodos
// aceitam `{ tenantIds }` para os testes rodarem só nas empresas deles (V32).
@Injectable()
export class OrigemPedidoService {
  private readonly log = new Logger('OrigemPedido');

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private escopo(e?: EscopoOrigem): SQL {
    if (!e?.tenantIds) return sql``;
    if (!e.tenantIds.length) return sql`and false`;
    return sql`and po.tenant_id in (${sql.join(
      e.tenantIds.map((t) => sql`${t}::uuid`),
      sql`, `,
    )})`;
  }

  private async emLotes(q: () => SQL): Promise<number> {
    let total = 0;
    for (let i = 0; i < MAX_LOTES; i++) {
      const r: any = await this.db.execute(q());
      const n = (r?.rows ?? r ?? []).length;
      total += n;
      if (n < LOTE) break;
    }
    return total;
  }

  // 04:40 de Brasília, depois da reconciliação da integração (04:30). O módulo nem sobe no
  // servidor da loja (V1), e o job se guarda sozinho mesmo assim.
  @Cron('0 40 4 * * *', { timeZone: 'America/Sao_Paulo' })
  async expurgoDiario(): Promise<void> {
    if (ehServidorLocal()) return;
    try {
      const r = await this.expurgar();
      if (r.cliques || r.orfas) this.log.log(`origem dos pedidos: ${r.cliques} com código de clique apagado, ${r.orfas} sem pedido removida(s)`);
    } catch (e: any) {
      this.log.error(`expurgo da origem dos pedidos falhou: ${e?.code ? `[${e.code}] ` : ''}${e?.message ?? e}`, e?.stack);
    }
  }

  async expurgar(e?: EscopoOrigem, dias = EXPURGO_CLIQUE_DIAS): Promise<{ cliques: number; orfas: number }> {
    const cliques = await this.emLotes(
      () => sql`
        with alvo as materialized (
          select po.pedido_id from pedido_origem po
           where po.ids_expurgados_em is null
             and po.criado_em < now() - make_interval(days => ${dias})
             ${this.escopo(e)}
           order by po.criado_em
           limit ${LOTE}
           for update skip locked
        )
        update pedido_origem po
           set gclid = null, gbraid = null, wbraid = null, fbclid = null, ids_expurgados_em = now()
          from alvo
         where po.pedido_id = alvo.pedido_id
        returning po.pedido_id`,
    );
    // Um dia de folga: a origem é gravada logo DEPOIS do pedido, fora da transação dele.
    const orfas = await this.emLotes(
      () => sql`
        with alvo as materialized (
          select po.pedido_id from pedido_origem po
           where po.criado_em < now() - interval '1 day'
             and not exists (select 1 from pedido_externo pe where pe.id = po.pedido_id)
             ${this.escopo(e)}
           limit ${LOTE}
           for update skip locked
        )
        delete from pedido_origem po
         using alvo
         where po.pedido_id = alvo.pedido_id
        returning po.pedido_id`,
    );
    return { cliques, orfas };
  }
}
