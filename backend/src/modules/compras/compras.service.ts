import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  compraLista,
  compraItem,
  itemEstoque,
  lote,
  unidade,
  tituloFinanceiro,
  movimentoEstoque,
  fornecedor,
  colaborador,
} from '../../db/schema';
import { custoMedioPonderado } from '../../common/regras-negocio';
import { condUnidadeOuRede, sqlUnidadeOuRede } from '../../common/filtro-unidade';
import { hojeISO } from '../../common/data';
import { CreateCompraListaDto } from './dto/create-compra-lista.dto';
import { ReceberCompraDto, ConferenciaItemDto } from './dto/receber-compra.dto';

@Injectable()
export class ComprasService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
    private readonly auditoria: AuditoriaService,
  ) {}

  private async saldos(tenantId: string, itemIds: string[]) {
    const map = new Map<string, number>();
    if (!itemIds.length) return map;
    const res: any = await this.db.execute(sql`
      select item_id as "itemId",
             coalesce(sum(case tipo when 'entrada' then quantidade
               when 'saida' then -quantidade else quantidade end), 0) as saldo
      from movimento_estoque
      where tenant_id = ${tenantId} and item_id in ${itemIds}
      group by item_id
    `);
    for (const r of res.rows ?? res) map.set(r.itemId, Number(r.saldo));
    return map;
  }

  async createLista(
    tenantId: string,
    dto: CreateCompraListaDto,
    escopoUnidadeId: string | null = null,
  ) {
    // Unidade da lista: a do usuário vence o corpo; a informada pela rede é conferida
    // contra o tenant. Sem isso a lista nascia sem loja — e o LOTE criado no
    // recebimento herdava essa ausência, ficando fora do escopo de qualquer filial.
    let unidadeIdLista = escopoUnidadeId ?? dto.unidadeId ?? null;
    if (!escopoUnidadeId && dto.unidadeId) {
      const [u] = await this.db
        .select({ id: unidade.id })
        .from(unidade)
        .where(and(eq(unidade.id, dto.unidadeId), eq(unidade.tenantId, tenantId)));
      if (!u) throw new BadRequestException('Unidade inválida.');
      unidadeIdLista = u.id;
    }

    const ids = dto.itens.map((i) => i.itemId);
    const validos = new Set(
      (
        await this.db
          .select({ id: itemEstoque.id })
          .from(itemEstoque)
          .where(
            and(
              eq(itemEstoque.tenantId, tenantId),
              inArray(itemEstoque.id, ids),
              isNull(itemEstoque.deletedAt),
              // Insumo da loja da lista OU da rede — não de outra filial.
              condUnidadeOuRede(itemEstoque.unidadeId, unidadeIdLista),
            ),
          )
      ).map((i) => i.id),
    );
    // Antes, item inválido era DESCARTADO em silêncio (`filter`) e a lista saía menor
    // do que o comprador montou: ele não compra o que sumiu e ninguém sabe por quê.
    const invalidos = dto.itens.filter((i) => !validos.has(i.itemId));
    if (invalidos.length)
      throw new BadRequestException(
        `${invalidos.length} item(ns) não pertencem a esta loja ou não existem mais.`,
      );
    const linhas = dto.itens;


    const [lista] = await this.db
      .insert(compraLista)
      .values({
        tenantId,
        unidadeId: unidadeIdLista,
        nome: dto.nome,
        fornecedorId: dto.fornecedorId,
        dataRecebimento: dto.dataRecebimento,
        vencimento: dto.vencimento,
        delegadoId: dto.delegadoId,
        enviarKds: dto.enviarKds ?? true,
        enviarDashboard: dto.enviarDashboard ?? true,
      })
      .returning();
    await this.db.insert(compraItem).values(
      linhas.map((i) => ({
        tenantId,
        listaId: lista.id,
        itemId: i.itemId,
        quantidade: String(i.quantidade),
        custoUnitario: i.custoUnitario != null ? String(i.custoUnitario) : undefined,
      })),
    );
    return { ...lista, itens: linhas.length };
  }

  async listListas(tenantId: string, atual: string | null = null) {
    const listas = await this.db
      .select({
        id: compraLista.id,
        nome: compraLista.nome,
        status: compraLista.status,
        dataRecebimento: compraLista.dataRecebimento,
        recebidaEm: compraLista.recebidaEm,
        fornecedorNome: fornecedor.nome,
        delegadoNome: colaborador.nome,
      })
      .from(compraLista)
      .leftJoin(fornecedor, eq(compraLista.fornecedorId, fornecedor.id))
      .leftJoin(colaborador, eq(compraLista.delegadoId, colaborador.id))
      // Escopo por loja (auditoria #6/#33): antes a lista da Filial A aparecia — e podia
      // ser removida — na tela da Filial B.
      .where(and(eq(compraLista.tenantId, tenantId), isNull(compraLista.deletedAt), condUnidadeOuRede(compraLista.unidadeId, atual)))
      .orderBy(desc(compraLista.createdAt));
    const ids = listas.map((l) => l.id);
    const cnt = ids.length
      ? await this.db
          .select({ listaId: compraItem.listaId, n: sql<number>`count(*)` })
          .from(compraItem)
          .where(inArray(compraItem.listaId, ids))
          .groupBy(compraItem.listaId)
      : [];
    const nItens = new Map(cnt.map((c: any) => [c.listaId, Number(c.n)]));
    return listas.map((l) => ({ ...l, itens: nItens.get(l.id) ?? 0 }));
  }

  async getLista(tenantId: string, id: string, atual: string | null = null) {
    const [lista] = await this.db
      .select()
      .from(compraLista)
      .where(
        and(
          eq(compraLista.id, id),
          eq(compraLista.tenantId, tenantId),
          isNull(compraLista.deletedAt),
          condUnidadeOuRede(compraLista.unidadeId, atual),
        ),
      );
    if (!lista) throw new NotFoundException('Lista não encontrada');
    const itens = await this.db
      .select({
        id: compraItem.id,
        itemId: compraItem.itemId,
        nome: itemEstoque.nome,
        unidadeMedida: itemEstoque.unidadeMedida,
        quantidade: compraItem.quantidade,
        custoUnitario: compraItem.custoUnitario,
        qtdRecebida: compraItem.qtdRecebida,
        validade: compraItem.validade,
        validadeIndefinida: compraItem.validadeIndefinida,
        loteCodigo: compraItem.loteCodigo,
        divergencia: compraItem.divergencia,
      })
      .from(compraItem)
      .leftJoin(itemEstoque, eq(compraItem.itemId, itemEstoque.id))
      .where(eq(compraItem.listaId, id));

    // Memória por insumo: como este insumo foi conferido da ÚLTIMA vez. A tela
    // pré-preenche com isso — o guardanapo já vem marcado como indefinido, o
    // hambúrguer já vem pedindo a data. A decisão continua aparecendo e sendo
    // confirmada por quem confere; o que sai é a digitação repetitiva, que é o que
    // faria "indefinida" virar o clique rápido em tudo.
    const memoria = await this.ultimaConferenciaPorItem(
      tenantId,
      itens.map((i) => i.itemId),
    );
    return {
      ...lista,
      itens: itens.map((i) => ({ ...i, sugestao: memoria.get(i.itemId) ?? null })),
    };
  }

  // Última conferência de cada insumo (1 consulta, não N): DISTINCT ON pega a linha
  // conferida mais recente por item.
  private async ultimaConferenciaPorItem(tenantId: string, itemIds: string[]) {
    const mapa = new Map<string, { validadeIndefinida: boolean }>();
    if (!itemIds.length) return mapa;
    const r: any = await this.db.execute(sql`
      select distinct on (ci.item_id)
        ci.item_id as "itemId",
        ci.validade_indefinida as "validadeIndefinida"
      from compra_item ci
      where ci.tenant_id = ${tenantId}
        and ci.item_id in ${itemIds}
        and ci.qtd_recebida is not null
      order by ci.item_id, ci.updated_at desc
    `);
    for (const x of r.rows ?? r)
      mapa.set(x.itemId, { validadeIndefinida: !!x.validadeIndefinida });
    return mapa;
  }

  // Sugestão: itens abaixo do mínimo, com quantidade sugerida (mínimo − saldo).
  async sugerir(tenantId: string, atual: string | null = null) {
    const res: any = await this.db.execute(sql`
      select i.id as "itemId", i.nome, i.unidade_medida as "unidadeMedida",
             i.estoque_minimo as "estoqueMinimo",
             coalesce(sum(case m.tipo when 'entrada' then m.quantidade
               when 'saida' then -m.quantidade else m.quantidade end), 0) as saldo
      from item_estoque i
      left join movimento_estoque m on m.item_id = i.id
      -- Insumo da loja ou da rede. Antes vinha o do tenant INTEIRO, sem rótulo de loja:
      -- dois "Farinha de trigo", um de cada filial, e o gerente marcava o da outra — o
      -- recebimento dava entrada e reescrevia o custo médio no estoque que não era dele.
      where i.tenant_id = ${tenantId} and i.deleted_at is null ${sqlUnidadeOuRede('i.unidade_id', atual)}
      group by i.id
      order by i.nome
    `);
    return (res.rows ?? res)
      .map((r: any) => {
        const saldo = Number(r.saldo);
        const min = Number(r.estoqueMinimo);
        return { ...r, saldo, sugerido: Math.max(0, min - saldo) };
      })
      .filter((r: any) => r.sugerido > 0);
  }

  async removerLista(tenantId: string, id: string, atual: string | null = null) {
    const [row] = await this.db
      .update(compraLista)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(compraLista.id, id),
          eq(compraLista.tenantId, tenantId),
          isNull(compraLista.deletedAt),
          condUnidadeOuRede(compraLista.unidadeId, atual),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Lista não encontrada');
    return { ok: true };
  }

  // Divergência deduzida da conta. O cliente só manda quando a conta não enxerga
  // (chegou tudo, mas danificado).
  private divergenciaDe(pedida: number, recebida: number): string {
    if (recebida === 0) return 'nao_veio';
    if (recebida < pedida) return 'parcial';
    if (recebida > pedida) return 'excedente';
    return 'ok';
  }

  // Receber a compra: CONFERE o que chegou, entra no estoque (movimento 'entrada' com
  // custo) + atualiza custo médio ponderado, cria o LOTE e marca recebida.
  //
  // Antes, `receber()` não recebia corpo nenhum e lançava no estoque a quantidade
  // PEDIDA: pediu 10 caixas, chegaram 7, entravam 10 — estoque que não existe, e o
  // custo médio ponderado calculado em cima dele. A conferência (`qtd_recebida`,
  // divergência) só existia em `recebimento_item`, de um fluxo que a base mostra
  // com ZERO notas. A validade também nasce aqui: está impressa na embalagem que a
  // pessoa tem na mão, e cada compra do mesmo insumo chega com uma diferente — por
  // isso não serve a data fixa do cadastro do insumo (mig 149).
  async receber(
    tenantId: string,
    id: string,
    atorId?: string | null,
    dto?: ReceberCompraDto,
    atual: string | null = null,
  ) {
    // TUDO numa transação: antes, cada insert ia solto. Falha no meio do laço deixava
    // parte dos itens no estoque com a lista ainda "pendente" — e o operador clicava de
    // novo. A trava (`for update`) fecha o check-then-act do duplo clique, e o `ref` no
    // movimento deixa o próprio banco recusar a segunda entrada (índice da mig 024).
    const lista = await this.db.transaction(async (tx) => {
      const [lista] = await tx
        .select()
        .from(compraLista)
        .where(
          and(
            eq(compraLista.id, id),
            eq(compraLista.tenantId, tenantId),
            isNull(compraLista.deletedAt),
            condUnidadeOuRede(compraLista.unidadeId, atual),
          ),
        )
        .for('update');
      if (!lista) throw new NotFoundException('Lista não encontrada');
      if (lista.status === 'recebida')
        throw new BadRequestException('Compra já recebida.');

      const itens = await tx
        .select()
        .from(compraItem)
        .where(and(eq(compraItem.listaId, id), eq(compraItem.tenantId, tenantId)));
      const saldos = await this.saldos(tenantId, itens.map((i) => i.itemId));
      const data = lista.dataRecebimento ?? hojeISO();

      // A conferência é OBRIGATÓRIA e tem de cobrir a lista inteira. Aceitar parcial
      // deixaria linha entrando pela quantidade pedida — exatamente o que este
      // conserto tira do caminho.
      let valorConferido = 0;
      const conf = new Map<string, ConferenciaItemDto>();
      for (const c of dto?.itens ?? []) conf.set(c.compraItemId, c);
      const semConferencia = itens.filter((it) => !conf.has(it.id));
      if (semConferencia.length)
        throw new BadRequestException(
          `Confira todas as linhas antes de receber (${semConferencia.length} pendente(s)).`,
        );

      for (const it of itens) {
        const c = conf.get(it.id)!;
        const pedida = Number(it.quantidade);
        const qtd = Number(c.qtdRecebida);
        if (!(qtd >= 0))
          throw new BadRequestException('Informe a quantidade recebida de cada linha.');
        // Os três estados da validade. "Nenhum dos dois" é recusado de propósito:
        // campo em branco é o estado de hoje, em que ninguém preenche.
        if (!c.validade && !c.validadeIndefinida)
          throw new BadRequestException(
            'Informe a validade de cada linha, ou marque como indefinida.',
          );
        if (c.validade && c.validadeIndefinida)
          throw new BadRequestException(
            'Ou a validade tem data, ou é indefinida — não os dois.',
          );

        const custo = it.custoUnitario != null ? Number(it.custoUnitario) : null;

        // A conferência fica gravada na linha: é o histórico do que chegou (e a
        // memória que pré-preenche a próxima compra deste insumo).
        await tx
          .update(compraItem)
          .set({
            qtdRecebida: String(qtd),
            validade: c.validade ?? null,
            validadeIndefinida: !!c.validadeIndefinida,
            loteCodigo: c.loteCodigo?.trim() || null,
            divergencia: c.divergencia ?? this.divergenciaDe(pedida, qtd),
            updatedAt: new Date(),
          })
          .where(and(eq(compraItem.id, it.id), eq(compraItem.tenantId, tenantId)));

        if (qtd <= 0) continue; // não veio: conferência registrada, estoque intocado
        await tx.insert(movimentoEstoque).values({
          tenantId,
          itemId: it.itemId,
          tipo: 'entrada',
          quantidade: String(qtd),
          custoUnitario: custo != null ? String(custo) : undefined,
          motivo: 'compra',
          refTipo: 'compra_item', // ref por LINHA: duas linhas do mesmo item não colidem
          refId: it.id,
          data,
        });

        // LOTE — só quando há o que rastrear: uma validade, ou um código de lote do
        // fabricante. Sem nenhum dos dois (o guardanapo sem código), a linha já diz
        // tudo pelo próprio `compra_item` e um lote vazio seria só ruído na tela.
        const codigo = c.loteCodigo?.trim() || null;
        if (c.validade || codigo) {
          await tx.insert(lote).values({
            tenantId,
            itemId: it.itemId,
            unidadeId: lista.unidadeId ?? null,
            fornecedorId: lista.fornecedorId ?? null,
            compraItemId: it.id,
            codigo,
            validade: c.validade ?? null,
            validadeIndefinida: !!c.validadeIndefinida,
            quantidade: String(qtd),
            custoUnitario: custo != null ? String(custo) : undefined,
            entrada: data,
          });
        }

        if (custo != null) valorConferido += qtd * custo;

        if (custo != null) {
          const [cur] = await tx
            .select({ custoMedio: itemEstoque.custoMedio })
            .from(itemEstoque)
            .where(and(eq(itemEstoque.id, it.itemId), eq(itemEstoque.tenantId, tenantId)));
          const novo = custoMedioPonderado(
            saldos.get(it.itemId) ?? 0,
            Number(cur?.custoMedio ?? 0),
            qtd,
            custo,
          );
          await tx
            .update(itemEstoque)
            .set({ custoMedio: String(novo), updatedAt: new Date() })
            .where(and(eq(itemEstoque.id, it.itemId), eq(itemEstoque.tenantId, tenantId)));
        }
      }

      // CONTA A PAGAR — `compras.receber()` entrava com a mercadoria e não gerava
      // dívida nenhuma: só o `recebimento.confirmar()` gerava, e aquele fluxo tem ZERO
      // notas na base. O fornecedor e o valor já estavam na mão o tempo todo.
      //
      // O valor usa a quantidade CONFERIDA, nunca a pedida: pagar 10 caixas quando
      // chegaram 7 é o mesmo erro do estoque, do lado do dinheiro.
      if (lista.fornecedorId && valorConferido > 0) {
        // Data de pagamento (decisão do dono): a da conferência vence a da criação;
        // sem nenhuma das duas, o prazo do fornecedor a partir do recebimento. Título
        // sem vencimento não entra em alerta de contas a pagar e some do radar.
        let vencimento = dto?.vencimento ?? lista.vencimento ?? null;
        if (!vencimento) {
          const [f] = await tx
            .select({ prazo: fornecedor.prazoPagamentoDias })
            .from(fornecedor)
            .where(and(eq(fornecedor.id, lista.fornecedorId), eq(fornecedor.tenantId, tenantId)));
          const dias = Number(f?.prazo ?? 0);
          if (dias > 0) {
            const d = new Date(`${data}T12:00:00`);
            d.setDate(d.getDate() + dias);
            vencimento = d.toLocaleDateString('en-CA');
          }
        }
        await tx.insert(tituloFinanceiro).values({
          tenantId,
          unidadeId: lista.unidadeId,
          tipo: 'pagar',
          descricao: `Compra: ${lista.nome}`,
          categoria: 'fornecedor',
          fornecedorId: lista.fornecedorId,
          valor: String(valorConferido.toFixed(2)),
          vencimento: vencimento ?? undefined,
          origem: 'compra',
          origemId: id,
          criadoPorId: atorId ?? undefined,
        });
      }

      await tx
        .update(compraLista)
        .set({ status: 'recebida', recebidaEm: new Date() })
        .where(and(eq(compraLista.id, id), eq(compraLista.tenantId, tenantId)));
      return { ...lista, itens: itens.length };
    });

    // Mexeu em saldo e em custo — tem de deixar rastro (regra do projeto).
    await this.auditoria.registrar({
      tenantId,
      atorId: atorId ?? null,
      atorPerfil: '',
      tipo: 'estoque',
      acao: 'recebeu_compra',
      entidadeTipo: 'compra_lista',
      entidadeId: id,
      detalhe: { nome: lista.nome, itens: lista.itens },
    });

    if (lista.enviarKds)
      this.events.emit('kds.alerta.sistema', {
        tenantId,
        titulo: `Compra recebida: ${lista.nome}`,
        detalhe: 'Itens entraram no estoque.',
        prioridade: 'baixa',
      });
    return { ok: true };
  }
}
