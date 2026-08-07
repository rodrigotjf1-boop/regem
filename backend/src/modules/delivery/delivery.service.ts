import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  forwardRef,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHmac, randomBytes } from 'crypto';
import { and, desc, eq, gte, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { OnEvent } from '@nestjs/event-emitter';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  caixaSessao,
  cardapioBairro,
  cardapioConfig,
  colaborador,
  comandaItem,
  deliveryConfig,
  funcao,
  integracao,
  lancamentoCaixa,
  pedidoExterno,
  edgeHeartbeat,
  produto,
} from '../../db/schema';
import { condUnidadeOuRede } from '../../common/filtro-unidade';
import { validarTokenMP } from '../../common/mercadopago';
import { validarTokenIugu } from '../../common/iugu';
import { perfilEfetivo, listarPerfis, CAMPOS_CATALOGO, type PerfilCupom } from './cupom-perfis';
import { VendasService } from '../vendas/vendas.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { CashbackService } from '../cashback/cashback.service';
import { FidelidadeService } from '../fidelidade/fidelidade.service';
import { OpenDeliveryService } from '../integracoes/open-delivery/open-delivery.service';
import { CardapioWebService } from '../integracoes/cardapio-web/cardapio-web.service';
import { IfoodService } from '../integracoes/ifood/ifood.service';
import { Food99Service } from '../integracoes/food99/food99.service';
import { AnotaAiService } from '../integracoes/anotaai/anotaai.service';
import { adaptar, PedidoNormalizado } from './adapters';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FLUXO = ['confirmado', 'pronto', 'despachado', 'concluido'];

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger('Delivery');
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly vendas: VendasService,
    private readonly producao: ProducaoPedidoService,
    private readonly cashback: CashbackService,
    private readonly fidelidade: FidelidadeService,
    @Optional()
    @Inject(forwardRef(() => OpenDeliveryService))
    private readonly openDelivery?: OpenDeliveryService,
    @Optional()
    @Inject(forwardRef(() => CardapioWebService))
    private readonly cardapioWeb?: CardapioWebService,
    @Optional()
    @Inject(forwardRef(() => IfoodService))
    private readonly ifood?: IfoodService,
    @Optional()
    @Inject(forwardRef(() => Food99Service))
    private readonly food99?: Food99Service,
    @Optional()
    @Inject(forwardRef(() => AnotaAiService))
    private readonly anotaai?: AnotaAiService,
  ) {}

  // Status back para marketplaces (hoje: Open Delivery). Best-effort.
  private async statusBack(tenantId: string, row: any, acao: 'dispatch' | 'cancel') {
    if (!this.openDelivery || !['open_delivery', 'delivery_direto'].includes(row?.canal) || !row?.externalId) return;
    try {
      const ig = await this.openDelivery.integracaoDoTenant(tenantId, row.canal);
      if (!ig) return;
      if (acao === 'dispatch') await this.openDelivery.despachar(ig, row.externalId);
      else await this.openDelivery.cancelar(ig, row.externalId, row.motivoCancelamento ?? undefined);
    } catch {
      /* nunca quebra o fluxo por causa do status back */
    }
  }

  // Status back para o Cardápio Web (API Aberta) — confirm/ready/delivered/
  // finalize/cancel. Cada transição do Regem reflete no CW. Best-effort.
  private async statusBackCw(
    tenantId: string,
    row: any,
    acao: 'confirm' | 'ready' | 'delivered' | 'finalize' | 'cancel',
  ) {
    if (!this.cardapioWeb || row?.canal !== 'cardapio_web' || !row?.externalId) return;
    try {
      await this.cardapioWeb.statusBack(
        tenantId,
        String(row.externalId),
        acao,
        row.motivoCancelamento ?? undefined,
      );
    } catch {
      /* nunca quebra o fluxo por causa do status back */
    }
  }

  // Status back para o iFood — confirm/ready/dispatch/cancel. Best-effort.
  private async statusBackIfood(
    tenantId: string,
    row: any,
    acao: 'confirm' | 'ready' | 'dispatch' | 'cancel',
  ) {
    if (!this.ifood || row?.canal !== 'ifood' || !row?.externalId) return;
    try {
      const ig = await this.ifood.integracaoDoTenant(tenantId);
      if (!ig) return;
      const id = String(row.externalId);
      if (acao === 'confirm') await this.ifood.confirmar(ig, id);
      else if (acao === 'ready') await this.ifood.prontoRetirada(ig, id);
      else if (acao === 'dispatch') {
        // Pedido AGENDADO não pode ser despachado no iFood antes da janela marcada.
        // Se ainda não chegou a hora, NÃO enviamos o dispatch agora (o kanban local
        // segue operável; só a chamada ao iFood respeita o horário do cliente).
        const janela = row?.agendamento ? new Date(row.agendamento) : null;
        if (janela && !isNaN(janela.getTime()) && Date.now() < janela.getTime()) {
          this.logger.warn(
            `dispatch adiado ${id.slice(0, 8)}: pedido agendado para ${janela.toISOString()}`,
          );
          return;
        }
        await this.ifood.despachar(ig, id);
      } else {
        // Blindagem: enfileira + reenvia até o iFood aceitar (não fire-and-forget).
        await this.ifood.cancelarComBlindagem(tenantId, id, row.motivoCancelamento ?? undefined);
      }
    } catch {
      /* nunca quebra o fluxo por causa do status back */
    }
  }

  // Status back para o 99Food / DiDi Food — confirm/ready/delivered/cancel.
  // O cancel usa a blindagem (reenvio pelo poller) — não repetir o fire-and-forget
  // que reprovou a homologação do iFood. Best-effort nas demais transições.
  private async statusBackFood99(
    tenantId: string,
    row: any,
    acao: 'confirm' | 'ready' | 'delivered' | 'cancel',
  ) {
    if (!this.food99 || row?.canal !== '99food' || !row?.externalId) return;
    try {
      const id = String(row.externalId);
      if (acao === 'cancel') {
        // Blindagem: reenfileira até o 99food aceitar (não fire-and-forget).
        await this.food99.cancelarComBlindagem(tenantId, id, row.motivoCancelamento ?? undefined);
        return;
      }
      const ig = await this.food99.integracaoDoTenant(tenantId);
      if (!ig) return;
      if (acao === 'confirm') await this.food99.confirmar(ig, id);
      else if (acao === 'ready') await this.food99.pronto(ig, id);
      else if (acao === 'delivered') await this.food99.entregue(ig, id);
    } catch {
      /* nunca quebra o fluxo por causa do status back */
    }
  }

  // Status back para a Anota Aí — pronto / finalizar / cancelar. (O aceite acontece
  // no poller ao ingerir, então o "confirm" do kanban não reenvia.) Best-effort.
  private async statusBackAnotaAi(tenantId: string, row: any, acao: 'ready' | 'finalizar' | 'cancel') {
    if (!this.anotaai || row?.canal !== 'anotaai' || !row?.externalId) return;
    try {
      const ig = await this.anotaai.integracaoDoTenant(tenantId);
      if (!ig) return;
      const id = String(row.externalId);
      if (acao === 'ready') await this.anotaai.pronto(ig, id);
      else if (acao === 'finalizar') await this.anotaai.finalizar(ig, id);
      else if (acao === 'cancel') await this.anotaai.cancelar(ig, id, row.motivoCancelamento ?? undefined);
    } catch {
      /* nunca quebra o fluxo por causa do status back */
    }
  }

  // Reflete localmente uma mudança de status que veio DO canal (ex.: a Anota Aí/
  // iFood avançou ou cancelou/concluiu o pedido). NÃO dispara status-back — o
  // evento já veio de lá. Idempotente e SÓ AVANÇA (não regride): usa a ordem do
  // fluxo pra impedir voltar um estado. `cancelado` é terminal (sempre aplica se
  // ainda não terminal). Usado pelos pollers (iFood/99food/Anota Aí).
  async refletirStatusExterno(
    tenantId: string,
    canal: string,
    externalId: string,
    novoStatus: 'pronto' | 'despachado' | 'concluido' | 'cancelado',
  ): Promise<void> {
    const [row] = await this.db
      .select()
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.tenantId, tenantId),
          eq(pedidoExterno.canal, canal),
          eq(pedidoExterno.externalId, externalId),
        ),
      );
    if (!row) {
      this.logger.warn(`reflexo ${canal} → ${novoStatus}: pedido ${externalId.slice(0, 10)} não encontrado (externalId?)`);
      return;
    }
    // Retirada não tem "em rota" (não há entregador). Um reflexo de 'despachado'
    // (ex.: "Prontos para entrega" da Anota, que acumula retirada pronta + delivery
    // em rota) vira 'pronto' quando o pedido é retirada — aguardando o cliente buscar.
    if (novoStatus === 'despachado' && row.tipo === 'retirada') novoStatus = 'pronto';
    // Idempotente: já está no estado alvo ou já é terminal (não regride).
    if (row.status === novoStatus) return;
    if (row.status === 'cancelado' || row.status === 'concluido') return;
    // Não regride: só reflete se o alvo estiver ADIANTE do atual no fluxo
    // (cancelado é exceção — sempre encerra). RANK: novo<confirmado<pronto<despachado<concluido.
    if (novoStatus !== 'cancelado') {
      const RANK: Record<string, number> = { novo: 0, confirmado: 1, pronto: 2, despachado: 3, concluido: 4 };
      if ((RANK[novoStatus] ?? 0) <= (RANK[row.status] ?? 0)) return;
    }
    const patch: any = { status: novoStatus };
    if (novoStatus === 'cancelado') {
      patch.canceladoEm = new Date();
      patch.motivoCancelamento = row.motivoCancelamento ?? `Cancelado pelo ${canal}`;
    } else if (novoStatus === 'pronto') {
      patch.prontoEm = new Date();
    } else if (novoStatus === 'despachado') {
      patch.despachadoEm = new Date();
    } else {
      patch.concluidoEm = new Date();
    }
    const [upd] = await this.db
      .update(pedidoExterno)
      .set(patch)
      .where(eq(pedidoExterno.id, row.id))
      .returning();
    // Conclusão baixa o estoque e concilia o dinheiro (igual ao avanço manual).
    if (novoStatus === 'concluido' && upd.comandaId) {
      await this.vendas.baixarEstoqueExterno(tenantId, upd.comandaId).catch(() => {});
      await this.reconciliarDinheiro(tenantId, upd).catch(() => {});
    }
    this.logger.log(`reflexo ${canal} ${externalId.slice(0, 8)} → ${novoStatus}`);
    void this.dispararWebhook(tenantId, upd);
  }

  // Materializa (aceita) um pedido externo se ainda estiver 'novo'. Usado pelos pollers
  // (iFood/Anota) quando a plataforma CONFIRMA/avança o pedido por fora do kanban do
  // Regem — senão ele nunca vira produção e não aparece no KDS. Idempotente (só 'novo').
  async materializarSeNovoExterno(tenantId: string, canal: string, externalId: string) {
    const [row] = await this.db
      .select({ id: pedidoExterno.id, status: pedidoExterno.status })
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.tenantId, tenantId),
          eq(pedidoExterno.canal, canal),
          eq(pedidoExterno.externalId, externalId),
        ),
      );
    if (row && row.status === 'novo') {
      try {
        await this.aceitar(tenantId, null, row.id);
      } catch (e: any) {
        this.logger.warn(`materializar ${canal} ${externalId.slice(0, 8)}: ${e?.message ?? e}`);
      }
    }
  }

  // Lê o catálogo do Regem (categorias + produtos disponíveis no cardápio) para os
  // conectores EXPORTAREM pro marketplace (99food/Cardápio Web). Só produtos com
  // disponivel_cardapio=true. Retorna arrays crus (nome, codigo, preço, categoria).
  // canal: quando informado (ex.: '99food', 'cardapio_web'), exclui os produtos
  // pausados NAQUELE canal (produto.canais_pausados). Assim o toggle "Ativo no X"
  // do cadastro efetivamente tira o item do export daquela integração.
  async lerCatalogoParaExport(
    tenantId: string,
    canal?: string,
  ): Promise<{ categorias: any[]; produtos: any[] }> {
    const c: any = await this.db.execute(sql`
      select id, nome from categoria_produto
      where tenant_id = ${tenantId} order by ordem asc nulls last, nome asc`);
    const filtroCanal = canal
      ? sql`and (canais_pausados is null or not jsonb_exists(canais_pausados, ${canal}))`
      : sql``;
    const p: any = await this.db.execute(sql`
      select id, nome, codigo, preco_venda, preco_custo, categoria_id, descricao, canais_pausados
      from produto
      where tenant_id = ${tenantId} and deleted_at is null and disponivel_cardapio = true
      ${filtroCanal}`);
    return { categorias: (c?.rows ?? c) ?? [], produtos: (p?.rows ?? p) ?? [] };
  }

  // Unidade padrão do tenant (matriz) — usada quando o pedido externo chega sem
  // unidade, senão fica com unidade_id null e some do painel filtrado por loja.
  private async unidadePadrao(tenantId: string): Promise<string | null> {
    const r: any = await this.db.execute(sql`
      select id from unidade
      where tenant_id = ${tenantId} and deleted_at is null
      order by (tipo = 'matriz') desc, created_at asc
      limit 1
    `);
    return (r?.rows ?? r)?.[0]?.id ?? null;
  }

  // A nuvem deve adiar a materialização deste pedido para o EDGE? Sim quando NÃO
  // estamos no edge E a loja tem um servidor edge com heartbeat recente (~3 min).
  private async deferirParaEdge(tenantId: string): Promise<boolean> {
    if (String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true') return false;
    const limite = new Date(Date.now() - 3 * 60 * 1000);
    const [hb] = await this.db
      .select({ id: edgeHeartbeat.id })
      .from(edgeHeartbeat)
      .where(and(eq(edgeHeartbeat.tenantId, tenantId), gte(edgeHeartbeat.recebidoEm, limite)))
      .limit(1);
    return !!hb;
  }

  // ===== Ingestão (edge → nós) =====
  // Recebe o pedido bruto do canal, normaliza e grava (dedup por external_id).
  // Se a unidade estiver em auto-aceitar, já vira venda + produção.
  async ingest(
    tenantId: string,
    unidadeId: string | null,
    canal: string,
    raw: any,
    extra?: {
      taxaEntrega?: number;
      cupom?: string;
      desconto?: number;
      trocoPara?: number;
      statusPagamento?: string;
      agendamento?: string | Date;
      profissional?: string;
      cnpj?: string;
      clienteTelefone2?: string;
      enderecoRua?: string;
      enderecoNumero?: string;
      enderecoReferencia?: string;
      enderecoBairro?: string;
      bandeira?: string;
      clientRef?: string;
    },
  ) {
    const norm: PedidoNormalizado = adaptar(canal, raw);
    // Sem unidade explícita → cai na matriz (senão o pedido some do painel/KDS
    // filtrado por loja). Vale p/ iFood, Cardápio Web e demais marketplaces.
    if (!unidadeId) unidadeId = await this.unidadePadrao(tenantId);
    // Idempotência do pedido público (retry do cliente): mesmo client_ref = mesmo pedido.
    if (extra?.clientRef) {
      const [ja] = await this.db
        .select()
        .from(pedidoExterno)
        .where(
          and(
            eq(pedidoExterno.tenantId, tenantId),
            eq(pedidoExterno.clientRef, extra.clientRef),
          ),
        );
      if (ja) return ja;
    }
    if (norm.externalId) {
      const [ja] = await this.db
        .select()
        .from(pedidoExterno)
        .where(
          and(
            eq(pedidoExterno.tenantId, tenantId),
            eq(pedidoExterno.canal, canal),
            eq(pedidoExterno.externalId, norm.externalId),
          ),
        );
      if (ja) return ja; // idempotente: webhook duplicado
    }
    // Nº sequencial do dia (fuso SP) — o "#284" do card.
    const nq: any = await this.db.execute(sql`
      select coalesce(max(numero), 0) + 1 as n from pedido_externo
      where tenant_id = ${tenantId}
        and (criado_em at time zone 'America/Sao_Paulo')::date
            = (now() at time zone 'America/Sao_Paulo')::date`);
    const numero = Number((nq.rows ?? nq)[0].n) || 1;
    let row: typeof pedidoExterno.$inferSelect;
    try {
      [row] = await this.db
      .insert(pedidoExterno)
      .values({
        tenantId,
        unidadeId,
        canal,
        numero,
        clientRef: extra?.clientRef ?? null,
        externalId: norm.externalId,
        displayId: norm.displayId ?? `#${numero}`,
        clienteNome: norm.clienteNome,
        clienteTelefone: norm.clienteTelefone,
        tipo: norm.tipo,
        endereco: norm.endereco,
        itens: norm.itens as any,
        total: String(norm.total.toFixed(2)),
        formaPagamento: norm.formaPagamento,
        status: 'novo',
        taxaEntrega: String(Number(extra?.taxaEntrega ?? 0).toFixed(2)),
        cupom: extra?.cupom ?? null,
        desconto: String(Number(extra?.desconto ?? 0).toFixed(2)),
        trocoPara: extra?.trocoPara != null ? String(extra.trocoPara) : null,
        // Pago online (PIX/cartão/carteira) NÃO é "a pagar". extra.statusPagamento
        // (cardápio/gateway) tem precedência; senão usa o `pago` detectado no adapter.
        pago: extra?.statusPagamento === 'aprovado' ? true : norm.pago ?? false,
        statusPagamento: extra?.statusPagamento ?? (norm.pago ? 'aprovado' : 'na_entrega'),
        agendamento: extra?.agendamento ? new Date(extra.agendamento) : null,
        profissional: extra?.profissional ?? null,
        cnpj: extra?.cnpj ?? null,
        clienteTelefone2: extra?.clienteTelefone2 ?? null,
        enderecoRua: extra?.enderecoRua ?? null,
        enderecoNumero: extra?.enderecoNumero ?? null,
        enderecoReferencia: extra?.enderecoReferencia ?? null,
        enderecoBairro: extra?.enderecoBairro ?? null,
        bandeira: extra?.bandeira ?? null,
        raw: raw as any,
      })
      .returning();
    } catch (e: any) {
      // Corrida: duas requisições com o mesmo client_ref ao mesmo tempo. O índice
      // único barra a 2ª (23505) — devolvemos o pedido que a 1ª já criou.
      if (e?.code === '23505' && extra?.clientRef) {
        const [ja] = await this.db
          .select()
          .from(pedidoExterno)
          .where(
            and(
              eq(pedidoExterno.tenantId, tenantId),
              eq(pedidoExterno.clientRef, extra.clientRef),
            ),
          );
        if (ja) return ja;
      }
      throw e;
    }

    const cfg = await this.configRaw(tenantId, unidadeId);
    // P1: se a loja tem servidor edge ativo (modo local), a nuvem NÃO materializa —
    // o pedido desce pelo sync e o edge o processa localmente (KDS/estoque).
    if (cfg?.autoAceitar && !(await this.deferirParaEdge(tenantId))) {
      try {
        return await this.aceitar(tenantId, null, row.id);
      } catch {
        // Aceite automático falhou (ex.: produto sem cadastro): mantém 'novo',
        // mas sinaliza para aparecer em destaque na coluna Chegada.
        const [flag] = await this.db
          .update(pedidoExterno)
          .set({ autoAceiteFalhou: true })
          .where(eq(pedidoExterno.id, row.id))
          .returning();
        return flag ?? row;
      }
    }
    return row;
  }

  // ===== Gestão (PDV) =====
  // Ativos (qualquer idade) + finalizados das últimas 24h (coluna Finalizado).
  async listar(
    tenantId: string,
    atual: string | null = null,
    opts?: { excluirRetirada?: boolean },
  ) {
    // Janela de retenção dos finalizados (concluído/cancelado) no quadro — horas
    // configuráveis (padrão 5h). Só afeta a coluna "Finalizado"; os ativos sempre aparecem.
    const cfg = await this.getConfig(tenantId, atual);
    const horas = Math.min(240, Math.max(1, Number(cfg?.finalizadoHoras) || 5));
    const desde = new Date(Date.now() - horas * 60 * 60 * 1000);
    const rows = await this.db
      .select()
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.tenantId, tenantId),
          // Pedidos de marketplace (iFood/Anota) podem chegar SEM unidade (unidade_id
          // null = "rede"). condUnidadeOuRede inclui os null → não somem do quadro
          // quando há uma unidade selecionada no topo (bug: apareciam no KDS, não aqui).
          condUnidadeOuRede(pedidoExterno.unidadeId, atual),
          or(
            inArray(pedidoExterno.status, [
              'novo',
              'confirmado',
              'pronto',
              'despachado',
            ]),
            and(
              inArray(pedidoExterno.status, ['concluido', 'cancelado']),
              gte(pedidoExterno.criadoEm, desde),
            ),
          ),
        ),
      )
      .orderBy(desc(pedidoExterno.criadoEm))
      .limit(200);
    // Total de pedidos (histórico completo) por telefone — ícone no card do kanban.
    const counts = new Map<string, number>();
    if (rows.length) {
      const c: any = await this.db.execute(sql`
        select cliente_telefone as tel, count(*)::int as n
        from pedido_externo
        where tenant_id = ${tenantId} and cliente_telefone is not null and cliente_telefone <> ''
          ${atual ? sql`and unidade_id = ${atual}` : sql``}
        group by 1
      `);
      for (const x of c?.rows ?? c) counts.set(String(x.tel), Number(x.n));
    }
    // Painel de Delivery: retirada (imediata) tem hub próprio ("Balcão retirada /
    // encomendas") — não deve aparecer aqui. Encomenda de ENTREGA continua no painel.
    const base = opts?.excluirRetirada ? rows.filter((r) => r.tipo !== 'retirada') : rows;
    return base.map((r) => ({
      ...r,
      clientePedidosCount: r.clienteTelefone ? counts.get(r.clienteTelefone) ?? 1 : 1,
    }));
  }

  private async carregar(tenantId: string, id: string) {
    const [p] = await this.db
      .select()
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.id, id), eq(pedidoExterno.tenantId, tenantId)));
    if (!p) throw new NotFoundException('Pedido externo não encontrado');
    return p;
  }

  // Aceita: mapeia itens → produtos (por código/SKU) e cria a venda externa.
  async aceitar(tenantId: string, atorId: string | null, id: string) {
    const ped = await this.carregar(tenantId, id);
    if (ped.status !== 'novo')
      throw new BadRequestException('Pedido já foi aceito.');

    const itens = (ped.itens as any[]) ?? [];
    const codigos = itens.map((i) => i.codigo).filter(Boolean);
    const nomes = itens.map((i) => i.descricao).filter(Boolean);
    const nomesLower = nomes.map((n) => String(n).trim().toLowerCase());
    // Casa por CÓDIGO/SKU e, como reserva, por NOME (case-insensitive) — ajuda
    // quando o marketplace não manda um código PDV estável (ex.: iFood).
    const prods =
      codigos.length || nomesLower.length
        ? await this.db
            .select({ id: produto.id, codigo: produto.codigo, nome: produto.nome })
            .from(produto)
            .where(
              and(
                eq(produto.tenantId, tenantId),
                or(
                  codigos.length ? inArray(produto.codigo, codigos) : undefined,
                  nomesLower.length
                    ? or(...nomesLower.map((n) => sql`lower(${produto.nome}) = ${n}`))
                    : undefined,
                ),
              ),
            )
        : [];
    const porCodigo = new Map(prods.filter((p) => p.codigo).map((p) => [p.codigo, p.id]));
    const porNome = new Map(prods.map((p) => [String(p.nome).trim().toLowerCase(), p.id]));

    const PLAT: Record<string, string> = { cardapio: 'Cardápio', ifood: 'iFood', totem: 'Totem' };
    const cfg = await this.configRaw(tenantId, ped.unidadeId);
    // Retirada/consumo no local = produção do BALCÃO; entrega (courier) = DELIVERY.
    // A plataforma (iFood/Cardápio/Totem) segue no rótulo do card em ambos.
    const venda = await this.vendas.venderExterno(tenantId, atorId, {
      unidadeId: ped.unidadeId,
      cliente: ped.clienteNome,
      forma: ped.formaPagamento ?? 'online',
      origem: ped.tipo === 'retirada' ? 'balcao' : 'delivery',
      setorId: (cfg as any)?.setorId ?? null,
      plataforma: PLAT[ped.canal] ?? ped.canal,
      senhaPlataforma: ped.displayId ?? null,
      itens: itens.map((it) => ({
        produtoId:
          it.produtoId ??
          (it.codigo ? porCodigo.get(it.codigo) : undefined) ??
          porNome.get(String(it.descricao).trim().toLowerCase()) ??
          null,
        descricao: it.descricao,
        quantidade: Number(it.quantidade) || 1,
        precoUnitario: Number(it.precoUnitario) || 0,
        observacao: it.observacao ?? null,
        // Complementos (batata/bebida) NÃO são observação — vão para o campo próprio,
        // que o KDS mostra em dourado (não no vermelho de OBS).
        complementosTexto: (it as any).complementos ?? null,
        // Ids das opções escolhidas (só origem interna: cardápio/totem) → roteamento
        // por opção/etapa no criarPedidos (Fase 1). Marketplaces não mandam nossos ids.
        complementos: (it as any).opcaoIds ?? [],
      })),
    });

    const [row] = await this.db
      .update(pedidoExterno)
      .set({
        status: 'confirmado',
        comandaId: venda.comandaId,
        confirmadoEm: new Date(),
        autoAceiteFalhou: false,
      })
      .where(eq(pedidoExterno.id, id))
      .returning();
    void this.dispararWebhook(tenantId, row);
    void this.statusBackCw(tenantId, row, 'confirm');
    void this.statusBackIfood(tenantId, row, 'confirm');
    void this.statusBackFood99(tenantId, row, 'confirm');
    // Cashback: credita o retorno no saldo do cliente após a confirmação.
    void this.cashback
      .creditarPedido(tenantId, {
        telefone: row.clienteTelefone ?? undefined,
        clienteId: row.clienteId ?? undefined,
        pedidoId: row.id,
        total: Number(row.total),
        taxaEntrega: Number(row.taxaEntrega),
      })
      .catch(() => {});
    return row;
  }

  async avancar(
    tenantId: string,
    id: string,
    dados?: {
      entregadorId?: string | null;
      entregadorNome?: string | null;
      entregadorTelefone?: string | null;
    },
  ) {
    const ped = await this.carregar(tenantId, id);
    if (ped.status === 'cancelado' || ped.status === 'novo')
      throw new BadRequestException('Aceite o pedido antes de avançar.');
    const idx = FLUXO.indexOf(ped.status);
    if (idx < 0 || idx >= FLUXO.length - 1)
      throw new BadRequestException('Pedido já concluído.');
    const proximo = FLUXO[idx + 1];
    // Retirada não passa por "despachado" (não há entregador): pronto → concluído.
    const novo = ped.tipo === 'retirada' && proximo === 'despachado' ? 'concluido' : proximo;
    const patch: any = { status: novo };
    if (novo === 'pronto') patch.prontoEm = new Date();
    if (novo === 'despachado') {
      patch.despachadoEm = new Date();
      // Entrega recebe o entregador; retirada não precisa.
      if (dados?.entregadorNome != null)
        patch.entregadorNome = dados.entregadorNome || null;
      if (dados?.entregadorId != null)
        patch.entregadorId = dados.entregadorId || null;
      if (dados?.entregadorTelefone != null)
        patch.entregadorTelefone = dados.entregadorTelefone || null;
    }
    if (novo === 'concluido') patch.concluidoEm = new Date();
    const [row] = await this.db
      .update(pedidoExterno)
      .set(patch)
      .where(eq(pedidoExterno.id, id))
      .returning();
    // Ao concluir (entrega): baixa o estoque e concilia o dinheiro na gaveta.
    if (novo === 'concluido' && row.comandaId) {
      await this.vendas.baixarEstoqueExterno(tenantId, row.comandaId).catch(() => {});
      await this.reconciliarDinheiro(tenantId, row);
    }
    void this.dispararWebhook(tenantId, row);
    if (novo === 'despachado') void this.statusBack(tenantId, row, 'dispatch');
    // Cardápio Web — mapeamento por tipo, alinhado ao fluxo do CW:
    //  retirada: pronto→ready (pronto p/ retirar), concluído→finalize
    //  delivery: pronto→(sem mudança), despachado→ready (saiu p/ entrega/em rota),
    //            concluído→delivered (entregue)
    if (row.tipo === 'retirada') {
      if (novo === 'pronto') void this.statusBackCw(tenantId, row, 'ready');
      else if (novo === 'concluido') void this.statusBackCw(tenantId, row, 'finalize');
    } else {
      if (novo === 'despachado') void this.statusBackCw(tenantId, row, 'ready');
      else if (novo === 'concluido') void this.statusBackCw(tenantId, row, 'delivered');
    }
    // iFood: pronto → readyToPickup; despachado → dispatch.
    if (novo === 'pronto') void this.statusBackIfood(tenantId, row, 'ready');
    else if (novo === 'despachado') void this.statusBackIfood(tenantId, row, 'dispatch');
    // 99food: pronto → ready; concluído → delivered (self-delivery).
    if (novo === 'pronto') void this.statusBackFood99(tenantId, row, 'ready');
    else if (novo === 'concluido') void this.statusBackFood99(tenantId, row, 'delivered');
    // Anota Aí: pronto → pronto; concluído → finalizar.
    if (novo === 'pronto') void this.statusBackAnotaAi(tenantId, row, 'ready');
    else if (novo === 'concluido') void this.statusBackAnotaAi(tenantId, row, 'finalizar');
    return row;
  }

  // Despacha DIRETO para "em rota" (Painel de controle): confirmado|pronto →
  // despachado, pulando a etapa 'pronto' do AVANÇAR (o 'pronto' fica só no botão
  // PRONTO e no reflexo do KDS). Só entrega (retirada não vai para rota).
  async despachar(
    tenantId: string,
    id: string,
    dados?: {
      entregadorId?: string | null;
      entregadorNome?: string | null;
      entregadorTelefone?: string | null;
    },
  ) {
    const ped = await this.carregar(tenantId, id);
    if (ped.tipo === 'retirada')
      throw new BadRequestException('Pedido de retirada não vai para entrega.');
    if (!['confirmado', 'pronto'].includes(ped.status))
      throw new BadRequestException('Só é possível despachar um pedido em produção ou pronto.');
    const [row] = await this.db
      .update(pedidoExterno)
      .set({
        status: 'despachado',
        despachadoEm: new Date(),
        entregadorNome:
          dados?.entregadorNome != null ? dados.entregadorNome || null : ped.entregadorNome,
        entregadorId:
          dados?.entregadorId != null ? dados.entregadorId || null : ped.entregadorId,
        entregadorTelefone:
          dados?.entregadorTelefone != null
            ? dados.entregadorTelefone || null
            : ped.entregadorTelefone,
      })
      .where(eq(pedidoExterno.id, id))
      .returning();
    void this.dispararWebhook(tenantId, row);
    void this.statusBack(tenantId, row, 'dispatch');
    void this.statusBackCw(tenantId, row, 'ready'); // CW: saiu para entrega
    void this.statusBackIfood(tenantId, row, 'dispatch');
    return row;
  }

  // Reflexo do KDS: quando a produção da comanda fica 'pronto', o pedido de delivery
  // ligado sobe para 'pronto' no Painel (só se ainda estiver 'confirmado'). Idempotente
  // e best-effort — nunca derruba o avanço do KDS.
  @OnEvent('producao.pronto')
  async aoProducaoPronto(payload: { tenantId: string; comandaId?: string | null }) {
    const tenantId = payload?.tenantId;
    const comandaId = payload?.comandaId;
    if (!tenantId || !comandaId) return;
    try {
      const [ped] = await this.db
        .select({ id: pedidoExterno.id, status: pedidoExterno.status })
        .from(pedidoExterno)
        .where(and(eq(pedidoExterno.tenantId, tenantId), eq(pedidoExterno.comandaId, comandaId)));
      if (ped && ped.status === 'confirmado') {
        await this.avancar(tenantId, ped.id); // confirmado → pronto (+ status-back ready)
      }
    } catch {
      // silencioso
    }
  }

  // Finaliza a entrega (Painel de controle, Fase 5). Pago online conclui direto;
  // a-receber exige a CONFERÊNCIA (forma recebida) e registra o valor no caixa de
  // entregas (turno 'delivery' aberto) antes de concluir. Sem forma no a-receber,
  // devolve { precisaConferencia } para o front abrir o modal.
  async finalizar(
    tenantId: string,
    atorId: string,
    id: string,
    opts: { forma?: string; valorRecebido?: number } = {},
  ) {
    const ped = await this.carregar(tenantId, id);
    if (ped.status === 'concluido') return ped;
    if (ped.status !== 'despachado')
      throw new BadRequestException('Só é possível finalizar um pedido em rota.');
    // Pago online (ou já quitado): conclui direto, sem conferência.
    if (ped.pago) return this.avancar(tenantId, id);
    // A-receber: precisa da forma recebida (conferência).
    const forma = String(opts.forma ?? '').trim().toLowerCase();
    if (!forma) return { precisaConferencia: true };
    // Registra o recebimento no caixa de entregas aberto.
    const [sessao] = await this.db
      .select({ id: caixaSessao.id })
      .from(caixaSessao)
      .where(
        and(
          eq(caixaSessao.tenantId, tenantId),
          eq(caixaSessao.status, 'aberta'),
          eq(caixaSessao.origem, 'delivery'),
        ),
      );
    if (!sessao)
      throw new BadRequestException(
        'Abra o caixa de entregas para registrar o recebimento do entregador.',
      );
    await this.db
      .update(pedidoExterno)
      .set({
        pago: true,
        statusPagamento: 'aprovado',
        formaPagamento: forma,
        caixaSessaoId: sessao.id,
      })
      .where(eq(pedidoExterno.id, id));
    // Re-aponta o lançamento da venda para o caixa de entregas com a forma recebida.
    if (ped.comandaId) {
      await this.db
        .update(lancamentoCaixa)
        .set({ sessaoId: sessao.id, forma })
        .where(
          and(
            eq(lancamentoCaixa.tenantId, tenantId),
            eq(lancamentoCaixa.comandaId, ped.comandaId),
            eq(lancamentoCaixa.tipo, 'entrada'),
            eq(lancamentoCaixa.categoria, 'venda'),
          ),
        );
    }
    // Conclui (baixa estoque + webhooks/status-back). Como pago=true, o
    // reconciliarDinheiro interno vira no-op (já registramos acima).
    return this.avancar(tenantId, id);
  }

  // ===== Hub "Retirada / Encomendas" (Fase 1, mig 132) =====
  // Grupo de origem do pedido: 'regem' (cardápio próprio) | 'integrado' | 'marketplace'.
  private static grupoCanal(canal: string): 'regem' | 'integrado' | 'marketplace' {
    const c = String(canal || '').toLowerCase();
    if (['ifood', '99food', 'keeta'].includes(c)) return 'marketplace';
    if (['anotaai', 'cardapio_web', 'delivery_direto', 'rappi'].includes(c)) return 'integrado';
    return 'regem'; // cardapio, manual, balcao, n8n…
  }

  // Lista só os pedidos de RETIRADA e ENCOMENDA, com o grupo de origem e o tipo
  // (retirada = imediata; encomenda = agendada). O front agrupa pelos 3 grupos.
  async listarRetirada(tenantId: string, atual: string | null = null) {
    const rows = await this.listar(tenantId, atual);
    return rows
      .filter((r) => r.tipo === 'retirada' || r.agendamento != null)
      .map((r) => ({
        ...r,
        grupoCanal: DeliveryService.grupoCanal(r.canal),
        retiradaTipo: r.agendamento != null ? 'encomenda' : 'retirada',
      }));
  }

  // Entrega no balcão: conclui um pedido de retirada/encomenda. Se for A-PAGAR
  // (não pago online), joga o valor no caixa (turno) ABERTO do atendente (origem
  // 'pdv' do terminal). Pago online → só conclui (não entra no caixa). mig 132.
  async entregarBalcao(
    tenantId: string,
    atorId: string | null,
    id: string,
    terminalId: string | null,
    dados?: { forma?: string | null },
  ) {
    const ped = await this.carregar(tenantId, id);
    if (ped.status === 'cancelado') throw new BadRequestException('Pedido cancelado.');
    if (ped.status === 'concluido') throw new BadRequestException('Pedido já concluído.');
    if (ped.status === 'novo') throw new BadRequestException('Aceite o pedido antes de entregar.');

    const agora = new Date();
    const patch: any = {
      status: 'concluido',
      concluidoEm: agora,
      entregueEm: agora,
      atendenteId: atorId ?? null,
    };
    // A-pagar: precisa do caixa do atendente aberto para receber o valor.
    let sessaoId: string | null = null;
    if (!ped.pago) {
      const [sessao] = await this.db
        .select({ id: caixaSessao.id })
        .from(caixaSessao)
        .where(
          and(
            eq(caixaSessao.tenantId, tenantId),
            eq(caixaSessao.status, 'aberta'),
            eq(caixaSessao.origem, 'pdv'),
            terminalId
              ? eq(caixaSessao.terminalId, terminalId)
              : isNull(caixaSessao.terminalId),
          ),
        );
      if (!sessao)
        throw new BadRequestException('Abra o caixa do PDV para cobrar a retirada.');
      sessaoId = sessao.id;
      patch.caixaSessaoId = sessaoId;
      patch.pago = true;
      patch.statusPagamento = 'aprovado';
    } else {
      patch.pagoOnline = true;
    }
    const [row] = await this.db
      .update(pedidoExterno)
      .set(patch)
      .where(eq(pedidoExterno.id, id))
      .returning();
    // Baixa o estoque na conclusão (idempotente por ref do movimento).
    if (row.comandaId)
      await this.vendas.baixarEstoqueExterno(tenantId, row.comandaId).catch(() => {});
    // Aponta o lançamento da venda para o caixa do atendente, com a forma cobrada.
    if (sessaoId && row.comandaId) {
      const forma = dados?.forma && String(dados.forma).trim() ? String(dados.forma).trim() : 'dinheiro';
      await this.db
        .update(lancamentoCaixa)
        .set({ sessaoId, forma })
        .where(
          and(
            eq(lancamentoCaixa.tenantId, tenantId),
            eq(lancamentoCaixa.comandaId, row.comandaId),
            eq(lancamentoCaixa.tipo, 'entrada'),
            eq(lancamentoCaixa.categoria, 'venda'),
          ),
        );
    }
    // Status-back de conclusão aos canais.
    void this.dispararWebhook(tenantId, row);
    if (row.tipo === 'retirada') void this.statusBackCw(tenantId, row, 'finalize');
    else void this.statusBackCw(tenantId, row, 'delivered');
    void this.statusBackFood99(tenantId, row, 'delivered');
    void this.statusBackAnotaAi(tenantId, row, 'finalizar');
    return row;
  }

  // "Avisar pronto": marca o pedido como pronto (dispara os status-backs dos canais
  // integrados) e, no cardápio próprio, notifica o cliente pelo robô (n8n). mig 132.
  async avisarPronto(tenantId: string, id: string) {
    const ped = await this.carregar(tenantId, id);
    if (ped.status === 'cancelado' || ped.status === 'concluido')
      throw new BadRequestException('Pedido não está em preparo.');
    // Ainda em produção? avança para "pronto" (isso já dispara os canais).
    if (ped.status === 'confirmado') await this.avancar(tenantId, id);
    const [row] = await this.db
      .update(pedidoExterno)
      .set({ avisadoProntoEm: new Date() })
      .where(eq(pedidoExterno.id, id))
      .returning();
    // Cardápio próprio (Regem): dispara a notificação ao cliente pelo robô.
    if (DeliveryService.grupoCanal(row.canal) === 'regem')
      void this.dispararWebhook(tenantId, row, 'pronto');
    return row;
  }

  // Correção de avanço errado: volta de "em rota" para a produção.
  async retornarProducao(tenantId: string, id: string) {
    const ped = await this.carregar(tenantId, id);
    if (ped.status !== 'despachado')
      throw new BadRequestException('Só um pedido em rota pode retornar à produção.');
    const [row] = await this.db
      .update(pedidoExterno)
      .set({
        status: 'confirmado',
        despachadoEm: null,
        entregadorId: null,
        entregadorNome: null,
        entregadorTelefone: null,
      })
      .where(eq(pedidoExterno.id, id))
      .returning();
    void this.dispararWebhook(tenantId, row);
    return row;
  }

  // "Voltar pedido" na coluna Finalizado: reabre um pedido concluído/cancelado,
  // trazendo-o de volta uma etapa. Exige senha de gestor (presidente/C&O). A baixa
  // de estoque feita na conclusão NÃO é estornada (o re-concluir é idempotente).
  async voltarPedido(tenantId: string, atorId: string | null, id: string, senha?: string) {
    const ped = await this.carregar(tenantId, id);
    if (ped.status !== 'concluido' && ped.status !== 'cancelado')
      throw new BadRequestException('Só um pedido finalizado pode voltar.');
    // Autorização de gestor (mesmo portão do cancelamento).
    await this.autorizarPorSenha(tenantId, senha);
    // Destino: cancelado → confirmado; concluído → em rota (entrega) ou pronto (retirada).
    const destino =
      ped.status === 'cancelado'
        ? 'confirmado'
        : ped.tipo === 'retirada'
          ? 'pronto'
          : 'despachado';
    const patch: any = { status: destino, concluidoEm: null, canceladoEm: null, motivoCancelamento: null };
    if (destino !== 'despachado') {
      patch.despachadoEm = null;
      patch.entregadorId = null;
      patch.entregadorNome = null;
      patch.entregadorTelefone = null;
    }
    const [row] = await this.db
      .update(pedidoExterno)
      .set(patch)
      .where(eq(pedidoExterno.id, id))
      .returning();
    void this.dispararWebhook(tenantId, row);
    return row;
  }

  // Se o pedido foi pago em dinheiro na entrega, amarra o lançamento da venda à
  // sessão de caixa do delivery aberta — assim o fechamento confere a gaveta.
  private async reconciliarDinheiro(tenantId: string, ped: any) {
    if (!ped?.comandaId || ped.pago) return;
    const forma = String(ped.formaPagamento ?? '');
    const ehDinheiro = /dinheiro|cash|money/i.test(forma) || ped.trocoPara != null;
    if (!ehDinheiro) return;
    const [sessao] = await this.db
      .select({ id: caixaSessao.id })
      .from(caixaSessao)
      .where(
        and(
          eq(caixaSessao.tenantId, tenantId),
          eq(caixaSessao.status, 'aberta'),
          eq(caixaSessao.origem, 'delivery'),
        ),
      );
    if (!sessao) return; // sem caixa do delivery aberto: fica só como receita
    await this.db
      .update(lancamentoCaixa)
      .set({ sessaoId: sessao.id, forma: 'dinheiro' })
      .where(
        and(
          eq(lancamentoCaixa.tenantId, tenantId),
          eq(lancamentoCaixa.comandaId, ped.comandaId),
          eq(lancamentoCaixa.tipo, 'entrada'),
          eq(lancamentoCaixa.categoria, 'venda'),
        ),
      );
  }

  // Valida a senha de login de um gestor (presidente/gerente) do tenant.
  // Retorna o colaborador que autorizou (para auditoria).
  private async autorizarPorSenha(tenantId: string, senha?: string) {
    if (!senha) throw new BadRequestException('Informe a senha de autorização.');
    const gestores = await this.db
      .select({ id: colaborador.id, nome: colaborador.nome, senhaHash: colaborador.senhaHash })
      .from(colaborador)
      .innerJoin(funcao, eq(funcao.id, colaborador.funcaoId))
      .where(
        and(
          eq(colaborador.tenantId, tenantId),
          isNotNull(colaborador.senhaHash),
          inArray(funcao.categoria, ['presidente', 'gerente']),
        ),
      );
    for (const g of gestores) {
      if (g.senhaHash && (await bcrypt.compare(senha, g.senhaHash)))
        return { id: g.id, nome: g.nome };
    }
    throw new ForbiddenException('Senha de gestor inválida.');
  }

  // `reaproveitado` (mig 128): quando o pedido JÁ produziu (baixou insumo), diz se o
  // insumo foi REUTILIZADO (volta ao estoque) ou virou PERDA (fica baixado). Default
  // true = reaproveitado (comportamento anterior).
  async cancelar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    id: string,
    motivo?: string,
    senha?: string,
    reaproveitado = true,
  ) {
    const ped = await this.carregar(tenantId, id);
    if (ped.status === 'cancelado')
      throw new BadRequestException('Pedido já cancelado.');
    if (ped.status === 'concluido')
      throw new BadRequestException('Pedido concluído não pode ser cancelado.');
    // Trava: exige senha de um gestor com autoridade para cancelar.
    const autorizou = await this.autorizarPorSenha(tenantId, senha);
    // Estorna o financeiro (a baixa de estoque só ocorre na conclusão, então não
    // há estoque a estornar aqui).
    if (ped.comandaId) {
      await this.vendas.estornarVendaExterna(
        tenantId,
        atorId,
        atorPerfil,
        ped.comandaId,
        motivo,
        reaproveitado,
      );
    }
    const [row] = await this.db
      .update(pedidoExterno)
      .set({
        status: 'cancelado',
        canceladoEm: new Date(),
        // Só faz sentido registrar quando houve produção (comanda) — senão nada baixou.
        estoqueReaproveitado: ped.comandaId ? reaproveitado : null,
        motivoCancelamento: motivo
          ? `${motivo} (autorizado por ${autorizou.nome})`
          : `autorizado por ${autorizou.nome}`,
      })
      .where(eq(pedidoExterno.id, id))
      .returning();
    void this.dispararWebhook(tenantId, row);
    void this.statusBackCw(tenantId, row, 'cancel');
    void this.statusBackIfood(tenantId, row, 'cancel');
    void this.statusBackFood99(tenantId, row, 'cancel');
    void this.statusBackAnotaAi(tenantId, row, 'cancel');
    // Integridade: cancelamento estorna cashback e pontos de fidelidade do pedido.
    // Cashback GASTO só volta se a loja configurou (default true); o GANHO sempre sai.
    // Fidelidade é perda FIXA do ponto (+ rollback do prêmio gerado; devolve o consumido).
    const [cfgLoja] = await this.db
      .select({ estorna: cardapioConfig.cancelamentoEstornaCashback })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId))
      .limit(1);
    const devolverGasto = cfgLoja?.estorna !== false;
    void this.cashback
      .estornarPedido(tenantId, id, row.clienteTelefone ?? undefined, devolverGasto)
      .catch(() => {});
    void this.fidelidade.estornarPedido(tenantId, id).catch(() => {});
    void this.statusBack(tenantId, row, 'cancel'); // avisa o marketplace
    return {
      ...row,
      // Informa o destino do insumo já baixado (perda × reutilizado) — mig 128.
      estoqueAviso: ped.comandaId
        ? reaproveitado
          ? 'Os insumos deste pedido foram devolvidos ao estoque (reutilizados).'
          : 'Os insumos deste pedido foram registrados como PERDA (não voltaram ao estoque).'
        : null,
    };
  }

  // Cancelamento automático pelo SISTEMA (cron de expiração de PIX) — sem senha de
  // gestor. O pedido está em 'novo' (nunca aceito → sem comanda/estoque a estornar).
  // Estorna cupom/cashback/fidelidade e avisa os canais. Idempotente.
  async cancelarSistema(tenantId: string, id: string, motivo: string) {
    const [ped] = await this.db
      .select({ status: pedidoExterno.status })
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.tenantId, tenantId), eq(pedidoExterno.id, id)));
    if (!ped || ped.status === 'cancelado' || ped.status === 'concluido') return { ok: false };
    const [row] = await this.db
      .update(pedidoExterno)
      .set({ status: 'cancelado', canceladoEm: new Date(), motivoCancelamento: motivo })
      .where(eq(pedidoExterno.id, id))
      .returning();
    void this.dispararWebhook(tenantId, row);
    const [cfgLoja] = await this.db
      .select({ estorna: cardapioConfig.cancelamentoEstornaCashback })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId))
      .limit(1);
    void this.cashback
      .estornarPedido(tenantId, id, row.clienteTelefone ?? undefined, cfgLoja?.estorna !== false)
      .catch(() => {});
    void this.fidelidade.estornarPedido(tenantId, id).catch(() => {});
    return { ok: true, id: row.id };
  }

  // ===== Alterar / reimprimir / entregadores =====
  // Bairros com taxa cadastrados (para o editor de endereço escolher).
  listarBairros(tenantId: string) {
    return this.db
      .select({ id: cardapioBairro.id, nome: cardapioBairro.nome, taxa: cardapioBairro.taxa })
      .from(cardapioBairro)
      .where(and(eq(cardapioBairro.tenantId, tenantId), eq(cardapioBairro.ativo, true)))
      .orderBy(cardapioBairro.ordem, cardapioBairro.nome);
  }

  // Mapa de calor de entregas por bairro (todos os canais). Agrega pedidos de
  // ENTREGA não cancelados no período. Sem lat/lng no pedido → visão por bairro
  // (o pedido só guarda `endereco_bairro`). Financeiro/receita: gestão apenas.
  async mapaCalorBairros(tenantId: string, dias: number) {
    const d = Math.max(1, Math.min(365, Math.floor(dias) || 30));
    const r: any = await this.db.execute(sql`
      select
        coalesce(nullif(trim(endereco_bairro), ''), 'Sem bairro') as bairro,
        count(*)::int as pedidos,
        coalesce(sum(total), 0) as receita,
        coalesce(round(avg(taxa_entrega), 2), 0) as taxa_media
      from pedido_externo
      where tenant_id = ${tenantId}
        and tipo = 'entrega'
        and status <> 'cancelado'
        and criado_em >= now() - (${d} * interval '1 day')
      group by 1
      order by pedidos desc, receita desc
    `);
    const rows = (r.rows ?? r) as any[];
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const totalPedidos = rows.reduce((s, x) => s + Number(x.pedidos), 0);
    const totalReceita = rows.reduce((s, x) => s + Number(x.receita), 0);
    const somaTaxaPonderada = rows.reduce(
      (s, x) => s + Number(x.taxa_media) * Number(x.pedidos),
      0,
    );
    const bairros = rows.map((x) => {
      const pedidos = Number(x.pedidos);
      const receita = Number(x.receita);
      return {
        bairro: x.bairro,
        pedidos,
        receita: round2(receita),
        ticketMedio: pedidos ? round2(receita / pedidos) : 0,
        taxaMedia: Number(x.taxa_media),
        // participação em pedidos (1 casa) — usado na barra de calor
        pct: totalPedidos ? Math.round((pedidos / totalPedidos) * 1000) / 10 : 0,
      };
    });
    return {
      periodoDias: d,
      geral: {
        pedidos: totalPedidos,
        receita: round2(totalReceita),
        ticketMedio: totalPedidos ? round2(totalReceita / totalPedidos) : 0,
        taxaMedia: totalPedidos ? round2(somaTaxaPonderada / totalPedidos) : 0,
        bairros: bairros.length,
      },
      bairros,
    };
  }

  // Resolve o bairro (taxa + nome) do cadastro de "área de atendimento":
  // por id, ou pelo nome (case-insensitive).
  private async resolverBairro(
    tenantId: string,
    bairroId?: string,
    bairroNome?: string,
  ): Promise<{ taxa: number; nome: string } | null> {
    if (bairroId) {
      const [b] = await this.db
        .select({ taxa: cardapioBairro.taxa, nome: cardapioBairro.nome })
        .from(cardapioBairro)
        .where(and(eq(cardapioBairro.tenantId, tenantId), eq(cardapioBairro.id, bairroId)));
      return b ? { taxa: Number(b.taxa), nome: b.nome } : null;
    }
    if (bairroNome?.trim()) {
      const [b] = await this.db
        .select({ taxa: cardapioBairro.taxa, nome: cardapioBairro.nome })
        .from(cardapioBairro)
        .where(and(eq(cardapioBairro.tenantId, tenantId), ilike(cardapioBairro.nome, bairroNome.trim())));
      return b ? { taxa: Number(b.taxa), nome: b.nome } : null;
    }
    return null;
  }

  async alterar(
    tenantId: string,
    atorId: string,
    id: string,
    dto: {
      adicionar?: { produtoId: string; quantidade?: number; observacao?: string }[];
      remover?: string[];
      endereco?: {
        rua?: string;
        numero?: string;
        bairro?: string;
        bairroId?: string;
        referencia?: string;
      };
    },
  ) {
    const ped = await this.carregar(tenantId, id);
    if (!['confirmado', 'pronto'].includes(ped.status))
      throw new BadRequestException(
        'Só dá para alterar um pedido aceito e ainda não despachado. Se já saiu, cancele e refaça.',
      );
    if (!ped.comandaId)
      throw new BadRequestException('Pedido sem venda vinculada.');

    // Subtotal dos itens: recalcula se houve mudança de itens; senão usa o atual.
    const mexeuItens = (dto.adicionar?.length ?? 0) > 0 || (dto.remover?.length ?? 0) > 0;
    let subtotal: number;
    if (mexeuItens) {
      const r = await this.vendas.alterarItensExterno(tenantId, atorId, ped.comandaId, {
        adicionar: dto.adicionar,
        remover: dto.remover,
      });
      subtotal = r.total;
    } else {
      subtotal = Number(ped.total) - Number(ped.taxaEntrega ?? 0) + Number(ped.desconto ?? 0);
    }

    const patch: any = { alterado: true, alteradoEm: new Date() };
    let taxa = Number(ped.taxaEntrega ?? 0);
    // Edição de endereço: atualiza campos e, se o bairro mudou, puxa a taxa do cadastro.
    if (dto.endereco) {
      const e = dto.endereco;
      if (e.rua != null) patch.enderecoRua = e.rua || null;
      if (e.numero != null) patch.enderecoNumero = e.numero || null;
      if (e.referencia != null) patch.enderecoReferencia = e.referencia || null;
      if (e.bairro != null || e.bairroId != null) {
        const b = await this.resolverBairro(tenantId, e.bairroId, e.bairro);
        // Nome do bairro: o do cadastro (se resolvido) ou o texto informado.
        patch.enderecoBairro = b?.nome ?? e.bairro ?? null;
        if (b) {
          taxa = b.taxa;
          patch.taxaEntrega = String(b.taxa.toFixed(2));
        }
      }
      const bairroFinal = patch.enderecoBairro ?? ped.enderecoBairro;
      patch.endereco = [e.rua ?? ped.enderecoRua, e.numero ?? ped.enderecoNumero, bairroFinal].filter(Boolean).join(', ') || ped.endereco;
    }

    patch.total = String((subtotal + taxa - Number(ped.desconto ?? 0)).toFixed(2));
    const [row] = await this.db
      .update(pedidoExterno)
      .set(patch)
      .where(eq(pedidoExterno.id, id))
      .returning();
    // Reimprime as vias configuradas com o novo conteúdo.
    await this.vendas.reimprimirViasExterno(tenantId, atorId, ped.comandaId).catch(() => {});
    return row;
  }

  // Itens reais da comanda (com id) — para o editor de "Alterar".
  async itensComanda(tenantId: string, id: string) {
    const ped = await this.carregar(tenantId, id);
    if (!ped.comandaId) return [];
    return this.db
      .select({
        id: comandaItem.id,
        descricao: comandaItem.descricao,
        quantidade: comandaItem.quantidade,
        precoUnitario: comandaItem.precoUnitario,
      })
      .from(comandaItem)
      .where(
        and(
          eq(comandaItem.tenantId, tenantId),
          eq(comandaItem.comandaId, ped.comandaId),
        ),
      );
  }

  async reimprimir(tenantId: string, atorId: string, id: string, alvoPreferido?: string | null) {
    const ped = await this.carregar(tenantId, id);
    if (!ped.comandaId)
      throw new BadRequestException('Pedido ainda não aceito (sem via para imprimir).');
    return this.vendas.reimprimirViasExterno(tenantId, atorId, ped.comandaId, alvoPreferido);
  }

  // ===== Integrações (credenciais de apps externos) =====
  // Delivery/marketplaces + integração + gateways de PIX (mercadopago/iugu no fim).
  private static readonly CANAIS_INTEGRACAO = ['ifood', '99food', 'delivery_direto', 'cardapio_web', 'rappi', 'anotaai', 'keeta', 'n8n', 'mercadopago', 'iugu'];

  // Avisa o webhook (n8n) quando o pedido muda de status. Fire-and-forget:
  // nunca quebra o fluxo do pedido. Assina o corpo com HMAC-SHA256 (X-Regem-Signature).
  private async dispararWebhook(tenantId: string, ped: any, evento = 'status') {
    try {
      const [row] = await this.db
        .select()
        .from(integracao)
        .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, 'n8n')));
      const url = row?.merchantId; // guardamos a URL do webhook no merchantId
      if (!row?.ativo || !url) return;
      const payload = {
        evento,
        pedidoId: ped.id,
        numero: ped.numero,
        displayId: ped.displayId,
        status: ped.status,
        tipo: ped.tipo,
        cliente: ped.clienteNome,
        telefone: ped.clienteTelefone,
        total: Number(ped.total),
        canal: ped.canal,
        entregadorNome: ped.entregadorNome ?? null,
        em: new Date().toISOString(),
      };
      const body = JSON.stringify(payload);
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (row.clientSecret)
        headers['X-Regem-Signature'] = createHmac('sha256', row.clientSecret).update(body).digest('hex');
      void fetch(url, { method: 'POST', headers, body }).catch(() => {});
    } catch {
      /* nunca quebra o pedido por causa do webhook */
    }
  }

  // Lista as integrações — SECRETS MASCARADOS (nunca voltam em texto).
  async listarIntegracoes(tenantId: string) {
    const rows = await this.db
      .select()
      .from(integracao)
      .where(eq(integracao.tenantId, tenantId));
    const porCanal = new Map(rows.map((r) => [r.canal, r]));
    // Sempre devolve os canais conhecidos (mesmo sem config), + extras salvos.
    const canais = [
      ...DeliveryService.CANAIS_INTEGRACAO,
      ...rows.map((r) => r.canal).filter((c) => !DeliveryService.CANAIS_INTEGRACAO.includes(c)),
    ];
    return canais.map((canal) => {
      const r: any = porCanal.get(canal);
      return {
        canal,
        ativo: !!r?.ativo,
        unidadeId: r?.unidadeId ?? null,
        merchantId: r?.merchantId ?? null,
        clientId: r?.clientId ?? null,
        cor: r?.config?.cor ?? null, // cor de identificação no kanban
        temSecret: !!r?.clientSecret,
        temToken: !!r?.token,
        // Estado do pedido de integração (Anota Aí/iFood): pendente | conectado |
        // recusado | pendente_remocao | removido — usado pelo card do cliente.
        // iFood ativo com merchant, mas sem pedido formal (conectado "por fora"),
        // conta como 'conectado' — senão o card mostra "Solicitar" com a integração no ar.
        pedidoStatus:
          r?.config?.pedidoIntegracao?.status ??
          (canal === 'ifood' && r?.ativo && r?.merchantId ? 'conectado' : null),
        updatedAt: r?.updatedAt ?? null,
      };
    });
  }

  // Upsert por (tenant, canal). Secret/token só são alterados quando um NOVO
  // valor não-vazio é enviado — senão o valor atual é preservado.
  async salvarIntegracao(tenantId: string, dto: any) {
    const canal = String(dto?.canal ?? '').trim();
    if (!canal) throw new BadRequestException('Canal obrigatório.');
    const [atual] = await this.db
      .select()
      .from(integracao)
      .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, canal)));
    const secretNovo = typeof dto.clientSecret === 'string' && dto.clientSecret.trim() ? dto.clientSecret.trim() : undefined;
    const tokenNovo = typeof dto.token === 'string' && dto.token.trim() ? dto.token.trim() : undefined;
    // Cor de identificação (kanban) — guardada no config jsonb, preservando o resto.
    // dto.cor: string preenchida = definir; '' = usar padrão (limpar); ausente = manter.
    const corDef = typeof dto.cor === 'string' ? dto.cor.trim() : undefined;
    const config = { ...((atual as any)?.config ?? {}) };
    if (corDef !== undefined) {
      if (corDef) config.cor = corDef;
      else delete config.cor;
    }
    // iFood tem fluxo PRÓPRIO (parceiro): ativação/merchant só via
    // /integracoes/ifood/solicitar + /distribuicao/.../resolver. Pela rota genérica
    // só deixamos ajustar campos benignos (ex.: cor no kanban) — ativar por fora
    // deixaria a integração invisível na distribuição (sem pedidoIntegracao).
    const fluxoProprio = canal === 'ifood';
    const vals: any = {
      ativo: fluxoProprio
        ? atual?.ativo ?? false
        : dto.ativo != null
          ? !!dto.ativo
          : atual?.ativo ?? false,
      merchantId: fluxoProprio ? atual?.merchantId ?? null : dto.merchantId ?? atual?.merchantId ?? null,
      clientId: fluxoProprio ? atual?.clientId ?? null : dto.clientId ?? atual?.clientId ?? null,
      clientSecret: fluxoProprio ? atual?.clientSecret ?? null : secretNovo ?? atual?.clientSecret ?? null,
      token: fluxoProprio ? atual?.token ?? null : tokenNovo ?? atual?.token ?? null,
      config,
      updatedAt: new Date(),
    };
    if (atual) {
      await this.db.update(integracao).set(vals).where(eq(integracao.id, atual.id));
    } else {
      await this.db.insert(integracao).values({ tenantId, unidadeId: dto.unidadeId ?? null, canal, ...vals });
    }
    return { ok: true };
  }

  // Testa a conexão de um gateway de PIX validando o token na API do provedor.
  // Usa o token do corpo (o que está no campo, ainda não salvo) ou, se vazio, o salvo.
  async testarGatewayPix(tenantId: string, canal: string, tokenBody?: string) {
    if (canal !== 'mercadopago' && canal !== 'iugu')
      throw new BadRequestException('Canal inválido para teste de PIX.');
    let token = String(tokenBody ?? '').trim();
    if (!token) {
      const [row] = await this.db
        .select({ token: integracao.token })
        .from(integracao)
        .where(and(eq(integracao.tenantId, tenantId), eq(integracao.canal, canal)));
      token = row?.token ?? '';
    }
    if (!token)
      throw new BadRequestException('Cole o token no campo antes de testar (ou salve-o primeiro).');
    try {
      const r = canal === 'mercadopago' ? await validarTokenMP(token) : await validarTokenIugu(token);
      return { ok: true as const, conta: r.conta ?? null };
    } catch (e) {
      throw new BadRequestException(e instanceof Error ? e.message : 'Token inválido');
    }
  }

  // Entregadores = colaboradores ativos com função cujo nome contém "entregador".
  async listarEntregadores(tenantId: string) {
    return this.db
      .select({
        id: colaborador.id,
        nome: colaborador.nome,
        telefone: colaborador.telefone,
      })
      .from(colaborador)
      .innerJoin(funcao, eq(funcao.id, colaborador.funcaoId))
      .where(
        and(
          eq(colaborador.tenantId, tenantId),
          eq(colaborador.status, 'ativo'),
          ilike(funcao.nome, '%entregador%'),
        ),
      )
      .orderBy(colaborador.nome);
  }

  // ===== Config =====
  private async configRaw(tenantId: string, unidadeId?: string | null) {
    // Config por unidade COM herança da rede: usa a config específica da unidade
    // quando existe; senão cai na config padrão da rede (unidade_id null). Sem
    // isso, um pedido de uma unidade sem config própria não enxerga o
    // "aceitar automático" ligado na rede.
    const rows = await this.db
      .select()
      .from(deliveryConfig)
      .where(
        and(
          eq(deliveryConfig.tenantId, tenantId),
          unidadeId
            ? or(eq(deliveryConfig.unidadeId, unidadeId), sql`unidade_id is null`)
            : sql`unidade_id is null`,
        ),
      );
    return (
      rows.find((r) => r.unidadeId === unidadeId) ??
      rows.find((r) => r.unidadeId == null) ??
      rows[0]
    );
  }

  async getConfig(tenantId: string, unidadeId?: string | null) {
    const row = await this.configRaw(tenantId, unidadeId);
    const base =
      row ?? {
        ativo: false,
        autoAceitar: false,
        colunas: DeliveryService.COLUNAS_PADRAO,
        cupomLayout: {},
        prepBalcaoMin: 15,
        prepBalcaoMax: 25,
        prepDeliveryMin: 45,
        prepDeliveryMax: 55,
        setorId: null,
        finalizadoHoras: 5,
        qrDespacho: false,
        adiarProducaoAteKds: false,
        pausadoAte: null,
        pausaMotivo: null,
      };
    // Pausa reativa sozinha: 'pausado' é computado (janela ainda válida?).
    const pausado = !!base.pausadoAte && new Date(base.pausadoAte) > new Date();
    return { ...base, pausado, pausadoAte: pausado ? base.pausadoAte : null };
  }

  // ===== QR do entregador (Fase 4) — despacho self-service pelo cupom =====
  // Garante o token de despacho do pedido (curto). O QR do cupom do entregador leva
  // {base}/e/{token}. Idempotente.
  async tokenDespacho(tenantId: string, pedidoId: string): Promise<string> {
    const [row] = await this.db
      .select({ token: pedidoExterno.despachoToken })
      .from(pedidoExterno)
      .where(and(eq(pedidoExterno.tenantId, tenantId), eq(pedidoExterno.id, pedidoId)));
    if (row?.token) return row.token;
    const token = randomBytes(6).toString('hex'); // 12 chars — curto, imprime bem no QR
    await this.db.update(pedidoExterno).set({ despachoToken: token }).where(eq(pedidoExterno.id, pedidoId));
    return token;
  }

  // Público (só pelo token do QR): dados do pedido + entregadores da loja p/ a tela.
  async despachoInfo(token: string) {
    const [ped] = await this.db.select().from(pedidoExterno).where(eq(pedidoExterno.despachoToken, token));
    if (!ped) throw new NotFoundException('Pedido não encontrado.');
    const endereco = [ped.endereco, ped.enderecoNumero, ped.enderecoBairro, ped.enderecoReferencia]
      .filter(Boolean)
      .join(', ');
    const entregadores = await this.listarEntregadores(ped.tenantId).catch(() => []);
    return {
      numero: ped.numero,
      cliente: ped.clienteNome,
      telefone: ped.clienteTelefone,
      endereco: endereco || null,
      itens: ped.itens ?? [],
      status: ped.status,
      jaDespachado: ['despachado', 'concluido'].includes(String(ped.status)),
      cancelado: ped.status === 'cancelado',
      entregadorNome: ped.entregadorNome,
      entregadores,
    };
  }

  // Público (token): o entregador se identifica e o pedido sai para entrega (despachado),
  // atrelado a ele. Idempotente (se já saiu, devolve ok).
  async despachoConfirmar(token: string, dados: { entregadorId?: string; entregadorNome?: string }) {
    const [ped] = await this.db.select().from(pedidoExterno).where(eq(pedidoExterno.despachoToken, token));
    if (!ped) throw new NotFoundException('Pedido não encontrado.');
    if (['despachado', 'concluido'].includes(String(ped.status)))
      return { ok: true, status: ped.status, jaFeito: true };
    if (ped.status === 'cancelado') throw new BadRequestException('Pedido cancelado.');
    if (ped.status !== 'pronto')
      throw new BadRequestException('O pedido ainda não está pronto para sair.');
    let nome = (dados.entregadorNome ?? '').trim();
    const id = dados.entregadorId || null;
    if (id) {
      const e = (await this.listarEntregadores(ped.tenantId).catch(() => [])).find((x: any) => x.id === id);
      if (e) nome = e.nome;
    }
    if (!nome) throw new BadRequestException('Informe o entregador.');
    await this.avancar(ped.tenantId, ped.id, { entregadorId: id, entregadorNome: nome });
    return { ok: true, status: 'despachado' };
  }

  // Imprime o CUPOM DO ENTREGADOR (perfil 'entregador') com o QR de despacho. Gera o
  // token e monta o QR {base público}/e/{token}. Base pública (celular do entregador
  // escaneia fora da LAN) = sempre a nuvem.
  async imprimirCupomEntregador(tenantId: string, unidadeId: string | null, pedidoId: string, terminalId?: string | null) {
    const ped: any = await this.carregar(tenantId, pedidoId);
    if (ped.tipo === 'retirada') throw new BadRequestException('Retirada não tem cupom de entregador.');
    const token = await this.tokenDespacho(tenantId, pedidoId);
    const cfg: any = await this.getConfig(tenantId, unidadeId);
    const perfil = perfilEfetivo('entregador', (cfg?.cupomPerfis ?? {})?.entregador);
    const base = (process.env.CARDAPIO_PUBLIC_URL || process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/$/, '');
    const endereco = [ped.endereco, ped.enderecoNumero, ped.enderecoBairro, ped.enderecoReferencia].filter(Boolean).join('\n');
    const total = Number(ped.total) || 0;
    const conteudo = this.producao.renderCupomPerfil(
      perfil,
      {
        nomeLoja: (typeof cfg?.cupomLayout?.cabecalho === 'string' && cfg.cupomLayout.cabecalho.trim()) || undefined,
        dataHora: new Date().toLocaleString('pt-BR'),
        ticket: ped.numero != null ? String(ped.numero) : undefined,
        plataforma: `${ped.canal}${ped.displayId ? ' #' + ped.displayId : ''}`,
        pedidoRegem: ped.numero != null ? `#${ped.numero}` : undefined,
        cliente: ped.clienteNome,
        endereco: endereco || undefined,
        telefone: ped.clienteTelefone,
        itens: ped.itens ?? [],
        subtotal: total,
        taxaEntrega: ped.taxaEntrega != null ? Number(ped.taxaEntrega) : undefined,
        desconto: ped.desconto != null ? Number(ped.desconto) : undefined,
        totalGeral: total,
        cobrarCliente: ped.pago ? 0 : total, // pago online = cobrar 0
        pagamento: ped.formaPagamento,
        bandeiras: (ped as any).bandeira ?? undefined,
        qrData: `${base}/e/${token}`,
      },
      undefined,
      typeof cfg?.cupomLayout?.rodape === 'string' ? cfg.cupomLayout.rodape : undefined,
    );
    await this.producao.enfileirarViaCliente(tenantId, unidadeId, ped.comandaId, conteudo, terminalId);
    return { ok: true, token };
  }

  // Perfis de cupom EFETIVOS (padrão + override salvo). Fase 1 — o editor (Fase 2)
  // consome isto para montar a UI e a pré-visualização.
  async getCupomPerfis(
    tenantId: string,
    unidadeId?: string | null,
  ): Promise<{ perfis: PerfilCupom[]; campos: typeof CAMPOS_CATALOGO }> {
    const cfg = await this.getConfig(tenantId, unidadeId);
    const ov = ((cfg?.cupomPerfis as any) ?? {}) as Record<string, any>;
    // Padrão (com override) + perfis personalizados da loja (Fase 3a).
    return { perfis: listarPerfis(ov), campos: CAMPOS_CATALOGO };
  }

  // ===== Pausa temporária da loja =====
  async pausar(tenantId: string, minutos: number, motivo?: string) {
    const m = [30, 60, 720].includes(Number(minutos)) ? Number(minutos) : 30;
    const ate = new Date(Date.now() + m * 60 * 1000);
    await this.setConfig(tenantId, null, { pausadoAte: ate, pausaMotivo: motivo ?? null });
    return this.getConfig(tenantId, null);
  }

  async despausar(tenantId: string) {
    await this.setConfig(tenantId, null, { pausadoAte: null, pausaMotivo: null });
    return this.getConfig(tenantId, null);
  }

  // ===== Novo pedido manual (delivery ou retirada) =====
  // Preço SEMPRE calculado no servidor a partir do cadastro do produto.
  async criarManual(
    tenantId: string,
    unidadeId: string | null,
    dto: {
      tipo?: 'entrega' | 'retirada';
      clienteNome?: string;
      clienteTelefone?: string;
      enderecoRua?: string;
      enderecoNumero?: string;
      enderecoBairro?: string;
      enderecoReferencia?: string;
      formaPagamento?: string;
      trocoPara?: number;
      itens?: { produtoId: string; quantidade?: number; observacao?: string }[];
    },
  ) {
    const linhas = dto.itens ?? [];
    if (linhas.length === 0)
      throw new BadRequestException('Inclua ao menos um item.');
    const ids = [...new Set(linhas.map((i) => i.produtoId).filter(Boolean))];
    const prods = ids.length
      ? await this.db
          .select({ id: produto.id, nome: produto.nome, preco: produto.precoVenda, codigo: produto.codigo })
          .from(produto)
          .where(and(eq(produto.tenantId, tenantId), inArray(produto.id, ids)))
      : [];
    const mapa = new Map(prods.map((p) => [p.id, p]));
    const itens = linhas.map((l) => {
      const p = mapa.get(l.produtoId);
      if (!p) throw new BadRequestException('Produto inválido no pedido.');
      return {
        produtoId: p.id,
        codigo: p.codigo ?? undefined,
        descricao: p.nome,
        quantidade: Number(l.quantidade) || 1,
        precoUnitario: Number(p.preco) || 0, // servidor manda no preço
        observacao: l.observacao,
      };
    });
    const total = itens.reduce((s, i) => s + i.precoUnitario * i.quantidade, 0);
    const tipo = dto.tipo === 'retirada' ? 'retirada' : 'entrega';
    const enderecoStr = [dto.enderecoRua, dto.enderecoNumero, dto.enderecoBairro]
      .filter(Boolean)
      .join(', ');
    // Reaproveita a ingestão (canal 'manual') — cai como 'novo' no quadro.
    return this.ingest(
      tenantId,
      unidadeId,
      'manual',
      {
        clienteNome: dto.clienteNome,
        clienteTelefone: dto.clienteTelefone,
        tipo,
        endereco: tipo === 'entrega' ? enderecoStr : undefined,
        itens,
        total,
        formaPagamento: dto.formaPagamento ?? 'dinheiro',
      },
      {
        trocoPara: dto.trocoPara,
        enderecoRua: dto.enderecoRua,
        enderecoNumero: dto.enderecoNumero,
        enderecoBairro: dto.enderecoBairro,
        enderecoReferencia: dto.enderecoReferencia,
      },
    );
  }

  async emitirNf(tenantId: string, atorId: string, id: string) {
    const ped = await this.carregar(tenantId, id);
    if (!ped.comandaId)
      throw new BadRequestException('Aceite o pedido antes de emitir a NF.');
    return this.vendas.emitirNf(tenantId, atorId, ped.comandaId);
  }

  private static readonly COLUNAS_PADRAO = {
    chegada: true,
    producao: true,
    pronto: true,
    rota: true,
    finalizado: true,
  };

  async setConfig(tenantId: string, unidadeId: string | null, dto: any) {
    const row = await this.configRaw(tenantId, unidadeId);
    // Colunas: mescla o que veio com o atual (ou o padrão), só chaves conhecidas.
    const colunasAtuais: any =
      (row?.colunas as any) ?? DeliveryService.COLUNAS_PADRAO;
    const colunas = { ...colunasAtuais };
    if (dto.colunas && typeof dto.colunas === 'object') {
      for (const k of Object.keys(DeliveryService.COLUNAS_PADRAO)) {
        if (dto.colunas[k] != null) colunas[k] = !!dto.colunas[k];
      }
    }
    const numOr = (v: any, atual: any, def: number) =>
      v != null && Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : atual ?? def;
    const vals: any = {
      ativo: dto.ativo != null ? !!dto.ativo : row?.ativo ?? false,
      autoAceitar: dto.autoAceitar != null ? !!dto.autoAceitar : row?.autoAceitar ?? false,
      merchantId: dto.merchantId ?? row?.merchantId ?? null,
      colunas,
      prepBalcaoMin: numOr(dto.prepBalcaoMin, row?.prepBalcaoMin, 15),
      prepBalcaoMax: numOr(dto.prepBalcaoMax, row?.prepBalcaoMax, 25),
      prepDeliveryMin: numOr(dto.prepDeliveryMin, row?.prepDeliveryMin, 45),
      prepDeliveryMax: numOr(dto.prepDeliveryMax, row?.prepDeliveryMax, 55),
      setorId:
        dto.setorId !== undefined ? dto.setorId || null : row?.setorId ?? null,
      // Horas na coluna "Finalizado" (1..240, padrão 5).
      finalizadoHoras: Math.min(
        240,
        Math.max(1, numOr(dto.finalizadoHoras, row?.finalizadoHoras, 5)),
      ),
      qrDespacho:
        dto.qrDespacho != null ? !!dto.qrDespacho : row?.qrDespacho ?? false,
      adiarProducaoAteKds:
        dto.adiarProducaoAteKds != null ? !!dto.adiarProducaoAteKds : row?.adiarProducaoAteKds ?? false,
    };
    // Pausa: só sobrescreve quando explicitamente enviado (undefined = mantém).
    if (dto.pausadoAte !== undefined) vals.pausadoAte = dto.pausadoAte;
    if (dto.pausaMotivo !== undefined) vals.pausaMotivo = dto.pausaMotivo;
    // Layout do cupom: mescla com o atual (só as chaves enviadas mudam).
    if (dto.cupomLayout && typeof dto.cupomLayout === 'object') {
      vals.cupomLayout = { ...((row?.cupomLayout as any) ?? {}), ...dto.cupomLayout };
    }
    // Perfis de cupom (Fase 1): mescla por perfil (caixa/entregador/producao).
    if (dto.cupomPerfis && typeof dto.cupomPerfis === 'object') {
      vals.cupomPerfis = { ...((row?.cupomPerfis as any) ?? {}), ...dto.cupomPerfis };
    }
    if (row) {
      await this.db
        .update(deliveryConfig)
        .set({ ...vals, updatedAt: new Date() })
        .where(eq(deliveryConfig.id, row.id));
    } else {
      await this.db.insert(deliveryConfig).values({ tenantId, unidadeId, ...vals });
    }
    return this.getConfig(tenantId, unidadeId);
  }
}
