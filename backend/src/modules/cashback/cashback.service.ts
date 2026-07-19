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

  // Resumo do que o cancelamento faz com o cashback — usado para AVISAR o cliente
  // ANTES de cancelar (quando a loja NÃO devolve o gasto, ele perde o saldo usado).
  async resumoEstorno(tenantId: string, pedidoId: string, devolverGasto: boolean) {
    const movs = await this.db
      .select()
      .from(cashbackMovimento)
      .where(and(eq(cashbackMovimento.tenantId, tenantId), eq(cashbackMovimento.pedidoId, pedidoId)));
    // Gasto = soma dos 'resgate' (saldo em R$ usado no pedido); negativo → abs.
    let gastoCent = 0;
    for (const m of movs) {
      if (m.origem === 'resgate' && m.tipo === 'valor') gastoCent += Math.round(-Number(m.delta) * 100);
    }
    const valesUsados = await this.db
      .select({ id: cashbackVale.id, valor: cashbackVale.valor })
      .from(cashbackVale)
      .where(and(eq(cashbackVale.tenantId, tenantId), eq(cashbackVale.pedidoId, pedidoId), eq(cashbackVale.status, 'usado')));
    const gasto = Number((gastoCent / 100).toFixed(2));
    const temPerda = !devolverGasto && (gasto > 0 || valesUsados.length > 0);
    return {
      cashbackGasto: gasto,
      valesUsados: valesUsados.length,
      devolve: devolverGasto,
      // Se a loja não devolve, o cliente perde o que gastou — mensagem para avisar.
      aviso: temPerda
        ? `Ao cancelar este pedido você NÃO recebe de volta o cashback usado` +
          `${gasto > 0 ? ` (R$ ${gasto.toFixed(2)})` : ''}` +
          `${valesUsados.length ? ` e perde ${valesUsados.length} vale(s) resgatado(s)` : ''}.`
        : null,
    };
  }

  // Estorna o cashback de um pedido cancelado.
  //  - GANHO (origem 'credito'): SEMPRE removido (pedido cancelado não gera cashback).
  //  - GASTO (origem 'resgate' + vales): devolvido SÓ se `devolverGasto` (config da loja).
  // Idempotente: reverte o líquido de crédito uma vez; a devolução do gasto é marcada
  // por 'estorno_devolucao' (não repete) e os vales só voltam se ainda estão 'usado'.
  async estornarPedido(
    tenantId: string,
    pedidoId: string,
    telefone?: string,
    devolverGasto = false,
  ) {
    const movs = await this.db
      .select()
      .from(cashbackMovimento)
      .where(
        and(eq(cashbackMovimento.tenantId, tenantId), eq(cashbackMovimento.pedidoId, pedidoId)),
      );
    const porTipo = new Map<
      string,
      { tel: string; cli: string | null; credito: number; gasto: number; jaDevolvido: boolean }
    >();
    for (const m of movs) {
      const cur =
        porTipo.get(m.tipo) ??
        { tel: m.telefone, cli: m.clienteId ?? null, credito: 0, gasto: 0, jaDevolvido: false };
      if (m.origem === 'credito') cur.credito += Number(m.delta); // ganho (positivo)
      if (m.origem === 'estorno') cur.credito += Number(m.delta); // já revertido (negativo)
      if (m.origem === 'resgate') cur.gasto += Number(m.delta); // gasto (negativo)
      if (m.origem === 'estorno_devolucao') cur.jaDevolvido = true; // já devolvemos antes
      porTipo.set(m.tipo, cur);
    }
    let saldoDevolvido = 0;
    for (const [tipo, info] of porTipo) {
      // 1. Remove o que sobrou de crédito ganho (sempre).
      if (info.credito > 0) {
        await this.ajustarSaldo(tenantId, info.tel, info.cli ?? undefined, tipo, -info.credito, 'estorno', {
          pedidoId,
        });
      }
      // 2. Devolve o gasto (opcional, idempotente): info.gasto é negativo → re-credita.
      if (devolverGasto && info.gasto < 0 && !info.jaDevolvido) {
        await this.ajustarSaldo(tenantId, info.tel, info.cli ?? undefined, tipo, -info.gasto, 'estorno_devolucao', {
          pedidoId,
        });
        if (tipo === 'valor') saldoDevolvido += -info.gasto;
      }
    }
    // 3. Vales usados no pedido voltam a ficar disponíveis (só se devolver o gasto).
    let valesDevolvidos = 0;
    if (devolverGasto) {
      const back = await this.db
        .update(cashbackVale)
        .set({ status: 'disponivel', pedidoId: null })
        .where(
          and(
            eq(cashbackVale.tenantId, tenantId),
            eq(cashbackVale.pedidoId, pedidoId),
            eq(cashbackVale.status, 'usado'),
          ),
        )
        .returning({ id: cashbackVale.id });
      valesDevolvidos = back.length;
    }
    return { saldoDevolvido: Number(saldoDevolvido.toFixed(2)), valesDevolvidos };
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
