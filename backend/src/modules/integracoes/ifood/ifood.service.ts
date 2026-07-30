import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../../db/drizzle.module';
import { integracao } from '../../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Cliente da API do iFood (merchant-api.ifood.com.br). Guardamos por integração
// (canal 'ifood'): merchantId = UUID da loja no iFood · clientId/clientSecret =
// credenciais do app (Portal do Desenvolvedor) · token = cache do access_token.
// OAuth client_credentials; eventos por polling (+ acknowledgment). Reusa o
// adaptarIfood + delivery.ingest que já existem.
const CANAL = 'ifood';
const BASE = 'https://merchant-api.ifood.com.br';

export interface IntegIfood {
  id: string;
  tenantId: string;
  unidadeId: string | null;
  merchantId: string;
  clientId: string;
  clientSecret: string;
  token: string | null;
  config: any;
}

@Injectable()
export class IfoodService {
  private readonly logger = new Logger('iFood');
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private mapRow(r: any): IntegIfood | null {
    // Client ID/Secret são do APP PARCEIRO da Regem — globais (env), iguais p/ todas
    // as lojas. Só o merchantId é por loja. Fallback para credenciais na própria
    // linha mantém retrocompat com integrações antigas (preenchidas no card).
    if (!r || !r.merchantId) return null;
    const clientId = ((r.clientId as string) || process.env.IFOOD_CLIENT_ID || '').trim();
    const clientSecret = ((r.clientSecret as string) || process.env.IFOOD_CLIENT_SECRET || '').trim();
    if (!clientId || !clientSecret) return null;
    return {
      id: r.id,
      tenantId: r.tenantId,
      unidadeId: r.unidadeId ?? null,
      merchantId: (r.merchantId as string).trim(),
      clientId,
      clientSecret,
      token: r.token,
      config: r.config ?? {},
    };
  }

