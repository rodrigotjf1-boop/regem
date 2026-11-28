import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { ehGestor } from '../../auth/niveis';
import { autorizarPorSenhaDeGestor } from '../../common/autorizacao-gestor';
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
  equipamento,
  ocorrencia,
  tipoOcorrencia,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ProducaoPedidoService } from '../producao-pedido/producao-pedido.service';
import { proximaData } from '../../common/regras-negocio';
import { uuidDeChave } from '../../common/id-deterministico';
import { sqlUnidade, condUnidade } from '../../common/filtro-unidade';
import { gorjetaComanda } from '../../common/faturamento';
import { formaDoCaixa, somarPorFormaDoCaixa } from '../../common/forma-do-caixa';
import { instanteDe } from '../../common/fuso-sql';
import { paraCentavos, paraReais, somarCentavos } from '../../util/dinheiro';
import { CreateTituloDto } from './dto/create-titulo.dto';
import { PagarTituloDto } from './dto/pagar-titulo.dto';
import { hojeISO } from '../../common/data';
import { idadeDoTurno, TURNO_LIMITE_HORAS } from '../../common/turno';
import { gravarEntitlement } from '../../common/gravar-entitlement';
import { agendadosParaDepois, baixarPendenciasAntigas, escopoDoTurno, EVENTO_CANCELADOS_NA_BAIXA, pendenciasDoTurno, TODOS_OS_AGENDADOS } from '../delivery/pendencias-turno';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Tamanho mínimo do motivo para o gestor fechar o turno do delivery com entrega pendente. */
const JUSTIFICATIVA_MINIMA = 10;
/** Gerente ou presidente da loja — o técnico de suporte NÃO entra (ele passa no @Roles como gerente). */
const gerenteOuPresidente = (perfil?: string | null) => perfil === 'gerente' || perfil === 'presidente';

@Injectable()
export class FinanceiroService {
  private readonly logger = new Logger('Financeiro');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly producao: ProducaoPedidoService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  // Nome do operador e do terminal (para os cupons de caixa). Best-effort.
  private async dadosOperadorTerminal(atorId: string, terminalId?: string | null) {
    const [op] = await this.db
      .select({ nome: colaborador.nome })
      .from(colaborador)
      .where(eq(colaborador.id, atorId));
    let terminal: string | undefined;
    if (terminalId) {
      const [t] = await this.db
        .select({ nome: equipamento.nome })
        .from(equipamento)
        .where(eq(equipamento.id, terminalId));
      terminal = t?.nome;
    }
    return { operador: op?.nome, terminal };
  }

