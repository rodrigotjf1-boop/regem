import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { perfilEfetivo } from '../delivery/cupom-perfis';
import {
  mesa,
  comanda,
  comandaItem,
  comandaPagamento,
  comandaItemComplemento,
  complementoGrupo,
  complementoOpcao,
  produto,
  produtoVariacao,
  produtoComboItem,
  fichaTecnica,
  fichaIngrediente,
  itemEstoque,
  movimentoEstoque,
  lancamentoCaixa,
  acertoSubpdv,
  caixaSessao,
  entitlement,
  colaborador,
  equipamento,
  auditLog,
  deliveryConfig,
  produtoFaixaPreco,
} from '../../db/schema';
import { precoComAtacado } from '../../common/preco-atacado';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  ProducaoPedidoService,
  ItemProducao,
} from '../producao-pedido/producao-pedido.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { OrdemProducaoService } from '../ordem-producao/ordem-producao.service';
import { VendaBalcaoDto } from './dto/venda-balcao.dto';
import { VendaExternaPdvDto } from './dto/venda-externa-pdv.dto';
import { VendaExternaFalhaDto } from './dto/venda-externa-falha.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

@Injectable()
export class VendasService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly events: EventEmitter2,
    private readonly producao: ProducaoPedidoService,
    private readonly fiscal: FiscalService,
    private readonly ordemProducao: OrdemProducaoService,
  ) {}

  // ===== Atacado: disponibilidade + encomenda (mig 184/185) =====

  // Saldo atual de UM item de estoque no ledger (entrada − saída), opcionalmente
  // por unidade. Base para decidir quanto dá pra vender no ato.
  private async saldoItem(
    tenantId: string,
    itemId: string,
    unidadeId?: string | null,
  ): Promise<number> {
    const r: any = await this.db.execute(sql`
      select coalesce(sum(case tipo
               when 'entrada' then quantidade
               when 'saida'   then -quantidade
               else quantidade end), 0) as saldo
      from movimento_estoque
      where tenant_id = ${tenantId} and item_id = ${itemId}
        ${unidadeId ? sql`and (unidade_id = ${unidadeId} or unidade_id is null)` : sql``}
    `);
    return Number((r?.rows ?? r)?.[0]?.saldo ?? 0);
  }

  // Quantas unidades do produto dá pra atender AGORA com o estoque disponível.
  // `disponivel: null` = produto sem controle de estoque (ilimitado). Explode a
  // ficha para 1 unidade e divide o saldo de cada insumo pelo consumo por unidade
  // (piso do gargalo). `podeEncomendar` = tem ficha → o excedente pode virar ordem.
  async disponibilidadeProduto(
    tenantId: string,
    produtoId: string,
    unidadeId?: string | null,
  ): Promise<{ disponivel: number | null; podeEncomendar: boolean }> {
    const [p] = await this.db
      .select()
      .from(produto)
      .where(and(eq(produto.id, produtoId), eq(produto.tenantId, tenantId)));
    if (!p) return { disponivel: 0, podeEncomendar: false };
    if (!p.controlaEstoque) return { disponivel: null, podeEncomendar: !!p.fichaId };
    const consumo = new Map<string, number>();
    await this.acumularProduto(this.db, tenantId, p, 1, 1, [], consumo);
    if (consumo.size === 0) return { disponivel: null, podeEncomendar: !!p.fichaId };
    let disp = Infinity;
    for (const [itemId, porUn] of consumo) {
      if (!(porUn > 0)) continue;
      const saldo = await this.saldoItem(tenantId, itemId, unidadeId);
      disp = Math.min(disp, Math.floor(saldo / porUn));
    }
    const disponivel = Number.isFinite(disp) ? Math.max(disp, 0) : null;
    return { disponivel, podeEncomendar: !!p.fichaId };
  }

  // Preview do split de atacado: por item, quanto sai no ato e quanto vira
  // encomenda, dado o estoque disponível. Somente leitura (não vende nem baixa).
  async preverEncomendaAtacado(
    tenantId: string,
    itens: { produtoId: string; quantidade: number }[],
    unidadeId?: string | null,
  ) {
    const out: any[] = [];
    for (const it of itens ?? []) {
      const qtd = Number(it.quantidade) || 0;
      const [p] = await this.db
        .select({ id: produto.id, nome: produto.nome, atacadoAtivo: produto.atacadoAtivo })
        .from(produto)
        .where(and(eq(produto.id, it.produtoId), eq(produto.tenantId, tenantId)));
      if (!p) continue;
      const { disponivel, podeEncomendar } = await this.disponibilidadeProduto(
        tenantId,
        it.produtoId,
        unidadeId,
      );
      // Ilimitado (disponivel null) → tudo imediato, sem encomenda.
      const imediato = disponivel == null ? qtd : Math.min(qtd, Math.max(disponivel, 0));
      const encomenda = Math.max(qtd - imediato, 0);
      out.push({
        produtoId: p.id,
        nome: p.nome,
        atacadoAtivo: p.atacadoAtivo === true,
        solicitado: qtd,
        disponivel,
        imediato,
        encomenda,
        // Só dá pra encomendar o excedente se o produto tem ficha (é produzível).
        podeEncomendar: encomenda > 0 && podeEncomendar,
      });
    }
    return out;
  }

  // Faixas de atacado (mig 184) de UM produto: só as com desconto > 0, ordenadas
  // por qtd_min. Aceita `tx` (dentro de transação) ou usa this.db. Vazio = sem
  // atacado. Usado no PDV/comanda para descontar o preço unitário pela quantidade.
  private async faixasAtacadoDe(
    db: any,
    tenantId: string,
    produtoId: string,
  ): Promise<{ qtdMin: number; descontoPct: number }[]> {
    const rows = await db
      .select({
        qtdMin: produtoFaixaPreco.qtdMin,
        descontoPct: produtoFaixaPreco.descontoPct,
      })
      .from(produtoFaixaPreco)
      .where(
        and(
          eq(produtoFaixaPreco.tenantId, tenantId),
          eq(produtoFaixaPreco.produtoId, produtoId),
        ),
      )
      .orderBy(produtoFaixaPreco.qtdMin);
    return rows
      .map((r: any) => ({ qtdMin: Number(r.qtdMin) || 0, descontoPct: Number(r.descontoPct) || 0 }))
      .filter((f: any) => f.descontoPct > 0);
  }

  // ACUMULA (não insere) o consumo por item da explosão de UMA ficha no mapa
  // `consumo`. `remover` = ids de ficha_ingrediente que NÃO devem baixar (opcionais
  // "sem X"). Sub-fichas explodem recursivamente; `visitados` barra ciclo.
  private async acumularFicha(
    tx: any,
    tenantId: string,
    fichaId: string,
    multiplicador: number,
    consumo: Map<string, number>,
    remover: Set<string>,
    // incluirDelivery: pedido externo (delivery) baixa também as linhas
    // `somente_delivery` (embalagens); balcão/mesa/kiosk as ignora.
    incluirDelivery = false,
    visitados: Set<string> = new Set(),
  ) {
    if (visitados.has(fichaId)) return;
    const [ficha] = await tx
      .select({ rendimento: fichaTecnica.rendimento })
      .from(fichaTecnica)
      .where(eq(fichaTecnica.id, fichaId));
    const rendimento = Number(ficha?.rendimento) || 1;
    const ings = await tx
      .select()
      .from(fichaIngrediente)
      .where(eq(fichaIngrediente.fichaId, fichaId));
    const proximos = new Set(visitados);
    proximos.add(fichaId);
    for (const ing of ings) {
      if (remover.has(ing.id)) continue; // opcional removido ("sem alface")
      if (ing.somenteDelivery && !incluirDelivery) continue; // custo só de delivery
      const c =
        ((Number(ing.quantidade) * Number(ing.fatorCorrecao)) / rendimento) *
        multiplicador;
      if (c <= 0) continue;
      if (ing.subFichaId) {
        // Sub-receita: remoção só vale no nível do produto → set vazio na recursão.
        await this.acumularFicha(tx, tenantId, ing.subFichaId, c, consumo, new Set(), incluirDelivery, proximos);
        continue;
      }
      if (!ing.itemId) continue;
      consumo.set(ing.itemId, (consumo.get(ing.itemId) ?? 0) + c);
    }
  }

  // Sessão de caixa aberta (para amarrar a venda ao turno) — null se caixa fechado.
  // Caixa aberto do BALCÃO (origem 'pdv'). O caixa do delivery é uma gaveta
  // separada e não deve satisfazer/receber uma venda de balcão.
  private async sessaoAbertaId(
    tx: any,
    tenantId: string,
    terminalId?: string | null,
    ator?: { id: string; categoria: string } | null,
  ): Promise<string | null> {
    const [s] = await tx
      .select({ id: caixaSessao.id, abertaPorId: caixaSessao.abertaPorId })
      .from(caixaSessao)
      .where(
        and(
          eq(caixaSessao.tenantId, tenantId),
          eq(caixaSessao.status, 'aberta'),
          eq(caixaSessao.origem, 'pdv'),
          terminalId
            ? eq(caixaSessao.terminalId, terminalId)
            : isNull(caixaSessao.terminalId),
        ),
      );
    if (!s) return null;
    // S2c (RBAC de modo): na NUVEM, registrar/alterar no turno aberto por OUTRA
    // pessoa é exclusivo do presidente (dono). No SERVIDOR LOCAL (edge) não há
    // restrição — a operação de balcão é compartilhada no terminal. Só vale quando
    // o chamador passa `ator` (fluxos de venda); aberturas/leituras internas não.
    if (
      ator &&
      process.env.EDGE_MODE !== 'true' &&
      ator.categoria !== 'presidente' &&
      s.abertaPorId &&
      s.abertaPorId !== ator.id
    ) {
      throw new ForbiddenException(
        'Na nuvem, só o presidente pode registrar ou alterar no turno aberto por outra pessoa. Faça pelo servidor local da loja.',
      );
    }
    return s.id;
  }

  // ACUMULA o consumo por item de um produto vendido (simples/variável/combo)
  // + complementos: opcionais 'remover' suprimem ingredientes; 'adicionar' baixam
  // itens extras. Respeita controla_estoque para a ficha; adicionais sempre baixam.
  private async acumularProduto(
    tx: any,
    tenantId: string,
    p: any,
    fatorFicha: number,
    quantidade: number,
    complementos: any[],
    consumo: Map<string, number>,
    incluirDelivery = false, // pedido externo (delivery) — baixa linhas somente_delivery
  ) {
    const remover = new Set<string>(
      complementos
        .filter((c) => c.tipo === 'remover' && c.fichaIngredienteId)
        .map((c) => c.fichaIngredienteId),
    );
    if (p.controlaEstoque) {
      if (p.tipo === 'combo') {
        const comps = await tx
          .select({
            fichaId: produto.fichaId,
            controla: produto.controlaEstoque,
            q: produtoComboItem.quantidade,
          })
          .from(produtoComboItem)
          .innerJoin(produto, eq(produto.id, produtoComboItem.componenteProdutoId))
          .where(eq(produtoComboItem.comboProdutoId, p.id));
        for (const c of comps) {
          if (c.fichaId && c.controla)
            await this.acumularFicha(
              tx,
              tenantId,
              c.fichaId,
              quantidade * fatorFicha * (Number(c.q) || 1),
              consumo,
              new Set(), // remoção não se aplica a itens de combo
              incluirDelivery,
            );
        }
      } else if (p.fichaId) {
        await this.acumularFicha(
          tx,
          tenantId,
          p.fichaId,
          quantidade * fatorFicha,
          consumo,
          remover,
          incluirDelivery,
        );
      } else if (p.itemId) {
        // Revenda (industrializado): baixa direta do item de estoque vinculado.
        const q = quantidade * fatorFicha;
        if (q > 0) consumo.set(p.itemId, (consumo.get(p.itemId) ?? 0) + q);
      }
    }
    // Adicionais (extra bacon): item de estoque próprio → baixa sempre.
    for (const c of complementos.filter((x) => x.tipo === 'adicionar' && x.itemId)) {
      const q = (Number(c.quantidade) || 1) * quantidade;
      if (q > 0) consumo.set(c.itemId, (consumo.get(c.itemId) ?? 0) + q);
    }
    // Combo por etapa (L5): opção 'escolha' vinculada a um produto real (ex.: a
    // bebida escolhida) → explode a ficha/estoque do produto referenciado.
    for (const c of complementos.filter((x) => x.produtoRefId)) {
      const [ref] = await tx
        .select({
          id: produto.id,
          tipo: produto.tipo,
          fichaId: produto.fichaId,
          itemId: produto.itemId,
          controlaEstoque: produto.controlaEstoque,
        })
        .from(produto)
        .where(and(eq(produto.tenantId, tenantId), eq(produto.id, c.produtoRefId)));
      if (!ref) continue;
      const q = (Number(c.quantidade) || 1) * quantidade;
      await this.acumularProduto(tx, tenantId, ref, 1, q, [], consumo, incluirDelivery);
    }
  }

  // Insere um movimento de saída por item agregado (ref = venda/comanda → reversível).
  private async lancarSaidas(
    tx: any,
    tenantId: string,
    consumo: Map<string, number>,
    comandaId: string,
  ) {
    for (const [itemId, qtd] of consumo) {
      if (qtd <= 0) continue;
      const [item] = await tx
        .select({ custoMedio: itemEstoque.custoMedio })
        .from(itemEstoque)
        .where(eq(itemEstoque.id, itemId));
      await tx
        .insert(movimentoEstoque)
        .values({
          tenantId,
          itemId,
          tipo: 'saida',
          quantidade: String(qtd),
          custoUnitario: item?.custoMedio != null ? String(item.custoMedio) : undefined,
          motivo: 'venda',
          refTipo: 'venda',
          refId: comandaId,
          data: hojeISO(),
        })
        // Idempotência real: índice único parcial idx_movimento_ref
        // (tenant, ref_tipo, ref_id, item_id). Uma 2ª baixa do mesmo pedido
        // (ex.: delivery concluído duas vezes) é ignorada em vez de estourar.
        .onConflictDoNothing();
    }
    // Avisa o cardápio para recomputar esgotados (auto-pausa por estoque). O
    // listener recomputa do ledger; se rodar antes do commit, o próximo movimento
    // ou o render do menu (que também computa) corrige — sem estado inconsistente.
    if (consumo.size) this.events.emit('estoque.baixado', { tenantId });
  }

  // Resolve os complementos escolhidos (por opcaoId) validando que pertencem ao
  // produto; devolve snapshots + delta de preço. (Segurança: preço vem do banco.)
  private async resolverComplementos(
    tx: any,
    tenantId: string,
    produtoId: string,
    opcaoIds: string[],
  ): Promise<{ snapshots: any[]; precoDelta: number }> {
    if (!opcaoIds?.length) return { snapshots: [], precoDelta: 0 };
    const opcoes = await tx
      .select({
        id: complementoOpcao.id,
        nome: complementoOpcao.nome,
        precoDelta: complementoOpcao.precoDelta,
        fichaIngredienteId: complementoOpcao.fichaIngredienteId,
        itemId: complementoOpcao.itemId,
        produtoRefId: complementoOpcao.produtoRefId,
        quantidade: complementoOpcao.quantidade,
        codigoPdv: complementoOpcao.codigoPdv,
        controlaEstoque: complementoOpcao.controlaEstoque,
        tipo: complementoGrupo.tipo,
        gProduto: complementoGrupo.produtoId,
      })
      .from(complementoOpcao)
      .innerJoin(
        complementoGrupo,
        eq(complementoGrupo.id, complementoOpcao.grupoId),
      )
      .where(
        and(
          eq(complementoOpcao.tenantId, tenantId),
          inArray(complementoOpcao.id, opcaoIds),
        ),
      );
    const snapshots: any[] = [];
    let precoDelta = 0;
    for (const o of opcoes) {
      if (o.gProduto !== produtoId) continue; // não é deste produto → ignora
      // mig 126 — SEM código PDV a opção é INFORMATIVA (observação de preparo:
      // "ponto de carne", "talheres"): não soma preço nem baixa estoque; entra só
      // como snapshot/nota na comanda e no ticket de produção.
      const informativa = !(o.codigoPdv ?? '').trim();
      if (!informativa) precoDelta += Number(o.precoDelta) || 0;
      snapshots.push({
        opcaoId: o.id,
        tipo: o.tipo,
        nome: o.nome,
        precoDelta: informativa ? '0' : o.precoDelta,
        informativa,
        // Links de baixa só valem para opção real COM controle de estoque.
        fichaIngredienteId: o.fichaIngredienteId, // 'remover' vale mesmo informativa
        itemId: informativa || !o.controlaEstoque ? null : o.itemId,
        produtoRefId: informativa ? null : o.produtoRefId,
        quantidade: o.quantidade,
      });
    }
    return { snapshots, precoDelta };
  }

  // Venda balcão rápida: paga na hora → comanda fechada + baixa + caixa + pedido KDS.
  async vendaBalcao(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: VendaBalcaoDto,
    terminalId?: string | null,
  ) {
    if (!dto.itens?.length)
      throw new BadRequestException('Adicione ao menos um item.');

    // Terminal de PDV (F2): a venda pertence ao terminal — a unidade da comanda
    // e o caixa a receber derivam dele (fecha o multi-unidade e o multi-balcão).
    if (terminalId) {
      const [t] = await this.db
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
      if (!t) throw new BadRequestException('Terminal de PDV inválido ou inativo.');
      if (t.unidadeId) dto.unidadeId = t.unidadeId;
    }

    // Idempotência (offline-first): mesma chave → não reprocessa (não duplica baixa/caixa).
    if (dto.idempotencyKey) {
      const [existente] = await this.db
        .select({ id: comanda.id })
        .from(comanda)
        .where(
          and(
            eq(comanda.tenantId, tenantId),
            eq(comanda.idempotencyKey, dto.idempotencyKey),
          ),
        );
      if (existente) return { comandaId: existente.id, idempotente: true };
    }

    // Encomendas de atacado a criar APÓS o commit (evita ordem órfã se a venda
    // falhar/rolar back). Preenchido no loop de itens quando há split.
    const encomendas: any[] = [];
    let res: any;
    try {
      res = await this.db.transaction(async (tx) => {
      // Fase A: venda exige caixa aberto (deste terminal).
      const sessaoId = await this.sessaoAbertaId(tx, tenantId, terminalId, {
        id: atorId,
        categoria: atorPerfil,
      });
      if (!sessaoId)
        throw new BadRequestException('Abra o caixa para registrar vendas.');

      const taxa = Number(dto.taxaServicoPct) || 0;
      // Senha central (F4): só no balcão (mesa usa o número da mesa).
      const senha = dto.mesa
        ? null
        : await this.producao.proximaSenha(tx, tenantId, dto.unidadeId ?? null);
      const [cmd] = await tx
        .insert(comanda)
        .values({
          tenantId,
          unidadeId: dto.unidadeId,
          mesa: dto.mesa,
          senha,
          status: 'fechada',
          idempotencyKey: dto.idempotencyKey,
          taxaServicoPct: String(taxa),
          forma: (dto as any).pagamentos?.length
            ? (dto as any).pagamentos.length > 1 ? 'multiplo' : (dto as any).pagamentos[0].forma
            : dto.forma,
          fechadaEm: new Date(),
          abertaPorId: atorId,
          // Equipamento de origem do cupom (PDV/caixa que fez a venda) — pro card
          // de Cupons mostrar "de onde saiu" (totem já grava; balcão faltava).
          origemEquipamentoId: terminalId ?? null,
        })
        .returning();

      let total = 0;
      const itensProducao: ItemProducao[] = [];
      const viaClienteItens: any[] = []; // p/ cupom do cliente
      const consumo = new Map<string, number>(); // baixa agregada por item

      for (const it of dto.itens) {
        const [p] = await tx
          .select()
          .from(produto)
          .where(and(eq(produto.id, it.produtoId), eq(produto.tenantId, tenantId)));
        if (!p) throw new BadRequestException('Produto inválido');
        const qtd = Number(it.quantidade) || 1;

        // Atacado + encomenda (mig 185): com data de entrega e item de atacado
        // produzível (tem ficha), o que passa do estoque disponível AGORA vira
        // ordem de produção agendada; vende só o disponível no ato.
        let qtdVenda = qtd;
        if (dto.encomendaDataEntrega && p.atacadoAtivo && p.fichaId) {
          const { disponivel } = await this.disponibilidadeProduto(
            tenantId,
            p.id,
            dto.unidadeId ?? null,
          );
          if (disponivel != null && qtd > disponivel) {
            qtdVenda = Math.max(disponivel, 0);
            const encQtd = qtd - qtdVenda;
            if (encQtd > 0)
              encomendas.push({
                produtoId: p.id,
                fichaId: p.fichaId,
                itemSaidaId: p.itemId ?? null,
                unidade: p.unidadeMedida ?? 'un',
                quantidade: encQtd,
                descricao: p.nome,
              });
          }
        }
        // Tudo virou encomenda → nada a vender/baixar agora nesta linha.
        if (qtdVenda <= 0) continue;

        let preco = Number(p.precoVenda);
        let descricao = p.nome;
        let fatorFicha = 1;
        if (it.variacaoId) {
          const [v] = await tx
            .select()
            .from(produtoVariacao)
            .where(eq(produtoVariacao.id, it.variacaoId));
          if (v) {
            preco = Number(v.precoVenda);
            descricao = `${p.nome} · ${v.nome}`;
            fatorFicha = Number(v.fatorFicha) || 1;
          }
        }

        // Complementos escolhidos (opcionais/adicionais) — preço vem do banco.
        const { snapshots, precoDelta } = await this.resolverComplementos(
          tx,
          tenantId,
          p.id,
          (it as any).complementos ?? [],
        );
        preco += precoDelta;
        // Atacado por volume (mig 184): desconto por quantidade sobre o preço
        // unitário da linha (grava já descontado; o subtotal segue a soma).
        if (p.atacadoAtivo) {
          const faixas = await this.faixasAtacadoDe(tx, tenantId, p.id);
          // Desconto pela quantidade TOTAL pedida (qtd), não só a vendida no ato.
          preco = precoComAtacado(preco, faixas, qtd);
        }
        total += preco * qtdVenda;

        const obs = (it as any).observacao || null;
        const [ci] = await tx
          .insert(comandaItem)
          .values({
            tenantId,
            comandaId: cmd.id,
            produtoId: p.id,
            variacaoId: it.variacaoId,
            fichaId: p.fichaId,
            descricao,
            quantidade: String(qtdVenda),
            precoUnitario: String(preco),
            observacao: obs,
            criadoPorId: atorId,
          })
          .returning();

        for (const s of snapshots) {
          await tx.insert(comandaItemComplemento).values({
            tenantId,
            comandaItemId: ci.id,
            opcaoId: s.opcaoId,
            tipo: s.tipo,
            nome: s.nome,
            precoDelta: String(s.precoDelta),
            fichaIngredienteId: s.fichaIngredienteId,
            itemId: s.itemId,
            produtoRefId: s.produtoRefId,
            quantidade: String(s.quantidade),
          });
        }

        await this.acumularProduto(tx, tenantId, p, fatorFicha, qtdVenda, snapshots, consumo);

        const compTexto =
          snapshots
            .map((s: any) => `${s.tipo === 'remover' ? 'sem' : '+'} ${s.nome}`)
            .join(' · ') || null;
        viaClienteItens.push({
          quantidade: qtdVenda,
          descricao,
          precoUnitario: preco,
          complementosTexto: compTexto,
        });
        if (p.vaiParaProducao)
          itensProducao.push({
            produto: p,
            descricao,
            quantidade: qtdVenda,
            complementosTexto: compTexto,
            observacao: obs,
            comandaItemId: ci.id,
            opcaoIds: snapshots.map((s: any) => s.opcaoId), // roteamento por opção/etapa (Fase 1)
          });
      }

      await this.lancarSaidas(tx, tenantId, consumo, cmd.id);

      // Pedidos de produção duráveis (um por destino) — roteados por produto.
      const producaoPayloads = await this.producao.criarPedidos(
        tx,
        {
          tenantId,
          unidadeId: dto.unidadeId ?? null,
          comandaId: cmd.id,
          senha,
          origem: dto.mesa ? 'mesa' : 'balcao',
          mesa: dto.mesa ?? null,
        },
        itensProducao,
      );

      const totalComTaxa = total * (1 + taxa / 100);
      await tx
        .update(comanda)
        .set({ total: String(totalComTaxa.toFixed(2)) })
        .where(eq(comanda.id, cmd.id));

      const pagamentos = (dto as any).pagamentos as
        | { forma: string; valor: number; formaPagamentoId?: string }[]
        | undefined;
      const descBase = dto.mesa ? `Venda balcão · mesa ${dto.mesa}` : 'Venda balcão';
      if (pagamentos?.length) {
        // Dividir conta / multi-pagamento: soma tem de bater com o total.
        const somaPag = pagamentos.reduce((s, p) => s + (Number(p.valor) || 0), 0);
        if (Math.abs(somaPag - totalComTaxa) > 0.05)
          throw new BadRequestException(
            `A soma dos pagamentos (${somaPag.toFixed(2)}) não bate com o total (${totalComTaxa.toFixed(2)}).`,
          );
        for (const p of pagamentos) {
          await tx.insert(comandaPagamento).values({
            tenantId,
            comandaId: cmd.id,
            forma: p.forma,
            formaPagamentoId: p.formaPagamentoId ?? null,
            valor: String(Number(p.valor).toFixed(2)),
          });
          // Um lançamento de caixa por forma → fechamento "por forma" correto.
          await tx.insert(lancamentoCaixa).values({
            tenantId,
            unidadeId: dto.unidadeId,
            sessaoId,
            comandaId: cmd.id,
            tipo: 'entrada',
            valor: String(Number(p.valor).toFixed(2)),
            data: hojeISO(),
            categoria: 'venda',
            forma: p.forma,
            descricao: descBase,
            criadoPorId: atorId,
          });
        }
      } else {
        await tx.insert(lancamentoCaixa).values({
          tenantId,
          unidadeId: dto.unidadeId,
          sessaoId,
          comandaId: cmd.id,
          tipo: 'entrada',
          valor: String(totalComTaxa.toFixed(2)),
          data: hojeISO(),
          categoria: 'venda',
          forma: dto.forma,
          descricao: descBase,
          criadoPorId: atorId,
        });
      }

      return {
        comandaId: cmd.id,
        senha,
        subtotal: Number(total.toFixed(2)),
        taxaServicoPct: taxa,
        total: Number(totalComTaxa.toFixed(2)),
        producaoPayloads,
        viaClienteItens,
        unidadeId: dto.unidadeId ?? null,
      };
      });
    } catch (e: any) {
      // Corrida: outra requisição com a mesma chave inseriu primeiro (unique).
      if (e?.code === '23505' && dto.idempotencyKey) {
        const [existente] = await this.db
          .select({ id: comanda.id })
          .from(comanda)
          .where(
            and(
              eq(comanda.tenantId, tenantId),
              eq(comanda.idempotencyKey, dto.idempotencyKey),
            ),
          );
        if (existente) return { comandaId: existente.id, idempotente: true };
      }
      throw e;
    }

    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'venda',
      acao: 'venda_balcao',
      entidadeTipo: 'comanda',
      entidadeId: res.comandaId,
      detalhe: { total: res.total, itens: dto.itens.length },
    });

    // Encomendas de atacado (mig 185): cria as ordens de produção do excedente
    // APÓS o commit da venda, amarradas à comanda, com a data combinada. Falha
    // aqui não desfaz a venda já concluída (best-effort + auditoria da ordem).
    const encomendasCriadas: any[] = [];
    for (const e of encomendas) {
      try {
        const ordem = await this.ordemProducao.criar(tenantId, atorId, {
          fichaId: e.fichaId,
          quantidadePlanejada: e.quantidade,
          unidade: e.unidade,
          unidadeId: res.unidadeId ?? null,
          dataProducao: (dto as any).encomendaDataEntrega,
          dataEntrega: (dto as any).encomendaDataEntrega,
          itemSaidaId: e.itemSaidaId,
          comandaId: res.comandaId,
          origem: 'encomenda_atacado',
          obs: `Encomenda de atacado: ${e.quantidade}× ${e.descricao}`,
          liberar: true,
        });
        encomendasCriadas.push({
          ordemId: ordem?.id,
          produtoId: e.produtoId,
          descricao: e.descricao,
          quantidade: e.quantidade,
          dataEntrega: (dto as any).encomendaDataEntrega,
        });
      } catch {
        // não derruba a venda; o gestor pode recriar a ordem manualmente
      }
    }

    // Notifica destinos (KDS/impressora) dos novos pedidos duráveis (tempo real).
    this.producao.emitirNovos(res.producaoPayloads);

    // Via do cliente (balcão): imprime o cupom na impressora DESTE terminal
    // (fallback: cupom da unidade). Corrige o disparo em todas as 'cupom'.
    await this.imprimirViaCliente(
      tenantId,
      res.comandaId,
      res.unidadeId,
      atorId,
      {
        senha: res.senha,
        mesa: dto.mesa ?? null,
        itens: res.viaClienteItens,
        total: res.total,
        forma: dto.forma ?? null,
      },
      terminalId,
    );

    // NFC-e automática (se o fiscal estiver ativo na unidade). Não bloqueia a venda.
    const nota = await this.fiscal.emitirSeAtivo(
      tenantId,
      atorId,
      res.comandaId,
      res.unidadeId,
    );
    return {
      ...res,
      nfce: nota ? { status: nota.status, chave: nota.chave, numero: nota.numero } : null,
      encomendas: encomendasCriadas,
    };
  }

  // Renderiza + enfileira a via do cliente (cupom). Silencioso se não há impressora 'cupom'.
  private async imprimirViaCliente(
    tenantId: string,
    comandaId: string,
    unidadeId: string | null,
    atorId: string | null,
    dados: { senha?: number | null; mesa?: string | null; itens: any[]; total: number; forma?: string | null },
    terminalId?: string | null,
    alvoPreferido?: string | null,
    qrData?: string | null,
  ) {
    // atorId pode ser nulo (materialização no edge de uma venda que desceu) — sem
    // ator o cupom sai sem "atendente"; evita consultar colaborador com id inválido.
    const [ator] = atorId
      ? await this.db
          .select({ nome: colaborador.nome })
          .from(colaborador)
          .where(eq(colaborador.id, atorId))
      : [undefined as { nome: string } | undefined];
    // Layout + perfis do cupom da loja (unidade → rede). Vazio = padrão.
    const dcs = await this.db
      .select({ unidadeId: deliveryConfig.unidadeId, cupomLayout: deliveryConfig.cupomLayout, cupomPerfis: deliveryConfig.cupomPerfis })
      .from(deliveryConfig)
      .where(
        and(
          eq(deliveryConfig.tenantId, tenantId),
          unidadeId
            ? or(eq(deliveryConfig.unidadeId, unidadeId), isNull(deliveryConfig.unidadeId))
            : isNull(deliveryConfig.unidadeId),
        ),
      );
    const linhaCfg = dcs.find((d) => d.unidadeId === unidadeId) ?? dcs.find((d) => d.unidadeId == null);
    const layout = (linhaCfg?.cupomLayout as any) ?? {};
    // Fase 3 — perfil "caixa" efetivo (padrão + override) para o render por perfil.
    const perfilCaixa = perfilEfetivo('caixa', ((linhaCfg?.cupomPerfis as any) ?? {})?.caixa);
    let conteudo = this.producao.renderViaCliente(
      { ...dados, atendente: ator?.nome ?? null },
      layout,
      perfilCaixa,
    );
    // Pedido externo (delivery) com QR de despacho na comanda: o entregador escaneia
    // direto da via do caixa (aposenta o cupom do entregador separado). Centralizado.
    if (qrData) conteudo += `\n@C\n@QR:${qrData}\n`;
    return this.producao.enfileirarViaCliente(
      tenantId,
      unidadeId,
      comandaId,
      conteudo,
      terminalId,
      alvoPreferido,
      'cliente',
      perfilCaixa.impressoras, // S5 — impressoras direcionadas ao perfil "caixa"
    );
  }

  // ===== S3 — Materialização de impressão no EDGE =====
  // Uma venda registrada no MODO NUVEM (presidente) desce pelo sync (S1), mas a
  // impressora do caixa é LOCAL — a nuvem não a alcança. No edge, reconstruímos a
  // via do cliente (cupom) a partir da comanda que desceu e enfileiramos na
  // impressora de cupom LOCAL. Chamado pelo processador do edge (idempotência lá).
  // Best-effort: quem chama trata a falha (não derruba o ciclo).
  async materializarImpressaoLocal(
    tenantId: string,
    comandaId: string,
  ): Promise<{ enfileirados: number; aviso: string | null }> {
    const [c] = await this.db
      .select()
      .from(comanda)
      .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
    if (!c || c.status !== 'fechada') return { enfileirados: 0, aviso: 'comanda não fechada' };

    const itens = await this.db
      .select()
      .from(comandaItem)
      .where(eq(comandaItem.comandaId, comandaId));

    const viaClienteItens: any[] = [];
    for (const it of itens) {
      const comps = await this.db
        .select({ tipo: comandaItemComplemento.tipo, nome: comandaItemComplemento.nome })
        .from(comandaItemComplemento)
        .where(eq(comandaItemComplemento.comandaItemId, it.id));
      const compTexto =
        comps.map((s) => `${s.tipo === 'remover' ? 'sem' : '+'} ${s.nome}`).join(' · ') || null;
      viaClienteItens.push({
        quantidade: Number(it.quantidade),
        descricao: it.descricao,
        precoUnitario: Number(it.precoUnitario),
        complementosTexto: compTexto,
        observacao: it.observacao,
      });
    }

    // Cupom (via do cliente) — sem terminal → resolve pela impressora de cupom
    // (faz_cupom) da unidade/rede.
    const cupom = await this.imprimirViaCliente(
      tenantId,
      comandaId,
      c.unidadeId ?? null,
      c.abertaPorId ?? null,
      {
        senha: c.senha,
        mesa: c.mesa,
        itens: viaClienteItens,
        total: Number(c.total),
        forma: c.forma ?? null,
      },
      null,
    );

    // Vias de PRODUÇÃO (cozinha/setores) — best-effort, não derruba o cupom.
    let producao = 0;
    try {
      producao = await this.producao.materializarProducaoLocal(tenantId, comandaId);
    } catch {
      /* produção é best-effort; o cupom já saiu */
    }

    return {
      enfileirados: (cupom.enfileirados || 0) + producao,
      aviso: cupom.aviso,
    };
  }

  // P/ pedido EXTERNO no edge: imprime SÓ a via do caixa (cupom) da comanda — a
  // produção já saiu no aceitar (emitirNovos). Com `qrData`, a via leva o QR de
  // despacho (o entregador escaneia direto da comanda). Best-effort; silencioso se
  // não há impressora de cupom. Idempotência é de quem chama (aceitar roda 1x).
  async materializarCupomCaixa(
    tenantId: string,
    comandaId: string,
    qrData?: string | null,
  ): Promise<{ enfileirados: number; aviso: string | null }> {
    const [c] = await this.db
      .select()
      .from(comanda)
      .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
    if (!c || c.status !== 'fechada') return { enfileirados: 0, aviso: 'comanda não fechada' };

    const itens = await this.db
      .select()
      .from(comandaItem)
      .where(eq(comandaItem.comandaId, comandaId));
    const viaClienteItens: any[] = [];
    for (const it of itens) {
      const comps = await this.db
        .select({ tipo: comandaItemComplemento.tipo, nome: comandaItemComplemento.nome })
        .from(comandaItemComplemento)
        .where(eq(comandaItemComplemento.comandaItemId, it.id));
      const compTexto =
        comps.map((s) => `${s.tipo === 'remover' ? 'sem' : '+'} ${s.nome}`).join(' · ') || null;
      viaClienteItens.push({
        quantidade: Number(it.quantidade),
        descricao: it.descricao,
        precoUnitario: Number(it.precoUnitario),
        complementosTexto: compTexto,
        observacao: it.observacao,
      });
    }

    return this.imprimirViaCliente(
      tenantId,
      comandaId,
      c.unidadeId ?? null,
      c.abertaPorId ?? null,
      { senha: c.senha, mesa: c.mesa, itens: viaClienteItens, total: Number(c.total), forma: c.forma ?? null },
      null,
      null,
      qrData,
    );
  }

  // Venda por canal externo (delivery). Sem caixa: baixa estoque, cria produção
  // (F1), lança no financeiro como 'online' e emite NFC-e se ativo. Reaproveita
  // a mesma lógica da venda de balcão.
  async venderExterno(
    tenantId: string,
    atorId: string | null,
    dto: {
      unidadeId?: string | null;
      cliente?: string | null;
      forma?: string | null;
      origem?: string;
      setorId?: string | null; // setor de produção (ex.: delivery)
      plataforma?: string | null; // ex.: "Cardápio", "iFood"
      senhaPlataforma?: string | null; // senha/nº do pedido na plataforma
      itens: {
        produtoId?: string | null;
        descricao: string;
        quantidade: number;
        precoUnitario: number;
        observacao?: string | null;
        complementos?: string[] | null; // opcaoIds escolhidos (roteamento por opção/etapa — Fase 1)
      }[];
    },
  ) {
    if (!dto.itens?.length)
      throw new BadRequestException('Pedido sem itens.');
    const res = await this.db.transaction(async (tx) => {
      // Senha LOCAL do PDV (sequência central) — o KDS exibe esta; a senha da
      // plataforma vai como metadado ao lado.
      const senha = await this.producao.proximaSenha(tx, tenantId, dto.unidadeId ?? null);
      const [cmd] = await tx
        .insert(comanda)
        .values({
          tenantId,
          unidadeId: dto.unidadeId,
          cliente: dto.cliente,
          status: 'fechada',
          senha,
          forma: dto.forma ?? 'online',
          fechadaEm: new Date(),
          abertaPorId: atorId,
        })
        .returning();

      let total = 0;
      const itensProducao: ItemProducao[] = [];
      for (const it of dto.itens) {
        const qtd = Number(it.quantidade) || 1;
        const preco = Number(it.precoUnitario) || 0;
        total += preco * qtd;
        let p: any = null;
        if (it.produtoId) {
          [p] = await tx
            .select()
            .from(produto)
            .where(and(eq(produto.id, it.produtoId), eq(produto.tenantId, tenantId)));
        }
        const [ci] = await tx
          .insert(comandaItem)
          .values({
            tenantId,
            comandaId: cmd.id,
            produtoId: p?.id ?? null,
            fichaId: p?.fichaId ?? null,
            descricao: it.descricao,
            quantidade: String(qtd),
            precoUnitario: String(preco),
            observacao: it.observacao ?? null,
            criadoPorId: atorId,
          })
          .returning();
        if (p) {
          if (p.vaiParaProducao)
            itensProducao.push({
              produto: p,
              descricao: it.descricao,
              quantidade: qtd,
              observacao: it.observacao ?? null,
              complementosTexto: (it as any).complementosTexto ?? null,
              comandaItemId: ci.id,
              opcaoIds: (it as any).complementos ?? [], // roteamento por opção/etapa (Fase 1)
            });
        }
      }
      // Delivery NÃO baixa estoque no aceite: a baixa ocorre só na CONCLUSÃO
      // (entrega). Pedido cancelado antes disso não movimenta estoque.
      const producaoPayloads = await this.producao.criarPedidos(
        tx,
        {
          tenantId,
          unidadeId: dto.unidadeId ?? null,
          comandaId: cmd.id,
          origem: dto.origem ?? 'delivery',
          setorId: dto.setorId ?? null,
          mesa: null,
          senha,
          plataforma: dto.plataforma ?? null,
          senhaPlataforma: dto.senhaPlataforma ?? null,
        },
        itensProducao,
      );
      await tx
        .update(comanda)
        .set({ total: String(total.toFixed(2)) })
        .where(eq(comanda.id, cmd.id));
      // Financeiro: lançamento 'online' sem sessão de caixa (delivery é pré-pago).
      await tx.insert(lancamentoCaixa).values({
        tenantId,
        unidadeId: dto.unidadeId,
        comandaId: cmd.id,
        tipo: 'entrada',
        valor: String(total.toFixed(2)),
        data: hojeISO(),
        categoria: 'venda',
        forma: dto.forma ?? 'online',
        descricao: `Venda ${dto.origem ?? 'delivery'}`,
        criadoPorId: atorId,
      });
      return { comandaId: cmd.id, total: Number(total.toFixed(2)), producaoPayloads };
    });

    this.producao.emitirNovos(res.producaoPayloads);
    await this.fiscal.emitirSeAtivo(tenantId, atorId, res.comandaId, dto.unidadeId ?? null);
    return res;
  }

  // L-VEN-1 — Venda de origem externa PAGA por código PDV (totem/autoatendimento).
  // Autenticada por dispositivo (X-Sync-Token). Diferenças vs. venderExterno:
  //  • itens vêm por `codigoPdv` (de-para) — o preço é resolvido no servidor;
  //  • baixa de estoque IMEDIATA (a venda já foi concluída e paga no totem);
  //  • pagamento pré-pago (TEF/PIX) → lançamento por forma, SEM sessão de caixa;
  //  • idempotência pela chave do totem (reenvio nunca duplica venda/baixa/caixa).
  async venderTotem(
    tenantId: string,
    ctx: { unidadeId: string | null; equipamentoId: string },
    dto: VendaExternaPdvDto,
  ) {
    if (!dto.itens?.length) throw new BadRequestException('Pedido sem itens.');
    if (!dto.pagamentos?.length)
      throw new BadRequestException('Venda de totem é pré-paga: informe o pagamento.');
    if (!dto.idempotencyKey?.trim())
      throw new BadRequestException('idempotencyKey é obrigatória.');

    const unidadeId = dto.unidadeId ?? ctx.unidadeId ?? null;

    // Idempotência (chave do totem): mesma chave → devolve a venda já lançada.
    const [existente] = await this.db
      .select({ id: comanda.id })
      .from(comanda)
      .where(
        and(
          eq(comanda.tenantId, tenantId),
          eq(comanda.idempotencyKey, dto.idempotencyKey),
        ),
      );
    if (existente) return { comandaId: existente.id, idempotente: true };

    // De-para: resolve produtos por codigo_pdv. Preço vem do banco (nunca do cliente).
    const codigos = [
      ...new Set(dto.itens.map((i) => (i.codigoPdv ?? '').trim()).filter(Boolean)),
    ];
    if (!codigos.length) throw new BadRequestException('Itens sem codigoPdv.');
    const prods = await this.db
      .select()
      .from(produto)
      .where(
        and(
          eq(produto.tenantId, tenantId),
          inArray(produto.codigo, codigos),
          isNull(produto.deletedAt),
        ),
      );
    const porCodigo = new Map<string, any>(
      prods.filter((p) => p.codigo).map((p) => [p.codigo as string, p]),
    );
    const faltando = codigos.filter((c) => !porCodigo.has(c));
    if (faltando.length)
      throw new BadRequestException(
        `Código(s) PDV não encontrado(s) neste tenant: ${faltando.join(', ')}`,
      );

    let res: any;
    try {
      res = await this.db.transaction(async (tx) => {
        const taxa = Number(dto.taxaServicoPct) || 0;
        const senha = await this.producao.proximaSenha(tx, tenantId, unidadeId);
        const formaResumo =
          dto.pagamentos.length > 1 ? 'multiplo' : dto.pagamentos[0].forma;
        const [cmd] = await tx
          .insert(comanda)
          .values({
            tenantId,
            unidadeId,
            cliente: dto.cliente ?? null,
            cpf: dto.cpf ?? null,
            consumo: dto.consumo ?? null,
            senha,
            status: 'fechada',
            idempotencyKey: dto.idempotencyKey,
            taxaServicoPct: String(taxa),
            forma: formaResumo,
            origemEquipamentoId: ctx.equipamentoId,
            fechadaEm: new Date(),
          })
          .returning();

        let total = 0;
        const itensProducao: ItemProducao[] = [];
        const consumo = new Map<string, number>(); // baixa agregada por item

        for (const it of dto.itens) {
          const p = porCodigo.get((it.codigoPdv ?? '').trim());
          const qtd = Number(it.quantidade) || 1;
          const preco = Number(p.precoVenda);
          total += preco * qtd;
          const obs = it.observacao ?? null;
          const [ci] = await tx
            .insert(comandaItem)
            .values({
              tenantId,
              comandaId: cmd.id,
              produtoId: p.id,
              fichaId: p.fichaId,
              descricao: p.nome,
              quantidade: String(qtd),
              precoUnitario: String(preco),
              observacao: obs,
            })
            .returning();
          // v1: itens simples (sem complementos). Complementos por codigoPdv das
          // opções são follow-up (L-VEN-1 v2).
          await this.acumularProduto(tx, tenantId, p, 1, qtd, [], consumo);
          if (p.vaiParaProducao)
            itensProducao.push({
              produto: p,
              descricao: p.nome,
              quantidade: qtd,
              observacao: obs,
              comandaItemId: ci.id,
            });
        }

        // Totem: venda concluída e paga → baixa estoque IMEDIATA (difere do delivery).
        await this.lancarSaidas(tx, tenantId, consumo, cmd.id);

        const producaoPayloads = await this.producao.criarPedidos(
          tx,
          {
            tenantId,
            unidadeId,
            comandaId: cmd.id,
            origem: 'totem',
            setorId: null,
            mesa: null,
            senha,
            plataforma: dto.plataforma ?? 'Totem',
            senhaPlataforma: dto.senhaPlataforma ?? null,
          },
          itensProducao,
        );

        const totalComTaxa = total * (1 + taxa / 100);
        await tx
          .update(comanda)
          .set({ total: String(totalComTaxa.toFixed(2)) })
          .where(eq(comanda.id, cmd.id));

        // Pré-pago no totem (TEF/PIX): soma tem de bater; sem sessão de caixa.
        const somaPag = dto.pagamentos.reduce(
          (s, p) => s + (Number(p.valor) || 0),
          0,
        );
        if (Math.abs(somaPag - totalComTaxa) > 0.05)
          throw new BadRequestException(
            `A soma dos pagamentos (${somaPag.toFixed(2)}) não bate com o total (${totalComTaxa.toFixed(2)}).`,
          );
        for (const pg of dto.pagamentos) {
          await tx.insert(comandaPagamento).values({
            tenantId,
            comandaId: cmd.id,
            forma: pg.forma,
            formaPagamentoId: pg.formaPagamentoId ?? null,
            valor: String(Number(pg.valor).toFixed(2)),
          });
          const ref = [
            pg.nsu ? `NSU ${pg.nsu}` : null,
            pg.autorizacao ? `aut ${pg.autorizacao}` : null,
          ]
            .filter(Boolean)
            .join(' · ');
          await tx.insert(lancamentoCaixa).values({
            tenantId,
            unidadeId,
            comandaId: cmd.id,
            tipo: 'entrada',
            valor: String(Number(pg.valor).toFixed(2)),
            data: hojeISO(),
            categoria: 'venda',
            forma: pg.forma,
            descricao: ref ? `Venda totem · ${ref}` : 'Venda totem',
          });
        }

        return {
          comandaId: cmd.id,
          senha,
          subtotal: Number(total.toFixed(2)),
          taxaServicoPct: taxa,
          total: Number(totalComTaxa.toFixed(2)),
          producaoPayloads,
        };
      });
    } catch (e: any) {
      // Corrida: outra requisição com a mesma chave inseriu primeiro (unique).
      if (e?.code === '23505') {
        const [ex] = await this.db
          .select({ id: comanda.id })
          .from(comanda)
          .where(
            and(
              eq(comanda.tenantId, tenantId),
              eq(comanda.idempotencyKey, dto.idempotencyKey),
            ),
          );
        if (ex) return { comandaId: ex.id, idempotente: true };
      }
      throw e;
    }

    this.producao.emitirNovos(res.producaoPayloads);
    const nfce = await this.fiscal.emitirSeAtivo(tenantId, null, res.comandaId, unidadeId);
    await this.auditoria.registrar({
      tenantId,
      atorId: null,
      atorPerfil: 'servico',
      tipo: 'venda',
      acao: 'venda_totem',
      entidadeTipo: 'comanda',
      entidadeId: res.comandaId,
      detalhe: {
        total: res.total,
        itens: dto.itens.length,
        origem: 'totem',
        equipamentoId: ctx.equipamentoId,
      },
    });
    return {
      ...res,
      nfce: nfce
        ? { status: (nfce as any).status, chave: (nfce as any).chave, numero: (nfce as any).numero }
        : null,
    };
  }

  // Estorna uma venda externa (delivery cancelado). Como não passa por caixa,
  // reverte estoque (entrada inversa) e o lançamento 'online', sem exigir sessão.
  // `reaproveitado` (mig 128): true = o insumo baixado foi REUTILIZADO → devolve ao
  // estoque (entrada inversa). false = virou PERDA → a saída permanece (o insumo se
  // perdeu) e a decisão fica registrada na comanda para relatório.
  async estornarVendaExterna(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    comandaId: string,
    motivo?: string,
    reaproveitado = true,
  ) {
    await this.db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(comanda)
        .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
      if (!c) throw new NotFoundException('Comanda não encontrada');
      if (c.status === 'cancelada') return;

      const saidas = await tx
        .select()
        .from(movimentoEstoque)
        .where(
          and(
            eq(movimentoEstoque.tenantId, tenantId),
            eq(movimentoEstoque.refTipo, 'venda'),
            eq(movimentoEstoque.refId, comandaId),
          ),
        );
      // Só devolve ao estoque se o insumo foi REUTILIZADO. Em caso de PERDA a saída
      // original permanece (o insumo realmente se perdeu) — nada a estornar.
      if (reaproveitado) {
        for (const m of saidas) {
          await tx.insert(movimentoEstoque).values({
            tenantId,
            itemId: m.itemId,
            tipo: 'entrada',
            quantidade: m.quantidade,
            custoUnitario: m.custoUnitario ?? undefined,
            motivo: 'estorno',
            refTipo: 'estorno',
            refId: comandaId,
            data: hojeISO(),
          });
        }
      }
      // Registra a decisão (só quando houve baixa de fato) para relatório/auditoria.
      if (saidas.length) {
        await tx
          .update(comanda)
          .set({ estoqueReaproveitado: reaproveitado, updatedAt: new Date() })
          .where(eq(comanda.id, comandaId));
      }
      const [lanc] = await tx
        .select()
        .from(lancamentoCaixa)
        .where(
          and(
            eq(lancamentoCaixa.tenantId, tenantId),
            eq(lancamentoCaixa.comandaId, comandaId),
            eq(lancamentoCaixa.tipo, 'entrada'),
          ),
        );
      if (lanc) {
        await tx.insert(lancamentoCaixa).values({
          tenantId,
          unidadeId: lanc.unidadeId,
          comandaId,
          tipo: 'saida',
          valor: lanc.valor,
          data: hojeISO(),
          categoria: 'estorno',
          estornoDe: lanc.id,
          descricao: 'Estorno · delivery cancelado',
          criadoPorId: atorId,
        });
      }
      await tx
        .update(comanda)
        .set({
          status: 'cancelada',
          canceladaEm: new Date(),
          canceladaPorId: atorId,
          motivoCancelamento: motivo,
        })
        .where(eq(comanda.id, comandaId));
    });
    // Avisa a produção/KDS: os pedidos dessa comanda saem da fila (cancelados).
    await this.producao
      .cancelarPorComanda(tenantId, atorId, comandaId, motivo)
      .catch(() => {});
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'venda',
      acao: 'cancelou_delivery',
      entidadeTipo: 'comanda',
      entidadeId: comandaId,
      detalhe: { motivo },
    });
    return { ok: true };
  }

  // Emite a NFC-e de uma comanda (botão "NF" do delivery). Usa a config fiscal.
  async emitirNf(tenantId: string, atorId: string, comandaId: string) {
    return this.fiscal.emitir(tenantId, atorId, comandaId);
  }

  // Baixa de estoque do delivery na CONCLUSÃO (entrega). Idempotente pelo ref
  // (índice único em lancarSaidas). Recalcula o consumo a partir dos itens.
  async baixarEstoqueExterno(tenantId: string, comandaId: string) {
    await this.db.transaction(async (tx) => {
      const itens = await tx
        .select()
        .from(comandaItem)
        .where(
          and(
            eq(comandaItem.tenantId, tenantId),
            eq(comandaItem.comandaId, comandaId),
          ),
        );
      const consumo = new Map<string, number>();
      for (const it of itens) {
        if (!it.produtoId) continue;
        const [p] = await tx
          .select()
          .from(produto)
          .where(and(eq(produto.id, it.produtoId), eq(produto.tenantId, tenantId)));
        if (p)
          await this.acumularProduto(
            tx,
            tenantId,
            p,
            1,
            Number(it.quantidade) || 1,
            [],
            consumo,
            true, // pedido externo → baixa também os custos/embalagens de delivery
          );
      }
      await this.lancarSaidas(tx, tenantId, consumo, comandaId);
    });
  }

  // Reimprime as vias (via do cliente) a partir do estado atual da comanda.
  async reimprimirViasExterno(
    tenantId: string,
    atorId: string,
    comandaId: string,
    alvoPreferido?: string | null,
    qrData?: string | null,
  ) {
    const [c] = await this.db
      .select()
      .from(comanda)
      .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
    if (!c) throw new NotFoundException('Comanda não encontrada');
    const itens = await this.db
      .select()
      .from(comandaItem)
      .where(
        and(
          eq(comandaItem.tenantId, tenantId),
          eq(comandaItem.comandaId, comandaId),
        ),
      );
    const res = await this.imprimirViaCliente(
      tenantId,
      comandaId,
      c.unidadeId,
      atorId,
      {
        senha: c.senha,
        mesa: c.mesa,
        itens: itens.map((it) => ({
          quantidade: Number(it.quantidade),
          descricao: it.descricao,
          precoUnitario: Number(it.precoUnitario),
          complementosTexto: null,
        })),
        total: Number(c.total),
        forma: c.forma,
      },
      null,
      alvoPreferido,
      qrData,
    );
    return { ok: (res?.enfileirados ?? 0) > 0, ...res };
  }

  // Reimprime a 2ª via do comprovante de um cupom (balcão/mesa/delivery).
  // Reaproveita a via do cliente a partir do estado atual da comanda.
  reimprimirCupom(tenantId: string, atorId: string, comandaId: string, alvoPreferido?: string | null) {
    return this.reimprimirViasExterno(tenantId, atorId, comandaId, alvoPreferido);
  }

  // Altera os itens de um delivery (comanda 'fechada'): adiciona/remove itens,
  // recalcula o total e ajusta o lançamento no financeiro. A baixa de estoque só
  // ocorre na conclusão, então NÃO há estorno aqui. Reemite a produção ao KDS.
  async alterarItensExterno(
    tenantId: string,
    atorId: string,
    comandaId: string,
    dto: {
      adicionar?: { produtoId: string; quantidade?: number; observacao?: string }[];
      remover?: string[];
    },
  ) {
    const [c] = await this.db
      .select()
      .from(comanda)
      .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
    if (!c) throw new NotFoundException('Comanda não encontrada');

    for (const itemId of dto.remover ?? []) {
      await this.db
        .delete(comandaItemComplemento)
        .where(eq(comandaItemComplemento.comandaItemId, itemId));
      await this.producao.removerItemComanda(tenantId, itemId);
      await this.db
        .delete(comandaItem)
        .where(
          and(eq(comandaItem.id, itemId), eq(comandaItem.comandaId, comandaId)),
        );
    }

    for (const add of dto.adicionar ?? []) {
      const [p] = await this.db
        .select()
        .from(produto)
        .where(and(eq(produto.id, add.produtoId), eq(produto.tenantId, tenantId)));
      if (!p) continue;
      const qtd = Number(add.quantidade) || 1;
      const preco = Number(p.precoVenda) || 0;
      const [item] = await this.db
        .insert(comandaItem)
        .values({
          tenantId,
          comandaId,
          produtoId: p.id,
          fichaId: p.fichaId,
          descricao: p.nome,
          quantidade: String(qtd),
          precoUnitario: String(preco),
          observacao: add.observacao || null,
          criadoPorId: atorId,
        })
        .returning();
      if (p.vaiParaProducao) {
        const payloads = await this.producao.criarPedidos(
          this.db,
          {
            tenantId,
            unidadeId: c.unidadeId,
            comandaId,
            senha: c.senha,
            origem: 'delivery',
          },
          [
            {
              produto: p,
              descricao: p.nome,
              quantidade: qtd,
              observacao: add.observacao || null,
              comandaItemId: item.id,
            },
          ],
        );
        this.producao.emitirNovos(payloads);
      }
    }

    // Recalcula o total a partir dos itens restantes.
    const itens = await this.db
      .select()
      .from(comandaItem)
      .where(
        and(
          eq(comandaItem.tenantId, tenantId),
          eq(comandaItem.comandaId, comandaId),
        ),
      );
    const total = itens.reduce(
      (s, it) => s + Number(it.precoUnitario) * Number(it.quantidade),
      0,
    );
    await this.db
      .update(comanda)
      .set({ total: String(total.toFixed(2)) })
      .where(eq(comanda.id, comandaId));
    // Ajusta a receita lançada (delivery = 'venda'/'entrada').
    await this.db
      .update(lancamentoCaixa)
      .set({ valor: String(total.toFixed(2)) })
      .where(
        and(
          eq(lancamentoCaixa.tenantId, tenantId),
          eq(lancamentoCaixa.comandaId, comandaId),
          eq(lancamentoCaixa.categoria, 'venda'),
          eq(lancamentoCaixa.tipo, 'entrada'),
        ),
      );
    // Avisa o KDS que o pedido foi alterado.
    await this.producao.marcarAlteradoPorComanda(tenantId, comandaId);
    return { total: Number(total.toFixed(2)) };
  }

  // ===== Mesas & comandas (J3) =====
  async abrirComanda(
    tenantId: string,
    atorId: string,
    dto: { mesa?: string; cliente?: string; unidadeId?: string },
  ) {
    return this.db.transaction(async (tx) => {
      // Comanda avulsa (sem mesa) recebe senha central; comanda de mesa não.
      const senha = dto.mesa
        ? null
        : await this.producao.proximaSenha(tx, tenantId, dto.unidadeId ?? null);
      const [c] = await tx
        .insert(comanda)
        .values({
          tenantId,
          unidadeId: dto.unidadeId,
          mesa: dto.mesa,
          senha,
          cliente: dto.cliente,
          status: 'aberta',
          abertaPorId: atorId,
        })
        .returning();
      return c;
    });
  }

  async listarComandas(tenantId: string) {
    const res: any = await this.db.execute(sql`
      select c.id, c.mesa, c.cliente, c.aberta_em as "abertaEm",
             coalesce(sum(ci.quantidade * ci.preco_unitario),0) as total,
             count(ci.id) as itens
      from comanda c
      left join comanda_item ci on ci.comanda_id = c.id
      where c.tenant_id = ${tenantId} and c.status = 'aberta' and c.mesa_id is null
      group by c.id
      order by c.aberta_em desc
    `);
    return res.rows ?? res;
  }

  // ===== Mesas (Fase F2) =====
  // Sub-PDV salão (mig 133): se o terminal atuante for um ponto de salão (equipamento
  // tipo='salao'), devolve { id, nome, pdvMainId }; senão null. Serve para exigir o
  // caixa do PDV main aberto e carimbar o cabeçalho de emissão da cozinha.
  private async pontoSalao(tenantId: string, terminalId?: string | null) {
    if (!terminalId) return null;
    const [e] = await this.db
      .select({
        id: equipamento.id,
        nome: equipamento.nome,
        tipo: equipamento.tipo,
        pdvMainId: equipamento.pdvMainId,
        unidadeId: equipamento.unidadeId,
      })
      .from(equipamento)
      .where(and(eq(equipamento.id, terminalId), eq(equipamento.tenantId, tenantId)));
    if (!e || e.tipo !== 'salao') return null;
    return { id: e.id, nome: e.nome, pdvMainId: e.pdvMainId, unidadeId: e.unidadeId };
  }

  // Terminal cujo caixa recebe o fechamento: o próprio PDV, ou — se for salão — o
  // PDV main a que o ponto está atrelado (o valor cai no caixa principal).
  private async terminalCaixa(tenantId: string, terminalId?: string | null) {
    const salao = await this.pontoSalao(tenantId, terminalId);
    return salao ? salao.pdvMainId ?? null : terminalId ?? null;
  }

  // Abre a mesa (dono = quem abriu). Modo 'mesa' já cria 1 comanda; 'comandas' fica vazia.
  // Sub-PDV salão só abre mesa com o turno do PDV main aberto.
  async abrirMesa(
    tenantId: string,
    atorId: string,
    dto: { numero: string; nome?: string; modo?: string; unidadeId?: string },
    terminalId?: string | null,
  ) {
    if (!dto.numero?.trim())
      throw new BadRequestException('Informe o número/nome da mesa.');
    const salao = await this.pontoSalao(tenantId, terminalId);
    if (salao) {
      const sessao = await this.sessaoAbertaId(this.db, tenantId, salao.pdvMainId);
      if (!sessao)
        throw new BadRequestException('Abra o caixa do PDV principal para abrir mesas no salão.');
    }
    const modo = dto.modo === 'comandas' ? 'comandas' : 'mesa';
    const [m] = await this.db
      .insert(mesa)
      .values({
        tenantId,
        unidadeId: dto.unidadeId,
        numero: dto.numero.trim(),
        nome: dto.nome,
        modo,
        donoId: atorId,
        equipamentoId: salao ? salao.id : null,
        abertaPorId: atorId,
      })
      .returning();
    if (modo === 'mesa') {
      await this.db.insert(comanda).values({
        tenantId,
        unidadeId: dto.unidadeId,
        mesaId: m.id,
        mesa: m.numero,
        status: 'aberta',
        origemEquipamentoId: salao ? salao.id : null,
        abertaPorId: atorId,
      });
    }
    return m;
  }

  async listarMesas(tenantId: string, unidadeId?: string) {
    const res: any = await this.db.execute(sql`
      select m.id, m.numero, m.nome, m.modo, m.dono_id as "donoId",
             m.aberta_em as "abertaEm",
             count(distinct c.id) as comandas,
             coalesce(sum(ci.quantidade * ci.preco_unitario),0) as total
      from mesa m
      left join comanda c on c.mesa_id = m.id and c.status = 'aberta'
      left join comanda_item ci on ci.comanda_id = c.id
      where m.tenant_id = ${tenantId} and m.status = 'aberta'
        ${unidadeId ? sql`and m.unidade_id = ${unidadeId}` : sql``}
      group by m.id
      order by m.aberta_em desc
    `);
    return res.rows ?? res;
  }

  // Mesa + suas comandas abertas (cada uma com itens e total).
  async getMesa(tenantId: string, mesaId: string) {
    const [m] = await this.db
      .select()
      .from(mesa)
      .where(and(eq(mesa.id, mesaId), eq(mesa.tenantId, tenantId)));
    if (!m) throw new NotFoundException('Mesa não encontrada');
    const comandas = await this.db
      .select()
      .from(comanda)
      .where(and(eq(comanda.mesaId, mesaId), eq(comanda.status, 'aberta')));
    const comComItens = await Promise.all(
      comandas.map(async (c) => {
        const itens = await this.db
          .select()
          .from(comandaItem)
          .where(eq(comandaItem.comandaId, c.id));
        const total = itens.reduce(
          (s, it) => s + Number(it.precoUnitario) * Number(it.quantidade),
          0,
        );
        return { ...c, itens, total: Number(total.toFixed(2)) };
      }),
    );
    return { ...m, comandas: comComItens };
  }

  // Abre uma comanda dentro da mesa (modo 'comandas' = por cliente/pulseira).
  async abrirComandaNaMesa(
    tenantId: string,
    atorId: string,
    mesaId: string,
    dto: { identificador?: string; cliente?: string },
  ) {
    const [m] = await this.db
      .select()
      .from(mesa)
      .where(and(eq(mesa.id, mesaId), eq(mesa.tenantId, tenantId)));
    if (!m) throw new NotFoundException('Mesa não encontrada');
    if (m.status !== 'aberta')
      throw new BadRequestException('Mesa não está aberta.');
    const [c] = await this.db
      .insert(comanda)
      .values({
        tenantId,
        unidadeId: m.unidadeId,
        mesaId: m.id,
        mesa: m.numero,
        identificador: dto.identificador,
        cliente: dto.cliente,
        status: 'aberta',
        abertaPorId: atorId,
      })
      .returning();
    return c;
  }

  // Fecha a mesa inteira: fecha cada comanda aberta (baixa + caixa) e marca a mesa.
  async fecharMesa(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    mesaId: string,
    dto: { forma?: string; taxaServicoPct?: number },
    terminalId?: string | null,
  ) {
    const [m] = await this.db
      .select()
      .from(mesa)
      .where(and(eq(mesa.id, mesaId), eq(mesa.tenantId, tenantId)));
    if (!m) throw new NotFoundException('Mesa não encontrada');
    if (m.status !== 'aberta')
      throw new BadRequestException('Mesa já fechada.');
    const comandas = await this.db
      .select({ id: comanda.id })
      .from(comanda)
      .where(and(eq(comanda.mesaId, mesaId), eq(comanda.status, 'aberta')));

    const cupons: any[] = [];
    for (const c of comandas) {
      const cnt: any = await this.db.execute(sql`
        select count(*)::int as n from comanda_item where comanda_id = ${c.id}
      `);
      const n = Number((cnt.rows ?? cnt)[0].n);
      if (n > 0) {
        // reaproveita o fechamento por comanda (baixa + lançamento + auditoria).
        const r = await this.fecharComanda(tenantId, atorId, atorPerfil, c.id, dto, terminalId);
        cupons.push(r);
      } else {
        // Comanda vazia: fecha sem cupom (não gera lançamento).
        await this.db
          .update(comanda)
          .set({ status: 'fechada', fechadaEm: new Date() })
          .where(eq(comanda.id, c.id));
      }
    }
    await this.db
      .update(mesa)
      .set({ status: 'fechada', fechadaEm: new Date(), fechadaPorId: atorId })
      .where(eq(mesa.id, mesaId));

    const total = cupons.reduce((s, x) => s + Number(x.total || 0), 0);
    return { mesaId, comandas: cupons.length, total: Number(total.toFixed(2)), cupons };
  }

  async getComanda(tenantId: string, id: string) {
    const [c] = await this.db
      .select()
      .from(comanda)
      .where(and(eq(comanda.id, id), eq(comanda.tenantId, tenantId)));
    if (!c) throw new NotFoundException('Comanda não encontrada');
    const itens = await this.db
      .select()
      .from(comandaItem)
      .where(eq(comandaItem.comandaId, id));
    const comps = itens.length
      ? await this.db
          .select()
          .from(comandaItemComplemento)
          .where(
            inArray(
              comandaItemComplemento.comandaItemId,
              itens.map((i) => i.id),
            ),
          )
      : [];
    const itensCom = itens.map((i) => ({
      ...i,
      complementos: comps.filter((x) => x.comandaItemId === i.id),
    }));
    return { ...c, itens: itensCom };
  }

  async adicionarItem(
    tenantId: string,
    atorId: string,
    comandaId: string,
    dto: {
      produtoId: string;
      variacaoId?: string;
      quantidade: number;
      complementos?: string[];
      observacao?: string;
    },
    terminalId?: string | null,
  ) {
    const [c] = await this.db
      .select()
      .from(comanda)
      .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
    if (!c) throw new NotFoundException('Comanda não encontrada');
    if (c.status !== 'aberta')
      throw new BadRequestException('Comanda não está aberta');
    // Sub-PDV salão: ponto que está lançando (carimba origem + cabeçalho cozinha).
    const salao = await this.pontoSalao(tenantId, terminalId);

    const [p] = await this.db
      .select()
      .from(produto)
      .where(and(eq(produto.id, dto.produtoId), eq(produto.tenantId, tenantId)));
    if (!p) throw new BadRequestException('Produto inválido');

    let preco = Number(p.precoVenda);
    let descricao = p.nome;
    if (dto.variacaoId) {
      const [v] = await this.db
        .select()
        .from(produtoVariacao)
        .where(eq(produtoVariacao.id, dto.variacaoId));
      if (v) {
        preco = Number(v.precoVenda);
        descricao = `${p.nome} · ${v.nome}`;
      }
    }
    const { snapshots, precoDelta } = await this.resolverComplementos(
      this.db,
      tenantId,
      p.id,
      dto.complementos ?? [],
    );
    preco += precoDelta;
    const qtd = Number(dto.quantidade) || 1;
    // Atacado por volume (mig 184): desconto por quantidade nesta linha da comanda.
    if (p.atacadoAtivo) {
      const faixas = await this.faixasAtacadoDe(this.db, tenantId, p.id);
      preco = precoComAtacado(preco, faixas, qtd);
    }
    const obs = dto.observacao || null;
    const [item] = await this.db
      .insert(comandaItem)
      .values({
        tenantId,
        comandaId,
        produtoId: p.id,
        variacaoId: dto.variacaoId,
        fichaId: p.fichaId,
        descricao,
        quantidade: String(qtd),
        precoUnitario: String(preco),
        observacao: obs,
        origemEquipamentoId: salao ? salao.id : null,
        criadoPorId: atorId,
      })
      .returning();
    for (const s of snapshots) {
      await this.db.insert(comandaItemComplemento).values({
        tenantId,
        comandaItemId: item.id,
        opcaoId: s.opcaoId,
        tipo: s.tipo,
        nome: s.nome,
        precoDelta: String(s.precoDelta),
        fichaIngredienteId: s.fichaIngredienteId,
        itemId: s.itemId,
        produtoRefId: s.produtoRefId,
        quantidade: String(s.quantidade),
      });
    }

    // Cozinha começa já (o pedido de produção vai ao destino ao lançar, não ao fechar).
    if (p.vaiParaProducao) {
      const payloads = await this.producao.criarPedidos(
        this.db,
        {
          tenantId,
          unidadeId: c.unidadeId,
          comandaId,
          senha: c.senha,
          origem: c.mesa ? 'mesa' : 'comanda',
          mesa: c.mesa,
          emitidoDe: salao ? salao.nome : null,
        },
        [
          {
            produto: p,
            descricao,
            quantidade: qtd,
            complementosTexto:
              snapshots
                .map((s: any) => `${s.tipo === 'remover' ? 'sem' : '+'} ${s.nome}`)
                .join(' · ') || null,
            observacao: obs,
            comandaItemId: item.id,
            opcaoIds: snapshots.map((s: any) => s.opcaoId), // roteamento por opção/etapa (Fase 1)
          },
        ],
      );
      this.producao.emitirNovos(payloads);
    }

    // Se a comanda pertence a uma mesa, avisa em tempo real o PDV dono (garçom → PDV).
    if (c.mesaId) {
      const [m] = await this.db
        .select({ donoId: mesa.donoId })
        .from(mesa)
        .where(eq(mesa.id, c.mesaId));
      this.events.emit('mesa.evento', {
        tenantId,
        donoId: m?.donoId ?? null,
        mesaId: c.mesaId,
        comandaId,
        tipo: 'item',
        descricao,
        quantidade: qtd,
      });
    }
    return item;
  }

  // Remove um item de uma comanda ABERTA (correção de pedido). Como a baixa só
  // ocorre no fechamento, não há estorno; avisa a produção (KDS) da alteração.
  async removerItem(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    itemId: string,
    justificativa?: string,
  ) {
    // Autorização: atendente só remove se o presidente liberou (mesmo gate do
    // cancelamento); gerente+ sempre. E a justificativa é SEMPRE obrigatória
    // (alimenta o relatório de retiradas).
    if (atorPerfil === 'atendente' && !(await this.cancelamentoLivre(tenantId))) {
      throw new ForbiddenException('Remoção de item requer autorização de um gerente.');
    }
    const just = (justificativa ?? '').trim();
    if (!just) throw new BadRequestException('Informe a justificativa da remoção.');
    const [it] = await this.db
      .select()
      .from(comandaItem)
      .where(and(eq(comandaItem.id, itemId), eq(comandaItem.tenantId, tenantId)));
    if (!it) throw new NotFoundException('Item não encontrado');
    const [c] = await this.db
      .select({ status: comanda.status })
      .from(comanda)
      .where(eq(comanda.id, it.comandaId));
    if (!c) throw new NotFoundException('Comanda não encontrada');
    if (c.status !== 'aberta')
      throw new BadRequestException(
        'Só é possível alterar itens de comanda aberta. Para venda fechada, use o cancelamento.',
      );

    await this.db
      .delete(comandaItemComplemento)
      .where(eq(comandaItemComplemento.comandaItemId, itemId));
    await this.db
      .delete(comandaItem)
      .where(and(eq(comandaItem.id, itemId), eq(comandaItem.tenantId, tenantId)));

    // Marca o item nos pedidos de produção como removido (cancela o pedido se vazio).
    await this.producao.removerItemComanda(tenantId, itemId);

    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'venda',
      acao: 'removeu_item_comanda',
      entidadeTipo: 'comanda_item',
      entidadeId: itemId,
      detalhe: { descricao: it.descricao, comandaId: it.comandaId, justificativa: just },
    });
    return { ok: true };
  }

  // Fecha a comanda: baixa por explosão de todos os itens + caixa. (Pedido já foi ao KDS.)
  // ===== Acerto de contas do sub-PDV (mig 143) =====
  // Fila do caixa: "o que ainda me devem prestar contas". Mostra quem fechou, a
  // mesa, o valor e a forma — o operador confere contra o dinheiro na mão.
  async listarAcertos(tenantId: string, terminalId?: string | null, unidadeId?: string | null) {
    const r: any = await this.db.execute(sql`
      select a.id, a.valor_centavos as "valorCentavos", a.forma, a.status,
             a.fechado_em as "fechadoEm", a.mesa_id as "mesaId",
             c.mesa, c.senha,
             sub.nome as "subPdvNome",
             col.nome as "fechadoPorNome"
        from acerto_subpdv a
        left join comanda c on c.id = a.comanda_id
        left join equipamento sub on sub.id = a.sub_pdv_id
        left join colaborador col on col.id = a.fechado_por_id
       where a.tenant_id = ${tenantId}
         and a.status = 'pendente'
         ${terminalId ? sql`and a.caixa_destino_id = ${terminalId}` : sql``}
         ${unidadeId ? sql`and a.unidade_id = ${unidadeId}` : sql``}
       order by a.fechado_em asc
    `);
    return r?.rows ?? r;
  }

  // O caixa recebeu e conferiu: agora sim o valor entra na gaveta. `recebido`
  // permite registrar diferença (quebra), no mesmo espírito do fechamento cego.
  async baixarAcerto(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    id: string,
    dto: { recebidoCentavos?: number; observacao?: string },
    terminalId?: string | null,
  ) {
    const caixaTerminalId = await this.terminalCaixa(tenantId, terminalId);
    const res = await this.db.transaction(async (tx) => {
      const [a] = await tx
        .select()
        .from(acertoSubpdv)
        .where(and(eq(acertoSubpdv.id, id), eq(acertoSubpdv.tenantId, tenantId)));
      if (!a) throw new NotFoundException('Acerto não encontrado.');
      if (a.status !== 'pendente')
        throw new BadRequestException('Este acerto já foi baixado.');

      // O dinheiro entra na sessão aberta AGORA (não na de quando fechou a mesa):
      // é neste momento que ele fisicamente chega ao caixa.
      const sessaoId = await this.sessaoAbertaId(tx, tenantId, caixaTerminalId, {
        id: atorId,
        categoria: atorPerfil,
      });
      if (!sessaoId) throw new BadRequestException('Abra o caixa para dar baixa no acerto.');

      const recebido = dto.recebidoCentavos ?? a.valorCentavos;
      const dif = recebido - a.valorCentavos;

      await tx.insert(lancamentoCaixa).values({
        tenantId,
        unidadeId: a.unidadeId,
        sessaoId,
        comandaId: a.comandaId,
        tipo: 'entrada',
        valor: String((recebido / 100).toFixed(2)),
        data: hojeISO(),
        categoria: 'venda',
        forma: a.forma ?? undefined,
        descricao: 'Acerto do salão',
        criadoPorId: atorId,
      });
      await tx
        .update(acertoSubpdv)
        .set({
          status: 'baixado',
          recebidoCentavos: recebido,
          diferencaCentavos: dif,
          baixadoPorId: atorId,
          baixadoEm: new Date(),
          caixaSessaoId: sessaoId,
          observacao: dto.observacao,
          updatedAt: new Date(),
        })
        .where(eq(acertoSubpdv.id, id));
      return { id, recebidoCentavos: recebido, diferencaCentavos: dif };
    });

    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'venda',
      acao: 'baixou_acerto_salao',
      entidadeTipo: 'acerto_subpdv',
      entidadeId: id,
      detalhe: res,
    });
    return res;
  }

  async fecharComanda(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    comandaId: string,
    dto: { forma?: string; taxaServicoPct?: number },
    terminalId?: string | null,
  ) {
    // Sub-PDV salão: o fechamento cai no caixa do PDV main (não no ponto do salão).
    const caixaTerminalId = await this.terminalCaixa(tenantId, terminalId);
    const salao = await this.pontoSalao(tenantId, terminalId);
    const res = await this.db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(comanda)
        .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
      if (!c) throw new NotFoundException('Comanda não encontrada');
      if (c.status !== 'aberta')
        throw new BadRequestException('Comanda não está aberta');

      const sessaoId = await this.sessaoAbertaId(tx, tenantId, caixaTerminalId, {
        id: atorId,
        categoria: atorPerfil,
      });
      if (!sessaoId)
        throw new BadRequestException('Abra o caixa para fechar a comanda.');

      const itens = await tx
        .select()
        .from(comandaItem)
        .where(eq(comandaItem.comandaId, comandaId));
      if (!itens.length)
        throw new BadRequestException('Comanda sem itens');

      let total = 0;
      const consumo = new Map<string, number>();
      for (const it of itens) {
        total += Number(it.precoUnitario) * Number(it.quantidade);
        const [p] = await tx
          .select()
          .from(produto)
          .where(eq(produto.id, it.produtoId as string));
        if (p) {
          let fator = 1;
          if (it.variacaoId) {
            const [v] = await tx
              .select()
              .from(produtoVariacao)
              .where(eq(produtoVariacao.id, it.variacaoId));
            if (v) fator = Number(v.fatorFicha) || 1;
          }
          const comps = await tx
            .select()
            .from(comandaItemComplemento)
            .where(eq(comandaItemComplemento.comandaItemId, it.id));
          await this.acumularProduto(
            tx,
            tenantId,
            p,
            fator,
            Number(it.quantidade),
            comps,
            consumo,
          );
        }
      }
      await this.lancarSaidas(tx, tenantId, consumo, comandaId);

      const taxa =
        dto.taxaServicoPct != null
          ? dto.taxaServicoPct
          : Number(c.taxaServicoPct) || 0;
      const totalComTaxa = total * (1 + taxa / 100);
      // Sub-PDV de salão (mig 143): o dinheiro fica com o garçom, então NÃO entra
      // no caixa agora — vira pendência de acerto. O caixa responsável confere
      // quando receber e só aí lança. Fechamento no próprio PDV entra direto.
      if (salao) {
        await tx.insert(acertoSubpdv).values({
          tenantId,
          // Nunca nulo: sem a loja, a pendência sumiria da fila filtrada por
          // unidade e o caixa nunca saberia que tem dinheiro a receber.
          unidadeId: c.unidadeId ?? salao.unidadeId,
          comandaId,
          mesaId: c.mesaId ?? null,
          subPdvId: salao.id,
          caixaDestinoId: caixaTerminalId,
          valorCentavos: Math.round(totalComTaxa * 100),
          forma: dto.forma,
          fechadoPorId: atorId,
        });
      } else {
        await tx.insert(lancamentoCaixa).values({
          tenantId,
          unidadeId: c.unidadeId,
          sessaoId,
          comandaId,
          tipo: 'entrada',
          valor: String(totalComTaxa.toFixed(2)),
          data: hojeISO(),
          categoria: 'venda',
          forma: dto.forma,
          descricao: c.mesa ? `Comanda · mesa ${c.mesa}` : 'Comanda',
          criadoPorId: atorId,
        });
      }
      await tx
        .update(comanda)
        .set({
          status: 'fechada',
          fechadaEm: new Date(),
          taxaServicoPct: String(taxa),
          total: String(totalComTaxa.toFixed(2)),
          forma: dto.forma,
        })
        .where(eq(comanda.id, comandaId));

      return {
        comandaId,
        subtotal: Number(total.toFixed(2)),
        taxaServicoPct: taxa,
        total: Number(totalComTaxa.toFixed(2)),
        senha: c.senha,
        mesa: c.mesa,
        unidadeId: c.unidadeId,
        viaClienteItens: itens.map((it) => ({
          quantidade: Number(it.quantidade),
          descricao: it.descricao,
          precoUnitario: Number(it.precoUnitario),
        })),
      };
    });

    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'venda',
      acao: 'fechou_comanda',
      entidadeTipo: 'comanda',
      entidadeId: comandaId,
      detalhe: { total: res.total },
    });

    // Via do cliente sai ao fechar a conta (mesa/comanda).
    await this.imprimirViaCliente(tenantId, comandaId, res.unidadeId, atorId, {
      senha: res.senha,
      mesa: res.mesa,
      itens: res.viaClienteItens,
      total: res.total,
      forma: dto.forma ?? null,
    });
    // NFC-e automática ao fechar a conta (se ativo na unidade).
    await this.fiscal.emitirSeAtivo(tenantId, atorId, comandaId, res.unidadeId);
    return res;
  }

  // ===== Cupons & cancelamento (Fase C) =====
  // Cupons = vendas fechadas/canceladas (as comandas). Consulta pelo atendente/gerente.
  // Pedido de totem que NÃO foi pago (erro no checkout do GoGeM). SÓ informativo:
  // entra na lista de Cupons como 'falha' + motivo, sem baixar estoque e sem caixa.
  // Endpoint SEPARADO da venda (via GoGeM, best-effort) para NUNCA virar venda/caixa.
  async registrarFalhaTotem(
    tenantId: string,
    ctx: { unidadeId: string | null; equipamentoId: string | null },
    dto: VendaExternaFalhaDto,
  ) {
    if (!dto.idempotencyKey?.trim())
      throw new BadRequestException('idempotencyKey é obrigatória.');
    const motivo = (dto.motivo ?? '').trim() || 'Falha no pagamento (totem).';

    // Idempotência: mesma chave → devolve o registro já criado (reenvio não duplica).
    const [existente] = await this.db
      .select({ id: comanda.id })
      .from(comanda)
      .where(
        and(
          eq(comanda.tenantId, tenantId),
          eq(comanda.idempotencyKey, dto.idempotencyKey),
        ),
      );
    if (existente) return { comandaId: existente.id, idempotente: true };

    // Resolve itens por codigo_pdv SÓ para a descrição (informativo). NÃO baixa
    // estoque, NÃO cria produção, NÃO lança caixa.
    const codigos = [
      ...new Set((dto.itens ?? []).map((i) => (i.codigoPdv ?? '').trim()).filter(Boolean)),
    ];
    const prods = codigos.length
      ? await this.db
          .select()
          .from(produto)
          .where(
            and(
              eq(produto.tenantId, tenantId),
              inArray(produto.codigo, codigos),
              isNull(produto.deletedAt),
            ),
          )
      : [];
    const porCodigo = new Map<string, any>(
      prods.filter((p) => p.codigo).map((p) => [p.codigo as string, p]),
    );

    const total = dto.totalCentavos != null ? Number(dto.totalCentavos) / 100 : null;
    try {
      const [cmd] = await this.db
        .insert(comanda)
        .values({
          tenantId,
          unidadeId: ctx.unidadeId ?? null,
          status: 'falha',
          idempotencyKey: dto.idempotencyKey,
          forma: dto.formaTentada ?? null,
          total: total != null ? String(total.toFixed(2)) : null,
          origemEquipamentoId: ctx.equipamentoId ?? null,
          // Reusa a coluna de motivo (sem migration) para a causa da falha.
          motivoCancelamento: motivo,
          obs: dto.senhaPlataforma ? `Totem #${dto.senhaPlataforma}` : null,
        })
        .returning();

      for (const it of dto.itens ?? []) {
        const p = porCodigo.get((it.codigoPdv ?? '').trim());
        const qtd = Number(it.quantidade) || 1;
        await this.db.insert(comandaItem).values({
          tenantId,
          comandaId: cmd.id,
          produtoId: p?.id ?? null,
          descricao: p?.nome ?? (it.codigoPdv ?? 'item'),
          quantidade: String(qtd),
          precoUnitario: p ? String(Number(p.precoVenda)) : '0',
        });
      }

      await this.auditoria.registrar({
        tenantId,
        atorId: null,
        atorPerfil: 'servico',
        tipo: 'venda',
        acao: 'falha_pagamento_totem',
        entidadeTipo: 'comanda',
        entidadeId: cmd.id,
        detalhe: {
          motivo,
          forma: dto.formaTentada ?? null,
          total,
          origem: 'totem',
          equipamentoId: ctx.equipamentoId,
        },
      });
      return { comandaId: cmd.id, status: 'falha' };
    } catch (e: any) {
      // Corrida: mesma chave inseriu primeiro (unique) → devolve o existente.
      if (e?.code === '23505') {
        const [ex] = await this.db
          .select({ id: comanda.id })
          .from(comanda)
          .where(
            and(
              eq(comanda.tenantId, tenantId),
              eq(comanda.idempotencyKey, dto.idempotencyKey),
            ),
          );
        if (ex) return { comandaId: ex.id, idempotente: true };
      }
      throw e;
    }
  }

  listarCupons(tenantId: string, limite = 50) {
    // Inclui 'falha' (pedido de totem que não foi pago — informativo). O join traz
    // o NOME do equipamento de origem (totem1/pdv1/caixa1) pro card do cupom.
    return this.db.execute(sql`
      select c.id, c.senha, c.mesa, c.status, c.total, c.forma,
             c.fechada_em as "fechadaEm", c.cancelada_em as "canceladaEm",
             c.aberta_em as "abertaEm",
             c.motivo_cancelamento as "motivoCancelamento",
             e.nome as "equipamentoNome"
      from comanda c
      left join equipamento e on e.id = c.origem_equipamento_id
      where c.tenant_id = ${tenantId} and c.status in ('fechada','cancelada','falha')
      order by coalesce(c.fechada_em, c.aberta_em) desc
      limit ${limite}
    `).then((r: any) => r.rows ?? r);
  }

  getCupom(tenantId: string, id: string) {
    return this.getComanda(tenantId, id);
  }

  // Busca um cupom pela SENHA (nº que o operador enxerga) — pega o mais recente.
  async buscarCupomPorSenha(tenantId: string, senha: number) {
    const n = Number(senha);
    if (!Number.isFinite(n)) throw new BadRequestException('Senha inválida.');
    const [c] = await this.db
      .select({ id: comanda.id })
      .from(comanda)
      .where(and(eq(comanda.tenantId, tenantId), eq(comanda.senha, n)))
      .orderBy(desc(comanda.abertaEm))
      .limit(1);
    if (!c) throw new NotFoundException('Nenhum cupom com essa senha.');
    return this.getComanda(tenantId, c.id);
  }

  // Configuração do presidente/C&O: se o cancelamento é livre para o atendente.
  // D1: exclui uma mesa VAZIA (sem item lançado). Se tiver item, bloqueia.
  async excluirMesa(tenantId: string, atorId: string, mesaId: string) {
    const [m] = await this.db
      .select()
      .from(mesa)
      .where(and(eq(mesa.id, mesaId), eq(mesa.tenantId, tenantId)));
    if (!m) throw new NotFoundException('Mesa não encontrada.');
    const r: any = await this.db.execute(sql`
      select count(ci.id)::int as n
      from comanda c left join comanda_item ci on ci.comanda_id = c.id
      where c.mesa_id = ${mesaId} and c.tenant_id = ${tenantId}`);
    const n = Number((r.rows ?? r)[0].n) || 0;
    if (n > 0) {
      throw new BadRequestException('A mesa tem itens lançados. Remova os itens ou feche a mesa antes de excluir.');
    }
    await this.db.delete(comanda).where(and(eq(comanda.mesaId, mesaId), eq(comanda.tenantId, tenantId)));
    await this.db.delete(mesa).where(and(eq(mesa.id, mesaId), eq(mesa.tenantId, tenantId)));
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil: '',
      tipo: 'venda',
      acao: 'excluiu_mesa',
      entidadeTipo: 'mesa',
      entidadeId: mesaId,
      detalhe: { numero: m.numero, nome: m.nome },
    });
    return { ok: true };
  }

  // D2: relatório de retiradas de item (com justificativa), lido da auditoria.
  async remocoesItens(tenantId: string, inicio?: string, fim?: string) {
    const cond = [eq(auditLog.tenantId, tenantId), eq(auditLog.acao, 'removeu_item_comanda')];
    if (inicio) cond.push(sql`${auditLog.createdAt} >= ${inicio}`);
    if (fim) cond.push(sql`${auditLog.createdAt} <= ${fim + ' 23:59:59'}`);
    const rows = await this.db
      .select({
        id: auditLog.id,
        createdAt: auditLog.createdAt,
        detalhe: auditLog.detalhe,
        ator: colaborador.nome,
      })
      .from(auditLog)
      .leftJoin(colaborador, eq(colaborador.id, auditLog.actorId))
      .where(and(...cond))
      .orderBy(desc(auditLog.createdAt))
      .limit(300);
    return rows.map((r: any) => ({
      id: r.id,
      data: r.createdAt,
      ator: r.ator ?? '—',
      descricao: r.detalhe?.descricao ?? '—',
      justificativa: r.detalhe?.justificativa ?? '',
    }));
  }

  private async cancelamentoLivre(tenantId: string): Promise<boolean> {
    const [e] = await this.db
      .select({ ativo: entitlement.ativo })
      .from(entitlement)
      .where(
        and(
          eq(entitlement.tenantId, tenantId),
          eq(entitlement.modulo, 'pdv_cancelamento_livre'),
        ),
      );
    return !!e?.ativo;
  }

  // Config do PDV (presidente/C&O): estado dos flags configuráveis.
  async getConfig(tenantId: string) {
    return { cancelamentoLivre: await this.cancelamentoLivre(tenantId) };
  }

  // Liga/desliga o cancelamento livre pelo atendente (upsert do entitlement).
  async setCancelamentoLivre(tenantId: string, ativo: boolean) {
    await this.db
      .insert(entitlement)
      .values({ tenantId, modulo: 'pdv_cancelamento_livre', ativo })
      .onConflictDoUpdate({
        target: [entitlement.tenantId, entitlement.modulo],
        set: { ativo, updatedAt: new Date() },
      });
    return { cancelamentoLivre: ativo };
  }

  // Cancela uma venda fechada: estorna estoque (entrada inversa) + caixa (lançamento
  // de estorno) e marca a comanda como cancelada. Reversível pois a baixa carrega
  // ref_tipo='venda'/ref_id=comanda.
  // `reaproveitado` (mig 128/132): insumo já baixado da venda foi REUTILIZADO
  // (volta ao estoque via estorno) ou virou PERDA (fica baixado). Default true.
  async cancelar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    comandaId: string,
    dto: { motivo?: string; reaproveitado?: boolean },
  ) {
    const reaproveitado = dto.reaproveitado !== false;
    // Autorização: atendente só cancela se o presidente liberou; gerente+ sempre.
    if (atorPerfil === 'atendente' && !(await this.cancelamentoLivre(tenantId))) {
      throw new ForbiddenException(
        'Cancelamento requer autorização de um gerente.',
      );
    }

    await this.db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(comanda)
        .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
      if (!c) throw new NotFoundException('Cupom não encontrado');
      if (c.status !== 'fechada')
        throw new BadRequestException(
          c.status === 'cancelada' ? 'Já cancelado.' : 'Só cancela venda fechada.',
        );

      const sessaoId = await this.sessaoAbertaId(tx, tenantId, null, {
        id: atorId,
        categoria: atorPerfil,
      });
      if (!sessaoId)
        throw new BadRequestException('Abra o caixa para cancelar a venda.');

      // Estorna estoque só se REUTILIZADO: entrada inversa de cada saída da venda.
      // Perda (reaproveitado=false) → mantém a baixa (o insumo foi descartado).
      const saidas = await tx
        .select()
        .from(movimentoEstoque)
        .where(
          and(
            eq(movimentoEstoque.tenantId, tenantId),
            eq(movimentoEstoque.refTipo, 'venda'),
            eq(movimentoEstoque.refId, comandaId),
          ),
        );
      if (reaproveitado) {
        for (const m of saidas) {
          await tx.insert(movimentoEstoque).values({
            tenantId,
            itemId: m.itemId,
            tipo: 'entrada',
            quantidade: m.quantidade,
            custoUnitario: m.custoUnitario ?? undefined,
            motivo: 'estorno',
            refTipo: 'estorno',
            refId: comandaId,
            data: hojeISO(),
          });
        }
      }

      // Estorna caixa: saída de estorno referente ao lançamento da venda.
      const [lanc] = await tx
        .select()
        .from(lancamentoCaixa)
        .where(
          and(
            eq(lancamentoCaixa.tenantId, tenantId),
            eq(lancamentoCaixa.comandaId, comandaId),
            eq(lancamentoCaixa.tipo, 'entrada'),
          ),
        );
      if (lanc) {
        await tx.insert(lancamentoCaixa).values({
          tenantId,
          unidadeId: lanc.unidadeId,
          sessaoId,
          comandaId,
          tipo: 'saida',
          valor: lanc.valor,
          data: hojeISO(),
          categoria: 'estorno',
          estornoDe: lanc.id,
          descricao: `Estorno · cancelamento venda`,
          criadoPorId: atorId,
        });
      }

      await tx
        .update(comanda)
        .set({
          status: 'cancelada',
          canceladaEm: new Date(),
          canceladaPorId: atorId,
          motivoCancelamento: dto.motivo,
          // Registra a decisão só quando houve baixa a estornar (senão n/a).
          estoqueReaproveitado: saidas.length ? reaproveitado : null,
        })
        .where(eq(comanda.id, comandaId));
    });

    // Avisa a produção/KDS: os pedidos dessa comanda saem da fila (cancelados).
    await this.producao
      .cancelarPorComanda(tenantId, atorId, comandaId, dto.motivo)
      .catch(() => {});

    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'venda',
      acao: 'cancelou_venda',
      entidadeTipo: 'comanda',
      entidadeId: comandaId,
      detalhe: { motivo: dto.motivo },
    });
    return { ok: true };
  }
}
