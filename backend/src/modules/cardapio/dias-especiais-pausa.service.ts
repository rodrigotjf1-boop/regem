/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import type { AuthUser } from '../../auth/auth-user';
import { ehServidorLocal } from '../../common/modo';
import { agoraEmSaoPaulo, somarDias } from '../../common/horario-da-data';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PausaDoCanalService } from '../delivery/pausa-do-canal.service';
import { deLinha } from './dias-especiais';
import { pausaAutomaticaLigada } from './dias-especiais.service';
import { pausasDeAgora, pausasDoDiaEspecial, type JanelaDePausa } from './pausa-do-dia-especial';

// A PAUSA SOZINHA DO IFOOD E DA 99 NO DIA ESPECIAL (fase H3; protótipo `mockups/regem-dias-especiais.html`, decisão 5). A cada
// 5 minutos, só na NUVEM (é ela que fala com o iFood e a 99 — `PausaNosCanaisService`) e só com a variável
// `DIAS_ESPECIAIS_PAUSA_AUTOMATICA=1` (o dono liga): os dias especiais de hoje e de ontem (a abertura que vira a meia-noite) com
// "Pausar o iFood e a 99" ligado viram as janelas de `pausasDoDiaEspecial`; a que vale agora e ainda não foi feita é pausada
// pela pausa de SEMPRE (`PausaDoCanalService.pausar`, a do "⏸ Pausar" do painel), com o nome do dia no motivo.
//
// O "já fiz" (V42) é a própria linha da pausa do canal: se ela foi tocada depois que a janela começou — por esta rotina ou pela
// equipe (pausou à mão, reabriu) —, a rotina não mexe mais. Assim a loja que reabriu o iFood no Natal não é pausada de novo, e a
// pausa manual mais longa não é encurtada. Cada decisão vai à auditoria (`dia_especial_pausou_canal`, com o resultado).

const CRON_DA_PAUSA = '0 */5 * * * *';

/** Quem pausa: o Regem, pela empresa do dia especial (vai ao "pausado por" e à auditoria). */
const SISTEMA = (tenantId: string): AuthUser => ({ tenantId, colaboradorId: null, nome: 'Regem (dia especial)', categoria: 'sistema' }) as any;

type Candidata = JanelaDePausa & { tenantId: string; unidadeId: string | null; diaEspecialId: string; nome: string };

const linhas = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));

