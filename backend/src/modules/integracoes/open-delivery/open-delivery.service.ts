import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../../db/drizzle.module';
import { integracao } from '../../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Cliente da Open Delivery API (Abrasel). Cada marketplace expõe a mesma spec
// numa base URL própria; guardamos por integração (canal 'open_delivery'):
//   merchantId = baseUrl da API  ·  clientId/clientSecret = OAuth  ·  token = cache
const CANAL = 'open_delivery';

export interface IntegOD {
  id: string;
  tenantId: string;
  unidadeId: string | null;
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  token: string | null;
  config: any;
}

@Injectable()
export class OpenDeliveryService {
  private readonly logger = new Logger('OpenDelivery');
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Integrações Open Delivery ativas (todas as lojas) — usado pelo poller.
  async integracoesAtivas(): Promise<IntegOD[]> {
    const rows = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.canal, CANAL), eq(integracao.ativo, true)));
    return rows
      .filter((r) => r.merchantId && r.clientId && r.clientSecret)
      .map((r) => ({
        id: r.id,
        tenantId: r.tenantId,
        unidadeId: r.unidadeId ?? null,
        baseUrl: (r.merchantId as string).replace(/\/+$/, ''),
        clientId: r.clientId as string,
        clientSecret: r.clientSecret as string,
        token: r.token,
        config: r.config ?? {},
      }));
  }

  // Integração Open Delivery de um pedido (para o status back a partir do kanban).
  async integracaoDoTenant(tenantId: string): Promise<IntegOD | null> {
    const [r] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL), eq(integracao.ativo, true)));
    if (!r || !r.merchantId || !r.clientId || !r.clientSecret) return null;
    return {
      id: r.id,
      tenantId: r.tenantId,
      unidadeId: r.unidadeId ?? null,
      baseUrl: (r.merchantId as string).replace(/\/+$/, ''),
      clientId: r.clientId as string,
      clientSecret: r.clientSecret as string,
      token: r.token,
      config: r.config ?? {},
    };
  }

  // OAuth client_credentials → access_token (cacheado em integracao.token +
  // config.tokenExp). Reusa até ~1 min antes de expirar.
  private async token(ig: IntegOD): Promise<string | null> {
    const exp = Number(ig.config?.tokenExp ?? 0);
    if (ig.token && exp > Date.now() + 60000) return ig.token;
    try {
      const res = await fetch(`${ig.baseUrl}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: ig.clientId,
          client_secret: ig.clientSecret,
        }).toString(),
      });
      if (!res.ok) {
        this.logger.error(`token ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
        return null;
      }
      const j: any = await res.json();
      const access = j.access_token as string;
      const tokenExp = Date.now() + (Number(j.expires_in) || 3600) * 1000;
      await this.db
        .update(integracao)
        .set({ token: access, config: { ...(ig.config ?? {}), tokenExp } })
        .where(eq(integracao.id, ig.id));
      ig.token = access;
      ig.config = { ...(ig.config ?? {}), tokenExp };
      return access;
    } catch (e: any) {
      this.logger.error(`token falhou: ${e?.message ?? e}`);
      return null;
    }
  }

  private async req(ig: IntegOD, path: string, init: RequestInit = {}): Promise<any> {
    const tk = await this.token(ig);
    if (!tk) throw new Error('sem token');
    const res = await fetch(`${ig.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${tk}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    return res;
  }

  // Polling de eventos: 200 com lista, 204 vazio.
  async polling(ig: IntegOD): Promise<any[]> {
    const res = await this.req(ig, '/events:polling', { method: 'GET' });
    if (res.status === 204) return [];
    if (!res.ok) {
      this.logger.warn(`polling ${res.status}`);
      return [];
    }
    const j = await res.json().catch(() => []);
    return Array.isArray(j) ? j : j?.events ?? [];
  }

  // Acknowledgment (descarta os eventos do polling). Lotes de até 100.
  async acknowledge(ig: IntegOD, eventos: any[]): Promise<void> {
    if (!eventos.length) return;
    const corpo = eventos.map((e) => ({ id: e.id, orderId: e.orderId, eventType: e.eventType }));
    for (let i = 0; i < corpo.length; i += 100) {
      await this.req(ig, '/acknowledgment', {
        method: 'POST',
        body: JSON.stringify(corpo.slice(i, i + 100)),
      }).catch(() => {});
    }
  }

  async pedido(ig: IntegOD, orderId: string): Promise<any | null> {
    const res = await this.req(ig, `/orders/${orderId}`, { method: 'GET' });
    return res.ok ? res.json().catch(() => null) : null;
  }

  // ===== Status back (kanban → marketplace) =====
  async confirmar(ig: IntegOD, orderId: string, orderExternalCode?: string) {
    await this.req(ig, `/orders/${orderId}/confirm`, {
      method: 'POST',
      body: JSON.stringify({ createdAt: new Date().toISOString(), orderExternalCode }),
    }).catch(() => {});
  }
  async despachar(ig: IntegOD, orderId: string) {
    await this.req(ig, `/orders/${orderId}/dispatch`, { method: 'POST', body: '{}' }).catch(() => {});
  }
  async cancelar(ig: IntegOD, orderId: string, reason = 'Cancelado pela loja') {
    await this.req(ig, `/orders/${orderId}/requestCancellation`, {
      method: 'POST',
      body: JSON.stringify({ reason, code: 'OTHER' }),
    }).catch(() => {});
  }
}
