import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
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
  caixaSessao,
  entitlement,
  colaborador,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  ProducaoPedidoService,
  ItemProducao,
} from '../producao-pedido/producao-pedido.service';
import { FiscalService } from '../fiscal/fiscal.service';
import { VendaBalcaoDto } from './dto/venda-balcao.dto';

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
  ) {}

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
      const c =
        ((Number(ing.quantidade) * Number(ing.fatorCorrecao)) / rendimento) *
        multiplicador;
      if (c <= 0) continue;
      if (ing.subFichaId) {
        // Sub-receita: remoção só vale no nível do produto → set vazio na recursão.
        await this.acumularFicha(tx, tenantId, ing.subFichaId, c, consumo, new Set(), proximos);
        continue;
      }
      if (!ing.itemId) continue;
      consumo.set(ing.itemId, (consumo.get(ing.itemId) ?? 0) + c);
    }
  }

  // Sessão de caixa aberta (para amarrar a venda ao turno) — null se caixa fechado.
  // Caixa aberto do BALCÃO (origem 'pdv'). O caixa do delivery é uma gaveta
  // separada e não deve satisfazer/receber uma venda de balcão.
  private async sessaoAbertaId(tx: any, tenantId: string): Promise<string | null> {
    const [s] = await tx
      .select({ id: caixaSessao.id })
      .from(caixaSessao)
      .where(
        and(
          eq(caixaSessao.tenantId, tenantId),
          eq(caixaSessao.status, 'aberta'),
          eq(caixaSessao.origem, 'pdv'),
        ),
      );
    return s?.id ?? null;
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
        );
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
          controlaEstoque: produto.controlaEstoque,
        })
        .from(produto)
        .where(and(eq(produto.tenantId, tenantId), eq(produto.id, c.produtoRefId)));
      if (!ref) continue;
      const q = (Number(c.quantidade) || 1) * quantidade;
      await this.acumularProduto(tx, tenantId, ref, 1, q, [], consumo);
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
      await tx.insert(movimentoEstoque).values({
        tenantId,
        itemId,
        tipo: 'saida',
        quantidade: String(qtd),
        custoUnitario: item?.custoMedio != null ? String(item.custoMedio) : undefined,
        motivo: 'venda',
        refTipo: 'venda',
        refId: comandaId,
        data: hojeISO(),
      });
    }
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
      precoDelta += Number(o.precoDelta) || 0;
      snapshots.push({
        opcaoId: o.id,
        tipo: o.tipo,
        nome: o.nome,
        precoDelta: o.precoDelta,
        fichaIngredienteId: o.fichaIngredienteId,
        itemId: o.itemId,
        produtoRefId: o.produtoRefId,
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
  ) {
    if (!dto.itens?.length)
      throw new BadRequestException('Adicione ao menos um item.');

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

    let res: any;
    try {
      res = await this.db.transaction(async (tx) => {
      // Fase A: venda exige caixa aberto.
      const sessaoId = await this.sessaoAbertaId(tx, tenantId);
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
        total += preco * qtd;

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
            quantidade: String(qtd),
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

        await this.acumularProduto(tx, tenantId, p, fatorFicha, qtd, snapshots, consumo);

        const compTexto =
          snapshots
            .map((s: any) => `${s.tipo === 'remover' ? 'sem' : '+'} ${s.nome}`)
            .join(' · ') || null;
        viaClienteItens.push({
          quantidade: qtd,
          descricao,
          precoUnitario: preco,
          complementosTexto: compTexto,
        });
        if (p.vaiParaProducao)
          itensProducao.push({
            produto: p,
            descricao,
            quantidade: qtd,
            complementosTexto: compTexto,
            observacao: obs,
            comandaItemId: ci.id,
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

    // Notifica destinos (KDS/impressora) dos novos pedidos duráveis (tempo real).
    this.producao.emitirNovos(res.producaoPayloads);

    // Via do cliente (balcão): imprime o cupom nas impressoras de papel 'cupom'.
    await this.imprimirViaCliente(tenantId, res.comandaId, res.unidadeId, atorId, {
      senha: res.senha,
      mesa: dto.mesa ?? null,
      itens: res.viaClienteItens,
      total: res.total,
      forma: dto.forma ?? null,
    });

    // NFC-e automática (se o fiscal estiver ativo na unidade). Não bloqueia a venda.
    const nota = await this.fiscal.emitirSeAtivo(
      tenantId,
      atorId,
      res.comandaId,
      res.unidadeId,
    );
    return { ...res, nfce: nota ? { status: nota.status, chave: nota.chave, numero: nota.numero } : null };
  }

  // Renderiza + enfileira a via do cliente (cupom). Silencioso se não há impressora 'cupom'.
  private async imprimirViaCliente(
    tenantId: string,
    comandaId: string,
    unidadeId: string | null,
    atorId: string,
    dados: { senha?: number | null; mesa?: string | null; itens: any[]; total: number; forma?: string | null },
  ) {
    const [ator] = await this.db
      .select({ nome: colaborador.nome })
      .from(colaborador)
      .where(eq(colaborador.id, atorId));
    const conteudo = this.producao.renderViaCliente({
      ...dados,
      atendente: ator?.nome ?? null,
    });
    await this.producao.enfileirarViaCliente(tenantId, unidadeId, comandaId, conteudo);
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
      plataforma?: string | null; // ex.: "Cardápio", "iFood"
      senhaPlataforma?: string | null; // senha/nº do pedido na plataforma
      itens: {
        produtoId?: string | null;
        descricao: string;
        quantidade: number;
        precoUnitario: number;
        observacao?: string | null;
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
              comandaItemId: ci.id,
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

  // Estorna uma venda externa (delivery cancelado). Como não passa por caixa,
  // reverte estoque (entrada inversa) e o lançamento 'online', sem exigir sessão.
  async estornarVendaExterna(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    comandaId: string,
    motivo?: string,
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
    await this.imprimirViaCliente(tenantId, comandaId, c.unidadeId, atorId, {
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
    });
    return { ok: true };
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
  // Abre a mesa (dono = quem abriu). Modo 'mesa' já cria 1 comanda; 'comandas' fica vazia.
  async abrirMesa(
    tenantId: string,
    atorId: string,
    dto: { numero: string; nome?: string; modo?: string; unidadeId?: string },
  ) {
    if (!dto.numero?.trim())
      throw new BadRequestException('Informe o número/nome da mesa.');
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
        const r = await this.fecharComanda(tenantId, atorId, atorPerfil, c.id, dto);
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
  ) {
    const [c] = await this.db
      .select()
      .from(comanda)
      .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
    if (!c) throw new NotFoundException('Comanda não encontrada');
    if (c.status !== 'aberta')
      throw new BadRequestException('Comanda não está aberta');

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
  ) {
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
      detalhe: { descricao: it.descricao, comandaId: it.comandaId },
    });
    return { ok: true };
  }

  // Fecha a comanda: baixa por explosão de todos os itens + caixa. (Pedido já foi ao KDS.)
  async fecharComanda(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    comandaId: string,
    dto: { forma?: string; taxaServicoPct?: number },
  ) {
    const res = await this.db.transaction(async (tx) => {
      const [c] = await tx
        .select()
        .from(comanda)
        .where(and(eq(comanda.id, comandaId), eq(comanda.tenantId, tenantId)));
      if (!c) throw new NotFoundException('Comanda não encontrada');
      if (c.status !== 'aberta')
        throw new BadRequestException('Comanda não está aberta');

      const sessaoId = await this.sessaoAbertaId(tx, tenantId);
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
  listarCupons(tenantId: string, limite = 50) {
    return this.db.execute(sql`
      select c.id, c.senha, c.mesa, c.status, c.total, c.forma,
             c.fechada_em as "fechadaEm", c.cancelada_em as "canceladaEm",
             c.motivo_cancelamento as "motivoCancelamento"
      from comanda c
      where c.tenant_id = ${tenantId} and c.status in ('fechada','cancelada')
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
  async cancelar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    comandaId: string,
    dto: { motivo?: string },
  ) {
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

      const sessaoId = await this.sessaoAbertaId(tx, tenantId);
      if (!sessaoId)
        throw new BadRequestException('Abra o caixa para cancelar a venda.');

      // Estorna estoque: entrada inversa de cada saída da venda.
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
