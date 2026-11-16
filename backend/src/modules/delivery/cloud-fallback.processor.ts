import { ehServidorLocal } from '../../common/modo';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, asc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { pedidoExterno, edgeHeartbeat } from '../../db/schema';
import { EsperaPorFalha } from '../../common/espera-por-falha';
import { DeliveryService } from './delivery.service';
import { deveMaterializar } from './deve-materializar';

/**
 * P2 — Rede de segurança da NUVEM para pedidos online presos.
 *
 * Quando a loja opera em modo local, `receberPedido` NÃO materializa: adia para o
 * edge processar (ver EdgePedidosProcessor). Mas essa decisão é one-shot no momento
 * do pedido. Se o edge cair DEPOIS de deferir e ANTES de puxar/processar, o pedido
 * fica preso em `novo` sem comanda — a nuvem não re-materializa e o edge morto não
 * processa. Aqui a NUVEM resgata: pega pedidos online `novo`/sem comanda com mais de
 * TETO_MIN minutos E cujo tenant NÃO tem heartbeat recente do edge (edge caiu) e
 * chama `delivery.aceitar` na própria nuvem.
 *
 * Guardas contra corrida com o edge:
 *  - Só age se NÃO há heartbeat do edge nos últimos HB_MIN min (edge ativo → não toca).
 *  - Idade mínima TETO_MIN dá tempo do fluxo normal (sync + processador do edge).
 *  - `aceitar` seta comanda_id → idempotente; no próximo ciclo o pedido já não entra.
 *  - Só roda na NUVEM (no edge, EDGE_MODE=true, retorna cedo — lá quem materializa é
 *    o EdgePedidosProcessor).
 */