@Injectable()
export class DiasEspeciaisPausaService {
  private readonly logger = new Logger('DiasEspeciaisPausa');
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly pausas: PausaDoCanalService,
    private readonly auditoria: AuditoriaService,
  ) {}

  @Cron(CRON_DA_PAUSA)
  async rotina(): Promise<void> {
    if (ehServidorLocal() || !pausaAutomaticaLigada() || this.rodando) return;
    this.rodando = true;
    try {
      await this.volta();
    } catch (e: any) {
      this.logger.error(`a pausa dos dias especiais não rodou: ${String(e?.message ?? e).slice(0, 300)}`, e?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /** As janelas que valem agora (todas as empresas, ou só `soEmpresas`). Só lê. */
  async janelasDeAgora(agora: Date = new Date(), soEmpresas?: string[]): Promise<Candidata[]> {
    const { dia } = agoraEmSaoPaulo(agora);
    const ontem = somarDias(dia, -1);
    const so = soEmpresas?.length ? sql`and h.tenant_id in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;
    const r: any = await this.db.execute(sql`
      select h.id, h.tenant_id::text as tenant_id, h.unidade_id::text as unidade_id, to_char(h.data, 'YYYY-MM-DD') as data,
             to_char(h.data_fim, 'YYYY-MM-DD') as data_fim, h.nome, h.funcionamento, h.abre, h.fecha, h.conjunto, h.aviso_antes,
             h.pausar_canais,
             (select c.horarios from cardapio_config c
               where c.tenant_id = h.tenant_id and (c.unidade_id = h.unidade_id or c.unidade_id is null)
               order by (c.unidade_id is not distinct from h.unidade_id) desc
               limit 1) as semana
        from horario_especial h
        join empresa emp on emp.id = h.tenant_id and emp.deleted_at is null
       where h.deleted_at is null and h.pausar_canais and h.funcionamento <> 'normal' and h.conjunto <> 'retirada'
         and h.data <= ${dia}::date and coalesce(h.data_fim, h.data) >= ${ontem}::date ${so}
       limit 500`);
    const out: Candidata[] = [];
    for (const x of linhas(r)) {
      const e = deLinha(x);
      const janelas = [ontem, dia].flatMap((d) => pausasDoDiaEspecial(e, Array.isArray(x.semana) ? x.semana : [], d));
      for (const j of pausasDeAgora(janelas, agora))
        out.push({ ...j, tenantId: x.tenant_id, unidadeId: x.unidade_id ?? null, diaEspecialId: String(x.id), nome: e.nome });
    }
    return out;
  }

  /** Uma volta: pausa o que vale agora e ainda não foi tocado. Devolve o que decidiu (para o teste e o log). */
  async volta(agora: Date = new Date(), soEmpresas?: string[]): Promise<Array<{ chave: string; resultado: string }>> {
    const feitas: Array<{ chave: string; resultado: string }> = [];
    for (const c of await this.janelasDeAgora(agora, soEmpresas)) {
      const resultado = await this.pausarUma(c, agora).catch((e: any) => {
        this.logger.warn(`a pausa ${c.chave} não saiu — ${e?.message ?? e}`);
        return null;
      });
      if (resultado) feitas.push({ chave: c.chave, resultado });
    }
    return feitas;
  }

  /** A decisão de UMA janela: `null` quando não há nada a fazer (já tocada); senão o resultado gravado na auditoria. */
  private async pausarUma(c: Candidata, agora: Date): Promise<string | null> {
    // O "já fiz": a linha da pausa deste canal tocada depois que a janela começou (por esta rotina ou pela equipe).
    const tocada = linhas(
      await this.db.execute(sql`
        select 1 from pausa_canal
         where tenant_id = ${c.tenantId}::uuid and canal = ${c.canal}
           and (unidade_id is not distinct from ${c.unidadeId}::uuid or ${c.unidadeId}::uuid is null)
           and pausado_em >= ${c.de.toISOString()}::timestamptz
         limit 1`),
    ).length > 0;
    if (tocada) return null;
    // Já decidida antes (o canal não ligado, já estava pausado, a recusa): não se repete a cada 5 minutos.
    const decidida = linhas(
      await this.db.execute(sql`
        select 1 from audit_log
         where tenant_id = ${c.tenantId}::uuid and acao = 'dia_especial_pausou_canal' and detalhe ->> 'chave' = ${c.chave}
         limit 1`),
    ).length > 0;
    if (decidida) return null;
    const estado: any = await this.pausas.estado(c.tenantId, c.unidadeId, agora);
    const canal = (estado?.canais ?? []).find((x: any) => x.canal === c.canal);
    let resultado: string;
    if (!canal?.disponivel) resultado = 'canal_nao_ligado';
    else if (canal.pausa && new Date(canal.pausa.ate).getTime() >= c.ate.getTime() - 60_000) resultado = 'ja_estava_pausado';
    else {
      try {
        await this.pausas.pausar(
          SISTEMA(c.tenantId),
          c.unidadeId,
          {
            canais: [c.canal],
            motivo: 'outro',
            motivoTexto: c.motivoTexto,
            ...(c.canal === 'food99' ? { tempo99: { fimDoDia: true } } : { tempo: { ate: c.ateHora ?? undefined } }),
          },
          agora,
        );
        resultado = 'pausado';
      } catch (e: any) {
        if (!(e instanceof BadRequestException)) throw e;
        resultado = `recusado: ${String(e.message ?? '').slice(0, 120)}`;
      }
    }
    await this.auditoria.registrar({
      tenantId: c.tenantId,
      unidadeId: c.unidadeId,
      atorId: null,
      atorPerfil: 'sistema',
      tipo: 'delivery',
      acao: 'dia_especial_pausou_canal',
      entidadeTipo: 'horario_especial',
      entidadeId: c.diaEspecialId,
      detalhe: { chave: c.chave, canal: c.canal, nome: c.nome, ate: c.ate.toISOString(), resultado },
    });
    return resultado;
  }
}
