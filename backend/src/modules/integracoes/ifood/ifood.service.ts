import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../../db/drizzle.module';
import { integracao } from '../../../db/schema';
import { fetchExterno } from '../../../common/fetch-externo';
import { registrarDisputa, registrarEncerramento } from './ifood-disputa';
import { anotarEventoNaoTratado } from './ifood-eventos';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Cliente da API do iFood (merchant-api.ifood.com.br). Guardamos por integração
// (canal 'ifood'): merchantId = UUID da loja no iFood · clientId/clientSecret =
// credenciais do app (Portal do Desenvolvedor) · token = cache do access_token.
// OAuth client_credentials; eventos por polling (+ acknowledgment). Reusa o
// adaptarIfood + delivery.ingest que já existem.
const CANAL = 'ifood';
const BASE = 'https://merchant-api.ifood.com.br';
/** A saúde do canal anotada se reafirma no banco a cada tanto, mesmo sem mudar (ver `anotarSaude`). */
export const SAUDE_REAFIRMA_MS = 10 * 60_000;

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
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    // O aviso em tempo real do caso novo (disputa) — opcional: os testes montam o serviço sem ele.
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  // ===== Disputas (Plataforma de negociação) — a central de atendimento, Onda 1, PR 2 =====

  /** HSD: abre o caso da disputa (idempotente pelo id da disputa). */
  registrarDisputa(ig: IntegIfood, ev: any) {
    return registrarDisputa(this.db, (e, p) => this.events?.emit(e, p), ig, ev);
  }

  /** HSS: grava como a disputa terminou e resolve o caso. */
  registrarEncerramento(ig: IntegIfood, ev: any) {
    return registrarEncerramento(this.db, (e, p) => this.events?.emit(e, p), ig.tenantId, ev);
  }

  /** O evento que o Regem ainda não trata vai à telemetria da distribuição — a forma, sem valores (ERR-421). Nunca rejeita. */
  anotarEventoNaoTratado(ig: IntegIfood, ev: any) {
    return anotarEventoNaoTratado(this.db, ig, ev, (m) => this.logger.warn(m));
  }

  /**
   * Responde à disputa: `accept` | `reject` | `alternative` (POST /order/v1.0/disputes/{id}/…). O iFood aceita UMA resposta
   * por disputa (422 DISPUTE_ALREADY_ANSWERED). Devolve o que o iFood respondeu — quem chama decide a mensagem.
   */
  async responderDisputa(
    ig: IntegIfood,
    disputa: string,
    acao: 'accept' | 'reject' | 'alternative',
    corpo: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; codigo: string | null; mensagem: string | null }> {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(disputa)) return { ok: false, status: 400, codigo: 'ID', mensagem: 'id da disputa inválido' };
    const res = await this.req(ig, `/order/v1.0/disputes/${disputa}/${acao}`, { method: 'POST', body: JSON.stringify(corpo) });
    if (res.ok) {
      this.logger.log(`disputa ${disputa.slice(0, 8)} ${acao} OK`);
      return { ok: true, status: res.status, codigo: null, mensagem: null };
    }
    const txt = await res.text().catch(() => '');
    let j: any = null;
    try {
      j = JSON.parse(txt);
    } catch {
      /* corpo sem JSON */
    }
    const codigo = j?.code ?? j?.error?.code ?? null;
    const mensagem = j?.message ?? j?.error?.message ?? (txt.slice(0, 160) || null);
    this.logger.warn(`disputa ${disputa.slice(0, 8)} ${acao} ${res.status}: ${codigo ?? ''} ${String(mensagem ?? '').slice(0, 120)}`);
    return { ok: false, status: res.status, codigo, mensagem };
  }

  // ===== Avaliações (Review API v2.0) — a central de atendimento, checkpoint item 4 (06/11/2026) =====

  /**
   * As avaliações da loja de `desde` até agora, a mais nova primeiro, até `paginas` páginas de 50 (o máximo do iFood).
   * `ok: false` com o status quando o iFood recusa (401/403: o módulo de avaliações não está liberado no app).
   */
  async avaliacoes(ig: IntegIfood, o: { desde: Date; paginas?: number }): Promise<{ ok: boolean; status: number; itens: any[] }> {
    const itens: any[] = [];
    const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    for (let page = 1; page <= (o.paginas ?? 3); page++) {
      const q = new URLSearchParams({
        page: String(page),
        pageSize: '50',
        addCount: 'true',
        dateFrom: iso(o.desde),
        dateTo: iso(new Date()),
        sort: 'DESC',
        sortBy: 'CREATED_AT',
      });
      const res = await this.req(ig, `/review/v2.0/merchants/${encodeURIComponent(ig.merchantId)}/reviews?${q}`, { method: 'GET' });
      if (!res.ok) {
        if (page === 1) return { ok: false, status: res.status, itens: [] };
        break;
      }
      const j: any = await res.json().catch(() => null);
      const lote: any[] = Array.isArray(j) ? j : (j?.reviews ?? j?.items ?? j?.data ?? []);
      itens.push(...lote);
      if (lote.length < 50) break;
    }
    return { ok: true, status: 200, itens };
  }

  /**
   * Responde à avaliação: `POST /review/v2.0/merchants/{merchantId}/reviews/{id}/answers` com `{ text }`. O iFood aceita UMA
   * resposta (409/422 depois de respondida ou publicada) e de 10 a 300 caracteres (400). Devolve o que o iFood respondeu.
   */
  async responderAvaliacao(ig: IntegIfood, reviewId: string, texto: string): Promise<{ ok: boolean; status: number; codigo: string | null; mensagem: string | null }> {
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(reviewId)) return { ok: false, status: 400, codigo: 'ID', mensagem: 'id da avaliação inválido' };
    const res = await this.req(ig, `/review/v2.0/merchants/${encodeURIComponent(ig.merchantId)}/reviews/${reviewId}/answers`, {
      method: 'POST',
      body: JSON.stringify({ text: texto }),
    });
    if (res.ok) {
      this.logger.log(`avaliação ${reviewId.slice(0, 8)} respondida`);
      return { ok: true, status: res.status, codigo: null, mensagem: null };
    }
    const txt = await res.text().catch(() => '');
    let j: any = null;
    try {
      j = JSON.parse(txt);
    } catch {
      /* corpo sem JSON */
    }
    const codigo = j?.code ?? j?.error?.code ?? null;
    const mensagem = j?.message ?? j?.error?.message ?? (txt.slice(0, 160) || null);
    this.logger.warn(`avaliação ${reviewId.slice(0, 8)} resposta ${res.status}: ${codigo ?? ''} ${String(mensagem ?? '').slice(0, 120)}`);
    return { ok: false, status: res.status, codigo, mensagem };
  }

  /**
   * A FOTO que o cliente mandou na disputa. O endereço vem do iFood e pede o token da loja — por isso só vale o próprio
   * `https://merchant-api.ifood.com.br/…` (o token nunca vai para outro endereço — V68). Até 8 MB, só imagem.
   */
  async fotoDaDisputa(ig: IntegIfood, url: string): Promise<{ tipo: string; bytes: Buffer } | null> {
    let alvo: URL;
    try {
      alvo = new URL(url);
    } catch {
      return null;
    }
    if (alvo.protocol !== 'https:' || alvo.host !== 'merchant-api.ifood.com.br') return null;
    const res = await this.req(ig, `${alvo.pathname}${alvo.search}`, { method: 'GET', headers: { Accept: 'image/*' } });
    if (!res.ok) return null;
    const tipo = String(res.headers.get('content-type') ?? '');
    if (!tipo.startsWith('image/')) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) return null;
    return { tipo, bytes };
  }

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
      await fetchExterno(hook, {
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
      const res = await fetchExterno(`${BASE}/authentication/v1.0/oauth/token`, {
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
      // Só a chave dele, mesclando no banco (V82): uma cópia da config em memória apagaria o ajuste que a tela gravou
      // entre a leitura da integração e a renovação do token (o "Avaliações do iFood na fila", por exemplo).
      await this.db
        .update(integracao)
        .set({ token: access, config: sql`coalesce(${integracao.config}, '{}'::jsonb) || jsonb_build_object('tokenExp', ${tokenExp}::bigint)` })
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
    return fetchExterno(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${tk}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  }

  // Polling de eventos (filtra pela loja via x-polling-merchants). 204 = vazio.
  // A saúde do canal sai DAQUI (aviso "iFood desconectado" do Mister): a resposta de erro (401, 403, 500…) vira lista vazia
  // para o poller — que então "funcionou" —, e só esta função sabe que o iFood recusou ou não respondeu.
  async polling(ig: IntegIfood): Promise<any[]> {
    let res: Response;
    try {
      res = await this.req(ig, '/events/v1.0/events:polling', {
        method: 'GET',
        headers: { 'x-polling-merchants': ig.merchantId },
      });
    } catch (e: any) {
      await this.anotarSaude(ig.id, true, String(e?.message ?? '') === 'sem token iFood' ? 'sem_token' : 'sem_resposta');
      throw e;
    }
    if (res.status === 204) {
      await this.anotarSaude(ig.id, false);
      return [];
    }
    if (!res.ok) {
      await this.anotarSaude(ig.id, true, `http_${res.status}`);
      this.logger.warn(`polling ${res.status}: ${(await res.text().catch(() => '')).slice(0, 150)}`);
      return [];
    }
    await this.anotarSaude(ig.id, false);
    const j = await res.json().catch(() => []);
    return Array.isArray(j) ? j : [];
  }

  // ===== A saúde do canal (aviso do Mister "iFood ou 99 desconectado", F1.2c) =====
  // "Sem resposta desde" fica na PRÓPRIA integração (`config.semRespostaDesde` e o motivo), que é só da nuvem. A gravação é
  // condicional — marca só se ainda não estava marcado, limpa só se estava — e mescla só as suas chaves (V82). Para não
  // ir ao banco a cada 30 s, este processo lembra o último estado anotado; e reafirma a cada 10 min, porque a rota genérica
  // do delivery regrava o `config` a partir de uma cópia em memória e pode ressuscitar uma marca já limpa. Nunca lança:
  // a entrada de pedidos não pode parar por causa disto.
  private readonly saudeAnotada = new Map<string, { falhando: boolean; em: number }>();

  async anotarSaude(integracaoId: string, falhou: boolean, motivo: string | null = null, agora = Date.now()): Promise<void> {
    const antes = this.saudeAnotada.get(integracaoId);
    if (antes && antes.falhando === falhou && agora - antes.em < SAUDE_REAFIRMA_MS) return;
    try {
      if (falhou) {
        await this.db.execute(sql`
          update integracao
             set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('semRespostaDesde', ${new Date(agora).toISOString()}::text, 'semRespostaMotivo', ${motivo}::text)
           where id = ${integracaoId}::uuid and not jsonb_exists(coalesce(config, '{}'::jsonb), 'semRespostaDesde')`);
      } else {
        await this.db.execute(sql`
          update integracao set config = config - 'semRespostaDesde' - 'semRespostaMotivo'
           where id = ${integracaoId}::uuid and jsonb_exists(coalesce(config, '{}'::jsonb), 'semRespostaDesde')`);
      }
      this.saudeAnotada.set(integracaoId, { falhando: falhou, em: agora });
    } catch (e: any) {
      this.logger.warn(`a saúde da integração ${integracaoId} não foi anotada: ${e?.message ?? e}`);
    }
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
  // POST /order/v1.0/orders/{id}/verifyDeliveryCode {code} → { valid: true } e o iFood
  // marca o pedido como CONCLUDED automaticamente. ENTREGA PRÓPRIA (deliveredBy=MERCHANT):
  // o cliente informa o código de entrega ao entregador, que digita no Regem. É o módulo
  // ORDER (que o app do Regem tem) — NÃO a Logistics API (essa é p/ operadores de logística,
  // e o app do Regem só tem order+events). O `dispatch` já é feito no despacho normal.
  async verificarCodigoEntrega(
    ig: IntegIfood,
    orderId: string,
    codigo: string,
  ): Promise<{ ok: boolean; valid: boolean }> {
    try {
      const res = await this.req(ig, `/order/v1.0/orders/${orderId}/verifyDeliveryCode`, {
        method: 'POST',
        body: JSON.stringify({ code: String(codigo ?? '').trim() }),
      });
      if (!res.ok) {
        // 404 = pedido não elegível a código · 422 = código não confere.
        this.logger.warn(`verifyDeliveryCode ${orderId.slice(0, 8)} ${res.status}`);
        return { ok: false, valid: false };
      }
      const j: any = await res.json().catch(() => ({}));
      const valid = j?.valid === true || j?.success === true;
      this.logger.log(`verifyDeliveryCode ${orderId.slice(0, 8)} valid=${valid}`);
      return { ok: true, valid };
    } catch (e: any) {
      this.logger.warn(`verifyDeliveryCode ${orderId.slice(0, 8)} falhou: ${e?.message ?? e}`);
      return { ok: false, valid: false };
    }
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
  // Devolve se o iFood aceitou AGORA (false = ficou pendente para o reenvio) — só para o registro
  // do envio na linha do tempo do pedido; o envio e a blindagem são os mesmos.
  async cancelarComBlindagem(tenantId: string, orderId: string, motivo?: string): Promise<boolean> {
    const ig = await this.integracaoDoTenant(tenantId);
    if (!ig) return false;
    const ok = await this.cancelar(ig, orderId, motivo);
    if (ok) await this.limparCancelPendente(ig, orderId);
    else await this.marcarCancelPendente(ig, orderId, motivo);
    return ok;
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
