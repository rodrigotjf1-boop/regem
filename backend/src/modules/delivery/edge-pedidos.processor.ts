import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { pedidoExterno } from '../../db/schema';
import { DeliveryService } from './delivery.service';
import { deveMaterializar } from './deve-materializar';

/**
 * P1b — Processador de pedidos ONLINE no EDGE.
 *
 * Pedidos online (cardápio/marketplaces) nascem na NUVEM. Quando a loja está em
 * modo local, a nuvem NÃO materializa a produção (deixa o pedido em `novo` sem
 * comanda) e ele DESCE pelo sync. Aqui, no edge (EDGE_MODE), pegamos esses pedidos
 * (`status='novo'` e `comanda_id IS NULL`) e chamamos `delivery.aceitar` — que cria
 * a comanda + produção LOCALMENTE (KDS/garçom) e faz a baixa de estoque no edge.
 *
 * Idempotente: `aceitar` seta `comanda_id`; no próximo ciclo o pedido já não entra.
 * Só roda no edge — na nuvem o EDGE_MODE é falso e o intervalo retorna cedo.
 */
@Injectable()
export class EdgePedidosProcessor {
  private readonly logger = new Logger('EdgePedidos');
  private rodando = false;
  private ultimoAvisoOrfaos = 0; // throttle do aviso de comanda ausente (ms)
  private readonly isEdge = String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';
  // Unidade DESTE edge (F2 — roteamento por loja). Setada → só materializa/imprime os
  // pedidos DESTA loja (o edge da matriz NUNCA pega o pedido da filial). Vazia (1 loja
  // ou edge antigo sem EDGE_UNIDADE_ID) → tenant-wide, comportamento atual preservado.
  private readonly unidadeId = (process.env.EDGE_UNIDADE_ID || '').trim() || null;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly delivery: DeliveryService,
  ) {}

  @Interval(15000)
  async processar() {
    if (!this.isEdge || this.rodando) return;
    this.rodando = true;
    try {
      // Pedidos que desceram da nuvem e ainda não viraram produção local.
      const conds = [
        eq(pedidoExterno.status, 'novo'),
        isNull(pedidoExterno.comandaId),
        // Só pedidos ONLINE (têm cliente/canal externo) — evita mexer em rascunhos.
        sql`(${pedidoExterno.canal} is not null and ${pedidoExterno.canal} <> 'balcao')`,
      ];
      // F2: escopo por unidade quando o edge é de uma loja específica (nunca matriz→filial).
      if (this.unidadeId) conds.push(eq(pedidoExterno.unidadeId, this.unidadeId));
      const pendentes = await this.db
        .select({
          id: pedidoExterno.id,
          tenantId: pedidoExterno.tenantId,
          canal: pedidoExterno.canal,
          pago: pedidoExterno.pago,
          // Retido de cartão/PIX nunca vai para a cozinha antes de aprovar (deveMaterializar).
          formaPagamento: pedidoExterno.formaPagamento,
        })
        .from(pedidoExterno)
        .where(and(...conds))
        .limit(50);

      // "Produz só depois de pago" é config por loja; lê uma vez por tenant do lote.
      const aposPagamento = new Map<string, boolean>();
      for (const t of new Set(pendentes.map((p) => p.tenantId))) {
        aposPagamento.set(t, await this.delivery.totemAposPagamento(t));
      }

      for (const p of pendentes) {
        // Totem em dinheiro é "a pagar no balcão": o cupom do cliente diz que só produz
        // depois de pago. Sem isto, este ciclo mandava para a cozinha em 15s.
        if (!deveMaterializar(p, aposPagamento.get(p.tenantId) ?? true)) continue;
        try {
          await this.delivery.aceitar(p.tenantId, null, p.id);
          this.logger.log(`pedido online ${p.id} materializado no edge (comanda + produção)`);
        } catch (e: any) {
          this.logger.warn(`falha ao materializar ${p.id}: ${e?.message ?? e}`);
        }
      }

      await this.imprimirAceitosFora();

      // Reconciliação (SÓ observabilidade — NÃO re-materializa p/ não duplicar estoque/
      // avisos): pedido ONLINE que a NUVEM materializou (comanda_id preenchido) mas cuja
      // comanda NÃO desceu para o edge fica invisível no painel local. Isso é o sintoma
      // clássico do cursor pulando/janela (ver keyset do pull). Aqui só surfamos a
      // contagem (throttle 5 min) — com o keyset a comanda desce e a contagem zera. A
      // re-materialização segura (sem baixa dupla) fica p/ validação em edge real.
      const orfaos: any[] = await this.db.execute(sql`
        select pe.id
        from pedido_externo pe
        where pe.comanda_id is not null
          and pe.canal is not null and pe.canal <> 'balcao'
          ${this.unidadeId ? sql`and pe.unidade_id = ${this.unidadeId}` : sql``}
          and pe.criado_em >= now() - interval '2 days'
          and pe.criado_em <  now() - interval '3 minutes'
          and not exists (select 1 from comanda c where c.id = pe.comanda_id)
        limit 50
      `).then((r: any) => r.rows ?? r);
      if (orfaos.length && Date.now() - this.ultimoAvisoOrfaos > 5 * 60 * 1000) {
        this.ultimoAvisoOrfaos = Date.now();
        const amostra = orfaos.slice(0, 3).map((o) => o.id).join(', ');
        this.logger.warn(
          `${orfaos.length} pedido(s) materializado(s) na nuvem SEM comanda local ` +
            `(provável descida do pull) — ex.: ${amostra}. O keyset deve fechar; ` +
            `se persistir, verificar sync da tabela comanda.`,
        );
      }
    } catch (e: any) {
      this.logger.warn(`ciclo falhou: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Pedido de canal que chegou JÁ ACEITO (a nuvem aceitou enquanto este servidor estava fora do
   * ar, ou alguém aceitou no painel da nuvem): o ciclo acima só pega 'novo', e o materializador
   * de vendas da nuvem pula pedido de canal — nada saía no papel (ERR-251). Aqui sai a via e a
   * produção, UMA vez:
   *  • só 'confirmado' (em produção) e chegado há menos de 2 h: pronto, despachado ou concluído
   *    já passou da cozinha; a loja que volta de uma queda longa não recebe pilha de pedido velho;
   *  • folga de 30 s depois do aceite: o aceite feito AQUI enfileira na hora (e marca o pedido);
   *  • a comanda já desceu e nenhuma via saiu para ela; nem o pedido nem a comanda marcados em
   *    `impressao_edge_feito`;
   *  • sem impressora: tenta por até 20 min (dá tempo de configurar) e desiste com aviso.
   */
  private async imprimirAceitosFora() {
    const r: any = await this.db.execute(sql`
      select pe.id, pe.tenant_id as "tenantId", pe.comanda_id as "comandaId", pe.canal, pe.tipo,
             pe.unidade_id as "unidadeId", pe.criado_em as "criadoEm"
        from pedido_externo pe
       where pe.status = 'confirmado'
         and pe.comanda_id is not null
         and pe.deleted_at is null
         and pe.canal is not null and pe.canal <> 'balcao'
         ${this.unidadeId ? sql`and pe.unidade_id = ${this.unidadeId}` : sql``}
         and pe.criado_em > now() - interval '2 hours'
         and coalesce(pe.confirmado_em, pe.criado_em) < now() - interval '30 seconds'
         and exists (select 1 from comanda c where c.id = pe.comanda_id and c.status = 'fechada')
         and not exists (select 1 from impressao_job j where j.comanda_id = pe.comanda_id)
         and not exists (select 1 from impressao_edge_feito f where f.comanda_id in (pe.id, pe.comanda_id))
       order by pe.criado_em asc
       limit 20
    `);
    const GRACA_MIN = 20;
    for (const p of r.rows ?? r) {
      let enfileirados = 0;
      let erro = false;
      try {
        const res = await this.delivery.imprimirPedidoAceitoFora(p.tenantId, p);
        enfileirados = res.enfileirados;
        if (enfileirados > 0) this.logger.log(`pedido ${p.id} chegou já aceito: via e produção impressas aqui (${enfileirados})`);
      } catch (e: any) {
        erro = true; // falha passageira: tenta de novo no próximo ciclo
        this.logger.warn(`pedido ${p.id} chegou já aceito, mas a impressão falhou: ${e?.message ?? e}`);
      }
      const idadeMin = (Date.now() - new Date(p.criadoEm).getTime()) / 60000;
      if (!erro && enfileirados === 0 && idadeMin > GRACA_MIN) {
        await this.db
          .execute(sql`insert into impressao_edge_feito (comanda_id) values (${p.id}) on conflict do nothing`)
          .catch(() => undefined);
        this.logger.warn(`pedido ${p.id} chegou já aceito e NÃO foi impresso: sem impressora para ele (desisti após ${GRACA_MIN} min)`);
      }
    }
  }
}
