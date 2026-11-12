import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { Interval } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { alertaKds } from '../../db/schema';
import { ehServidorLocal } from '../../common/modo';
import { ehTipoDeAviso, prioridadeDoKds } from '../../common/avisos-do-kds';
import { avisoDaLinha, duracaoDoAviso, kdsDoAviso, type AvisoDaTela } from './alerta-kds';

/* eslint-disable @typescript-eslint/no-explicit-any */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** De onde vem cada tipo, quando quem emite não diz (o histórico mostra). */
const ORIGEM_DO_TIPO: Record<string, string> = {
  loja: 'Alertas da loja',
  farol: 'Farol',
  pausa: 'Pausa dos canais',
  estoque: 'Estoque',
  chegou: 'Cliente chegou',
  gestao: 'Gestão',
};

/** Quantas horas o histórico olha por padrão, e o máximo (os 90 dias guardados). */
export const HORAS_DO_HISTORICO = 24;
export const DIAS_GUARDADOS = 90;
/** O urgente que espera o "Ciente" volta à tela recarregada por até 12 horas (a janela da fila do KDS). */
export const HORAS_DO_PENDENTE = 12;
/** O servidor da loja mostra o aviso da nuvem que desceu há até 3 minutos (depois disso, só o pendente, pela tela). */
export const MINUTOS_PARA_MOSTRAR_NA_LOJA = 3;

/** O que chega para virar aviso (o evento `kds.alerta.sistema`, de qualquer módulo, ou o transporte do Farol). */
export type EntradaDoAviso = {
  tenantId: string;
  unidadeId?: string | null;
  id?: string;
  titulo: string;
  detalhe?: string | null;
  prioridade?: string;
  duracaoSeg?: number;
  tipo?: string;
  kds?: unknown;
  fica?: unknown;
  origem?: string | null;
  ref?: string | null;
  /** O aviso da NUVEM que o servidor da loja também mostra quando a linha desce (o Farol, o "Testar" feito na nuvem). */
  naLoja?: boolean;
};

/**
 * OS AVISOS DO KDS GUARDADOS (auditoria do KDS de 11/11/2026, onda 3 — mig 412). Todo aviso que vai ao rodapé das telas
 * passa por aqui: vira uma linha da `alerta_kds` e então vai às telas (`kds.alerta.mostrar` → o gateway → `kds:alerta`).
 *  • O "Ciente" de uma tela grava quem e quando, e tira o aviso das outras (`kds:aviso-ciente`).
 *  • A tela recarregada recupera o urgente que ainda espera o "Ciente" (`pendentes`).
 *  • O histórico de 90 dias (`historico`) é o do LADO da tela: os dois lados rodam o motor dos alertas cadastrados, e cada
 *    um guarda o seu — sem nada em dobro. No servidor da loja entram também os avisos que a nuvem marcou para a loja.
 *  • No servidor da loja, o aviso da nuvem marcado para a loja (o Farol) é mostrado quando a linha desce pelo sync.
 * Guardar nunca impede o aviso de aparecer: sem o banco, ele vai às telas do mesmo jeito (com o motivo no log).
 */
