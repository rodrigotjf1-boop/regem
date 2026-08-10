import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  etiquetaTemplate,
  etiquetaValidade,
  produto,
  fichaTecnica,
  itemEstoque,
  empresa,
  impressaoJob,
  equipamento,
  desperdicio,
} from '../../db/schema';
import { condUnidade } from '../../common/filtro-unidade';
import { AuditoriaService } from '../auditoria/auditoria.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
const hojeISO = () => new Date().toISOString().slice(0, 10);
const addDias = (iso: string, d: number) => {
  const dt = new Date(iso + 'T00:00:00');
  dt.setDate(dt.getDate() + d);
  return dt.toISOString().slice(0, 10);
};
// Campos padrão da etiqueta (RDC 216): produto, validade e a data são obrigatórios.
const CAMPOS_PADRAO = [
  { campo: 'loja', visivel: true, negrito: false },
  { campo: 'produto', visivel: true, negrito: true },
  { campo: 'unidade', visivel: true, negrito: false },
  { campo: 'fabricacao', visivel: true, negrito: false },
  { campo: 'compra', visivel: false, negrito: false },
  { campo: 'status', visivel: true, negrito: false },
  { campo: 'validade', visivel: true, negrito: true },
  { campo: 'responsavel', visivel: false, negrito: false },
];

