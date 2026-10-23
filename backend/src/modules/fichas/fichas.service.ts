import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { entitlement, fichaIngrediente, fichaTecnica, itemConversao, itemEstoque } from '../../db/schema';
import { MODULO_MESMA_EMBALAGEM } from '../../common/embalagem-da-ficha';
import { idEntitlement } from '../../common/id-deterministico';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { arredondarEstoque, arredondarInformado, CASAS_INFORMADO, chaveUnidade, fatorParaEstoque, type Conversao } from '../../common/conversao-unidade';
import { conferirConversoes, unidadeOuPadrao } from '../estoque/unidades';
import { custoTotalFicha, fichaAlcancavel, type FichaCusto } from '../../common/regras-negocio';
import { carregarFichas, custoPorUnidadeDaFicha, dependenciasDasFichas, mesmaEmbalagemDaEmpresa, rendeEm, type Rendimento } from './fichas-carga';
import { CreateFichaDto } from './dto/create-ficha.dto';
import { CreateIngredienteDto } from './dto/create-ingrediente.dto';
import { UpdateFichaDto } from './dto/update-ficha.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Margem de perda como vai para o banco: de 0 a 100 (fora disso, 400); 0 ou vazio = sem margem (null).
function margemOuNada(v: number | null | undefined): string | null {
  if (v == null) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100) throw new BadRequestException('Margem de perda: informe de 0 a 100%.');
  return n === 0 ? null : String(Math.round(n * 100) / 100);
}
// custoTotal já resolvido (recursivo, com sub-fichas) → deriva porção, CMV, preço.
function computar(f: any, custoTotal: number) {
  const rendimento = Number(f.rendimento) || 1;
  const custoPorcao = custoTotal / rendimento;
  const precoVenda = f.precoVenda != null ? Number(f.precoVenda) : null;
  const cmv =
    precoVenda && precoVenda > 0 ? (custoPorcao / precoVenda) * 100 : null;
  const metaCmv = f.metaCmv != null ? Number(f.metaCmv) : null;
  // G5: preço sugerido = custo da porção ÷ CMV-alvo (ex.: custo ÷ 0,315 p/ CMV 31,5%).
  const precoSugerido =
    metaCmv && metaCmv > 0 && custoPorcao > 0
      ? custoPorcao / (metaCmv / 100)
      : null;
  // Markup = preço/custo; margem = (preço−custo)/preço. Confusão clássica — mostramos os dois.
  const markup =
    precoVenda && custoPorcao > 0 ? precoVenda / custoPorcao : null;
  const margem =
    precoVenda && precoVenda > 0 ? ((precoVenda - custoPorcao) / precoVenda) * 100 : null;
  return {
    custoTotal: Number(custoTotal.toFixed(2)),
    custoPorcao: Number(custoPorcao.toFixed(2)),
    cmv: cmv != null ? Number(cmv.toFixed(1)) : null,
    precoSugerido: precoSugerido != null ? Number(precoSugerido.toFixed(2)) : null,
    markup: markup != null ? Number(markup.toFixed(2)) : null,
    margem: margem != null ? Number(margem.toFixed(1)) : null,
  };
}

// Custo/CMV nos dois contextos: balcão (padrão, mantém os nomes atuais; ingredientes + embalagem
// do balcão) e delivery (ingredientes + embalagem do delivery). `temCustoDelivery` = os dois custos
// diferem (a UI mostra os dois valores quando true).
function computarDois(f: any, custoBalcao: number, custoDelivery: number) {
  const balcao = computar(f, custoBalcao);
  const deliv = computar(f, custoDelivery);
  return {
    ...balcao,
    custoTotalDelivery: deliv.custoTotal,
    custoPorcaoDelivery: deliv.custoPorcao,
    cmvDelivery: deliv.cmv,
    margemDelivery: deliv.margem,
    temCustoDelivery: Math.abs(custoDelivery - custoBalcao) > 0.0001,
  };
}

