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
import {
  equipamento,
  produtoDestinoProducao,
  setorDestinoProducao,
  complementoDestinoProducao,
  opcaoDestinoProducao,
  complementoOpcao,
  complementoGrupo,
  complemento,
  producaoPedido,
  producaoPedidoItem,
  impressaoJob,
  kdsCorConfig,
  senhaContador,
  setor,
  comanda,
  deliveryConfig,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { perfilEfetivo } from '../delivery/cupom-perfis';
import { edgeAtivo } from '../../common/edge-ativo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Item pronto para roteamento (montado pela venda a partir da comanda).
export interface ItemProducao {
  produto: any; // linha de produto (precisa: id, vaiParaProducao, setorProducaoId, tempoPreparoMin)
  descricao: string;
  quantidade: number;
  complementosTexto?: string | null;
  observacao?: string | null;
  comandaItemId?: string | null;
  opcaoIds?: string[]; // opções/complementos escolhidos (roteamento por opção/etapa — mig 127/Fase 1)
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
    // (3b) impressora ÚNICA da loja vira destino automático: se a loja só tem uma
    // impressora ativa e nada foi definido, não faz sentido exigir configuração.
    const impressoras = await tx
      .select({
        equipamentoId: equipamento.id,
        tipo: equipamento.tipo,
        setorId: equipamento.setorId,
      })
      .from(equipamento)
      .where(
        and(
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.tipo, 'impressora'),
          eq(equipamento.ativo, true),
        ),
      );
    if (impressoras.length === 1) return impressoras.map(this.normalizaDestino);
    // (4) genérico
    return [{ equipamentoId: null, tipo: 'kds', setorId: null }];
  }

  // Destinos PRÓPRIOS das opções/complementos escolhidos num item (mig 127). A
  // partir dos `opcaoIds` resolve DOIS níveis, de forma ADITIVA e deduplicada:
  //   (1) destino da OPÇÃO (opcao_destino_producao.opcaoId = complemento_opcao.id);
  //   (2) destino da ETAPA/complemento reutilizável — opção → grupo →
  //       origem_complemento_id → complemento_destino_producao.complementoId.
  // Vazio = o item herda o roteamento do produto (comportamento atual). NÃO remove
  // o destino do produto: os destinos daqui SOMAM (a cozinha do produto continua,
  // e a impressora específica da opção/etapa também recebe). Roda na tx da venda.
  private async destinosPorOpcoes(
    tx: any,
    tenantId: string,
    opcaoIds: string[] | undefined,
  ): Promise<Destino[]> {
    const ids = [...new Set((opcaoIds ?? []).filter(Boolean))];
    if (!ids.length) return [];
    const out: Destino[] = [];
    const seen = new Set<string>();
    const push = (rows: any[]) => {
      for (const d of rows.map(this.normalizaDestino)) {
        const k = `${d.equipamentoId}|${d.tipo}`;
        if (d.equipamentoId && !seen.has(k)) {
          seen.add(k);
          out.push(d);
        }
      }
    };
    // (1) destino da OPÇÃO escolhida. Atenção: opcao_destino_producao.opcao_id
    // referencia a OPÇÃO REUTILIZÁVEL do catálogo (`opcao.id`), não a
    // complemento_opcao materializada — ligam por complemento_opcao.origem_opcao_id.
    push(
      await tx
        .select({ equipamentoId: equipamento.id, tipo: equipamento.tipo, setorId: equipamento.setorId })
        .from(complementoOpcao)
        .innerJoin(opcaoDestinoProducao, eq(opcaoDestinoProducao.opcaoId, complementoOpcao.origemOpcaoId))
        .innerJoin(equipamento, eq(equipamento.id, opcaoDestinoProducao.equipamentoId))
        .where(
          and(
            eq(complementoOpcao.tenantId, tenantId),
            inArray(complementoOpcao.id, ids),
            eq(equipamento.ativo, true),
          ),
        ),
    );
    // (2) destino da ETAPA/complemento reutilizável (via grupo → origem_complemento_id)
    push(
      await tx
        .select({ equipamentoId: equipamento.id, tipo: equipamento.tipo, setorId: equipamento.setorId })
        .from(complementoOpcao)
        .innerJoin(complementoGrupo, eq(complementoGrupo.id, complementoOpcao.grupoId))
        .innerJoin(
          complementoDestinoProducao,
          eq(complementoDestinoProducao.complementoId, complementoGrupo.origemComplementoId),
        )
        .innerJoin(equipamento, eq(equipamento.id, complementoDestinoProducao.equipamentoId))
        .where(
          and(
            eq(complementoOpcao.tenantId, tenantId),
            inArray(complementoOpcao.id, ids),
            eq(equipamento.ativo, true),
          ),
        ),
    );
    return out;
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
      plataforma?: string | null;
      senhaPlataforma?: string | null;
      setorId?: string | null; // setor do card (ex.: setor do delivery)
      emitidoDe?: string | null; // ponto de salão que emitiu (cabeçalho cozinha, mig 133)
    },
    itens: ItemProducao[],
  ): Promise<any[]> {
    const daProducao = itens.filter((it) => it.produto?.vaiParaProducao);
    if (!daProducao.length) return [];

    // Regra: 1 pedido de produção por venda (senha ÚNICA) — todos os itens de
    // produção num único card de KDS, sem quebrar por setor. As impressoras
    // configuradas continuam recebendo suas vias de produção.
    // Impressoras de PRODUÇÃO ativas da unidade — para roteamento por
    // `setores_atendidos` (upgrade) e para a impressora PADRÃO (fallback). NÃO
    // remove o roteamento por produto/setor (`resolverDestinos`), só o complementa.
    const printers: any[] = await tx
      .select({
        id: equipamento.id,
        setoresAtendidos: equipamento.setoresAtendidos,
        padrao: equipamento.padrao,
      })
      .from(equipamento)
      .where(
        and(
          eq(equipamento.tenantId, ctx.tenantId),
          eq(equipamento.tipo, 'impressora'),
          eq(equipamento.ativo, true),
          eq(equipamento.fazProducao, true), // mig 167 (antes: papel null|'producao')
          ctx.unidadeId ? eq(equipamento.unidadeId, ctx.unidadeId) : sql`true`,
        ),
      );
    const padraoId: string | null = printers.find((p) => p.padrao)?.id ?? null;

    const impressoras = new Map<string, Set<ItemProducao>>();
    const addImp = (eqId: string, it: ItemProducao) => {
      const s = impressoras.get(eqId) ?? new Set<ItemProducao>();
      s.add(it);
      impressoras.set(eqId, s);
    };
    for (const it of daProducao) {
      let roteado = false;
      // (a) destinos explícitos do produto/setor → equipamento (como já existia)
      const destinos = await this.resolverDestinos(tx, ctx.tenantId, it.produto);
      for (const d of destinos) {
        if (d.tipo === 'impressora' && d.equipamentoId) {
          addImp(d.equipamentoId, it);
          roteado = true;
        }
      }
      // (a2) destinos próprios das OPÇÕES/COMPLEMENTOS escolhidos (mig 127/Fase 1):
      // impressora específica de uma opção/etapa SOMA ao destino do produto — assim
      // um adicional direcionado (ex.: bebida → bar) também recebe a via.
      const destinosOpcoes = await this.destinosPorOpcoes(tx, ctx.tenantId, it.opcaoIds);
      for (const d of destinosOpcoes) {
        if (d.tipo === 'impressora' && d.equipamentoId) {
          addImp(d.equipamentoId, it);
          roteado = true;
        }
      }
      // (b) impressoras que atendem o setor do produto (setores_atendidos)
      const setor = it.produto?.setorProducaoId;
      if (setor) {
        for (const pr of printers) {
          const sa = Array.isArray(pr.setoresAtendidos) ? pr.setoresAtendidos : [];
          if (sa.includes(setor)) {
            addImp(pr.id, it);
            roteado = true;
          }
        }
      }
      // (c) fallback: item SEM setor e sem impressora → impressora PADRÃO da
      // unidade. Item com setor que só vai pra KDS continua sem imprimir (não
      // forçamos na padrão para não gerar via indevida).
      if (!roteado && !setor && padraoId) addImp(padraoId, it);
    }

    const numero = await this.proximoNumero(tx, ctx.tenantId, ctx.unidadeId);
    const tempo = daProducao.reduce(
      (mx, it) => Math.max(mx, Number(it.produto?.tempoPreparoMin) || 0),
      0,
    );
    const [ped] = await tx
      .insert(producaoPedido)
      .values({
        tenantId: ctx.tenantId,
        unidadeId: ctx.unidadeId ?? null,
        comandaId: ctx.comandaId,
        destinoEquipamentoId: null,
        destinoTipo: 'kds',
        setorId: ctx.setorId ?? null,
        numero,
        senha: ctx.senha ?? null,
        origem: ctx.origem,
        plataforma: ctx.plataforma ?? null,
        senhaPlataforma: ctx.senhaPlataforma ?? null,
        mesa: ctx.mesa ?? null,
        status: 'recebido',
        tempoPreparoMin: tempo || null,
      })
      .returning();
    for (const it of daProducao) {
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
    // Config de cupom da loja: perfil de produção (Fase 3b) + política de adiar (Fase 6).
    const cfgCupom = await this.carregarConfigCupom(tx, ctx.tenantId, ctx.unidadeId ?? null);
    const idProd = ctx.origem === 'delivery' ? 'producao_delivery' : 'producao_balcao';
    const ppProd = cfgCupom.override[idProd]
      ? { perfil: perfilEfetivo(idProd, cfgCupom.override[idProd]), cabecalho: cfgCupom.cabecalho, rodape: cfgCupom.rodape }
      : null;
    // Fase 6 — adiar a via de produção até o KDS? Só adia se houver KDS "armado"
    // (imprime_ao_avancar) ativo na unidade — senão imprime no registro (não perde o ticket).
    let emitirProducaoAgora = true;
    if (cfgCupom.adiarProducao) {
      const armados = await tx
        .select({ id: equipamento.id })
        .from(equipamento)
        .where(
          and(
            eq(equipamento.tenantId, ctx.tenantId),
            eq(equipamento.tipo, 'kds'),
            eq(equipamento.ativo, true),
            eq(equipamento.imprimeAoAvancar, true),
            ctx.unidadeId
              ? or(eq(equipamento.unidadeId, ctx.unidadeId), isNull(equipamento.unidadeId))!
              : sql`true`,
          ),
        )
        .limit(1);
      if (armados.length) emitirProducaoAgora = false;
    }
    // Vias de produção por impressora (uma por equipamento), quando houver.
    if (emitirProducaoAgora) {
      for (const [equipamentoId, its] of impressoras) {
        await tx.insert(impressaoJob).values({
          tenantId: ctx.tenantId,
          unidadeId: ctx.unidadeId ?? null,
          equipamentoId,
          pedidoId: ped.id,
          via: 'producao',
          conteudo: this.renderTicket(ctx, Array.from(its), numero, ppProd),
        });
      }
    }

    // Fase 5 — ETIQUETA de produto personalizado: quando o item tem opção de uma
    // etapa marcada "gera etiqueta" (imprime_etiqueta), sai uma etiqueta extra
    // (senha/nº + item + complemento/obs) para colar no produto. Roteada pela
    // impressora da etapa (mig 127/Fase 1); sem destino próprio, cai nas impressoras
    // de produção do item; por último, na padrão.
    for (const it of daProducao) {
      if (!it.opcaoIds?.length) continue;
      const flagged = await tx
        .select({ id: complementoOpcao.id })
        .from(complementoOpcao)
        .innerJoin(complementoGrupo, eq(complementoGrupo.id, complementoOpcao.grupoId))
        .innerJoin(complemento, eq(complemento.id, complementoGrupo.origemComplementoId))
        .where(
          and(
            eq(complementoOpcao.tenantId, ctx.tenantId),
            inArray(complementoOpcao.id, it.opcaoIds),
            eq(complemento.imprimeEtiqueta, true),
          ),
        );
      if (!flagged.length) continue;
      let alvos = (await this.destinosPorOpcoes(tx, ctx.tenantId, flagged.map((f) => f.id)))
        .filter((d) => d.tipo === 'impressora' && d.equipamentoId)
        .map((d) => d.equipamentoId as string);
      if (!alvos.length)
        alvos = [...impressoras.entries()].filter(([, s]) => s.has(it)).map(([eqId]) => eqId);
      if (!alvos.length && padraoId) alvos = [padraoId];
      if (!alvos.length) continue;
      const conteudo = this.renderEtiquetaItem(ctx, it, numero);
      for (const eqId of [...new Set(alvos)]) {
        await tx.insert(impressaoJob).values({
          tenantId: ctx.tenantId,
          unidadeId: ctx.unidadeId ?? null,
          equipamentoId: eqId,
          pedidoId: ped.id,
          via: 'etiqueta',
          conteudo,
        });
      }
    }
    return [
      {
        tenantId: ctx.tenantId,
        unidadeId: ctx.unidadeId ?? null,
        setorId: ctx.setorId ?? null,
        destinoEquipamentoId: null,
        destinoTipo: 'kds',
        pedidoId: ped.id,
        tipo: 'novo',
      },
    ];
  }

  // VIA DE PRODUÇÃO (cozinha) — sem valores; senha e observações/adicionais em
  // destaque. O worker do edge converte para ESC/POS.
  // Config de cupom da loja (override dos perfis + cabeçalho/rodapé do layout).
  private async carregarConfigCupom(
    db: any,
    tenantId: string,
    unidadeId: string | null,
  ): Promise<{ override: Record<string, any>; cabecalho?: string; rodape?: string; adiarProducao: boolean }> {
    const rows = await db
      .select({
        unidadeId: deliveryConfig.unidadeId,
        cupomPerfis: deliveryConfig.cupomPerfis,
        cupomLayout: deliveryConfig.cupomLayout,
        adiar: deliveryConfig.adiarProducaoAteKds,
      })
      .from(deliveryConfig)
      .where(
        and(
          eq(deliveryConfig.tenantId, tenantId),
          unidadeId
            ? or(eq(deliveryConfig.unidadeId, unidadeId), isNull(deliveryConfig.unidadeId))
            : isNull(deliveryConfig.unidadeId),
        ),
      );
    const cfg = rows.find((r: any) => r.unidadeId === unidadeId) ?? rows.find((r: any) => r.unidadeId == null);
    const layout = (cfg?.cupomLayout as any) ?? {};
    return {
      override: ((cfg?.cupomPerfis as any) ?? {}) as Record<string, any>,
      cabecalho: typeof layout.cabecalho === 'string' ? layout.cabecalho : undefined,
      rodape: typeof layout.rodape === 'string' ? layout.rodape : undefined,
      adiarProducao: !!cfg?.adiar,
    };
  }

  // Perfil de produção EFETIVO (Fase 3b). Gated por OVERRIDE: só devolve perfil
  // quando a loja customizou `producao_balcao`/`producao_delivery` — senão null, e
  // a via de produção mantém o layout legado (zero impacto em produção).
  private async carregarPerfilProducao(
    db: any,
    tenantId: string,
    unidadeId: string | null,
    origem?: string | null,
  ): Promise<{ perfil: any; cabecalho?: string; rodape?: string } | null> {
    const id = origem === 'delivery' ? 'producao_delivery' : 'producao_balcao';
    const cfg = await this.carregarConfigCupom(db, tenantId, unidadeId);
    if (!cfg.override[id]) return null; // não customizado → mantém o legado
    return { perfil: perfilEfetivo(id, cfg.override[id]), cabecalho: cfg.cabecalho, rodape: cfg.rodape };
  }

  // Cupom de operação de CAIXA (sangria/suprimento/fechamento) — Fase 3. Renderiza
  // pelo perfil da loja (padrão se não customizado) e enfileira na impressora de
  // cupom do terminal. Best-effort: quem chama trata falha sem quebrar a operação.
  async imprimirCupomCaixa(
    tenantId: string,
    unidadeId: string | null,
    terminalId: string | null,
    perfilId: 'sangria' | 'suprimento' | 'fechamento',
    dados: any,
  ): Promise<{ enfileirados: number; aviso: string | null }> {
    const cfg = await this.carregarConfigCupom(this.db, tenantId, unidadeId);
    const perfil = perfilEfetivo(perfilId, cfg.override[perfilId]);
    // O nome da loja sai pelo campo `nomeLoja` do perfil (não repetir no cabeçalho).
    const conteudo = this.renderCupomPerfil(perfil, { nomeLoja: cfg.cabecalho, ...dados }, undefined, cfg.rodape);
    return this.enfileirarViaCliente(tenantId, unidadeId, null, conteudo, terminalId, null, 'caixa');
  }

  private renderTicket(
    ctx: any,
    its: any[],
    numero?: number | null,
    pp?: { perfil: any; cabecalho?: string; rodape?: string } | null,
  ): string {
    // Fase 3b — via de produção por PERFIL (quando a loja customizou). Sem valores.
    if (pp?.perfil) {
      return this.renderCupomPerfil(
        pp.perfil,
        {
          senha: ctx.senha,
          mesa: ctx.mesa,
          dataHora: new Date().toLocaleString('pt-BR'),
          ticket: numero ? `#${numero}` : undefined,
          pedidoRegem: numero || undefined,
          plataforma: ctx.plataforma
            ? `${ctx.plataforma}${ctx.senhaPlataforma ? ` #${ctx.senhaPlataforma}` : ''}`
            : undefined,
          emitidoDe: ctx.emitidoDe ?? undefined,
          itens: its,
          // Produção NÃO mostra valores (mostrarValoresItem fica desligado).
        },
        pp.cabecalho,
        pp.rodape,
      );
    }
    const linha = '--------------------------------';
    const cab = ctx.mesa ? `MESA ${ctx.mesa}` : 'BALCAO';
    const l: string[] = ['*** PRODUCAO ***'];
    if (ctx.senha) l.push(`>>> SENHA ${ctx.senha} <<<`);
    l.push(`${cab}${numero ? ` · #${numero}` : ''}`);
    // Sub-PDV salão (mig 133): cabeçalho de onde o pedido foi emitido.
    if (ctx.emitidoDe) l.push(`EMITIDO: ${ctx.emitidoDe}`);
    l.push(linha);
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
  // layout (mig 131): { cabecalho, rodape, mostrarSenha, mostrarItens,
  // mostrarComplementos, mostrarValoresItem, mostrarTotal, mostrarPagamento,
  // mostrarAtendente, mostrarData } — toggles com DEFAULT LIGADO (vazio = padrão).
  renderViaCliente(
    dados: {
      senha?: number | null;
      mesa?: string | null;
      itens: { quantidade: number; descricao: string; precoUnitario: number; complementosTexto?: string | null }[];
      total: number;
      forma?: string | null;
      atendente?: string | null;
    },
    layout?: any,
    perfilCaixa?: { campos: any[] } | null,
  ): string {
    const L = layout ?? {};
    // Fase 3 — se houver perfil (caixa), o cupom sai por perfil (ordem/alinhamento/
    // negrito). O nome da loja usa o cabeçalho configurado; o rodapé vai no fim.
    if (perfilCaixa?.campos?.length) {
      return this.renderCupomPerfil(
        perfilCaixa,
        {
          senha: dados.senha,
          itens: dados.itens,
          subtotal: dados.total,
          totalGeral: dados.total,
          pagamento: dados.forma,
          operador: dados.atendente,
          dataHora: new Date().toLocaleString('pt-BR'),
          nomeLoja: (typeof L.cabecalho === 'string' && L.cabecalho.trim()) || undefined,
          mostrarValoresItem: L.mostrarValoresItem !== false,
          fiscal: false,
        },
        undefined,
        typeof L.rodape === 'string' ? L.rodape : undefined,
      );
    }
    const on = (k: string) => L[k] !== false; // default ligado
    const linha = '--------------------------------';
    const money = (n: number) =>
      Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const cab = typeof L.cabecalho === 'string' && L.cabecalho.trim() ? L.cabecalho.trim() : 'REGEM';
    const l: string[] = [cab, 'Cupom - via do cliente'];
    if (dados.senha && on('mostrarSenha')) l.push(`>>> SENHA ${dados.senha} <<<`);
    l.push(linha);
    if (on('mostrarItens')) {
      for (const it of dados.itens) {
        const sub = Number(it.precoUnitario) * Number(it.quantidade);
        l.push(`${Number(it.quantidade)}x ${it.descricao}`);
        if (it.complementosTexto && on('mostrarComplementos')) l.push(`   ${it.complementosTexto}`);
        if (on('mostrarValoresItem')) l.push(`   ${money(sub)}`);
      }
      l.push(linha);
    }
    if (on('mostrarTotal')) l.push(`TOTAL: ${money(dados.total)}`);
    if (dados.forma && on('mostrarPagamento')) l.push(`Pagamento: ${dados.forma}`);
    if (dados.atendente && on('mostrarAtendente')) l.push(`Atendente: ${dados.atendente}`);
    if (on('mostrarData')) l.push(new Date().toLocaleString('pt-BR'));
    if (typeof L.rodape === 'string' && L.rodape.trim()) {
      l.push(linha);
      l.push(L.rodape.trim());
    }
    return l.join('\n');
  }

  // Fase 3 — render por PERFIL de cupom (caixa/entregador/produção): honra ordem,
  // visibilidade, alinhamento (@C/@R) e negrito (@B) de cada campo. Cabeçalho/rodapé
  // do cupom_layout entram centralizados. QR do entregador vira '@QR:<dados>'.
  renderCupomPerfil(
    perfil: {
      campos: {
        key: string;
        visivel: boolean;
        negrito: boolean;
        alinhamento: string;
        tamanho?: string;
        agrupado?: boolean;
      }[];
    },
    dados: any,
    cabecalho?: string,
    rodape?: string,
  ): string {
    const money = (n: any) =>
      Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const sep = '--------------------------------';
    // Texto (uma ou mais linhas) de cada campo a partir dos dados. [] = não imprime.
    const CAMPO: Record<string, () => string[]> = {
      senha: () => (dados.senha != null ? [`SENHA ${dados.senha}`] : []),
      tipoFiscal: () => [dados.fiscal ? 'CUPOM FISCAL' : 'CUPOM NAO FISCAL'],
      nomeLoja: () => (dados.nomeLoja ? [String(dados.nomeLoja)] : []),
      dataHora: () => [dados.dataHora ?? new Date().toLocaleString('pt-BR')],
      ticket: () => (dados.ticket ? [`Ticket ${dados.ticket}`] : []),
      vendaBalcao: () => ['Venda balcao'],
      operador: () => (dados.operador ? [`Operador: ${dados.operador}`] : []),
      itens: () =>
        (dados.itens ?? []).flatMap((it: any) => {
          const ls = [`${Number(it.quantidade)}x ${it.descricao}`];
          if (it.complementosTexto) ls.push(`   ${it.complementosTexto}`);
          if (it.observacao) ls.push(`   OBS: ${it.observacao}`);
          if (dados.mostrarValoresItem) ls.push(`   ${money(Number(it.precoUnitario) * Number(it.quantidade))}`);
          return ls;
        }),
      subtotal: () => (dados.subtotal != null ? [`Subtotal: ${money(dados.subtotal)}`] : []),
      desconto: () => (dados.desconto ? [`Desconto: -${money(dados.desconto)}`] : []),
      totalGeral: () => (dados.totalGeral != null ? [`TOTAL: ${money(dados.totalGeral)}`] : []),
      pagamento: () => {
        const ls: string[] = [];
        if (dados.pagamento) ls.push(`Pagamento: ${dados.pagamento}`);
        if (dados.troco) ls.push(`Troco para ${money(dados.troco)}`);
        return ls;
      },
      avisoFiscal: () => (dados.fiscal ? [] : ['Este documento nao tem valor fiscal']),
      plataforma: () => (dados.plataforma ? [String(dados.plataforma)] : []),
      pedidoRegem: () => (dados.pedidoRegem ? [`Pedido Regem ${dados.pedidoRegem}`] : []),
      // Produção (Fase 3b): mesa/balcão, origem e sub-PDV emissor.
      mesa: () => [dados.mesa ? `MESA ${dados.mesa}` : 'BALCAO'],
      emitidoDe: () => (dados.emitidoDe ? [`Emitido: ${dados.emitidoDe}`] : []),
      origemPedido: () => (dados.origemPedido ? [String(dados.origemPedido)] : []),
      cliente: () => (dados.cliente ? [String(dados.cliente)] : []),
      endereco: () => (dados.endereco ? String(dados.endereco).split('\n') : []),
      telefone: () => (dados.telefone ? [String(dados.telefone)] : []),
      taxaEntrega: () => (dados.taxaEntrega != null ? [`Entrega: ${money(dados.taxaEntrega)}`] : []),
      cobrarCliente: () => (dados.cobrarCliente != null ? [`COBRAR ${money(dados.cobrarCliente)}`] : []),
      bandeiras: () => (dados.bandeiras ? [`Bandeira: ${dados.bandeiras}`] : []),
      qrcode: () => (dados.qrData ? [`@QR:${dados.qrData}`] : []),
      // Movimentos de caixa (Fase 3 — sangria/suprimento/fechamento)
      tipoMovimento: () => (dados.tipoMovimento ? [String(dados.tipoMovimento)] : []),
      valorMovimento: () => (dados.valorMovimento != null ? [`Valor: ${money(dados.valorMovimento)}`] : []),
      motivo: () => (dados.motivo ? [`Motivo: ${dados.motivo}`] : []),
      autorizadoPor: () => (dados.autorizadoPor ? [`Autorizado: ${dados.autorizadoPor}`] : []),
      turno: () => (dados.turno != null ? [`Turno ${dados.turno}`] : []),
      terminal: () => (dados.terminal ? [`Terminal: ${dados.terminal}`] : []),
      aberturaValor: () => (dados.aberturaValor != null ? [`Abertura: ${money(dados.aberturaValor)}`] : []),
      totalPorForma: () => (Array.isArray(dados.totalPorForma) ? dados.totalPorForma : []),
      sangriasTotal: () => (dados.sangriasTotal != null ? [`Sangrias: -${money(dados.sangriasTotal)}`] : []),
      suprimentosTotal: () => (dados.suprimentosTotal != null ? [`Suprimentos: +${money(dados.suprimentosTotal)}`] : []),
      esperado: () => (dados.esperado != null ? [`Esperado: ${money(dados.esperado)}`] : []),
      informado: () => (dados.informado != null ? [`Informado: ${money(dados.informado)}`] : []),
      diferenca: () => (dados.diferenca != null ? [`Diferenca: ${money(dados.diferenca)}`] : []),
      assinatura: () => ['', '______________________', 'Assinatura'],
    };
    const out: string[] = [];
    if (cabecalho && String(cabecalho).trim()) out.push(`@C ${String(cabecalho).trim()}`);
    // Fase 4 — pseudo-campos de layout (_espaco/_tracejado), fonte grande (@D) e
    // agrupar dois campos na mesma linha (esq | dir, via token @LR).
    let prev: { idx: number; text: string } | null = null;
    for (const c of perfil.campos) {
      if (!c.visivel) continue;
      let linhas: string[];
      if (c.key === '_espaco') linhas = [''];
      else if (c.key === '_tracejado') linhas = [sep];
      else {
        linhas = CAMPO[c.key]?.() ?? [];
        if (!linhas.length) continue;
      }
      const simples = linhas.length === 1 && !linhas[0].startsWith('@QR:');
      if (c.agrupado && prev && simples) {
        out[prev.idx] = `@LR${prev.text}|${linhas[0]}`; // junta com a linha anterior
        prev = null;
        continue;
      }
      const flags =
        (c.alinhamento === 'centro' ? 'C' : c.alinhamento === 'direita' ? 'R' : '') +
        (c.negrito ? 'B' : '') +
        (c.tamanho === 'grande' ? 'D' : '');
      if (c.key === 'itens') out.push(sep);
      for (const t of linhas) {
        if (t.startsWith('@QR:')) out.push(t); // QR: linha própria (o escpos centraliza)
        else out.push(flags ? `@${flags} ${t}` : t);
      }
      if (c.key === 'itens') out.push(sep);
      prev = simples && c.key !== 'itens' ? { idx: out.length - 1, text: linhas[0] } : null;
    }
    if (rodape && String(rodape).trim()) {
      out.push(sep);
      out.push(`@C ${String(rodape).trim()}`);
    }
    return out.join('\n');
  }

  // ETIQUETA de produto personalizado (Fase 5) — sai numa impressora térmica de
  // bobina (não é a etiquetadora de estoque): senha/nº + item + complemento/obs,
  // para colar no produto. Usa os tokens legados (*** *** / >>> <<<) que o escpos
  // já destaca (centralizado, negrito, fonte dupla).
  private renderEtiquetaItem(ctx: any, it: any, numero?: number | null): string {
    const l: string[] = ['*** COLAR NO PRODUTO ***'];
    if (ctx.senha) l.push(`>>> SENHA ${ctx.senha} <<<`);
    else if (numero) l.push(`>>> #${numero} <<<`);
    l.push(`${Number(it.quantidade)}x ${it.descricao}`);
    if (it.complementosTexto) l.push(String(it.complementosTexto));
    if (it.observacao) l.push(`OBS: ${it.observacao}`);
    return l.join('\n');
  }

  // Uma impressora só tem "alvo" imprimível se: rede → tem IP (host); local → tem
  // nome no Windows (dispositivo). Sem isso, o job nasceria fadado ao erro.
  private alvoValido(p: { conexao?: string | null; host?: string | null; dispositivo?: string | null }) {
    return p.conexao === 'local' ? !!p.dispositivo : !!p.host;
  }

  // Enfileira a via do cliente (cupom). Prioridade:
  //  0) alvo preferido explícito (reimprimir "Imprimir em…");
  //  1) impressora amarrada ao terminal de PDV (impressora_padrao_id);
  //  2) impressoras de CUPOM (faz_cupom) da UNIDADE (ou de rede, unidade nula);
  //  3) fallback: qualquer impressora ativa com alvo válido (nunca deixa sem sair).
  // Só enfileira em impressoras com ALVO VÁLIDO — nunca cria job fadado ao erro
  // (mig 167). Devolve { enfileirados, aviso } para o front sinalizar config faltando.
  async enfileirarViaCliente(
    tenantId: string,
    unidadeId: string | null,
    comandaId: string | null,
    conteudo: string,
    terminalId?: string | null,
    alvoPreferido?: string | null,
    via: string = 'cliente',
  ): Promise<{ enfileirados: number; aviso: string | null }> {
    const cols = {
      id: equipamento.id,
      conexao: equipamento.conexao,
      host: equipamento.host,
      dispositivo: equipamento.dispositivo,
    };
    type Imp = { id: string; conexao: string | null; host: string | null; dispositivo: string | null };
    let printers: Imp[] = [];

    // (0) alvo preferido explícito (override do reimprimir).
    if (alvoPreferido) {
      const [imp] = await this.db
        .select(cols)
        .from(equipamento)
        .where(
          and(
            eq(equipamento.id, alvoPreferido),
            eq(equipamento.tenantId, tenantId),
            eq(equipamento.tipo, 'impressora'),
            eq(equipamento.ativo, true),
          ),
        );
      if (imp) printers = [imp];
    }

    // (1) impressora do terminal, se configurada e válida.
    if (!printers.length && terminalId) {
      const [term] = await this.db
        .select({ imp: equipamento.impressoraPadraoId })
        .from(equipamento)
        .where(
          and(
            eq(equipamento.id, terminalId),
            eq(equipamento.tenantId, tenantId),
            eq(equipamento.tipo, 'pdv'),
            eq(equipamento.ativo, true),
          ),
        );
      if (term?.imp) {
        const [imp] = await this.db
          .select(cols)
          .from(equipamento)
          .where(
            and(
              eq(equipamento.id, term.imp),
              eq(equipamento.tenantId, tenantId),
              eq(equipamento.tipo, 'impressora'),
              eq(equipamento.ativo, true),
            ),
          );
        if (imp) printers = [imp];
      }
    }

    // (2) impressoras de cupom (faz_cupom) da unidade (ou de rede, unidade nula).
    if (!printers.length) {
      const conds = [
        eq(equipamento.tenantId, tenantId),
        eq(equipamento.tipo, 'impressora'),
        eq(equipamento.fazCupom, true),
        eq(equipamento.ativo, true),
      ];
      if (unidadeId)
        conds.push(
          or(eq(equipamento.unidadeId, unidadeId), isNull(equipamento.unidadeId))!,
        );
      printers = await this.db.select(cols).from(equipamento).where(and(...conds));
    }

    // Só as com alvo imprimível.
    let validos = printers.filter((p) => this.alvoValido(p));
    let aviso: string | null = null;

    // (3) fallback: nenhuma cupom válida → usa a 1ª impressora ativa com alvo
    // válido (prefere local/USB). Evita "não sai nada" quando o cupom não foi
    // configurado, e avisa o gestor para arrumar depois.
    if (!validos.length) {
      const conds = [
        eq(equipamento.tenantId, tenantId),
        eq(equipamento.tipo, 'impressora'),
        eq(equipamento.ativo, true),
      ];
      if (unidadeId)
        conds.push(
          or(eq(equipamento.unidadeId, unidadeId), isNull(equipamento.unidadeId))!,
        );
      const todas: Imp[] = await this.db.select(cols).from(equipamento).where(and(...conds));
      const disponiveis = todas
        .filter((p) => this.alvoValido(p))
        .sort((a, b) => (a.conexao === 'local' ? -1 : 0) - (b.conexao === 'local' ? -1 : 0));
      if (disponiveis.length) {
        validos = [disponiveis[0]];
        aviso = 'Nenhuma impressora de cupom configurada — usei a primeira impressora disponível.';
      } else {
        return {
          enfileirados: 0,
          aviso: 'Nenhuma impressora com alvo válido — configure o IP (rede) ou o nome no Windows (local) da impressora de cupom.',
        };
      }
    }

    for (const p of validos) {
      await this.db.insert(impressaoJob).values({
        tenantId,
        unidadeId,
        equipamentoId: p.id,
        pedidoId: null,
        via,
        conteudo,
      });
    }
    return { enfileirados: validos.length, aviso };
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
        conexao: equipamento.conexao, // 'rede' | 'local' (mig 120)
        host: equipamento.host,
        porta: equipamento.porta,
        dispositivo: equipamento.dispositivo, // nome no Windows (conexao='local')
        largura: equipamento.largura,
        // Vias por tipo (mig 168): cupom do cliente vs produção; null herda `vias`.
        vias: sql<number>`case
          when ${impressaoJob.via} = 'cliente' then coalesce(${equipamento.viasCliente}, ${equipamento.vias})
          when ${impressaoJob.via} = 'producao' then coalesce(${equipamento.viasProducao}, ${equipamento.vias})
          else ${equipamento.vias} end`,
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

  // Fila recente para o painel (status + impressora). Gestor logado.
  async filaRecente(tenantId: string, limite = 40) {
    return this.db
      .select({
        id: impressaoJob.id,
        via: impressaoJob.via,
        status: impressaoJob.status,
        tentativas: impressaoJob.tentativas,
        erro: impressaoJob.erro,
        criadoEm: impressaoJob.criadoEm,
        impressoEm: impressaoJob.impressoEm,
        impressora: equipamento.nome,
      })
      .from(impressaoJob)
      .leftJoin(equipamento, eq(equipamento.id, impressaoJob.equipamentoId))
      .where(eq(impressaoJob.tenantId, tenantId))
      .orderBy(desc(impressaoJob.criadoEm))
      .limit(limite);
  }

  // Enfileira uma página de teste para a impressora (botão do painel). O worker
  // do edge converte o texto em ESC/POS e imprime — valida IP/porta/papel na hora.
  async enfileirarTeste(tenantId: string, equipamentoId: string) {
    // F10 — com edge ativo, a impressão é do servidor local; a nuvem não gera job
    // órfão. Orienta o usuário a testar pelo servidor local.
    if (await edgeAtivo(this.db, tenantId)) {
      return { ok: false, edge: true, aviso: 'Esta loja usa servidor local (edge). Faça o teste de impressão no servidor local — a nuvem não imprime direto nas impressoras da LAN.' };
    }
    const [imp] = await this.db
      .select()
      .from(equipamento)
      .where(
        and(
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.id, equipamentoId),
          eq(equipamento.tipo, 'impressora'),
        ),
      );
    if (!imp) throw new NotFoundException('Impressora não encontrada');
    const linha = '-'.repeat(Number(imp.largura) === 58 ? 32 : 48);
    const conteudo = [
      '*** TESTE REGEM ***',
      linha,
      `Impressora: ${imp.nome}`,
      `IP: ${imp.host ?? '(sem IP)'}:${imp.porta ?? 9100}`,
      `Largura: ${imp.largura ?? 80}mm`,
      new Date().toLocaleString('pt-BR'),
      linha,
      'Se leu isto, a impressora esta OK.',
    ].join('\n');
    const [job] = await this.db
      .insert(impressaoJob)
      .values({
        tenantId,
        unidadeId: imp.unidadeId ?? null,
        equipamentoId,
        pedidoId: null,
        via: 'teste',
        conteudo,
      })
      .returning();
    return { ok: true, jobId: job.id };
  }

  // Reenfileira um job com erro (gestor). `equipamentoId` opcional ("Imprimir em…")
  // reroteia o job para outra impressora com alvo válido (mig 167).
  async reimprimir(tenantId: string, jobId: string, equipamentoId?: string | null) {
    // F10 — com edge ativo, reimpressão é feita pelo servidor local (evita job órfão).
    if (await edgeAtivo(this.db, tenantId)) {
      return { ok: false, edge: true, aviso: 'Esta loja usa servidor local (edge). Reimprima pelo servidor local.' };
    }
    const set: { status: string; erro: null; equipamentoId?: string } = {
      status: 'pendente',
      erro: null,
    };
    if (equipamentoId) {
      const [imp] = await this.db
        .select({ id: equipamento.id, conexao: equipamento.conexao, host: equipamento.host, dispositivo: equipamento.dispositivo })
        .from(equipamento)
        .where(
          and(
            eq(equipamento.id, equipamentoId),
            eq(equipamento.tenantId, tenantId),
            eq(equipamento.tipo, 'impressora'),
            eq(equipamento.ativo, true),
          ),
        );
      if (!imp) throw new NotFoundException('Impressora não encontrada');
      if (!this.alvoValido(imp))
        throw new BadRequestException('Impressora sem alvo — configure o IP (rede) ou o nome no Windows (local).');
      set.equipamentoId = imp.id;
    }
    await this.db
      .update(impressaoJob)
      .set(set)
      .where(and(eq(impressaoJob.id, jobId), eq(impressaoJob.tenantId, tenantId)));
    return { ok: true };
  }

  // Nº sequencial de exibição por unidade/dia (reinicia a cada dia).
  private async proximoNumero(
    tx: any,
    tenantId: string,
    unidadeId?: string | null,
  ): Promise<number> {
    // Fase 7 — trava por (tenant, unidade) na transação: sem isto, dois PDVs/canais
    // registrando ao mesmo tempo leem o mesmo max(numero) e DUPLICAM o número do card.
    // O advisory lock serializa só esta chave; libera no fim da transação da venda.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`pnum:${tenantId}:${unidadeId ?? ''}`})::bigint)`,
    );
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

  // Fila do KDS por CANAL: 'delivery' (courier) x 'balcao' (salão/balcão + retirada
  // e consumo local vindos de plataformas). Mostra os pedidos ativos
  // (recebido/preparo/pronto) + cancelados recentes (riscados por um tempo).
  async filaKds(
    tenantId: string,
    opts: { setorId?: string; unidadeId?: string; canal?: string; equipamentoId?: string } = {},
  ) {
    const cores = await this.getCores(tenantId, opts.unidadeId);
    const conds = [
      eq(producaoPedido.tenantId, tenantId),
      eq(producaoPedido.destinoTipo, 'kds'),
    ];
    if (opts.unidadeId) conds.push(eq(producaoPedido.unidadeId, opts.unidadeId));
    // Canal: delivery (courier) | balcao (local/retirada) | todos (KDS único — mescla
    // balcão + delivery, p/ cozinhas menores).
    if (opts.canal === 'delivery') {
      conds.push(eq(producaoPedido.origem, 'delivery'));
    } else if (opts.canal === 'balcao') {
      conds.push(sql`origem <> 'delivery'` as any);
    }
    // 'todos' (ou vazio) → sem filtro de origem.
    if (opts.equipamentoId) {
      // Fase E: o KDS operado filtra pela CADEIA — cards roteados para ele (destino)
      // OU ainda não roteados (destino null) do seu setor (entrada). Ignora setorId.
      const [ekds] = await this.db
        .select({ setorId: equipamento.setorId })
        .from(equipamento)
        .where(and(eq(equipamento.id, opts.equipamentoId), eq(equipamento.tenantId, tenantId)));
      const setorKds = ekds?.setorId ?? null;
      conds.push(
        sql`(destino_equipamento_id = ${opts.equipamentoId} or (destino_equipamento_id is null ${
          setorKds ? sql`and setor_id = ${setorKds}` : sql``
        }))` as any,
      );
    } else if (opts.setorId) {
      conds.push(eq(producaoPedido.setorId, opts.setorId));
    }
    // Ativos + cancelados recentes.
    conds.push(
      sql`(status in ('recebido','preparo','pronto')
           or (status = 'cancelado'
               and coalesce(cancelado_em, criado_em) > now() - interval '${sql.raw(
                 String(JANELA_ACAO_MIN),
               )} minutes'))` as any,
    );
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
    const comItens = await this.comItens(tenantId, pedidos);
    // Enriquece p/ o painel do gestor: nome do setor + vínculo com a comanda.
    const setorIds = [...new Set(pedidos.map((p) => p.setorId).filter(Boolean))];
    const comandaIds = [...new Set(pedidos.map((p) => p.comandaId).filter(Boolean))];
    const setores = setorIds.length
      ? await this.db.select({ id: setor.id, nome: setor.nome }).from(setor).where(inArray(setor.id, setorIds as string[]))
      : [];
    const comandas = comandaIds.length
      ? await this.db
          .select({ id: comanda.id, cliente: comanda.cliente, total: comanda.total, mesa: comanda.mesa, status: comanda.status })
          .from(comanda)
          .where(inArray(comanda.id, comandaIds as string[]))
      : [];
    const sMap = new Map(setores.map((s) => [s.id, s.nome]));
    const cMap = new Map(comandas.map((c) => [c.id, c]));
    return comItens.map((p: any) => ({
      ...p,
      setorNome: p.setorId ? sMap.get(p.setorId) ?? null : null,
      comanda: p.comandaId ? cMap.get(p.comandaId) ?? null : null,
    }));
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
    equipamentoId?: string, // KDS que operou o avanço (Fase E — roteamento p/ o próximo)
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
    // Fase E — roteamento entre KDS: se o KDS que avançou tem "próximo KDS", o card
    // migra para lá (aparece na fila do próximo). Opt-in: sem proximo_kds, nada muda.
    if (equipamentoId && novo !== 'entregue') {
      const [ekds] = await this.db
        .select({ proximo: equipamento.proximoKdsId })
        .from(equipamento)
        .where(and(eq(equipamento.id, equipamentoId), eq(equipamento.tenantId, tenantId)));
      if (ekds?.proximo) patch.destinoEquipamentoId = ekds.proximo;
    }
    await this.db
      .update(producaoPedido)
      .set(patch)
      .where(eq(producaoPedido.id, pedidoId));
    // Impressão guiada por etapa (mig 129): se o KDS deste pedido está configurado
    // para imprimir ao chegar nesta etapa, o ticket sai agora (e não no PDV).
    await this.imprimirNaEtapa(tenantId, p, novo).catch(() => {});
    this.events?.emit('producao.evento', {
      tenantId,
      unidadeId: p.unidadeId,
      setorId: p.setorId,
      destinoEquipamentoId: p.destinoEquipamentoId,
      pedidoId,
      tipo: 'status',
      status: novo,
    });
    // Reflexo no Painel de delivery: quando a produção fica 'pronto', o pedido de
    // delivery ligado à mesma comanda sobe para 'pronto' no listview (ouvido no
    // DeliveryService). Idempotente lá (só se ainda estiver 'confirmado').
    if (novo === 'pronto' && p.comandaId) {
      this.events?.emit('producao.pronto', { tenantId, comandaId: p.comandaId });
    }
    return { ok: true, status: novo };
  }

  // Limpa a fila do KDS: avança TODOS os cards ativos até saírem (concluir ou migrar
  // para o próximo KDS). Faz o loop NO SERVIDOR (uma requisição só) — o KDS não dispara
  // um POST por card (o que estourava o rate-limit com 429).
  async limparFila(
    tenantId: string,
    atorId: string,
    opts: { setorId?: string; unidadeId?: string; canal?: string; equipamentoId?: string } = {},
  ) {
    const { pedidos } = await this.filaKds(tenantId, opts);
    let avancados = 0;
    for (const p of pedidos as any[]) {
      if (p.status === 'cancelado' || p.status === 'entregue') continue;
      // Avança até o card sair desta fila (entregue/cancelado, ou roteado p/ outro KDS).
      for (let i = 0; i < 6; i++) {
        try {
          await this.avancar(tenantId, atorId, p.id, 'entrega', opts.equipamentoId);
          avancados++;
        } catch {
          break; // já concluído ou não avança mais
        }
        const [atual] = await this.db
          .select({ status: producaoPedido.status, destino: producaoPedido.destinoEquipamentoId })
          .from(producaoPedido)
          .where(eq(producaoPedido.id, p.id));
        if (!atual || atual.status === 'entregue' || atual.status === 'cancelado') break;
        // Roteou para outro KDS (destino diferente do KDS operado) → saiu desta fila.
        if (opts.equipamentoId && atual.destino && atual.destino !== opts.equipamentoId) break;
      }
    }
    return { ok: true, avancados };
  }

  // Enfileira o ticket quando o pedido AVANÇA para a etapa configurada no KDS.
  // O KDS pode ser o destino explícito do pedido ou, no legado (sem equipamento),
  // qualquer KDS ativo do mesmo setor com a regra ligada.
  private async imprimirNaEtapa(tenantId: string, p: any, novoStatus: string) {
    const cond = [
      eq(equipamento.tenantId, tenantId),
      eq(equipamento.tipo, 'kds'),
      eq(equipamento.ativo, true),
      eq(equipamento.imprimeAoAvancar, true),
      eq(equipamento.imprimeNoStatus, novoStatus),
    ];
    if (p.destinoEquipamentoId) cond.push(eq(equipamento.id, p.destinoEquipamentoId));
    else if (p.setorId) cond.push(eq(equipamento.setorId, p.setorId));
    else return; // sem como identificar o KDS de origem
    const kdss = await this.db
      .select({ id: equipamento.id, impressoraDestinoId: equipamento.impressoraDestinoId })
      .from(equipamento)
      .where(and(...cond));
    if (!kdss.length) return;

    const itens = await this.db
      .select()
      .from(producaoPedidoItem)
      .where(eq(producaoPedidoItem.pedidoId, p.id));
    const ctx: any = {
      tenantId,
      unidadeId: p.unidadeId,
      comandaId: p.comandaId,
      setorId: p.setorId,
      senha: p.senha,
      origem: p.origem,
      plataforma: p.plataforma,
      senhaPlataforma: p.senhaPlataforma,
      mesa: p.mesa,
    };
    const ppEtapa = await this.carregarPerfilProducao(this.db, tenantId, p.unidadeId, p.origem);
    const conteudo = this.renderTicket(
      ctx,
      itens.map((i) => ({
        descricao: i.descricao,
        quantidade: Number(i.quantidade),
        complementosTexto: i.complementosTexto ?? undefined,
        observacao: i.observacao ?? undefined,
      })),
      p.numero ?? 0,
      ppEtapa,
    );
    for (const k of kdss) {
      // Sem impressora explícita, cai na padrão do setor do pedido.
      let alvo = k.impressoraDestinoId;
      if (!alvo && p.setorId) {
        const [padrao] = await this.db
          .select({ id: equipamento.id })
          .from(equipamento)
          .where(
            and(
              eq(equipamento.tenantId, tenantId),
              eq(equipamento.tipo, 'impressora'),
              eq(equipamento.ativo, true),
              eq(equipamento.setorId, p.setorId),
            ),
          )
          .limit(1);
        alvo = padrao?.id ?? null;
      }
      if (!alvo) continue;
      await this.db.insert(impressaoJob).values({
        tenantId,
        unidadeId: p.unidadeId ?? null,
        equipamentoId: alvo,
        pedidoId: p.id,
        via: 'producao',
        conteudo,
      });
    }
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

  // Cancela TODOS os pedidos de produção de uma comanda (ao cancelar o cupom):
  // marca 'cancelado' e avisa o KDS por cada destino.
  async cancelarPorComanda(
    tenantId: string,
    atorId: string,
    comandaId: string,
    motivo?: string,
  ) {
    const pedidos = await this.db
      .select()
      .from(producaoPedido)
      .where(
        and(
          eq(producaoPedido.tenantId, tenantId),
          eq(producaoPedido.comandaId, comandaId),
        ),
      );
    for (const p of pedidos) {
      if (p.status === 'cancelado') continue;
      await this.db
        .update(producaoPedido)
        .set({
          status: 'cancelado',
          canceladoEm: new Date(),
          canceladoPorId: atorId,
          obs: motivo ?? p.obs,
        })
        .where(eq(producaoPedido.id, p.id));
      this.events?.emit('producao.evento', {
        tenantId,
        unidadeId: p.unidadeId,
        setorId: p.setorId,
        destinoEquipamentoId: p.destinoEquipamentoId,
        pedidoId: p.id,
        tipo: 'cancelado',
      });
    }
    return { cancelados: pedidos.filter((p) => p.status !== 'cancelado').length };
  }

  // Marca os pedidos ativos de uma comanda como "ALTERADO" e avisa o KDS
  // (usado quando o delivery tem os itens alterados após já estar na produção).
  async marcarAlteradoPorComanda(tenantId: string, comandaId: string) {
    const pedidos = await this.db
      .select()
      .from(producaoPedido)
      .where(
        and(
          eq(producaoPedido.tenantId, tenantId),
          eq(producaoPedido.comandaId, comandaId),
        ),
      );
    for (const p of pedidos) {
      if (['cancelado', 'entregue'].includes(p.status)) continue;
      await this.db
        .update(producaoPedido)
        .set({ obs: 'ALTERADO' })
        .where(eq(producaoPedido.id, p.id));
      this.events?.emit('producao.evento', {
        tenantId,
        unidadeId: p.unidadeId,
        setorId: p.setorId,
        destinoEquipamentoId: p.destinoEquipamentoId,
        pedidoId: p.id,
        tipo: 'atualizado',
      });
    }
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
