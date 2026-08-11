import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { normalizarFormaPagamento } from '../../common/formas-pagamento-normaliza';

// Re-agrupa linhas {forma,qtd,total} pelo rótulo UNIFICADO (dinheiro/pix/crédito/…)
// — os canais gravavam N nomes p/ o mesmo método. '—' (sem forma) fica separado.
function agruparPorForma(rows: any[]): { forma: string; qtd: number; total: number }[] {
  const m = new Map<string, { qtd: number; total: number }>();
  for (const r of rows) {
    const label = !r.forma || r.forma === '—' ? '—' : normalizarFormaPagamento(r.forma).label;
    const g = m.get(label) ?? { qtd: 0, total: 0 };
    g.qtd += Number(r.qtd) || 0;
    g.total += Number(r.total) || 0;
    m.set(label, g);
  }
  return [...m.entries()]
    .map(([forma, v]) => ({ forma, qtd: v.qtd, total: v.total }))
    .sort((a, b) => b.total - a.total);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
// Relatórios de venda — camada de LEITURA sobre comanda/comanda_item (vendas
// fechadas). Canal é derivado (mesa / delivery-app / balcão) sem coluna nova.
@Injectable()
export class RelatoriosService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  private periodo(inicio?: string, fim?: string) {
    // ini/f agora filtram por TIMESTAMP (a coluna não é mais truncada com ::date),
    // então o filtro honra hora inicial/final vinda do front (ex.: "2026-08-05 14:30:00").
    // Se vier só a data (sem hora) ou nada, completamos o dia inteiro para não excluir
    // o próprio dia — mantendo o comportamento antigo de filtro só-por-data.
    const hoje = new Date().toISOString().slice(0, 10);
    const comHoraIni = (d?: string) =>
      !d ? null : d.length <= 10 ? `${d} 00:00:00` : d;
    const comHoraFim = (d?: string) =>
      !d ? null : d.length <= 10 ? `${d} 23:59:59` : d;
    const ini =
      comHoraIni(inicio) ||
      `${new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)} 00:00:00`;
    return { ini, fim: comHoraFim(fim) || `${hoje} 23:59:59` };
  }
  private async rows(q: any): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return r.rows ?? r;
  }

  // Oculta valores em R$ para quem não pode ver financeiro (gerente vê só volume).
  private oc(v: any, verFin: boolean): number | null {
    return verFin ? Number(v) : null;
  }

  // Resumo + quebras (forma, canal, dia, hora).
  async vendas(tenantId: string, inicio?: string, fim?: string, verFin = false) {
    const { ini, fim: f } = this.periodo(inicio, fim);
    const m = (v: any) => this.oc(v, verFin);
    const base = sql`from comanda c
      where c.tenant_id = ${tenantId}
        and c.status = 'fechada'
        and c.fechada_em between ${ini} and ${f}`;

    const [resumo] = await this.rows(sql`
      select count(*)::int as vendas,
             coalesce(sum(c.total),0) as faturado,
             coalesce(avg(c.total),0) as ticket_medio
      ${base}`);
    const [{ canceladas }] = await this.rows(sql`
      select count(*)::int as canceladas from comanda c
      where c.tenant_id = ${tenantId} and c.status='cancelada'
        and c.cancelada_em between ${ini} and ${f}`);

    const porForma = await this.rows(sql`
      select coalesce(c.forma,'—') as forma, count(*)::int as qtd, coalesce(sum(c.total),0) as total
      ${base} group by 1 order by 3 desc`);
    const porCanal = await this.rows(sql`
      select case when c.mesa_id is not null then 'mesa'
                  when c.forma='online' then 'delivery/app'
                  else 'balcão' end as canal,
             count(*)::int as qtd, coalesce(sum(c.total),0) as total
      ${base} group by 1 order by 3 desc`);
    const porDia = await this.rows(sql`
      select c.fechada_em::date as dia, count(*)::int as qtd, coalesce(sum(c.total),0) as total
      ${base} group by 1 order by 1`);
    const porHora = await this.rows(sql`
      select extract(hour from c.fechada_em)::int as hora, count(*)::int as qtd, coalesce(sum(c.total),0) as total
      ${base} group by 1 order by 1`);

    return {
      periodo: { inicio: ini, fim: f },
      verFinanceiro: verFin,
      resumo: {
        vendas: Number(resumo.vendas),
        faturado: m(resumo.faturado),
        ticketMedio: m(Number(resumo.ticket_medio).toFixed(2)),
        canceladas: Number(canceladas),
      },
      porForma: agruparPorForma(porForma).map((r) => ({ forma: r.forma, qtd: r.qtd, total: m(r.total) })),
      porCanal: porCanal.map((r) => ({ canal: r.canal, qtd: Number(r.qtd), total: m(r.total) })),
      porDia: porDia.map((r) => ({ dia: r.dia, qtd: Number(r.qtd), total: m(r.total) })),
      porHora: porHora.map((r) => ({ hora: Number(r.hora), qtd: Number(r.qtd), total: m(r.total) })),
    };
  }

  // Curva ABC dos produtos por faturamento (A<=80%, B<=95%, C resto).
  async produtos(tenantId: string, inicio?: string, fim?: string, verFin = false) {
    const { ini, fim: f } = this.periodo(inicio, fim);
    const m = (v: any) => this.oc(v, verFin);
    const rows = await this.rows(sql`
      select ci.descricao,
             coalesce(sum(ci.quantidade),0) as qtd,
             coalesce(sum(ci.quantidade * ci.preco_unitario),0) as faturamento
      from comanda_item ci
      join comanda c on c.id = ci.comanda_id
      where c.tenant_id = ${tenantId} and c.status = 'fechada'
        and c.fechada_em between ${ini} and ${f}
      group by ci.descricao
      order by faturamento desc`);
    const total = rows.reduce((s, r) => s + Number(r.faturamento), 0) || 1;
    let acum = 0;
    return {
      periodo: { inicio: ini, fim: f },
      verFinanceiro: verFin,
      total: m(total.toFixed(2)),
      itens: rows.map((r) => {
        const fat = Number(r.faturamento);
        acum += fat;
        const pctAcum = (acum / total) * 100;
        const classe = pctAcum <= 80 ? 'A' : pctAcum <= 95 ? 'B' : 'C';
        return {
          descricao: r.descricao,
          qtd: Number(r.qtd),
          faturamento: m(fat.toFixed(2)),
          pct: Number(((fat / total) * 100).toFixed(1)),
          pctAcum: Number(pctAcum.toFixed(1)),
          classe,
        };
      }),
    };
  }

  // Desempenho por atendente (quem abriu a venda).
  async atendentes(tenantId: string, inicio?: string, fim?: string, verFin = false) {
    const { ini, fim: f } = this.periodo(inicio, fim);
    const m = (v: any) => this.oc(v, verFin);
    const rows = await this.rows(sql`
      select coalesce(col.nome,'—') as nome,
             count(*)::int as vendas,
             coalesce(sum(c.total),0) as total,
             coalesce(avg(c.total),0) as ticket_medio
      from comanda c
      left join colaborador col on col.id = c.aberta_por_id
      where c.tenant_id = ${tenantId} and c.status = 'fechada'
        and c.fechada_em between ${ini} and ${f}
      group by col.nome
      order by total desc`);
    return {
      periodo: { inicio: ini, fim: f },
      verFinanceiro: verFin,
      atendentes: rows.map((r) => ({
        nome: r.nome,
        vendas: Number(r.vendas),
        total: m(r.total),
        ticketMedio: m(Number(r.ticket_medio).toFixed(2)),
      })),
    };
  }

  // Operações de caixa no período: cancelamentos (quem cancelou + motivo) e
  // sangrias/suprimentos por operador. Base para auditoria de caixa.
  async operacoesCaixa(tenantId: string, inicio?: string, fim?: string, verFin = false) {
    const { ini, fim: f } = this.periodo(inicio, fim);
    const m = (v: any) => this.oc(v, verFin);

    // Cancelamentos: comanda cancelada, por quem cancelou.
    const cancel = await this.rows(sql`
      select coalesce(col.nome,'—') as operador,
             count(*)::int as qtd,
             coalesce(sum(c.total),0) as valor
      from comanda c
      left join colaborador col on col.id = c.cancelada_por_id
      where c.tenant_id = ${tenantId} and c.status = 'cancelada'
        and c.created_at between ${ini} and ${f}
      group by col.nome order by qtd desc`);

    // Sangrias e suprimentos: lançamentos de caixa por operador.
    const mov = await this.rows(sql`
      select coalesce(col.nome,'—') as operador,
             coalesce(sum(case when l.categoria='sangria' then l.valor else 0 end),0) as sangrias,
             coalesce(sum(case when l.categoria='suprimento' then l.valor else 0 end),0) as suprimentos,
             count(*) filter (where l.categoria='sangria')::int as qtd_sangrias,
             count(*) filter (where l.categoria='suprimento')::int as qtd_suprimentos
      from lancamento_caixa l
      left join colaborador col on col.id = l.criado_por_id
      where l.tenant_id = ${tenantId} and l.categoria in ('sangria','suprimento')
        and l.data between ${ini} and ${f}
      group by col.nome order by operador`);

    return {
      periodo: { inicio: ini, fim: f },
      verFinanceiro: verFin,
      cancelamentos: cancel.map((r) => ({
        operador: r.operador,
        qtd: Number(r.qtd),
        valor: m(r.valor),
      })),
      cancelamentosTotal: {
        qtd: cancel.reduce((s, r) => s + Number(r.qtd), 0),
        valor: m(cancel.reduce((s, r) => s + Number(r.valor), 0)),
      },
      movimentos: mov.map((r) => ({
        operador: r.operador,
        sangrias: m(r.sangrias),
        suprimentos: m(r.suprimentos),
        qtdSangrias: Number(r.qtd_sangrias),
        qtdSuprimentos: Number(r.qtd_suprimentos),
      })),
      movimentosTotal: {
        sangrias: m(mov.reduce((s, r) => s + Number(r.sangrias), 0)),
        suprimentos: m(mov.reduce((s, r) => s + Number(r.suprimentos), 0)),
      },
    };
  }

  // Faturamento por mês e por trimestre DENTRO do período (respeita De/Até).
  async faturamentoPeriodo(tenantId: string, inicio?: string, fim?: string) {
    const { ini, fim: f } = this.periodo(inicio, fim);
    const rows = await this.rows(sql`
      select to_char(c.fechada_em, 'YYYY-MM') as ym,
             coalesce(sum(c.total),0) as total, count(*)::int as vendas
      from comanda c
      where c.tenant_id = ${tenantId} and c.status = 'fechada'
        and c.fechada_em between ${ini} and ${f}
      group by 1 order by 1`);
    const porMes = rows.map((r) => ({
      ym: r.ym as string,
      total: Number(r.total),
      vendas: Number(r.vendas),
    }));
    // Trimestres agrupados por ano-Qn (funciona mesmo cruzando anos).
    const tri = new Map<string, { trimestre: string; total: number; vendas: number }>();
    for (const m of porMes) {
      const [y, mm] = m.ym.split('-').map(Number);
      const key = `${y}·T${Math.ceil(mm / 3)}`;
      const cur = tri.get(key) ?? { trimestre: key, total: 0, vendas: 0 };
      cur.total += m.total;
      cur.vendas += m.vendas;
      tri.set(key, cur);
    }
    return {
      periodo: { inicio: ini, fim: f },
      porMes,
      trimestres: [...tri.values()].map((t) => ({
        ...t,
        total: Number(t.total.toFixed(2)),
      })),
      total: Number(porMes.reduce((s, m) => s + m.total, 0).toFixed(2)),
    };
  }

  // Detalhe por canal: 'balcao' (local: balcão/salão) ou 'delivery'. Delivery =
  // comanda com pedido externo aceito; balcão = sem pedido externo.
  async detalheCanal(
    tenantId: string,
    canal: 'balcao' | 'delivery',
    inicio?: string,
    fim?: string,
    verFin = false,
  ) {
    const { ini, fim: f } = this.periodo(inicio, fim);
    const m = (v: any) => this.oc(v, verFin);
    const deliv = canal === 'delivery';
    const cond = deliv
      ? sql`and exists (select 1 from pedido_externo pe where pe.comanda_id = c.id and pe.status not in ('novo','cancelado'))`
      : sql`and not exists (select 1 from pedido_externo pe where pe.comanda_id = c.id and pe.status not in ('novo','cancelado'))`;
    const base = sql`from comanda c
      where c.tenant_id = ${tenantId} and c.status = 'fechada'
        and c.fechada_em between ${ini} and ${f} ${cond}`;
    const [resumo] = await this.rows(sql`
      select count(*)::int as vendas, coalesce(sum(c.total),0) as faturado,
             coalesce(avg(c.total),0) as ticket_medio ${base}`);
    const porDia = await this.rows(sql`
      select c.fechada_em::date as dia, count(*)::int as qtd, coalesce(sum(c.total),0) as total
      ${base} group by 1 order by 1`);
    const porHora = await this.rows(sql`
      select extract(hour from c.fechada_em)::int as hora, count(*)::int as qtd, coalesce(sum(c.total),0) as total
      ${base} group by 1 order by 1`);
    const maisVendidos = await this.rows(sql`
      select ci.descricao, coalesce(sum(ci.quantidade),0) as qtd,
             coalesce(sum(ci.quantidade * ci.preco_unitario),0) as fat
      from comanda_item ci join comanda c on c.id = ci.comanda_id
      where c.tenant_id = ${tenantId} and c.status = 'fechada'
        and c.fechada_em between ${ini} and ${f} ${cond}
      group by ci.descricao order by qtd desc limit 20`);
    let porRegiao: any[] = [];
    let porPlataforma: any[] = [];
    if (deliv) {
      const baseD = sql`from comanda c
        join pedido_externo pe on pe.comanda_id = c.id
        where c.tenant_id = ${tenantId} and c.status = 'fechada'
          and c.fechada_em between ${ini} and ${f}
          and pe.status not in ('novo','cancelado')`;
      porRegiao = await this.rows(sql`
        select coalesce(nullif(pe.endereco_bairro,''),'—') as regiao,
               count(*)::int as qtd, coalesce(sum(c.total),0) as total
        ${baseD} group by 1 order by total desc`);
      porPlataforma = await this.rows(sql`
        select pe.canal as plataforma, count(*)::int as qtd, coalesce(sum(c.total),0) as total
        ${baseD} group by 1 order by total desc`);
    }
    return {
      periodo: { inicio: ini, fim: f },
      canal,
      verFinanceiro: verFin,
      resumo: {
        vendas: Number(resumo.vendas),
        faturado: m(resumo.faturado),
        ticketMedio: m(Number(resumo.ticket_medio).toFixed(2)),
      },
      porDia: porDia.map((r) => ({ dia: r.dia, qtd: Number(r.qtd), total: m(r.total) })),
      porHora: porHora.map((r) => ({ hora: Number(r.hora), qtd: Number(r.qtd), total: m(r.total) })),
      maisVendidos: maisVendidos.map((r) => ({ descricao: r.descricao, qtd: Number(r.qtd), faturamento: m(r.fat) })),
      porRegiao: porRegiao.map((r) => ({ regiao: r.regiao, qtd: Number(r.qtd), total: m(r.total) })),
      porPlataforma: porPlataforma.map((r) => ({ plataforma: r.plataforma, qtd: Number(r.qtd), total: m(r.total) })),
    };
  }

  // Ranking global de produtos (balcão + delivery), com a quebra por canal.
  async rankingProdutos(tenantId: string, inicio?: string, fim?: string, verFin = false) {
    const { ini, fim: f } = this.periodo(inicio, fim);
    const m = (v: any) => this.oc(v, verFin);
    const rows = await this.rows(sql`
      select ci.descricao,
             coalesce(sum(ci.quantidade),0) as qtd,
             coalesce(sum(ci.quantidade * ci.preco_unitario),0) as fat,
             coalesce(sum(case when d.is_deliv then ci.quantidade else 0 end),0) as qtd_delivery,
             coalesce(sum(case when d.is_deliv then 0 else ci.quantidade end),0) as qtd_balcao
      from comanda_item ci
      join comanda c on c.id = ci.comanda_id
      join lateral (
        select exists(select 1 from pedido_externo pe
          where pe.comanda_id = c.id and pe.status not in ('novo','cancelado')) as is_deliv
      ) d on true
      where c.tenant_id = ${tenantId} and c.status = 'fechada'
        and c.fechada_em between ${ini} and ${f}
      group by ci.descricao order by qtd desc limit 30`);
    return {
      periodo: { inicio: ini, fim: f },
      verFinanceiro: verFin,
      itens: rows.map((r) => ({
        descricao: r.descricao,
        qtd: Number(r.qtd),
        faturamento: m(r.fat),
        qtdDelivery: Number(r.qtd_delivery),
        qtdBalcao: Number(r.qtd_balcao),
      })),
    };
  }

  // Turnos = sessões de caixa no período (lista com totais por sessão).
  async turnos(tenantId: string, inicio?: string, fim?: string, verFin = false) {
    const { ini, fim: f } = this.periodo(inicio, fim);
    const m = (v: any) => this.oc(v, verFin);
    const rows = await this.rows(sql`
      select s.id, s.origem, s.status, s.aberta_em as "abertaEm", s.fechada_em as "fechadaEm",
             s.valor_abertura as "abertura", s.valor_informado as "informado",
             s.valor_esperado as "esperado", s.diferenca,
             ab.nome as "abertaPor", fe.nome as "fechadaPor",
             coalesce((select sum(l.valor) from lancamento_caixa l
               where l.sessao_id = s.id and l.tipo='entrada' and l.estorno_de is null
                 and coalesce(l.categoria,'') <> 'suprimento'),0) as vendas,
             coalesce((select sum(l.valor) from lancamento_caixa l
               where l.sessao_id = s.id and l.categoria='sangria'),0) as sangrias,
             coalesce((select sum(l.valor) from lancamento_caixa l
               where l.sessao_id = s.id and l.categoria='suprimento'),0) as suprimentos
      from caixa_sessao s
      left join colaborador ab on ab.id = s.aberta_por_id
      left join colaborador fe on fe.id = s.fechada_por_id
      where s.tenant_id = ${tenantId} and s.aberta_em between ${ini} and ${f}
      order by s.aberta_em desc`);
    return {
      periodo: { inicio: ini, fim: f },
      verFinanceiro: verFin,
      turnos: rows.map((r) => ({
        id: r.id,
        origem: r.origem,
        status: r.status,
        abertaEm: r.abertaEm,
        fechadaEm: r.fechadaEm,
        abertaPor: r.abertaPor,
        fechadaPor: r.fechadaPor,
        abertura: m(r.abertura ?? 0),
        vendas: m(r.vendas ?? 0),
        sangrias: m(r.sangrias ?? 0),
        suprimentos: m(r.suprimentos ?? 0),
        esperado: r.esperado != null ? m(r.esperado) : null,
        informado: r.informado != null ? m(r.informado) : null,
        diferenca: r.diferenca != null ? m(r.diferenca) : null,
      })),
    };
  }

  // Cupom de fechamento de um turno: vendas por forma + sangrias/suprimentos.
  async turnoDetalhe(tenantId: string, sessaoId: string, verFin = false) {
    const m = (v: any) => this.oc(v, verFin);
    const [s] = await this.rows(sql`
      select s.id, s.origem, s.status, s.aberta_em as "abertaEm", s.fechada_em as "fechadaEm",
             s.valor_abertura as "abertura", s.valor_informado as "informado",
             s.valor_esperado as "esperado", s.diferenca,
             ab.nome as "abertaPor", fe.nome as "fechadaPor"
      from caixa_sessao s
      left join colaborador ab on ab.id = s.aberta_por_id
      left join colaborador fe on fe.id = s.fechada_por_id
      where s.tenant_id = ${tenantId} and s.id = ${sessaoId}`);
    if (!s) return null;
    const porForma = await this.rows(sql`
      select coalesce(forma,'—') as forma, count(*)::int as qtd,
             coalesce(sum(case when tipo='entrada' then valor else -valor end),0) as total
      from lancamento_caixa
      where tenant_id = ${tenantId} and sessao_id = ${sessaoId} and estorno_de is null
        and coalesce(categoria,'') not in ('sangria','suprimento')
      group by 1 order by total desc`);
    const movimentos = await this.rows(sql`
      select categoria, tipo, valor, descricao, created_at as "em"
      from lancamento_caixa
      where tenant_id = ${tenantId} and sessao_id = ${sessaoId}
        and categoria in ('sangria','suprimento')
      order by created_at`);
    return {
      sessao: {
        id: s.id,
        origem: s.origem,
        status: s.status,
        abertaEm: s.abertaEm,
        fechadaEm: s.fechadaEm,
        abertaPor: s.abertaPor,
        fechadaPor: s.fechadaPor,
        abertura: m(s.abertura ?? 0),
        esperado: s.esperado != null ? m(s.esperado) : null,
        informado: s.informado != null ? m(s.informado) : null,
        diferenca: s.diferenca != null ? m(s.diferenca) : null,
      },
      verFinanceiro: verFin,
      porForma: agruparPorForma(porForma).map((r) => ({ forma: r.forma, qtd: r.qtd, total: m(r.total) })),
      movimentos: movimentos.map((r) => ({
        categoria: r.categoria,
        tipo: r.tipo,
        valor: m(r.valor),
        descricao: r.descricao,
        em: r.em,
      })),
    };
  }

  // Faturamento de delivery por plataforma (canal do pedido externo).
  async faturamentoDelivery(tenantId: string, inicio?: string, fim?: string) {
    const { ini, fim: f } = this.periodo(inicio, fim);
    // Faturado = pedidos aceitos (exclui 'novo' pendente e 'cancelado').
    const base = sql`from pedido_externo pe
      where pe.tenant_id = ${tenantId}
        and pe.status not in ('novo','cancelado')
        and pe.criado_em between ${ini} and ${f}`;
    const porPlataforma = await this.rows(sql`
      select pe.canal as plataforma, count(*)::int as pedidos,
             coalesce(sum(pe.total),0) as total,
             coalesce(avg(pe.total),0) as ticket_medio
      ${base} group by pe.canal order by total desc`);
    const porDia = await this.rows(sql`
      select pe.criado_em::date as dia, count(*)::int as pedidos,
             coalesce(sum(pe.total),0) as total
      ${base} group by 1 order by 1`);
    const total = porPlataforma.reduce((s, r) => s + Number(r.total), 0);
    const pedidos = porPlataforma.reduce((s, r) => s + Number(r.pedidos), 0);
    return {
      periodo: { inicio: ini, fim: f },
      total: Number(total.toFixed(2)),
      pedidos,
      ticketMedio: Number((pedidos ? total / pedidos : 0).toFixed(2)),
      porPlataforma: porPlataforma.map((r) => ({
        plataforma: r.plataforma,
        pedidos: Number(r.pedidos),
        total: Number(r.total),
        ticketMedio: Number(Number(r.ticket_medio).toFixed(2)),
      })),
      porDia: porDia.map((r) => ({
        dia: r.dia,
        pedidos: Number(r.pedidos),
        total: Number(r.total),
      })),
    };
  }

  // Produção de fichas (§1.2 — explosão): lê os eventos auditados `produziu_ficha`
  // (fonte com fichaId + quantidade + custo). Agrupa por dia/semana/mês.
  async producao(
    tenantId: string,
    inicio?: string,
    fim?: string,
    agrupamento: 'dia' | 'semana' | 'mes' = 'dia',
    verFin = false,
  ) {
    const { ini, fim: f } = this.periodo(inicio, fim);
    const m = (v: any) => this.oc(v, verFin);
    const g = agrupamento === 'semana' ? 'semana' : agrupamento === 'mes' ? 'mes' : 'dia';
    const chave =
      g === 'mes'
        ? sql`to_char(a.created_at, 'YYYY-MM')`
        : g === 'semana'
        ? sql`to_char(date_trunc('week', a.created_at), 'YYYY-MM-DD')`
        : sql`a.created_at::date::text`;

    const base = sql`from audit_log a
      left join ficha_tecnica ft on ft.id = a.entidade_id
      where a.tenant_id = ${tenantId}
        and a.acao = 'produziu_ficha'
        and a.created_at between ${ini} and ${f}`;
    const qtd = sql`coalesce((a.detalhe->>'quantidade')::numeric, 0)`;
    const custo = sql`coalesce((a.detalhe->>'custoTotal')::numeric, 0)`;

    const [resumo] = await this.rows(sql`
      select count(*)::int as producoes,
             coalesce(sum(${qtd}),0) as qtd,
             coalesce(sum(${custo}),0) as custo
      ${base}`);
    const porProduto = await this.rows(sql`
      select a.entidade_id as "fichaId",
             coalesce(ft.nome,'(ficha removida)') as nome,
             count(*)::int as producoes,
             coalesce(sum(${qtd}),0) as qtd,
             coalesce(sum(${custo}),0) as custo
      ${base}
      group by a.entidade_id, ft.nome
      order by qtd desc`);
    const porPeriodo = await this.rows(sql`
      select ${chave} as periodo,
             count(*)::int as producoes,
             coalesce(sum(${qtd}),0) as qtd,
             coalesce(sum(${custo}),0) as custo
      ${base}
      group by 1 order by 1`);

    return {
      periodo: { inicio: ini, fim: f },
      agrupamento: g,
      verFinanceiro: verFin,
      resumo: {
        producoes: Number(resumo.producoes),
        qtd: Number(Number(resumo.qtd).toFixed(3)),
        custo: m(Number(resumo.custo).toFixed(2)),
      },
      porProduto: porProduto.map((r) => ({
        fichaId: r.fichaId,
        nome: r.nome,
        producoes: Number(r.producoes),
        qtd: Number(Number(r.qtd).toFixed(3)),
        custo: m(Number(r.custo).toFixed(2)),
      })),
      porPeriodo: porPeriodo.map((r) => ({
        periodo: r.periodo,
        producoes: Number(r.producoes),
        qtd: Number(Number(r.qtd).toFixed(3)),
        custo: m(Number(r.custo).toFixed(2)),
      })),
    };
  }
}
