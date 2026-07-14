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
  unidade,
  ocorrencia,
  tipoOcorrencia,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { proximaData } from '../../common/regras-negocio';
import { paraCentavos, paraReais, somarCentavos } from '../../util/dinheiro';
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
             t.fornecedor_id as "fornecedorId",
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

  // Edição — só contas EM ABERTO (paga tem lançamento; estorne antes de editar).
  async atualizar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    id: string,
    dto: CreateTituloDto,
  ) {
    const [t] = await this.db
      .select()
      .from(tituloFinanceiro)
      .where(and(eq(tituloFinanceiro.id, id), eq(tituloFinanceiro.tenantId, tenantId)));
    if (!t) throw new NotFoundException('Título não encontrado');
    if (t.status !== 'aberto')
      throw new BadRequestException('Só é possível editar contas em aberto.');
    const [row] = await this.db
      .update(tituloFinanceiro)
      .set({
        tipo: dto.tipo ?? t.tipo,
        descricao: dto.descricao,
        categoria: dto.categoria ?? null,
        fornecedorId: dto.fornecedorId ?? null,
        valor: String(dto.valor),
        vencimento: dto.vencimento ?? null,
        recorrencia: dto.recorrencia ?? 'nenhuma',
        fotoRef: dto.fotoRef ?? null,
      })
      .where(and(eq(tituloFinanceiro.id, id), eq(tituloFinanceiro.tenantId, tenantId)))
      .returning();
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'financeiro',
      acao: 'editou_titulo',
      entidadeTipo: 'titulo_financeiro',
      entidadeId: id,
      detalhe: { descricao: row.descricao, valor: Number(row.valor) },
    });
    return row;
  }

  // "Excluir" = cancela a conta em aberto (mantém o registro para auditoria).
  async cancelar(tenantId: string, atorId: string, atorPerfil: string, id: string) {
    const [t] = await this.db
      .select()
      .from(tituloFinanceiro)
      .where(and(eq(tituloFinanceiro.id, id), eq(tituloFinanceiro.tenantId, tenantId)));
    if (!t) throw new NotFoundException('Título não encontrado');
    if (t.status !== 'aberto')
      throw new BadRequestException('Só é possível excluir contas em aberto.');
    await this.db
      .update(tituloFinanceiro)
      .set({ status: 'cancelado' })
      .where(and(eq(tituloFinanceiro.id, id), eq(tituloFinanceiro.tenantId, tenantId)));
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'financeiro',
      acao: 'cancelou_titulo',
      entidadeTipo: 'titulo_financeiro',
      entidadeId: id,
      detalhe: { descricao: t.descricao, valor: Number(t.valor) },
    });
    return { ok: true };
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
    // Exclui os estornos (estorno_de not null) E os lançamentos que foram
    // estornados (id referenciado por algum estorno) — assim reversões não
    // contam como receita/despesa na DRE.
    const estornados = sql`
      select estorno_de from lancamento_caixa
      where tenant_id=${tenantId} and estorno_de is not null
    `;
    const rec: any = await this.db.execute(sql`
      select coalesce(sum(valor),0) as v from lancamento_caixa
      where tenant_id=${tenantId} and tipo='entrada' and estorno_de is null
        and id not in (${estornados})
        and data between ${inicio} and ${fim}
    `);
    const desp: any = await this.db.execute(sql`
      select coalesce(categoria,'outros') as categoria, coalesce(sum(valor),0) as v
      from lancamento_caixa
      where tenant_id=${tenantId} and tipo='saida' and estorno_de is null
        and id not in (${estornados})
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

  // Fechamento CEGO por forma: recebe o CONTADO por forma (o operador não vê o
  // esperado); calcula esperado e diferença por forma (dinheiro inclui a abertura
  // e sangrias/suprimentos) e devolve o comparativo. Diferença acima do limite da
  // unidade gera ocorrência automática + auditoria.
  async fecharSessao(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: {
      valorInformado?: number; // legado (dinheiro) — compat
      valoresInformados?: Record<string, number>; // contado por forma
      obs?: string;
      origem?: string;
    },
  ) {
    const s = await this.sessaoAberta(
      tenantId,
      dto.origem === 'delivery' ? 'delivery' : 'pdv',
    );
    if (!s) throw new BadRequestException('Nenhum caixa aberto.');
    this.exigeDonoDoTurno(s, atorId, atorPerfil);

    // Esperado por forma = movimentos (entrada − saída) da sessão agrupados por
    // forma; sangrias/suprimentos já são lançamentos, então entram naturalmente.
    // A abertura conta como dinheiro (gaveta).
    const rf: any = await this.db.execute(sql`
      select coalesce(forma,'dinheiro') as forma,
             coalesce(sum(case when tipo='entrada' then valor else -valor end),0) as mov
      from lancamento_caixa where sessao_id=${s.id}
      group by coalesce(forma,'dinheiro')`);
    const espCent: Record<string, number> = {};
    for (const x of rf.rows ?? rf) espCent[x.forma] = paraCentavos(x.mov);
    espCent['dinheiro'] = somarCentavos(espCent['dinheiro'] ?? 0, paraCentavos(s.valorAbertura));

    // Contado por forma (compat: só valorInformado = dinheiro).
    const informados: Record<string, number> =
      dto.valoresInformados ??
      (dto.valorInformado != null ? { dinheiro: dto.valorInformado } : {});

    const formas = Array.from(new Set([...Object.keys(espCent), ...Object.keys(informados)])).sort();
    const esperadoPorForma: Record<string, number> = {};
    const informadoPorForma: Record<string, number> = {};
    const diferencaPorForma: Record<string, number> = {};
    let totEspCent = 0;
    let totInfCent = 0;
    let excedeu = false;
    const limiteCent = await this.limiteDiferenca(tenantId, s.unidadeId);
    for (const f of formas) {
      const e = espCent[f] ?? 0;
      const i = paraCentavos(informados[f] ?? 0);
      esperadoPorForma[f] = paraReais(e);
      informadoPorForma[f] = paraReais(i);
      const d = somarCentavos(i, -e);
      diferencaPorForma[f] = paraReais(d);
      totEspCent += e;
      totInfCent += i;
      if (Math.abs(d) > limiteCent) excedeu = true;
    }
    const esperado = paraReais(totEspCent);
    const informado = paraReais(totInfCent);
    const diferencaCent = somarCentavos(totInfCent, -totEspCent);
    const diferenca = paraReais(diferencaCent);
    if (Math.abs(diferencaCent) > limiteCent) excedeu = true;

    const [row] = await this.db
      .update(caixaSessao)
      .set({
        status: 'fechada',
        // Colunas legadas guardam o DINHEIRO (gaveta); o detalhe fica nos jsonb.
        valorInformado: String(informadoPorForma['dinheiro'] ?? informado),
        valorEsperado: String(esperadoPorForma['dinheiro'] ?? esperado),
        diferenca: String(diferencaPorForma['dinheiro'] ?? diferenca),
        valoresInformados: informadoPorForma,
        esperadoPorForma,
        diferencaPorForma,
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
      detalhe: { esperado, informado, diferenca, esperadoPorForma, informadoPorForma, diferencaPorForma },
    });

    if (excedeu) {
      // Ocorrência não bloqueia o fechamento (best-effort).
      await this.gerarOcorrenciaDiferenca(tenantId, atorId, {
        esperado, informado, diferenca, diferencaPorForma, limite: paraReais(limiteCent),
      }).catch(() => undefined);
    }

    return {
      esperado, informado, diferenca,
      esperadoPorForma, informadoPorForma, diferencaPorForma,
      formas, alertou: excedeu, limite: paraReais(limiteCent),
      sessao: row,
    };
  }

  // Limite de diferença (em centavos) da unidade; default R$ 5,00.
  private async limiteDiferenca(tenantId: string, unidadeId: string | null) {
    if (!unidadeId) return paraCentavos(5);
    const [u] = await this.db
      .select({ limite: unidade.limiteDiferencaCaixa })
      .from(unidade)
      .where(and(eq(unidade.id, unidadeId), eq(unidade.tenantId, tenantId)));
    return paraCentavos(u?.limite ?? 5);
  }

  // Ocorrência automática para diferença de caixa acima do limite (get-or-create
  // de um tipo de sistema "Diferença de caixa").
  private async gerarOcorrenciaDiferenca(
    tenantId: string,
    atorId: string,
    info: {
      esperado: number;
      informado: number;
      diferenca: number;
      diferencaPorForma: Record<string, number>;
      limite: number;
    },
  ) {
    let [tipo] = await this.db
      .select()
      .from(tipoOcorrencia)
      .where(and(eq(tipoOcorrencia.tenantId, tenantId), eq(tipoOcorrencia.nome, 'Diferença de caixa')));
    if (!tipo) {
      [tipo] = await this.db
        .insert(tipoOcorrencia)
        .values({ tenantId, nome: 'Diferença de caixa', sinal: 'negativo' })
        .returning();
    }
    const detalhe = Object.entries(info.diferencaPorForma)
      .filter(([, v]) => Math.abs(Number(v)) > 0.001)
      .map(([f, v]) => `${f}: ${Number(v) >= 0 ? '+' : ''}R$ ${Number(v).toFixed(2)}`)
      .join(' · ');
    await this.db.insert(ocorrencia).values({
      tenantId,
      colaboradorId: atorId,
      tipoId: tipo.id,
      autorId: atorId,
      sinal: 'negativo',
      gravidade: Math.abs(info.diferenca) > info.limite * 2 ? 'grave' : 'leve',
      descricao:
        `Diferença no fechamento de caixa: total R$ ${info.diferenca.toFixed(2)} ` +
        `(esperado R$ ${info.esperado.toFixed(2)}, contado R$ ${info.informado.toFixed(2)}).` +
        (detalhe ? ` ${detalhe}` : ''),
      setorId: null,
    });
  }

  // Relatório de fechamentos (gerente/presidente): sessões fechadas com operador e
  // diferenças, mais recentes primeiro. Filtro opcional por período (fechadaEm).
  async fechamentos(tenantId: string, inicio?: string, fim?: string) {
    const cond = [eq(caixaSessao.tenantId, tenantId), eq(caixaSessao.status, 'fechada')];
    if (inicio) cond.push(sql`${caixaSessao.fechadaEm} >= ${inicio}`);
    if (fim) cond.push(sql`${caixaSessao.fechadaEm} <= ${fim + ' 23:59:59'}`);
    return this.db
      .select({
        id: caixaSessao.id,
        origem: caixaSessao.origem,
        turnoNumero: caixaSessao.turnoNumero,
        abertaEm: caixaSessao.abertaEm,
        fechadaEm: caixaSessao.fechadaEm,
        valorAbertura: caixaSessao.valorAbertura,
        valorEsperado: caixaSessao.valorEsperado,
        valorInformado: caixaSessao.valorInformado,
        diferenca: caixaSessao.diferenca,
        esperadoPorForma: caixaSessao.esperadoPorForma,
        diferencaPorForma: caixaSessao.diferencaPorForma,
        operador: colaborador.nome,
        obs: caixaSessao.obs,
      })
      .from(caixaSessao)
      .leftJoin(colaborador, eq(colaborador.id, caixaSessao.fechadaPorId))
      .where(and(...cond))
      .orderBy(desc(caixaSessao.fechadaEm))
      .limit(300);
  }
}
