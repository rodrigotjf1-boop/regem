import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { createHmac } from 'crypto';
import { and, desc, eq, gte, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  caixaSessao,
  cardapioBairro,
  colaborador,
  comandaItem,
  deliveryConfig,
  funcao,
  integracao,
  lancamentoCaixa,
  pedidoExterno,
  produto,
} from '../../db/schema';
import { VendasService } from '../vendas/vendas.service';
import { adaptar, PedidoNormalizado } from './adapters';

/* eslint-disable @typescript-eslint/no-explicit-any */

const FLUXO = ['confirmado', 'pronto', 'despachado', 'concluido'];

@Injectable()
export class DeliveryService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly vendas: VendasService,
  ) {}

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
    },
  ) {
    const norm: PedidoNormalizado = adaptar(canal, raw);
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
    const [row] = await this.db
      .insert(pedidoExterno)
      .values({
        tenantId,
        unidadeId,
        canal,
        numero,
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
        statusPagamento: extra?.statusPagamento ?? 'na_entrega',
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

    const cfg = await this.configRaw(tenantId, unidadeId);
    if (cfg?.autoAceitar) {
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
  async listar(tenantId: string) {
    const desde = new Date(Date.now() - 24 * 60 * 60 * 1000);
    return this.db
      .select()
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.tenantId, tenantId),
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
    const prods = codigos.length
      ? await this.db
          .select({ id: produto.id, codigo: produto.codigo })
          .from(produto)
          .where(
            and(
              eq(produto.tenantId, tenantId),
              inArray(produto.codigo, codigos),
            ),
          )
      : [];
    const porCodigo = new Map(prods.map((p) => [p.codigo, p.id]));

    const PLAT: Record<string, string> = { cardapio: 'Cardápio', ifood: 'iFood', totem: 'Totem' };
    const venda = await this.vendas.venderExterno(tenantId, atorId, {
      unidadeId: ped.unidadeId,
      cliente: ped.clienteNome,
      forma: ped.formaPagamento ?? 'online',
      origem: 'delivery',
      plataforma: PLAT[ped.canal] ?? ped.canal,
      senhaPlataforma: ped.displayId ?? null,
      itens: itens.map((it) => ({
        produtoId: it.produtoId ?? (it.codigo ? porCodigo.get(it.codigo) ?? null : null),
        descricao: it.descricao,
        quantidade: Number(it.quantidade) || 1,
        precoUnitario: Number(it.precoUnitario) || 0,
        observacao: it.observacao ?? null,
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
    const novo = FLUXO[idx + 1];
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

  async cancelar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    id: string,
    motivo?: string,
    senha?: string,
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
      );
    }
    const [row] = await this.db
      .update(pedidoExterno)
      .set({
        status: 'cancelado',
        canceladoEm: new Date(),
        motivoCancelamento: motivo
          ? `${motivo} (autorizado por ${autorizou.nome})`
          : `autorizado por ${autorizou.nome}`,
      })
      .where(eq(pedidoExterno.id, id))
      .returning();
    void this.dispararWebhook(tenantId, row);
    return row;
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

  async reimprimir(tenantId: string, atorId: string, id: string) {
    const ped = await this.carregar(tenantId, id);
    if (!ped.comandaId)
      throw new BadRequestException('Pedido ainda não aceito (sem via para imprimir).');
    return this.vendas.reimprimirViasExterno(tenantId, atorId, ped.comandaId);
  }

  // ===== Integrações (credenciais de apps externos) =====
  private static readonly CANAIS_INTEGRACAO = ['ifood', 'ubereats', 'rappi', '99food', 'n8n'];

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
        merchantId: r?.merchantId ?? null,
        clientId: r?.clientId ?? null,
        temSecret: !!r?.clientSecret,
        temToken: !!r?.token,
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
    const vals: any = {
      ativo: dto.ativo != null ? !!dto.ativo : atual?.ativo ?? false,
      merchantId: dto.merchantId ?? atual?.merchantId ?? null,
      clientId: dto.clientId ?? atual?.clientId ?? null,
      clientSecret: secretNovo ?? atual?.clientSecret ?? null,
      token: tokenNovo ?? atual?.token ?? null,
      updatedAt: new Date(),
    };
    if (atual) {
      await this.db.update(integracao).set(vals).where(eq(integracao.id, atual.id));
    } else {
      await this.db.insert(integracao).values({ tenantId, unidadeId: dto.unidadeId ?? null, canal, ...vals });
    }
    return { ok: true };
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
    const [row] = await this.db
      .select()
      .from(deliveryConfig)
      .where(
        and(
          eq(deliveryConfig.tenantId, tenantId),
          unidadeId
            ? eq(deliveryConfig.unidadeId, unidadeId)
            : sql`unidade_id is null`,
        ),
      );
    return row;
  }

  async getConfig(tenantId: string, unidadeId?: string | null) {
    const row = await this.configRaw(tenantId, unidadeId);
    const base =
      row ?? {
        ativo: false,
        autoAceitar: false,
        colunas: DeliveryService.COLUNAS_PADRAO,
        prepBalcaoMin: 15,
        prepBalcaoMax: 25,
        prepDeliveryMin: 45,
        prepDeliveryMax: 55,
        pausadoAte: null,
        pausaMotivo: null,
      };
    // Pausa reativa sozinha: 'pausado' é computado (janela ainda válida?).
    const pausado = !!base.pausadoAte && new Date(base.pausadoAte) > new Date();
    return { ...base, pausado, pausadoAte: pausado ? base.pausadoAte : null };
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
    };
    // Pausa: só sobrescreve quando explicitamente enviado (undefined = mantém).
    if (dto.pausadoAte !== undefined) vals.pausadoAte = dto.pausadoAte;
    if (dto.pausaMotivo !== undefined) vals.pausaMotivo = dto.pausaMotivo;
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
