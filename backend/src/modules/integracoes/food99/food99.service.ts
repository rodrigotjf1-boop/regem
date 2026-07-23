import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../../db/drizzle.module';
import { integracao } from '../../../db/schema';
import { DeliveryService } from '../../delivery/delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Cliente da API do 99Food / DiDi Food (openapi.didi-food.com). É a API
// PROPRIETÁRIA do DiDi (NÃO é Open Delivery, apesar do 99food também falar
// Open Delivery na Abrasel). Diferenças-chave em relação ao iFood:
//  - Recebe pedido por WEBHOOK/push (orderNew/orderCancel/orderFinish) no callback
//    público — não por polling. Precisa de URL pública (nuvem).
//  - Auth por LOJA: auth_token obtido com (app_id + app_secret + app_shop_id),
//    cache até expirar, refresh 1x/2min, erro 10102 = expirado.
//  - Status back com auth_token+order_id no corpo/query. Cancel usa reason_id (enum).
//  - IDs de pedido são inteiro 64-bit (long): o order_id NUNCA passa por
//    JSON.parse (corromperia) — extraímos como STRING do corpo cru e injetamos
//    literal nos JSON de saída.
// Guardamos por integração (canal '99food'):
//   clientId = app_id · clientSecret = app_secret · merchantId = app_shop_id
//   token = auth_token (cache) · config.tokenExp = validade (ms)
//   config.pendingCancels = { [orderId]: { reasonId, reason, attempts } }  (blindagem)
const CANAL = '99food';
const BASE = process.env.FOOD99_BASE_URL ?? 'https://openapi.didi-food.com';
// reason_id padrão de cancelamento (enum 99food: 1010/1020/1030/1040/1050/1060/1080).
// 1010 = problema no estabelecimento (ajustar quando tivermos os labels oficiais).
const CANCEL_REASON_PADRAO = Number(process.env.FOOD99_CANCEL_REASON ?? 1010);

export interface IntegFood99 {
  id: string;
  tenantId: string;
  unidadeId: string | null;
  appId: string;
  appSecret: string;
  appShopId: string;
  token: string | null;
  config: any;
}

