import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import { DRIZZLE, DrizzleDB } from '../../../db/drizzle.module';
import { integracao } from '../../../db/schema';
import { DeliveryService } from '../../delivery/delivery.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Cliente da API Aberta do Cardápio Web (docs.cardapioweb.com).
// Auth = OAuth 2.0 authorization_code + PKCE ("CW App Store"): o app "Regem" é
// aprovado na App Store, a loja instala e autoriza por consentimento (portal),
// e cada instalação gera um par access_token (2h) + refresh_token vinculado a
// (app + loja). Guardamos por integração (canal 'cardapio_web'):
//   token = access_token  ·  config.refreshToken / config.tokenExp / config.env
//   merchantId = id do estabelecimento no CW (preenchido quando conhecido)
//   config.pendingState / config.codeVerifier = PKCE em voo (entre conectar e callback)
const CANAL = 'cardapio_web';

type Ambiente = 'sandbox' | 'producao';

function bases(env: Ambiente) {
  return env === 'producao'
    ? {
        api: 'https://integracao.cardapioweb.com',
        portal: 'https://www.portal.cardapioweb.com/cw-apps',
      }
    : {
        api: 'https://integracao.sandbox.cardapioweb.com',
        portal: 'https://portal.sandbox.cardapioweb.com/cw-apps',
      };
}

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface IntegCW {
  id: string;
  tenantId: string;
  unidadeId: string | null;
  merchantId: string | null;
  token: string | null;
  config: any;
}