  async listar(tenantId: string, tipo?: string, status?: string, atual: string | null = null) {
    const res: any = await this.db.execute(sql`
      select t.id, t.tipo, t.descricao, t.categoria, t.valor, t.vencimento,
             t.recorrencia, t.status, t.origem, t.foto_ref as "fotoRef",
             t.fornecedor_id as "fornecedorId",
             t.created_at as "createdAt", f.nome as "fornecedorNome"
      from titulo_financeiro t
      left join fornecedor f on f.id = t.fornecedor_id and f.tenant_id = t.tenant_id
      where t.tenant_id = ${tenantId} ${sqlUnidade('t.unidade_id', atual)}
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
    atual: string | null = null,
    // M3a: quem lança por fora da tela diz de onde veio (o Mister lança o boleto por foto com `origem: 'mister'`).
    opcoes: { origem?: string } = {},
  ) {
    await this.exigirFornecedorDaEmpresa(tenantId, dto.fornecedorId);
    const [row] = await this.db
      .insert(tituloFinanceiro)
      .values({
        tenantId,
        unidadeId: atual ?? dto.unidadeId,
        tipo: dto.tipo ?? 'pagar',
        descricao: dto.descricao,
        categoria: dto.categoria,
        fornecedorId: dto.fornecedorId,
        valor: String(dto.valor),
        vencimento: dto.vencimento,
        recorrencia: dto.recorrencia ?? 'nenhuma',
        origem: opcoes.origem ?? 'manual',
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
  /**
   * Rodada 7, MIS-I-03 (ERR-661): o fornecedor da conta é da MESMA empresa (e não apagado). O DTO só conferia o formato do id, e o
   * banco liga só pelo id: a conta com o id do fornecedor de outra empresa mostrava o nome dele na lista e no Mister.
   */
  private async exigirFornecedorDaEmpresa(tenantId: string, fornecedorId: string | null | undefined): Promise<void> {
    if (!fornecedorId) return;
    const r: any = await this.db.execute(sql`select 1 from fornecedor where id = ${fornecedorId}::uuid and tenant_id = ${tenantId}::uuid and deleted_at is null`);
    if (!(r?.rows ?? r ?? []).length) throw new BadRequestException('Fornecedor não encontrado.');
  }

  async atualizar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    id: string,
    dto: CreateTituloDto,
    atual: string | null = null,
  ) {
    const [t] = await this.db
      .select()
      .from(tituloFinanceiro)
      .where(and(eq(tituloFinanceiro.id, id), eq(tituloFinanceiro.tenantId, tenantId), condUnidade(tituloFinanceiro.unidadeId, atual)));
    if (!t) throw new NotFoundException('Título não encontrado');
    if (t.status !== 'aberto')
      throw new BadRequestException('Só é possível editar contas em aberto.');
    await this.exigirFornecedorDaEmpresa(tenantId, dto.fornecedorId);
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
      // Só a conta AINDA aberta (F-01 da revisão de 24/11/2026): a baixa que entrou entre a leitura e esta gravação faz a
      // edição ser recusada — antes, o título pago mudava de valor e de tipo com a saída do caixa já lançada.
      .where(and(eq(tituloFinanceiro.id, id), eq(tituloFinanceiro.tenantId, tenantId), eq(tituloFinanceiro.status, 'aberto')))
      .returning();
    if (!row) throw new BadRequestException('Só é possível editar contas em aberto.');
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
  async cancelar(tenantId: string, atorId: string, atorPerfil: string, id: string, atual: string | null = null) {
    const [t] = await this.db
      .select()
      .from(tituloFinanceiro)
      .where(and(eq(tituloFinanceiro.id, id), eq(tituloFinanceiro.tenantId, tenantId), condUnidade(tituloFinanceiro.unidadeId, atual)));
    if (!t) throw new NotFoundException('Título não encontrado');
    if (t.status !== 'aberto')
      throw new BadRequestException('Só é possível excluir contas em aberto.');
    // Só a conta AINDA aberta (F-01): cancelar no meio de uma baixa deixava o título cancelado com a saída no caixa — e um
    // título cancelado não se estorna pelo caminho normal.
    const [cancelou] = await this.db
      .update(tituloFinanceiro)
      .set({ status: 'cancelado' })
      .where(and(eq(tituloFinanceiro.id, id), eq(tituloFinanceiro.tenantId, tenantId), eq(tituloFinanceiro.status, 'aberto')))
      .returning({ id: tituloFinanceiro.id });
    if (!cancelou) throw new BadRequestException('Só é possível excluir contas em aberto.');
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
    atual: string | null = null,
  ) {
    return this.db.transaction(async (tx) => {
      // Uma vez só (M3a parte 4: o "Já paguei" do Mister e a tela chamam este mesmo método): a troca condicional
      // "aberto" → "pago" vem ANTES do lançamento. Dois pedidos ao mesmo tempo: o segundo espera a trava da linha, relê
      // a situação e não acha mais "aberto" — nada lança (antes, os dois liam "aberto" e lançavam a saída duas vezes).
      const [t] = await tx
        .update(tituloFinanceiro)
        .set({ status: 'pago' })
        .where(
          and(
            eq(tituloFinanceiro.id, id),
            eq(tituloFinanceiro.tenantId, tenantId),
            condUnidade(tituloFinanceiro.unidadeId, atual),
            eq(tituloFinanceiro.status, 'aberto'),
          ),
        )
        .returning();
      if (!t) {
        const [existe] = await tx
          .select({ id: tituloFinanceiro.id })
          .from(tituloFinanceiro)
          .where(and(eq(tituloFinanceiro.id, id), eq(tituloFinanceiro.tenantId, tenantId), condUnidade(tituloFinanceiro.unidadeId, atual)));
        if (!existe) throw new NotFoundException('Título não encontrado');
        throw new BadRequestException('Título não está aberto');
      }

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

      // Recorrência: gera o próximo título em aberto. O id nasce deste título e do vencimento: pagar, estornar e pagar de
      // novo acha a próxima que já existe, em vez de criar outra (ERR-566).
      const prox = proximaData(t.vencimento, t.recorrencia);
      if (prox) {
        await tx
          .insert(tituloFinanceiro)
          .values({
            id: uuidDeChave('titulo-recorrente', t.id, prox),
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
          })
          .onConflictDoNothing({ target: tituloFinanceiro.id });
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
    atual: string | null = null,
  ) {
    return this.db.transaction(async (tx) => {
      // Uma vez só: a troca condicional "pago" → "aberto" vem ANTES do lançamento inverso. O segundo pedido ao mesmo
      // tempo não acha mais "pago" e nada lança (antes, os dois achavam o mesmo pagamento e o estornavam duas vezes).
      const [reaberto] = await tx
        .update(tituloFinanceiro)
        .set({ status: 'aberto' })
        .where(
          and(
            eq(tituloFinanceiro.id, id),
            eq(tituloFinanceiro.tenantId, tenantId),
            condUnidade(tituloFinanceiro.unidadeId, atual),
            eq(tituloFinanceiro.status, 'pago'),
          ),
        )
        .returning({ id: tituloFinanceiro.id });
      if (!reaberto) throw new BadRequestException('Esta conta não está paga: não há o que estornar.');
      const [lanc] = await tx
        .select()
        .from(lancamentoCaixa)
        .where(
          and(
            eq(lancamentoCaixa.tituloId, id),
            eq(lancamentoCaixa.tenantId, tenantId),
            condUnidade(lancamentoCaixa.unidadeId, atual),
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
  async resumo(tenantId: string, atual: string | null = null) {
    const r: any = await this.db.execute(sql`
      select
        coalesce(sum(case when tipo='pagar' and status='aberto' then valor else 0 end),0) as "aPagar",
        coalesce(sum(case when tipo='receber' and status='aberto' then valor else 0 end),0) as "aReceber"
      from titulo_financeiro where tenant_id=${tenantId} ${sqlUnidade('unidade_id', atual)}
    `);
    const c: any = await this.db.execute(sql`
      select coalesce(sum(case when tipo='entrada' then valor else -valor end),0) as "saldoCaixa"
      from lancamento_caixa where tenant_id=${tenantId} ${sqlUnidade('unidade_id', atual)}
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
  async fluxoCaixa(tenantId: string, dias = 30, atual: string | null = null) {
    const c: any = await this.db.execute(sql`
      select coalesce(sum(case when tipo='entrada' then valor else -valor end),0) as saldo
      from lancamento_caixa where tenant_id=${tenantId} ${sqlUnidade('unidade_id', atual)}
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
        and vencimento <= ${limite} ${sqlUnidade('unidade_id', atual)}
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
  async dreCaixa(tenantId: string, inicio: string, fim: string, atual: string | null = null) {
    // Exclui os estornos (estorno_de not null) E os lançamentos que foram
    // estornados (id referenciado por algum estorno) — assim reversões não
    // contam como receita/despesa na DRE.
    const estornados = sql`
      select estorno_de from lancamento_caixa
      where tenant_id=${tenantId} and estorno_de is not null
    `;
    // Sangria e suprimento só mudam o dinheiro de lugar (gaveta ↔ cofre): não são receita nem despesa (F-02 da revisão de
    // 24/11/2026 — antes, um suprimento de R$ 100 e uma sangria de R$ 60 davam R$ 40 de "resultado").
    const naoInterno = sql`coalesce(categoria, '') not in ('sangria', 'suprimento')`;
    const entradas = sql`
      from lancamento_caixa
      where tenant_id=${tenantId} and tipo='entrada' and estorno_de is null and ${naoInterno}
        and id not in (${estornados})
        and data between ${inicio} and ${fim} ${sqlUnidade('unidade_id', atual)}`;
    const rec: any = await this.db.execute(sql`select coalesce(sum(valor),0) as v ${entradas}`);
    // A gorjeta (taxa de serviço) entra no caixa junto com a venda, mas é repasse ao funcionário, não receita
    // (`common/faturamento.ts`): sai das receitas e aparece à parte — a de cada comanda uma vez, mesmo dividida em formas.
    // Só a gorjeta que ENTROU (PDV-F-02 da revisão de 25/11/2026): proporcional ao recebido da comanda no período, até o total
    // dela. O acerto do salão baixado com R$ 0 (quebra do garçom) deduzia a gorjeta inteira e a receita ficava negativa.
    const gorj: any = await this.db.execute(sql`
      select coalesce(sum(case when c.total > 0 then ${gorjetaComanda('c')} * least(1, e.recebido / c.total) else 0 end), 0) as v
        from (select comanda_id, sum(valor) as recebido ${entradas} and comanda_id is not null group by comanda_id) e
        join comanda c on c.id = e.comanda_id and c.tenant_id = ${tenantId}`);
    const desp: any = await this.db.execute(sql`
      select coalesce(categoria,'outros') as categoria, coalesce(sum(valor),0) as v
      from lancamento_caixa
      where tenant_id=${tenantId} and tipo='saida' and estorno_de is null and ${naoInterno}
        and id not in (${estornados})
        and data between ${inicio} and ${fim} ${sqlUnidade('unidade_id', atual)}
      group by coalesce(categoria,'outros')
      order by v desc
    `);
    const gorjeta = Number((gorj.rows ?? gorj)[0].v);
    const receitas = Number((Number((rec.rows ?? rec)[0].v) - gorjeta).toFixed(2));
    const despesas = (desp.rows ?? desp).map((d: any) => ({
      categoria: d.categoria,
      valor: Number(d.v),
    }));
    const totalDespesas = despesas.reduce((s: number, d: any) => s + d.valor, 0);
    return {
      periodo: { inicio, fim },
      receitas,
      // Repasse ao funcionário que passou pelo caixa — fora das receitas e do resultado.
      gorjeta: Number(gorjeta.toFixed(2)),
      despesas,
      totalDespesas,
      resultado: Number((receitas - totalDespesas).toFixed(2)),
    };
  }

  // ===== Caixa (J5) =====
  // Resolve a unidade de um terminal de PDV (equipamento tipo='pdv', ativo, do tenant).
  private async unidadeDoTerminal(
    tenantId: string,
    terminalId: string,
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ unidadeId: equipamento.unidadeId })
      .from(equipamento)
      .where(
        and(
          eq(equipamento.id, terminalId),
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.tipo, 'pdv'),
          eq(equipamento.ativo, true),
        ),
      );
    return row?.unidadeId ?? null;
  }

  // origem separa a gaveta do balcão (pdv) da gaveta do delivery. No balcão a
  // sessão é POR TERMINAL (cada caixa físico tem a sua); no delivery é uma só.
  async sessaoAberta(tenantId: string, origem = 'pdv', terminalId?: string | null) {
    const conds = [
      eq(caixaSessao.tenantId, tenantId),
      eq(caixaSessao.status, 'aberta'),
      eq(caixaSessao.origem, origem),
    ];
    if (origem !== 'delivery') {
      conds.push(
        terminalId
          ? eq(caixaSessao.terminalId, terminalId)
          : isNull(caixaSessao.terminalId),
      );
    }
    const [s] = await this.db.select().from(caixaSessao).where(and(...conds));
    return s ?? null;
  }

  async abrirSessao(
    tenantId: string,
    atorId: string,
    dto: { valorAbertura?: number; origem?: string; terminalId?: string | null },
  ) {
    const origem = dto.origem === 'delivery' ? 'delivery' : 'pdv';
    // Balcão exige terminal pareado (F1); a unidade da sessão deriva do terminal.
    let terminalId: string | null = null;
    let unidadeId: string | null = null;
    if (origem !== 'delivery') {
      terminalId = dto.terminalId ?? null;
      if (!terminalId)
        throw new BadRequestException(
          'Terminal de PDV não pareado neste computador.',
        );
      unidadeId = await this.unidadeDoTerminal(tenantId, terminalId);
      if (unidadeId === null && terminalId)
        throw new BadRequestException('Terminal inválido ou inativo.');
    }
    // Conferir "já tem caixa aberto", numerar o turno e gravar numa transação, com a empresa travada (C-06 da revisão de
    // 24/11/2026): sem isso, dois toques em "Abrir" (ou dois terminais juntos) liam "nenhum aberto" e o mesmo número de
    // turno, e abriam dois caixas no mesmo terminal — as vendas se dividiam entre eles. `for no key update` não espera as
    // gravações que só apontam para a empresa (a chave estrangeira pede `for key share`): só outra abertura espera.
    return this.db.transaction(async (tx: any) => {
      await tx.execute(sql`select id from empresa where id = ${tenantId} for no key update`);
      const condAberta = [
        eq(caixaSessao.tenantId, tenantId),
        eq(caixaSessao.status, 'aberta'),
        eq(caixaSessao.origem, origem),
        ...(origem !== 'delivery' ? [terminalId ? eq(caixaSessao.terminalId, terminalId) : isNull(caixaSessao.terminalId)] : []),
      ];
      const [aberta] = await tx.select({ id: caixaSessao.id }).from(caixaSessao).where(and(...condAberta));
      if (aberta) throw new BadRequestException('Já existe um caixa aberto neste terminal.');
      // Nº do turno = sequencial por dia (fuso SP), por origem: 1º caixa do dia = Turno 1.
      const tn: any = await tx.execute(sql`
        select coalesce(max(turno_numero), 0) + 1 as n from caixa_sessao
        where tenant_id = ${tenantId} and origem = ${origem}
          and (aberta_em at time zone 'America/Sao_Paulo')::date
              = (now() at time zone 'America/Sao_Paulo')::date`);
      const turnoNumero = Number((tn.rows ?? tn)[0].n) || 1;
      const [s] = await tx
        .insert(caixaSessao)
        .values({
          tenantId,
          unidadeId,
          terminalId,
          origem,
          turnoNumero,
          valorAbertura: String(dto.valorAbertura ?? 0),
          abertaPorId: atorId,
        })
        .returning();
      return s;
    });
  }

  // Caixa aberto + nome do operador (p/ o PDV mostrar "Turno N · Operador X").
  async caixaAtual(tenantId: string, origem = 'pdv', terminalId?: string | null) {
    const s = await this.sessaoAberta(tenantId, origem, terminalId);
    if (!s) return null;
    let operadorNome: string | null = null;
    if (s.abertaPorId) {
      const [c] = await this.db
        .select({ nome: colaborador.nome })
        .from(colaborador)
        .where(eq(colaborador.id, s.abertaPorId));
      operadorNome = c?.nome ?? null;
    }
    // Há quanto tempo o turno está aberto, pelo relógio do servidor: passou de 24 h, a tela pede o fechamento (pedido do
    // dono, 12/11/2026 — `common/turno.ts`).
    return { ...s, operadorNome, ...idadeDoTurno(s.abertaEm), limiteHoras: TURNO_LIMITE_HORAS };
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
    await gravarEntitlement(this.db, tenantId, 'pdv_caixa_livre', ativo); // dois salvamentos juntos: ERR-391
    return { caixaLivre: ativo };
  }

  // ===== Formas de pagamento (cadastro) =====
  private static readonly FORMAS_PADRAO = [
    { nome: 'Dinheiro', tipo: 'dinheiro' },
    { nome: 'Cartão de crédito', tipo: 'credito' },
    { nome: 'Cartão de débito', tipo: 'debito' },
    { nome: 'Pix', tipo: 'pix' },
    { nome: 'Vale refeição', tipo: 'vr' },
    { nome: 'Vale alimentação', tipo: 'vr' },
    { nome: 'Transferência', tipo: 'outro' },
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

  // Normaliza os campos ricos vindos do dto (compartilhado por criar/atualizar).
  private valsForma(dto: any) {
    const tipos = ['dinheiro', 'pix', 'credito', 'debito', 'vr', 'outro'];
    const tiposPed = ['delivery', 'retirada', 'balcao'];
    const vals: Record<string, unknown> = {};
    if (dto.nome != null) vals.nome = String(dto.nome).trim();
    if (dto.tipo != null) vals.tipo = tipos.includes(dto.tipo) ? dto.tipo : 'outro';
    if (dto.ativo != null) vals.ativo = !!dto.ativo;
    if (dto.cardapio != null) vals.cardapio = !!dto.cardapio;
    if (dto.tiposPedido != null)
      vals.tiposPedido = Array.isArray(dto.tiposPedido)
        ? dto.tiposPedido.filter((t: string) => tiposPed.includes(t))
        : [];
    if (dto.taxaExtra !== undefined)
      vals.taxaExtra = dto.taxaExtra === '' || dto.taxaExtra == null ? null : String(Number(dto.taxaExtra) || 0);
    if (dto.obs !== undefined) vals.obs = dto.obs?.trim() || null;
    if (dto.bandeiras != null) vals.bandeiras = Array.isArray(dto.bandeiras) ? dto.bandeiras : [];
    return vals;
  }

  async criarFormaPagamento(tenantId: string, dto: any) {
    if (!dto.nome?.trim()) throw new BadRequestException('Informe o nome.');
    const [row] = await this.db
      .insert(formaPagamento)
      .values({ tenantId, ...this.valsForma(dto) } as any)
      .returning();
    return row;
  }

  async atualizarFormaPagamento(tenantId: string, id: string, dto: any) {
    const vals = this.valsForma(dto);
    if (Object.keys(vals).length === 0) throw new BadRequestException('Nada para atualizar.');
    const [row] = await this.db
      .update(formaPagamento)
      .set(vals)
      .where(and(eq(formaPagamento.id, id), eq(formaPagamento.tenantId, tenantId)))
      .returning();
    if (!row) throw new BadRequestException('Forma não encontrada.');
    return row;
  }

  async removerFormaPagamento(tenantId: string, id: string) {
    const [row] = await this.db
      .delete(formaPagamento)
      .where(and(eq(formaPagamento.id, id), eq(formaPagamento.tenantId, tenantId)))
      .returning();
    if (!row) throw new BadRequestException('Forma não encontrada.');
    return { ok: true };
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

  // A sangria de quem tem este perfil pede a senha de quem libera? (`sangria_pede_senha`, ligada pelo presidente em
  // Acessos & perfis). Lida do perfil ATUAL — desligar ou ligar a chave vale na próxima sangria, sem novo login.
  private async sangriaPedeSenha(tenantId: string, atorId: string): Promise<boolean> {
    const r: any = await this.db.execute(sql`
      select (p.permissoes ->> 'sangria_pede_senha') = 'true' as pede
        from colaborador c
        join perfil_acesso p on p.id = c.perfil_acesso_id
       where c.tenant_id = ${tenantId} and c.id = ${atorId}`);
    return (r.rows ?? r)[0]?.pede === true;
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
      terminalId?: string | null;
      senhaAutorizacao?: string | null; // a de quem libera, quando o perfil pede (sangria)
    },
  ) {
    // SANGRIA DO PERFIL QUE PEDE SENHA (decisão do dono, 23/10/2026): só com a senha de quem libera (presidente, gerente
    // ou supervisão, com acesso), e quem liberou vai para o comprovante e a auditoria. Sem a chave no perfil, como sempre:
    // o gestor, ou o caixa quando o presidente deixou o caixa livre. O presidente nunca é travado pela chave.
    let liberou: { id: string; nome: string } | null = null;
    if (dto.tipo === 'sangria' && atorPerfil !== 'presidente' && (await this.sangriaPedeSenha(tenantId, atorId))) {
      liberou = await autorizarPorSenhaDeGestor(this.db, tenantId, dto.senhaAutorizacao);
    } else if (!ehGestor(atorPerfil) && !(await this.caixaLivre(tenantId))) {
      // Autorização: atendente só sangra/supre se o presidente liberou.
      throw new ForbiddenException(
        'Sangria/suprimento requer autorização de um gerente.',
      );
    }
    if (!(Number(dto.valor) > 0))
      throw new BadRequestException('Informe um valor válido.');
    const s = await this.sessaoAberta(
      tenantId,
      dto.origem === 'delivery' ? 'delivery' : 'pdv',
      dto.terminalId,
    );
    if (!s) throw new BadRequestException('Nenhum caixa aberto.');
    this.exigeDonoDoTurno(s, atorId, atorPerfil);
    // O lançamento entra com o caixa TRAVADO e ainda aberto (C-01 da revisão de 24/11/2026): antes, o caixa era lido
    // fora de transação e o lançamento podia cair num caixa que fechou no meio, fora do esperado do fechamento. O
    // fechamento trava com `for update`; aqui `for share` (o suprimento não espera outra venda) e, na sangria,
    // `for no key update` — duas sangrias juntas passam uma de cada vez, e a segunda enxerga a primeira no esperado.
    const sangria = dto.tipo === 'sangria';
    const valorCent = paraCentavos(dto.valor);
    const esperadoNaGaveta = await this.db.transaction(async (tx: any) => {
      const trava: any = await tx.execute(
        sangria
          ? sql`select id from caixa_sessao where id = ${s.id} and status = 'aberta' for no key update`
          : sql`select id from caixa_sessao where id = ${s.id} and status = 'aberta' for share`,
      );
      if (!(trava.rows ?? trava).length) throw new BadRequestException('Nenhum caixa aberto.');
      // O dinheiro que o sistema espera na gaveta antes da sangria (a mesma conta do fechamento: abertura + dinheiro).
      let esperadoCent: number | null = null;
      if (sangria) {
        // O dinheiro pela chave de conferência (PDV-C-01): a venda do balcão grava "Dinheiro", não "dinheiro".
        const d: any = await tx.execute(sql`
          select forma, coalesce(sum(case when tipo = 'entrada' then valor else -valor end), 0) as mov
            from lancamento_caixa where sessao_id = ${s.id} group by forma`);
        const movDinheiro = (d.rows ?? d)
          .filter((x: any) => formaDoCaixa(x.forma) === 'dinheiro')
          .reduce((soma: number, x: any) => somarCentavos(soma, paraCentavos(x.mov)), 0);
        esperadoCent = somarCentavos(movDinheiro, paraCentavos(s.valorAbertura));
      }
      await tx.insert(lancamentoCaixa).values({
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
      return esperadoCent;
    });
    // Sangria acima do dinheiro esperado (C-04): entra (a contagem é cega — recusar diria ao operador quanto o sistema
    // espera), mas fica marcada na auditoria com o esperado, para o gestor achar o erro de digitação antes do fechamento.
    const acimaDoEsperado = esperadoNaGaveta != null && valorCent > esperadoNaGaveta;
    if (acimaDoEsperado)
      this.logger.warn(`caixa ${s.id}: sangria acima do dinheiro esperado na gaveta`);
    // Toda sangria e suprimento na auditoria, com quem liberou quando o perfil pediu a senha.
    await this.auditoria.registrar({
      tenantId,
      unidadeId: s.unidadeId ?? null,
      atorId,
      atorPerfil,
      tipo: 'caixa',
      acao: dto.tipo,
      entidadeTipo: 'caixa_sessao',
      entidadeId: s.id,
      detalhe: {
        valor: Number(dto.valor),
        motivo: dto.descricao ?? null,
        ...(liberou ? { autorizadoPor: liberou.nome, autorizadoPorId: liberou.id } : {}),
        ...(esperadoNaGaveta != null ? { esperadoNaGaveta: paraReais(esperadoNaGaveta), acimaDoEsperado } : {}),
      },
      origem: 'web',
    });
    // Comprovante de sangria/suprimento (Fase 3). A falha não desfaz a operação, mas volta na resposta (antes era
    // engolida em silêncio): a tela avisa que o papel não saiu.
    let comprovante: { enfileirados: number; aviso: string | null };
    try {
      const { operador, terminal } = await this.dadosOperadorTerminal(atorId, dto.terminalId);
      comprovante = await this.producao.imprimirCupomCaixa(tenantId, s.unidadeId, dto.terminalId ?? null, dto.tipo, {
        tipoMovimento: dto.tipo === 'sangria' ? 'SANGRIA' : 'SUPRIMENTO',
        valorMovimento: Number(dto.valor),
        motivo: dto.descricao,
        operador,
        terminal,
        turno: (s as any).turnoNumero,
        autorizadoPor: liberou?.nome,
      });
    } catch (e: any) {
      this.logger.warn(`caixa ${s.id}: o comprovante de ${dto.tipo} não saiu (${e?.message ?? e})`);
      comprovante = { enfileirados: 0, aviso: `O comprovante de ${dto.tipo} não foi impresso.` };
    }
    return { ok: true, comprovante };
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

  // ===== Pendências do turno (pedidos ainda não baixados na hora de fechar) =====
  // O que a tela de fechar mostra ANTES da contagem: as entregas (turno do delivery) ou as
  // retiradas (turno do balcão) que ainda não foram concluídas nem canceladas.
  // A loja das pendências de um turno. O caixa do DELIVERY é um para a empresa inteira (`abrirSessao`, `sessaoAberta`):
  // quem o fecha responde pelas entregas de TODAS as lojas, então a lista, a baixa e a trava do fechamento olham a empresa
  // (C-03 da revisão de 24/11/2026 — antes, a entrega pendente de outra loja ficava fora). O do balcão é do terminal: a loja.
  private lojaDasPendencias(escopo: 'delivery' | 'pdv', unidadeAtual: string | null): string | null {
    return escopo === 'delivery' ? null : unidadeAtual;
  }

  async pendenciasDoTurno(tenantId: string, unidadeAtual: string | null, origem: string | undefined, atorPerfil: string) {
    const escopo = escopoDoTurno(origem);
    const loja = this.lojaDasPendencias(escopo, unidadeAtual);
    const [p, agendados] = await Promise.all([
      pendenciasDoTurno(this.db, tenantId, loja, escopo),
      // G8 (mig 455): no turno do delivery, os pedidos agendados para depois — a tela pergunta um por um.
      escopo === 'delivery' ? agendadosParaDepois(this.db, tenantId, loja) : Promise.resolve([]),
    ]);
    return {
      ...p,
      agendados,
      // delivery: pendência barra o fechamento; balcão: só avisa.
      bloqueia: escopo === 'delivery' && p.total > 0,
      // quem pode fechar o delivery justificando e quem pode baixar as antigas.
      gestor: gerenteOuPresidente(atorPerfil),
      justificativaMinima: JUSTIFICATIVA_MINIMA,
    };
  }

  // Baixa administrativa das pendências antigas (ver `pendencias-turno.ts`): um clique do
  // gerente/presidente, auditado. Não mexe em estoque, caixa nem canal; o pedido cancelado (nunca aceito) devolve ao
  // cliente o cashback e os pontos, como todo cancelamento (o delivery estorna, pelo evento).
  async baixarPendenciasAntigas(tenantId: string, atorId: string, atorPerfil: string, unidadeAtual: string | null, origem: string | undefined) {
    if (!gerenteOuPresidente(atorPerfil)) throw new ForbiddenException('Só gerente ou presidente baixa as pendências antigas.');
    const escopo = escopoDoTurno(origem);
    const r = await baixarPendenciasAntigas(this.db, tenantId, this.lojaDasPendencias(escopo, unidadeAtual), escopo);
    if (r.canceladosComCliente.length) this.events?.emit(EVENTO_CANCELADOS_NA_BAIXA, { tenantId, pedidos: r.canceladosComCliente });
    if (r.concluidos + r.cancelados > 0) {
      await this.auditoria.registrar({
        tenantId,
        atorId,
        atorPerfil,
        tipo: 'delivery',
        acao: 'baixou_pendencias_antigas',
        entidadeTipo: 'pedido_externo',
        unidadeId: unidadeAtual,
        detalhe: {
          escopo,
          concluidos: r.concluidos,
          cancelados: r.cancelados,
          porCanal: r.porCanal,
          // a lista inteira não cabe no registro quando são centenas: os 200 primeiros e a contagem
          pedidos: r.ids.slice(0, 200),
          semEfeitos: 'não baixou estoque, não lançou no caixa, não avisou canal nem cliente; o cancelado devolveu cashback e pontos',
        },
      });
    }
    return { concluidos: r.concluidos, cancelados: r.cancelados, porCanal: r.porCanal, pendencias: await this.pendenciasDoTurno(tenantId, unidadeAtual, origem, atorPerfil) };
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
      terminalId?: string | null;
      /** Loja selecionada por quem fecha (o caixa do delivery é da empresa; os pedidos são da loja). */
      unidadeAtual?: string | null;
      /** Só gerente/presidente: o motivo de fechar o turno do delivery com entrega pendente. */
      justificativaPendencias?: string;
      /** G8 (mig 455): os pedidos agendados para depois que a pessoa decidiu manter (os ids). */
      agendadosMantidos?: string[];
      /** O turno que a tela mostrou ao contar (PDV-C-03): a contagem só fecha ESTE turno. */
      sessaoId?: string | null;
    },
  ) {
    const s = await this.sessaoAberta(
      tenantId,
      dto.origem === 'delivery' ? 'delivery' : 'pdv',
      dto.terminalId,
    );
    // A contagem é do turno que a tela mostrou (PDV-C-03 da revisão de 25/11/2026): a confirmação atrasada de outra aba,
    // chegando depois de o turno A fechar e o B abrir, fechava o B com a contagem do A. Agora ela é recusada e o B segue aberto.
    if (dto.sessaoId && (!s || s.id !== dto.sessaoId))
      throw new ConflictException({ message: 'Este turno já foi fechado. Atualize a tela para ver o turno aberto agora.', code: 'CAIXA_JA_FECHADO', codigo: 'CAIXA_JA_FECHADO' });
    if (!s) throw new BadRequestException('Nenhum caixa aberto.');
    // Chamada sem os valores contados (corpo vazio/malformado) FECHAVA o caixa como se tivessem
    // contado R$ 0 — reproduzido (set/2026): diferença de −R$ 283,40 registrada. O PDV sempre
    // manda `valoresInformados` (mesmo vazio, no fechamento sem contagem).
    if (dto?.valoresInformados == null && dto?.valorInformado == null)
      throw new BadRequestException('Informe os valores contados (valoresInformados).');
    this.exigeDonoDoTurno(s, atorId, atorPerfil);

    // Turno do DELIVERY só fecha sem entrega pendente (decisão do dono, 02/10/2026). O operador é
    // barrado; gerente e presidente podem fechar mesmo assim ESCREVENDO o motivo, que vai para a
    // auditoria — sem isso, um pedido preso deixaria o caixa aberto para sempre. O balcão não é
    // barrado aqui: lá a tela só avisa das retiradas pendentes antes de fechar.
    let fechouComPendencias: { total: number; justificativa: string; pedidos: string[] } | null = null;
    if (s.origem === 'delivery') {
      const pend = await pendenciasDoTurno(this.db, tenantId, this.lojaDasPendencias('delivery', dto.unidadeAtual ?? null), 'delivery');
      if (pend.total > 0) {
        const n = pend.total === 1 ? 'Há 1 entrega pendente' : `Há ${pend.total} entregas pendentes`;
        if (!gerenteOuPresidente(atorPerfil))
          throw new ConflictException({
            message: `${n}. Conclua ou cancele os pedidos antes de fechar o turno do delivery — ou chame um gerente.`,
            codigo: 'PENDENCIAS_DO_TURNO',
            total: pend.total,
          });
        const justificativa = String(dto.justificativaPendencias ?? '').replace(/\s+/g, ' ').trim();
        if (justificativa.length < JUSTIFICATIVA_MINIMA)
          throw new ConflictException({
            message: `${n}. Para fechar mesmo assim, escreva o motivo (pelo menos ${JUSTIFICATIVA_MINIMA} letras).`,
            codigo: 'PENDENCIAS_DO_TURNO_JUSTIFICAR',
            total: pend.total,
          });
        fechouComPendencias = { total: pend.total, justificativa: justificativa.slice(0, 300), pedidos: pend.itens.slice(0, 50).map((p) => p.id) };
      }
      // G8 (mig 455): os pedidos AGENDADOS para depois — o turno não fecha sem a resposta de cada um. "Manter" vem na lista
      // `agendadosMantidos`; mudar o horário ou cancelar tira o pedido da lista antes. Vale para todos (é uma pergunta,
      // não uma pendência a justificar).
      // TODOS: com mais de 100 agendados, o corte da tela deixava o 101º passar sem resposta (C-03, 2ª volta).
      const agendados = await agendadosParaDepois(this.db, tenantId, this.lojaDasPendencias('delivery', dto.unidadeAtual ?? null), new Date(), TODOS_OS_AGENDADOS);
      const mantidos = new Set(Array.isArray(dto.agendadosMantidos) ? dto.agendadosMantidos.map(String) : []);
      const faltam = agendados.filter((a) => !mantidos.has(a.id));
      if (faltam.length)
        throw new ConflictException({
          message:
            faltam.length === 1
              ? 'Há 1 pedido agendado para depois. Diga se ele fica (manter), muda de horário ou é cancelado antes de fechar o turno.'
              : `Há ${faltam.length} pedidos agendados para depois. Diga se cada um fica (manter), muda de horário ou é cancelado antes de fechar o turno.`,
          codigo: 'AGENDADOS_DO_TURNO',
          agendados: faltam,
        });
    }

    // Esperado por forma = movimentos (entrada − saída) da sessão agrupados por
    // forma; sangrias/suprimentos já são lançamentos, então entram naturalmente.
    // A abertura conta como dinheiro (gaveta).
    // TUDO com o caixa travado (C-01 e C-02 da revisão de 24/11/2026). `for update` espera as vendas, sangrias e
    // recebimentos que estão gravando neste caixa (eles o travam com `for share`/`for key share`) e faz os que chegarem
    // depois esperarem o fechamento terminar — aí eles releem, veem "fechada" e recusam. Antes, a soma vinha de uma
    // leitura solta: o lançamento gravado no meio ficava fora do esperado (e dentro de um caixa já fechado), e dois
    // fechamentos juntos gravavam os dois, valendo a contagem do último, com duas auditorias e dois comprovantes.
    const limiteCent = await this.limiteDiferenca(tenantId, s.unidadeId);
    // Contado por forma (compat: só valorInformado = dinheiro), pela chave de conferência — a mesma do que entrou (PDV-C-01).
    const informadosCrus: Record<string, number> =
      dto.valoresInformados ??
      (dto.valorInformado != null ? { dinheiro: dto.valorInformado } : {});
    const informados: Record<string, number> = {};
    for (const [f, v] of Object.entries(informadosCrus)) {
      const k = formaDoCaixa(f);
      informados[k] = paraReais(somarCentavos(paraCentavos(informados[k] ?? 0), paraCentavos(v)));
    }
    const fechou = await this.db.transaction(async (tx: any) => {
      const trava: any = await tx.execute(sql`select id from caixa_sessao where id = ${s.id} and status = 'aberta' for update`);
      if (!(trava.rows ?? trava).length)
        throw new ConflictException({ message: 'Este caixa acabou de ser fechado (outro fechamento terminou antes).', code: 'CAIXA_JA_FECHADO', codigo: 'CAIXA_JA_FECHADO' });
      const rf: any = await tx.execute(sql`
        select coalesce(forma,'dinheiro') as forma,
               coalesce(sum(case when tipo='entrada' then valor else -valor end),0) as mov
        from lancamento_caixa where sessao_id=${s.id}
        group by coalesce(forma,'dinheiro')`);
      const crus: Record<string, number> = {};
      for (const x of rf.rows ?? rf) crus[x.forma] = paraCentavos(x.mov);
      // "Dinheiro" (venda do balcão) e "dinheiro" (delivery, sangria) são a mesma linha (PDV-C-01).
      const espCent = somarPorFormaDoCaixa(crus);
      espCent['dinheiro'] = somarCentavos(espCent['dinheiro'] ?? 0, paraCentavos(s.valorAbertura));

      const formas = Array.from(new Set([...Object.keys(espCent), ...Object.keys(informados)])).sort();
      const esperadoPorForma: Record<string, number> = {};
      const informadoPorForma: Record<string, number> = {};
      const diferencaPorForma: Record<string, number> = {};
      let totEspCent = 0;
      let totInfCent = 0;
      let excedeu = false;
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

      const [row] = await tx
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
        .where(and(eq(caixaSessao.id, s.id), eq(caixaSessao.status, 'aberta')))
        .returning();
      if (!row)
        throw new ConflictException({ message: 'Este caixa acabou de ser fechado (outro fechamento terminou antes).', code: 'CAIXA_JA_FECHADO', codigo: 'CAIXA_JA_FECHADO' });
      return { row, formas, esperadoPorForma, informadoPorForma, diferencaPorForma, esperado, informado, diferenca, excedeu };
    });
    const { row, formas, esperadoPorForma, informadoPorForma, diferencaPorForma, esperado, informado, diferenca, excedeu } = fechou;

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
    if (fechouComPendencias) {
      await this.auditoria.registrar({
        tenantId,
        atorId,
        atorPerfil,
        tipo: 'financeiro',
        acao: 'fechou_turno_com_pendencias',
        entidadeTipo: 'caixa_sessao',
        entidadeId: s.id,
        detalhe: fechouComPendencias,
      });
    }

    if (excedeu) {
      // Ocorrência não bloqueia o fechamento (best-effort).
      await this.gerarOcorrenciaDiferenca(tenantId, atorId, {
        esperado, informado, diferenca, diferencaPorForma, limite: paraReais(limiteCent),
      }).catch(() => undefined);
    }

    // Cupom de fechamento (Fase 3) — best-effort.
    try {
      const { operador, terminal } = await this.dadosOperadorTerminal(atorId, dto.terminalId);
      const mov: any = await this.db.execute(sql`
        select coalesce(sum(case when categoria='sangria' then valor else 0 end),0) as sangrias,
               coalesce(sum(case when categoria='suprimento' then valor else 0 end),0) as suprimentos
        from lancamento_caixa where sessao_id=${s.id}`);
      const mr = (mov.rows ?? mov)[0] ?? {};
      const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
      await this.producao.imprimirCupomCaixa(tenantId, s.unidadeId, dto.terminalId ?? null, 'fechamento', {
        tipoMovimento: 'FECHAMENTO DE CAIXA',
        operador,
        terminal,
        turno: (s as any).turnoNumero,
        aberturaValor: Number(s.valorAbertura),
        totalPorForma: formas.map((f) => `${f}: ${brl(esperadoPorForma[f] ?? 0)}`),
        sangriasTotal: Number(mr.sangrias) || 0,
        suprimentosTotal: Number(mr.suprimentos) || 0,
        esperado,
        informado,
        diferenca,
      });
    } catch {
      /* impressão é best-effort */
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
      data: hojeISO(),
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
  async fechamentos(tenantId: string, inicio?: string, fim?: string, atual: string | null = null) {
    const cond = [eq(caixaSessao.tenantId, tenantId), eq(caixaSessao.status, 'fechada')];
    const cu = condUnidade(caixaSessao.unidadeId, atual);
    if (cu) cond.push(cu);
    // O dia da operação (fuso da loja) até o último microssegundo — como os relatórios (G-02, ERR-120): antes o texto cru
    // era lido no fuso da sessão do banco (UTC na nuvem) e o corte em 23:59:59 perdia o fim do dia.
    if (inicio) cond.push(sql`${caixaSessao.fechadaEm} >= ${instanteDe(`${inicio.slice(0, 10)} 00:00:00`)}`);
    if (fim) cond.push(sql`${caixaSessao.fechadaEm} <= ${instanteDe(`${fim.slice(0, 10)} 23:59:59.999999`)}`);
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

  // ===== Verificador de reconciliação (P3) =====
  // NÃO recalcula nem corrige o fechamento — apenas RECOMPUTA o esperado por forma
  // a partir do ledger imutável (lancamento_caixa, append-only) e COMPARA com o que
  // ficou gravado na sessão no fechamento. Divergência = ledger foi mexido depois,
  // linha sumiu no sync, ou bug de cálculo. Se divergir, registra alerta em auditoria
  // (append-only). Só leitura + alerta; jamais muta a sessão. Presidente/C&O dispara.
  async reconciliarSessao(tenantId: string, sessaoId: string, atorId: string) {
    const [s] = await this.db
      .select()
      .from(caixaSessao)
      .where(and(eq(caixaSessao.id, sessaoId), eq(caixaSessao.tenantId, tenantId)));
    if (!s) throw new BadRequestException('Sessão de caixa não encontrada.');
    if (s.status !== 'fechada')
      throw new BadRequestException('Só é possível reconciliar uma sessão já fechada.');

    // Recompute idêntico ao fecharSessao: (entrada − saída) por forma + abertura em dinheiro.
    const rf: any = await this.db.execute(sql`
      select coalesce(forma,'dinheiro') as forma,
             coalesce(sum(case when tipo='entrada' then valor else -valor end),0) as mov
      from lancamento_caixa where sessao_id=${s.id}
      group by coalesce(forma,'dinheiro')`);
    const recalcCrus: Record<string, number> = {};
    for (const x of rf.rows ?? rf) recalcCrus[x.forma] = paraCentavos(x.mov);
    // Pela chave de conferência dos dois lados (PDV-C-01): o fechamento antigo gravou "Dinheiro" e "dinheiro" separados.
    const recalcCent = somarPorFormaDoCaixa(recalcCrus);
    recalcCent['dinheiro'] = somarCentavos(recalcCent['dinheiro'] ?? 0, paraCentavos(s.valorAbertura));

    // Gravado no fechamento (jsonb por forma; fallback legado = só dinheiro).
    const gravado: Record<string, number> =
      (s.esperadoPorForma as Record<string, number>) ??
      (s.valorEsperado != null ? { dinheiro: Number(s.valorEsperado) } : {});
    const gravadoCrus: Record<string, number> = {};
    for (const [f, v] of Object.entries(gravado)) gravadoCrus[f] = paraCentavos(v);
    const gravadoCent = somarPorFormaDoCaixa(gravadoCrus);

    const formas = Array.from(new Set([...Object.keys(recalcCent), ...Object.keys(gravadoCent)])).sort();
    const porForma = formas.map((f) => {
      const rec = recalcCent[f] ?? 0;
      const grv = gravadoCent[f] ?? 0;
      const div = somarCentavos(rec, -grv);
      return {
        forma: f,
        gravado: paraReais(grv),
        recalculado: paraReais(rec),
        divergencia: paraReais(div),
        divergeCent: div,
      };
    });
    const totalDivCent = porForma.reduce((s2, p) => s2 + Math.abs(p.divergeCent), 0);
    const divergentes = porForma.filter((p) => p.divergeCent !== 0);
    const ok = divergentes.length === 0;

    if (!ok) {
      // Alerta append-only — não bloqueia nada, só deixa rastro para auditoria.
      await this.auditoria
        .registrar({
          tenantId,
          atorId,
          atorPerfil: '',
          tipo: 'financeiro',
          acao: 'reconciliacao_divergente',
          entidadeTipo: 'caixa_sessao',
          entidadeId: s.id,
          detalhe: {
            totalDivergencia: paraReais(totalDivCent),
            porForma: divergentes.map((p) => ({
              forma: p.forma,
              gravado: p.gravado,
              recalculado: p.recalculado,
              divergencia: p.divergencia,
            })),
          },
        })
        .catch(() => undefined);
    }

    return {
      ok,
      sessaoId: s.id,
      totalDivergencia: paraReais(totalDivCent),
      porForma: porForma.map(({ divergeCent, ...p }) => p),
    };
  }
}