@Injectable()
export class FichasService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  // Unidade do insumo escrito à mão (sem produto do estoque nem sub-receita): tem de ser da lista.
  // Conferida ANTES de gravar qualquer coisa — a recusa (400) não pode deixar ficha sem ingredientes.
  private conferirUnidadesLivres(linhas: CreateIngredienteDto[] | undefined) {
    for (const i of linhas ?? [])
      if (!i.subFichaId && !i.itemId) unidadeOuPadrao(i.unidade, `Unidade de "${String(i.insumoNome ?? '').slice(0, 40)}"`);
  }

  // A linha de embalagem é de um canal só: balcão OU delivery. Conferida antes de gravar (400).
  private conferirCanais(linhas: CreateIngredienteDto[] | undefined) {
    for (const i of linhas ?? [])
      if (i.somenteDelivery && i.somenteBalcao)
        throw new BadRequestException(
          `"${String(i.insumoNome ?? '').slice(0, 40)}" está como embalagem do balcão e do delivery ao mesmo tempo. Escolha um dos dois.`,
        );
  }

  // ----- Embalagem: a mesma no balcão e no delivery? (chave da empresa inteira) -----
  // Além da chave, devolve quantas fichas têm cada tipo de embalagem: é o que a tela usa para
  // dizer, antes de a pessoa confirmar, o que muda de conta.
  async embalagemConfig(tenantId: string) {
    const [n] = await this.db
      .select({
        delivery: sql<number>`count(distinct ${fichaIngrediente.fichaId}) filter (where ${fichaIngrediente.somenteDelivery})::int`,
        balcao: sql<number>`count(distinct ${fichaIngrediente.fichaId}) filter (where ${fichaIngrediente.somenteBalcao})::int`,
      })
      .from(fichaIngrediente)
      .innerJoin(fichaTecnica, and(eq(fichaTecnica.id, fichaIngrediente.fichaId), isNull(fichaTecnica.deletedAt)))
      .where(and(eq(fichaIngrediente.tenantId, tenantId), isNull(fichaIngrediente.deletedAt)));
    return {
      mesmaEmbalagem: await mesmaEmbalagemDaEmpresa(this.db, tenantId),
      fichasComEmbalagemDoDelivery: Number(n?.delivery) || 0,
      fichasComEmbalagemDoBalcao: Number(n?.balcao) || 0,
    };
  }

  async setEmbalagemConfig(tenantId: string, mesmaEmbalagem: boolean, ator?: { colaboradorId?: string; categoria?: string } | null) {
    const antes = await mesmaEmbalagemDaEmpresa(this.db, tenantId);
    await this.db
      .insert(entitlement)
      .values({ id: idEntitlement(tenantId, MODULO_MESMA_EMBALAGEM), tenantId, modulo: MODULO_MESMA_EMBALAGEM, ativo: mesmaEmbalagem })
      .onConflictDoUpdate({
        target: [entitlement.tenantId, entitlement.modulo],
        set: { ativo: mesmaEmbalagem, updatedAt: new Date() },
      });
    // Muda o custo de balcão e a baixa de estoque de todas as fichas: fica no registro de auditoria.
    if (antes !== mesmaEmbalagem)
      await this.auditoria?.registrar({
        tenantId,
        atorId: ator?.colaboradorId,
        atorPerfil: ator?.categoria,
        tipo: 'estoque',
        acao: 'ficha_mesma_embalagem',
        entidadeTipo: 'empresa',
        entidadeId: tenantId,
        detalhe: { de: antes, para: mesmaEmbalagem },
        origem: 'web',
      });
    return this.embalagemConfig(tenantId);
  }

  async create(tenantId: string, dto: CreateFichaDto) {
    this.conferirUnidadesLivres(dto.ingredientes);
    this.conferirCanais(dto.ingredientes);
    const [f] = await this.db
      .insert(fichaTecnica)
      .values({
        tenantId,
        nome: dto.nome,
        categoria: dto.categoria ?? 'base',
        rendimento: dto.rendimento != null ? String(dto.rendimento) : '1',
        rendimentoUnidade: dto.rendimentoUnidade === undefined ? undefined : unidadeOuPadrao(dto.rendimentoUnidade, 'Unidade do rendimento', 'porção'),
        porcaoTamanho: dto.porcaoTamanho != null ? String(dto.porcaoTamanho) : undefined,
        porcaoUnidade: dto.porcaoUnidade,
        validade: dto.validade,
        precoVenda: dto.precoVenda != null ? String(dto.precoVenda) : undefined,
        metaCmv: dto.metaCmv != null ? String(dto.metaCmv) : undefined,
        margemPerda: margemOuNada(dto.margemPerda),
        conversoes: conferirConversoes(dto.conversoes) ?? [],
        setorId: dto.setorId,
        unidadeId: dto.unidadeId,
        popId: dto.popId,
      })
      .returning();

    if (dto.ingredientes?.length) {
      // Sub-fichas devem existir no tenant (ficha nova não pode fechar ciclo).
      const subs = dto.ingredientes
        .map((i) => i.subFichaId)
        .filter((x): x is string => !!x);
      if (subs.length) {
        const { fichas } = await this.carregarTudo(tenantId);
        const validos = new Set(fichas.map((x) => x.id));
        for (const s of subs) {
          if (!validos.has(s)) {
            throw new BadRequestException('Sub-ficha inválida para este tenant.');
          }
        }
      }
      const linhas = await this.linhasParaGravar(tenantId, dto.ingredientes);
      await this.db.insert(fichaIngrediente).values(
        linhas.map((i, idx) => ({
          tenantId,
          fichaId: f.id,
          itemId: i.subFichaId ? undefined : i.itemId,
          subFichaId: i.subFichaId,
          insumoNome: i.insumoNome,
          quantidade: i.quantidade != null ? String(i.quantidade) : '0',
          unidade: i.unidade,
          fatorCorrecao:
            i.fatorCorrecao != null ? String(i.fatorCorrecao) : '1',
          custoUnitario:
            i.custoUnitario != null ? String(i.custoUnitario) : '0',
          somenteDelivery: i.somenteDelivery ?? false,
          somenteBalcao: i.somenteBalcao ?? false,
          ordem: i.ordem ?? idx,
        })),
      );
    }
    return this.getOne(tenantId, f.id);
  }

  // Carrega todas as fichas do tenant + ingredientes → mapa p/ custo recursivo, e os produtos do
  // estoque feitos na loja (a mesma carga que o cadastro do estoque usa — `fichas-carga.ts`).
  private carregarTudo(tenantId: string) {
    return carregarFichas(this.db, tenantId);
  }

  // Unidade de estoque e conversões dos produtos ligados às linhas (para converter a quantidade), e o
  // nome atual (o que a linha grava).
  async unidadesDosItens(tenantId: string, itemIds: (string | null | undefined)[]) {
    const ids = [...new Set(itemIds.filter((x): x is string => !!x))];
    const mapa = new Map<string, { unidade: string; conversoes: Conversao[]; nome: string }>();
    if (!ids.length) return mapa;
    // As duas leituras ao mesmo tempo: uma ida ao banco a menos (cada uma custa ~115 ms — ERR-245).
    const [itens, convs] = await Promise.all([
      this.db
        .select({ id: itemEstoque.id, unidade: itemEstoque.unidadeMedida, nome: itemEstoque.nome })
        .from(itemEstoque)
        .where(and(eq(itemEstoque.tenantId, tenantId), inArray(itemEstoque.id, ids))),
      this.db
        .select({
          itemId: itemConversao.itemId,
          unidadeDe: itemConversao.unidadeDe,
          fator: itemConversao.fator,
          unidadePara: itemConversao.unidadePara,
        })
        .from(itemConversao)
        .where(and(eq(itemConversao.tenantId, tenantId), inArray(itemConversao.itemId, ids))),
    ]);
    for (const i of itens) mapa.set(i.id, { unidade: i.unidade, conversoes: [], nome: i.nome });
    for (const c of convs) mapa.get(c.itemId)?.conversoes.push(c);
    return mapa;
  }

  // Unidade do rendimento, conversões e rendimento das fichas usadas como SUB-RECEITA: a linha que
  // usa uma delas é gravada na unidade em que ela rende (mig 319). E o nome atual (o que a linha grava).
  async unidadesDasFichas(tenantId: string, fichaIds: (string | null | undefined)[]) {
    const ids = [...new Set(fichaIds.filter((x): x is string => !!x))];
    const mapa = new Map<string, Rendimento & { nome: string }>();
    if (!ids.length) return mapa;
    const fichas = await this.db
      .select({
        id: fichaTecnica.id,
        nome: fichaTecnica.nome,
        rendimentoUnidade: fichaTecnica.rendimentoUnidade,
        conversoes: fichaTecnica.conversoes,
        rendimento: fichaTecnica.rendimento,
      })
      .from(fichaTecnica)
      .where(and(eq(fichaTecnica.tenantId, tenantId), inArray(fichaTecnica.id, ids)));
    for (const f of fichas) mapa.set(f.id, { ...rendeEm(f), nome: f.nome });
    return mapa;
  }

  // A linha chega com a quantidade e o custo NA UNIDADE ESCOLHIDA ("2 unidade" de um bacon em
  // kg, a R$ 0,50 a fatia) e é GRAVADA na unidade do estoque (0,02778 kg, a R$ 36 o kg) — a mesma
  // em que a venda e a produção baixam e em que o custo da ficha é somado. É por isso que nenhuma
  // rotina de baixa precisou mudar. A SUB-RECEITA idem, na unidade em que ela rende (mig 319): "35
  // grama" de um molho que rende 1 kg é gravado 0,035 — antes ficava 35 e contava 35 kg (ERR-229).
  // Linha sem produto ligado, ou com unidade que o produto (ou a sub-receita) não alcança, fica como veio.
  // O NOME gravado na linha ligada é o atual do produto (ou da sub-receita), não o texto que a tela
  // mandou: a ficha aberta antes de alguém renomear o produto mandaria o nome antigo (ERR-231). Quem
  // renomeia depois é coberto pelo gatilho da mig 322, na nuvem.
  private async linhasParaGravar<T extends CreateIngredienteDto>(tenantId: string, linhas: T[]): Promise<T[]> {
    const unidades = await this.unidadesDosItens(
      tenantId,
      linhas.map((i) => (i.subFichaId ? null : i.itemId)),
    );
    const subs = await this.unidadesDasFichas(tenantId, linhas.map((i) => i.subFichaId));
    return linhas.map((i) => {
      // Insumo escrito à mão (sem produto do estoque nem sub-receita): a unidade é só rótulo, mas
      // sai da MESMA lista do estoque — "un" vira "unidade"; o que não existe é recusado (400).
      if (!i.subFichaId && !i.itemId)
        return { ...i, unidade: unidadeOuPadrao(i.unidade, `Unidade de "${String(i.insumoNome ?? '').slice(0, 40)}"`) };
      const sub = i.subFichaId ? subs.get(i.subFichaId) : undefined;
      const item = !i.subFichaId && i.itemId ? unidades.get(i.itemId) : undefined;
      const nomeAtual = sub?.nome ?? item?.nome;
      if (nomeAtual && nomeAtual !== i.insumoNome) i = { ...i, insumoNome: nomeAtual };
      // Sub-receita sem unidade informada: a do rendimento dela.
      if (sub && !String(i.unidade ?? '').trim()) i = { ...i, unidade: sub.unidade };
      const u = sub ?? item;
      const fator = u ? fatorParaEstoque(i.unidade, u.unidade, u.conversoes) ?? 1 : 1;
      if (fator === 1) return i;
      return {
        ...i,
        quantidade: i.quantidade != null ? arredondarEstoque(Number(i.quantidade) * fator) : i.quantidade,
        custoUnitario: i.custoUnitario != null ? arredondarEstoque(Number(i.custoUnitario) / fator) : i.custoUnitario,
      };
    });
  }

  // Devolve cada linha como a pessoa a informou (quantidade e custo na unidade escolhida) e,
  // ao lado, o que está gravado: a quantidade na unidade do estoque (ou do rendimento da
  // sub-receita). Anexa o nome da sub-ficha.
  private async enriquecer(
    tenantId: string,
    ings: any[],
    nome: Record<string, string>,
    mapa: Record<string, FichaCusto>,
    fichaDoItem: Map<string, string>,
    fichas: any[],
  ) {
    const unidades = await this.unidadesDosItens(tenantId, ings.map((i) => (i.subFichaId ? null : i.itemId)));
    const subs = new Map(fichas.map((f) => [f.id as string, rendeEm(f)]));
    return ings.map((i) => {
      const sub = i.subFichaId ? subs.get(i.subFichaId) : undefined;
      const u = sub ?? (!i.subFichaId && i.itemId ? unidades.get(i.itemId) : undefined);
      const fator = u ? fatorParaEstoque(i.unidade, u.unidade, u.conversoes) ?? 1 : 1;
      // Produto FEITO NA LOJA (mig 314): o custo da linha é o da ficha que o produz — calculado
      // agora, não o que ficou gravado quando a linha foi salva. A sub-receita idem: o custo de uma
      // unidade do rendimento dela, agora.
      const fichaDoItemId = !i.subFichaId && i.itemId ? fichaDoItem.get(i.itemId) ?? null : null;
      const pelaFicha = i.subFichaId ? custoPorUnidadeDaFicha(i.subFichaId, mapa) : fichaDoItemId ? custoPorUnidadeDaFicha(fichaDoItemId, mapa) : 0;
      const custoNoEstoque = pelaFicha > 0 ? pelaFicha : Number(i.custoUnitario);
      return {
        ...i,
        ...(pelaFicha > 0 ? { custoUnitario: String(arredondarInformado(pelaFicha)) } : {}),
        ...(fator === 1
          ? {}
          : {
              quantidade: String(arredondarInformado(Number(i.quantidade) / fator)),
              custoUnitario: String(arredondarInformado(custoNoEstoque * fator)),
            }),
        fichaDoItemId,
        fichaDoItemNome: fichaDoItemId ? nome[fichaDoItemId] ?? null : null,
        quantidadeEstoque: Number(i.quantidade),
        unidadeEstoque: u?.unidade ?? null,
        fatorUnidade: fator,
        subFichaNome: i.subFichaId ? nome[i.subFichaId] ?? null : null,
      };
    });
  }

  // Mapa fichaId → custo por porção (balcão e delivery). Usado por outros módulos
  // (catálogo) p/ derivar o custo de um produto ligado a uma ficha.
  async custoPorPorcao(
    tenantId: string,
  ): Promise<Record<string, { balcao: number; delivery: number }>> {
    const { fichas, mapa, mesmaEmbalagem } = await this.carregarTudo(tenantId);
    const out: Record<string, { balcao: number; delivery: number }> = {};
    for (const f of fichas) {
      const rend = Number(f.rendimento) || 1;
      out[f.id] = {
        balcao: custoTotalFicha(f.id, mapa, 'balcao', mesmaEmbalagem) / rend,
        delivery: custoTotalFicha(f.id, mapa, 'delivery', mesmaEmbalagem) / rend,
      };
    }
    return out;
  }

  async list(tenantId: string) {
    const { fichas, ings, mapa, nome, feitos, fichaDoItem, mesmaEmbalagem } = await this.carregarTudo(tenantId);
    const linhas = await this.enriquecer(tenantId, ings, nome, mapa, fichaDoItem, fichas);
    return fichas.map((f) => {
      const fi = linhas
        .filter((i) => i.fichaId === f.id)
        .sort((a, b) => Number(a.ordem) - Number(b.ordem));
      const custoBalcao = custoTotalFicha(f.id, mapa, 'balcao', mesmaEmbalagem);
      const custoDelivery = custoTotalFicha(f.id, mapa, 'delivery', mesmaEmbalagem);
      return {
        ...f,
        ingredientes: fi,
        // Os produtos do estoque que esta ficha PRODUZ (feitos na loja — mig 314).
        produtosFeitos: feitos.filter((p) => p.fichaId === f.id).map((p) => ({ id: p.itemId, nome: p.nome })),
        ...computarDois(f, custoBalcao, custoDelivery),
      };
    });
  }

  async getOne(tenantId: string, id: string) {
    const { fichas, ings, mapa, nome, feitos, fichaDoItem, mesmaEmbalagem } = await this.carregarTudo(tenantId);
    const f = fichas.find((x) => x.id === id);
    if (!f) throw new NotFoundException('Ficha não encontrada');
    const fi = ings
      .filter((i) => i.fichaId === id)
      .sort((a, b) => Number(a.ordem) - Number(b.ordem));
    const custoBalcao = custoTotalFicha(id, mapa, 'balcao', mesmaEmbalagem);
    const custoDelivery = custoTotalFicha(id, mapa, 'delivery', mesmaEmbalagem);
    return {
      ...f,
      ingredientes: await this.enriquecer(tenantId, fi, nome, mapa, fichaDoItem, fichas),
      produtosFeitos: feitos.filter((p) => p.fichaId === id).map((p) => ({ id: p.itemId, nome: p.nome })),
      ...computarDois(f, custoBalcao, custoDelivery),
    };
  }

  async update(tenantId: string, id: string, dto: UpdateFichaDto) {
    await this.getOne(tenantId, id);
    this.conferirUnidadesLivres(dto.ingredientes);
    this.conferirCanais(dto.ingredientes);
    if (dto.rendimentoUnidade !== undefined) unidadeOuPadrao(dto.rendimentoUnidade, 'Unidade do rendimento', 'porção');
    // Conferidas antes de gravar qualquer coisa: a recusa (400) não deixa a ficha pela metade.
    const conversoes = conferirConversoes(dto.conversoes);
    const patch: any = {};
    if (dto.nome !== undefined) patch.nome = dto.nome;
    if (dto.categoria !== undefined) patch.categoria = dto.categoria;
    if (dto.rendimento !== undefined) patch.rendimento = String(dto.rendimento);
    if (dto.rendimentoUnidade !== undefined)
      patch.rendimentoUnidade = unidadeOuPadrao(dto.rendimentoUnidade, 'Unidade do rendimento', 'porção');
    // Tamanho da porção (mig 130): converte porções (un) ↔ rendimento na ordem de produção.
    if (dto.porcaoTamanho !== undefined)
      patch.porcaoTamanho = dto.porcaoTamanho != null ? String(dto.porcaoTamanho) : null;
    if (dto.porcaoUnidade !== undefined) patch.porcaoUnidade = dto.porcaoUnidade || null;
    if (dto.validade !== undefined) patch.validade = dto.validade;
    if (dto.precoVenda !== undefined)
      patch.precoVenda = dto.precoVenda != null ? String(dto.precoVenda) : null;
    if (dto.metaCmv !== undefined) patch.metaCmv = String(dto.metaCmv);
    // Margem de perda (mig 318): ausente mantém; `null` (ou 0) tira.
    if (dto.margemPerda !== undefined) patch.margemPerda = margemOuNada(dto.margemPerda);
    if (dto.setorId !== undefined) patch.setorId = dto.setorId;
    if (dto.popId !== undefined) patch.popId = dto.popId;
    if (dto.ativo !== undefined) patch.ativo = dto.ativo;
    // Conversões do rendimento (mig 319): ausente mantém; [] tira.
    if (conversoes !== undefined) patch.conversoes = conversoes;
    let subReceitasAjustadas = 0;
    if (Object.keys(patch).length) {
      const doRegistro = and(eq(fichaTecnica.id, id), eq(fichaTecnica.tenantId, tenantId));
      const colunas = { rendimentoUnidade: fichaTecnica.rendimentoUnidade, conversoes: fichaTecnica.conversoes, rendimento: fichaTecnica.rendimento };
      const mexeNaUnidade = patch.rendimentoUnidade !== undefined || patch.conversoes !== undefined;
      // A unidade do rendimento ou as conversões mudaram: as linhas das fichas que usam esta como
      // sub-receita são refeitas na MESMA transação (`reconverterSubReceitas`). A trava na linha da
      // ficha impede que duas edições ao mesmo tempo partam do mesmo "antes".
      subReceitasAjustadas = await this.db.transaction(async (tx) => {
        const [antes] = mexeNaUnidade ? await tx.select(colunas).from(fichaTecnica).where(doRegistro).for('update') : [];
        const [depois] = await tx.update(fichaTecnica).set(patch).where(doRegistro).returning(colunas);
        return antes && depois ? this.reconverterSubReceitas(tx, tenantId, id, rendeEm(antes), rendeEm(depois)) : 0;
      });
    }
    // Ingredientes (replace-all) quando enviados — valida ciclo das sub-fichas.
    if (dto.ingredientes) {
      for (const s of dto.ingredientes
        .map((i) => i.subFichaId)
        .filter((x): x is string => !!x)) {
        await this.validarSubFicha(tenantId, id, s);
      }
      await this.validarProdutosFeitos(
        tenantId,
        id,
        dto.ingredientes.filter((i) => !i.subFichaId && i.itemId).map((i) => i.itemId as string),
      );
      // SOFT-delete (mig 242), não delete físico: a tabela sincroniza para o servidor
      // local por delta de linha. Apagar de verdade some da nuvem mas NÃO some do edge
      // — ele ficaria com o ingrediente antigo somado ao novo e baixaria insumo a mais.
      await this.db
        .update(fichaIngrediente)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(fichaIngrediente.fichaId, id),
            eq(fichaIngrediente.tenantId, tenantId),
            isNull(fichaIngrediente.deletedAt),
          ),
        );
      const linhas = await this.linhasParaGravar(tenantId, dto.ingredientes);
      if (linhas.length)
        await this.db.insert(fichaIngrediente).values(
          linhas.map((i, idx) => ({
            tenantId,
            fichaId: id,
            itemId: i.subFichaId ? undefined : i.itemId,
            subFichaId: i.subFichaId,
            insumoNome: i.insumoNome,
            quantidade: i.quantidade != null ? String(i.quantidade) : '0',
            unidade: i.unidade,
            fatorCorrecao: i.fatorCorrecao != null ? String(i.fatorCorrecao) : '1',
            custoUnitario: i.custoUnitario != null ? String(i.custoUnitario) : '0',
            somenteDelivery: i.somenteDelivery ?? false,
            somenteBalcao: i.somenteBalcao ?? false,
            ordem: i.ordem ?? idx,
          })),
        );
    }
    return { ...(await this.getOne(tenantId, id)), subReceitasAjustadas };
  }

  // A linha de outra ficha que usa ESTA como sub-receita guarda a quantidade na unidade em que esta
  // rende (35 grama de um molho que rende 1 kg = 0,035) e, ao lado, a unidade que a pessoa escolheu.
  // Mudou a unidade do rendimento ou uma conversão (1 saco passa a ser 2 kg): o que a pessoa
  // informou — "35 grama" — continua valendo e a quantidade gravada é refeita. A unidade da linha
  // que deixou de ser alcançada passa a ser a do rendimento, com a MESMA parte da receita (a conta
  // de custo e de baixa não muda). Mesma regra de `estoque.service › reconverterFichas`, para o
  // produto do estoque. Devolve quantas linhas foram regravadas.
  private async reconverterSubReceitas(tx: any, tenantId: string, fichaId: string, antes: Rendimento, depois: Rendimento): Promise<number> {
    const assinatura = (r: Rendimento) =>
      JSON.stringify([chaveUnidade(r.unidade), r.conversoes.map((c) => [chaveUnidade(c.unidadeDe), Number(c.fator), chaveUnidade(c.unidadePara)])]);
    if (assinatura(antes) === assinatura(depois)) return 0; // salvou sem mexer na unidade nem nas conversões
    const linhas = await tx
      .select({ id: fichaIngrediente.id, unidade: fichaIngrediente.unidade })
      .from(fichaIngrediente)
      .where(and(eq(fichaIngrediente.tenantId, tenantId), eq(fichaIngrediente.subFichaId, fichaId), isNull(fichaIngrediente.deletedAt)));
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
        const escala = depois.rendimento / antes.rendimento;
        await tx
          .update(fichaIngrediente)
          .set({
            unidade: depois.unidade,
            ...(Math.abs(escala - 1) < 1e-12 ? {} : { quantidade: sql`round(${fichaIngrediente.quantidade} * ${String(escala)}::numeric, 15)` }),
          })
          .where(inArray(fichaIngrediente.id, g.ids));
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

  async remove(tenantId: string, id: string) {
    await this.getOne(tenantId, id);
    await this.db
      .update(fichaTecnica)
      .set({ deletedAt: new Date() })
      .where(and(eq(fichaTecnica.id, id), eq(fichaTecnica.tenantId, tenantId)));
    return { ok: true };
  }

  // Ingrediente que é um produto FEITO NA LOJA (mig 314): a ficha que o produz não pode depender
  // desta — o custo de uma entraria no da outra, em círculo.
  private async validarProdutosFeitos(tenantId: string, fichaId: string, itemIds: string[]) {
    if (!itemIds.length) return;
    const { ings, feitos, fichaDoItem, nome } = await this.carregarTudo(tenantId);
    const dependencias = dependenciasDasFichas(ings, fichaDoItem);
    for (const itemId of new Set(itemIds)) {
      const feitaPor = fichaDoItem.get(itemId);
      if (!feitaPor) continue;
      const produto = feitos.find((p) => p.itemId === itemId)?.nome ?? 'O produto';
      if (feitaPor === fichaId)
        throw new BadRequestException(`"${produto}" é feito por esta ficha: ele não pode ser ingrediente dela mesma.`);
      if (fichaAlcancavel(feitaPor, fichaId, dependencias))
        throw new BadRequestException(`"${produto}" é feito pela ficha "${nome[feitaPor]}", que depende desta: usá-lo aqui criaria um ciclo de fichas.`);
    }
  }

  // Garante que a sub-ficha existe no tenant e que a ligação não cria ciclo.
  private async validarSubFicha(
    tenantId: string,
    fichaId: string,
    subFichaId: string,
  ) {
    if (subFichaId === fichaId) {
      throw new BadRequestException('Uma ficha não pode ser sub-receita dela mesma.');
    }
    const { fichas, ings, fichaDoItem } = await this.carregarTudo(tenantId);
    if (!fichas.some((f) => f.id === subFichaId)) {
      throw new BadRequestException('Sub-ficha inválida para este tenant.');
    }
    // Dependências: as sub-receitas E as fichas dos produtos feitos na loja que cada ficha usa.
    const arestas = dependenciasDasFichas(ings, fichaDoItem);
    // Adicionar pai→sub cria ciclo se a sub-ficha já alcança o pai.
    if (fichaAlcancavel(subFichaId, fichaId, arestas)) {
      throw new BadRequestException(
        'Isso criaria um ciclo de fichas (A usa B que usa A).',
      );
    }
  }

  async addIngrediente(
    tenantId: string,
    fichaId: string,
    dto: CreateIngredienteDto,
  ) {
    await this.getOne(tenantId, fichaId);
    this.conferirCanais([dto]);
    if (dto.subFichaId) await this.validarSubFicha(tenantId, fichaId, dto.subFichaId);
    else if (dto.itemId) await this.validarProdutosFeitos(tenantId, fichaId, [dto.itemId]);
    const [linha] = await this.linhasParaGravar(tenantId, [dto]);
    await this.db.insert(fichaIngrediente).values({
      tenantId,
      fichaId,
      itemId: dto.subFichaId ? undefined : dto.itemId,
      subFichaId: dto.subFichaId,
      insumoNome: linha.insumoNome,
      quantidade: linha.quantidade != null ? String(linha.quantidade) : '0',
      unidade: linha.unidade,
      fatorCorrecao: dto.fatorCorrecao != null ? String(dto.fatorCorrecao) : '1',
      custoUnitario: linha.custoUnitario != null ? String(linha.custoUnitario) : '0',
      somenteDelivery: dto.somenteDelivery ?? false,
      somenteBalcao: dto.somenteBalcao ?? false,
      ordem: dto.ordem ?? 0,
    });
    return this.getOne(tenantId, fichaId);
  }

  async removeIngrediente(tenantId: string, id: string) {
    // Soft-delete: a exclusão precisa DESCER para o servidor local (ver mig 242).
    await this.db
      .update(fichaIngrediente)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(fichaIngrediente.id, id),
          eq(fichaIngrediente.tenantId, tenantId),
        ),
      );
    return { ok: true };
  }
}
