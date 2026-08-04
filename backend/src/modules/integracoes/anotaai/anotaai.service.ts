import { BadRequestException, forwardRef, Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../../db/drizzle.module';
import { integracao, pedidoExterno, atendimentoChamado } from '../../../db/schema';
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
// O cardápio (menu) fica em OUTRO domínio (api-menu), não no de pedidos (api-parceiros).
const MENU_BASE = process.env.ANOTAAI_MENU_URL ?? 'https://api-menu.anota.ai/partnerauth';

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
    private readonly events: EventEmitter2,
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
  async listar(ig: IntegAnota, paginas = 4): Promise<any[]> {
    // A LIST paginа (~25/página). Puxamos algumas páginas para reverificar também
    // os pedidos ATIVOS mais antigos (não só os 25 recentes) — assim, ao reabrir o
    // backend, o status de todo pedido ainda aberto na Anota Aí é reconciliado.
    const todos: any[] = [];
    const vistos = new Set<string>();
    for (let p = 1; p <= paginas; p++) {
      const res = await this.req(ig, `${EP_LIST}?currentpage=${p}&excludeIfood=1`, { method: 'GET' }).catch(() => null);
      if (!res || !res.ok) {
        const body = res ? await res.text().catch(() => '') : '';
        this.logger.warn(`listar p${p} ${res?.status ?? 'ERR'}: ${body.slice(0, 150)}`);
        break;
      }
      const j: any = await res.json().catch(() => ({}));
      const docs: any[] = j?.info?.docs ?? [];
      if (!docs.length) break; // acabaram as páginas
      for (const d of docs) {
        const id = String(d._id ?? d.id ?? '');
        if (id && !vistos.has(id)) { vistos.add(id); todos.push(d); }
      }
      if (docs.length < 25) break; // última página (menos que o tamanho cheio)
    }
    return todos;
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
        let raw: any = null;
        if (!seenSet.has(orderId)) {
          raw = await this.pedido(ig, orderId);
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
        // 2) Reflete o status vindo DA Anota Aí (bidirecional; vale p/ já ingeridos).
        //    A Anota Aí só expõe o `check` numérico (a LIST não traz status textual):
        //    1 = EM PRODUÇÃO · 2 = "PRONTOS PARA ENTREGA" (na operação da loja = EM ROTA,
        //    é o último passo antes de finalizar) · 3 = finalizado · 4 = cancelado ·
        //    5 = negado · 6 = CLIENTE PEDIU CANCELAMENTO (loja aprova → sino).
        //    Por isso check 2 → 'despachado' (Entregas em andamento), não 'pronto'.
        let alvo: 'pronto' | 'despachado' | 'concluido' | 'cancelado' | null = null;
        if (check === 6) {
          // Não auto-cancela: abre um chamado no sino p/ a loja aceitar/recusar.
          await this.abrirChamadoCancelamento(tenantId, unidadeId, orderId).catch(() => {});
        } else if (check === 4 || check === 5) alvo = 'cancelado';
        else if (check === 3) alvo = 'concluido';
        else if (check === 2) alvo = 'despachado';
        // A partir de "aceito na Anota Aí" (check ≥ 1), garante que o pedido está
        // MATERIALIZADO localmente (vira 'confirmado' = coluna Produção). Sem isso o
        // pedido fica preso em "Em análise" e parece que "não atualiza".
        if (check >= 1 && check <= 3) await this.materializarSeNovo(tenantId, orderId).catch(() => {});
        if (alvo) await this.delivery.refletirStatusExterno(tenantId, CANAL, orderId, alvo);
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

  // Materializa (aceita) o pedido localmente se ainda estiver 'novo' — o Anota Aí já
  // aceitou do lado dele, então aqui só criamos a venda + produção e movemos para
  // 'confirmado' (Produção). `aceitar` não manda status-back p/ Anota Aí (só CW/iFood/
  // Food99), então não há risco de duplo-aceite. Idempotente (só age em 'novo').
  private async materializarSeNovo(tenantId: string, orderId: string) {
    const [ped] = await this.db
      .select({ id: pedidoExterno.id, status: pedidoExterno.status })
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.tenantId, tenantId), eq(pedidoExterno.canal, CANAL), eq(pedidoExterno.externalId, orderId)));
    if (!ped) {
      this.logger.warn(`materializar: pedido ${orderId.slice(0, 8)} não encontrado (externalId?)`);
      return;
    }
    if (ped.status === 'novo') await this.delivery.aceitar(tenantId, null, ped.id);
  }

  // Cliente pediu cancelamento na Anota Aí (check 6): abre um chamado no SINO
  // (atendimento tipo 'cancelamento') com o telefone de quem pediu, para a loja
  // aceitar (cancela de fato + status-back) ou recusar. Idempotente por pedido.
  private async abrirChamadoCancelamento(tenantId: string, unidadeId: string | null, orderId: string) {
    const [ped] = await this.db
      .select({
        id: pedidoExterno.id,
        numero: pedidoExterno.numero,
        clienteNome: pedidoExterno.clienteNome,
        clienteTelefone: pedidoExterno.clienteTelefone,
        status: pedidoExterno.status,
      })
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.tenantId, tenantId), eq(pedidoExterno.canal, CANAL), eq(pedidoExterno.externalId, orderId)));
    if (!ped || ped.status === 'cancelado' || ped.status === 'concluido') return;
    // Já existe um chamado aberto para este pedido? Não duplica a cada poll.
    const [ex] = await this.db
      .select({ id: atendimentoChamado.id })
      .from(atendimentoChamado)
      .where(
        and(
          eq(atendimentoChamado.tenantId, tenantId),
          eq(atendimentoChamado.pedidoId, ped.id),
          eq(atendimentoChamado.tipo, 'cancelamento'),
          eq(atendimentoChamado.status, 'aberto'),
        ),
      );
    if (ex) return;
    const [row] = await this.db
      .insert(atendimentoChamado)
      .values({
        tenantId,
        unidadeId: unidadeId ?? null,
        tipo: 'cancelamento',
        cliente: ped.clienteNome ?? null,
        telefone: ped.clienteTelefone ?? null,
        pedidoNumero: ped.numero != null ? String(ped.numero) : null,
        pedidoId: ped.id,
        mensagem: 'Cliente pediu cancelamento na Anota Aí',
      })
      .returning();
    this.events.emit('atendimento.novo', { tenantId, chamado: row });
    this.logger.log(`chamado de cancelamento (Anota Aí) aberto p/ pedido #${ped.numero ?? '?'}`);
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
    solicitanteId?: string | null,
  ): Promise<{ ok: boolean }> {
    const [existente] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, CANAL)));
    const tokenNovo = token && token.trim() ? token.trim() : undefined; // vazio mantém
    // Um token NOVO gera um "pedido de integração": a distribuição finaliza a conexão
    // no Portal de Integração da Anota Aí. Fica no config da integração (a distribuição
    // lê cross-tenant). Não recria se já está pendente.
    const cfgAtual: any = existente?.config ?? {};
    const jaPendente = cfgAtual?.pedidoIntegracao?.status === 'pendente';
    const criarPedido = !!tokenNovo && !jaPendente;
    const pedido = criarPedido
      ? {
          status: 'pendente',
          solicitadoEm: new Date().toISOString(),
          solicitadoPorId: solicitanteId ?? null,
        }
      : cfgAtual.pedidoIntegracao;
    const config = { ...cfgAtual, ...(pedido ? { pedidoIntegracao: pedido } : {}) };
    if (existente) {
      await this.db
        .update(integracao)
        .set({
          merchantId: lojaId ?? existente.merchantId,
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
        merchantId: lojaId,
        token: tokenNovo ?? null,
        config,
      });
    }
    // Alerta à distribuição (e-mail p/ diretoria + técnico via webhook) na 1ª solicitação.
    if (criarPedido) void this.alertarPedidoIntegracao(tenantId, tokenNovo as string);
    return { ok: true };
  }

  // Avisa a distribuição de um novo pedido de integração da Anota Aí. Reaproveita o
  // DIST_ALERT_WEBHOOK (n8n): manda a loja, o token e os e-mails da diretoria+técnico
  // p/ o webhook disparar o e-mail. Best-effort — nunca quebra o salvamento.
  private async alertarPedidoIntegracao(tenantId: string, token: string) {
    try {
      const hook = (process.env.DIST_ALERT_WEBHOOK ?? '').trim();
      if (!hook) return;
      const emp: any = await this.db.execute(
        sql`select nome from empresa where id = ${tenantId} limit 1`,
      );
      const loja = (emp?.rows ?? emp)?.[0]?.nome ?? 'Loja';
      const dst: any = await this.db.execute(
        sql`select email from usuario_distribuicao where perfil in ('diretoria','tecnico') and ativo = true`,
      );
      const destinatarios = (dst?.rows ?? dst).map((x: any) => x.email).filter(Boolean);
      await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          evento: 'pedido_integracao',
          canal: CANAL,
          loja,
          tenantId,
          token,
          destinatarios,
          em: new Date().toISOString(),
        }),
      }).catch(() => {});
    } catch {
      /* nunca quebra o salvamento por causa do alerta */
    }
  }

  async status(tenantId: string) {
    const ig = await this.integracaoDoTenant(tenantId);
    return { conectado: !!ig, lojaId: ig?.lojaId ?? null };
  }

  // ===== Importador de cardápio (onboarding) =====
  private async setorPadrao(tenantId: string): Promise<string | null> {
    const r: any = await this.db.execute(sql`
      select id from setor where tenant_id = ${tenantId} and deleted_at is null
      order by created_at asc limit 1`);
    return (r?.rows ?? r)?.[0]?.id ?? null;
  }

  // Puxa o cardápio da Anota Aí (GET simple-item/export/v2, em api-menu) e cria/
  // atualiza os produtos no Regem — categoria, preço e CÓDIGO (external_id || id,
  // a mesma regra do adapter → os pedidos casam sozinhos). Pula categorias de
  // adicionais (is_additional). Idempotente por (tenant, código).
  async importarCatalogo(
    tenantId: string,
  ): Promise<{ categorias: number; produtos: number; atualizados: number; complementos: number }> {
    const ig = await this.integracaoDoTenant(tenantId);
    if (!ig) throw new BadRequestException('Conecte a Anota Aí primeiro (salve o token da loja).');
    const res = await fetch(`${MENU_BASE}/v2/nm-category/rest/simple-item/export/v2`, {
      headers: { Authorization: ig.token, 'Content-Type': 'application/json' },
    }).catch(() => null);
    if (!res || !res.ok) throw new BadRequestException(`Falha ao buscar o cardápio da Anota Aí (${res?.status ?? 'sem resposta'}).`);
    const j: any = await res.json().catch(() => ({}));
    const todas: any[] = j.categories ?? [];
    const cats: any[] = todas.filter((c: any) => !c.is_additional);
    // Adicionais vivem em categorias is_additional; os produtos as referenciam.
    const addById = new Map<string, any>(
      todas.filter((c: any) => c.is_additional).map((c: any) => [String(c.id), c]),
    );
    // Diagnóstico (o formato do Anota Aí não é fixo na doc): campos de um item +
    // exemplo de categoria de adicional — ajuda a ajustar `gruposAnota` se preciso.
    const amostraItem = cats.find((c: any) => (c.itens ?? []).length)?.itens?.[0];
    if (amostraItem) this.logger.log(`importarCatalogo Anota: campos de um item = ${Object.keys(amostraItem).join(', ')}`);
    const amostraAdd = todas.find((c: any) => c.is_additional);
    if (amostraAdd) this.logger.log(`importarCatalogo Anota: categoria de adicional = ${JSON.stringify(amostraAdd).slice(0, 400)}`);
    const setor = await this.setorPadrao(tenantId);
    let nCat = 0, nProd = 0, nUpd = 0, nComp = 0;
    for (let i = 0; i < cats.length; i++) {
      const cat = cats[i];
      const nome = cat.title ?? 'Categoria';
      const ex: any = await this.db.execute(sql`select id from categoria_produto where tenant_id=${tenantId} and nome=${nome} limit 1`);
      let catId: string | null = (ex?.rows ?? ex)?.[0]?.id ?? null;
      if (!catId) {
        const ins: any = await this.db.execute(sql`insert into categoria_produto (tenant_id,nome,ordem,ativo,disponibilidade) values (${tenantId},${nome},${i},true,'{}'::jsonb) returning id`);
        catId = (ins?.rows ?? ins)?.[0]?.id ?? null;
        nCat++;
      }
      for (const it of cat.itens ?? []) {
        // De-para: external_id (código PDV) se a loja preencheu; senão o id interno
        // do item — a mesma regra do adaptarAnotaAi, então o pedido casa sozinho.
        const codigo = it.external_id || (it.id != null ? String(it.id) : undefined);
        if (!codigo) continue;
        const preco = Number(it.price) || 0;
        const found: any = await this.db.execute(sql`select id from produto where tenant_id=${tenantId} and codigo=${codigo} and deleted_at is null`);
        let prodId: string | null = (found?.rows ?? found)?.[0]?.id ?? null;
        if (prodId) {
          await this.db.execute(sql`update produto set nome=${it.title}, preco_venda=${preco}, categoria_id=${catId}, updated_at=now() where id=${prodId}`);
          nUpd++;
        } else {
          const ins: any = await this.db.execute(sql`
            insert into produto (tenant_id,nome,tipo,unidade_medida,preco_venda,controla_estoque,vai_para_producao,ativo,selos,disponivel_cardapio,destaque,disponivel_balcao,pausado_estoque,permite_negativo,categoria_id,codigo,setor_producao_id,descricao,imagem_ref,preco_custo)
            values (${tenantId},${it.title},'simples','un',${preco},false,true,true,'[]'::jsonb,true,false,true,false,false,${catId},${codigo},${setor},null,null,0)
            returning id`);
          prodId = (ins?.rows ?? ins)?.[0]?.id ?? null;
          nProd++;
        }
        if (prodId) nComp += await this.importarComplementosAnota(tenantId, prodId, String(codigo), it, addById);
      }
    }
    this.logger.log(`importarCatalogo tenant=${tenantId}: +${nCat} cat, +${nProd} prod, ${nUpd} atualizados, +${nComp} complementos(opções)`);
    return { categorias: nCat, produtos: nProd, atualizados: nUpd, complementos: nComp };
  }

  // Resolve os grupos de adicional de um item do Anota Aí. Tolera: referência por
  // id de categoria is_additional, grupo com opções inline, e vários nomes de campo
  // (a doc não fixa). Devolve grupos já normalizados {nome,min,max,obrig,opcoes}.
  private gruposAnota(
    it: any,
    addById: Map<string, any>,
  ): Array<{ nome: string; min: number; max: number | null; obrig: boolean; opcoes: any[] }> {
    const refs =
      it.complements ?? it.additionals ?? it.additional_categories ?? it.additionalCategories ??
      it.complementGroups ?? it.optionGroups ?? it.adicionais ?? it.nm_additional ?? it.groups ?? [];
    if (!Array.isArray(refs) || !refs.length) return [];
    const out: Array<{ nome: string; min: number; max: number | null; obrig: boolean; opcoes: any[] }> = [];
    for (const g of refs) {
      if (g == null) continue;
      // Referência simples (id da categoria de adicional).
      if (typeof g === 'number' || typeof g === 'string') {
        const cat = addById.get(String(g));
        const opcoes = cat?.itens ?? cat?.items ?? [];
        if (opcoes.length) out.push({ nome: String(cat?.title ?? 'Complemento'), min: 0, max: null, obrig: false, opcoes });
        continue;
      }
      // Objeto: pode referenciar uma categoria E/OU trazer as opções inline.
      const catRef =
        g.category_id ?? g.categoryId ?? g.additional_id ?? g.additionalId ?? g.id_category ?? g.nm_category_id ?? null;
      const cat = catRef != null ? addById.get(String(catRef)) : null;
      const inline = g.itens ?? g.items ?? g.options ?? g.complements ?? g.additionals ?? g.opcoes;
      const opcoes = Array.isArray(inline) && inline.length ? inline : cat?.itens ?? cat?.items ?? [];
      if (!Array.isArray(opcoes) || !opcoes.length) continue;
      const maxRaw = g.max ?? g.max_quantity ?? g.maximum ?? null;
      out.push({
        nome: String(g.title ?? g.name ?? cat?.title ?? 'Complemento').slice(0, 200),
        min: Number(g.min ?? g.min_quantity ?? g.minimum ?? 0) || 0,
        max: maxRaw != null && Number(maxRaw) ? Number(maxRaw) : null,
        obrig: Boolean(g.required ?? g.obrigatorio ?? g.is_required ?? g.mandatory),
        opcoes,
      });
    }
    return out;
  }

  // Materializa os complementos do Anota Aí em complemento_grupo/opcao (o que o motor
  // lê). Idempotente (não duplica se o produto já tem grupos). Devolve nº de opções.
  private async importarComplementosAnota(
    tenantId: string,
    produtoId: string,
    codigoBase: string,
    it: any,
    addById: Map<string, any>,
  ): Promise<number> {
    const grupos = this.gruposAnota(it, addById);
    if (!grupos.length) return 0;
    const jaTem: any = await this.db.execute(sql`select 1 from complemento_grupo where produto_id=${produtoId} and deleted_at is null limit 1`);
    if ((jaTem?.rows ?? jaTem)?.length) return 0;
    let n = 0;
    for (let gi = 0; gi < grupos.length; gi++) {
      const g = grupos[gi];
      const insG: any = await this.db.execute(sql`
        insert into complemento_grupo (tenant_id, produto_id, nome, tipo, min, max, obrigatorio, ordem)
        values (${tenantId}, ${produtoId}, ${g.nome}, 'adicionar', ${g.min}, ${g.max}, ${g.obrig}, ${gi})
        returning id`);
      const grupoId = (insG?.rows ?? insG)?.[0]?.id;
      if (!grupoId) continue;
      for (let oi = 0; oi < g.opcoes.length; oi++) {
        const o = g.opcoes[oi];
        const onome = String(o?.title ?? o?.name ?? o?.nome ?? '').slice(0, 200);
        if (!onome) continue;
        const preco = Number(o?.price ?? o?.preco ?? o?.additional_price ?? o?.value ?? 0) || 0;
        const cod = o?.external_id || o?.code || o?.codigo || (o?.id != null ? String(o.id) : `${codigoBase}c${gi}o${oi}`);
        await this.db.execute(sql`
          insert into complemento_opcao (tenant_id, grupo_id, nome, preco_delta, codigo_pdv, ordem)
          values (${tenantId}, ${grupoId}, ${onome}, ${preco}, ${String(cod).slice(0, 60)}, ${oi})`);
        n++;
      }
    }
    return n;
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