  // Integrações iFood ativas (todas as lojas) — usado pelo poller.
  async integracoesAtivas(): Promise<IntegIfood[]> {
    const rows = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.canal, CANAL), eq(integracao.ativo, true)));
    return rows.map((r) => this.mapRow(r)).filter((x): x is IntegIfood => !!x);
  }

  // Integração iFood de um tenant (para o status back a partir do kanban).
  async integracaoDoTenant(tenantId: string): Promise<IntegIfood | null> {
    const [r] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL), eq(integracao.ativo, true)));
    return this.mapRow(r);
  }

  // ===== Fluxo de integração (modelo parceiro) =====
  // Client ID/Secret são GLOBAIS da Regem (env) — a loja não os informa. A loja só
  // DISPARA o pedido; a distribuição pede a autorização do merchant no Portal do
  // Desenvolvedor e finaliza com o Merchant ID. Até lá a integração fica ativo=false
  // (o poller ignora — integracoesAtivas filtra por ativo=true).
  async solicitarIntegracao(tenantId: string, unidadeId: string | null, solicitanteId?: string | null) {
    const [existente] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL)));
    const cfgAtual: any = existente?.config ?? {};
    const jaPendente = cfgAtual?.pedidoIntegracao?.status === 'pendente';
    const pedido = jaPendente
      ? cfgAtual.pedidoIntegracao
      : { status: 'pendente', solicitadoEm: new Date().toISOString(), solicitadoPorId: solicitanteId ?? null };
    const config = { ...cfgAtual, pedidoIntegracao: pedido };
    if (existente) {
      await this.db
        .update(integracao)
        .set({ ativo: false, ...(unidadeId ? { unidadeId } : {}), config, updatedAt: new Date() })
        .where(eq(integracao.id, existente.id));
    } else {
      await this.db.insert(integracao).values({ tenantId, unidadeId, canal: CANAL, ativo: false, config });
    }
    if (!jaPendente) void this.alertarDistribuicao(tenantId, 'pedido_integracao');
    return { ok: true };
  }

  // A loja desativa: o iFood não tem revoke self-service confiável, então marcamos
  // "pendente_remocao" e avisamos a distribuição para tirar a loja do app no portal.
  async desativarIntegracao(tenantId: string) {
    const [existente] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL)));
    if (!existente) return { ok: true };
    const cfgAtual: any = existente.config ?? {};
    const pedido = {
      ...(cfgAtual.pedidoIntegracao ?? {}),
      status: 'pendente_remocao',
      removidoSolicitadoEm: new Date().toISOString(),
    };
    await this.db
      .update(integracao)
      .set({ ativo: false, config: { ...cfgAtual, pedidoIntegracao: pedido }, updatedAt: new Date() })
      .where(eq(integracao.id, existente.id));
    void this.alertarDistribuicao(tenantId, 'remocao_integracao');
    return { ok: true };
  }

  async statusIntegracao(tenantId: string) {
    const [r] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL)));
    const cfg: any = r?.config ?? {};
    return {
      ativo: !!r?.ativo,
      pedidoStatus: cfg?.pedidoIntegracao?.status ?? null,
      temMerchant: !!r?.merchantId,
    };
  }

  // Avisa a distribuição de um pedido/remoção (e-mail via DIST_ALERT_WEBHOOK/n8n).
  // Best-effort — nunca quebra a ação principal.
  private async alertarDistribuicao(tenantId: string, evento: string) {
    try {
      const hook = (process.env.DIST_ALERT_WEBHOOK ?? '').trim();
      if (!hook) return;
      const emp: any = await this.db.execute(sql`select nome, cnpj from empresa where id = ${tenantId} limit 1`);
      const row = (emp?.rows ?? emp)?.[0] ?? {};
      const dst: any = await this.db.execute(
        sql`select email from usuario_distribuicao where perfil in ('diretoria','tecnico') and ativo = true`,
      );
      const destinatarios = (dst?.rows ?? dst).map((x: any) => x.email).filter(Boolean);
      await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          evento,
          canal: CANAL,
          loja: row.nome ?? 'Loja',
          cnpj: row.cnpj ?? null,
          tenantId,
          destinatarios,
          em: new Date().toISOString(),
        }),
      }).catch(() => {});
    } catch {
      /* best-effort */
    }
  }

  // OAuth client_credentials → accessToken (cache em token + config.tokenExp).
  private async token(ig: IntegIfood): Promise<string | null> {
    const exp = Number(ig.config?.tokenExp ?? 0);
    if (ig.token && exp > Date.now() + 60000) return ig.token;
    try {
      const res = await fetch(`${BASE}/authentication/v1.0/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grantType: 'client_credentials',
          clientId: ig.clientId,
          clientSecret: ig.clientSecret,
        }).toString(),
      });
      if (!res.ok) {
        this.logger.error(`token ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
        return null;
      }
      const j: any = await res.json();
      const access = j.accessToken as string;
      const tokenExp = Date.now() + (Number(j.expiresIn) || 21600) * 1000;
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

  private async req(ig: IntegIfood, path: string, init: RequestInit = {}): Promise<Response> {
    const tk = await this.token(ig);
    if (!tk) throw new Error('sem token iFood');
    return fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${tk}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  // Polling de eventos (filtra pela loja via x-polling-merchants). 204 = vazio.
  async polling(ig: IntegIfood): Promise<any[]> {
    const res = await this.req(ig, '/events/v1.0/events:polling', {
      method: 'GET',
      headers: { 'x-polling-merchants': ig.merchantId },
    });
    if (res.status === 204) return [];
    if (!res.ok) {
      this.logger.warn(`polling ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}`);
      return [];
    }
    const j = await res.json().catch(() => []);
    return Array.isArray(j) ? j : [];
  }

  // Acknowledgment: descarta os eventos já lidos (lotes de até 2000).
  async acknowledge(ig: IntegIfood, eventos: any[]): Promise<void> {
    if (!eventos.length) return;
    const corpo = eventos.map((e) => ({ id: e.id }));
    for (let i = 0; i < corpo.length; i += 2000) {
      await this.req(ig, '/events/v1.0/events/acknowledgment', {
        method: 'POST',
        body: JSON.stringify(corpo.slice(i, i + 2000)),
      }).catch(() => {});
    }
  }

  async pedido(ig: IntegIfood, orderId: string): Promise<any | null> {
    const res = await this.req(ig, `/order/v1.0/orders/${orderId}`, { method: 'GET' });
    return res.ok ? res.json().catch(() => null) : null;
  }

  // ===== Status back (Regem → iFood) =====
  // Retorna true se o iFood aceitou (res.ok) — usado pela blindagem do cancel.
  private async acao(ig: IntegIfood, orderId: string, ep: string, body = '{}'): Promise<boolean> {
    try {
      const res = await this.req(ig, `/order/v1.0/orders/${orderId}/${ep}`, { method: 'POST', body });
      if (res.ok) {
        this.logger.log(`${ep} ${orderId.slice(0, 8)} OK`);
        return true;
      }
      this.logger.warn(`${ep} ${orderId.slice(0, 8)} ${res.status}: ${(await res.text().catch(() => '')).slice(0, 120)}`);
      return false;
    } catch (e: any) {
      this.logger.warn(`${ep} ${orderId.slice(0, 8)} falhou: ${e?.message ?? e}`);
      return false;
    }
  }
  async confirmar(ig: IntegIfood, orderId: string) {
    await this.acao(ig, orderId, 'confirm');
  }
  async prontoRetirada(ig: IntegIfood, orderId: string) {
    await this.acao(ig, orderId, 'readyToPickup');
  }
  async despachar(ig: IntegIfood, orderId: string) {
    await this.acao(ig, orderId, 'dispatch');
  }
  // Consulta os motivos de cancelamento VÁLIDOS para este pedido. O iFood exige
  // essa consulta antes de cancelar (homologação) — o código válido varia por
  // pedido/estado. Resposta oficial: { reasons: [{ code, description }] } (algumas
  // contas retornam o array direto). Normalizamos para [{ code, description }].
  async motivosCancelamento(ig: IntegIfood, orderId: string): Promise<Array<{ code: string; description: string }>> {
    try {
      const res = await this.req(ig, `/order/v1.0/orders/${orderId}/cancellationReasons`, { method: 'GET' });
      if (!res.ok) {
        this.logger.warn(`cancellationReasons ${orderId.slice(0, 8)} ${res.status}`);
        return [];
      }
      const j: any = await res.json().catch(() => ({}));
      const bruto = Array.isArray(j) ? j : Array.isArray(j?.reasons) ? j.reasons : [];
      const lista = bruto
        .map((m: any) => ({
          code: String(m?.code ?? m?.cancelCodeId ?? m?.cancellationCode ?? ''),
          description: String(m?.description ?? m?.reason ?? ''),
        }))
        .filter((m: { code: string }) => m.code);
      this.logger.log(`cancellationReasons ${orderId.slice(0, 8)} OK (${lista.length} motivos)`);
      return lista;
    } catch (e: any) {
      this.logger.warn(`cancellationReasons ${orderId.slice(0, 8)} falhou: ${e?.message ?? e}`);
      return [];
    }
  }

  async cancelar(ig: IntegIfood, orderId: string, _motivo?: string): Promise<boolean> {
    // 0) Consulta os detalhes do pedido antes de cancelar (requisito do iFood:
    //    confirmação/cancelamento só são permitidos após consultar o pedido).
    await this.pedido(ig, orderId).catch(() => null);
    // 1) Consulta os motivos válidos para o pedido (exigido pela homologação).
    const motivos = await this.motivosCancelamento(ig, orderId);
    // 2) O corpo do requestCancellation exige DOIS campos: `cancellationCode` (o
    //    CÓDIGO do motivo, ex.: "501") e `reason` (a DESCRIÇÃO/texto). Mandar só
    //    `reason` dá 400 "Field 'cancellationCode' is required". Prefere 501
    //    (problema no estabelecimento); senão o 1º motivo válido; fallback "501".
    const motivo = motivos.find((m) => m.code === '501') ?? motivos[0];
    const cancellationCode = motivo?.code ?? '501';
    const reason = _motivo || motivo?.description || 'Problema no estabelecimento';
    return this.acao(
      ig,
      orderId,
      'requestCancellation',
      JSON.stringify({ cancellationCode, reason }),
    );
  }

  // ===== Blindagem do cancel (não repetir a falha da homologação) =====
  // O cancel do kanban NÃO é mais fire-and-forget: se o requestCancellation falhar
  // (rede/queda/status), o pedido entra em config.pendingCancels e o poller reenvia
  // com backoff até o iFood aceitar. Evita "cancelado local, não cancelado no iFood".
  async cancelarComBlindagem(tenantId: string, orderId: string, motivo?: string): Promise<void> {
    const ig = await this.integracaoDoTenant(tenantId);
    if (!ig) return;
    const ok = await this.cancelar(ig, orderId, motivo);
    if (ok) await this.limparCancelPendente(ig, orderId);
    else await this.marcarCancelPendente(ig, orderId, motivo);
  }

  private async marcarCancelPendente(ig: IntegIfood, orderId: string, motivo?: string): Promise<void> {
    const pend = { ...(ig.config?.pendingCancels ?? {}) };
    const anterior = pend[orderId] ?? {};
    pend[orderId] = { motivo: motivo ?? anterior.motivo, attempts: (anterior.attempts ?? 0) + 1 };
    const config = { ...(ig.config ?? {}), pendingCancels: pend };
    await this.db.update(integracao).set({ config }).where(eq(integracao.id, ig.id));
    ig.config = config;
    this.logger.warn(`cancel ${orderId.slice(0, 8)} pendente (reconciliação vai reenviar)`);
  }

  private async limparCancelPendente(ig: IntegIfood, orderId: string): Promise<void> {
    if (!ig.config?.pendingCancels?.[orderId]) return;
    const pend = { ...ig.config.pendingCancels };
    delete pend[orderId];
    const config = { ...(ig.config ?? {}), pendingCancels: pend };
    await this.db.update(integracao).set({ config }).where(eq(integracao.id, ig.id));
    ig.config = config;
  }

  // Reenvia os cancelamentos pendentes de uma loja (chamado pelo poller a cada 30s).
  // Desiste após 20 tentativas (log), pra não reenviar eternamente.
  async reconciliarCancels(ig: IntegIfood): Promise<number> {
    const pend = { ...(ig.config?.pendingCancels ?? {}) };
    const ids = Object.keys(pend);
    if (!ids.length) return 0;
    let mudou = false;
    let feitos = 0;
    for (const orderId of ids) {
      const p = pend[orderId];
      if ((p.attempts ?? 0) >= 20) {
        delete pend[orderId];
        mudou = true;
        this.logger.warn(`cancel ${orderId.slice(0, 8)} DESISTIDO após 20 tentativas`);
        continue;
      }
      const ok = await this.cancelar(ig, orderId, p.motivo);
      if (ok) {
        delete pend[orderId];
        feitos++;
      } else {
        p.attempts = (p.attempts ?? 0) + 1;
        pend[orderId] = p;
      }
      mudou = true;
    }
    if (mudou) {
      const config = { ...(ig.config ?? {}), pendingCancels: pend };
      await this.db.update(integracao).set({ config }).where(eq(integracao.id, ig.id));
      ig.config = config;
    }
    return feitos;
  }
}
