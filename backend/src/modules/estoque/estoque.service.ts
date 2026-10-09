import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, isNotNull, isNull, desc, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  itemEstoque,
  itemFornecedor,
  movimentoEstoque,
  alertaEstoque,
  categoriaItem,
  itemConversao,
  fichaIngrediente,
  fornecedor,
  setor,
  produto,
  opcao,
  complementoOpcao,
} from '../../db/schema';
import { arredondarEstoque, CASAS_INFORMADO, chaveUnidade, fatorParaEstoque, type Conversao } from '../../common/conversao-unidade';
import { chaveNome, limparMarcas, limparNome } from './produto-nome';
import { apelidosDeUnidade, exigirUnidade, normalizarUnidade, UNIDADES_ESTOQUE } from './unidades';
import { CreateItemDto } from './dto/create-item.dto';
import { CreateMovimentoDto } from './dto/create-movimento.dto';
import { furoCmv } from '../../common/regras-negocio';
import { hojeISO, somarDias } from '../../common/data';
import { exigirLojaParaLancar } from '../../common/loja-lancamento';
import {
  contarLojas,
  gravarEstoqueMinimoDaLoja,
  sqlCustoDaLoja,
  sqlDiasSegurancaDaLoja,
  sqlLojasDoItem,
  sqlMinimoDaLoja,
} from '../../common/custo-loja';
import { sqlUnidade, sqlUnidadeOuRede, condUnidade, condUnidadeOuRede } from '../../common/filtro-unidade';
import { AuditoriaService } from '../auditoria/auditoria.service';

// Ator da operação (para auditoria) — vem do @CurrentUser do controller.
type Ator = { colaboradorId?: string; categoria?: string };