@Injectable()
export class CloudFallbackProcessor {
  private readonly logger = new Logger('CloudFallback');
  private rodando = false;
  private readonly isEdge = ehServidorLocal();
  private static readonly HB_MIN = 3; // heartbeat recente = edge ativo
  private static readonly TETO_MIN = 5; // idade mínima do pedido preso
  // Servidor que BATE mas não sincroniza há mais que isto não conta como vivo (ERR-132).
  private static readonly FALHA_MIN = 10;
  // Pedido cujo resgate falha seguidas vezes (V84, ERR-493): a leitura é de TODAS as empresas, e o que falhava sempre
  // voltava ao lote a cada minuto — 50 deles tomavam o resgate das outras lojas. As duas primeiras falhas tentam de novo no
  // ciclo seguinte; depois o pedido sai da consulta por 2, 4, 6… min (teto de 10). Segue "novo" no painel da loja.
  private readonly resgateFalhou = new EsperaPorFalha();
  /** Pedidos por ciclo (o teste diminui para provar que o que falha não toma o lote). */
  lote = 50;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly delivery: DeliveryService,
  ) {}

  /** `soEmpresas`: só para o teste (no CI as specs dividem o banco). Vale apenas como LISTA — o `@Interval` não passa nada. */
  @Interval(60000)
  async processar(soEmpresas?: string[]) {
    if (this.isEdge || this.rodando) return;
    this.rodando = true;
    try {
      const soEstas =
        Array.isArray(soEmpresas) && soEmpresas.length
          ? sql`${pedidoExterno.tenantId} in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})`
          : sql`true`;
      const corteIdade = new Date(Date.now() - CloudFallbackProcessor.TETO_MIN * 60 * 1000);
      const corteHb = new Date(Date.now() - CloudFallbackProcessor.HB_MIN * 60 * 1000);
      const corteFalha = new Date(Date.now() - CloudFallbackProcessor.FALHA_MIN * 60 * 1000);
      // O que está em espera por falha repetida fica fora deste ciclo.
      const emEspera = this.resgateFalhou.emEspera();
      const semOsEmEspera = emEspera.length
        ? sql`${pedidoExterno.id} not in (${sql.join(emEspera.map((id) => sql`${id}::uuid`), sql`, `)})`
        : sql`true`;

      // Pedidos online presos há mais de TETO_MIN, sem comanda, de loja que TEM servidor
      // local cadastrado e cujo servidor está SEM batida. Duas correções (ERR-062):
      //  • "vivo" = batida recente em `edge_status` (fonte atual, 1 linha por servidor, a
      //    cada ciclo) OU em `edge_heartbeat` (transição) — igual a common/edge-ativo.ts.
      //    Antes olhava só `edge_heartbeat`, que o servidor com token grava a cada 30 min:
      //    a nuvem dava a loja por morta e aceitava os pedidos no lugar dela;
      //  • loja SEM servidor local não entra: lá o pedido nunca é adiado para o edge — está
      //    'novo' porque a LOJA ainda não aceitou. Antes a nuvem aceitava (e confirmava no
      //    iFood/99) todo pedido não aceito em 5 min.
      // F2: o servidor da matriz NÃO "cobre" a filial (unidade do pedido ou servidor sem
      // unidade = da rede, na transição).
      // "Tem servidor local" = um servidor de LOJA: não a credencial do GoGeM (também é um
      // `servidor_local`, mig 290) nem sobra de instalação que nunca sincronizou. Com qualquer
      // `servidor_local` contando, a loja que só usa o GoGeM na nuvem passava por "servidor morto"
      // e a nuvem aceitava os pedidos do iFood/99 no lugar dela (ERR-108).
      const presos = await this.db
        .select({
          id: pedidoExterno.id,
          tenantId: pedidoExterno.tenantId,
          canal: pedidoExterno.canal,
          pago: pedidoExterno.pago,
          formaPagamento: pedidoExterno.formaPagamento,
          statusPagamento: pedidoExterno.statusPagamento,
          sinalStatus: pedidoExterno.sinalStatus,
        })
        .from(pedidoExterno)
        .where(
          and(
            eq(pedidoExterno.status, 'novo'),
            isNull(pedidoExterno.comandaId),
            lt(pedidoExterno.criadoEm, corteIdade),
            semOsEmEspera,
            soEstas,
            sql`(${pedidoExterno.canal} is not null and ${pedidoExterno.canal} <> 'balcao')`,
            // Pix/cartão online (ou o sinal) ainda não pago espera FORA da leitura (V84): na nuvem quem aceita depois é
            // o pagamento aprovado.
            sql`coalesce(${pedidoExterno.statusPagamento}, '') <> 'aguardando' and coalesce(${pedidoExterno.sinalStatus}, '') <> 'pendente'`,
            sql`exists (select 1 from equipamento e
                         where e.tenant_id = ${pedidoExterno.tenantId} and e.tipo = 'servidor_local'
                           and e.ativo = true
                           and e.integrador is null
                           and (e.last_push_ts is not null or e.last_push_seq is not null)
                           and (e.unidade_id = ${pedidoExterno.unidadeId} or e.unidade_id is null))`,
            // "Vivo" = bate E sincroniza (ERR-132): o servidor em laço na primeira carga batia a
            // cada ciclo com o sync falhando, e a nuvem segurava os pedidos dele para sempre. O
            // daemon manda na saúde desde quando falha sem parar (`syncFalhandoDesde`); ausente
            // (servidor bom ou versão antiga) = vivo, como antes. Valor que não é data não quebra
            // a consulta (o `case` só converte o que tem cara de data ISO).
            sql`not exists (select 1 from edge_status es
                             where es.tenant_id = ${pedidoExterno.tenantId} and es.recebido_em >= ${corteHb}
                               and (es.unidade_id = ${pedidoExterno.unidadeId} or es.unidade_id is null)
                               and coalesce(case when es.saude->>'syncFalhandoDesde' ~ '^\\d{4}-\\d{2}-\\d{2}T'
                                                 then (es.saude->>'syncFalhandoDesde')::timestamptz end,
                                            'infinity'::timestamptz) > ${corteFalha})`,
            sql`not exists (select 1 from ${edgeHeartbeat} hb where hb.tenant_id = ${pedidoExterno.tenantId} and hb.recebido_em >= ${corteHb} and (hb.unidade_id = ${pedidoExterno.unidadeId} or hb.unidade_id is null))`,
          ),
        )
        // Quem espera há mais tempo primeiro; o parado há mais de 12 h (pendência antiga, não cliente esperando) por
        // último: sem ordem, o lote podia vir só com eles.
        .orderBy(sql`(${pedidoExterno.criadoEm} < now() - interval '12 hours')`, asc(pedidoExterno.criadoEm))
        .limit(this.lote);

      // A MESMA regra do servidor da loja (`deveMaterializar`): o totem em dinheiro de loja que "produz só depois de pagar"
      // não vai à cozinha pelo resgate (antes ia — ERR-091 por outro caminho; auditoria do KDS, 11/11/2026).
      const aposPagamento = new Map<string, boolean>();
      for (const p of presos) {
        try {
          if (!aposPagamento.has(p.tenantId)) aposPagamento.set(p.tenantId, await this.delivery.totemAposPagamento(p.tenantId));
          if (!deveMaterializar(p, aposPagamento.get(p.tenantId) ?? true)) continue;
          await this.delivery.aceitar(p.tenantId, null, p.id);
          this.resgateFalhou.deuCerto(p.id);
          this.logger.warn(`pedido online ${p.id} resgatado na nuvem (edge inativo)`);
        } catch (e: any) {
          const espera = this.resgateFalhou.falhou(p.id);
          const depois = espera
            ? ` — ${this.resgateFalhou.vezes(p.id)} falhas seguidas: nova tentativa em ${Math.round(espera / 60_000)} min (o pedido segue "novo" no painel)`
            : '';
          this.logger.warn(`falha ao resgatar ${p.id}: ${e?.message ?? e}${depois}`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`ciclo falhou: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }
}