@Injectable()
export class Food99Service {
  private readonly logger = new Logger('99Food');
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // forwardRef dos dois lados: DeliveryService injeta este serviço (status back).
    @Inject(forwardRef(() => DeliveryService))
    private readonly delivery: DeliveryService,
  ) {}

  private mapRow(r: any): IntegFood99 | null {
    if (!r || !r.clientId || !r.clientSecret || !r.merchantId) return null;
    return {
      id: r.id,
      tenantId: r.tenantId,
      unidadeId: r.unidadeId ?? null,
      appId: (r.clientId as string).trim(),
      appSecret: (r.clientSecret as string).trim(),
      appShopId: (r.merchantId as string).trim(),
      token: r.token,
      config: r.config ?? {},
    };
  }

  // Integrações 99food ativas (todas as lojas) — usado pelo poller de reconciliação.
  async integracoesAtivas(): Promise<IntegFood99[]> {
    const rows = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.canal, CANAL), eq(integracao.ativo, true)));
    return rows.map((r) => this.mapRow(r)).filter((x): x is IntegFood99 => !!x);
  }

  // Integração 99food de um tenant (para o status back a partir do kanban).
  async integracaoDoTenant(tenantId: string): Promise<IntegFood99 | null> {
    const [r] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL), eq(integracao.ativo, true)));
    return this.mapRow(r);
  }

  // Resolve a loja pelo app_shop_id (chega no webhook). Se só há uma loja ativa,
  // usa ela (webhook sem app_shop_id identificável).
  private async porAppShopId(appShopId: string | undefined): Promise<IntegFood99 | null> {
    const ativos = await this.integracoesAtivas();
    if (appShopId) {
      const alvo = ativos.find((x) => x.appShopId === appShopId);
      if (alvo) return alvo;
    }
    return ativos.length === 1 ? ativos[0] : null;
  }

  // ===== Auth (auth_token por loja, cache + refresh) =====
  private async persistToken(ig: IntegFood99, token: string, expMs: number): Promise<void> {
    const config = { ...(ig.config ?? {}), tokenExp: expMs };
    await this.db.update(integracao).set({ token, config }).where(eq(integracao.id, ig.id));
    ig.token = token;
    ig.config = config;
  }

  // GET authtoken/get: read-only. Retorna o token vigente; errno 10102 = expirado.
  private async fetchTokenGet(ig: IntegFood99): Promise<{ token?: string; exp?: number; errno: number }> {
    try {
      const q = new URLSearchParams({
        app_id: ig.appId,
        app_secret: ig.appSecret,
        app_shop_id: ig.appShopId,
      }).toString();
      const res = await fetch(`${BASE}/v1/auth/authtoken/get?${q}`, { method: 'GET' });
      const j: any = await res.json().catch(() => ({ errno: -1 }));
      if (j?.errno === 0 && j?.data?.auth_token) {
        return { token: j.data.auth_token, exp: (Number(j.data.token_expiration_time) || 0) * 1000, errno: 0 };
      }
      return { errno: Number(j?.errno ?? -1) };
    } catch (e: any) {
      this.logger.warn(`authtoken/get falhou: ${e?.message ?? e}`);
      return { errno: -1 };
    }
  }

  // GET authtoken/refresh: gera um novo token (limite 1x/2min); depois é preciso
  // buscá-lo com authtoken/get.
  private async refreshToken(ig: IntegFood99): Promise<void> {
    try {
      const q = new URLSearchParams({
        app_id: ig.appId,
        app_secret: ig.appSecret,
        app_shop_id: ig.appShopId,
      }).toString();
      await fetch(`${BASE}/v1/auth/authtoken/refresh?${q}`, { method: 'GET' }).catch(() => {});
    } catch {
      /* ignora — o get subsequente decide */
    }
  }

  // auth_token válido: usa o cache; se expirou (ou errno 10102), refresh + get.
  private async authToken(ig: IntegFood99): Promise<string | null> {
    const exp = Number(ig.config?.tokenExp ?? 0);
    if (ig.token && exp > Date.now() + 60000) return ig.token;
    let r = await this.fetchTokenGet(ig);
    if (r.errno !== 0 || !r.token) {
      await this.refreshToken(ig);
      r = await this.fetchTokenGet(ig);
    }
    if (r.errno !== 0 || !r.token) {
      this.logger.warn(`sem auth_token loja=${ig.appShopId} (errno=${r.errno})`);
      return null;
    }
    await this.persistToken(ig, r.token, r.exp || Date.now() + 10 * 60 * 1000);
    return r.token;
  }

  // ===== Pedido =====
  async pedido(ig: IntegFood99, orderId: string): Promise<any | null> {
    const tk = await this.authToken(ig);
    if (!tk) return null;
    const q = new URLSearchParams({ auth_token: tk, order_id: orderId }).toString();
    const res = await fetch(`${BASE}/v1/order/order/detail?${q}`, { method: 'GET' }).catch(() => null);
    if (!res) return null;
    const j: any = await res.json().catch(() => null);
    return j?.errno === 0 ? j.data : null;
  }

  // ===== Status back (Regem → 99food) =====
  // order_id é injetado como INTEIRO LITERAL no JSON (bigint-safe). Exige dígitos.
  private soDigitos(orderId: string): boolean {
    return /^\d+$/.test(orderId);
  }

  async confirmar(ig: IntegFood99, orderId: string): Promise<boolean> {
    if (!this.soDigitos(orderId)) return false;
    const tk = await this.authToken(ig);
    if (!tk) return false;
    const body = `{"auth_token":${JSON.stringify(tk)},"order_id":${orderId}}`;
    const res = await fetch(`${BASE}/v1/order/order/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => null);
    const j: any = res ? await res.json().catch(() => ({ errno: -1 })) : { errno: -1 };
    if (j?.errno === 0) this.logger.log(`confirm ${orderId} OK`);
    else this.logger.warn(`confirm ${orderId} errno=${j?.errno}`);
    return j?.errno === 0;
  }

  // GET ready — meal prepared.
  async pronto(ig: IntegFood99, orderId: string): Promise<boolean> {
    if (!this.soDigitos(orderId)) return false;
    const tk = await this.authToken(ig);
    if (!tk) return false;
    const q = new URLSearchParams({ auth_token: tk, order_id: orderId }).toString();
    const res = await fetch(`${BASE}/v1/order/order/ready?${q}`, { method: 'GET' }).catch(() => null);
    const j: any = res ? await res.json().catch(() => ({ errno: -1 })) : { errno: -1 };
    return j?.errno === 0;
  }

  // GET delivered — conclusão (só self-delivery).
  async entregue(ig: IntegFood99, orderId: string): Promise<boolean> {
    if (!this.soDigitos(orderId)) return false;
    const tk = await this.authToken(ig);
    if (!tk) return false;
    const q = new URLSearchParams({ auth_token: tk, order_id: orderId }).toString();
    const res = await fetch(`${BASE}/v1/order/order/delivered?${q}`, { method: 'GET' }).catch(() => null);
    const j: any = res ? await res.json().catch(() => ({ errno: -1 })) : { errno: -1 };
    return j?.errno === 0;
  }

  // POST cancel {auth_token, order_id, reason_id, reason}. Retorna errno p/ a blindagem.
  private async cancelarApi(
    ig: IntegFood99,
    orderId: string,
    reasonId: number,
    reason?: string,
  ): Promise<{ ok: boolean; errno: number }> {
    if (!this.soDigitos(orderId)) return { ok: false, errno: -1 };
    const tk = await this.authToken(ig);
    if (!tk) return { ok: false, errno: -1 };
    const parts = [
      `"auth_token":${JSON.stringify(tk)}`,
      `"order_id":${orderId}`,
      `"reason_id":${reasonId}`,
    ];
    if (reason) parts.push(`"reason":${JSON.stringify(reason)}`);
    const res = await fetch(`${BASE}/v1/order/order/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: `{${parts.join(',')}}`,
    }).catch(() => null);
    const j: any = res ? await res.json().catch(() => ({ errno: -1 })) : { errno: -1 };
    const ok = j?.errno === 0;
    if (ok) this.logger.log(`cancel ${orderId} OK`);
    else this.logger.warn(`cancel ${orderId} errno=${j?.errno}`);
    return { ok, errno: Number(j?.errno ?? -1) };
  }

  // ===== Blindagem do cancel (não repetir o erro do iFood) =====
  // O cancel outbound NÃO é fire-and-forget: se a chamada falhar (rede/token/
  // errno), o pedido entra em config.pendingCancels e o poller reenvia com backoff
  // até o 99food aceitar (errno 0). Evita "cancelado local, não cancelado no 99food".
  async cancelarComBlindagem(
    tenantId: string,
    orderId: string,
    reason?: string,
    reasonId: number = CANCEL_REASON_PADRAO,
  ): Promise<void> {
    const ig = await this.integracaoDoTenant(tenantId);
    if (!ig) return;
    const r = await this.cancelarApi(ig, orderId, reasonId, reason);
    if (r.ok) await this.limparCancelPendente(ig, orderId);
    else await this.marcarCancelPendente(ig, orderId, reasonId, reason);
  }

  private async marcarCancelPendente(
    ig: IntegFood99,
    orderId: string,
    reasonId: number,
    reason?: string,
  ): Promise<void> {
    const pend = { ...(ig.config?.pendingCancels ?? {}) };
    const anterior = pend[orderId] ?? {};
    pend[orderId] = { reasonId, reason: reason ?? anterior.reason, attempts: (anterior.attempts ?? 0) + 1 };
    const config = { ...(ig.config ?? {}), pendingCancels: pend };
    await this.db.update(integracao).set({ config }).where(eq(integracao.id, ig.id));
    ig.config = config;
    this.logger.warn(`cancel ${orderId} pendente (reconciliação vai reenviar)`);
  }

  private async limparCancelPendente(ig: IntegFood99, orderId: string): Promise<void> {
    if (!ig.config?.pendingCancels?.[orderId]) return;
    const pend = { ...ig.config.pendingCancels };
    delete pend[orderId];
    const config = { ...(ig.config ?? {}), pendingCancels: pend };
    await this.db.update(integracao).set({ config }).where(eq(integracao.id, ig.id));
    ig.config = config;
  }

  // Reenvia os cancelamentos pendentes de uma loja (chamado pelo poller). Desiste
  // após 20 tentativas (log), pra não reenviar eternamente.
  async reconciliarCancels(ig: IntegFood99): Promise<number> {
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
        this.logger.warn(`cancel ${orderId} DESISTIDO após 20 tentativas`);
        continue;
      }
      const r = await this.cancelarApi(ig, orderId, p.reasonId ?? CANCEL_REASON_PADRAO, p.reason);
      if (r.ok) {
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

  // ===== Webhook (orderNew / orderCancel / orderFinish) =====
  // Recebe o CORPO CRU (string). O order_id é 64-bit: extraímos por regex como
  // STRING (nunca JSON.parse) pra não corromper. Responde rápido e ingere de forma
  // idempotente (delivery.ingest por externalId). O shape exato do payload será
  // confirmado no 1º pedido do sandbox — por isso logamos o corpo cru.
  async processarWebhook(raw: string): Promise<{ errno: number; errmsg: string }> {
    const orderId = (raw.match(/"order_id"\s*:\s*"?(\d+)"?/) || [])[1];
    const appShopId = (raw.match(/"app_shop_id"\s*:\s*"?([^",}\s]+)"?/) || [])[1];
    const event = (raw.match(/"(?:event|event_type|type|msg_type)"\s*:\s*"?([a-zA-Z_]+)"?/) || [])[1] || '';
    this.logger.log(`webhook event=${event || '?'} order=${orderId ?? '?'} shop=${appShopId ?? '?'} raw=${raw.slice(0, 300)}`);
    if (!orderId) return { errno: 0, errmsg: 'ignored' };
    const ig = await this.porAppShopId(appShopId);
    if (!ig) {
      this.logger.warn('webhook: loja 99food não resolvida (app_shop_id?)');
      return { errno: 0, errmsg: 'no-store' };
    }
    const ev = event.toLowerCase();
    try {
      if (ev.includes('cancel')) {
        await this.delivery.refletirStatusExterno(ig.tenantId, CANAL, orderId, 'cancelado');
      } else if (ev.includes('finish') || ev.includes('complete') || ev.includes('deliver')) {
        await this.delivery.refletirStatusExterno(ig.tenantId, CANAL, orderId, 'concluido');
      } else if (ev.includes('new') || ev === 'order' || ev.includes('order')) {
        // orderNew: ingere o pedido. Primário = GET detail (OrderModel no topo);
        // fallback = o pedido EMBUTIDO no webhook (data.order_info) — o Sandbox
        // avisa que o detail pode ser simulado, então não dependemos só dele.
        const unidadeId = await this.unidadeDestino(ig.tenantId, ig.unidadeId);
        let order: any = await this.pedido(ig, orderId);
        if (!order) {
          try {
            const parsed = JSON.parse(raw);
            order = parsed?.data?.order_info ?? parsed?.data ?? null;
          } catch {
            /* corpo não-JSON: ignora */
          }
        }
        if (order) {
          await this.delivery.ingest(
            ig.tenantId,
            unidadeId,
            CANAL,
            { ...order, order_id: orderId }, // externalId preciso (string, bigint-safe)
            { taxaEntrega: (Number(order?.price?.delivery_price) || 0) / 100 },
          );
        } else {
          this.logger.warn(`webhook: pedido ${orderId} sem detalhe nem corpo utilizável`);
        }
      } else {
        // Eventos não-pedido (uploadMenuTaskStatus, shopStatus…): só reconhece.
        this.logger.log(`webhook: evento ${event} ignorado`);
      }
    } catch (e: any) {
      this.logger.warn(`webhook ingest ${orderId}: ${e?.message ?? e}`);
    }
    // Resposta ao 99food. O shape exato de sucesso ("Webhooks Responses") será
    // confirmado na doc; StandardResponse errno:0 é a convenção da API deles.
    return { errno: 0, errmsg: 'success' };
  }

  // ===== Persistência das credenciais (tela do gestor) =====
  async salvarCredenciais(
    tenantId: string,
    unidadeId: string | null,
    appId: string,
    appSecret: string,
    appShopId: string,
  ): Promise<{ ok: boolean }> {
    const [existente] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL)));
    // Troca de credencial invalida o cache de token (força re-auth).
    const config = { ...((existente?.config as any) ?? {}), tokenExp: 0 };
    if (existente) {
      await this.db
        .update(integracao)
        .set({
          clientId: appId || existente.clientId,
          clientSecret: appSecret || existente.clientSecret,
          merchantId: appShopId || existente.merchantId,
          ativo: true,
          ...(unidadeId ? { unidadeId } : {}),
          token: null,
          config,
          updatedAt: new Date(),
        })
        .where(eq(integracao.id, existente.id));
    } else {
      await this.db.insert(integracao).values({
        tenantId,
        unidadeId,
        canal: CANAL,
        ativo: true,
        clientId: appId,
        clientSecret: appSecret,
        merchantId: appShopId,
        config,
      });
    }
    return { ok: true };
  }

  async status(tenantId: string) {
    const ig = await this.integracaoDoTenant(tenantId);
    return {
      conectado: !!ig,
      appShopId: ig?.appShopId ?? null,
      pendentesCancel: Object.keys(ig?.config?.pendingCancels ?? {}).length,
    };
  }

  // Retorna um auth_token FRESCO da loja — para colar na Ferramenta de Sandbox do
  // portal (que pede o token da loja de teste e ele expira). Usa as credenciais
  // salvas; se der certo, também prova que app_id/app_secret/app_shop_id estão OK.
  async tokenAtual(tenantId: string): Promise<{ ok: boolean; token: string | null; expiraEm: string | null }> {
    const ig = await this.integracaoDoTenant(tenantId);
    if (!ig) return { ok: false, token: null, expiraEm: null };
    const tk = await this.authToken(ig);
    const exp = Number(ig.config?.tokenExp ?? 0);
    return { ok: !!tk, token: tk, expiraEm: exp ? new Date(exp).toISOString() : null };
  }

  // Sobe um cardápio MÍNIMO (1 categoria + 1 item) na loja de teste, via
  // POST /v1/item/item/upload. Necessário porque a Ferramenta de Sandbox exige um
  // app_item_id existente no menu pra montar o "Crie pedido". Retorna o app_item_id
  // pra colar no Sandbox. Preços em CENTAVOS (int).
  async subirCardapioTeste(tenantId: string): Promise<{ ok: boolean; appItemId: string; errno?: number; resposta?: any }> {
    const ig = await this.integracaoDoTenant(tenantId);
    const appItemId = 'regemitem01';
    if (!ig) return { ok: false, appItemId };
    const tk = await this.authToken(ig);
    if (!tk) return { ok: false, appItemId };
    const body = {
      auth_token: tk,
      menus: [{ app_menu_id: 'regemmenu1', menu_name: 'Cardápio de teste', app_category_ids: ['regemcat1'] }],
      categories: [{ app_category_id: 'regemcat1', category_name: 'Lanches', app_item_ids: [appItemId] }],
      items: [{ app_item_id: appItemId, item_name: 'X-Burger Teste', price: 2500 }],
    };
    const res = await fetch(`${BASE}/v1/item/item/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const j: any = res ? await res.json().catch(() => ({ errno: -1 })) : { errno: -1 };
    if (j?.errno === 0) this.logger.log(`cardápio de teste subido (item=${appItemId})`);
    else this.logger.warn(`upload cardápio errno=${j?.errno}: ${JSON.stringify(j).slice(0, 200)}`);
    return { ok: j?.errno === 0, appItemId, errno: Number(j?.errno ?? -1), resposta: j };
  }

  // Exporta o cardápio do Regem PRA o 99food (upload em bloco /v3/item/item/upload).
  // Mapeia categorias+produtos disponíveis → menus/categories/items. app_item_id =
  // codigo do produto (ou id) → o pedido de volta casa pelo mesmo código. Preços em
  // CENTAVOS. Sem complementos por ora (modifier_groups: []).
  async exportarCatalogo(tenantId: string): Promise<{ categorias: number; produtos: number }> {
    const ig = await this.integracaoDoTenant(tenantId);
    if (!ig) throw new BadRequestException('Conecte o 99Food primeiro (salve as credenciais).');
    const tk = await this.authToken(ig);
    if (!tk) throw new BadRequestException('Sem auth_token do 99Food.');
    const { categorias, produtos } = await this.delivery.lerCatalogoParaExport(tenantId);
    const prods = produtos.filter((p: any) => p.categoria_id && categorias.some((c: any) => c.id === p.categoria_id));
    if (!prods.length) throw new BadRequestException('Nenhum produto (com categoria) disponível no cardápio pra exportar.');
    const codItem = (p: any) => String(p.codigo || p.id);
    const cats = categorias.filter((c: any) => prods.some((p: any) => p.categoria_id === c.id));
    const menus = [{ app_menu_id: 'regem-menu', menu_name: 'Cardápio', app_category_ids: cats.map((c: any) => `cat-${c.id}`) }];
    const categories = cats.map((c: any) => ({
      app_category_id: `cat-${c.id}`,
      category_name: String(c.nome).slice(0, 100),
      app_item_ids: prods.filter((p: any) => p.categoria_id === c.id).map(codItem),
    }));
    const items = prods.map((p: any) => ({
      app_item_id: codItem(p),
      item_name: String(p.nome).slice(0, 50),
      price: Math.round((Number(p.preco_venda) || 0) * 100),
      is_sold_separately: true,
      ...(p.descricao ? { short_desc: String(p.descricao).slice(0, 300) } : {}),
    }));
    const body = JSON.stringify({ auth_token: tk, menus, categories, items, modifier_groups: [] });
    const res = await fetch(`${BASE}/v3/item/item/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => null);
    const j: any = res ? await res.json().catch(() => ({ errno: -1 })) : { errno: -1 };
    if (j?.errno !== 0) {
      this.logger.warn(`exportarCatalogo errno=${j?.errno}: ${JSON.stringify(j).slice(0, 200)}`);
      throw new BadRequestException(`99Food recusou o upload (errno ${j?.errno}: ${String(j?.errmsg ?? '').slice(0, 120)})`);
    }
    this.logger.log(`exportarCatalogo tenant=${tenantId}: ${categories.length} cat, ${items.length} itens`);
    return { categorias: categories.length, produtos: items.length };
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

  // Puxa UM pedido pelo order_id (teste manual sem webhook). O 99food não tem
  // endpoint de "listar pedidos", então o teste é por id.
  async puxarPedido(tenantId: string, orderId: string): Promise<{ ok: boolean }> {
    const ig = await this.integracaoDoTenant(tenantId);
    if (!ig || !this.soDigitos(orderId)) return { ok: false };
    const unidadeId = await this.unidadeDestino(tenantId, ig.unidadeId);
    const detail = await this.pedido(ig, orderId);
    if (!detail) return { ok: false };
    await this.delivery.ingest(tenantId, unidadeId, CANAL, { ...detail, order_id: orderId }, {
      taxaEntrega: (Number(detail?.price?.delivery_price) || 0) / 100,
    });
    return { ok: true };
  }

  // Unidade destino do pedido: a da integração ou a matriz do tenant.
  private async unidadeDestino(tenantId: string, unidadeIg: string | null): Promise<string | null> {
    if (unidadeIg) return unidadeIg;
    const r: any = await this.db.execute(sql`
      select id from unidade
      where tenant_id = ${tenantId} and deleted_at is null
      order by (tipo = 'matriz') desc, created_at asc
      limit 1
    `);
    return (r?.rows ?? r)?.[0]?.id ?? null;
  }
}
