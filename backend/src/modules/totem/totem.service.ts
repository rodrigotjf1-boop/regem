import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, max, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import {
  categoriaProduto,
  complementoGrupo,
  complementoOpcao,
  fiscalConfig,
  produto,
} from '../../db/schema';
import { FiscalDoTotem, fiscalParaTotem } from './fiscal-totem';
import { DeliveryService } from '../delivery/delivery.service';
import { ProdutoService } from '../produto/produto.service';
import { VendasService } from '../vendas/vendas.service';
import { catalogoParaGogem, SnapshotGogem } from './catalogo-gogem';
import { TotemMidiaCache } from './midia-cache.service';
import {
  ehDinheiro,
  pagamentosParaReais,
  paraPedidoDinheiro,
  paraVendaExternaPdv,
  respostaParaTotem,
  VendaTotemGogem,
} from './venda-gogem';

// R3 — serviço do modo edge do totem. Só compõe: o catálogo vem do `ProdutoService`
// (mesma fonte do `/sync/catalogo`) e a tradução mora no `catalogo-gogem.ts`.
@Injectable()
export class TotemService {
  private readonly logger = new Logger('Totem');
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly produtos: ProdutoService,
    private readonly vendas: VendasService,
    private readonly delivery: DeliveryService,
    private readonly midia: TotemMidiaCache,
  ) {}

  /**
   * Venda do totem (R3b). O totem manda UM corpo só; o caminho é escolhido pela forma:
   *  • dinheiro → pedido RETIDO no hub de Retirada ("a pagar no balcão"): não fecha
   *    venda, não baixa estoque e não entra no caixa até o operador cobrar;
   *  • cartão/PIX → venda paga: comanda, caixa, estoque e produção na hora.
   * A idempotência é a do totem (mesma chave = mesma venda), então reenvio da fila
   * offline do aparelho nunca duplica.
   */
  async registrarVenda(
    ctx: { tenantId: string; unidadeId: string | null; equipamentoId: string },
    dto: VendaTotemGogem,
  ) {
    if (ehDinheiro(dto)) {
      const pedido = await this.delivery.criarPedidoTotemDinheiro(
        ctx.tenantId,
        { unidadeId: ctx.unidadeId },
        paraPedidoDinheiro(dto),
      );
      return respostaParaTotem(pedido);
    }
    const venda = await this.vendas.venderTotem(
      ctx.tenantId,
      { unidadeId: ctx.unidadeId, equipamentoId: ctx.equipamentoId },
      paraVendaExternaPdv(dto) as any,
    );
    return respostaParaTotem(venda);
  }

  /**
   * R4 — pedido RETIDO: entra no Regem antes do pagamento, sem ir para a cozinha.
   * É o que dá ao balcão a visão do "aguardando pagamento" e permite cancelar com
   * motivo quando o cliente desiste. A senha já sai aqui: é a que o totem imprime.
   */
  async abrirPedidoRetido(
    ctx: { tenantId: string; unidadeId: string | null; equipamentoId: string },
    dto: VendaTotemGogem & { formaPagamento?: string },
  ) {
    const pedido: any = await this.delivery.criarPedidoTotemRetido(
      ctx.tenantId,
      { unidadeId: ctx.unidadeId },
      { ...paraPedidoDinheiro(dto), formaPagamento: dto.formaPagamento ?? 'cartao' },
    );
    return {
      pedidoId: pedido.id,
      senha: pedido.senha ?? null,
      total: Number(pedido.total) || 0,
    };
  }

  /** R4 — pagamento aprovado: o pedido retido vira venda (comanda, caixa, produção). */
  async liberarPedido(
    ctx: { tenantId: string; unidadeId: string | null; equipamentoId: string },
    pedidoId: string,
    dto: VendaTotemGogem,
  ) {
    const venda = await this.delivery.liberarPagamentoTotem(
      ctx.tenantId,
      ctx,
      pedidoId,
      pagamentosParaReais(dto.pagamentos),
    );
    return respostaParaTotem(venda);
  }

  /** R4 — cliente desistiu, recusou tentar de novo, ou o tempo acabou. */
  async cancelarPedido(
    ctx: { tenantId: string },
    pedidoId: string,
    motivo?: string,
  ) {
    return this.delivery.cancelarPedidoTotem(ctx.tenantId, pedidoId, motivo ?? '');
  }

  /** O DANFE não saiu no papel: a nota é cancelada, a venda desfeita, o pedido cancelado. */
  async falhaImpressao(ctx: { tenantId: string }, pedidoId: string, motivo?: string) {
    return this.delivery.falhaImpressaoTotem(
      ctx.tenantId,
      pedidoId,
      typeof motivo === 'string' ? motivo.slice(0, 300) : null,
    );
  }

  /** Pagamento que NÃO passou — informativo, nunca vira venda nem caixa. */
  async registrarFalha(
    ctx: { tenantId: string; unidadeId: string | null; equipamentoId: string },
    dto: any,
  ) {
    return this.vendas.registrarFalhaTotem(
      ctx.tenantId,
      { unidadeId: ctx.unidadeId, equipamentoId: ctx.equipamentoId },
      dto,
    );
  }

  /**
   * Versão do cardápio: o instante da última alteração no catálogo, em segundos.
   * É monotônica (o totem compara `desde >= versao`) e não exige tabela nova — sai do
   * `updated_at` que as quatro tabelas do catálogo já mantêm. Mudou qualquer uma →
   * versão nova → o totem baixa; nada mudou → `{atualizado:false}` e nenhum tráfego.
   */
  async versaoCatalogo(tenantId: string): Promise<number> {
    const [p, c, g, o] = await Promise.all([
      this.db
        .select({ v: max(produto.updatedAt) })
        .from(produto)
        .where(and(eq(produto.tenantId, tenantId), isNull(produto.deletedAt))),
      this.db
        .select({ v: max(categoriaProduto.updatedAt) })
        .from(categoriaProduto)
        .where(
          and(
            eq(categoriaProduto.tenantId, tenantId),
            isNull(categoriaProduto.deletedAt),
          ),
        ),
      this.db
        .select({ v: max(complementoGrupo.updatedAt) })
        .from(complementoGrupo)
        .where(
          and(
            eq(complementoGrupo.tenantId, tenantId),
            isNull(complementoGrupo.deletedAt),
          ),
        ),
      this.db
        .select({ v: max(complementoOpcao.updatedAt) })
        .from(complementoOpcao)
        .where(
          and(
            eq(complementoOpcao.tenantId, tenantId),
            isNull(complementoOpcao.deletedAt),
          ),
        ),
    ]);
    const instantes = [p[0]?.v, c[0]?.v, g[0]?.v, o[0]?.v]
      .map((d) => (d ? new Date(d as any).getTime() : 0))
      .filter((n) => Number.isFinite(n));
    return Math.floor(Math.max(0, ...instantes) / 1000);
  }

  /**
   * Cardápio no formato do totem. `desde` = versão que o aparelho já tem; igual ou maior
   * que a atual devolve `{atualizado:false}` (checagem barata, sem montar o snapshot).
   */
  async catalogoPublicado(
    tenantId: string,
    unidadeId: string | null,
    desde?: number,
    baseMidia?: string,
  ): Promise<
    | (SnapshotGogem & { fiscal: FiscalDoTotem })
    | { atualizado: false; aparencia: unknown; fiscal: FiscalDoTotem }
  > {
    const versao = await this.versaoCatalogo(tenantId);
    const aparencia = await this.aparencia(tenantId);
    // O fiscal vai nas DUAS respostas, como a aparência: é configuração viva da loja, e
    // ligar a NFC-e não muda a versão do cardápio — sem isto o totem só saberia do limite
    // de identificação na próxima vez que alguém mexesse num produto.
    const fiscal = await this.fiscal(tenantId, unidadeId);
    if (desde != null && Number.isFinite(desde) && desde >= versao) {
      return { atualizado: false, aparencia, fiscal };
    }
    const catalogo = await this.produtos.catalogoParaSync(tenantId, unidadeId);
    const pronto = catalogoParaGogem(catalogo as any, aparencia, versao);
    return { ...(await this.comMidiaLocal(tenantId, pronto, baseMidia)), fiscal };
  }

  /**
   * Fiscal da loja para o totem. Mesma regra de busca do `FiscalService.configRaw` — a
   * configuração da LOJA, ou, sem ela, a da EMPRESA (ERR-084) —, senão o totem e o fiscal
   * discordariam sobre a loja emitir nota. Falha de leitura não derruba o cardápio: devolve
   * "sem fiscal", e quem recusa a emissão continua sendo o fiscal, depois.
   */
  private async fiscal(tenantId: string, unidadeId: string | null): Promise<FiscalDoTotem> {
    try {
      const [cfg] = await this.db
        .select({
          ativo: fiscalConfig.ativo,
          uf: fiscalConfig.uf,
          limiteIdentificacao: fiscalConfig.limiteIdentificacao,
        })
        .from(fiscalConfig)
        .where(
          and(
            eq(fiscalConfig.tenantId, tenantId),
            unidadeId
              ? sql`(unidade_id = ${unidadeId} or unidade_id is null)`
              : sql`unidade_id is null`,
          ),
        )
        .orderBy(sql`(unidade_id is null)`)
        .limit(1);
      return fiscalParaTotem(cfg);
    } catch (e: any) {
      this.logger.warn(`fiscal da loja não lido para o totem: ${e?.message ?? e}`);
      return fiscalParaTotem(null);
    }
  }

  /**
   * Troca as fotos do snapshot pela cópia servida por ESTE servidor, quando ela já
   * existe. O que ainda não foi copiado fica com a URL de origem e é copiado em segundo
   * plano — o totem nunca recebe foto quebrada, e o cardápio migra para a LAN sozinho.
   */
  private async comMidiaLocal(
    tenantId: string,
    snap: SnapshotGogem,
    baseMidia?: string,
  ): Promise<SnapshotGogem> {
    const base = (
      process.env.MIDIA_PUBLIC_URL ||
      baseMidia ||
      ''
    ).replace(/\/$/, '');
    if (!base) return snap; // sem base conhecida, mantém as URLs de origem
    const troca = (u: string | null) => this.midia.resolver(tenantId, u, base);
    for (const c of snap.snapshot.categorias) c.imagemUrl = await troca(c.imagemUrl);
    for (const p of snap.snapshot.produtos) {
      p.imagemUrl = await troca(p.imagemUrl);
      for (const g of p.grupos) {
        for (const o of g.opcoes) o.imagemUrl = await troca(o.imagemUrl);
      }
    }
    return snap;
  }

  /**
   * Aparência (tema) do totem. Ela é da NUVEM do GoGeM (modelo `Aparencia`, por loja) e
   * ainda não desce para o edge — é a etapa G2. Até lá devolvemos `null`: o app trata
   * ausente caindo no tema padrão GoGeM, então o totem funciona, só sem a marca da loja.
   */
  private async aparencia(_tenantId: string): Promise<unknown> {
    return null;
  }
}
