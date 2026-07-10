import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  categoriaProduto,
  fidelidadeCliente,
  fidelidadePlano,
  fidelidadePonto,
  fidelidadeResgate,
  produto,
} from '../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */
const soDigitos = (s?: string) => (s ?? '').replace(/\D/g, '');
const RECOMPENSAS = ['percentual_proximo', 'percentual_produtos', 'valor_fixo'];
const QUALIFICADORES = ['qualquer', 'categoria', 'produto'];

// Descrição legível do prêmio do plano (para UI pública e comprovante).
function descreverRecompensa(p: any): string {
  const v = Number(p.recompensaValor) || 0;
  if (p.recompensaTipo === 'valor_fixo') return `R$ ${v.toFixed(2)} de desconto no próximo pedido`;
  if (p.recompensaTipo === 'percentual_produtos') return `${v}% OFF em produtos selecionados`;
  return `${v}% OFF no próximo pedido`;
}

@Injectable()
export class FidelidadeService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // ===== Gestão (autenticado) =====
  listarPlanos(tenantId: string) {
    return this.db
      .select()
      .from(fidelidadePlano)
      .where(eq(fidelidadePlano.tenantId, tenantId))
      .orderBy(desc(fidelidadePlano.criadoEm));
  }

  async salvarPlano(tenantId: string, unidadeId: string | null, dto: any) {
    if (!dto?.nome?.trim()) throw new BadRequestException('Informe o nome do plano.');
    const vals = {
      nome: dto.nome.trim(),
      ativo: dto.ativo != null ? !!dto.ativo : true,
      qualificadorTipo: QUALIFICADORES.includes(dto.qualificadorTipo) ? dto.qualificadorTipo : 'qualquer',
      qualificadorId: dto.qualificadorTipo === 'qualquer' ? null : dto.qualificadorId || null,
      pontosMeta: Math.max(1, Number(dto.pontosMeta) || 1),
      recompensaTipo: RECOMPENSAS.includes(dto.recompensaTipo) ? dto.recompensaTipo : 'percentual_proximo',
      recompensaValor: String(Number(dto.recompensaValor) || 0),
      recompensaProdutos: Array.isArray(dto.recompensaProdutos) ? dto.recompensaProdutos : [],
      prazoResgateDias: dto.prazoResgateDias ? Number(dto.prazoResgateDias) || null : null,
    };
    if (dto.id) {
      const [row] = await this.db
        .update(fidelidadePlano)
        .set(vals)
        .where(and(eq(fidelidadePlano.id, dto.id), eq(fidelidadePlano.tenantId, tenantId)))
        .returning();
      if (!row) throw new NotFoundException('Plano não encontrado.');
      return row;
    }
    const [row] = await this.db
      .insert(fidelidadePlano)
      .values({ tenantId, unidadeId, status: 'ativo', ...vals })
      .returning();
    return row;
  }

  // Exclui o plano — todos os pontos e prêmios pendentes somem (aviso na UI).
  async removerPlano(tenantId: string, id: string) {
    const [p] = await this.db
      .select({ id: fidelidadePlano.id })
      .from(fidelidadePlano)
      .where(and(eq(fidelidadePlano.id, id), eq(fidelidadePlano.tenantId, tenantId)));
    if (!p) throw new NotFoundException('Plano não encontrado.');
    // fidelidade_cliente não tem FK para o plano — limpa manualmente.
    await this.db
      .delete(fidelidadeCliente)
      .where(and(eq(fidelidadeCliente.tenantId, tenantId), eq(fidelidadeCliente.planoId, id)));
    await this.db.delete(fidelidadePlano).where(eq(fidelidadePlano.id, id)); // cascade: ponto + resgate
    return { ok: true };
  }

  // Finaliza: não gera mais pontos, mas mantém os prêmios já conquistados até
  // que todos resgatem. Volta a 'ativo' se reativar.
  async finalizarPlano(tenantId: string, id: string) {
    const [row] = await this.db
      .update(fidelidadePlano)
      .set({ status: 'finalizando', ativo: false })
      .where(and(eq(fidelidadePlano.id, id), eq(fidelidadePlano.tenantId, tenantId)))
      .returning();
    if (!row) throw new NotFoundException('Plano não encontrado.');
    return row;
  }

  // Participantes de um plano (saldo por telefone), com busca opcional.
  async participantes(tenantId: string, planoId: string, telefone?: string) {
    const tel = soDigitos(telefone);
    const cond = [eq(fidelidadeCliente.tenantId, tenantId), eq(fidelidadeCliente.planoId, planoId)];
    if (tel) cond.push(sql`${fidelidadeCliente.telefone} like ${'%' + tel + '%'}`);
    return this.db
      .select()
      .from(fidelidadeCliente)
      .where(and(...cond))
      .orderBy(desc(fidelidadeCliente.pontos))
      .limit(200);
  }

  // Ajuste manual de pontos (adicionar/retirar) buscando pelo telefone.
  async ajustarPontos(tenantId: string, planoId: string, dto: any) {
    const tel = soDigitos(dto?.telefone);
    if (!tel) throw new BadRequestException('Informe o telefone.');
    const delta = Math.trunc(Number(dto?.delta) || 0);
    if (!delta) throw new BadRequestException('Informe quantos pontos adicionar ou retirar.');
    const [plano] = await this.db
      .select()
      .from(fidelidadePlano)
      .where(and(eq(fidelidadePlano.id, planoId), eq(fidelidadePlano.tenantId, tenantId)));
    if (!plano) throw new NotFoundException('Plano não encontrado.');
    const saldo = await this.saldo(tenantId, planoId, tel);
    let novo = Math.max(0, saldo + delta);
    let premios = 0;
    // Crédito manual pode cruzar a meta (gera prêmio) uma ou mais vezes.
    while (novo >= plano.pontosMeta) {
      novo -= plano.pontosMeta;
      premios++;
      await this.gerarResgate(tenantId, plano, tel, dto.clienteId);
    }
    await this.setSaldo(tenantId, planoId, tel, novo, dto.nome, dto.clienteId);
    return { ok: true, saldo: novo, premiosGerados: premios };
  }

  // Relatório de prêmios resgatados por dia/semana/mês.
  async relatorioResgates(tenantId: string, periodo = 'dia') {
    const trunc = periodo === 'mes' ? 'month' : periodo === 'semana' ? 'week' : 'day';
    const r: any = await this.db.execute(sql`
      select to_char(date_trunc(${trunc}, resgatado_em), 'YYYY-MM-DD') as periodo,
             count(*)::int as total
      from fidelidade_resgate
      where tenant_id = ${tenantId} and status = 'resgatado' and resgatado_em is not null
      group by 1 order by 1 desc limit 60
    `);
    return (r?.rows ?? r).map((x: any) => ({ periodo: x.periodo, total: Number(x.total) }));
  }

  // ===== Motor de pontos (chamado no checkout) =====
  async pontuarPedido(
    tenantId: string,
    dados: { telefone?: string; clienteId?: string; nome?: string; pedidoId: string; produtoIds: string[] },
  ) {
    const tel = soDigitos(dados.telefone);
    if (!tel) return { pontosGanhos: 0, premios: [] as any[] };
    const planos = await this.db
      .select()
      .from(fidelidadePlano)
      .where(
        and(
          eq(fidelidadePlano.tenantId, tenantId),
          eq(fidelidadePlano.ativo, true),
          eq(fidelidadePlano.status, 'ativo'),
        ),
      );
    if (!planos.length) return { pontosGanhos: 0, premios: [] as any[] };

    // Categorias dos produtos do pedido (para qualificador 'categoria').
    const ids = [...new Set(dados.produtoIds)].filter(Boolean);
    const prods = ids.length
      ? await this.db
          .select({ id: produto.id, categoriaId: produto.categoriaId })
          .from(produto)
          .where(and(eq(produto.tenantId, tenantId), inArray(produto.id, ids)))
      : [];
    const prodSet = new Set(prods.map((p) => p.id));
    const catSet = new Set(prods.map((p) => p.categoriaId).filter(Boolean) as string[]);

    let pontosGanhos = 0;
    const premios: any[] = [];
    for (const plano of planos) {
      const qualifica =
        plano.qualificadorTipo === 'qualquer'
          ? true
          : plano.qualificadorTipo === 'categoria'
            ? !!plano.qualificadorId && catSet.has(plano.qualificadorId)
            : !!plano.qualificadorId && prodSet.has(plano.qualificadorId);
      if (!qualifica) continue;
      // Dedupe: 1 ponto por pedido por plano (índice único pedido+plano).
      const ins = await this.db
        .insert(fidelidadePonto)
        .values({
          tenantId,
          planoId: plano.id,
          telefone: tel,
          clienteId: dados.clienteId,
          pedidoId: dados.pedidoId,
        })
        .onConflictDoNothing()
        .returning({ id: fidelidadePonto.id });
      if (!ins.length) continue; // pedido já pontuou nesse plano
      pontosGanhos++;
      let novo = (await this.saldo(tenantId, plano.id, tel)) + 1;
      if (novo >= plano.pontosMeta) {
        novo -= plano.pontosMeta;
        const resg = await this.gerarResgate(tenantId, plano, tel, dados.clienteId);
        premios.push({ plano: plano.nome, recompensa: descreverRecompensa(plano), resgateId: resg.id });
      }
      await this.setSaldo(tenantId, plano.id, tel, novo, dados.nome, dados.clienteId);
    }
    return { pontosGanhos, premios };
  }

  // ===== Público (por token, via CardapioService) =====
  async planosPublicos(tenantId: string) {
    const planos = await this.db
      .select()
      .from(fidelidadePlano)
      .where(and(eq(fidelidadePlano.tenantId, tenantId), eq(fidelidadePlano.ativo, true)));
    return planos.map((p) => ({
      id: p.id,
      nome: p.nome,
      pontosMeta: p.pontosMeta,
      recompensa: descreverRecompensa(p),
    }));
  }

  async statusCliente(tenantId: string, telefone: string) {
    const tel = soDigitos(telefone);
    if (!tel) return { planos: [], resgates: [] };
    await this.expirarVencidos(tenantId, tel);
    const planos = await this.db
      .select()
      .from(fidelidadePlano)
      .where(
        and(
          eq(fidelidadePlano.tenantId, tenantId),
          sql`${fidelidadePlano.status} <> 'encerrado'`,
        ),
      );
    const saldos = await this.db
      .select()
      .from(fidelidadeCliente)
      .where(and(eq(fidelidadeCliente.tenantId, tenantId), eq(fidelidadeCliente.telefone, tel)));
    const saldoPorPlano = new Map(saldos.map((s) => [s.planoId, s.pontos]));
    const resgates = await this.db
      .select()
      .from(fidelidadeResgate)
      .where(and(eq(fidelidadeResgate.tenantId, tenantId), eq(fidelidadeResgate.telefone, tel)))
      .orderBy(desc(fidelidadeResgate.ganhoEm))
      .limit(50);
    const planoById = new Map(planos.map((p) => [p.id, p]));
    return {
      planos: planos
        .filter((p) => p.ativo || (saldoPorPlano.get(p.id) ?? 0) > 0)
        .map((p) => ({
          id: p.id,
          nome: p.nome,
          pontos: saldoPorPlano.get(p.id) ?? 0,
          pontosMeta: p.pontosMeta,
          recompensa: descreverRecompensa(p),
          ativo: p.ativo,
        })),
      resgates: resgates.map((r) => ({
        id: r.id,
        plano: planoById.get(r.planoId)?.nome ?? 'Prêmio',
        recompensa: planoById.get(r.planoId) ? descreverRecompensa(planoById.get(r.planoId)) : '',
        status: r.status,
        ganhoEm: r.ganhoEm,
        prazoEm: r.prazoEm,
      })),
    };
  }

  // Prêmios já resgatados (status 'resgatado') prontos para abater no pedido.
  async premiosParaUsar(tenantId: string, telefone: string) {
    const tel = soDigitos(telefone);
    if (!tel) return [];
    await this.expirarVencidos(tenantId, tel);
    const rows = await this.db
      .select()
      .from(fidelidadeResgate)
      .where(
        and(
          eq(fidelidadeResgate.tenantId, tenantId),
          eq(fidelidadeResgate.telefone, tel),
          eq(fidelidadeResgate.status, 'resgatado'),
        ),
      );
    if (!rows.length) return [];
    const planoIds = [...new Set(rows.map((r) => r.planoId))];
    const planos = await this.db
      .select()
      .from(fidelidadePlano)
      .where(inArray(fidelidadePlano.id, planoIds));
    const byId = new Map(planos.map((p) => [p.id, p]));
    return rows
      .map((r) => {
        const p = byId.get(r.planoId);
        if (!p) return null;
        return {
          id: r.id,
          plano: p.nome,
          recompensa: descreverRecompensa(p),
          recompensaTipo: p.recompensaTipo,
          recompensaValor: Number(p.recompensaValor) || 0,
          recompensaProdutos: (p.recompensaProdutos as string[]) ?? [],
        };
      })
      .filter(Boolean);
  }

  // Calcula o desconto de um prêmio para um carrinho (não muta nada).
  static descontoPremio(
    recompensaTipo: string,
    recompensaValor: number,
    recompensaProdutos: string[],
    itens: { produtoId: string; precoUnitario: number; quantidade: number }[],
    subtotal: number,
  ): number {
    const v = Number(recompensaValor) || 0;
    if (recompensaTipo === 'valor_fixo') return Math.min(subtotal, v);
    if (recompensaTipo === 'percentual_produtos') {
      const sel = new Set(recompensaProdutos ?? []);
      const base = itens
        .filter((i) => sel.has(i.produtoId))
        .reduce((a, i) => a + Number(i.precoUnitario) * Number(i.quantidade), 0);
      return Number(((base * v) / 100).toFixed(2));
    }
    return Number(((subtotal * v) / 100).toFixed(2)); // percentual_proximo
  }

  // Avalia o prêmio no checkout: valida posse/estado e devolve o desconto.
  async avaliarPremio(
    tenantId: string,
    resgateId: string | undefined,
    telefone: string,
    itens: any[],
    subtotal: number,
  ): Promise<{ desconto: number; resgateId?: string; plano?: string }> {
    if (!resgateId) return { desconto: 0 };
    const tel = soDigitos(telefone);
    const [r] = await this.db
      .select()
      .from(fidelidadeResgate)
      .where(and(eq(fidelidadeResgate.id, resgateId), eq(fidelidadeResgate.tenantId, tenantId)));
    if (!r || r.telefone !== tel || r.status !== 'resgatado') return { desconto: 0 };
    if (r.prazoEm && new Date(r.prazoEm) < new Date()) return { desconto: 0 };
    const [plano] = await this.db
      .select()
      .from(fidelidadePlano)
      .where(eq(fidelidadePlano.id, r.planoId));
    if (!plano) return { desconto: 0 };
    const desconto = FidelidadeService.descontoPremio(
      plano.recompensaTipo,
      Number(plano.recompensaValor) || 0,
      (plano.recompensaProdutos as string[]) ?? [],
      itens,
      subtotal,
    );
    return { desconto, resgateId: r.id, plano: plano.nome };
  }

  // Marca o prêmio como consumido no pedido (após o pedido ser criado).
  async marcarPremioUsado(tenantId: string, resgateId: string, pedidoId: string) {
    await this.db
      .update(fidelidadeResgate)
      .set({ status: 'usado', pedidoId })
      .where(
        and(
          eq(fidelidadeResgate.id, resgateId),
          eq(fidelidadeResgate.tenantId, tenantId),
          eq(fidelidadeResgate.status, 'resgatado'),
        ),
      );
  }

  async resgatar(tenantId: string, resgateId: string, telefone: string) {
    const tel = soDigitos(telefone);
    const [r] = await this.db
      .select()
      .from(fidelidadeResgate)
      .where(and(eq(fidelidadeResgate.id, resgateId), eq(fidelidadeResgate.tenantId, tenantId)));
    if (!r || r.telefone !== tel) throw new NotFoundException('Prêmio não encontrado.');
    if (r.status !== 'disponivel')
      throw new BadRequestException(r.status === 'expirado' ? 'Prêmio expirado.' : 'Prêmio já resgatado.');
    if (r.prazoEm && new Date(r.prazoEm) < new Date()) {
      await this.db
        .update(fidelidadeResgate)
        .set({ status: 'expirado' })
        .where(eq(fidelidadeResgate.id, r.id));
      throw new BadRequestException('Prêmio expirado.');
    }
    await this.db
      .update(fidelidadeResgate)
      .set({ status: 'resgatado', resgatadoEm: new Date() })
      .where(eq(fidelidadeResgate.id, r.id));
    return { ok: true };
  }

  // ===== Helpers de saldo/resgate =====
  private async saldo(tenantId: string, planoId: string, tel: string): Promise<number> {
    const [row] = await this.db
      .select({ pontos: fidelidadeCliente.pontos })
      .from(fidelidadeCliente)
      .where(
        and(
          eq(fidelidadeCliente.tenantId, tenantId),
          eq(fidelidadeCliente.planoId, planoId),
          eq(fidelidadeCliente.telefone, tel),
        ),
      );
    return row?.pontos ?? 0;
  }

  private async setSaldo(
    tenantId: string,
    planoId: string,
    tel: string,
    pontos: number,
    nome?: string,
    clienteId?: string,
  ) {
    const [ja] = await this.db
      .select({ id: fidelidadeCliente.id })
      .from(fidelidadeCliente)
      .where(
        and(
          eq(fidelidadeCliente.tenantId, tenantId),
          eq(fidelidadeCliente.planoId, planoId),
          eq(fidelidadeCliente.telefone, tel),
        ),
      );
    if (ja) {
      await this.db
        .update(fidelidadeCliente)
        .set({ pontos, nome: nome ?? undefined, clienteId: clienteId ?? undefined, atualizadoEm: new Date() })
        .where(eq(fidelidadeCliente.id, ja.id));
      return;
    }
    await this.db
      .insert(fidelidadeCliente)
      .values({ tenantId, planoId, telefone: tel, nome: nome ?? null, clienteId: clienteId ?? null, pontos });
  }

  private async gerarResgate(tenantId: string, plano: any, tel: string, clienteId?: string) {
    const prazoEm = plano.prazoResgateDias
      ? new Date(Date.now() + Number(plano.prazoResgateDias) * 86400000)
      : null;
    const [row] = await this.db
      .insert(fidelidadeResgate)
      .values({ tenantId, planoId: plano.id, telefone: tel, clienteId: clienteId ?? null, prazoEm })
      .returning({ id: fidelidadeResgate.id });
    return row;
  }

  private async expirarVencidos(tenantId: string, tel: string) {
    await this.db
      .update(fidelidadeResgate)
      .set({ status: 'expirado' })
      .where(
        and(
          eq(fidelidadeResgate.tenantId, tenantId),
          eq(fidelidadeResgate.telefone, tel),
          eq(fidelidadeResgate.status, 'disponivel'),
          sql`${fidelidadeResgate.prazoEm} is not null and ${fidelidadeResgate.prazoEm} < now()`,
        ),
      );
  }
}
