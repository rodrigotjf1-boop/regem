import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  cashbackMovimento,
  cashbackPlano,
  cashbackProdutoValor,
  cashbackSaldo,
  cashbackVale,
  produto,
} from '../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */
const soDigitos = (s?: string) => (s ?? '').replace(/\D/g, '');

@Injectable()
export class CashbackService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Pontos por gasto: aplica a faixa que dá MAIS pontos (pacotes completos).
  static pontosPorGasto(regras: any[], total: number): number {
    let best = 0;
    for (const r of regras ?? []) {
      const reais = Number(r.reais) || 0;
      const pontos = Number(r.pontos) || 0;
      if (reais <= 0) continue;
      const p = Math.floor(total / reais) * pontos;
      if (p > best) best = p;
    }
    return best;
  }

  // ===== Gestão (autenticado) =====
  async listarPlanos(tenantId: string) {
    const planos = await this.db
      .select()
      .from(cashbackPlano)
      .where(eq(cashbackPlano.tenantId, tenantId))
      .orderBy(desc(cashbackPlano.criadoEm));
    const ids = planos.map((p) => p.id);
    const valores = ids.length
      ? await this.db
          .select()
          .from(cashbackProdutoValor)
          .where(inArray(cashbackProdutoValor.planoId, ids))
      : [];
    return planos.map((p) => ({
      ...p,
      produtos: valores
        .filter((v) => v.planoId === p.id)
        .map((v) => ({ produtoId: v.produtoId, pontos: v.pontos })),
    }));
  }

  async salvarPlano(tenantId: string, unidadeId: string | null, dto: any) {
    const tipo = dto.tipo === 'pontos' ? 'pontos' : 'valor';
    const vals = {
      tipo,
      ativo: dto.ativo != null ? !!dto.ativo : true,
      percentual: tipo === 'valor' ? String(Number(dto.percentual) || 0) : null,
      base: dto.base === 'sem_frete' ? 'sem_frete' : 'total',
      regras: tipo === 'pontos' && Array.isArray(dto.regras)
        ? dto.regras
            .map((r: any) => ({ reais: Number(r.reais) || 0, pontos: Number(r.pontos) || 0 }))
            .filter((r: any) => r.reais > 0 && r.pontos > 0)
        : [],
      prazoResgateDias: dto.prazoResgateDias ? Number(dto.prazoResgateDias) || null : null,
    };
    let planoId = dto.id;
    if (planoId) {
      const [row] = await this.db
        .update(cashbackPlano)
        .set(vals)
        .where(and(eq(cashbackPlano.id, planoId), eq(cashbackPlano.tenantId, tenantId)))
        .returning();
      if (!row) throw new NotFoundException('Plano não encontrado.');
    } else {
      const [row] = await this.db
        .insert(cashbackPlano)
        .values({ tenantId, unidadeId, status: 'ativo', ...vals })
        .returning();
      planoId = row.id;
    }
    // Valores em pontos por produto (tipo pontos).
    if (tipo === 'pontos') {
      await this.db.delete(cashbackProdutoValor).where(eq(cashbackProdutoValor.planoId, planoId));
      const produtos = (dto.produtos ?? []).filter((p: any) => p.produtoId && Number(p.pontos) > 0);
      if (produtos.length) {
        await this.db.insert(cashbackProdutoValor).values(
          produtos.map((p: any) => ({
            tenantId,
            planoId,
            produtoId: p.produtoId,
            pontos: Number(p.pontos),
          })),
        );
      }
    }
    return { ok: true, id: planoId };
  }

  async removerPlano(tenantId: string, id: string) {
    const [p] = await this.db
      .select({ id: cashbackPlano.id })
      .from(cashbackPlano)
      .where(and(eq(cashbackPlano.id, id), eq(cashbackPlano.tenantId, tenantId)));
    if (!p) throw new NotFoundException('Plano não encontrado.');
    await this.db.delete(cashbackPlano).where(eq(cashbackPlano.id, id));
    return { ok: true };
  }

  async finalizarPlano(tenantId: string, id: string) {
    const [row] = await this.db
      .update(cashbackPlano)
      .set({ status: 'finalizando', ativo: false })
      .where(and(eq(cashbackPlano.id, id), eq(cashbackPlano.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Plano não encontrado.');
    return row;
  }

  // Relatório de resgates (uso de saldo/pontos/vale) por período + cliente.
  async relatorioResgates(tenantId: string, inicio?: string, fim?: string, telefone?: string) {
    const tel = soDigitos(telefone);
    const cond = [eq(cashbackMovimento.tenantId, tenantId), eq(cashbackMovimento.origem, 'resgate')];
    if (inicio) cond.push(gte(cashbackMovimento.criadoEm, new Date(inicio)));
    if (fim) cond.push(lte(cashbackMovimento.criadoEm, new Date(fim + 'T23:59:59')));
    if (tel) cond.push(sql`${cashbackMovimento.telefone} like ${'%' + tel + '%'}`);
    const movs = await this.db
      .select()
      .from(cashbackMovimento)
      .where(and(...cond))
      .orderBy(desc(cashbackMovimento.criadoEm))
      .limit(500);
    return movs.map((m) => ({
      id: m.id,
      telefone: m.telefone,
      tipo: m.tipo,
      valor: Math.abs(Number(m.delta)),
      pedidoId: m.pedidoId,
      criadoEm: m.criadoEm,
    }));
  }

  // ===== Motor: crédito na confirmação, estorno no cancelamento =====
  async creditarPedido(
    tenantId: string,
    dados: {
      telefone?: string;
      clienteId?: string;
      pedidoId: string;
      total: number;
      taxaEntrega?: number;
      desconto?: number;
    },
  ) {
    const tel = soDigitos(dados.telefone);
    if (!tel) return;
    const planos = await this.db
      .select()
      .from(cashbackPlano)
      .where(
        and(
          eq(cashbackPlano.tenantId, tenantId),
          eq(cashbackPlano.ativo, true),
          eq(cashbackPlano.status, 'ativo'),
        ),
      );
    for (const plano of planos) {
      // Idempotência: não credita 2x o mesmo pedido no mesmo tipo.
      const [ja] = await this.db
        .select({ id: cashbackMovimento.id })
        .from(cashbackMovimento)
        .where(
          and(
            eq(cashbackMovimento.tenantId, tenantId),
            eq(cashbackMovimento.pedidoId, dados.pedidoId),
            eq(cashbackMovimento.tipo, plano.tipo),
            eq(cashbackMovimento.origem, 'credito'),
          ),
        );
      if (ja) continue;
      const bruto = Number(dados.total) || 0;
      const baseValor =
        plano.base === 'sem_frete' ? Math.max(0, bruto - (Number(dados.taxaEntrega) || 0)) : bruto;
      let delta = 0;
      if (plano.tipo === 'valor') {
        delta = Number(((baseValor * (Number(plano.percentual) || 0)) / 100).toFixed(2));
      } else {
        delta = CashbackService.pontosPorGasto(plano.regras as any[], baseValor);
      }
      if (delta <= 0) continue;
      const expiraEm = plano.prazoResgateDias
        ? new Date(Date.now() + Number(plano.prazoResgateDias) * 86400000)
        : null;
      await this.ajustarSaldo(tenantId, tel, dados.clienteId, plano.tipo, delta, 'credito', {
        planoId: plano.id,
        pedidoId: dados.pedidoId,
        expiraEm,
      });
    }
  }

  // Estorna todo o cashback creditado por um pedido (cancelamento).
  async estornarPedido(tenantId: string, pedidoId: string, telefone?: string) {
    const movs = await this.db
      .select()
      .from(cashbackMovimento)
      .where(
        and(eq(cashbackMovimento.tenantId, tenantId), eq(cashbackMovimento.pedidoId, pedidoId)),
      );
    if (!movs.length) return;
    // Saldo líquido por tipo já lançado para este pedido (credito + estornos).
    const porTipo = new Map<string, { tel: string; cli: string | null; net: number }>();
    for (const m of movs) {
      const cur = porTipo.get(m.tipo) ?? { tel: m.telefone, cli: m.clienteId ?? null, net: 0 };
      // Só nos importa reverter o que foi CREDITADO por este pedido.
      if (m.origem === 'credito') cur.net += Number(m.delta);
      if (m.origem === 'estorno') cur.net += Number(m.delta); // já negativo
      porTipo.set(m.tipo, cur);
    }
    for (const [tipo, info] of porTipo) {
      if (info.net <= 0) continue;
      await this.ajustarSaldo(tenantId, info.tel, info.cli ?? undefined, tipo, -info.net, 'estorno', {
        pedidoId,
      });
    }
  }

  private async ajustarSaldo(
    tenantId: string,
    tel: string,
    clienteId: string | undefined,
    tipo: string,
    delta: number,
    origem: string,
    extra: { planoId?: string; pedidoId?: string; expiraEm?: Date | null } = {},
  ) {
    await this.db.insert(cashbackMovimento).values({
      tenantId,
      telefone: tel,
      clienteId: clienteId ?? null,
      tipo,
      delta: String(delta),
      origem,
      planoId: extra.planoId ?? null,
      pedidoId: extra.pedidoId ?? null,
    });
    const [row] = await this.db
      .select()
      .from(cashbackSaldo)
      .where(
        and(
          eq(cashbackSaldo.tenantId, tenantId),
          eq(cashbackSaldo.telefone, tel),
          eq(cashbackSaldo.tipo, tipo),
        ),
      );
    if (row) {
      const novo = Math.max(0, Number(row.saldo) + delta);
      const expira =
        delta > 0 && extra.expiraEm
          ? extra.expiraEm // renova o prazo a cada crédito
          : row.expiraEm;
      await this.db
        .update(cashbackSaldo)
        .set({ saldo: String(novo), expiraEm: expira, atualizadoEm: new Date() })
        .where(eq(cashbackSaldo.id, row.id));
    } else {
      await this.db.insert(cashbackSaldo).values({
        tenantId,
        telefone: tel,
        clienteId: clienteId ?? null,
        tipo,
        saldo: String(Math.max(0, delta)),
        expiraEm: delta > 0 ? extra.expiraEm ?? null : null,
      });
    }
  }

  // Expira saldo vencido (lazy) e devolve o saldo atual por tipo.
  private async saldoTipo(tenantId: string, tel: string, tipo: string): Promise<number> {
    const [row] = await this.db
      .select()
      .from(cashbackSaldo)
      .where(
        and(
          eq(cashbackSaldo.tenantId, tenantId),
          eq(cashbackSaldo.telefone, tel),
          eq(cashbackSaldo.tipo, tipo),
        ),
      );
    if (!row) return 0;
    if (row.expiraEm && new Date(row.expiraEm) < new Date() && Number(row.saldo) > 0) {
      await this.ajustarSaldo(tenantId, tel, row.clienteId ?? undefined, tipo, -Number(row.saldo), 'expiracao');
      return 0;
    }
    return Number(row.saldo);
  }

  // ===== Público (cardápio) =====
  async saldoCliente(tenantId: string, telefone: string) {
    const tel = soDigitos(telefone);
    if (!tel) return { valor: 0, pontos: 0, vales: [], planos: [] };
    const [valor, pontos] = await Promise.all([
      this.saldoTipo(tenantId, tel, 'valor'),
      this.saldoTipo(tenantId, tel, 'pontos'),
    ]);
    const vales = await this.db
      .select()
      .from(cashbackVale)
      .where(
        and(
          eq(cashbackVale.tenantId, tenantId),
          eq(cashbackVale.telefone, tel),
          eq(cashbackVale.status, 'disponivel'),
        ),
      );
    const planos = await this.planosPublicos(tenantId);
    return {
      valor,
      pontos,
      vales: vales.map((v) => ({ id: v.id, descricao: v.descricao, valor: Number(v.valor) })),
      planos,
    };
  }

  async planosPublicos(tenantId: string) {
    const planos = await this.db
      .select()
      .from(cashbackPlano)
      .where(and(eq(cashbackPlano.tenantId, tenantId), eq(cashbackPlano.ativo, true)));
    const ids = planos.map((p) => p.id);
    const valores = ids.length
      ? await this.db
          .select({
            planoId: cashbackProdutoValor.planoId,
            produtoId: cashbackProdutoValor.produtoId,
            pontos: cashbackProdutoValor.pontos,
            nome: produto.nome,
            precoVenda: produto.precoVenda,
          })
          .from(cashbackProdutoValor)
          .leftJoin(produto, eq(produto.id, cashbackProdutoValor.produtoId))
          .where(inArray(cashbackProdutoValor.planoId, ids))
      : [];
    return planos.map((p) => ({
      id: p.id,
      tipo: p.tipo,
      percentual: p.percentual != null ? Number(p.percentual) : null,
      produtos:
        p.tipo === 'pontos'
          ? valores
              .filter((v) => v.planoId === p.id)
              .map((v) => ({
                produtoId: v.produtoId,
                pontos: v.pontos,
                nome: v.nome,
                precoVenda: v.precoVenda != null ? Number(v.precoVenda) : 0,
              }))
          : [],
    }));
  }

  // Cliente troca pontos por um produto → gera um vale (abate no próximo pedido).
  async resgatarProduto(tenantId: string, telefone: string, produtoId: string) {
    const tel = soDigitos(telefone);
    if (!tel) throw new BadRequestException('Telefone obrigatório.');
    const [pv] = await this.db
      .select({
        pontos: cashbackProdutoValor.pontos,
        precoVenda: produto.precoVenda,
        nome: produto.nome,
      })
      .from(cashbackProdutoValor)
      .leftJoin(produto, eq(produto.id, cashbackProdutoValor.produtoId))
      .innerJoin(cashbackPlano, eq(cashbackPlano.id, cashbackProdutoValor.planoId))
      .where(
        and(
          eq(cashbackProdutoValor.tenantId, tenantId),
          eq(cashbackProdutoValor.produtoId, produtoId),
          eq(cashbackPlano.ativo, true),
        ),
      );
    if (!pv) throw new NotFoundException('Produto não disponível para resgate.');
    const saldo = await this.saldoTipo(tenantId, tel, 'pontos');
    if (saldo < pv.pontos) throw new BadRequestException('Pontos insuficientes.');
    await this.ajustarSaldo(tenantId, tel, undefined, 'pontos', -pv.pontos, 'resgate');
    const [vale] = await this.db
      .insert(cashbackVale)
      .values({
        tenantId,
        telefone: tel,
        produtoId,
        descricao: pv.nome ?? 'Produto',
        valor: String(Number(pv.precoVenda) || 0),
      })
      .returning();
    return { ok: true, valeId: vale.id };
  }

  // ===== Checkout: aplica saldo (valor) + vales (produto) automaticamente =====
  async avaliarDescontos(tenantId: string, telefone: string, subtotal: number) {
    const tel = soDigitos(telefone);
    if (!tel) return { saldoUsado: 0, vales: [], desconto: 0 };
    const vales = await this.db
      .select()
      .from(cashbackVale)
      .where(
        and(
          eq(cashbackVale.tenantId, tenantId),
          eq(cashbackVale.telefone, tel),
          eq(cashbackVale.status, 'disponivel'),
        ),
      );
    const descVales = vales.reduce((a, v) => a + Number(v.valor), 0);
    const restante = Math.max(0, (Number(subtotal) || 0) - descVales);
    const saldo = await this.saldoTipo(tenantId, tel, 'valor');
    const saldoUsado = Math.min(saldo, restante); // uso máximo automático
    return {
      saldoUsado: Number(saldoUsado.toFixed(2)),
      vales: vales.map((v) => ({ id: v.id, descricao: v.descricao, valor: Number(v.valor) })),
      desconto: Number((descVales + saldoUsado).toFixed(2)),
    };
  }

  // Consome saldo/vales após o pedido criado.
  async consumir(
    tenantId: string,
    telefone: string,
    pedidoId: string,
    saldoUsado: number,
    valeIds: string[],
  ) {
    const tel = soDigitos(telefone);
    if (!tel) return;
    if (saldoUsado > 0) {
      await this.ajustarSaldo(tenantId, tel, undefined, 'valor', -saldoUsado, 'resgate', { pedidoId });
    }
    if (valeIds?.length) {
      await this.db
        .update(cashbackVale)
        .set({ status: 'usado', pedidoId })
        .where(
          and(
            eq(cashbackVale.tenantId, tenantId),
            eq(cashbackVale.telefone, tel),
            inArray(cashbackVale.id, valeIds),
            eq(cashbackVale.status, 'disponivel'),
          ),
        );
    }
  }
}
