import { forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../../db/drizzle.module';
import { integracao } from '../../../db/schema';
import { DeliveryService } from '../../delivery/delivery.service';
import { agendamentoAnotaAi } from '../../delivery/adapters';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Cliente da API de Pedidos da Anota Aí (api-parceiros.anota.ai). Auth = token da
// LOJA no header `Authorization` (obtido no Portal de Integração ao adicionar a
// loja). Recebe pedidos por POLLING (PING - LIST ORDERS a cada 30s) — igual ao
// Cardápio Web, então NÃO precisa de URL pública/túnel pra testar (roda local).
// Guardamos por integração (canal 'anotaai'):
//   token = token da loja (Authorization) · merchantId = ID da loja (Root)
//   clientId/clientSecret = credenciais da conta parceira (Portal) · config.seen = ids já ingeridos
const CANAL = 'anotaai';
const BASE = process.env.ANOTAAI_BASE_URL ?? 'https://api-parceiros.anota.ai/partnerauth';

// Rotas CONFIRMADAS na doc (anota-ai.stoplight.io, API de Pedidos v1):
const EP_LIST = '/ping/list';
const EP_GET = (id: string) => `/ping/get/${id}`;
const EP_ACEITAR = (id: string) => `/order/accept/${id}`;
const EP_PRONTO = (id: string) => `/order/ready/${id}`;
const EP_FINALIZAR = (id: string) => `/order/finalize/${id}`; // "finalize", não "finish"
const EP_CANCELAR = (id: string) => `/order/cancel/${id}`; // body { justification }

export interface IntegAnota {
  id: string;
  tenantId: string;
  unidadeId: string | null;
  token: string;
  lojaId: string | null;
  config: any;
}

@Injectable()
export class AnotaAiService {
  private readonly logger = new Logger('AnotaAi');
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Inject(forwardRef(() => DeliveryService))
    private readonly delivery: DeliveryService,
  ) {}

  private mapRow(r: any): IntegAnota | null {
    if (!r || !r.token) return null;
    return {
      id: r.id,
      tenantId: r.tenantId,
      unidadeId: r.unidadeId ?? null,
      token: (r.token as string).trim(),
      lojaId: r.merchantId ?? null,
      config: r.config ?? {},
    };
  }

  async integracaoDoTenant(tenantId: string): Promise<IntegAnota | null> {
    const [r] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL), eq(integracao.ativo, true)));
    return this.mapRow(r);
  }

  async integracoesAtivas(): Promise<IntegAnota[]> {
    const rows = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.canal, CANAL), eq(integracao.ativo, true)));
    return rows.map((r) => this.mapRow(r)).filter((x): x is IntegAnota => !!x);
  }

  private async req(ig: IntegAnota, path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${BASE}${path}`, {
      ...init,
      headers: { Authorization: ig.token, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  }

  // PING - GET ORDER → objeto do pedido (dentro de info).
  async pedido(ig: IntegAnota, orderId: string): Promise<any | null> {
    const res = await this.req(ig, EP_GET(orderId), { method: 'GET' }).catch(() => null);
    if (!res || !res.ok) return null;
    const j: any = await res.json().catch(() => null);
    return j?.info ?? null;
  }

  // PING - LIST ORDERS → [{ _id, check, from, ... }]. excludeIfood=1 (não traz
  // pedidos de origem iFood — esses vêm pelo conector iFood direto, evita duplicar).
  async listar(ig: IntegAnota): Promise<any[]> {
    const res = await this.req(ig, `${EP_LIST}?currentpage=1&excludeIfood=1`, { method: 'GET' }).catch(() => null);
    if (!res || !res.ok) {
      const body = res ? await res.text().catch(() => '') : '';
      this.logger.warn(`listar ${res?.status ?? 'ERR'}: ${body.slice(0, 150)}`);
      return [];
    }
    const j: any = await res.json().catch(() => ({}));
    return j?.info?.docs ?? [];
  }

  // ===== Status back (kanban → Anota Aí) — rotas confirmadas na doc. =====
  private async acao(ig: IntegAnota, path: string, body = '{}'): Promise<boolean> {
    const res = await this.req(ig, path, { method: 'POST', body }).catch(() => null);
    if (res && res.ok) return true;
    this.logger.warn(`acao ${path} ${res?.status ?? 'ERR'}`);
    return false;
  }
  async aceitar(ig: IntegAnota, id: string) {
    return this.acao(ig, EP_ACEITAR(id));
  }
  async pronto(ig: IntegAnota, id: string) {
    return this.acao(ig, EP_PRONTO(id));
  }
  async finalizar(ig: IntegAnota, id: string) {
    return this.acao(ig, EP_FINALIZAR(id));
  }
  // Cancelar exige body { justification }.
  async cancelar(ig: IntegAnota, id: string, justification?: string) {
    return this.acao(ig, EP_CANCELAR(id), JSON.stringify({ justification: justification || 'Cancelado pela loja' }));
  }

  private async unidadeDestino(tenantId: string, unidadeIg: string | null): Promise<string | null> {
    if (unidadeIg) return unidadeIg;
    const r: any = await this.db.execute(sql`
      select id from unidade where tenant_id = ${tenantId} and deleted_at is null
      order by (tipo = 'matriz') desc, created_at asc limit 1`);
    return (r?.rows ?? r)?.[0]?.id ?? null;
  }

  // ===== Poller: puxa a lista, ingere os NOVOS (por externalId), auto-aceita. =====
  // Idempotente: usa config.seen (últimos ~500 ids) pra não re-processar. Pedidos
  // cancelados/negados (check 4/5) refletem localmente. Pedido de mesa agrupado
  // (from='table-merged') é ignorado por ora (as ações exigem o orderId original).
  async sincronizar(tenantId: string): Promise<number> {
    const ig = await this.integracaoDoTenant(tenantId);
    if (!ig) return 0;
    const unidadeId = await this.unidadeDestino(tenantId, ig.unidadeId);
    const docs = await this.listar(ig);
    const seen: string[] = Array.isArray(ig.config?.seen) ? ig.config.seen : [];
    const seenSet = new Set(seen);
    let n = 0;
    for (const d of docs) {
      const orderId = String(d._id ?? d.id ?? '');
      if (!orderId) continue;
      if (String(d.from ?? '') === 'table-merged') continue; // ação exige orderId original
      const check = Number(d.check);
      try {
        // 1) Ingere se for NOVO. Aceita só quem está EM ANÁLISE (check 0) ou
        //    agendado (-2) — senão o accept dá 400 (pedido já avançado).
        if (!seenSet.has(orderId)) {
          const raw = await this.pedido(ig, orderId);
          if (raw) {
            seenSet.add(orderId); // marca ANTES de ingerir (evita re-GET/dup nos próximos ciclos)
            await this.delivery
              .ingest(tenantId, unidadeId, CANAL, raw, {
                taxaEntrega: Number(raw?.deliveryFee) || 0,
                agendamento: agendamentoAnotaAi(raw) ?? undefined,
              })
              .catch(() => {}); // duplicado (constraint) = ok, já existe
            if (check === 0 || check === -2) await this.aceitar(ig, orderId);
            n++;
          }
        }
        // 2) Reflete a mudança de status vinda DA Anota Aí (bidirecional; vale p/ já
        //    ingeridos). check: 2 pronto · 3 finalizado · 4/5 cancelado/negado.
        if (check === 4 || check === 5) await this.delivery.refletirStatusExterno(tenantId, CANAL, orderId, 'cancelado');
        else if (check === 3) await this.delivery.refletirStatusExterno(tenantId, CANAL, orderId, 'concluido');
        else if (check === 2) await this.delivery.refletirStatusExterno(tenantId, CANAL, orderId, 'pronto');
      } catch (e: any) {
        this.logger.warn(`pedido ${orderId}: ${e?.message ?? e}`);
      }
    }
    // Persiste os últimos 500 ids vistos.
    const novoSeen = Array.from(seenSet).slice(-500);
    await this.db
      .update(integracao)
      .set({ config: { ...(ig.config ?? {}), seen: novoSeen, lastPollAt: new Date().toISOString() } })
      .where(eq(integracao.id, ig.id));
    if (n) this.logger.log(`tenant ${tenantId}: ${n} pedido(s) novo(s)`);
    return n;
  }

  // Puxa agora (botão de teste).
  async puxarAgora(tenantId: string): Promise<{ ingeridos: number }> {
    return { ingeridos: await this.sincronizar(tenantId) };
  }

  // ===== Credenciais (tela do gestor) =====
  async salvarCredenciais(
    tenantId: string,
    unidadeId: string | null,
    token: string,
    lojaId: string | null,
  ): Promise<{ ok: boolean }> {
    const [existente] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL)));
    const tokenNovo = token && token.trim() ? token.trim() : undefined; // vazio mantém
    if (existente) {
      await this.db
        .update(integracao)
        .set({
          merchantId: lojaId ?? existente.merchantId,
          ativo: true,
          ...(unidadeId ? { unidadeId } : {}),
          ...(tokenNovo ? { token: tokenNovo } : {}),
          updatedAt: new Date(),
        })
        .where(eq(integracao.id, existente.id));
    } else {
      await this.db.insert(integracao).values({
        tenantId,
        unidadeId,
        canal: CANAL,
        ativo: true,
        merchantId: lojaId,
        token: tokenNovo ?? null,
        config: {},
      });
    }
    return { ok: true };
  }

  async status(tenantId: string) {
    const ig = await this.integracaoDoTenant(tenantId);
    return { conectado: !!ig, lojaId: ig?.lojaId ?? null };
  }

  async desconectar(tenantId: string): Promise<{ ok: boolean }> {
    const [ig] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL)));
    if (!ig) return { ok: true };
    await this.db
      .update(integracao)
      .set({ ativo: false, token: null, config: {}, updatedAt: new Date() })
      .where(eq(integracao.id, ig.id));
    return { ok: true };
  }
}