@Injectable()
export class AlertaKdsService {
  private readonly logger = new Logger('AlertaKds');
  /** Servidor da loja: os avisos da nuvem já mostrados aqui (id → quando), para não repetir a cada volta. */
  private mostradosDaNuvem = new Map<string, number>();
  private conferindo = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly events: EventEmitter2,
  ) {}

  /** O lado deste processo. */
  static lado(): 'nuvem' | 'loja' {
    return ehServidorLocal() ? 'loja' : 'nuvem';
  }

  /** As linhas que as telas DESTE lado viram (o histórico e os pendentes de cada lado). */
  private doLado() {
    return AlertaKdsService.lado() === 'loja'
      ? sql`(a.lado = 'loja' or (a.lado = 'nuvem' and a.entregar_na_loja))`
      : sql`a.lado = 'nuvem'`;
  }

  /** O aviso de qualquer módulo (o mesmo evento de sempre): guarda e mostra. */
  @OnEvent('kds.alerta.sistema')
  async aoAvisoDoSistema(p: EntradaDoAviso) {
    try {
      await this.guardarEMostrar(p);
    } catch (e: any) {
      this.logger.error(`aviso do KDS não foi às telas: ${e?.message ?? e}`);
    }
  }

  /**
   * Guarda e mostra. `soNovo` (o Farol, que reenvia o mesmo envio): se a linha já existia, não mostra de novo e devolve
   * 'repetido'. Nunca rejeita por causa do banco: sem gravar, mostra mesmo assim.
   */
  async guardarEMostrar(p: EntradaDoAviso, o: { soNovo?: boolean } = {}): Promise<{ aviso: AvisoDaTela; situacao: 'novo' | 'repetido' | 'sem_gravar' }> {
    if (!p?.tenantId || !UUID_RE.test(String(p.tenantId))) throw new BadRequestException('Aviso sem empresa.');
    const lado = AlertaKdsService.lado();
    const tipo = ehTipoDeAviso(p.tipo) ? p.tipo : 'loja';
    const linha = {
      id: p.id && UUID_RE.test(p.id) ? p.id : randomUUID(),
      tenantId: p.tenantId,
      unidadeId: p.unidadeId && UUID_RE.test(String(p.unidadeId)) ? String(p.unidadeId) : null,
      tipo,
      origem: (p.origem ? String(p.origem) : ORIGEM_DO_TIPO[tipo]).slice(0, 120),
      titulo: String(p.titulo ?? 'Alerta').slice(0, 200) || 'Alerta',
      detalhe: p.detalhe ? String(p.detalhe).slice(0, 500) : null,
      prioridade: prioridadeDoKds(p.prioridade),
      duracaoSeg: duracaoDoAviso(p.duracaoSeg),
      fica: p.fica === true,
      kdsIds: kdsDoAviso(p.kds),
      ref: p.ref ? String(p.ref).slice(0, 120) : null,
      lado,
      entregarNaLoja: lado === 'nuvem' && p.naLoja === true,
    };
    let situacao: 'novo' | 'repetido' | 'sem_gravar' = 'novo';
    let criadoEm: Date = new Date();
    try {
      const [r] = await this.db.insert(alertaKds).values(linha).onConflictDoNothing().returning({ criadoEm: alertaKds.criadoEm });
      if (r) criadoEm = r.criadoEm;
      else situacao = 'repetido';
    } catch (e: any) {
      situacao = 'sem_gravar';
      this.logger.warn(`aviso do KDS "${linha.titulo}" vai às telas SEM ficar guardado (histórico e "Ciente" dele não valem): ${e?.message ?? e}`);
    }
    const aviso = avisoDaLinha({ ...linha, criadoEm });
    if (situacao === 'repetido' && o.soNovo) return { aviso, situacao };
    this.mostrar(linha.tenantId, linha.unidadeId, aviso);
    return { aviso, situacao };
  }

  /** Manda às telas da loja (ou da empresa, sem loja) pelo gateway. */
  mostrar(tenantId: string, unidadeId: string | null, aviso: AvisoDaTela) {
    this.events.emit('kds.alerta.mostrar', { tenantId, unidadeId, ...aviso });
  }

  /**
   * "Ciente" numa tela: grava quem e quando e tira o aviso das outras telas. Idempotente — o segundo toque (outra tela, ou a
   * mesma de novo) responde quem deu o "Ciente" primeiro, sem gravar por cima.
   */
  async ciente(tenantId: string, id: string, ator: { id?: string | null; nome?: string | null }, kdsId?: unknown) {
    if (!UUID_RE.test(String(id))) throw new NotFoundException('Aviso não encontrado.');
    const kds = typeof kdsId === 'string' && UUID_RE.test(kdsId) ? kdsId : null;
    const nome = ator?.nome ? String(ator.nome).slice(0, 120) : null;
    const r: any = await this.db.execute(sql`
      update alerta_kds
         set ciente_em = now(), ciente_por_id = ${ator?.id && UUID_RE.test(String(ator.id)) ? String(ator.id) : null}::uuid,
             ciente_por_nome = ${nome}, ciente_kds_id = ${kds}::uuid
       where id = ${id}::uuid and tenant_id = ${tenantId}::uuid and ciente_em is null
       returning unidade_id, ciente_em, ciente_por_nome`);
    const feito = (r.rows ?? r)[0];
    if (feito) {
      this.events.emit('kds.alerta.ciente', { tenantId, unidadeId: feito.unidade_id ?? null, id, por: feito.ciente_por_nome ?? null });
      return { ok: true, id, cienteEm: new Date(feito.ciente_em).toISOString(), por: feito.ciente_por_nome ?? null, jaEstava: false };
    }
    const j: any = await this.db.execute(sql`
      select ciente_em, ciente_por_nome from alerta_kds where id = ${id}::uuid and tenant_id = ${tenantId}::uuid`);
    const ja = (j.rows ?? j)[0];
    if (!ja) throw new NotFoundException('Aviso não encontrado.');
    return { ok: true, id, cienteEm: new Date(ja.ciente_em).toISOString(), por: ja.ciente_por_nome ?? null, jaEstava: true };
  }

  /** O urgente que ainda espera o "Ciente" (a tela recarregada recupera): os do lado desta tela, das últimas 12 h. */
  async pendentes(tenantId: string, unidadeId: string | null): Promise<AvisoDaTela[]> {
    const r: any = await this.db.execute(sql`
      select a.* from alerta_kds a
       where a.tenant_id = ${tenantId}::uuid
         ${unidadeId ? sql`and (a.unidade_id = ${unidadeId}::uuid or a.unidade_id is null)` : sql``}
         and a.fica and a.ciente_em is null
         and a.criado_em > now() - make_interval(hours => ${HORAS_DO_PENDENTE})
         and ${this.doLado()}
       order by a.criado_em desc
       limit 50`);
    return (r.rows ?? r).map(avisoDaLinha);
  }

  /** O histórico do lado desta tela: as últimas `horas` (24 por padrão, até os 90 dias guardados), no máximo 300. */
  async historico(tenantId: string, unidadeId: string | null, horas?: unknown) {
    const h = Math.max(1, Math.min(DIAS_GUARDADOS * 24, Math.round(Number(horas) || HORAS_DO_HISTORICO)));
    const r: any = await this.db.execute(sql`
      select a.* from alerta_kds a
       where a.tenant_id = ${tenantId}::uuid
         ${unidadeId ? sql`and (a.unidade_id = ${unidadeId}::uuid or a.unidade_id is null)` : sql``}
         and a.criado_em > now() - make_interval(hours => ${h})
         and ${this.doLado()}
       order by a.criado_em desc
       limit 300`);
    return {
      horas: h,
      avisos: (r.rows ?? r).map((x: any) => ({
        ...avisoDaLinha(x),
        ciente: x.ciente_em ? { em: new Date(x.ciente_em).toISOString(), por: x.ciente_por_nome ?? null, kdsId: x.ciente_kds_id ?? null } : null,
      })),
    };
  }

  /**
   * SERVIDOR DA LOJA: o aviso da nuvem marcado para a loja (o Farol, o "Testar" feito na nuvem) chega pela sincronização;
   * aqui ele vai às telas da loja, uma vez. Só os que desceram há até 3 minutos (o urgente mais velho a tela recupera
   * pelos pendentes). Na nuvem não roda.
   */
  @Interval(5000)
  async mostrarOsQueDesceram() {
    if (!ehServidorLocal() || this.conferindo) return;
    this.conferindo = true;
    try {
      const r: any = await this.db.execute(sql`
        select a.* from alerta_kds a
         where a.lado = 'nuvem' and a.entregar_na_loja
           and a.criado_em > now() - make_interval(mins => ${MINUTOS_PARA_MOSTRAR_NA_LOJA})
           and a.ciente_em is null
         order by a.criado_em
         limit 50`);
      const agora = Date.now();
      for (const x of r.rows ?? r) {
        const id = String(x.id);
        if (this.mostradosDaNuvem.has(id)) continue;
        this.mostradosDaNuvem.set(id, agora);
        this.mostrar(String(x.tenant_id), x.unidade_id ?? null, avisoDaLinha(x));
      }
      for (const [id, em] of this.mostradosDaNuvem) if (agora - em > 10 * 60_000) this.mostradosDaNuvem.delete(id);
    } catch (e: any) {
      // Sem a tabela (o `.zip` ainda sem a mig 412) ou o banco fora: tenta na volta seguinte.
      this.logger.warn(`avisos que desceram da nuvem: a conferência falhou (tenta de novo) — ${e?.message ?? e}`);
    } finally {
      this.conferindo = false;
    }
  }

  /** Guardados por 90 dias: a limpeza roda nos dois lados, em lotes (a exclusão sincroniza). */
  @Interval(6 * 3600_000)
  async limpar() {
    try {
      const r: any = await this.db.execute(sql`
        delete from alerta_kds
         where id in (select id from alerta_kds where criado_em < now() - make_interval(days => ${DIAS_GUARDADOS}) limit 5000)`);
      const n = Number(r?.rowCount ?? 0);
      if (n) this.logger.log(`${n} avisos do KDS com mais de ${DIAS_GUARDADOS} dias apagados.`);
    } catch (e: any) {
      this.logger.warn(`limpeza dos avisos do KDS não rodou: ${e?.message ?? e}`);
    }
  }
}