@Injectable()
export class CardapioWebService {
  private readonly logger = new Logger('CardapioWeb');
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // forwardRef dos dois lados: DeliveryService também injeta este serviço
    // (status back) → dependência circular resolvida no bootstrap do Nest.
    @Inject(forwardRef(() => DeliveryService))
    private readonly delivery: DeliveryService,
  ) {}

  private get env(): Ambiente {
    return (process.env.CARDAPIOWEB_ENV as Ambiente) === 'producao' ? 'producao' : 'sandbox';
  }
  private get clientId(): string {
    return process.env.CARDAPIOWEB_CLIENT_ID ?? '';
  }
  private get redirectUri(): string {
    // Deve ser IDÊNTICA à Redirect URI registrada no app do Cardápio Web.
    const base = (process.env.API_PUBLIC_URL ?? process.env.APP_URL ?? '').replace(/\/+$/, '');
    return (
      process.env.CARDAPIOWEB_REDIRECT_URI ??
      `${base}/api/v1/integracoes/cardapio-web/oauth/callback`
    );
  }

  // ===== Persistência (uma integração 'cardapio_web' por tenant) =====
  private async doTenant(tenantId: string): Promise<IntegCW | null> {
    const [r] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL)));
    if (!r) return null;
    return {
      id: r.id,
      tenantId: r.tenantId,
      unidadeId: r.unidadeId ?? null,
      merchantId: r.merchantId ?? null,
      token: r.token,
      config: r.config ?? {},
    };
  }

  private async porState(state: string): Promise<IntegCW | null> {
    // Callback é público (redirect do navegador) — achamos o tenant pelo state.
    const rows = await this.db.select().from(integracao).where(eq(integracao.canal, CANAL));
    const r = rows.find((x: any) => (x.config ?? {}).pendingState === state);
    if (!r) return null;
    return {
      id: r.id,
      tenantId: r.tenantId,
      unidadeId: r.unidadeId ?? null,
      merchantId: r.merchantId ?? null,
      token: r.token,
      config: r.config ?? {},
    };
  }

  // ===== 1) Iniciar consentimento (gera PKCE + URL do portal) =====
  async iniciarConexao(tenantId: string, unidadeId: string | null): Promise<{ url: string }> {
    if (!this.clientId) {
      throw new Error('CARDAPIOWEB_CLIENT_ID não configurado (registre o app na CW App Store).');
    }
    const state = base64url(randomBytes(24));
    const codeVerifier = base64url(randomBytes(48)); // 64 chars, dentro de 43–128
    const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
    const env = this.env;

    const existente = await this.doTenant(tenantId);
    const novaConfig = { ...(existente?.config ?? {}), env, pendingState: state, codeVerifier };
    if (existente) {
      await this.db
        .update(integracao)
        .set({ config: novaConfig, updatedAt: new Date() })
        .where(eq(integracao.id, existente.id));
    } else {
      await this.db.insert(integracao).values({
        tenantId,
        unidadeId,
        canal: CANAL,
        ativo: false,
        clientId: this.clientId,
        config: novaConfig,
      });
    }

    const p = new URLSearchParams({
      client_id: this.clientId,
      state,
      redirect_uri: this.redirectUri,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return { url: `${bases(env).portal}?${p.toString()}` };
  }

  // ===== 2) Callback: troca code → tokens e ativa a integração =====
  async concluirConexao(code: string, state: string): Promise<{ ok: boolean; tenantId?: string }> {
    const ig = await this.porState(state);
    if (!ig) {
      this.logger.warn('callback com state desconhecido');
      return { ok: false };
    }
    const env: Ambiente = (ig.config?.env as Ambiente) ?? this.env;
    const codeVerifier = ig.config?.codeVerifier as string;
    try {
      const res = await fetch(`${bases(env).api}/api/partner/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: this.clientId,
          code,
          redirect_uri: this.redirectUri,
          code_verifier: codeVerifier,
        }).toString(),
      });
      if (!res.ok) {
        this.logger.error(`token ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
        return { ok: false, tenantId: ig.tenantId };
      }
      const j: any = await res.json();
      const tokenExp = Date.now() + (Number(j.expires_in) || 7200) * 1000;
      const config = { ...(ig.config ?? {}), env, tokenExp, refreshToken: j.refresh_token, scope: j.scope };
      delete config.pendingState;
      delete config.codeVerifier;
      await this.db
        .update(integracao)
        .set({ token: j.access_token, ativo: true, config, updatedAt: new Date() })
        .where(eq(integracao.id, ig.id));
      this.logger.log(`conectado tenant=${ig.tenantId} scope=${j.scope}`);
      return { ok: true, tenantId: ig.tenantId };
    } catch (e: any) {
      this.logger.error(`callback falhou: ${e?.message ?? e}`);
      return { ok: false, tenantId: ig.tenantId };
    }
  }

  // ===== 3) Token válido (refresh reativo antes de expirar) =====
  private async tokenValido(ig: IntegCW): Promise<string | null> {
    const exp = Number(ig.config?.tokenExp ?? 0);
    if (ig.token && exp > Date.now() + 60000) return ig.token;
    const refresh = ig.config?.refreshToken as string | undefined;
    if (!refresh) return ig.token; // sem refresh: usa o que tem (pode 401 e reconectar)
    const env: Ambiente = (ig.config?.env as Ambiente) ?? this.env;
    try {
      const res = await fetch(`${bases(env).api}/api/partner/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: this.clientId,
          refresh_token: refresh,
        }).toString(),
      });
      if (!res.ok) {
        this.logger.warn(`refresh ${res.status}`);
        return ig.token;
      }
      const j: any = await res.json();
      const tokenExp = Date.now() + (Number(j.expires_in) || 7200) * 1000;
      const config = { ...(ig.config ?? {}), tokenExp, refreshToken: j.refresh_token ?? refresh };
      await this.db
        .update(integracao)
        .set({ token: j.access_token, config, updatedAt: new Date() })
        .where(eq(integracao.id, ig.id));
      ig.token = j.access_token;
      ig.config = config;
      return j.access_token;
    } catch (e: any) {
      this.logger.warn(`refresh falhou: ${e?.message ?? e}`);
      return ig.token;
    }
  }

  // true se a integração tem como autenticar (a chave/token fica na coluna token).
  private autenticavel(ig: IntegCW | null): ig is IntegCW {
    return !!(ig && ig.token);
  }

  private async req(ig: IntegCW, path: string, init: RequestInit = {}): Promise<Response> {
    const env: Ambiente = (ig.config?.env as Ambiente) ?? this.env;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((init.headers as Record<string, string>) ?? {}),
    };
    // Modo chave (X-API-KEY): a chave está em `token` e NÃO há refreshToken.
    // Modo OAuth: há refreshToken → Bearer (com refresh reativo).
    if (ig.token && !ig.config?.refreshToken) {
      headers['X-API-KEY'] = ig.token;
    } else {
      const tk = await this.tokenValido(ig);
      if (!tk) throw new Error('sem token do Cardápio Web');
      headers['Authorization'] = `Bearer ${tk}`;
    }
    return fetch(`${bases(env).api}${path}`, { ...init, headers });
  }

  // ===== 4) Pedidos (F2 usa isto no webhook/poller) =====
  async pedido(tenantId: string, orderId: string): Promise<any | null> {
    const ig = await this.doTenant(tenantId);
    if (!this.autenticavel(ig)) return null;
    const res = await this.req(ig, `/api/partner/v1/orders/${orderId}`, { method: 'GET' });
    return res.ok ? res.json().catch(() => null) : null;
  }

  // Polling de reconciliação (fallback do webhook): pedidos alterados desde X.
  async listarDesde(tenantId: string, desdeIso: string, status?: string[]): Promise<any[]> {
    const ig = await this.doTenant(tenantId);
    if (!this.autenticavel(ig)) {
      this.logger.warn(`listarDesde: tenant ${tenantId} SEM chave/token salvo (clicou Salvar?)`);
      return [];
    }
    const env: Ambiente = (ig.config?.env as Ambiente) ?? this.env;
    const p = new URLSearchParams({ updated_since: desdeIso });
    (status ?? []).forEach((s) => p.append('status[]', s));
    let res: Response;
    try {
      res = await this.req(ig, `/api/partner/v1/orders?${p.toString()}`, { method: 'GET' });
    } catch (e: any) {
      this.logger.warn(`listarDesde fetch falhou @${bases(env).api} [${env}]: ${e?.message ?? e}`);
      return [];
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.warn(`listarDesde ${res.status} @${bases(env).api} [${env}]: ${body.slice(0, 250)}`);
      return [];
    }
    const j = await res.json().catch(() => []);
    const arr = Array.isArray(j) ? j : j?.orders ?? j?.data ?? [];
    this.logger.log(`listarDesde tenant=${tenantId} [${env}]: ${arr.length} pedido(s) na janela`);
    return arr;
  }

  // ===== 5) Status de volta (Regem → Cardápio Web) =====
  // Endpoints reais do CW: confirm | ready | delivered | finalize | cancel.
  // Chamado pelo DeliveryService a cada transição do pedido. Best-effort.
  async statusBack(
    tenantId: string,
    orderId: string,
    acao: 'confirm' | 'ready' | 'delivered' | 'finalize' | 'cancel',
    motivo?: string,
  ): Promise<boolean> {
    const ig = await this.doTenant(tenantId);
    if (!this.autenticavel(ig)) return false;
    const body =
      acao === 'cancel' && motivo ? JSON.stringify({ cancellation_reason: motivo }) : '{}';
    const res = await this.req(ig, `/api/partner/v1/orders/${orderId}/${acao}`, {
      method: 'POST',
      body,
    }).catch(() => null);
    return !!res && res.ok;
  }

  // ===== Modo chave (X-API-KEY) — caminho rápido p/ uma loja =====
  // A loja gera a chave no painel (Configurações → Integrações → API de
  // integração) e informa o "código da loja"; guardamos e passamos a puxar.
  async salvarChave(
    tenantId: string,
    unidadeId: string | null,
    apiKey: string,
    codigoLoja: string | null,
    ambiente?: string,
  ): Promise<{ ok: boolean }> {
    // A chave gerada no painel da loja é do ambiente daquela conta (a loja real
    // fica em produção). Default: CARDAPIOWEB_ENV.
    const env: Ambiente =
      ambiente === 'producao' ? 'producao' : ambiente === 'sandbox' ? 'sandbox' : this.env;
    const existente = await this.doTenant(tenantId);
    // Modo chave: a chave vai na coluna `token` (convenção das integrações);
    // config guarda só o ambiente (sem resíduo do fluxo OAuth). Chave vazia
    // mantém a atual (padrão do painel: "deixe em branco para manter").
    const tokenNovo = apiKey && apiKey.trim() ? apiKey.trim() : undefined;
    const config = { env };
    if (existente) {
      await this.db
        .update(integracao)
        .set({
          merchantId: codigoLoja ?? existente.merchantId,
          ativo: true,
          ...(unidadeId ? { unidadeId } : {}),
          ...(tokenNovo ? { token: tokenNovo } : {}),
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
        merchantId: codigoLoja,
        token: tokenNovo ?? null,
        config,
      });
    }
    return { ok: true };
  }

  // Unidade destino do pedido: a da integração ou, se não vinculada, a matriz
  // do tenant (senão fica com unidade_id null e some do painel filtrado por loja).
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

  // Ingere uma lista de LiteOrders: detalhe → delivery.ingest → aceita no CW.
  // Idempotente por externalId (re-puxar não duplica).
  private async ingerirLista(tenantId: string, unidadeId: string | null, lite: any[]): Promise<number> {
    let n = 0;
    for (const o of lite) {
      try {
        const raw = await this.pedido(tenantId, String(o.id));
        if (!raw) continue;
        await this.delivery.ingest(tenantId, unidadeId, 'cardapio_web', raw, {
          taxaEntrega: Number(raw?.delivery_fee) || 0,
          trocoPara: raw?.payments?.[0]?.change_for ?? undefined,
        });
        // O confirm no CW sai do fluxo do Regem (delivery.aceitar → statusBack).
        n++;
      } catch (e: any) {
        this.logger.warn(`pedido ${o?.id}: ${e?.message ?? e}`);
      }
    }
    return n;
  }

  // Puxa manualmente os pedidos recentes (botão) — janela de 6h, sem filtro de
  // status (o CW pode já ter avançado o pedido). É o teste sem webhook.
  async puxarAgora(tenantId: string): Promise<{ total: number; ingeridos: number }> {
    const ig = await this.doTenant(tenantId);
    if (!this.autenticavel(ig)) return { total: 0, ingeridos: 0 };
    const unidadeId = await this.unidadeDestino(tenantId, ig.unidadeId);
    const desde = new Date(Date.now() - 6 * 3600 * 1000).toISOString();
    const lite = await this.listarDesde(tenantId, desde);
    const ingeridos = await this.ingerirLista(tenantId, unidadeId, lite);
    this.logger.log(`puxarAgora tenant=${tenantId}: ${ingeridos}/${lite.length}`);
    return { total: lite.length, ingeridos };
  }

  // ===== Sincronização automática (poller) =====
  // Integrações Cardápio Web ativas (todas as lojas) — iterado pelo poller.
  async integracoesAtivasCw(): Promise<{ tenantId: string }[]> {
    const rows = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.canal, CANAL), eq(integracao.ativo, true)));
    return rows.filter((r) => r.token).map((r) => ({ tenantId: r.tenantId }));
  }

  // Puxa só o que mudou desde o último ciclo (cursor `lastPollAt` em config).
  async sincronizar(tenantId: string): Promise<number> {
    const ig = await this.doTenant(tenantId);
    if (!this.autenticavel(ig)) return 0;
    const unidadeId = await this.unidadeDestino(tenantId, ig.unidadeId);
    const anterior = ig.config?.lastPollAt
      ? new Date(ig.config.lastPollAt).getTime()
      : Date.now() - 15 * 60 * 1000;
    // -60s de folga; teto de 23h (o CW exige updated_since dentro de 24h).
    const desdeMs = Math.max(anterior - 60 * 1000, Date.now() - 23 * 3600 * 1000);
    const lite = await this.listarDesde(tenantId, new Date(desdeMs).toISOString());
    const n = await this.ingerirLista(tenantId, unidadeId, lite);
    await this.db
      .update(integracao)
      .set({ config: { ...(ig.config ?? {}), lastPollAt: new Date().toISOString() } })
      .where(eq(integracao.id, ig.id));
    return n;
  }

  // ===== Webhook (tempo real, produção) =====
  // Recebe {order_id} de um evento do CW → busca detalhe → ingere. Resolve o
  // tenant pelo webhook token (config.webhookToken) ou, se só houver uma loja
  // ativa, por ela. Responder rápido; a ingestão é idempotente.
  async processarWebhook(token: string | undefined, orderId: string): Promise<{ ok: boolean }> {
    const rows = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.canal, CANAL), eq(integracao.ativo, true)));
    const ativos = rows.filter((r) => r.token);
    let alvo = token ? ativos.find((r: any) => (r.config ?? {}).webhookToken === token) : undefined;
    if (!alvo && ativos.length === 1) alvo = ativos[0];
    if (!alvo) {
      this.logger.warn('webhook: tenant não resolvido (token inválido?)');
      return { ok: false };
    }
    const unidadeId = await this.unidadeDestino(alvo.tenantId, alvo.unidadeId ?? null);
    const raw = await this.pedido(alvo.tenantId, String(orderId));
    if (!raw) return { ok: false };
    await this.delivery.ingest(alvo.tenantId, unidadeId, 'cardapio_web', raw, {
      taxaEntrega: Number(raw?.delivery_fee) || 0,
      trocoPara: raw?.payments?.[0]?.change_for ?? undefined,
    });
    return { ok: true };
  }

  // ===== Importador de catálogo (onboarding) =====
  private async setorPadrao(tenantId: string): Promise<string | null> {
    const r: any = await this.db.execute(sql`
      select id from setor where tenant_id = ${tenantId} and deleted_at is null
      order by created_at asc limit 1`);
    return (r?.rows ?? r)?.[0]?.id ?? null;
  }

  // Puxa o catálogo do Cardápio Web (GET /catalog) e cria/atualiza os produtos no
  // Regem — categoria, preço, imagem e CÓDIGO (external_code || 'cw'+id, a mesma
  // regra do adapter → os pedidos casam sozinhos). Idempotente por (tenant, código).
  async importarCatalogo(tenantId: string): Promise<{ categorias: number; produtos: number; atualizados: number }> {
    const ig = await this.doTenant(tenantId);
    if (!this.autenticavel(ig)) throw new BadRequestException('Conecte o Cardápio Web primeiro (salve a chave).');
    const res = await this.req(ig, '/api/partner/v1/catalog', { method: 'GET' });
    if (!res.ok) throw new BadRequestException(`Falha ao buscar o catálogo do Cardápio Web (${res.status}).`);
    const j: any = await res.json().catch(() => ({}));
    const cats: any[] = j.categories ?? j.data ?? [];
    const setor = await this.setorPadrao(tenantId);
    let nCat = 0, nProd = 0, nUpd = 0;
    for (let i = 0; i < cats.length; i++) {
      const cat = cats[i];
      const ex: any = await this.db.execute(sql`select id from categoria_produto where tenant_id=${tenantId} and nome=${cat.name} limit 1`);
      let catId: string | null = (ex?.rows ?? ex)?.[0]?.id ?? null;
      if (!catId) {
        const ins: any = await this.db.execute(sql`insert into categoria_produto (tenant_id,nome,ordem,ativo,disponibilidade) values (${tenantId},${cat.name},${i},true,'{}'::jsonb) returning id`);
        catId = (ins?.rows ?? ins)?.[0]?.id ?? null;
        nCat++;
      }
      for (const it of cat.items ?? []) {
        const codigo = it.external_code || `cw${it.id}`;
        const preco = Number(it.price) || 0;
        const img = it.image?.image_url ?? null;
        const found: any = await this.db.execute(sql`select id from produto where tenant_id=${tenantId} and codigo=${codigo} and deleted_at is null`);
        const foundId = (found?.rows ?? found)?.[0]?.id ?? null;
        if (foundId) {
          await this.db.execute(sql`update produto set nome=${it.name}, preco_venda=${preco}, categoria_id=${catId}, updated_at=now() where id=${foundId}`);
          nUpd++;
          continue;
        }
        await this.db.execute(sql`
          insert into produto (tenant_id,nome,tipo,unidade_medida,preco_venda,controla_estoque,vai_para_producao,ativo,selos,disponivel_cardapio,destaque,disponivel_balcao,pausado_estoque,permite_negativo,categoria_id,codigo,setor_producao_id,descricao,imagem_ref,preco_custo)
          values (${tenantId},${it.name},'simples',${(it.unit_type || 'un').toLowerCase()},${preco},false,true,true,'[]'::jsonb,true,false,true,false,false,${catId},${codigo},${setor},${it.description ?? null},${img},${Number(it.cost_price) || 0})`);
        nProd++;
      }
    }
    this.logger.log(`importarCatalogo tenant=${tenantId}: +${nCat} cat, +${nProd} prod, ${nUpd} atualizados`);
    return { categorias: nCat, produtos: nProd, atualizados: nUpd };
  }

  // ===== Status / desconectar (tela do gestor) =====
  async status(tenantId: string) {
    const ig = await this.doTenant(tenantId);
    const modo = ig?.config?.refreshToken ? 'oauth' : ig?.token ? 'chave' : null;
    const conectado = this.autenticavel(ig) && !ig.config?.pendingState;
    return {
      conectado,
      modo, // 'chave' | 'oauth' | null
      merchantId: ig?.merchantId ?? null, // código da loja no Cardápio Web
      escopos: ig?.config?.scope ?? null,
      ambiente: ig?.config?.env ?? this.env,
      oauthDisponivel: !!this.clientId, // se o fluxo App Store está configurado
    };
  }

  async desconectar(tenantId: string): Promise<{ ok: boolean }> {
    const ig = await this.doTenant(tenantId);
    if (!ig) return { ok: true };
    await this.db
      .update(integracao)
      .set({ ativo: false, token: null, config: { env: ig.config?.env ?? this.env }, updatedAt: new Date() })
      .where(eq(integracao.id, ig.id));
    return { ok: true };
  }
}
