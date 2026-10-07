import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { categoriaItem, itemEstoque, movimentoEstoque } from '../../db/schema';
import { condUnidadeOuRede } from '../../common/filtro-unidade';
import { exigirLojaParaLancar } from '../../common/loja-lancamento';
import { hojeISO } from '../../common/data';
import { escreverCsv, escreverXlsx } from '../../common/escrever-planilha';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EstoqueService } from './estoque.service';
import { chaveNome, limparNome } from './produto-nome';
import { exigirUnidade } from './unidades';
import { PLANILHA_MAX_LINHAS, lerTabela, montarPrevia, tabelaDeExportacao } from './produtos-planilha';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Ator = { colaboradorId?: string; categoria?: string };

// Importar e exportar o cadastro de produtos do estoque por planilha. A leitura do arquivo e a
// classificação (novo / já existe / parecido) ficam em `produtos-planilha.ts`; aqui, o banco.
@Injectable()
export class ProdutosPlanilhaService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly estoque: EstoqueService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** PRÉVIA: lê o arquivo e classifica. Não grava nada. */
  async previa(tenantId: string, buffer: Buffer, nomeArquivo: string, atual: string | null = null) {
    if (!buffer?.length) throw new BadRequestException('Escolha o arquivo da planilha.');
    // Com o que comparar: os produtos que a pessoa enxerga — os da loja e os compartilhados
    // (em "todas", todos). É o mesmo alcance em que um produto novo esbarraria no nome.
    const existentes = await this.db
      .select({ id: itemEstoque.id, nome: itemEstoque.nome })
      .from(itemEstoque)
      .where(
        and(
          eq(itemEstoque.tenantId, tenantId),
          isNull(itemEstoque.deletedAt),
          condUnidadeOuRede(itemEstoque.unidadeId, atual),
        ),
      );
    const categorias = await this.estoque.listCategorias(tenantId);
    try {
      const { tabela, decimalPonto } = lerTabela(buffer, nomeArquivo);
      return {
        arquivo: nomeArquivo,
        ...montarPrevia(tabela, decimalPonto, existentes, categorias.map((c) => c.nome)),
      };
    } catch (e: any) {
      // Arquivo ilegível ou sem a coluna do nome é erro de quem enviou, com a frase que explica.
      throw new BadRequestException(e?.message ?? 'Não consegui ler a planilha.');
    }
  }

  /**
   * GRAVA os produtos conferidos, de uma vez (um insert). Só entra o que é novo: nome que já
   * existe é pulado e devolvido em `jaExistiam` — repetir o envio não duplica nada. Cria as
   * categorias que faltam e, se vier quantidade, lança o saldo inicial como AJUSTE (não como
   * entrada: entrada conta como compra nos relatórios de custo).
   */
  async importar(tenantId: string, dto: any, atual: string | null = null, ator?: Ator) {
    const brutos: any[] | null = Array.isArray(dto?.itens) ? dto.itens : null;
    if (!brutos?.length) throw new BadRequestException('Nenhum produto para importar.');
    if (brutos.length > PLANILHA_MAX_LINHAS)
      throw new BadRequestException(`O limite por importação é de ${PLANILHA_MAX_LINHAS} produtos. Divida o arquivo.`);

    // Valida TUDO antes de gravar qualquer coisa.
    const itens = brutos.map((b, i) => {
      const nome = limparNome(b?.nome);
      if (!nome) throw new BadRequestException(`Produto ${i + 1}: sem nome.`);
      const numero = (v: unknown, campo: string): number | null => {
        if (v === undefined || v === null || v === '') return null;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw new BadRequestException(`Produto "${nome}": ${campo} inválido.`);
        return n;
      };
      return {
        nome,
        unidadeMedida: exigirUnidade(b?.unidadeMedida, `Produto "${nome}"`),
        categoria: limparNome(b?.categoria),
        estoqueMinimo: numero(b?.estoqueMinimo, 'estoque mínimo'),
        custo: numero(b?.custo, 'custo'),
        quantidade: numero(b?.quantidade, 'quantidade'),
      };
    });

    // Loja em uso (ou nenhuma, em "todas" e na empresa de uma loja) — como no cadastro manual.
    const unidadeId = atual ?? null;
    // Saldo inicial é lançamento de estoque e precisa da loja: recusa ANTES de gravar produto.
    const temSaldo = itens.some((i) => (i.quantidade ?? 0) > 0);
    const lojaDoSaldo = temSaldo ? await exigirLojaParaLancar(this.db, tenantId, atual) : null;

    const resultado = await this.db.transaction(async (tx) => {
      await this.estoque.travarNomes(tx, tenantId);
      const existentes = await tx
        .select({ nome: itemEstoque.nome, unidadeId: itemEstoque.unidadeId })
        .from(itemEstoque)
        .where(and(eq(itemEstoque.tenantId, tenantId), isNull(itemEstoque.deletedAt)));
      const ocupadas = new Set(
        existentes
          .filter((o) => o.unidadeId == null || unidadeId == null || o.unidadeId === unidadeId)
          .map((o) => chaveNome(o.nome)),
      );
      const jaExistiam: string[] = [];
      const novos: typeof itens = [];
      for (const it of itens) {
        const chave = chaveNome(it.nome);
        if (ocupadas.has(chave)) {
          jaExistiam.push(it.nome);
          continue;
        }
        ocupadas.add(chave); // também barra o repetido dentro do próprio envio
        novos.push(it);
      }
      if (!novos.length) return { criados: 0, jaExistiam, categoriasCriadas: [] as string[], comSaldo: 0 };

      const categorias = await tx
        .select({ id: categoriaItem.id, nome: categoriaItem.nome })
        .from(categoriaItem)
        .where(and(eq(categoriaItem.tenantId, tenantId), isNull(categoriaItem.deletedAt)));
      const idDaCategoria = new Map<string, string>(categorias.map((c) => [chaveNome(c.nome), c.id]));
      const faltam = new Map<string, string>();
      for (const it of novos) {
        const chave = it.categoria ? chaveNome(it.categoria) : '';
        // a 1ª grafia que aparece é a que fica ("Insumos" e, adiante, "insumos" = uma categoria)
        if (chave && !idDaCategoria.has(chave) && !faltam.has(chave)) faltam.set(chave, it.categoria);
      }
      let categoriasCriadas: string[] = [];
      if (faltam.size) {
        const criadas = await tx
          .insert(categoriaItem)
          .values([...faltam.values()].map((nome) => ({ tenantId, nome })))
          .returning({ id: categoriaItem.id, nome: categoriaItem.nome });
        for (const c of criadas) idDaCategoria.set(chaveNome(c.nome), c.id);
        categoriasCriadas = criadas.map((c) => c.nome);
      }

      const criados = await tx
        .insert(itemEstoque)
        .values(
          novos.map((it) => ({
            tenantId,
            unidadeId,
            nome: it.nome,
            unidadeMedida: it.unidadeMedida,
            estoqueMinimo: String(it.estoqueMinimo ?? 0),
            custoMedio: String(it.custo ?? 0),
            categoriaItemId: it.categoria ? (idDaCategoria.get(chaveNome(it.categoria)) ?? null) : null,
          })),
        )
        .returning({ id: itemEstoque.id, nome: itemEstoque.nome });

      // Saldo inicial: pelo NOME (a ordem do `returning` não é contrato do banco).
      const idDoNome = new Map(criados.map((c) => [c.nome, c.id]));
      const saldos = novos
        .filter((it) => (it.quantidade ?? 0) > 0 && idDoNome.has(it.nome))
        .map((it) => ({
          tenantId,
          unidadeId: lojaDoSaldo,
          itemId: idDoNome.get(it.nome)!,
          tipo: 'ajuste',
          quantidade: String(it.quantidade),
          custoUnitario: it.custo != null ? String(it.custo) : null,
          motivo: 'Saldo inicial (importação de planilha)',
          refTipo: 'ajuste',
        }));
      if (saldos.length) await tx.insert(movimentoEstoque).values(saldos);
      return { criados: criados.length, jaExistiam, categoriasCriadas, comSaldo: saldos.length };
    });

    if (resultado.criados > 0)
      await this.auditoria.registrar({
        tenantId,
        atorId: ator?.colaboradorId,
        atorPerfil: ator?.categoria,
        tipo: 'estoque',
        acao: 'itens_importados',
        entidadeTipo: 'item_estoque',
        unidadeId,
        detalhe: {
          criados: resultado.criados,
          jaExistiam: resultado.jaExistiam.length,
          categoriasCriadas: resultado.categoriasCriadas.length,
          comSaldoInicial: resultado.comSaldo,
          arquivo: typeof dto?.arquivo === 'string' ? dto.arquivo.slice(0, 120) : undefined,
        },
        origem: 'web',
      });
    return resultado;
  }

  /** EXPORTA o cadastro (o que a pessoa enxerga; ou só os `ids` da lista filtrada na tela). */
  async exportar(
    tenantId: string,
    verFinanceiro: boolean,
    atual: string | null,
    formato: unknown,
    ids?: unknown,
  ) {
    if (formato !== 'xlsx' && formato !== 'csv')
      throw new BadRequestException('Formato de arquivo desconhecido. Use Excel (xlsx) ou CSV.');
    let itens: any[] = await this.estoque.listItens(tenantId, verFinanceiro, atual);
    if (Array.isArray(ids)) {
      const quais = new Set(ids.map(String));
      itens = itens.filter((i) => quais.has(i.id));
    }
    if (!itens.length) throw new BadRequestException('Nenhum produto para exportar.');
    const { linhas, larguras } = tabelaDeExportacao(itens, verFinanceiro);
    const arquivo = formato === 'xlsx' ? escreverXlsx(linhas, { planilha: 'Produtos', larguras }) : escreverCsv(linhas);
    return {
      filename: `produtos-estoque-${hojeISO()}.${formato}`,
      mime:
        formato === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv;charset=utf-8',
      base64: arquivo.toString('base64'),
      produtos: itens.length,
    };
  }
}
