import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  etiquetaTemplate,
  etiquetaValidade,
  produto,
  fichaTecnica,
  itemEstoque,
  lote,
  empresa,
  cardapioConfig,
  impressaoJob,
  equipamento,
  desperdicio,
  colaborador,
  fornecedor,
} from '../../db/schema';
import { condUnidade, condUnidadeOuRede } from '../../common/filtro-unidade';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { gravarOuEncaminharImpressao } from '../../common/impressao-destino';
import { dataNoFuso, hojeISO, horaNoFuso } from '../../common/data';
import { DesperdicioService } from '../desperdicio/desperdicio.service';
import { candidatosCodigoLido, escolherPorCodigoLido } from './codigo-lido';
import {
  CAMPOS_PADRAO,
  MODELOS_ETIQUETA,
  montarConteudoEtiqueta,
  nomeCurto,
  type DadosEtiqueta,
} from './etiqueta-conteudo';

/* eslint-disable @typescript-eslint/no-explicit-any */
// QUINTA cópia de `hojeISO` em UTC, achada depois do conserto das outras quatro:
// esta escapou da guarda de deriva porque é arrow function e o teste procurava
// `function hojeISO`. A guarda foi ampliada junto com este conserto.
//
// O efeito aqui é direto: a validade da etiqueta nasce de `fabricacao`, que cai em
// `hojeISO()` quando não vem no corpo. Às 21h em São Paulo o UTC já é o dia seguinte,
// então a etiqueta impressa à noite dizia vencer um dia DEPOIS do certo — num controle
// que existe exatamente para não usar alimento fora do prazo (RDC 216).
const addDias = (iso: string, d: number) => {
  // Meio-dia UTC + aritmética em UTC: o cálculo não depende do fuso do servidor.
  // Antes montava `iso + 'T00:00:00'` (hora LOCAL) e lia de volta com toISOString()
  // (UTC) — acertava por coincidência no Brasil e na nuvem, e erraria um dia em
  // qualquer servidor a leste de Greenwich.
  const dt = new Date(`${iso}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + d);
  return dt.toISOString().slice(0, 10);
};

@Injectable()
export class EtiquetaValidadeService {
  private readonly log = new Logger(EtiquetaValidadeService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly events: EventEmitter2,
    private readonly desperdicios: DesperdicioService,
  ) {}

  // Estados em que a etiqueta ainda representa algo NA PRATELEIRA. `baixado`
  // (consumido), `vencido` (já virou perda) e `substituida` são terminais: agir sobre
  // eles gerava perda de algo já consumido, ou uma segunda perda do mesmo pote.
  private static readonly VIVA = ['fechado', 'em_uso'];

  // Carrega COM TRAVA de linha e roda `fn` no mesmo commit. Ler o status e agir em
  // cima dele sem trava deixava dois cliques em "virou perda" gerarem dois desperdícios.
  private async comTrava<T>(
    tenantId: string,
    id: string,
    fn: (tx: any, e: any) => Promise<T>,
  ): Promise<T> {
    return this.db.transaction(async (tx) => {
      const [e] = await tx
        .select()
        .from(etiquetaValidade)
        .where(
          and(
            eq(etiquetaValidade.id, id),
            eq(etiquetaValidade.tenantId, tenantId),
            isNull(etiquetaValidade.deletedAt),
          ),
        )
        .for('update');
      if (!e) throw new NotFoundException('Etiqueta não encontrada.');
      return fn(tx, e);
    });
  }

  private exigirViva(e: any, acao: string) {
    if (!EtiquetaValidadeService.VIVA.includes(e.status))
      throw new BadRequestException(
        `Não dá para ${acao}: esta etiqueta já está "${e.status}".`,
      );
  }

  // ===== Template =====
  async getTemplate(tenantId: string) {
    const [t] = await this.db
      .select()
      .from(etiquetaTemplate)
      .where(and(eq(etiquetaTemplate.tenantId, tenantId), eq(etiquetaTemplate.padrao, true)))
      .limit(1);
    if (t) return t;
    // Sem template salvo: devolve um padrão (não persiste até salvar).
    return {
      id: null,
      nome: 'Padrão',
      campos: CAMPOS_PADRAO,
      tamanho: '40x40',
      codigoTipo: 'code128',
      modelo: 'classico',
      padrao: true,
    };
  }

  async salvarTemplate(tenantId: string, dto: any) {
    const campos = Array.isArray(dto?.campos) && dto.campos.length ? dto.campos : CAMPOS_PADRAO;
    // Tamanho LxA em mm: aceita qualquer valor são (10–200mm) — presets ou personalizado.
    const tRaw = String(dto?.tamanho ?? '').trim().toLowerCase().replace(/\s/g, '');
    const mT = tRaw.match(/^(\d{1,3})x(\d{1,3})$/);
    const tamanho =
      mT && +mT[1] >= 10 && +mT[1] <= 200 && +mT[2] >= 10 && +mT[2] <= 200
        ? `${+mT[1]}x${+mT[2]}`
        : '40x40';
    const codigoTipo = ['nenhum', 'ean13', 'code128', 'qr'].includes(dto?.codigoTipo) ? dto.codigoTipo : 'code128';
    // Modelo do desenho (mig 306). Valor desconhecido é recusado; AUSENTE mantém o que
    // está salvo — tela antiga (ou outra integração) que salva sem o campo não pode
    // devolver a loja ao clássico sem ninguém pedir.
    if (dto?.modelo != null && !MODELOS_ETIQUETA.includes(dto.modelo))
      throw new BadRequestException('Modelo de etiqueta inválido. Use "classico" ou "moderno".');
    const [existente] = await this.db
      .select({ id: etiquetaTemplate.id, modelo: etiquetaTemplate.modelo })
      .from(etiquetaTemplate)
      .where(and(eq(etiquetaTemplate.tenantId, tenantId), eq(etiquetaTemplate.padrao, true)))
      .limit(1);
    const modelo: string = dto?.modelo ?? existente?.modelo ?? 'classico';
    if (existente) {
      const [row] = await this.db
        .update(etiquetaTemplate)
        .set({ nome: dto?.nome ?? 'Padrão', campos, tamanho, codigoTipo, modelo, updatedAt: new Date() })
        .where(eq(etiquetaTemplate.id, existente.id))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(etiquetaTemplate)
      .values({ tenantId, nome: dto?.nome ?? 'Padrão', campos, tamanho, codigoTipo, modelo, padrao: true })
      .returning();
    return row;
  }

  // ===== Fontes (produtos com validade + fichas) =====
  async fontes(tenantId: string, atual: string | null = null) {
    const prods = await this.db
      .select({
        id: produto.id, nome: produto.nome, unidade: produto.unidadeMedida,
        fechado: produto.validadeFechadoDias, aberto: produto.validadeAbertoDias,
      })
      .from(produto)
      .where(and(eq(produto.tenantId, tenantId), eq(produto.controlaValidade, true), isNull(produto.deletedAt)))
      .orderBy(produto.nome);
    const fichas = await this.db
      .select({
        id: fichaTecnica.id, nome: fichaTecnica.nome, unidade: fichaTecnica.rendimentoUnidade,
        fechado: fichaTecnica.validadeDias, aberto: fichaTecnica.validadeAbertoDias,
      })
      .from(fichaTecnica)
      .where(and(eq(fichaTecnica.tenantId, tenantId), eq(fichaTecnica.ativo, true), isNull(fichaTecnica.deletedAt)))
      .orderBy(fichaTecnica.nome);
    // Insumos (item_estoque) com validade cadastrada — a validade é uma DATA
    // absoluta (não dias fechado/aberto), então entram como fonte direta.
    const itens = await this.db
      .select({
        id: itemEstoque.id, nome: itemEstoque.nome,
        unidade: itemEstoque.unidadeMedida, validade: itemEstoque.validade,
      })
      .from(itemEstoque)
      .where(and(eq(itemEstoque.tenantId, tenantId), isNotNull(itemEstoque.validade), isNull(itemEstoque.deletedAt)))
      .orderBy(itemEstoque.nome);
    // LOTES (mig 246) — a fonte que faltava. Etiquetar um insumo comprado exigia
    // `item_estoque.validade`, uma data FIXA no cadastro; mas cada compra do mesmo
    // insumo chega com uma validade diferente, então essa data nunca serviria. O lote
    // carrega a validade daquela entrega, e a etiqueta que sai dele guarda o vínculo:
    // é o que faz um recall alcançar até o que já foi ABERTO.
    const lotesAtivos = await this.db
      .select({
        id: lote.id,
        itemId: lote.itemId,
        nome: itemEstoque.nome,
        unidade: itemEstoque.unidadeMedida,
        validade: lote.validade,
        codigo: lote.codigo,
        quantidade: lote.quantidade,
      })
      .from(lote)
      .innerJoin(itemEstoque, eq(itemEstoque.id, lote.itemId))
      .where(
        and(
          eq(lote.tenantId, tenantId),
          isNull(lote.deletedAt),
          eq(lote.esgotado, false),
          // Sem validade não há etiqueta de validade para imprimir (a coluna é NOT NULL).
          isNotNull(lote.validade),
          condUnidadeOuRede(itemEstoque.unidadeId, atual),
        ),
      )
      .orderBy(lote.validade);

    return {
      produtos: prods.map((p) => ({ tipo: 'produto', ...p })),
      fichas: fichas
        .filter((f) => f.fechado != null || f.aberto != null)
        .map((f) => ({ tipo: 'ficha', ...f })),
      itens: itens.map((i) => ({ tipo: 'item', ...i })),
      lotes: lotesAtivos.map((l) => ({ tipo: 'lote', ...l })),
    };
  }

  // ===== Criar etiqueta(s) + imprimir =====
  async criar(
    tenantId: string,
    atorId: string | null,
    dto: {
      produtoId?: string;
      fichaId?: string;
      itemId?: string; // insumo (item_estoque) — validade absoluta
      loteId?: string; // lote da compra (mig 246) — validade DAQUELA entrega
      tipoUso?: 'novo' | 'usado';
      quantidade?: number;
      fabricacao?: string;
      compra?: string;
      impressoraId?: string;
      unidadeId?: string;
    },
    atual: string | null = null,
  ) {
    if (!dto.produtoId && !dto.fichaId && !dto.itemId && !dto.loteId)
      throw new BadRequestException('Escolha um produto, ficha, insumo ou lote.');
    const usado = dto.tipoUso === 'usado';
    const fabricacao = dto.fabricacao || hojeISO();

    // Nome + validade da fonte. Produto/ficha usam DIAS (fechado/aberto); insumo
    // (item_estoque) tem uma DATA de validade absoluta cadastrada.
    let descricao = 'Produto';
    let unidadeMedida: string | null = null;
    let validade: string;
    let loteIdOk: string | null = null;
    let itemIdOk: string | null = dto.itemId ?? null;
    if (dto.loteId) {
      const [lt] = await this.db
        .select({
          id: lote.id, itemId: lote.itemId, validade: lote.validade,
          nome: itemEstoque.nome, unidadeMedida: itemEstoque.unidadeMedida,
        })
        .from(lote)
        .innerJoin(itemEstoque, eq(itemEstoque.id, lote.itemId))
        .where(and(eq(lote.id, dto.loteId), eq(lote.tenantId, tenantId), isNull(lote.deletedAt)));
      if (!lt) throw new NotFoundException('Lote não encontrado.');
      if (!lt.validade)
        throw new BadRequestException(
          'Este lote foi recebido com validade indefinida — não há data para a etiqueta.',
        );
      descricao = lt.nome;
      unidadeMedida = lt.unidadeMedida;
      validade = String(lt.validade).slice(0, 10);
      // O insumo vai junto: é por ele que `abrir()` recalcula a validade após aberto.
      itemIdOk = lt.itemId;
      loteIdOk = lt.id;
    } else if (dto.itemId) {
      const [it] = await this.db.select().from(itemEstoque).where(and(eq(itemEstoque.id, dto.itemId), eq(itemEstoque.tenantId, tenantId)));
      if (!it) throw new NotFoundException('Insumo não encontrado.');
      if (!it.validade)
        throw new BadRequestException('Cadastre a validade do insumo antes de gerar a etiqueta.');
      descricao = it.nome;
      unidadeMedida = it.unidadeMedida;
      validade = String(it.validade).slice(0, 10);
    } else {
      let diasFechado: number | null = null;
      let diasAberto: number | null = null;
      if (dto.produtoId) {
        const [p] = await this.db.select().from(produto).where(and(eq(produto.id, dto.produtoId), eq(produto.tenantId, tenantId)));
        if (!p) throw new NotFoundException('Produto não encontrado.');
        descricao = p.nome;
        unidadeMedida = p.unidadeMedida;
        diasFechado = p.validadeFechadoDias ?? p.validadeDias ?? null;
        diasAberto = p.validadeAbertoDias ?? null;
      } else {
        const [f] = await this.db.select().from(fichaTecnica).where(and(eq(fichaTecnica.id, dto.fichaId as string), eq(fichaTecnica.tenantId, tenantId)));
        if (!f) throw new NotFoundException('Ficha não encontrada.');
        descricao = f.nome;
        unidadeMedida = f.rendimentoUnidade;
        diasFechado = f.validadeDias ?? null;
        diasAberto = f.validadeAbertoDias ?? null;
      }
      const dias = usado ? diasAberto : diasFechado;
      if (dias == null)
        throw new BadRequestException(
          usado ? 'Cadastre a validade após aberto no produto/ficha.' : 'Cadastre a validade fechado no produto/ficha.',
        );
      validade = addDias(usado ? hojeISO() : fabricacao, dias);
    }
    const qtd = Math.max(1, Math.min(50, Number(dto.quantidade) || 1));

    const template = await this.getTemplate(tenantId);
    const [emp] = await this.db.select({ nome: empresa.nome }).from(empresa).where(eq(empresa.id, tenantId));
    // Nome que sai na etiqueta = "Nome do estabelecimento" (Configurações → Loja =
    // cardapio_config.nomePublico); prefere a unidade atual, cai no nome da empresa.
    const cfgsLoja = await this.db
      .select({ unidadeId: cardapioConfig.unidadeId, nomePublico: cardapioConfig.nomePublico })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, tenantId));
    const cfgLoja =
      cfgsLoja.find((c) => c.unidadeId === atual) ??
      cfgsLoja.find((c) => c.unidadeId == null) ??
      cfgsLoja[0];
    const nomeLoja = cfgLoja?.nomePublico?.trim() || emp?.nome || 'Regem';
    const extras = await this.extrasDaEtiqueta(tenantId, {
      atorId, loteId: loteIdOk, fabricacao, criadaEm: new Date(),
    });
    const criadas: any[] = [];
    for (let i = 0; i < qtd; i++) {
      const codigo = this.gerarCodigo();
      const [row] = await this.db
        .insert(etiquetaValidade)
        .values({
          tenantId,
          unidadeId: atual ?? dto.unidadeId ?? null,
          produtoId: dto.produtoId ?? null,
          fichaId: dto.fichaId ?? null,
          itemId: itemIdOk,
          loteId: loteIdOk,
          templateId: (template as any).id ?? null,
          descricao,
          unidadeMedida,
          tipo: usado ? 'usado' : 'novo',
          status: usado ? 'em_uso' : 'fechado',
          fabricacao,
          compra: dto.compra ?? null,
          abertura: usado ? new Date() : null,
          validade,
          codigo,
          impressaEm: new Date(),
          criadoPorId: atorId,
        })
        .returning();
      criadas.push(row);
      // Imprime (fila do edge). Sem impressora → só registra a etiqueta.
      await this.enfileirarImpressao(tenantId, atual, dto.impressoraId, template, {
        loja: nomeLoja,
        descricao, unidadeMedida, tipoUso: usado ? 'EM USO' : 'FECHADO',
        fabricacao, compra: dto.compra ?? null, validade, codigo,
        ...extras,
      }).catch(() => {});
    }
    await this.auditoria.registrar({
      tenantId, atorId: atorId ?? undefined, atorPerfil: 'gestao',
      tipo: 'estoque', acao: 'gerou_etiqueta',
      entidadeTipo: 'etiqueta_validade', entidadeId: criadas[0]?.id,
      detalhe: { descricao, qtd, validade },
    });
    return { criadas: criadas.length, etiquetas: criadas };
  }

  private gerarCodigo(): string {
    // 12 dígitos: base no tempo + aleatório (identificação/baixa; serve p/ Code128/EAN).
    const base = String(Date.now()).slice(-9);
    const rnd = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
    return base + rnd;
  }

  // ===== Impressão térmica (via='etiqueta') =====
  private async enfileirarImpressao(
    tenantId: string,
    unidadeId: string | null,
    impressoraId: string | undefined,
    template: any,
    dados: DadosEtiqueta,
  ) {
    let equipamentoId = impressoraId ?? null;
    if (!equipamentoId) {
      // (1) impressora designada como ETIQUETA (faz_etiqueta) da unidade/rede — mig 179.
      const conds = [
        eq(equipamento.tenantId, tenantId),
        eq(equipamento.tipo, 'impressora'),
        eq(equipamento.fazEtiqueta, true),
        eq(equipamento.ativo, true),
      ];
      if (unidadeId)
        conds.push(or(eq(equipamento.unidadeId, unidadeId), isNull(equipamento.unidadeId))!);
      const [etiq] = await this.db.select({ id: equipamento.id }).from(equipamento).where(and(...conds)).limit(1);
      equipamentoId = etiq?.id ?? null;
      // (2) fallback: nenhuma impressora de etiqueta designada → 1ª ativa DA LOJA (ou sem loja)
      // (não perde a impressão; o ideal é marcar uma impressora como "Etiqueta"). Antes era a 1ª
      // da EMPRESA — numa rede com duas lojas a etiqueta ia para a impressora da outra loja.
      if (!equipamentoId) {
        const [imp] = await this.db
          .select({ id: equipamento.id })
          .from(equipamento)
          .where(
            and(
              eq(equipamento.tenantId, tenantId),
              eq(equipamento.tipo, 'impressora'),
              eq(equipamento.ativo, true),
              unidadeId ? or(eq(equipamento.unidadeId, unidadeId), isNull(equipamento.unidadeId)) : undefined,
            ),
          )
          .limit(1);
        equipamentoId = imp?.id ?? null;
      }
    }
    if (!equipamentoId) return; // sem impressora cadastrada: etiqueta fica só no sistema
    // Texto da etiqueta (cabeçalho + linhas + código) — ver `etiqueta-conteudo.ts`.
    const conteudo = montarConteudoEtiqueta(template, dados);
    // Loja com servidor local ativo: vai por comando para ele (a fila da nuvem não é lida lá).
    await gravarOuEncaminharImpressao(this.db, {
      tenantId, unidadeId: unidadeId ?? null, equipamentoId, via: 'etiqueta', conteudo,
    });
  }

  // O que a etiqueta mostra além do básico: a hora, quem gerou e, quando ela nasce de um
  // lote, o lote e o fornecedor. Falha aqui NUNCA impede a etiqueta de sair: o motivo vai
  // para o log e ela é impressa sem o dado.
  private async extrasDaEtiqueta(
    tenantId: string,
    o: { atorId: string | null; loteId: string | null; fabricacao?: string | null; criadaEm: Date },
  ): Promise<Pick<DadosEtiqueta, 'hora' | 'responsavel' | 'lote' | 'fornecedor'>> {
    const extras: Pick<DadosEtiqueta, 'hora' | 'responsavel' | 'lote' | 'fornecedor'> = {};
    // A hora só vale quando a etiqueta nasce NO DIA da manipulação: numa reimpressão de
    // outro dia (ou com a fabricação informada à mão) ela seria a hora de outra coisa.
    if (o.fabricacao && dataNoFuso(o.criadaEm) === String(o.fabricacao).slice(0, 10))
      extras.hora = horaNoFuso(o.criadaEm);
    try {
      if (o.atorId) {
        const [c] = await this.db
          .select({ nome: colaborador.nome })
          .from(colaborador)
          .where(and(eq(colaborador.id, o.atorId), eq(colaborador.tenantId, tenantId)));
        extras.responsavel = nomeCurto(c?.nome) || null;
      }
      if (o.loteId) {
        const [l] = await this.db
          .select({ codigo: lote.codigo, fornecedor: fornecedor.nome })
          .from(lote)
          .leftJoin(fornecedor, and(eq(fornecedor.id, lote.fornecedorId), eq(fornecedor.tenantId, tenantId)))
          .where(and(eq(lote.id, o.loteId), eq(lote.tenantId, tenantId)));
        if (l?.codigo) {
          extras.lote = l.codigo;
          extras.fornecedor = l.fornecedor ?? null;
        }
      }
    } catch (e) {
      this.log.warn(`etiqueta: sem os dados complementares (${(e as Error).message}) — sai sem eles`);
    }
    return extras;
  }

  // ===== Lista + lifecycle =====
  // `soVivas` = só as que ainda estão na prateleira (fechada ou em uso), da que vence primeiro
  // para a que vence por último — é o que a aba Etiquetas mostra e conta. Sem o filtro vêm as
  // 300 mais recentes de QUALQUER situação: numa cozinha que etiqueta muito, a vencida ainda
  // não baixada (a mais antiga, justamente a que pede a perda) ficava fora da lista.
  async listar(tenantId: string, atual: string | null = null, soVivas = false) {
    const rows = await this.db
      .select()
      .from(etiquetaValidade)
      .where(
        and(
          eq(etiquetaValidade.tenantId, tenantId),
          condUnidade(etiquetaValidade.unidadeId, atual),
          isNull(etiquetaValidade.deletedAt),
          soVivas ? inArray(etiquetaValidade.status, EtiquetaValidadeService.VIVA) : undefined,
        ),
      )
      .orderBy(...(soVivas ? [asc(etiquetaValidade.validade), asc(etiquetaValidade.createdAt)] : [desc(etiquetaValidade.createdAt)]))
      .limit(soVivas ? 1000 : 300);
    const hoje = hojeISO();
    return rows.map((r) => {
      const diasRestantes = Math.round((new Date(r.validade + 'T00:00:00').getTime() - new Date(hoje + 'T00:00:00').getTime()) / 86400000);
      return { ...r, diasRestantes, vencida: diasRestantes < 0 };
    });
  }

  private async carregar(tenantId: string, id: string) {
    const [e] = await this.db
      .select()
      .from(etiquetaValidade)
      .where(and(eq(etiquetaValidade.id, id), eq(etiquetaValidade.tenantId, tenantId), isNull(etiquetaValidade.deletedAt)));
    if (!e) throw new NotFoundException('Etiqueta não encontrada.');
    return e;
  }

  // Núcleo de ABRIR (fechado → em uso). Recalcula a validade após aberto pela fonte
  // (produto/ficha/INSUMO). SÓ reimprime uma nova via se a validade ENCURTAR — se não
  // muda, a etiqueta física continua válida e não precisa gerar outra (E2).
  private async abrirEtiquetaRow(e: any, atorId: string | null) {
    let diasAberto: number | null = null;
    if (e.produtoId) {
      const [p] = await this.db.select({ ab: produto.validadeAbertoDias }).from(produto).where(eq(produto.id, e.produtoId));
      diasAberto = p?.ab ?? null;
    } else if (e.fichaId) {
      const [f] = await this.db.select({ ab: fichaTecnica.validadeAbertoDias }).from(fichaTecnica).where(eq(fichaTecnica.id, e.fichaId));
      diasAberto = f?.ab ?? null;
    } else if (e.itemId) {
      const [it] = await this.db.select({ ab: itemEstoque.validadeAbertoDias }).from(itemEstoque).where(eq(itemEstoque.id, e.itemId));
      diasAberto = it?.ab ?? null;
    }
    const cand = diasAberto != null ? addDias(hojeISO(), diasAberto) : null;
    // Encurtou a validade ao abrir → ANULA a antiga (status 'substituida') e CRIA uma
    // NOVA etiqueta (novo QR) que a sobrepõe. Assim o QR antigo passa a ser inválido.
    if (cand && cand < String(e.validade).slice(0, 10)) {
      const codigo = this.gerarCodigo();
      const [nova] = await this.db
        .insert(etiquetaValidade)
        .values({
          tenantId: e.tenantId,
          unidadeId: e.unidadeId ?? null,
          produtoId: e.produtoId ?? null,
          fichaId: e.fichaId ?? null,
          itemId: e.itemId ?? null,
          templateId: e.templateId ?? null,
          descricao: e.descricao,
          unidadeMedida: e.unidadeMedida,
          tipo: 'usado',
          status: 'em_uso',
          fabricacao: e.fabricacao,
          compra: e.compra ?? null,
          abertura: new Date(),
          validade: cand,
          codigo,
          impressaEm: new Date(),
          criadoPorId: atorId,
        })
        .returning();
      await this.db
        .update(etiquetaValidade)
        .set({ status: 'substituida', substituidaPorId: nova.id, baixadoEm: new Date(), baixadoPorId: atorId, updatedAt: new Date() })
        .where(eq(etiquetaValidade.id, e.id));
      await this.reimprimirEtiqueta(nova).catch(() => {});
      return { acao: 'aberto', reimpresso: true, substituida: true, etiqueta: nova, anteriorId: e.id };
    }
    // Não encurta → só abre a MESMA etiqueta (a via física continua válida).
    const [row] = await this.db
      .update(etiquetaValidade)
      .set({ status: 'em_uso', tipo: 'usado', abertura: new Date(), baixadoPorId: atorId, updatedAt: new Date() })
      .where(eq(etiquetaValidade.id, e.id))
      .returning();
    return { acao: 'aberto', reimpresso: false, substituida: false, etiqueta: row };
  }

  // A etiqueta do código que o LEITOR entregou. O texto lido nem sempre é o gravado
  // (EAN-13 chega com o dígito verificador; ver `codigo-lido.ts`) — antes cada busca
  // comparava o texto inteiro e o modelo EAN-13 nunca era encontrado.
  private async acharPorCodigoLido(tenantId: string, codigo: unknown) {
    const candidatos = candidatosCodigoLido(codigo);
    if (!candidatos.length) return null;
    const achadas = await this.db
      .select()
      .from(etiquetaValidade)
      .where(
        and(
          eq(etiquetaValidade.tenantId, tenantId),
          inArray(etiquetaValidade.codigo, candidatos),
          isNull(etiquetaValidade.deletedAt),
        ),
      );
    return escolherPorCodigoLido(candidatos, achadas);
  }

  // Busca a etiqueta pelo código (read-only) — o ponto de baixa lê, mostra e decide
  // a ação (baixar/abrir) conforme o modo. Não muta nada.
  async buscarPorCodigo(tenantId: string, codigo: string) {
    if (!String(codigo ?? '').trim()) throw new NotFoundException('Código vazio.');
    const e = await this.acharPorCodigoLido(tenantId, codigo);
    if (!e) throw new NotFoundException('Etiqueta não encontrada.');
    const hoje = hojeISO();
    const diasRestantes = Math.round(
      (new Date(e.validade + 'T00:00:00').getTime() - new Date(hoje + 'T00:00:00').getTime()) / 86400000,
    );
    let substituta: any = null;
    if (e.status === 'substituida' && e.substituidaPorId) {
      const [n] = await this.db
        .select({ id: etiquetaValidade.id, codigo: etiquetaValidade.codigo, validade: etiquetaValidade.validade })
        .from(etiquetaValidade)
        .where(eq(etiquetaValidade.id, e.substituidaPorId));
      substituta = n ?? null;
    }
    return { ...e, diasRestantes, vencida: diasRestantes < 0, substituta };
  }

  // Reimprime uma nova via física de uma etiqueta existente (dados atuais dela).
  private async reimprimirEtiqueta(e: any) {
    const template = await this.getTemplate(e.tenantId);
    const [emp] = await this.db.select({ nome: empresa.nome }).from(empresa).where(eq(empresa.id, e.tenantId));
    const cfgs = await this.db
      .select({ unidadeId: cardapioConfig.unidadeId, nomePublico: cardapioConfig.nomePublico })
      .from(cardapioConfig)
      .where(eq(cardapioConfig.tenantId, e.tenantId));
    const cfg = cfgs.find((c) => c.unidadeId === e.unidadeId) ?? cfgs.find((c) => c.unidadeId == null) ?? cfgs[0];
    const nomeLoja = cfg?.nomePublico?.trim() || emp?.nome || 'Regem';
    const extras = await this.extrasDaEtiqueta(e.tenantId, {
      atorId: e.criadoPorId ?? null,
      loteId: e.loteId ?? null,
      fabricacao: e.fabricacao,
      criadaEm: e.createdAt ? new Date(e.createdAt) : new Date(),
    });
    await this.enfileirarImpressao(e.tenantId, e.unidadeId ?? null, undefined, template, {
      loja: nomeLoja,
      descricao: e.descricao,
      unidadeMedida: e.unidadeMedida,
      tipoUso: e.status === 'em_uso' ? 'EM USO' : 'FECHADO',
      fabricacao: e.fabricacao,
      compra: e.compra ?? null,
      validade: e.validade,
      codigo: e.codigo,
      ...extras,
    });
  }

  // Abrir por ID (botão "Abrir" na aba Ativas). Baixa direta = finalizar(id).
  async abrir(tenantId: string, atorId: string | null, id: string) {
    const e = await this.carregar(tenantId, id);
    if (e.status !== 'fechado') return { acao: 'ja_aberto', reimpresso: false, etiqueta: e };
    return this.abrirEtiquetaRow(e, atorId);
  }

  // Leitura do código: fechado → em uso (recalcula/reimprime) → baixado.
  async lerCodigo(tenantId: string, atorId: string | null, codigo: string) {
    const e = await this.acharPorCodigoLido(tenantId, codigo);
    if (!e) throw new NotFoundException('Código não encontrado.');
    if (e.status === 'fechado') return this.abrirEtiquetaRow(e, atorId);
    if (e.status === 'em_uso') {
      // Já aberta → baixa (consumido).
      const [row] = await this.db
        .update(etiquetaValidade)
        .set({ status: 'baixado', baixadoEm: new Date(), baixadoPorId: atorId, updatedAt: new Date() })
        .where(eq(etiquetaValidade.id, e.id))
        .returning();
      return { acao: 'baixado', etiqueta: row };
    }
    // substituida / baixado / vencido → não muta; informa (o QR já não vale).
    return { acao: 'informativo', status: e.status, etiqueta: e };
  }

  // Vencida usada até o fim → finaliza (sem perda).
  //
  // Antes aceitava QUALQUER estado. Finalizar uma etiqueta que já tinha virado perda
  // sobrescrevia `virouPerda: true` com `false` — o desperdício continuava lançado,
  // mas a etiqueta passava a dizer que tinha sido consumida. Agora só a etiqueta viva.
  async finalizar(tenantId: string, atorId: string | null, id: string) {
    return this.comTrava(tenantId, id, async (tx, e) => {
      this.exigirViva(e, 'finalizar');
      const [row] = await tx
        .update(etiquetaValidade)
        .set({ status: 'baixado', baixadoEm: new Date(), baixadoPorId: atorId, virouPerda: false, updatedAt: new Date() })
        .where(eq(etiquetaValidade.id, id))
        .returning();
      return row;
    });
  }

  // Venceu sem usar → vira PERDA.
  //
  // Dois defeitos antigos:
  //  • #47 — sem guarda de estado nem trava: etiqueta já CONSUMIDA virava perda (um
  //    desperdício de algo que foi usado), e dois cliques geravam dois desperdícios.
  //  • #48 — gravava o desperdício direto na tabela, com `quantidade: '1'` fixo e SEM
  //    movimento de estoque. O comentário dizia "p/ CMV", mas o CMV lê o ledger: a
  //    perda não aparecia em lugar nenhum e o insumo jogado fora seguia no estoque.
  //
  // Agora passa pelo MESMO caminho do desperdício manual — custo médio, movimento de
  // saída e consumo FEFO do lote de onde a etiqueta saiu. A quantidade vem de quem
  // registra a perda: a etiqueta não sabe quanto representa (um pote de 500 g ou de
  // 2 kg), e inventar um número seria pior do que não baixar. Sem quantidade, ou sem
  // insumo resolvível (etiqueta de ficha), fica o registro textual — e a resposta diz.
  async perda(
    tenantId: string,
    atorId: string | null,
    id: string,
    atual: string | null = null,
    quantidade?: number,
  ) {
    const res = await this.comTrava(tenantId, id, async (tx, e) => {
      this.exigirViva(e, 'registrar perda');
      const qtd = Number(quantidade);
      const baixa = !!e.itemId && qtd > 0;

      const d: any = await this.desperdicios.create(
        tenantId,
        {
          itemId: baixa ? e.itemId : undefined,
          quantidade: baixa ? qtd : undefined,
          unidadeMedida: e.unidadeMedida ?? undefined,
          descricao: `Etiqueta vencida: ${e.descricao}`,
          motivo: 'Validade',
          colaboradorId: atorId ?? undefined,
          unidadeId: e.unidadeId ?? undefined,
        } as any,
        atual,
        tx,
        atorId,
      );

      const [row] = await tx
        .update(etiquetaValidade)
        .set({ status: 'vencido', virouPerda: true, desperdicioId: d.id, baixadoEm: new Date(), baixadoPorId: atorId, updatedAt: new Date() })
        .where(eq(etiquetaValidade.id, id))
        .returning();
      return { row, baixouEstoque: baixa, descricao: e.descricao, itemId: e.itemId };
    });

    await this.auditoria.registrar({
      tenantId, atorId: atorId ?? undefined, atorPerfil: 'gestao',
      tipo: 'estoque', acao: 'etiqueta_perda', entidadeTipo: 'etiqueta_validade', entidadeId: id,
      detalhe: { descricao: res.descricao, quantidade: quantidade ?? null, baixouEstoque: res.baixouEstoque },
    });
    return { ...res.row, baixouEstoque: res.baixouEstoque };
  }

  // ===== Job diário: alerta de a-vencer/vencidas (mig 136) =====
  async alertasValidade(): Promise<number> {
    const hoje = hojeISO();
    // A vencer nas próximas 24h (status ainda ativo) e vencidas não resolvidas.
    const rows = await this.db
      .select({ tenantId: etiquetaValidade.tenantId, descricao: etiquetaValidade.descricao, validade: etiquetaValidade.validade, status: etiquetaValidade.status })
      .from(etiquetaValidade)
      .where(
        and(
          isNull(etiquetaValidade.deletedAt),
          sql`${etiquetaValidade.status} in ('fechado','em_uso')`,
          lte(etiquetaValidade.validade, addDias(hoje, 1)),
        ),
      );
    const porTenant = new Map<string, { vencendo: number; vencidas: number }>();
    for (const r of rows) {
      const g = porTenant.get(r.tenantId) ?? { vencendo: 0, vencidas: 0 };
      if (r.validade < hoje) g.vencidas++;
      else g.vencendo++;
      porTenant.set(r.tenantId, g);
    }
    for (const [tenantId, g] of porTenant) {
      this.events.emit('kds.alerta.sistema', {
        tenantId,
        titulo: '🏷️ Etiquetas de validade',
        detalhe: `${g.vencendo} a vencer · ${g.vencidas} vencida(s)`,
        prioridade: g.vencidas > 0 ? 'danger' : 'alta',
      });
    }
    return rows.length;
  }
}
