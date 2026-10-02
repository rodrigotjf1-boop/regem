import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { cardapioConfig, cupom, produto } from '../../db/schema';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import {
  EVENTOS_COM_JOGO,
  EventosInvalidos,
  JOGO_ANTES_MS,
  JOGO_DEPOIS_MS,
  MAX_CHAMADA,
  MAX_COLECAO,
  MAX_DIAS_ANTES,
  MAX_DIAS_DEPOIS,
  MAX_JOGOS,
  MAX_TEXTO,
  MAX_TITULO,
  NOME_EVENTO,
  agendaDeEventos,
  aplicarEventos,
  diaEmBrasilia,
  eventoNoAr,
  lerEventos,
  type EventoChave,
  type EventosConfig,
} from './eventos-cardapio';

/* eslint-disable @typescript-eslint/no-explicit-any */

// EVENTOS SAZONAIS DO CARDÁPIO — a configuração do presidente (Delivery → Configurações → Eventos).
//
// Fica em `cardapio_config.tema_config.eventos`, sem tabela nova. Tem rota própria, e não a de
// "salvar configuração do cardápio", por três motivos: (1) só o presidente grava — a rota geral
// aceita gerente; (2) aqui o corpo é conferido campo a campo (a geral é um `dto` livre com junção
// rasa de `temaConfig`); (3) a gravação troca SÓ a chave `eventos`, numa instrução, sem ler e
// regravar o tema inteiro — salvar cor/banner ao mesmo tempo em outra tela não apaga os eventos, e
// salvar eventos não apaga cor/banner.
@Injectable()
export class EventosCardapioService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
  ) {}

  /** A configuração do cardápio é uma linha por empresa (sem loja). */
  private async linha(tenantId: string) {
    const [row] = await this.db
      .select({ id: cardapioConfig.id, temaConfig: cardapioConfig.temaConfig })
      .from(cardapioConfig)
      .where(and(eq(cardapioConfig.tenantId, tenantId), isNull(cardapioConfig.unidadeId)));
    return row ?? null;
  }

  async obter(tenantId: string, categoria: string) {
    const row = await this.linha(tenantId);
    return this.resposta(lerEventos((row?.temaConfig as any)?.eventos), !!row, categoria);
  }

  private resposta(config: EventosConfig, temCardapio: boolean, categoria: string) {
    const agora = new Date();
    return {
      /** Sem cardápio digital configurado não há onde guardar (nem o que enfeitar). */
      temCardapio,
      podeEditar: categoria === 'presidente',
      config,
      hoje: diaEmBrasilia(agora),
      noAr: eventoNoAr(config, agora)?.chave ?? null,
      agenda: agendaDeEventos(config, agora),
      diaDeJogo: { ativo: config.porEvento.jogo?.ativo === true, ligaAntesMin: JOGO_ANTES_MS / 60_000, desligaDepoisMin: JOGO_DEPOIS_MS / 60_000 },
      limites: {
        diasAntes: MAX_DIAS_ANTES, diasDepois: MAX_DIAS_DEPOIS, titulo: MAX_TITULO, texto: MAX_TEXTO,
        colecao: MAX_COLECAO, jogos: MAX_JOGOS, chamada: MAX_CHAMADA,
      },
    };
  }

  async salvar(user: AuthUser, dto: unknown) {
    const tenantId = user.tenantId;
    const row = await this.linha(tenantId);
    if (!row) throw new BadRequestException('Ative o cardápio digital antes de configurar os eventos.');
    const atual = lerEventos((row.temaConfig as any)?.eventos);
    let novo: EventosConfig;
    try {
      novo = aplicarEventos(atual, dto, new Date());
    } catch (e) {
      if (e instanceof EventosInvalidos) throw new BadRequestException(e.message);
      throw e;
    }
    await this.conferirDonos(tenantId, novo);

    // Troca só a chave `eventos` (junção de jsonb no próprio banco): o resto do tema fica como está.
    await this.db
      .update(cardapioConfig)
      .set({
        temaConfig: sql`coalesce(${cardapioConfig.temaConfig}, '{}'::jsonb) || ${JSON.stringify({ eventos: novo })}::jsonb`,
        updatedAt: new Date(), // cursor do sincronismo com o servidor da loja
      })
      .where(eq(cardapioConfig.id, row.id));

    await this.auditoria.registrar({
      tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao: 'cardapio_eventos_alterados',
      entidadeTipo: 'cardapio_config',
      entidadeId: row.id,
      detalhe: this.resumoDaMudanca(atual, novo),
    });
    return this.resposta(novo, true, user.categoria);
  }

  /** Produto da coleção e cupom do jogo têm de ser da própria empresa (o cupom, ativo). */
  private async conferirDonos(tenantId: string, cfg: EventosConfig) {
    const produtos = new Set<string>();
    const cupons = new Map<string, EventoChave>();
    for (const [chave, e] of Object.entries(cfg.porEvento) as [EventoChave, NonNullable<EventosConfig['porEvento'][EventoChave]>][]) {
      for (const id of e.colecao ?? []) produtos.add(id);
      if (e.cupomJogo && EVENTOS_COM_JOGO.includes(chave)) cupons.set(e.cupomJogo, chave);
    }
    if (produtos.size) {
      const achados = await this.db
        .select({ id: produto.id })
        .from(produto)
        .where(and(eq(produto.tenantId, tenantId), inArray(produto.id, [...produtos])));
      if (achados.length !== produtos.size) throw new BadRequestException('Há produto na coleção que não é desta empresa. Escolha de novo os produtos do evento.');
    }
    if (cupons.size) {
      const achados = await this.db
        .select({ id: cupom.id })
        .from(cupom)
        .where(and(eq(cupom.tenantId, tenantId), eq(cupom.ativo, true), inArray(cupom.id, [...cupons.keys()])));
      const ok = new Set(achados.map((c) => c.id));
      for (const [id, chave] of cupons) {
        if (!ok.has(id)) throw new BadRequestException(`${NOME_EVENTO[chave]}: o cupom do jogo não existe mais ou está desativado. Escolha outro.`);
      }
    }
  }

  /** O que mudou, em poucas palavras — é o que fica na auditoria. */
  private resumoDaMudanca(antes: EventosConfig, depois: EventosConfig) {
    const ligados = (c: EventosConfig) => Object.entries(c.porEvento).filter(([, e]) => e?.ativo).map(([k]) => k).sort();
    const a = ligados(antes);
    const d = ligados(depois);
    return {
      ligou: d.filter((k) => !a.includes(k)),
      desligou: a.filter((k) => !d.includes(k)),
      ligados: d,
      jogos: depois.jogos.length,
      animacoes: depois.animacoes,
      coresDoEvento: depois.coresDoEvento,
    };
  }
}
