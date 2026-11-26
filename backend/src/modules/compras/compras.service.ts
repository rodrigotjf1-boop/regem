import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  compraLista,
  compraItem,
  itemEstoque,
  lote,
  unidade,
  empresa,
  tituloFinanceiro,
  movimentoEstoque,
  fornecedor,
  colaborador,
} from '../../db/schema';
import {
  ponderarCustoDaEntrada,
  sqlLojasDoItem,
  sqlMinimoDaLoja,
} from '../../common/custo-loja';
import { travarInsumos } from '../../common/trava-do-insumo';
import { condUnidadeOuRede, sqlUnidade, sqlUnidadeOuRede } from '../../common/filtro-unidade';
import { hojeISO } from '../../common/data';
import type { Periodo } from '../../common/periodo';
import { acharMarca, limparNome } from '../estoque/produto-nome';
import { CreateCompraListaDto } from './dto/create-compra-lista.dto';
import { ReceberCompraDto, ConferenciaItemDto } from './dto/receber-compra.dto';
import { GerarFaltanteDto } from './dto/gerar-faltante.dto';
import { assuntoDoPedido, emailParaEnvio, linkDoEmail, linkDoWhatsapp, telefoneParaWhatsapp, textoDoPedido } from './pedido-texto';

@Injectable()
export class ComprasService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
    private readonly auditoria: AuditoriaService,
  ) {}

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
    const produtos = (
        await this.db
          .select({ id: itemEstoque.id, nome: itemEstoque.nome, nomeComercial: itemEstoque.nomeComercial, marcas: itemEstoque.marcas })
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
    );
    const validos = new Set(produtos.map((i) => i.id));
    // Antes, item inválido era DESCARTADO em silêncio (`filter`) e a lista saía menor
    // do que o comprador montou: ele não compra o que sumiu e ninguém sabe por quê.
    const invalidos = dto.itens.filter((i) => !validos.has(i.itemId));
    if (invalidos.length)
      throw new BadRequestException(
        `${invalidos.length} item(ns) não pertencem a esta loja ou não existem mais.`,
      );
    // Marca (mig 311): o estoque é um só, mas o PEDIDO diz a marca. Produto com duas ou mais marcas
    // exige a escolha (pedido ambíguo não sai); com uma só, vale ela; sem marca cadastrada, nenhuma.
    // 2ª opção (mig 312): outra marca do mesmo produto, para o caso de a 1ª faltar — opcional.
    const porId = new Map(produtos.map((p) => [p.id, p]));
    const linhas = dto.itens.map((i) => {
      const p = porId.get(i.itemId)!;
      const marcas: string[] = Array.isArray(p.marcas) ? p.marcas : [];
      const rotulo = p.nomeComercial || p.nome;
      const pedida = limparNome(i.marca);
      const semSegunda = null as string | null;
      if (!marcas.length) return { ...i, marca: null as string | null, marcaAlternativa: semSegunda };
      if (!pedida) {
        if (marcas.length === 1) return { ...i, marca: marcas[0], marcaAlternativa: semSegunda };
        throw new BadRequestException(`Escolha a marca de "${rotulo}": ${marcas.join(', ')}.`);
      }
      const achada = acharMarca(marcas, pedida);
      if (!achada)
        throw new BadRequestException(`"${pedida}" não é marca cadastrada de "${rotulo}". Marcas: ${marcas.join(', ')}.`);
      const segunda = limparNome(i.marcaAlternativa);
      if (!segunda || marcas.length < 2) return { ...i, marca: achada, marcaAlternativa: semSegunda };
      const alternativa = acharMarca(marcas, segunda);
      if (!alternativa)
        throw new BadRequestException(`"${segunda}" não é marca cadastrada de "${rotulo}". Marcas: ${marcas.join(', ')}.`);
      if (alternativa === achada)
        throw new BadRequestException(`A 2ª opção de "${rotulo}" tem de ser uma marca diferente da 1ª (${achada}).`);
      return { ...i, marca: achada, marcaAlternativa: alternativa };
    });


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
        marca: i.marca,
        marcaAlternativa: i.marcaAlternativa,
      })),
    );
    return { ...lista, itens: linhas.length };
  }

  // `periodo` é o que a tela pede para a lista não crescer para sempre. Ele corta só as listas
  // já RECEBIDAS (pela data em que foram recebidas); a que ainda aguarda aparece sempre, por
  // mais antiga que seja — é a compra esquecida que precisa ser vista. Sem período, tudo.
  // `verFinanceiro`: o valor estimado só sai para quem tem "ver valores em R$".
  async listListas(
    tenantId: string,
    atual: string | null = null,
    periodo: Periodo = { inicio: null, fim: null },
    verFinanceiro = true,
  ) {
    const recebidaNoDia = sql`coalesce((${compraLista.recebidaEm} at time zone 'America/Sao_Paulo')::date, ${compraLista.dataRecebimento}, (${compraLista.createdAt} at time zone 'America/Sao_Paulo')::date)`;
    const listas = await this.db
      .select({
        id: compraLista.id,
        nome: compraLista.nome,
        status: compraLista.status,
        dataRecebimento: compraLista.dataRecebimento,
        recebidaEm: compraLista.recebidaEm,
        createdAt: compraLista.createdAt,
        fornecedorId: compraLista.fornecedorId,
        delegadoId: compraLista.delegadoId,
        fornecedorNome: fornecedor.nome,
        delegadoNome: colaborador.nome,
        origemListaId: compraLista.origemListaId,
        enviadoEm: compraLista.enviadoEm,
        enviadoCanal: compraLista.enviadoCanal,
        notaRef: compraLista.notaRef,
      })
      .from(compraLista)
      .leftJoin(fornecedor, eq(compraLista.fornecedorId, fornecedor.id))
      .leftJoin(colaborador, eq(compraLista.delegadoId, colaborador.id))
      // Escopo por loja (auditoria #6/#33): antes a lista da Filial A aparecia — e podia
      // ser removida — na tela da Filial B.
      .where(
        and(
          eq(compraLista.tenantId, tenantId),
          isNull(compraLista.deletedAt),
          condUnidadeOuRede(compraLista.unidadeId, atual),
          periodo.inicio ? sql`(${compraLista.status} <> 'recebida' or ${recebidaNoDia} >= ${periodo.inicio})` : undefined,
          periodo.fim ? sql`(${compraLista.status} <> 'recebida' or ${recebidaNoDia} <= ${periodo.fim})` : undefined,
        ),
      )
      .orderBy(desc(compraLista.createdAt));
    const ids = listas.map((l) => l.id);
    // Por lista: quantos itens, o valor (quantidade × custo informado) e quantos estão sem custo
    // — o valor é "estimado" justamente porque nem todo item tem o custo preenchido.
    const cnt = ids.length
      ? await this.db
          .select({
            listaId: compraItem.listaId,
            n: sql<number>`count(*)`,
            // Antes de receber: pedido × valor informado (estimativa). Depois: o que CHEGOU × o valor
            // da nota — pedir 10 e receber 5 não deixa o pedido valendo 10.
            valor: sql<string>`coalesce(sum(coalesce(${compraItem.qtdRecebida}, ${compraItem.quantidade}) * ${compraItem.custoUnitario}), 0)`,
            semCusto: sql<number>`count(*) filter (where ${compraItem.custoUnitario} is null)`,
            // Veio menos do que o pedido (uma parte, ou nada): é a falta que a tela mostra na lista recebida.
            comFalta: sql<number>`count(*) filter (where ${compraItem.qtdRecebida} is not null and ${compraItem.qtdRecebida} < ${compraItem.quantidade})`,
            // "Não sei" no recebimento (mig 504): a situação "Validade pendente" da lista.
            validadesPendentes: sql<number>`count(*) filter (where ${compraItem.validadePendente})`,
          })
          .from(compraItem)
          .where(inArray(compraItem.listaId, ids))
          .groupBy(compraItem.listaId)
      : [];
    const por = new Map(cnt.map((c: any) => [c.listaId, c]));
    // Listas que já têm a "lista do que faltou" gerada (uma por origem) — a tela não oferece de novo.
    const comListaDoQueFaltou = new Set(
      ids.length
        ? (
            await this.db
              .select({ origem: compraLista.origemListaId })
              .from(compraLista)
              .where(and(eq(compraLista.tenantId, tenantId), inArray(compraLista.origemListaId, ids), isNull(compraLista.deletedAt)))
          ).map((r) => r.origem)
        : [],
    );
    return listas.map((l) => ({
      ...l,
      itens: Number(por.get(l.id)?.n ?? 0),
      valorEstimado: verFinanceiro ? Number(por.get(l.id)?.valor ?? 0) : null,
      itensSemCusto: Number(por.get(l.id)?.semCusto ?? 0),
      itensComFalta: l.status === 'recebida' ? Number(por.get(l.id)?.comFalta ?? 0) : 0,
      validadesPendentes: Number(por.get(l.id)?.validadesPendentes ?? 0),
      temListaDoQueFaltou: comListaDoQueFaltou.has(l.id),
    }));
  }

  // `verFinanceiro`: o custo de cada item só sai para quem tem "ver valores em R$".
  async getLista(tenantId: string, id: string, atual: string | null = null, verFinanceiro = true) {
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
    if (!lista) throw new NotFoundException('Pedido não encontrado');
    const itens = await this.db
      .select({
        id: compraItem.id,
        itemId: compraItem.itemId,
        nome: itemEstoque.nome,
        nomeComercial: itemEstoque.nomeComercial, // o que aparece na compra (mig 311); null = usa o nome
        marca: compraItem.marca,
        marcaAlternativa: compraItem.marcaAlternativa, // 2ª opção, se a 1ª faltar (mig 312)
        marcaRecebida: compraItem.marcaRecebida, // a que veio de fato
        marcas: itemEstoque.marcas, // as do cadastro: a conferência escolhe entre elas a que veio
        unidadeMedida: itemEstoque.unidadeMedida,
        quantidade: compraItem.quantidade,
        custoUnitario: compraItem.custoUnitario,
        qtdRecebida: compraItem.qtdRecebida,
        validade: compraItem.validade,
        validadeIndefinida: compraItem.validadeIndefinida,
        validadePendente: compraItem.validadePendente, // "não sei" no recebimento (mig 504)
        validadeObrigatoria: itemEstoque.validadeObrigatoria, // o produto pede a validade no recebimento (mig 504)
        loteCodigo: compraItem.loteCodigo,
        divergencia: compraItem.divergencia,
        custoPedido: compraItem.custoPedido, // o valor do pedido, quando a nota veio com outro (mig 313)
        fornecedorId: compraItem.fornecedorId, // de onde a linha veio (mig 505); null = o do pedido
        fornecedorNome: fornecedor.nome,
      })
      .from(compraItem)
      .leftJoin(itemEstoque, eq(compraItem.itemId, itemEstoque.id))
      // O nome de onde a linha veio, só do cadastro desta empresa (a coluna não tem chave estrangeira).
      .leftJoin(fornecedor, and(eq(fornecedor.id, compraItem.fornecedorId), eq(fornecedor.tenantId, tenantId)))
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
    // "Lista do que faltou": a que nasceu desta (a mais recente, se houver mais de uma) e a de onde esta nasceu.
    const [listaDoQueFaltou] = await this.db
      .select({ id: compraLista.id, nome: compraLista.nome })
      .from(compraLista)
      .where(and(eq(compraLista.tenantId, tenantId), eq(compraLista.origemListaId, id), isNull(compraLista.deletedAt)))
      .orderBy(desc(compraLista.createdAt))
      .limit(1);
    const [origem] = lista.origemListaId
      ? await this.db
          .select({ id: compraLista.id, nome: compraLista.nome })
          .from(compraLista)
          .where(and(eq(compraLista.id, lista.origemListaId), eq(compraLista.tenantId, tenantId)))
      : [];
    return {
      ...lista,
      listaDoQueFaltou: listaDoQueFaltou ?? null,
      origem: origem ?? null,
      itens: itens.map((i) => ({
        ...i,
        custoUnitario: verFinanceiro ? i.custoUnitario : null,
        custoPedido: verFinanceiro ? i.custoPedido : null,
        sugestao: memoria.get(i.itemId) ?? null,
      })),
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
        and ci.qtd_recebida > 0 -- o que NÃO VEIO não ensina nada sobre a validade do produto
      order by ci.item_id, ci.updated_at desc
    `);
    for (const x of r.rows ?? r)
      mapa.set(x.itemId, { validadeIndefinida: !!x.validadeIndefinida });
    return mapa;
  }

  // Sugestão: itens abaixo do mínimo, com quantidade sugerida (mínimo − saldo).
  async sugerir(tenantId: string, atual: string | null = null) {
    const res: any = await this.db.execute(sql`
      -- Saldo e mínimo DA LOJA (migs 253 e 257): a sugestão de compra é do estoque dela. Em
      -- "todas", soma o que falta em cada loja — a sobra de uma não cobre a falta da outra.
      select i.id as "itemId", i.nome, i.nome_comercial as "nomeComercial", i.marcas, i.unidade_medida as "unidadeMedida",
             sum(${sqlMinimoDaLoja}) as "estoqueMinimo",
             sum(mv.saldo) as saldo,
             sum(case when u.orfao then 0 else greatest(0, ${sqlMinimoDaLoja} - mv.saldo) end) as falta
      from item_estoque i
      ${sqlLojasDoItem(atual)}
      cross join lateral (
        select coalesce(sum(case m.tipo when 'entrada' then m.quantidade
                                  when 'saida'   then -m.quantidade
                                  else m.quantidade end), 0) as saldo
          from movimento_estoque m
         where m.item_id = i.id and m.unidade_id is not distinct from u.uid
      ) mv
      -- Insumo da loja ou da rede. Antes vinha o do tenant INTEIRO, sem rótulo de loja:
      -- dois "Farinha de trigo", um de cada filial, e o gerente marcava o da outra — o
      -- recebimento dava entrada e reescrevia o custo médio no estoque que não era dele.
      where i.tenant_id = ${tenantId} and i.deleted_at is null ${sqlUnidadeOuRede('i.unidade_id', atual)}
      group by i.id
      order by i.nome
    `);
    return (res.rows ?? res)
      .map((r: any) => {
        const { falta, ...resto } = r;
        return { ...resto, saldo: Number(r.saldo), sugerido: Number(falta) };
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
    if (!row) throw new NotFoundException('Pedido não encontrado');
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
    // P4 de "Pedidos e recebimento": o pedido recebido pela nota ou pelo cupom do Mister — a despesa sai da nota (o cupom já
    // pago, as parcelas da NF), não da soma dos itens; sem isto seriam duas contas da mesma compra.
    opcoes: { semConta?: boolean } = {},
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
      if (!lista) throw new NotFoundException('Pedido não encontrado');
      if (lista.status === 'recebida')
        throw new BadRequestException('Compra já recebida.');

      const itens = await tx
        .select()
        .from(compraItem)
        .where(and(eq(compraItem.listaId, id), eq(compraItem.tenantId, tenantId)));
      const data = lista.dataRecebimento ?? hojeISO();

      // A conferência é OBRIGATÓRIA e tem de cobrir a lista inteira. Aceitar parcial
      // deixaria linha entrando pela quantidade pedida — exatamente o que este
      // conserto tira do caminho.
      let valorConferido = 0;
      let comFalta = 0; // linhas em que veio menos do que o pedido (uma parte, ou nada)
      const notaRef = limparNome(dto?.notaRef) || null; // a nota que veio com a entrega
      const conf = new Map<string, ConferenciaItemDto>();
      for (const c of dto?.itens ?? []) conf.set(c.compraItemId, c);
      const semConferencia = itens.filter((it) => !conf.has(it.id));
      if (semConferencia.length)
        throw new BadRequestException(
          `Confira todas as linhas antes de receber (${semConferencia.length} pendente(s)).`,
        );
      // MARCADOR DE RECEBIMENTO (decisão do dono, 09/10/2026): o item que ficou SEM o marcador na
      // tela chega aqui com quantidade 0 — "não veio". Se nada veio, não há o que receber: a lista
      // segue aguardando (fechá-la como recebida esconderia a entrega que ainda vai chegar).
      if (!itens.some((it) => Number(conf.get(it.id)!.qtdRecebida) > 0))
        throw new BadRequestException(
          'Nenhum item foi marcado como recebido. Se a entrega ainda não veio, o pedido continua aguardando.',
        );
      // Marcas de cada produto: a conferência diz QUAL veio (a pedida, a 2ª opção ou outra do
      // cadastro). O estoque continua um só — a marca fica só no registro da compra.
      const produtos = await tx
        .select({ id: itemEstoque.id, nome: itemEstoque.nome, nomeComercial: itemEstoque.nomeComercial, marcas: itemEstoque.marcas, validadeObrigatoria: itemEstoque.validadeObrigatoria })
        .from(itemEstoque)
        .where(and(eq(itemEstoque.tenantId, tenantId), inArray(itemEstoque.id, itens.map((i) => i.itemId))));
      const produtoDe = new Map(produtos.map((p) => [p.id, p]));
      // "De onde veio" (P2, mig 505): cada linha pode dizer o fornecedor ou o mercado; tem de ser do cadastro desta empresa.
      const ditos = [...new Set((dto?.itens ?? []).map((c) => c.fornecedorId).filter((f): f is string => !!f))];
      const daEmpresa = ditos.length
        ? new Set(
            (
              await tx
                .select({ id: fornecedor.id })
                .from(fornecedor)
                .where(and(eq(fornecedor.tenantId, tenantId), inArray(fornecedor.id, ditos), isNull(fornecedor.deletedAt)))
            ).map((f) => f.id),
          )
        : new Set<string>();
      const foraDoCadastro = ditos.find((f) => !daEmpresa.has(f));
      if (foraDoCadastro) throw new BadRequestException('O fornecedor de um item não está no cadastro desta empresa.');
      // O valor conferido de cada fornecedor: é uma conta a pagar por fornecedor (PR-5).
      const valorPorFornecedor = new Map<string, number>();
      const itensPorFornecedor = new Map<string, number>();
      // Os insumos que vieram TRAVADOS de uma vez, em ordem (EST-D-01, como o recebimento da nota): o custo médio de cada um é
      // lido e gravado com ninguém mais dando entrada nele, e duas compras com os mesmos insumos em outra ordem não ficam
      // esperando uma a outra (antes, cada entrada travava o seu insumo no meio do laço — o Postgres derrubava uma com impasse).
      await travarInsumos(tx, tenantId, itens.filter((it) => Number(conf.get(it.id)!.qtdRecebida) > 0).map((it) => it.itemId));

      for (const it of itens) {
        const c = conf.get(it.id)!;
        const pedida = Number(it.quantidade);
        const qtd = Number(c.qtdRecebida);
        if (!(qtd >= 0))
          throw new BadRequestException('Informe a quantidade recebida de cada linha.');
        if (qtd < pedida) comFalta++;
        // NÃO VEIO: a conferência fica registrada e mais nada é pedido — validade e lote são da
        // mercadoria que a pessoa tem na mão, e aqui não há mercadoria. O estoque fica intocado.
        if (qtd === 0) {
          await tx
            .update(compraItem)
            .set({
              qtdRecebida: '0',
              validade: null,
              validadeIndefinida: false,
              validadePendente: false,
              loteCodigo: null,
              marcaRecebida: null,
              fornecedorId: null,
              divergencia: 'nao_veio',
              updatedAt: new Date(),
            })
            .where(and(eq(compraItem.id, it.id), eq(compraItem.tenantId, tenantId)));
          continue;
        }
        // A VALIDADE (P1 de "Pedidos e recebimento", mig 504 — o dono, 24/11: "lançar o pedido não deve ser o bloqueio").
        // Só o produto marcado "Validade obrigatória no recebimento" exige uma das três: a data, "sem validade" ou "não sei"
        // (o item entra e a validade fica pendente). Nos outros, a data é opcional e o "não sei" não cria pendência.
        // Antes, TODA linha exigia a data ou "indefinida" — e quem não sabia não conseguia receber.
        const produto = produtoDe.get(it.itemId);
        const obrigatoria = produto?.validadeObrigatoria === true;
        const pendente = obrigatoria && !!c.validadePendente && !c.validade && !c.validadeIndefinida;
        if ([!!c.validade, !!c.validadeIndefinida, !!c.validadePendente].filter(Boolean).length > 1)
          throw new BadRequestException(
            'A validade é uma das três: a data, "sem validade" ou "não sei" — só uma por linha.',
          );
        if (obrigatoria && !c.validade && !c.validadeIndefinida && !pendente)
          throw new BadRequestException(
            `"${produto?.nomeComercial || produto?.nome}" tem validade obrigatória: informe a data, marque "sem validade" ou "não sei".`,
          );

        // A marca que veio: a informada tem de ser do cadastro do produto; em branco, vale a pedida.
        const marcas: string[] = Array.isArray(produto?.marcas) ? (produto!.marcas as string[]) : [];
        const informada = limparNome(c.marcaRecebida);
        let marcaRecebida: string | null = null;
        if (marcas.length) {
          if (informada) {
            marcaRecebida = acharMarca(marcas, informada);
            if (!marcaRecebida)
              throw new BadRequestException(
                `"${informada}" não é marca cadastrada de "${produto?.nomeComercial || produto?.nome}". Marcas: ${marcas.join(', ')}.`,
              );
          } else marcaRecebida = it.marca ?? (marcas.length === 1 ? marcas[0] : null);
        }

        // VALOR DA NOTA (decisão do dono, 10/10/2026): a conferência informa o valor unitário que veio
        // na nota. Ele passa a ser o custo da linha — é o que entra no estoque, no custo médio e na
        // conta a pagar — e o que estava no pedido fica guardado ao lado, para comparação. Em
        // branco, vale o do pedido.
        const custoDoPedido = it.custoUnitario != null ? Number(it.custoUnitario) : null;
        const custoDaNota = c.custoUnitario != null ? Number(c.custoUnitario) : null;
        const custo = custoDaNota ?? custoDoPedido;
        const mudou = custoDaNota != null && custoDoPedido != null && Math.abs(custoDaNota - custoDoPedido) > 1e-9;

        // A conferência fica gravada na linha: é o histórico do que chegou (e a
        // memória que pré-preenche a próxima compra deste insumo).
        await tx
          .update(compraItem)
          .set({
            qtdRecebida: String(qtd),
            validade: c.validade ?? null,
            validadeIndefinida: !!c.validadeIndefinida,
            validadePendente: pendente,
            loteCodigo: c.loteCodigo?.trim() || null,
            marcaRecebida,
            fornecedorId: c.fornecedorId ?? null,
            ...(custoDaNota != null ? { custoUnitario: String(custoDaNota), custoPedido: mudou ? String(custoDoPedido) : null } : {}),
            divergencia: c.divergencia ?? this.divergenciaDe(pedida, qtd),
            updatedAt: new Date(),
          })
          .where(and(eq(compraItem.id, it.id), eq(compraItem.tenantId, tenantId)));

        const [mov] = await tx.insert(movimentoEstoque).values({
          tenantId,
          itemId: it.itemId,
          tipo: 'entrada',
          quantidade: String(qtd),
          custoUnitario: custo != null ? String(custo) : undefined,
          motivo: 'compra',
          refTipo: 'compra_item', // ref por LINHA: duas linhas do mesmo item não colidem
          refId: it.id,
          data,
        }).returning({ id: movimentoEstoque.id });

        // LOTE — só quando há o que rastrear: uma validade, um código de lote do fabricante ou a validade PENDENTE (o
        // lote recebe a data quando alguém informar). Sem nenhum dos três (o guardanapo sem código), a linha já diz
        // tudo pelo próprio `compra_item` e um lote vazio seria só ruído na tela.
        const codigo = c.loteCodigo?.trim() || null;
        if (c.validade || codigo || pendente) {
          await tx.insert(lote).values({
            tenantId,
            itemId: it.itemId,
            unidadeId: lista.unidadeId ?? null,
            fornecedorId: c.fornecedorId ?? lista.fornecedorId ?? null,
            compraItemId: it.id,
            codigo,
            validade: c.validade ?? null,
            validadeIndefinida: !!c.validadeIndefinida,
            validadePendente: pendente,
            quantidade: String(qtd),
            custoUnitario: custo != null ? String(custo) : undefined,
            entrada: data,
          });
        }

        if (custo != null) valorConferido += qtd * custo;
        const deOnde = c.fornecedorId ?? lista.fornecedorId ?? null;
        if (deOnde && custo != null) {
          valorPorFornecedor.set(deOnde, (valorPorFornecedor.get(deOnde) ?? 0) + qtd * custo);
          itensPorFornecedor.set(deOnde, (itensPorFornecedor.get(deOnde) ?? 0) + 1);
        }

        // Custo médio DA LOJA da lista (mig 257): a compra da loja A não mexe no custo da B.
        // O saldo "antes" sai da transação, então a 2ª linha do mesmo insumo na lista já
        // pondera sobre a 1ª (antes lia um saldo tirado fora da transação, antes do laço).
        if (custo != null) await ponderarCustoDaEntrada(tx, tenantId, mov.id, it.itemId, qtd, custo);
      }

      // CONTA A PAGAR — `compras.receber()` entrava com a mercadoria e não gerava
      // dívida nenhuma: só o `recebimento.confirmar()` gerava, e aquele fluxo tem ZERO
      // notas na base. O fornecedor e o valor já estavam na mão o tempo todo.
      //
      // O valor usa a quantidade CONFERIDA, nunca a pedida: pagar 10 caixas quando
      // chegaram 7 é o mesmo erro do estoque, do lado do dinheiro.
      // UMA POR FORNECEDOR (P2, PR-5): a lista de compras do mercado vira uma conta por lugar de onde veio. A linha sem
      // fornecedor (nem dela, nem do pedido) não gera conta, como antes. `valorConferido` continua o total da tela.
      const contas = opcoes.semConta ? [] : [...valorPorFornecedor.entries()].filter(([, v]) => v > 0);
      for (const [fornecedorDaConta, valorDaConta] of contas) {
        // Data de pagamento (decisão do dono): a da conferência vence a da criação;
        // sem nenhuma das duas, o prazo do fornecedor a partir do recebimento. Título
        // sem vencimento não entra em alerta de contas a pagar e some do radar.
        let vencimento = dto?.vencimento ?? lista.vencimento ?? null;
        if (!vencimento) {
          const [f] = await tx
            .select({ prazo: fornecedor.prazoPagamentoDias })
            .from(fornecedor)
            .where(and(eq(fornecedor.id, fornecedorDaConta), eq(fornecedor.tenantId, tenantId)));
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
          descricao: `Compra: ${lista.nome}${contas.length > 1 ? ` (${itensPorFornecedor.get(fornecedorDaConta)} ${itensPorFornecedor.get(fornecedorDaConta) === 1 ? 'item' : 'itens'})` : ''}${notaRef ? ` · nota ${notaRef}` : ''}`,
          categoria: 'fornecedor',
          fornecedorId: fornecedorDaConta,
          valor: String(valorDaConta.toFixed(2)),
          vencimento: vencimento ?? undefined,
          origem: 'compra',
          origemId: id,
          criadoPorId: atorId ?? undefined,
        });
      }

      await tx
        .update(compraLista)
        .set({ status: 'recebida', recebidaEm: new Date(), notaRef })
        .where(and(eq(compraLista.id, id), eq(compraLista.tenantId, tenantId)));
      return { ...lista, itens: itens.length, comFalta, contas: contas.length, valorConferido };
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
      detalhe: { nome: lista.nome, itens: lista.itens, itensComFalta: lista.comFalta, contasAPagar: lista.contas },
    });

    // Com a LOJA da lista (ERR-494): a compra entra no estoque de uma loja; sem ela o aviso ia a todas as lojas da rede.
    if (lista.enviarKds)
      this.events.emit('kds.alerta.sistema', {
        tenantId,
        unidadeId: lista.unidadeId ?? null,
        titulo: `Compra recebida: ${lista.nome}`,
        detalhe: 'Itens entraram no estoque.',
        prioridade: 'baixa',
        tipo: 'gestao', // aviso de gestão: as telas de preparo não recebem por padrão (mig 408)
      });
    // `itensComFalta`: a tela oferece na hora "gerar lista com o que faltou".
    return { ok: true, itensComFalta: lista.comFalta, contasAPagar: lista.contas };
  }

  /**
   * "Informar a validade" (P1 de "Pedidos e recebimento", mig 504): a linha recebida com "não sei" ganha a data ou "sem
   * validade", e o lote dela também. Trava a linha (`for update`) e só mexe se ainda estiver pendente: duas pessoas juntas
   * informam uma vez. As duas tabelas sincronizam pelo `updated_at` (V91), por isso ele anda nas duas.
   */
  async informarValidade(
    tenantId: string,
    listaId: string,
    compraItemId: string,
    dto: { validade?: string; validadeIndefinida?: boolean },
    atual: string | null = null,
    atorId?: string | null,
  ) {
    const validade = dto?.validade || null;
    const indefinida = dto?.validadeIndefinida === true;
    if (!validade && !indefinida) throw new BadRequestException('Informe a data da validade, ou marque "sem validade".');
    if (validade && indefinida) throw new BadRequestException('Ou a validade tem data, ou é "sem validade" — não os dois.');
    const r = await this.db.transaction(async (tx) => {
      const [lista] = await tx
        .select({ id: compraLista.id, nome: compraLista.nome })
        .from(compraLista)
        .where(and(eq(compraLista.id, listaId), eq(compraLista.tenantId, tenantId), isNull(compraLista.deletedAt), condUnidadeOuRede(compraLista.unidadeId, atual)));
      if (!lista) throw new NotFoundException('Pedido não encontrado');
      const [linha] = await tx
        .select({ id: compraItem.id, itemId: compraItem.itemId, pendente: compraItem.validadePendente })
        .from(compraItem)
        .where(and(eq(compraItem.id, compraItemId), eq(compraItem.listaId, listaId), eq(compraItem.tenantId, tenantId)))
        .for('update');
      if (!linha) throw new NotFoundException('Item do pedido não encontrado');
      if (!linha.pendente) throw new BadRequestException('A validade deste item já foi informada.');
      const agora = new Date();
      await tx
        .update(compraItem)
        .set({ validade, validadeIndefinida: indefinida, validadePendente: false, updatedAt: agora })
        .where(and(eq(compraItem.id, compraItemId), eq(compraItem.tenantId, tenantId)));
      await tx
        .update(lote)
        .set({ validade, validadeIndefinida: indefinida, validadePendente: false, updatedAt: agora })
        .where(and(eq(lote.compraItemId, compraItemId), eq(lote.tenantId, tenantId)));
      return { lista, itemId: linha.itemId };
    });
    await this.auditoria.registrar({
      tenantId,
      atorId: atorId ?? null,
      atorPerfil: '',
      tipo: 'estoque',
      acao: 'informou_validade',
      entidadeTipo: 'compra_item',
      entidadeId: compraItemId,
      detalhe: { pedido: r.lista.nome, validade, semValidade: indefinida },
    });
    return { ok: true, validade, validadeIndefinida: indefinida };
  }

  /**
   * Versão 10, C1b (o Mister): o item que veio a mais na entrega e que a pessoa disse que é do pedido entra NELE antes do
   * recebimento (sem isto ia pelo recebimento avulso, fora do pedido). Só no pedido ainda aberto, com o insumo desta empresa;
   * o insumo que já está no pedido não entra de novo. A linha nova é conferida no recebimento como as outras.
   */
  async adicionarAoPedido(
    tenantId: string,
    id: string,
    itens: Array<{ itemId: string; quantidade: number }>,
    atual: string | null = null,
    atorId?: string | null,
  ): Promise<{ adicionados: number }> {
    const validos = itens.filter((i) => i.itemId && Number.isFinite(i.quantidade) && i.quantidade > 0);
    if (!validos.length) return { adicionados: 0 };
    const r = await this.db.transaction(async (tx) => {
      const [lista] = await tx
        .select({ id: compraLista.id, status: compraLista.status })
        .from(compraLista)
        .where(and(eq(compraLista.id, id), eq(compraLista.tenantId, tenantId), isNull(compraLista.deletedAt), condUnidadeOuRede(compraLista.unidadeId, atual)))
        .for('update');
      if (!lista) throw new NotFoundException('Pedido não encontrado');
      if (lista.status === 'recebida') throw new BadRequestException('Compra já recebida.');
      const daEmpresa = new Set(
        (
          await tx
            .select({ id: itemEstoque.id })
            .from(itemEstoque)
            .where(and(eq(itemEstoque.tenantId, tenantId), isNull(itemEstoque.deletedAt), inArray(itemEstoque.id, validos.map((i) => i.itemId))))
        ).map((x) => x.id),
      );
      const ja = new Set(
        (await tx.select({ itemId: compraItem.itemId }).from(compraItem).where(and(eq(compraItem.listaId, id), eq(compraItem.tenantId, tenantId)))).map((x) => x.itemId),
      );
      const novos = validos.filter((i) => daEmpresa.has(i.itemId) && !ja.has(i.itemId));
      if (novos.length) await tx.insert(compraItem).values(novos.map((i) => ({ tenantId, listaId: id, itemId: i.itemId, quantidade: String(Math.round(i.quantidade * 10000) / 10000) })));
      return novos;
    });
    if (r.length)
      await this.auditoria.registrar({
        tenantId,
        atorId: atorId ?? null,
        atorPerfil: '',
        tipo: 'estoque',
        acao: 'adicionou_ao_pedido',
        entidadeTipo: 'compra_lista',
        entidadeId: id,
        detalhe: { itens: r.map((i) => ({ itemId: i.itemId, quantidade: i.quantidade })), pelo: 'mister' },
      });
    return { adicionados: r.length };
  }

  // "Gerar lista com o que faltou" (decisão do dono, 09/10/2026). A lista recebida fecha como
  // está; o que não veio — a linha inteira ou só uma parte — vira uma lista NOVA, com o mesmo
  // fornecedor, o mesmo responsável e as mesmas marcas (1ª e 2ª opção). Uma só por lista de
  // origem: a tabela sincroniza nos dois sentidos e por isso não leva índice único (ERR-159) —
  // a origem é travada na transação e o segundo pedido devolve a lista que já existe.
  async gerarListaDoQueFaltou(
    tenantId: string,
    id: string,
    dto: GerarFaltanteDto | undefined,
    atual: string | null = null,
    atorId?: string | null,
    // Versão 10, C1b (o Mister): só os itens que a pessoa disse que ainda chegam — o que foi cancelado não volta a ser pedido.
    // A tela não manda: o pedido do que faltou continua com tudo o que faltou.
    opcoes: { apenasItens?: string[] } = {},
  ) {
    const r = await this.db.transaction(async (tx) => {
      const [origem] = await tx
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
      if (!origem) throw new NotFoundException('Pedido não encontrado');
      if (origem.status !== 'recebida')
        throw new BadRequestException('O pedido do que faltou só existe depois de conferir e receber a compra.');

      // A mais recente, se por acaso houver mais de uma (criada igual na loja e na nuvem).
      const [existente] = await tx
        .select({ id: compraLista.id, nome: compraLista.nome })
        .from(compraLista)
        .where(and(eq(compraLista.tenantId, tenantId), eq(compraLista.origemListaId, id), isNull(compraLista.deletedAt)))
        .orderBy(desc(compraLista.createdAt))
        .limit(1);
      if (existente) return { ...existente, itens: 0, jaExistia: true, semProduto: 0 };

      // A falta sai da conta feita no banco (numeric): 10 − 9,7 não vira 0,30000000000000004.
      const linhas = await tx
        .select({
          itemId: compraItem.itemId,
          falta: sql<string>`(${compraItem.quantidade} - coalesce(${compraItem.qtdRecebida}, 0))`,
          custoUnitario: compraItem.custoUnitario,
          marca: compraItem.marca,
          marcaAlternativa: compraItem.marcaAlternativa,
          produtoVivo: sql<boolean>`(${itemEstoque.id} is not null and ${itemEstoque.deletedAt} is null)`,
        })
        .from(compraItem)
        .leftJoin(itemEstoque, eq(compraItem.itemId, itemEstoque.id))
        .where(and(eq(compraItem.listaId, id), eq(compraItem.tenantId, tenantId)));
      const escolhidos = opcoes.apenasItens ? new Set(opcoes.apenasItens) : null;
      const faltas = linhas.filter((l) => Number(l.falta) > 0 && (!escolhidos || escolhidos.has(l.itemId)));
      if (!faltas.length)
        throw new BadRequestException('Não faltou nada neste pedido: tudo o que foi pedido chegou.');
      // Produto excluído do estoque depois da compra não volta para uma lista nova.
      const vivas = faltas.filter((l) => l.produtoVivo);
      if (!vivas.length)
        throw new BadRequestException('Os produtos que faltaram foram excluídos do estoque: não há o que pedir de novo.');

      const PREFIXO = 'Faltou de: ';
      const nome = (origem.nome.startsWith(PREFIXO) ? origem.nome : PREFIXO + origem.nome).slice(0, 160);
      const [nova] = await tx
        .insert(compraLista)
        .values({
          tenantId,
          unidadeId: origem.unidadeId,
          nome,
          fornecedorId: origem.fornecedorId,
          dataRecebimento: dto?.dataRecebimento || null,
          delegadoId: origem.delegadoId,
          enviarKds: origem.enviarKds,
          enviarDashboard: origem.enviarDashboard,
          origemListaId: origem.id,
        })
        .returning();
      await tx.insert(compraItem).values(
        vivas.map((l) => ({
          tenantId,
          listaId: nova.id,
          itemId: l.itemId,
          quantidade: String(l.falta),
          custoUnitario: l.custoUnitario ?? undefined,
          marca: l.marca,
          marcaAlternativa: l.marcaAlternativa,
        })),
      );
      return { id: nova.id, nome: nova.nome, itens: vivas.length, jaExistia: false, semProduto: faltas.length - vivas.length };
    });

    if (!r.jaExistia)
      await this.auditoria.registrar({
        tenantId,
        atorId: atorId ?? null,
        atorPerfil: '',
        tipo: 'estoque',
        acao: 'gerou_lista_do_que_faltou',
        entidadeTipo: 'compra_lista',
        entidadeId: r.id,
        detalhe: { nome: r.nome, origem: id, itens: r.itens },
      });
    return r;
  }

  // ENVIAR AO FORNECEDOR (decisão do dono, 10/10/2026). O sistema NÃO envia sozinho: devolve o
  // pedido em texto e os links que abrem o WhatsApp e o e-mail de quem está usando, já escritos —
  // a pessoa confere e toca em enviar. Sem fornecedor (não é obrigatório direcionar o pedido) ou
  // sem contato no cadastro, vem só o texto, para copiar e mandar por onde preferir.
  async pedidoParaEnviar(tenantId: string, id: string, atual: string | null = null) {
    const lista: any = await this.getLista(tenantId, id, atual, false);
    const [f] = lista.fornecedorId
      ? await this.db
          .select({ nome: fornecedor.nome, contato: fornecedor.contato, telefone: fornecedor.telefone, email: fornecedor.email })
          .from(fornecedor)
          .where(and(eq(fornecedor.id, lista.fornecedorId), eq(fornecedor.tenantId, tenantId)))
      : [];
    // Quem assina o pedido: a loja da lista; na empresa de uma loja só (lista sem loja), a empresa.
    const [loja] = lista.unidadeId
      ? await this.db.select({ nome: unidade.nome }).from(unidade).where(and(eq(unidade.id, lista.unidadeId), eq(unidade.tenantId, tenantId)))
      : await this.db.select({ nome: empresa.nome }).from(empresa).where(eq(empresa.id, tenantId));
    const dados = {
      loja: loja?.nome ?? '',
      pedido: lista.nome,
      fornecedor: f?.nome ?? null,
      contato: f?.contato ?? null,
      entrega: lista.dataRecebimento ?? null,
      itens: lista.itens,
    };
    const texto = textoDoPedido(dados);
    const assunto = assuntoDoPedido(dados);
    const numero = telefoneParaWhatsapp(f?.telefone);
    const email = emailParaEnvio(f?.email);
    return {
      id: lista.id,
      nome: lista.nome,
      status: lista.status,
      texto,
      assunto,
      fornecedor: f ? { nome: f.nome, contato: f.contato ?? null, telefone: f.telefone ?? null, email: f.email ?? null } : null,
      whatsapp: numero ? linkDoWhatsapp(numero, texto) : null,
      email: email ? linkDoEmail(email, assunto, textoDoPedido(dados, false)) : null,
      enviadoEm: lista.enviadoEm ?? null,
      enviadoCanal: lista.enviadoCanal ?? null,
    };
  }

  // "Marcar como enviado": é a PESSOA quem diz que enviou (o sistema só abriu o aplicativo dela —
  // não tem como saber se a mensagem saiu). Fica no pedido quando e por onde, e na auditoria quem.
  /**
   * P4 de "Pedidos e recebimento" (a decisão do dono, 25/11: "ao receber pedido, perguntar se é para lançar no estoque"): o
   * pedido recebido pela nota do Mister com "Não" — fica RECEBIDO sem mexer no estoque (nem movimento, nem lote, nem custo,
   * nem conta: a despesa é a da nota). As linhas ficam sem conferência. A gravação confere de novo que não foi recebido.
   */
  async marcarRecebidoSemEstoque(tenantId: string, id: string, atual: string | null = null, atorId?: string | null, notaRef?: string | null) {
    const [antes] = await this.db
      .select({ id: compraLista.id, status: compraLista.status, nome: compraLista.nome })
      .from(compraLista)
      .where(and(eq(compraLista.id, id), eq(compraLista.tenantId, tenantId), isNull(compraLista.deletedAt), condUnidadeOuRede(compraLista.unidadeId, atual)));
    if (!antes) throw new NotFoundException('Pedido não encontrado');
    if (antes.status === 'recebida') throw new BadRequestException('Compra já recebida.');
    const agora = new Date();
    const nota = limparNome(notaRef) || null;
    const [feito] = await this.db
      .update(compraLista)
      .set({ status: 'recebida', recebidaEm: agora, updatedAt: agora, ...(nota ? { notaRef: nota } : {}) })
      .where(and(eq(compraLista.id, id), eq(compraLista.tenantId, tenantId), isNull(compraLista.deletedAt), ne(compraLista.status, 'recebida')))
      .returning({ id: compraLista.id });
    if (!feito) throw new BadRequestException('Compra já recebida.');
    await this.auditoria.registrar({
      tenantId,
      atorId: atorId ?? null,
      atorPerfil: '',
      tipo: 'estoque',
      acao: 'recebeu_pedido_sem_estoque',
      entidadeTipo: 'compra_lista',
      entidadeId: id,
      detalhe: { nome: antes.nome, notaRef: nota },
    });
    return { ok: true };
  }

  /**
   * P4 de "Pedidos e recebimento" (PR-8: "a nota sem pedido vira um pedido já recebido em Estoque › Pedidos — tudo num lugar
   * só"): o pedido nasce com as linhas da nota e é recebido na hora pelo MESMO `receber` (estoque, custo médio, lote; a conta
   * não — a despesa é a da nota). Diferenças da criação pela tela, porque é o registro do que CHEGOU, não um pedido a mandar:
   * a marca não é exigida (a nota não diz qual é); não vai ao KDS nem ao painel; o insumo repetido na nota vira uma linha só.
   * Se o recebimento recusa, o pedido criado sai (não sobra pedido aberto que ninguém fez).
   */
  async registrarPedidoRecebido(
    tenantId: string,
    dados: { nome: string; fornecedorId: string | null; dataRecebimento: string | null; notaRef: string | null; itens: { itemId: string; quantidade: number; custoUnitario?: number }[] },
    atual: string | null = null,
    atorId?: string | null,
  ): Promise<{ id: string; nome: string; itens: number; pendentes: string[] }> {
    const porInsumo = new Map<string, { quantidade: number; total: number; comValor: boolean }>();
    for (const i of dados.itens) {
      if (!(i.quantidade > 0)) continue;
      const a = porInsumo.get(i.itemId) ?? { quantidade: 0, total: 0, comValor: true };
      a.quantidade += i.quantidade;
      if (i.custoUnitario != null && i.custoUnitario > 0) a.total += i.custoUnitario * i.quantidade;
      else a.comValor = false;
      porInsumo.set(i.itemId, a);
    }
    if (!porInsumo.size) throw new BadRequestException('A nota não tem item para dar entrada.');
    const ids = [...porInsumo.keys()];
    const daEmpresa = await this.db
      .select({ id: itemEstoque.id })
      .from(itemEstoque)
      .where(and(eq(itemEstoque.tenantId, tenantId), inArray(itemEstoque.id, ids), isNull(itemEstoque.deletedAt)));
    if (daEmpresa.length !== ids.length) throw new BadRequestException('Um item da nota não está mais no estoque desta empresa.');
    const nome = (limparNome(dados.nome) || 'Nota sem pedido').slice(0, 120);
    const lista = await this.db.transaction(async (tx) => {
      const [l] = await tx
        .insert(compraLista)
        .values({
          tenantId,
          unidadeId: atual,
          nome,
          fornecedorId: dados.fornecedorId,
          dataRecebimento: dados.dataRecebimento,
          enviarKds: false,
          enviarDashboard: false,
        })
        .returning({ id: compraLista.id });
      await tx.insert(compraItem).values(
        ids.map((itemId) => {
          const a = porInsumo.get(itemId)!;
          const q = Math.round(a.quantidade * 10000) / 10000;
          return { tenantId, listaId: l.id, itemId, quantidade: String(q), custoUnitario: a.comValor && a.total > 0 ? String(Math.round((a.total / q) * 10000) / 10000) : undefined };
        }),
      );
      return l;
    });
    const linhas = await this.db
      .select({ id: compraItem.id, quantidade: compraItem.quantidade })
      .from(compraItem)
      .where(and(eq(compraItem.listaId, lista.id), eq(compraItem.tenantId, tenantId)));
    try {
      await this.receber(
        tenantId,
        lista.id,
        atorId,
        { itens: linhas.map((l) => ({ compraItemId: l.id, qtdRecebida: Number(l.quantidade), validadePendente: true })), notaRef: dados.notaRef ?? undefined } as any,
        atual,
        { semConta: true },
      );
    } catch (e) {
      await this.db.update(compraLista).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(compraLista.id, lista.id), eq(compraLista.tenantId, tenantId)));
      throw e;
    }
    // A validade obrigatória ficou pendente (a nota não traz a data): o aviso da P1 pergunta depois.
    const pendentes = await this.db
      .select({ nome: itemEstoque.nome, nomeComercial: itemEstoque.nomeComercial })
      .from(compraItem)
      .innerJoin(itemEstoque, eq(itemEstoque.id, compraItem.itemId))
      .where(and(eq(compraItem.listaId, lista.id), eq(compraItem.tenantId, tenantId), eq(compraItem.validadePendente, true)));
    return { id: lista.id, nome, itens: linhas.length, pendentes: pendentes.map((p) => p.nomeComercial || p.nome) };
  }

  /**
   * P3 de "Pedidos e recebimento" (25/11): a nova previsão de recebimento de um pedido ainda não recebido — o "Mudar a previsão"
   * do aviso do pedido atrasado do Mister. A gravação confere de novo que não foi recebido (o recebimento no meio não muda a data).
   */
  async mudarPrevisao(tenantId: string, id: string, previsao: string, atual: string | null = null, atorId?: string | null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(previsao) || Number.isNaN(Date.parse(`${previsao}T12:00:00Z`))) throw new BadRequestException('Previsão de recebimento inválida.');
    const [antes] = await this.db
      .select({ id: compraLista.id, status: compraLista.status, nome: compraLista.nome, previsao: compraLista.dataRecebimento })
      .from(compraLista)
      .where(and(eq(compraLista.id, id), eq(compraLista.tenantId, tenantId), isNull(compraLista.deletedAt), condUnidadeOuRede(compraLista.unidadeId, atual)));
    if (!antes) throw new NotFoundException('Pedido não encontrado');
    const recebido = 'Este pedido já foi recebido: a previsão não muda mais.';
    if (antes.status === 'recebida') throw new BadRequestException(recebido);
    const [feito] = await this.db
      .update(compraLista)
      .set({ dataRecebimento: previsao, updatedAt: new Date() })
      .where(and(eq(compraLista.id, id), eq(compraLista.tenantId, tenantId), isNull(compraLista.deletedAt), ne(compraLista.status, 'recebida')))
      .returning({ id: compraLista.id });
    if (!feito) throw new BadRequestException(recebido);
    await this.auditoria.registrar({
      tenantId,
      atorId: atorId ?? null,
      atorPerfil: '',
      tipo: 'estoque',
      acao: 'mudou_previsao_pedido',
      entidadeTipo: 'compra_lista',
      entidadeId: id,
      detalhe: { nome: antes.nome, de: antes.previsao ?? null, para: previsao },
    });
    return { ok: true, dataRecebimento: previsao };
  }

  async marcarEnviado(tenantId: string, id: string, canal: string, atual: string | null = null, atorId?: string | null) {
    if (canal !== 'whatsapp' && canal !== 'email') throw new BadRequestException('Canal de envio desconhecido.');
    const [antes] = await this.db
      .select({ id: compraLista.id, status: compraLista.status, nome: compraLista.nome })
      .from(compraLista)
      .where(
        and(
          eq(compraLista.id, id),
          eq(compraLista.tenantId, tenantId),
          isNull(compraLista.deletedAt),
          condUnidadeOuRede(compraLista.unidadeId, atual),
        ),
      );
    if (!antes) throw new NotFoundException('Pedido não encontrado');
    if (antes.status === 'recebida') throw new BadRequestException('Este pedido já foi recebido: não há o que enviar.');
    const agora = new Date();
    await this.db
      .update(compraLista)
      .set({ enviadoEm: agora, enviadoCanal: canal, updatedAt: agora })
      .where(and(eq(compraLista.id, id), eq(compraLista.tenantId, tenantId)));
    await this.auditoria.registrar({
      tenantId,
      atorId: atorId ?? null,
      atorPerfil: '',
      tipo: 'estoque',
      acao: 'marcou_pedido_enviado',
      entidadeTipo: 'compra_lista',
      entidadeId: id,
      detalhe: { nome: antes.nome, canal },
    });
    return { ok: true, enviadoEm: agora.toISOString(), enviadoCanal: canal };
  }
}
