import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  deliveryConfig,
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
        /* mantém como 'novo' se falhar o aceite automático */
      }
    }
    return row;
  }

  // ===== Gestão (PDV) =====
  async listar(tenantId: string) {
    return this.db
      .select()
      .from(pedidoExterno)
      .where(
        and(
          eq(pedidoExterno.tenantId, tenantId),
          inArray(pedidoExterno.status, [
            'novo',
            'confirmado',
            'pronto',
            'despachado',
          ]),
        ),
      )
      .orderBy(desc(pedidoExterno.criadoEm))
      .limit(100);
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
      .set({ status: 'confirmado', comandaId: venda.comandaId, confirmadoEm: new Date() })
      .where(eq(pedidoExterno.id, id))
      .returning();
    return row;
  }

  async avancar(tenantId: string, id: string) {
    const ped = await this.carregar(tenantId, id);
    if (ped.status === 'cancelado' || ped.status === 'novo')
      throw new BadRequestException('Aceite o pedido antes de avançar.');
    const idx = FLUXO.indexOf(ped.status);
    if (idx < 0 || idx >= FLUXO.length - 1)
      throw new BadRequestException('Pedido já concluído.');
    const novo = FLUXO[idx + 1];
    const patch: any = { status: novo };
    if (novo === 'pronto') patch.prontoEm = new Date();
    if (novo === 'despachado') patch.despachadoEm = new Date();
    if (novo === 'concluido') patch.concluidoEm = new Date();
    const [row] = await this.db
      .update(pedidoExterno)
      .set(patch)
      .where(eq(pedidoExterno.id, id))
      .returning();
    return row;
  }

  async cancelar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    id: string,
    motivo?: string,
  ) {
    const ped = await this.carregar(tenantId, id);
    if (ped.status === 'cancelado')
      throw new BadRequestException('Pedido já cancelado.');
    if (ped.status === 'concluido')
      throw new BadRequestException('Pedido concluído não pode ser cancelado.');
    // Se já virou venda, estorna estoque + financeiro.
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
      .set({ status: 'cancelado', canceladoEm: new Date(), motivoCancelamento: motivo })
      .where(eq(pedidoExterno.id, id))
      .returning();
    return row;
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
    return row ?? { ativo: false, autoAceitar: false };
  }

  async setConfig(tenantId: string, unidadeId: string | null, dto: any) {
    const row = await this.configRaw(tenantId, unidadeId);
    const vals = {
      ativo: dto.ativo != null ? !!dto.ativo : row?.ativo ?? false,
      autoAceitar: dto.autoAceitar != null ? !!dto.autoAceitar : row?.autoAceitar ?? false,
      merchantId: dto.merchantId ?? row?.merchantId ?? null,
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
