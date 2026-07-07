import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { and, desc, eq, gte, ilike, inArray, isNotNull, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  caixaSessao,
  colaborador,
  comandaItem,
  deliveryConfig,
  funcao,
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
    const [row] = await this.db
      .insert(pedidoExterno)
      .values({
        tenantId,
        unidadeId,
        canal,
        externalId: norm.externalId,
        displayId: norm.displayId,
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
    return row;
  }

  // ===== Alterar / reimprimir / entregadores =====
  async alterar(
    tenantId: string,
    atorId: string,
    id: string,
    dto: {
      adicionar?: { produtoId: string; quantidade?: number; observacao?: string }[];
      remover?: string[];
    },
  ) {
    const ped = await this.carregar(tenantId, id);
    if (!['confirmado', 'pronto'].includes(ped.status))
      throw new BadRequestException(
        'Só dá para alterar um pedido aceito e ainda não despachado. Se já saiu, cancele e refaça.',
      );
    if (!ped.comandaId)
      throw new BadRequestException('Pedido sem venda vinculada.');
    const r = await this.vendas.alterarItensExterno(
      tenantId,
      atorId,
      ped.comandaId,
      dto,
    );
    const [row] = await this.db
      .update(pedidoExterno)
      .set({ alterado: true, alteradoEm: new Date(), total: String(r.total.toFixed(2)) })
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
    return (
      row ?? {
        ativo: false,
        autoAceitar: false,
        colunas: DeliveryService.COLUNAS_PADRAO,
      }
    );
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
    const vals = {
      ativo: dto.ativo != null ? !!dto.ativo : row?.ativo ?? false,
      autoAceitar: dto.autoAceitar != null ? !!dto.autoAceitar : row?.autoAceitar ?? false,
      merchantId: dto.merchantId ?? row?.merchantId ?? null,
      colunas,
    };
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
