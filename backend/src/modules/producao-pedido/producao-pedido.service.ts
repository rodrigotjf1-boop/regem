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
  equipamento,
  produtoDestinoProducao,
  setorDestinoProducao,
  producaoPedido,
  producaoPedidoItem,
  impressaoJob,
  kdsCorConfig,
  senhaContador,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Item pronto para roteamento (montado pela venda a partir da comanda).
export interface ItemProducao {
  produto: any; // linha de produto (precisa: id, vaiParaProducao, setorProducaoId, tempoPreparoMin)
  descricao: string;
  quantidade: number;
  complementosTexto?: string | null;
  observacao?: string | null;
  comandaItemId?: string | null;
}

// Um destino resolvido para um produto.
interface Destino {
  equipamentoId: string | null;
  tipo: string; // kds | impressora
  setorId: string | null;
}

// Status válidos, em ordem de avanço.
const JANELA_ACAO_MIN = 30; // atendente pode agir até 30min após "pronto"

@Injectable()
export class ProducaoPedidoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly events: EventEmitter2,
  ) {}

  // ===== Roteamento =====
  // Resolve os destinos de um produto: (1) destinos próprios; (2) padrão do setor;
  // (3) legado (setor sem device); (4) genérico (sem setor).
  private async resolverDestinos(
    tx: any,
    tenantId: string,
    p: any,
  ): Promise<Destino[]> {
    // (1) destinos explícitos do produto
    const proprios = await tx
      .select({
        equipamentoId: equipamento.id,
        tipo: equipamento.tipo,
        setorId: equipamento.setorId,
      })
      .from(produtoDestinoProducao)
      .innerJoin(
        equipamento,
        eq(equipamento.id, produtoDestinoProducao.equipamentoId),
      )
      .where(
        and(
          eq(produtoDestinoProducao.tenantId, tenantId),
          eq(produtoDestinoProducao.produtoId, p.id),
          eq(equipamento.ativo, true),
        ),
      );
    if (proprios.length) return proprios.map(this.normalizaDestino);

    // (2) padrão do setor do produto
    if (p.setorProducaoId) {
      const doSetor = await tx
        .select({
          equipamentoId: equipamento.id,
          tipo: equipamento.tipo,
          setorId: equipamento.setorId,
        })
        .from(setorDestinoProducao)
        .innerJoin(
          equipamento,
          eq(equipamento.id, setorDestinoProducao.equipamentoId),
        )
        .where(
          and(
            eq(setorDestinoProducao.tenantId, tenantId),
            eq(setorDestinoProducao.setorId, p.setorProducaoId),
            eq(equipamento.ativo, true),
          ),
        );
      if (doSetor.length) return doSetor.map(this.normalizaDestino);
      // (3) legado: setor sem device → pedido de KDS filtrável por setor
      return [{ equipamentoId: null, tipo: 'kds', setorId: p.setorProducaoId }];
    }
    // (4) genérico
    return [{ equipamentoId: null, tipo: 'kds', setorId: null }];
  }

  private normalizaDestino = (d: any): Destino => ({
    equipamentoId: d.equipamentoId ?? null,
    tipo: d.tipo === 'impressora' ? 'impressora' : 'kds',
    setorId: d.setorId ?? null,
  });

  // Cria os pedidos duráveis (um por destino) para os itens de uma venda/comanda.
  // Roda DENTRO da transação da venda. Devolve payloads para emitir após o commit.
  async criarPedidos(
    tx: any,
    ctx: {
      tenantId: string;
      unidadeId?: string | null;
      comandaId: string;
      origem: string;
      mesa?: string | null;
      senha?: number | null;
    },
    itens: ItemProducao[],
  ): Promise<any[]> {
    const daProducao = itens.filter((it) => it.produto?.vaiParaProducao);
    if (!daProducao.length) return [];

    // Agrupa itens por destino (chave estável).
    const grupos = new Map<string, { destino: Destino; itens: ItemProducao[] }>();
    for (const it of daProducao) {
      const destinos = await this.resolverDestinos(tx, ctx.tenantId, it.produto);
      for (const d of destinos) {
        const chave = `${d.equipamentoId ?? 'null'}|${d.tipo}|${d.setorId ?? 'null'}`;
        if (!grupos.has(chave)) grupos.set(chave, { destino: d, itens: [] });
        grupos.get(chave)!.itens.push(it);
      }
    }

    const payloads: any[] = [];
    for (const { destino, itens: its } of grupos.values()) {
      const numero = await this.proximoNumero(tx, ctx.tenantId, ctx.unidadeId);
      const tempo = its.reduce(
        (mx, it) => Math.max(mx, Number(it.produto?.tempoPreparoMin) || 0),
        0,
      );
      const [ped] = await tx
        .insert(producaoPedido)
        .values({
          tenantId: ctx.tenantId,
          unidadeId: ctx.unidadeId ?? null,
          comandaId: ctx.comandaId,
          destinoEquipamentoId: destino.equipamentoId,
          destinoTipo: destino.tipo,
          setorId: destino.setorId,
          numero,
          senha: ctx.senha ?? null,
          origem: ctx.origem,
          mesa: ctx.mesa ?? null,
          status: 'recebido',
          tempoPreparoMin: tempo || null,
        })
        .returning();
      for (const it of its) {
        await tx.insert(producaoPedidoItem).values({
          tenantId: ctx.tenantId,
          pedidoId: ped.id,
          comandaItemId: it.comandaItemId ?? null,
          descricao: it.descricao,
          quantidade: String(it.quantidade),
          complementosTexto: it.complementosTexto ?? null,
          observacao: it.observacao ?? null,
        });
      }
      // Destino impressora → enfileira a VIA DE PRODUÇÃO (sem valores; worker imprime).
      if (destino.tipo === 'impressora') {
        await tx.insert(impressaoJob).values({
          tenantId: ctx.tenantId,
          unidadeId: ctx.unidadeId ?? null,
          equipamentoId: destino.equipamentoId,
          pedidoId: ped.id,
          via: 'producao',
          conteudo: this.renderTicket(ctx, its, numero),
        });
      }
      payloads.push({
        tenantId: ctx.tenantId,
        unidadeId: ctx.unidadeId ?? null,
        setorId: destino.setorId,
        destinoEquipamentoId: destino.equipamentoId,
        destinoTipo: destino.tipo,
        pedidoId: ped.id,
        tipo: 'novo',
      });
    }
    return payloads;
  }

  // VIA DE PRODUÇÃO (cozinha) — sem valores; senha e observações/adicionais em
  // destaque. O worker do edge converte para ESC/POS.
  private renderTicket(ctx: any, its: any[], numero?: number | null): string {
    const linha = '--------------------------------';
    const cab = ctx.mesa ? `MESA ${ctx.mesa}` : 'BALCAO';
    const l: string[] = ['*** PRODUCAO ***'];
    if (ctx.senha) l.push(`>>> SENHA ${ctx.senha} <<<`);
    l.push(`${cab}${numero ? ` · #${numero}` : ''}`, linha);
    for (const it of its) {
      l.push(`${Number(it.quantidade)}x ${it.descricao}`);
      if (it.complementosTexto) l.push(`  >> ${it.complementosTexto}`);
      if (it.observacao) l.push(`  ** OBS: ${it.observacao}`);
    }
    l.push(linha);
    l.push(new Date().toLocaleString('pt-BR'));
    return l.join('\n');
  }

  // VIA DO CLIENTE (cupom) — com valores, atendente, hora e senha em destaque.
  renderViaCliente(dados: {
    senha?: number | null;
    mesa?: string | null;
    itens: { quantidade: number; descricao: string; precoUnitario: number; complementosTexto?: string | null }[];
    total: number;
    forma?: string | null;
    atendente?: string | null;
  }): string {
    const linha = '--------------------------------';
    const money = (n: number) =>
      Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const l: string[] = ['REGEM', 'Cupom - via do cliente'];
    if (dados.senha) l.push(`>>> SENHA ${dados.senha} <<<`);
    l.push(linha);
    for (const it of dados.itens) {
      const sub = Number(it.precoUnitario) * Number(it.quantidade);
      l.push(`${Number(it.quantidade)}x ${it.descricao}`);
      if (it.complementosTexto) l.push(`   ${it.complementosTexto}`);
      l.push(`   ${money(sub)}`);
    }
    l.push(linha);
    l.push(`TOTAL: ${money(dados.total)}`);
    if (dados.forma) l.push(`Pagamento: ${dados.forma}`);
    if (dados.atendente) l.push(`Atendente: ${dados.atendente}`);
    l.push(new Date().toLocaleString('pt-BR'));
    return l.join('\n');
  }

  // Enfileira a via do cliente nas impressoras de papel 'cupom' da unidade.
  async enfileirarViaCliente(
    tenantId: string,
    unidadeId: string | null,
    comandaId: string,
    conteudo: string,
  ) {
    const cupomPrinters = await this.db
      .select({ id: equipamento.id })
      .from(equipamento)
      .where(
        and(
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.tipo, 'impressora'),
          eq(equipamento.papel, 'cupom'),
          eq(equipamento.ativo, true),
        ),
      );
    for (const p of cupomPrinters) {
      await this.db.insert(impressaoJob).values({
        tenantId,
        unidadeId,
        equipamentoId: p.id,
        pedidoId: null,
        via: 'cliente',
        conteudo,
      });
    }
    return cupomPrinters.length;
  }

  // ===== Fila de impressão (worker do edge; auth por token servidor_local) =====
  // Devolve host/porta da impressora junto (o worker não precisa de outra chamada).
  jobsPendentes(tenantId: string, limite = 20) {
    return this.db
      .select({
        id: impressaoJob.id,
        equipamentoId: impressaoJob.equipamentoId,
        pedidoId: impressaoJob.pedidoId,
        conteudo: impressaoJob.conteudo,
        tentativas: impressaoJob.tentativas,
        criadoEm: impressaoJob.criadoEm,
        host: equipamento.host,
        porta: equipamento.porta,
        impressora: equipamento.nome,
      })
      .from(impressaoJob)
      .leftJoin(equipamento, eq(equipamento.id, impressaoJob.equipamentoId))
      .where(
        and(
          eq(impressaoJob.tenantId, tenantId),
          eq(impressaoJob.status, 'pendente'),
        ),
      )
      .orderBy(impressaoJob.criadoEm)
      .limit(limite);
  }

  async marcarImpresso(tenantId: string, jobId: string) {
    await this.db
      .update(impressaoJob)
      .set({ status: 'impresso', impressoEm: new Date() })
      .where(
        and(eq(impressaoJob.id, jobId), eq(impressaoJob.tenantId, tenantId)),
      );
    return { ok: true };
  }

  async marcarErro(tenantId: string, jobId: string, erro?: string) {
    await this.db
      .update(impressaoJob)
      .set({
        status: 'erro',
        erro: (erro ?? 'falha').slice(0, 400),
        tentativas: sql`${impressaoJob.tentativas} + 1`,
      })
      .where(
        and(eq(impressaoJob.id, jobId), eq(impressaoJob.tenantId, tenantId)),
      );
    return { ok: true };
  }

  // Reenfileira um job com erro (gestor).
  async reimprimir(tenantId: string, jobId: string) {
    await this.db
      .update(impressaoJob)
      .set({ status: 'pendente', erro: null })
      .where(
        and(eq(impressaoJob.id, jobId), eq(impressaoJob.tenantId, tenantId)),
      );
    return { ok: true };
  }

  // Nº sequencial de exibição por unidade/dia (reinicia a cada dia).
  private async proximoNumero(
    tx: any,
    tenantId: string,
    unidadeId?: string | null,
  ): Promise<number> {
    const r: any = await tx.execute(sql`
      select coalesce(max(numero), 0) + 1 as n
      from producao_pedido
      where tenant_id = ${tenantId}
        and criado_em::date = current_date
        and unidade_id is not distinct from ${unidadeId ?? null}
    `);
    return Number((r.rows ?? r)[0].n) || 1;
  }

  // ===== Senha central (atômica, com reset diário/semanal) =====
  // Puxa a próxima senha da unidade travando a linha (dois PDVs não duplicam).
  async proximaSenha(
    tx: any,
    tenantId: string,
    unidadeId?: string | null,
  ): Promise<number> {
    await tx.execute(sql`
      insert into senha_contador (tenant_id, unidade_id)
      values (${tenantId}, ${unidadeId ?? null})
      on conflict (tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid))
      do nothing
    `);
    const cur: any = await tx.execute(sql`
      select id, valor, periodo, ultimo_reset as "ultimoReset"
      from senha_contador
      where tenant_id = ${tenantId} and unidade_id is not distinct from ${unidadeId ?? null}
      for update
    `);
    const row = (cur.rows ?? cur)[0];
    const reset = this.precisaReset(row.periodo, row.ultimoReset);
    const valor = (reset ? 0 : Number(row.valor)) + 1;
    await tx.execute(sql`
      update senha_contador
      set valor = ${valor},
          ultimo_reset = ${reset ? sql`current_date` : sql`ultimo_reset`},
          updated_at = now()
      where id = ${row.id}
    `);
    return valor;
  }

  private toDate(d: any): Date {
    return d instanceof Date ? d : new Date(String(d) + 'T00:00:00');
  }
  private diaStr(d: Date) {
    return d.toISOString().slice(0, 10);
  }
  private inicioSemana(d: Date) {
    const x = new Date(d);
    const dow = (x.getDay() + 6) % 7; // segunda = 0
    x.setDate(x.getDate() - dow);
    return this.diaStr(x);
  }
  private precisaReset(periodo: string, ultimoReset: any): boolean {
    if (periodo === 'nunca') return false;
    const ur = this.toDate(ultimoReset);
    const hoje = new Date();
    if (periodo === 'semanal') return this.inicioSemana(ur) < this.inicioSemana(hoje);
    return this.diaStr(ur) < this.diaStr(hoje); // diario (padrão)
  }

  async getSenhaConfig(tenantId: string, unidadeId?: string | null) {
    const [row] = await this.db
      .select({ periodo: senhaContador.periodo, valor: senhaContador.valor })
      .from(senhaContador)
      .where(
        and(
          eq(senhaContador.tenantId, tenantId),
          unidadeId
            ? eq(senhaContador.unidadeId, unidadeId)
            : sql`unidade_id is null`,
        ),
      );
    return { periodo: row?.periodo ?? 'diario', atual: row?.valor ?? 0 };
  }

  async setSenhaPeriodo(
    tenantId: string,
    unidadeId: string | null,
    periodo: string,
  ) {
    const p = ['diario', 'semanal', 'nunca'].includes(periodo) ? periodo : 'diario';
    const [row] = await this.db
      .select({ id: senhaContador.id })
      .from(senhaContador)
      .where(
        and(
          eq(senhaContador.tenantId, tenantId),
          unidadeId
            ? eq(senhaContador.unidadeId, unidadeId)
            : sql`unidade_id is null`,
        ),
      );
    if (row) {
      await this.db
        .update(senhaContador)
        .set({ periodo: p, updatedAt: new Date() })
        .where(eq(senhaContador.id, row.id));
    } else {
      await this.db
        .insert(senhaContador)
        .values({ tenantId, unidadeId, periodo: p });
    }
    return { periodo: p };
  }

  // ===== Etapas do KDS por unidade (recebido e pronto sempre; preparo/entregue opcionais) =====
  private async etapasDe(tenantId: string, unidadeId?: string | null) {
    const [row] = await this.db
      .select({
        usaPreparo: kdsCorConfig.usaPreparo,
        usaEntregue: kdsCorConfig.usaEntregue,
      })
      .from(kdsCorConfig)
      .where(
        and(
          eq(kdsCorConfig.tenantId, tenantId),
          unidadeId
            ? eq(kdsCorConfig.unidadeId, unidadeId)
            : sql`unidade_id is null`,
        ),
      );
    const usaPreparo = row?.usaPreparo ?? true;
    const usaEntregue = row?.usaEntregue ?? true;
    const fluxo = [
      'recebido',
      ...(usaPreparo ? ['preparo'] : []),
      'pronto',
      ...(usaEntregue ? ['entregue'] : []),
    ];
    return { usaPreparo, usaEntregue, fluxo };
  }

  // Existe um KDS de entrega ativo (para rota pronto → entrega)?
  private async temKdsEntrega(
    tenantId: string,
    unidadeId?: string | null,
  ): Promise<boolean> {
    const rows = await this.db
      .select({ id: equipamento.id })
      .from(equipamento)
      .where(
        and(
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.tipo, 'kds'),
          eq(equipamento.escopo, 'entrega'),
          eq(equipamento.ativo, true),
          unidadeId ? eq(equipamento.unidadeId, unidadeId) : sql`true`,
        ),
      );
    return rows.length > 0;
  }

  // Emite os eventos de novos pedidos (chamado após o commit da venda).
  emitirNovos(payloads: any[]) {
    for (const p of payloads) this.events?.emit('producao.evento', p);
  }

  // ===== Consulta =====
  private async comItens(tenantId: string, pedidos: any[]) {
    if (!pedidos.length) return [];
    const itens = await this.db
      .select()
      .from(producaoPedidoItem)
      .where(
        and(
          eq(producaoPedidoItem.tenantId, tenantId),
          inArray(
            producaoPedidoItem.pedidoId,
            pedidos.map((p) => p.id),
          ),
        ),
      );
    return pedidos.map((p) => ({
      ...p,
      itens: itens.filter((i) => i.pedidoId === p.id),
    }));
  }

  // Fila do KDS. escopo 'entrega' mostra os PRONTOS (retirada); 'producao' mostra
  // recebido/preparo (+pronto só se não houver KDS de entrega assumindo a entrega).
  async filaKds(
    tenantId: string,
    opts: { setorId?: string; unidadeId?: string; escopo?: string } = {},
  ) {
    const entrega = opts.escopo === 'entrega';
    const cores = await this.getCores(tenantId, opts.unidadeId);
    const conds = [
      eq(producaoPedido.tenantId, tenantId),
      eq(producaoPedido.destinoTipo, 'kds'),
    ];
    if (opts.unidadeId) conds.push(eq(producaoPedido.unidadeId, opts.unidadeId));

    if (entrega) {
      conds.push(eq(producaoPedido.status, 'pronto'));
    } else {
      // Produção: sempre recebido/preparo. 'pronto' fica aqui só se ninguém de
      // entrega vai assumir (sem KDS de entrega e sem etapa 'entregue').
      const temEntrega = await this.temKdsEntrega(tenantId, opts.unidadeId);
      const statusProd = ['recebido', 'preparo'];
      if (!temEntrega && !cores.usaEntregue) statusProd.push('pronto');
      else if (!temEntrega && cores.usaEntregue) statusProd.push('pronto'); // avança até entregue no próprio KDS
      conds.push(inArray(producaoPedido.status, statusProd));
      if (opts.setorId) conds.push(eq(producaoPedido.setorId, opts.setorId));
    }
    const pedidos = await this.db
      .select()
      .from(producaoPedido)
      .where(and(...conds))
      .orderBy(producaoPedido.criadoEm);
    return { cores, pedidos: await this.comItens(tenantId, pedidos) };
  }

  // Fila do PDV (atendente): ativos + concluídos recentes (janela de ação).
  async filaPdv(tenantId: string, opts: { unidadeId?: string } = {}) {
    const conds = [eq(producaoPedido.tenantId, tenantId)];
    if (opts.unidadeId) conds.push(eq(producaoPedido.unidadeId, opts.unidadeId));
    const pedidos = await this.db
      .select()
      .from(producaoPedido)
      .where(
        and(
          ...conds,
          sql`(status in ('recebido','preparo','pronto')
               or (status in ('entregue','cancelado')
                   and coalesce(pronto_em, criado_em) > now() - interval '${sql.raw(
                     String(JANELA_ACAO_MIN),
                   )} minutes'))`,
        ),
      )
      .orderBy(desc(producaoPedido.criadoEm))
      .limit(100);
    return this.comItens(tenantId, pedidos);
  }

  private async carregar(tenantId: string, pedidoId: string) {
    const [p] = await this.db
      .select()
      .from(producaoPedido)
      .where(
        and(
          eq(producaoPedido.id, pedidoId),
          eq(producaoPedido.tenantId, tenantId),
        ),
      );
    if (!p) throw new NotFoundException('Pedido de produção não encontrado');
    return p;
  }

  // ===== Transições =====
  // Avança o pedido para a próxima etapa HABILITADA da unidade. Só avança.
  // 'entregue' só pelo KDS de entrega quando existe um (escopo='entrega').
  async avancar(
    tenantId: string,
    atorId: string,
    pedidoId: string,
    escopo?: string,
  ) {
    const p = await this.carregar(tenantId, pedidoId);
    if (p.status === 'cancelado')
      throw new BadRequestException('Pedido cancelado não avança.');
    const { fluxo } = await this.etapasDe(tenantId, p.unidadeId);
    const idx = fluxo.indexOf(p.status);
    if (idx < 0 || idx >= fluxo.length - 1)
      throw new BadRequestException('Pedido já concluído.');
    const novo = fluxo[idx + 1];
    if (
      novo === 'entregue' &&
      escopo !== 'entrega' &&
      (await this.temKdsEntrega(tenantId, p.unidadeId))
    ) {
      throw new BadRequestException('A entrega é concluída no KDS de entrega.');
    }
    const patch: any = { status: novo };
    if (novo === 'preparo') patch.iniciadoEm = new Date();
    if (novo === 'pronto') patch.prontoEm = new Date();
    if (novo === 'entregue') patch.entregueEm = new Date();
    await this.db
      .update(producaoPedido)
      .set(patch)
      .where(eq(producaoPedido.id, pedidoId));
    this.events?.emit('producao.evento', {
      tenantId,
      unidadeId: p.unidadeId,
      setorId: p.setorId,
      destinoEquipamentoId: p.destinoEquipamentoId,
      pedidoId,
      tipo: 'status',
      status: novo,
    });
    return { ok: true, status: novo };
  }

  // PDV (atendente) cancela o pedido em produção e avisa o KDS. Respeita a janela.
  async cancelarPedido(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    pedidoId: string,
    motivo?: string,
  ) {
    const p = await this.carregar(tenantId, pedidoId);
    if (p.status === 'cancelado')
      throw new BadRequestException('Pedido já cancelado.');
    // Janela: livre enquanto não entregue; até 30min após pronto se já entregue.
    if (p.status === 'entregue') {
      const base = p.prontoEm ?? p.criadoEm;
      const limite = new Date(base).getTime() + JANELA_ACAO_MIN * 60000;
      if (Date.now() > limite)
        throw new BadRequestException(
          'Fora da janela de ação (30min após conclusão).',
        );
    }
    await this.db
      .update(producaoPedido)
      .set({
        status: 'cancelado',
        canceladoEm: new Date(),
        canceladoPorId: atorId,
        obs: motivo ?? p.obs,
      })
      .where(eq(producaoPedido.id, pedidoId));
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'producao',
      acao: 'cancelou_pedido_producao',
      entidadeTipo: 'producao_pedido',
      entidadeId: pedidoId,
      detalhe: { motivo, mesa: p.mesa },
    });
    this.events?.emit('producao.evento', {
      tenantId,
      unidadeId: p.unidadeId,
      setorId: p.setorId,
      destinoEquipamentoId: p.destinoEquipamentoId,
      pedidoId,
      tipo: 'cancelado',
    });
    return { ok: true };
  }

  // Item removido de uma comanda aberta (PDV): marca o item nos pedidos de
  // produção como 'removido' e cancela o pedido se ficar sem itens. Avisa o KDS.
  async removerItemComanda(tenantId: string, comandaItemId: string) {
    const itens = await this.db
      .select({ id: producaoPedidoItem.id, pedidoId: producaoPedidoItem.pedidoId })
      .from(producaoPedidoItem)
      .where(
        and(
          eq(producaoPedidoItem.tenantId, tenantId),
          eq(producaoPedidoItem.comandaItemId, comandaItemId),
        ),
      );
    if (!itens.length) return;
    await this.db
      .update(producaoPedidoItem)
      .set({ status: 'removido' })
      .where(
        and(
          eq(producaoPedidoItem.tenantId, tenantId),
          eq(producaoPedidoItem.comandaItemId, comandaItemId),
        ),
      );
    const pedidoIds = [...new Set(itens.map((i) => i.pedidoId))];
    for (const pedidoId of pedidoIds) {
      const restam: any = await this.db.execute(sql`
        select count(*)::int as n from producao_pedido_item
        where pedido_id = ${pedidoId} and status <> 'removido'
      `);
      const n = Number((restam.rows ?? restam)[0].n);
      const [ped] = await this.db
        .select()
        .from(producaoPedido)
        .where(eq(producaoPedido.id, pedidoId));
      if (!ped) continue;
      if (n === 0 && ped.status !== 'cancelado') {
        await this.db
          .update(producaoPedido)
          .set({ status: 'cancelado', canceladoEm: new Date() })
          .where(eq(producaoPedido.id, pedidoId));
      }
      this.events?.emit('producao.evento', {
        tenantId,
        unidadeId: ped.unidadeId,
        setorId: ped.setorId,
        destinoEquipamentoId: ped.destinoEquipamentoId,
        pedidoId,
        tipo: n === 0 ? 'cancelado' : 'status',
      });
    }
  }

  // ===== Config (gerência/presidente) =====
  destinosDoProduto(tenantId: string, produtoId: string) {
    return this.db
      .select()
      .from(produtoDestinoProducao)
      .where(
        and(
          eq(produtoDestinoProducao.tenantId, tenantId),
          eq(produtoDestinoProducao.produtoId, produtoId),
        ),
      );
  }

  async setDestinosProduto(
    tenantId: string,
    produtoId: string,
    equipamentoIds: string[],
  ) {
    await this.db
      .delete(produtoDestinoProducao)
      .where(
        and(
          eq(produtoDestinoProducao.tenantId, tenantId),
          eq(produtoDestinoProducao.produtoId, produtoId),
        ),
      );
    if (equipamentoIds?.length) {
      await this.validarEquipamentos(tenantId, equipamentoIds);
      await this.db.insert(produtoDestinoProducao).values(
        equipamentoIds.map((equipamentoId) => ({
          tenantId,
          produtoId,
          equipamentoId,
        })),
      );
    }
    return this.destinosDoProduto(tenantId, produtoId);
  }

  destinosDoSetor(tenantId: string, setorId: string) {
    return this.db
      .select()
      .from(setorDestinoProducao)
      .where(
        and(
          eq(setorDestinoProducao.tenantId, tenantId),
          eq(setorDestinoProducao.setorId, setorId),
        ),
      );
  }

  async setDestinosSetor(
    tenantId: string,
    setorId: string,
    equipamentoIds: string[],
  ) {
    await this.db
      .delete(setorDestinoProducao)
      .where(
        and(
          eq(setorDestinoProducao.tenantId, tenantId),
          eq(setorDestinoProducao.setorId, setorId),
        ),
      );
    if (equipamentoIds?.length) {
      await this.validarEquipamentos(tenantId, equipamentoIds);
      await this.db.insert(setorDestinoProducao).values(
        equipamentoIds.map((equipamentoId) => ({
          tenantId,
          setorId,
          equipamentoId,
        })),
      );
    }
    return this.destinosDoSetor(tenantId, setorId);
  }

  // Segurança: equipamentos precisam ser do tenant (evita vincular device de outro).
  private async validarEquipamentos(tenantId: string, ids: string[]) {
    const rows = await this.db
      .select({ id: equipamento.id })
      .from(equipamento)
      .where(
        and(eq(equipamento.tenantId, tenantId), inArray(equipamento.id, ids)),
      );
    if (rows.length !== new Set(ids).size)
      throw new ForbiddenException('Equipamento inválido para este tenant.');
  }

  async getCores(tenantId: string, unidadeId?: string | null) {
    const [row] = await this.db
      .select()
      .from(kdsCorConfig)
      .where(
        and(
          eq(kdsCorConfig.tenantId, tenantId),
          unidadeId
            ? eq(kdsCorConfig.unidadeId, unidadeId)
            : sql`unidade_id is null`,
        ),
      );
    return {
      verdeAteMin: row?.verdeAteMin ?? 5,
      amareloAteMin: row?.amareloAteMin ?? 10,
      usaPreparo: row?.usaPreparo ?? true,
      usaEntregue: row?.usaEntregue ?? true,
    };
  }

  async setCores(
    tenantId: string,
    unidadeId: string | null,
    dto: {
      verdeAteMin?: number;
      amareloAteMin?: number;
      usaPreparo?: boolean;
      usaEntregue?: boolean;
    },
  ) {
    const atual = await this.getCores(tenantId, unidadeId);
    const [row] = await this.db
      .select({ id: kdsCorConfig.id })
      .from(kdsCorConfig)
      .where(
        and(
          eq(kdsCorConfig.tenantId, tenantId),
          unidadeId
            ? eq(kdsCorConfig.unidadeId, unidadeId)
            : sql`unidade_id is null`,
        ),
      );
    const vals = {
      verdeAteMin: dto.verdeAteMin != null ? Number(dto.verdeAteMin) : atual.verdeAteMin,
      amareloAteMin:
        dto.amareloAteMin != null ? Number(dto.amareloAteMin) : atual.amareloAteMin,
      usaPreparo: dto.usaPreparo != null ? !!dto.usaPreparo : atual.usaPreparo,
      usaEntregue: dto.usaEntregue != null ? !!dto.usaEntregue : atual.usaEntregue,
    };
    if (row) {
      await this.db
        .update(kdsCorConfig)
        .set({ ...vals, updatedAt: new Date() })
        .where(eq(kdsCorConfig.id, row.id));
    } else {
      await this.db
        .insert(kdsCorConfig)
        .values({ tenantId, unidadeId, ...vals });
    }
    return vals;
  }
}
