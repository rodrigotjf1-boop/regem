import { Injectable, Logger, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Inject } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { DRIZZLE, DrizzleDB } from '../../../db/drizzle.module';
import { ehServidorLocal } from '../../../common/modo';
import { IfoodService, IntegIfood } from './ifood.service';
import { atualizarAvaliacao, avaliacoesLigadas, lerAvaliacao, registrarAvaliacao } from './ifood-avaliacao';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** As avaliações dos últimos 7 dias (o padrão do iFood é 7 dias para trás). */
export const DIAS_DE_AVALIACOES = 7;
/** O iFood recusou (módulo não liberado): o motivo vai ao log no máximo uma vez por hora por loja. */
const AVISO_DE_RECUSA_MS = 60 * 60 * 1000;

/**
 * A ROTINA das avaliações do iFood (checkpoint da Central, item 4 — 06/11/2026). Só na NUVEM (a credencial do iFood mora
 * lá), de 30 em 30 minutos — avaliação não é urgente como pedido (regra da frequência pelo dado) —, só nas lojas com
 * "Avaliações do iFood na fila" ligado (nasce desligado). Lê os últimos 7 dias: a nova que pede uma pessoa vira caso; a
 * que a loja respondeu pelo Portal do Parceiro, ou que foi publicada ou descartada, resolve o caso que estava aberto.
 * O iFood recusando (401/403/404 — o módulo de avaliações não está liberado no app) não derruba nada: vira aviso no log.
 */
@Injectable()
export class IfoodAvaliacoesPoller {
  private readonly logger = new Logger('IfoodAvaliacoes');
  private rodando = false;
  private readonly recusas = new Map<string, number>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly ifood: IfoodService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  @Interval(30 * 60 * 1000)
  async tick(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      for (const ig of await this.ifood.integracoesAtivas()) {
        if (!avaliacoesLigadas(ig.config)) continue;
        await this.daLoja(ig).catch((e: any) => this.logger.warn(`loja ${ig.tenantId}: avaliações não lidas agora (${e?.message ?? e})`));
      }
    } catch (e: any) {
      this.logger.warn(`avaliações do iFood: a volta falhou — ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }

  /** Uma loja: lê, abre os casos novos e resolve os que mudaram no iFood. Devolve as contagens (o teste confere). */
  async daLoja(ig: IntegIfood): Promise<{ lidas: number; abertos: number; resolvidos: number; recusado: number | null }> {
    const r = await this.ifood.avaliacoes(ig, { desde: new Date(Date.now() - DIAS_DE_AVALIACOES * 86_400_000) });
    if (!r.ok) {
      const ultima = this.recusas.get(ig.id) ?? 0;
      if (Date.now() - ultima > AVISO_DE_RECUSA_MS) {
        this.recusas.set(ig.id, Date.now());
        this.logger.warn(
          `loja ${ig.tenantId}: o iFood recusou a leitura das avaliações (HTTP ${r.status})` +
            ([401, 403, 404].includes(r.status) ? ' — o módulo de avaliações não está liberado no app do iFood' : ''),
        );
      }
      return { lidas: 0, abertos: 0, resolvidos: 0, recusado: r.status };
    }
    const emitir = (e: string, p: any) => this.events?.emit(e, p);
    let abertos = 0;
    let resolvidos = 0;
    for (const bruto of r.itens) {
      const a = lerAvaliacao(bruto);
      if (!a) continue;
      if ((await registrarAvaliacao(this.db, emitir, ig, a)).aberto) abertos++;
      else if (await atualizarAvaliacao(this.db, emitir, ig.tenantId, a)) resolvidos++;
    }
    return { lidas: r.itens.length, abertos, resolvidos, recusado: null };
  }
}