@Injectable()
export class EstoqueService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  async createItem(
    tenantId: string,
    dto: CreateItemDto,
    atual: string | null = null,
    ator?: Ator,
  ) {
    const nome = limparNome(dto.nome);
    if (!nome) throw new BadRequestException('Dê um nome ao produto.');
    // Unidade da LISTA (unidades.ts): "L" vira litro, texto fora dela é recusado.
    const unidadeMedida =
      dto.unidadeMedida === undefined ? 'unidade' : exigirUnidade(dto.unidadeMedida, 'Unidade principal');
    const conversoes = this.validarConversoes(dto.conversoes);
    // Usuário de loja (ou presidente com filial escolhida) grava sempre na
    // unidade atual; o dto só vale quando não há unidade no contexto.
    const unidadeId = atual ?? dto.unidadeId ?? null;
    // Fornecedor principal: 1º da lista N:N, ou o campo legado.
    const principal = dto.fornecedorIds?.length ? dto.fornecedorIds[0] : dto.fornecedorId;
    const row = await this.db.transaction(async (tx) => {
      await this.travarNomes(tx, tenantId);
      await this.exigirNomeLivre(tx, tenantId, nome, unidadeId);
      const setores = await this.resolverSetores(tx, tenantId, dto);
      const [novo] = await tx
        .insert(itemEstoque)
        .values({
          tenantId,
          unidadeId: unidadeId ?? undefined,
          nome,
          nomeComercial: limparNome(dto.nomeComercial) || null,
          marcas: limparMarcas(dto.marcas),
          unidadeMedida,
          estoqueMinimo:
            dto.estoqueMinimo != null ? String(dto.estoqueMinimo) : undefined,
          categoria: dto.categoria,
          fornecedorId: principal,
          categoriaItemId: dto.categoriaItemId,
          setorId: setores?.setorId ?? undefined,
          setoresExtras: setores?.setoresExtras ?? [],
          validade: dto.validade || undefined,
          validadeAbertoDias: dto.validadeAbertoDias ?? undefined,
        })
        .returning();
      await this.gravarConversoes(tx, tenantId, novo.id, conversoes);
      await this.gravarFornecedores(tx, tenantId, novo.id, dto.fornecedorIds, dto.fornecedorId);
      return novo;
    });
    // Auditoria: insumo criado.
    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.colaboradorId,
      atorPerfil: ator?.categoria,
      tipo: 'estoque',
      acao: 'item_criado',
      entidadeTipo: 'item_estoque',
      entidadeId: row.id,
      origem: 'web',
    });
    return row;
  }

  // Nome de produto não se repete. Não há índice único no banco de propósito: o cadastro
  // sincroniza nos dois sentidos, e um índice faria o sync recusar para sempre o produto criado
  // com o mesmo nome na loja e na nuvem. A trava é da TRANSAÇÃO e por empresa (mesma técnica da
  // auditoria; chave 1 = cadastro de produto): sem ela, duas gravações simultâneas passariam as
  // duas pela conferência. Some sozinha no commit ou no rollback. (Pública: a importação de
  // planilha grava produtos por outro caminho e usa a mesma trava.)
  async travarNomes(tx: any, tenantId: string) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${tenantId}), 1)`);
  }

  // Recusa (409) o nome que já existe — sem diferenciar maiúscula, acento, espaço e pontuação.
  // Produto exclusivo de uma loja só esbarra nos da própria loja e nos compartilhados; o
  // compartilhado esbarra em todos (é o cadastro que as lojas enxergam).
  private async exigirNomeLivre(
    tx: any,
    tenantId: string,
    nome: string,
    unidadeId: string | null,
    ignorarId?: string,
  ) {
    const outros: { id: string; nome: string; unidadeId: string | null }[] = await tx
      .select({ id: itemEstoque.id, nome: itemEstoque.nome, unidadeId: itemEstoque.unidadeId })
      .from(itemEstoque)
      .where(and(eq(itemEstoque.tenantId, tenantId), isNull(itemEstoque.deletedAt)));
    const chave = chaveNome(nome);
    const igual = outros.find(
      (o) =>
        o.id !== ignorarId &&
        chaveNome(o.nome) === chave &&
        (o.unidadeId == null || unidadeId == null || o.unidadeId === unidadeId),
    );
    if (igual) throw new ConflictException(`Já existe um produto com este nome: "${igual.nome}".`);
  }

  // Setores de estoque do produto (mig 307). `setorIds` (lista: o 1º é o principal) ou, na
  // ausência, o campo legado `setorId` — que mexe só no principal e mantém os demais.
  // Nenhum dos dois = não mexe (null). Setor de outra empresa ou excluído é recusado.
  private async resolverSetores(
    tx: any,
    tenantId: string,
    dto: { setorId?: string; setorIds?: string[] },
  ): Promise<{ setorId: string | null; setoresExtras?: string[] } | null> {
    if (dto.setorIds === undefined && dto.setorId === undefined) return null;
    const ids =
      dto.setorIds !== undefined
        ? [...new Set(dto.setorIds.filter(Boolean))]
        : dto.setorId
          ? [dto.setorId]
          : [];
    if (ids.length) {
      const achados = await tx
        .select({ id: setor.id })
        .from(setor)
        .where(and(eq(setor.tenantId, tenantId), inArray(setor.id, ids), isNull(setor.deletedAt)));
      if (achados.length !== ids.length)
        throw new BadRequestException('Setor de estoque não encontrado. Atualize a tela e escolha de novo.');
    }
    return dto.setorIds !== undefined
      ? { setorId: ids[0] ?? null, setoresExtras: ids.slice(1) }
      : { setorId: ids[0] ?? null };
  }

  // Replace-all dos fornecedores (N:N) de um insumo. Aceita a lista nova (fornecedorIds)
  // ou, na ausência, o campo legado (fornecedorId). Só grava quando algum é informado.
  private async gravarFornecedores(
    tx: any,
    tenantId: string,
    itemId: string,
    fornecedorIds?: string[],
    legado?: string,
  ) {
    if (fornecedorIds === undefined && legado === undefined) return; // nada a mexer
    const ids = [...new Set((fornecedorIds ?? (legado ? [legado] : [])).filter(Boolean))];
    await tx
      .delete(itemFornecedor)
      .where(and(eq(itemFornecedor.tenantId, tenantId), eq(itemFornecedor.itemId, itemId)));
    if (ids.length)
      await tx
        .insert(itemFornecedor)
        .values(ids.map((fornecedorId) => ({ tenantId, itemId, fornecedorId })))
        .onConflictDoNothing();
  }

  // Edita um insumo (campos + conversões replace-all).
  async updateItem(
    tenantId: string,
    id: string,
    dto: CreateItemDto,
    atual: string | null = null,
    ator?: Ator,
  ) {
    // Estoque mínimo é DA LOJA numa empresa de duas lojas (mig 257):
    //  • com loja escolhida, grava o da loja — inclusive em insumo de cadastro compartilhado,
    //    em que a loja não edita o cadastro (continua só do dono do cadastro), só o mínimo dela;
    //  • em "todas", a tela mostra a SOMA das lojas e trava o campo; o valor que vier é
    //    ignorado para não gravar a soma como mínimo do cadastro.
    // Empresa de uma loja: segue no cadastro, como sempre.
    const lojas = await contarLojas(this.db, tenantId);
    const minimoDaLoja = lojas > 1 && !!atual && dto.estoqueMinimo != null;
    if (minimoDaLoja) {
      const [alvo] = await this.db
        .select({ id: itemEstoque.id, unidadeId: itemEstoque.unidadeId })
        .from(itemEstoque)
        .where(
          and(
            eq(itemEstoque.id, id),
            eq(itemEstoque.tenantId, tenantId),
            condUnidadeOuRede(itemEstoque.unidadeId, atual),
            isNull(itemEstoque.deletedAt),
          ),
        );
      if (!alvo) throw new NotFoundException('Item não encontrado');
      await gravarEstoqueMinimoDaLoja(this.db, tenantId, id, atual!, Number(dto.estoqueMinimo));
      if (alvo.unidadeId == null) {
        await this.auditoria.registrar({
          tenantId,
          atorId: ator?.colaboradorId,
          atorPerfil: ator?.categoria,
          tipo: 'estoque',
          acao: 'item_minimo_loja',
          entidadeTipo: 'item_estoque',
          entidadeId: id,
          detalhe: { unidadeId: atual, estoqueMinimo: Number(dto.estoqueMinimo) },
          origem: 'web',
        });
        const [row] = await this.db.select().from(itemEstoque).where(eq(itemEstoque.id, id));
        return { ...row, estoqueMinimo: String(dto.estoqueMinimo) };
      }
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    const nome = dto.nome !== undefined ? limparNome(dto.nome) : undefined;
    if (nome !== undefined) {
      if (!nome) throw new BadRequestException('Dê um nome ao produto.');
      patch.nome = nome;
    }
    // Nome comercial e marcas (mig 311): ausente mantém; vazio limpa.
    if (dto.nomeComercial !== undefined) patch.nomeComercial = limparNome(dto.nomeComercial) || null;
    if (dto.marcas !== undefined) patch.marcas = limparMarcas(dto.marcas);
    if (dto.unidadeMedida !== undefined)
      patch.unidadeMedida = exigirUnidade(dto.unidadeMedida, 'Unidade principal');
    const conversoes = this.validarConversoes(dto.conversoes);
    if (dto.estoqueMinimo != null && lojas <= 1) patch.estoqueMinimo = String(dto.estoqueMinimo);
    if (dto.categoria !== undefined) patch.categoria = dto.categoria;
    // Fornecedor principal segue o 1º da lista N:N (quando enviada); senão o campo legado.
    if (dto.fornecedorIds !== undefined) patch.fornecedorId = dto.fornecedorIds[0] ?? null;
    else if (dto.fornecedorId !== undefined) patch.fornecedorId = dto.fornecedorId || null;
    if (dto.categoriaItemId !== undefined)
      patch.categoriaItemId = dto.categoriaItemId || null;
    if (dto.validade !== undefined) patch.validade = dto.validade || null;
    if (dto.validadeAbertoDias !== undefined) patch.validadeAbertoDias = dto.validadeAbertoDias ?? null;
    const doItem = and(
      eq(itemEstoque.id, id),
      eq(itemEstoque.tenantId, tenantId),
      condUnidade(itemEstoque.unidadeId, atual), // só edita item da própria unidade
      isNull(itemEstoque.deletedAt),
    );
    let fichasAjustadas = 0;
    let vinculosAjustados = 0;
    const row = await this.db.transaction(async (tx) => {
      // Como o produto estava antes (unidade e conversões): as linhas de ficha que usam uma
      // unidade convertida dele dependem disso — ver `reconverterFichas`.
      const mexeNaUnidade = !!conversoes || patch.unidadeMedida !== undefined;
      const [velho] = mexeNaUnidade
        ? await tx.select({ unidade: itemEstoque.unidadeMedida }).from(itemEstoque).where(doItem)
        : [];
      const conversoesVelhas: Conversao[] = velho
        ? await tx
            .select({ unidadeDe: itemConversao.unidadeDe, fator: itemConversao.fator, unidadePara: itemConversao.unidadePara })
            .from(itemConversao)
            .where(and(eq(itemConversao.tenantId, tenantId), eq(itemConversao.itemId, id)))
        : [];
      if (nome !== undefined) {
        // Só confere o nome quando ele MUDA: produto que já estava repetido antes desta regra
        // continua editável (para o dono poder arrumar), mas ninguém vira repetido por edição.
        await this.travarNomes(tx, tenantId);
        const [antes] = await tx
          .select({ nome: itemEstoque.nome, unidadeId: itemEstoque.unidadeId })
          .from(itemEstoque)
          .where(doItem);
        if (!antes) throw new NotFoundException('Item não encontrado');
        if (chaveNome(antes.nome) !== chaveNome(nome))
          await this.exigirNomeLivre(tx, tenantId, nome, antes.unidadeId, id);
      }
      const setores = await this.resolverSetores(tx, tenantId, dto);
      if (setores) {
        patch.setorId = setores.setorId;
        if (setores.setoresExtras !== undefined) patch.setoresExtras = setores.setoresExtras;
      }
      const [salvo] = await tx.update(itemEstoque).set(patch).where(doItem).returning();
      if (!salvo) throw new NotFoundException('Item não encontrado');
      if (conversoes) await this.gravarConversoes(tx, tenantId, id, conversoes);
      if (velho)
        fichasAjustadas = await this.reconverterFichas(
          tx, tenantId, id,
          { unidade: velho.unidade, conversoes: conversoesVelhas },
          { unidade: salvo.unidadeMedida, conversoes: conversoes ?? conversoesVelhas },
        );
      if (velho)
        vinculosAjustados = await this.reconverterVinculos(tx, tenantId, id, {
          unidade: salvo.unidadeMedida,
          conversoes: conversoes ?? conversoesVelhas,
        });
      if (dto.fornecedorIds !== undefined || dto.fornecedorId !== undefined)
        await this.gravarFornecedores(tx, tenantId, id, dto.fornecedorIds, dto.fornecedorId);
      return salvo;
    });
    // Auditoria: insumo editado.
    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.colaboradorId,
      atorPerfil: ator?.categoria,
      tipo: 'estoque',
      acao: 'item_editado',
      entidadeTipo: 'item_estoque',
      entidadeId: id,
      origem: 'web',
    });
    return { ...row, fichasAjustadas, vinculosAjustados };
  }

  // A linha de ficha guarda a quantidade JÁ na unidade do estoque (2 fatias de um bacon em kg
  // = 0,02778 kg) e, ao lado, a unidade que a pessoa escolheu. Se a conversão do produto muda
  // (1 kg passa a ser 60 fatias), o que a pessoa informou — "2 fatias" — tem de continuar
  // valendo: a quantidade gravada é refeita pelo fator novo. O custo gravado é o da unidade do
  // estoque (o kg custa o mesmo) e não é tocado — a linha fica mais cara porque as mesmas 2
  // fatias passaram a pesar mais, que é a verdade. Se a unidade da linha deixou
  // de existir no produto, a quantidade gravada continua certa: a linha só passa a ser mostrada
  // na unidade do estoque. Devolve quantas linhas foram regravadas.
  private async reconverterFichas(
    tx: any,
    tenantId: string,
    itemId: string,
    antes: { unidade: string; conversoes: Conversao[] },
    depois: { unidade: string; conversoes: Conversao[] },
  ): Promise<number> {
    const linhas = await tx
      .select({ id: fichaIngrediente.id, unidade: fichaIngrediente.unidade })
      .from(fichaIngrediente)
      .where(
        and(
          eq(fichaIngrediente.tenantId, tenantId),
          eq(fichaIngrediente.itemId, itemId),
          isNull(fichaIngrediente.deletedAt),
        ),
      );
    // Um UPDATE por unidade usada (são poucas), não um por linha.
    const porUnidade = new Map<string, { unidade: string | null; ids: string[] }>();
    for (const l of linhas) {
      const g = porUnidade.get(chaveUnidade(l.unidade)) ?? { unidade: l.unidade as string | null, ids: [] as string[] };
      g.ids.push(l.id);
      porUnidade.set(chaveUnidade(l.unidade), g);
    }
    let ajustadas = 0;
    for (const g of porUnidade.values()) {
      const fAntes = fatorParaEstoque(g.unidade, antes.unidade, antes.conversoes) ?? 1;
      const fDepois = fatorParaEstoque(g.unidade, depois.unidade, depois.conversoes);
      if (fDepois == null) {
        await tx.update(fichaIngrediente).set({ unidade: depois.unidade }).where(inArray(fichaIngrediente.id, g.ids));
        ajustadas += g.ids.length;
        continue;
      }
      if (Math.abs(fDepois / fAntes - 1) < 1e-12) continue;
      // Volta ao que a pessoa informou (÷ fator antigo, com o mesmo corte da tela) e converte de novo.
      await tx
        .update(fichaIngrediente)
        .set({
          quantidade: sql`round(round(${fichaIngrediente.quantidade} / ${String(fAntes)}::numeric, ${CASAS_INFORMADO}) * ${String(fDepois)}::numeric, 15)`,
        })
        .where(inArray(fichaIngrediente.id, g.ids));
      ajustadas += g.ids.length;
    }
    return ajustadas;
  }

  // Ligações DIRETAS com este produto do estoque por uma unidade convertida (mig 309): o produto
  // de revenda guarda o fator em `produto.item_fator` e o adicional, na quantidade das opções já
  // copiadas para os produtos (`complemento_opcao.quantidade`) — é o que a venda baixa. Mudou a
  // conversão (1 fardo passa a ter 6) → o fator é refeito e a ligação continua valendo "1
  // unidade". A unidade escolhida deixou de existir no produto → a ligação volta para a unidade
  // do estoque (fator 1), como era antes de existir a escolha. Devolve quantas mudaram.
  private async reconverterVinculos(
    tx: any,
    tenantId: string,
    itemId: string,
    depois: { unidade: string; conversoes: Conversao[] },
  ): Promise<number> {
    let ajustados = 0;
    const novoFator = (unidade: string | null) => {
      const f = fatorParaEstoque(unidade, depois.unidade, depois.conversoes);
      return f == null || f === 1 ? null : arredondarEstoque(f); // null = volta para a unidade do estoque
    };
    const revendas = await tx
      .select({ id: produto.id, unidade: produto.itemUnidade, fator: produto.itemFator })
      .from(produto)
      .where(
        and(
          eq(produto.tenantId, tenantId),
          eq(produto.itemId, itemId),
          isNotNull(produto.itemUnidade),
          isNull(produto.deletedAt),
        ),
      );
    for (const p of revendas) {
      const f = novoFator(p.unidade);
      if (f != null && Math.abs(f / (Number(p.fator) || 1) - 1) < 1e-12) continue;
      await tx
        .update(produto)
        .set(f == null ? { itemUnidade: null, itemFator: '1' } : { itemFator: String(f) })
        .where(eq(produto.id, p.id));
      ajustados++;
    }
    const adicionais = await tx
      .select({ id: opcao.id, unidade: opcao.itemUnidade })
      .from(opcao)
      .where(
        and(
          eq(opcao.tenantId, tenantId),
          eq(opcao.itemId, itemId),
          eq(opcao.tipo, 'insumo'),
          isNotNull(opcao.itemUnidade),
          isNull(opcao.deletedAt),
        ),
      );
    for (const o of adicionais) {
      const f = novoFator(o.unidade);
      if (f == null) await tx.update(opcao).set({ itemUnidade: null }).where(eq(opcao.id, o.id));
      const quantidade = String(f ?? 1);
      const mudadas = await tx
        .update(complementoOpcao)
        .set({ quantidade })
        .where(
          and(
            eq(complementoOpcao.tenantId, tenantId),
            eq(complementoOpcao.origemOpcaoId, o.id),
            eq(complementoOpcao.itemId, itemId),
            isNull(complementoOpcao.deletedAt),
            sql`${complementoOpcao.quantidade} <> ${quantidade}::numeric`,
          ),
        )
        .returning({ id: complementoOpcao.id });
      if (f == null || mudadas.length) ajustados++;
    }
    return ajustados;
  }

  // Conversões como vão ser gravadas: fica só a linha preenchida (unidades e fator > 0), e as
  // duas unidades têm de ser da LISTA — o texto livre aqui é o que criava "pacotes" ao lado de
  // "pacote". Roda ANTES de abrir a transação: recusa sem ter apagado nada.
  private validarConversoes(
    conversoes?: { unidadeDe: string; fator: number; unidadePara: string }[],
  ): { unidadeDe: string; fator: number; unidadePara: string }[] | undefined {
    if (!conversoes) return undefined;
    return conversoes
      .filter((c) => c.unidadeDe?.trim() && c.unidadePara?.trim() && Number(c.fator) > 0)
      .map((c) => {
        const unidadeDe = exigirUnidade(c.unidadeDe, 'Conversão');
        const unidadePara = exigirUnidade(c.unidadePara, 'Conversão');
        if (unidadeDe === unidadePara)
          throw new BadRequestException(`Conversão: as duas unidades são "${unidadeDe}". Escolha unidades diferentes.`);
        return { unidadeDe, fator: Number(c.fator), unidadePara };
      });
  }

  // Replace-all das conversões do item (já validadas por `validarConversoes`).
  private async gravarConversoes(
    tx: any,
    tenantId: string,
    itemId: string,
    conversoes?: { unidadeDe: string; fator: number; unidadePara: string }[],
  ) {
    if (!conversoes) return;
    await tx
      .delete(itemConversao)
      .where(
        and(
          eq(itemConversao.tenantId, tenantId),
          eq(itemConversao.itemId, itemId),
        ),
      );
    if (conversoes.length)
      await tx.insert(itemConversao).values(
        conversoes.map((c) => ({
          tenantId,
          itemId,
          unidadeDe: c.unidadeDe,
          fator: String(c.fator),
          unidadePara: c.unidadePara,
        })),
      );
  }

  // ----- Exclusão de produto -----
  //
  // O produto não some do banco: recebe `deleted_at` (o histórico de movimentos, perdas,
  // compras e etiquetas aponta para ele, e o sync leva a marca para a loja). O que a exclusão
  // quebraria em silêncio é recusado ANTES, com o motivo: saldo que deixaria de aparecer, ficha
  // técnica que deixaria de dar baixa e item do cardápio que deixaria de ter custo e baixa.
  async exclusaoDoItem(tenantId: string, id: string, atual: string | null = null) {
    const [alvo] = await this.db
      .select({ id: itemEstoque.id, nome: itemEstoque.nome, unidadeId: itemEstoque.unidadeId, unidadeMedida: itemEstoque.unidadeMedida })
      .from(itemEstoque)
      .where(
        and(
          eq(itemEstoque.id, id),
          eq(itemEstoque.tenantId, tenantId),
          condUnidadeOuRede(itemEstoque.unidadeId, atual),
          isNull(itemEstoque.deletedAt),
        ),
      );
    if (!alvo) throw new NotFoundException('Produto não encontrado');
    const motivos: string[] = [];
    const comoResolver: string[] = [];
    // Cadastro compartilhado entre as lojas, visto de dentro de UMA loja: a exclusão tiraria o
    // produto das outras. Mesma fronteira da edição (a loja só edita o que é dela).
    if (atual && alvo.unidadeId == null) {
      motivos.push('é um cadastro compartilhado entre as lojas');
      comoResolver.push('Escolha "todas as lojas" para excluir.');
    }
    const res: any = await this.db.execute(sql`
      select
        (select count(*)::int from (
           select 1 from movimento_estoque m
            where m.tenant_id = ${tenantId} and m.item_id = ${id}
            group by m.unidade_id
           having sum(case m.tipo when 'entrada' then m.quantidade
                                  when 'saida'   then -m.quantidade
                                  else m.quantidade end) <> 0) x) as "lojasComSaldo",
        (select coalesce(sum(case m.tipo when 'entrada' then m.quantidade
                                         when 'saida'   then -m.quantidade
                                         else m.quantidade end), 0)::float8
           from movimento_estoque m
          where m.tenant_id = ${tenantId} and m.item_id = ${id}) as saldo,
        (select coalesce(array_agg(distinct ft.nome), '{}')
           from ficha_ingrediente fi join ficha_tecnica ft on ft.id = fi.ficha_id
          where fi.tenant_id = ${tenantId} and fi.item_id = ${id} and ft.deleted_at is null) as fichas,
        (select coalesce(array_agg(distinct p.nome), '{}')
           from produto p
          where p.tenant_id = ${tenantId} and p.item_id = ${id} and p.deleted_at is null) as produtos,
        (select coalesce(array_agg(distinct o.nome), '{}')
           from (select nome from opcao
                  where tenant_id = ${tenantId} and item_id = ${id} and deleted_at is null
                 union all
                 select nome from complemento_opcao
                  where tenant_id = ${tenantId} and item_id = ${id} and deleted_at is null) o) as complementos
    `);
    const r = (res.rows ?? res)[0] ?? {};
    const lista = (nomes: string[]) =>
      nomes.slice(0, 3).join(', ') + (nomes.length > 3 ? ` e mais ${nomes.length - 3}` : '');
    const num = (n: number) => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
    if (Number(r.lojasComSaldo) > 0) {
      motivos.push(
        Number(r.lojasComSaldo) > 1
          ? `tem saldo em ${r.lojasComSaldo} lojas (${num(r.saldo)} ${alvo.unidadeMedida} no total)`
          : `tem ${num(r.saldo)} ${alvo.unidadeMedida} em estoque`,
      );
      comoResolver.push('Zere o saldo com um ajuste.');
    }
    const fichas: string[] = r.fichas ?? [];
    if (fichas.length) {
      motivos.push(`é ingrediente de ${fichas.length === 1 ? 'uma ficha técnica' : `${fichas.length} fichas técnicas`} (${lista(fichas)})`);
      comoResolver.push('Troque ou tire o ingrediente nas fichas.');
    }
    const cardapio: string[] = [...(r.produtos ?? []), ...(r.complementos ?? [])];
    if (cardapio.length) {
      motivos.push(`está ligado ao cardápio (${lista(cardapio)})`);
      comoResolver.push('Desligue o produto do cardápio deste item de estoque.');
    }
    return { id: alvo.id, nome: alvo.nome, pode: motivos.length === 0, motivos, comoResolver };
  }

  async removerItem(tenantId: string, id: string, atual: string | null = null, ator?: Ator) {
    const exame = await this.exclusaoDoItem(tenantId, id, atual);
    if (!exame.pode)
      throw new ConflictException(
        `"${exame.nome}" não pode ser excluído agora: ${exame.motivos.join('; ')}. ${exame.comoResolver.join(' ')}`,
      );
    const [row] = await this.db
      .update(itemEstoque)
      // `updated_at` junto: é por ele que o sync leva a exclusão para a loja (e para a nuvem).
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(itemEstoque.id, id), eq(itemEstoque.tenantId, tenantId), isNull(itemEstoque.deletedAt)))
      .returning({ id: itemEstoque.id });
    if (!row) throw new NotFoundException('Produto não encontrado');
    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.colaboradorId,
      atorPerfil: ator?.categoria,
      tipo: 'estoque',
      acao: 'item_excluido',
      entidadeTipo: 'item_estoque',
      entidadeId: id,
      detalhe: { nome: exame.nome },
      origem: 'web',
    });
    return { ok: true };
  }

  // ----- Categorias de insumo (cadastro próprio) -----
  listCategorias(tenantId: string) {
    return this.db
      .select()
      .from(categoriaItem)
      .where(and(eq(categoriaItem.tenantId, tenantId), isNull(categoriaItem.deletedAt)))
      .orderBy(categoriaItem.nome);
  }
  async createCategoria(tenantId: string, dto: { nome: string; cor?: string }) {
    const [row] = await this.db
      .insert(categoriaItem)
      .values({ tenantId, nome: dto.nome, cor: dto.cor })
      .returning();
    return row;
  }
  async removerCategoria(tenantId: string, id: string) {
    const [row] = await this.db
      .update(categoriaItem)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(categoriaItem.id, id),
          eq(categoriaItem.tenantId, tenantId),
          isNull(categoriaItem.deletedAt),
        ),
      )
      .returning();
    if (!row) throw new NotFoundException('Categoria não encontrada');
    return { ok: true };
  }

  // Saldo derivado do ledger (entrada +, saida -, ajuste sinalizado).
  async listItens(tenantId: string, verFin = true, atual: string | null = null) {
    const res: any = await this.db.execute(sql`
      -- Por LOJA (migs 253 e 257): cada insumo é expandido nas lojas que o usam, com o saldo,
      -- o custo e o mínimo de cada uma, e somado. Com loja escolhida é uma linha só (a dela);
      -- em "todas", o valor é a soma de saldo × custo de CADA loja (nunca o saldo total vezes
      -- um custo único) e o mínimo é a soma dos mínimos.
      select i.id, i.nome, i.unidade_medida as "unidadeMedida", i.unidade_id as "unidadeId",
             -- Como o produto é comprado e as marcas dele (mig 311); o nome continua o da ficha.
             i.nome_comercial as "nomeComercial", i.marcas,
             sum(${sqlMinimoDaLoja}) as "estoqueMinimo",
             case when sum(greatest(mv.saldo, 0)) > 0
                  then sum(greatest(mv.saldo, 0) * ${sqlCustoDaLoja}) / sum(greatest(mv.saldo, 0))
                  else max(${sqlCustoDaLoja}) end::float8 as "custoMedio",
             sum(mv.saldo * ${sqlCustoDaLoja}) as "valorEstoque",
             coalesce(bool_or(not u.orfao and mv.saldo < ${sqlMinimoDaLoja}), false) as "abaixoMinimo",
             i.categoria_item_id as "categoriaItemId",
             i.fornecedor_id as "fornecedorId",
             i.setor_id as "setorId", i.setores_extras as "setoresExtras",
             i.validade, i.validade_aberto_dias as "validadeAbertoDias",
             cat.nome as "categoriaNome", cat.cor as "categoriaCor",
             f.nome as "fornecedorNome",
             st.nome as "setorNome",
             sum(mv.saldo) as saldo
      from item_estoque i
      ${sqlLojasDoItem(atual)}
      cross join lateral (
        select coalesce(sum(case m.tipo when 'entrada' then m.quantidade
                                  when 'saida'   then -m.quantidade
                                  else m.quantidade end), 0) as saldo
          from movimento_estoque m
         where m.item_id = i.id and m.unidade_id is not distinct from u.uid
      ) mv
      left join categoria_item cat on cat.id = i.categoria_item_id
      left join fornecedor f on f.id = i.fornecedor_id
      left join setor st on st.id = i.setor_id
      -- Insumo da loja OU de cadastro compartilhado: o cadastro pode servir às duas lojas,
      -- o saldo é que é de cada uma.
      where i.tenant_id = ${tenantId} and i.deleted_at is null ${sqlUnidadeOuRede('i.unidade_id', atual)}
      group by i.id, cat.nome, cat.cor, f.nome, st.nome
      order by i.nome
    `);
    const rows = res.rows ?? res;
    // Conversões por item (anexadas em memória).
    const convs = await this.db
      .select()
      .from(itemConversao)
      .where(eq(itemConversao.tenantId, tenantId));
    const porItem = new Map<string, any[]>();
    for (const c of convs) {
      const arr = porItem.get(c.itemId) ?? [];
      arr.push({
        unidadeDe: c.unidadeDe,
        fator: Number(c.fator),
        unidadePara: c.unidadePara,
        // A unidade da LISTA que corresponde ao que está gravado (conversão antiga em texto
        // livre: "pacotes" → pacote). A tela abre o campo já nela; salvar corrige o gravado.
        unidadeDeLista: normalizarUnidade(c.unidadeDe),
        unidadeParaLista: normalizarUnidade(c.unidadePara),
      });
      porItem.set(c.itemId, arr);
    }
    // Fornecedores (N:N) por item (anexados em memória).
    const fs = await this.db
      .select({ itemId: itemFornecedor.itemId, fornecedorId: itemFornecedor.fornecedorId })
      .from(itemFornecedor)
      .where(eq(itemFornecedor.tenantId, tenantId));
    const fornPorItem = new Map<string, string[]>();
    for (const x of fs) {
      const arr = fornPorItem.get(x.itemId) ?? [];
      arr.push(x.fornecedorId);
      fornPorItem.set(x.itemId, arr);
    }
    // Nomes de fornecedor e de setor (a lista mostra TODOS os do produto, não só o principal).
    const nomeForn = new Map<string, string>(
      (
        await this.db
          .select({ id: fornecedor.id, nome: fornecedor.nome })
          .from(fornecedor)
          .where(and(eq(fornecedor.tenantId, tenantId), isNull(fornecedor.deletedAt)))
      ).map((f) => [f.id, f.nome]),
    );
    const nomeSetor = new Map<string, string>(
      (
        await this.db
          .select({ id: setor.id, nome: setor.nome })
          .from(setor)
          .where(and(eq(setor.tenantId, tenantId), isNull(setor.deletedAt)))
      ).map((s) => [s.id, s.nome]),
    );
    // Setores do produto: o principal primeiro, depois os extras (mig 307) — sem repetir e sem
    // setor que já foi excluído.
    const setoresDe = (r: any): string[] => {
      const extras: string[] = Array.isArray(r.setoresExtras) ? r.setoresExtras : [];
      return [...new Set([r.setorId, ...extras].filter((s): s is string => !!s && nomeSetor.has(s)))];
    };
    // Em "todas" numa empresa de duas lojas o mínimo mostrado é a SOMA das lojas: não é um
    // valor editável (cada loja tem o seu). A tela trava o campo e pede a loja.
    const lojas = await contarLojas(this.db, tenantId);
    // Valor em estoque = Σ saldo × custo médio de cada loja (derivado, nunca armazenado).
    // Valores em R$ (custo médio e valor) são financeiros → só presidente/C&O.
    return rows.map((r: any) => {
      // Lista completa de fornecedores, o principal primeiro; cai nele quando ainda não há N:N.
      const fornecedorIds = [
        ...new Set([r.fornecedorId, ...(fornPorItem.get(r.id) ?? [])].filter((f): f is string => !!f)),
      ];
      const setorIds = setoresDe(r);
      return {
        ...r,
        unidadeLista: normalizarUnidade(r.unidadeMedida), // idem conversões: "L" → litro
        custoMedio: verFin ? r.custoMedio : null,
        valorEstoque: verFin ? Number(r.valorEstoque ?? 0) : null,
        minimoPorLoja: lojas > 1 && !atual,
        minimoDaLoja: lojas > 1 && !!atual,
        conversoes: porItem.get(r.id) ?? [],
        fornecedorIds,
        fornecedorNomes: fornecedorIds.map((f) => nomeForn.get(f)).filter(Boolean),
        setorIds,
        setorNomes: setorIds.map((s) => nomeSetor.get(s)),
      };
    });
  }

  /** Lista fechada de unidades de medida (a tela não guarda cópia) e as outras formas de escrever
   *  cada uma — para a tela abrir "un" já como "unidade". */
  listUnidades() {
    return { unidades: [...UNIDADES_ESTOQUE], apelidos: apelidosDeUnidade() };
  }

  async createMovimento(
    tenantId: string,
    dto: CreateMovimentoDto,
    atual: string | null = null,
    ator?: Ator,
  ) {
    const [it] = await this.db
      .select({ id: itemEstoque.id, unidadeId: itemEstoque.unidadeId })
      .from(itemEstoque)
      .where(
        and(
          eq(itemEstoque.id, dto.itemId),
          eq(itemEstoque.tenantId, tenantId),
          // Insumo da loja OU compartilhado. Com o filtro estrito, a loja não conseguia
          // ajustar o saldo de um insumo de cadastro compartilhado — e o modelo é justamente
          // cadastro compartilhado com estoque separado por loja.
          condUnidadeOuRede(itemEstoque.unidadeId, atual),
          isNull(itemEstoque.deletedAt),
        ),
      );
    if (!it) throw new BadRequestException('Item inválido para esta unidade');

    // Loja do lançamento: a da sessão; sem ela, a do insumo exclusivo. Insumo compartilhado
    // sem loja escolhida, em empresa de duas lojas, é recusado — não há como saber de qual
    // loja é o saldo.
    const unidadeId = await exigirLojaParaLancar(this.db, tenantId, atual ?? it.unidadeId);

    // Quantidade do lançamento. No ajuste com `saldoContado`, é a diferença para o saldo da
    // loja NESTE instante (conta feita no banco, em numeric — não com o saldo que a tela tinha).
    let quantidade: string;
    if (dto.tipo === 'ajuste' && dto.saldoContado !== undefined) {
      const res: any = await this.db.execute(sql`
        select (${String(dto.saldoContado)}::numeric
                - coalesce(sum(case m.tipo when 'entrada' then m.quantidade
                                           when 'saida'   then -m.quantidade
                                           else m.quantidade end), 0))::text as diferenca
          from movimento_estoque m
         where m.tenant_id = ${tenantId} and m.item_id = ${dto.itemId}
           ${unidadeId ? sql`and m.unidade_id = ${unidadeId}` : sql``}`);
      quantidade = String((res.rows ?? res)[0]?.diferenca ?? '0');
      // Contou e bateu: não há o que lançar (um movimento de zero só sujaria o histórico).
      if (Number(quantidade) === 0) return { id: null, semMudanca: true };
    } else {
      const q = Number(dto.quantidade);
      if (!Number.isFinite(q)) throw new BadRequestException('Informe a quantidade.');
      if (dto.tipo !== 'ajuste' && q <= 0)
        throw new BadRequestException('A quantidade da entrada ou da saída tem de ser maior que zero.');
      if (dto.tipo === 'ajuste' && q === 0)
        throw new BadRequestException('O ajuste precisa de uma diferença (ou do saldo contado).');
      quantidade = String(q);
    }

    const [row] = await this.db
      .insert(movimentoEstoque)
      .values({
        tenantId,
        unidadeId: unidadeId ?? undefined,
        itemId: dto.itemId,
        tipo: dto.tipo,
        quantidade,
        motivo: dto.motivo,
        data: dto.data ?? hojeISO(),
      })
      .returning();
    // Auditoria: movimento manual de estoque (entrada/saída/ajuste).
    await this.auditoria.registrar({
      tenantId,
      atorId: ator?.colaboradorId,
      atorPerfil: ator?.categoria,
      tipo: 'estoque',
      acao: 'movimento_manual',
      entidadeTipo: 'item_estoque',
      entidadeId: dto.itemId,
      detalhe: {
        tipo: dto.tipo,
        quantidade: Number(quantidade),
        ...(dto.saldoContado !== undefined ? { saldoContado: dto.saldoContado } : {}),
        motivo: dto.motivo,
      },
      origem: 'web',
    });
    return row;
  }

  listMovimentos(tenantId: string, itemId: string, atual: string | null = null) {
    return this.db
      .select()
      .from(movimentoEstoque)
      .where(
        and(
          eq(movimentoEstoque.tenantId, tenantId),
          eq(movimentoEstoque.itemId, itemId),
          // movimento não tem unidade própria: garante que o item é da unidade atual.
          atual
            ? sql`exists (select 1 from item_estoque i where i.id = ${movimentoEstoque.itemId} and i.unidade_id = ${atual})`
            : undefined,
        ),
      )
      .orderBy(desc(movimentoEstoque.createdAt));
  }

  // G2/G3/G4 — Inteligência de estoque (tudo derivado do ledger + custo médio).
  // Valorização (valor em estoque + compras), reposição (ROP) e curva ABC no período.
  // Lead time é POR FORNECEDOR (item.fornecedor_id → fornecedor.lead_time_dias);
  // item sem fornecedor cai no padrão.
  async inteligencia(tenantId: string, inicio: string, fim: string, verFin = true, atual: string | null = null) {
    const LEAD_TIME_PADRAO = 7;
    const COBERTURA_ALVO_DIAS = 7;
    const res: any = await this.db.execute(sql`
      -- Saldo, consumo, compras, custo, mínimo e dias de segurança DA LOJA (migs 253 e 257)
      -- — é o que decide o ponto de pedido dela. Em "todas", soma por loja: o estoque de
      -- segurança é Σ consumo × dias de cada loja (dias ponderados pelo consumo), o valor
      -- consumido é Σ saída × custo de cada loja.
      select i.id, i.nome, i.unidade_medida as "unidadeMedida",
             sum(${sqlMinimoDaLoja}) as "estoqueMinimo",
             case when sum(greatest(mv.saldo, 0)) > 0
                  then sum(greatest(mv.saldo, 0) * ${sqlCustoDaLoja}) / sum(greatest(mv.saldo, 0))
                  else max(${sqlCustoDaLoja}) end as "custoMedio",
             coalesce(sum(mv.saida * ${sqlDiasSegurancaDaLoja}) / nullif(sum(mv.saida), 0),
                      max(${sqlDiasSegurancaDaLoja})) as "diasSeguranca",
             f.lead_time_dias as "leadTimeDias", f.nome as "fornecedorNome",
             sum(mv.saldo) as saldo,
             sum(mv.saida) as "saidaPeriodo",
             sum(mv.saldo * ${sqlCustoDaLoja}) as "valorEstoque",
             sum(mv.saida * ${sqlCustoDaLoja}) as "valorConsumido",
             coalesce(bool_or(not u.orfao and mv.saldo < ${sqlMinimoDaLoja}), false) as "abaixoMinimo",
             sum(mv.compras) as "comprasValor"
      from item_estoque i
      left join fornecedor f on f.id = i.fornecedor_id and f.deleted_at is null
      ${sqlLojasDoItem(atual)}
      cross join lateral (
        select coalesce(sum(case m.tipo when 'entrada' then m.quantidade
                                  when 'saida'   then -m.quantidade
                                  else m.quantidade end), 0) as saldo,
               coalesce(sum(case when m.tipo = 'saida' and m.data between ${inicio} and ${fim}
                 then m.quantidade else 0 end), 0) as saida,
               coalesce(sum(case when m.tipo = 'entrada' and m.motivo in ('recebimento', 'compra')
                 and m.data between ${inicio} and ${fim}
                 then m.quantidade * coalesce(m.custo_unitario, ${sqlCustoDaLoja}) else 0 end), 0) as compras
          from movimento_estoque m
         where m.item_id = i.id and m.unidade_id is not distinct from u.uid
      ) mv
      where i.tenant_id = ${tenantId} and i.deleted_at is null ${sqlUnidadeOuRede('i.unidade_id', atual)}
      group by i.id, f.lead_time_dias, f.nome
      order by i.nome
    `);
    const rows = res.rows ?? res;

    const d0 = new Date(inicio);
    const d1 = new Date(fim);
    const dias = Math.max(
      1,
      Math.round((d1.getTime() - d0.getTime()) / 86400000) + 1,
    );

    let itens = rows.map((r: any) => {
      const saldo = Number(r.saldo);
      const custoMedio = Number(r.custoMedio ?? 0);
      const saidaPeriodo = Number(r.saidaPeriodo);
      const consumoDiario = saidaPeriodo / dias;
      const diasCobertura = consumoDiario > 0 ? saldo / consumoDiario : null;
      // §1.4: ES = CMD × dias_seguranca; ROP = CMD × lead_time + ES.
      // Lead time do fornecedor do item (fallback = padrão).
      const diasSeguranca = Number(r.diasSeguranca ?? 2);
      const leadTime = Number(r.leadTimeDias ?? LEAD_TIME_PADRAO);
      const es = consumoDiario * diasSeguranca;
      const rop = consumoDiario * leadTime + es;
      const qtdSugerida = Math.max(
        0,
        consumoDiario * COBERTURA_ALVO_DIAS + es - saldo,
      );
      return {
        id: r.id,
        nome: r.nome,
        unidadeMedida: r.unidadeMedida,
        estoqueMinimo: Number(r.estoqueMinimo ?? 0),
        custoMedio,
        saldo,
        valorEstoque: Number(r.valorEstoque ?? 0),
        consumoDiario: Number(consumoDiario.toFixed(3)),
        diasCobertura: diasCobertura != null ? Number(diasCobertura.toFixed(1)) : null,
        valorConsumido: Number(r.valorConsumido ?? 0),
        estoqueSeguranca: Number(es.toFixed(2)),
        leadTime,
        fornecedorNome: r.fornecedorNome ?? null,
        rop: Number(rop.toFixed(2)),
        qtdSugerida: Number(qtdSugerida.toFixed(2)),
        repor: saldo <= rop && rop > 0,
        abaixoMinimo: !!r.abaixoMinimo,
        comprasValor: Number(r.comprasValor),
      };
    });

    // Curva ABC pelo valor consumido no período (A ≤80% acumulado, B ≤95%, C resto).
    const totalConsumo = itens.reduce((s: number, i: any) => s + i.valorConsumido, 0);
    const ordenados = [...itens].sort((a, b) => b.valorConsumido - a.valorConsumido);
    let acum = 0;
    const classe: Record<string, string> = {};
    for (const it of ordenados) {
      acum += it.valorConsumido;
      const pct = totalConsumo > 0 ? (acum / totalConsumo) * 100 : 100;
      classe[it.id] = it.valorConsumido === 0 ? 'C' : pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
    }
    itens = itens.map((i: any) => ({ ...i, classeAbc: classe[i.id] }));

    // Curva ABC (classeAbc) já calculada com os valores reais acima. Agora, se o
    // usuário não pode ver financeiro (gerente), anula os campos em R$ — mantendo
    // saldo, giro, cobertura, ROP e sugestão de compra (operacional).
    const resumo = {
      valorEstoque: verFin ? itens.reduce((s: number, i: any) => s + i.valorEstoque, 0) : null,
      comprasPeriodo: verFin ? itens.reduce((s: number, i: any) => s + i.comprasValor, 0) : null,
      valorConsumido: verFin ? totalConsumo : null,
      itensAbaixoMinimo: itens.filter((i: any) => i.abaixoMinimo).length,
      itensRepor: itens.filter((i: any) => i.repor).length,
      leadTimePadrao: LEAD_TIME_PADRAO,
      dias,
    };
    if (!verFin) {
      itens = itens.map((i: any) => ({
        ...i,
        custoMedio: null,
        valorEstoque: null,
        valorConsumido: null,
        comprasValor: null,
      }));
    }
    return { resumo, itens };
  }

  // §1.6 — Validades FEFO: lotes por vencimento com status (crítico/atenção/vencido).
  // O saldo do lote é o que ENTROU menos o que saiu dele (mig 248), não mais o valor
  // congelado da entrada.
  //
  // Escopo igual ao de `GET /lotes`: insumo DA LOJA ou da REDE. Com `= atual` puro, o
  // insumo de unidade nula — que é a maioria em quem nunca separou catálogo por filial —
  // sumia da tela, enquanto o job das 06:10 (que chama sem `atual`) alertava sobre ele.
  async validades(tenantId: string, atual: string | null = null) {
    const res: any = await this.db.execute(sql`
      select l.id, l.item_id as "itemId", i.nome as "itemNome",
             i.unidade_medida as "unidadeMedida", l.validade, l.codigo,
             (l.quantidade - coalesce((select sum(ml.quantidade) from movimento_lote ml where ml.lote_id = l.id), 0)) as quantidade,
             l.custo_unitario as "custoUnitario",
             (l.validade - current_date) as "diasParaVencer"
      from lote l
      join item_estoque i on i.id = l.item_id
      where l.tenant_id = ${tenantId} and l.esgotado = false
        and l.validade is not null and l.deleted_at is null
        -- Saldo DERIVADO (mig 248). Sem isto o alerta das 06:10 avisava "vence em 2
        -- dias, 10 kg" de um lote já inteiramente consumido — e alerta que mente é
        -- pior do que alerta nenhum, porque o lojista para de olhar.
        -- Pela loja do LOTE (mig 246): o lote da loja B não aparece na validade da loja A,
        -- mesmo sendo de um insumo compartilhado. Lote antigo sem loja aparece para as duas.
        and (l.quantidade - coalesce((select sum(ml.quantidade) from movimento_lote ml where ml.lote_id = l.id), 0)) > 0 ${sqlUnidadeOuRede('l.unidade_id', atual)}
      order by l.validade asc
    `);
    const rows = res.rows ?? res;
    return rows.map((r: any) => {
      const d = Number(r.diasParaVencer);
      const status = d < 0 ? 'vencido' : d <= 2 ? 'critico' : d <= 5 ? 'atencao' : 'ok';
      return {
        id: r.id,
        itemId: r.itemId,
        itemNome: r.itemNome,
        codigo: r.codigo ?? null,
        unidadeMedida: r.unidadeMedida,
        validade: r.validade,
        quantidade: Number(r.quantidade),
        custoUnitario: r.custoUnitario != null ? Number(r.custoUnitario) : null,
        diasParaVencer: d,
        status,
        valor: Number(r.quantidade) * Number(r.custoUnitario ?? 0),
      };
    });
  }

  // §1.3 — Grava o snapshot de estoque de UMA data (saldo até a data × custo médio atual).
  // Upsert: reexecutar no mesmo dia atualiza. (custo_medio é o cache atual — snapshot é "ao vivo".)
  async gerarSnapshot(tenantId: string, data?: string, atual: string | null = null) {
    const d = data ?? hojeISO();
    // Um snapshot POR LOJA (mig 255). Insumo compartilhado gera uma linha em cada loja,
    // com o saldo dos movimentos daquela loja; insumo exclusivo, só na loja dele; empresa
    // sem loja cadastrada fica com a linha sem loja. Movimento sem loja (antigo, sem origem,
    // insumo compartilhado em empresa de duas lojas) não entra em loja nenhuma — a próxima
    // contagem restabelece o saldo (decisão do dono: não se atribui por palpite).
    //
    // A mesma expansão por loja está na mig 256, que reconstruiu os snapshots antigos.
    await this.db.execute(sql`
      insert into estoque_snapshot (tenant_id, unidade_id, item_id, data, saldo, custo_medio)
      select i.tenant_id, u.uid, i.id, ${d}::date,
        coalesce(sum(case m.tipo when 'entrada' then m.quantidade
          when 'saida' then -m.quantidade else m.quantidade end),0),
        -- Custo médio DA LOJA naquele dia (mig 257).
        coalesce(max(iu.custo_medio), i.custo_medio)
      from item_estoque i
      cross join lateral (
        select un.id as uid from unidade un
         where un.tenant_id = i.tenant_id and un.deleted_at is null
           and (i.unidade_id is null or un.id = i.unidade_id)
        union all
        select null::uuid
         where not exists (
           select 1 from unidade un2 where un2.tenant_id = i.tenant_id and un2.deleted_at is null
         )
      ) u
      left join item_estoque_unidade iu
        on iu.item_id = i.id and iu.unidade_id = u.uid and iu.deleted_at is null
      left join movimento_estoque m
        on m.item_id = i.id and m.data <= ${d} and m.unidade_id is not distinct from u.uid
      where i.tenant_id = ${tenantId} and i.deleted_at is null
        ${atual ? sql`and u.uid = ${atual}` : sql``}
      group by i.id, u.uid
      on conflict (tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid), item_id, data)
        do update set saldo = excluded.saldo, custo_medio = excluded.custo_medio
    `);
    return { ok: true, data: d };
  }

  // §1.3 — CMV real (EI + Compras − EF) × CMV teórico consumido → desvio.
  async cmvReal(tenantId: string, inicio: string, fim: string, atual: string | null = null) {
    // Valor do snapshot mais recente com data <= alvo (EI/EF).
    const valorSnapshot = async (alvo: string): Promise<number> => {
      const r: any = await this.db.execute(sql`
        -- Snapshot mais recente POR INSUMO E LOJA (mig 255). Agrupando só por insumo, a loja
        -- A com snapshot num dia e a B noutro pegaria a data errada para uma delas.
        with ult as (
          select item_id, unidade_id, max(data) as data from estoque_snapshot
          where tenant_id=${tenantId} and data <= ${alvo} ${sqlUnidade('unidade_id', atual)}
          group by item_id, unidade_id
        )
        select coalesce(sum(s.saldo * s.custo_medio),0) as v
        from estoque_snapshot s
        join ult on ult.item_id = s.item_id and ult.data = s.data
                and ult.unidade_id is not distinct from s.unidade_id
        where s.tenant_id = ${tenantId} ${sqlUnidade('s.unidade_id', atual)}
      `);
      return Number((r.rows ?? r)[0].v);
    };
    const valorAtual = async (): Promise<number> => {
      const r: any = await this.db.execute(sql`
        -- Σ saldo × custo médio de CADA loja (mig 257).
        select coalesce(sum(mv.saldo * ${sqlCustoDaLoja}),0) as v
          from item_estoque i
          ${sqlLojasDoItem(atual)}
          cross join lateral (
            select coalesce(sum(case m.tipo when 'entrada' then m.quantidade
                                  when 'saida'   then -m.quantidade
                                  else m.quantidade end), 0) as saldo
              from movimento_estoque m
             where m.item_id = i.id and m.unidade_id is not distinct from u.uid
          ) mv
          where i.tenant_id=${tenantId} and i.deleted_at is null ${sqlUnidadeOuRede('i.unidade_id', atual)}
      `);
      return Number((r.rows ?? r)[0].v);
    };

    // Estoque INICIAL = fechamento da VÉSPERA. O snapshot do dia D soma os movimentos com
    // data <= D; usar o do próprio `inicio` punha as compras do 1º dia dentro do estoque
    // inicial E dentro de `compras` — contadas duas vezes. O erro ficava escondido porque
    // o job das 02:00 fotografava o dia recém-começado; consertar só a hora o exporia.
    const estoqueInicial = await valorSnapshot(somarDias(inicio, -1));
    const semSnapshotInicial = estoqueInicial === 0;

    let estoqueFinal = await valorSnapshot(fim);
    let efFonte = 'snapshot';
    if (estoqueFinal === 0) {
      estoqueFinal = await valorAtual(); // sem snapshot final → valorização atual
      efFonte = 'atual';
    }

    const somaMov = async (
      cond: any,
    ): Promise<number> => {
      const r: any = await this.db.execute(sql`
        select coalesce(sum(m.quantidade * coalesce(m.custo_unitario, iu.custo_medio, i.custo_medio)),0) as v
        from movimento_estoque m join item_estoque i on i.id = m.item_id
        left join item_estoque_unidade iu
          on iu.item_id = m.item_id and iu.unidade_id = m.unidade_id and iu.deleted_at is null
        -- Compras, consumo e desperdício DA LOJA: pela loja do movimento, não do insumo.
        where m.tenant_id=${tenantId} and m.data between ${inicio} and ${fim} ${sqlUnidade('m.unidade_id', atual)} and ${cond}
      `);
      return Number((r.rows ?? r)[0].v);
    };
    // Compras do período. A loja compra por `compras.receber()`, que grava motivo 'compra';
    // o CMV só somava 'recebimento' — o fluxo com ZERO notas em produção. Resultado: toda
    // compra ficava FORA do CMV, que virava estoque inicial menos final e nada mais.
    const compras = await somaMov(sql`m.tipo='entrada' and m.motivo in ('recebimento','compra')`);
    const cmvTeorico = await somaMov(
      sql`m.tipo='saida' and m.motivo in ('venda','producao')`,
    );
    // Desperdício valorizado no período (saídas com motivo 'desperdicio').
    const desperdicioValor = await somaMov(
      sql`m.tipo='saida' and m.motivo='desperdicio'`,
    );

    const cmvReal = estoqueInicial + compras - estoqueFinal;
    const desvio = cmvReal - cmvTeorico;
    // Furo = parte do desvio não explicada pelo desperdício registrado
    // (porção fora do padrão + perda/erro de contagem). §1.3.
    const furo = furoCmv(desvio, desperdicioValor);
    return {
      periodo: { inicio, fim },
      estoqueInicial: Number(estoqueInicial.toFixed(2)),
      compras: Number(compras.toFixed(2)),
      estoqueFinal: Number(estoqueFinal.toFixed(2)),
      efFonte,
      semSnapshotInicial,
      cmvReal: Number(cmvReal.toFixed(2)),
      cmvTeorico: Number(cmvTeorico.toFixed(2)),
      desvio: Number(desvio.toFixed(2)),
      desperdicioValor: Number(desperdicioValor.toFixed(2)),
      furo: Number(furo.toFixed(2)),
    };
  }

  // ── Alertas de estoque (ROP/FEFO) persistidos ────────────────────────────────
  // Mantém UM alerta aberto por (tenant, tipo): atualiza o existente ou cria.
  // Alerta de sistema é UM aberto por (empresa, LOJA, tipo) — mig 249. A chave inclui a
  // unidade, e unidade nula é uma chave própria (rede de loja única), não um coringa.
  private condAlertaUnidade(unidadeId: string | null | undefined) {
    return unidadeId ? eq(alertaEstoque.unidadeId, unidadeId) : isNull(alertaEstoque.unidadeId);
  }

  async registrarAlerta(
    tenantId: string,
    tipo: 'ponto_pedido' | 'validade',
    dados: { titulo: string; detalhe?: string; prioridade?: string; unidadeId?: string | null },
  ) {
    const atualizado = await this.db
      .update(alertaEstoque)
      .set({
        titulo: dados.titulo,
        detalhe: dados.detalhe,
        prioridade: dados.prioridade ?? 'alta',
        criadoEm: new Date(),
      })
      .where(
        and(
          eq(alertaEstoque.tenantId, tenantId),
          eq(alertaEstoque.tipo, tipo),
          this.condAlertaUnidade(dados.unidadeId),
          isNull(alertaEstoque.resolvidoEm),
        ),
      )
      .returning();
    if (atualizado.length) return atualizado[0];
    const [novo] = await this.db
      .insert(alertaEstoque)
      .values({
        tenantId,
        unidadeId: dados.unidadeId ?? null,
        tipo,
        titulo: dados.titulo,
        detalhe: dados.detalhe,
        prioridade: dados.prioridade ?? 'alta',
      })
      // Corrida entre dois disparos do mesmo job: o índice da mig 249 barra a duplicata.
      .onConflictDoNothing()
      .returning();
    return novo;
  }

  listarAlertas(tenantId: string, atual: string | null = null) {
    return this.db
      .select()
      .from(alertaEstoque)
      .where(
        and(
          eq(alertaEstoque.tenantId, tenantId),
          condUnidadeOuRede(alertaEstoque.unidadeId, atual),
          isNull(alertaEstoque.resolvidoEm),
        ),
      )
      .orderBy(desc(alertaEstoque.criadoEm));
  }

  // Auto-resolve (pelo sistema) quando a condição some — mantém a lista limpa.
  // Resolve o alerta DAQUELA loja. Sem a unidade na chave, a loja A que zerou as
  // pendências fecharia também o alerta da loja B, que ainda tem.
  async resolverAlertasSistema(tenantId: string, tipo: string, unidadeId: string | null = null) {
    await this.db
      .update(alertaEstoque)
      .set({ resolvidoEm: new Date() })
      .where(
        and(
          eq(alertaEstoque.tenantId, tenantId),
          eq(alertaEstoque.tipo, tipo),
          this.condAlertaUnidade(unidadeId),
          isNull(alertaEstoque.resolvidoEm),
        ),
      );
  }

  async resolverAlerta(tenantId: string, id: string, colaboradorId: string, atual: string | null = null) {
    await this.db
      .update(alertaEstoque)
      .set({ resolvidoEm: new Date(), resolvidoPor: colaboradorId })
      .where(
        and(
          eq(alertaEstoque.id, id),
          eq(alertaEstoque.tenantId, tenantId),
          condUnidadeOuRede(alertaEstoque.unidadeId, atual),
        ),
      );
    return { ok: true };
  }
}
