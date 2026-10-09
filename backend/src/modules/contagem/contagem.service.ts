import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { consumirLotes } from '../../common/lotes';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  contagemLista,
  contagemListaItem,
  contagemExecucao,
  contagemItem,
  itemEstoque,
  movimentoEstoque,
  colaborador,
} from '../../db/schema';
import {
  CreateContagemListaDto,
  SalvarContagemDto,
} from './dto/create-contagem-lista.dto';
import { condUnidade, condUnidadeOuRede } from '../../common/filtro-unidade';
import { hojeISO } from '../../common/data';
import { acharMarca } from '../estoque/produto-nome';

@Injectable()
export class ContagemService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
    private readonly auditoria: AuditoriaService,
  ) {}

  // Saldo (ledger) por item, para o snapshot da contagem.
  // Loja da lista de contagem. A contagem é de UMA loja: saldo, movimento durante a
  // contagem e saldo no instante são todos dela (mig 253).
  private async lojaDaLista(tenantId: string, listaId: string): Promise<string | null> {
    const [l] = await this.db
      .select({ unidadeId: contagemLista.unidadeId })
      .from(contagemLista)
      .where(and(eq(contagemLista.id, listaId), eq(contagemLista.tenantId, tenantId)));
    return l?.unidadeId ?? null;
  }

  private async saldos(tenantId: string, itemIds: string[], unidadeId: string | null = null) {
    const map = new Map<string, number>();
    if (!itemIds.length) return map;
    const res: any = await this.db.execute(sql`
      select item_id as "itemId",
             coalesce(sum(case tipo when 'entrada' then quantidade
               when 'saida' then -quantidade else quantidade end), 0) as saldo
      from movimento_estoque
      where tenant_id = ${tenantId} and item_id in ${itemIds}
        ${unidadeId ? sql`and unidade_id = ${unidadeId}` : sql``}
      group by item_id
    `);
    for (const r of res.rows ?? res) map.set(r.itemId, Number(r.saldo));
    return map;
  }

  async createLista(tenantId: string, dto: CreateContagemListaDto, atual: string | null = null) {
    // Só itens do tenant (e da unidade atual, quando escopada).
    const validos = (
      await this.db
        .select({ id: itemEstoque.id })
        .from(itemEstoque)
        .where(
          and(
            eq(itemEstoque.tenantId, tenantId),
            // Insumo da loja OU compartilhado: com estoque por loja, a loja precisa poder
            // contar o insumo de cadastro compartilhado (o saldo dele é dela).
            condUnidadeOuRede(itemEstoque.unidadeId, atual),
            inArray(itemEstoque.id, dto.itemIds),
            isNull(itemEstoque.deletedAt),
          ),
        )
    ).map((i) => i.id);
    const [lista] = await this.db
      .insert(contagemLista)
      .values({
        tenantId,
        unidadeId: atual,
        nome: dto.nome,
        recorrencia: dto.recorrencia ?? 'semanal',
        diaSemana: dto.diaSemana,
        diaMes: dto.diaMes,
        hora: dto.hora,
        delegadoId: dto.delegadoId,
        enviarKds: dto.enviarKds ?? true,
        enviarDashboard: dto.enviarDashboard ?? true,
      })
      .returning();
    if (validos.length)
      await this.db
        .insert(contagemListaItem)
        .values(validos.map((itemId) => ({ tenantId, listaId: lista.id, itemId })));
    return { ...lista, itens: validos.length };
  }

  async listListas(tenantId: string, atual: string | null = null) {
    const listas = await this.db
      .select()
      .from(contagemLista)
      .where(and(eq(contagemLista.tenantId, tenantId), condUnidade(contagemLista.unidadeId, atual), isNull(contagemLista.deletedAt)))
      .orderBy(contagemLista.nome);
    // produtos de cada lista + última execução por lista (em memória). Os ids vão junto: a tela
    // de edição abre com os produtos da lista já marcados.
    const ids = listas.map((l) => l.id);
    const linhas = ids.length
      ? await this.db
          .select({ listaId: contagemListaItem.listaId, itemId: contagemListaItem.itemId })
          .from(contagemListaItem)
          .where(inArray(contagemListaItem.listaId, ids))
      : [];
    const itensDe = new Map<string, string[]>();
    for (const x of linhas) itensDe.set(x.listaId, [...(itensDe.get(x.listaId) ?? []), x.itemId]);
    // Nome do responsável (do MESMO tenant).
    const delegados = [...new Set(listas.map((l) => l.delegadoId).filter((d): d is string => !!d))];
    const nomes = delegados.length
      ? await this.db
          .select({ id: colaborador.id, nome: colaborador.nome })
          .from(colaborador)
          .where(and(eq(colaborador.tenantId, tenantId), inArray(colaborador.id, delegados)))
      : [];
    const nomeDe = new Map(nomes.map((c) => [c.id, c.nome]));
    const execs = ids.length
      ? await this.db
          .select({
            listaId: contagemExecucao.listaId,
            data: contagemExecucao.data,
            status: contagemExecucao.status,
          })
          .from(contagemExecucao)
          .where(inArray(contagemExecucao.listaId, ids))
          .orderBy(desc(contagemExecucao.data))
      : [];
    const ultima = new Map<string, any>();
    for (const e of execs) if (!ultima.has(e.listaId)) ultima.set(e.listaId, e);
    return listas.map((l) => ({
      ...l,
      itens: (itensDe.get(l.id) ?? []).length,
      itemIds: itensDe.get(l.id) ?? [],
      delegadoNome: l.delegadoId ? (nomeDe.get(l.delegadoId) ?? null) : null,
      ultimaContagem: ultima.get(l.id)?.data ?? null,
      pendenteHoje: this.dueHoje(l),
    }));
  }

  // Edita a lista: nome, recorrência, horário, responsável, avisos e os produtos (troca o
  // conjunto). As contagens já feitas não mudam — guardam os produtos que tinham na hora.
  async updateLista(tenantId: string, id: string, dto: CreateContagemListaDto, atual: string | null = null) {
    const daLista = and(
      eq(contagemLista.id, id),
      eq(contagemLista.tenantId, tenantId),
      condUnidade(contagemLista.unidadeId, atual),
      isNull(contagemLista.deletedAt),
    );
    const [antes] = await this.db.select({ unidadeId: contagemLista.unidadeId }).from(contagemLista).where(daLista);
    if (!antes) throw new NotFoundException('Lista não encontrada');
    // Só produtos do tenant, da loja DA LISTA ou compartilhados (a mesma regra da criação).
    const validos = (
      await this.db
        .select({ id: itemEstoque.id })
        .from(itemEstoque)
        .where(
          and(
            eq(itemEstoque.tenantId, tenantId),
            condUnidadeOuRede(itemEstoque.unidadeId, antes.unidadeId),
            inArray(itemEstoque.id, dto.itemIds),
            isNull(itemEstoque.deletedAt),
          ),
        )
    ).map((i) => i.id);
    if (!validos.length) throw new BadRequestException('Escolha ao menos um produto desta loja.');
    return this.db.transaction(async (tx) => {
      const [lista] = await tx
        .update(contagemLista)
        .set({
          nome: dto.nome,
          recorrencia: dto.recorrencia ?? 'semanal',
          // dia que não é da recorrência escolhida não fica guardado (o aviso é por ele)
          diaSemana: dto.recorrencia === 'semanal' ? (dto.diaSemana ?? null) : null,
          diaMes: dto.recorrencia === 'mensal' ? (dto.diaMes ?? null) : null,
          hora: dto.hora ?? null,
          delegadoId: dto.delegadoId ?? null,
          enviarKds: dto.enviarKds ?? true,
          enviarDashboard: dto.enviarDashboard ?? true,
          updatedAt: new Date(),
        })
        .where(daLista)
        .returning();
      if (!lista) throw new NotFoundException('Lista não encontrada');
      await tx.delete(contagemListaItem).where(and(eq(contagemListaItem.tenantId, tenantId), eq(contagemListaItem.listaId, id)));
      await tx.insert(contagemListaItem).values(validos.map((itemId) => ({ tenantId, listaId: id, itemId })));
      return { ...lista, itens: validos.length };
    });
  }

  // Histórico da lista: as contagens feitas, da mais nova para a mais antiga (últimas 30), com
  // quantos produtos foram contados e quantos deram diferença contra o saldo da abertura.
  async historico(tenantId: string, listaId: string, atual: string | null = null) {
    const [lista] = await this.db
      .select({ id: contagemLista.id })
      .from(contagemLista)
      .where(and(eq(contagemLista.id, listaId), eq(contagemLista.tenantId, tenantId), condUnidade(contagemLista.unidadeId, atual)));
    if (!lista) throw new NotFoundException('Lista não encontrada');
    const r: any = await this.db.execute(sql`
      select e.id, e.data, e.status, e.concluida_em as "concluidaEm", c.nome as "quemNome",
             (select count(*)::int from contagem_item ci where ci.execucao_id = e.id) as itens,
             (select count(*)::int from contagem_item ci where ci.execucao_id = e.id and ci.contado is not null) as contados,
             (select count(*)::int from contagem_item ci
               where ci.execucao_id = e.id and ci.contado is not null and ci.contado <> ci.saldo_sistema) as "comDiferenca"
        from contagem_execucao e
        left join colaborador c on c.id = e.criada_por_id and c.tenant_id = e.tenant_id
       where e.tenant_id = ${tenantId} and e.lista_id = ${listaId}
       order by e.created_at desc
       limit 30
    `);
    const execucoes: any[] = r.rows ?? r;
    // O detalhe por marca (mig 312): só os produtos contados marca a marca, por contagem.
    const ids = execucoes.map((e) => e.id);
    const d: any = ids.length
      ? await this.db.execute(sql`
          select ci.execucao_id as "execucaoId", i.nome, i.unidade_medida as "unidadeMedida",
                 ci.contado::float8 as contado, ci.por_marca as "porMarca"
            from contagem_item ci
            join item_estoque i on i.id = ci.item_id
           where ci.tenant_id = ${tenantId} and ci.por_marca is not null
             and ci.execucao_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})
           order by i.nome
        `)
      : [];
    const porExecucao = new Map<string, any[]>();
    for (const x of d.rows ?? d) {
      const lista = porExecucao.get(x.execucaoId) ?? [];
      lista.push({ nome: x.nome, unidadeMedida: x.unidadeMedida, contado: x.contado, porMarca: x.porMarca });
      porExecucao.set(x.execucaoId, lista);
    }
    return execucoes.map((e) => ({ ...e, porMarca: porExecucao.get(e.id) ?? [] }));
  }

  // A lista deve ser contada hoje? (recorrência × dia atual no fuso SP)
  private dueHoje(l: any): boolean {
    const spDate = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const d = new Date(`${spDate}T00:00:00Z`);
    if (!l.ativo) return false;
    if (l.recorrencia === 'diaria') return true;
    if (l.recorrencia === 'semanal') return l.diaSemana === d.getUTCDay();
    if (l.recorrencia === 'mensal') return l.diaMes === d.getUTCDate();
    return false;
  }

  async removerLista(tenantId: string, id: string, atual: string | null = null) {
    const [row] = await this.db
      .update(contagemLista)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(contagemLista.id, id),
          eq(contagemLista.tenantId, tenantId),
          condUnidade(contagemLista.unidadeId, atual),
          isNull(contagemLista.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Lista não encontrada');
    return { ok: true };
  }

  // Abre uma execução: snapshot do saldo de cada item da lista.
  async iniciarExecucao(tenantId: string, listaId: string, atorId: string, atual: string | null = null) {
    const [lista] = await this.db
      .select()
      .from(contagemLista)
      .where(
        and(
          eq(contagemLista.id, listaId),
          eq(contagemLista.tenantId, tenantId),
          condUnidade(contagemLista.unidadeId, atual),
          isNull(contagemLista.deletedAt),
        ),
      );
    if (!lista) throw new NotFoundException('Lista não encontrada');
    const itens = await this.db
      .select({ itemId: contagemListaItem.itemId })
      .from(contagemListaItem)
      .where(eq(contagemListaItem.listaId, listaId));
    const itemIds = itens.map((i) => i.itemId);
    const saldos = await this.saldos(tenantId, itemIds, lista.unidadeId ?? null);
    const [exec] = await this.db
      .insert(contagemExecucao)
      .values({ tenantId, listaId, delegadoId: lista.delegadoId, criadaPorId: atorId, data: hojeISO() })
      .returning();
    if (itemIds.length)
      await this.db.insert(contagemItem).values(
        itemIds.map((itemId) => ({
          tenantId,
          execucaoId: exec.id,
          itemId,
          saldoSistema: String(saldos.get(itemId) ?? 0),
        })),
      );
    return this.getExecucao(tenantId, exec.id);
  }

  // Movimento líquido de cada item DESDE a abertura da contagem.
  //
  // É o dado que falta para o ajuste ser confiável. O `saldo_sistema` de cada item é
  // congelado quando a contagem abre; o ajuste lançado é `contado − saldo_sistema`.
  // Isso só está certo se o operador contou o item NO INSTANTE da abertura. Se houve
  // venda/produção no meio, o resultado depende de o item ter sido contado antes ou
  // depois desse movimento — e o sistema não sabe qual. Em vez de escolher em silêncio
  // uma base errada, expomos o movimento e deixamos quem conta decidir.
  private async movimentoDesde(
    tenantId: string,
    itemIds: string[],
    desde: Date,
    unidadeId: string | null = null,
  ) {
    const mapa = new Map<string, { qtd: number; n: number }>();
    if (!itemIds.length) return mapa;
    const res: any = await this.db.execute(sql`
      select item_id as "itemId",
             coalesce(sum(case tipo when 'entrada' then quantidade
               when 'saida' then -quantidade else quantidade end), 0) as qtd,
             count(*)::int as n
      from movimento_estoque
      where tenant_id = ${tenantId} and item_id in ${itemIds}
        ${unidadeId ? sql`and unidade_id = ${unidadeId}` : sql``}
        and created_at > ${desde}
        -- o próprio ajuste da contagem não conta como "movimento durante a contagem"
        and coalesce(motivo, '') <> 'contagem'
      group by item_id
    `);
    for (const r of res.rows ?? res) mapa.set(r.itemId, { qtd: Number(r.qtd), n: Number(r.n) });
    return mapa;
  }

  // Saldo de cada item NO INSTANTE em que ele foi contado (mig 244).
  //
  // É a base correta do ajuste. O snapshot da abertura só acerta se o item tiver sido
  // contado no instante em que a contagem abriu — o que não acontece num inventário de
  // expediente: conta-se item a item, andando entre câmara e freezer, enquanto a chapa
  // consome. Com a hora de cada linha, cada item ganha a base do seu próprio momento.
  //
  // `instantes` é um mapa itemId → Date JÁ VALIDADA pelo chamador.
  private async saldosNoInstante(
    tenantId: string,
    instantes: Map<string, Date>,
    unidadeId: string | null = null,
  ): Promise<Map<string, number>> {
    const saldos = new Map<string, number>();
    if (!instantes.size) return saldos;
    // Uma consulta só para todos os itens: `values` pareia item × instante e a soma
    // corre por item. Um SELECT por item seria N viagens ao banco numa contagem de 200.
    const pares = [...instantes.entries()].map(
      ([itemId, t]) => sql`(${itemId}::uuid, ${t.toISOString()}::timestamptz)`,
    );
    const res: any = await this.db.execute(sql`
      with alvo(item_id, ate) as (values ${sql.join(pares, sql`, `)})
      select a.item_id as "itemId",
             coalesce(sum(case m.tipo when 'entrada' then m.quantidade
               when 'saida' then -m.quantidade else m.quantidade end), 0) as saldo
        from alvo a
        left join movimento_estoque m
          on m.tenant_id = ${tenantId} and m.item_id = a.item_id and m.created_at <= a.ate
             ${unidadeId ? sql`and m.unidade_id = ${unidadeId}` : sql``}
       group by a.item_id
    `);
    for (const r of res.rows ?? res) saldos.set(r.itemId, Number(r.saldo));
    return saldos;
  }

  async getExecucao(tenantId: string, execId: string) {
    const [exec] = await this.db
      .select()
      .from(contagemExecucao)
      .where(and(eq(contagemExecucao.id, execId), eq(contagemExecucao.tenantId, tenantId)));
    if (!exec) throw new NotFoundException('Contagem não encontrada');
    const itens = await this.db
      .select({
        itemId: contagemItem.itemId,
        nome: itemEstoque.nome,
        unidadeMedida: itemEstoque.unidadeMedida,
        saldoSistema: contagemItem.saldoSistema,
        contado: contagemItem.contado,
        // Produto com duas ou mais marcas é contado marca a marca (mig 312); o estoque é um só.
        marcas: itemEstoque.marcas,
        porMarca: contagemItem.porMarca,
      })
      .from(contagemItem)
      .leftJoin(itemEstoque, eq(contagemItem.itemId, itemEstoque.id))
      .where(eq(contagemItem.execucaoId, execId));
    // Movimento desde a abertura: o operador vê, ENQUANTO conta, que aquele item saiu
    // ou entrou depois do snapshot — e decide se conta de novo ou aceita a diferença.
    const mov = await this.movimentoDesde(
      tenantId,
      itens.map((i) => i.itemId),
      exec.createdAt,
      await this.lojaDaLista(tenantId, exec.listaId),
    );
    return {
      ...exec,
      itens: itens.map((i) => ({
        ...i,
        movimentoDesdeAbertura: mov.get(i.itemId)?.qtd ?? 0,
        movimentosDesdeAbertura: mov.get(i.itemId)?.n ?? 0,
      })),
      itensComMovimento: itens.filter((i) => (mov.get(i.itemId)?.n ?? 0) > 0).length,
    };
  }

  // Salva os contados; opcionalmente ajusta o estoque (movimento 'ajuste').
  async salvarContagem(
    tenantId: string,
    execId: string,
    atorId: string,
    dto: SalvarContagemDto,
  ) {
    // TUDO numa transação, com a execução TRAVADA. Antes cada update/insert ia solto:
    // (a) falha no meio do laço deixava metade dos ajustes aplicados com a contagem ainda
    // aberta; (b) sem guarda de status, reenviar o formulário lançava o MESMO ajuste de
    // novo — o estoque andava duas vezes. O `ref` por linha (índice único da mig 024) é a
    // trava final: mesmo com trava vencida, o banco recusa o segundo ajuste.
    const resumo = await this.db.transaction(async (tx) => {
      const [exec] = await tx
        .select()
        .from(contagemExecucao)
        .where(and(eq(contagemExecucao.id, execId), eq(contagemExecucao.tenantId, tenantId)))
        .for('update');
      if (!exec) throw new NotFoundException('Contagem não encontrada');
      if (exec.status === 'concluida')
        throw new BadRequestException('Contagem já concluída — o ajuste não é lançado duas vezes.');

      const atuais = await tx
        .select()
        .from(contagemItem)
        .where(and(eq(contagemItem.execucaoId, execId), eq(contagemItem.tenantId, tenantId)));
      const linhaDe = new Map(atuais.map((a) => [a.itemId, a]));
      // CONTAGEM POR MARCA (decisão do dono, 09/10/2026): o produto com duas ou mais marcas é
      // contado marca a marca. O que conta para o estoque é a SOMA — o estoque é um só por
      // produto; o detalhe fica guardado na contagem. Tudo é conferido ANTES de gravar.
      const produtos = atuais.length
        ? await tx
            .select({ id: itemEstoque.id, nome: itemEstoque.nome, marcas: itemEstoque.marcas })
            .from(itemEstoque)
            .where(and(eq(itemEstoque.tenantId, tenantId), inArray(itemEstoque.id, atuais.map((a) => a.itemId))))
        : [];
      const produtoDe = new Map(produtos.map((p) => [p.id, p]));
      const porMarcaDe = new Map<string, Record<string, number> | null>();
      for (const it of dto.itens) {
        if (!linhaDe.has(it.itemId)) continue;
        const produto = produtoDe.get(it.itemId);
        const marcas: string[] = Array.isArray(produto?.marcas) ? (produto!.marcas as string[]) : [];
        // Com uma marca só (ou nenhuma) não há o que separar: vale o contado.
        if (!it.porMarca?.length || marcas.length < 2) {
          porMarcaDe.set(it.itemId, null);
          continue;
        }
        const detalhe: Record<string, number> = {};
        for (const m of it.porMarca) {
          const marca = acharMarca(marcas, m.marca);
          if (!marca)
            throw new BadRequestException(`"${m.marca}" não é marca cadastrada de "${produto?.nome}". Marcas: ${marcas.join(', ')}.`);
          detalhe[marca] = Math.round(((detalhe[marca] ?? 0) + Number(m.quantidade)) * 1e6) / 1e6;
        }
        const soma = Math.round(Object.values(detalhe).reduce((s, v) => s + v, 0) * 1e6) / 1e6;
        if (Math.abs(soma - Number(it.contado)) > 1e-6)
          throw new BadRequestException(`"${produto?.nome}": a soma das marcas (${soma}) não bate com o total contado (${it.contado}).`);
        porMarcaDe.set(it.itemId, detalhe);
      }
      // Quais itens se moveram DURANTE a contagem. O ajuste segue sendo lançado contra o
      // snapshot da abertura (é a base que o operador viu na tela), mas o que se moveu
      // fica REGISTRADO: sem isso, um ajuste possivelmente errado some sem deixar pista.
      const lojaExec = await this.lojaDaLista(tenantId, exec.listaId);
      const mov = await this.movimentoDesde(tenantId, [...linhaDe.keys()], exec.createdAt, lojaExec);

      // Hora de cada item, LIMITADA ao intervalo [abertura, agora]. O valor vem do
      // cliente: relógio adiantado/atrasado — ou adulterado — não pode escolher a base
      // do estoque. Sem hora (app antigo, ou digitação em lote), cai em "agora".
      const agora = new Date();
      const abertura = exec.createdAt;
      const instantes = new Map<string, Date>();
      for (const it of dto.itens) {
        if (!linhaDe.has(it.itemId)) continue;
        const bruto = it.contadoEm ? new Date(it.contadoEm) : agora;
        const t = Number.isNaN(bruto.getTime()) ? agora : bruto;
        instantes.set(it.itemId, t < abertura ? abertura : t > agora ? agora : t);
      }
      const saldoNo = await this.saldosNoInstante(tenantId, instantes, lojaExec);

      let ajustados = 0;
      let contados = 0;
      const suspeitos: { itemId: string; movimento: number; diff: number; base: number }[] = [];
      for (const it of dto.itens) {
        const linha = linhaDe.get(it.itemId);
        if (!linha) continue;
        const quando = instantes.get(it.itemId) ?? agora;
        await tx
          .update(contagemItem)
          .set({ contado: String(it.contado), contadoEm: quando, porMarca: porMarcaDe.get(it.itemId) ?? null })
          .where(
            and(eq(contagemItem.execucaoId, execId), eq(contagemItem.itemId, it.itemId)),
          );
        contados++;
        if (dto.aplicarAjuste) {
          // Base = saldo no instante da contagem DAQUELE item. Caindo de volta no
          // snapshot da abertura só se o item não tiver movimento nenhum no período
          // (aí os dois valores são idênticos de qualquer forma).
          const base = saldoNo.get(it.itemId) ?? (Number(linha.saldoSistema) || 0);
          const diff = Number(it.contado) - base;
          if (Math.abs(diff) > 1e-9) {
            const [movAj] = await tx
              .insert(movimentoEstoque)
              .values({
                tenantId,
                itemId: it.itemId,
                tipo: 'ajuste',
                quantidade: String(diff),
                motivo: 'contagem',
                refTipo: 'contagem_item', // ref por LINHA da contagem
                refId: linha.id,
                data: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }),
              })
              .returning({ id: movimentoEstoque.id });
            // Ajuste NEGATIVO (contou menos do que o sistema tinha) sai de lote em
            // FEFO (mig 248) — senão a perda sumiria do estoque mas o lote seguiria
            // "cheio" alertando validade de mercadoria que não existe mais. Ajuste
            // positivo é sobra sem origem conhecida: não inventa lote.
            if (movAj && diff < 0)
              await consumirLotes(tx, tenantId, it.itemId, -diff, movAj.id);
            ajustados++;
            const m = mov.get(it.itemId);
            if (m && m.n > 0) suspeitos.push({ itemId: it.itemId, movimento: m.qtd, diff, base });
          }
        }
      }

      await tx
        .update(contagemExecucao)
        .set({ status: 'concluida', concluidaEm: new Date() })
        .where(and(eq(contagemExecucao.id, execId), eq(contagemExecucao.tenantId, tenantId)));
      return { contados, ajustados, listaId: exec.listaId, suspeitos };
    });

    // Ajuste de saldo SEM rastro era o pior da contagem: o `atorId` chegava aqui e era
    // ignorado, então ninguém sabia quem mudou o estoque nem em quanto.
    await this.auditoria.registrar({
      tenantId,
      atorId: atorId ?? null,
      atorPerfil: '',
      tipo: 'estoque',
      acao: dto.aplicarAjuste ? 'ajustou_estoque_por_contagem' : 'registrou_contagem',
      entidadeTipo: 'contagem_execucao',
      entidadeId: execId,
      detalhe: { ...resumo, aplicarAjuste: !!dto.aplicarAjuste },
    });

    const nSusp = resumo.suspeitos.length;
    // Avisa dashboard/KDS que a contagem foi concluída. Item que se moveu durante a
    // contagem sobe a prioridade: é um ajuste que pode estar errado e alguém precisa ver.
    this.events.emit('kds.alerta.sistema', {
      tenantId,
      titulo: nSusp ? 'Contagem concluída — confira' : 'Contagem concluída',
      detalhe: nSusp
        ? `${nSusp} item(ns) tiveram movimento durante a contagem; o ajuste desses pode estar errado.`
        : dto.aplicarAjuste
          ? 'Estoque ajustado pela contagem.'
          : 'Contagem registrada.',
      prioridade: nSusp ? 'media' : 'baixa',
    });
    return {
      ok: true,
      contados: resumo.contados,
      ajustados: resumo.ajustados,
      // O front avisa quem acabou de contar — é o único momento em que dá para conferir
      // enquanto a informação ainda está fresca.
      itensComMovimento: nSusp,
      suspeitos: resumo.suspeitos,
    };
  }

  // Alerta por horário: toda hora cheia, avisa as listas que vencem agora.
  @Cron('0 * * * *')
  async alertasContagem() {
    const listas = await this.db
      .select()
      .from(contagemLista)
      .where(
        and(
          eq(contagemLista.ativo, true),
          eq(contagemLista.enviarKds, true),
          isNull(contagemLista.deletedAt),
        ),
      );
    const spHora = Number(
      new Date()
        .toLocaleString('en-GB', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hour12: false })
        .slice(0, 2),
    );
    for (const l of listas) {
      if (l.hora == null) continue;
      if (Number(String(l.hora).slice(0, 2)) !== spHora) continue;
      if (!this.dueHoje(l)) continue;
      let alvo = '';
      if (l.delegadoId) {
        const [c] = await this.db
          .select({ nome: colaborador.nome })
          .from(colaborador)
          .where(eq(colaborador.id, l.delegadoId));
        if (c?.nome) alvo = ` — responsável: ${c.nome}`;
      }
      this.events.emit('kds.alerta.sistema', {
        tenantId: l.tenantId,
        titulo: `Contagem: ${l.nome}`,
        detalhe: `Hora de contar o estoque desta lista${alvo}.`,
        prioridade: 'media',
      });
    }
  }
}