@Injectable()
export class EtiquetaValidadeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly events: EventEmitter2,
  ) {}

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
      padrao: true,
    };
  }

  async salvarTemplate(tenantId: string, dto: any) {
    const campos = Array.isArray(dto?.campos) && dto.campos.length ? dto.campos : CAMPOS_PADRAO;
    const tamanho = ['40x40', '60x40', '40x25'].includes(dto?.tamanho) ? dto.tamanho : '40x40';
    const codigoTipo = ['nenhum', 'ean13', 'code128', 'qr'].includes(dto?.codigoTipo) ? dto.codigoTipo : 'code128';
    const [existente] = await this.db
      .select({ id: etiquetaTemplate.id })
      .from(etiquetaTemplate)
      .where(and(eq(etiquetaTemplate.tenantId, tenantId), eq(etiquetaTemplate.padrao, true)))
      .limit(1);
    if (existente) {
      const [row] = await this.db
        .update(etiquetaTemplate)
        .set({ nome: dto?.nome ?? 'Padrão', campos, tamanho, codigoTipo, updatedAt: new Date() })
        .where(eq(etiquetaTemplate.id, existente.id))
        .returning();
      return row;
    }
    const [row] = await this.db
      .insert(etiquetaTemplate)
      .values({ tenantId, nome: dto?.nome ?? 'Padrão', campos, tamanho, codigoTipo, padrao: true })
      .returning();
    return row;
  }

  // ===== Fontes (produtos com validade + fichas) =====
  async fontes(tenantId: string) {
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
    return {
      produtos: prods.map((p) => ({ tipo: 'produto', ...p })),
      fichas: fichas
        .filter((f) => f.fechado != null || f.aberto != null)
        .map((f) => ({ tipo: 'ficha', ...f })),
      itens: itens.map((i) => ({ tipo: 'item', ...i })),
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
      tipoUso?: 'novo' | 'usado';
      quantidade?: number;
      fabricacao?: string;
      compra?: string;
      impressoraId?: string;
      unidadeId?: string;
    },
    atual: string | null = null,
  ) {
    if (!dto.produtoId && !dto.fichaId && !dto.itemId)
      throw new BadRequestException('Escolha um produto, ficha ou insumo.');
    const usado = dto.tipoUso === 'usado';
    const fabricacao = dto.fabricacao || hojeISO();

    // Nome + validade da fonte. Produto/ficha usam DIAS (fechado/aberto); insumo
    // (item_estoque) tem uma DATA de validade absoluta cadastrada.
    let descricao = 'Produto';
    let unidadeMedida: string | null = null;
    let validade: string;
    if (dto.itemId) {
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
        loja: emp?.nome ?? 'Regem',
        descricao, unidadeMedida, tipoUso: usado ? 'EM USO' : 'FECHADO',
        fabricacao, compra: dto.compra ?? null, validade, codigo,
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
    dados: any,
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
      // (2) fallback: nenhuma impressora de etiqueta designada → 1ª ativa qualquer
      // (não perde a impressão; o ideal é marcar uma impressora como "Etiqueta").
      if (!equipamentoId) {
        const [imp] = await this.db
          .select({ id: equipamento.id })
          .from(equipamento)
          .where(and(eq(equipamento.tenantId, tenantId), eq(equipamento.tipo, 'impressora'), eq(equipamento.ativo, true)))
          .limit(1);
        equipamentoId = imp?.id ?? null;
      }
    }
    if (!equipamentoId) return; // sem impressora cadastrada: etiqueta fica só no sistema
    const conteudo = this.renderEtiqueta(template, dados);
    await this.db.insert(impressaoJob).values({
      tenantId, unidadeId: unidadeId ?? undefined, equipamentoId, via: 'etiqueta', conteudo,
    });
  }

  // Texto da etiqueta + marcadores @BARCODE/@QR que o edge (escpos.mjs) converte.
  private renderEtiqueta(template: any, d: any): string {
    const campos: any[] = Array.isArray(template?.campos) && template.campos.length ? template.campos : CAMPOS_PADRAO;
    const val: Record<string, string> = {
      loja: d.loja,
      produto: d.descricao,
      unidade: d.unidadeMedida ? `Unid.: ${d.unidadeMedida}` : '',
      fabricacao: `Fabricacao: ${this.brDate(d.fabricacao)}`,
      compra: d.compra ? `Compra: ${this.brDate(d.compra)}` : '',
      status: `Status: ${d.tipoUso}`,
      validade: `VALIDADE: ${this.brDate(d.validade)}`,
      responsavel: '',
    };
    const linhas: string[] = ['@ETIQUETA'];
    for (const c of campos) {
      if (c.visivel === false) continue;
      const texto = val[c.campo];
      if (!texto) continue;
      linhas.push(c.negrito ? `@B${texto}` : texto);
    }
    const tipo = template?.codigoTipo ?? 'code128';
    if (tipo === 'qr') linhas.push(`@QR:${d.codigo}`);
    else if (tipo && tipo !== 'nenhum') linhas.push(`@BARCODE:${tipo}:${d.codigo}`);
    else linhas.push(d.codigo);
    return linhas.join('\n');
  }
  private brDate(iso?: string) {
    if (!iso) return '—';
    const [y, m, dd] = iso.slice(0, 10).split('-');
    return `${dd}/${m}/${y}`;
  }

  // ===== Lista + lifecycle =====
  async listar(tenantId: string, atual: string | null = null) {
    const rows = await this.db
      .select()
      .from(etiquetaValidade)
      .where(
        and(
          eq(etiquetaValidade.tenantId, tenantId),
          condUnidade(etiquetaValidade.unidadeId, atual),
          isNull(etiquetaValidade.deletedAt),
        ),
      )
      .orderBy(desc(etiquetaValidade.createdAt))
      .limit(300);
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

  // Leitura do código: fechado → em uso (recalcula validade após aberto) → baixado.
  async lerCodigo(tenantId: string, atorId: string | null, codigo: string) {
    const [e] = await this.db
      .select()
      .from(etiquetaValidade)
      .where(and(eq(etiquetaValidade.tenantId, tenantId), eq(etiquetaValidade.codigo, codigo), isNull(etiquetaValidade.deletedAt)));
    if (!e) throw new NotFoundException('Código não encontrado.');
    if (e.status === 'fechado') {
      // Abriu agora: vira "em uso" e, se houver validade após aberto no produto, recalcula.
      let novaValidade = e.validade;
      if (e.produtoId) {
        const [p] = await this.db.select({ ab: produto.validadeAbertoDias }).from(produto).where(eq(produto.id, e.produtoId));
        if (p?.ab != null) novaValidade = addDias(hojeISO(), p.ab);
      }
      const [row] = await this.db
        .update(etiquetaValidade)
        .set({ status: 'em_uso', tipo: 'usado', abertura: new Date(), validade: novaValidade, baixadoPorId: atorId, updatedAt: new Date() })
        .where(eq(etiquetaValidade.id, e.id))
        .returning();
      return { acao: 'aberto', etiqueta: row };
    }
    // Já em uso → baixa (consumido).
    const [row] = await this.db
      .update(etiquetaValidade)
      .set({ status: 'baixado', baixadoEm: new Date(), baixadoPorId: atorId, updatedAt: new Date() })
      .where(eq(etiquetaValidade.id, e.id))
      .returning();
    return { acao: 'baixado', etiqueta: row };
  }

  // Vencida usada até o fim → finaliza (sem perda).
  async finalizar(tenantId: string, atorId: string | null, id: string) {
    await this.carregar(tenantId, id);
    const [row] = await this.db
      .update(etiquetaValidade)
      .set({ status: 'baixado', baixadoEm: new Date(), baixadoPorId: atorId, virouPerda: false, updatedAt: new Date() })
      .where(eq(etiquetaValidade.id, id))
      .returning();
    return row;
  }

  // Venceu sem usar → vira PERDA (registra desperdício textual p/ CMV).
  async perda(tenantId: string, atorId: string | null, id: string, atual: string | null = null) {
    const e = await this.carregar(tenantId, id);
    const [d] = await this.db
      .insert(desperdicio)
      .values({
        tenantId,
        unidadeId: atual ?? e.unidadeId ?? null,
        colaboradorId: atorId ?? null,
        descricao: `Etiqueta vencida: ${e.descricao}`,
        quantidade: '1',
        unidadeMedida: e.unidadeMedida ?? null,
        motivo: 'validade',
      })
      .returning();
    const [row] = await this.db
      .update(etiquetaValidade)
      .set({ status: 'vencido', virouPerda: true, desperdicioId: d.id, baixadoEm: new Date(), baixadoPorId: atorId, updatedAt: new Date() })
      .where(eq(etiquetaValidade.id, id))
      .returning();
    await this.auditoria.registrar({
      tenantId, atorId: atorId ?? undefined, atorPerfil: 'gestao',
      tipo: 'estoque', acao: 'etiqueta_perda', entidadeTipo: 'etiqueta_validade', entidadeId: id,
      detalhe: { descricao: e.descricao },
    });
    return row;
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
