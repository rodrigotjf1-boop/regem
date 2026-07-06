import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  tituloFinanceiro,
  lancamentoCaixa,
  fornecedor,
  caixaSessao,
  colaborador,
  formaPagamento,
  entitlement,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { proximaData } from '../../common/regras-negocio';
import { CreateTituloDto } from './dto/create-titulo.dto';
import { PagarTituloDto } from './dto/pagar-titulo.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class FinanceiroService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  async listar(tenantId: string, tipo?: string, status?: string) {
    const res: any = await this.db.execute(sql`
      select t.id, t.tipo, t.descricao, t.categoria, t.valor, t.vencimento,
             t.recorrencia, t.status, t.origem, t.foto_ref as "fotoRef",
             t.created_at as "createdAt", f.nome as "fornecedorNome"
      from titulo_financeiro t
      left join fornecedor f on f.id = t.fornecedor_id
      where t.tenant_id = ${tenantId}
      ${tipo ? sql`and t.tipo = ${tipo}` : sql``}
      ${status ? sql`and t.status = ${status}` : sql``}
      order by (t.status = 'aberto') desc, t.vencimento asc nulls last, t.created_at desc
      limit 300
    `);
    return res.rows ?? res;
  }

  async criar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: CreateTituloDto,
  ) {
    const [row] = await this.db
      .insert(tituloFinanceiro)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        tipo: dto.tipo ?? 'pagar',
        descricao: dto.descricao,
        categoria: dto.categoria,
        fornecedorId: dto.fornecedorId,
        valor: String(dto.valor),
        vencimento: dto.vencimento,
        recorrencia: dto.recorrencia ?? 'nenhuma',
        origem: 'manual',
        fotoRef: dto.fotoRef,
        criadoPorId: atorId,
      })
      .returning();
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'financeiro',
      acao: 'criou_titulo',
      entidadeTipo: 'titulo_financeiro',
      entidadeId: row.id,
      detalhe: { descricao: row.descricao, valor: Number(row.valor), tipo: row.tipo },
    });
    return row;
  }

  // Baixa: gera lançamento de caixa e fecha o título. Recorrente → cria o próximo.
  async pagar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    id: string,
    dto: PagarTituloDto,
  ) {
    return this.db.transaction(async (tx) => {
      const [t] = await tx
        .select()
        .from(tituloFinanceiro)
        .where(
          and(
            eq(tituloFinanceiro.id, id),
            eq(tituloFinanceiro.tenantId, tenantId),
          ),
        );
      if (!t) throw new NotFoundException('Título não encontrado');
      if (t.status !== 'aberto')
        throw new BadRequestException('Título não está aberto');

      const valor = dto.valor != null ? dto.valor : Number(t.valor);
      await tx.insert(lancamentoCaixa).values({
        tenantId,
        unidadeId: t.unidadeId,
        tituloId: t.id,
        tipo: t.tipo === 'pagar' ? 'saida' : 'entrada',
        valor: String(valor),
        data: dto.data ?? hojeISO(),
        categoria: t.categoria,
        forma: dto.forma,
        descricao: t.descricao,
        criadoPorId: atorId,
      });
      await tx
        .update(tituloFinanceiro)
        .set({ status: 'pago' })
        .where(eq(tituloFinanceiro.id, t.id));

      // Recorrência: gera o próximo título em aberto.
      const prox = proximaData(t.vencimento, t.recorrencia);
      if (prox) {
        await tx.insert(tituloFinanceiro).values({
          tenantId,
          unidadeId: t.unidadeId,
          tipo: t.tipo,
          descricao: t.descricao,
          categoria: t.categoria,
          fornecedorId: t.fornecedorId,
          valor: t.valor,
          vencimento: prox,
          recorrencia: t.recorrencia,
          origem: 'manual',
          criadoPorId: atorId,
        });
      }

      await this.auditoria.registrar({
        tenantId,
        atorId,
        atorPerfil,
        tipo: 'financeiro',
        acao: 'pagou_titulo',
        entidadeTipo: 'titulo_financeiro',
        entidadeId: t.id,
        detalhe: { valor, forma: dto.forma ?? null, recorrenteProx: prox },
      });
      return { ok: true, proximoVencimento: prox };
    });
  }

  // Estorno = lançamento inverso + reabre o título (nunca apaga).
  async estornar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    id: string,
  ) {
    return this.db.transaction(async (tx) => {
      const [lanc] = await tx
        .select()
        .from(lancamentoCaixa)
        .where(
          and(
            eq(lancamentoCaixa.tituloId, id),
            eq(lancamentoCaixa.tenantId, tenantId),
            isNull(lancamentoCaixa.estornoDe),
          ),
        )
        .orderBy(desc(lancamentoCaixa.createdAt));
      if (!lanc) throw new NotFoundException('Pagamento não encontrado');

      await tx.insert(lancamentoCaixa).values({
        tenantId,
        unidadeId: lanc.unidadeId,
        tituloId: id,
        tipo: lanc.tipo === 'saida' ? 'entrada' : 'saida',
        valor: lanc.valor,
        data: hojeISO(),
        categoria: lanc.categoria,
        descricao: `Estorno · ${lanc.descricao ?? ''}`,
        estornoDe: lanc.id,
        criadoPorId: atorId,
      });
      await tx
        .update(tituloFinanceiro)
        .set({ status: 'aberto' })
        .where(eq(tituloFinanceiro.id, id));

      await this.auditoria.registrar({
        tenantId,
        atorId,
        atorPerfil,
        tipo: 'financeiro',
        acao: 'estornou_titulo',
        entidadeTipo: 'titulo_financeiro',
        entidadeId: id,
        detalhe: { valor: Number(lanc.valor) },
      });
      return { ok: true };
    });
  }

  // Resumo p/ o topo da tela (base do fluxo de caixa — H2).
  async resumo(tenantId: string) {
    const r: any = await this.db.execute(sql`
      select
        coalesce(sum(case when tipo='pagar' and status='aberto' then valor else 0 end),0) as "aPagar",
        coalesce(sum(case when tipo='receber' and status='aberto' then valor else 0 end),0) as "aReceber"
      from titulo_financeiro where tenant_id=${tenantId}
    `);
    const c: any = await this.db.execute(sql`
      select coalesce(sum(case when tipo='entrada' then valor else -valor end),0) as "saldoCaixa"
      from lancamento_caixa where tenant_id=${tenantId}
    `);
    const t = (r.rows ?? r)[0];
    const cx = (c.rows ?? c)[0];
    return {
      aPagar: Number(t.aPagar),
      aReceber: Number(t.aReceber),
      saldoCaixa: Number(cx.saldoCaixa),
    };
  }

  // Fluxo de caixa projetado: saldo atual + títulos abertos por vencimento,
  // com saldo acumulado dia a dia (vencidos entram no "hoje"). H2.
  async fluxoCaixa(tenantId: string, dias = 30) {
    const c: any = await this.db.execute(sql`
      select coalesce(sum(case when tipo='entrada' then valor else -valor end),0) as saldo
      from lancamento_caixa where tenant_id=${tenantId}
    `);
    const saldoAtual = Number((c.rows ?? c)[0].saldo);

    const hoje = hojeISO();
    const limite = new Date(Date.now() + dias * 86400000)
      .toISOString()
      .slice(0, 10);
    const t: any = await this.db.execute(sql`
      select vencimento::text as data, tipo, coalesce(sum(valor),0) as valor
      from titulo_financeiro
      where tenant_id=${tenantId} and status='aberto' and vencimento is not null
        and vencimento <= ${limite}
      group by vencimento, tipo
      order by vencimento asc
    `);
    const linhas = t.rows ?? t;

    // Agrega por data (vencidos → hoje).
    const mapa = new Map<string, { aPagar: number; aReceber: number }>();
    for (const l of linhas) {
      const data = l.data < hoje ? hoje : l.data;
      const cur = mapa.get(data) ?? { aPagar: 0, aReceber: 0 };
      if (l.tipo === 'pagar') cur.aPagar += Number(l.valor);
      else cur.aReceber += Number(l.valor);
      mapa.set(data, cur);
    }

    let saldo = saldoAtual;
    const datas = [...mapa.keys()].sort();
    const projecao = datas.map((data) => {
      const m = mapa.get(data)!;
      saldo += m.aReceber - m.aPagar;
      return {
        data,
        aPagar: m.aPagar,
        aReceber: m.aReceber,
        saldoProjetado: Number(saldo.toFixed(2)),
        atraso: data === hoje && datas.includes(hoje),
        negativo: saldo < 0,
      };
    });

    return {
      saldoAtual,
      horizonteDias: dias,
      totalAPagar: projecao.reduce((s, p) => s + p.aPagar, 0),
      totalAReceber: projecao.reduce((s, p) => s + p.aReceber, 0),
      saldoFinal: Number(saldo.toFixed(2)),
      projecao,
    };
  }

  // DRE gerencial (regime de caixa) — receitas − despesas por categoria, do ledger. H3.
  // Valor pleno (receita de vendas, CMV, folha) chega com o PDV (Fase J) e a folha.
  async dreCaixa(tenantId: string, inicio: string, fim: string) {
    const rec: any = await this.db.execute(sql`
      select coalesce(sum(valor),0) as v from lancamento_caixa
      where tenant_id=${tenantId} and tipo='entrada' and estorno_de is null
        and data between ${inicio} and ${fim}
    `);
    const desp: any = await this.db.execute(sql`
      select coalesce(categoria,'outros') as categoria, coalesce(sum(valor),0) as v
      from lancamento_caixa
      where tenant_id=${tenantId} and tipo='saida' and estorno_de is null
        and data between ${inicio} and ${fim}
      group by coalesce(categoria,'outros')
      order by v desc
    `);
    const receitas = Number((rec.rows ?? rec)[0].v);
    const despesas = (desp.rows ?? desp).map((d: any) => ({
      categoria: d.categoria,
      valor: Number(d.v),
    }));
    const totalDespesas = despesas.reduce((s: number, d: any) => s + d.valor, 0);
    return {
      periodo: { inicio, fim },
      receitas,
      despesas,
      totalDespesas,
      resultado: Number((receitas - totalDespesas).toFixed(2)),
    };
  }

  // ===== Caixa (J5) =====
  // origem separa a gaveta do balcão (pdv) da gaveta do delivery.
  async sessaoAberta(tenantId: string, origem = 'pdv') {
    const [s] = await this.db
      .select()
      .from(caixaSessao)
      .where(
        and(
          eq(caixaSessao.tenantId, tenantId),
          eq(caixaSessao.status, 'aberta'),
          eq(caixaSessao.origem, origem),
        ),
      );
    return s ?? null;
  }

  async abrirSessao(
    tenantId: string,
    atorId: string,
    dto: { valorAbertura?: number; unidadeId?: string; origem?: string },
  ) {
    const origem = dto.origem === 'delivery' ? 'delivery' : 'pdv';
    const aberta = await this.sessaoAberta(tenantId, origem);
    if (aberta) throw new BadRequestException('Já existe um caixa aberto.');
    // Nº do turno = sequencial por dia (fuso SP), por origem: 1º caixa do dia = Turno 1.
    const tn: any = await this.db.execute(sql`
      select coalesce(max(turno_numero), 0) + 1 as n from caixa_sessao
      where tenant_id = ${tenantId} and origem = ${origem}
        and (aberta_em at time zone 'America/Sao_Paulo')::date
            = (now() at time zone 'America/Sao_Paulo')::date`);
    const turnoNumero = Number((tn.rows ?? tn)[0].n) || 1;
    const [s] = await this.db
      .insert(caixaSessao)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        origem,
        turnoNumero,
        valorAbertura: String(dto.valorAbertura ?? 0),
        abertaPorId: atorId,
      })
      .returning();
    return s;
  }

  // Caixa aberto + nome do operador (p/ o PDV mostrar "Turno N · Operador X").
  async caixaAtual(tenantId: string, origem = 'pdv') {
    const s = await this.sessaoAberta(tenantId, origem);
    if (!s) return null;
    let operadorNome: string | null = null;
    if (s.abertaPorId) {
      const [c] = await this.db
        .select({ nome: colaborador.nome })
        .from(colaborador)
        .where(eq(colaborador.id, s.abertaPorId));
      operadorNome = c?.nome ?? null;
    }
    return { ...s, operadorNome };
  }

  // Config do caixa (presidente/C&O): atendente pode sangrar/suprir sem autorização?
  private async caixaLivre(tenantId: string): Promise<boolean> {
    const [e] = await this.db
      .select({ ativo: entitlement.ativo })
      .from(entitlement)
      .where(
        and(
          eq(entitlement.tenantId, tenantId),
          eq(entitlement.modulo, 'pdv_caixa_livre'),
        ),
      );
    return !!e?.ativo;
  }

  async getConfigCaixa(tenantId: string) {
    return { caixaLivre: await this.caixaLivre(tenantId) };
  }

  async setCaixaLivre(tenantId: string, ativo: boolean) {
    await this.db
      .insert(entitlement)
      .values({ tenantId, modulo: 'pdv_caixa_livre', ativo })
      .onConflictDoUpdate({
        target: [entitlement.tenantId, entitlement.modulo],
        set: { ativo, updatedAt: new Date() },
      });
    return { caixaLivre: ativo };
  }

  // ===== Formas de pagamento (cadastro) =====
  private static readonly FORMAS_PADRAO = [
    { nome: 'Dinheiro', tipo: 'dinheiro' },
    { nome: 'Pix', tipo: 'pix' },
    { nome: 'Cartão de crédito', tipo: 'credito' },
    { nome: 'Cartão de débito', tipo: 'debito' },
  ];

  async listarFormasPagamento(tenantId: string, apenasAtivas = false) {
    const rows = await this.db
      .select()
      .from(formaPagamento)
      .where(eq(formaPagamento.tenantId, tenantId))
      .orderBy(formaPagamento.ordem, formaPagamento.nome);
    // Semeia os padrões na primeira vez (sem quebrar a leitura).
    if (rows.length === 0) {
      await this.db.insert(formaPagamento).values(
        FinanceiroService.FORMAS_PADRAO.map((f, i) => ({ tenantId, nome: f.nome, tipo: f.tipo, ordem: i })),
      );
      return this.db
        .select()
        .from(formaPagamento)
        .where(
          apenasAtivas
            ? and(eq(formaPagamento.tenantId, tenantId), eq(formaPagamento.ativo, true))
            : eq(formaPagamento.tenantId, tenantId),
        )
        .orderBy(formaPagamento.ordem, formaPagamento.nome);
    }
    return apenasAtivas ? rows.filter((r) => r.ativo) : rows;
  }

  async criarFormaPagamento(
    tenantId: string,
    dto: { nome: string; tipo?: string },
  ) {
    if (!dto.nome?.trim()) throw new BadRequestException('Informe o nome.');
    const tipos = ['dinheiro', 'pix', 'credito', 'debito', 'vr', 'outro'];
    const [row] = await this.db
      .insert(formaPagamento)
      .values({
        tenantId,
        nome: dto.nome.trim(),
        tipo: tipos.includes(dto.tipo ?? '') ? dto.tipo : 'outro',
      })
      .returning();
    return row;
  }

  async setFormaPagamentoAtiva(tenantId: string, id: string, ativo: boolean) {
    const [row] = await this.db
      .update(formaPagamento)
      .set({ ativo })
      .where(and(eq(formaPagamento.id, id), eq(formaPagamento.tenantId, tenantId)))
      .returning();
    if (!row) throw new BadRequestException('Forma não encontrada.');
    return row;
  }

  // Sangria (retira dinheiro) / suprimento (coloca dinheiro) — sempre em dinheiro.
  async movimentarCaixa(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: {
      tipo: 'sangria' | 'suprimento';
      valor: number;
      descricao?: string;
      origem?: string;
    },
  ) {
    // Autorização: atendente só sangra/supre se o presidente liberou.
    if (atorPerfil === 'atendente' && !(await this.caixaLivre(tenantId))) {
      throw new ForbiddenException(
        'Sangria/suprimento requer autorização de um gerente.',
      );
    }
    if (!(Number(dto.valor) > 0))
      throw new BadRequestException('Informe um valor válido.');
    const s = await this.sessaoAberta(
      tenantId,
      dto.origem === 'delivery' ? 'delivery' : 'pdv',
    );
    if (!s) throw new BadRequestException('Nenhum caixa aberto.');
    this.exigeDonoDoTurno(s, atorId, atorPerfil);
    await this.db.insert(lancamentoCaixa).values({
      tenantId,
      unidadeId: s.unidadeId,
      sessaoId: s.id,
      tipo: dto.tipo === 'suprimento' ? 'entrada' : 'saida',
      valor: String(dto.valor),
      data: hojeISO(),
      categoria: dto.tipo,
      forma: 'dinheiro',
      descricao: dto.descricao,
      criadoPorId: atorId,
    });
    return { ok: true };
  }

  // Turno é do operador que abriu: só ele fecha/movimenta (gerente+ faz override).
  private exigeDonoDoTurno(s: any, atorId: string, atorPerfil: string) {
    const gestor = atorPerfil === 'gerente' || atorPerfil === 'presidente';
    if (s.abertaPorId && s.abertaPorId !== atorId && !gestor) {
      throw new ForbiddenException(
        'Este turno é de outro operador. Só quem abriu (ou um gerente) pode movimentar/fechar.',
      );
    }
  }

  // Fechamento CEGO: recebe a contagem; calcula o esperado (só dinheiro) e a diferença.
  async fecharSessao(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: { valorInformado: number; obs?: string; origem?: string },
  ) {
    const s = await this.sessaoAberta(
      tenantId,
      dto.origem === 'delivery' ? 'delivery' : 'pdv',
    );
    if (!s) throw new BadRequestException('Nenhum caixa aberto.');
    this.exigeDonoDoTurno(s, atorId, atorPerfil);
    // Esperado em gaveta = abertura + entradas − saídas (apenas dinheiro) da sessão.
    const r: any = await this.db.execute(sql`
      select coalesce(sum(case when tipo='entrada' then valor else -valor end),0) as mov
      from lancamento_caixa
      where sessao_id=${s.id} and (forma='dinheiro' or forma is null)
    `);
    const mov = Number((r.rows ?? r)[0].mov);
    const esperado = Number(s.valorAbertura) + mov;
    const informado = Number(dto.valorInformado);
    const diferenca = Number((informado - esperado).toFixed(2));

    // Resumo por forma de pagamento (vendas registradas na sessão) — útil sem TEF.
    const rf: any = await this.db.execute(sql`
      select coalesce(forma,'dinheiro') as forma,
             coalesce(sum(case when tipo='entrada' then valor else -valor end),0) as total
      from lancamento_caixa
      where sessao_id=${s.id} and categoria='venda'
      group by coalesce(forma,'dinheiro')
      order by 1
    `);
    const porForma = (rf.rows ?? rf).map((x: any) => ({
      forma: x.forma,
      total: Number(Number(x.total).toFixed(2)),
    }));
    const [row] = await this.db
      .update(caixaSessao)
      .set({
        status: 'fechada',
        valorInformado: String(informado),
        valorEsperado: String(esperado.toFixed(2)),
        diferenca: String(diferenca),
        fechadaEm: new Date(),
        fechadaPorId: atorId,
        obs: dto.obs,
      })
      .where(eq(caixaSessao.id, s.id))
      .returning();
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil: '',
      tipo: 'financeiro',
      acao: 'fechou_caixa',
      entidadeTipo: 'caixa_sessao',
      entidadeId: s.id,
      detalhe: { esperado, informado, diferenca, porForma },
    });
    return { esperado, informado, diferenca, porForma, sessao: row };
  }
}
