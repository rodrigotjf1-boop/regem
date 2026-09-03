import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../../db/drizzle.module';
import { integracao } from '../../../db/schema';
import { DeliveryService } from '../../delivery/delivery.service';
import { fetchExterno } from '../../../common/fetch-externo';

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
// Domínio migrado didi-food.com → 99food.com (changelog 29/04/2026; o antigo morreu
// em 29/05/2026). Env FOOD99_BASE_URL sobrepõe se precisar.
const BASE = process.env.FOOD99_BASE_URL ?? 'https://openapi.99food.com';
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

  // App de PRODUÇÃO: app_id/app_secret são GLOBAIS (1 app da SISTER p/ TODAS as
  // lojas) e vêm do ambiente (FOOD99_APP_ID / FOOD99_APP_SECRET). Fallback: credencial
  // por tenant no banco (modelo de teste). Por loja guardamos só o app_shop_id
  // (merchantId = UUID que o 99food gera no vínculo) + auth_token (cache).
  private appIdEnv(): string {
    return (process.env.FOOD99_APP_ID ?? '').trim();
  }
  private appSecretEnv(): string {
    return (process.env.FOOD99_APP_SECRET ?? '').trim();
  }

  private mapRow(r: any): IntegFood99 | null {
    if (!r || !r.merchantId) return null;
    const appId = this.appIdEnv() || (r.clientId ? String(r.clientId).trim() : '');
    const appSecret = this.appSecretEnv() || (r.clientSecret ? String(r.clientSecret).trim() : '');
    if (!appId || !appSecret) return null;
    return {
      id: r.id,
      tenantId: r.tenantId,
      unidadeId: r.unidadeId ?? null,
      appId,
      appSecret,
      appShopId: String(r.merchantId).trim(),
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
    const config = { ...(ig.config ?? {}), tokenExp: expMs, lastAuthErrno: null };
    await this.db.update(integracao).set({ token, config }).where(eq(integracao.id, ig.id));
    ig.token = token;
    ig.config = config;
  }

  // Registra o último erro de auth (errno do get/refresh) no config e zera o token,
  // p/ o /status refletir a saúde REAL do auth sem forçar uma chamada a cada poll.
  private async persistAuthErro(ig: IntegFood99, errno: number): Promise<void> {
    const config = { ...(ig.config ?? {}), tokenExp: 0, lastAuthErrno: errno };
    await this.db.update(integracao).set({ token: null, config }).where(eq(integracao.id, ig.id));
    ig.token = null;
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
      const res = await fetchExterno(`${BASE}/v1/auth/authtoken/get?${q}`, { method: 'GET' });
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
  // buscá-lo com authtoken/get. Loga o errno da resposta (10101 = "store authorization
  // information does not exist" → loja não provisionada no v1 do 99food, apesar de
  // aparecer bound no getAuthorizedShops v3 → ticket no 99food).
  private async refreshToken(ig: IntegFood99): Promise<number> {
    try {
      const q = new URLSearchParams({
        app_id: ig.appId,
        app_secret: ig.appSecret,
        app_shop_id: ig.appShopId,
      }).toString();
      const res = await fetchExterno(`${BASE}/v1/auth/authtoken/refresh?${q}`, { method: 'GET' }).catch(() => null);
      const j: any = res ? await res.json().catch(() => ({ errno: -1 })) : { errno: -1 };
      const errno = Number(j?.errno ?? -1);
      if (errno !== 0) {
        this.logger.warn(`authtoken/refresh loja=${ig.appShopId} errno=${errno}: ${String(j?.errmsg ?? '').slice(0, 120)}`);
      }
      return errno;
    } catch (e: any) {
      this.logger.warn(`authtoken/refresh falhou: ${e?.message ?? e}`);
      return -1;
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
      await this.persistAuthErro(ig, r.errno);
      return null;
    }
    await this.persistToken(ig, r.token, r.exp || Date.now() + 10 * 60 * 1000);
    return r.token;
  }

  // ===== Onboarding self-service (produção) =====
  // O lojista NÃO digita credencial. Ele autoriza a loja pelo link do getUrl; o
  // 99food avisa por webhook shopBindStatus; a gente atribui ao tenant que clicou
  // "Conectar" e ele confirma o nome da loja. app_id/app_secret são globais (env).

  // Token EFÊMERO (não persiste) para uma loja recém-vinculada ainda sem linha própria.
  private async tokenEfemero(appShopId: string): Promise<string | null> {
    const appId = this.appIdEnv();
    const appSecret = this.appSecretEnv();
    if (!appId || !appSecret) return null;
    const r = await this.fetchTokenGet({ appId, appSecret, appShopId, config: {} } as any);
    return r.errno === 0 && r.token ? r.token : null;
  }

  // GET /v1/shop/shop/detail — nome/endereço da loja (usa auth_token).
  private async shopDetail(appShopId: string): Promise<any | null> {
    const tk = await this.tokenEfemero(appShopId);
    if (!tk) return null;
    const q = new URLSearchParams({ auth_token: tk }).toString();
    const res = await fetchExterno(`${BASE}/v1/shop/shop/detail?${q}`, { method: 'GET' }).catch(() => null);
    const j: any = res ? await res.json().catch(() => null) : null;
    return j?.errno === 0 ? j.data : null;
  }

  // Gera o link de autorização (getUrl) p/ o lojista conectar a loja 99food dele ao
  // NOSSO app. Só precisa do app_id (global). Marca bindPending no tenant p/ atribuir
  // o shopBindStatus que vier a seguir.
  async conectar(tenantId: string, unidadeId: string | null): Promise<{ url: string }> {
    const appId = this.appIdEnv();
    if (!appId) throw new BadRequestException('99Food não configurado no servidor (defina FOOD99_APP_ID/FOOD99_APP_SECRET).');
    const [ex] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL)));
    const config = { ...((ex?.config as any) ?? {}), bindPending: Date.now() };
    if (ex) {
      await this.db.update(integracao).set({ config, ...(unidadeId ? { unidadeId } : {}), updatedAt: new Date() }).where(eq(integracao.id, ex.id));
    } else {
      await this.db.insert(integracao).values({ tenantId, unidadeId, canal: CANAL, ativo: false, config });
    }
    // app_id é 64-bit → LITERAL no corpo (bigint-safe).
    const res = await fetchExterno(`${BASE}/v1/auth/authorizationpage/getUrl`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: `{"app_id":${appId}}`,
    }).catch(() => null);
    const j: any = res ? await res.json().catch(() => ({ errno: -1 })) : { errno: -1 };
    if (j?.errno !== 0 || !j?.data?.url) {
      this.logger.warn(`getUrl errno=${j?.errno}: ${JSON.stringify(j).slice(0, 160)}`);
      throw new BadRequestException(`99Food recusou gerar o link (errno ${j?.errno}).`);
    }
    return { url: j.data.url };
  }

  // Webhook shopBindStatus: o lojista autorizou (ou desvinculou) a loja pelo link.
  // data.appShopIDList = UUID(s) da loja no nosso app; data.bindStatus = bind|unbind.
  private async tratarBind(raw: string): Promise<void> {
    const bindStatus = ((raw.match(/"bindStatus"\s*:\s*"?(bind|unbind)"?/i) || [])[1] || '').toLowerCase();
    const lista = (raw.match(/"appShopIDList"\s*:\s*\[([^\]]*)\]/) || [])[1] || '';
    const uuids = (lista.match(/"([^"]+)"/g) || []).map((s) => s.replace(/"/g, ''));
    if (!uuids.length) {
      this.logger.warn('shopBindStatus sem appShopIDList');
      return;
    }
    if (bindStatus === 'unbind') {
      for (const u of uuids) {
        const [row] = await this.db.select().from(integracao).where(and(eq(integracao.canal, CANAL), eq(integracao.merchantId, u)));
        if (row) await this.db.update(integracao).set({ ativo: false, token: null, updatedAt: new Date() }).where(eq(integracao.id, row.id));
      }
      this.logger.log(`shopBindStatus unbind: ${uuids.join(',')}`);
      return;
    }
    // bind: atribui ao tenant que clicou "Conectar" mais recentemente e guarda a loja
    // para ELE confirmar (nome/endereço) — evita atribuir à loja errada.
    const alvo = await this.tenantBindPendente();
    if (!alvo) {
      this.logger.warn(`shopBindStatus bind ${uuids.join(',')} sem tenant aguardando (ignora)`);
      return;
    }
    const u = uuids[0];
    const detail = await this.shopDetail(u).catch(() => null);
    const nome = detail?.shop_name ?? detail?.name ?? null;
    const addr = detail?.shop_addr ?? detail?.address ?? null;
    const config = { ...((alvo.config as any) ?? {}), pendingBind: { appShopId: u, nome, addr }, bindPending: null };
    await this.db.update(integracao).set({ config, updatedAt: new Date() }).where(eq(integracao.id, alvo.id));
    this.logger.log(`shopBindStatus bind ${u} → tenant ${alvo.tenant_id ?? alvo.tenantId} (aguarda confirmação: ${nome ?? '?'})`);
  }

  // Assinatura de request (endpoints v3 de auth/store SEM auth_token): ordena as
  // chaves A→Z, monta "k=v" unido por "&", concatena o app_secret no fim, MD5.
  // (Algoritmo "List Bind Stores" da doc.) app_id vai como string decimal (bigint-safe).
  private assinarRequest(params: Record<string, string | number>): string {
    const secret = this.appSecretEnv();
    const keys = Object.keys(params)
      .filter((k) => k !== 'sign' && params[k] !== '' && params[k] !== null && params[k] !== undefined)
      .sort();
    const base = keys.map((k) => `${k}=${params[k]}`).join('&') + secret;
    return createHash('md5').update(base).digest('hex');
  }

  // POST /v3/auth/authorization/getAuthorizedShops — lista as lojas autorizadas ao
  // nosso app (independe do webhook shopBindStatus). Paginado. app_id LITERAL no corpo.
  private async getAuthorizedShops(): Promise<Array<{ appShopId: string; nome: string | null }>> {
    const appId = this.appIdEnv();
    const secret = this.appSecretEnv();
    if (!appId || !secret) return [];
    const out: Array<{ appShopId: string; nome: string | null }> = [];
    for (let page = 1; page <= 10; page++) {
      const ts = Math.floor(Date.now() / 1000);
      const sign = this.assinarRequest({ app_id: appId, page_no: page, page_size: 50, timestamp: ts });
      const body = `{"app_id":${appId},"page_no":${page},"page_size":50,"timestamp":${ts},"sign":${JSON.stringify(sign)}}`;
      const res = await fetchExterno(`${BASE}/v3/auth/authorization/getAuthorizedShops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      }).catch(() => null);
      const j: any = res ? await res.json().catch(() => ({ errno: -1 })) : { errno: -1 };
      if (j?.errno !== 0) {
        this.logger.warn(`getAuthorizedShops errno=${j?.errno}: ${JSON.stringify(j).slice(0, 160)}`);
        break;
      }
      const d = j?.data ?? {};
      const shops: any[] = d.shops ?? d.list ?? d.shop_list ?? d.shop_infos ?? (Array.isArray(d) ? d : []);
      for (const s of shops) {
        const id = String(s.app_shop_id ?? s.appShopId ?? '');
        if (id) out.push({ appShopId: id, nome: s.shop_name ?? s.name ?? null });
      }
      if (shops.length < 50) break;
    }
    return out;
  }

  // Lojas autorizadas ao app que AINDA não estão vinculadas a nenhum tenant do Regem
  // (o lojista escolhe a dele). Enriquecemos o nome via shop/detail se faltar.
  async lojasAutorizadas(_tenantId: string): Promise<{ lojas: Array<{ appShopId: string; nome: string | null }> }> {
    const todas = await this.getAuthorizedShops();
    const claimed = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.canal, CANAL), eq(integracao.ativo, true)));
    const claimedIds = new Set(claimed.map((r: any) => String(r.merchantId)));
    const livres = todas.filter((s) => !claimedIds.has(s.appShopId));
    for (const s of livres) {
      if (!s.nome) s.nome = (await this.shopDetail(s.appShopId).catch(() => null))?.shop_name ?? null;
    }
    return { lojas: livres };
  }

  // Linha 99food com bindPending mais recente (o lojista que acabou de clicar Conectar).
  private async tenantBindPendente(): Promise<any | null> {
    const r: any = await this.db.execute(sql`
      select * from integracao
      where canal = ${CANAL} and (config->>'bindPending') is not null
      order by (config->>'bindPending')::bigint desc
      limit 1
    `);
    return (r?.rows ?? r)?.[0] ?? null;
  }

  // Confirma o vínculo (o lojista disse "é a minha loja"): grava o app_shop_id,
  // ativa, liga cancel/refund do cliente e ajusta o aceite p/ API.
  async vincular(tenantId: string, appShopId: string): Promise<{ ok: boolean }> {
    const [row] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL)));
    if (!row) throw new BadRequestException('Nada para vincular — clique em "Conectar com 99Food" primeiro.');
    const pend = (row.config as any)?.pendingBind;
    const alvoId = appShopId || pend?.appShopId;
    if (!alvoId) throw new BadRequestException('Nenhuma loja recém-vinculada para confirmar.');
    // nome: do webhook (pendingBind) ou busca no shop/detail (fluxo pull getAuthorizedShops).
    let nome = pend?.appShopId === alvoId ? pend?.nome ?? null : null;
    if (!nome) nome = (await this.shopDetail(alvoId).catch(() => null))?.shop_name ?? null;
    const config = { ...((row.config as any) ?? {}), tokenExp: 0, shopName: nome, pendingBind: null, bindPending: null };
    await this.db.update(integracao).set({ merchantId: alvoId, ativo: true, token: null, config, updatedAt: new Date() }).where(eq(integracao.id, row.id));
    const ig = await this.integracaoDoTenant(tenantId);
    if (ig) {
      await this.configurarApply(ig, true, true).catch(() => false);
      await this.definirAceiteApi(ig).catch(() => false);
    }
    return { ok: true };
  }

  // Descarta a loja recém-vinculada oferecida (não era a do lojista).
  async recusarBind(tenantId: string): Promise<{ ok: boolean }> {
    const [row] = await this.db.select().from(integracao).where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL)));
    if (row) {
      const config = { ...((row.config as any) ?? {}), pendingBind: null };
      await this.db.update(integracao).set({ config, updatedAt: new Date() }).where(eq(integracao.id, row.id));
    }
    return { ok: true };
  }

  // POST setconfirmmethod {auth_token, order_confirm_method:2} — aceite via API.
  private async definirAceiteApi(ig: IntegFood99): Promise<boolean> {
    const tk = await this.authToken(ig);
    if (!tk) return false;
    const j = await this.postJson('/v1/shop/shop/setconfirmmethod', tk, ['"order_confirm_method":2']);
    if (j?.errno !== 0) this.logger.warn(`setconfirmmethod loja=${ig.appShopId} errno=${j?.errno}`);
    return j?.errno === 0;
  }

  // ===== Pedido =====
  async pedido(ig: IntegFood99, orderId: string): Promise<any | null> {
    const tk = await this.authToken(ig);
    if (!tk) return null;
    const q = new URLSearchParams({ auth_token: tk, order_id: orderId }).toString();
    const res = await fetchExterno(`${BASE}/v1/order/order/detail?${q}`, { method: 'GET' }).catch(() => null);
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
    const res = await fetchExterno(`${BASE}/v1/order/order/confirm`, {
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
    const res = await fetchExterno(`${BASE}/v1/order/order/ready?${q}`, { method: 'GET' }).catch(() => null);
    const j: any = res ? await res.json().catch(() => ({ errno: -1 })) : { errno: -1 };
    return j?.errno === 0;
  }

  // GET delivered — conclusão (só self-delivery).
  async entregue(ig: IntegFood99, orderId: string): Promise<boolean> {
    if (!this.soDigitos(orderId)) return false;
    const tk = await this.authToken(ig);
    if (!tk) return false;
    const q = new URLSearchParams({ auth_token: tk, order_id: orderId }).toString();
    const res = await fetchExterno(`${BASE}/v1/order/order/delivered?${q}`, { method: 'GET' }).catch(() => null);
    const j: any = res ? await res.json().catch(() => ({ errno: -1 })) : { errno: -1 };
    return j?.errno === 0;
  }

  // POST body JSON bigint-safe (order_id/apply_id como LITERAIS, nunca via JSON.stringify).
  private async postJson(caminho: string, tk: string, campos: string[]): Promise<any> {
    const body = `{${[`"auth_token":${JSON.stringify(tk)}`, ...campos].join(',')}}`;
    const res = await fetchExterno(`${BASE}${caminho}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => null);
    return res ? await res.json().catch(() => ({ errno: -1 })) : { errno: -1 };
  }

  // POST /v1/order/selfdelivery/verifyDeliveryCode {auth_token, order_id, takeaway_code}
  // — self-delivery (changelog 23/07): valida o código do cliente → pedido vira 600.
  async verificarCodigoEntrega(ig: IntegFood99, orderId: string, codigo: string): Promise<{ ok: boolean; errno: number }> {
    if (!this.soDigitos(orderId)) return { ok: false, errno: -1 };
    const tk = await this.authToken(ig);
    if (!tk) return { ok: false, errno: -1 };
    const j = await this.postJson('/v1/order/selfdelivery/verifyDeliveryCode', tk, [
      `"order_id":${orderId}`,
      `"takeaway_code":${JSON.stringify(String(codigo))}`,
    ]);
    if (j?.errno === 0) this.logger.log(`verifyDeliveryCode ${orderId} OK`);
    else this.logger.warn(`verifyDeliveryCode ${orderId} errno=${j?.errno}`);
    return { ok: j?.errno === 0, errno: Number(j?.errno ?? -1) };
  }

  // POST /v1/shop/apply/set — LIGA o recebimento de cancelamento/reembolso do cliente
  // (é o que dispara orderCancelApply/orderRefundApply). receive_*: 0=não, 1=sim.
  async configurarApply(ig: IntegFood99, receberCancel: boolean, receberRefund: boolean): Promise<boolean> {
    const tk = await this.authToken(ig);
    if (!tk) return false;
    const j = await this.postJson('/v1/shop/apply/set', tk, [
      `"receive_cancel_apply":${receberCancel ? 1 : 0}`,
      `"receive_refund_apply":${receberRefund ? 1 : 0}`,
    ]);
    if (j?.errno !== 0) this.logger.warn(`apply/set loja=${ig.appShopId} errno=${j?.errno}`);
    return j?.errno === 0;
  }

  // POST /v1/order/apply/cancel — responde ao cancelamento PEDIDO PELO CLIENTE
  // (webhook orderCancelApply). agree=true aceita; false recusa (com reason).
  // ⚠️ Os nomes dos campos (agree_type/reason) precisam ser confirmados na doc
  // "Order Cancel Apply" — se der errno de parâmetro no Sandbox, ajustar aqui.
  async responderCancelamento(
    ig: IntegFood99,
    orderId: string,
    applyId: string,
    agree: boolean,
    reason?: string,
  ): Promise<{ ok: boolean; errno: number }> {
    if (!this.soDigitos(orderId) || !this.soDigitos(applyId)) return { ok: false, errno: -1 };
    const tk = await this.authToken(ig);
    if (!tk) return { ok: false, errno: -1 };
    const campos = [`"order_id":${orderId}`, `"apply_id":${applyId}`, `"agree_type":${agree ? 1 : 2}`];
    if (reason) campos.push(`"reason":${JSON.stringify(reason)}`);
    const j = await this.postJson('/v1/order/apply/cancel', tk, campos);
    this.logger.log(`apply/cancel ${orderId} agree=${agree} errno=${j?.errno}`);
    return { ok: j?.errno === 0, errno: Number(j?.errno ?? -1) };
  }

  // POST /v1/order/apply/refund — responde ao reembolso pedido pelo cliente
  // (webhook orderRefundApply). Mesma ressalva de campos que o apply/cancel.
  async responderReembolso(
    ig: IntegFood99,
    orderId: string,
    applyId: string,
    agree: boolean,
    reason?: string,
  ): Promise<{ ok: boolean; errno: number }> {
    if (!this.soDigitos(orderId) || !this.soDigitos(applyId)) return { ok: false, errno: -1 };
    const tk = await this.authToken(ig);
    if (!tk) return { ok: false, errno: -1 };
    const campos = [`"order_id":${orderId}`, `"apply_id":${applyId}`, `"agree_type":${agree ? 1 : 2}`];
    if (reason) campos.push(`"reason":${JSON.stringify(reason)}`);
    const j = await this.postJson('/v1/order/apply/refund', tk, campos);
    this.logger.log(`apply/refund ${orderId} agree=${agree} errno=${j?.errno}`);
    return { ok: j?.errno === 0, errno: Number(j?.errno ?? -1) };
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
    const res = await fetchExterno(`${BASE}/v1/order/order/cancel`, {
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

  // Liga na loja o recebimento de cancelamento/reembolso do cliente (apply/set) —
  // é o que faz o 99food enviar orderCancelApply/orderRefundApply.
  async ativarApply(tenantId: string, cancel = true, refund = true): Promise<{ ok: boolean }> {
    const ig = await this.integracaoDoTenant(tenantId);
    if (!ig) throw new BadRequestException('99Food não configurado para esta loja.');
    return { ok: await this.configurarApply(ig, cancel, refund) };
  }

  // Confirma a entrega self-delivery pelo código do cliente (verifyDeliveryCode → 600).
  async verificarEntregaPorTenant(tenantId: string, orderId: string, codigo: string): Promise<{ ok: boolean; errno: number }> {
    const ig = await this.integracaoDoTenant(tenantId);
    if (!ig) throw new BadRequestException('99Food não configurado para esta loja.');
    return this.verificarCodigoEntrega(ig, orderId, codigo);
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

  // Verificação da assinatura do webhook: didi-header-sign = MD5(corpo_cru + app_secret).
  // true = íntegro. Sem sign/secret → false (não dá pra verificar).
  private assinaturaOk(raw: string, appSecret: string, sign?: string): boolean {
    if (!sign || !appSecret) return false;
    const esperado = createHash('md5').update(raw + appSecret).digest('hex');
    return esperado.toLowerCase() === String(sign).toLowerCase();
  }

  // ===== Webhook do 99food =====
  // Recebe o CORPO CRU (string) + a assinatura (didi-header-sign). order_id/apply_id
  // são 64-bit: extraídos por regex como STRING (nunca JSON.parse) pra não corromper.
  // Switch por TIPO EXATO (orderNew, orderCancelApply, …). Responde StandardResponse
  // errno:0 (senão o 99food reenvia).
  async processarWebhook(raw: string, sign?: string): Promise<{ errno: number; errmsg: string }> {
    const orderId = (raw.match(/"order_id"\s*:\s*"?(\d+)"?/) || [])[1];
    const applyId = (raw.match(/"apply_id"\s*:\s*"?(\d+)"?/) || [])[1];
    const appShopId = (raw.match(/"app_shop_id"\s*:\s*"?([^",}\s]+)"?/) || [])[1];
    const type = (raw.match(/"(?:type|event|event_type|msg_type)"\s*:\s*"?([a-zA-Z_]+)"?/) || [])[1] || '';
    const ev = type.toLowerCase();
    this.logger.log(`webhook type=${type || '?'} order=${orderId ?? '?'} shop=${appShopId ?? '?'} raw=${raw.slice(0, 300)}`);

    // Vínculo/desvínculo de loja (produção): não depende de loja ativa; o app_shop_id
    // vem em data.appShopIDList, não no topo. Assinatura conferida com o secret GLOBAL.
    if (ev === 'shopbindstatus') {
      if (!this.assinaturaOk(raw, this.appSecretEnv(), sign)) {
        this.logger.warn('shopBindStatus: assinatura inválida');
        if (process.env.FOOD99_REQUIRE_SIGN === 'true') return { errno: 0, errmsg: 'bad-sign' };
      }
      await this.tratarBind(raw).catch((e) => this.logger.warn(`tratarBind: ${e?.message ?? e}`));
      return { errno: 0, errmsg: 'ok' };
    }

    const ig = await this.porAppShopId(appShopId);
    if (!ig) {
      this.logger.warn('webhook: loja 99food não resolvida (app_shop_id?)');
      return { errno: 0, errmsg: 'no-store' };
    }

    // Segurança (CL-3, auditoria ago/2026): EXIGE assinatura válida por padrão —
    // só tolera se FOOD99_REQUIRE_SIGN='false' for setado explicitamente (ex.: um
    // ambiente de homologação). Sem assinatura válida NÃO processa: um POST forjado
    // poderia cancelar/concluir pedidos legítimos ou injetar pedido pelo corpo.
    const exigeSign = process.env.FOOD99_REQUIRE_SIGN !== 'false';
    if (!this.assinaturaOk(raw, ig.appSecret, sign)) {
      this.logger.warn(`webhook: assinatura inválida (loja=${ig.appShopId})`);
      if (exigeSign) return { errno: 0, errmsg: 'bad-sign' };
    }

    try {
      if (ev === 'ordercancelapply') {
        // Cliente pediu cancelamento → aceitamos (homologação). O orderCancel seguinte
        // reflete o pedido como cancelado. (FOOD99_APPLY_CANCEL=refuse recusa.)
        if (applyId) {
          const agree = process.env.FOOD99_APPLY_CANCEL !== 'refuse';
          await this.responderCancelamento(ig, orderId!, applyId, agree, agree ? undefined : 'store cannot fulfill');
        }
      } else if (ev === 'orderrefundapply') {
        if (applyId) {
          const agree = process.env.FOOD99_APPLY_REFUND !== 'refuse';
          await this.responderReembolso(ig, orderId!, applyId, agree, agree ? undefined : 'store refuses');
        }
      } else if (ev === 'ordercancel' || ev === 'orderpartialcancel') {
        if (orderId) await this.delivery.refletirStatusExterno(ig.tenantId, CANAL, orderId, 'cancelado');
      } else if (ev === 'orderfinish') {
        if (orderId) await this.delivery.refletirStatusExterno(ig.tenantId, CANAL, orderId, 'concluido');
      } else if (ev === 'ordernew' || (!ev && orderId)) {
        // orderNew: ingere. Primário = GET detail; fallback = data.order_info do corpo.
        if (orderId) await this.ingerirNovo(ig, orderId, raw);
      } else if (ev === 'orderconfirm' || ev === 'orderready' || ev === 'deliverystatus') {
        // Ecos do nosso próprio status / progresso de entrega — só reconhece.
        this.logger.log(`webhook: ${type} order=${orderId} (ack)`);
      } else {
        // shopStatus, shopBindStatus, imageAuditStatus, uploadMenuTaskStatus,
        // autoOnlineResult… — reconhece (nada a fazer no fluxo de pedido por ora).
        this.logger.log(`webhook: evento ${type} reconhecido (sem ação)`);
      }
    } catch (e: any) {
      this.logger.warn(`webhook ${type} ${orderId}: ${e?.message ?? e}`);
    }
    return { errno: 0, errmsg: 'ok' };
  }

  // Ingestão de um pedido novo (orderNew): detail como primário, corpo como fallback.
  private async ingerirNovo(ig: IntegFood99, orderId: string, raw: string): Promise<void> {
    const unidadeId = await this.unidadeDestino(ig.tenantId, ig.unidadeId);
    // CL-3: ingere SOMENTE do GET detail autenticado — nunca do corpo do webhook
    // (forjável). Se o detail não retornar agora, o poller reconcilia depois.
    const order: any = await this.pedido(ig, orderId);
    if (!order) {
      this.logger.warn(
        `webhook: pedido ${orderId} sem detail autenticado — ignorando corpo (poller reconcilia)`,
      );
      return;
    }
    await this.delivery.ingest(
      ig.tenantId,
      unidadeId,
      CANAL,
      { ...order, order_id: orderId }, // externalId string (bigint-safe)
      { taxaEntrega: (Number(order?.price?.delivery_price) || 0) / 100 },
    );
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
    const [row] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL)));
    const ig = this.mapRow(row);
    const cfg = (row?.config as any) ?? {};
    const tokenExp = Number(cfg.tokenExp ?? 0);
    const autenticado = !!row?.token && tokenExp > Date.now(); // saúde REAL do auth 99food
    return {
      conectado: !!ig && !!row?.ativo,
      configurado: !!this.appIdEnv() || !!row?.clientId, // servidor tem app configurado
      autenticado, // token vigente e válido — NÃO só a flag ativo (evita falso positivo)
      ultimoErroAuth: cfg.lastAuthErrno ?? null, // errno do último get/refresh que falhou (ex.: 10101)
      tokenExpiraEm: tokenExp ? new Date(tokenExp).toISOString() : null,
      appShopId: ig?.appShopId ?? null,
      shopName: cfg.shopName ?? null,
      pendingBind: cfg.pendingBind ?? null, // loja recém-vinculada aguardando confirmação
      pendentesCancel: Object.keys(cfg.pendingCancels ?? {}).length,
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
      items: [{ app_item_id: appItemId, item_name: 'X-Burger Teste', price: 2500, is_sold_separately: true }],
      modifier_groups: [],
    };
    // Menu é v3 (a v1 saiu junto com a migração de domínio) — mesma forma do export.
    const res = await fetchExterno(`${BASE}/v3/item/item/upload`, {
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
    const { categorias, produtos } = await this.delivery.lerCatalogoParaExport(tenantId, '99food');
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
    const res = await fetchExterno(`${BASE}/v3/item/item/upload`, {
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
    // Desvincula a loja no 99food também (best-effort), depois desativa localmente.
    const ativo = await this.integracaoDoTenant(tenantId);
    if (ativo) {
      const tk = await this.authToken(ativo).catch(() => null);
      if (tk) {
        await fetchExterno(`${BASE}/v1/shop/shop/unbind?${new URLSearchParams({ auth_token: tk }).toString()}`, { method: 'GET' }).catch(() => {});
      }
    }
    const [row] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL)));
    if (!row) return { ok: true };
    await this.db
      .update(integracao)
      .set({ ativo: false, token: null, config: {}, updatedAt: new Date() })
      .where(eq(integracao.id, row.id));
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
