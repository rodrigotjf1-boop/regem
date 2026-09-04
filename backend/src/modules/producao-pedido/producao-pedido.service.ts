import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
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
  comandaItem,
  comandaItemComplemento,
  produto,
  deliveryConfig,
} from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { perfilEfetivo } from '../delivery/cupom-perfis';
import { edgeAtivo } from '../../common/edge-ativo';

/* eslint-disable @typescript-eslint/no-explicit-any */

const logImpressao = new Logger('Impressao'); // P4 — logs do expurgo da fila

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
          comandaId: ctx.comandaId, // liga à venda (idempotência do materializador do edge)
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
          comandaId: ctx.comandaId, // liga à venda (idempotência do materializador do edge)
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

  // ===== S3b — Materializa as VIAS DE PRODUÇÃO no EDGE =====
  // Uma venda registrada no MODO NUVEM desce com o `producao_pedido` (KDS), mas as
  // vias de produção (cozinha/setores) não saem: as impressoras são LOCAIS do edge.
  // Aqui, no edge, reconstruímos os itens de produção a partir da comanda que desceu
  // e enfileiramos as vias na(s) impressora(s) local(is) — ESPELHANDO o roteamento de
  // `criarPedidos` (mantê-los em sincronia). O pedido de produção NÃO é recriado (já
  // desceu). O job leva `comandaId` → o processador do edge não reprocessa.
  async materializarProducaoLocal(tenantId: string, comandaId: string): Promise<number> {
    const [ped] = await this.db
      .select()
      .from(producaoPedido)
      .where(and(eq(producaoPedido.comandaId, comandaId), eq(producaoPedido.tenantId, tenantId)))
      .limit(1);
    if (!ped) return 0;

    // Reconstrói os ItemProducao a partir da comanda (produto + complementos que desceram).
    const cis = await this.db
      .select()
      .from(comandaItem)
      .where(eq(comandaItem.comandaId, comandaId));
    const daProducao: ItemProducao[] = [];
    for (const ci of cis) {
      if (!ci.produtoId) continue;
      const [p] = await this.db
        .select()
        .from(produto)
        .where(and(eq(produto.id, ci.produtoId), eq(produto.tenantId, tenantId)));
      if (!p || !p.vaiParaProducao) continue;
      const comps = await this.db
        .select({
          opcaoId: comandaItemComplemento.opcaoId,
          tipo: comandaItemComplemento.tipo,
          nome: comandaItemComplemento.nome,
        })
        .from(comandaItemComplemento)
        .where(eq(comandaItemComplemento.comandaItemId, ci.id));
      const compTexto =
        comps.map((s) => `${s.tipo === 'remover' ? 'sem' : '+'} ${s.nome}`).join(' · ') || null;
      daProducao.push({
        produto: p,
        descricao: ci.descricao,
        quantidade: Number(ci.quantidade),
        complementosTexto: compTexto,
        observacao: ci.observacao,
        comandaItemId: ci.id,
        opcaoIds: comps.map((s) => s.opcaoId).filter(Boolean) as string[],
      });
    }
    if (!daProducao.length) return 0;

    const ctx: any = {
      tenantId,
      unidadeId: ped.unidadeId ?? null,
      comandaId,
      origem: ped.origem,
      mesa: ped.mesa ?? null,
      senha: ped.senha ?? null,
      plataforma: ped.plataforma ?? null,
      senhaPlataforma: ped.senhaPlataforma ?? null,
      setorId: ped.setorId ?? null,
    };
    const numero = ped.numero ?? null;
    const db = this.db;

    // Impressoras de PRODUÇÃO locais + roteamento (idêntico a criarPedidos).
    const printers: any[] = await db
      .select({
        id: equipamento.id,
        setoresAtendidos: equipamento.setoresAtendidos,
        padrao: equipamento.padrao,
      })
      .from(equipamento)
      .where(
        and(
          eq(equipamento.tenantId, tenantId),
          eq(equipamento.tipo, 'impressora'),
          eq(equipamento.ativo, true),
          eq(equipamento.fazProducao, true),
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
      const destinos = await this.resolverDestinos(db, tenantId, it.produto);
      for (const d of destinos)
        if (d.tipo === 'impressora' && d.equipamentoId) {
          addImp(d.equipamentoId, it);
          roteado = true;
        }
      const destinosOpcoes = await this.destinosPorOpcoes(db, tenantId, it.opcaoIds);
      for (const d of destinosOpcoes)
        if (d.tipo === 'impressora' && d.equipamentoId) {
          addImp(d.equipamentoId, it);
          roteado = true;
        }
      const setorP = it.produto?.setorProducaoId;
      if (setorP)
        for (const pr of printers) {
          const sa = Array.isArray(pr.setoresAtendidos) ? pr.setoresAtendidos : [];
          if (sa.includes(setorP)) {
            addImp(pr.id, it);
            roteado = true;
          }
        }
      if (!roteado && !setorP && padraoId) addImp(padraoId, it);
    }

    const cfgCupom = await this.carregarConfigCupom(db, tenantId, ctx.unidadeId ?? null);
    const idProd = ctx.origem === 'delivery' ? 'producao_delivery' : 'producao_balcao';
    const ppProd = cfgCupom.override[idProd]
      ? { perfil: perfilEfetivo(idProd, cfgCupom.override[idProd]), cabecalho: cfgCupom.cabecalho, rodape: cfgCupom.rodape }
      : null;
    // Adiar até o KDS? Só se houver KDS armado (imprime_ao_avancar) — igual a criarPedidos.
    let emitirProducaoAgora = true;
    if (cfgCupom.adiarProducao) {
      const armados = await db
        .select({ id: equipamento.id })
        .from(equipamento)
        .where(
          and(
            eq(equipamento.tenantId, tenantId),
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

    let enfileirados = 0;
    if (emitirProducaoAgora) {
      for (const [equipamentoId, its] of impressoras) {
        await db.insert(impressaoJob).values({
          tenantId,
          unidadeId: ctx.unidadeId ?? null,
          equipamentoId,
          pedidoId: ped.id,
          comandaId,
          via: 'producao',
          conteudo: this.renderTicket(ctx, Array.from(its), numero, ppProd),
        });
        enfileirados++;
      }
    }

    // Etiquetas de produto personalizado (mesma regra da venda local).
    for (const it of daProducao) {
      if (!it.opcaoIds?.length) continue;
      const flagged = await db
        .select({ id: complementoOpcao.id })
        .from(complementoOpcao)
        .innerJoin(complementoGrupo, eq(complementoGrupo.id, complementoOpcao.grupoId))
        .innerJoin(complemento, eq(complemento.id, complementoGrupo.origemComplementoId))
        .where(
          and(
            eq(complementoOpcao.tenantId, tenantId),
            inArray(complementoOpcao.id, it.opcaoIds),
            eq(complemento.imprimeEtiqueta, true),
          ),
        );
      if (!flagged.length) continue;
      let alvos = (await this.destinosPorOpcoes(db, tenantId, flagged.map((f) => f.id)))
        .filter((d) => d.tipo === 'impressora' && d.equipamentoId)
        .map((d) => d.equipamentoId as string);
      if (!alvos.length)
        alvos = [...impressoras.entries()].filter(([, s]) => s.has(it)).map(([eqId]) => eqId);
      if (!alvos.length && padraoId) alvos = [padraoId];
      if (!alvos.length) continue;
      const conteudo = this.renderEtiquetaItem(ctx, it, numero);
      for (const eqId of [...new Set(alvos)]) {
        await db.insert(impressaoJob).values({
          tenantId,
          unidadeId: ctx.unidadeId ?? null,
          equipamentoId: eqId,
          pedidoId: ped.id,
          comandaId,
          via: 'etiqueta',
          conteudo,
        });
        enfileirados++;
      }
    }
    return enfileirados;
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
    return this.enfileirarViaCliente(tenantId, unidadeId, null, conteudo, terminalId, null, 'caixa', perfil.impressoras);
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
        tamanho?: string; // legado: 'grande' == escala 2
        escala?: number; // magnificação 1..4 (1 = normal)
        mini?: boolean; // fonte pequena (Font B) — régua "Pequena"/"Média"
        comp?: { negrito?: boolean; escala?: number; mini?: boolean }; // estilo dos complementos (só em itens)
        obs?: { negrito?: boolean; escala?: number; mini?: boolean }; // estilo da observação (só em itens)
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
      // itens é tratado à parte no loop (estilo por linha: nome/complemento/obs/valor).
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
    // Escala 1..4 de um estilo (compat: tamanho 'grande' == 2).
    const escOf = (o: any): number =>
      o?.escala && o.escala >= 2 ? Math.min(4, Math.floor(o.escala)) : o?.tamanho === 'grande' ? 2 : 1;
    // Monta o token de flags (@C/@R/@B/@S/@D…) de um estilo. @D=2× (edges antigos
    // entendem); @D3/@D4 = 3×/4× (requer escpos atualizado). @S = fonte pequena.
    const flagStr = (align: string, negrito: boolean, mini: boolean, esc: number): string =>
      (align === 'centro' ? 'C' : align === 'direita' ? 'R' : '') +
      (negrito ? 'B' : '') +
      (mini ? 'S' : '') +
      (esc >= 3 ? `D${esc}` : esc === 2 ? 'D' : '');
    let prev: { idx: number; text: string } | null = null;
    for (const c of perfil.campos) {
      if (!c.visivel) continue;

      // ITENS: cada linha tem estilo próprio — complementos e observação podem ficar
      // maiores/negrito para não passarem batidos na cozinha (c.comp / c.obs).
      if (c.key === 'itens') {
        if (!(dados.itens ?? []).length) continue;
        const fNome = flagStr(c.alinhamento, !!c.negrito, !!c.mini, escOf(c));
        const fComp = c.comp ? flagStr(c.alinhamento, !!c.comp.negrito, !!c.comp.mini, escOf(c.comp)) : fNome;
        const fObs = c.obs ? flagStr(c.alinhamento, !!c.obs.negrito, !!c.obs.mini, escOf(c.obs)) : fNome;
        const put = (f: string, t: string) => out.push(f ? `@${f} ${t}` : t);
        out.push(sep);
        for (const it of dados.itens ?? []) {
          put(fNome, `${Number(it.quantidade)}x ${it.descricao}`);
          if (it.complementosTexto) put(fComp, `   ${it.complementosTexto}`);
          if (it.observacao) put(fObs, `   OBS: ${it.observacao}`);
          if (dados.mostrarValoresItem) put(fNome, `   ${money(Number(it.precoUnitario) * Number(it.quantidade))}`);
        }
        out.push(sep);
        prev = null;
        continue;
      }

      let linhas: string[];
      if (c.key === '_espaco') linhas = [''];
      else if (c.key === '_tracejado') linhas = ['-'.repeat(24)]; // linha divisória (centralizável)
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
      const flags = flagStr(c.alinhamento, !!c.negrito, !!c.mini, escOf(c));
      for (const t of linhas) {
        if (t.startsWith('@QR:')) out.push(t); // QR: linha própria (o escpos centraliza)
        else out.push(flags ? `@${flags} ${t}` : t);
      }
      prev = simples ? { idx: out.length - 1, text: linhas[0] } : null;
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
    impressorasPerfil?: string[] | null, // S5 — impressoras direcionadas ao perfil deste cupom
  ): Promise<{ enfileirados: number; aviso: string | null }> {
    const cols = {
      id: equipamento.id,
      conexao: equipamento.conexao,
      host: equipamento.host,
      dispositivo: equipamento.dispositivo,
      fazProducao: equipamento.fazProducao, // P3 — não jogar cupom do cliente na cozinha
      fazCupom: equipamento.fazCupom,
    };
    type Imp = {
      id: string;
      conexao: string | null;
      host: string | null;
      dispositivo: string | null;
      fazProducao?: boolean | null;
      fazCupom?: boolean | null;
    };
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

    // (0.5) impressoras DIRECIONADAS ao perfil deste cupom (S5). Quando o perfil tem
    // impressoras associadas, elas mandam — o fallback abaixo (terminal/faz_cupom) só
    // entra se nenhuma for válida (config trocada). Vias saem de cada impressora.
    if (!printers.length && impressorasPerfil?.length) {
      printers = await this.db
        .select(cols)
        .from(equipamento)
        .where(
          and(
            inArray(equipamento.id, impressorasPerfil),
            eq(equipamento.tenantId, tenantId),
            eq(equipamento.tipo, 'impressora'),
            eq(equipamento.ativo, true),
          ),
        );
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
      // P3 — prefere impressora que NÃO seja só de produção (evita cupom do cliente na cozinha);
      // depois local/USB. Se sobrar só produção, usa mesmo assim, mas com aviso mais forte.
      const disponiveis = todas.filter((p) => this.alvoValido(p)).sort((a, b) => {
        const soProdA = a.fazProducao && !a.fazCupom ? 1 : 0;
        const soProdB = b.fazProducao && !b.fazCupom ? 1 : 0;
        if (soProdA !== soProdB) return soProdA - soProdB;
        return (a.conexao === 'local' ? -1 : 0) - (b.conexao === 'local' ? -1 : 0);
      });
      if (disponiveis.length) {
        const p0 = disponiveis[0];
        validos = [p0];
        aviso =
          p0.fazProducao && !p0.fazCupom
            ? 'Nenhuma impressora de cupom configurada — usei uma impressora de PRODUÇÃO. Configure uma impressora de cupom.'
            : 'Nenhuma impressora de cupom configurada — usei a primeira impressora disponível.';
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
        comandaId: comandaId ?? null, // liga à venda (idempotência do materializador do edge)
        via,
        conteudo,
      });
    }
    return { enfileirados: validos.length, aviso };
  }

  // ===== Fila de impressão (worker do edge; auth por token servidor_local) =====
  // Devolve host/porta da impressora junto (o worker não precisa de outra chamada).
  // Reserva ATÔMICA (claim/lease, mig 221) + entrega da fila ao worker (edge/nuvem). O
  // `for update skip locked` impede dois consumidores pegarem o MESMO job (fim do duplo-print);
  // marca 'enviando' + lease de 120s na entrega — se o worker morrer no meio, o job só volta a
  // ser pegável quando a lease vence (não reimprime a cada ciclo se o ACK falhar). F2: filtro
  // pela unidade do edge (+ os "da rede", unidade_id null). Vias por tipo (mig 168).
  async jobsPendentes(tenantId: string, unidadeId: string | null = null, limite = 20) {
    const filtro = unidadeId
      ? sql`and (j.unidade_id = ${unidadeId} or j.unidade_id is null)`
      : sql``;
    const r: any = await this.db.execute(sql`
      with alvo as (
        select j.id from impressao_job j
        where j.tenant_id = ${tenantId}
          and ((j.status = 'pendente' and (j.claim_ate is null or j.claim_ate < now()))
               or (j.status = 'enviando' and j.claim_ate < now()))
          ${filtro}
        order by j.criado_em asc
        limit ${limite}
        for update skip locked
      ),
      claimed as (
        update impressao_job
        set status = 'enviando', claim_por = 'cloud', claim_ate = now() + interval '120 seconds'
        where id in (select id from alvo)
        returning id, equipamento_id, pedido_id, via, conteudo, tentativas, criado_em
      )
      select c.id, c.equipamento_id as "equipamentoId", c.pedido_id as "pedidoId",
             c.conteudo, c.tentativas, c.criado_em as "criadoEm",
             e.conexao, e.host, e.porta, e.dispositivo, e.largura,
             case
               when c.via = 'cliente' then coalesce(e.vias_cliente, e.vias)
               when c.via = 'producao' then coalesce(e.vias_producao, e.vias)
               else e.vias end as vias,
             e.nome as impressora, e.linguagem_etiqueta as linguagem
      from claimed c
      left join equipamento e on e.id = c.equipamento_id
      order by c.criado_em asc`);
    return (r.rows ?? r) as any[];
  }

  async marcarImpresso(tenantId: string, jobId: string) {
    await this.db
      .update(impressaoJob)
      .set({ status: 'impresso', impressoEm: new Date(), claimPor: null, claimAte: null })
      .where(
        and(eq(impressaoJob.id, jobId), eq(impressaoJob.tenantId, tenantId)),
      );
    return { ok: true };
  }

  async marcarErro(tenantId: string, jobId: string, erro?: string) {
    // Auto-retry (P2): re-enfileira 'pendente' com backoff crescente (reusa claim_ate como "não
    // pegar antes de") até 5 rounds; depois 'erro' terminal (reimpressão manual). CASE atômico.
    await this.db.execute(sql`
      update impressao_job set
        tentativas = tentativas + 1,
        erro = ${(erro ?? 'falha').slice(0, 400)},
        claim_por = null,
        status = case when tentativas + 1 < 5 then 'pendente' else 'erro' end,
        claim_ate = case when tentativas + 1 < 5 then now() + (interval '30 seconds' * (tentativas + 1)) else null end
      where id = ${jobId} and tenant_id = ${tenantId}`);
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

  // P4 — expurgo da fila de impressão (não cresce pra sempre). Roda no backend da NUVEM E no do
  // EDGE — cada um limpa a SUA fila local (impressao_job é por-banco). Mantém 'impresso' 3 dias
  // (histórico do painel), 'erro' 14 dias (diagnóstico) e órfãos 'pendente'/'enviando' 2 dias.
  @Cron('17 4 * * *')
  async expurgarFilaImpressao() {
    try {
      const r: any = await this.db.execute(sql`
        delete from impressao_job
        where (status = 'impresso' and impresso_em < now() - interval '3 days')
           or (status = 'erro' and criado_em < now() - interval '14 days')
           or (status in ('pendente', 'enviando') and criado_em < now() - interval '2 days')`);
      const n = Number(r.rowCount ?? r.rows?.length ?? 0);
      if (n) logImpressao.log(`expurgo: ${n} jobs antigos removidos da fila`);
    } catch (e: any) {
      logImpressao.warn(`expurgo falhou: ${e?.message ?? e}`);
    }
  }

  // Enfileira uma página de teste para a impressora (botão do painel). O worker
  // do edge converte o texto em ESC/POS e imprime — valida IP/porta/papel na hora.
  async enfileirarTeste(tenantId: string, equipamentoId: string) {
    // F10 — com edge ativo, a impressora está na LAN (a nuvem não a alcança direto).
    // Em vez de um aviso morto, dispara um COMANDO REMOTO: o servidor local recebe no
    // próximo ciclo e imprime um teste em TODAS as impressoras configuradas nele. Sem
    // sincronizar impressao_job/equipamento — reusa o canal edge_comando (mesmo do
    // rollback). O `equipamentoId` clicado é ignorado (a config de impressora vive no
    // edge; a nuvem não tem os ids dele) — testa todas, que é o que valida "imprime?".
    if (await edgeAtivo(this.db, tenantId)) {
      await this.db.execute(sql`
        insert into edge_comando (tenant_id, comando, solicitado_por)
        values (${tenantId}, 'testar_impressora', 'nuvem')`);
      return {
        ok: true,
        edge: true,
        aviso:
          'Servidor local ativo — enviei um teste para as impressoras configuradas nele. ' +
          'O papel sai em alguns segundos (no próximo ciclo do servidor).',
      };
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
    const set: {
      status: string;
      erro: null;
      claimPor: null;
      claimAte: null;
      equipamentoId?: string;
    } = {
      status: 'pendente',
      erro: null,
      claimPor: null,
      claimAte: null,
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
  // para o próximo KDS). Uma requisição só (o KDS não dispara um POST por card).
  // `avancar` tem efeito por card (roteia p/ próximo KDS, imprime na etapa, reflete no
  // delivery) — não dá pra bulkar cru; então rodamos os cards em PARALELO com limite
  // de concorrência (era sequencial: 150 cards × até 6 passos × ~5 queries em série
  // estourava o timeout do proxy e limpava parcial).
  async limparFila(
    tenantId: string,
    atorId: string,
    opts: { setorId?: string; unidadeId?: string; canal?: string; equipamentoId?: string } = {},
  ) {
    const { pedidos } = await this.filaKds(tenantId, opts);
    const ativos = (pedidos as any[]).filter((p) => p.status !== 'cancelado' && p.status !== 'entregue');
    let avancados = 0;
    // Avança um card até ele sair desta fila (concluído/cancelado ou roteado p/ outro KDS).
    const finalizarUm = async (p: any) => {
      for (let i = 0; i < 6; i++) {
        let novo: string;
        try {
          const r = await this.avancar(tenantId, atorId, p.id, 'entrega', opts.equipamentoId);
          novo = (r as any)?.status;
          avancados++; // JS single-thread: ++ é seguro mesmo com Promise.all
        } catch {
          break; // já concluído ou não avança mais
        }
        if (novo === 'entregue' || novo === 'cancelado') break;
        // Roteou para outro KDS? (destino diferente do KDS operado → saiu desta fila).
        if (opts.equipamentoId) {
          const [atual] = await this.db
            .select({ destino: producaoPedido.destinoEquipamentoId })
            .from(producaoPedido)
            .where(eq(producaoPedido.id, p.id));
          if (atual?.destino && atual.destino !== opts.equipamentoId) break;
        }
      }
    };
    // Lotes concorrentes (limite < pool de conexões p/ não esgotar).
    const CONC = 8;
    for (let i = 0; i < ativos.length; i += CONC) {
      await Promise.all(ativos.slice(i, i + CONC).map(finalizarUm));
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
